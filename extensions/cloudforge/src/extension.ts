/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	commands,
	ConfigurationTarget,
	Diagnostic,
	DiagnosticSeverity,
	EventEmitter,
	l10n,
	languages,
	Position,
	ProgressLocation,
	Range,
	StatusBarAlignment,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
	ViewColumn,
	window,
	workspace,
	type Event,
	type ExtensionContext,
	type TreeDataProvider,
	type TreeView
} from 'vscode';
import { activateProjects } from './project/index';
import { registerTerraformEditorProviders } from './editor/providers';
import {
	extractTerraformReferenceAtPosition,
	findTerraformBlockAtLine,
	matchBlockToGraphNode,
	matchReferenceToGraphNode,
	parseTerraformDocumentBlocks
} from './editor/terraformLanguage';
import {
	formatReadinessReportText,
	formatResourceExplanationMarkdown,
	formatSchemaDiffReportText,
	groupUpgradeableSnapshots,
	sanitizeExportStem
} from './project/architectureTools';
import { findWorkspacePreset, isWorkspacePresetId, WORKSPACE_PRESETS, type WorkspacePresetId } from './project/workspacePresets';
import { explainResource } from './canvas/advisorRecipes';
import { CloudForgeCanvasPanel } from './canvas/canvasPanel';
import { createDraftDocument } from './canvas/draftDocument';
import { renderArchitectureMarkdownReport } from './canvas/exportDiagram';
import { generateTargetIac, type GeneratorTarget } from './canvas/generators';
import { buildCanvasProjection, orientServiceEdgesForCanvas } from './canvas/layout';
import { estimateArchitectureCost, evaluateArchitecturePolicies } from './canvas/planReview';
import { isValidTfFileName, type CanvasCatalogueSnapshot, type CanvasCatalogueTypes, type CanvasCloudRegionsPayload, type CanvasEnginePlanActionKind, type CanvasEnginePlanReport, type CanvasEngineValidateDiagnostic, type CanvasGraphSnapshot } from './canvas/protocol';
import { lookupBundledSchema, type FormSchema } from './canvas/schemaForm';
import { findTemplateById } from './canvas/templateLibrary';
import { activateSidePanel } from './sidePanel/sidePanel';
import {
	draftSaveErrorMessage,
	formatEnginePlanReportText,
	mapRustFormSchemaToCanvasFormSchema,
	mapServiceValidationPollToRun,
	parseCatalogueSnapshots,
	parseCloudRegionsPayload,
	parseDependencyReport,
	parseDetectedEngines,
	parseDraftSaveApply,
	parseDraftSavePreview,
	parseEngineInitOfflineReport,
	parseEnginePlanReport,
	parseSaveAllApply,
	parseSaveAllPreview,
	parseEngineValidateReport,
	parseExportAuditReport,
	parseMirrorPackages,
	parseModuleInspection,
	parseOfflineMirrorReadiness,
	parseSchemaDiffReport,
	parseValidationPoll,
	parseValidationStart,
	newestPaletteSnapshots,
	parseCatalogueTypes,
	parseFormCoverage,
	parseSchemaPreview,
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
	readonly sourceFile?: string;
	readonly sourceLine?: number;
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
			const typeLabel = element.node.resourceType ?? element.node.kind;
			const sourceLabel = element.node.sourceFile
				? `${element.node.sourceFile}${element.node.sourceLine ? `:${element.node.sourceLine}` : ''}`
				: undefined;
			item.description = sourceLabel ? `${typeLabel} · ${sourceLabel}` : typeLabel;
			item.tooltip = sourceLabel
				? `${element.node.kind}: ${element.node.name}\n${sourceLabel}`
				: `${element.node.kind}: ${element.node.name}`;
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
		const sourceRecord = isRecord(node.source) ? node.source : undefined;
		const sourceFile = sourceRecord && isValidTfFileName(sourceRecord.file) ? sourceRecord.file : undefined;
		const sourceLine = sourceRecord && typeof sourceRecord.line === 'number' && Number.isSafeInteger(sourceRecord.line) && sourceRecord.line >= 1
			? sourceRecord.line
			: undefined;
		nodes.push({
			id: node.id,
			kind: node.kind,
			resourceType: node.resourceType,
			name: node.name,
			label: node.label,
			hasSource: Boolean(sourceRecord),
			...(sourceFile ? { sourceFile } : {}),
			...(sourceLine ? { sourceLine } : {}),
		});
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
	treeView.message = graphMessage(graph);
	return graph;
}

function graphMessage(graph: ArchitectureGraph | undefined): string | undefined {
	if (graph?.status === 'partial') {
		return l10n.t('This graph is partial. See Diagnostics for details.');
	}
	return graph && graph.nodes.length === 0 ? l10n.t('No resources were found in this architecture.') : undefined;
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
	// The same graph also shows in the CloudForge side panel; Explorer keeps its copy.
	const panelTreeView = window.createTreeView('cloudforge.panel.resources', { treeDataProvider: provider });
	context.subscriptions.push(panelTreeView, provider.onDidChangeTreeData(() => { panelTreeView.message = graphMessage(provider.getGraph()); }));
	const problems = languages.createDiagnosticCollection('cloudforge');
	const planOutput = window.createOutputChannel(l10n.t('CloudForge Plan'));
	const readinessOutput = window.createOutputChannel(l10n.t('CloudForge Readiness'));
	const schemaDiffOutput = window.createOutputChannel(l10n.t('CloudForge Schema Diff'));
	const statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 100);
	statusBar.command = 'cloudforge.openCanvas';
	statusBar.name = l10n.t('CloudForge Architecture');
	let currentArchitectureName = l10n.t('Architecture');
	const projectControllerRef: { current?: ReturnType<typeof activateProjects> } = {};
	const terraformProvidersRef: { current?: ReturnType<typeof registerTerraformEditorProviders> } = {};

	function toVsSeverity(raw: string): DiagnosticSeverity {
		const lower = raw.toLowerCase();
		if (lower === 'error') {
			return DiagnosticSeverity.Error;
		}
		if (lower === 'warning' || lower === 'warn') {
			return DiagnosticSeverity.Warning;
		}
		return DiagnosticSeverity.Information;
	}

	function syncProblems(
		graph: ArchitectureGraph | undefined,
		cliReport?: { readonly engine: 'openTofu' | 'terraform'; readonly diagnostics: readonly CanvasEngineValidateDiagnostic[] }
	): void {
		problems.clear();
		if (!graph) {
			return;
		}
		const folder = workspace.workspaceFolders?.[0]?.uri;
		const fallbackUri = folder
			? Uri.joinPath(folder, 'main.tf')
			: Uri.parse(`cloudforge:/${encodeURIComponent(currentArchitectureName)}/main.tf`);
		const byUri = new Map<string, { uri: Uri; list: Diagnostic[] }>();
		const pushDiag = (uri: Uri, diag: Diagnostic) => {
			const key = uri.toString();
			let bucket = byUri.get(key);
			if (!bucket) {
				bucket = { uri, list: [] };
				byUri.set(key, bucket);
			}
			bucket.list.push(diag);
		};
		const zeroRange = new Range(new Position(0, 0), new Position(0, 0));
		for (const d of graph.diagnostics) {
			const diag = new Diagnostic(zeroRange, d.message, toVsSeverity(d.severity));
			diag.source = 'CloudForge';
			diag.code = d.code;
			pushDiag(fallbackUri, diag);
		}
		if (cliReport) {
			for (const d of cliReport.diagnostics) {
				const lineIdx = typeof d.line === 'number' && d.line > 0 ? d.line - 1 : 0;
				const range = new Range(new Position(lineIdx, 0), new Position(lineIdx, 0));
				const safeRel = d.filename && !d.filename.startsWith('/') && !d.filename.includes('..') && !/^[A-Za-z]:/.test(d.filename)
					? d.filename.replace(/\\/g, '/')
					: undefined;
				const uri = folder && safeRel ? Uri.joinPath(folder, ...safeRel.split('/').filter(Boolean)) : fallbackUri;
				const msg = d.detail ? `${d.summary}: ${d.detail}` : d.summary;
				const diag = new Diagnostic(range, msg, toVsSeverity(d.severity));
				diag.source = cliReport.engine === 'openTofu' ? 'CloudForge (OpenTofu)' : 'CloudForge (Terraform)';
				if (d.address) {
					diag.code = d.address;
				}
				pushDiag(uri, diag);
			}
		}
		for (const { uri, list } of byUri.values()) {
			problems.set(uri, list);
		}
	}

	function updateStatusBar(graph: ArchitectureGraph | undefined): void {
		terraformProvidersRef.current?.refresh();
		if (!graph) {
			statusBar.hide();
			return;
		}
		statusBar.text = `$(type-hierarchy) CloudForge: ${currentArchitectureName} · rev ${graph.sourceRevision.slice(0, 8)}`;
		statusBar.tooltip = l10n.t(
			'{0} ({1} resources, {2} diagnostics) — Click to open Architecture Canvas',
			currentArchitectureName,
			graph.nodes.length,
			graph.diagnostics.length
		);
		statusBar.show();
	}

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

	async function openSourceLocation(workspaceId: string, architectureId: string, sourceRevision: string, fileName: string, line?: number, column?: number): Promise<string | undefined> {
		try {
			const result = await commands.executeCommand<unknown>('_cloudforge.openSourceLocation', workspaceId, architectureId, sourceRevision, fileName, line, column);
			if (isRecord(result) && result.ok === false) {
				const code = isRecord(result.error) && typeof result.error.code === 'string' ? result.error.code : 'SERVICE_ERROR';
				if (code !== 'STALE_SOURCE') {
					showServiceError({ code });
				}
				return code;
			}
			return undefined;
		} catch {
			void window.showErrorMessage(l10n.t('The source location could not be opened.'));
			return 'SERVICE_ERROR';
		}
	}

	let activeValidation: { readonly workspaceId: string; readonly runId: string; cancelled: boolean } | undefined;
	/** Token of the last focused save preview, so its apply sends only the token. */
	let focusedSaveToken: string | undefined;
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

	async function auditArchitectureExportReadiness(workspaceId: string, architectureId: string, sourceRevision: string) {
		const result = await callService<unknown>('auditExportReadiness', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
		});
		if (!result.ok) {
			return undefined;
		}
		return parseExportAuditReport(result.value);
	}

	async function diffArchitectureCatalogueSnapshots(
		fromKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string },
		toKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string },
		workspaceId: string,
		architectureId: string,
		sourceRevision: string
	) {
		const result = await callService<unknown>('diffCatalogueSnapshots', {
			fromKey,
			toKey,
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
		});
		if (!result.ok) {
			return { ok: false as const, message: l10n.t('Could not diff the selected provider schema snapshots.') };
		}
		const report = parseSchemaDiffReport(result.value);
		if (!report) {
			return { ok: false as const, message: l10n.t('The CloudForge service returned an invalid schema diff.') };
		}
		return { ok: true as const, report };
	}

	async function detectLocalEngines() {
		const result = await callService<unknown>('detectEngines', {});
		if (!result.ok) {
			return [];
		}
		return parseDetectedEngines(result.value);
	}

	async function runArchitectureEngineValidate(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	) {
		const result = await callService<unknown>('runEngineValidate', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
			...(engine ? { engine } : {}),
		});
		if (!result.ok) {
			const message = result.error.code === 'STALE_SOURCE'
				? l10n.t('The Terraform source changed on disk. Refresh the graph before running CLI validation.')
				: result.error.code === 'WORKSPACE_UNAVAILABLE'
					? l10n.t('No compatible local OpenTofu or Terraform CLI engine was found or validation returned unusable output.')
					: result.error.code === 'LIMIT_EXCEEDED'
						? l10n.t('CLI validation exceeded its time or output limit.')
						: l10n.t('Local CLI validation could not complete.');
			return { ok: false as const, message };
		}
		const report = parseEngineValidateReport(result.value);
		if (!report) {
			return { ok: false as const, message: l10n.t('The CloudForge service returned an invalid CLI validation report.') };
		}
		syncProblems(provider.getGraph(), report);
		return { ok: true as const, report };
	}

	async function runArchitectureEnginePlan(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	) {
		const result = await callService<unknown>('runEnginePlan', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
			...(engine ? { engine } : {}),
		});
		if (!result.ok) {
			const message = result.error.code === 'STALE_SOURCE'
				? l10n.t('The Terraform source changed on disk. Refresh the graph before running a local plan.')
				: result.error.code === 'WORKSPACE_UNAVAILABLE'
					? l10n.t('No compatible local OpenTofu or Terraform CLI engine was found or plan capture returned unusable output.')
					: result.error.code === 'LIMIT_EXCEEDED'
						? l10n.t('Local plan capture exceeded its time or output limit.')
						: l10n.t('Local CLI plan capture could not complete.');
			return { ok: false as const, message };
		}
		const report = parseEnginePlanReport(result.value);
		if (!report) {
			return { ok: false as const, message: l10n.t('The CloudForge service returned an invalid local plan report.') };
		}
		syncProblems(provider.getGraph(), report);
		return { ok: true as const, report };
	}

	async function checkArchitectureOfflineMirrorReadiness(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string
	) {
		const result = await callService<unknown>('checkOfflineMirrorReadiness', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
		});
		if (!result.ok) {
			return undefined;
		}
		return parseOfflineMirrorReadiness(result.value);
	}

	async function runArchitectureEngineInitOffline(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	) {
		const result = await callService<unknown>('runEngineInitOffline', {
			workspaceId,
			architectureId,
			expectedSourceRevision: sourceRevision,
			...(engine ? { engine } : {}),
		});
		if (!result.ok) {
			const message = result.error.code === 'STALE_SOURCE'
				? l10n.t('The Terraform source changed on disk. Refresh the graph before running offline init.')
				: result.error.code === 'SCOPE_DENIED'
					? l10n.t('Offline init is only allowed on writable project architectures, not read-only imported repositories.')
					: result.error.code === 'SCHEMA_UNAVAILABLE'
						? l10n.t('One or more locked providers are missing or unverified in the local offline mirror.')
						: result.error.code === 'WORKSPACE_UNAVAILABLE'
							? l10n.t('No compatible local OpenTofu or Terraform CLI engine was found.')
							: result.error.code === 'LIMIT_EXCEEDED'
								? l10n.t('Offline init exceeded its time or output limit.')
								: l10n.t('Offline mirror initialization could not complete.');
			return { ok: false as const, message };
		}
		const report = parseEngineInitOfflineReport(result.value);
		if (!report) {
			return { ok: false as const, message: l10n.t('The CloudForge service returned an invalid offline init report.') };
		}
		return { ok: true as const, report };
	}

	function planActionIcon(kind: CanvasEnginePlanActionKind): string {
		switch (kind) {
			case 'create': return '$(diff-added)';
			case 'update': return '$(diff-modified)';
			case 'replace': return '$(diff-renamed)';
			case 'delete': return '$(diff-removed)';
			case 'read': return '$(eye)';
			case 'no-op': return '$(dash)';
		}
	}

	async function runAndPresentLocalPlan(graph: ArchitectureGraph): Promise<void> {
		const outcome = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('CloudForge: Running credential-free local plan for {0}…', currentArchitectureName),
				cancellable: false,
			},
			() => runArchitectureEnginePlan(graph.workspaceId, graph.architectureId, graph.sourceRevision)
		);
		if (!outcome.ok) {
			void window.showErrorMessage(outcome.message);
			return;
		}
		const report: CanvasEnginePlanReport = outcome.report;
		planOutput.clear();
		planOutput.append(formatEnginePlanReportText(report, currentArchitectureName));

		const engineLabel = report.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
		if (report.status === 'failed') {
			const openOutput = l10n.t('Open Plan Output');
			const showProblems = l10n.t('Show Problems');
			const firstDiag = report.diagnostics[0]?.summary;
			const msg = firstDiag
				? l10n.t('{0} {1} plan failed: {2}', engineLabel, report.engineVersion, firstDiag)
				: l10n.t('{0} {1} plan failed. Ensure providers are initialized locally and check Problems.', engineLabel, report.engineVersion);
			const choice = await window.showWarningMessage(msg, openOutput, showProblems);
			if (choice === openOutput) {
				planOutput.show(true);
			} else if (choice === showProblems) {
				await commands.executeCommand('workbench.actions.view.problems');
			}
			return;
		}

		type PlanPick =
			| { readonly label: string; readonly description?: string; readonly detail?: string; readonly pickKind: 'resource'; readonly address: string; readonly typeName: string; readonly name: string }
			| { readonly label: string; readonly description?: string; readonly pickKind: 'output' }
			| { readonly label: string; readonly description?: string; readonly pickKind: 'openOutput' };
		const picks: PlanPick[] = [];
		for (const rc of report.resourceChanges) {
			const attrs = rc.changedAttributePaths.length > 0 ? rc.changedAttributePaths.join(', ') : undefined;
			const sens = rc.hasSensitiveAttributes ? l10n.t('sensitive values redacted') : undefined;
			picks.push({
				label: `${planActionIcon(rc.actionKind)} ${rc.address}`,
				description: `${rc.actionKind}${sens ? ` · $(lock) ${sens}` : ''}`,
				detail: attrs ? l10n.t('Changed attributes: {0}', attrs) : undefined,
				pickKind: 'resource',
				address: rc.address,
				typeName: rc.typeName,
				name: rc.name,
			});
		}
		for (const out of report.outputChanges) {
			picks.push({
				label: `$(symbol-variable) output.${out.name}`,
				description: `${out.actions.join('/')}${out.sensitive ? ` · $(lock) ${l10n.t('sensitive')}` : ''}`,
				pickKind: 'output',
			});
		}
		picks.push({
			label: `$(output) ${l10n.t('Open Full Plan Output ({0} {1})', engineLabel, report.engineVersion)}`,
			description: l10n.t('{0} ms · rev {1}', report.durationMs, report.sourceRevision.slice(0, 8)),
			pickKind: 'openOutput',
		});

		const s = report.summary;
		const summaryTitle = l10n.t(
			'Local Plan: +{0} create · ~{1} update · +/-{2} replace · -{3} delete ({4} {5})',
			s.create,
			s.update,
			s.replace,
			s.delete,
			engineLabel,
			report.engineVersion
		);
		const picked = await window.showQuickPick(picks, {
			title: summaryTitle,
			placeHolder: report.truncated
				? l10n.t('Select a resource change to reveal it in Canvas & source (plan truncated at service bounds)')
				: l10n.t('Select a resource change to reveal it in Canvas & source'),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!picked) {
			return;
		}
		if (picked.pickKind === 'openOutput' || picked.pickKind === 'output') {
			planOutput.show(true);
			return;
		}
		const currentGraph = provider.getGraph();
		const targetNode = currentGraph?.nodes.find(node =>
			node.name === picked.address ||
			(node.resourceType === picked.typeName && (node.label === picked.name || node.name.endsWith(`.${picked.name}`)))
		);
		if (currentGraph && targetNode) {
			canvas.selectNode(targetNode.id);
			if (targetNode.hasSource) {
				await openNodeSource(currentGraph.workspaceId, currentGraph.architectureId, currentGraph.sourceRevision, targetNode.id);
			}
		} else {
			planOutput.show(true);
		}
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

	let cachedCatalogueTypes: readonly CanvasCatalogueTypes[] | undefined;
	async function loadCatalogueTypes(): Promise<readonly CanvasCatalogueTypes[]> {
		if (cachedCatalogueTypes !== undefined) {
			return cachedCatalogueTypes;
		}
		const out: CanvasCatalogueTypes[] = [];
		for (const { provider, snapshot } of newestPaletteSnapshots(await loadCatalogueSnapshots())) {
			const result = await callService<unknown>('listCatalogueTypes', {
				key: { address: snapshot.address, version: snapshot.version, formatVersion: snapshot.formatVersion, sha256: snapshot.sha256 },
			});
			const types = result.ok ? parseCatalogueTypes(result.value, provider, snapshot.version) : undefined;
			if (types) {
				out.push(types);
			}
		}
		cachedCatalogueTypes = out;
		return out;
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
		let adapted = mapRustFormSchemaToCanvasFormSchema(result.value, bundled) ?? null;
		if (adapted) {
			const coverage = await callService<unknown>('getCatalogueCoverage', {
				key: { address: snap.address, version: snap.version, formatVersion: snap.formatVersion, sha256: snap.sha256 },
				kind,
				typeName,
			});
			const parsed = coverage.ok ? parseFormCoverage(coverage.value) : undefined;
			if (parsed) {
				adapted = { ...adapted, coverage: parsed };
			}
		}
		cachedLiveSchemas.set(cacheKey, adapted);
		return adapted;
	}

	let focusModeActive = false;
	let savedZenCenterLayout: { readonly hadWorkspace: boolean; readonly value: unknown } | undefined;
	let savedZenShowTabs: { readonly hadWorkspace: boolean; readonly value: unknown } | undefined;

	async function setCanvasFocusMode(desired?: boolean): Promise<boolean> {
		const next = desired === undefined ? !focusModeActive : desired;
		if (next === focusModeActive) {
			return focusModeActive;
		}
		const zenConfig = workspace.getConfiguration('zenMode');
		const hasWorkspace = (workspace.workspaceFolders?.length ?? 0) > 0;
		const target = hasWorkspace ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;
		if (next) {
			const centerInspect = zenConfig.inspect<boolean>('centerLayout');
			const tabsInspect = zenConfig.inspect<string>('showTabs');
			savedZenCenterLayout = { hadWorkspace: hasWorkspace, value: hasWorkspace ? centerInspect?.workspaceValue : centerInspect?.globalValue };
			savedZenShowTabs = { hadWorkspace: hasWorkspace, value: hasWorkspace ? tabsInspect?.workspaceValue : tabsInspect?.globalValue };
			try {
				await zenConfig.update('centerLayout', false, target);
				await zenConfig.update('showTabs', 'none', target);
			} catch {
				// Proceed with Zen Mode even if settings are read-only.
			}
			const graph = provider.getGraph();
			canvas.show(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined, false);
			await commands.executeCommand('workbench.action.toggleZenMode');
			focusModeActive = true;
			canvas.setFocusMode(true);
		} else {
			focusModeActive = false;
			try {
				await commands.executeCommand('workbench.action.toggleZenMode');
			} finally {
				const restoreTarget = savedZenCenterLayout?.hadWorkspace ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;
				if (savedZenCenterLayout !== undefined) {
					await zenConfig.update('centerLayout', savedZenCenterLayout.value, restoreTarget).then(undefined, () => undefined);
					savedZenCenterLayout = undefined;
				}
				if (savedZenShowTabs !== undefined) {
					await zenConfig.update('showTabs', savedZenShowTabs.value, restoreTarget).then(undefined, () => undefined);
					savedZenShowTabs = undefined;
				}
			}
			canvas.setFocusMode(false);
		}
		return focusModeActive;
	}

	const canvas = new CloudForgeCanvasPanel(context, {
		onSelectNode() {
			// Selection is preserved inside the canvas state; native tree selection stays non-destructive.
		},
		onOpenSource: openNodeSource,
		onOpenSourceLocation: openSourceLocation,
		async onRefresh(workspaceId, architectureId) {
			await cancelServiceValidation();
			const refreshed = await showGraph(provider, treeView, workspaceId, architectureId);
			if (refreshed) {
				updateStatusBar(refreshed);
				syncProblems(refreshed);
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
		async onPreviewDraftSave(workspaceId, architectureId, expectedSourceRevision, fileName, contents, removeAddresses, renames, baseContents) {
			// Focused save first: the service folds the canvas draft into the file on disk and keeps
			// comments and fields the canvas does not show. If the file on disk does not parse, fall
			// back to the whole-file preview so the user can still save.
			const params = { workspaceId, architectureId, expectedSourceRevision, fileName, contents };
			let result = await callService<unknown>('previewFocusedSave', {
				...params,
				...(removeAddresses?.length ? { removeAddresses: [...removeAddresses] } : {}),
				...(renames?.length ? { renames: renames.map(({ from, to }) => ({ from, to })) } : {}),
				...(baseContents !== undefined ? { baseContents } : {}),
			});
			if (!result.ok && (result.error.code === 'UNSUPPORTED_FORMAT' || result.error.code === 'INVALID_PARAMS')) {
				result = await callService<unknown>('previewDraftSave', params);
			}
			if (!result.ok) {
				return { ok: false, error: draftSaveErrorMessage(result.error.code) };
			}
			const preview = parseDraftSavePreview(result.value);
			if (!preview) {
				return { ok: false, error: draftSaveErrorMessage('SERVICE_ERROR') };
			}
			focusedSaveToken = preview.merge ? preview.previewToken : undefined;
			return { ok: true, preview };
		},
		async onApplyDraftSave(workspaceId, architectureId, expectedSourceRevision, fileName, contents, previewToken) {
			// A focused preview holds the merged text in the service; only the token goes back.
			const focused = focusedSaveToken !== undefined && focusedSaveToken === previewToken;
			focusedSaveToken = undefined;
			const result = focused
				? await callService<unknown>('applyFocusedSave', { workspaceId, architectureId, expectedSourceRevision, fileName, previewToken })
				: await callService<unknown>('applyDraftSave', { workspaceId, architectureId, expectedSourceRevision, fileName, contents, previewToken });
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
				updateStatusBar(refreshed);
				syncProblems(refreshed);
				canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
				canvas.setNotice({
					kind: 'info',
					message: l10n.t('Saved {0} ({1} bytes) and refreshed architecture to revision {2}.', applied.fileName, applied.bytesWritten, applied.newSourceRevision.slice(0, 8)),
				});
			}
			return { ok: true, applied };
		},
		async onPreviewSaveAll(workspaceId, architectureId, expectedSourceRevision, files) {
			const result = await callService<unknown>('previewFocusedSaveBatch', {
				workspaceId, architectureId, expectedSourceRevision,
				files: files.map(file => ({
					fileName: file.fileName,
					contents: file.contents,
					...(file.removeAddresses?.length ? { removeAddresses: [...file.removeAddresses] } : {}),
					...(file.renames?.length ? { renames: file.renames.map(({ from, to }) => ({ from, to })) } : {}),
					...(file.baseContents !== undefined ? { baseContents: file.baseContents } : {}),
				})),
			});
			if (!result.ok) {
				return { ok: false, error: draftSaveErrorMessage(result.error.code) };
			}
			const preview = parseSaveAllPreview(result.value);
			return preview ? { ok: true, preview } : { ok: false, error: draftSaveErrorMessage('SERVICE_ERROR') };
		},
		async onApplySaveAll(workspaceId, architectureId, expectedSourceRevision, previewToken) {
			// The merged text of every file stays in the service; only the token goes back.
			const result = await callService<unknown>('applyFocusedSaveBatch', { workspaceId, architectureId, expectedSourceRevision, previewToken });
			if (!result.ok) {
				return { ok: false, error: draftSaveErrorMessage(result.error.code) };
			}
			const applied = parseSaveAllApply(result.value);
			if (!applied) {
				return { ok: false, error: draftSaveErrorMessage('SERVICE_ERROR') };
			}
			const refreshed = await showGraph(provider, treeView, workspaceId, architectureId);
			if (refreshed) {
				updateStatusBar(refreshed);
				syncProblems(refreshed);
				canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
				canvas.setNotice({
					kind: 'info',
					message: l10n.t('Saved {0} files and refreshed architecture to revision {1}.', applied.files.length, applied.newSourceRevision.slice(0, 8)),
				});
			}
			return { ok: true, applied };
		},
		onLoadCatalogueSnapshots: loadCatalogueSnapshots,
		onLoadCatalogueTypes: loadCatalogueTypes,
		onLoadResourceSchema: loadResourceSchema,
		async onReadResourceValues(workspaceId, architectureId, sourceRevision) {
			const result = await callService<unknown>('readResourceValues', { workspaceId, architectureId, expectedSourceRevision: sourceRevision });
			return result.ok ? result.value : undefined;
		},
		async onRenderResourceDraft(resourceId, draft) {
			const typeName = typeof draft.typeName === 'string' ? draft.typeName : '';
			const snap = selectBestSnapshotForType(await loadCatalogueSnapshots(), typeName);
			if (!snap) {
				return null;
			}
			const result = await callService<unknown>('renderResourceDraft', {
				key: { address: snap.address, version: snap.version, formatVersion: snap.formatVersion, sha256: snap.sha256 },
				draft,
			});
			return result.ok ? parseSchemaPreview(result.value, resourceId, snap.version) ?? null : null;
		},
		onLoadCloudRegions: loadCloudRegions,
		onInspectDependencies: inspectArchitectureDependencies,
		onReadModule: readArchitectureModule,
		onAuditExportReadiness: auditArchitectureExportReadiness,
		onDiffCatalogueSnapshots: diffArchitectureCatalogueSnapshots,
		onDetectEngines: detectLocalEngines,
		onRunEngineValidate: runArchitectureEngineValidate,
		onRunEnginePlan: runArchitectureEnginePlan,
		onCheckOfflineMirrorReadiness: checkArchitectureOfflineMirrorReadiness,
		onRunEngineInitOffline: runArchitectureEngineInitOffline,
		async onExportArtifact(format, suggestedFileName, content, encoding) {
			const folder = workspace.workspaceFolders?.[0]?.uri;
			const defaultUri = folder ? Uri.joinPath(folder, suggestedFileName) : Uri.file(suggestedFileName);
			const filters: Record<string, string[]> = format === 'bundle'
				? { 'CloudForge Project Bundle': ['zip'] }
				: format === 'svg'
				? { 'SVG Diagram': ['svg'] }
				: format === 'png'
					? { 'PNG Image': ['png'] }
					: format === 'bicep'
						? { 'Azure Bicep': ['bicep'] }
						: format === 'arm'
							? { 'Azure ARM JSON': ['json'] }
							: format === 'cloudformation'
								? { 'CloudFormation YAML': ['yaml', 'yml'] }
								: format === 'k8s'
									? { 'Kubernetes YAML': ['yaml', 'yml'] }
									: { 'Markdown Report': ['md'] };
			const target = await window.showSaveDialog({
				defaultUri,
				filters,
				saveLabel: l10n.t('Export'),
				title: format === 'bundle' ? l10n.t('Export CloudForge Project Bundle') : l10n.t('Export CloudForge Architecture'),
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
		async onUseTemplateAsArchitecture(templateId) {
			const template = findTemplateById(templateId);
			if (!template) {
				return;
			}
			await projectControllerRef.current?.createArchitectureFromTemplate(template.defaultArchName, template.starterMainTf);
		},
		onToggleFocusMode: setCanvasFocusMode,
		isFocusModeActive: () => focusModeActive,
	});

	const terraformProviders = registerTerraformEditorProviders({
		getActiveSnapshot() {
			const graph = provider.getGraph();
			return graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined;
		},
		getCachedSchema(kind, typeName) {
			return cachedLiveSchemas.get(`${kind}:${typeName}`) ?? undefined;
		},
		listCachedSchemas() {
			const out: FormSchema[] = [];
			for (const schema of cachedLiveSchemas.values()) {
				if (schema) {
					out.push(schema);
				}
			}
			return out;
		},
	});
	terraformProvidersRef.current = terraformProviders;

	function resolveNodeIdFromActiveEditor(graph: ArchitectureGraph): string | undefined {
		const editor = window.activeTextEditor;
		if (!editor) {
			return undefined;
		}
		const doc = editor.document;
		const lowerPath = doc.uri.path.toLowerCase();
		if (!lowerPath.endsWith('.tf') && !lowerPath.endsWith('.tofu') && doc.languageId !== 'terraform' && doc.languageId !== 'hcl') {
			return undefined;
		}
		const pos = editor.selection.active;
		const ref = extractTerraformReferenceAtPosition(doc.lineAt(pos.line).text, pos.character);
		if (ref) {
			const matchedRef = matchReferenceToGraphNode(ref, graph.nodes);
			if (matchedRef) {
				return matchedRef.id;
			}
		}
		const blocks = parseTerraformDocumentBlocks(doc.getText());
		const block = findTerraformBlockAtLine(blocks, pos.line);
		if (block) {
			const pathStr = doc.uri.path;
			const slashIdx = pathStr.lastIndexOf('/');
			const baseName = slashIdx >= 0 ? pathStr.slice(slashIdx + 1) : pathStr;
			const matchedBlock = matchBlockToGraphNode(block, graph.nodes, baseName);
			if (matchedBlock) {
				return matchedBlock.id;
			}
		}
		return undefined;
	}

	context.subscriptions.push(provider, treeView, problems, planOutput, readinessOutput, schemaDiffOutput, canvas, statusBar, terraformProviders);
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
	context.subscriptions.push(commands.registerCommand('cloudforge.revealNodeInCanvas', async (arg?: unknown) => {
		const graph = provider.getGraph();
		if (!graph || graph.nodes.length === 0) {
			void window.showInformationMessage(l10n.t('Open an architecture before revealing a resource in the Canvas.'));
			return;
		}
		let nodeId: string | undefined;
		if (typeof arg === 'string' && arg.length > 0) {
			nodeId = arg;
		} else {
			nodeId = resolveNodeIdFromActiveEditor(graph);
		}
		if (!nodeId) {
			const picked = await window.showQuickPick(
				graph.nodes.map(node => ({
					label: node.label,
					description: `${node.resourceType ?? node.kind}${node.sourceFile ? ` · ${node.sourceFile}${node.sourceLine ? `:${node.sourceLine}` : ''}` : ''}`,
					nodeId: node.id,
				})),
				{
					title: l10n.t('Reveal Resource in Canvas ({0})', currentArchitectureName),
					placeHolder: l10n.t('Choose a resource to select on the CloudForge Architecture Canvas'),
					matchOnDescription: true,
				}
			);
			if (!picked) {
				return;
			}
			nodeId = picked.nodeId;
		}
		const target = graph.nodes.find(node => node.id === nodeId);
		if (!target) {
			return;
		}
		canvas.revealNode(toCanvasSnapshot(graph, currentArchitectureName), target.id);
	}));
	async function applyWorkspacePreset(requestedId?: unknown): Promise<void> {
		let presetId: WorkspacePresetId | undefined = isWorkspacePresetId(requestedId) ? requestedId : undefined;
		if (!presetId) {
			const picked = await window.showQuickPick(
				WORKSPACE_PRESETS.map(preset => ({
					label: `${preset.icon} ${preset.label}`,
					description: preset.description,
					detail: preset.detail,
					presetId: preset.id,
				})),
				{
					title: l10n.t('CloudForge Workspace Layout'),
					placeHolder: l10n.t('Choose a workspace layout preset'),
				}
			);
			if (!picked) {
				return;
			}
			presetId = picked.presetId;
		}
		const preset = findWorkspacePreset(presetId);
		const graph = provider.getGraph();
		if (preset.focusMode) {
			canvas.show(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined, false);
			await setCanvasFocusMode(true);
			return;
		}
		if (focusModeActive) {
			await setCanvasFocusMode(false);
		}
		if (preset.hideSecondarySidebar) {
			await commands.executeCommand('workbench.action.closeAuxiliaryBar').then(undefined, () => undefined);
		}
		if (preset.hideBottomPanel) {
			await commands.executeCommand('workbench.action.closePanel').then(undefined, () => undefined);
		}
		if (preset.showPrimarySidebar) {
			await commands.executeCommand('cloudforge.projects.focus').then(undefined, () => undefined);
		}
		if (preset.editorLayout) {
			await commands.executeCommand('vscode.setEditorLayout', preset.editorLayout).then(undefined, () => undefined);
		}
		canvas.show(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined, false);
		if (preset.id === 'architecture-code') {
			const sourceNode = graph?.nodes.find(node => node.hasSource);
			if (graph && sourceNode) {
				await commands.executeCommand('workbench.action.focusSecondEditorGroup').then(undefined, () => undefined);
				await openNodeSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, sourceNode.id);
			} else {
				const tfFiles = await workspace.findFiles('**/*.tf', '**/.terraform/**', 1);
				if (tfFiles.length > 0) {
					await window.showTextDocument(tfFiles[0], { viewColumn: ViewColumn.Two, preserveFocus: true }).then(undefined, () => undefined);
				}
			}
		}
	}

	context.subscriptions.push(commands.registerCommand('cloudforge.toggleCanvasFocusMode', () => {
		return setCanvasFocusMode();
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.applyWorkspacePreset', (presetId?: unknown) => {
		return applyWorkspacePreset(presetId);
	}));
	context.subscriptions.push({
		dispose() {
			if (focusModeActive) {
				void setCanvasFocusMode(false);
			}
		}
	});
	// Live reverse sync: saving a Terraform source file in Code OSS refreshes the open CloudForge Canvas.
	let tfSaveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	const isTerraformUri = (uri: Uri) => {
		const lower = uri.path.toLowerCase();
		return lower.endsWith('.tf') || lower.endsWith('.tf.json');
	};
	const scheduleTfRefresh = () => {
		const current = provider.getGraph();
		if (!current) {
			return;
		}
		if (tfSaveRefreshTimer) {
			clearTimeout(tfSaveRefreshTimer);
		}
		tfSaveRefreshTimer = setTimeout(() => {
			tfSaveRefreshTimer = undefined;
			const active = provider.getGraph();
			if (!active) {
				return;
			}
			void showGraph(provider, treeView, active.workspaceId, active.architectureId).then(refreshed => {
				if (refreshed) {
					updateStatusBar(refreshed);
					syncProblems(refreshed);
					canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
				}
			});
		}, 250);
	};
	context.subscriptions.push(workspace.onDidSaveTextDocument(doc => {
		if (isTerraformUri(doc.uri)) {
			scheduleTfRefresh();
		}
	}));
	// Changes from outside the editor (git pull, another tool, a file deleted in Explorer) refresh
	// the canvas too. Rust re-reads the architecture, so a change outside it is a cheap no-op.
	const tfWatcher = workspace.createFileSystemWatcher('**/*.{tf,tf.json}');
	context.subscriptions.push(
		tfWatcher,
		tfWatcher.onDidChange(uri => { if (isTerraformUri(uri)) { scheduleTfRefresh(); } }),
		tfWatcher.onDidCreate(uri => { if (isTerraformUri(uri)) { scheduleTfRefresh(); } }),
		tfWatcher.onDidDelete(uri => { if (isTerraformUri(uri)) { scheduleTfRefresh(); } }),
	);
	context.subscriptions.push({
		dispose() {
			if (tfSaveRefreshTimer) {
				clearTimeout(tfSaveRefreshTimer);
				tfSaveRefreshTimer = undefined;
			}
		}
	});
	context.subscriptions.push(commands.registerCommand('cloudforge.validateArchitecture', () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before running validation.'));
			return;
		}
		canvas.triggerValidation(toCanvasSnapshot(graph, currentArchitectureName), 'architecture');
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.runEnginePlan', async () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before previewing a local plan.'));
			return;
		}
		await runAndPresentLocalPlan(graph);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.exportMultiTarget', async () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before exporting IaC or reports.'));
			return;
		}
		const snapshot = toCanvasSnapshot(graph, currentArchitectureName);
		type TargetPick = {
			readonly label: string;
			readonly description: string;
			readonly target: GeneratorTarget | 'markdown';
			readonly language: string;
			readonly ext: string;
			readonly filterName: string;
		};
		const picked = await window.showQuickPick<TargetPick>(
			[
				{ label: `$(markdown) ${l10n.t('Architecture Markdown Report')}`, description: '.md · Inventory, dependencies & provider lock summary', target: 'markdown', language: 'markdown', ext: '.md', filterName: 'Markdown Report' },
				{ label: `$(file-code) ${l10n.t('Azure Bicep Preview')}`, description: '.bicep · Offline static mapper with coverage report', target: 'bicep', language: 'bicep', ext: '.bicep', filterName: 'Azure Bicep' },
				{ label: `$(json) ${l10n.t('Azure ARM Template Preview')}`, description: '.json · ARM 2019-04-01 template schema', target: 'arm', language: 'json', ext: '.json', filterName: 'Azure ARM JSON' },
				{ label: `$(file-code) ${l10n.t('AWS CloudFormation YAML Preview')}`, description: '.yaml · AWS CloudFormation resource mapping', target: 'cloudformation', language: 'yaml', ext: '.yaml', filterName: 'CloudFormation YAML' },
				{ label: `$(file-code) ${l10n.t('Kubernetes Manifests YAML Preview')}`, description: '.yaml · Namespaces, deployments, services & policies', target: 'k8s', language: 'yaml', ext: '.yaml', filterName: 'Kubernetes YAML' },
			],
			{
				title: l10n.t('Export CloudForge Architecture ({0})', currentArchitectureName),
				placeHolder: l10n.t('Choose an export format to preview or save'),
			}
		);
		if (!picked) {
			return;
		}

		let content: string;
		let summaryNote: string;
		if (picked.target === 'markdown') {
			const dependencyReport = await inspectArchitectureDependencies(graph.workspaceId, graph.architectureId, graph.sourceRevision);
			const projection = buildCanvasProjection(snapshot, 'visual', '', new Set());
			content = renderArchitectureMarkdownReport(snapshot, projection, {
				scope: 'architecture',
				theme: 'dark',
				mode: 'visual',
				includeValidation: false,
				includeAnnotations: false,
				includeProvenance: true,
				frames: [],
				annotations: [],
				hiddenLayers: [],
				dependencyReport: dependencyReport ?? null,
			});
			summaryNote = l10n.t('Generated Markdown report for {0} ({1} resources).', currentArchitectureName, snapshot.nodes.length);
		} else {
			const artifact = generateTargetIac(snapshot, {}, picked.target);
			content = artifact.code;
			summaryNote = l10n.t(
				'Generated {0}: {1} mapped, {2} unmapped.',
				artifact.label,
				artifact.mappedCount,
				artifact.unmappedCount
			);
		}

		const doc = await workspace.openTextDocument({ content, language: picked.language });
		await window.showTextDocument(doc, { preview: true });
		const saveChoice = l10n.t('Save to File…');
		const choice = await window.showInformationMessage(summaryNote, saveChoice);
		if (choice === saveChoice) {
			const folder = workspace.workspaceFolders?.[0]?.uri;
			const fileName = `${sanitizeExportStem(currentArchitectureName)}${picked.ext}`;
			const defaultUri = folder ? Uri.joinPath(folder, fileName) : Uri.file(fileName);
			const targetUri = await window.showSaveDialog({
				defaultUri,
				filters: { [picked.filterName]: [picked.ext.slice(1)] },
				saveLabel: l10n.t('Save Export'),
				title: l10n.t('Save {0}', picked.filterName),
			});
			if (targetUri) {
				await workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
				void window.showInformationMessage(l10n.t('Saved {0}.', targetUri.path.split('/').pop() ?? fileName));
			}
		}
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.inspectArchitectureReadiness', async () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before inspecting readiness, policy, and cost.'));
			return;
		}
		const snapshot = toCanvasSnapshot(graph, currentArchitectureName);
		const [dependencyReport, exportAudit] = await Promise.all([
			inspectArchitectureDependencies(graph.workspaceId, graph.architectureId, graph.sourceRevision),
			auditArchitectureExportReadiness(graph.workspaceId, graph.architectureId, graph.sourceRevision),
		]);
		const policyFindings = evaluateArchitecturePolicies(snapshot, {}, dependencyReport ?? null);
		const costEstimate = estimateArchitectureCost(createDraftDocument(snapshot));

		readinessOutput.clear();
		readinessOutput.append(formatReadinessReportText({
			architectureName: currentArchitectureName,
			sourceRevision: graph.sourceRevision,
			dependencyReport,
			exportAudit,
			policyFindings,
			costEstimate,
		}));

		type ReadinessPick =
			| { readonly label: string; readonly description?: string; readonly detail?: string; readonly pickKind: 'finding'; readonly nodeId: string | null }
			| { readonly label: string; readonly description?: string; readonly detail?: string; readonly pickKind: 'openOutput' };
		const picks: ReadinessPick[] = [];
		if (exportAudit) {
			picks.push({
				label: `${exportAudit.reproducible ? '$(shield)' : '$(warning)'} ${l10n.t('Export Readiness: {0}', exportAudit.reproducible ? l10n.t('Reproducible') : l10n.t('Action Required'))}`,
				description: l10n.t('lock: {0} ({1} entries) · {2} modules', exportAudit.lockState, exportAudit.lockEntryCount, exportAudit.moduleCount),
				detail: exportAudit.unresolvedReasonKinds.length > 0 ? l10n.t('Unresolved: {0}', exportAudit.unresolvedReasonKinds.join(', ')) : undefined,
				pickKind: 'openOutput',
			});
		}
		picks.push({
			label: `$(credit-card) ${l10n.t('Offline Cost Estimate: ${0}/mo USD', costEstimate.baselineTotalUsd.toFixed(2))}`,
			description: l10n.t('{0} catalogued · {1} unknown', costEstimate.knownCount, costEstimate.unknownCount),
			detail: costEstimate.pricingCatalog,
			pickKind: 'openOutput',
		});
		for (const finding of policyFindings) {
			const icon = finding.severity === 'error' ? '$(error)' : finding.severity === 'warning' ? '$(warning)' : '$(info)';
			picks.push({
				label: `${icon} ${finding.ruleId}: ${finding.title}`,
				description: finding.resourceLabel,
				detail: finding.remediation,
				pickKind: 'finding',
				nodeId: finding.nodeId,
			});
		}
		picks.push({
			label: `$(output) ${l10n.t('Open Full Readiness & Cost Report')}`,
			description: l10n.t('CloudForge Readiness output channel'),
			pickKind: 'openOutput',
		});

		const picked = await window.showQuickPick(picks, {
			title: l10n.t('CloudForge Readiness, Policy & Cost ({0})', currentArchitectureName),
			placeHolder: l10n.t('Select a finding to locate its resource or open the full report'),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!picked) {
			return;
		}
		if (picked.pickKind === 'finding' && picked.nodeId) {
			canvas.selectNode(picked.nodeId);
			await openNodeSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, picked.nodeId);
			return;
		}
		readinessOutput.show(true);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.diffProviderSchema', async () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before running a provider schema upgrade diff.'));
			return;
		}
		const snapshots = await loadCatalogueSnapshots();
		const groups = groupUpgradeableSnapshots(snapshots);
		if (groups.length === 0) {
			const importAction = l10n.t('Import Provider Schema…');
			const choice = await window.showInformationMessage(
				l10n.t('Import at least two versions of the same provider schema to diff upgrade impact.'),
				importAction
			);
			if (choice === importAction) {
				await commands.executeCommand('cloudforge.importProviderSchema');
			}
			return;
		}
		let group = groups[0];
		if (groups.length > 1) {
			const pickedGroup = await window.showQuickPick(
				groups.map(item => ({
					label: item.address,
					description: l10n.t('{0} snapshots ({1})', item.snapshots.length, item.snapshots.map(s => s.version).join(', ')),
					group: item,
				})),
				{ title: l10n.t('Choose Provider to Diff') }
			);
			if (!pickedGroup) {
				return;
			}
			group = pickedGroup.group;
		}
		const fromPick = await window.showQuickPick(
			group.snapshots.map(snap => ({
				label: snap.version,
				description: `format ${snap.formatVersion} · ${snap.sha256.slice(0, 8)}`,
				detail: l10n.t('{0} resources · {1} data sources', snap.resourceCount, snap.dataSourceCount),
				snap,
			})),
			{ title: l10n.t('Baseline (From) Version for {0}', group.address) }
		);
		if (!fromPick) {
			return;
		}
		const toCandidates = group.snapshots.filter(s => s.sha256 !== fromPick.snap.sha256 || s.version !== fromPick.snap.version);
		const toPick = await window.showQuickPick(
			toCandidates.map(snap => ({
				label: snap.version,
				description: `format ${snap.formatVersion} · ${snap.sha256.slice(0, 8)}`,
				detail: l10n.t('{0} resources · {1} data sources', snap.resourceCount, snap.dataSourceCount),
				snap,
			})),
			{ title: l10n.t('Target (To) Version for {0}', group.address) }
		);
		if (!toPick) {
			return;
		}
		const outcome = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('Diffing {0} {1} -> {2}…', group.address, fromPick.snap.version, toPick.snap.version),
			},
			() => diffArchitectureCatalogueSnapshots(
				{ address: fromPick.snap.address, version: fromPick.snap.version, formatVersion: fromPick.snap.formatVersion, sha256: fromPick.snap.sha256 },
				{ address: toPick.snap.address, version: toPick.snap.version, formatVersion: toPick.snap.formatVersion, sha256: toPick.snap.sha256 },
				graph.workspaceId,
				graph.architectureId,
				graph.sourceRevision
			)
		);
		if (!outcome.ok) {
			void window.showErrorMessage(outcome.message);
			return;
		}
		const report = outcome.report;
		schemaDiffOutput.clear();
		schemaDiffOutput.append(formatSchemaDiffReportText(report, currentArchitectureName));

		type DiffPick =
			| { readonly label: string; readonly description?: string; readonly detail?: string; readonly pickKind: 'impact'; readonly address: string; readonly typeName: string }
			| { readonly label: string; readonly description?: string; readonly pickKind: 'openOutput' };
		const picks: DiffPick[] = report.impactedArchitectureItems.map(item => ({
			label: `${item.breaking ? '$(error)' : '$(info)'} ${item.resourceAddress}`,
			description: `${item.typeName}.${item.path}${item.breaking ? ' · BREAKING' : ''}`,
			detail: item.summary,
			pickKind: 'impact',
			address: item.resourceAddress,
			typeName: item.typeName,
		}));
		picks.push({
			label: `$(output) ${l10n.t('Open Full Schema Diff Output')}`,
			description: l10n.t('+{0} / -{1} types · {2} path changes{3}', report.addedTypeCount, report.removedTypeCount, report.pathChangeCount, report.hasBreakingChanges ? ' · BREAKING' : ''),
			pickKind: 'openOutput',
		});

		const selected = await window.showQuickPick(picks, {
			title: l10n.t('Schema Upgrade Impact: {0} ({1} -> {2})', report.provider, report.fromVersion, report.toVersion),
			placeHolder: report.impactedArchitectureItems.length > 0
				? l10n.t('Select an impacted resource to inspect it in Canvas & source')
				: l10n.t('No resources in {0} are impacted by this upgrade', currentArchitectureName),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!selected) {
			return;
		}
		if (selected.pickKind === 'impact') {
			const targetNode = graph.nodes.find(node =>
				node.name === selected.address ||
				(node.resourceType === selected.typeName && selected.address.endsWith(`.${node.label}`))
			);
			if (targetNode) {
				canvas.selectNode(targetNode.id);
				if (targetNode.hasSource) {
					await openNodeSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, targetNode.id);
				}
				return;
			}
		}
		schemaDiffOutput.show(true);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.explainResource', async (arg?: unknown) => {
		const graph = provider.getGraph();
		if (!graph || graph.nodes.length === 0) {
			void window.showInformationMessage(l10n.t('Open an architecture before explaining a resource.'));
			return;
		}
		let nodeId: string | undefined;
		if (arg instanceof ResourceTreeItem) {
			nodeId = arg.node.id;
		} else if (typeof arg === 'string') {
			nodeId = arg;
		} else {
			nodeId = resolveNodeIdFromActiveEditor(graph);
		}
		if (!nodeId) {
			const picked = await window.showQuickPick(
				graph.nodes.map(node => ({
					label: node.label,
					description: `${node.resourceType ?? node.kind}${node.sourceFile ? ` · ${node.sourceFile}${node.sourceLine ? `:${node.sourceLine}` : ''}` : ''}`,
					nodeId: node.id,
				})),
				{
					title: l10n.t('Explain CloudForge Resource ({0})', currentArchitectureName),
					placeHolder: l10n.t('Choose a resource to inspect topology, cost, policy, and advisor guidance'),
					matchOnDescription: true,
				}
			);
			if (!picked) {
				return;
			}
			nodeId = picked.nodeId;
		}
		const snapshot = toCanvasSnapshot(graph, currentArchitectureName);
		const node = snapshot.nodes.find(item => item.id === nodeId);
		if (!node) {
			return;
		}
		let schema: FormSchema | undefined;
		if (node.resourceType) {
			const kind = node.kind === 'data' ? 'dataSource' : 'resource';
			schema = (await loadResourceSchema(kind, node.resourceType))
				?? lookupBundledSchema({ kind: node.kind, resourceType: node.resourceType });
		}
		const policyFindings = evaluateArchitecturePolicies(snapshot, {});
		const costEstimate = estimateArchitectureCost(createDraftDocument(snapshot));
		const explanation = explainResource(snapshot, node.id, {
			schema,
			policyFindings,
			costEstimate,
		});
		if (!explanation) {
			return;
		}
		const markdown = formatResourceExplanationMarkdown(explanation, currentArchitectureName);
		const doc = await workspace.openTextDocument({ content: markdown, language: 'markdown' });
		await window.showTextDocument(doc, { preview: true });
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
	context.subscriptions.push(commands.registerCommand('cloudforge.openTemplateLibrary', () => {
		const graph = provider.getGraph();
		canvas.openTemplates(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined);
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
		cachedCatalogueTypes = undefined;
		cachedLiveSchemas.clear();
		canvas.refreshCatalogueTypes();
		const graph = provider.getGraph();
		if (graph) {
			canvas.updateIfOpen(toCanvasSnapshot(graph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Imported {0} {1} ({2} resources) into the CloudForge provider catalogue.', chosen.address, version.trim(), chosen.resources)
		);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.initArchitectureOffline', async () => {
		const graph = provider.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open an architecture before running offline mirror initialization.'));
			return;
		}
		const outcome = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('CloudForge: Initializing {0} offline from local provider mirror…', currentArchitectureName),
				cancellable: false,
			},
			() => runArchitectureEngineInitOffline(graph.workspaceId, graph.architectureId, graph.sourceRevision)
		);
		if (!outcome.ok) {
			void window.showWarningMessage(outcome.message);
			return;
		}
		const engineLabel = outcome.report.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
		if (outcome.report.status === 'initialized') {
			void window.showInformationMessage(
				l10n.t('{0} {1} offline init succeeded in {2} ms. {3}', engineLabel, outcome.report.engineVersion, outcome.report.durationMs, outcome.report.summary)
			);
		} else {
			void window.showWarningMessage(
				l10n.t('{0} {1} offline init failed (exit {2}): {3}', engineLabel, outcome.report.engineVersion, outcome.report.exitCode, outcome.report.summary)
			);
		}
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.extractMirrorSchema', async () => {
		const listed = await callService<unknown>('listMirrorPackages', {});
		if (!listed.ok) {
			showServiceError(listed.error);
			return;
		}
		const winPackages = parseMirrorPackages(listed.value).filter(pkg => pkg.key.platform === 'windows_amd64');
		if (winPackages.length === 0) {
			void window.showInformationMessage(
				l10n.t('No verified windows_amd64 provider packages were found in the local CloudForge mirror.')
			);
			return;
		}
		const picked = await window.showQuickPick(
			winPackages.map(pkg => ({
				label: `${pkg.key.address} ${pkg.key.version}`,
				description: pkg.publisher ? `${pkg.publisher} · ${pkg.sha256.slice(0, 8)}` : pkg.sha256.slice(0, 8),
				detail: l10n.t('windows_amd64 · {0} bytes · recorded {1}', pkg.sizeBytes, pkg.recordedAt),
				pkg,
			})),
			{
				title: l10n.t('Extract Provider Schema from Local Offline Mirror'),
				placeHolder: l10n.t('Select a verified mirrored provider package to extract into the catalogue'),
			}
		);
		if (!picked) {
			return;
		}
		const extracted = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('Extracting {0} {1} schema offline from local mirror…', picked.pkg.key.address, picked.pkg.key.version),
				cancellable: false,
			},
			() => callService<unknown>('extractProviderSchemaFromMirror', {
				address: picked.pkg.key.address,
				version: picked.pkg.key.version,
			})
		);
		if (!extracted.ok) {
			showServiceError(extracted.error);
			return;
		}
		cachedCatalogueSnapshots = undefined;
		cachedLiveSchemas.clear();
		const graph = provider.getGraph();
		if (graph) {
			canvas.updateIfOpen(toCanvasSnapshot(graph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Extracted {0} {1} into the CloudForge provider catalogue from the local offline mirror.', picked.pkg.key.address, picked.pkg.key.version)
		);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.importMirrorPackage', async () => {
		const graph = provider.getGraph();
		let suggestedAddress = 'registry.terraform.io/hashicorp/azurerm';
		let suggestedVersion = '';
		let suggestedPlatform = 'windows_amd64';
		if (graph) {
			const readiness = await checkArchitectureOfflineMirrorReadiness(graph.workspaceId, graph.architectureId, graph.sourceRevision);
			const firstMissing = readiness?.missing[0];
			if (firstMissing) {
				suggestedAddress = firstMissing.address;
				suggestedVersion = firstMissing.version;
				suggestedPlatform = firstMissing.platform;
			}
		}
		const address = await window.showInputBox({
			title: l10n.t('Provider Address (hostname/namespace/type)'),
			value: suggestedAddress,
			placeHolder: 'registry.terraform.io/hashicorp/azurerm',
			validateInput: text => {
				const parts = text.trim().split('/');
				return parts.length === 3 && parts.every(p => /^[A-Za-z0-9._+-]+$/.test(p) && p !== '.' && p !== '..')
					? undefined
					: l10n.t('Enter a full 3-segment provider address such as registry.terraform.io/hashicorp/azurerm.');
			},
		});
		if (!address) {
			return;
		}
		const version = await window.showInputBox({
			title: l10n.t('Provider Version for {0}', address.trim()),
			value: suggestedVersion,
			placeHolder: '5.14.0',
			validateInput: text => /^[A-Za-z0-9._+-]+$/.test(text.trim()) ? undefined : l10n.t('Enter a provider release version such as 5.14.0.'),
		});
		if (!version) {
			return;
		}
		const platformPick = await window.showQuickPick(
			[
				{ label: 'windows_amd64', description: l10n.t('Required for local Windows offline init & schema extraction') },
				{ label: 'linux_amd64', description: l10n.t('CI / Linux offline mirror target') },
			],
			{
				title: l10n.t('Target Platform for {0} {1}', address.trim(), version.trim()),
				placeHolder: suggestedPlatform,
			}
		);
		if (!platformPick) {
			return;
		}
		const expectedSha256 = await window.showInputBox({
			title: l10n.t('Expected SHA-256 Digest (64 hex characters)'),
			placeHolder: '0123456789abcdef...',
			validateInput: text => /^[0-9a-fA-F]{64}$/.test(text.trim())
				? undefined
				: l10n.t('Enter the verified 64-character SHA-256 hex digest for the provider .zip archive.'),
		});
		if (!expectedSha256) {
			return;
		}
		const imported = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('Verifying and importing {0} {1} ({2}) into local mirror…', address.trim(), version.trim(), platformPick.label),
				cancellable: false,
			},
			() => callService<unknown>('importMirrorPackage', {
				address: address.trim(),
				version: version.trim(),
				platform: platformPick.label,
				expectedSha256: expectedSha256.trim().toLowerCase(),
			})
		);
		if (!imported.ok) {
			if (imported.error.code !== 'CANCELLED') {
				showServiceError(imported.error);
			}
			return;
		}
		const currentGraph = provider.getGraph();
		if (currentGraph) {
			canvas.updateIfOpen(toCanvasSnapshot(currentGraph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Verified and imported {0} {1} ({2}) into the local offline provider mirror.', address.trim(), version.trim(), platformPick.label)
		);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.evictMirrorPackage', async () => {
		const listed = await callService<unknown>('listMirrorPackages', {});
		if (!listed.ok) {
			showServiceError(listed.error);
			return;
		}
		const packages = parseMirrorPackages(listed.value);
		if (packages.length === 0) {
			void window.showInformationMessage(l10n.t('The local CloudForge provider mirror is currently empty.'));
			return;
		}
		const picked = await window.showQuickPick(
			packages.map(pkg => ({
				label: `${pkg.key.address} ${pkg.key.version} (${pkg.key.platform})`,
				description: `${pkg.sizeBytes} bytes · ${pkg.sha256.slice(0, 8)}`,
				detail: pkg.publisher ? l10n.t('{0} · recorded {1}', pkg.publisher, pkg.recordedAt) : l10n.t('Recorded {0}', pkg.recordedAt),
				pkg,
			})),
			{
				title: l10n.t('Remove Package from Local Offline Mirror'),
				placeHolder: l10n.t('Select a mirrored provider archive to remove'),
			}
		);
		if (!picked) {
			return;
		}
		const confirmAction = l10n.t('Remove Package');
		const confirm = await window.showWarningMessage(
			l10n.t('Remove {0} {1} ({2}) from the local offline provider mirror?', picked.pkg.key.address, picked.pkg.key.version, picked.pkg.key.platform),
			{ modal: true },
			confirmAction
		);
		if (confirm !== confirmAction) {
			return;
		}
		const evicted = await callService<unknown>('evictMirrorPackage', {
			address: picked.pkg.key.address,
			version: picked.pkg.key.version,
			platform: picked.pkg.key.platform,
		});
		if (!evicted.ok) {
			showServiceError(evicted.error);
			return;
		}
		const bytesReclaimed = isRecord(evicted.value) && typeof evicted.value.bytesReclaimed === 'number' ? evicted.value.bytesReclaimed : picked.pkg.sizeBytes;
		const currentGraph = provider.getGraph();
		if (currentGraph) {
			canvas.updateIfOpen(toCanvasSnapshot(currentGraph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Removed {0} {1} ({2}) from the local mirror ({3} bytes reclaimed).', picked.pkg.key.address, picked.pkg.key.version, picked.pkg.key.platform, bytesReclaimed)
		);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.verifyMirrorIntegrity', async () => {
		const verified = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: l10n.t('CloudForge: Verifying local offline provider mirror integrity…'),
				cancellable: false,
			},
			() => callService<unknown>('verifyMirrorIntegrity', {})
		);
		if (!verified.ok) {
			showServiceError(verified.error);
			return;
		}
		if (!isRecord(verified.value)) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid mirror verification report.'));
			return;
		}
		const verifiedCount = typeof verified.value.verifiedCount === 'number' ? verified.value.verifiedCount : 0;
		const missingCount = typeof verified.value.missingArchiveCount === 'number' ? verified.value.missingArchiveCount : 0;
		const corruptedCount = typeof verified.value.corruptedCount === 'number' ? verified.value.corruptedCount : 0;
		const totalBytes = typeof verified.value.totalBytes === 'number' ? verified.value.totalBytes : 0;
		const totalMiB = (totalBytes / (1024 * 1024)).toFixed(1);
		if (missingCount === 0 && corruptedCount === 0) {
			void window.showInformationMessage(
				l10n.t('Local provider mirror verified: {0} intact package(s) ({1} MiB total).', verifiedCount, totalMiB)
			);
			return;
		}
		void window.showWarningMessage(
			l10n.t('Local provider mirror integrity issues found: {0} verified, {1} missing archive(s), {2} corrupted.', verifiedCount, missingCount, corruptedCount)
		);
	}));
	context.subscriptions.push(commands.registerCommand('cloudforge.planMirrorCleanup', async () => {
		const quotaText = await window.showInputBox({
			title: l10n.t('Target Local Provider Mirror Quota (MiB)'),
			value: '512',
			placeHolder: '512',
			validateInput: text => /^\d+$/.test(text.trim()) ? undefined : l10n.t('Enter a non-negative integer quota in MiB.'),
		});
		if (quotaText === undefined) {
			return;
		}
		const quotaBytes = Number(quotaText.trim()) * 1024 * 1024;
		const graph = provider.getGraph();
		const params: Record<string, unknown> = graph
			? {
				quotaBytes,
				workspaceId: graph.workspaceId,
				architectureId: graph.architectureId,
				expectedSourceRevision: graph.sourceRevision,
			}
			: { quotaBytes };
		const planned = await callService<unknown>('planMirrorCleanup', params);
		if (!planned.ok) {
			showServiceError(planned.error);
			return;
		}
		if (!isRecord(planned.value)) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid mirror cleanup plan.'));
			return;
		}
		const evictable = Array.isArray(planned.value.evictable) ? planned.value.evictable : [];
		const pinned = Array.isArray(planned.value.pinnedRequiringReview) ? planned.value.pinnedRequiringReview : [];
		const totalBytes = typeof planned.value.totalBytes === 'number' ? planned.value.totalBytes : 0;
		const bytesOverQuota = typeof planned.value.bytesOverQuota === 'number' ? planned.value.bytesOverQuota : 0;
		if (evictable.length === 0 && pinned.length === 0) {
			void window.showInformationMessage(
				l10n.t('Local provider mirror is within quota ({0} MiB used; {1} MiB limit).', (totalBytes / (1024 * 1024)).toFixed(1), quotaText.trim())
			);
			return;
		}
		type CleanupPick = {
			readonly label: string;
			readonly description: string;
			readonly detail?: string;
			readonly evictKey?: { readonly address: string; readonly version: string; readonly platform: string };
		};
		const picks: CleanupPick[] = [];
		for (const item of evictable) {
			if (!isRecord(item) || !isRecord(item.key) || typeof item.key.address !== 'string' || typeof item.key.version !== 'string' || typeof item.key.platform !== 'string') {
				continue;
			}
			const bytes = typeof item.bytes === 'number' ? item.bytes : 0;
			picks.push({
				label: `$(trash) ${item.key.address} ${item.key.version} (${item.key.platform})`,
				description: l10n.t('Evictable · {0} bytes', bytes),
				detail: l10n.t('Select to remove this unpinned mirrored archive now'),
				evictKey: { address: item.key.address, version: item.key.version, platform: item.key.platform },
			});
		}
		for (const item of pinned) {
			if (!isRecord(item) || !isRecord(item.key) || typeof item.key.address !== 'string' || typeof item.key.version !== 'string' || typeof item.key.platform !== 'string') {
				continue;
			}
			const bytes = typeof item.bytes === 'number' ? item.bytes : 0;
			picks.push({
				label: `$(pin) ${item.key.address} ${item.key.version} (${item.key.platform})`,
				description: l10n.t('Pinned by active architecture · {0} bytes (protected)', bytes),
			});
		}
		const selected = await window.showQuickPick(picks, {
			title: l10n.t('Mirror Cleanup Plan ({0} MiB over quota)', (bytesOverQuota / (1024 * 1024)).toFixed(1)),
			placeHolder: l10n.t('Choose an unpinned candidate to remove, or press Escape to cancel'),
		});
		if (!selected?.evictKey) {
			return;
		}
		const evicted = await callService<unknown>('evictMirrorPackage', selected.evictKey);
		if (!evicted.ok) {
			showServiceError(evicted.error);
			return;
		}
		const currentGraph = provider.getGraph();
		if (currentGraph) {
			canvas.updateIfOpen(toCanvasSnapshot(currentGraph, currentArchitectureName));
		}
		void window.showInformationMessage(
			l10n.t('Removed {0} {1} ({2}) from the local offline provider mirror.', selected.evictKey.address, selected.evictKey.version, selected.evictKey.platform)
		);
	}));
	let opening: Promise<void> | undefined;
	context.subscriptions.push(commands.registerCommand('cloudforge.openWorkspace', () => {
		return opening ??= openWorkspace(provider, treeView, (loaded, architectureName) => {
			currentArchitectureName = architectureName;
			updateStatusBar(loaded);
			syncProblems(loaded);
			canvas.show(toCanvasSnapshot(loaded, architectureName), true);
		}).finally(() => { opening = undefined; });
	}));

	// Stage 2: projects with repositories. Architectures chosen in the Projects view, including
	// those that live in imported repositories, show in both the native graph tree and the canvas.
	projectControllerRef.current = activateProjects(context, {
		async show(workspaceId, architectureId, architectureName) {
			provider.setGraph(undefined);
			updateStatusBar(undefined);
			syncProblems(undefined);
			const selected = await callService<unknown>('selectArchitecture', { workspaceId, architectureId });
			if (!selected.ok) {
				showServiceError(selected.error);
				return;
			}
			const loaded = await showGraph(provider, treeView, workspaceId, architectureId);
			if (loaded) {
				currentArchitectureName = architectureName || l10n.t('Architecture');
				updateStatusBar(loaded);
				syncProblems(loaded);
				canvas.show(toCanvasSnapshot(loaded, currentArchitectureName), true);
			}
			await commands.executeCommand(panelTreeView.visible ? 'cloudforge.panel.resources.focus' : 'cloudforge.resources.focus');
		},
		async openCanvas(focusMode = false) {
			const graph = provider.getGraph();
			canvas.show(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined, false);
			if (focusMode) {
				await setCanvasFocusMode(true);
			}
		},
		async validateArchitecture() {
			const graph = provider.getGraph();
			if (graph) {
				canvas.triggerValidation(toCanvasSnapshot(graph, currentArchitectureName), 'architecture');
			}
		},
		async planArchitecture() {
			const graph = provider.getGraph();
			if (graph) {
				await runAndPresentLocalPlan(graph);
			}
		},
		openTemplates() {
			const graph = provider.getGraph();
			canvas.openTemplates(graph ? toCanvasSnapshot(graph, currentArchitectureName) : undefined);
		}
	});

	// Stage 11: the CloudForge side panel (Project Status, Terraform State, Cloud Connections).
	const projectChanged = new EventEmitter<void>();
	context.subscriptions.push(projectChanged, projectControllerRef.current.onDidChange(() => projectChanged.fire()));
	activateSidePanel(context, {
		callService,
		getGraph: () => provider.getGraph(),
		onDidChangeGraph: provider.onDidChangeTreeData,
		architectureName: () => provider.getGraph() ? currentArchitectureName : undefined,
		projectName: () => projectControllerRef.current?.current?.displayName,
		projectWorkspaceId: () => projectControllerRef.current?.current?.workspaceId,
		onDidChangeProject: projectChanged.event,
		openNodeSource: (graph, nodeId) => openNodeSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, nodeId),
	});
}
