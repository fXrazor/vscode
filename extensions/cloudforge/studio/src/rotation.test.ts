/*---------------------------------------------------------------------------------------------
 *  Drawings rotate about their centres as one undo step; resources and frames stay upright.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { dragRotation, pointerAngle, rotatedCorners, snapRotation } from './rotation.ts';
import { applyCanvasCommand, normaliseRotation } from './canvasOperations.ts';
import { createHistory, historyReducer, type Architecture, type BoardItem } from './model.ts';
import { presentationSvg } from './exportPresentation.ts';

const item = (id: string, kind: BoardItem['kind'], extra: Partial<BoardItem> = {}): BoardItem => ({ id, kind, text: id, positions: { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } }, width: 100, height: 50, members: [], ...extra });
const board = (items: BoardItem[]) => ({ name: 'Rotate', resources: [], items, connections: [] }) as unknown as Architecture;

test('pointer angle: up is 0°, right is 90°; snapping is sticky at right angles, Shift snaps to 15°', () => {
	const centre = { x: 0, y: 0 };
	assert.equal(pointerAngle(centre, { x: 0, y: -10 }), 0);
	assert.equal(pointerAngle(centre, { x: 10, y: 0 }), 90);
	assert.equal(snapRotation(92), 90, 'within 4° of a right angle');
	assert.equal(snapRotation(97), 97);
	assert.equal(snapRotation(-23, true), 330);
});

test('dragging the bottom handle turns relative to where the press started', () => {
	const centre = { x: 0, y: 0 };
	// Press below the centre (180°), sweep to the left (270°): a drawing at 10° turns to 100°.
	assert.equal(dragRotation(10, centre, { x: 0, y: 10 }, { x: -10, y: 0 }), 100);
	assert.equal(dragRotation(0, centre, { x: 0, y: 10 }, { x: 0, y: 10 }), 0, 'a click without movement keeps the angle');
});

test('rotation normalises, skips frames and locked drawings, and 0° clears the field', () => {
	assert.equal(normaliseRotation(-15), 345);
	assert.equal(normaliseRotation(720), undefined);
	let architecture = board([item('note', 'note'), item('frame', 'frame'), item('locked', 'shape', { canvasLocked: true })]);
	architecture = applyCanvasCommand(architecture, { kind: 'rotate', ids: ['note', 'frame', 'locked'], by: 30 });
	assert.deepEqual(architecture.items.map(entry => entry.rotation), [30, undefined, undefined]);
	architecture = applyCanvasCommand(architecture, { kind: 'rotate', ids: ['note'], by: -30 });
	assert.ok(!('rotation' in architecture.items[0]));
});

test('a rotation is one undo step and exports with a centred rotate transform', async () => {
	let h = createHistory(board([item('shape', 'shape', { shape: 'rectangle' as BoardItem['shape'] })]));
	h = historyReducer(h, { type: 'canvas', command: { kind: 'rotate', ids: ['shape'], angle: 45 } });
	assert.equal(h.present.items[0].rotation, 45);
	assert.ok((await presentationSvg(h.present)).includes('rotate(45 50 25)'));
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.items[0].rotation, undefined);
});

test('rotated corners keep the centre', () => {
	const corners = rotatedCorners(0, 0, 100, 50, 90);
	assert.deepEqual(corners.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })), [{ x: 75, y: -25 }, { x: 75, y: 75 }, { x: 25, y: 75 }, { x: 25, y: -25 }]);
});
