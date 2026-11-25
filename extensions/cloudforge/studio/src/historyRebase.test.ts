/*---------------------------------------------------------------------------------------------
 *  Semantic undo survives live refreshes of the same architecture.
 *--------------------------------------------------------------------------------------------*/

import { elementEndpoint, endpointElementId } from './connectionEndpoints.ts';
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
const rg2 = node('rg-2', 'azurerm_resource_group', 'rg_two');

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

test('a refresh keeps user drawing links, edge styling, groups and layer order', () => {
	const withEdge = { ...snapshot([rg, rg2], 'a'), edges: [{ fromId: 'rg-2', toId: 'rg-1', kind: 'depends_on' }] } as unknown as HostGraphSnapshot;
	let h = createHistory(projectGraphSnapshotToArchitecture(withEdge).architecture);
	const serviceEdge = h.present.connections[0];
	assert.ok(serviceEdge, 'service edge projected as a design connection');
	h = historyReducer(h, { type: 'updateConnection', id: serviceEdge.id, patch: { stroke: '#ff0000' } });
	h = historyReducer(h, { type: 'addItem', item: { id: 'note-1', kind: 'note', text: 'Ingress', positions: { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } }, width: 120, height: 80, members: [] } });
	h = historyReducer(h, { type: 'connect', source: 'note-1', target: 'rg-1' });
	const userLink = h.present.connections.find(connection => endpointElementId(connection.source) === 'note-1');
	assert.ok(userLink, 'user drawing link created');
	const groupedInput = { ...h.present, groups: [{ id: 'g-1', label: 'Group', members: ['note-1', 'rg-1'] }], layerOrder: ['note-1', 'rg-1', 'rg-2'] };
	h = { ...h, present: groupedInput };

	h = refresh(h, { ...withEdge, sourceRevision: 'b'.repeat(64) });
	assert.ok(h.present.connections.some(connection => connection.id === userLink.id), 'drawing link survives');
	assert.equal(h.present.connections.find(connection => connection.id === serviceEdge.id)?.stroke, '#ff0000', 'edge styling survives');
	assert.deepEqual(h.present.groups?.map(group => group.id), ['g-1']);
	assert.deepEqual(h.present.layerOrder, ['note-1', 'rg-1', 'rg-2']);

	h = refresh(h, { ...snapshot([rg2], 'c') });
	assert.ok(!h.present.connections.some(connection => endpointElementId(connection.target) === 'rg-1'), 'links to a removed resource are pruned');
	assert.equal(h.present.groups, undefined, 'a group left with one member is dropped');
	assert.deepEqual(h.present.layerOrder, ['note-1', 'rg-2']);
});

test('unsaved canvas edits survive a refresh and file changes land on top of them', () => {
	const graph = snapshot([rg, vnet], 'a');
	const vnetId = 'vnet-1';
	const [mine, theirs] = ['Address space', 'DNS servers'];
	const projected = projectGraphSnapshotToArchitecture(graph).architecture;
	const baseline = { ...projected, resources: projected.resources.map(resource => resource.id === vnetId ? { ...resource, settings: { ...resource.settings, [mine]: 'old', [theirs]: 'old' } } : resource) };
	let h = createHistory(baseline);
	// The user edits one setting on the canvas and does not save.
	const edited = { ...h.present, resources: h.present.resources.map(resource => resource.id === vnetId ? { ...resource, settings: { ...resource.settings, [mine]: 'canvas-value' } } : resource) };
	h = { past: [baseline], present: edited, future: [] } as History;
	// Meanwhile the file changes another setting of the same resource and a refresh arrives.
	const fromFiles = { ...baseline, resources: baseline.resources.map(resource => resource.id === vnetId ? { ...resource, settings: { ...resource.settings, [theirs]: 'file-value' } } : resource) };
	h = historyReducer(h, { type: 'rebase', architecture: fromFiles, base: baseline });
	const vnetNow = h.present.resources.find(resource => resource.id === vnetId)!;
	assert.equal(vnetNow.settings[mine], 'canvas-value', 'unsaved edit kept');
	assert.equal(vnetNow.settings[theirs], 'file-value', 'file change applied');
	assert.notEqual(h.present, fromFiles, 'still dirty against the new baseline');
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.resources.find(resource => resource.id === vnetId)!.settings[theirs], 'file-value', 'undo keeps the file change');

	// Both changed the same field: the file wins.
	const conflict = { ...fromFiles, resources: fromFiles.resources.map(resource => resource.id === vnetId ? { ...resource, settings: { ...resource.settings, [mine]: 'file-wins' } } : resource) };
	let c = { past: [], present: { ...edited }, future: [] } as History;
	c = historyReducer(c, { type: 'rebase', architecture: conflict, base: baseline });
	assert.equal(c.present.resources.find(resource => resource.id === vnetId)!.settings[mine], 'file-wins');

	// No canvas edits: the refreshed object becomes the present, so the canvas reads as clean.
	let clean = createHistory(baseline);
	clean = historyReducer(clean, { type: 'rebase', architecture: fromFiles, base: baseline });
	assert.equal(clean.present, fromFiles);
});

test('a local architecture rename survives repeated refreshes and stays undoable alongside external additions', () => {
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot([rg], 'a')).architecture);
	h = historyReducer(h, { type: 'renameArchitecture', name: 'Platform network' });
	h = refresh(h, snapshot([rg, vnet], 'b'));
	assert.equal(h.present.name, 'Platform network');
	assert.equal(h.past.length, 1);
	h = refresh(h, snapshot([rg, vnet], 'c'));
	assert.equal(h.present.name, 'Platform network');
	assert.equal(h.past.length, 1, 'refresh does not create a second rename gesture');
	h = historyReducer(h, { type: 'undo' });
	assert.equal(h.present.name, 'Live');
	assert.ok(h.present.resources.some(resource => resource.id === vnet.id), 'external resource survives rename Undo');
	h = historyReducer(h, { type: 'redo' });
	assert.equal(h.present.name, 'Platform network');
});

test('an undone rename remains in redo after refresh; a different architecture takes its own name', () => {
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot([rg], 'a')).architecture);
	h = historyReducer(h, { type: 'renameArchitecture', name: 'Platform network' });
	h = historyReducer(h, { type: 'undo' });
	h = refresh(h, snapshot([rg, vnet], 'b'));
	assert.equal(h.present.name, 'Live');
	assert.equal(h.future.length, 1);
	h = historyReducer(h, { type: 'redo' });
	assert.equal(h.present.name, 'Platform network');
	// App passes previousArchitecture only for a refresh of the same architecture identity.
	const other = projectGraphSnapshotToArchitecture({ ...snapshot([rg2], 'c'), architectureId: 'arch-2', architectureName: 'Second environment' }).architecture;
	h = historyReducer(h, { type: 'replace', architecture: other });
	assert.equal(h.present.name, 'Second environment');
	assert.equal(h.past.length, 0);
	assert.equal(h.future.length, 0);
});
