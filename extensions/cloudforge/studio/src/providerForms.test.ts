/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { clearFormAttributes, ensureTypes, getDef, registerFormAttributes, setCatalogReader, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { additionalBlocks, editableFields, fieldIssue, type BlockDefinition } from './formDefinition.ts';
import { bindingKey, fieldDefinition } from './fieldBindings.ts';
import { resourceDefinition, sampleArchitecture } from './fixture.ts';
import { formCoverageGaps, liveSchemaAttributes, liveSchemaBlocks, type HostFormSchema } from './liveSchema.ts';
import { createHistory, historyReducer, type Resource } from './model.ts';
import { projectGraphSnapshotToArchitecture } from './serviceAdapter.ts';
import { applyTerraformDraft, terraformCode } from './terraformProjection.ts';
import { additionalTerraformItems, extraFieldValue, hasTerraformExtras } from './additionalTerraform.ts';
import { registerLiveFormSchema } from './providerCatalogue.ts';
import { variableUses } from './variables.ts';
import { buildResourceDraft } from './resourceDraft.ts';
import { readLiteralShape } from '../../src/canvas/serviceAdapters.ts';
import { hydrateResourceValues, type FileResourceValues } from './resourceValues.ts';

const json = async (relative: string) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const vmssType = 'azurerm_linux_virtual_machine_scale_set';
const probe = (type: string): Resource => ({
	id: 'resource', kind: 'generic', provider: type.startsWith('aws_') ? 'aws' : type.startsWith('google_') ? 'gcp' : 'azure',
	catalogue: { type, label: type, service: 'Test', category: 'Test', icon: '', fields: [] },
	name: 'example', region: 'uksouth', settings: {}, blocks: [], positions: { visual: { x: 10, y: 20 }, technical: { x: 30, y: 40 } },
});
const paths = (attributes: readonly AttrDef[], prefix = ''): string[] => attributes.filter(attribute => !attribute.readOnly).flatMap(attribute => [prefix + attribute.name, ...paths(attribute.children ?? [], prefix + attribute.name + '.')]);
const blockPaths = (blocks: readonly BlockDefinition[], prefix = ''): string[] => blocks.flatMap(block => [prefix + block.type, ...block.attributes?.map(attribute => prefix + block.type + '.' + attribute.name) ?? [], ...blockPaths(block.children, prefix + block.type + '.')]);

test('all provider documentation paths reach the shared form, including hosted placeholders; loading never edits history', async () => {
	const snapshots = await Promise.all(['azurerm', 'aws', 'google'].map(provider => json('../assets/provider-forms/' + provider + '/resources.json')));
	const definitions = snapshots.flatMap(snapshot => snapshot.resources) as { type: string; attributes: AttrDef[] }[];
	const requests: string[] = [];
	setCatalogReader(async file => { requests.push(file); return json('../assets/provider-forms/' + file); });
	const curated = structuredClone(getDef('azurerm_kubernetes_cluster'));
	const graph = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'Test', sourceRevision: 'a'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [], nodes: [{ id: 'vmss', kind: 'resource', resourceType: vmssType, name: 'example', label: 'VM scale set', hasSource: true }] };
	const history = createHistory(projectGraphSnapshotToArchitecture(graph).architecture);
	const before = JSON.stringify(history);
	const beforeCode = terraformCode(history.present, 'vmss');
	assert.equal(editableFields(history.present.resources[0]).length, 0, 'reproduces the hosted graph placeholder');
	await ensureTypes(definitions.map(definition => definition.type));
	assert.equal(JSON.stringify(history), before, 'metadata must not mutate Architecture or undo/Modified state');
	assert.equal(terraformCode(history.present, 'vmss').replace(/^#.*\n/gm, ''), beforeCode.replace(/^#.*\n/gm, ''), 'metadata must not invent a provider location or change Terraform arguments');
	assert.equal(definitions.length, 4271);
	for (const definition of definitions) {
		const resource = probe(definition.type);
		const actual = new Set([...editableFields(resource).map(field => field.name), ...blockPaths(additionalBlocks(resource))]);
		for (const path of paths(definition.attributes)) { assert.ok(actual.has(path), definition.type + '.' + path); }
	}
	const fields = editableFields(history.present.resources[0]);
	for (const name of ['sku', 'admin_username', 'resource_group_name', 'instances', 'tags', 'zones']) { assert.ok(fields.some(field => field.name === name), name); }
	const nic = additionalBlocks(probe(vmssType)).find(block => block.type === 'network_interface')!;
	assert.ok(nic.required);
	assert.ok(nic.children.find(block => block.type === 'ip_configuration')?.attributes?.some(attribute => attribute.name === 'subnet_id'));
	assert.ok(additionalBlocks(probe(vmssType)).some(block => block.type === 'os_disk' && block.required));
	assert.deepEqual(getDef('azurerm_linux_virtual_machine')?.attributes.find(attribute => attribute.name === 'network_interface_ids')?.refTypes, ['azurerm_network_interface'], 'exact field schemas retain explicitly reviewed reference targets');
	assert.ok(getDef('azurerm_network_interface')?.exported.includes('id'), 'optional-computed IDs remain valid reference outputs');
	assert.equal(getDef(vmssType)?.attributes.find(attribute => attribute.name === 'priority')?.type, 'string', 'documented Spot/Regular values are not a numeric priority');
	assert.ok(additionalBlocks(probe(vmssType)).find(block => block.type === 'timeouts')?.attributes?.some(attribute => attribute.name === 'create'));
	assert.ok(additionalBlocks(probe('azurerm_container_registry_token_password')).find(block => block.type === 'password1')?.attributes?.some(attribute => attribute.name === 'expiry'), 'shared named block definitions reach their actual arguments');
	assert.equal(getDef('aws_wafv2_rule_group')?.attributes.find(attribute => attribute.name === 'tags')?.type, 'map', 'provider default_tags prose must not turn resource tags into a block');
	assert.ok(additionalBlocks(probe('aws_route53domains_domain')).find(block => block.type === 'tech_contact')?.attributes?.some(attribute => attribute.name === 'email'), 'shared contact documentation remains a nested form rather than a string');
	assert.deepEqual(getDef('azurerm_kubernetes_cluster')?.inherit, curated?.inherit, 'document loading preserves reviewed inheritance');
	assert.deepEqual(getDef('azurerm_kubernetes_cluster')?.parents, curated?.parents, 'document loading preserves reviewed placement');
	assert.deepEqual(getDef(vmssType)?.inherit, [], 'inferred documentation relationships cannot create semantic references');
	const requestCount = requests.length;
	await ensureTypes(definitions.map(definition => definition.type));
	assert.equal(requests.length, requestCount, 'loaded definitions are cached');
});

test('VMSS nested fields keep scalar/list/map types and repeated HCL blocks', async () => {
	await ensureTypes([vmssType]);
	const resource: Resource = { ...probe(vmssType), settings: { sku: 'Standard_D4_v5', instances: '2', tags: '{"environment":"dev"}' }, blocks: [
		{ id: 'nic', type: 'network_interface', values: { name: 'internal', primary: 'true' }, blocks: [
			{ id: 'ip', type: 'ip_configuration', values: { name: 'internal', primary: 'true', application_security_group_ids: '["sg-1","sg-2"]' }, blocks: [] },
		] },
	] };
	assert.equal(fieldDefinition(resource, { kind: 'block', blockId: 'ip', name: 'primary' })?.type, 'bool');
	assert.equal(fieldDefinition(resource, { kind: 'block', blockId: 'ip', name: 'application_security_group_ids' })?.type, 'list');
	const code = terraformCode({ name: 'VMSS', resources: [resource], items: [], connections: [] }, resource.id);
	assert.match(code, /instances\s*=\s*2\b/);
	assert.match(code, /primary\s*=\s*true\b/);
	assert.match(code, /network_interface\s*\{/);
	assert.match(code, /ip_configuration\s*\{/);
	assert.doesNotMatch(code, /network_interface\s*=/);
	assert.match(code, /application_security_group_ids\s*=\s*\["sg-1", "sg-2"\]/);
});

const live = (): HostFormSchema => ({
	kind: 'resource', typeName: vmssType, providerSource: 'hashicorp/azurerm', providerVersion: '9.0.0', description: '', docsUrl: '', exampleHcl: '', outputs: [],
	attributes: [{ name: 'sku', path: 'sku', valueType: 'string', access: 'required', description: 'Live sku' }, { name: 'instances', path: 'instances', valueType: 'number', access: 'computedOnly', description: 'Output in this schema' }],
	blocks: [
		{ name: 'network_interface', path: 'network_interface', description: '', minItems: 1, attributes: [] },
		{ name: 'ip_configuration', path: 'network_interface.ip_configuration', description: '', minItems: 1, attributes: [{ name: 'primary', path: 'network_interface.ip_configuration.primary', access: 'optional', valueType: 'bool', description: '' }] },
	],
});

test('live schema remains authoritative over every bundled field/block and reconstructs nested paths', () => {
	const schema = live();
	const resource = { ...probe(vmssType), catalogue: { ...probe(vmssType).catalogue!, fields: [{ name: 'instances', type: 'number' as const }, { name: 'stale_option', type: 'string' as const }] } };
	assert.deepEqual(liveSchemaAttributes(schema, [{ name: 'stale_option', type: 'string', description: '' }]).map(field => field.name), ['sku']);
	assert.deepEqual(editableFields(resource, { [vmssType]: schema }).map(field => field.name), ['sku']);
	const blocks = liveSchemaBlocks(schema, [{ name: 'old_block', type: 'block', description: '' }]);
	assert.deepEqual(blocks.map(block => block.type), ['network_interface']);
	assert.deepEqual(blocks[0].children.map(block => block.type), ['ip_configuration']);
	resource.blocks = [{ id: 'nic', type: 'network_interface', values: {}, blocks: [{ id: 'ip', type: 'ip_configuration', values: {}, blocks: [] }] }];
	assert.equal(fieldDefinition(resource, { kind: 'block', blockId: 'ip', name: 'primary' }, { [vmssType]: schema })?.type, 'bool');
});

test('each provider form payload matches its documented provenance digest and preserves unknown version applicability', async () => {
	const provenance = await json('../assets/provider-forms/provenance.json');
	for (const [provider, original] of [['azure', 'azurerm'], ['aws', 'aws'], ['gcp', 'google']]) {
		const record = provenance.providers[provider];
		const bytes = await readFile(new URL('../assets/provider-forms/' + original + '/resources.json', import.meta.url));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), record.resourcesSha256);
		assert.equal(record.evidence.length, record.resources);
		assert.ok(record.evidence.filter((entry: { document?: unknown }) => entry.document).every((entry: { document?: { url?: string } }) => entry.document?.url?.includes('/blob/' + record.documentationRevision + '/')));
		assert.equal(record.resourcesWithCapturedSchema, record.resources);
	}
	assert.equal(provenance.providers.aws.declaredVersionTagAvailable, false, 'missing version evidence cannot become a verified schema');
});

test('resource Terraform adds ordinary fields to forms and preserves dynamic blocks in the same undo history', async () => {
	await ensureTypes([vmssType]);
	const resource = { ...probe(vmssType), settings: { sku: 'Standard_D4_v5' } };
	const architecture = { name: 'Test', resources: [resource], items: [], connections: [] };
	const source = terraformCode(architecture, resource.id);
	const code = source.replace(/}\s*$/, '  instances = 3\n  dynamic "network_interface" {\n    for_each = var.interfaces\n    content {\n      name = network_interface.value.name\n    }\n  }\n}');
	const resources = applyTerraformDraft(architecture, code, resource.id, { allowAdditional: true });
	assert.equal(resources[0].settings.instances, '3', 'a representable field must become a form value');
	assert.ok(hasTerraformExtras(resources[0].terraformExtras));
	assert.ok(variableUses({ ...architecture, resources }).get('interfaces')?.has(resource.id));
	assert.deepEqual(additionalTerraformItems(resources[0]).map(item => item.path), ['dynamic.network_interface']);
	let history = historyReducer(createHistory(architecture), { type: 'applyResourceCode', resources });
	assert.equal(history.past.length, 1);
	assert.match(terraformCode(history.present, resource.id), /dynamic "network_interface"/);
	history = historyReducer(history, { type: 'update', id: resource.id, patch: { settings: { ...resources[0].settings, sku: 'Standard_D8_v5' } } });
	assert.match(terraformCode(history.present, resource.id), /dynamic "network_interface"/);
	history = historyReducer(history, { type: 'undo' });
	assert.equal(history.present.resources[0].settings.sku, 'Standard_D4_v5');
	assert.ok(hasTerraformExtras(history.present.resources[0].terraformExtras));
	history = historyReducer(history, { type: 'undo' });
	assert.equal(history.present.resources[0].terraformExtras, undefined);
	assert.equal(history.present.resources[0].settings.instances, undefined);
});

test('literal nested blocks become editable controls; nested expressions survive form edits and scoped refreshes', async () => {
	await ensureTypes([vmssType]);
	const resource = probe(vmssType);
	const architecture = { name: 'Test', resources: [resource], items: [], connections: [] };
	const source = terraformCode(architecture, resource.id);
	const code = source.replace(/}\s*$/, '  network_interface {\n    name = "internal"\n    primary = var.primary\n    ip_configuration {\n      name = "internal"\n      subnet_id = "subnet-1"\n    }\n  }\n}');
	const [next] = applyTerraformDraft(architecture, code, resource.id, { allowAdditional: true });
	assert.equal(next.blocks[0].values.name, 'internal');
	assert.equal(next.blocks[0].blocks[0].values.subnet_id, 'subnet-1');
	assert.deepEqual(extraFieldValue(next, { kind: 'block', blockId: next.blocks[0].id, name: 'primary' }), { $expr: 'var.primary' });
	const snapshot = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'Test', sourceRevision: 'b'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [], nodes: [{ id: next.id, kind: 'resource', resourceType: vmssType, name: next.name, label: next.name, hasSource: true }] };
	const refreshed = projectGraphSnapshotToArchitecture(snapshot, { previousArchitecture: { ...architecture, resources: [next] } }).architecture;
	assert.deepEqual(refreshed.resources[0].terraformExtras, next.terraformExtras);
	const removed = historyReducer(createHistory(refreshed), { type: 'update', id: next.id, patch: { blocks: [] } });
	assert.ok(!hasTerraformExtras(removed.present.resources[0].terraformExtras), 'deleting the owning form block cannot resurrect its extra expressions');
});

test('additional code apply rejects unknown literal fields and secrets and the old editor never drops dynamic blocks', async () => {
	await ensureTypes([vmssType]);
	const resource = probe(vmssType);
	const architecture = { name: 'Test', resources: [resource], items: [], connections: [] };
	const source = terraformCode(architecture, resource.id);
	assert.throws(() => applyTerraformDraft(architecture, source.replace(/}\s*$/, ' unmodelled = true\n}'), resource.id, { allowAdditional: true }), /schema/);
	const dynamic = source.replace(/}\s*$/, ' dynamic "network_interface" {\n for_each = var.interfaces\n content { name = "internal" }\n }\n}');
	assert.throws(() => applyTerraformDraft(architecture, dynamic, resource.id), /resource-scoped/);
	assert.throws(() => applyTerraformDraft(architecture, dynamic.replace('name = "internal"', 'password = "not-a-real-secret"'), resource.id, { allowAdditional: true }), /sensitive variable/);
});

test('imported object/list schemas share their real types with HCL generation instead of falling back to code', () => {
	const typeName = 'aws_form_schema_test';
	const schema: HostFormSchema = { ...live(), typeName, providerSource: 'hashicorp/aws', attributes: [
		{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: '' },
		{ name: 'configuration', path: 'configuration', access: 'optional', valueType: 'mapString', description: '' },
		{ name: 'targets', path: 'targets', access: 'optional', valueType: 'listString', description: '' },
		{ name: 'dynamic_value', path: 'dynamic_value', access: 'optional', valueType: 'json', description: '' },
	], blocks: [], coverage: { complete: false, paths: 3, readOnly: 0, gaps: [{ path: 'configuration.nested', reason: 'Complex object' }, { path: 'targets', reason: 'List of objects' }, { path: 'not_exposed', reason: 'Depth limit' }] } };
	registerLiveFormSchema(schema);
	const resource = { ...probe(typeName), settings: { configuration: '{"nested":{"enabled":true}}', targets: '[{"name":"one","weight":2}]', dynamic_value: '42' } };
	const architecture = { name: 'Test', resources: [resource], items: [], connections: [] };
	const code = terraformCode(architecture, resource.id);
	assert.match(code, /dynamic_value\s*=\s*42/);
	assert.equal(fieldIssue('{bad', { name: 'dynamic_value', type: 'json', description: '' }), 'Enter a JSON value');
	const applied = applyTerraformDraft(architecture, code.replace(/dynamic_value\s*=\s*42/, 'dynamic_value = { nested = [true, 2] }'), resource.id, { allowAdditional: true, schema });
	assert.equal(applied[0].settings.dynamic_value, '{"nested":[true,2]}');
	assert.equal(hasTerraformExtras(applied[0].terraformExtras), false, 'JSON literals remain form-editable');
	assert.match(code, /configuration\s*=\s*\{/);
	assert.match(code, /targets\s*=\s*\[/);
	assert.doesNotMatch(code, /configuration\s*\{/);
	assert.deepEqual(formCoverageGaps(schema).map(gap => gap.path), ['not_exposed']);
	assert.deepEqual(liveSchemaAttributes({ ...schema, attributes: [{ name: 'choice', path: 'choice', access: 'optional', valueType: 'string', description: '' }] }, [{ name: 'choice', type: 'string', description: '', options: ['stale'] }])[0].options, undefined, 'a live string is not restricted by stale bundled enum choices');
});

test('schema draft checks keep nested JSON attributes as assignments alongside real blocks', () => {
	const typeName = 'aws_nested_json_form_test';
	const schema: HostFormSchema = { ...live(), typeName, providerSource: 'hashicorp/aws', attributes: [], blocks: [
		{ name: 'nested', path: 'nested', description: '', attributes: [{ name: 'config', path: 'nested.config', access: 'optional', valueType: 'mapString', description: '' }] },
	] };
	registerLiveFormSchema(schema);
	const resource = { ...probe(typeName), blocks: [{ id: 'nested', type: 'nested', values: { config: '{"enabled":true,"weight":3}' }, blocks: [] }] };
	const draft = buildResourceDraft({ name: 'Test', resources: [resource], items: [], connections: [] }, resource.id, schema)!;
	assert.equal(draft.body.blocks[0].name, 'nested');
	assert.deepEqual(draft.body.blocks[0].body.attributes.config, { kind: 'literal', value: { enabled: true, weight: 3 } });
	assert.deepEqual(draft.body.blocks[0].body.blocks, []);
});

test('nested attribute forms and code apply share member access and type constraints', () => {
	const typeName = 'aws_member_access_form_test';
	const literalShape = readLiteralShape(undefined, { mode: 'list', minItems: 1, attributes: [{ name: 'enabled', access: 'required', typeExpr: { kind: 'bool' } }, { name: 'id', access: 'computedOnly', typeExpr: { kind: 'string' } }] });
	const schema: HostFormSchema = { ...live(), typeName, attributes: [{ name: 'items', path: 'items', access: 'optional', valueType: 'listString', description: '', literalShape }], blocks: [] };
	registerLiveFormSchema(schema);
	const resource = probe(typeName);
	const definition = fieldDefinition(resource, { kind: 'setting', name: 'items' }, { [typeName]: schema });
	assert.equal(definition?.literalShape?.element?.members?.id.access, 'computedOnly');
	assert.match(fieldIssue('[{}]', definition)!, /enabled: Required/);
	assert.equal(fieldIssue('[{"enabled":true}]', definition), undefined);
	const architecture = { name: 'Test', resources: [resource], items: [], connections: [] };
	const source = terraformCode(architecture, resource.id);
	assert.throws(() => applyTerraformDraft(architecture, source.replace(/}\s*$/, ' items = [{ enabled = true, id = "output" }]\n}'), resource.id, { allowAdditional: true, schema }), /read-only/);
	const [next] = applyTerraformDraft(architecture, source.replace(/}\s*$/, ' items = [{ enabled = true }]\n}'), resource.id, { allowAdditional: true, schema });
	assert.equal(next.settings.items, '[{"enabled":true}]');
});

test('source values hydrate known blocks and expressions after metadata loads without losing local edits', async () => {
	await ensureTypes([vmssType]);
	const resource = { ...probe(vmssType), terraformName: 'example' };
	const graph = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'Test', sourceRevision: 'a'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [], nodes: [{ id: resource.id, kind: 'resource', resourceType: vmssType, name: 'example', label: 'example', hasSource: true }] };
	const file: FileResourceValues = { address: vmssType + '.example', file: 'main.tf', attributes: { sku: { kind: 'literal', value: 'Standard_D4_v5' }, instances: { kind: 'expression', text: 'max(2, var.desired)' } }, blocks: [{ name: 'network_interface', attributes: { name: { kind: 'literal', value: 'internal' } }, blocks: [{ name: 'ip_configuration', attributes: { name: { kind: 'literal', value: 'primary' }, subnet_id: { kind: 'expression', text: 'azurerm_subnet.example.id' } }, blocks: [] }] }] };
	const initial = { name: 'Test', resources: [resource], items: [], connections: [] };
	const hydrated = hydrateResourceValues(initial, graph, [file]);
	assert.equal(hydrated.resources[0].blocks[0].blocks[0].values.name, 'primary');
	assert.match(terraformCode(hydrated, resource.id), /instances\s*=\s*max\(2, var.desired\)/);
	assert.match(terraformCode(hydrated, resource.id), /subnet_id\s*=\s*azurerm_subnet.example.id/);
	assert.equal(hydrateResourceValues(hydrated, graph, [file]), hydrated, 'replaying source metadata is idempotent');
	let history = historyReducer(createHistory(hydrated), { type: 'update', id: resource.id, patch: { settings: { ...hydrated.resources[0].settings, sku: 'Standard_D8_v5' } } });
	const nextBase = hydrateResourceValues(hydrated, graph, [{ ...file, attributes: { ...file.attributes, instances: { kind: 'literal', value: 3 } } }]);
	history = historyReducer(history, { type: 'rebase', architecture: nextBase, base: hydrated });
	assert.equal(history.present.resources[0].settings.sku, 'Standard_D8_v5');
	assert.match(terraformCode(history.present, resource.id), /instances\s*=\s*3/);
});

test('mixed list HCL typed in code editor or hydrated from source files parses into editable mixed entries and falls back safely on complex expressions', () => {
	const base = sampleArchitecture();
	const architecture = {
		...base,
		variables: [
			{ id: 'v-extra', name: 'extra_nic_id', type: 'string' as const, description: '', sensitive: false },
			{ id: 'v-net', name: 'net', type: 'object' as const, description: '', sensitive: false, defaultValue: { fallback_nic: '/subscriptions/x/nic-obj' } },
		],
	};
	const vm = architecture.resources.find(item => item.id === 'vm')!;
	const nic = architecture.resources.find(item => item.id === 'nic')!;
	const nicExpr = 'azurerm_network_interface.' + (nic.terraformName ?? nic.name.replace(/[^A-Za-z0-9_-]/g, '_')) + '.id';
	const key = bindingKey({ kind: 'setting', name: 'network_interface_ids' });

	// 1. Code editor apply parses mixed [ref, var, var.obj.leaf, "literal"] directly into resourceRefs without opaque terraformExtras
	const before = terraformCode(architecture, vm.id);
	const edited = before.replace(
		/network_interface_ids\s*=\s*\[[^\]]*\]/,
		`network_interface_ids = [${nicExpr}, var.extra_nic_id, var.net.fallback_nic, "/subscriptions/x/manual"]`
	);
	const [applied] = applyTerraformDraft(architecture, edited, vm.id, { allowAdditional: true });
	assert.equal(hasTerraformExtras(applied.terraformExtras), false, 'representable mixed list stays out of opaque terraformExtras');
	assert.deepEqual(applied.resourceRefs?.[key], {
		refs: [{ resourceId: nic.id, attribute: 'id' }],
		items: [
			{ kind: 'ref', resourceId: nic.id, attribute: 'id' },
			{ kind: 'variable', variableId: 'v-extra' },
			{ kind: 'variable', variableId: 'v-net', path: ['fallback_nic'] },
			{ kind: 'value', value: '/subscriptions/x/manual' },
		],
	});

	// 2. Complex function expressions stay safely preserved in terraformExtras (no silent data loss)
	const complex = before.replace(
		/network_interface_ids\s*=\s*\[[^\]]*\]/,
		`network_interface_ids = [coalesce(${nicExpr}, var.extra_nic_id)]`
	);
	const [preserved] = applyTerraformDraft(architecture, complex, vm.id, { allowAdditional: true });
	assert.equal(hasTerraformExtras(preserved.terraformExtras), true);
	assert.equal(preserved.resourceRefs?.[key], undefined);

	// 3. File hydration (readResourceValues) hydrates mixed lists cleanly and idempotently
	const vmAddr = 'azurerm_linux_virtual_machine.' + (vm.terraformName ?? vm.name.replace(/[^A-Za-z0-9_-]/g, '_'));
	const graph = {
		workspaceId: 'ws',
		architectureId: 'arch',
		architectureName: architecture.name,
		sourceRevision: 'c'.repeat(64),
		status: 'complete' as const,
		edges: [],
		diagnostics: [],
		nodes: [
			{ id: vm.id, kind: 'resource' as const, resourceType: 'azurerm_linux_virtual_machine', name: vmAddr.split('.')[1], label: vm.name, hasSource: true },
			{ id: nic.id, kind: 'resource' as const, resourceType: 'azurerm_network_interface', name: nicExpr.split('.')[1], label: nic.name, hasSource: true },
		],
	};
	const file: FileResourceValues = {
		address: vmAddr,
		file: 'main.tf',
		attributes: {
			network_interface_ids: { kind: 'expression', text: `[${nicExpr}, var.extra_nic_id, "/subscriptions/x/from-file"]` },
		},
		blocks: [],
	};
	const hydrated = hydrateResourceValues(architecture, graph, [file]);
	const hydratedVm = hydrated.resources.find(item => item.id === vm.id)!;
	assert.equal(hasTerraformExtras(hydratedVm.terraformExtras), false);
	assert.deepEqual(hydratedVm.resourceRefs?.[key], {
		refs: [{ resourceId: nic.id, attribute: 'id' }],
		items: [
			{ kind: 'ref', resourceId: nic.id, attribute: 'id' },
			{ kind: 'variable', variableId: 'v-extra' },
			{ kind: 'value', value: '/subscriptions/x/from-file' },
		],
	});
	assert.equal(hydrateResourceValues(hydrated, graph, [file]), hydrated, 'mixed list hydration is idempotent');
});

test('inferred references on an imported-schema type survive file hydration', () => {
	const type = 'azurerm_virtual_machine';
	registerFormAttributes(type, 'azurerm', [
		{ name: 'network_interface_ids', type: 'list', description: '' },
		{ name: 'resource_group_name', type: 'string', description: '' },
	]);
	try {
		const base = sampleArchitecture();
		const template = base.resources.find(item => item.id === 'vm')!;
		const nic = base.resources.find(item => item.id === 'nic')!;
		const group = base.resources.find(item => resourceDefinition(item).type === 'azurerm_resource_group')!;
		const vm = { ...template, id: 'legacy-vm', name: 'legacy-vm', settings: {}, resourceRefs: {}, fieldBindings: {}, catalogue: { type, label: 'Virtual machine', service: 'Compute', category: 'Compute', icon: '', curated: false, fields: [] } } as unknown as Resource;
		const architecture = { ...base, resources: [...base.resources, vm] };
		const address = (resource: Resource, resourceType: string) => resourceType + '.' + (resource.terraformName ?? resource.name.replace(/[^A-Za-z0-9_-]/g, '_'));
		const nicAddress = address(nic, 'azurerm_network_interface');
		const groupAddress = address(group, 'azurerm_resource_group');
		const graph = {
			workspaceId: 'ws', architectureId: 'arch', architectureName: architecture.name, sourceRevision: 'd'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [],
			nodes: [
				{ id: vm.id, kind: 'resource' as const, resourceType: type, name: 'legacy-vm', label: vm.name, hasSource: true },
				{ id: nic.id, kind: 'resource' as const, resourceType: 'azurerm_network_interface', name: nicAddress.split('.')[1], label: nic.name, hasSource: true },
			],
		};
		const file: FileResourceValues = {
			address: type + '.legacy-vm', file: 'main.tf', blocks: [],
			attributes: {
				network_interface_ids: { kind: 'expression', text: `[${nicAddress}.id, "/subscriptions/x/nic2"]` },
				resource_group_name: { kind: 'expression', text: `${groupAddress}.name` },
			},
		};
		const hydrated = hydrateResourceValues(architecture, graph, [file]).resources.find(item => item.id === vm.id)!;
		assert.deepEqual(hydrated.resourceRefs?.[bindingKey({ kind: 'setting', name: 'network_interface_ids' })], {
			refs: [{ resourceId: nic.id, attribute: 'id' }],
			items: [{ kind: 'ref', resourceId: nic.id, attribute: 'id' }, { kind: 'value', value: '/subscriptions/x/nic2' }],
		});
		assert.equal(hydrated.terraformExtras?.attrs.network_interface_ids, undefined, 'the list is editable, not Configured in Terraform');
	} finally {
		clearFormAttributes(type);
	}
});
