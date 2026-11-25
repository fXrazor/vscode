/*---------------------------------------------------------------------------------------------
 *  A connector dropped on empty canvas creates and links a drawing in one undo step.
 *--------------------------------------------------------------------------------------------*/

import { elementEndpoint, endpointElementId } from './connectionEndpoints.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropChoices, droppedItem } from './connectorDrop.ts';
import { createHistory, historyReducer, type Architecture, type BoardItem } from './model.ts';

const note: BoardItem = { id: 'note-1', kind: 'note', text: 'Start', positions: { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } }, width: 220, height: 140, members: [] };
const board = { name: 'Drop', resources: [], items: [note], connections: [] } as unknown as Architecture;

test('the new drawing puts its input port on the drop point', () => {
	const item = droppedItem(dropChoices.find(choice => choice.shape === 'diamond')!, 'd-1', { x: 400, y: 300 });
	assert.deepEqual(item.positions.visual, { x: 400, y: 250 });
	assert.equal(item.kind, 'shape');
	assert.equal(item.text, 'Decision');
});

test('create-and-connect is one undo step', () => {
	let h = createHistory(board);
	h = historyReducer(h, { type: 'addConnectedItem', source: 'note-1', item: droppedItem(dropChoices[0], 'n-2', { x: 500, y: 70 }) });
	assert.equal(h.present.items.length, 2);
	assert.deepEqual(h.present.connections.map(link => [endpointElementId(link.source), endpointElementId(link.target)]), [['note-1', 'n-2']]);
	assert.equal(h.past.length, 1);
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.items.length, 1);
	assert.equal(h.present.connections.length, 0);
});

test('an unknown source or a reused id changes nothing', () => {
	const h = createHistory(board);
	assert.equal(historyReducer(h, { type: 'addConnectedItem', source: 'missing', item: droppedItem(dropChoices[0], 'n-3', { x: 0, y: 0 }) }), h);
	assert.equal(historyReducer(h, { type: 'addConnectedItem', source: 'note-1', item: { ...note } }), h);
});
