/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { applyTerraformDraft, terraformCode } from './terraformProjection.ts';
import { inheritedDependencies } from './resourceHierarchy.ts';
import { architectureDiagnostics } from './diagnostics.ts';
import { eligibleReferenceTargets, fieldDefinition, fieldExpression, resourceRefBindingIssue } from './fieldBindings.ts';
import { selectionFragment } from './canvasOperations.ts';

test('VM network_interface_ids binds to compatible NIC ID, projects HCL, derives dependency edge, round-trips sibling edits, and undoes atomically', () => {
	const base = sampleArchitecture();
	const vm = base.resources.find(r => r.name === 'vm-application')!;
	const nic = base.resources.find(r => r.name === 'nic-application')!;
	assert.ok(vm && nic);

	const def = fieldDefinition(vm, { kind: 'setting', name: 'network_interface_ids' });
	const candidates = eligibleReferenceTargets(base, vm, def);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].resource.id, nic.id);
	assert.equal(candidates[0].attribute, 'id');

	let history = createHistory(base);
	history = historyReducer(history, {
		type: 'bindResourceRef',
		id: vm.id,
		target: { kind: 'setting', name: 'network_interface_ids' },
		refs: [{ resourceId: nic.id, attribute: 'id' }],
	});
	const boundVm = history.present.resources.find(r => r.id === vm.id)!;
	assert.equal(
		fieldExpression(boundVm, { kind: 'setting', name: 'network_interface_ids' }, history.present.variables, history.present),
		'[azurerm_network_interface.nic-application.id]'
	);

	// Terraform projection emits real typed $ref list expression
	const hcl = terraformCode(history.present, vm.id);
	assert.ok(hcl.includes('network_interface_ids = [azurerm_network_interface.nic-application.id]'), hcl);

	// Derived Technical-view dependency edge links NIC -> VM distinctly from drawing connections
	const deps = inheritedDependencies(history.present);
	assert.ok(deps.some(d => d.source === nic.id && d.target === vm.id && d.fields.includes('network_interface_ids')));
	assert.equal(history.present.connections.length, base.connections.length);

	// Sibling HCL edit preserves typed NIC reference during applyTerraformDraft
	const editedHcl = hcl.replace('Standard_D2s_v5', 'Standard_B2s');
	const applied = applyTerraformDraft(history.present, editedHcl, vm.id);
	assert.equal(applied.length, 1);
	assert.equal(applied[0].settings.Size ?? applied[0].settings.size, 'Standard_B2s');
	assert.deepEqual(applied[0].resourceRefs, boundVm.resourceRefs);

	// One semantic Undo restores empty network_interface_ids
	const undone = historyReducer(history, { type: 'undo' });
	assert.equal(undone.present.resources.find(r => r.id === vm.id)?.resourceRefs, undefined);
});

test('Nested block subnet_id reference overrides inheritance, rejects invalid/cyclic targets, remaps on copy, and flags deleted targets', () => {
	const base = sampleArchitecture();
	const nic = base.resources.find(r => r.name === 'nic-application')!;
	const subnet = base.resources.find(r => r.name === 'snet-applications')!;
	const rg = base.resources.find(r => r.name === 'rg-production')!;
	const ipBlock = nic.blocks.find(b => b.type === 'ip_configuration')!;
	assert.ok(nic && subnet && rg && ipBlock);

	let history = createHistory(base);
	// Reject incompatible target (RG is not an azurerm_subnet)
	const rejected = historyReducer(history, {
		type: 'bindResourceRef',
		id: nic.id,
		target: { kind: 'block', blockId: ipBlock.id, name: 'subnet_id' },
		refs: [{ resourceId: rg.id, attribute: 'id' }],
	});
	assert.equal(rejected.past.length, 0);

	// Bind explicit subnet reference on nested block
	history = historyReducer(history, {
		type: 'bindResourceRef',
		id: nic.id,
		target: { kind: 'block', blockId: ipBlock.id, name: 'subnet_id' },
		refs: [{ resourceId: subnet.id, attribute: 'id' }],
	});
	assert.equal(history.past.length, 1);
	const nicHcl = terraformCode(history.present, nic.id);
	assert.match(nicHcl, /subnet_id\s+=\s+azurerm_subnet\.snet-applications\.id/);

	// Copying container holding VM + NIC remaps internal VM -> NIC reference to the new NIC copy
	const vm = history.present.resources.find(r => r.name === 'vm-application')!;
	history = historyReducer(history, {
		type: 'bindResourceRef',
		id: vm.id,
		target: { kind: 'setting', name: 'network_interface_ids' },
		refs: [{ resourceId: nic.id, attribute: 'id' }],
	});
	const fragment = selectionFragment(history.present, [vm.id, nic.id]);
	const idMap = { [vm.id]: 'vm-copy', [nic.id]: 'nic-copy' };
	const duplicated = historyReducer(history, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: 40 } });
	const copiedVm = duplicated.present.resources.find(r => r.id === 'vm-copy')!;
	const copiedNic = duplicated.present.resources.find(r => r.id === 'nic-copy')!;
	assert.ok(copiedVm && copiedNic);
	assert.equal(copiedVm.resourceRefs?.['["setting","network_interface_ids"]']?.refs[0]?.resourceId, 'nic-copy');

	// Deleting referenced NIC triggers truthful missing-reference diagnostic on VM
	const afterDeleteNic = historyReducer(history, { type: 'delete', id: nic.id });
	const vmDiags = architectureDiagnostics(afterDeleteNic.present).filter(d => d.resourceId === vm.id);
	assert.ok(vmDiags.some(d => d.message.includes('referenced resource is missing')), JSON.stringify(vmDiags));
});

test('uncurated catalogue types infer reference targets from *_id and *_ids argument names', () => {
	const base = sampleArchitecture();
	const template = base.resources.find(r => r.name === 'vm-application')!;
	const nic = base.resources.find(r => r.name === 'nic-application')!;
	const legacyVm = {
		...template, id: 'legacy-vm', name: 'legacy-vm', settings: {}, resourceRefs: {}, fieldBindings: {},
		catalogue: { type: 'azurerm_virtual_machine', label: 'Virtual machine', service: 'Compute', category: 'Compute', icon: '', curated: false, fields: [
			{ name: 'network_interface_ids', type: 'list', description: 'NICs.' },
			{ name: 'availability_set_id', type: 'string', description: 'Availability set.' },
			{ name: 'tenant_id', type: 'string', description: 'Tenant.' },
			{ name: 'resource_group_name', type: 'string', description: 'Resource group.' },
			{ name: 'computer_name', type: 'string', description: 'Host name.' },
		] },
	} as unknown as typeof template;
	const architecture = { ...base, resources: [...base.resources, legacyVm] };

	const nics = fieldDefinition(legacyVm, { kind: 'setting', name: 'network_interface_ids' });
	assert.deepEqual(nics?.refTypes, ['azurerm_network_interface']);
	assert.equal(nics?.refInferred, true);
	assert.deepEqual(eligibleReferenceTargets(architecture, legacyVm, nics).map(item => item.resource.id), [nic.id]);
	assert.deepEqual(fieldDefinition(legacyVm, { kind: 'setting', name: 'availability_set_id' })?.refTypes, ['azurerm_availability_set']);
	assert.equal(fieldDefinition(legacyVm, { kind: 'setting', name: 'tenant_id' })?.refTypes, undefined);
	const group = fieldDefinition(legacyVm, { kind: 'setting', name: 'resource_group_name' });
	assert.deepEqual([group?.refTypes, group?.refAttr], [['azurerm_resource_group'], 'name']);
	const rgCandidates = eligibleReferenceTargets(architecture, legacyVm, group);
	assert.ok(rgCandidates.length > 0 && rgCandidates.every(item => item.attribute === 'name' && item.expression.startsWith('azurerm_resource_group.')));
	assert.equal(resourceRefBindingIssue({ refs: [{ resourceId: rgCandidates[0].resource.id, attribute: 'name' }] }, architecture, legacyVm, group), undefined);
	// No azurerm_computer resource exists, so no Reference control is offered for computer_name.
	assert.equal(eligibleReferenceTargets(architecture, legacyVm, fieldDefinition(legacyVm, { kind: 'setting', name: 'computer_name' })).length, 0);
	// Curated definitions keep their own reference metadata.
	assert.equal(fieldDefinition(template, { kind: 'setting', name: 'network_interface_ids' })?.refInferred, undefined);
});

test('a NIC attached to one VM is shown as in use and cannot be attached to a second VM', () => {
	const base = sampleArchitecture();
	const vm = base.resources.find(r => r.name === 'vm-application')!;
	const nic = base.resources.find(r => r.name === 'nic-application')!;
	const target = { kind: 'setting' as const, name: 'network_interface_ids' };
	const other = { ...structuredClone(vm), id: vm.id + '-b', name: 'vm-second', resourceRefs: {} };
	let history = createHistory({ ...base, resources: [...base.resources, other] });
	history = historyReducer(history, { type: 'bindResourceRef', id: vm.id, target, refs: [{ resourceId: nic.id, attribute: 'id' }] });
	const def = fieldDefinition(other, target);

	// The first VM still sees its own NIC as free; the second sees it held by the first.
	assert.equal(eligibleReferenceTargets(history.present, history.present.resources.find(r => r.id === vm.id)!, def)[0].inUseBy, undefined);
	const candidates = eligibleReferenceTargets(history.present, history.present.resources.find(r => r.id === other.id)!, def);
	assert.equal(candidates[0].resource.id, nic.id);
	assert.equal(candidates[0].inUseBy?.id, vm.id);

	// Neither the picker nor a mixed list can attach it to the second VM.
	const before = history.present;
	history = historyReducer(history, { type: 'bindResourceRef', id: other.id, target, refs: [{ resourceId: nic.id, attribute: 'id' }] });
	assert.equal(history.present, before);
	history = historyReducer(history, { type: 'setListEntries', id: other.id, target, items: [{ kind: 'value', value: 'x' }, { kind: 'ref', resourceId: nic.id, attribute: 'id' }] });
	assert.equal(history.present, before);

	// A conflict read from a file is kept and reported, not silently dropped.
	const conflicted = { ...before, resources: before.resources.map(r => r.id === other.id ? { ...r, resourceRefs: { '["setting","network_interface_ids"]': { refs: [{ resourceId: nic.id, attribute: 'id' }] } } } : r) };
	const second = conflicted.resources.find(r => r.id === other.id)!;
	assert.match(resourceRefBindingIssue(second.resourceRefs!['["setting","network_interface_ids"]'], conflicted, second, def) ?? '', /already attached to vm-application/);

	// Non-exclusive references (many VMs in one subnet) are unaffected.
	const subnetDef = fieldDefinition(other, { kind: 'setting', name: 'subnet_id' });
	for (const candidate of eligibleReferenceTargets(history.present, other, subnetDef)) { assert.equal(candidate.inUseBy, undefined); }
});
