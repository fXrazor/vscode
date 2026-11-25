/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Position } from './model.ts';
import { isResourceContainer, visualParentId } from './resourceHierarchy.ts';
import { resourceDefinition } from './fixture.ts';
import { infrastructureLayers, resourceIntelligence, type InfrastructureLayer } from './providerKnowledge.ts';
import { documentedHubSpokes, infrastructureRelationships } from './infrastructureRelationships.ts';

export type NodeSize = { width: number; height: number };
export type TechnicalLayout = { offsets: Record<string, Position>; sizes: Record<string, NodeSize>; parents: Record<string, string | undefined> };
export const technicalCardSize: NodeSize = { width: 284, height: 286 };
const gap = 40; const inset = 28; const header = 100;

/** A bounded compound packing projection. It does not mutate resources, configuration or history. */
export function technicalLayout(architecture: Architecture, measured: Record<string, NodeSize> = {}): TechnicalLayout {
	const resources = new Map(architecture.resources.map(resource => [resource.id, resource]));
	// Free-form drawings keep their shared design positions. Only infrastructure participates in this projection.
	const elements = architecture.resources;
	const byId = new Map(elements.map(item => [item.id, item]));
	const parents: TechnicalLayout['parents'] = {};
	for (const item of elements) {
		const resource = resources.get(item.id); const container = resource && visualParentId(resource);
		parents[item.id] = container && resources.has(container) && isResourceContainer(resources.get(container)!) ? container : undefined;
	}
	// Corrupt or externally refreshed grouping must not cause recursion or an invisible cyclic subflow.
	for (const item of elements) { const seen = new Set([item.id]); let parent = parents[item.id]; while (parent) { if (seen.has(parent)) { parents[item.id] = undefined; break; } seen.add(parent); parent = parents[parent]; } }
	const children = new Map<string | undefined, string[]>();
	for (const item of elements) { const list = children.get(parents[item.id]) ?? []; list.push(item.id); children.set(parents[item.id], list); }
	const relationships = infrastructureRelationships(architecture);
	const stars = documentedHubSpokes(architecture, relationships);
	const sizes: TechnicalLayout['sizes'] = {};
	const local: Record<string, Position> = {};
	const layerOf = (id: string): InfrastructureLayer => { const resource = resources.get(id); return resource ? resourceIntelligence(resourceDefinition(resource).type).layer : 'unknown'; };
	const order = new Map(elements.map((item, index) => [item.id, index]));
	function sorted(ids: string[]) {
		// Actual prerequisite edges order same-layer siblings; unresolved cycles retain stable model order.
		const wanted = new Set(ids); const ranks = new Map<string, number>(); const incoming = new Map(ids.map(id => [id, new Set<string>()]));
		for (const link of relationships) { if (link.ordering && wanted.has(link.source) && wanted.has(link.target) && layerOf(link.source) === layerOf(link.target)) { incoming.get(link.target)!.add(link.source); } }
		for (let pass = 0; pass < ids.length; pass++) { let changed = false; for (const id of ids) { if (!ranks.has(id) && [...incoming.get(id)!].every(source => ranks.has(source))) { ranks.set(id, Math.max(0, ...[...incoming.get(id)!].map(source => ranks.get(source)! + 1))); changed = true; } } if (!changed) { break; } }
		return [...ids].sort((a, b) => infrastructureLayers.indexOf(layerOf(a)) - infrastructureLayers.indexOf(layerOf(b)) || (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0) || order.get(a)! - order.get(b)!);
	}
	function pack(ids: string[], padding: number, top: number): NodeSize {
		const ordered = sorted(ids); ordered.forEach(sizeOf);
		let y = top; let right = padding; const star = stars.find(star => ordered.includes(star.hub) && star.spokes.every(id => ordered.includes(id)));
		const handled = new Set<string>();
		if (star) {
			// Two-sided hub/spoke arrangement only for a complete sibling star with configured peering endpoints.
			const spokes = star.spokes; const columnWidth = Math.max(...[star.hub, ...spokes].map(id => sizes[id].width));
			const rows = Math.ceil(spokes.length / 2); const rowHeight = Math.max(...[star.hub, ...spokes].map(id => sizes[id].height)) + gap;
			local[star.hub] = { x: padding + columnWidth + gap, y: top + (rows * rowHeight - gap - sizes[star.hub].height) / 2 };
			spokes.forEach((id, index) => { local[id] = { x: padding + (index % 2 ? 2 * (columnWidth + gap) : 0), y: top + Math.floor(index / 2) * rowHeight }; handled.add(id); });
			handled.add(star.hub); right = padding + 3 * columnWidth + 2 * gap; y += rows * rowHeight;
		}
		const remaining = ordered.filter(id => !handled.has(id));
		// Compare bounded column packings. Large nested containers can occupy one column while
		// smaller siblings stack beside them; a separate full-width row per role creates a tall strip.
		let best: { score: number; width: number; height: number; positions: Record<string, Position> } | undefined;
		for (let columns = 1; columns <= Math.min(remaining.length, Math.ceil(Math.sqrt(remaining.length)) + 2); columns++) {
			const lanes = Array.from({ length: columns }, () => ({ width: 0, height: 0, ids: [] as string[] }));
			for (const id of remaining) { const lane = lanes.reduce((best, lane) => lane.height < best.height ? lane : best); lane.ids.push(id); lane.width = Math.max(lane.width, sizes[id].width); lane.height += sizes[id].height + gap; }
			const width = lanes.reduce((sum, lane) => sum + lane.width, 0) + gap * (columns - 1);
			const height = Math.max(...lanes.map(lane => lane.height)) - gap;
			const score = width * height * (1 + 0.55 * Math.abs(Math.log(width / height / 1.6)));
			if (!best || score < best.score) {
				const positions: Record<string, Position> = {}; let x = padding;
				for (const lane of lanes) { let top = y; for (const id of lane.ids) { positions[id] = { x, y: top }; top += sizes[id].height + gap; } x += lane.width + gap; }
				best = { score, width, height, positions };
			}
		}
		if (best) { Object.assign(local, best.positions); right = Math.max(right, padding + best.width); y += best.height + gap; }
		return { width: Math.max(320, right + padding), height: Math.max(190, y - gap + padding) };
	}
	function sizeOf(id: string) {
		if (sizes[id]) { return; } const resource = resources.get(id);
		if (children.has(id) || resource && isResourceContainer(resource)) { sizes[id] = pack(children.get(id) ?? [], inset, header); }
		else { sizes[id] = measured[id] ?? technicalCardSize; }
	}
	pack(children.get(undefined) ?? [], 0, 0);
	const origin = { x: Math.min(0, ...elements.map(item => item.positions.technical.x)), y: Math.min(0, ...elements.map(item => item.positions.technical.y)) };
	const offsets: TechnicalLayout['offsets'] = {};
	function locate(id: string, parent: Position) {
		const position = { x: parent.x + local[id].x, y: parent.y + local[id].y };
		const original = byId.get(id)!.positions.technical; offsets[id] = { x: position.x - original.x, y: position.y - original.y };
		for (const child of children.get(id) ?? []) { locate(child, position); }
	}
	for (const root of children.get(undefined) ?? []) { locate(root, origin); }
	return { offsets, sizes, parents };
}
