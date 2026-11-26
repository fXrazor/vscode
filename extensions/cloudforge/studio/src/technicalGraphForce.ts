/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Force-directed layout (after d3-force: link, many-body, centre and collide forces with velocity
 * Verlet integration and alpha cooling), without a D3 dependency. Positions are presentation-only
 * and live in the renderer; nothing here can reach Resource.positions.
 */
import type { GraphEdge, GraphNode } from './technicalGraph.ts';
import { layerOrder } from './technicalGraphLayout.ts';

export interface ForceNode { id: string; layer: GraphNode['layer']; group: string; r: number; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }
export interface ForceLink { source: string; target: string }
export interface ForceSimulation { nodes: ForceNode[]; links: ForceLink[]; alpha: number; alphaTarget: number; options: ForceOptions }

/** User-facing Network options. Percentages are relative to the defaults below. */
export interface NetworkOptions {
	/** How much bigger the most-connected node is than a leaf, in percent (0 = all equal). */
	sizeBy: number;
	/** Link length, percent of the default. */
	linkLength: number;
	/** Repulsion between nodes, percent of the default. */
	spacing: number;
	/** Pull resources into soft clusters and draw a hull around each. */
	clusters: 'none' | 'scope' | 'layer';
	labels: 'all' | 'auto' | 'none';
	links: 'straight' | 'curved';
}
export const defaultNetworkOptions: NetworkOptions = { sizeBy: 60, linkLength: 100, spacing: 100, clusters: 'scope', labels: 'auto', links: 'curved' };

const networkChoices = { clusters: ['scope', 'layer', 'none'], labels: ['auto', 'all', 'none'], links: ['curved', 'straight'] } as const;
/** Reads stored Network options, clamping numbers and dropping unknown values. */
export function parseNetworkOptions(value: unknown): NetworkOptions | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const raw = value as Record<string, unknown>;
	const num = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
	const pick = <K extends keyof typeof networkChoices>(key: K): NetworkOptions[K] => (networkChoices[key] as readonly string[]).includes(raw[key] as string) ? raw[key] as NetworkOptions[K] : defaultNetworkOptions[key];
	return { sizeBy: num(raw.sizeBy, 0, 300, defaultNetworkOptions.sizeBy), linkLength: num(raw.linkLength, 40, 300, 100), spacing: num(raw.spacing, 40, 300, 100), clusters: pick('clusters'), labels: pick('labels'), links: pick('links') };
}

interface ForceOptions { linkDistance: number; charge: number; clusterPull: number; layerPull: number }
export const forceSettings = { radius: 22, linkDistance: 110, charge: -460, labelPad: 20, velocityDecay: 0.4, alphaMin: 0.001, alphaDecay: 1 - Math.pow(0.001, 1 / 300), layerPull: 0.035, clusterPull: 0.06 };

/**
 * Node radius from configured connections (in + out, membership excluded). Area-like growth:
 * sqrt of degree relative to the busiest node, so a hub stands out without dwarfing everything.
 */
export function nodeRadii(nodes: readonly Pick<GraphNode, 'id'>[], edges: readonly Pick<GraphEdge, 'source' | 'target' | 'membership'>[], sizeBy: number): Record<string, number> {
	const degree = new Map(nodes.map(node => [node.id, 0]));
	for (const edge of edges) { if (edge.membership) { continue; } for (const id of [edge.source, edge.target]) { if (degree.has(id)) { degree.set(id, degree.get(id)! + 1); } } }
	const max = Math.max(1, ...degree.values()); const growth = Math.max(0, Math.min(300, sizeBy)) / 100;
	return Object.fromEntries([...degree].map(([id, d]) => [id, Math.round(forceSettings.radius * (1 + growth * Math.sqrt(d / max)) * 10) / 10]));
}

/** Deterministic phyllotaxis start, like d3-force, so the same project always settles the same way. */
export function createForceSimulation(nodes: readonly Pick<GraphNode, 'id' | 'layer'>[] & readonly { scope?: string }[], edges: readonly Pick<GraphEdge, 'source' | 'target'>[], options: { radii?: Record<string, number>; network?: Partial<NetworkOptions> } = {}): ForceSimulation {
	const network = { ...defaultNetworkOptions, ...options.network };
	const ids = new Set(nodes.map(node => node.id));
	const order = [...nodes].sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer));
	const groupOf = (node: Pick<GraphNode, 'id' | 'layer'> & { scope?: string; scopePath?: readonly string[] }) => network.clusters === 'layer' ? node.layer : network.clusters === 'scope' ? (node.scopePath?.[0] ?? node.scope ?? node.id) : '';
	const simNodes = order.map((node, i) => { const r = 10 * Math.sqrt(0.5 + i); const a = i * Math.PI * (3 - Math.sqrt(5)); return { id: node.id, layer: node.layer, group: groupOf(node), r: options.radii?.[node.id] ?? forceSettings.radius, x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0 }; });
	const seen = new Set<string>();
	const links = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target).filter(edge => { const key = [edge.source, edge.target].sort().join('\u0000'); if (seen.has(key)) { return false; } seen.add(key); return true; }).map(edge => ({ source: edge.source, target: edge.target }));
	return { nodes: simNodes, links, alpha: 1, alphaTarget: 0, options: { linkDistance: forceSettings.linkDistance * clampPercent(network.linkLength) / 100, charge: forceSettings.charge * clampPercent(network.spacing) / 100, clusterPull: network.clusters === 'none' ? 0 : forceSettings.clusterPull, layerPull: network.clusters === 'layer' ? forceSettings.layerPull * 2.4 : forceSettings.layerPull } };
}
const clampPercent = (value: number) => Math.max(40, Math.min(300, Number.isFinite(value) ? value : 100));

/** One simulation step. Returns false once cooled. */
export function tickForce(sim: ForceSimulation): boolean {
	if (sim.alpha < forceSettings.alphaMin && sim.alphaTarget === 0) { return false; }
	sim.alpha += (sim.alphaTarget - sim.alpha) * forceSettings.alphaDecay;
	const { alpha, options } = sim; const byId = new Map(sim.nodes.map(node => [node.id, node]));
	const degree = new Map<string, number>(); for (const link of sim.links) { degree.set(link.source, (degree.get(link.source) ?? 0) + 1); degree.set(link.target, (degree.get(link.target) ?? 0) + 1); }
	// Links: springs toward linkDistance (plus both radii so big hubs keep their neighbours readable).
	for (const link of sim.links) {
		const s = byId.get(link.source)!; const t = byId.get(link.target)!;
		let dx = t.x + t.vx - s.x - s.vx || 1e-6; let dy = t.y + t.vy - s.y - s.vy || 1e-6; const l = Math.hypot(dx, dy);
		const strength = 1 / Math.min(degree.get(s.id)!, degree.get(t.id)!); const k = (l - (options.linkDistance + s.r + t.r - 2 * forceSettings.radius)) / l * alpha * strength;
		dx *= k; dy *= k; const bias = degree.get(s.id)! / (degree.get(s.id)! + degree.get(t.id)!);
		t.vx -= dx * bias; t.vy -= dy * bias; s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
	}
	// Many-body repulsion (exact; Barnes–Hut is unnecessary at graph-view sizes), scaled by size, and collision with label room.
	const n = sim.nodes.length; const maxDistance2 = 900 * 900;
	for (let i = 0; i < n; i++) {
		const a = sim.nodes[i];
		for (let j = i + 1; j < n; j++) {
			const b = sim.nodes[j]; let dx = b.x - a.x; let dy = b.y - a.y; let d2 = dx * dx + dy * dy;
			if (d2 === 0) { dx = (j - i) * 1e-3; dy = 1e-3; d2 = dx * dx + dy * dy; }
			if (d2 < maxDistance2) { const apart = options.clusterPull && a.group && b.group && a.group !== b.group ? 1.8 : 1; const w = options.charge * apart * Math.sqrt(a.r * b.r) / forceSettings.radius * alpha / Math.max(d2, 100); a.vx += dx * w; a.vy += dy * w; b.vx -= dx * w; b.vy -= dy * w; }
			const min = a.r + b.r + forceSettings.labelPad; if (d2 < min * min) { const d = Math.sqrt(d2); const push = (min - d) / d * 0.5; a.vx -= dx * push; a.vy -= dy * push; b.vx += dx * push; b.vy += dy * push; }
		}
	}
	// Cluster pull: each node drifts toward its group's centroid (a soft forceX/forceY per group).
	if (options.clusterPull) {
		const centres = new Map<string, { x: number; y: number; n: number }>();
		for (const node of sim.nodes) { if (!node.group) { continue; } const c = centres.get(node.group) ?? { x: 0, y: 0, n: 0 }; c.x += node.x; c.y += node.y; c.n++; centres.set(node.group, c); }
		for (const node of sim.nodes) { const c = node.group ? centres.get(node.group) : undefined; if (c && c.n > 1) { node.vx += (c.x / c.n - node.x) * options.clusterPull * alpha; node.vy += (c.y / c.n - node.y) * options.clusterPull * alpha; } }
	}
	// A weak pull of each layer toward its own direction keeps network, compute and data readable.
	if (options.layerPull) {
		const pull = options.layerPull;
		for (const node of sim.nodes) {
			const angle = (layerOrder.indexOf(node.layer) / layerOrder.length) * Math.PI * 2 - Math.PI / 2; const reach = options.layerPull > forceSettings.layerPull ? 340 : 220;
			node.vx += (Math.cos(angle) * reach - node.x) * pull * alpha; node.vy += (Math.sin(angle) * reach - node.y) * pull * alpha;
		}
	}
	let cx = 0; let cy = 0;
	for (const node of sim.nodes) {
		if (node.fx !== undefined && node.fy !== undefined) { node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0; continue; }
		node.vx *= 1 - forceSettings.velocityDecay; node.vy *= 1 - forceSettings.velocityDecay; node.x += node.vx; node.y += node.vy; cx += node.x; cy += node.y;
	}
	// Centre force: shift the free nodes so their mean stays at the origin.
	const free = sim.nodes.filter(node => node.fx === undefined); if (free.length) { cx /= free.length; cy /= free.length; for (const node of free) { node.x -= cx; node.y -= cy; } }
	return true;
}

/** Run to (near) rest synchronously, for the first frame, reduced motion and tests. */
export function settleForce(sim: ForceSimulation, maxTicks = 300): ForceSimulation {
	for (let i = 0; i < maxTicks && tickForce(sim); i++) { /* Cooling. */ }
	return sim;
}

/**
 * Turn a settled layout so its long axis runs along the viewport's long axis (principal axis of
 * the positions). Presentation-only, deterministic, and it keeps every distance.
 */
export function orientForce(sim: ForceSimulation, aspect: number): ForceSimulation {
	const n = sim.nodes.length; if (n < 3) { return sim; }
	const mx = sim.nodes.reduce((sum, node) => sum + node.x, 0) / n; const my = sim.nodes.reduce((sum, node) => sum + node.y, 0) / n;
	let sxx = 0; let syy = 0; let sxy = 0; for (const node of sim.nodes) { const dx = node.x - mx; const dy = node.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
	const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy); const turn = (aspect >= 1 ? 0 : Math.PI / 2) - axis;
	const cos = Math.cos(turn); const sin = Math.sin(turn);
	for (const node of sim.nodes) { const dx = node.x - mx; const dy = node.y - my; node.x = dx * cos - dy * sin; node.y = dx * sin + dy * cos; }
	return sim;
}

/** Padded convex hull (monotone chain) as a smooth closed path, for cluster backgrounds. */
export function hullPath(points: readonly { x: number; y: number; r: number }[], pad = 18): string {
	const ring = points.flatMap(p => Array.from({ length: 8 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 4) * (p.r + pad), y: p.y + Math.sin(i * Math.PI / 4) * (p.r + pad) })));
	if (ring.length < 3) { return ''; }
	const sorted = [...ring].sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: typeof sorted = []; for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) { lower.pop(); } lower.push(p); }
	const upper: typeof sorted = []; for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) { upper.pop(); } upper.push(p); }
	const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
	// Smooth with midpoint quadratic curves so the hull reads as a soft blob, not a polygon.
	const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const r = (v: number) => Math.round(v * 10) / 10;
	let d = ''; const start = mid(hull.at(-1)!, hull[0]); d += `M ${r(start.x)} ${r(start.y)}`;
	for (let i = 0; i < hull.length; i++) { const p = hull[i]; const m = mid(p, hull[(i + 1) % hull.length]); d += ` Q ${r(p.x)} ${r(p.y)} ${r(m.x)} ${r(m.y)}`; }
	return d + ' Z';
}
