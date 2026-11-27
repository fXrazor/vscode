/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildReferenceCandidates,
	createInitialDraft,
	listBundledSchemaTypes,
	lookupBundledSchema,
	renderDraftPreview,
} from '../src/canvas/schemaForm.ts';
import type { CanvasGraphSnapshot, CanvasNodeSummary } from '../src/canvas/protocol.ts';
import type { FormSchema } from '../src/canvas/schemaForm.ts';

const rev = 'a'.repeat(64);

test('dynamic schema literals stay typed HCL rather than quoted JSON text', () => {
	const schema: FormSchema = { kind: 'resource', typeName: 'aws_dynamic_test', providerSource: 'hashicorp/aws', providerVersion: 'test', description: '', docsUrl: '', exampleHcl: '', attributes: [{ name: 'config', path: 'config', access: 'optional', valueType: 'json', description: '' }], blocks: [], outputs: [] };
	const draft = createInitialDraft({ id: 'test', kind: 'resource', resourceType: schema.typeName, name: 'example', label: '', hasSource: false }, schema, rev);
	const rendered = renderDraftPreview(schema, { ...draft, attributes: { config: { kind: 'literal', value: 42 } } });
	assert.equal(rendered.hasErrors, false);
	assert.match(rendered.hcl, /config\s*=\s*42/);
});

const rgNode: CanvasNodeSummary = {
	id: 'n1',
	kind: 'resource',
	resourceType: 'azurerm_resource_group',
	name: 'hub',
	label: 'azurerm_resource_group.hub',
	hasSource: true,
};

const vnetNode: CanvasNodeSummary = {
	id: 'n2',
	kind: 'resource',
	resourceType: 'azurerm_virtual_network',
	name: 'vnet_hub',
	label: 'azurerm_virtual_network.vnet_hub',
	hasSource: true,
};

const nsgNode: CanvasNodeSummary = {
	id: 'n3',
	kind: 'resource',
	resourceType: 'azurerm_network_security_group',
	name: 'nsg_web',
	label: 'azurerm_network_security_group.nsg_web',
	hasSource: true,
};

test('bundled schema catalogue covers the initial Azure networking set and returns undefined for unsupported types', () => {
	const types = listBundledSchemaTypes();
	assert.ok(types.includes('azurerm_resource_group'));
	assert.ok(types.includes('azurerm_virtual_network'));
	assert.ok(types.includes('azurerm_subnet'));
	assert.ok(types.includes('azurerm_network_security_group'));
	assert.ok(types.includes('azurerm_public_ip'));
	assert.ok(types.includes('azurerm_route_table'));

	assert.ok(lookupBundledSchema(vnetNode));
	assert.equal(lookupBundledSchema({ id: 'x', kind: 'resource', resourceType: 'aws_s3_bucket', name: 'b', label: 'aws_s3_bucket.b', hasSource: true }), undefined);
	assert.equal(lookupBundledSchema({ id: 'm', kind: 'module', resourceType: null, name: 'mod', label: 'module.mod', hasSource: true }), undefined);
});

test('renderDraftPreview validates required fields, preserves HCL expressions, and emits aligned HCL', () => {
	const schema = lookupBundledSchema(vnetNode)!;
	const initial = createInitialDraft(vnetNode, schema, rev);
	const incomplete = renderDraftPreview(schema, initial);
	assert.equal(incomplete.hasErrors, true);
	assert.ok(incomplete.diagnostics.some(d => d.path === 'resource_group_name' && d.severity === 'error'));
	assert.ok(incomplete.diagnostics.some(d => d.path === 'address_space' && d.severity === 'error'));

	const complete = renderDraftPreview(schema, {
		...initial,
		attributes: {
			name: { kind: 'literal', value: 'vnet-hub' },
			location: { kind: 'expression', text: 'azurerm_resource_group.hub.location' },
			resource_group_name: { kind: 'expression', text: 'azurerm_resource_group.hub.name' },
			address_space: { kind: 'literal', value: ['10.0.0.0/16'] },
		},
	});
	assert.equal(complete.hasErrors, false);
	assert.equal(complete.diagnostics.length, 0);
	assert.ok(complete.hcl.includes('# Unsaved draft preview (base revision aaaaaaaa'));
	assert.ok(complete.hcl.includes('resource "azurerm_virtual_network" "vnet_hub" {'));
	assert.ok(complete.hcl.includes('location            = azurerm_resource_group.hub.location'));
	assert.ok(complete.hcl.includes('resource_group_name = azurerm_resource_group.hub.name'));
	assert.ok(complete.hcl.includes('address_space       = ["10.0.0.0/16"]'));
});

test('renderDraftPreview rejects computed-only attributes and validates nested blocks', () => {
	const schema = lookupBundledSchema(nsgNode)!;
	const initial = createInitialDraft(nsgNode, schema, rev);
	const rendered = renderDraftPreview(schema, {
		...initial,
		attributes: {
			name: { kind: 'literal', value: 'nsg-web' },
			location: { kind: 'literal', value: 'uksouth' },
			resource_group_name: { kind: 'expression', text: 'azurerm_resource_group.hub.name' },
			id: { kind: 'literal', value: 'should-fail' },
		},
		blocks: [
			{
				id: 'b1',
				name: 'security_rule',
				attributes: {
					name: { kind: 'literal', value: 'allow-https' },
					priority: { kind: 'literal', value: 100 },
					direction: { kind: 'literal', value: 'Inbound' },
					access: { kind: 'literal', value: 'Allow' },
					protocol: { kind: 'literal', value: 'Tcp' },
					destination_port_range: { kind: 'literal', value: '443' },
				},
			},
		],
	});
	assert.equal(rendered.hasErrors, true);
	assert.ok(rendered.diagnostics.some(d => d.path === 'id' && /computed/.test(d.message)));
	assert.ok(rendered.hcl.includes('security_rule {'));
	assert.ok(rendered.hcl.includes('priority               = 100'));
	assert.ok(rendered.hcl.includes('destination_port_range = "443"'));
});

test('buildReferenceCandidates lists other resources and marks apply-time outputs honestly', () => {
	const graph: CanvasGraphSnapshot = {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-1',
		architectureName: 'Hub',
		sourceRevision: rev,
		status: 'complete',
		nodes: [rgNode, vnetNode],
		edges: [{ fromId: 'n1', toId: 'n2', kind: 'reference' }],
		diagnostics: [],
	};
	const refs = buildReferenceCandidates(graph, 'n2');
	assert.ok(refs.every(r => r.nodeId !== 'n2'), 'excludes self references');
	const rgId = refs.find(r => r.expression === 'azurerm_resource_group.hub.id')!;
	const rgName = refs.find(r => r.expression === 'azurerm_resource_group.hub.name')!;
	assert.equal(rgId.knownAtApply, true);
	assert.equal(rgName.knownAtApply, false);
});
