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

export type GraphLayoutKind = 'layers' | 'scopes' | 'tree';
export type GraphSize = { width: number; height: number };
export interface GraphLane { id: string; label: string; x: number; y: number; width: number; height: number; kind: 'layer' | 'scope' }
export interface GraphLayoutResult { positions: Record<string, Position>; sizes: Record<string, GraphSize>; lanes: GraphLane[]; columns: GraphLane[] }

/** Engineering reading order: scope, then the network a workload lands in, the controls on it, the workload, its data and telemetry. */
export const layerOrder: InfrastructureLayer[] = ['scope', 'network', 'security', 'identity', 'compute', 'application', 'data', 'monitoring', 'unknown'];
export const graphMetrics = { width: 248, header: 80, row: 26, footer: 10, compactHeight: 80, gapX: 48, gapY: 32, bandGap: 36, bandHeader: 28, gutter: 130, perLine: 7, columnGap: 72, columnHeader: 40, rowLimit: 5 };

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

interface Options { layout: GraphLayoutKind; expanded: ReadonlySet<string>; compact: boolean; pins: Readonly<Record<string, Position>>; visible?: ReadonlySet<string>; edges: readonly GraphEdge[] }

export function layoutTechnicalGraph(snapshot: TechnicalGraphSnapshot, options: Options): GraphLayoutResult {
	const nodes = snapshot.nodes.filter(node => !options.visible || options.visible.has(node.id));
	const sizes: Record<string, GraphSize> = Object.fromEntries(nodes.map(node => [node.id, graphNodeSize(node, options.expanded.has(node.id), options.compact)]));
	const result = options.layout === 'tree' ? treeLayout(nodes, sizes) : gridLayout(snapshot, nodes, sizes, options.edges, options.layout === 'scopes');
	for (const [id, pin] of Object.entries(options.pins)) { if (result.positions[id]) { result.positions[id] = { x: pin.x, y: pin.y }; } }
	return result;
}

function gridLayout(snapshot: TechnicalGraphSnapshot, nodes: readonly GraphNode[], sizes: Record<string, GraphSize>, edges: readonly GraphEdge[], byScope: boolean): GraphLayoutResult {
	const m = graphMetrics; const byId = new Map(nodes.map(node => [node.id, node]));
	const label = (id: string) => snapshot.nodes.find(node => node.id === id)?.label ?? id;
	// Scope view: one column per top-level ownership root. Scope containers themselves head their column.
	const columnOf = (node: GraphNode) => byScope ? (node.scopePath[0] ?? (node.isScope && !node.scope ? node.id : '__unscoped')) : '__all';
	const columnIds = [...new Set(nodes.map(columnOf))].sort((a, b) => (a === '__unscoped' ? 1 : 0) - (b === '__unscoped' ? 1 : 0));
	const perLine = byScope ? Math.max(2, Math.ceil(m.perLine / Math.max(1, columnIds.length)) + 1) : m.perLine;
	const layers = layerOrder.filter(layer => nodes.some(node => node.layer === layer));
	// Lines: per layer, per column, wrapped at perLine.
	type Line = { layer: InfrastructureLayer; column: string; ids: string[] };
	const lines: Line[] = [];
	for (const layer of layers) { for (const column of columnIds) {
		const ids = nodes.filter(node => node.layer === layer && columnOf(node) === column).map(node => node.id);
		for (let i = 0; i < ids.length; i += perLine) { lines.push({ layer, column, ids: ids.slice(i, i + perLine) }); }
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
		lanes.push({ id: 'lane:' + layer, label: layerLabels[layer], kind: 'layer', x: 0, y: top, width: m.gutter + totalWidth + 40, height: m.bandHeader + height + 18 });
		y += height + m.bandGap;
	}
	const columns: GraphLane[] = byScope ? columnIds.map(column => ({ id: 'column:' + column, label: column === '__unscoped' ? 'No ownership scope' : label(column), kind: 'scope', x: columnX.get(column)! - 20, y: 0, width: columnWidth.get(column)! + 40, height: y - m.bandGap + 10 })) : [];
	void byId;
	return { positions, sizes, lanes, columns };
}

/** Tidy top-down ownership tree (resource group → network → subnet → attached resources). */
function treeLayout(nodes: readonly GraphNode[], sizes: Record<string, GraphSize>): GraphLayoutResult {
	const m = graphMetrics; const ids = new Set(nodes.map(node => node.id));
	const parentOf = (node: GraphNode) => { const parent = [...node.scopePath].reverse().find(id => ids.has(id) && id !== node.id); return parent; };
	const children = new Map<string | undefined, string[]>();
	for (const node of nodes) { const parent = parentOf(node); (children.get(parent) ?? children.set(parent, []).get(parent)!).push(node.id); }
	const layerIndex = new Map(nodes.map(node => [node.id, layerOrder.indexOf(node.layer)]));
	for (const list of children.values()) { list.sort((a, b) => layerIndex.get(a)! - layerIndex.get(b)!); }
	// Leaves under one parent wrap into a small grid; branches sit beside them. Keeps wide scopes readable.
	const vGap = m.bandGap + 24; const leafCols = 3;
	const box = new Map<string, { width: number; height: number; leafW: number; leafCols: number }>();
	const measure = (id: string): { width: number; height: number } => {
		const kids = children.get(id) ?? []; const leaves = kids.filter(kid => !children.get(kid)?.length); const branches = kids.filter(kid => children.get(kid)?.length);
		const cols = Math.min(leafCols, leaves.length); const leafW = cols ? cols * m.width + (cols - 1) * m.gapX : 0;
		let leafH = 0; for (let i = 0; i < leaves.length; i += cols) { leafH += Math.max(...leaves.slice(i, i + cols).map(kid => sizes[kid].height)) + m.gapY; } leafH = Math.max(0, leafH - m.gapY);
		const branchBoxes = branches.map(measure);
		const branchW = branchBoxes.reduce((sum, b) => sum + b.width, 0) + Math.max(0, branches.length - 1) * m.gapX;
		const childW = leafW + (leafW && branchW ? m.columnGap : 0) + branchW; const childH = Math.max(leafH, ...branchBoxes.map(b => b.height), 0);
		const result = { width: Math.max(m.width, childW), height: sizes[id].height + (kids.length ? vGap + childH : 0), leafW, leafCols: cols };
		box.set(id, result); return result;
	};
	const roots = children.get(undefined) ?? [];
	roots.forEach(measure);
	const positions: Record<string, Position> = {};
	const place = (id: string, left: number, top: number) => {
		const b = box.get(id)!; positions[id] = { x: left + (b.width - m.width) / 2, y: top };
		const kids = children.get(id) ?? []; if (!kids.length) { return; }
		const leaves = kids.filter(kid => !children.get(kid)?.length); const branches = kids.filter(kid => children.get(kid)?.length);
		const branchW = branches.reduce((sum, kid) => sum + box.get(kid)!.width, 0) + Math.max(0, branches.length - 1) * m.gapX;
		const childW = b.leafW + (b.leafW && branchW ? m.columnGap : 0) + branchW;
		let x = left + (b.width - childW) / 2; const y = top + sizes[id].height + vGap;
		let rowTop = y;
		for (let i = 0; i < leaves.length; i += b.leafCols) {
			const row = leaves.slice(i, i + b.leafCols); row.forEach((kid, j) => { positions[kid] = { x: x + j * (m.width + m.gapX), y: rowTop }; });
			rowTop += Math.max(...row.map(kid => sizes[kid].height)) + m.gapY;
		}
		x += b.leafW + (b.leafW && branchW ? m.columnGap : 0);
		for (const kid of branches) { place(kid, x, y); x += box.get(kid)!.width + m.gapX; }
	};
	let left = 0; for (const root of roots) { place(root, left, 0); left += box.get(root)!.width + m.columnGap; }
	return { positions, sizes, lanes: [], columns: [] };
}
