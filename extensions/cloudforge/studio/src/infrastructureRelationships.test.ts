/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleArchitecture } from './fixture.ts';
import type { Architecture, Resource } from './model.ts';
import { createHistory, historyReducer } from './model.ts';
import { bindingKey } from './fieldBindings.ts';
import { configuredImpact, documentedHubSpokes, infrastructureRelationships, type InfrastructureRelationship } from './infrastructureRelationships.ts';
import { projectGraphSnapshotToArchitecture } from './serviceAdapter.ts';
import { selectionFragment } from './canvasOperations.ts';
import { projectTechnicalGraph } from './technicalGraph.ts';
import { layoutTechnicalGraph } from './technicalGraphLayout.ts';

function node(id: string, type: string, refs: Record<string, string> = {}): Resource {
	const base = sampleArchitecture().resources.find(resource => resource.id === 'vm')!;
	return { ...base, id, name: id, parentId: undefined, kind: 'generic', catalogue: { type, label: id, service: id, category: 'Other', icon: 'azure-compute.svg', fields: [] }, settings: Object.fromEntries(Object.keys(refs).map(field => [field, ''])), resourceRefs: Object.fromEntries(Object.entries(refs).map(([field, resourceId]) => [bindingKey({ kind: 'setting', name: field }), { refs: [{ resourceId, attribute: 'id' }] }])) };
}
test('only actual field bindings create attachments; visual nesting and a design line do not', () => {
	let history = createHistory(sampleArchitecture());
	assert.equal(infrastructureRelationships(history.present).some(link => link.category === 'attachment' && link.source === 'nic' && link.target === 'vm'), false);
	history = historyReducer(history, { type: 'bindResourceRef', id: 'vm', target: { kind: 'setting', name: 'network_interface_ids' }, refs: [{ resourceId: 'nic', attribute: 'id' }] });
	const links = infrastructureRelationships(history.present);
	const attachment = links.find(link => link.source === 'nic' && link.target === 'vm');
	assert.equal(attachment?.category, 'attachment'); assert.equal(attachment?.evidence[0].field, 'network_interface_ids');
	assert.equal(attachment?.evidence[0].origin, 'binding'); assert.equal(attachment?.ordering, true);
	assert.ok(links.some(link => link.target === 'vm' && link.source === 'resource-group' && link.category === 'reference' && link.evidence.some(item => item.field === 'location')));
	assert.ok(!links.some(link => link.target === 'vm' && link.source === 'subnet' && link.category === 'ownership'));
});
test('AWS, GCP and unreviewed field references preserve different meanings without creating runtime links', () => {
	const architecture: Architecture = { name: 'Relations', items: [], connections: [], resources: [node('subnet', 'aws_subnet'), node('ec2', 'aws_instance', { subnet_id: 'subnet' }), node('vpc', 'google_compute_network'), node('sql', 'google_sql_database_instance', { 'settings.ip_configuration.private_network': 'vpc' }), node('unknown', 'aws_unreviewed_service', { arbitrary_id: 'subnet' })] };
	const links = infrastructureRelationships(architecture);
	assert.equal(links.find(link => link.target === 'ec2')?.category, 'attachment');
	assert.equal(links.find(link => link.target === 'sql')?.category, 'attachment');
	assert.equal(links.find(link => link.target === 'unknown')?.category, 'reference');
	assert.ok(links.every(link => link.category !== 'runtime'));
});
test('explicit source dependencies retain provenance and do not invent NIC attachments or copy as service evidence', () => {
	const { architecture } = projectGraphSnapshotToArchitecture({ workspaceId: 'ws', architectureId: 'arch', architectureName: 'Explicit', sourceRevision: 'a'.repeat(64), status: 'complete', nodes: [{ id: 'nic', name: 'nic', label: 'nic', resourceType: 'azurerm_network_interface', kind: 'resource', hasSource: true }, { id: 'vm', name: 'vm', label: 'vm', resourceType: 'azurerm_linux_virtual_machine', kind: 'resource', hasSource: true }], edges: [{ fromId: 'nic', toId: 'vm', kind: 'explicit' }], diagnostics: [] });
	assert.deepEqual(architecture.connections[0].origin, { kind: 'service', edgeKind: 'explicit' });
	assert.equal(architecture.resources.find(resource => resource.id === 'vm')?.resourceRefs, undefined);
	const links = infrastructureRelationships(architecture); assert.equal(links.length, 1); assert.equal(links[0].category, 'execution');
	assert.equal(links[0].evidence[0].field, 'depends_on');
	const history = createHistory(architecture);
	for (const action of [{ type: 'reverseConnection' as const, id: architecture.connections[0].id }, { type: 'deleteConnection' as const, id: architecture.connections[0].id }]) { assert.equal(historyReducer(history, action), history); }
	assert.equal(selectionFragment(architecture, ['vm', 'nic']).connections.length, 0);
});
test('a generic source expression cannot guess a NIC field, and a real local binding survives refresh', () => {
	const snapshot = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'References', sourceRevision: 'b'.repeat(64), status: 'complete' as const, nodes: [{ id: 'nic', name: 'nic', label: 'nic', resourceType: 'azurerm_network_interface', kind: 'resource', hasSource: true }, { id: 'vm', name: 'vm', label: 'vm', resourceType: 'azurerm_linux_virtual_machine', kind: 'resource', hasSource: true }], edges: [{ fromId: 'nic', toId: 'vm', kind: 'reference' }], diagnostics: [] };
	const projected = projectGraphSnapshotToArchitecture(snapshot).architecture;
	assert.equal(projected.resources.find(resource => resource.id === 'vm')?.resourceRefs, undefined);
	assert.equal(infrastructureRelationships(projected)[0].category, 'reference');
	let history = createHistory(projected);
	history = historyReducer(history, { type: 'bindResourceRef', id: 'vm', target: { kind: 'setting', name: 'network_interface_ids' }, refs: [{ resourceId: 'nic', attribute: 'id' }] });
	assert.ok(infrastructureRelationships(history.present).some(link => link.category === 'attachment'));
	const refreshed = projectGraphSnapshotToArchitecture(snapshot, { previousArchitecture: history.present }).architecture;
	assert.deepEqual(refreshed.resources.find(resource => resource.id === 'vm')?.resourceRefs, history.present.resources.find(resource => resource.id === 'vm')?.resourceRefs);
});
test('configured impact terminates on cycles and ignores unclassified service ordering', () => {
	const links = [['a', 'b', true], ['b', 'c', true], ['c', 'a', true], ['a', 'outside', false]].map(([source, target, ordering], index) => ({ id: String(index), source, target, ordering, category: 'reference', evidence: [] })) as InfrastructureRelationship[];
	assert.deepEqual(configuredImpact(links, 'a'), { direct: ['b'], transitive: ['c'] });
});
test('hub/spoke recognition requires peering endpoints and arranges a documented sibling star centrally', () => {
	const architecture: Architecture = { name: 'Hub', items: [], connections: [], resources: [node('hub', 'azurerm_virtual_network'), node('spoke-a', 'azurerm_virtual_network'), node('spoke-b', 'azurerm_virtual_network')] };
	assert.deepEqual(documentedHubSpokes(architecture, infrastructureRelationships(architecture)), []);
	architecture.resources.push(node('peer-a', 'azurerm_virtual_network_peering', { virtual_network_name: 'hub', remote_virtual_network_id: 'spoke-a' }), node('peer-b', 'azurerm_virtual_network_peering', { virtual_network_name: 'hub', remote_virtual_network_id: 'spoke-b' }));
	const links = infrastructureRelationships(architecture); assert.equal(documentedHubSpokes(architecture, links)[0].hub, 'hub');
	const snapshot = projectTechnicalGraph(architecture); const layout = layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: true, pins: {}, edges: snapshot.edges });
	const x = (id: string) => layout.positions[id].x;
	assert.ok(x('spoke-a') < x('hub') && x('hub') < x('spoke-b'));
});
