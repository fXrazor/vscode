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
	window,
	type Event,
	type ExtensionContext,
	type TreeDataProvider,
	type TreeView
} from 'vscode';
import { activateProjects } from './project/index';
import { CloudForgeCanvasPanel } from './canvas/canvasPanel';
import type { CanvasGraphSnapshot } from './canvas/protocol';

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
		edges: graph.edges,
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

	const canvas = new CloudForgeCanvasPanel(context, {
		onSelectNode() {
			// Selection is preserved inside the canvas state; native tree selection stays non-destructive.
		},
		onOpenSource: openNodeSource,
		async onRefresh(workspaceId, architectureId) {
			const refreshed = await showGraph(provider, treeView, workspaceId, architectureId);
			if (refreshed) {
				canvas.updateIfOpen(toCanvasSnapshot(refreshed, currentArchitectureName));
			}
		}
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
