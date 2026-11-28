/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistory, historyReducer } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { variableUses, type VariableDefinition } from './variables.ts';

test('mixed list variable uses protect deletion and rename until entries are removed, including object leaves', () => {
	const architecture = sampleArchitecture();
	const scalar: VariableDefinition = { id: 'list-input', name: 'extra_nic_id', type: 'string', description: '', sensitive: false };
	const object: VariableDefinition = { id: 'object-input', name: 'network_config', type: 'object', defaultValue: { nic: 'qa-nic' }, description: '', sensitive: false };
	architecture.variables = [scalar, object];
	const target = { kind: 'setting' as const, name: 'network_interface_ids' };
	let history = historyReducer(createHistory(architecture), { type: 'setListEntries', id: 'vm', target, items: [
		{ kind: 'ref', resourceId: 'nic', attribute: 'id' }, { kind: 'variable', variableId: scalar.id },
		{ kind: 'variable', variableId: scalar.id }, { kind: 'variable', variableId: object.id, path: ['nic'] },
	] });
	for (const variable of [scalar, object]) {
		assert.deepEqual([...variableUses(history.present).get(variable.name) ?? []], ['vm'], 'one resource use even with repeated entries');
		assert.equal(historyReducer(history, { type: 'deleteVariable', id: variable.id }), history, 'used variable cannot be deleted');
		assert.equal(historyReducer(history, { type: 'saveVariable', variable: { ...variable, name: variable.name + '_renamed' } }), history, 'used variable cannot be renamed');
	}
	history = historyReducer(history, { type: 'setListEntries', id: 'vm', target, items: [{ kind: 'ref', resourceId: 'nic', attribute: 'id' }] });
	assert.equal(variableUses(history.present).has(scalar.name), false);
	assert.equal(variableUses(history.present).has(object.name), false);
	const removed = historyReducer(history, { type: 'deleteVariable', id: scalar.id });
	assert.equal(removed.present.variables?.some(variable => variable.id === scalar.id), false, 'unreferenced variable can be deleted');
	history = historyReducer(historyReducer(removed, { type: 'undo' }), { type: 'undo' });
	assert.deepEqual([...variableUses(history.present).get(scalar.name) ?? []], ['vm'], 'Undo restores usage protection');
	assert.equal(historyReducer(history, { type: 'deleteVariable', id: scalar.id }), history);
});
