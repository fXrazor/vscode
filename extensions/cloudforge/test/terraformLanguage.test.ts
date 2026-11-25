/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTerraformNodeHoverMarkdown,
	buildTerraformSchemaOnlyHoverMarkdown,
	extractTerraformReferenceAtPosition,
	findBlockDefinitionInText,
	findTerraformBlockAtLine,
	matchBlockToGraphNode,
	matchReferenceToGraphNode,
	parseTerraformDocumentBlocks
} from '../src/editor/terraformLanguage.ts';

test('parseTerraformDocumentBlocks parses top-level HCL2 blocks with nested braces, comments, interpolations, and heredocs', () => {
	const source = [
		'# Header comment with fake resource "azurerm_fake" "ignored" {',
		'terraform {',
		'  required_version = ">= 1.6.0"',
		'  required_providers {',
		'    azurerm = { source = "hashicorp/azurerm" }',
		'  }',
		'}',
		'',
		'/* Multi-line comment',
		'resource "azurerm_commented" "skip" {',
		'}',
		'*/',
		'variable "location" {',
		'  type    = string',
		'  default = "uksouth"',
		'}',
		'',
		'locals {',
		'  prefix = "hub-${var.location}"',
		'  banner = <<-EOF',
		'    resource "azurerm_heredoc" "ignored" {',
		'      name = "not-a-block"',
		'    }',
		'  EOF',
		'}',
		'',
		'resource "azurerm_resource_group" "rg_hub" {',
		'  name     = "rg-${lookup(local.map, "k")}-}"',
		'  location = var.location',
		'}',
		'',
		'data "azurerm_client_config" "current" {}',
		'',
		'module "network"',
		'{',
		'  source = "./modules/network"',
		'}',
		'',
		'output "rg_id" {',
		'  value = azurerm_resource_group.rg_hub.id',
		'}',
	].join('\n');

	const blocks = parseTerraformDocumentBlocks(source);
	assert.deepEqual(
		blocks.map(b => ({ kind: b.kind, address: b.address, start: b.startLine, end: b.endLine })),
		[
			{ kind: 'terraform', address: 'terraform', start: 1, end: 6 },
			{ kind: 'variable', address: 'var.location', start: 12, end: 15 },
			{ kind: 'locals', address: 'locals', start: 17, end: 24 },
			{ kind: 'resource', address: 'azurerm_resource_group.rg_hub', start: 26, end: 29 },
			{ kind: 'data', address: 'data.azurerm_client_config.current', start: 31, end: 31 },
			{ kind: 'module', address: 'module.network', start: 33, end: 36 },
			{ kind: 'output', address: 'output.rg_id', start: 38, end: 40 },
		]
	);

	assert.equal(findTerraformBlockAtLine(blocks, 28)?.address, 'azurerm_resource_group.rg_hub');
	assert.equal(findTerraformBlockAtLine(blocks, 7), undefined);
});

test('parseTerraformDocumentBlocks handles oversize documents and unclosed trailing blocks safely', () => {
	assert.deepEqual(parseTerraformDocumentBlocks('a'.repeat(512 * 1024 + 1)), []);

	const unclosed = 'resource "azurerm_subnet" "snet_app" {\n  name = "app"';
	const blocks = parseTerraformDocumentBlocks(unclosed);
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].address, 'azurerm_subnet.snet_app');
	assert.equal(blocks[0].endLine, 1);
});

test('extractTerraformReferenceAtPosition resolves references, interpolations, block headers, and ignores comments', () => {
	const resLine = '  resource_group_name = azurerm_resource_group.rg_hub.name # azurerm_subnet.ignored.id';
	const resRef = extractTerraformReferenceAtPosition(resLine, resLine.indexOf('rg_hub') + 2);
	assert.equal(resRef?.kind, 'resource');
	assert.equal(resRef?.resourceType, 'azurerm_resource_group');
	assert.equal(resRef?.name, 'rg_hub');
	assert.equal(resRef?.address, 'azurerm_resource_group.rg_hub');
	assert.equal(resRef?.attributePath, 'name');

	// Inside line comment -> ignored
	assert.equal(extractTerraformReferenceAtPosition(resLine, resLine.indexOf('ignored')), undefined);

	// Data source inside string interpolation
	const dataLine = '  tenant = "${data.azurerm_client_config.current.tenant_id}"';
	const dataRef = extractTerraformReferenceAtPosition(dataLine, dataLine.indexOf('current'));
	assert.equal(dataRef?.kind, 'data');
	assert.equal(dataRef?.resourceType, 'azurerm_client_config');
	assert.equal(dataRef?.address, 'data.azurerm_client_config.current');
	assert.equal(dataRef?.attributePath, 'tenant_id');

	// Module, variable, local, and reserved root
	const modLine = '  subnet_id = module.network.app_subnet_id';
	assert.equal(extractTerraformReferenceAtPosition(modLine, modLine.indexOf('network'))?.address, 'module.network');

	const varLine = '  location = var.primary_region';
	assert.equal(extractTerraformReferenceAtPosition(varLine, varLine.indexOf('primary_region'))?.address, 'var.primary_region');

	const localLine = '  tags = local.common_tags';
	assert.equal(extractTerraformReferenceAtPosition(localLine, localLine.indexOf('common_tags'))?.address, 'local.common_tags');

	const eachLine = '  name = each.key';
	assert.equal(extractTerraformReferenceAtPosition(eachLine, eachLine.indexOf('key')), undefined);

	// Block declaration header itself
	const headerLine = 'resource "azurerm_virtual_network" "vnet_hub" {';
	const headerRef = extractTerraformReferenceAtPosition(headerLine, headerLine.indexOf('vnet_hub'));
	assert.equal(headerRef?.kind, 'resource');
	assert.equal(headerRef?.address, 'azurerm_virtual_network.vnet_hub');
});

test('matchBlockToGraphNode and matchReferenceToGraphNode disambiguate multi-file nodes and support data/module nodes', () => {
	const nodes = [
		{ id: 'n-rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'azurerm_resource_group.rg_hub', label: 'rg_hub', hasSource: true, sourceFile: 'main.tf', sourceLine: 1 },
		{ id: 'n-snet', kind: 'resource', resourceType: 'azurerm_subnet', name: 'azurerm_subnet.snet_app', label: 'snet_app', hasSource: true, sourceFile: 'network.tf', sourceLine: 12 },
		{ id: 'n-data', kind: 'data', resourceType: 'azurerm_client_config', name: 'data.azurerm_client_config.current', label: 'current', hasSource: true, sourceFile: 'main.tf', sourceLine: 20 },
		{ id: 'n-mod', kind: 'module', resourceType: null, name: 'module.landing_zone', label: 'landing_zone', hasSource: true, sourceFile: 'main.tf', sourceLine: 30 },
	];

	const blocks = parseTerraformDocumentBlocks([
		'resource "azurerm_subnet" "snet_app" {}',
		'data "azurerm_client_config" "current" {}',
		'module "landing_zone" {}',
	].join('\n'));

	assert.equal(matchBlockToGraphNode(blocks[0], nodes, 'NETWORK.TF')?.id, 'n-snet');
	assert.equal(matchBlockToGraphNode(blocks[1], nodes, 'main.tf')?.id, 'n-data');
	assert.equal(matchBlockToGraphNode(blocks[2], nodes, 'main.tf')?.id, 'n-mod');

	const ref = extractTerraformReferenceAtPosition('  id = azurerm_resource_group.rg_hub.id', 15)!;
	assert.equal(matchReferenceToGraphNode(ref, nodes)?.id, 'n-rg');
});

test('findBlockDefinitionInText resolves resource, variable, and local attribute declarations', () => {
	const doc = [
		'variable "region" {',
		'  default = "uksouth"',
		'}',
		'locals {',
		'  common_tags = { env = "prod" }',
		'}',
		'resource "azurerm_resource_group" "rg_hub" {',
		'  location = var.region',
		'}',
	].join('\n');

	const varRef = extractTerraformReferenceAtPosition('  location = var.region', 18)!;
	const varHit = findBlockDefinitionInText(doc, varRef);
	assert.equal(varHit?.startLine, 0);

	const localRef = extractTerraformReferenceAtPosition('  tags = local.common_tags', 16)!;
	const localHit = findBlockDefinitionInText(doc, localRef);
	assert.equal(localHit?.startLine, 4);
	assert.equal(localHit?.startCharacter, 2);

	const resRef = extractTerraformReferenceAtPosition('  rg = azurerm_resource_group.rg_hub.name', 12)!;
	const resHit = findBlockDefinitionInText(doc, resRef);
	assert.equal(resHit?.startLine, 6);
});

test('buildTerraformNodeHoverMarkdown and buildTerraformSchemaOnlyHoverMarkdown format topology, cost, schema, and command links', () => {
	const rg = { id: 'n-rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'azurerm_resource_group.rg_hub', label: 'rg_hub', hasSource: true, sourceFile: 'main.tf', sourceLine: 1 };
	const vnet = { id: 'n-vnet', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'azurerm_virtual_network.vnet_hub', label: 'vnet_hub', hasSource: true, sourceFile: 'network.tf', sourceLine: 1 };
	const snet = { id: 'n-snet', kind: 'resource', resourceType: 'azurerm_subnet', name: 'azurerm_subnet.snet_app', label: 'snet_app', hasSource: true, sourceFile: 'network.tf', sourceLine: 10 };
	const graph = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Hub Network',
		sourceRevision: 'a'.repeat(64),
		status: 'complete' as const,
		nodes: [rg, vnet, snet],
		edges: [
			{ fromId: 'n-rg', toId: 'n-vnet', kind: 'reference' },
			{ fromId: 'n-vnet', toId: 'n-snet', kind: 'reference' },
		],
		diagnostics: [],
	};

	const schema = {
		kind: 'resource' as const,
		typeName: 'azurerm_virtual_network',
		providerSource: 'hashicorp/azurerm',
		providerVersion: '4.10.0',
		description: 'Manages an Azure Virtual Network.',
		docsUrl: 'https://registry.terraform.io',
		exampleHcl: '',
		attributes: [
			{ name: 'name', path: 'name', access: 'required' as const, valueType: 'string' as const, description: 'Name' },
			{ name: 'address_space', path: 'address_space', access: 'required' as const, valueType: 'listString' as const, description: 'CIDR' },
		],
		blocks: [],
		outputs: [],
	};

	const md = buildTerraformNodeHoverMarkdown({
		node: vnet,
		graph,
		schema,
		costLine: {
			nodeId: 'n-vnet',
			resourceLabel: 'vnet_hub',
			resourceType: 'azurerm_virtual_network',
			status: 'free',
			baselineMonthlyUsd: 0,
			projectedMonthlyUsd: 0,
			deltaMonthlyUsd: 0,
			basis: 'VNet address space (data transfer billed separately)',
		},
	});

	assert.match(md, /azurerm_virtual_network\.vnet_hub/);
	assert.match(md, /Source: `network\.tf:1`/);
	assert.match(md, /1 upstream \(`rg_hub`\) \| 1 downstream \(`snet_app`\)/);
	assert.match(md, /\$0\.00\/mo \(free\)/);
	assert.match(md, /command:cloudforge\.revealNodeInCanvas\?%5B%22n-vnet%22%5D/);
	assert.match(md, /command:cloudforge\.explainResource\?%5B%22n-vnet%22%5D/);

	const schemaOnly = buildTerraformSchemaOnlyHoverMarkdown(schema);
	assert.match(schemaOnly, /CloudForge Schema/);
	assert.match(schemaOnly, /`name`, `address_space`/);
});
