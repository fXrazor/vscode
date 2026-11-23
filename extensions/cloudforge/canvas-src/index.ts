/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Read-only Architecture Canvas Webview (Phase 1):
// - Single canonical graph model projected into Visual Design & Technical Design modes.
// - Independent canvas theme (Workbench / Light / Dark) and zoom-adaptive subtle grid.
// - Single-click inspector, n8n-style Focused Resource Workspace with Back to Canvas,
//   keyboard-accessible Resource List, scoped search, and trusted Open Source navigation.

import {
	adaptiveGridStep,
	alignPositionedNodes,
	buildCanvasProjection,
	computeFrameForNodes,
	computeLodLevel,
	computeSnapGuides,
	fitRectToStage,
	inferProvider,
	layerDisplayName,
	providerDisplayName,
	snapCoordinate,
	type CanvasProjection,
	type PositionedNode
} from '../src/canvas/layout';
import {
	renderArchitectureMarkdownReport,
	renderArchitectureSvg,
	type DiagramExportOptions,
	type ExportScope
} from '../src/canvas/exportDiagram';
import {
	buildExtractModulePreview,
	inspectModuleBoundary,
	instantiateStarterPattern,
	STARTER_PATTERNS
} from '../src/canvas/patterns';
import {
	appendCheckpoint,
	captureCheckpoint,
	checkpointToDraftState,
	compareSemanticSnapshots,
	isSampleContextStale,
	startExperimentSession,
	type ExperimentSession
} from '../src/canvas/history';
import {
	buildReferenceCandidates,
	createInitialDraft,
	lookupBundledSchema,
	renderDraftPreview,
	type DraftBlock,
	type DraftValue,
	type FormAttribute,
	type FormBlockType,
	type FormSchema,
	type ResourceDraft
} from '../src/canvas/schemaForm';
import {
	cancelValidationRun,
	computePrerequisiteScope,
	runOfflineValidation,
	syncRunWithRevision,
	type RunnerNodeStatus,
	type ValidationRun
} from '../src/canvas/validationRunner';
import {
	applyDraftEdit,
	computeDraftChangeSummary,
	createDraftDocument,
	generateTerraformPreview,
	projectDraftGraph,
	redoDraftEdit,
	revertDraftDocument,
	undoDraftEdit,
	uniqueResourceName,
	type DraftDocument,
	type DraftEdit
} from '../src/canvas/draftDocument';
import {
	ARCHITECTURE_LAYERS,
	defaultCanvasViewState,
	isValidTfFileName,
	type ArchitectureLayer,
	type CanvasAnnotation,
	type CanvasAnnotationColor,
	type CanvasCatalogueSnapshot,
	type CanvasCloudRegionsPayload,
	type CanvasDependencyReport,
	type CanvasFrame,
	type CanvasFrameColor,
	type CanvasGraphSnapshot,
	type CanvasGridMode,
	type CanvasNodeSummary,
	type CanvasNotice,
	type CanvasPoint,
	type CanvasTheme,
	type CanvasViewMode,
	type CanvasViewport,
	type CanvasViewState,
	type DraftSaveError,
	type DraftSavePreviewResult,
	type ExportFormat,
	type ExtensionToWebviewMessage,
	type WebviewToExtensionMessage
} from '../src/canvas/protocol';

declare function acquireVsCodeApi<T>(): {
	postMessage(message: unknown): void;
	getState(): T | undefined;
	setState(state: T): void;
};

const vscode = acquireVsCodeApi<CanvasViewState>();

const SVG_NS = 'http://www.w3.org/2000/svg';

const ADDABLE_RESOURCE_TYPES: readonly { readonly typeName: string; readonly shortLabel: string; readonly defaultName: string }[] = [
	{ typeName: 'azurerm_resource_group', shortLabel: 'Resource Group', defaultName: 'rg' },
	{ typeName: 'azurerm_virtual_network', shortLabel: 'Virtual Network', defaultName: 'vnet' },
	{ typeName: 'azurerm_subnet', shortLabel: 'Subnet', defaultName: 'subnet' },
	{ typeName: 'azurerm_network_security_group', shortLabel: 'Network Security Group', defaultName: 'nsg' },
	{ typeName: 'azurerm_public_ip', shortLabel: 'Public IP', defaultName: 'pip' },
	{ typeName: 'azurerm_route_table', shortLabel: 'Route Table', defaultName: 'rt' },
];

let draftDoc: DraftDocument | undefined;
let notice: CanvasNotice | null = null;
let emptyMessage = 'Select an architecture in CloudForge Project or run CloudForge: Open Workspace to inspect its infrastructure graph.';
let state: CanvasViewState = defaultCanvasViewState();
let searchQuery = '';
let projection: CanvasProjection | undefined;
let viewport: CanvasViewport = { x: 40, y: 40, zoom: 1 };
let dragging: { startX: number; startY: number; originX: number; originY: number } | undefined;
let persistTimer: number | undefined;
let lastFocusBeforeWorkspace: HTMLElement | null = null;
let lastFocusBeforeHclReview: HTMLElement | null = null;
let activeFieldKey: { readonly blockId?: string; readonly attrName: string } | undefined;
let workspaceResultsTab: 'findings' | 'preview' | 'outputs' = 'preview';
let nextDraftBlockId = 1;
let nextDraftNodeSeq = 1;
let currentRun: ValidationRun | undefined;
let validationInFlight = false;
let timelineOpen = false;
let hclReviewOpen = false;
let connectFeedback: string | undefined;
let catalogueSnapshots: readonly CanvasCatalogueSnapshot[] = [];
const liveSchemas = new Map<string, FormSchema | null>();
const pendingSchemaRequests = new Set<string>();
const cloudRegionsByProvider = new Map<'azure' | 'aws' | 'google', CanvasCloudRegionsPayload>();
let dependencyReport: CanvasDependencyReport | null = null;
let saveFileName = 'cloudforge_draft.tf';
let savePhase: 'idle' | 'previewing' | 'previewReady' | 'applying' = 'idle';
let savePreview: DraftSavePreviewResult | undefined;
let savePreviewHcl: string | undefined;
let saveError: DraftSaveError | undefined;
const selectedIds = new Set<string>();
let activeGuideX: number | undefined;
let activeGuideY: number | undefined;
let nodeDrag: {
	readonly nodeId: string;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly originX: number;
	readonly originY: number;
	readonly width: number;
	readonly height: number;
	moved: boolean;
} | undefined;
let frameDrag: {
	readonly frameId: string;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly originX: number;
	readonly originY: number;
	readonly memberOrigins: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>;
	moved: boolean;
} | undefined;
let noteDrag: {
	readonly noteId: string;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly originX: number;
	readonly originY: number;
	moved: boolean;
} | undefined;
let exportModalOpen = false;
let lastFocusBeforeExport: HTMLElement | null = null;
let exportFormat: ExportFormat = 'svg';
let exportScope: ExportScope = 'architecture';
let exportFrameId: string | undefined;
let exportTheme: 'light' | 'dark' = 'dark';
let exportIncludeValidation = true;
let exportIncludeAnnotations = true;
let exportIncludeProvenance = true;
let exportBusy = false;
let exportStatusMessage: { readonly ok: boolean; readonly text: string } | undefined;
let nextPresentationSeq = 1;
const expandedPaginatedGroups = new Set<string>();
let drilledModuleId: string | null = null;
let lastFocusBeforeModuleDrill: HTMLElement | null = null;
let extractModuleModalOpen = false;
let extractModuleName = 'network_core';
let extractModuleTab: 'call' | 'moved' | 'variables' | 'outputs' = 'call';
let lastFocusBeforeExtractModal: HTMLElement | null = null;
let historyModalOpen = false;
let historyModalTab: 'checkpoints' | 'experiments' | 'sample' = 'checkpoints';
let lastFocusBeforeHistoryModal: HTMLElement | null = null;
let checkpointNameInput = '';
let checkpointNoteInput = '';
let compareCheckpointId: string | null = null;
let experimentNameInput = '';
let activeExperiment: ExperimentSession | undefined;
let sampleLabelInput = 'Staging Dry-Run';
let sampleEnvInput: 'dev' | 'staging' | 'prod' = 'staging';
let sampleRegionInput = 'uksouth';

const FRAME_COLORS: readonly CanvasFrameColor[] = ['blue', 'emerald', 'amber', 'violet', 'slate'];
const NOTE_COLORS: readonly CanvasAnnotationColor[] = ['amber', 'blue', 'emerald', 'rose'];

function resetSavePreviewState(): void {
	savePhase = 'idle';
	savePreview = undefined;
	savePreviewHcl = undefined;
	saveError = undefined;
}

function cloudProviderForType(resourceType: string | null): 'azure' | 'aws' | 'google' | undefined {
	if (!resourceType) {
		return undefined;
	}
	const lower = resourceType.toLowerCase();
	if (lower.startsWith('azurerm_') || lower.startsWith('azapi_') || lower.startsWith('azuread_')) {
		return 'azure';
	}
	if (lower.startsWith('aws_')) {
		return 'aws';
	}
	if (lower.startsWith('google_')) {
		return 'google';
	}
	return undefined;
}

function lookupEffectiveSchema(node: Pick<CanvasNodeSummary, 'kind' | 'resourceType'>): FormSchema | undefined {
	const base = (node.resourceType ? liveSchemas.get(node.resourceType) : undefined) ?? lookupBundledSchema(node);
	if (!base) {
		return undefined;
	}
	const cloudProvider = cloudProviderForType(node.resourceType);
	const regionData = cloudProvider ? cloudRegionsByProvider.get(cloudProvider) : undefined;
	if (!regionData || regionData.regions.length === 0) {
		return base;
	}
	const regionNames = regionData.regions.map(r => r.name);
	let enriched = false;
	const attributes = base.attributes.map(attr => {
		if (attr.valueType === 'string' && (attr.name === 'location' || attr.name === 'region')) {
			enriched = true;
			return { ...attr, options: regionNames };
		}
		return attr;
	});
	return enriched ? { ...base, attributes } : base;
}

function maybeRequestLiveSchema(node: CanvasNodeSummary): void {
	if (!node.resourceType) {
		return;
	}
	const normalizedKind = node.kind.toLowerCase();
	const kind: 'resource' | 'dataSource' | undefined = normalizedKind === 'resource'
		? 'resource'
		: normalizedKind === 'data' || normalizedKind === 'datasource'
			? 'dataSource'
			: undefined;
	if (!kind) {
		return;
	}
	if (liveSchemas.has(node.resourceType) || pendingSchemaRequests.has(node.resourceType)) {
		return;
	}
	pendingSchemaRequests.add(node.resourceType);
	post({ type: 'requestSchema', kind, typeName: node.resourceType });
}

function activeGraph(): CanvasGraphSnapshot | undefined {
	return draftDoc ? projectDraftGraph(draftDoc) : undefined;
}

function draftsAsMap(): ReadonlyMap<string, ResourceDraft> {
	return draftDoc ? new Map(Object.entries(draftDoc.present.drafts)) : new Map();
}

const root = document.getElementById('app')!;

function post(message: WebviewToExtensionMessage): void {
	vscode.postMessage(message);
}

function schedulePersistViewState(): void {
	const nextState: CanvasViewState = {
		...state,
		viewports: {
			...state.viewports,
			[state.mode]: viewport,
		},
	};
	state = nextState;
	vscode.setState(nextState);
	if (persistTimer !== undefined) {
		window.clearTimeout(persistTimer);
	}
	persistTimer = window.setTimeout(() => {
		persistTimer = undefined;
		post({ type: 'viewState', state });
	}, 180);
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		node.setAttribute(k, String(v));
	}
	return node;
}

function getStageElement(): HTMLElement | null {
	return root.querySelector<HTMLElement>('.cf-stage');
}

function getStageSize(): { width: number; height: number } {
	const stage = getStageElement();
	const rect = stage?.getBoundingClientRect();
	return {
		width: rect && rect.width > 80 ? rect.width : Math.max(400, window.innerWidth - 320),
		height: rect && rect.height > 80 ? rect.height : Math.max(300, window.innerHeight - 96),
	};
}

function fitGraph(force = false): void {
	if (!projection) {
		return;
	}
	const saved = !force ? state.viewports[state.mode] : undefined;
	if (saved) {
		viewport = saved;
	} else {
		const { width, height } = getStageSize();
		viewport = fitRectToStage(projection.bounds, width, height);
	}
	applyViewportTransform();
	schedulePersistViewState();
}

function fitNode(nodeId: string): void {
	if (!projection) {
		return;
	}
	const target = projection.nodes.find(n => n.node.id === nodeId);
	if (!target) {
		return;
	}
	const { width, height } = getStageSize();
	viewport = fitRectToStage(
		{ minX: target.x, minY: target.y, maxX: target.x + target.width, maxY: target.y + target.height },
		width,
		height,
		96,
		1.15
	);
	applyViewportTransform();
	schedulePersistViewState();
}

function applyViewportTransform(): void {
	const world = root.querySelector<HTMLElement>('.cf-world');
	if (world) {
		world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
	}
	root.dataset.lod = computeLodLevel(viewport.zoom, projection?.visibleNodes ?? 0);
	const zoomReadout = root.querySelector<HTMLElement>('.cf-zoom-readout');
	if (zoomReadout) {
		zoomReadout.textContent = `${Math.round(viewport.zoom * 100)}%`;
	}
	updateGridPattern();
}

function updateGridPattern(): void {
	const pattern = root.querySelector<SVGPatternElement>('#cf-grid-pattern');
	if (!pattern) {
		return;
	}
	const step = adaptiveGridStep(viewport.zoom) * viewport.zoom;
	const offsetX = ((viewport.x % step) + step) % step;
	const offsetY = ((viewport.y % step) + step) % step;
	pattern.setAttribute('width', String(step));
	pattern.setAttribute('height', String(step));
	pattern.setAttribute('patternTransform', `translate(${offsetX} ${offsetY})`);
	const linePath = pattern.querySelector('path');
	if (linePath) {
		linePath.setAttribute('d', `M ${step} 0 L 0 0 0 ${step}`);
	}
}

function setMode(mode: CanvasViewMode): void {
	if (state.mode === mode) {
		return;
	}
	const updatedViewports = { ...state.viewports, [state.mode]: viewport };
	state = { ...state, mode, viewports: updatedViewports };
	rebuildProjection();
	render();
	fitGraph(false);
}

function setTheme(theme: CanvasTheme): void {
	state = { ...state, theme };
	root.dataset.theme = theme;
	schedulePersistViewState();
}

function setGrid(grid: CanvasGridMode): void {
	state = { ...state, grid };
	render();
	schedulePersistViewState();
}

function selectNode(nodeId: string | null, options?: { notifyExtension?: boolean; focusInCanvas?: boolean; additive?: boolean }): void {
	if (options?.additive && nodeId !== null) {
		if (selectedIds.has(nodeId)) {
			selectedIds.delete(nodeId);
		} else {
			selectedIds.add(nodeId);
		}
		const primary = selectedIds.size > 0 ? [...selectedIds].at(-1)! : null;
		const changed = state.selectedId !== primary;
		state = {
			...state,
			selectedId: primary,
			focusedWorkspaceOpen: primary !== null ? state.focusedWorkspaceOpen : false,
			inspectorOpen: selectedIds.size === 1,
		};
		if (changed && options.notifyExtension !== false) {
			post({ type: 'selectNode', nodeId: primary });
		}
		render();
		applyViewportTransform();
		schedulePersistViewState();
		return;
	}
	selectedIds.clear();
	if (nodeId !== null) {
		selectedIds.add(nodeId);
	}
	const changed = state.selectedId !== nodeId;
	state = {
		...state,
		selectedId: nodeId,
		focusedWorkspaceOpen: nodeId !== null ? state.focusedWorkspaceOpen : false,
		inspectorOpen: nodeId !== null,
	};
	if (changed && options?.notifyExtension !== false) {
		post({ type: 'selectNode', nodeId });
	}
	render();
	if (nodeId && options?.focusInCanvas) {
		fitNode(nodeId);
	} else {
		applyViewportTransform();
		schedulePersistViewState();
	}
}

function openFocusedWorkspace(nodeId: string): void {
	const node = nodeById(nodeId);
	if (node && node.kind.toLowerCase() === 'module') {
		openModuleDrillDown(nodeId);
		return;
	}
	lastFocusBeforeWorkspace = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	state = { ...state, selectedId: nodeId, focusedWorkspaceOpen: true };
	post({ type: 'selectNode', nodeId });
	if (node) {
		maybeRequestLiveSchema(node);
	}
	render();
	schedulePersistViewState();
	const backBtn = root.querySelector<HTMLButtonElement>('.cf-back-btn');
	backBtn?.focus();
}

function openModuleDrillDown(moduleNodeId: string): void {
	lastFocusBeforeModuleDrill = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	drilledModuleId = moduleNodeId;
	state = { ...state, selectedId: moduleNodeId, focusedWorkspaceOpen: false };
	post({ type: 'selectNode', nodeId: moduleNodeId });
	render();
	schedulePersistViewState();
	root.querySelector<HTMLButtonElement>('.cf-module-back-btn')?.focus();
}

function closeModuleDrillDown(): void {
	if (!drilledModuleId) {
		return;
	}
	const parentId = drilledModuleId;
	drilledModuleId = null;
	render();
	applyViewportTransform();
	schedulePersistViewState();
	if (lastFocusBeforeModuleDrill?.isConnected) {
		lastFocusBeforeModuleDrill.focus();
	} else {
		root.querySelector<HTMLElement>(`.cf-node[data-node-id="${CSS.escape(parentId)}"]`)?.focus();
	}
}

function insertStarterPatternById(patternId: string): void {
	if (!draftDoc) {
		return;
	}
	const instantiated = instantiateStarterPattern(
		patternId,
		draftDoc.present.nodes,
		draftDoc.baseSourceRevision,
		lookupEffectiveSchema,
		nextDraftNodeSeq
	);
	if (!instantiated) {
		return;
	}
	nextDraftNodeSeq += instantiated.nodes.length + 1;
	const firstId = instantiated.nodes[0]?.id ?? null;
	commitDraftEdit(
		{
			type: 'insertPattern',
			patternName: instantiated.template.name,
			nodes: instantiated.nodes,
			edges: instantiated.edges,
			drafts: instantiated.drafts,
		},
		{ selectId: firstId }
	);
	fitGraph(true);
}

function openExtractModuleModal(): void {
	if (selectedIds.size === 0) {
		return;
	}
	lastFocusBeforeExtractModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	extractModuleModalOpen = true;
	extractModuleTab = 'call';
	render();
	root.querySelector<HTMLButtonElement>('.cf-extract-close')?.focus();
}

function closeExtractModuleModal(): void {
	if (!extractModuleModalOpen) {
		return;
	}
	extractModuleModalOpen = false;
	render();
	applyViewportTransform();
	if (lastFocusBeforeExtractModal?.isConnected) {
		lastFocusBeforeExtractModal.focus();
	}
}

function openHistoryModal(tab: 'checkpoints' | 'experiments' | 'sample' = 'checkpoints'): void {
	if (!draftDoc) {
		return;
	}
	lastFocusBeforeHistoryModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	historyModalOpen = true;
	historyModalTab = tab;
	render();
	root.querySelector<HTMLButtonElement>('.cf-history-close')?.focus();
}

function closeHistoryModal(): void {
	if (!historyModalOpen) {
		return;
	}
	historyModalOpen = false;
	render();
	applyViewportTransform();
	if (lastFocusBeforeHistoryModal?.isConnected) {
		lastFocusBeforeHistoryModal.focus();
	}
}

function closeFocusedWorkspace(): void {
	if (!state.focusedWorkspaceOpen) {
		return;
	}
	state = { ...state, focusedWorkspaceOpen: false };
	render();
	applyViewportTransform();
	schedulePersistViewState();
	if (lastFocusBeforeWorkspace?.isConnected) {
		lastFocusBeforeWorkspace.focus();
	} else if (state.selectedId) {
		const card = root.querySelector<HTMLElement>(`.cf-node[data-node-id="${CSS.escape(state.selectedId)}"]`);
		card?.focus();
	}
}

function toggleGroupCollapsed(groupId: string): void {
	const next = new Set(state.collapsedGroups);
	if (next.has(groupId)) {
		next.delete(groupId);
	} else {
		next.add(groupId);
	}
	state = { ...state, collapsedGroups: [...next] };
	rebuildProjection();
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function commitDraftEdit(edit: DraftEdit, options?: { readonly selectId?: string | null; readonly focusInCanvas?: boolean }): boolean {
	if (!draftDoc) {
		return false;
	}
	const next = applyDraftEdit(draftDoc, edit);
	if (next === draftDoc) {
		return false;
	}
	draftDoc = next;
	connectFeedback = undefined;
	resetSavePreviewState();
	if (options?.selectId !== undefined) {
		state = {
			...state,
			selectedId: options.selectId,
			inspectorOpen: options.selectId !== null ? true : state.inspectorOpen,
			focusedWorkspaceOpen: options.selectId !== null ? state.focusedWorkspaceOpen : false,
		};
	} else if (state.selectedId && !draftDoc.present.nodes.some(n => n.id === state.selectedId)) {
		state = { ...state, selectedId: null, focusedWorkspaceOpen: false };
	}
	rebuildProjection();
	render();
	if (options?.selectId && options.focusInCanvas) {
		fitNode(options.selectId);
	} else {
		applyViewportTransform();
		schedulePersistViewState();
	}
	return true;
}

function addNewResource(typeName: string, defaultName: string): void {
	if (!draftDoc) {
		return;
	}
	const name = uniqueResourceName(draftDoc.present.nodes, defaultName);
	const nodeId = `draft:${typeName}.${name}:${nextDraftNodeSeq++}`;
	const node: CanvasNodeSummary = {
		id: nodeId,
		kind: 'resource',
		resourceType: typeName,
		name,
		label: `${typeName}.${name}`,
		hasSource: false,
	};
	const schema = lookupEffectiveSchema(node);
	const initialDraft = schema ? createInitialDraft(node, schema, draftDoc.baseSourceRevision) : undefined;
	commitDraftEdit({ type: 'addResource', node, initialDraft }, { selectId: nodeId, focusInCanvas: true });
}

function duplicateSelectedResource(node: CanvasNodeSummary): void {
	if (!draftDoc) {
		return;
	}
	const newName = uniqueResourceName(draftDoc.present.nodes, `${node.name}_copy`);
	const newNodeId = `draft:${node.resourceType ?? node.kind}.${newName}:${nextDraftNodeSeq++}`;
	commitDraftEdit(
		{ type: 'duplicateResource', sourceNodeId: node.id, newNodeId, newName },
		{ selectId: newNodeId, focusInCanvas: true }
	);
}

function deleteSelectedResource(nodeId: string): void {
	commitDraftEdit({ type: 'deleteResource', nodeId }, { selectId: null });
}

function performUndo(): void {
	if (!draftDoc || draftDoc.past.length === 0) {
		return;
	}
	draftDoc = undoDraftEdit(draftDoc);
	connectFeedback = undefined;
	resetSavePreviewState();
	if (state.selectedId && !draftDoc.present.nodes.some(n => n.id === state.selectedId)) {
		state = { ...state, selectedId: null, focusedWorkspaceOpen: false };
	}
	rebuildProjection();
	render();
	applyViewportTransform();
}

function performRedo(): void {
	if (!draftDoc || draftDoc.future.length === 0) {
		return;
	}
	draftDoc = redoDraftEdit(draftDoc);
	connectFeedback = undefined;
	resetSavePreviewState();
	if (state.selectedId && !draftDoc.present.nodes.some(n => n.id === state.selectedId)) {
		state = { ...state, selectedId: null, focusedWorkspaceOpen: false };
	}
	rebuildProjection();
	render();
	applyViewportTransform();
}

function performRevertDraft(): void {
	if (!draftDoc) {
		return;
	}
	draftDoc = revertDraftDocument(draftDoc);
	connectFeedback = undefined;
	resetSavePreviewState();
	hclReviewOpen = false;
	if (state.selectedId && !draftDoc.present.nodes.some(n => n.id === state.selectedId)) {
		state = { ...state, selectedId: null, focusedWorkspaceOpen: false };
	}
	rebuildProjection();
	render();
	fitGraph(false);
}

function openHclReviewModal(): void {
	if (!draftDoc) {
		return;
	}
	lastFocusBeforeHclReview = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	hclReviewOpen = true;
	render();
	root.querySelector<HTMLButtonElement>('.cf-modal-close')?.focus();
}

function closeHclReviewModal(): void {
	if (!hclReviewOpen) {
		return;
	}
	hclReviewOpen = false;
	render();
	applyViewportTransform();
	if (lastFocusBeforeHclReview?.isConnected) {
		lastFocusBeforeHclReview.focus();
	}
}

function rebuildProjection(): void {
	const current = activeGraph();
	if (!current) {
		projection = undefined;
		return;
	}
	const pinnedNodeIds = new Set<string>(selectedIds);
	if (state.selectedId) {
		pinnedNodeIds.add(state.selectedId);
	}
	if (currentRun) {
		for (const [id, res] of Object.entries(currentRun.nodeResults)) {
			if (res.status === 'failed' || res.status === 'warning') {
				pinnedNodeIds.add(id);
			}
		}
	}
	projection = buildCanvasProjection(current, state.mode, searchQuery, new Set(state.collapsedGroups), {
		hiddenLayers: new Set(state.hiddenLayers),
		nodePositions: state.nodePositions[state.mode],
		expandedPaginatedGroups,
		pinnedNodeIds,
	});
}

function countHiddenFindings(): number {
	if (!currentRun || !projection) {
		return 0;
	}
	const visibleIds = new Set(projection.nodes.map(n => n.node.id));
	let hidden = 0;
	for (const [nodeId, res] of Object.entries(currentRun.nodeResults)) {
		if (!visibleIds.has(nodeId) && (res.status === 'failed' || res.status === 'warning' || res.findings.length > 0)) {
			hidden += Math.max(1, res.findings.length);
		}
	}
	return hidden;
}

function toggleLayerVisibility(layer: ArchitectureLayer): void {
	const next = new Set(state.hiddenLayers);
	if (next.has(layer)) {
		next.delete(layer);
	} else {
		next.add(layer);
	}
	state = { ...state, hiddenLayers: [...next] };
	rebuildProjection();
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function showAllLayers(): void {
	if (state.hiddenLayers.length === 0) {
		return;
	}
	state = { ...state, hiddenLayers: [] };
	rebuildProjection();
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function updateModeNodePositions(updates: Readonly<Record<string, CanvasPoint>>): void {
	const existing = state.nodePositions[state.mode] ?? {};
	state = {
		...state,
		nodePositions: {
			...state.nodePositions,
			[state.mode]: { ...existing, ...updates },
		},
	};
	rebuildProjection();
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function resetModeLayout(): void {
	const nextPositions = { ...state.nodePositions };
	delete nextPositions[state.mode];
	state = { ...state, nodePositions: nextPositions };
	rebuildProjection();
	render();
	fitGraph(true);
}

function addVisualFrame(targetNodes?: readonly PositionedNode[]): void {
	const nodes = targetNodes && targetNodes.length > 0
		? targetNodes
		: projection?.nodes.filter(n => selectedIds.has(n.node.id)) ?? [];
	const seq = nextPresentationSeq++;
	const id = `frame-${Date.now()}-${seq}`;
	const title = nodes.length > 0 ? `Section ${state.frames.length + 1}` : `Area ${state.frames.length + 1}`;
	const color = FRAME_COLORS[state.frames.length % FRAME_COLORS.length];
	const frame = nodes.length > 0
		? computeFrameForNodes(nodes, title, id, color)
		: {
			id,
			title,
			color,
			x: Math.round((projection?.bounds.minX ?? 48) + state.frames.length * 24),
			y: Math.round((projection?.bounds.minY ?? 48) + state.frames.length * 24),
			width: 360,
			height: 220,
		};
	state = { ...state, frames: [...state.frames, frame] };
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function addStickyAnnotation(): void {
	const seq = nextPresentationSeq++;
	const id = `note-${Date.now()}-${seq}`;
	const anchorX = projection ? Math.round(projection.bounds.maxX + 36) : 80;
	const anchorY = projection ? Math.round(projection.bounds.minY + state.annotations.length * 100) : 80;
	const note: CanvasAnnotation = {
		id,
		text: 'Architecture note…',
		color: NOTE_COLORS[state.annotations.length % NOTE_COLORS.length],
		x: anchorX,
		y: anchorY,
		width: 210,
	};
	state = { ...state, annotations: [...state.annotations, note] };
	render();
	applyViewportTransform();
	schedulePersistViewState();
}

function openExportModal(): void {
	const current = activeGraph();
	if (!current || !projection) {
		return;
	}
	lastFocusBeforeExport = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	exportModalOpen = true;
	exportStatusMessage = undefined;
	exportBusy = false;
	exportTheme = state.theme === 'light' ? 'light' : 'dark';
	if (exportScope === 'selection' && selectedIds.size === 0) {
		exportScope = 'architecture';
	}
	if (exportScope === 'frame' && !state.frames.some(f => f.id === exportFrameId)) {
		exportScope = state.frames.length > 0 ? 'frame' : 'architecture';
		exportFrameId = state.frames[0]?.id;
	}
	render();
	root.querySelector<HTMLButtonElement>('.cf-export-close')?.focus();
}

function closeExportModal(): void {
	if (!exportModalOpen) {
		return;
	}
	exportModalOpen = false;
	exportBusy = false;
	render();
	applyViewportTransform();
	if (lastFocusBeforeExport?.isConnected) {
		lastFocusBeforeExport.focus();
	}
}

function buildExportOptions(): DiagramExportOptions {
	return {
		scope: exportScope,
		frameId: exportScope === 'frame' ? exportFrameId : undefined,
		selectedIds: exportScope === 'selection' ? [...selectedIds] : undefined,
		theme: exportTheme,
		mode: state.mode,
		includeValidation: exportIncludeValidation,
		includeAnnotations: exportIncludeAnnotations,
		includeProvenance: exportIncludeProvenance,
		frames: state.frames,
		annotations: state.annotations,
		hiddenLayers: state.hiddenLayers,
		validationRun: currentRun,
		dependencyReport,
	};
}

function sanitizeExportBaseName(name: string): string {
	const cleaned = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return cleaned || 'cloudforge-architecture';
}

function renderSvgToPngBase64(svgText: string, width: number, height: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const scale = 2;
		const canvas = document.createElement('canvas');
		canvas.width = Math.min(4096, Math.max(1, Math.round(width * scale)));
		canvas.height = Math.min(4096, Math.max(1, Math.round(height * scale)));
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			reject(new Error('Canvas 2D context unavailable'));
			return;
		}
		const img = new Image();
		img.onload = () => {
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			try {
				const dataUrl = canvas.toDataURL('image/png');
				const idx = dataUrl.indexOf(',');
				if (idx < 0) {
					reject(new Error('PNG serialization failed'));
					return;
				}
				resolve(dataUrl.slice(idx + 1));
			} catch (err) {
				reject(err);
			}
		};
		img.onerror = () => reject(new Error('Could not rasterize SVG'));
		const utf8Bytes = new TextEncoder().encode(svgText);
		let binary = '';
		for (let i = 0; i < utf8Bytes.length; i++) {
			binary += String.fromCharCode(utf8Bytes[i]);
		}
		img.src = `data:image/svg+xml;base64,${btoa(binary)}`;
	});
}

async function triggerExportSave(): Promise<void> {
	const current = activeGraph();
	if (!current || !projection || exportBusy) {
		return;
	}
	exportBusy = true;
	exportStatusMessage = undefined;
	render();
	const opts = buildExportOptions();
	const base = `${sanitizeExportBaseName(current.architectureName)}-${current.sourceRevision.slice(0, 8)}`;
	try {
		if (exportFormat === 'markdown') {
			const md = renderArchitectureMarkdownReport(current, projection, opts);
			post({
				type: 'exportArtifact',
				format: 'markdown',
				suggestedFileName: `${base}.md`,
				content: md,
				encoding: 'utf8',
			});
			return;
		}
		const rendered = renderArchitectureSvg(current, projection, opts);
		if (exportFormat === 'svg') {
			post({
				type: 'exportArtifact',
				format: 'svg',
				suggestedFileName: `${base}.svg`,
				content: rendered.svg,
				encoding: 'utf8',
			});
			return;
		}
		const pngBase64 = await renderSvgToPngBase64(rendered.svg, rendered.width, rendered.height);
		post({
			type: 'exportArtifact',
			format: 'png',
			suggestedFileName: `${base}.png`,
			content: pngBase64,
			encoding: 'base64',
		});
	} catch {
		exportBusy = false;
		exportStatusMessage = { ok: false, text: 'Could not generate PNG image in this environment. Try SVG or Markdown export.' };
		render();
	}
}

function nodeById(id: string | null): CanvasNodeSummary | undefined {
	const current = activeGraph();
	if (!current || !id) {
		return undefined;
	}
	return current.nodes.find(node => node.id === id);
}

function relatedEdges(nodeId: string): { upstream: { node: CanvasNodeSummary; kind: string }[]; downstream: { node: CanvasNodeSummary; kind: string }[] } {
	const current = activeGraph();
	if (!current) {
		return { upstream: [], downstream: [] };
	}
	const map = new Map(current.nodes.map(n => [n.id, n]));
	const upstream: { node: CanvasNodeSummary; kind: string }[] = [];
	const downstream: { node: CanvasNodeSummary; kind: string }[] = [];
	for (const edge of current.edges) {
		if (edge.toId === nodeId) {
			const src = map.get(edge.fromId);
			if (src) {
				upstream.push({ node: src, kind: edge.kind });
			}
		} else if (edge.fromId === nodeId) {
			const dst = map.get(edge.toId);
			if (dst) {
				downstream.push({ node: dst, kind: edge.kind });
			}
		}
	}
	return { upstream, downstream };
}

function statusLabel(status: RunnerNodeStatus): { readonly icon: string; readonly text: string } {
	switch (status) {
		case 'pending': return { icon: '\u25cb', text: 'Pending' };
		case 'running': return { icon: '\u25cf', text: 'Running' };
		case 'success': return { icon: '\u2713', text: 'Passed' };
		case 'warning': return { icon: '!', text: 'Warning' };
		case 'failed': return { icon: '\u2717', text: 'Failed' };
		case 'skipped': return { icon: '\u2298', text: 'Skipped' };
	}
}

function startValidation(scope: 'architecture' | 'resource', nodeId?: string, localOnly = false): void {
	const current = activeGraph();
	if (!current) {
		return;
	}
	const summary = draftDoc ? computeDraftChangeSummary(draftDoc) : undefined;
	if (!localOnly && !summary?.dirty) {
		validationInFlight = true;
		timelineOpen = true;
		if (scope === 'resource') {
			workspaceResultsTab = 'findings';
		}
		post({ type: 'requestValidation', scope, ...(nodeId ? { nodeId } : {}) });
		render();
		applyViewportTransform();
		return;
	}
	validationInFlight = false;
	const previousRun = currentRun && currentRun.architectureId === current.architectureId ? currentRun : undefined;
	currentRun = runOfflineValidation(current, {
		scope,
		targetNodeId: nodeId,
		drafts: draftsAsMap(),
		lookupSchema: lookupEffectiveSchema,
		renderDraft: renderDraftPreview,
		previousRun,
	});
	timelineOpen = true;
	if (scope === 'resource') {
		workspaceResultsTab = 'findings';
	}
	render();
	applyViewportTransform();
}

function cancelActiveRun(): void {
	if (validationInFlight) {
		validationInFlight = false;
		post({ type: 'cancelValidation' });
	}
	if (!currentRun) {
		render();
		applyViewportTransform();
		return;
	}
	currentRun = cancelValidationRun(currentRun);
	render();
	applyViewportTransform();
}

type ResourceGlyphCategory = 'network' | 'security' | 'compute' | 'storage' | 'module' | 'resource';

function glyphCategoryFor(resourceType: string | null, kind: string): ResourceGlyphCategory {
	if (kind.toLowerCase() === 'module') {
		return 'module';
	}
	const type = (resourceType ?? '').toLowerCase();
	if (/(security_group|key_vault|kms|iam|role|policy|secret|identity|rbac|cert)/.test(type)) {
		return 'security';
	}
	if (/(network|vnet|subnet|route|firewall|gateway|vpc|public_ip|lb|load_balancer|dns|nat|peering)/.test(type)) {
		return 'network';
	}
	if (/(kubernetes|aks|eks|gke|cluster|vm|virtual_machine|instance|compute|app_service|function|lambda|container|ecs)/.test(type)) {
		return 'compute';
	}
	if (/(storage|bucket|s3|blob|disk|file|sql|database|db|postgres|mysql|cosmos|dynamo|rds|redis)/.test(type)) {
		return 'storage';
	}
	return 'resource';
}

function createGlyphSvg(category: ResourceGlyphCategory): SVGSVGElement {
	const svg = svgEl('svg', {
		class: 'cf-glyph-svg',
		viewBox: '0 0 16 16',
		width: 15,
		height: 15,
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 1.5,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true',
	});
	switch (category) {
		case 'network':
			svg.append(
				svgEl('circle', { cx: 3.5, cy: 8, r: 2 }),
				svgEl('circle', { cx: 12.5, cy: 3.5, r: 2 }),
				svgEl('circle', { cx: 12.5, cy: 12.5, r: 2 }),
				svgEl('path', { d: 'M 5.3 7.1 L 10.7 4.4 M 5.3 8.9 L 10.7 11.6' })
			);
			break;
		case 'security':
			svg.append(
				svgEl('path', { d: 'M 8 1.8 L 13 3.8 V 7.8 C 13 11.1 10.8 13.4 8 14.3 C 5.2 13.4 3 11.1 3 7.8 V 3.8 Z' }),
				svgEl('path', { d: 'M 6 8 L 7.4 9.4 L 10.3 6.5' })
			);
			break;
		case 'compute':
			svg.append(
				svgEl('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5 }),
				svgEl('path', { d: 'M 6 1.8 V 4 M 10 1.8 V 4 M 6 12 V 14.2 M 10 12 V 14.2 M 1.8 6 H 4 M 1.8 10 H 4 M 12 6 H 14.2 M 12 10 H 14.2' })
			);
			break;
		case 'storage':
			svg.append(
				svgEl('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2 }),
				svgEl('path', { d: 'M 3 4 V 12 C 3 13.1 5.2 14 8 14 C 10.8 14 13 13.1 13 12 V 4' }),
				svgEl('path', { d: 'M 3 8 C 3 9.1 5.2 10 8 10 C 10.8 10 13 9.1 13 8' })
			);
			break;
		case 'module':
			svg.append(
				svgEl('path', { d: 'M 8 1.8 L 13.5 4.8 V 11.2 L 8 14.2 L 2.5 11.2 V 4.8 Z' }),
				svgEl('path', { d: 'M 8 8 L 13.5 4.8 M 8 8 L 2.5 4.8 M 8 8 V 14.2' })
			);
			break;
		case 'resource':
			svg.append(
				svgEl('rect', { x: 2.2, y: 2.5, width: 11.6, height: 11, rx: 2 }),
				svgEl('path', { d: 'M 2.2 6.2 H 13.8' })
			);
			break;
	}
	return svg;
}

function renderHeader(): HTMLElement {
	const current = activeGraph();
	const summary = draftDoc ? computeDraftChangeSummary(draftDoc) : undefined;
	const hasHistory = !!draftDoc && (draftDoc.past.length > 0 || draftDoc.future.length > 0 || !!summary?.dirty);

	const header = el('header', 'cf-header');
	const left = el('div', 'cf-header-group cf-header-left');
	const title = el('h1', 'cf-title', current ? current.architectureName : 'CloudForge Canvas');
	left.append(title);

	if (current) {
		const countText = projection
			? projection.hiddenByFilterOrCollapse > 0
				? `${projection.visibleNodes} / ${projection.totalNodes} visible`
				: `${projection.totalNodes} resource${projection.totalNodes === 1 ? '' : 's'}`
			: '';
		if (summary?.dirty) {
			left.append(el(
				'span',
				'cf-pill cf-pill-warn',
				`Unsaved draft (+${summary.added.length} / ~${summary.modified.length} / -${summary.deleted.length})`
			));
		} else {
			const metaChip = el(
				'span',
				`cf-pill cf-mono ${current.status === 'partial' ? 'cf-pill-warn' : ''}`,
				`${countText ? `${countText} \u00b7 ` : ''}rev ${current.sourceRevision.slice(0, 8)}`
			);
			metaChip.title = current.status === 'partial'
				? 'Partial static coverage — inspect Diagnostics for unresolved references'
				: 'Read-only Terraform architecture snapshot';
			left.append(metaChip);
		}
		if (validationInFlight) {
			const liveBtn = el('button', 'cf-pill cf-pill-btn cf-pill-warn', 'Validating (Rust)\u2026');
			liveBtn.type = 'button';
			liveBtn.addEventListener('click', () => {
				timelineOpen = !timelineOpen;
				render();
				applyViewportTransform();
			});
			left.append(liveBtn);
		} else if (currentRun) {
			const outcomeCls = currentRun.outcome === 'failed'
				? 'cf-pill-err'
				: currentRun.outcome === 'completed'
					? 'cf-pill-ok'
					: 'cf-pill-warn';
			const runLabel = currentRun.outcome === 'completed'
				? `\u2713 Validated`
				: currentRun.outcome === 'failed'
					? `\u2717 Failed`
					: `! ${currentRun.outcome.replace(/_/g, ' ')}`;
			const runPill = el('button', `cf-pill cf-pill-btn ${outcomeCls}`, `${runLabel}${currentRun.stale ? ' (stale)' : ''}`);
			runPill.type = 'button';
			runPill.title = `Run #${currentRun.attempt}: ${currentRun.coverage} coverage \u2014 click to toggle Runner Timeline`;
			runPill.addEventListener('click', () => {
				timelineOpen = !timelineOpen;
				render();
				applyViewportTransform();
			});
			left.append(runPill);
		}
		const hiddenFindings = countHiddenFindings();
		if (state.hiddenLayers.length > 0 || hiddenFindings > 0) {
			const hiddenLabel = hiddenFindings > 0
				? `! ${hiddenFindings} hidden finding${hiddenFindings === 1 ? '' : 's'}`
				: `${state.hiddenLayers.length} layer${state.hiddenLayers.length === 1 ? '' : 's'} hidden`;
			const hiddenBtn = el('button', `cf-pill cf-pill-btn ${hiddenFindings > 0 ? 'cf-pill-warn' : ''}`, hiddenLabel);
			hiddenBtn.type = 'button';
			hiddenBtn.title = 'Click to show all architectural layers';
			hiddenBtn.addEventListener('click', () => showAllLayers());
			left.append(hiddenBtn);
		}
		if (activeExperiment) {
			const expPill = el('button', 'cf-pill cf-pill-btn cf-pill-warn', `Experiment: ${activeExperiment.name}`);
			expPill.type = 'button';
			expPill.title = 'Click to compare, promote, or discard this isolated local experiment';
			expPill.addEventListener('click', () => openHistoryModal('experiments'));
			left.append(expPill);
		}
		if (state.sampleContext) {
			const staleCtx = isSampleContextStale(state.sampleContext, current.sourceRevision);
			const samplePill = el('button', `cf-pill cf-pill-btn ${staleCtx ? 'cf-pill-warn' : ''}`, `Sample: ${state.sampleContext.environment}${staleCtx ? ' (stale)' : ''}`);
			samplePill.type = 'button';
			samplePill.title = `Sample validation context "${state.sampleContext.label}" (${state.sampleContext.region}) — click to manage`;
			samplePill.addEventListener('click', () => openHistoryModal('sample'));
			left.append(samplePill);
		}
	}
	header.append(left);

	const right = el('div', 'cf-header-group cf-header-right');

	// Two-mode switch: Visual Design | Technical Design
	const modeGroup = el('div', 'cf-segmented');
	modeGroup.setAttribute('role', 'group');
	modeGroup.setAttribute('aria-label', 'Architecture view mode');

	const visualBtn = el('button', 'cf-seg-btn', 'Visual Design');
	visualBtn.type = 'button';
	visualBtn.setAttribute('aria-pressed', String(state.mode === 'visual'));
	visualBtn.addEventListener('click', () => setMode('visual'));

	const techBtn = el('button', 'cf-seg-btn', 'Technical Design');
	techBtn.type = 'button';
	techBtn.setAttribute('aria-pressed', String(state.mode === 'technical'));
	techBtn.addEventListener('click', () => setMode('technical'));

	modeGroup.append(visualBtn, techBtn);
	right.append(modeGroup);

	// Contextual + Add Resource disclosure
	if (current) {
		const addDetails = el('details', 'cf-disclosure');
		const addSummary = el('summary', 'cf-btn', '+ Add');
		addSummary.title = 'Add a schema-backed Azure resource to the unsaved draft';
		addDetails.append(addSummary);
		const addMenu = el('div', 'cf-popover cf-popover-menu');
		addMenu.append(el('div', 'cf-menu-section-label', 'Azure Resources'));
		for (const item of ADDABLE_RESOURCE_TYPES) {
			const btn = el('button', 'cf-menu-item cf-menu-item-icon');
			btn.type = 'button';
			const iconWrap = el('span', 'cf-menu-glyph cf-provider-azure');
			iconWrap.append(createGlyphSvg(glyphCategoryFor(item.typeName, 'resource')));
			const textWrap = el('span', 'cf-menu-text');
			textWrap.append(
				el('span', 'cf-dep-name', item.shortLabel),
				el('span', 'cf-dep-meta cf-mono', item.typeName)
			);
			btn.append(iconWrap, textWrap);
			btn.addEventListener('click', () => {
				addDetails.open = false;
				addNewResource(item.typeName, item.defaultName);
			});
			addMenu.append(btn);
		}
		addMenu.append(el('div', 'cf-popover-divider'), el('div', 'cf-menu-section-label', 'Starter Patterns'));
		for (const pattern of STARTER_PATTERNS) {
			const btn = el('button', 'cf-menu-item cf-menu-item-icon');
			btn.type = 'button';
			const iconWrap = el('span', 'cf-menu-glyph cf-provider-module');
			iconWrap.append(createGlyphSvg('module'));
			const textWrap = el('span', 'cf-menu-text');
			textWrap.append(
				el('span', 'cf-dep-name', `${pattern.name} (${pattern.resourceCount})`),
				el('span', 'cf-dep-meta', `v${pattern.version} · atomic undoable pattern`)
			);
			btn.append(iconWrap, textWrap);
			btn.title = pattern.description;
			btn.addEventListener('click', () => {
				addDetails.open = false;
				insertStarterPatternById(pattern.id);
			});
			addMenu.append(btn);
		}
		addDetails.append(addMenu);
		addDetails.addEventListener('keydown', event => {
			if (event.key === 'Escape' && addDetails.open) {
				event.preventDefault();
				addDetails.open = false;
				addSummary.focus();
			}
		});
		right.append(addDetails);
	}

	// Contextual authoring controls: only shown when the user has unsaved draft history or changes
	if (hasHistory && draftDoc) {
		const undoBtn = el('button', 'cf-btn', 'Undo');
		undoBtn.type = 'button';
		undoBtn.disabled = draftDoc.past.length === 0;
		undoBtn.title = draftDoc.past.length > 0 ? `Undo: ${draftDoc.past.at(-1)!.reason} (Ctrl+Z)` : 'Nothing to undo';
		undoBtn.addEventListener('click', () => performUndo());

		const redoBtn = el('button', 'cf-btn', 'Redo');
		redoBtn.type = 'button';
		redoBtn.disabled = draftDoc.future.length === 0;
		redoBtn.title = draftDoc.future.length > 0 ? `Redo: ${draftDoc.future[0].reason} (Ctrl+Shift+Z)` : 'Nothing to redo';
		redoBtn.addEventListener('click', () => performRedo());

		right.append(undoBtn, redoBtn);

		if (summary?.dirty) {
			const reviewBtn = el('button', 'cf-btn cf-btn-primary', 'Review HCL');
			reviewBtn.type = 'button';
			reviewBtn.title = 'Review generated Terraform HCL and preview or apply a guarded save';
			reviewBtn.addEventListener('click', () => openHclReviewModal());

			const revertBtn = el('button', 'cf-btn cf-btn-danger', 'Revert Draft');
			revertBtn.type = 'button';
			revertBtn.title = 'Discard all unsaved draft edits and restore read-only Terraform baseline';
			revertBtn.addEventListener('click', () => performRevertDraft());

			right.append(reviewBtn, revertBtn);
		}
	}

	const listBtn = el('button', 'cf-btn', 'List');
	listBtn.type = 'button';
	listBtn.setAttribute('aria-pressed', String(state.listOpen));
	listBtn.title = 'Toggle resource list (/)';
	listBtn.addEventListener('click', () => {
		state = { ...state, listOpen: !state.listOpen };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	const inspBtn = el('button', 'cf-btn', 'Inspector');
	inspBtn.type = 'button';
	inspBtn.setAttribute('aria-pressed', String(state.inspectorOpen));
	inspBtn.title = 'Toggle resource inspector';
	inspBtn.addEventListener('click', () => {
		state = { ...state, inspectorOpen: !state.inspectorOpen };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	// View options disclosure (Theme, Grid, Timeline, Fit, Refresh)
	const viewDetails = el('details', 'cf-disclosure');
	const viewSummary = el('summary', 'cf-btn', 'View');
	viewDetails.append(viewSummary);
	const viewMenu = el('div', 'cf-popover');

	const themeLabel = el('label', 'cf-field-row');
	themeLabel.append(el('span', undefined, 'Canvas theme'));
	const themeSelect = el('select', 'cf-select');
	themeSelect.setAttribute('aria-label', 'Canvas theme');
	for (const [val, label] of [['workbench', 'Workbench'], ['light', 'Light'], ['dark', 'Dark']] as const) {
		const opt = el('option', undefined, label);
		opt.value = val;
		opt.selected = state.theme === val;
		themeSelect.append(opt);
	}
	themeSelect.addEventListener('change', () => setTheme(themeSelect.value as CanvasTheme));
	themeLabel.append(themeSelect);

	const gridLabel = el('label', 'cf-field-row');
	gridLabel.append(el('span', undefined, 'Grid'));
	const gridSelect = el('select', 'cf-select');
	gridSelect.setAttribute('aria-label', 'Canvas grid');
	for (const [val, label] of [['lines', 'Lines'], ['dots', 'Dots'], ['none', 'None']] as const) {
		const opt = el('option', undefined, label);
		opt.value = val;
		opt.selected = state.grid === val;
		gridSelect.append(opt);
	}
	gridSelect.addEventListener('change', () => setGrid(gridSelect.value as CanvasGridMode));
	gridLabel.append(gridSelect);

	const snapRow = el('label', 'cf-field-row cf-check-row');
	snapRow.append(el('span', undefined, 'Snap to grid'));
	const snapCb = el('input');
	snapCb.type = 'checkbox';
	snapCb.checked = state.snapToGrid;
	snapCb.setAttribute('aria-label', 'Snap to grid');
	snapCb.addEventListener('change', () => {
		state = { ...state, snapToGrid: snapCb.checked };
		schedulePersistViewState();
	});
	snapRow.append(snapCb);

	const layersSection = el('div', 'cf-layers-section');
	const layersHead = el('div', 'cf-layers-head');
	layersHead.append(el('span', 'cf-layers-title', 'Layers'));
	if (state.hiddenLayers.length > 0) {
		const showAllBtn = el('button', 'cf-link-btn', 'Show all');
		showAllBtn.type = 'button';
		showAllBtn.addEventListener('click', () => showAllLayers());
		layersHead.append(showAllBtn);
	}
	layersSection.append(layersHead);
	const layersList = el('div', 'cf-layers-grid');
	for (const layer of ARCHITECTURE_LAYERS) {
		const visible = !state.hiddenLayers.includes(layer);
		const count = projection?.layerCounts[layer] ?? 0;
		const chip = el('button', `cf-layer-chip${visible ? ' active' : ''}`, `${layerDisplayName(layer)} (${count})`);
		chip.type = 'button';
		chip.setAttribute('aria-pressed', String(visible));
		chip.addEventListener('click', () => toggleLayerVisibility(layer));
		layersList.append(chip);
	}
	layersSection.append(layersList);

	const menuDivider = el('div', 'cf-popover-divider');
	const menuActions = el('div', 'cf-popover-actions');

	if (current) {
		const addFrameBtn = el('button', 'cf-btn', '+ Add Visual Frame');
		addFrameBtn.type = 'button';
		addFrameBtn.addEventListener('click', () => {
			viewDetails.open = false;
			addVisualFrame();
		});
		const addNoteBtn = el('button', 'cf-btn', '+ Add Sticky Note');
		addNoteBtn.type = 'button';
		addNoteBtn.addEventListener('click', () => {
			viewDetails.open = false;
			addStickyAnnotation();
		});
		const exportMenuBtn = el('button', 'cf-btn cf-btn-primary', 'Export Diagram / Report\u2026');
		exportMenuBtn.type = 'button';
		exportMenuBtn.addEventListener('click', () => {
			viewDetails.open = false;
			openExportModal();
		});
		const historyMenuBtn = el('button', 'cf-btn', `History & Experiments\u2026${state.checkpoints.length > 0 ? ` (${state.checkpoints.length})` : ''}`);
		historyMenuBtn.type = 'button';
		historyMenuBtn.title = 'Named checkpoints, semantic compare, experiments, and sample validation context (Ctrl+Shift+H)';
		historyMenuBtn.addEventListener('click', () => {
			viewDetails.open = false;
			openHistoryModal('checkpoints');
		});
		menuActions.append(addFrameBtn, addNoteBtn, historyMenuBtn, exportMenuBtn);

		const hasCustomPositions = Object.keys(state.nodePositions[state.mode] ?? {}).length > 0;
		if (hasCustomPositions) {
			const resetLayoutBtn = el('button', 'cf-btn', 'Reset Auto-Layout');
			resetLayoutBtn.type = 'button';
			resetLayoutBtn.addEventListener('click', () => {
				viewDetails.open = false;
				resetModeLayout();
			});
			menuActions.append(resetLayoutBtn);
		}
	}

	const timelineMenuBtn = el('button', 'cf-btn', timelineOpen ? 'Hide Timeline' : 'Show Timeline');
	timelineMenuBtn.type = 'button';
	timelineMenuBtn.addEventListener('click', () => {
		viewDetails.open = false;
		timelineOpen = !timelineOpen;
		render();
		applyViewportTransform();
	});

	const fitMenuBtn = el('button', 'cf-btn', 'Fit Graph');
	fitMenuBtn.type = 'button';
	fitMenuBtn.addEventListener('click', () => {
		viewDetails.open = false;
		fitGraph(true);
	});

	const refreshMenuBtn = el('button', 'cf-btn', 'Refresh');
	refreshMenuBtn.type = 'button';
	refreshMenuBtn.title = 'Re-read architecture from CloudForge service';
	refreshMenuBtn.addEventListener('click', () => {
		viewDetails.open = false;
		post({ type: 'refresh' });
	});

	menuActions.append(timelineMenuBtn, fitMenuBtn, refreshMenuBtn);
	viewMenu.append(themeLabel, gridLabel, snapRow, el('div', 'cf-popover-divider'), layersSection, menuDivider, menuActions);
	if (catalogueSnapshots.length > 0) {
		viewMenu.append(el('div', 'cf-field-help', `${catalogueSnapshots.length} verified provider catalogue${catalogueSnapshots.length === 1 ? '' : 's'} active`));
	}
	viewDetails.append(viewMenu);
	viewDetails.addEventListener('keydown', event => {
		if (event.key === 'Escape' && viewDetails.open) {
			event.preventDefault();
			viewDetails.open = false;
			viewSummary.focus();
		}
	});

	const validateBtn = el('button', summary?.dirty ? 'cf-btn' : 'cf-btn cf-btn-primary', currentRun ? 'Revalidate' : 'Validate');
	validateBtn.type = 'button';
	validateBtn.disabled = !current;
	validateBtn.title = 'Run offline architecture validation (read, dependencies, static & schema checks)';
	validateBtn.addEventListener('click', () => startValidation('architecture'));

	right.append(listBtn, inspBtn, viewDetails, validateBtn);
	header.append(right);
	return header;
}

function renderNoticeBanner(): HTMLElement | null {
	const current = activeGraph();
	if (notice) {
		const banner = el('div', `cf-banner cf-banner-${notice.kind}`);
		banner.setAttribute('role', 'alert');
		banner.append(el('span', undefined, notice.message));
		const refreshBtn = el('button', 'cf-btn cf-btn-primary', 'Refresh Graph');
		refreshBtn.type = 'button';
		refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));
		banner.append(refreshBtn);
		return banner;
	}
	if (current && current.status === 'partial') {
		const banner = el('div', 'cf-banner cf-banner-info');
		banner.setAttribute('role', 'status');
		banner.append(el('span', undefined, 'Partial graph coverage: some Terraform declarations or references could not be statically resolved. Check Diagnostics in the inspector.'));
		return banner;
	}
	return null;
}

function renderResourceList(): HTMLElement {
	const aside = el('aside', 'cf-list-pane');
	aside.setAttribute('aria-label', 'Architecture resource list');

	const searchWrap = el('div', 'cf-search-wrap');
	const input = el('input', 'cf-search');
	input.type = 'search';
	input.placeholder = 'Filter resources… (/)';
	input.setAttribute('aria-label', 'Filter resources');
	input.value = searchQuery;
	input.addEventListener('input', () => {
		searchQuery = input.value;
		rebuildProjection();
		render();
		applyViewportTransform();
		const restored = root.querySelector<HTMLInputElement>('.cf-search');
		if (restored) {
			restored.focus();
			restored.setSelectionRange(searchQuery.length, searchQuery.length);
		}
	});
	searchWrap.append(input);
	aside.append(searchWrap);

	const list = el('div', 'cf-list-scroll');
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', 'Resources');

	if (projection && projection.nodes.length > 0) {
		for (const item of projection.nodes) {
			const row = el('button', `cf-list-row${item.node.id === state.selectedId ? ' selected' : ''}`);
			row.type = 'button';
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', String(item.node.id === state.selectedId));
			const nameEl = el('span', 'cf-list-name', item.node.name);
			const metaEl = el('span', 'cf-list-type cf-mono', item.node.resourceType ?? item.node.kind);
			row.append(nameEl, metaEl);
			row.addEventListener('click', () => selectNode(item.node.id, { focusInCanvas: true }));
			row.addEventListener('dblclick', () => openFocusedWorkspace(item.node.id));
			list.append(row);
		}
	} else {
		list.append(el('p', 'cf-empty-note', searchQuery ? 'No matching resources.' : 'No visible resources.'));
	}
	aside.append(list);
	return aside;
}

function renderStage(): HTMLElement {
	const stage = el('main', 'cf-stage');
	stage.setAttribute('aria-label', state.mode === 'visual' ? 'Visual Design canvas' : 'Technical Design canvas');
	stage.tabIndex = 0;

	// Background grid SVG
	if (state.grid !== 'none') {
		const gridSvg = svgEl('svg', { class: 'cf-grid-svg', 'aria-hidden': 'true' });
		const defs = svgEl('defs', {});
		const pattern = svgEl('pattern', { id: 'cf-grid-pattern', width: 80, height: 80, patternUnits: 'userSpaceOnUse' });
		if (state.grid === 'lines') {
			pattern.append(svgEl('path', { d: 'M 80 0 L 0 0 0 80', fill: 'none', class: 'cf-grid-stroke' }));
		} else {
			pattern.append(svgEl('circle', { cx: 2, cy: 2, r: 1.25, class: 'cf-grid-dot' }));
		}
		defs.append(pattern);
		gridSvg.append(defs);
		gridSvg.append(svgEl('rect', { width: '100%', height: '100%', fill: 'url(#cf-grid-pattern)' }));
		stage.append(gridSvg);
	}

	const world = el('div', 'cf-world');
	if (projection) {
		// Persisted visual frames / sections (presentation metadata only)
		for (const frame of state.frames) {
			world.append(renderVisualFrame(frame));
		}

		// Groups layer
		for (const group of projection.groups) {
			const box = el('section', `cf-group cf-provider-${group.provider}${group.collapsed ? ' collapsed' : ''}`);
			box.style.left = `${group.x}px`;
			box.style.top = `${group.y}px`;
			box.style.width = `${group.width}px`;
			box.style.height = `${group.height}px`;

			const head = el('button', 'cf-group-header');
			head.type = 'button';
			head.setAttribute('aria-expanded', String(!group.collapsed));
			head.append(
				el('span', 'cf-group-caret', group.collapsed ? '\u25b8' : '\u25be'),
				el('span', 'cf-group-label', group.label),
				el('span', 'cf-group-count', group.paginatedHiddenCount > 0 ? `${group.visibleCount}/${group.totalCount}` : `${group.visibleCount}`)
			);
			head.addEventListener('click', event => {
				event.stopPropagation();
				toggleGroupCollapsed(group.id);
			});
			box.append(head);
			if (!group.collapsed && group.paginatedHiddenCount > 0) {
				const expandBtn = el('button', 'cf-group-expand-btn', `+ Show ${group.paginatedHiddenCount} more`);
				expandBtn.type = 'button';
				expandBtn.addEventListener('click', event => {
					event.stopPropagation();
					expandedPaginatedGroups.add(group.id);
					rebuildProjection();
					render();
					applyViewportTransform();
				});
				box.append(expandBtn);
			}
			world.append(box);
		}

		// Edges SVG layer
		const maxW = Math.max(1200, projection.bounds.maxX + 200);
		const maxH = Math.max(800, projection.bounds.maxY + 200);
		const edgesSvg = svgEl('svg', { class: 'cf-edges-svg', width: maxW, height: maxH, viewBox: `0 0 ${maxW} ${maxH}` });
		const defs = svgEl('defs', {});
		const marker = svgEl('marker', { id: 'cf-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
		marker.append(svgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', class: 'cf-arrow-fill' }));
		defs.append(marker);
		edgesSvg.append(defs);

		for (const edge of projection.edges) {
			let d: string;
			if (edge.orientation === 'vertical') {
				const dy = Math.max(36, Math.abs(edge.toY - edge.fromY) * 0.45);
				const dir = edge.toY >= edge.fromY ? 1 : -1;
				d = `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${edge.fromY + dir * dy}, ${edge.toX} ${edge.toY - dir * dy}, ${edge.toX} ${edge.toY}`;
			} else {
				const dx = Math.max(40, Math.abs(edge.toX - edge.fromX) * 0.45);
				const dir = edge.toX >= edge.fromX ? 1 : -1;
				d = `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + dir * dx} ${edge.fromY}, ${edge.toX - dir * dx} ${edge.toY}, ${edge.toX} ${edge.toY}`;
			}
			const isRelated = state.selectedId !== null && (edge.fromId === state.selectedId || edge.toId === state.selectedId);
			const isDimmed = state.selectedId !== null && !isRelated;
			const fromRes = currentRun?.nodeResults[edge.fromId];
			const toRes = currentRun?.nodeResults[edge.toId];
			const isBlockedEdge = (fromRes?.status === 'failed' || toRes?.status === 'skipped' || (currentRun?.cycleNodeIds.includes(edge.fromId) && currentRun?.cycleNodeIds.includes(edge.toId)));
			const isPassedEdge = fromRes?.status === 'success' && toRes?.status === 'success';
			const cls = `cf-edge${edge.collapsedSummary ? ' summary' : ''}${isRelated ? ' active' : ''}${isDimmed ? ' dimmed' : ''}${isBlockedEdge ? ' edge-blocked' : isPassedEdge ? ' edge-passed' : ''}`;
			edgesSvg.append(svgEl('path', { d, class: cls, 'marker-end': 'url(#cf-arrow)' }));
		}
		world.append(edgesSvg);

		// Nodes layer
		for (const item of projection.nodes) {
			world.append(renderNodeCard(item));
		}

		// Sticky annotations layer (presentation metadata only)
		for (const note of state.annotations) {
			world.append(renderStickyNote(note));
		}

		// Magnetic alignment guides during drag
		if (activeGuideX !== undefined) {
			const gx = el('div', 'cf-guide-x');
			gx.style.left = `${activeGuideX}px`;
			world.append(gx);
		}
		if (activeGuideY !== undefined) {
			const gy = el('div', 'cf-guide-y');
			gy.style.top = `${activeGuideY}px`;
			world.append(gy);
		}
	}
	stage.append(world);

	// Contextual multi-selection alignment bar (only when 2+ nodes are selected)
	if (projection && selectedIds.size >= 2) {
		const multiNodes = projection.nodes.filter(n => selectedIds.has(n.node.id));
		if (multiNodes.length >= 2) {
			const bar = el('div', 'cf-multi-bar');
			bar.setAttribute('role', 'toolbar');
			bar.setAttribute('aria-label', 'Multi-selection alignment tools');
			bar.append(el('span', 'cf-multi-count', `${multiNodes.length} selected`));

			for (const [kind, label] of [
				['left', 'Align Left'],
				['top', 'Align Top'],
				['centerY', 'Center Y'],
				['distributeH', 'Distribute'],
			] as const) {
				const btn = el('button', 'cf-icon-btn', label);
				btn.type = 'button';
				btn.addEventListener('click', event => {
					event.stopPropagation();
					updateModeNodePositions(alignPositionedNodes(multiNodes, kind));
				});
				bar.append(btn);
			}

			const frameBtn = el('button', 'cf-icon-btn', 'Wrap Frame');
			frameBtn.type = 'button';
			frameBtn.addEventListener('click', event => {
				event.stopPropagation();
				addVisualFrame(multiNodes);
			});
			bar.append(frameBtn);

			const extractBtn = el('button', 'cf-icon-btn', 'Extract Module');
			extractBtn.type = 'button';
			extractBtn.title = 'Preview Terraform module refactoring and state moved {} blocks';
			extractBtn.addEventListener('click', event => {
				event.stopPropagation();
				openExtractModuleModal();
			});
			bar.append(extractBtn);

			const clearBtn = el('button', 'cf-icon-btn', 'Clear');
			clearBtn.type = 'button';
			clearBtn.addEventListener('click', event => {
				event.stopPropagation();
				selectNode(null);
			});
			bar.append(clearBtn);
			stage.append(bar);
		}
	}

	// Empty architecture welcome card (e.g. brand-new starter architecture)
	if (projection && projection.totalNodes === 0) {
		const emptyCard = el('div', 'cf-canvas-empty-card');
		emptyCard.append(
			createGlyphSvg('module'),
			el('h2', 'cf-section-title', 'Empty architecture'),
			el('p', 'cf-muted', 'Start from a curated Azure pattern in one click or use + Add in the top bar, then review and save Terraform HCL.')
		);
		const starterRow = el('div', 'cf-action-row');
		for (const pattern of STARTER_PATTERNS) {
			const btn = el('button', 'cf-btn cf-btn-primary', `+ ${pattern.name}`);
			btn.type = 'button';
			btn.title = pattern.description;
			btn.addEventListener('click', () => insertStarterPatternById(pattern.id));
			starterRow.append(btn);
		}
		emptyCard.append(starterRow);
		stage.append(emptyCard);
	}

	// Bottom-left floating keyboard shortcuts disclosure
	const helpDetails = el('details', 'cf-shortcuts-bar');
	const helpSummary = el('summary', 'cf-icon-btn', '?');
	helpSummary.title = 'Keyboard shortcuts';
	helpSummary.setAttribute('aria-label', 'Keyboard shortcuts');
	helpDetails.append(helpSummary);
	const helpPop = el('div', 'cf-shortcuts-popover');
	for (const [k, desc] of [
		['/', 'Filter resources'],
		['F', 'Fit graph or selection'],
		['Enter', 'Open focused workspace'],
		['O', 'Open Terraform source'],
		['Shift+Click', 'Multi-select & align'],
		['Ctrl+Shift+H', 'History & Experiments'],
		['Ctrl+Shift+E', 'Export SVG / PNG / MD'],
		['Ctrl+Z', 'Undo / Shift+Z Redo'],
		['Esc', 'Close overlay'],
	] as const) {
		const row = el('div', 'cf-shortcut-row');
		row.append(el('kbd', 'cf-kbd cf-mono', k), el('span', undefined, desc));
		helpPop.append(row);
	}
	helpDetails.append(helpPop);
	helpDetails.addEventListener('keydown', event => {
		if (event.key === 'Escape' && helpDetails.open) {
			event.preventDefault();
			helpDetails.open = false;
			helpSummary.focus();
		}
	});
	stage.append(helpDetails);

	// Bottom-right floating zoom controls
	const controls = el('div', 'cf-zoom-bar');
	controls.setAttribute('role', 'group');
	controls.setAttribute('aria-label', 'Zoom controls');
	const zoomOut = el('button', 'cf-icon-btn', '\u2212');
	zoomOut.type = 'button';
	zoomOut.title = 'Zoom out';
	zoomOut.addEventListener('click', () => zoomBy(0.85));
	const zoomReadout = el('span', 'cf-zoom-readout', `${Math.round(viewport.zoom * 100)}%`);
	const zoomIn = el('button', 'cf-icon-btn', '+');
	zoomIn.type = 'button';
	zoomIn.title = 'Zoom in';
	zoomIn.addEventListener('click', () => zoomBy(1.18));
	const fitAll = el('button', 'cf-icon-btn', 'Fit');
	fitAll.type = 'button';
	fitAll.title = 'Fit whole graph (F)';
	fitAll.addEventListener('click', () => fitGraph(true));
	controls.append(zoomOut, zoomReadout, zoomIn, fitAll);
	stage.append(controls);

	// Pointer pan & wheel zoom (plus node, frame, and sticky-note drag handling)
	stage.addEventListener('pointerdown', event => {
		if (event.button !== 0 || (event.target as HTMLElement).closest('.cf-node, .cf-group-header, .cf-frame, .cf-note, .cf-multi-bar, .cf-zoom-bar, .cf-shortcuts-bar')) {
			return;
		}
		stage.setPointerCapture(event.pointerId);
		dragging = { startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y };
		stage.classList.add('dragging');
	});
	stage.addEventListener('pointermove', event => {
		if (nodeDrag && projection) {
			const dx = (event.clientX - nodeDrag.startClientX) / viewport.zoom;
			const dy = (event.clientY - nodeDrag.startClientY) / viewport.zoom;
			if (!nodeDrag.moved && Math.hypot(event.clientX - nodeDrag.startClientX, event.clientY - nodeDrag.startClientY) < 4) {
				return;
			}
			nodeDrag.moved = true;
			let nextX = nodeDrag.originX + dx;
			let nextY = nodeDrag.originY + dy;
			if (state.snapToGrid) {
				nextX = snapCoordinate(nextX, 16);
				nextY = snapCoordinate(nextY, 16);
			}
			const peers = projection.nodes.filter(n => n.node.id !== nodeDrag!.nodeId);
			const snapped = computeSnapGuides({ x: nextX, y: nextY, width: nodeDrag.width, height: nodeDrag.height }, peers);
			activeGuideX = snapped.guideX;
			activeGuideY = snapped.guideY;
			const existing = state.nodePositions[state.mode] ?? {};
			state = {
				...state,
				nodePositions: {
					...state.nodePositions,
					[state.mode]: { ...existing, [nodeDrag.nodeId]: { x: Math.round(snapped.x), y: Math.round(snapped.y) } },
				},
			};
			rebuildProjection();
			render();
			applyViewportTransform();
			return;
		}
		if (frameDrag) {
			const dx = (event.clientX - frameDrag.startClientX) / viewport.zoom;
			const dy = (event.clientY - frameDrag.startClientY) / viewport.zoom;
			if (!frameDrag.moved && Math.hypot(event.clientX - frameDrag.startClientX, event.clientY - frameDrag.startClientY) < 4) {
				return;
			}
			frameDrag.moved = true;
			let nextX = frameDrag.originX + dx;
			let nextY = frameDrag.originY + dy;
			if (state.snapToGrid) {
				nextX = snapCoordinate(nextX, 16);
				nextY = snapCoordinate(nextY, 16);
			}
			const appliedDx = Math.round(nextX) - frameDrag.originX;
			const appliedDy = Math.round(nextY) - frameDrag.originY;
			const nextFrames = state.frames.map(f => f.id === frameDrag!.frameId ? { ...f, x: frameDrag!.originX + appliedDx, y: frameDrag!.originY + appliedDy } : f);
			const existing = { ...(state.nodePositions[state.mode] ?? {}) };
			for (const member of frameDrag.memberOrigins) {
				existing[member.id] = { x: member.x + appliedDx, y: member.y + appliedDy };
			}
			state = {
				...state,
				frames: nextFrames,
				nodePositions: frameDrag.memberOrigins.length > 0
					? { ...state.nodePositions, [state.mode]: existing }
					: state.nodePositions,
			};
			rebuildProjection();
			render();
			applyViewportTransform();
			return;
		}
		if (noteDrag) {
			const dx = (event.clientX - noteDrag.startClientX) / viewport.zoom;
			const dy = (event.clientY - noteDrag.startClientY) / viewport.zoom;
			if (!noteDrag.moved && Math.hypot(event.clientX - noteDrag.startClientX, event.clientY - noteDrag.startClientY) < 4) {
				return;
			}
			noteDrag.moved = true;
			let nextX = noteDrag.originX + dx;
			let nextY = noteDrag.originY + dy;
			if (state.snapToGrid) {
				nextX = snapCoordinate(nextX, 16);
				nextY = snapCoordinate(nextY, 16);
			}
			state = {
				...state,
				annotations: state.annotations.map(n => n.id === noteDrag!.noteId ? { ...n, x: Math.round(nextX), y: Math.round(nextY) } : n),
			};
			render();
			applyViewportTransform();
			return;
		}
		if (!dragging) {
			return;
		}
		viewport = {
			...viewport,
			x: dragging.originX + (event.clientX - dragging.startX),
			y: dragging.originY + (event.clientY - dragging.startY),
		};
		applyViewportTransform();
	});
	stage.addEventListener('pointerup', event => {
		if (nodeDrag) {
			const wasMoved = nodeDrag.moved;
			nodeDrag = undefined;
			activeGuideX = undefined;
			activeGuideY = undefined;
			if (wasMoved) {
				render();
				applyViewportTransform();
				schedulePersistViewState();
			}
			return;
		}
		if (frameDrag) {
			const wasMoved = frameDrag.moved;
			frameDrag = undefined;
			if (wasMoved) {
				schedulePersistViewState();
			}
			return;
		}
		if (noteDrag) {
			const wasMoved = noteDrag.moved;
			noteDrag = undefined;
			if (wasMoved) {
				schedulePersistViewState();
			}
			return;
		}
		if (!dragging) {
			return;
		}
		const moved = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
		dragging = undefined;
		stage.classList.remove('dragging');
		stage.releasePointerCapture(event.pointerId);
		if (moved < 4) {
			selectNode(null);
		} else {
			schedulePersistViewState();
		}
	});
	stage.addEventListener('wheel', event => {
		event.preventDefault();
		const factor = event.deltaY < 0 ? 1.1 : 0.91;
		const rect = stage.getBoundingClientRect();
		const px = event.clientX - rect.left;
		const py = event.clientY - rect.top;
		const nextZoom = Math.max(0.15, Math.min(3, viewport.zoom * factor));
		const ratio = nextZoom / viewport.zoom;
		viewport = {
			x: px - (px - viewport.x) * ratio,
			y: py - (py - viewport.y) * ratio,
			zoom: nextZoom,
		};
		applyViewportTransform();
		schedulePersistViewState();
	}, { passive: false });

	return stage;
}

function zoomBy(factor: number): void {
	const { width, height } = getStageSize();
	const cx = width / 2;
	const cy = height / 2;
	const nextZoom = Math.max(0.15, Math.min(3, viewport.zoom * factor));
	const ratio = nextZoom / viewport.zoom;
	viewport = {
		x: cx - (cx - viewport.x) * ratio,
		y: cy - (cy - viewport.y) * ratio,
		zoom: nextZoom,
	};
	applyViewportTransform();
	schedulePersistViewState();
}

function renderVisualFrame(frame: CanvasFrame): HTMLElement {
	const box = el('section', `cf-frame cf-frame-${frame.color}`);
	box.dataset.frameId = frame.id;
	box.style.left = `${frame.x}px`;
	box.style.top = `${frame.y}px`;
	box.style.width = `${frame.width}px`;
	box.style.height = `${frame.height}px`;

	const bar = el('div', 'cf-frame-header');
	const titleInput = el('input', 'cf-frame-title');
	titleInput.type = 'text';
	titleInput.value = frame.title;
	titleInput.setAttribute('aria-label', 'Frame title');
	titleInput.addEventListener('pointerdown', e => e.stopPropagation());
	titleInput.addEventListener('change', () => {
		const nextTitle = titleInput.value.trim() || 'Section';
		state = {
			...state,
			frames: state.frames.map(f => f.id === frame.id ? { ...f, title: nextTitle } : f),
		};
		schedulePersistViewState();
	});

	const colorBtn = el('button', 'cf-frame-action', '\u25cf');
	colorBtn.type = 'button';
	colorBtn.title = 'Cycle frame accent color';
	colorBtn.setAttribute('aria-label', 'Cycle frame accent color');
	colorBtn.addEventListener('pointerdown', e => e.stopPropagation());
	colorBtn.addEventListener('click', event => {
		event.stopPropagation();
		const nextColor = FRAME_COLORS[(FRAME_COLORS.indexOf(frame.color) + 1) % FRAME_COLORS.length];
		state = {
			...state,
			frames: state.frames.map(f => f.id === frame.id ? { ...f, color: nextColor } : f),
		};
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	const delBtn = el('button', 'cf-frame-action', '\u00d7');
	delBtn.type = 'button';
	delBtn.title = 'Remove visual frame (keeps all resources)';
	delBtn.setAttribute('aria-label', 'Remove visual frame');
	delBtn.addEventListener('pointerdown', e => e.stopPropagation());
	delBtn.addEventListener('click', event => {
		event.stopPropagation();
		state = { ...state, frames: state.frames.filter(f => f.id !== frame.id) };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	bar.addEventListener('pointerdown', event => {
		if (event.button !== 0 || (event.target as HTMLElement).closest('input, button')) {
			return;
		}
		event.stopPropagation();
		const members = (projection?.nodes ?? [])
			.filter(n => n.x >= frame.x && n.y >= frame.y && n.x + n.width <= frame.x + frame.width && n.y + n.height <= frame.y + frame.height)
			.map(n => ({ id: n.node.id, x: n.x, y: n.y }));
		frameDrag = {
			frameId: frame.id,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: frame.x,
			originY: frame.y,
			memberOrigins: members,
			moved: false,
		};
	});

	bar.append(titleInput, colorBtn, delBtn);
	box.append(bar);
	return box;
}

function renderStickyNote(note: CanvasAnnotation): HTMLElement {
	const card = el('aside', `cf-note cf-note-${note.color}`);
	card.dataset.noteId = note.id;
	card.style.left = `${note.x}px`;
	card.style.top = `${note.y}px`;
	card.style.width = `${note.width}px`;

	const head = el('div', 'cf-note-head');
	head.append(el('span', 'cf-note-label', 'Note'));

	const actions = el('div', 'cf-note-actions');
	const colorBtn = el('button', 'cf-frame-action', '\u25cf');
	colorBtn.type = 'button';
	colorBtn.title = 'Cycle note color';
	colorBtn.setAttribute('aria-label', 'Cycle note color');
	colorBtn.addEventListener('pointerdown', e => e.stopPropagation());
	colorBtn.addEventListener('click', event => {
		event.stopPropagation();
		const nextColor = NOTE_COLORS[(NOTE_COLORS.indexOf(note.color) + 1) % NOTE_COLORS.length];
		state = {
			...state,
			annotations: state.annotations.map(n => n.id === note.id ? { ...n, color: nextColor } : n),
		};
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	const delBtn = el('button', 'cf-frame-action', '\u00d7');
	delBtn.type = 'button';
	delBtn.title = 'Delete note';
	delBtn.setAttribute('aria-label', 'Delete note');
	delBtn.addEventListener('pointerdown', e => e.stopPropagation());
	delBtn.addEventListener('click', event => {
		event.stopPropagation();
		state = { ...state, annotations: state.annotations.filter(n => n.id !== note.id) };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});
	actions.append(colorBtn, delBtn);
	head.append(actions);

	head.addEventListener('pointerdown', event => {
		if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
			return;
		}
		event.stopPropagation();
		noteDrag = {
			noteId: note.id,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: note.x,
			originY: note.y,
			moved: false,
		};
	});

	const textarea = el('textarea', 'cf-note-input');
	textarea.rows = 3;
	textarea.value = note.text;
	textarea.setAttribute('aria-label', 'Annotation text');
	textarea.addEventListener('pointerdown', e => e.stopPropagation());
	textarea.addEventListener('change', () => {
		state = {
			...state,
			annotations: state.annotations.map(n => n.id === note.id ? { ...n, text: textarea.value } : n),
		};
		schedulePersistViewState();
	});

	card.append(head, textarea);
	return card;
}

function renderNodeCard(item: PositionedNode): HTMLElement {
	const selected = item.node.id === state.selectedId || selectedIds.has(item.node.id);
	const isDraftAdded = !!draftDoc && draftDoc.present.addedIds.includes(item.node.id);
	const runResult = currentRun?.nodeResults[item.node.id];
	const statusCls = runResult ? ` cf-status-${runResult.status}` : '';
	const card = el('button', `cf-node cf-node-${state.mode} cf-provider-${item.provider}${selected ? ' selected' : ''}${isDraftAdded ? ' cf-node-draft' : ''}${statusCls}`);
	card.type = 'button';
	card.dataset.nodeId = item.node.id;
	card.style.left = `${item.x}px`;
	card.style.top = `${item.y}px`;
	card.style.width = `${item.width}px`;
	card.style.height = `${item.height}px`;
	card.setAttribute('aria-pressed', String(selected));
	const badgeInfo = runResult ? statusLabel(runResult.status) : undefined;
	card.setAttribute('aria-label', `${item.node.name}, ${item.node.resourceType ?? item.node.kind}${isDraftAdded ? ', unsaved draft' : ''}${badgeInfo ? `, ${badgeInfo.text}` : ''}`);

	const glyphBadge = el('span', 'cf-node-glyph');
	glyphBadge.append(createGlyphSvg(glyphCategoryFor(item.node.resourceType, item.node.kind)));

	if (state.mode === 'visual') {
		const top = el('div', 'cf-node-top');
		const providerRow = el('span', 'cf-node-provider-row');
		providerRow.append(glyphBadge, el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
		top.append(providerRow);
		if (badgeInfo && runResult) {
			top.append(el('span', `cf-status-badge cf-badge-${runResult.status}`, `${badgeInfo.icon} ${badgeInfo.text}`));
		} else if (isDraftAdded) {
			top.append(el('span', 'cf-draft-tag', 'Draft'));
		} else {
			top.append(el('span', 'cf-kind-tag', item.node.kind));
		}
		card.append(top);
		card.append(el('div', 'cf-node-name', item.node.name));
		const typeEl = el('div', 'cf-node-type cf-mono', item.node.resourceType ?? item.node.label);
		typeEl.title = item.node.resourceType ?? item.node.label;
		card.append(typeEl);
	} else {
		const head = el('div', 'cf-tech-head');
		const providerRow = el('span', 'cf-node-provider-row');
		providerRow.append(glyphBadge, el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
		head.append(providerRow);
		if (badgeInfo && runResult) {
			head.append(el('span', `cf-status-badge cf-badge-${runResult.status}`, `${badgeInfo.icon} ${badgeInfo.text}`));
		} else if (isDraftAdded) {
			head.append(el('span', 'cf-draft-tag', 'Draft'));
		} else {
			head.append(el('span', 'cf-kind-tag', item.node.kind));
		}
		card.append(head);
		card.append(el('div', 'cf-node-name', item.node.name));
		card.append(el('div', 'cf-node-type cf-mono', item.node.resourceType ?? item.node.label));
		const ports = el('div', 'cf-tech-ports');
		ports.append(
			el('span', 'cf-port cf-port-in', `IN ${item.incomingCount}`),
			el('span', 'cf-port cf-port-out', `OUT ${item.outgoingCount}`)
		);
		card.append(ports);
	}

	card.addEventListener('pointerdown', event => {
		if (event.button !== 0) {
			return;
		}
		event.stopPropagation();
		nodeDrag = {
			nodeId: item.node.id,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: item.x,
			originY: item.y,
			width: item.width,
			height: item.height,
			moved: false,
		};
	});
	card.addEventListener('click', event => {
		event.stopPropagation();
		selectNode(item.node.id, { additive: event.shiftKey || event.ctrlKey || event.metaKey });
	});
	card.addEventListener('dblclick', event => {
		event.stopPropagation();
		openFocusedWorkspace(item.node.id);
	});
	return card;
}

function renderInspector(): HTMLElement {
	const aside = el('aside', 'cf-inspector');
	aside.setAttribute('aria-label', 'Resource inspector');
	const current = activeGraph();

	const closeInspectorBtn = el('button', 'cf-icon-btn cf-inspector-close', '\u00d7');
	closeInspectorBtn.type = 'button';
	closeInspectorBtn.title = 'Close inspector';
	closeInspectorBtn.setAttribute('aria-label', 'Close inspector');
	closeInspectorBtn.addEventListener('click', () => {
		const selectedId = state.selectedId;
		state = { ...state, inspectorOpen: false };
		render();
		applyViewportTransform();
		schedulePersistViewState();
		if (selectedId) {
			root.querySelector<HTMLElement>(`.cf-node[data-node-id="${CSS.escape(selectedId)}"]`)?.focus();
		}
	});

	const selected = nodeById(state.selectedId);
	if (!selected) {
		const empty = el('div', 'cf-inspector-section');
		const emptyHead = el('div', 'cf-block-header');
		emptyHead.append(el('h2', 'cf-section-title', 'Inspector'), closeInspectorBtn);
		empty.append(
			emptyHead,
			el('p', 'cf-muted', 'Click any resource to inspect its dependencies, author draft edits, or open its Terraform source. Double-click or press Enter to open the focused resource workspace.')
		);
		aside.append(empty);
		if (dependencyReport && (dependencyReport.providers.length > 0 || dependencyReport.diagnosticCount > 0)) {
			aside.append(renderDependencyReportSection(dependencyReport));
		}
		if (current && current.diagnostics.length > 0) {
			aside.append(renderDiagnosticsSection(current));
		}
		return aside;
	}

	const provider = inferProvider(selected);
	const isStale = notice?.kind === 'stale';
	const { upstream, downstream } = relatedEdges(selected.id);

	const summary = el('div', 'cf-inspector-section');
	const kickerRow = el('div', 'cf-block-header');
	kickerRow.append(
		el('div', 'cf-inspector-kicker', `${providerDisplayName(provider)} · ${selected.kind}`),
		closeInspectorBtn
	);
	summary.append(
		kickerRow,
		el('h2', 'cf-inspector-title', selected.name),
		el('div', 'cf-mono cf-inspector-type', selected.resourceType ?? selected.label)
	);

	const actions = el('div', 'cf-action-row');
	const isModule = selected.kind.toLowerCase() === 'module';
	const openWs = el('button', 'cf-btn cf-btn-primary', isModule ? 'Inspect Module' : 'Open Resource');
	openWs.type = 'button';
	openWs.addEventListener('click', () => openFocusedWorkspace(selected.id));
	actions.append(openWs);

	const valRes = el('button', 'cf-btn', 'Validate Resource');
	valRes.type = 'button';
	valRes.addEventListener('click', () => startValidation('resource', selected.id));
	actions.append(valRes);

	const openSrc = el('button', 'cf-btn', 'Open Source');
	openSrc.type = 'button';
	openSrc.disabled = !selected.hasSource || isStale;
	openSrc.title = isStale
		? 'Refresh the graph before opening source'
		: selected.hasSource
			? 'Open declaration in native Terraform editor (O)'
			: 'No source location available (unsaved draft resource)';
	openSrc.addEventListener('click', () => post({ type: 'openSource', nodeId: selected.id }));
	actions.append(openSrc);

	const dupBtn = el('button', 'cf-btn', 'Duplicate');
	dupBtn.type = 'button';
	dupBtn.title = 'Duplicate resource in the unsaved draft';
	dupBtn.addEventListener('click', () => duplicateSelectedResource(selected));
	actions.append(dupBtn);

	const delBtn = el('button', 'cf-btn cf-btn-danger', 'Delete');
	delBtn.type = 'button';
	delBtn.title = 'Remove resource and connected edges from the unsaved draft (undoable)';
	delBtn.addEventListener('click', () => deleteSelectedResource(selected.id));
	actions.append(delBtn);

	summary.append(actions);
	aside.append(summary);

	const runNodeRes = currentRun?.nodeResults[selected.id];
	if (runNodeRes) {
		const runSec = el('div', 'cf-inspector-section');
		const info = statusLabel(runNodeRes.status);
		runSec.append(el('h3', 'cf-section-title', `Validation: ${info.icon} ${info.text}`));
		if (runNodeRes.reason) {
			runSec.append(el('p', 'cf-muted', runNodeRes.reason));
		}
		for (const finding of runNodeRes.findings) {
			const card = el('div', `cf-diag cf-diag-${finding.severity}`);
			card.append(
				el('div', 'cf-diag-head cf-mono', `${finding.code} · ${finding.severity}`),
				el('div', 'cf-diag-msg', finding.message),
				el('div', 'cf-muted', finding.remediation)
			);
			runSec.append(card);
		}
		aside.append(runSec);
	}

	aside.append(renderDepListSection('Upstream dependencies', upstream, false));
	aside.append(renderDepListSection('Downstream dependents', downstream, false));

	// Contextual Add Dependency control (cycle-safe)
	if (current && current.nodes.length > 1) {
		const existingDownstream = new Set(downstream.map(d => d.node.id));
		const targets = current.nodes.filter(n => n.id !== selected.id && !existingDownstream.has(n.id));
		if (targets.length > 0) {
			const connSec = el('div', 'cf-inspector-section');
			connSec.append(el('h3', 'cf-section-title', 'Connect dependency'));
			const row = el('div', 'cf-connect-row');
			const targetSel = el('select', 'cf-select');
			targetSel.setAttribute('aria-label', 'Connect to target resource');
			for (const t of targets) {
				const opt = el('option', undefined, `${t.name} (${t.resourceType ?? t.kind})`);
				opt.value = t.id;
				targetSel.append(opt);
			}
			const connBtn = el('button', 'cf-btn', 'Connect');
			connBtn.type = 'button';
			connBtn.addEventListener('click', () => {
				const ok = commitDraftEdit({ type: 'connectResources', fromId: selected.id, toId: targetSel.value });
				if (!ok) {
					connectFeedback = 'Connection skipped: would create a dependency cycle.';
					render();
					applyViewportTransform();
				}
			});
			row.append(targetSel, connBtn);
			connSec.append(row);
			if (connectFeedback) {
				connSec.append(el('div', 'cf-field-error', connectFeedback));
			}
			aside.append(connSec);
		}
	}

	if (current && current.diagnostics.length > 0) {
		aside.append(renderDiagnosticsSection(current));
	}
	if (dependencyReport && (dependencyReport.providers.length > 0 || dependencyReport.diagnosticCount > 0)) {
		aside.append(renderDependencyReportSection(dependencyReport));
	}
	return aside;
}

function renderDependencyReportSection(report: CanvasDependencyReport): HTMLElement {
	const section = el('div', 'cf-inspector-section');
	const lockLabel = report.lockState === 'valid'
		? 'lock valid'
		: report.lockState === 'absent'
			? 'no lockfile'
			: `lock ${report.lockState}`;
	section.append(
		el('h3', 'cf-section-title', `Providers & locks (${report.providers.length})`),
		el('div', 'cf-muted cf-mono', `${report.engine}${report.engineInferred ? ' (inferred)' : ''} · ${lockLabel}`)
	);
	for (const prov of report.providers) {
		const severity = prov.status === 'conflict' || prov.status === 'noMatchingRelease'
			? 'error'
			: prov.status === 'lockOutsideConstraints' || prov.status === 'unlocked'
				? 'warning'
				: 'info';
		const item = el('div', `cf-diag cf-diag-${severity}`);
		const statusText = prov.status === 'locked' && prov.lockedVersion
			? `locked ${prov.lockedVersion}`
			: prov.status === 'lockOutsideConstraints' && prov.lockedVersion
				? `lock ${prov.lockedVersion} outside constraints`
				: prov.status;
		item.append(
			el('div', 'cf-diag-head cf-mono', prov.display),
			el('div', 'cf-diag-msg', `${statusText} · ${prov.requirementCount} requirement${prov.requirementCount === 1 ? '' : 's'}${prov.conflictCount > 0 ? ` · ${prov.conflictCount} conflict(s)` : ''}`)
		);
		section.append(item);
	}
	if (report.unusedLockEntries.length > 0) {
		section.append(el('p', 'cf-muted', `${report.unusedLockEntries.length} unused lock entr${report.unusedLockEntries.length === 1 ? 'y' : 'ies'}.`));
	}
	return section;
}

function renderDepListSection(title: string, items: { node: CanvasNodeSummary; kind: string }[], inWorkspace: boolean): HTMLElement {
	const section = el('div', 'cf-inspector-section');
	section.append(el('h3', 'cf-section-title', `${title} (${items.length})`));
	if (items.length === 0) {
		section.append(el('p', 'cf-muted', 'None resolved in this root.'));
		return section;
	}
	const list = el('div', 'cf-dep-list');
	for (const entry of items) {
		const btn = el('button', 'cf-dep-btn');
		btn.type = 'button';
		btn.append(
			el('span', 'cf-dep-name', entry.node.name),
			el('span', 'cf-dep-meta cf-mono', `${entry.kind} · ${entry.node.resourceType ?? entry.node.kind}`)
		);
		btn.addEventListener('click', () => {
			if (inWorkspace) {
				state = { ...state, selectedId: entry.node.id };
				post({ type: 'selectNode', nodeId: entry.node.id });
				render();
				schedulePersistViewState();
			} else {
				selectNode(entry.node.id, { focusInCanvas: true });
			}
		});
		list.append(btn);
	}
	section.append(list);
	return section;
}

function renderDiagnosticsSection(current: CanvasGraphSnapshot): HTMLElement {
	const section = el('div', 'cf-inspector-section');
	section.append(el('h3', 'cf-section-title', `Diagnostics (${current.diagnostics.length})`));
	for (const diag of current.diagnostics) {
		const item = el('div', `cf-diag cf-diag-${diag.severity.toLowerCase()}`);
		item.append(
			el('div', 'cf-diag-head cf-mono', `${diag.code} · ${diag.severity}`),
			el('div', 'cf-diag-msg', diag.message)
		);
		section.append(item);
	}
	return section;
}

function getOrCreateDraft(node: CanvasNodeSummary, schema: FormSchema): ResourceDraft {
	const existing = draftDoc?.present.drafts[node.id];
	if (existing && existing.typeName === schema.typeName) {
		return existing;
	}
	return createInitialDraft(node, schema, draftDoc?.baseSourceRevision ?? '0'.repeat(64));
}

function updateDraft(nodeId: string, updater: (draft: ResourceDraft) => ResourceDraft): void {
	if (!draftDoc) {
		return;
	}
	const node = nodeById(nodeId);
	if (!node) {
		return;
	}
	const schema = lookupEffectiveSchema(node);
	const current = draftDoc.present.drafts[nodeId] ?? (schema ? createInitialDraft(node, schema, draftDoc.baseSourceRevision) : undefined);
	if (!current) {
		return;
	}
	commitDraftEdit({ type: 'updateDraft', nodeId, draft: updater(current) });
}

function setAttrInDraft(draft: ResourceDraft, attrName: string, value: DraftValue | undefined, blockId?: string): ResourceDraft {
	if (blockId) {
		return {
			...draft,
			blocks: draft.blocks.map(block => {
				if (block.id !== blockId) {
					return block;
				}
				const nextAttrs = { ...block.attributes };
				if (value === undefined) {
					delete nextAttrs[attrName];
				} else {
					nextAttrs[attrName] = value;
				}
				return { ...block, attributes: nextAttrs };
			}),
		};
	}
	const nextAttrs = { ...draft.attributes };
	if (value === undefined) {
		delete nextAttrs[attrName];
	} else {
		nextAttrs[attrName] = value;
	}
	return { ...draft, attributes: nextAttrs };
}

function renderSchemaFieldRow(
	nodeId: string,
	attr: FormAttribute,
	current: DraftValue | undefined,
	diagMessage: string | undefined,
	blockId?: string
): HTMLElement {
	const row = el('div', `cf-schema-field${diagMessage ? ' has-error' : ''}`);
	const top = el('div', 'cf-schema-field-head');
	const label = el('span', 'cf-schema-field-name cf-mono', attr.name);
	if (attr.access === 'required') {
		label.append(el('span', 'cf-req-star', ' *'));
	}
	top.append(label);

	const modeToggle = el('div', 'cf-segmented cf-segmented-sm');
	const isExpr = current?.kind === 'expression';
	const valBtn = el('button', 'cf-seg-btn', 'Value');
	valBtn.type = 'button';
	valBtn.setAttribute('aria-pressed', String(!isExpr));
	valBtn.addEventListener('click', () => {
		const fallback: DraftValue = attr.valueType === 'bool'
			? { kind: 'literal', value: false }
			: attr.valueType === 'listString'
				? { kind: 'literal', value: [] }
				: attr.valueType === 'mapString'
					? { kind: 'literal', value: {} }
					: { kind: 'literal', value: '' };
		updateDraft(nodeId, d => setAttrInDraft(d, attr.name, fallback, blockId));
	});
	const exprBtn = el('button', 'cf-seg-btn', 'Expr');
	exprBtn.type = 'button';
	exprBtn.setAttribute('aria-pressed', String(isExpr));
	exprBtn.addEventListener('click', () => {
		const text = current?.kind === 'expression' ? current.text : '';
		updateDraft(nodeId, d => setAttrInDraft(d, attr.name, { kind: 'expression', text }, blockId));
	});
	modeToggle.append(valBtn, exprBtn);
	top.append(modeToggle);
	row.append(top);

	const markActive = () => { activeFieldKey = { blockId, attrName: attr.name }; };

	if (isExpr) {
		const input = el('input', 'cf-input cf-mono');
		input.type = 'text';
		input.placeholder = 'e.g. azurerm_resource_group.hub.name';
		input.setAttribute('aria-label', `${attr.name} HCL expression`);
		input.value = current.text;
		input.addEventListener('focus', markActive);
		input.addEventListener('input', () => {
			updateDraft(nodeId, d => setAttrInDraft(d, attr.name, { kind: 'expression', text: input.value }, blockId));
		});
		row.append(input);
	} else if (attr.valueType === 'bool') {
		const checkLabel = el('label', 'cf-bool-row');
		const cb = el('input');
		cb.type = 'checkbox';
		cb.checked = current?.kind === 'literal' && current.value === true;
		cb.addEventListener('focus', markActive);
		cb.addEventListener('change', () => {
			updateDraft(nodeId, d => setAttrInDraft(d, attr.name, { kind: 'literal', value: cb.checked }, blockId));
		});
		checkLabel.append(cb, el('span', undefined, cb.checked ? 'true' : 'false'));
		row.append(checkLabel);
	} else if (attr.valueType === 'string' && attr.options && attr.options.length > 0) {
		const select = el('select', 'cf-input');
		select.setAttribute('aria-label', attr.name);
		const emptyOpt = el('option', undefined, '— Select —');
		emptyOpt.value = '';
		select.append(emptyOpt);
		const currentStr = current?.kind === 'literal' && typeof current.value === 'string' ? current.value : '';
		for (const optVal of attr.options) {
			const opt = el('option', undefined, optVal);
			opt.value = optVal;
			opt.selected = currentStr === optVal;
			select.append(opt);
		}
		select.addEventListener('focus', markActive);
		select.addEventListener('change', () => {
			updateDraft(nodeId, d => setAttrInDraft(d, attr.name, select.value ? { kind: 'literal', value: select.value } : undefined, blockId));
		});
		row.append(select);
	} else if (attr.valueType === 'listString') {
		const input = el('input', 'cf-input cf-mono');
		input.type = 'text';
		input.placeholder = attr.placeholder ?? 'Comma-separated values (e.g. 10.0.0.0/16)';
		input.setAttribute('aria-label', attr.name);
		input.value = current?.kind === 'literal' && Array.isArray(current.value) ? current.value.join(', ') : '';
		input.addEventListener('focus', markActive);
		input.addEventListener('change', () => {
			const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
			updateDraft(nodeId, d => setAttrInDraft(d, attr.name, parts.length > 0 ? { kind: 'literal', value: parts } : undefined, blockId));
		});
		row.append(input);
	} else if (attr.valueType === 'mapString') {
		const textarea = el('textarea', 'cf-input cf-mono cf-textarea');
		textarea.rows = 2;
		textarea.placeholder = 'environment=prod';
		textarea.setAttribute('aria-label', attr.name);
		if (current?.kind === 'literal' && current.value && typeof current.value === 'object' && !Array.isArray(current.value)) {
			textarea.value = Object.entries(current.value).map(([k, v]) => `${k}=${v}`).join('\n');
		}
		textarea.addEventListener('focus', markActive);
		textarea.addEventListener('change', () => {
			const map: Record<string, string> = {};
			for (const line of textarea.value.split(/\r?\n/)) {
				const idx = line.indexOf('=');
				if (idx > 0) {
					map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
				}
			}
			updateDraft(nodeId, d => setAttrInDraft(d, attr.name, Object.keys(map).length > 0 ? { kind: 'literal', value: map } : undefined, blockId));
		});
		row.append(textarea);
	} else {
		const input = el('input', 'cf-input');
		input.type = attr.sensitive ? 'password' : attr.valueType === 'number' ? 'number' : 'text';
		input.placeholder = attr.placeholder ?? '';
		input.setAttribute('aria-label', attr.name);
		input.value = current?.kind === 'literal' && (typeof current.value === 'string' || typeof current.value === 'number') ? String(current.value) : '';
		input.addEventListener('focus', markActive);
		input.addEventListener('change', () => {
			if (input.value === '') {
				updateDraft(nodeId, d => setAttrInDraft(d, attr.name, undefined, blockId));
			} else if (attr.valueType === 'number') {
				updateDraft(nodeId, d => setAttrInDraft(d, attr.name, { kind: 'literal', value: Number(input.value) }, blockId));
			} else {
				updateDraft(nodeId, d => setAttrInDraft(d, attr.name, { kind: 'literal', value: input.value }, blockId));
			}
		});
		row.append(input);
	}

	row.append(el('div', 'cf-field-help', attr.description));
	if (diagMessage) {
		row.append(el('div', 'cf-field-error', diagMessage));
	}
	return row;
}

function renderNestedBlocksSection(nodeId: string, blockTypes: readonly FormBlockType[], draft: ResourceDraft, diagByPath: ReadonlyMap<string, string>): HTMLElement {
	const wrap = el('div', 'cf-blocks-wrap');
	for (const bt of blockTypes) {
		const section = el('div', 'cf-inspector-section');
		const headerRow = el('div', 'cf-block-header');
		headerRow.append(el('h3', 'cf-section-title', `Nested block: ${bt.name}`));
		const addBtn = el('button', 'cf-btn', `+ Add ${bt.name}`);
		addBtn.type = 'button';
		addBtn.addEventListener('click', () => {
			const nextBlock: DraftBlock = { id: `blk-${nextDraftBlockId++}`, name: bt.name, attributes: {} };
			updateDraft(nodeId, d => ({ ...d, blocks: [...d.blocks, nextBlock] }));
		});
		headerRow.append(addBtn);
		section.append(headerRow);
		section.append(el('p', 'cf-muted', bt.description));

		const instances = draft.blocks.filter(b => b.name === bt.name);
		instances.forEach((inst, idx) => {
			const card = el('div', 'cf-block-card');
			const cardHead = el('div', 'cf-block-header');
			cardHead.append(el('strong', 'cf-mono', `${bt.name}[${idx}]`));
			const rmBtn = el('button', 'cf-btn', 'Remove');
			rmBtn.type = 'button';
			rmBtn.addEventListener('click', () => {
				updateDraft(nodeId, d => ({ ...d, blocks: d.blocks.filter(b => b.id !== inst.id) }));
			});
			cardHead.append(rmBtn);
			card.append(cardHead);
			for (const attr of bt.attributes) {
				const path = `${bt.path}[${idx}].${attr.name}`;
				card.append(renderSchemaFieldRow(nodeId, attr, inst.attributes[attr.name], diagByPath.get(path), inst.id));
			}
			section.append(card);
		});
		wrap.append(section);
	}
	return wrap;
}

function renderFocusedWorkspace(selected: CanvasNodeSummary): HTMLElement {
	const overlay = el('section', 'cf-workspace');
	overlay.setAttribute('aria-label', `Focused resource workspace: ${selected.name}`);

	const current = activeGraph();
	const provider = inferProvider(selected);
	const isStale = notice?.kind === 'stale';
	const { upstream, downstream } = relatedEdges(selected.id);
	const schema = lookupEffectiveSchema(selected);
	const schemaLoading = !!selected.resourceType && pendingSchemaRequests.has(selected.resourceType);
	const draft = schema ? getOrCreateDraft(selected, schema) : undefined;
	const draftStale = !!draft && !!current && draft.baseSourceRevision !== current.sourceRevision;
	const rendered = schema && draft ? renderDraftPreview(schema, draft) : undefined;
	const diagByPath = new Map((rendered?.diagnostics ?? []).map(d => [d.path, d.message]));
	const references = current ? buildReferenceCandidates(current, selected.id) : [];

	const top = el('header', 'cf-workspace-header');
	const backBtn = el('button', 'cf-btn cf-back-btn', '← Back to Canvas');
	backBtn.type = 'button';
	backBtn.addEventListener('click', () => closeFocusedWorkspace());

	const heading = el('div', 'cf-workspace-heading');
	heading.append(
		el('strong', undefined, selected.name),
		el('span', 'cf-mono cf-muted', selected.resourceType ?? selected.label)
	);

	const actions = el('div', 'cf-header-group');
	if (schema) {
		actions.append(el('span', 'cf-pill', `${schema.providerSource} ${schema.providerVersion}`));
	}
	if (current) {
		actions.append(el('span', 'cf-pill cf-mono', `rev ${current.sourceRevision.slice(0, 8)}`));
	}
	const prereqCount = current ? computePrerequisiteScope(current, selected.id).length : 1;
	const validateResBtn = el('button', 'cf-btn', `Validate Resource (${prereqCount})`);
	validateResBtn.type = 'button';
	validateResBtn.title = `Validate ${selected.name} and its ${Math.max(0, prereqCount - 1)} upstream prerequisite(s)`;
	validateResBtn.addEventListener('click', () => startValidation('resource', selected.id));
	actions.append(validateResBtn);

	const openSrc = el('button', 'cf-btn cf-btn-primary', 'Advanced (Open Source)');
	openSrc.type = 'button';
	openSrc.disabled = !selected.hasSource || isStale;
	openSrc.addEventListener('click', () => post({ type: 'openSource', nodeId: selected.id }));
	actions.append(openSrc);

	top.append(backBtn, heading, actions);
	overlay.append(top);

	if (draftStale) {
		const staleBar = el('div', 'cf-banner cf-banner-stale');
		staleBar.setAttribute('role', 'alert');
		staleBar.append(el('span', undefined, 'Architecture source revision changed since this draft started. Reset the draft to align with the latest revision.'));
		const resetBtn = el('button', 'cf-btn', 'Reset Draft');
		resetBtn.type = 'button';
		resetBtn.addEventListener('click', () => {
			if (schema && current) {
				commitDraftEdit({ type: 'updateDraft', nodeId: selected.id, draft: createInitialDraft(selected, schema, current.sourceRevision) });
			}
		});
		staleBar.append(resetBtn);
		overlay.append(staleBar);
	}

	const columns = el('div', 'cf-workspace-columns');

	// Left pane — Inputs & Typed Reference Picker (n8n pattern)
	const leftPane = el('aside', 'cf-ws-pane');
	leftPane.append(el('h2', 'cf-ws-pane-title', 'Inputs'));
	leftPane.append(renderDepListSection('Upstream resources', upstream, true));

	const refSection = el('div', 'cf-inspector-section');
	refSection.append(el('h3', 'cf-section-title', `Typed references (${references.length})`));
	if (references.length === 0) {
		refSection.append(el('p', 'cf-muted', 'No other resources in this architecture to reference.'));
	} else {
		refSection.append(el('p', 'cf-muted', schema
			? 'Focus a field in Parameters, then click a chip to insert it as an HCL expression.'
			: 'Available resource references in this architecture.'));
		const chipWrap = el('div', 'cf-ref-chips');
		for (const ref of references) {
			const chip = el('button', 'cf-ref-chip');
			chip.type = 'button';
			chip.title = `${ref.description} (${ref.valueType})`;
			chip.append(
				el('span', 'cf-mono cf-ref-expr', ref.expression),
				el('span', 'cf-ref-badge', ref.knownAtApply ? `${ref.valueType} · apply-time` : ref.valueType)
			);
			chip.disabled = !schema;
			chip.addEventListener('click', () => {
				if (!schema) {
					return;
				}
				const targetAttr = activeFieldKey?.attrName ?? schema.attributes.find(a => a.access === 'required' && a.name !== 'name')?.name ?? 'name';
				updateDraft(selected.id, d => setAttrInDraft(d, targetAttr, { kind: 'expression', text: ref.expression }, activeFieldKey?.blockId));
			});
			chipWrap.append(chip);
		}
		refSection.append(chipWrap);
	}
	leftPane.append(refSection);
	columns.append(leftPane);

	// Center pane — Schema-backed Parameters form (or explicit schema-absent fallback)
	const centerPane = el('div', 'cf-ws-pane cf-ws-center');
	centerPane.append(el('h2', 'cf-ws-pane-title', 'Parameters (Unsaved Draft Preview)'));

	if (schema && draft) {
		centerPane.append(el('p', 'cf-muted', `${schema.description} Offline guidance pinned to ${schema.providerSource} ${schema.providerVersion}. Draft edits stay in memory and never modify Terraform files on disk.`));

		const reqAttrs = schema.attributes.filter(a => a.access === 'required');
		const optAttrs = schema.attributes.filter(a => a.access === 'optional');

		if (reqAttrs.length > 0) {
			const reqSec = el('div', 'cf-inspector-section');
			reqSec.append(el('h3', 'cf-section-title', 'Required'));
			for (const attr of reqAttrs) {
				reqSec.append(renderSchemaFieldRow(selected.id, attr, draft.attributes[attr.name], diagByPath.get(attr.path)));
			}
			centerPane.append(reqSec);
		}
		if (optAttrs.length > 0) {
			const optDetails = el('details', 'cf-opt-details');
			optDetails.open = optAttrs.some(a => draft.attributes[a.name] !== undefined);
			optDetails.append(el('summary', 'cf-section-title', `Optional (${optAttrs.length})`));
			for (const attr of optAttrs) {
				optDetails.append(renderSchemaFieldRow(selected.id, attr, draft.attributes[attr.name], diagByPath.get(attr.path)));
			}
			centerPane.append(optDetails);
		}
		if (schema.blocks.length > 0) {
			centerPane.append(renderNestedBlocksSection(selected.id, schema.blocks, draft, diagByPath));
		}

		const helpDetails = el('details', 'cf-opt-details');
		helpDetails.append(el('summary', 'cf-section-title', 'Offline example & provider docs'));
		helpDetails.append(el('pre', 'cf-hcl-preview cf-mono', schema.exampleHcl));
		helpDetails.append(el('p', 'cf-muted cf-mono', `Official reference: ${schema.docsUrl}`));
		centerPane.append(helpDetails);
	} else {
		const dl = el('dl', 'cf-meta-grid');
		const rows: [string, string][] = [
			['Provider', providerDisplayName(provider)],
			['Declaration kind', selected.kind],
			['Terraform type', selected.resourceType ?? '—'],
			['Schema status', schemaLoading ? 'Checking verified provider catalogue…' : 'Schema not available in bundled or local verified catalogue'],
			['Source authority', 'Read-only Terraform source (verified by CloudForge Rust service)'],
		];
		for (const [k, v] of rows) {
			dl.append(el('dt', undefined, k), el('dd', k === 'Terraform type' ? 'cf-mono' : undefined, v));
		}
		centerPane.append(dl);
		centerPane.append(el('p', 'cf-muted', schemaLoading
			? 'Querying the verified local provider catalogue snapshot for this resource type.'
			: 'No form schema is installed for this declaration type yet. Unsupported content survives inspection untouched; use Advanced (Open Source) to edit it in the native Terraform editor.'));
	}
	columns.append(centerPane);

	// Right pane — Results (Findings | HCL Preview | Outputs)
	const rightPane = el('aside', 'cf-ws-pane');
	rightPane.append(el('h2', 'cf-ws-pane-title', 'Results'));

	const tabs = el('div', 'cf-segmented');
	tabs.setAttribute('role', 'tablist');
	for (const [tabId, label] of [['preview', 'HCL Preview'], ['findings', `Findings (${(rendered?.diagnostics.length ?? 0) + (current?.diagnostics.length ?? 0)})`], ['outputs', 'Outputs']] as const) {
		const btn = el('button', 'cf-seg-btn', label);
		btn.type = 'button';
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', String(workspaceResultsTab === tabId));
		btn.setAttribute('aria-pressed', String(workspaceResultsTab === tabId));
		btn.addEventListener('click', () => {
			workspaceResultsTab = tabId;
			render();
		});
		tabs.append(btn);
	}
	rightPane.append(tabs);

	if (workspaceResultsTab === 'preview') {
		if (rendered && draft) {
			const headRow = el('div', 'cf-block-header');
			headRow.append(el('span', 'cf-pill cf-pill-warn', 'Unsaved draft'));
			const resetBtn = el('button', 'cf-btn', 'Reset Draft');
			resetBtn.type = 'button';
			resetBtn.addEventListener('click', () => {
				if (schema && current) {
					commitDraftEdit({ type: 'updateDraft', nodeId: selected.id, draft: createInitialDraft(selected, schema, current.sourceRevision) });
				}
			});
			headRow.append(resetBtn);
			rightPane.append(headRow);
			rightPane.append(el('pre', 'cf-hcl-preview cf-mono', rendered.hcl));
			rightPane.append(el('p', 'cf-muted', 'Preview only until applied. Open Review HCL in the header to preview and apply a guarded save to a local .tf file.'));
		} else {
			rightPane.append(el('p', 'cf-muted', 'HCL draft preview is available for schema-backed Azure networking resources. Use Advanced (Open Source) for native Terraform source.'));
		}
	} else if (workspaceResultsTab === 'findings') {
		const runRes = currentRun?.nodeResults[selected.id];
		if (runRes) {
			const info = statusLabel(runRes.status);
			const sec = el('div', 'cf-inspector-section');
			sec.append(el('h3', 'cf-section-title', `Runner result: ${info.icon} ${info.text}`));
			if (runRes.reason) {
				sec.append(el('p', 'cf-muted', runRes.reason));
			}
			for (const finding of runRes.findings) {
				const item = el('div', `cf-diag cf-diag-${finding.severity}`);
				item.append(
					el('div', 'cf-diag-head cf-mono', `${finding.code} · ${finding.severity}`),
					el('div', 'cf-diag-msg', finding.message),
					el('div', 'cf-muted', finding.remediation)
				);
				sec.append(item);
			}
			rightPane.append(sec);
		}
		if (rendered && rendered.diagnostics.length > 0) {
			const diagSec = el('div', 'cf-inspector-section');
			diagSec.append(el('h3', 'cf-section-title', `Draft schema checks (${rendered.diagnostics.length})`));
			for (const d of rendered.diagnostics) {
				const item = el('div', `cf-diag cf-diag-${d.severity}`);
				item.append(
					el('div', 'cf-diag-head cf-mono', `${d.path || 'resource'} · ${d.severity}`),
					el('div', 'cf-diag-msg', d.message)
				);
				diagSec.append(item);
			}
			rightPane.append(diagSec);
		} else if (rendered) {
			rightPane.append(el('p', 'cf-muted', 'All required fields in this draft pass local schema checks.'));
		}
		if (current && current.diagnostics.length > 0) {
			rightPane.append(renderDiagnosticsSection(current));
		}
	} else {
		rightPane.append(renderDepListSection('Downstream dependents', downstream, true));
		if (schema && schema.outputs.length > 0) {
			const outSec = el('div', 'cf-inspector-section');
			outSec.append(el('h3', 'cf-section-title', 'Known resource outputs'));
			for (const out of schema.outputs) {
				const card = el('div', 'cf-diag');
				card.append(
					el('div', 'cf-mono', `${selected.resourceType}.${selected.name}.${out.name}`),
					el('div', 'cf-muted', `${out.description} — ${out.knownAtApply ? 'Known after apply (not fabricated)' : 'Known from configuration'}`)
				);
				outSec.append(card);
			}
			rightPane.append(outSec);
		}
	}
	columns.append(rightPane);

	overlay.append(columns);
	return overlay;
}

function renderTimeline(): HTMLElement {
	const panel = el('section', 'cf-timeline');
	panel.setAttribute('aria-label', 'Runner Timeline');

	const head = el('div', 'cf-timeline-header');
	const titleGroup = el('div', 'cf-header-group');
	titleGroup.append(el('strong', undefined, 'Runner Timeline'));
	if (state.sampleContext) {
		const current = activeGraph();
		const staleCtx = current ? isSampleContextStale(state.sampleContext, current.sourceRevision) : false;
		titleGroup.append(el(
			'span',
			`cf-pill ${staleCtx ? 'cf-pill-warn' : ''}`,
			`Sample context: ${state.sampleContext.label} (${state.sampleContext.environment} · ${state.sampleContext.region})${staleCtx ? ' · stale' : ''}`
		));
	}
	if (currentRun) {
		titleGroup.append(
			el('span', 'cf-pill cf-mono', `${currentRun.runId} · ${currentRun.scope}`),
			el('span', 'cf-pill', `${currentRun.analyzedNodeIds.length} resource(s) · ${currentRun.coverage} coverage`)
		);
		if (currentRun.previousRunId) {
			titleGroup.append(el('span', 'cf-muted', `rerun of ${currentRun.previousRunId}`));
		}
		if (currentRun.stale) {
			titleGroup.append(el('span', 'cf-pill cf-pill-warn', 'Stale revision'));
		}
	}
	head.append(titleGroup);

	const actions = el('div', 'cf-header-group');
	const runBtn = el('button', 'cf-btn', currentRun ? 'Rerun' : 'Validate Architecture');
	runBtn.type = 'button';
	runBtn.addEventListener('click', () => startValidation('architecture'));
	actions.append(runBtn);

	if (currentRun && currentRun.outcome !== 'cancelled') {
		const cancelBtn = el('button', 'cf-btn', 'Cancel Run');
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', () => cancelActiveRun());
		actions.append(cancelBtn);
	}

	const closeBtn = el('button', 'cf-btn', 'Close');
	closeBtn.type = 'button';
	closeBtn.addEventListener('click', () => {
		timelineOpen = false;
		render();
		applyViewportTransform();
	});
	actions.append(closeBtn);
	head.append(actions);
	panel.append(head);

	if (!currentRun) {
		panel.append(el('p', 'cf-empty-note', 'No validation run yet. Click Validate Architecture or Validate Resource to run deterministic offline checks.'));
		return panel;
	}

	const body = el('div', 'cf-timeline-body');
	const stagesCol = el('div', 'cf-timeline-stages');
	for (const stage of currentRun.stages) {
		const card = el('div', 'cf-stage-card');
		const row = el('div', 'cf-block-header');
		row.append(el('strong', undefined, stage.label), el('span', 'cf-mono cf-muted', `${stage.status} · ${stage.durationMs}ms`));
		card.append(row, el('span', 'cf-muted', stage.detail));
		stagesCol.append(card);
	}
	for (const note of currentRun.coverageNotes) {
		stagesCol.append(el('p', 'cf-muted', note));
	}
	body.append(stagesCol);

	const eventsCol = el('div', 'cf-timeline-events');
	for (const ev of currentRun.events) {
		const row = el('div', 'cf-event-row');
		row.append(
			el('span', 'cf-mono cf-muted', `#${ev.sequence}`),
			el('span', 'cf-mono', ev.stage),
			el('span', 'cf-mono cf-muted', ev.status)
		);
		if (ev.nodeId) {
			const link = el('button', 'cf-event-link', ev.message);
			link.type = 'button';
			const targetId = ev.nodeId;
			link.addEventListener('click', () => selectNode(targetId, { focusInCanvas: true }));
			row.append(link);
		} else {
			row.append(el('span', undefined, ev.message));
		}
		eventsCol.append(row);
	}
	body.append(eventsCol);
	panel.append(body);
	return panel;
}

function renderHclReviewModal(): HTMLElement | null {
	if (!hclReviewOpen || !draftDoc) {
		return null;
	}
	const summary = computeDraftChangeSummary(draftDoc);
	const preview = generateTerraformPreview(draftDoc, lookupEffectiveSchema, renderDraftPreview);
	const trimmedFileName = saveFileName.trim();
	const validFileName = isValidTfFileName(trimmedFileName);
	const activePreview = savePreview && savePreviewHcl === preview.hcl && savePreview.fileName === trimmedFileName
		? savePreview
		: undefined;
	const busy = savePhase === 'previewing' || savePhase === 'applying';

	const backdrop = el('div', 'cf-modal-backdrop');
	backdrop.addEventListener('click', event => {
		if (event.target === backdrop && !busy) {
			closeHclReviewModal();
		}
	});

	const dialog = el('section', 'cf-modal');
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Review Generated Terraform HCL');

	const head = el('header', 'cf-modal-header');
	const titleGroup = el('div', 'cf-header-group');
	titleGroup.append(
		el('strong', undefined, 'Review Generated Terraform HCL'),
		el('span', 'cf-pill cf-mono', `base ${preview.baseSourceRevision.slice(0, 8)}`),
		el('span', `cf-pill ${preview.hasErrors ? 'cf-pill-err' : 'cf-pill-ok'}`, `${preview.resourceCount} block(s) · ${preview.diagnosticsCount} diagnostic(s)`)
	);
	const headActions = el('div', 'cf-header-group');
	const revertBtn = el('button', 'cf-btn cf-btn-danger', 'Revert Draft');
	revertBtn.type = 'button';
	revertBtn.disabled = busy;
	revertBtn.addEventListener('click', () => performRevertDraft());
	const closeBtn = el('button', 'cf-btn cf-modal-close', 'Close');
	closeBtn.type = 'button';
	closeBtn.disabled = busy;
	closeBtn.addEventListener('click', () => closeHclReviewModal());
	headActions.append(revertBtn, closeBtn);
	head.append(titleGroup, headActions);
	dialog.append(head);

	const body = el('div', 'cf-modal-body');
	body.append(el(
		'p',
		'cf-muted',
		`Unsaved draft: +${summary.added.length} added, ~${summary.modified.length} modified, -${summary.deleted.length} removed, +${summary.addedEdges}/-${summary.removedEdges} edge(s). Preview Save checks HCL syntax, live revision, and secret literals without touching disk; Apply writes atomically with a one-shot token.`
	));

	const saveBar = el('div', 'cf-save-bar');
	const fileLabel = el('label', 'cf-save-field');
	fileLabel.append(el('span', undefined, 'Target .tf file'));
	const fileInput = el('input', 'cf-input cf-mono');
	fileInput.type = 'text';
	fileInput.value = saveFileName;
	fileInput.placeholder = 'cloudforge_draft.tf';
	fileInput.disabled = busy;
	fileInput.setAttribute('aria-label', 'Target Terraform filename');
	fileInput.addEventListener('input', () => {
		saveFileName = fileInput.value;
		if (savePreview || saveError) {
			savePreview = undefined;
			savePreviewHcl = undefined;
			saveError = undefined;
			savePhase = 'idle';
		}
		const previewBtnEl = dialog.querySelector<HTMLButtonElement>('.cf-save-preview-btn');
		if (previewBtnEl) {
			previewBtnEl.disabled = preview.hasErrors || !isValidTfFileName(saveFileName.trim()) || busy;
		}
	});
	fileLabel.append(fileInput);

	const previewBtn = el(
		'button',
		`cf-btn cf-save-preview-btn${activePreview ? '' : ' cf-btn-primary'}`,
		savePhase === 'previewing' ? 'Checking HCL…' : 'Preview Save'
	);
	previewBtn.type = 'button';
	previewBtn.disabled = preview.hasErrors || !validFileName || busy;
	previewBtn.title = preview.hasErrors
		? 'Fix schema errors before previewing save'
		: !validFileName
			? 'Enter a single top-level .tf filename (not starting with a dot)'
			: 'Validate HCL syntax, revision, and secret literals before writing';
	previewBtn.addEventListener('click', () => {
		const target = saveFileName.trim();
		if (!isValidTfFileName(target) || preview.hasErrors) {
			return;
		}
		savePhase = 'previewing';
		saveError = undefined;
		savePreview = undefined;
		savePreviewHcl = preview.hcl;
		post({ type: 'requestDraftSavePreview', fileName: target, contents: preview.hcl });
		render();
	});

	saveBar.append(fileLabel, previewBtn);
	body.append(saveBar);

	if (saveError) {
		const errBox = el('div', 'cf-save-error');
		errBox.setAttribute('role', 'alert');
		errBox.append(el('strong', undefined, `${saveError.code}: `), el('span', undefined, saveError.message));
		body.append(errBox);
	}

	if (activePreview) {
		const card = el('div', 'cf-save-preview-card');
		const meta = el('div', 'cf-save-preview-meta');
		const metaLeft = el('div', 'cf-header-group');
		metaLeft.append(
			el('strong', undefined, activePreview.created ? `Create ${activePreview.fileName}` : `Replace ${activePreview.fileName}`),
			el('span', 'cf-pill cf-mono', `+${activePreview.addedLines} / -${activePreview.removedLines} lines`),
			el('span', 'cf-pill cf-mono', `sha256 ${activePreview.afterSha256.slice(0, 10)}`)
		);
		const metaActions = el('div', 'cf-header-group');
		const applyBtn = el('button', 'cf-btn cf-btn-primary', savePhase === 'applying' ? 'Applying…' : 'Apply Saved Changes');
		applyBtn.type = 'button';
		applyBtn.disabled = busy;
		applyBtn.addEventListener('click', () => {
			savePhase = 'applying';
			saveError = undefined;
			post({
				type: 'applyDraftSave',
				fileName: activePreview.fileName,
				contents: preview.hcl,
				previewToken: activePreview.previewToken,
			});
			render();
		});
		const cancelPreviewBtn = el('button', 'cf-btn', 'Cancel Preview');
		cancelPreviewBtn.type = 'button';
		cancelPreviewBtn.disabled = busy;
		cancelPreviewBtn.addEventListener('click', () => {
			resetSavePreviewState();
			render();
		});
		metaActions.append(applyBtn, cancelPreviewBtn);
		meta.append(metaLeft, metaActions);
		card.append(meta);

		if (activePreview.findings.length > 0) {
			const warnBox = el('div', 'cf-save-warnings');
			warnBox.setAttribute('role', 'alert');
			warnBox.append(el('strong', undefined, `Sensitive literal warning (${activePreview.findings.length})`));
			for (const finding of activePreview.findings) {
				const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
				warnBox.append(el('span', 'cf-mono', `${finding.code} at ${loc} — consider using a variable instead of a literal secret.`));
			}
			card.append(warnBox);
		}
		body.append(card);
	}

	body.append(el('pre', 'cf-hcl-preview cf-mono', preview.hcl));
	dialog.append(body);

	backdrop.append(dialog);
	return backdrop;
}

function renderExportModal(): HTMLElement | null {
	const current = activeGraph();
	if (!exportModalOpen || !current || !projection) {
		return null;
	}
	const opts = buildExportOptions();
	const svgPreview = exportFormat !== 'markdown' ? renderArchitectureSvg(current, projection, opts) : undefined;
	const mdPreview = exportFormat === 'markdown' ? renderArchitectureMarkdownReport(current, projection, opts) : undefined;

	const backdrop = el('div', 'cf-modal-backdrop');
	backdrop.addEventListener('click', event => {
		if (event.target === backdrop && !exportBusy) {
			closeExportModal();
		}
	});

	const dialog = el('section', 'cf-modal cf-export-modal');
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Export Architecture Diagram or Report');

	const head = el('header', 'cf-modal-header');
	const titleGroup = el('div', 'cf-header-group');
	titleGroup.append(
		el('strong', undefined, 'Export Architecture'),
		el('span', 'cf-pill cf-mono', `rev ${current.sourceRevision.slice(0, 8)}`)
	);
	if (svgPreview) {
		titleGroup.append(el('span', 'cf-pill', `${svgPreview.width}\u00d7${svgPreview.height}px \u00b7 ${svgPreview.nodeCount} resource(s)`));
	}
	const closeBtn = el('button', 'cf-btn cf-export-close', 'Close');
	closeBtn.type = 'button';
	closeBtn.disabled = exportBusy;
	closeBtn.addEventListener('click', () => closeExportModal());
	head.append(titleGroup, closeBtn);
	dialog.append(head);

	const body = el('div', 'cf-modal-body');

	const controls = el('div', 'cf-export-controls');

	const fmtField = el('label', 'cf-export-field');
	fmtField.append(el('span', undefined, 'Format'));
	const fmtSelect = el('select', 'cf-select');
	fmtSelect.setAttribute('aria-label', 'Export format');
	for (const [val, label] of [['svg', 'SVG Diagram (Vector)'], ['png', 'PNG Image (2\u00d7 Retina)'], ['markdown', 'Markdown Architecture Report']] as const) {
		const opt = el('option', undefined, label);
		opt.value = val;
		opt.selected = exportFormat === val;
		fmtSelect.append(opt);
	}
	fmtSelect.addEventListener('change', () => {
		exportFormat = fmtSelect.value as ExportFormat;
		exportStatusMessage = undefined;
		render();
	});
	fmtField.append(fmtSelect);

	const scopeField = el('label', 'cf-export-field');
	scopeField.append(el('span', undefined, 'Scope'));
	const scopeSelect = el('select', 'cf-select');
	scopeSelect.setAttribute('aria-label', 'Export scope');
	const fullOpt = el('option', undefined, 'Full Architecture');
	fullOpt.value = 'architecture';
	fullOpt.selected = exportScope === 'architecture';
	scopeSelect.append(fullOpt);
	if (selectedIds.size > 0) {
		const selOpt = el('option', undefined, `Selection (${selectedIds.size})`);
		selOpt.value = 'selection';
		selOpt.selected = exportScope === 'selection';
		scopeSelect.append(selOpt);
	}
	for (const frame of state.frames) {
		const fOpt = el('option', undefined, `Frame: ${frame.title}`);
		fOpt.value = `frame:${frame.id}`;
		fOpt.selected = exportScope === 'frame' && exportFrameId === frame.id;
		scopeSelect.append(fOpt);
	}
	scopeSelect.addEventListener('change', () => {
		if (scopeSelect.value.startsWith('frame:')) {
			exportScope = 'frame';
			exportFrameId = scopeSelect.value.slice('frame:'.length);
		} else {
			exportScope = scopeSelect.value as ExportScope;
			exportFrameId = undefined;
		}
		render();
	});
	scopeField.append(scopeSelect);

	const themeField = el('label', 'cf-export-field');
	themeField.append(el('span', undefined, 'Theme'));
	const themeSel = el('select', 'cf-select');
	themeSel.setAttribute('aria-label', 'Export theme');
	for (const [val, label] of [['dark', 'Dark'], ['light', 'Light']] as const) {
		const opt = el('option', undefined, label);
		opt.value = val;
		opt.selected = exportTheme === val;
		themeSel.append(opt);
	}
	themeSel.disabled = exportFormat === 'markdown';
	themeSel.addEventListener('change', () => {
		exportTheme = themeSel.value as 'light' | 'dark';
		render();
	});
	themeField.append(themeSel);

	controls.append(fmtField, scopeField, themeField);
	body.append(controls);

	const toggles = el('div', 'cf-export-toggles');
	const makeCheck = (labelText: string, checked: boolean, onChange: (val: boolean) => void) => {
		const lbl = el('label', 'cf-export-check');
		const cb = el('input');
		cb.type = 'checkbox';
		cb.checked = checked;
		cb.addEventListener('change', () => {
			onChange(cb.checked);
			render();
		});
		lbl.append(cb, el('span', undefined, labelText));
		return lbl;
	};
	toggles.append(
		makeCheck('Include validation status', exportIncludeValidation, v => { exportIncludeValidation = v; }),
		makeCheck('Include annotations', exportIncludeAnnotations, v => { exportIncludeAnnotations = v; }),
		makeCheck('Include revision provenance footer', exportIncludeProvenance, v => { exportIncludeProvenance = v; })
	);
	body.append(toggles);

	if (exportStatusMessage) {
		const msgBox = el('div', exportStatusMessage.ok ? 'cf-save-preview-card' : 'cf-save-error');
		msgBox.setAttribute('role', 'status');
		msgBox.textContent = exportStatusMessage.text;
		body.append(msgBox);
	}

	if (svgPreview) {
		const previewBox = el('div', 'cf-export-preview-stage');
		try {
			const parsed = new DOMParser().parseFromString(svgPreview.svg, 'image/svg+xml');
			const svgNode = parsed.documentElement;
			if (svgNode && svgNode.nodeName.toLowerCase() === 'svg') {
				const imported = document.importNode(svgNode, true);
				imported.setAttribute('class', 'cf-export-preview-svg');
				previewBox.append(imported);
			}
		} catch {
			previewBox.append(el('p', 'cf-muted', 'SVG preview ready to export.'));
		}
		body.append(previewBox);
	} else if (mdPreview !== undefined) {
		body.append(el('pre', 'cf-hcl-preview cf-mono', mdPreview));
	}

	const footer = el('div', 'cf-modal-header');
	footer.append(el('span', 'cf-muted', 'Exports are rendered offline from the captured source revision with no external network requests.'));
	const saveExportBtn = el('button', 'cf-btn cf-btn-primary cf-export-save-btn', exportBusy ? 'Exporting\u2026' : 'Save Export\u2026');
	saveExportBtn.type = 'button';
	saveExportBtn.disabled = exportBusy;
	saveExportBtn.addEventListener('click', () => { void triggerExportSave(); });
	footer.append(saveExportBtn);

	dialog.append(body, footer);
	backdrop.append(dialog);
	return backdrop;
}

function renderModuleDrillDown(moduleId: string): HTMLElement | null {
	const current = activeGraph();
	if (!current) {
		return null;
	}
	const info = inspectModuleBoundary(current, moduleId);
	if (!info) {
		return null;
	}
	const isStale = notice?.kind === 'stale';
	const overlay = el('section', 'cf-workspace');
	overlay.setAttribute('aria-label', `Module boundary view: ${info.moduleNode.name}`);

	const top = el('header', 'cf-workspace-header');
	const leftGroup = el('div', 'cf-header-group');
	const backBtn = el('button', 'cf-btn cf-module-back-btn', '\u2190 Back to Parent');
	backBtn.type = 'button';
	backBtn.addEventListener('click', () => closeModuleDrillDown());
	const crumb = el('nav', 'cf-breadcrumb');
	crumb.setAttribute('aria-label', 'Module breadcrumb');
	crumb.append(
		el('span', 'cf-muted', current.architectureName),
		el('span', 'cf-muted', '/'),
		el('strong', 'cf-mono', info.moduleNode.label)
	);
	leftGroup.append(backBtn, crumb);

	const actions = el('div', 'cf-header-group');
	actions.append(el('span', 'cf-pill cf-mono', `rev ${current.sourceRevision.slice(0, 8)}`));
	const openSrc = el('button', 'cf-btn cf-btn-primary', 'Open Module Call (Source)');
	openSrc.type = 'button';
	openSrc.disabled = !info.moduleNode.hasSource || isStale;
	openSrc.addEventListener('click', () => post({ type: 'openSource', nodeId: info.moduleNode.id }));
	actions.append(openSrc);
	top.append(leftGroup, actions);
	overlay.append(top);

	const columns = el('div', 'cf-workspace-columns');

	const inPane = el('aside', 'cf-ws-pane');
	inPane.append(el('h2', 'cf-ws-pane-title', `Module Inputs (${info.inputs.length})`));
	if (info.inputs.length === 0) {
		inPane.append(el('p', 'cf-muted', 'No upstream root resources feed this module statically.'));
	} else {
		const list = el('div', 'cf-dep-list');
		for (const item of info.inputs) {
			const btn = el('button', 'cf-dep-btn');
			btn.type = 'button';
			btn.append(
				el('span', 'cf-dep-name', item.node.name),
				el('span', 'cf-dep-meta cf-mono', `${item.edgeKind} · ${item.node.resourceType ?? item.node.kind}`)
			);
			btn.addEventListener('click', () => {
				drilledModuleId = null;
				selectNode(item.node.id, { focusInCanvas: true });
			});
			list.append(btn);
		}
		inPane.append(list);
	}
	columns.append(inPane);

	const centerPane = el('div', 'cf-ws-pane cf-ws-center');
	centerPane.append(
		el('h2', 'cf-ws-pane-title', 'Module Boundary'),
		el('p', 'cf-muted', 'Terraform child module calls preserve explicit input/output boundaries separately from visual grouping. Open the module call in native source to inspect its source reference and variable bindings.')
	);
	const dl = el('dl', 'cf-meta-grid');
	for (const [k, v] of [
		['Module declaration', info.moduleNode.label],
		['Upstream bindings', `${info.inputs.length} input connection(s)`],
		['Downstream consumers', `${info.outputs.length} output consumer(s)`],
		['Boundary diagnostics', `${info.diagnostics.length} finding(s)`],
	] as const) {
		dl.append(el('dt', undefined, k), el('dd', k === 'Module declaration' ? 'cf-mono' : undefined, v));
	}
	centerPane.append(dl);
	if (info.diagnostics.length > 0) {
		const diagSec = el('div', 'cf-inspector-section');
		diagSec.append(el('h3', 'cf-section-title', `Boundary diagnostics (${info.diagnostics.length})`));
		for (const diag of info.diagnostics) {
			const card = el('div', `cf-diag cf-diag-${diag.severity.toLowerCase()}`);
			card.append(el('div', 'cf-diag-head cf-mono', `${diag.code} · ${diag.severity}`), el('div', 'cf-diag-msg', diag.message));
			diagSec.append(card);
		}
		centerPane.append(diagSec);
	}
	columns.append(centerPane);

	const outPane = el('aside', 'cf-ws-pane');
	outPane.append(el('h2', 'cf-ws-pane-title', `Module Outputs (${info.outputs.length})`));
	if (info.outputs.length === 0) {
		outPane.append(el('p', 'cf-muted', 'No downstream root resources reference this module statically.'));
	} else {
		const list = el('div', 'cf-dep-list');
		for (const item of info.outputs) {
			const btn = el('button', 'cf-dep-btn');
			btn.type = 'button';
			btn.append(
				el('span', 'cf-dep-name', item.node.name),
				el('span', 'cf-dep-meta cf-mono', `${item.edgeKind} · ${item.node.resourceType ?? item.node.kind}`)
			);
			btn.addEventListener('click', () => {
				drilledModuleId = null;
				selectNode(item.node.id, { focusInCanvas: true });
			});
			list.append(btn);
		}
		outPane.append(list);
	}
	columns.append(outPane);

	overlay.append(columns);
	return overlay;
}

function renderExtractModuleModal(): HTMLElement | null {
	const current = activeGraph();
	if (!extractModuleModalOpen || !current) {
		return null;
	}
	const preview = buildExtractModulePreview(current, [...selectedIds], extractModuleName);
	if (!preview) {
		return null;
	}

	const backdrop = el('div', 'cf-modal-backdrop');
	backdrop.addEventListener('click', event => {
		if (event.target === backdrop) {
			closeExtractModuleModal();
		}
	});

	const dialog = el('section', 'cf-modal cf-extract-modal');
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Extract to Module Refactoring Preview');

	const head = el('header', 'cf-modal-header');
	const titleGroup = el('div', 'cf-header-group');
	titleGroup.append(
		el('strong', undefined, 'Extract to Module (Read-Only Preview)'),
		el('span', 'cf-pill', `${preview.selectedNodes.length} resource(s)`),
		el('span', 'cf-pill', `${preview.inferredInputs.length} input(s) · ${preview.inferredOutputs.length} output(s)`)
	);
	const closeBtn = el('button', 'cf-btn cf-extract-close', 'Close');
	closeBtn.type = 'button';
	closeBtn.addEventListener('click', () => closeExtractModuleModal());
	head.append(titleGroup, closeBtn);
	dialog.append(head);

	const body = el('div', 'cf-modal-body');
	const nameBar = el('div', 'cf-save-bar');
	const nameField = el('label', 'cf-save-field');
	nameField.append(el('span', undefined, 'Module name'));
	const nameInput = el('input', 'cf-input cf-mono');
	nameInput.type = 'text';
	nameInput.value = extractModuleName;
	nameInput.setAttribute('aria-label', 'Extracted module name');
	nameInput.addEventListener('change', () => {
		extractModuleName = nameInput.value.trim() || 'network_core';
		render();
	});
	nameField.append(nameInput);
	nameBar.append(nameField);
	body.append(nameBar);

	const tabs = el('div', 'cf-segmented');
	for (const [id, label] of [
		['call', 'module call'],
		['moved', 'state moved {}'],
		['variables', `variables.tf (${preview.inferredInputs.length})`],
		['outputs', `outputs.tf (${preview.inferredOutputs.length})`],
	] as const) {
		const btn = el('button', 'cf-seg-btn', label);
		btn.type = 'button';
		btn.setAttribute('aria-pressed', String(extractModuleTab === id));
		btn.addEventListener('click', () => {
			extractModuleTab = id;
			render();
		});
		tabs.append(btn);
	}
	body.append(tabs);

	const codeText = extractModuleTab === 'call'
		? preview.moduleCallHcl
		: extractModuleTab === 'moved'
			? preview.movedBlocksHcl
			: extractModuleTab === 'variables'
				? preview.variablesHcl
				: preview.outputsHcl;
	body.append(
		el('pre', 'cf-hcl-preview cf-mono', codeText),
		el('p', 'cf-muted', 'Review state migration moved {} blocks before refactoring live Terraform modules to avoid resource replacement.')
	);
	dialog.append(body);
	backdrop.append(dialog);
	return backdrop;
}

function renderHistoryModal(): HTMLElement | null {
	const current = activeGraph();
	if (!historyModalOpen || !draftDoc || !current) {
		return null;
	}
	const doc = draftDoc;

	const backdrop = el('div', 'cf-modal-backdrop');
	backdrop.addEventListener('click', event => {
		if (event.target === backdrop) {
			closeHistoryModal();
		}
	});

	const dialog = el('section', 'cf-modal cf-history-modal');
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Checkpoints, Experiments & Sample Validation Context');

	const head = el('header', 'cf-modal-header');
	const titleGroup = el('div', 'cf-header-group');
	titleGroup.append(
		el('strong', undefined, 'History, Experiments & Sample Context'),
		el('span', 'cf-pill cf-mono', `rev ${current.sourceRevision.slice(0, 8)}`)
	);
	const closeBtn = el('button', 'cf-btn cf-history-close', 'Close');
	closeBtn.type = 'button';
	closeBtn.addEventListener('click', () => closeHistoryModal());
	head.append(titleGroup, closeBtn);
	dialog.append(head);

	const body = el('div', 'cf-modal-body');

	const tabs = el('div', 'cf-segmented');
	for (const [id, label] of [
		['checkpoints', `Checkpoints (${state.checkpoints.length})`],
		['experiments', activeExperiment ? `Experiment: ${activeExperiment.name}` : 'Experiments'],
		['sample', state.sampleContext ? 'Sample Context (Active)' : 'Sample Context'],
	] as const) {
		const btn = el('button', 'cf-seg-btn', label);
		btn.type = 'button';
		btn.setAttribute('aria-pressed', String(historyModalTab === id));
		btn.addEventListener('click', () => {
			historyModalTab = id;
			render();
		});
		tabs.append(btn);
	}
	body.append(tabs);

	if (historyModalTab === 'checkpoints') {
		const bar = el('div', 'cf-save-bar');
		const nameIn = el('input', 'cf-input');
		nameIn.type = 'text';
		nameIn.placeholder = 'Checkpoint name (e.g. Pre-firewall baseline)';
		nameIn.value = checkpointNameInput;
		nameIn.setAttribute('aria-label', 'Checkpoint name');
		nameIn.addEventListener('input', () => { checkpointNameInput = nameIn.value; });

		const noteIn = el('input', 'cf-input');
		noteIn.type = 'text';
		noteIn.placeholder = 'Optional note';
		noteIn.value = checkpointNoteInput;
		noteIn.setAttribute('aria-label', 'Checkpoint note');
		noteIn.addEventListener('input', () => { checkpointNoteInput = noteIn.value; });

		const saveCpBtn = el('button', 'cf-btn cf-btn-primary', 'Save Checkpoint');
		saveCpBtn.type = 'button';
		saveCpBtn.addEventListener('click', () => {
			const cp = captureCheckpoint(doc, checkpointNameInput || `Checkpoint ${state.checkpoints.length + 1}`, {
				note: checkpointNoteInput || undefined,
			});
			state = { ...state, checkpoints: appendCheckpoint(state.checkpoints, cp) };
			checkpointNameInput = '';
			checkpointNoteInput = '';
			schedulePersistViewState();
			render();
		});
		bar.append(nameIn, noteIn, saveCpBtn);
		body.append(bar);

		if (state.checkpoints.length === 0) {
			body.append(el('p', 'cf-muted', 'No named checkpoints yet. Capture a semantic checkpoint before making major architecture changes; drag-only layout moves are never duplicated into checkpoints.'));
		} else {
			const list = el('div', 'cf-dep-list');
			for (const cp of [...state.checkpoints].reverse()) {
				const card = el('div', 'cf-stage-card');
				const row = el('div', 'cf-save-preview-meta');
				const meta = el('div', 'cf-header-group');
				meta.append(
					el('strong', undefined, cp.name),
					el('span', 'cf-pill cf-mono', `rev ${cp.baseSourceRevision.slice(0, 8)}`),
					el('span', 'cf-pill', `${cp.nodes.length} resources · ${cp.edges.length} edges`),
					el('span', 'cf-muted', cp.createdAtIso.slice(0, 19).replace('T', ' '))
				);
				const acts = el('div', 'cf-header-group');
				const cmpBtn = el('button', 'cf-btn', compareCheckpointId === cp.id ? 'Hide Diff' : 'Compare');
				cmpBtn.type = 'button';
				cmpBtn.addEventListener('click', () => {
					compareCheckpointId = compareCheckpointId === cp.id ? null : cp.id;
					render();
				});
				const restoreBtn = el('button', 'cf-btn cf-btn-primary', 'Restore');
				restoreBtn.type = 'button';
				restoreBtn.title = 'Automatically saves a backup checkpoint of current work before restoring';
				restoreBtn.addEventListener('click', () => {
					const backup = captureCheckpoint(doc, `Auto-backup before restoring "${cp.name}"`);
					state = { ...state, checkpoints: appendCheckpoint(state.checkpoints, backup) };
					schedulePersistViewState();
					const restoredState = checkpointToDraftState(cp, doc);
					commitDraftEdit({ type: 'restoreSnapshot', reason: `Restore checkpoint: ${cp.name}`, snapshot: restoredState });
					render();
				});
				const delBtn = el('button', 'cf-btn cf-btn-danger', 'Delete');
				delBtn.type = 'button';
				delBtn.addEventListener('click', () => {
					state = { ...state, checkpoints: state.checkpoints.filter(c => c.id !== cp.id) };
					if (compareCheckpointId === cp.id) {
						compareCheckpointId = null;
					}
					schedulePersistViewState();
					render();
				});
				acts.append(cmpBtn, restoreBtn, delBtn);
				row.append(meta, acts);
				card.append(row);
				if (cp.note) {
					card.append(el('p', 'cf-muted', cp.note));
				}
				if (compareCheckpointId === cp.id) {
					const diff = compareSemanticSnapshots(
						{ nodes: cp.nodes, edges: cp.edges, modifiedDraftIds: cp.modifiedDraftIds },
						{ nodes: doc.present.nodes, edges: doc.present.edges, modifiedDraftIds: Object.keys(doc.present.drafts) }
					);
					const diffBox = el('div', 'cf-save-preview-card');
					if (!diff.hasChanges) {
						diffBox.append(el('span', 'cf-muted', 'No semantic differences between this checkpoint and the current working draft.'));
					} else {
						diffBox.append(el('strong', undefined, `Diff vs Current Draft: +${diff.addedNodes.length} added, -${diff.removedNodes.length} removed, ~${diff.modifiedDraftIds.length} draft change(s), +${diff.addedEdges.length}/-${diff.removedEdges.length} edges`));
						for (const n of diff.addedNodes) {
							diffBox.append(el('div', 'cf-mono cf-diff-add', `+ ${n.label}`));
						}
						for (const n of diff.removedNodes) {
							diffBox.append(el('div', 'cf-mono cf-diff-rem', `- ${n.label}`));
						}
					}
					card.append(diffBox);
				}
				list.append(card);
			}
			body.append(list);
		}
	} else if (historyModalTab === 'experiments') {
		if (!activeExperiment) {
			body.append(el('p', 'cf-muted', 'Start an isolated local design experiment to explore topology changes, review the semantic diff against your baseline, and either promote or discard cleanly without touching disk or credentials.'));
			const bar = el('div', 'cf-save-bar');
			const expIn = el('input', 'cf-input');
			expIn.type = 'text';
			expIn.placeholder = 'Experiment name (e.g. Zero-Trust Spoke Split)';
			expIn.value = experimentNameInput;
			expIn.setAttribute('aria-label', 'Experiment name');
			expIn.addEventListener('input', () => { experimentNameInput = expIn.value; });
			const startBtn = el('button', 'cf-btn cf-btn-primary', 'Start Experiment');
			startBtn.type = 'button';
			startBtn.addEventListener('click', () => {
				activeExperiment = startExperimentSession(doc, experimentNameInput || 'Topology Experiment');
				experimentNameInput = '';
				render();
			});
			bar.append(expIn, startBtn);
			body.append(bar);
		} else {
			const exp = activeExperiment;
			const diff = compareSemanticSnapshots(
				{ nodes: exp.baselineState.nodes, edges: exp.baselineState.edges, modifiedDraftIds: Object.keys(exp.baselineState.drafts) },
				{ nodes: doc.present.nodes, edges: doc.present.edges, modifiedDraftIds: Object.keys(doc.present.drafts) }
			);
			const card = el('div', 'cf-save-preview-card');
			card.append(
				el('strong', undefined, `Active Experiment: ${exp.name}`),
				el('span', 'cf-muted', `Started ${exp.createdAtIso.slice(0, 19).replace('T', ' ')} UTC on base rev ${exp.baseSourceRevision.slice(0, 8)}.`),
				el('div', 'cf-mono', diff.hasChanges
					? `Changes vs baseline: +${diff.addedNodes.length} nodes, -${diff.removedNodes.length} nodes, +${diff.addedEdges.length}/-${diff.removedEdges.length} edges`
					: 'No changes made in this experiment yet.')
			);
			const acts = el('div', 'cf-action-row');
			const promoteBtn = el('button', 'cf-btn cf-btn-primary', 'Promote to Working Draft');
			promoteBtn.type = 'button';
			promoteBtn.addEventListener('click', () => {
				const cp = captureCheckpoint(doc, `Promoted experiment: ${exp.name}`);
				state = { ...state, checkpoints: appendCheckpoint(state.checkpoints, cp) };
				activeExperiment = undefined;
				schedulePersistViewState();
				render();
			});
			const discardBtn = el('button', 'cf-btn cf-btn-danger', 'Discard Experiment');
			discardBtn.type = 'button';
			discardBtn.addEventListener('click', () => {
				const baseline = exp.baselineState;
				activeExperiment = undefined;
				commitDraftEdit({ type: 'restoreSnapshot', reason: `Discard experiment: ${exp.name}`, snapshot: baseline });
				render();
			});
			acts.append(promoteBtn, discardBtn);
			card.append(acts);
			body.append(card);
		}
	} else {
		body.append(el('p', 'cf-muted', 'Pin a clearly labelled, non-secret sample validation context to record target environment, region, and captured source revision across draft validation runs.'));
		const staleCtx = isSampleContextStale(state.sampleContext, current.sourceRevision);
		if (state.sampleContext) {
			const ctxCard = el('div', staleCtx ? 'cf-save-warnings' : 'cf-save-preview-card');
			ctxCard.append(
				el('strong', undefined, `${state.sampleContext.label} (${state.sampleContext.environment} · ${state.sampleContext.region})`),
				el('span', 'cf-mono', `Pinned to rev ${state.sampleContext.sourceRevision.slice(0, 8)} · ${state.sampleContext.schemaVersion} · captured ${state.sampleContext.capturedAtIso.slice(0, 19).replace('T', ' ')} UTC`),
				el('span', 'cf-muted', staleCtx ? 'Freshness: STALE — architecture source revision changed since capture.' : 'Freshness: CURRENT — matches active architecture revision.')
			);
			const row = el('div', 'cf-action-row');
			if (staleCtx) {
				const refreshBtn = el('button', 'cf-btn cf-btn-primary', 'Re-pin to Current Revision');
				refreshBtn.type = 'button';
				refreshBtn.addEventListener('click', () => {
					if (state.sampleContext) {
						state = { ...state, sampleContext: { ...state.sampleContext, sourceRevision: current.sourceRevision, capturedAtIso: new Date().toISOString() } };
						schedulePersistViewState();
						render();
					}
				});
				row.append(refreshBtn);
			}
			const clearBtn = el('button', 'cf-btn cf-btn-danger', 'Clear Sample Context');
			clearBtn.type = 'button';
			clearBtn.addEventListener('click', () => {
				state = { ...state, sampleContext: null };
				schedulePersistViewState();
				render();
			});
			row.append(clearBtn);
			ctxCard.append(row);
			body.append(ctxCard);
		}

		const form = el('div', 'cf-export-controls');
		const lblField = el('label', 'cf-export-field');
		lblField.append(el('span', undefined, 'Context label'));
		const lblIn = el('input', 'cf-input');
		lblIn.type = 'text';
		lblIn.value = sampleLabelInput;
		lblIn.setAttribute('aria-label', 'Sample context label');
		lblIn.addEventListener('input', () => { sampleLabelInput = lblIn.value; });
		lblField.append(lblIn);

		const envField = el('label', 'cf-export-field');
		envField.append(el('span', undefined, 'Environment'));
		const envSel = el('select', 'cf-select');
		envSel.setAttribute('aria-label', 'Sample environment');
		for (const env of ['dev', 'staging', 'prod'] as const) {
			const opt = el('option', undefined, env);
			opt.value = env;
			opt.selected = sampleEnvInput === env;
			envSel.append(opt);
		}
		envSel.addEventListener('change', () => { sampleEnvInput = envSel.value as 'dev' | 'staging' | 'prod'; });
		envField.append(envSel);

		const regField = el('label', 'cf-export-field');
		regField.append(el('span', undefined, 'Target region'));
		const azureRegions = cloudRegionsByProvider.get('azure')?.regions.map(r => r.name) ?? ['uksouth', 'ukwest', 'eastus', 'westeurope', 'swedencentral'];
		const regSel = el('select', 'cf-select');
		regSel.setAttribute('aria-label', 'Sample target region');
		for (const r of azureRegions) {
			const opt = el('option', undefined, r);
			opt.value = r;
			opt.selected = sampleRegionInput === r;
			regSel.append(opt);
		}
		regSel.addEventListener('change', () => { sampleRegionInput = regSel.value; });
		regField.append(regSel);
		form.append(lblField, envField, regField);
		body.append(form);

		const pinBtn = el('button', 'cf-btn cf-btn-primary', 'Pin Sample Context');
		pinBtn.type = 'button';
		pinBtn.addEventListener('click', () => {
			state = {
				...state,
				sampleContext: {
					label: sampleLabelInput.trim() || 'Sample Context',
					environment: sampleEnvInput,
					region: sampleRegionInput,
					capturedAtIso: new Date().toISOString(),
					sourceRevision: current.sourceRevision,
					schemaVersion: 'hashicorp/azurerm 5.14.0',
				},
			};
			schedulePersistViewState();
			render();
		});
		body.append(pinBtn);
	}

	dialog.append(body);
	backdrop.append(dialog);
	return backdrop;
}

function render(): void {
	root.dataset.theme = state.theme;
	root.dataset.mode = state.mode;
	root.replaceChildren();

	root.append(renderHeader());
	const banner = renderNoticeBanner();
	if (banner) {
		root.append(banner);
	}

	const current = activeGraph();
	if (!current) {
		const empty = el('div', 'cf-empty-state');
		empty.append(el('p', undefined, emptyMessage));
		root.append(empty);
		return;
	}

	if (drilledModuleId) {
		const modView = renderModuleDrillDown(drilledModuleId);
		if (modView) {
			root.append(modView);
			const hModal = renderHistoryModal();
			if (hModal) {
				root.append(hModal);
			}
			const eModal = renderExportModal();
			if (eModal) {
				root.append(eModal);
			}
			return;
		}
		drilledModuleId = null;
	}

	const selected = nodeById(state.selectedId);
	if (state.focusedWorkspaceOpen && selected) {
		root.append(renderFocusedWorkspace(selected));
		if (timelineOpen) {
			root.append(renderTimeline());
		}
		const modal = renderHclReviewModal();
		if (modal) {
			root.append(modal);
		}
		const exportModal = renderExportModal();
		if (exportModal) {
			root.append(exportModal);
		}
		const historyModal = renderHistoryModal();
		if (historyModal) {
			root.append(historyModal);
		}
		return;
	}

	const body = el('div', 'cf-body');
	if (state.listOpen) {
		body.append(renderResourceList());
	}
	body.append(renderStage());
	if (state.inspectorOpen) {
		body.append(renderInspector());
	}
	root.append(body);
	if (timelineOpen) {
		root.append(renderTimeline());
	}
	const modal = renderHclReviewModal();
	if (modal) {
		root.append(modal);
	}
	const exportModal = renderExportModal();
	if (exportModal) {
		root.append(exportModal);
	}
	const extractModal = renderExtractModuleModal();
	if (extractModal) {
		root.append(extractModal);
	}
	const historyModal = renderHistoryModal();
	if (historyModal) {
		root.append(historyModal);
	}
}

// Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z / Ctrl+Y (redo), Ctrl/Cmd+Shift+E (export),
// Ctrl/Cmd+Shift+H (history/experiments), / (search), ArrowUp/ArrowDown (cycle resources),
// Enter (open resource/module), O (open source), F (fit), Escape (close overlay).
window.addEventListener('keydown', event => {
	const target = event.target;
	const inInput = target instanceof HTMLElement && target.matches('input, textarea, select');
	if (event.key === 'Escape') {
		if (historyModalOpen) {
			event.preventDefault();
			closeHistoryModal();
			return;
		}
		if (extractModuleModalOpen) {
			event.preventDefault();
			closeExtractModuleModal();
			return;
		}
		if (exportModalOpen) {
			event.preventDefault();
			closeExportModal();
			return;
		}
		if (hclReviewOpen) {
			event.preventDefault();
			closeHclReviewModal();
			return;
		}
		if (drilledModuleId) {
			event.preventDefault();
			closeModuleDrillDown();
			return;
		}
		if (state.focusedWorkspaceOpen) {
			event.preventDefault();
			closeFocusedWorkspace();
		}
		return;
	}
	const current = activeGraph();
	if (inInput || !current) {
		return;
	}
	const mod = event.ctrlKey || event.metaKey;
	if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
		event.preventDefault();
		openExportModal();
		return;
	}
	if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'h') {
		event.preventDefault();
		openHistoryModal('checkpoints');
		return;
	}
	if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
		event.preventDefault();
		if (event.shiftKey) {
			performRedo();
		} else {
			performUndo();
		}
		return;
	}
	if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'y') {
		event.preventDefault();
		performRedo();
		return;
	}
	if (event.key === '/') {
		event.preventDefault();
		if (!state.listOpen) {
			state = { ...state, listOpen: true };
			render();
			applyViewportTransform();
		}
		root.querySelector<HTMLInputElement>('.cf-search')?.focus();
	} else if (event.key.toLowerCase() === 'f') {
		event.preventDefault();
		if (state.selectedId) {
			fitNode(state.selectedId);
		} else {
			fitGraph(true);
		}
	} else if (event.key.toLowerCase() === 'o' && state.selectedId && notice?.kind !== 'stale') {
		const selected = nodeById(state.selectedId);
		if (selected?.hasSource) {
			event.preventDefault();
			post({ type: 'openSource', nodeId: selected.id });
		}
	} else if (event.key === 'Enter' && state.selectedId && !state.focusedWorkspaceOpen && !hclReviewOpen && !(target instanceof HTMLButtonElement && !target.classList.contains('cf-node'))) {
		event.preventDefault();
		openFocusedWorkspace(state.selectedId);
	} else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && projection && projection.nodes.length > 0 && !state.focusedWorkspaceOpen && !hclReviewOpen) {
		event.preventDefault();
		const ids = projection.nodes.map(n => n.node.id);
		const idx = state.selectedId ? ids.indexOf(state.selectedId) : -1;
		const nextIdx = event.key === 'ArrowDown'
			? (idx + 1) % ids.length
			: (idx <= 0 ? ids.length - 1 : idx - 1);
		selectNode(ids[nextIdx], { focusInCanvas: true });
	}
});

window.addEventListener('message', event => {
	const message = event.data as ExtensionToWebviewMessage | undefined;
	if (!message || typeof message !== 'object') {
		return;
	}
	switch (message.type) {
		case 'graph':
			draftDoc = createDraftDocument(message.graph);
			dependencyReport = null;
			hclReviewOpen = false;
			exportModalOpen = false;
			extractModuleModalOpen = false;
			historyModalOpen = false;
			drilledModuleId = null;
			activeExperiment = undefined;
			expandedPaginatedGroups.clear();
			exportBusy = false;
			exportStatusMessage = undefined;
			connectFeedback = undefined;
			validationInFlight = false;
			resetSavePreviewState();
			state = message.viewState;
			selectedIds.clear();
			if (state.selectedId) {
				selectedIds.add(state.selectedId);
			}
			notice = message.notice;
			currentRun = currentRun && currentRun.architectureId === message.graph.architectureId
				? syncRunWithRevision(currentRun, message.graph.sourceRevision)
				: undefined;
			rebuildProjection();
			render();
			fitGraph(false);
			break;
		case 'selectNode':
			selectNode(message.nodeId, { notifyExtension: false, focusInCanvas: message.nodeId !== null });
			break;
		case 'notice':
			notice = message.notice;
			render();
			applyViewportTransform();
			break;
		case 'empty':
			draftDoc = undefined;
			projection = undefined;
			currentRun = undefined;
			validationInFlight = false;
			hclReviewOpen = false;
			connectFeedback = undefined;
			resetSavePreviewState();
			notice = null;
			emptyMessage = message.message;
			render();
			break;
		case 'runValidation':
			startValidation(message.scope, message.nodeId, message.localOnly === true);
			break;
		case 'cancelValidation':
			cancelActiveRun();
			break;
		case 'validationRunUpdate':
			currentRun = message.run;
			validationInFlight = message.run.outcome === 'running';
			timelineOpen = true;
			render();
			applyViewportTransform();
			break;
		case 'draftSavePreview':
			if (message.result.ok) {
				savePhase = 'previewReady';
				savePreview = message.result.preview;
				saveError = undefined;
			} else {
				savePhase = 'idle';
				savePreview = undefined;
				saveError = message.result.error;
			}
			render();
			break;
		case 'draftSaveApplied':
			if (message.result.ok) {
				resetSavePreviewState();
				hclReviewOpen = false;
			} else {
				savePhase = 'idle';
				savePreview = undefined;
				saveError = message.result.error;
			}
			render();
			break;
		case 'catalogueSnapshots':
			catalogueSnapshots = message.snapshots;
			render();
			applyViewportTransform();
			break;
		case 'liveSchema':
			pendingSchemaRequests.delete(message.typeName);
			liveSchemas.set(message.typeName, message.schema);
			if (state.focusedWorkspaceOpen || hclReviewOpen) {
				render();
			}
			break;
		case 'cloudRegions':
			cloudRegionsByProvider.set(message.data.provider, message.data);
			if (state.focusedWorkspaceOpen) {
				render();
			}
			break;
		case 'dependencyReport':
			dependencyReport = message.report;
			if (state.inspectorOpen || exportModalOpen) {
				render();
				applyViewportTransform();
			}
			break;
		case 'openExport':
			openExportModal();
			break;
		case 'exportResult':
			exportBusy = false;
			exportStatusMessage = { ok: message.ok, text: message.message };
			render();
			break;
	}
});

render();
post({ type: 'ready' });
