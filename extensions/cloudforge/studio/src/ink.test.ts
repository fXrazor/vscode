/*---------------------------------------------------------------------------------------------
 *  Freehand strokes become one ink drawing whose path stretches with the element.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { inkDefaults, normaliseInkStyle, strokePath, strokeToInk, thinStroke } from './ink.ts';
import { createHistory, historyReducer } from './model.ts';
import { presentationSvg } from './exportPresentation.ts';

test('thinning keeps the first and final points and drops jitter', () => {
	const thinned = thinStroke([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 3, y: 0 }, { x: 3.4, y: 0 }], 2);
	assert.deepEqual(thinned, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3.4, y: 0 }]);
});

test('a stroke becomes a padded box with a 0–100 path', () => {
	const ink = strokeToInk([{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 200 }], 4);
	assert.ok(ink);
	assert.deepEqual({ ...ink.position, width: ink.width, height: ink.height }, { x: 96, y: 96, width: 108, height: 108 });
	const numbers = ink.path.match(/-?[0-9.]+/g)!.map(Number);
	assert.ok(numbers.every(value => value >= 0 && value <= 100), ink.path);
	assert.ok(ink.path.startsWith('M') && ink.path.includes('Q'));
});

test('a dot still gets a minimum box and a drawable path', () => {
	const ink = strokeToInk([{ x: 10, y: 10 }]);
	assert.equal(ink?.width, 16);
	assert.equal(strokePath([{ x: 5, y: 5 }]), 'M5 5l0 0');
});

test('an ink drawing is one undoable step and exports as an SVG path', async () => {
	const ink = strokeToInk([{ x: 0, y: 0 }, { x: 40, y: 40 }])!;
	let h = createHistory({ name: 'Ink', resources: [], items: [], connections: [] } as never);
	h = historyReducer(h, { type: 'addItem', item: { id: 'ink-1', kind: 'ink', text: '', path: ink.path, positions: { visual: ink.position, technical: ink.position }, width: ink.width, height: ink.height, members: [] } });
	assert.equal(h.present.items.length, 1);
	const svg = await presentationSvg(h.present);
	assert.ok(svg.includes('aria-label="Freehand drawing"') && svg.includes(ink.path));
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.items.length, 0);
});

test('pen presets reject invalid colours and keep weight inside drawing style limits', () => {
	assert.deepEqual(normaliseInkStyle({}), { strokeColor: inkDefaults.strokeColor, strokeWidth: inkDefaults.strokeWidth });
	assert.deepEqual(normaliseInkStyle({ strokeColor: '#1274ab', strokeWidth: 6 }), { strokeColor: '#1274ab', strokeWidth: 6 });
	for (const weight of [-10, 0, 1, 4.5, 8, 99]) {
		const preset = normaliseInkStyle({ strokeColor: 'url(secret)', strokeWidth: weight });
		assert.equal(preset.strokeColor, inkDefaults.strokeColor);
		assert.ok(Number.isInteger(preset.strokeWidth) && preset.strokeWidth >= 1 && preset.strokeWidth <= 8);
	}
	assert.equal(normaliseInkStyle({ strokeWidth: NaN }).strokeWidth, inkDefaults.strokeWidth);
});

test('a chosen pen weight pads the stroke and persists through export and one-step undo/redo', async () => {
	const preset = normaliseInkStyle({ strokeColor: '#1274ab', strokeWidth: 8 });
	const ink = strokeToInk([{ x: 0, y: 0 }, { x: 100, y: 50 }], preset.strokeWidth)!;
	assert.equal(ink.width, 116);
	assert.equal(ink.height, 66);
	let h = createHistory({ name: 'Ink', resources: [], items: [], connections: [] } as never);
	h = historyReducer(h, { type: 'addItem', item: { id: 'ink-1', kind: 'ink', text: '', path: ink.path, ...preset, width: ink.width, height: ink.height, positions: { visual: ink.position, technical: ink.position }, members: [] } });
	assert.equal(h.past.length, 1);
	const svg = await presentationSvg(h.present);
	assert.ok(svg.includes('stroke="#1274ab"') && svg.includes('stroke-width="8"'));
	const drawing = h.present.items[0];
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.items.length, 0);
	h = historyReducer(h, { type: 'redo' });
	assert.deepEqual(h.present.items[0], drawing);
});
