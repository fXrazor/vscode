/*---------------------------------------------------------------------------------------------
 *  Multi-object resize is one semantic step on the shared architecture.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer, type Architecture, type BoardItem } from './model.ts';

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
