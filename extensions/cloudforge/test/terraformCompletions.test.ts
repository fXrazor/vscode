/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTerraformCompletionItems,
	collectWorkspaceTerraformSymbols,
	detectTerraformCompletionContext,
	mergeGraphNodesIntoSymbols
} from '../src/editor/terraformCompletions.ts';

const SAMPLE_SCHEMA = {
	kind: 'resource' as const,
	typeName: 'azurerm_resource_group',
	providerSource: 'hashicorp/azurerm',
	providerVersion: '5.14.0',
	description: 'Manages an Azure Resource Group.',
	docsUrl: 'https://registry.terraform.io',
	exampleHcl: '',
	attributes: [
		{ name: 'name', path: 'name', access: 'required' as const, valueType: 'string' as const, description: 'Resource Group name.', placeholder: 'rg-app' },
		{ name: 'location', path: 'location', access: 'required' as const, valueType: 'string' as const, description: 'Azure region.', options: ['uksouth', 'eastus', 'westeurope'] },
		{ name: 'tags', path: 'tags', access: 'optional' as const, valueType: 'mapString' as const, description: 'Resource tags.' },
		{ name: 'id', path: 'id', access: 'computedOnly' as const, valueType: 'string' as const, description: 'ID.' },
	],
	blocks: [
		{
			name: 'timeouts',
			path: 'timeouts',
			maxItems: 1,
			description: 'Operation timeouts.',
			attributes: [
				{ name: 'create', path: 'timeouts.create', access: 'optional' as const, valueType: 'string' as const, description: 'Create timeout.' },
			],
		},
	],
	outputs: [
		{ name: 'id', valueType: 'string' as const, description: 'Resource Group ID.', knownAtApply: true },
		{ name: 'name', valueType: 'string' as const, description: 'Resource Group name.', knownAtApply: false },
		{ name: 'location', valueType: 'string' as const, description: 'Azure region.', knownAtApply: false },
	],
};

test('collectWorkspaceTerraformSymbols indexes variables, locals, modules, resources, and data sources across files', () => {
	const symbols = collectWorkspaceTerraformSymbols([
		{
			fileName: 'variables.tf',
			text: [
				'variable "region" { default = "uksouth" }',
				'locals {',
				'  common_tags = { env = "prod" }',
				'  # ignored = "comment"',
				'  name_prefix = "cf"',
				'}',
			].join('\n'),
		},
		{
			fileName: 'main.tf',
			text: [
				'data "azurerm_client_config" "current" {}',
				'resource "azurerm_resource_group" "hub" {',
				'  name     = "rg-hub"',
				'  location = var.region',
				'}',
				'module "network" {',
				'  source = "./modules/network"',
				'}',
			].join('\n'),
		},
	]);

	assert.deepEqual(symbols.variables.map(v => v.name), ['region']);
	assert.deepEqual(symbols.locals.map(l => l.name), ['common_tags', 'name_prefix']);
	assert.deepEqual(symbols.modules.map(m => m.name), ['network']);
	assert.deepEqual(symbols.resources.map(r => `${r.resourceType}.${r.name}`), ['azurerm_resource_group.hub']);
	assert.deepEqual(symbols.dataSources.map(d => `${d.resourceType}.${d.name}`), ['azurerm_client_config.current']);

	const merged = mergeGraphNodesIntoSymbols(symbols, {
		workspaceId: 'ws',
		architectureId: 'arch',
		architectureName: 'Hub',
		sourceRevision: 'a'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'n1', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'azurerm_virtual_network.vnet', label: 'vnet', hasSource: true, sourceFile: 'network.tf' },
		],
		edges: [],
		diagnostics: [],
	});
	assert.equal(merged.resources.length, 2);
	assert.equal(merged.resources[1].name, 'vnet');
});

test('detectTerraformCompletionContext & buildTerraformCompletionItems handle top-level, type labels, attributes, and options', () => {
	const emptySymbols = collectWorkspaceTerraformSymbols([]);

	// Top level snippet
	const topCtx = detectTerraformCompletionContext('res', 0, 3);
	assert.equal(topCtx?.kind, 'topLevel');
	const topItems = buildTerraformCompletionItems(topCtx!, { schemas: [SAMPLE_SCHEMA], symbols: emptySymbols });
	assert.ok(topItems.some(i => i.label === 'resource'));
	assert.ok(topItems.some(i => i.label === 'resource "azurerm_resource_group"' && i.insertText.includes('location =')));

	// Resource type label inside quotes
	const labelCtx = detectTerraformCompletionContext('resource "az', 0, 12);
	assert.equal(labelCtx?.kind, 'resourceTypeLabel');
	const labelItems = buildTerraformCompletionItems(labelCtx!, { schemas: [SAMPLE_SCHEMA], symbols: emptySymbols });
	assert.deepEqual(labelItems.map(i => i.label), ['azurerm_resource_group']);

	// Block attribute completion skips already-present attributes & computedOnly, sorts required first
	const blockText = [
		'resource "azurerm_resource_group" "hub" {',
		'  name = "rg-hub"',
		'  ',
		'}',
	].join('\n');
	const attrCtx = detectTerraformCompletionContext(blockText, 2, 2);
	assert.equal(attrCtx?.kind, 'blockAttribute');
	const attrItems = buildTerraformCompletionItems(attrCtx!, { schemas: [SAMPLE_SCHEMA], symbols: emptySymbols });
	assert.ok(!attrItems.some(i => i.label === 'name'), 'existing attribute should be omitted');
	assert.ok(!attrItems.some(i => i.label === 'id'), 'computedOnly attribute should be omitted');
	assert.equal(attrItems[0].label, 'location', 'remaining required attribute should sort first');
	assert.ok(attrItems.some(i => i.label === 'tags'));
	assert.ok(attrItems.some(i => i.label === 'timeouts'));

	// Attribute value options inside quotes
	const valueText = [
		'resource "azurerm_resource_group" "hub" {',
		'  location = "uk',
		'}',
	].join('\n');
	const valCtx = detectTerraformCompletionContext(valueText, 1, 16);
	assert.equal(valCtx?.kind, 'valueExpression');
	const valItems = buildTerraformCompletionItems(valCtx!, { schemas: [SAMPLE_SCHEMA], symbols: emptySymbols });
	assert.deepEqual(valItems.map(i => i.label), ['uksouth', 'eastus', 'westeurope']);
});

test('referenceMember completion suggests var, local, module, resource names, and schema outputs even inside interpolations', () => {
	const symbols = collectWorkspaceTerraformSymbols([
		{
			fileName: 'main.tf',
			text: [
				'variable "env" {}',
				'locals { prefix = "prod" }',
				'module "net" { source = "./net" }',
				'resource "azurerm_resource_group" "hub" {}',
			].join('\n'),
		},
	]);

	// var.
	const varCtx = detectTerraformCompletionContext('  x = var.', 0, 10);
	assert.equal(varCtx?.kind, 'referenceMember');
	assert.deepEqual(buildTerraformCompletionItems(varCtx!, { schemas: [SAMPLE_SCHEMA], symbols }).map(i => i.label), ['env']);

	// local. inside interpolation
	const interpLine = '  name = "${local.pre';
	const localCtx = detectTerraformCompletionContext(interpLine, 0, interpLine.length);
	assert.equal(localCtx?.kind, 'referenceMember');
	assert.deepEqual(buildTerraformCompletionItems(localCtx!, { schemas: [SAMPLE_SCHEMA], symbols }).map(i => i.label), ['prefix']);

	// module.
	const modCtx = detectTerraformCompletionContext('  id = module.', 0, 14);
	assert.deepEqual(buildTerraformCompletionItems(modCtx!, { schemas: [SAMPLE_SCHEMA], symbols }).map(i => i.label), ['net']);

	// resource type -> name -> output attribute
	const typeCtx = detectTerraformCompletionContext('  x = azurerm_resource_group.', 0, 29);
	assert.deepEqual(buildTerraformCompletionItems(typeCtx!, { schemas: [SAMPLE_SCHEMA], symbols }).map(i => i.label), ['hub']);

	const outCtx = detectTerraformCompletionContext('  x = azurerm_resource_group.hub.', 0, 33);
	assert.deepEqual(buildTerraformCompletionItems(outCtx!, { schemas: [SAMPLE_SCHEMA], symbols }).map(i => i.label), ['id', 'name', 'location']);

	// Ignored inside comments
	assert.equal(detectTerraformCompletionContext('  # var.', 0, 8), undefined);
});
