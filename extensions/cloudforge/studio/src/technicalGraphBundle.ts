/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Radial hierarchical edge bundling (after Holten 2006, as in d3's curveBundle), without a D3
 * dependency. Resources sit on a circle grouped by layer, then scope; each relationship is a
 * B-spline through the hierarchy (leaf → layer → centre → layer → leaf) straightened by `beta`.
 * Pure geometry from the frozen snapshot: it never reads or writes project positions.
 */
import type { GraphEdge, GraphNode, TechnicalGraphSnapshot } from './technicalGraph.ts';
import { layerOrder } from './technicalGraphLayout.ts';
import { layerLabels } from './technicalGraph.ts';

export interface BundleLeaf { id: string; label: string; layer: GraphNode['layer']; angle: number; x: number; y: number }
export interface BundleGroup { layer: GraphNode['layer']; label: string; start: number; end: number }
export interface BundlePath { edgeId: string; source: string; target: string; category: GraphEdge['category']; d: string }
export interface BundleLayout { radius: number; leaves: BundleLeaf[]; groups: BundleGroup[]; paths: BundlePath[] }

type Point = [number, number];
const polar = (angle: number, radius: number): Point => [Math.cos(angle - Math.PI / 2) * radius, Math.sin(angle - Math.PI / 2) * radius];
const round = (value: number) => Math.round(value * 10) / 10;

/** Uniform cubic B-spline through control points, matching d3.curveBasis. */
export function basisPath(points: readonly Point[]): string {
	if (points.length < 3) { return points.length ? 'M ' + points.map(p => round(p[0]) + ' ' + round(p[1])).join(' L ') : ''; }
	const p = [points[0], points[0], ...points, points.at(-1)!, points.at(-1)!];
	let d = `M ${round(points[0][0])} ${round(points[0][1])}`;
	for (let i = 1; i < p.length - 2; i++) {
		const [x0, y0] = p[i - 1]; const [x1, y1] = p[i]; const [x2, y2] = p[i + 1];
		d += ` C ${round((2 * x0 + x1) / 3)} ${round((2 * y0 + y1) / 3)}, ${round((x0 + 2 * x1) / 3)} ${round((y0 + 2 * y1) / 3)}, ${round((x0 + 4 * x1 + x2) / 6)} ${round((y0 + 4 * y1 + y2) / 6)}`;
	}
	return d + ` L ${round(points.at(-1)![0])} ${round(points.at(-1)![1])}`;
}

/** Straighten control points toward the chord: beta 1 = full bundling, 0 = straight line. */
export function straighten(points: readonly Point[], beta: number): Point[] {
	const n = points.length - 1; const [x0, y0] = points[0]; const [xn, yn] = points[n];
	return points.map(([x, y], i) => [beta * x + (1 - beta) * (x0 + (xn - x0) * i / n), beta * y + (1 - beta) * (y0 + (yn - y0) * i / n)]);
}

export function bundleLayout(snapshot: TechnicalGraphSnapshot, edges: readonly GraphEdge[], options: { beta?: number; visible?: ReadonlySet<string> } = {}): BundleLayout {
	const beta = options.beta ?? 0.85;
	const nodes = snapshot.nodes.filter(node => !options.visible || options.visible.has(node.id));
	const scopeLabel = (node: GraphNode) => node.scope ?? '';
	const ordered = layerOrder.flatMap(layer => nodes.filter(node => node.layer === layer).sort((a, b) => scopeLabel(a).localeCompare(scopeLabel(b)) || a.label.localeCompare(b.label)));
	const layers = layerOrder.filter(layer => ordered.some(node => node.layer === layer));
	// One slot per leaf plus a gap slot between layer groups so groups read as arcs.
	const slots = ordered.length + layers.length;
	const radius = Math.max(260, Math.min(900, slots * 13));
	const step = (Math.PI * 2) / Math.max(1, slots);
	const leaves: BundleLeaf[] = []; const groups: BundleGroup[] = []; let slot = 0;
	for (const layer of layers) {
		const members = ordered.filter(node => node.layer === layer); const start = slot * step;
		for (const node of members) { const angle = slot * step; const [x, y] = polar(angle, radius); leaves.push({ id: node.id, label: node.label, layer, angle, x, y }); slot++; }
		groups.push({ layer, label: layerLabels[layer], start, end: (slot - 1) * step }); slot++;
	}
	const leafById = new Map(leaves.map(leaf => [leaf.id, leaf]));
	const groupAnchor = new Map(groups.map(group => [group.layer, polar((group.start + group.end) / 2, radius * 0.5)]));
	const paths: BundlePath[] = [];
	for (const edge of edges) {
		const a = leafById.get(edge.source); const b = leafById.get(edge.target);
		if (!a || !b || a.id === b.id) { continue; }
		const control: Point[] = [[a.x, a.y], polar(a.angle, radius * 0.78), groupAnchor.get(a.layer)!];
		if (a.layer !== b.layer) { control.push([0, 0], groupAnchor.get(b.layer)!); }
		control.push(polar(b.angle, radius * 0.78), [b.x, b.y]);
		paths.push({ edgeId: edge.id, source: edge.source, target: edge.target, category: edge.category, d: basisPath(straighten(control, beta)) });
	}
	return { radius, leaves, groups, paths };
}
