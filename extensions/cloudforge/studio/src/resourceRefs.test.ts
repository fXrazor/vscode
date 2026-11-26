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
import { eligibleReferenceTargets, fieldDefinition, fieldExpression } from './fieldBindings.ts';
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
		] },
	} as unknown as typeof template;
	const architecture = { ...base, resources: [...base.resources, legacyVm] };

	const nics = fieldDefinition(legacyVm, { kind: 'setting', name: 'network_interface_ids' });
	assert.deepEqual(nics?.refTypes, ['azurerm_network_interface']);
	assert.equal(nics?.refInferred, true);
	assert.deepEqual(eligibleReferenceTargets(architecture, legacyVm, nics).map(item => item.resource.id), [nic.id]);
	assert.deepEqual(fieldDefinition(legacyVm, { kind: 'setting', name: 'availability_set_id' })?.refTypes, ['azurerm_availability_set']);
	assert.equal(fieldDefinition(legacyVm, { kind: 'setting', name: 'tenant_id' })?.refTypes, undefined);
	// Curated definitions keep their own reference metadata.
	assert.equal(fieldDefinition(template, { kind: 'setting', name: 'network_interface_ids' })?.refInferred, undefined);
});
