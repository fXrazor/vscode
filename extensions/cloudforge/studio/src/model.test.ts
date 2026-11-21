/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistory, historyReducer, checkDraft } from './model.ts';
import { sampleArchitecture } from './fixture.ts';

test('semantic edits share one history while each mode retains its layout', () => {
	const initial = createHistory(sampleArchitecture());
	const moved = historyReducer(initial, { type: 'move', id: 'network', mode: 'technical', position: { x: 900, y: 10 } });
	const renamed = historyReducer(moved, { type: 'update', id: 'network', patch: { name: 'renamed-network' } });
	assert.equal(renamed.present.resources[0].name, 'renamed-network');
	assert.deepEqual(renamed.present.resources[0].positions.visual, initial.present.resources[0].positions.visual);
	assert.deepEqual(historyReducer(renamed, { type: 'undo' }), { ...moved, future: [renamed.present] });
	assert.deepEqual(historyReducer(historyReducer(renamed, { type: 'undo' }), { type: 'redo' }).present, renamed.present);
	assert.equal(initial.present.resources[0].name, 'vnet-production');
});

test('deleting a resource removes its connections and undo restores them together', () => {
	const initial = createHistory(sampleArchitecture());
	const deleted = historyReducer(initial, { type: 'delete', id: 'subnet' });
	assert.equal(deleted.present.connections.some(connection => connection.source === 'subnet' || connection.target === 'subnet'), false);
	assert.deepEqual(historyReducer(deleted, { type: 'undo' }).present, initial.present);
});

test('a new edit after undo discards the redo branch', () => {
	const initial = createHistory(sampleArchitecture());
	const edited = historyReducer(initial, { type: 'update', id: 'network', patch: { name: 'first' } });
	const undone = historyReducer(edited, { type: 'undo' });
	const changed = historyReducer(undone, { type: 'update', id: 'network', patch: { name: 'second' } });
	assert.equal(changed.future.length, 0);
	assert.equal(historyReducer(changed, { type: 'redo' }), changed);
});

test('connections reject dangling, self and duplicate links without adding history', () => {
	const initial = createHistory(sampleArchitecture());
	for (const [source, target] of [['missing', 'network'], ['network', 'network'], ['network', 'subnet']]) {
		assert.equal(historyReducer(initial, { type: 'connect', source, target }), initial);
	}
});

test('draft name findings are derived from current edits and clear after correction', () => {
	const initial = createHistory(sampleArchitecture());
	const duplicate = historyReducer(initial, { type: 'update', id: 'subnet', patch: { name: 'VNET-PRODUCTION' } });
	assert.equal(checkDraft(duplicate.present).length, 1);
	assert.deepEqual(checkDraft(initial.present), []);
});

test('moving a frame moves its members in only the active mode as one undoable edit', () => {
	const initial = createHistory(sampleArchitecture());
	const moved = historyReducer(initial, { type: 'moveItem', id: 'frame-network', mode: 'visual', position: { x: 120, y: 165 } });
	assert.equal(moved.present.resources[0].positions.visual.x, initial.present.resources[0].positions.visual.x + 100);
	assert.deepEqual(moved.present.resources[0].positions.technical, initial.present.resources[0].positions.technical);
	assert.deepEqual(moved.present.resources[2], initial.present.resources[2]);
	assert.deepEqual(historyReducer(moved, { type: 'undo' }).present, initial.present);
});


test('unchanged inline field input does not consume an undo step', () => {
 const initial = createHistory(sampleArchitecture());
 const changed = historyReducer(initial, { type: 'update', id: 'cluster', patch: { name: 'shared-inline' } });
 assert.equal(historyReducer(changed, { type: 'update', id: 'cluster', patch: { name: 'shared-inline' } }), changed);
 assert.deepEqual(historyReducer(changed, { type: 'undo' }).present, initial.present);
});

test('inserting a template is one undo step for resources and their relationships', () => {
 const initial=createHistory(sampleArchitecture());
 const template=sampleArchitecture();
 template.resources=template.resources.slice(0,2).map(resource=>({...resource,id:'template-'+resource.id}));
 template.items=[];
 template.connections=[{id:'template-link',source:'template-network',target:'template-subnet'}];
 const added=historyReducer(initial,{type:'insert',architecture:template});
 assert.equal(added.present.resources.length,initial.present.resources.length+2);
 assert.ok(added.present.connections.some(edge=>edge.id==='template-link'));
 assert.equal(added.past.length,1);
 assert.deepEqual(historyReducer(added,{type:'undo'}).present,initial.present);
 assert.deepEqual(historyReducer(historyReducer(added,{type:'undo'}),{type:'redo'}).present,added.present);
});
