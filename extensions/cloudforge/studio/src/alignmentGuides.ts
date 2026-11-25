/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export type GuideBox = { id: string; x: number; y: number; width: number; height: number; parentId?: string };
export type GuideLine = { x1: number; y1: number; x2: number; y2: number; kind?: 'spacing' };
type Span = { start: number; size: number; cross: number; crossSize: number };
type SpacingSnap = { delta: number; pairs: [Span, Span][]; shifted: Span };

/**
 * Equal-spacing snap along one axis: the moving span can sit centred between its nearest
 * neighbours, or repeat a gap that already exists between neighbouring elements in its row.
 * Spans are axis-neutral (start/size along the axis, cross/crossSize across it).
 */
export function spacingSnap(moving: Span, targets: Span[], threshold: number): SpacingSnap | undefined {
	const end = (span: Span) => span.start + span.size;
	const row = targets.filter(span => span.cross < moving.cross + moving.crossSize && span.cross + span.crossSize > moving.cross).sort((a, b) => a.start - b.start);
	const before = row.filter(span => end(span) <= moving.start).sort((a, b) => end(b) - end(a))[0];
	const after = row.filter(span => span.start >= end(moving)).sort((a, b) => a.start - b.start)[0];
	const gaps: [Span, Span][] = [];
	for (let index = 1; index < row.length; index++) {
		const previous = row.slice(0, index).filter(span => end(span) <= row[index].start).sort((a, b) => end(b) - end(a))[0];
		if (previous && row[index].start - end(previous) > 0) { gaps.push([previous, row[index]]); }
	}
	let best: SpacingSnap | undefined;
	const offer = (start: number, pairs: (shifted: Span) => [Span, Span][]) => {
		const delta = start - moving.start;
		if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) { const shifted = { ...moving, start }; best = { delta, pairs: pairs(shifted), shifted }; }
	};
	if (before && after && after.start - end(before) > moving.size) { offer((end(before) + after.start - moving.size) / 2, shifted => [[before, shifted], [shifted, after]]); }
	for (const pair of gaps) {
		const gap = pair[1].start - end(pair[0]);
		if (before) { offer(end(before) + gap, shifted => [[before, shifted], pair]); }
		if (after) { offer(after.start - gap - moving.size, shifted => [[shifted, after], pair]); }
	}
	return best;
}


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
	// Equal spacing competes with edge/centre alignment per axis; the closer snap wins.
	const xSpacing = spacingSnap({ start: x, size: width, cross: y, crossSize: height }, targets.map(box => ({ start: box.x, size: box.width, cross: box.y, crossSize: box.height })), threshold);
	const ySpacing = spacingSnap({ start: y, size: height, cross: x, crossSize: width }, targets.map(box => ({ start: box.y, size: box.height, cross: box.x, crossSize: box.width })), threshold);
	if (xSpacing && (!vertical || Math.abs(xSpacing.delta) < Math.abs(vertical.delta))) { vertical = undefined; } else if (xSpacing) { xSpacing.pairs = []; }
	if (ySpacing && (!horizontal || Math.abs(ySpacing.delta) < Math.abs(horizontal.delta))) { horizontal = undefined; } else if (ySpacing) { ySpacing.pairs = []; }
	const dx = vertical?.delta ?? (xSpacing?.pairs.length ? xSpacing.delta : 0); const dy = horizontal?.delta ?? (ySpacing?.pairs.length ? ySpacing.delta : 0); const padding = 8 / scale;
	const lines: GuideLine[] = [];
	// Gap markers sit midway across the overlap of each pair; the moving span also takes the other axis's snap.
	const markers = (snap: SpacingSnap, crossShift: number, horizontalAxis: boolean) => snap.pairs.map(([a, b]): GuideLine => {
		const cross = (span: Span) => span === snap.shifted ? span.cross + crossShift : span.cross;
		const at = (Math.max(cross(a), cross(b)) + Math.min(cross(a) + a.crossSize, cross(b) + b.crossSize)) / 2;
		return horizontalAxis ? { x1: a.start + a.size, x2: b.start, y1: at, y2: at, kind: 'spacing' } : { y1: a.start + a.size, y2: b.start, x1: at, x2: at, kind: 'spacing' };
	});
	if (xSpacing?.pairs.length) { lines.push(...markers(xSpacing, dy, true)); }
	if (ySpacing?.pairs.length) { lines.push(...markers(ySpacing, dx, false)); }
	if (vertical) { lines.push({ x1: vertical.at, x2: vertical.at, y1: Math.min(y + dy, vertical.box.y) - padding, y2: Math.max(y + dy + height, vertical.box.y + vertical.box.height) + padding }); }
	if (horizontal) { lines.push({ y1: horizontal.at, y2: horizontal.at, x1: Math.min(x + dx, horizontal.box.x) - padding, x2: Math.max(x + dx + width, horizontal.box.x + horizontal.box.width) + padding }); }
	return { dx, dy, roots, lines };
}
