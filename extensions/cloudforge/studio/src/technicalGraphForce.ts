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

export interface ForceNode { id: string; layer: GraphNode['layer']; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }
export interface ForceLink { source: string; target: string }
export interface ForceSimulation { nodes: ForceNode[]; links: ForceLink[]; alpha: number; alphaTarget: number }

export const forceSettings = { radius: 22, linkDistance: 110, charge: -460, collide: 64, velocityDecay: 0.4, alphaMin: 0.001, alphaDecay: 1 - Math.pow(0.001, 1 / 300), layerPull: 0.035 };

/** Deterministic phyllotaxis start, like d3-force, so the same project always settles the same way. */
export function createForceSimulation(nodes: readonly Pick<GraphNode, 'id' | 'layer'>[], edges: readonly Pick<GraphEdge, 'source' | 'target'>[]): ForceSimulation {
	const ids = new Set(nodes.map(node => node.id));
	const order = [...nodes].sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer));
	const simNodes = order.map((node, i) => { const r = 10 * Math.sqrt(0.5 + i); const a = i * Math.PI * (3 - Math.sqrt(5)); return { id: node.id, layer: node.layer, x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0 }; });
	const seen = new Set<string>();
	const links = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target).filter(edge => { const key = [edge.source, edge.target].sort().join('\u0000'); if (seen.has(key)) { return false; } seen.add(key); return true; }).map(edge => ({ source: edge.source, target: edge.target }));
	return { nodes: simNodes, links, alpha: 1, alphaTarget: 0 };
}

/** One simulation step. Returns false once cooled. */
export function tickForce(sim: ForceSimulation): boolean {
	if (sim.alpha < forceSettings.alphaMin && sim.alphaTarget === 0) { return false; }
	sim.alpha += (sim.alphaTarget - sim.alpha) * forceSettings.alphaDecay;
	const { alpha } = sim; const byId = new Map(sim.nodes.map(node => [node.id, node]));
	const degree = new Map<string, number>(); for (const link of sim.links) { degree.set(link.source, (degree.get(link.source) ?? 0) + 1); degree.set(link.target, (degree.get(link.target) ?? 0) + 1); }
	// Links: springs toward linkDistance, weaker on hubs (d3 default strength 1 / min degree).
	for (const link of sim.links) {
		const s = byId.get(link.source)!; const t = byId.get(link.target)!;
		let dx = t.x + t.vx - s.x - s.vx || 1e-6; let dy = t.y + t.vy - s.y - s.vy || 1e-6; const l = Math.hypot(dx, dy);
		const strength = 1 / Math.min(degree.get(s.id)!, degree.get(t.id)!); const k = (l - forceSettings.linkDistance) / l * alpha * strength;
		dx *= k; dy *= k; const bias = degree.get(s.id)! / (degree.get(s.id)! + degree.get(t.id)!);
		t.vx -= dx * bias; t.vy -= dy * bias; s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
	}
	// Many-body repulsion (exact; Barnes–Hut is unnecessary at graph-view sizes) and collision.
	const n = sim.nodes.length; const maxDistance2 = 900 * 900;
	for (let i = 0; i < n; i++) {
		const a = sim.nodes[i];
		for (let j = i + 1; j < n; j++) {
			const b = sim.nodes[j]; let dx = b.x - a.x; let dy = b.y - a.y; let d2 = dx * dx + dy * dy;
			if (d2 === 0) { dx = (j - i) * 1e-3; dy = 1e-3; d2 = dx * dx + dy * dy; }
			if (d2 < maxDistance2) { const w = forceSettings.charge * alpha / Math.max(d2, 100); a.vx += dx * w; a.vy += dy * w; b.vx -= dx * w; b.vy -= dy * w; }
			const min = forceSettings.collide; if (d2 < min * min) { const d = Math.sqrt(d2); const push = (min - d) / d * 0.5; a.vx -= dx * push; a.vy -= dy * push; b.vx += dx * push; b.vy += dy * push; }
		}
	}
	// A weak pull of each layer toward its own direction keeps network, compute and data readable.
	for (const node of sim.nodes) {
		const angle = (layerOrder.indexOf(node.layer) / layerOrder.length) * Math.PI * 2 - Math.PI / 2; const reach = 220;
		node.vx += (Math.cos(angle) * reach - node.x) * forceSettings.layerPull * alpha; node.vy += (Math.sin(angle) * reach - node.y) * forceSettings.layerPull * alpha;
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
