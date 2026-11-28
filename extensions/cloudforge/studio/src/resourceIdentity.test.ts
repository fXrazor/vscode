/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer } from './model.ts';
import { adoptSavedFiles, buildHostViewState, projectGraphSnapshotToArchitecture, refreshPrevious } from './serviceAdapter.ts';
import { createRekeyer, snapshotIdMap, viewStateIdMap } from './resourceIdentity.ts';
import type { HostGraphSnapshot, HostNodeSummary } from './webviewBridge.ts';
import type { Architecture } from './model.ts';

const node = (id: string, resourceType: string, name: string): HostNodeSummary => ({ id, kind: 'resource', resourceType, name, label: resourceType + '.' + name, hasSource: true, sourceFile: 'main.tf' });
const snapshot = (nodes: HostNodeSummary[], revision: string): HostGraphSnapshot => ({ workspaceId: 'ws', architectureId: 'arch', architectureName: 'Arch', sourceRevision: revision.repeat(64), status: 'complete', nodes, edges: [], diagnostics: [] });

/** The same steps the Studio takes when the service sends a refreshed graph. */
function refresh(history: ReturnType<typeof createHistory>, baseline: Architecture, saved: { state: Architecture; files: Set<string> } | null, next: HostGraphSnapshot) {
	const idMap = snapshotIdMap(next.nodes, [history.present, saved?.state, baseline]);
	const rekey = createRekeyer(idMap);
	const prior = saved ? adoptSavedFiles(baseline, saved.state, saved.files) : baseline;
	const projected = projectGraphSnapshotToArchitecture(next, { previousArchitecture: refreshPrevious(rekey(prior), rekey(history.present)) });
	return { history: historyReducer(history, { type: 'rebase', architecture: projected.architecture, base: prior, rekey: idMap }), baseline: projected.architecture, idMap };
}

test('a save that renumbers the service ids keeps every resource where it was, with its own settings', () => {
	const first = snapshot([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_virtual_network', 'vnet_b'), node('node-3', 'azurerm_linux_virtual_machine', 'vm')], 'a');
	const loaded = projectGraphSnapshotToArchitecture(first).architecture;
	let history = createHistory(loaded);
	const vm = loaded.resources.find(resource => resource.name === 'vm')!;
	const vnet = loaded.resources.find(resource => resource.name === 'vnet_b')!;
	history = historyReducer(history, { type: 'canvas', command: { kind: 'move', mode: 'visual', positions: { [vm.id]: { x: 1500, y: 900 }, [vnet.id]: { x: 1200, y: 40 } }, fit: false } });
	history = historyReducer(history, { type: 'update', id: vm.id, patch: { settings: { ...vm.settings, size: 'Standard_B2s' } } });
	// A NIC drawn on the canvas has the Studio's own id until its block is read back.
	const drawn = projectGraphSnapshotToArchitecture(snapshot([node('x', 'azurerm_network_interface', 'nic_a')], 'c')).architecture.resources[0];
	const nic = { ...drawn, id: 'canvas-nic', positions: { visual: { x: 700, y: 700 }, technical: { x: 700, y: 700 } } };
	history = { ...history, present: { ...history.present, resources: [...history.present.resources, nic] } };
	const vmPosition = history.present.resources.find(resource => resource.id === vm.id)!.positions.visual;
	const vnetPosition = history.present.resources.find(resource => resource.id === vnet.id)!.positions.visual;

	// Saving writes nic_a; the service now numbers it before vnet_b and vm, so their ids shift.
	const second = snapshot([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_network_interface', 'nic_a'), node('node-3', 'azurerm_virtual_network', 'vnet_b'), node('node-4', 'azurerm_linux_virtual_machine', 'vm')], 'b');
	const result = refresh(history, loaded, { state: history.present, files: new Set(['main.tf']) }, second);
	assert.deepEqual(Object.fromEntries(result.idMap), { 'node-2': 'node-3', 'node-3': 'node-4', 'canvas-nic': 'node-2' });

	const present = result.history.present;
	const byName = (name: string) => present.resources.find(resource => resource.terraformName === name)!;
	assert.equal(present.resources.length, 4, 'no duplicate of the saved canvas resource');
	assert.equal(byName('vm').id, 'node-4');
	assert.deepEqual(byName('vm').positions.visual, vmPosition);
	assert.equal(byName('vm').settings.size, 'Standard_B2s', 'settings stay with their resource');
	assert.equal(byName('vnet_b').id, 'node-3');
	assert.deepEqual(byName('vnet_b').positions.visual, vnetPosition);
	assert.equal(byName('nic_a').id, 'node-2');
	assert.deepEqual(byName('nic_a').positions.visual, { x: 700, y: 700 });
	assert.ok(byName('vnet_b').settings.size === undefined || byName('vnet_b').settings.size !== 'Standard_B2s', 'the VM size never lands on the VNet');

	// Undo still acts on the right resource after the rename.
	const undone = historyReducer(result.history, { type: 'undo' }).present;
	assert.ok(undone.resources.every(resource => !resource.id.startsWith('canvas-')));
});

test('a block removed from the files never hands its position to the block that takes its id', () => {
	const first = snapshot([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_storage_account', 'old'), node('node-3', 'azurerm_key_vault', 'kv')], 'a');
	const loaded = projectGraphSnapshotToArchitecture(first).architecture;
	const map = snapshotIdMap([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_key_vault', 'kv')], [loaded]);
	assert.equal(map.get('node-3'), 'node-2');
	assert.equal(map.get('node-2'), 'node-2~stale');
});

test('reopening follows saved positions by address when the service has renumbered the ids', () => {
	const first = snapshot([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_virtual_network', 'vnet_b')], 'a');
	const loaded = projectGraphSnapshotToArchitecture(first).architecture;
	const moved = { ...loaded, resources: loaded.resources.map(resource => resource.id === 'node-2' ? { ...resource, positions: { visual: { x: 900, y: 600 }, technical: { x: 900, y: 600 } } } : resource) };
	const viewState = buildHostViewState({ architecture: moved, mode: 'visual', theme: 'light', selectedId: '', focusedWorkspaceOpen: false, inspectorOpen: true, libraryOpen: true });
	assert.equal(viewState.addresses?.['node-2'], 'azurerm_virtual_network.vnet_b');

	// The files gained a block before vnet_b while the Studio was closed.
	const reopened = snapshot([node('node-1', 'azurerm_resource_group', 'rg'), node('node-2', 'azurerm_public_ip', 'pip'), node('node-3', 'azurerm_virtual_network', 'vnet_b')], 'b');
	const projected = projectGraphSnapshotToArchitecture(reopened, { viewState }).architecture;
	assert.deepEqual(projected.resources.find(resource => resource.id === 'node-3')!.positions.visual, { x: 900, y: 600 });
	assert.notDeepEqual(projected.resources.find(resource => resource.id === 'node-2')!.positions.visual, { x: 900, y: 600 });
	assert.deepEqual(Object.fromEntries(viewStateIdMap(reopened.nodes, viewState.addresses)), { 'node-2': 'node-3' });
});
