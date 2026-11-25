/*---------------------------------------------------------------------------------------------
 *  Multi-object resize is one semantic step on the shared architecture.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer, type Architecture, type BoardItem } from './model.ts';
import { resizeAnchorPoint, resizeAnchors } from './canvasOperations.ts';
import { dragScale, scaledSelectionBounds } from './selectionGeometry.ts';

const item = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BoardItem> = {}): BoardItem => ({ id, kind: 'shape', text: id, positions: { visual: { x, y }, technical: { x, y } }, width, height, members: [], ...extra });
const board = (items: BoardItem[]): Architecture => ({ name: 'Board', resources: [], items, connections: [] });

test('scaling a selection resizes and spaces every element about the selection origin in one undo step', () => {
	let h = createHistory(board([item('a', 100, 100, 100, 50), item('b', 300, 200, 40, 40)]));
	h = historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: ['a', 'b'], mode: 'visual', scale: 2 } });
	const [a, b] = h.present.items;
	assert.deepEqual([a.width, a.height, a.positions.visual], [200, 100, { x: 100, y: 100 }]);
	assert.deepEqual([b.width, b.height, b.positions.visual], [80, 80, { x: 500, y: 300 }]);
	assert.deepEqual(b.positions.technical, b.positions.visual, 'both renderers share the new geometry');
	assert.equal(h.past.length, 1);
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.items[1].width, 40);
});

test('match sizes uses the largest element, skips locked ones and ignores a single target', () => {
	let h = createHistory(board([item('a', 0, 0, 100, 50), item('b', 200, 0, 40, 90), item('c', 400, 0, 10, 10, { canvasLocked: true })]));
	h = historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: ['a', 'b', 'c'], mode: 'visual', match: 'width' } });
	assert.deepEqual(h.present.items.map(entry => entry.width), [100, 100, 10]);
	assert.deepEqual(h.present.items.map(entry => entry.height), [50, 90, 10], 'match width leaves heights alone');
	const before = h;
	h = historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: ['a'], mode: 'visual', match: 'size' } });
	assert.equal(h, before, 'matching needs at least two editable elements');
});

test('invalid or identity scales are rejected without a history step', () => {
	const h = createHistory(board([item('a', 0, 0, 100, 50), item('b', 200, 0, 40, 90)]));
	for (const scale of [1, 0, -2, 10, Number.NaN]) {
		assert.equal(historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: ['a', 'b'], mode: 'visual', scale } }), h);
	}
});

test('visual resource icons scale within icon limits; technical cards and containers are left alone', async () => {
	const { sampleArchitecture } = await import('./fixture.ts');
	const { isResourceContainer } = await import('./resourceHierarchy.ts');
	const { resourceIconSize } = await import('./resourceGeometry.ts');
	const architecture = sampleArchitecture();
	const icons = architecture.resources.filter(resource => !isResourceContainer(resource)).slice(0, 2).map(resource => resource.id);
	assert.equal(icons.length, 2);
	const h = createHistory(architecture);
	assert.equal(historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: icons, mode: 'technical', scale: 2 } }), h, 'technical cards have fixed sizes');
	const scaled = historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: icons, mode: 'visual', scale: 4 } });
	for (const id of icons) {
		assert.equal(resourceIconSize(scaled.present.resources.find(resource => resource.id === id)!), 160, 'clamped to the icon maximum');
	}
});

test('dragging the selection corner gives a proportional scale within limits', async () => {
	const { dragScale } = await import('./selectionGeometry.ts');
	const bounds = { x: 0, y: 0, width: 200, height: 100 };
	assert.equal(dragScale(bounds, 100, 0), 1.5);
	assert.equal(dragScale(bounds, 0, 100), 2, 'the larger proportional change wins');
	assert.equal(dragScale(bounds, -500, -500), 0.25);
	assert.equal(dragScale(bounds, 5000, 0), 4);
});

function boundsOf(items: BoardItem[]) {
	const x = Math.min(...items.map(item => item.positions.visual.x)); const y = Math.min(...items.map(item => item.positions.visual.y));
	return { x, y, width: Math.max(...items.map(item => item.positions.visual.x + item.width)) - x, height: Math.max(...items.map(item => item.positions.visual.y + item.height)) - y };
}

test('every fixed corner is preserved by a grouped resize in either renderer with one Undo/Redo', () => {
	const architecture = { ...board([item('a', 100, 100, 100, 50), item('b', 300, 200, 40, 40)]), groups: [{ id: 'group', label: 'Group', members: ['a', 'b'] }] };
	const bounds = boundsOf(architecture.items);
	for (const mode of ['visual', 'technical'] as const) {
		for (const anchor of resizeAnchors) {
			let h = historyReducer(createHistory(architecture), { type: 'canvas', command: { kind: 'resize', ids: ['a'], mode, scale: 2, anchor } });
			assert.equal(h.past.length, 1);
			assert.deepEqual(resizeAnchorPoint(boundsOf(h.present.items), anchor), resizeAnchorPoint(bounds, anchor), anchor);
			assert.deepEqual(h.present.items.map(item => item.width), [200, 80]);
			for (const item of h.present.items) { assert.deepEqual(item.positions.technical, item.positions.visual); }
			const resized = h.present;
			h = historyReducer(h, { type: 'undo' });
			assert.deepEqual(h.present, architecture);
			h = historyReducer(h, { type: 'redo' });
			assert.deepEqual(h.present, resized);
		}
	}
});

test('size clamps and rounding keep the fixed corner while locked drawings remain untouched', () => {
	const locked = item('locked', 9000, 9000, 100, 100, { canvasLocked: true });
	const architecture = board([item('a', 100, 100, 3900, 2000), item('b', 4200, 2200, 100, 50), locked]);
	const before = boundsOf(architecture.items.slice(0, 2));
	for (const scale of [0.25, 1.33, 4]) {
		for (const anchor of resizeAnchors) {
			const h = historyReducer(createHistory(architecture), { type: 'canvas', command: { kind: 'resize', ids: ['a', 'b', 'locked'], mode: 'visual', scale, anchor } });
			assert.deepEqual(resizeAnchorPoint(boundsOf(h.present.items.slice(0, 2)), anchor), resizeAnchorPoint(before, anchor));
			assert.deepEqual(h.present.items[2], locked);
			assert.ok(h.present.items.every(item => item.width <= 4000 && item.height <= 4000));
		}
	}
});

test('invalid resize anchors do not consume history', () => {
	const h = createHistory(board([item('a', 0, 0, 100, 50)]));
	assert.equal(historyReducer(h, { type: 'canvas', command: { kind: 'resize', ids: ['a'], mode: 'visual', scale: 2, anchor: 'centre' as never } }), h);
});

test('corner drag previews keep the opposite corner fixed for growth and shrink', () => {
	const bounds = { x: 20, y: 40, width: 200, height: 100 };
	for (const corner of resizeAnchors) {
		const anchor = resizeAnchors.find(value => value.startsWith(corner.startsWith('top') ? 'bottom' : 'top') && value.endsWith(corner.endsWith('left') ? 'right' : 'left'))!;
		const dx = corner.endsWith('right') ? 100 : -100; const dy = corner.startsWith('bottom') ? 50 : -50;
		assert.equal(dragScale(bounds, dx, dy, corner), 1.5);
		assert.equal(dragScale(bounds, -dx, -dy, corner), 0.5);
		for (const scale of [0.5, 1.5]) { assert.deepEqual(resizeAnchorPoint(scaledSelectionBounds(bounds, scale, anchor), anchor), resizeAnchorPoint(bounds, anchor)); }
	}
});
