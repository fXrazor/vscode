/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	commands,
	EventEmitter,
	l10n,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
	window,
	workspace,
	type Event,
	type ExtensionContext,
	type TreeDataProvider,
	type TreeView
} from 'vscode';
import { activateProjects } from './project/index';
import { CloudForgeCanvasPanel } from './canvas/canvasPanel';
import { orientServiceEdgesForCanvas } from './canvas/layout';
import type { CanvasCatalogueSnapshot, CanvasCloudRegionsPayload, CanvasGraphSnapshot } from './canvas/protocol';
import { lookupBundledSchema, type FormSchema } from './canvas/schemaForm';
import {
	draftSaveErrorMessage,
	mapRustFormSchemaToCanvasFormSchema,
	mapServiceValidationPollToRun,
	parseCatalogueSnapshots,
	parseCloudRegionsPayload,
	parseDependencyReport,
	parseDraftSaveApply,
	parseDraftSavePreview,
	parseModuleInspection,
	parseValidationPoll,
	parseValidationStart,
	selectBestSnapshotForType,
	type ServicePollEvent
} from './canvas/serviceAdapters';

interface WorkspaceArchitecture {
	readonly architectureId: string;
	readonly displayName: string;
}

interface TerraformRoot {
	readonly candidateId: string;
	readonly displayName: string;
}

interface WorkspaceChoice {
	readonly workspaceId: string;
	readonly kind: 'project' | 'terraform';
	readonly displayName: string;
	readonly selectionRequired: boolean;
	readonly architectures: readonly WorkspaceArchitecture[];
	readonly terraformRoots: readonly TerraformRoot[];
}

interface GraphNode {
	readonly id: string;
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
	readonly label: string;
	readonly hasSource: boolean;
}

interface GraphEdge {
	readonly fromId: string;
	readonly toId: string;
	readonly kind: string;
}

interface GraphDiagnostic {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
}

interface ArchitectureGraph {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly status: 'complete' | 'partial';
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly diagnostics: readonly GraphDiagnostic[];
}

interface ServiceError {
	readonly code: string;
}

type ServiceResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ServiceError };

type OpenWorkspaceCommandResult = {
	readonly cancelled: boolean;
	readonly result?: ServiceResult<unknown>;
};

type GraphTreeItem = ResourceTreeItem | SectionTreeItem | ConnectionTreeItem | DiagnosticTreeItem;

class ResourceTreeItem {
	readonly type = 'resource';
	constructor(readonly node: GraphNode) { }
}

class SectionTreeItem {
	readonly type = 'section';
	constructor(readonly section: 'resources' | 'diagnostics') { }
}

class ConnectionTreeItem {
	readonly type = 'connection';
	constructor(readonly label: string, readonly direction: string) { }
}

class DiagnosticTreeItem {
	readonly type = 'diagnostic';
	constructor(readonly diagnostic: GraphDiagnostic) { }
}

class CloudForgeGraphProvider implements TreeDataProvider<GraphTreeItem> {
	private readonly changeEmitter = new EventEmitter<GraphTreeItem | undefined>();
	readonly onDidChangeTreeData: Event<GraphTreeItem | undefined> = this.changeEmitter.event;
	private graph: ArchitectureGraph | undefined;

	setGraph(graph: ArchitectureGraph | undefined): void {
		this.graph = graph;
		this.changeEmitter.fire(undefined);
	}

	getGraph(): ArchitectureGraph | undefined {
		return this.graph;
	}

	getTreeItem(element: GraphTreeItem): TreeItem {
		if (element.type === 'section') {
			const label = element.section === 'resources'
				? l10n.t('Resources')
				: l10n.t('Diagnostics');
			const count = element.section === 'resources' ? this.graph?.nodes.length ?? 0 : this.graph?.diagnostics.length ?? 0;
			const item = new TreeItem(label + ' (' + count + ')', TreeItemCollapsibleState.Expanded);
			item.contextValue = element.section;
			return item;
		}
		if (element.type === 'resource') {
			const edges = this.graph?.edges ?? [];
			const hasConnections = edges.some(edge => edge.fromId === element.node.id || edge.toId === element.node.id);
			const item = new TreeItem(element.node.label, hasConnections ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None);
			item.description = element.node.resourceType ?? element.node.kind;
			item.tooltip = element.node.kind + ': ' + element.node.name;
			item.contextValue = 'cloudForgeResource';
			return item;
		}
		if (element.type === 'connection') {
			const item = new TreeItem(element.label, TreeItemCollapsibleState.None);
			item.description = element.direction;
			item.contextValue = 'cloudForgeConnection';
			return item;
		}
		const item = new TreeItem(element.diagnostic.message, TreeItemCollapsibleState.None);
		item.description = element.diagnostic.code + ' · ' + element.diagnostic.severity;
		item.contextValue = 'cloudForgeDiagnostic';
		return item;
	}

	getChildren(element?: GraphTreeItem): GraphTreeItem[] {
		const graph = this.graph;
		if (!graph) {
			return [];
		}
		if (!element) {
			return [new SectionTreeItem('resources'), new SectionTreeItem('diagnostics')];
		}
		if (element.type === 'section') {
			return element.section === 'resources'
				? graph.nodes.map(node => new ResourceTreeItem(node))
				: graph.diagnostics.map(diagnostic => new DiagnosticTreeItem(diagnostic));
		}
		if (element.type !== 'resource') {
			return [];
		}
		const connections: ConnectionTreeItem[] = [];
		for (const edge of graph.edges) {
			if (edge.fromId === element.node.id) {
				const target = graph.nodes.find(node => node.id === edge.toId);
				if (target) {
					connections.push(new ConnectionTreeItem(edge.kind + ': ' + target.label, l10n.t('outgoing')));
				}
			} else if (edge.toId === element.node.id) {
				const source = graph.nodes.find(node => node.id === edge.fromId);
				if (source) {
					connections.push(new ConnectionTreeItem(edge.kind + ': ' + source.label, l10n.t('incoming')));
				}
			}
		}
		return connections;
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, limit = 1024): value is string {
	return typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseWorkspaceChoice(value: unknown): WorkspaceChoice | undefined {
	if (!isRecord(value) || !isOpaqueId(value.workspaceId) || (value.kind !== 'project' && value.kind !== 'terraform') || !isSafeText(value.displayName, 256) || typeof value.selectionRequired !== 'boolean' || !Array.isArray(value.architectures) || value.architectures.length > 256) {
		return undefined;
	}
	const architectures: WorkspaceArchitecture[] = [];
	for (const architecture of value.architectures) {
		if (!isRecord(architecture) || !isOpaqueId(architecture.architectureId) || !isSafeText(architecture.displayName, 256)) {
			return undefined;
		}
		architectures.push({ architectureId: architecture.architectureId, displayName: architecture.displayName });
	}
	const terraformRoots: TerraformRoot[] = [];
	if (value.terraformRoots !== undefined) {
		if (!Array.isArray(value.terraformRoots) || value.terraformRoots.length > 64) {
			return undefined;
		}
		for (const candidate of value.terraformRoots) {
			if (!isRecord(candidate) || !isOpaqueId(candidate.candidateId) || !isSafeText(candidate.displayName, 256)) {
				return undefined;
			}
			terraformRoots.push({ candidateId: candidate.candidateId, displayName: candidate.displayName });
		}
	}
	return {
		workspaceId: value.workspaceId,
		kind: value.kind,
		displayName: value.displayName,
		selectionRequired: value.selectionRequired,
		architectures,
		terraformRoots
	};
}

function edgeNodeIds(value: Record<string, unknown>): { fromId: string; toId: string } | undefined {
	const fromId = value.fromId ?? value.from ?? value.sourceId ?? value.source;
	const toId = value.toId ?? value.to ?? value.targetId ?? value.target;
	return isOpaqueId(fromId) && isOpaqueId(toId) ? { fromId, toId } : undefined;
}

function parseGraph(value: unknown, workspaceId: string, architectureId: string): ArchitectureGraph | undefined {
	if (!isRecord(value) || value.workspaceId !== workspaceId || value.architectureId !== architectureId || typeof value.sourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceRevision) || (value.status !== 'complete' && value.status !== 'partial') || !Array.isArray(value.nodes) || value.nodes.length > 10000 || !Array.isArray(value.edges) || value.edges.length > 40000 || !Array.isArray(value.diagnostics) || value.diagnostics.length > 2000) {
		return undefined;
	}
	const nodes: GraphNode[] = [];
	const nodeIds = new Set<string>();
	for (const node of value.nodes) {
		if (!isRecord(node) || !isOpaqueId(node.id) || !isSafeText(node.kind) || (node.resourceType !== null && !isSafeText(node.resourceType)) || !isSafeText(node.name) || !isSafeText(node.label)) {
			return undefined;
		}
		if (node.source !== undefined && node.source !== null && !isRecord(node.source)) {
			return undefined;
		}
		if (nodeIds.has(node.id)) {
			return undefined;
		}
		nodeIds.add(node.id);
		nodes.push({ id: node.id, kind: node.kind, resourceType: node.resourceType, name: node.name, label: node.label, hasSource: isRecord(node.source) });
	}
	const edges: GraphEdge[] = [];
	for (const edge of value.edges) {
		if (!isRecord(edge)) {
			return undefined;
		}
		const ids = edgeNodeIds(edge);
		const kind = edge.kind ?? edge.referenceKind;
		if (!ids || !nodeIds.has(ids.fromId) || !nodeIds.has(ids.toId) || !isSafeText(kind, 128)) {
			return undefined;
		}
		edges.push({ ...ids, kind });
	}
	const diagnostics: GraphDiagnostic[] = [];
	for (const diagnostic of value.diagnostics) {
		if (!isRecord(diagnostic) || !isSafeText(diagnostic.code, 128) || !isSafeText(diagnostic.severity, 32) || !isSafeText(diagnostic.message, 1024)) {
			return undefined;
		}
		diagnostics.push({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message });
	}
	return {
		workspaceId,
		architectureId,
		sourceRevision: value.sourceRevision,
		status: value.status,
		nodes,
		edges,
		diagnostics
	};
}

function errorMessage(code: string): string {
	switch (code) {
		case 'STALE_SOURCE': return l10n.t('The workspace source changed. Reopen it to refresh the graph.');
		case 'UNSUPPORTED_FORMAT': return l10n.t('This workspace format is not supported.');
		case 'WORKSPACE_UNAVAILABLE': return l10n.t('The selected workspace is not available.');
		case 'LIMIT_EXCEEDED': return l10n.t('The workspace exceeds the CloudForge inspection limit.');
		case 'SCOPE_DENIED': return l10n.t('This workspace is no longer active in this window.');
		default: return l10n.t('The CloudForge service could not complete the request.');
	}
}

async function callService<T>(method: string, params: Record<string, unknown>): Promise<ServiceResult<T>> {
	let result: unknown;
	try {
		result = await commands.executeCommand<unknown>('_cloudforge.callService', method, params);
	} catch {
		return { ok: false, error: { code: 'SERVICE_ERROR' } };
	}
	if (!isRecord(result) || typeof result.ok !== 'boolean') {
		return { ok: false, error: { code: 'SERVICE_ERROR' } };
	}
	if (result.ok === true) {
		return { ok: true, value: result.value as T };
	}
	return {
		ok: false,
		error: { code: isRecord(result.error) && typeof result.error.code === 'string' ? result.error.code : 'SERVICE_ERROR' }
	};
}

function showServiceError(error: ServiceError): void {
	void window.showErrorMessage(errorMessage(error.code));
}

async function readArchitecture(workspaceId: string, architectureId: string): Promise<ArchitectureGraph | undefined> {
	const result = await callService<unknown>('readArchitecture', { workspaceId, architectureId });
	if (!result.ok) {
		showServiceError(result.error);
		return undefined;
	}
	const graph = parseGraph(result.value, workspaceId, architectureId);
	if (!graph) {
		void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid graph.'));
	}
	return graph;
}

async function choose<T extends { readonly displayName: string; readonly id: string }>(items: readonly T[], placeHolder: string): Promise<T | undefined> {
	const selected = await window.showQuickPick(items.map(item => ({ label: item.displayName, item })), { placeHolder });
	return selected?.item;
}

async function openWorkspace(
	provider: CloudForgeGraphProvider,
	treeView: TreeView<GraphTreeItem>,
	onGraphLoaded: (graph: ArchitectureGraph, architectureName: string) => void
): Promise<void> {
	let response: OpenWorkspaceCommandResult | undefined;
	try {
		response = await commands.executeCommand<OpenWorkspaceCommandResult>('_cloudforge.openWorkspace');
	} catch {
		void window.showErrorMessage(l10n.t('The CloudForge service could not be started.'));
		return;
	}
	if (response?.cancelled) {
		return;
	}

	provider.setGraph(undefined);
	treeView.message = undefined;
	const opened = response?.result;
	if (!opened) {
		showServiceError({ code: 'SERVICE_ERROR' });
		return;
	}
	if (!opened.ok) {
		showServiceError(opened.error);
		return;
	}
	let choice = parseWorkspaceChoice(opened.value);
	if (!choice) {
		void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid workspace.'));
		return;
	}

	if (choice.selectionRequired) {
		if (choice.terraformRoots.length === 0) {
			void window.showErrorMessage(l10n.t('The CloudForge service did not return a Terraform root to select.'));
			return;
		}
		const selectedRoot = await choose(choice.terraformRoots.map(root => ({ id: root.candidateId, displayName: root.displayName })), l10n.t('Choose a Terraform root'));
		if (!selectedRoot) {
			return;
		}
		const selected = await callService<unknown>('chooseTerraformRoot', { workspaceId: choice.workspaceId, candidateId: selectedRoot.id });
		if (!selected.ok) {
			showServiceError(selected.error);
			return;
		}
		const selectedChoice = parseWorkspaceChoice(selected.value);
		if (!selectedChoice) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid Terraform root.'));
			return;
		}
		choice = selectedChoice;
	} else if (choice.terraformRoots.length > 1) {
		void window.showErrorMessage(l10n.t('The CloudForge service did not require a Terraform root selection.'));
		return;
	}

	let architecture: WorkspaceArchitecture | undefined;
	if (choice.kind === 'project') {
		if (choice.architectures.length === 0) {
			void window.showErrorMessage(l10n.t('This project has no supported architectures.'));
			return;
		}
		const selectedArchitecture = await choose(choice.architectures.map(item => ({ ...item, id: item.architectureId })), l10n.t('Choose an architecture'));
		if (!selectedArchitecture) {
			return;
		}
		const selected = await callService<unknown>('selectArchitecture', {
			workspaceId: choice.workspaceId,
			architectureId: selectedArchitecture.id
		});
		if (!selected.ok) {
			showServiceError(selected.error);
			return;
		}
		if (!isRecord(selected.value) || selected.value.workspaceId !== choice.workspaceId || selected.value.architectureId !== selectedArchitecture.id) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid architecture.'));
			return;
		}
		architecture = selectedArchitecture;
	} else {
		if (choice.architectures.length !== 1) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid Terraform architecture.'));
			return;
		}
		architecture = choice.architectures[0];
	}
	if (!architecture) {
		return;
	}

	const loaded = await showGraph(provider, treeView, choice.workspaceId, architecture.architectureId);
	if (loaded) {
		onGraphLoaded(loaded, architecture.displayName);
	}
}

/** Reads an architecture that is already selected and shows it in the graph view. */
async function showGraph(provider: CloudForgeGraphProvider, treeView: TreeView<GraphTreeItem>, workspaceId: string, architectureId: string): Promise<ArchitectureGraph | undefined> {
	const graph = await readArchitecture(workspaceId, architectureId);
	if (!graph) {
		return undefined;
	}
	provider.setGraph(graph);
	if (graph.status === 'partial') {
		treeView.message = l10n.t('This graph is partial. See Diagnostics for details.');
	} else if (graph.nodes.length === 0) {
		treeView.message = l10n.t('No resources were found in this architecture.');
	} else {
		treeView.message = undefined;
	}
	return graph;
}

function toCanvasSnapshot(graph: ArchitectureGraph, architectureName: string): CanvasGraphSnapshot {
	return {
		workspaceId: graph.workspaceId,
		architectureId: graph.architectureId,
		architectureName,
		sourceRevision: graph.sourceRevision,
		status: graph.status,
		nodes: graph.nodes,
		edges: orientServiceEdgesForCanvas(graph.edges),
		diagnostics: graph.diagnostics,
	};
}

export function activate(context: ExtensionContext): void {
	const provider = new CloudForgeGraphProvider();
	const treeView = window.createTreeView('cloudforge.resources', { treeDataProvider: provider });
	let currentArchitectureName = l10n.t('Architecture');

	async function openNodeSource(workspaceId: string, architectureId: string, sourceRevision: string, nodeId: string): Promise<string | undefined> {
		try {
			const result = await commands.executeCommand<unknown>('_cloudforge.openSource', workspaceId, architectureId, sourceRevision, nodeId);
			if (isRecord(result) && result.ok === false) {
				const code = isRecord(result.error) && typeof result.error.code === 'string' ? result.error.code : 'SERVICE_ERROR';
				showServiceError({ code });
				return code;
			}
			return undefined;
		} catch {
			void window.showErrorMessage(l10n.t('The source location could not be opened.'));
			return 'SERVICE_ERROR';
		}
	}

	let activeValidation: { readonly workspaceId: string; readonly runId: string; cancelled: boolean } | undefined;
	let validationAttempt = 0;
	let lastValidationRunId: string | null = null;
	let cachedCatalogueSnapshots: readonly CanvasCatalogueSnapshot[] | undefined;
	const cachedLiveSchemas = new Map<string, FormSchema | null>();
	const cachedCloudRegions = new Map<'azure' | 'aws' | 'google', CanvasCloudRegionsPayload | null>();

	async function loadCloudRegions(provider: 'azure' | 'aws' | 'google'): Promise<CanvasCloudRegionsPayload | undefined> {
		const cached = cachedCloudRegions.get(provider);
		if (cached !== undefined) {
			return cached ?? undefined;
		}
		const result = await callService<unknown>('listCloudRegions', { provider });
		if (!result.ok) {
			return undefined;
		}
		const parsed = parseCloudRegionsPayload(result.value) ?? null;
		cachedCloudRegions.set(provider, parsed);
		return parsed ?? undefined;
	}

	async function inspectArchitectureDependencies(workspaceId: string, architectureId: string, sourceRevision: string) {
		const result = await callService<unknown>('inspectDependencies', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
		});
		if (!result.ok) {
			return undefined;
		}
		return parseDependencyReport(result.value);
	}

	async function readArchitectureModule(workspaceId: string, architectureId: string, sourceRevision: string, modulePath: readonly string[]) {
		const result = await callService<unknown>('readModule', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
			modulePath: [...modulePath],
		});
		if (!result.ok) {
			const msg = result.error.code === 'SCOPE_DENIED'
				? l10n.t('This module source escapes the granted workspace folder.')
				: result.error.code === 'STALE_SOURCE'
					? l10n.t('The Terraform source changed on disk. Refresh the graph before inspecting modules.')
					: result.error.code === 'WORKSPACE_UNAVAILABLE'
						? l10n.t('The child module folder is unavailable or contains no Terraform source.')
						: l10n.t('The requested module could not be inspected.');
			return { ok: false as const, message: msg };
		}
		const inspection = parseModuleInspection(result.value, currentArchitectureName);
		if (!inspection) {
			return { ok: false as const, message: l10n.t('The CloudForge service returned an invalid module summary.') };
		}
		return { ok: true as const, inspection };
	}

	async function cancelServiceValidation(): Promise<void> {
		const active = activeValidation;
		if (!active) {
			return;
		}
		active.cancelled = true;
		activeValidation = undefined;
		await callService<unknown>('cancelValidationRun', {
			workspaceId: active.workspaceId,
			runId: active.runId,
		});
	}

	async function loadCatalogueSnapshots(): Promise<readonly CanvasCatalogueSnapshot[]> {
		if (cachedCatalogueSnapshots !== undefined) {
			return cachedCatalogueSnapshots;
		}
		const result = await callService<unknown>('listCatalogueSnapshots', {});
		if (!result.ok) {
			return [];
		}
		cachedCatalogueSnapshots = parseCatalogueSnapshots(result.value);
		return cachedCatalogueSnapshots;
	}

	async function loadResourceSchema(kind: 'resource' | 'dataSource', typeName: string): Promise<FormSchema | null> {
		const cacheKey = `${kind}:${typeName}`;
		const cached = cachedLiveSchemas.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const snapshots = await loadCatalogueSnapshots();
		const snap = selectBestSnapshotForType(snapshots, typeName);
		if (!snap) {
			cachedLiveSchemas.set(cacheKey, null);
			return null;
		}
		const result = await callService<unknown>('getResourceFormSchema', {
			key: {
				address: snap.address,
				version: snap.version,
				formatVersion: snap.formatVersion,
				sha256: snap.sha256,
			},
			kind,
			typeName,
		});
		if (!result.ok) {
			cachedLiveSchemas.set(cacheKey, null);
			return null;
		}
		const bundled = lookupBundledSchema({ kind: kind === 'dataSource' ? 'data' : 'resource', resourceType: typeName });
		const adapted = mapRustFormSchemaToCanvasFormSchema(result.value, bundled) ?? null;
		cachedLiveSchemas.set(cacheKey, adapted);
		return adapted;
	}

	const canvas = new CloudForgeCanvasPanel(context, {
		onSelectNode() {
			// Selection is preserved inside the canvas state; native tree selection stays non-destructive.
		},
		onOpenSource: openNodeSource,
		async onRefresh(workspaceId, architectureId) {
			await cancelServiceValidation();
			const refreshed = await showGraph(provider, treeView, workspaceId, architectureId);
			if (refreshed) {
				canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
			}
		},
		async onRequestValidation(graph, scope, nodeId, onUpdate) {
			await cancelServiceValidation();
			const started = await callService<unknown>('startValidationRun', {
				workspaceId: graph.workspaceId,
				architectureId: graph.architectureId,
				expectedSourceRevision: graph.sourceRevision,
			});
			if (!started.ok) {
				if (started.error.code === 'STALE_SOURCE' || started.error.code === 'SCOPE_DENIED' || started.error.code === 'WORKSPACE_UNAVAILABLE') {
					return { handled: true, errorCode: started.error.code };
				}
				return { handled: false, errorCode: started.error.code };
			}
			const startInfo = parseValidationStart(started.value);
			if (!startInfo) {
				return { handled: false };
			}

			const attempt = ++validationAttempt;
			const previousRunId = lastValidationRunId;
			lastValidationRunId = startInfo.runId;
			const startedAtMs = Date.now();
			const handle = { workspaceId: graph.workspaceId, runId: startInfo.runId, cancelled: false };
			activeValidation = handle;

			const accumulatedEvents: ServicePollEvent[] = [];
			let cursor = 0;

			for (let pollIdx = 0; pollIdx < 240; pollIdx++) {
				if (handle.cancelled || activeValidation !== handle) {
					break;
				}
				const polled = await callService<unknown>('pollValidationRun', {
					workspaceId: graph.workspaceId,
					runId: startInfo.runId,
					cursor,
					maxEvents: 256,
					includeSnapshot: true,
				});
				if (!polled.ok) {
					if (activeValidation === handle) {
						activeValidation = undefined;
					}
					if (polled.error.code === 'SCOPE_DENIED') {
						return { handled: true, errorCode: 'SCOPE_DENIED' };
					}
					return { handled: pollIdx > 0, errorCode: polled.error.code };
				}
				const parsed = parseValidationPoll(polled.value);
				if (!parsed) {
					break;
				}
				cursor = parsed.nextCursor;
				for (const ev of parsed.events) {
					accumulatedEvents.push(ev);
				}
				const runView = mapServiceValidationPollToRun(parsed, {
					graph,
					scope,
					targetNodeId: scope === 'resource' ? (nodeId ?? null) : null,
					attempt,
					previousRunId,
					startedAtMs,
					accumulatedEvents,
				});
				onUpdate(runView);

				if (parsed.state !== 'running' && !parsed.hasMore) {
					break;
				}
				if (!parsed.hasMore) {
					await new Promise<void>(resolve => setTimeout(resolve, 40));
				}
			}
			if (activeValidation === handle) {
				activeValidation = undefined;
			}
			return { handled: true };
		},
		onCancelValidation: cancelServiceValidation,
		async onPreviewDraftSave(workspaceId, architectureId, expectedSourceRevision, fileName, contents) {
			const result = await callService<unknown>('previewDraftSave', {
				workspaceId,
				architectureId,
				expectedSourceRevision,
				fileName,
				contents,
			});
			if (!result.ok) {
				return { ok: false, error: draftSaveErrorMessage(result.error.code) };
			}
			const preview = parseDraftSavePreview(result.value);
			if (!preview) {
				return { ok: false, error: draftSaveErrorMessage('SERVICE_ERROR') };
			}
			return { ok: true, preview };
		},
		async onApplyDraftSave(workspaceId, architectureId, expectedSourceRevision, fileName, contents, previewToken) {
			const result = await callService<unknown>('applyDraftSave', {
				workspaceId,
				architectureId,
				expectedSourceRevision,
				fileName,
				contents,
				previewToken,
			});
			if (!result.ok) {
				return { ok: false, error: draftSaveErrorMessage(result.error.code) };
			}
			const applied = parseDraftSaveApply(result.value);
			if (!applied) {
				return { ok: false, error: draftSaveErrorMessage('SERVICE_ERROR') };
			}
			// Re-read the architecture so both the native CloudForge Graph tree and Canvas reflect
			// the newly saved file and updated sourceRevision.
			const refreshed = await showGraph(provider, treeView, workspaceId, architectureId);
			if (refreshed) {
				canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
				canvas.setNotice({
					kind: 'info',
					message: l10n.t('Saved {0} ({1} bytes) and refreshed architecture to revision {2}.', applied.fileName, applied.bytesWritten, applied.newSourceRevision.slice(0, 8)),
				});
			}
			return { ok: true, applied };
		},
		onLoadCatalogueSnapshots: loadCatalogueSnapshots,
		onLoadResourceSchema: loadResourceSchema,
		onLoadCloudRegions: loadCloudRegions,
		onInspectDependencies: inspectArchitectureDependencies,
		onReadModule: readArchitectureModule,
		async onExportArtifact(format, suggestedFileName, content, encoding) {
			const folder = workspace.workspaceFolders?.[0]?.uri;
			const defaultUri = folder ? Uri.joinPath(folder, suggestedFileName) : Uri.file(suggestedFileName);
			const filters: Record<string, string[]> = format === 'svg'
				? { 'SVG Diagram': ['svg'] }
				: format === 'png'
					? { 'PNG Image': ['png'] }
					: { 'Markdown Report': ['md'] };
			const target = await window.showSaveDialog({
				defaultUri,
				filters,
				saveLabel: l10n.t('Export'),
				title: l10n.t('Export CloudForge Architecture'),
			});
			if (!target) {
				return { ok: false, message: l10n.t('Export cancelled.') };
			}
			try {
				const bytes = encoding === 'base64'
					? Buffer.from(content, 'base64')
					: Buffer.from(content, 'utf8');
				await workspace.fs.writeFile(target, bytes);
				const openAction = l10n.t('Open File');
				void window.showInformationMessage(l10n.t('Exported {0}.', suggestedFileName), openAction).then(choice => {
					if (choice === openAction) {
						void commands.executeCommand('vscode.open', target);
					}
				});
				return { ok: true, message: l10n.t('Saved {0}.', target.path.split('/').pop() ?? suggestedFileName) };
			} catch {
				return { ok: false, message: l10n.t('Could not write the exported file.') };
			}
		},
	});

	context.subscriptions.push(provider, treeView, canvas);
	context.subscriptions.push(treeView.onDidChangeSelection(event => {
		const resource = event.selection.find(item => item.type === 'resource');
		const graph = provider.getGraph();
		if (!resource || !graph) {
			return;
		}
		canvas.selectNode(resource.node.id);
		void openNodeSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, resource.node.id);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.showProofStatus', () => {
		return window.showInformationMessage(l10n.t('The CloudForge built-in extension is active.'));
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.openCanvas', () => {
		const graph = provider.getGraph();
		canvas.show(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined, false);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.validateArchitecture', () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before running validation.'));
			return;
		}
		canvas.triggerValidation(toCanvasSnapshot(graph, currentArchitectureName), 'architecture');
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.cancelValidation', () => {
		canvas.cancelValidation();
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.exportCanvas', () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before exporting a diagram or report.'));
			return;
		}
		canvas.openExport(toCanvasSnapshot(graph, currentArchitectureName));
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.importProviderSchema', async () => {
		const inspected = await callService<unknown>('inspectCatalogueSchemaFile', {});
		if (!inspected.ok) {
			if (inspected.error.code !== 'CANCELLED') {
				showServiceError(inspected.error);
			}
			return;
		}
		if (!isRecord(inspected.value) || typeof inspected.value.previewId !== 'string' || !Array.isArray(inspected.value.providers) || inspected.value.providers.length === 0) {
			void window.showErrorMessage(l10n.t('The selected schema file did not contain any supported providers.'));
			return;
		}
		const previewId = inspected.value.previewId;
		const providers: { address: string; resources: number; dataSources: number; lockVersion?: string }[] = [];
		for (const item of inspected.value.providers) {
			if (isRecord(item) && typeof item.address === 'string' && typeof item.resources === 'number' && typeof item.dataSources === 'number') {
				providers.push({
					address: item.address,
					resources: item.resources,
					dataSources: item.dataSources,
					lockVersion: typeof item.lockVersion === 'string' ? item.lockVersion : undefined,
				});
			}
		}
		if (providers.length === 0) {
			void window.showErrorMessage(l10n.t('The selected schema file did not contain any supported providers.'));
			return;
		}
		let chosen = providers[0];
		if (providers.length > 1) {
			const picked = await window.showQuickPick(
				providers.map(entry => ({
					label: entry.address,
					description: entry.lockVersion ? l10n.t('lock {0}', entry.lockVersion) : undefined,
					detail: l10n.t('{0} resources · {1} data sources', entry.resources, entry.dataSources),
					entry,
				})),
				{ title: l10n.t('Choose Provider to Import into CloudForge Catalogue') }
			);
			if (!picked) {
				return;
			}
			chosen = picked.entry;
		}
		const version = await window.showInputBox({
			title: l10n.t('Provider Release Version for {0}', chosen.address),
			value: chosen.lockVersion ?? '',
			placeHolder: '5.14.0',
			validateInput: text => /^[A-Za-z0-9._+-]+$/.test(text.trim()) ? undefined : l10n.t('Enter a provider release version such as 5.14.0.'),
		});
		if (!version) {
			return;
		}
		const enginePick = await window.showQuickPick(
			[
				{ label: 'OpenTofu', engineName: 'openTofu' as const, defaultVersion: '1.11.0' },
				{ label: 'Terraform', engineName: 'terraform' as const, defaultVersion: '1.15.8' },
			],
			{ title: l10n.t('Engine That Generated This Schema File') }
		);
		if (!enginePick) {
			return;
		}
		const engineVersion = await window.showInputBox({
			title: l10n.t('{0} Version', enginePick.label),
			value: enginePick.defaultVersion,
			validateInput: text => /^[A-Za-z0-9._+-]+$/.test(text.trim()) ? undefined : l10n.t('Enter an engine version such as {0}.', enginePick.defaultVersion),
		});
		if (!engineVersion) {
			return;
		}
		const imported = await callService<unknown>('importCatalogueSnapshot', {
			previewId,
			address: chosen.address,
			version: version.trim(),
			engineName: enginePick.engineName,
			engineVersion: engineVersion.trim(),
		});
		if (!imported.ok) {
			showServiceError(imported.error);
			return;
		}
		cachedCatalogueSnapshots = undefined;
		cachedLiveSchemas.clear();
		const graph = provider.getGraph();
		if (graph) {
			canvas.updateIfOpen(toCanvasSnapshot(graph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Imported {0} {1} ({2} resources) into the CloudForge provider catalogue.', chosen.address, version.trim(), chosen.resources)
		);
	}));
	let opening: Promise<void> | undefined;
	context.subscriptions.push(commands.registerCommand('cloudforge.openWorkspace', () => {
		return opening ??= openWorkspace(provider, treeView, (loaded, architectureName) => {
			currentArchitectureName = architectureName;
			canvas.show(toCanvasSnapshot(loaded, architectureName), true);
		}).finally(() => { opening = undefined; });
	}));

	// Stage 2: projects with repositories. Architectures chosen in the Projects view, including
	// those that live in imported repositories, show in both the native graph tree and the canvas.
	activateProjects(context, {
		async show(workspaceId, architectureId, architectureName) {
			provider.setGraph(undefined);
			const selected = await callService<unknown>('selectArchitecture', { workspaceId, architectureId });
			if (!selected.ok) {
				showServiceError(selected.error);
				return;
			}
			const loaded = await showGraph(provider, treeView, workspaceId, architectureId);
			if (loaded) {
				currentArchitectureName = architectureName || l10n.t('Architecture');
				canvas.show(toCanvasSnapshot(loaded, currentArchitectureName), true);
			}
			await commands.executeCommand('cloudforge.resources.focus');
		}
	});
}
