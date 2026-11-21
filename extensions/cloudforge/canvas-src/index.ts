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
	defaultCanvasViewState,
	type CanvasGraphSnapshot,
	type CanvasGridMode,
	type CanvasNodeSummary,
	type CanvasNotice,
	type CanvasTheme,
	type CanvasViewMode,
	type CanvasViewport,
	type CanvasViewState,
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

let graph: CanvasGraphSnapshot | undefined;
let notice: CanvasNotice | null = null;
let emptyMessage = 'Select an architecture in CloudForge Project or run CloudForge: Open Workspace to inspect its infrastructure graph.';
let state: CanvasViewState = defaultCanvasViewState();
let searchQuery = '';
let projection: CanvasProjection | undefined;
let viewport: CanvasViewport = { x: 40, y: 40, zoom: 1 };
let dragging: { startX: number; startY: number; originX: number; originY: number } | undefined;
let persistTimer: number | undefined;
let lastFocusBeforeWorkspace: HTMLElement | null = null;

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

function rebuildProjection(): void {
	if (!graph) {
		projection = undefined;
		return;
	}
	projection = buildCanvasProjection(graph, state.mode, searchQuery, new Set(state.collapsedGroups));
}

function nodeById(id: string | null): CanvasNodeSummary | undefined {
	if (!graph || !id) {
		return undefined;
	}
	return graph.nodes.find(node => node.id === id);
}

function relatedEdges(nodeId: string): { upstream: { node: CanvasNodeSummary; kind: string }[]; downstream: { node: CanvasNodeSummary; kind: string }[] } {
	if (!graph) {
		return { upstream: [], downstream: [] };
	}
	const map = new Map(graph.nodes.map(n => [n.id, n]));
	const upstream: { node: CanvasNodeSummary; kind: string }[] = [];
	const downstream: { node: CanvasNodeSummary; kind: string }[] = [];
	for (const edge of graph.edges) {
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

function renderHeader(): HTMLElement {
	const header = el('header', 'cf-header');
	const left = el('div', 'cf-header-group');
	const title = el('h1', 'cf-title', graph ? graph.architectureName : 'CloudForge Canvas');
	left.append(title);

	if (graph) {
		left.append(el('span', 'cf-pill cf-mono', `rev ${graph.sourceRevision.slice(0, 8)}`));
		left.append(el(
			'span',
			`cf-pill ${graph.status === 'partial' ? 'cf-pill-warn' : 'cf-pill-ok'}`,
			graph.status === 'partial' ? 'Partial coverage' : 'Read-only Terraform'
		));
		if (projection) {
			const countText = projection.hiddenByFilterOrCollapse > 0
				? `${projection.visibleNodes} / ${projection.totalNodes} visible`
				: `${projection.totalNodes} resource${projection.totalNodes === 1 ? '' : 's'}`;
			left.append(el('span', 'cf-pill', countText));
		}
		if (graph.diagnostics.length > 0) {
			left.append(el('span', 'cf-pill cf-pill-warn', `${graph.diagnostics.length} diagnostic${graph.diagnostics.length === 1 ? '' : 's'}`));
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

	const refreshBtn = el('button', 'cf-btn', 'Refresh');
	refreshBtn.type = 'button';
	refreshBtn.title = 'Re-read architecture from CloudForge service';
	refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));

	right.append(listBtn, inspBtn, viewDetails, fitBtn, refreshBtn);
	header.append(right);
	return header;
}

function renderNoticeBanner(): HTMLElement | null {
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
	if (graph && graph.status === 'partial') {
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
			const cls = `cf-edge${edge.collapsedSummary ? ' summary' : ''}${isRelated ? ' active' : ''}${isDimmed ? ' dimmed' : ''}`;
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
	const card = el('button', `cf-node cf-node-${state.mode} cf-provider-${item.provider}${selected ? ' selected' : ''}`);
	card.type = 'button';
	card.dataset.nodeId = item.node.id;
	card.style.left = `${item.x}px`;
	card.style.top = `${item.y}px`;
	card.style.width = `${item.width}px`;
	card.style.height = `${item.height}px`;
	card.setAttribute('aria-pressed', String(selected));
	card.setAttribute('aria-label', `${item.node.name}, ${item.node.resourceType ?? item.node.kind}`);

	if (state.mode === 'visual') {
		const top = el('div', 'cf-node-top');
		top.append(el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
		top.append(el('span', 'cf-kind-tag', item.node.kind));
		card.append(top);
		card.append(el('div', 'cf-node-name', item.node.name));
		card.append(el('div', 'cf-node-type cf-mono', item.node.resourceType ?? item.node.label));
	} else {
		const head = el('div', 'cf-tech-head');
		head.append(el('span', 'cf-provider-tag', providerDisplayName(item.provider)));
		head.append(el('span', 'cf-kind-tag', item.node.kind));
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

	const selected = nodeById(state.selectedId);
	if (!selected) {
		const empty = el('div', 'cf-inspector-section');
		empty.append(
			el('h2', 'cf-section-title', 'Inspector'),
			el('p', 'cf-muted', 'Click any resource to inspect its dependencies and open its Terraform source. Double-click or press Enter to open the focused resource workspace.')
		);
		aside.append(empty);
		if (graph && graph.diagnostics.length > 0) {
			aside.append(renderDiagnosticsSection(graph));
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

	const openSrc = el('button', 'cf-btn', 'Open Source');
	openSrc.type = 'button';
	openSrc.disabled = !selected.hasSource || isStale;
	openSrc.title = isStale
		? 'Refresh the graph before opening source'
		: selected.hasSource
			? 'Open declaration in native Terraform editor (O)'
			: 'No source location available';
	openSrc.addEventListener('click', () => post({ type: 'openSource', nodeId: selected.id }));
	actions.append(openSrc);

	summary.append(actions);
	aside.append(summary);

	aside.append(renderDepListSection('Upstream dependencies', upstream, false));
	aside.append(renderDepListSection('Downstream dependents', downstream, false));

	if (graph && graph.diagnostics.length > 0) {
		aside.append(renderDiagnosticsSection(graph));
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

function renderFocusedWorkspace(selected: CanvasNodeSummary): HTMLElement {
	const overlay = el('section', 'cf-workspace');
	overlay.setAttribute('aria-label', `Focused resource workspace: ${selected.name}`);

	const provider = inferProvider(selected);
	const isStale = notice?.kind === 'stale';
	const { upstream, downstream } = relatedEdges(selected.id);

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
	if (graph) {
		actions.append(el('span', 'cf-pill cf-mono', `rev ${graph.sourceRevision.slice(0, 8)}`));
	}
	const openSrc = el('button', 'cf-btn cf-btn-primary', 'Open Source');
	openSrc.type = 'button';
	openSrc.disabled = !selected.hasSource || isStale;
	openSrc.addEventListener('click', () => post({ type: 'openSource', nodeId: selected.id }));
	actions.append(openSrc);

	top.append(backBtn, heading, actions);
	overlay.append(top);

	const columns = el('div', 'cf-workspace-columns');

	// Left pane — Inputs (n8n pattern)
	const leftPane = el('aside', 'cf-ws-pane');
	leftPane.append(el('h2', 'cf-ws-pane-title', 'Inputs'));
	leftPane.append(renderDepListSection('Upstream resources', upstream, true));
	columns.append(leftPane);

	// Center pane — Resource metadata & source authority
	const centerPane = el('div', 'cf-ws-pane cf-ws-center');
	centerPane.append(el('h2', 'cf-ws-pane-title', 'Resource'));
	const dl = el('dl', 'cf-meta-grid');
	const rows: [string, string][] = [
		['Provider', providerDisplayName(provider)],
		['Declaration kind', selected.kind],
		['Terraform type', selected.resourceType ?? '—'],
		['Name', selected.name],
		['Display label', selected.label],
		['Source authority', 'Read-only Terraform source (verified by CloudForge Rust service)'],
	];
	for (const [k, v] of rows) {
		dl.append(el('dt', undefined, k), el('dd', k === 'Terraform type' || k === 'Display label' ? 'cf-mono' : undefined, v));
	}
	centerPane.append(dl);
	centerPane.append(el('p', 'cf-muted', 'In Phase 1, resource configuration values and edits stay in native Terraform editor tabs. Use Open Source to jump directly to this declaration with revision verification.'));
	columns.append(centerPane);

	// Right pane — Results & Downstream
	const rightPane = el('aside', 'cf-ws-pane');
	rightPane.append(el('h2', 'cf-ws-pane-title', 'Results & Impact'));
	rightPane.append(renderDepListSection('Downstream dependents', downstream, true));
	if (graph) {
		const coverage = el('div', 'cf-inspector-section');
		coverage.append(
			el('h3', 'cf-section-title', 'Coverage'),
			el('p', 'cf-muted', graph.status === 'partial'
				? 'Partial static graph: inspect Diagnostics for unresolved references or unsupported syntax.'
				: 'Complete static graph for the captured Terraform revision.')
		);
		rightPane.append(coverage);
		if (graph.diagnostics.length > 0) {
			rightPane.append(renderDiagnosticsSection(graph));
		}
	}
	columns.append(rightPane);

	overlay.append(columns);
	return overlay;
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

	if (!graph) {
		const empty = el('div', 'cf-empty-state');
		empty.append(el('p', undefined, emptyMessage));
		root.append(empty);
		return;
	}

	const selected = nodeById(state.selectedId);
	if (state.focusedWorkspaceOpen && selected) {
		root.append(renderFocusedWorkspace(selected));
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
}

// Keyboard shortcuts: / (search), ArrowUp/ArrowDown (cycle resources), Enter (open resource),
// O (open source), F (fit), Escape (close focused workspace).
window.addEventListener('keydown', event => {
	const target = event.target;
	const inInput = target instanceof HTMLElement && target.matches('input, textarea, select');
	if (event.key === 'Escape') {
		if (state.focusedWorkspaceOpen) {
			event.preventDefault();
			closeFocusedWorkspace();
		}
		return;
	}
	if (inInput || !graph) {
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
	} else if (event.key === 'Enter' && state.selectedId && !state.focusedWorkspaceOpen && !(target instanceof HTMLButtonElement && !target.classList.contains('cf-node'))) {
		event.preventDefault();
		openFocusedWorkspace(state.selectedId);
	} else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && projection && projection.nodes.length > 0 && !state.focusedWorkspaceOpen) {
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
			graph = message.graph;
			state = message.viewState;
			notice = message.notice;
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
			graph = undefined;
			projection = undefined;
			notice = null;
			emptyMessage = message.message;
			render();
			break;
	}
});

render();
post({ type: 'ready' });
