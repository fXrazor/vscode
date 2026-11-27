/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Semantic layouts for the Technical Graph. Inputs are the frozen graph snapshot and graph
 * presentation state only; outputs are fresh presentation coordinates. Nothing here can read or
 * write Architecture positions, parentage or containers.
 */
import type { InfrastructureLayer } from './providerKnowledge.ts';
import { layerLabels, type GraphEdge, type GraphNode, type TechnicalGraphSnapshot } from './technicalGraph.ts';
import type { Position } from './model.ts';

/** `bundled` is drawn radially by technicalGraphBundle.ts; card layout falls back to layers (used by image export). */
export type GraphLayoutKind = 'layers' | 'scopes' | 'tree' | 'bundled' | 'force';
export type GraphSize = { width: number; height: number };
export interface GraphLane { id: string; label: string; x: number; y: number; width: number; height: number; kind: 'layer' | 'scope' | 'inputs'; members?: string[] }
export interface GraphLayoutResult { positions: Record<string, Position>; sizes: Record<string, GraphSize>; lanes: GraphLane[]; columns: GraphLane[]; /** Tree only: parent id → leaf children wrapped into a multi-column block. */ treeBlocks?: Record<string, string[]> }

/** Engineering reading order: scope, then the network a workload lands in, the controls on it, the workload, its data and telemetry. */
export const layerOrder: InfrastructureLayer[] = ['scope', 'network', 'security', 'identity', 'compute', 'application', 'data', 'monitoring', 'unknown'];
export const graphMetrics = { width: 248, header: 80, row: 26, footer: 10, compactHeight: 80, gapX: 48, gapY: 32, bandGap: 36, bandHeader: 28, gutter: 170, perLine: 7, columnGap: 72, columnHeader: 40, rowLimit: 5 };

export function visiblePortCount(node: GraphNode, expanded: boolean): { shown: number; hidden: number } {
	const total = node.ports.length; if (expanded || total <= graphMetrics.rowLimit) { return { shown: total, hidden: 0 }; }
	return { shown: graphMetrics.rowLimit - 1, hidden: total - (graphMetrics.rowLimit - 1) };
}
export function graphNodeSize(node: GraphNode, expanded: boolean, compact: boolean): GraphSize {
	if (compact) { return { width: graphMetrics.width, height: graphMetrics.compactHeight }; }
	const { shown, hidden } = visiblePortCount(node, expanded);
	const rows = shown + (hidden ? 1 : 0);
	return { width: graphMetrics.width, height: graphMetrics.header + (rows ? rows * graphMetrics.row + graphMetrics.footer : 0) };
}

/** Order each line by the mean position of its already-placed neighbours (a few barycentre sweeps). */
function orderBands(bands: string[][], edges: readonly GraphEdge[]): string[][] {
	const neighbours = new Map<string, string[]>();
	for (const edge of edges) { (neighbours.get(edge.source) ?? neighbours.set(edge.source, []).get(edge.source)!).push(edge.target); (neighbours.get(edge.target) ?? neighbours.set(edge.target, []).get(edge.target)!).push(edge.source); }
	let result = bands.map(band => [...band]);
	for (let sweep = 0; sweep < 4; sweep++) {
		const index = new Map<string, number>(); result.forEach(band => band.forEach((id, i) => index.set(id, i / Math.max(1, band.length - 1))));
		const order = sweep % 2 ? [...result.keys()].reverse() : [...result.keys()];
		for (const b of order) {
			const band = result[b];
			const score = (id: string, fallback: number) => { const peers = (neighbours.get(id) ?? []).filter(peer => index.has(peer) && !band.includes(peer)); return peers.length ? peers.reduce((sum, peer) => sum + index.get(peer)!, 0) / peers.length : fallback; };
			const scored = band.map((id, i) => ({ id, value: score(id, index.get(id) ?? i) , i }));
			scored.sort((a, b) => a.value - b.value || a.i - b.i);
			result[b] = scored.map(item => item.id);
			result[b].forEach((id, i) => index.set(id, i / Math.max(1, result[b].length - 1)));
		}
	}
	return result;
}

/** Put a configured-peering hub in the middle of its spokes when they share a line. */
function centreHubs(band: string[], snapshot: TechnicalGraphSnapshot): string[] {
	for (const star of snapshot.hubSpokes) {
		if (!band.includes(star.hub) || !star.spokes.every(id => band.includes(id))) { continue; }
		const rest = band.filter(id => id !== star.hub && !star.spokes.includes(id));
		const left = star.spokes.filter((_, i) => i % 2 === 0); const right = star.spokes.filter((_, i) => i % 2 === 1);
		return [...left, star.hub, ...right, ...rest];
	}
	return band;
}

/** `auto` opens gaps that many lines cross; a number scales all spacing (100 = default). */
export type GraphSpacing = 'auto' | number;
interface Options { layout: GraphLayoutKind; expanded: ReadonlySet<string>; compact: boolean; pins: Readonly<Record<string, Position>>; visible?: ReadonlySet<string>; edges: readonly GraphEdge[]; spacing?: GraphSpacing; /** Extra vertical stretch in percent (100 = none). */ height?: number; /** Tree only: subtrees folded under these ids. */ collapsed?: ReadonlySet<string> }

export function layoutTechnicalGraph(snapshot: TechnicalGraphSnapshot, options: Options): GraphLayoutResult {
	const nodes = snapshot.nodes.filter(node => !options.visible || options.visible.has(node.id));
	const sizes: Record<string, GraphSize> = Object.fromEntries(nodes.map(node => [node.id, graphNodeSize(node, options.expanded.has(node.id), options.compact)]));
	const result = options.layout === 'tree' ? treeLayout(nodes, sizes, options.collapsed) : gridLayout(snapshot, nodes, sizes, options.edges, options.layout === 'scopes');
	// The tidy tree has no card rows for density gaps; only an explicit percentage scales it.
	spread(result, options.edges, options.layout === 'tree' && options.spacing === 'auto' ? 100 : options.spacing ?? 'auto', options.height ?? 100);
	for (const [id, pin] of Object.entries(options.pins)) { if (result.positions[id]) { result.positions[id] = { x: pin.x, y: pin.y }; } }
	return result;
}

function gridLayout(snapshot: TechnicalGraphSnapshot, nodes: readonly GraphNode[], sizes: Record<string, GraphSize>, edges: readonly GraphEdge[], byScope: boolean): GraphLayoutResult {
	const m = graphMetrics; const byId = new Map(nodes.map(node => [node.id, node]));
	const label = (id: string) => snapshot.nodes.find(node => node.id === id)?.label ?? id;
	// Scope view: one column per top-level ownership root. Scope containers themselves head their column.
	const columnOf = (node: GraphNode) => byScope ? (node.scopePath[0] ?? (node.isScope && !node.scope ? node.id : '__unscoped')) : '__all';
	const columnIds = [...new Set(nodes.map(columnOf))].sort((a, b) => (a === '__unscoped' ? 1 : 0) - (b === '__unscoped' ? 1 : 0));
	// Scope view: each column wraps its busiest layer into a roughly square block (cards are wider
	// than tall, so about two rows per extra column), so a large resource group reads as one block.
	const busiest = new Map(columnIds.map(column => [column, Math.max(1, ...layerOrder.map(layer => nodes.filter(node => node.layer === layer && columnOf(node) === column).length))]));
	const perLineOf = (column: string) => byScope ? Math.max(2, Math.min(m.perLine, Math.ceil(Math.sqrt(busiest.get(column)! * 1.6)))) : Math.max(m.perLine, Math.min(14, Math.ceil(Math.sqrt(busiest.get(column)! * 1.6))));
	const layers = layerOrder.filter(layer => nodes.some(node => node.layer === layer));
	// Lines: per layer, per column, wrapped at perLine.
	type Line = { layer: InfrastructureLayer; column: string; ids: string[] };
	const lines: Line[] = [];
	for (const layer of layers) { for (const column of columnIds) {
		const ids = nodes.filter(node => node.layer === layer && columnOf(node) === column).map(node => node.id);
		const perLine = perLineOf(column); for (let i = 0; i < ids.length; i += perLine) { lines.push({ layer, column, ids: ids.slice(i, i + perLine) }); }
	} }
	const ordered = orderBands(lines.map(line => line.ids), edges);
	lines.forEach((line, i) => { line.ids = centreHubs(ordered[i], snapshot); });
	// Column widths from the widest line in each column.
	const columnWidth = new Map(columnIds.map(column => [column, Math.max(m.width, ...lines.filter(line => line.column === column).map(line => line.ids.length * m.width + (line.ids.length - 1) * m.gapX))]));
	const columnX = new Map<string, number>(); let x = m.gutter;
	for (const column of columnIds) { columnX.set(column, x); x += columnWidth.get(column)! + m.columnGap; }
	const totalWidth = x - m.columnGap - m.gutter;
	const positions: Record<string, Position> = {}; const lanes: GraphLane[] = [];
	let y = byScope ? m.columnHeader : 0;
	for (const layer of layers) {
		const top = y; y += m.bandHeader;
		const bandHeight = new Map<string, number>();
		for (const column of columnIds) {
			let cy = y;
			for (const line of lines.filter(line => line.layer === layer && line.column === column)) {
				const height = Math.max(...line.ids.map(id => sizes[id].height));
				const lineWidth = line.ids.length * m.width + (line.ids.length - 1) * m.gapX;
				let lx = columnX.get(column)! + (columnWidth.get(column)! - lineWidth) / 2;
				for (const id of line.ids) { positions[id] = { x: lx, y: cy }; lx += m.width + m.gapX; }
				cy += height + m.gapY;
			}
			bandHeight.set(column, cy - y);
		}
		const height = Math.max(0, ...bandHeight.values()) - m.gapY;
		lanes.push({ id: 'lane:' + layer, label: layerLabels[layer], kind: 'layer', members: nodes.filter(node => node.layer === layer).map(node => node.id), x: 0, y: top, width: m.gutter + totalWidth + 40, height: m.bandHeader + height + 18 });
		y += height + m.bandGap;
	}
	const columns: GraphLane[] = byScope ? columnIds.map(column => ({ id: 'column:' + column, label: column === '__unscoped' ? 'No ownership scope' : label(column), kind: 'scope', members: nodes.filter(node => columnOf(node) === column).map(node => node.id), x: columnX.get(column)! - 20, y: 0, width: columnWidth.get(column)! + 40, height: y - m.bandGap + 10 })) : [];
	void byId;
	return { positions, sizes, lanes, columns };
}

/** Tidy top-down ownership tree (resource group → network → subnet → attached resources). */
/** Parent of each node in the ownership tree (nearest configured scope ancestor that is shown). */
export function treeParents(nodes: readonly GraphNode[]): Map<string, string | undefined> {
	const ids = new Set(nodes.map(node => node.id));
	return new Map(nodes.map(node => [node.id, [...node.scopePath].reverse().find(id => ids.has(id) && id !== node.id)]));
}
/**
 * Horizontal tidy tree (after d3.tree): depth runs left to right, siblings stack vertically and each
 * parent is centred on its children. Collapsed subtrees are omitted from the layout.
 */
function treeLayout(nodes: readonly GraphNode[], sizes: Record<string, GraphSize>, collapsed: ReadonlySet<string> = new Set()): GraphLayoutResult {
	const m = graphMetrics; const parents = treeParents(nodes);
	const children = new Map<string | undefined, string[]>();
	for (const node of nodes) { const parent = parents.get(node.id); (children.get(parent) ?? children.set(parent, []).get(parent)!).push(node.id); }
	const layerIndex = new Map(nodes.map(node => [node.id, layerOrder.indexOf(node.layer)]));
	const label = new Map(nodes.map(node => [node.id, node.label]));
	for (const list of children.values()) { list.sort((a, b) => layerIndex.get(a)! - layerIndex.get(b)! || label.get(a)!.localeCompare(label.get(b)!)); }
	const kids = (id: string) => collapsed.has(id) ? [] : children.get(id) ?? [];
	const leafGap = 14; const branchGap = 30; const column = m.width + 120; const blockRows = 6; const blockColGap = 56; const busRoom = 30;
	// Many leaf children wrap into columns of up to six (a "block") reached by one bus, so wide scopes stay on screen.
	type Item = { kind: 'node'; id: string } | { kind: 'block'; ids: string[]; cols: number; rowHeights: number[] };
	const items = (id: string): Item[] => {
		const list = kids(id); const leaves = list.filter(kid => !kids(kid).length);
		if (leaves.length <= blockRows) { return list.map(kid => ({ kind: 'node', id: kid })); }
		const cols = Math.ceil(leaves.length / blockRows); const rows = Math.ceil(leaves.length / cols);
		const rowHeights = Array.from({ length: rows }, (_, r) => Math.max(...leaves.filter((_, i) => i % rows === r).map(kid => sizes[kid].height)));
		return [{ kind: 'block', ids: leaves, cols, rowHeights }, ...list.filter(kid => kids(kid).length).map(kid => ({ kind: 'node' as const, id: kid }))];
	};
	const height = new Map<string, number>();
	const itemHeight = (item: Item): number => item.kind === 'node' ? height.get(item.id)! : busRoom + item.rowHeights.reduce((sum, h) => sum + h, 0) + (item.rowHeights.length - 1) * leafGap;
	const gapBetween = (a: Item, b: Item) => a.kind === 'block' || b.kind === 'block' || kids(a.id).length || kids(b.id).length ? branchGap : leafGap;
	const measure = (id: string): number => {
		const list = items(id); for (const item of list) { if (item.kind === 'node') { measure(item.id); } else { item.ids.forEach(measure); } }
		const total = list.reduce((sum, item, i) => sum + itemHeight(item) + (i ? gapBetween(list[i - 1], item) : 0), 0);
		const h = Math.max(sizes[id].height, total); height.set(id, h); return h;
	};
	const positions: Record<string, Position> = {}; const treeBlocks: Record<string, string[]> = {};
	const place = (id: string, depth: number, top: number): number => {
		const list = items(id); const own = sizes[id].height; const span = height.get(id)!;
		if (!list.length) { positions[id] = { x: depth * column, y: top + (span - own) / 2 }; return top + span / 2; }
		const total = list.reduce((sum, item, i) => sum + itemHeight(item) + (i ? gapBetween(list[i - 1], item) : 0), 0);
		let y = top + (span - total) / 2; const centres: number[] = [];
		list.forEach((item, i) => {
			if (i) { y += gapBetween(list[i - 1], item); }
			if (item.kind === 'node') { centres.push(place(item.id, depth + 1, y)); y += height.get(item.id)!; return; }
			treeBlocks[id] = item.ids; const rows = item.rowHeights.length; let rowTop = y + busRoom;
			item.rowHeights.forEach((rowHeight, r) => { item.ids.forEach((kid, k) => { if (k % rows === r) { positions[kid] = { x: (depth + 1) * column + Math.floor(k / rows) * (m.width + blockColGap), y: rowTop }; } }); rowTop += rowHeight + leafGap; });
			centres.push(y + busRoom / 2); y += itemHeight(item);
		});
		const centre = Math.min(Math.max((centres[0] + centres.at(-1)!) / 2, top + own / 2), top + span - own / 2);
		positions[id] = { x: depth * column, y: centre - own / 2 }; return centre;
	};
	let top = 0; for (const root of children.get(undefined) ?? []) { measure(root); place(root, 0, top); top += height.get(root)! + 64; }
	return { positions, sizes, lanes: [], columns: [], treeBlocks };
}

/** Extra vertical room for a gap, from the number of lines that cross it. */
export function densityGap(crossing: number): number { return Math.min(220, Math.max(0, crossing - 3) * 9); }

/**
 * Spread a computed layout. A percentage scales all gaps about the origin. `auto` keeps the default
 * scale and opens each horizontal gap between rows by the number of lines crossing it (lines that
 * stay within a row route underneath it, so they count for the gap below). Lanes are refitted.
 */
function spread(result: GraphLayoutResult, edges: readonly GraphEdge[], spacing: GraphSpacing, heightPercent: number) {
	const ids = Object.keys(result.positions); if (!ids.length) { return; }
	const scale = spacing === 'auto' ? 1 : Math.max(1, Math.min(3, spacing / 100));
	if (scale !== 1) { for (const id of ids) { const p = result.positions[id]; result.positions[id] = { x: p.x * scale, y: p.y * scale }; } }
	if (spacing === 'auto') {
		const tops = [...new Set(ids.map(id => Math.round(result.positions[id].y)))].sort((a, b) => a - b);
		const rowOf = (id: string) => tops.indexOf(Math.round(result.positions[id].y));
		const crossing = new Array(Math.max(0, tops.length - 1)).fill(0);
		for (const edge of edges) {
			if (!(edge.source in result.positions) || !(edge.target in result.positions)) { continue; }
			const a = rowOf(edge.source); const b = rowOf(edge.target);
			if (a === b) { if (a < crossing.length) { crossing[a]++; } continue; }
			for (let k = Math.min(a, b); k < Math.max(a, b); k++) { crossing[k]++; }
		}
		const shift = tops.map((_, index) => crossing.slice(0, index).reduce((sum, count) => sum + densityGap(count), 0));
		for (const id of ids) { const p = result.positions[id]; result.positions[id] = { x: p.x, y: p.y + shift[rowOf(id)] }; }
	}
	const stretch = Math.max(1, Math.min(4, heightPercent / 100));
	if (stretch !== 1) { for (const id of ids) { const p = result.positions[id]; result.positions[id] = { x: p.x, y: p.y * stretch }; } }
	if (scale === 1 && spacing !== 'auto' && stretch === 1) { return; }
	const right = Math.max(...ids.map(id => result.positions[id].x + result.sizes[id].width));
	const bottom = Math.max(...ids.map(id => result.positions[id].y + result.sizes[id].height));
	for (const lane of result.lanes) {
		const members = (lane.members ?? []).filter(id => result.positions[id]); if (!members.length) { continue; }
		const top = Math.min(...members.map(id => result.positions[id].y)) - graphMetrics.bandHeader;
		const end = Math.max(...members.map(id => result.positions[id].y + result.sizes[id].height));
		Object.assign(lane, { y: top, height: end - top + 18, width: right + 40 });
	}
	for (const column of result.columns) {
		const members = (column.members ?? []).filter(id => result.positions[id]); if (!members.length) { continue; }
		const left = Math.min(...members.map(id => result.positions[id].x)) - 20;
		Object.assign(column, { x: left, width: Math.max(...members.map(id => result.positions[id].x + result.sizes[id].width)) - left + 20, height: bottom + 10 - column.y });
	}
}

export const inputSize: GraphSize = { width: 196, height: 52 };
/**
 * Ghost inputs (var., local., data.) sit in one row above the graph, each near the mean x of the
 * cards that read it, swept left to right so they never overlap each other or any card.
 */
export function placeInputs(inputs: readonly { id: string; consumers: readonly { resourceId: string }[] }[], layout: GraphLayoutResult): { positions: Record<string, Position>; lane?: GraphLane } {
	const placed = inputs.map(input => {
		const xs = input.consumers.flatMap(consumer => { const p = layout.positions[consumer.resourceId]; const size = layout.sizes[consumer.resourceId]; return p && size ? [p.x + size.width / 2] : []; });
		return { id: input.id, centre: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN };
	}).filter(item => Number.isFinite(item.centre)).sort((a, b) => a.centre - b.centre || a.id.localeCompare(b.id));
	if (!placed.length) { return { positions: {} }; }
	const boxes = Object.entries(layout.positions).map(([id, p]) => ({ ...p, ...layout.sizes[id] }));
	const top = Math.min(...boxes.map(box => box.y), ...[...layout.lanes, ...layout.columns].map(lane => lane.y));
	const y = top - 48 - inputSize.height; const gap = 18;
	const positions: Record<string, Position> = {}; let cursor = -Infinity;
	for (const item of placed) { const x = Math.max(item.centre - inputSize.width / 2, cursor); positions[item.id] = { x: Math.round(x), y: Math.round(y) }; cursor = x + inputSize.width + gap; }
	const xs = Object.values(positions).map(p => p.x);
	const minX = Math.min(...xs, ...boxes.map(box => box.x)); const maxX = Math.max(...xs.map(x => x + inputSize.width), ...boxes.map(box => box.x + box.width));
	return { positions, lane: { id: 'lane:inputs', kind: 'inputs', label: 'Inputs', x: minX - graphMetrics.gutter, y: y - graphMetrics.bandHeader, width: maxX - minX + graphMetrics.gutter + 40, height: inputSize.height + graphMetrics.bandHeader + 18 } };
}

/** Rounded orthogonal polyline through points (org-chart style connectors). */
export function elbowPath(points: readonly Position[], radius = 8): string {
	let d = `M ${points[0].x} ${points[0].y}`;
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1]; const at = points[i]; const next = points[i + 1];
		const r = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2, Math.hypot(next.x - at.x, next.y - at.y) / 2);
		const a = { x: at.x - Math.sign(at.x - prev.x) * r, y: at.y - Math.sign(at.y - prev.y) * r };
		const b = { x: at.x + Math.sign(next.x - at.x) * r, y: at.y + Math.sign(next.y - at.y) * r };
		d += ` L ${a.x} ${a.y} Q ${at.x} ${at.y} ${b.x} ${b.y}`;
	}
	const last = points.at(-1)!; return d + ` L ${last.x} ${last.y}`;
}
/** Ownership-tree link (d3.linkHorizontal): parent's right edge to the child's left edge, in the column gap. */
export function treeConnector(parent: Position & GraphSize, child: Position & GraphSize): { d: string; side: 'left' } {
	const sx = parent.x + parent.width; const sy = parent.y + Math.min(parent.height / 2, 40);
	const tx = child.x; const ty = child.y + Math.min(child.height / 2, 40); const mx = (sx + tx) / 2;
	return { side: 'left', d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}` };
}

/**
 * Tree link for one child. Ordinary children get a horizontal S-curve. Children in a wrapped block
 * share a bus above the block, then drop down a bracket on the left of their column and step in.
 */
export function treeLinkPath(layout: GraphLayoutResult, parent: string, child: string): string {
	const box = (id: string) => ({ ...layout.positions[id], ...layout.sizes[id] });
	const block = layout.treeBlocks?.[parent];
	if (!block?.includes(child)) { return treeConnector(box(parent), box(child)).d; }
	const p = box(parent); const c = box(child); const members = block.filter(id => layout.positions[id]).map(box);
	const sx = p.x + p.width; const sy = p.y + Math.min(p.height / 2, 40);
	const busY = Math.min(...members.map(item => item.y)) - 16; const startX = Math.min(...members.map(item => item.x)) - 18; const colX = c.x - 18; const ty = c.y + Math.min(c.height / 2, 40);
	const mx = (sx + startX) / 2;
	return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${busY}, ${startX} ${busY}` + elbowPath([{ x: startX, y: busY }, { x: colX, y: busY }, { x: colX, y: ty }, { x: c.x, y: ty }]).replace(/^M [^ ]+ [^ ]+/, '');
}
