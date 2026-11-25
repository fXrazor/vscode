/*---------------------------------------------------------------------------------------------
 *  Semantic undo survives live refreshes of the same architecture.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer, type History } from './model.ts';
import { projectGraphSnapshotToArchitecture } from './serviceAdapter.ts';
import type { HostGraphSnapshot, HostNodeSummary } from './webviewBridge.ts';

const node = (id: string, resourceType: string, name: string): HostNodeSummary => ({ id, kind: 'resource', resourceType, name, label: name, hasSource: true });

function snapshot(nodes: HostNodeSummary[], revision: string): HostGraphSnapshot {
	return { workspaceId: 'ws-1', architectureId: 'arch-1', architectureName: 'Live', sourceRevision: revision.repeat(64), status: 'complete', nodes, edges: [], diagnostics: [] };
}

function refresh(history: History, graph: HostGraphSnapshot): History {
	const { architecture } = projectGraphSnapshotToArchitecture(graph, { previousArchitecture: history.present });
	return historyReducer(history, { type: 'rebase', architecture });
}

const rg = node('rg-1', 'azurerm_resource_group', 'rg_one');
const vnet = node('vnet-1', 'azurerm_virtual_network', 'vnet_one');

test('a refresh that echoes the current state keeps undo and redo intact', () => {
	const first = snapshot([rg], 'a');
	let h = createHistory(projectGraphSnapshotToArchitecture(first).architecture);
	const original = { ...h.present.resources[0].positions.visual };
	h = historyReducer(h, { type: 'move', id: 'rg-1', mode: 'visual', position: { x: 400, y: 300 } });
	h = historyReducer(h, { type: 'renameArchitecture', name: 'Edited' });
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.past.length, 1);
	assert.equal(h.future.length, 1);

	h = refresh(h, snapshot([rg], 'b'));
	assert.equal(h.past.length, 1, 'undo step survives');
	assert.equal(h.future.length, 1, 'redo step survives');
	h = historyReducer(h, { type: 'undo' });
	assert.deepEqual(h.present.resources[0].positions.visual, original);
});

test('undo after an external addition reverts the user edit but keeps the new resource', () => {
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot([rg], 'a')).architecture);
	h = historyReducer(h, { type: 'update', id: 'rg-1', patch: { region: 'westeurope' } });

	h = refresh(h, snapshot([rg, vnet], 'b'));
	assert.equal(h.present.resources.length, 2);
	assert.equal(h.past.length, 1);

	h = historyReducer(h, { type: 'undo' });
	assert.ok(h.present.resources.some(resource => resource.id === 'vnet-1'), 'externally added VNet stays after undo');
	assert.notEqual(h.present.resources.find(resource => resource.id === 'rg-1')?.region, 'westeurope');
	h = historyReducer(h, { type: 'redo' });
	assert.equal(h.present.resources.find(resource => resource.id === 'rg-1')?.region, 'westeurope');
	assert.equal(h.present.resources.length, 2);
});

test('an external removal is applied to every step and empty steps are dropped', () => {
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot([rg, vnet], 'a')).architecture);
	h = historyReducer(h, { type: 'move', id: 'vnet-1', mode: 'visual', position: { x: 900, y: 900 } });
	h = historyReducer(h, { type: 'update', id: 'rg-1', patch: { region: 'westeurope' } });

	h = refresh(h, snapshot([rg], 'b'));
	assert.ok(h.past.every(state => state.resources.every(resource => resource.id !== 'vnet-1')), 'removed VNet is gone from history');
	assert.equal(h.past.length, 1, 'the VNet move became a no-op and was dropped');
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.resources.length, 1);
	assert.equal(h.past.length, 0);
});

test('switching to a different architecture still starts a fresh history', () => {
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot([rg], 'a')).architecture);
	h = historyReducer(h, { type: 'renameArchitecture', name: 'Edited' });
	const other = projectGraphSnapshotToArchitecture({ ...snapshot([vnet], 'c'), architectureId: 'arch-2' }).architecture;
	h = historyReducer(h, { type: 'replace', architecture: other });
	assert.equal(h.past.length, 0);
	assert.equal(h.future.length, 0);
});
