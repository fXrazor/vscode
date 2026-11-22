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
	buildCanvasProjection,
	fitRectToStage,
	inferProvider,
	providerDisplayName,
	type CanvasProjection,
	type PositionedNode
} from '../src/canvas/layout';
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
	defaultCanvasViewState,
	isValidTfFileName,
	type CanvasCatalogueSnapshot,
	type CanvasGraphSnapshot,
	type CanvasGridMode,
	type CanvasNodeSummary,
	type CanvasNotice,
	type CanvasTheme,
	type CanvasViewMode,
	type CanvasViewport,
	type CanvasViewState,
	type DraftSaveError,
	type DraftSavePreviewResult,
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
let saveFileName = 'cloudforge_draft.tf';
let savePhase: 'idle' | 'previewing' | 'previewReady' | 'applying' = 'idle';
let savePreview: DraftSavePreviewResult | undefined;
let savePreviewHcl: string | undefined;
let saveError: DraftSaveError | undefined;

function resetSavePreviewState(): void {
	savePhase = 'idle';
	savePreview = undefined;
	savePreviewHcl = undefined;
	saveError = undefined;
}

function lookupEffectiveSchema(node: Pick<CanvasNodeSummary, 'kind' | 'resourceType'>): FormSchema | undefined {
	if (node.resourceType) {
		const live = liveSchemas.get(node.resourceType);
		if (live) {
			return live;
		}
	}
	return lookupBundledSchema(node);
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

function selectNode(nodeId: string | null, options?: { notifyExtension?: boolean; focusInCanvas?: boolean }): void {
	const changed = state.selectedId !== nodeId;
	state = {
		...state,
		selectedId: nodeId,
		focusedWorkspaceOpen: nodeId !== null ? state.focusedWorkspaceOpen : false,
		inspectorOpen: nodeId !== null ? true : state.inspectorOpen,
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
	lastFocusBeforeWorkspace = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	state = { ...state, selectedId: nodeId, focusedWorkspaceOpen: true };
	post({ type: 'selectNode', nodeId });
	const node = nodeById(nodeId);
	if (node) {
		maybeRequestLiveSchema(node);
	}
	render();
	schedulePersistViewState();
	const backBtn = root.querySelector<HTMLButtonElement>('.cf-back-btn');
	backBtn?.focus();
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
	projection = buildCanvasProjection(current, state.mode, searchQuery, new Set(state.collapsedGroups));
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

function renderHeader(): HTMLElement {
	const current = activeGraph();
	const summary = draftDoc ? computeDraftChangeSummary(draftDoc) : undefined;
	const hasHistory = !!draftDoc && (draftDoc.past.length > 0 || draftDoc.future.length > 0 || !!summary?.dirty);

	const header = el('header', 'cf-header');
	const left = el('div', 'cf-header-group');
	const title = el('h1', 'cf-title', current ? current.architectureName : 'CloudForge Canvas');
	left.append(title);

	if (current) {
		left.append(el('span', 'cf-pill cf-mono', `rev ${current.sourceRevision.slice(0, 8)}`));
		if (summary?.dirty) {
			left.append(el(
				'span',
				'cf-pill cf-pill-warn',
				`Unsaved draft (+${summary.added.length} / ~${summary.modified.length} / -${summary.deleted.length})`
			));
		} else {
			left.append(el(
				'span',
				`cf-pill ${current.status === 'partial' ? 'cf-pill-warn' : 'cf-pill-ok'}`,
				current.status === 'partial' ? 'Partial coverage' : 'Read-only Terraform'
			));
		}
		if (projection) {
			const countText = projection.hiddenByFilterOrCollapse > 0
				? `${projection.visibleNodes} / ${projection.totalNodes} visible`
				: `${projection.totalNodes} resource${projection.totalNodes === 1 ? '' : 's'}`;
			left.append(el('span', 'cf-pill', countText));
		}
		if (current.diagnostics.length > 0) {
			left.append(el('span', 'cf-pill cf-pill-warn', `${current.diagnostics.length} diagnostic${current.diagnostics.length === 1 ? '' : 's'}`));
		}
		if (validationInFlight) {
			left.append(el('span', 'cf-pill cf-pill-warn', 'Validating (Rust)…'));
		} else if (currentRun) {
			const outcomeCls = currentRun.outcome === 'failed'
				? 'cf-pill-err'
				: currentRun.outcome === 'completed'
					? 'cf-pill-ok'
					: 'cf-pill-warn';
			const runText = `Run #${currentRun.attempt}: ${currentRun.outcome.replace(/_/g, ' ')} (${currentRun.coverage} coverage${currentRun.stale ? ', stale' : ''})`;
			left.append(el('span', `cf-pill ${outcomeCls}`, runText));
		}
		if (catalogueSnapshots.length > 0) {
			left.append(el('span', 'cf-pill', `${catalogueSnapshots.length} verified catalogue${catalogueSnapshots.length === 1 ? '' : 's'}`));
		}
	}
	header.append(left);

	const right = el('div', 'cf-header-group');

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
		for (const item of ADDABLE_RESOURCE_TYPES) {
			const btn = el('button', 'cf-menu-item');
			btn.type = 'button';
			btn.append(
				el('span', 'cf-dep-name', item.shortLabel),
				el('span', 'cf-dep-meta cf-mono', item.typeName)
			);
			btn.addEventListener('click', () => {
				addDetails.open = false;
				addNewResource(item.typeName, item.defaultName);
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
			const reviewBtn = el('button', 'cf-btn', 'Review HCL');
			reviewBtn.type = 'button';
			reviewBtn.title = 'Inspect deterministic generated Terraform HCL preview (read-only)';
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
	listBtn.title = 'Toggle resource list';
	listBtn.addEventListener('click', () => {
		state = { ...state, listOpen: !state.listOpen };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	const inspBtn = el('button', 'cf-btn', 'Inspector');
	inspBtn.type = 'button';
	inspBtn.setAttribute('aria-pressed', String(state.inspectorOpen));
	inspBtn.title = 'Toggle inspector panel';
	inspBtn.addEventListener('click', () => {
		state = { ...state, inspectorOpen: !state.inspectorOpen };
		render();
		applyViewportTransform();
		schedulePersistViewState();
	});

	// View options disclosure (Theme + Grid)
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

	viewMenu.append(themeLabel, gridLabel);
	viewDetails.append(viewMenu);
	viewDetails.addEventListener('keydown', event => {
		if (event.key === 'Escape' && viewDetails.open) {
			event.preventDefault();
			viewDetails.open = false;
			viewSummary.focus();
		}
	});

	const fitBtn = el('button', 'cf-btn', 'Fit');
	fitBtn.type = 'button';
	fitBtn.title = 'Fit graph to view (F)';
	fitBtn.addEventListener('click', () => {
		if (state.selectedId) {
			fitNode(state.selectedId);
		} else {
			fitGraph(true);
		}
	});

	const validateBtn = el('button', 'cf-btn cf-btn-primary', currentRun ? 'Revalidate' : 'Validate');
	validateBtn.type = 'button';
	validateBtn.disabled = !current;
	validateBtn.title = 'Run offline architecture validation (read, dependencies, static & schema checks)';
	validateBtn.addEventListener('click', () => startValidation('architecture'));

	const timelineBtn = el('button', 'cf-btn', 'Timeline');
	timelineBtn.type = 'button';
	timelineBtn.setAttribute('aria-pressed', String(timelineOpen));
	timelineBtn.title = 'Toggle Runner Timeline panel';
	timelineBtn.addEventListener('click', () => {
		timelineOpen = !timelineOpen;
		render();
		applyViewportTransform();
	});

	const refreshBtn = el('button', 'cf-btn', 'Refresh');
	refreshBtn.type = 'button';
	refreshBtn.title = 'Re-read architecture from CloudForge service';
	refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));

	right.append(listBtn, inspBtn, timelineBtn, viewDetails, fitBtn, validateBtn, refreshBtn);
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
				el('span', 'cf-group-count', `${group.visibleCount}`)
			);
			head.addEventListener('click', event => {
				event.stopPropagation();
				toggleGroupCollapsed(group.id);
			});
			box.append(head);
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
			const dx = Math.max(40, Math.abs(edge.toX - edge.fromX) * 0.45);
			const d = `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + dx} ${edge.fromY}, ${edge.toX - dx} ${edge.toY}, ${edge.toX} ${edge.toY}`;
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
	}
	stage.append(world);

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

	// Pointer pan & wheel zoom
	stage.addEventListener('pointerdown', event => {
		if (event.button !== 0 || (event.target as HTMLElement).closest('.cf-node, .cf-group-header, .cf-zoom-bar')) {
			return;
		}
		stage.setPointerCapture(event.pointerId);
		dragging = { startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y };
		stage.classList.add('dragging');
	});
	stage.addEventListener('pointermove', event => {
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

function renderNodeCard(item: PositionedNode): HTMLElement {
	const selected = item.node.id === state.selectedId;
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

	if (state.mode === 'visual') {
		const top = el('div', 'cf-node-top');
		top.append(el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
		if (badgeInfo && runResult) {
			top.append(el('span', `cf-status-badge cf-badge-${runResult.status}`, `${badgeInfo.icon} ${badgeInfo.text}`));
		} else if (isDraftAdded) {
			top.append(el('span', 'cf-draft-tag', 'Draft'));
		} else {
			top.append(el('span', 'cf-kind-tag', item.node.kind));
		}
		card.append(top);
		card.append(el('div', 'cf-node-name', item.node.name));
		card.append(el('div', 'cf-node-type cf-mono', item.node.resourceType ?? item.node.label));
	} else {
		const head = el('div', 'cf-tech-head');
		head.append(el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
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

	card.addEventListener('click', event => {
		event.stopPropagation();
		selectNode(item.node.id);
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

	const selected = nodeById(state.selectedId);
	if (!selected) {
		const empty = el('div', 'cf-inspector-section');
		empty.append(
			el('h2', 'cf-section-title', 'Inspector'),
			el('p', 'cf-muted', 'Click any resource to inspect its dependencies, author draft edits, or open its Terraform source. Double-click or press Enter to open the focused resource workspace.')
		);
		aside.append(empty);
		if (current && current.diagnostics.length > 0) {
			aside.append(renderDiagnosticsSection(current));
		}
		return aside;
	}

	const provider = inferProvider(selected);
	const isStale = notice?.kind === 'stale';
	const { upstream, downstream } = relatedEdges(selected.id);

	const summary = el('div', 'cf-inspector-section');
	summary.append(
		el('div', 'cf-inspector-kicker', `${providerDisplayName(provider)} · ${selected.kind}`),
		el('h2', 'cf-inspector-title', selected.name),
		el('div', 'cf-mono cf-inspector-type', selected.resourceType ?? selected.label)
	);

	const actions = el('div', 'cf-action-row');
	const openWs = el('button', 'cf-btn cf-btn-primary', 'Open Resource');
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
	return aside;
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
}

// Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z / Ctrl+Y (redo), / (search),
// ArrowUp/ArrowDown (cycle resources), Enter (open resource), O (open source), F (fit),
// Escape (close HCL review modal or focused workspace).
window.addEventListener('keydown', event => {
	const target = event.target;
	const inInput = target instanceof HTMLElement && target.matches('input, textarea, select');
	if (event.key === 'Escape') {
		if (hclReviewOpen) {
			event.preventDefault();
			closeHclReviewModal();
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
			hclReviewOpen = false;
			connectFeedback = undefined;
			validationInFlight = false;
			resetSavePreviewState();
			state = message.viewState;
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
	}
});

render();
post({ type: 'ready' });
