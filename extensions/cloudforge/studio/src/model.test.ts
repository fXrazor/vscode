import { applyTerraformDraft, terraformCode } from './terraformProjection.ts';
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { importVariableDraft, exportableArchitecture, variableDeclarations, variableUses, type VariableDefinition } from './variables.ts';
import type { BoardItem } from './model.ts';
import { presentationSvg } from './exportPresentation.ts';
import { shapeDefinitions } from './shapes.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistory, historyReducer, checkDraft } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { additionalBlocks, blockDefinitions, fieldIssue, resourceFormIssues } from './formDefinition.ts';
import { connectionDash, connectionPath } from './connectionGeometry.ts';

test('connection appearance and deletion use shared history without changing Terraform configuration', () => {
	const initial = createHistory(sampleArchitecture()); const id = initial.present.connections[0].id;
	const updated = historyReducer(initial, { type: 'updateConnection', id, patch: { label: 'HTTPS', routing: 'curve', pattern: 'dotted', width: 3, startArrow: true, endArrow: false } });
	assert.equal(updated.past.length, 1); assert.equal(updated.present.connections[0].routing, 'curve');
	assert.equal(connectionDash(updated.present.connections[0]), '3 9');
	assert.equal(terraformCode(updated.present), terraformCode(initial.present));
	assert.deepEqual(historyReducer(updated, { type: 'undo' }).present, initial.present);
	assert.equal(historyReducer(updated, { type: 'updateConnection', id, patch: { width: 3 } }), updated);
	assert.equal(historyReducer(updated, { type: 'updateConnection', id, patch: { width: NaN } }), updated);
	const deleted = historyReducer(updated, { type: 'deleteConnection', id });
	assert.equal(deleted.present.connections.length, initial.present.connections.length - 1);
	assert.deepEqual(historyReducer(deleted, { type: 'undo' }).present, updated.present);
});

test('connection geometry uses distinct straight, elbow and curve projections', () => {
	const connection = { id: 'link', source: 'a', target: 'b' };
	const paths = (['straight','elbow','curve'] as const).map(routing => connectionPath({ ...connection, routing }, 0, 0, 200, 100)[0]);
	assert.equal(new Set(paths).size, 3); assert.ok(paths[2].includes('C'));
	assert.equal(connectionDash(connection), undefined);
});

test('node form findings derive from current nested block values and clear with correction', () => {
	const network = sampleArchitecture().resources[0];
	const resource = { ...network, kind: 'generic' as const, catalogue: { type: 'azurerm_linux_virtual_machine', label: 'VM', service: 'Compute', category: 'Compute', icon: '', fields: [] }, blocks: [{ id: 'disk', type: 'os_disk', values: { caching: '', storage_account_type: 'Standard_LRS' }, blocks: [] }] };
	assert.ok(resourceFormIssues(resource).some(issue => issue.includes('caching: Required value')));
	assert.equal(resourceFormIssues({ ...resource, blocks: [{ ...resource.blocks[0], values: { ...resource.blocks[0].values, caching: 'ReadOnly' } }] }).some(issue => issue.startsWith('os_disk')), false);
});

test('nested schema preserves required flags, recursive cardinality and typed defaults', () => {
	const blocks = blockDefinitions([{ name: 'pool', type: 'block', required: true, repeat: true, description: 'Pool', children: [
		{ name: 'enabled', type: 'bool', default: false, description: 'Enabled' },
		{ name: 'size', type: 'number', default: 0, description: 'Size' },
		{ name: 'optional', type: 'string', description: 'Optional' },
		{ name: 'child', type: 'block', description: 'Child', children: [] }
	] }]);
	assert.equal(blocks[0].required, true); assert.equal(blocks[0].max, Infinity);
	assert.deepEqual(blocks[0].fields, { enabled: 'false', size: '0' });
	assert.equal(blocks[0].children[0].max, 1);
	assert.deepEqual(blocks[0].children[0].fields, {});
});

test('local nested field checks distinguish absence from false and zero', () => {
	const attr = { name: 'value', required: true, description: '' };
	assert.equal(fieldIssue('', { ...attr, type: 'string' }), 'Required value');
	assert.equal(fieldIssue('false', { ...attr, type: 'bool' }), undefined);
	assert.equal(fieldIssue('0', { ...attr, type: 'number' }), undefined);
	assert.equal(fieldIssue('NaN', { ...attr, type: 'number' }), 'Enter a finite number');
	assert.equal(fieldIssue('{}', { ...attr, type: 'list' }), 'Enter a JSON array');
	assert.equal(fieldIssue('[]', { ...attr, type: 'map' }), 'Enter a JSON object');
	assert.equal(fieldIssue('var.allowed', { ...attr, type: 'list' }), undefined);
});

test('sample cluster does not create a second editable default node pool', () => {
	const cluster = sampleArchitecture().resources.find(resource => resource.kind === 'cluster')!;
	assert.equal(additionalBlocks(cluster).some(block => block.type === 'default_node_pool'), false);
});

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


test('shape geometry and top-left resize share history across renderers and undo atomically', () => {
 const initial = createHistory(sampleArchitecture());
 const added = historyReducer(initial, { type: 'addItem', item: { id: 'shape-test', kind: 'shape', shape: 'diamond', text: 'Decision', positions: { visual: { x: 100, y: 100 }, technical: { x: 400, y: 400 } }, width: 200, height: 120, members: [] } });
 const resized = historyReducer(added, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 60, y: 80 }, width: 240, height: 140 });
 const item = resized.present.items.find(item => item.id === 'shape-test')!;
 assert.equal(resized.past.length, added.past.length + 1);
 assert.deepEqual(item.positions, { visual: { x: 60, y: 80 }, technical: { x: 400, y: 400 } });
 assert.equal(item.shape, 'diamond');
 assert.equal(item.width, 240);
 assert.deepEqual(historyReducer(resized, { type: 'undo' }).present, added.present);
 assert.equal(historyReducer(resized, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 60, y: 80 }, width: 240, height: 140 }), resized);
 assert.equal(historyReducer(resized, { type: 'resizeItem', id: 'shape-test', mode: 'visual', position: { x: 0, y: 0 }, width: NaN, height: 140 }), resized);
});

test('presentation export retains each shape geometry and escapes labels', async () => {
 const items: BoardItem[] = shapeDefinitions.map((shape, index) => ({ id: shape.id, kind: 'shape' as const, shape: shape.id, text: '<review & approve>', fill: '#ffffff', positions: { visual: { x: index * 220, y: 0 }, technical: { x: 0, y: 0 } }, width: 200, height: 140, members: [] }));
 items[0] = { ...items[0], strokeColor: '#123456', strokeWidth: 3, strokeStyle: 'dashed' };
 const svg = await presentationSvg({ name: 'Shapes', resources: [], connections: [], items });
 for (const shape of shapeDefinitions) { assert.ok(svg.includes('d="' + shape.path + '"')); }
 assert.ok(svg.includes('stroke="#123456" stroke-width="3" stroke-dasharray="12 9"'));
 assert.ok(svg.includes('&lt;review &amp; approve&gt;'));
 assert.ok(!svg.includes('<review & approve>'));
});


test('variable defaults preserve empty, false and zero, and edits share semantic undo', () => {
 const initial = createHistory(sampleArchitecture());
 const variable: VariableDefinition = { id: 'input-1', name: 'replicas', type: 'number', description: '', sensitive: false, defaultValue: 0 };
 const added = historyReducer(initial, { type: 'saveVariable', variable });
 assert.equal(added.present.variables?.[0].defaultValue, 0);
 assert.deepEqual(historyReducer(added, { type: 'undo' }).present, initial.present);
 assert.equal(historyReducer(added, { type: 'saveVariable', variable: { ...variable, id: 'duplicate' } }), added);
 assert.equal(historyReducer(added, { type: 'saveVariable', variable: { ...variable, defaultValue: 'bad-number' } }), added);
 assert.ok(variableDeclarations([{ ...variable, name: 'enabled', type: 'bool', defaultValue: false }]).includes('default = false'));
 assert.ok(variableDeclarations([{ ...variable, name: 'label', type: 'string', defaultValue: '' }]).includes('default = ""'));
});

test('referenced variables cannot be deleted or renamed by the draft reducer', () => {
 const architecture = sampleArchitecture();
 architecture.resources[0].settings = { cidr: 'var.network_cidr' };
 architecture.variables = [{ id: 'cidr', name: 'network_cidr', type: 'string', description: '', sensitive: false }];
 const initial = createHistory(architecture);
 assert.deepEqual([...variableUses(architecture).get('network_cidr')!], [architecture.resources[0].id]);
 assert.equal(historyReducer(initial, { type: 'deleteVariable', id: 'cidr' }), initial);
 assert.equal(historyReducer(initial, { type: 'saveVariable', variable: { ...architecture.variables[0], name: 'renamed' } }), initial);
});

test('variable exports omit sensitive values and escape literal HCL template openers', () => {
 const architecture = sampleArchitecture();
 architecture.variables = [{ id: 'secret', name: 'token', type: 'string', description: '', sensitive: true, defaultValue: 'private-default', value: 'private-value' }];
 const exported = JSON.stringify(exportableArchitecture(architecture));
 const code = variableDeclarations(architecture.variables);
 assert.ok(!exported.includes('private-default') && !exported.includes('private-value'));
 assert.ok(!code.includes('private-default') && !code.includes('private-value'));
 assert.ok(code.includes('sensitive = true'));
 assert.equal(architecture.variables[0].value, 'private-value');
 const literal = variableDeclarations([{ id: 'literal', name: 'labels', type: 'map(string)', description: '', sensitive: false, defaultValue: { literal: '${untrusted}' } }]);
 assert.ok(literal.includes('$${untrusted}'));
});


test('discovered variable declarations are inserted as one undo operation', () => {
 const initial = createHistory(sampleArchitecture());
 const added = historyReducer(initial, { type: 'addVariables', variables: ['region_input', 'size_input'].map(name => ({ id: name, name, type: 'any' as const, description: '', sensitive: false })) });
 assert.equal(added.present.variables?.length, 2);
 assert.equal(added.past.length, 1);
 assert.deepEqual(historyReducer(added, { type: 'undo' }).present, initial.present);
 const invalid = historyReducer(initial, { type: 'addVariables', variables: ['duplicate', 'duplicate'].map((name, index) => ({ id: String(index), name, type: 'string' as const, description: '', sensitive: false })) });
 assert.equal(invalid, initial);
});


test('Terraform code scopes to main or the selected resource using the source generator', () => {
 const architecture = sampleArchitecture();
 const main = terraformCode(architecture);
 const selected = terraformCode(architecture, 'network');
 assert.ok(main.includes('resource "azurerm_virtual_network"'));
 assert.ok(main.includes('resource "azurerm_kubernetes_cluster"'));
 assert.ok(selected.includes('address_space'));
 assert.ok(!selected.includes('resource "azurerm_kubernetes_cluster"'));
});

test('supported resource HCL applies atomically and keeps the Terraform identifier stable', () => {
 const initial = createHistory(sampleArchitecture());
 const source = terraformCode(initial.present, 'network');
 const edited = source.replace(/(\n\s+name\s*=\s*)"vnet-production"/, '$1"vnet-edited"');
 assert.notEqual(source, edited);
 const resources = applyTerraformDraft(initial.present, edited, 'network');
 assert.equal(resources[0].name, 'vnet-edited');
 assert.equal(resources[0].terraformName, 'vnet-production');
 const applied = historyReducer(initial, { type: 'applyResourceCode', resources });
 assert.equal(applied.past.length, 1);
 assert.deepEqual(historyReducer(applied, { type: 'undo' }).present, initial.present);
 assert.ok(terraformCode(applied.present, 'network').includes('resource "azurerm_virtual_network" "vnet-production"'));
});

test('unsupported Terraform edits reject without changing the graph', () => {
 const architecture = sampleArchitecture();
 const before = JSON.stringify(architecture);
 const source = terraformCode(architecture, 'network');
 assert.throws(() => applyTerraformDraft(architecture, source + '\n# custom comment', 'network'), /comments/);
 assert.throws(() => applyTerraformDraft(architecture, source.replace(/}\s*$/, '  unmodelled = true\n}'), 'network'), /unmodelled/);
 assert.equal(JSON.stringify(architecture), before);
});


test('variable declaration and tfvars imports distinguish defaults, assigned values and conflicts', () => {
 const declarations = importVariableDraft('variable "enabled" {\n type = bool\n default = false\n}\nvariable "count_input" {\n type = number\n default = 0\n}', [], 'tf');
 assert.equal(declarations[0].defaultValue, false);
 assert.equal(declarations[1].defaultValue, 0);
 const values = importVariableDraft('enabled = true', declarations, 'tfvars');
 assert.equal(values[0].defaultValue, false);
 assert.equal(values[0].value, true);
 const initial = createHistory({ ...sampleArchitecture(), variables: declarations });
 const kept = historyReducer(initial, { type: 'importVariables', variables: values, override: false });
 assert.equal(kept.present.variables?.[0].value, undefined);
 const replaced = historyReducer(initial, { type: 'importVariables', variables: values, override: true });
 assert.equal(replaced.present.variables?.[0].value, true);
 assert.equal(replaced.past.length, 1);
 assert.deepEqual(historyReducer(replaced, { type: 'undo' }).present, initial.present);
});

test('variable imports refuse unsupported expressions, validations and structural types', () => {
 assert.throws(() => importVariableDraft('input_value = var.other', [], 'tfvars'), /Expression/);
 assert.throws(() => importVariableDraft('variable "x" {\n type = object({ a = string })\n}', [], 'tf'), /structural type/);
 assert.throws(() => importVariableDraft('variable "x" {\n type = string\n validation {\n condition = true\n error_message = "bad"\n }\n}', [], 'tf'), /advanced attributes/);
});

test('sensitive resource properties are omitted from graph and Terraform projections', () => {
 const architecture = sampleArchitecture();
 architecture.resources[0] = { ...architecture.resources[0], kind: 'compute', settings: { admin_password: 'private-resource-password' } };
 assert.ok(!JSON.stringify(exportableArchitecture(architecture)).includes('private-resource-password'));
 assert.ok(!terraformCode(architecture).includes('private-resource-password'));
});
