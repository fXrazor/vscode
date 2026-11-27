/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleArchitecture, resourceDefinition } from './fixture.ts';
import { createHistory, historyReducer, type Architecture } from './model.ts';
import { terraformCode } from './terraformProjection.ts';
import { fieldImpact } from './fieldImpact.ts';
import { resourceGraphic } from './resourceGraphic.ts';
import { inheritedReferences, visualParentId, visualResourcePlacement, visualDescendants } from './resourceHierarchy.ts';
import { selectionFragment } from './canvasOperations.ts';
import { liveSchemaAttributes, type HostFormSchema } from './liveSchema.ts';
import { projectGraphSnapshotToArchitecture } from './serviceAdapter.ts';

const vm = (architecture: Architecture) => architecture.resources.find(resource => resource.id === 'vm')!;
const schema = (description = '', providerVersion = '9.0.0', name = 'name'): HostFormSchema => ({ kind: 'resource', typeName: 'aws_instance', providerSource: 'hashicorp/aws', providerVersion, description: '', docsUrl: 'https://registry.terraform.io/', exampleHcl: '', blocks: [], outputs: [], attributes: [{ name, path: name, access: 'required', valueType: 'string', description }] });

test('duplicated VM can leave a subnet for a VNet visual boundary without a false VM to VNet inheritance link', () => {
	let h = createHistory(sampleArchitecture());
	h = historyReducer(h, { type: 'canvas', command: { kind: 'duplicate', fragment: selectionFragment(h.present, ['vm']), idMap: { vm: 'vm-copy' }, offset: 30 } });
	const before = h.present; const cleanCode = (architecture: Architecture) => terraformCode(architecture, 'vm-copy').split('\n').filter(line => !line.startsWith('#')).join('\n'); const terraform = cleanCode(before);
	h = historyReducer(h, { type: 'placeResource', id: 'vm-copy', visualParentId: 'network', mode: 'visual', positions: { 'vm-copy': { x: 500, y: 240 } } });
	const copy = h.present.resources.find(resource => resource.id === 'vm-copy')!;
	assert.equal(copy.visualParentId, 'network'); assert.equal(copy.parentId, 'resource-group');
	assert.deepEqual(copy.resourceRefs, before.resources.find(resource => resource.id === 'vm-copy')!.resourceRefs);
	assert.equal(cleanCode(h.present), terraform, 'visual regrouping creates no Terraform attachment');
	assert.ok(inheritedReferences(h.present, copy).every(reference => reference.source.id !== 'network'));
	assert.deepEqual(copy.positions.visual, copy.positions.technical);
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, before);
	assert.deepEqual(historyReducer(historyReducer(h, { type: 'undo' }), { type: 'redo' }).present, h.present);
});

test('visual movement, duplication and deletion follow visual ownership and keep safe inheritance', () => {
	let h = createHistory(sampleArchitecture());
	h = historyReducer(h, { type: 'placeResource', id: 'vm', visualParentId: 'network', mode: 'visual', positions: { vm: { x: 400, y: 240 } } });
	assert.ok(!visualDescendants(h.present, 'subnet').some(resource => resource.id === 'vm'));
	const before = vm(h.present).positions.visual;
	h = historyReducer(h, { type: 'canvas', command: { kind: 'move', mode: 'technical', positions: { subnet: { x: 200, y: 400 } } } });
	assert.deepEqual(vm(h.present).positions.visual, before, 'old subnet no longer moves the VM');
	const network = h.present.resources.find(resource => resource.id === 'network')!;
	h = historyReducer(h, { type: 'canvas', command: { kind: 'move', mode: 'technical', positions: { network: { x: network.positions.technical.x + 40, y: network.positions.technical.y + 20 } } } });
	assert.deepEqual(vm(h.present).positions.visual, { x: before.x + 40, y: before.y + 20 });
	const fragment = selectionFragment(h.present, ['network']); const idMap = Object.fromEntries(fragment.resources.map(resource => [resource.id, resource.id + '-copy']));
	h = historyReducer(h, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: 30 } });
	assert.equal(h.present.resources.find(resource => resource.id === 'vm-copy')!.visualParentId, 'network-copy');
	const original = h.present;
	h = historyReducer(h, { type: 'delete', id: 'network' });
	assert.ok(!h.present.resources.some(resource => resource.id === 'vm'));
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, original);
});

test('visual placement rejects cross-provider and cyclic targets, clears root inheritance, and protects locked contents', () => {
	let h = createHistory(sampleArchitecture()); const original = h;
	h = historyReducer(h, { type: 'placeResource', id: 'network', visualParentId: 'subnet', mode: 'visual' });
	assert.equal(h, original);
	assert.equal(visualResourcePlacement({ ...h.present, resources: h.present.resources.map(resource => resource.id === 'network' ? { ...resource, provider: 'aws' } : resource) }, vm(h.present), 'network').ok, false);
	h = historyReducer(h, { type: 'placeResource', id: 'vm', visualParentId: null, mode: 'visual' });
	assert.equal(vm(h.present).parentId, undefined); assert.equal(visualParentId(vm(h.present)), undefined);
	h = historyReducer(h, { type: 'undo' });
	h = historyReducer(h, { type: 'canvas', command: { kind: 'lock', ids: ['vm'], locked: true } });
	const locked = h;
	h = historyReducer(h, { type: 'delete', id: 'subnet' });
	assert.equal(h, locked, 'container deletion cannot remove a locked owned child');
});

test('graphic changes preserve Terraform identity and export selection rejects arbitrary paths', () => {
	let h = createHistory(sampleArchitecture()); const before = terraformCode(h.present);
	h = historyReducer(h, { type: 'update', id: 'vm', patch: { iconOverride: { icon: 'catalog-icons/aws/aws-ec2.svg', provider: 'aws', label: 'EC2' } } });
	assert.equal(resourceGraphic(vm(h.present)).icon, 'catalog-icons/aws/aws-ec2.svg');
	assert.equal(resourceDefinition(vm(h.present)).type, 'azurerm_linux_virtual_machine');
	assert.equal(terraformCode(h.present), before);
	assert.notEqual(resourceGraphic({ ...vm(h.present), iconOverride: { icon: '../outside.svg', provider: 'aws', label: 'Invalid' } }).icon, '../outside.svg');
	assert.equal(vm(historyReducer(h, { type: 'undo' }).present).iconOverride, undefined);
});

test('refresh retains visual ownership and graphic overrides; vanished targets are pruned from undo snapshots', () => {
	const nodes = sampleArchitecture().resources.map(resource => ({ id: resource.id, kind: 'resource', resourceType: resourceDefinition(resource).type, name: resource.name, label: resource.name, hasSource: true }));
	const snapshot = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'Fresh', sourceRevision: 'b'.repeat(64), status: 'complete' as const, nodes, edges: [], diagnostics: [] };
	let h = createHistory(projectGraphSnapshotToArchitecture(snapshot).architecture);
	h = historyReducer(h, { type: 'placeResource', id: 'vm', visualParentId: 'network', mode: 'visual' });
	h = historyReducer(h, { type: 'update', id: 'vm', patch: { iconOverride: { icon: 'aws-ec2.svg', provider: 'aws', label: 'EC2' } } });
	const fresh = projectGraphSnapshotToArchitecture(snapshot, { previousArchitecture: h.present }).architecture;
	assert.equal(vm(fresh).visualParentId, 'network'); assert.equal(vm(fresh).iconOverride?.provider, 'aws');
	h = historyReducer(h, { type: 'rebase', architecture: fresh });
	assert.equal(h.past.length, 2);
	const removed = projectGraphSnapshotToArchitecture({ ...snapshot, nodes: nodes.filter(node => node.id !== 'network') }, { previousArchitecture: h.present }).architecture;
	h = historyReducer(h, { type: 'rebase', architecture: removed });
	assert.equal(vm(h.present).visualParentId, undefined);
	assert.ok(h.past.every(state => !state.resources.some(resource => resource.visualParentId === 'network')));
});

test('replacement guidance is evidence-scoped across providers and does not infer from unrelated words', () => {
	const resource = vm(sampleArchitecture());
	assert.equal(fieldImpact({ ...resource, provider: 'aws' }, ['name'], schema('Changing this value requires replacement.'))?.kind, 'replacement');
	assert.equal(fieldImpact(resource, ['name'], schema('Automatically replaced on hardware failure.')), undefined);
	assert.equal(fieldImpact(resource, ['name'], schema('Creates a replacement environment in a blue/green deployment.')), undefined);
	const group = sampleArchitecture().resources.find(resource => resource.kind === 'group')!;
	assert.equal(fieldImpact(group, ['name'])?.kind, 'replacement');
	assert.equal(fieldImpact(group, ['name'], { ...schema(''), typeName: 'azurerm_resource_group' }), undefined, 'a rule for 5.14 must not be reused for 9.0');
	const gcp = { ...resource, provider: 'gcp' as const };
	assert.equal(fieldImpact(gcp, ['machine_type'])?.kind, 'restart');
	assert.equal(fieldImpact(gcp, ['name'])?.kind, 'replacement');
	assert.equal(fieldImpact(resource, ['name'], { ...schema('Changing this forces a new resource.'), kind: 'dataSource' }), undefined);
});

test('live computed-only fields cannot reappear as editable curated attributes', () => {
	const base = schema(); const live: HostFormSchema = { ...base, attributes: [{ ...base.attributes[0], access: 'computedOnly' }] };
	assert.deepEqual(liveSchemaAttributes(live, [{ name: 'name', type: 'string', description: 'Curated fallback' }]), []);
});
