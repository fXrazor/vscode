/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCanvasAction } from './canvasMutationPolicy.ts';
import { createHistory, historyReducer, type Action } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { terraformCode } from './terraformProjection.ts';

test('graph actions cannot move AKS, change parentage, edit fields, create/delete resources or consume project Undo', () => {
	let history = createHistory(sampleArchitecture()); const before = structuredClone(history); const code = terraformCode(history.present);
	const dispatch = (action: Action) => { history = historyReducer(history, action); };
	const actions: Action[] = [
		{ type: 'move', id: 'cluster', mode: 'technical', position: { x: 8000, y: 8000 } },
		{ type: 'placeResource', id: 'cluster', visualParentId: 'subnet', mode: 'technical', positions: { cluster: { x: 8000, y: 8000 } } },
		{ type: 'update', id: 'cluster', patch: { name: 'changed' } },
		{ type: 'resizeContainer', id: 'network', position: { x: 0, y: 0 }, width: 9000, height: 9000 },
		{ type: 'delete', id: 'cluster' }, { type: 'add', resource: { ...history.present.resources[0], id: 'extra' } },
		{ type: 'connect', source: 'network', target: 'vm' },
		{ type: 'canvas', command: { kind: 'move', mode: 'technical', positions: { cluster: { x: 8000, y: 8000 } } } },
		{ type: 'undo' }, { type: 'redo' }
	];
	for (const action of actions) { dispatchCanvasAction('technical', dispatch, action); }
	assert.deepEqual(history, before); assert.equal(terraformCode(history.present), code);
	dispatchCanvasAction('visual', dispatch, actions[0]);
	assert.equal(history.present.resources.find(resource => resource.id === 'cluster')!.positions.visual.x, 8000, 'Architecture authoring still works');
	assert.deepEqual(historyReducer(history, { type: 'undo' }).present, before.present);
});
