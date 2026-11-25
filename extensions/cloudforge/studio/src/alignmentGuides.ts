/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export type GuideBox = { id: string; x: number; y: number; width: number; height: number; parentId?: string };
export type GuideLine = { x1: number; y1: number; x2: number; y2: number };

/** Presentation geometry only. A selection moves as one unit; container descendants never snap to themselves. */
export function alignmentGuides(boxes: GuideBox[], ids: string[], zoom: number) {
	const selected = new Set(ids); const byId = new Map(boxes.map(box => [box.id, box]));
	function ancestors(box: GuideBox) {
		const result = new Set<string>(); let parent = box.parentId;
		while (parent && !result.has(parent)) { result.add(parent); parent = byId.get(parent)?.parentId; }
		return result;
	}
	const valid = boxes.filter(box => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0);
	const moving = valid.filter(box => selected.has(box.id) && ![...ancestors(box)].some(id => selected.has(id)));
	const roots = new Set(moving.map(box => box.id));
	if (!moving.length) { return { dx: 0, dy: 0, roots, lines: [] as GuideLine[] }; }
	const parents = new Set(moving.flatMap(box => [...ancestors(box)]));
	const targets = valid.filter(box => !selected.has(box.id) && !parents.has(box.id) && ![...ancestors(box)].some(id => roots.has(id)));
	const x = Math.min(...moving.map(box => box.x)); const y = Math.min(...moving.map(box => box.y));
	const width = Math.max(...moving.map(box => box.x + box.width)) - x; const height = Math.max(...moving.map(box => box.y + box.height)) - y;
	const scale = Math.max(0.1, Number.isFinite(zoom) ? zoom : 1);
	const threshold = 6 / scale;
	let horizontal: { delta: number; at: number; box: GuideBox } | undefined;
	let vertical: { delta: number; at: number; box: GuideBox } | undefined;
	for (const box of targets) {
		for (const from of [x + width / 2, x, x + width]) {
			for (const at of [box.x + box.width / 2, box.x, box.x + box.width]) {
				const delta = at - from;
				if (Math.abs(delta) <= threshold && (!vertical || Math.abs(delta) < Math.abs(vertical.delta))) { vertical = { delta, at, box }; }
			}
		}
		for (const from of [y + height / 2, y, y + height]) {
			for (const at of [box.y + box.height / 2, box.y, box.y + box.height]) {
				const delta = at - from;
				if (Math.abs(delta) <= threshold && (!horizontal || Math.abs(delta) < Math.abs(horizontal.delta))) { horizontal = { delta, at, box }; }
			}
		}
	}
	const dx = vertical?.delta ?? 0; const dy = horizontal?.delta ?? 0; const padding = 8 / scale;
	const lines: GuideLine[] = [];
	if (vertical) { lines.push({ x1: vertical.at, x2: vertical.at, y1: Math.min(y + dy, vertical.box.y) - padding, y2: Math.max(y + dy + height, vertical.box.y + vertical.box.height) + padding }); }
	if (horizontal) { lines.push({ y1: horizontal.at, y2: horizontal.at, x1: Math.min(x + dx, horizontal.box.x) - padding, x2: Math.max(x + dx + width, horizontal.box.x + horizontal.box.width) + padding }); }
	return { dx, dy, roots, lines };
}
