/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { matchingBrace, parseLiteral, readAttributes, scanTerraformBlocks } from '../src/templates/hclScan.ts';
import { parseCatalogueIcons, PROVIDER_MARKS, TEMPLATE_ICON_OVERRIDES } from '../src/templates/iconCatalogue.ts';
import { buildLibraryHtml } from '../src/templates/libraryHtml.ts';
import { parseLibraryMessage, templateKey } from '../src/templates/libraryProtocol.ts';
import type { TemplateSummary } from '../src/templates/model.ts';
import { hclString, parameterFields, renderTfvars, validateParameter, validateParameters } from '../src/templates/parameters.ts';
import { buildTemplateDiagram, referencedAddresses, shortLabel, templateVariables } from '../src/templates/preview.ts';
import { sectionTemplates, templateDescription } from '../src/templates/sections.ts';

const HUB_SPOKE = [
	{
		fileName: 'variables.tf', contents: `variable "location" {
  description = "Azure region."
  type        = string
  default     = "uksouth"
}

variable "hub_cidr" {
  type    = string
  default = "10.0.0.0/16"
}
`
	},
	{
		fileName: 'network.tf', contents: `# Top-level container so child resources inherit location and resource_group_name.
resource "azurerm_resource_group" "network" {
  name     = "rg-network"
  location = var.location
}

resource "azurerm_virtual_network" "hub" {
  name                = "vnet-hub"
  location            = azurerm_resource_group.network.location
  resource_group_name = azurerm_resource_group.network.name
  address_space       = [var.hub_cidr]
}

resource "azurerm_virtual_network" "spoke_app" {
  name                = "vnet-spoke-app"
  location            = azurerm_resource_group.network.location
  resource_group_name = azurerm_resource_group.network.name
  address_space       = ["10.1.0.0/16"]
}

resource "azurerm_subnet" "spoke_app" {
  name                 = "snet-app"
  resource_group_name  = azurerm_resource_group.network.name
  virtual_network_name = azurerm_virtual_network.spoke_app.name
  address_prefixes     = [cidrsubnet(var.hub_cidr, 8, 1)]
}

resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  name                      = "hub-to-spoke"
  resource_group_name       = azurerm_resource_group.network.name
  virtual_network_name      = azurerm_virtual_network.hub.name
  remote_virtual_network_id = azurerm_virtual_network.spoke_app.id
}
`
	},
	{
		fileName: 'security.tf', contents: `resource "azurerm_network_security_group" "spoke_app" {
  name                = "nsg-spoke-app"
  location            = azurerm_resource_group.network.location
  resource_group_name = azurerm_resource_group.network.name

  security_rule {
    name = "deny-all" # braces in comments { are ignored
    description = "Rule with a } brace in a string and \${var.location}"
  }
}

resource "azurerm_subnet_network_security_group_association" "spoke_app" {
  subnet_id                 = azurerm_subnet.spoke_app.id
  network_security_group_id = azurerm_network_security_group.spoke_app.id
}
`
	},
];

const EKS = [{
	fileName: 'cluster.tf', contents: `resource "aws_vpc" "eks" { cidr_block = "10.40.0.0/16" }
resource "aws_subnet" "eks_a" {
  vpc_id     = aws_vpc.eks.id
  cidr_block = "10.40.1.0/24"
}
resource "aws_subnet" "eks_b" {
  vpc_id     = aws_vpc.eks.id
  cidr_block = "10.40.2.0/24"
}
resource "aws_iam_role" "eks_cluster" {
  name = "eks"
  assume_role_policy = <<EOF
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow" } ] }
EOF
}
resource "aws_eks_cluster" "main" {
  role_arn = aws_iam_role.eks_cluster.arn
  vpc_config { subnet_ids = [aws_subnet.eks_a.id, aws_subnet.eks_b.id] }
}
resource "aws_route" "r" { route_table_id = aws_route_table.t.id }
resource "aws_route_table" "t" { vpc_id = aws_vpc.eks.id }
data "aws_caller_identity" "current" {}
module "tags" {
  source = "./modules/tags"
  owner  = data.aws_caller_identity.current.account_id
}
`
}];

test('scanner finds top-level blocks and skips braces in strings, comments and heredocs', () => {
	const blocks = scanTerraformBlocks(HUB_SPOKE[2].contents, 'security.tf');
	assert.deepEqual(blocks.map(b => [b.kind, ...b.labels]), [
		['resource', 'azurerm_network_security_group', 'spoke_app'],
		['resource', 'azurerm_subnet_network_security_group_association', 'spoke_app'],
	]);
	assert.equal(blocks[1].line, 12);
	const eks = scanTerraformBlocks(EKS[0].contents, 'cluster.tf');
	assert.deepEqual(eks.map(b => b.kind + ':' + b.labels.join('.')), [
		'resource:aws_vpc.eks', 'resource:aws_subnet.eks_a', 'resource:aws_subnet.eks_b', 'resource:aws_iam_role.eks_cluster',
		'resource:aws_eks_cluster.main', 'resource:aws_route.r', 'resource:aws_route_table.t', 'data:aws_caller_identity.current', 'module:tags',
	]);
	assert.equal(matchingBrace('{ "}" # }\n }', 0), 11);
	assert.equal(matchingBrace('{ unclosed', 0), -1);
});

test('attributes and literals are read without evaluating anything', () => {
	const attrs = readAttributes(`
  name     = "rg-network"   # a comment
  count    = 2
  enabled  = true
  tags     = { env = "dev", "cost-centre" = "42" }
  prefixes = ["10.0.1.0/24", "10.0.2.0/24"]
  nested {
    hidden = "inner"
  }
  expr     = cidrsubnet(var.hub_cidr, 8, 1)
`);
	assert.equal(attrs.get('name'), '"rg-network"');
	assert.equal(attrs.has('hidden'), false);
	assert.equal(parseLiteral(attrs.get('name')), 'rg-network');
	assert.equal(parseLiteral(attrs.get('count')), 2);
	assert.equal(parseLiteral(attrs.get('enabled')), true);
	assert.deepEqual(parseLiteral(attrs.get('tags')), { env: 'dev', 'cost-centre': '42' });
	assert.deepEqual(parseLiteral(attrs.get('prefixes')), ['10.0.1.0/24', '10.0.2.0/24']);
	assert.equal(parseLiteral(attrs.get('expr')), undefined);
	assert.equal(parseLiteral('"${var.prefix}-x"'), undefined);
	assert.equal(parseLiteral('"a \\"quoted\\" word"'), 'a "quoted" word');
});

test('references are limited to known addresses and ignore attributes and var/local/data prefixes', () => {
	const known = new Set(['azurerm_subnet.spoke_app', 'azurerm_network_security_group.spoke_app', 'data.aws_caller_identity.current', 'module.tags']);
	assert.deepEqual(referencedAddresses('a = azurerm_subnet.spoke_app.id\nb = azurerm_network_security_group.spoke_app.id\nc = var.azurerm_subnet.spoke_app', known),
		['azurerm_subnet.spoke_app', 'azurerm_network_security_group.spoke_app']);
	assert.deepEqual(referencedAddresses('x = data.aws_caller_identity.current.id\ny = module.tags.value', known), ['data.aws_caller_identity.current', 'module.tags']);
});

test('the preview nests resources in the containers they reference and draws other references as arrows', () => {
	const icons = (type: string) => type === 'azurerm_virtual_network' ? { icon: 'catalog-icons/azure/azure-virtual-networks.svg', label: 'Virtual network' } : undefined;
	const dg = buildTemplateDiagram(HUB_SPOKE, icons, undefined, 'azure');
	const parent = Object.fromEntries(dg.nodes.map(n => [n.id, n.parent ?? null]));
	assert.deepEqual(parent, {
		'azurerm_resource_group.network': null,
		'azurerm_virtual_network.hub': 'azurerm_resource_group.network',
		'azurerm_virtual_network.spoke_app': 'azurerm_resource_group.network',
		'azurerm_subnet.spoke_app': 'azurerm_virtual_network.spoke_app',
		// References both networks at the same depth: it sits in their common container.
		'azurerm_virtual_network_peering.hub_to_spoke': 'azurerm_resource_group.network',
		'azurerm_network_security_group.spoke_app': 'azurerm_resource_group.network',
		'azurerm_subnet_network_security_group_association.spoke_app': 'azurerm_subnet.spoke_app',
	});
	assert.deepEqual(dg.edges, [
		['azurerm_virtual_network_peering.hub_to_spoke', 'azurerm_virtual_network.hub'],
		['azurerm_virtual_network_peering.hub_to_spoke', 'azurerm_virtual_network.spoke_app'],
		['azurerm_subnet_network_security_group_association.spoke_app', 'azurerm_network_security_group.spoke_app'],
	]);
	const hub = dg.nodes.find(n => n.id === 'azurerm_virtual_network.hub')!;
	assert.equal(hub.detail, '10.0.0.0/16', 'a bare var.x takes the variable default');
	assert.equal(hub.icon, 'catalog-icons/azure/azure-virtual-networks.svg');
	assert.equal(hub.label, 'VNet');
	assert.equal(dg.nodes.find(n => n.id === 'azurerm_subnet.spoke_app')!.detail, undefined, 'cidrsubnet() is not evaluated');
	assert.deepEqual(dg.providers, ['azure']);
	assert.equal(dg.nodes.find(n => n.id === 'azurerm_network_security_group.spoke_app')!.file, 'security.tf');
});

test('the preview places a resource referencing two subnets in their network, and inherits the parent of what it uses', () => {
	const dg = buildTemplateDiagram(EKS, undefined, undefined, 'aws');
	const parent = Object.fromEntries(dg.nodes.map(n => [n.id, n.parent ?? null]));
	assert.equal(parent['aws_eks_cluster.main'], 'aws_vpc.eks');
	assert.equal(parent['aws_iam_role.eks_cluster'], null, 'global resources stay outside the network');
	assert.equal(parent['aws_route.r'], 'aws_vpc.eks', 'beside the route table it uses');
	assert.equal(dg.nodes.find(n => n.id === 'data.aws_caller_identity.current')!.role, 'data');
	const mod = dg.nodes.find(n => n.id === 'module.tags')!;
	assert.equal(mod.role, 'module');
	assert.equal(mod.provider, 'aws');
	assert.ok(dg.edges.some(([a, b]) => a === 'aws_eks_cluster.main' && b === 'aws_subnet.eks_b'));
	assert.ok(!dg.edges.some(([a, b]) => a === 'aws_subnet.eks_a' && b === 'aws_vpc.eks'), 'containment is not drawn as an arrow');
});

test('layout.json visual parents win over inferred containment', () => {
	const files = [{ fileName: 'main.tf', contents: 'resource "azurerm_resource_group" "a" {}\nresource "azurerm_resource_group" "b" {}\nresource "azurerm_virtual_network" "v" { resource_group_name = azurerm_resource_group.a.name }' }];
	const dg = buildTemplateDiagram(files, undefined, { resources: { 'azurerm_virtual_network.v': { visualParent: 'azurerm_resource_group.b' } } });
	assert.equal(dg.nodes.find(n => n.id === 'azurerm_virtual_network.v')!.parent, 'azurerm_resource_group.b');
});

test('short labels come from the curated table, then the catalogue, then the type', () => {
	assert.equal(shortLabel('aws_nat_gateway'), 'NAT gateway');
	assert.equal(shortLabel('azurerm_key_vault_secret', 'Key Vault secret'), 'Key Vault secret');
	assert.equal(shortLabel('google_dns_managed_zone'), 'Dns managed zone');
});

test('wizard fields follow parameters.schema.json when present and skip ids and secrets', () => {
	const variables = templateVariables([{
		fileName: 'variables.tf', contents: `variable "prefix" {
  default = "cf-dev"
}
variable "location" {
  type    = string
  default = "uksouth"
}
variable "address_space" {
  type    = string
  default = "10.0.0.0/16"
}
variable "tags" {
  type    = map(string)
  default = { env = "dev" }
}
variable "admin_password" {
  type      = string
  sensitive = true
}
variable "subscription_id" { type = string }
variable "not_in_schema" { default = "x" }
` }]);
	const schema = {
		type: 'object', required: ['prefix', 'location', 'address_space'], 'x-cloudforge-groups': ['General', 'Network'],
		properties: {
			address_space: { type: 'string', title: 'Address space', format: 'cidr', 'x-cloudforge-group': 'Network', 'x-cloudforge-order': 1 },
			prefix: { type: 'string', title: 'Naming prefix', format: 'naming-prefix', 'x-cloudforge-group': 'General', 'x-cloudforge-order': 1 },
			location: { type: 'string', title: 'Region', format: 'region', 'x-cloudforge-group': 'General', 'x-cloudforge-order': 2 },
			tags: { type: 'object', title: 'Tags', 'x-cloudforge-group': 'General', 'x-cloudforge-order': 3 },
			admin_password: { type: 'string' },
			subscription_id: { type: 'string' },
		},
	};
	const fields = parameterFields(schema, variables);
	assert.deepEqual(fields.map(f => f.name), ['prefix', 'location', 'tags', 'address_space', 'admin_password', 'subscription_id']);
	assert.equal(fields.find(f => f.name === 'tags')!.defaultText, 'env=dev');
	assert.equal(fields.find(f => f.name === 'admin_password')!.skip, 'sensitive');
	assert.equal(fields.find(f => f.name === 'subscription_id')!.skip, 'cloudAccount');
	const all = parameterFields(undefined, variables);
	assert.ok(all.some(f => f.name === 'not_in_schema'), 'without a schema every variable is a field');
	assert.equal(all.find(f => f.name === 'subscription_id')!.required, true);

	const cidr = fields.find(f => f.name === 'address_space')!;
	assert.equal(validateParameter(cidr, '10.0.0.0/16'), undefined);
	assert.match(validateParameter(cidr, '10.0.0.0/33')!, /address range/);
	assert.match(validateParameter(fields[0], 'Bad Prefix')!, /lowercase/);
	assert.equal(validateParameter(fields.find(f => f.name === 'admin_password')!, ''), undefined, 'skipped fields are never required');
	assert.deepEqual(Object.keys(validateParameters(fields, { prefix: '', location: 'uk south' })), ['location'], 'an empty value falls back to the default');
});

test('terraform.tfvars escapes every value so nothing becomes an expression, and never writes secrets', () => {
	assert.equal(hclString('a"b\\c${var.x}%{if}\n'), '"a\\"b\\\\c$${var.x}%%{if}\\n"');
	const variables = templateVariables([{ fileName: 'v.tf', contents: 'variable "prefix" { default = "cf" }\nvariable "count" { type = number\n default = 2 }\nvariable "on" { type = bool\n default = true }\nvariable "tags" { type = map(string)\n default = {} }\nvariable "cidrs" { type = list(string)\n default = [] }\nvariable "secret" {\n sensitive = true\n}\nvariable "project_id" {}\n' }]);
	const fields = parameterFields(undefined, variables);
	const text = renderTfvars({ id: 'cloudforge.azure.basic-vnet', version: '1.0.0' }, fields, { prefix: 'x${y}', tags: 'env=dev\ncost centre=42', cidrs: '10.0.0.0/24, 10.0.1.0/24', secret: 'hunter2' })!;
	assert.match(text, /^# Values for this architecture, from CloudForge template cloudforge\.azure\.basic-vnet 1\.0\.0\./);
	assert.match(text, /^prefix = "x\$\$\{y\}"$/m);
	assert.match(text, /^count = 2$/m);
	assert.match(text, /^on = true$/m);
	assert.match(text, /^tags = \{\n {2}env = "dev"\n {2}"cost centre" = "42"\n\}$/m);
	assert.match(text, /^cidrs = \["10\.0\.0\.0\/24", "10\.0\.1\.0\/24"\]$/m);
	assert.ok(!text.includes('hunter2'));
	assert.match(text, /# secret: sensitive/);
	assert.match(text, /# project_id: set this yourself/);
	assert.equal(renderTfvars({ id: 'a.b', version: '1.0.0' }, [], {}), undefined);
});

test('webview messages are validated before the extension acts on them', () => {
	assert.deepEqual(parseLibraryMessage({ type: 'ready' }), { type: 'ready' });
	assert.deepEqual(parseLibraryMessage({ type: 'details', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0' }), { type: 'details', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0' });
	assert.equal(parseLibraryMessage({ type: 'details', templateId: '../etc', version: '1.0.0' }), undefined);
	assert.equal(parseLibraryMessage({ type: 'details', templateId: 'cloudforge.azure.hub-spoke', version: 'latest' }), undefined);
	assert.equal(parseLibraryMessage({ type: 'create', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', name: '', values: {} }), undefined);
	assert.equal(parseLibraryMessage({ type: 'create', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', name: 'hub', values: { 'bad key': 'x' } }), undefined);
	assert.equal(parseLibraryMessage({ type: 'create', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', name: 'hub', values: { a: 1 } }), undefined);
	assert.deepEqual(parseLibraryMessage({ type: 'create', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', name: 'hub', values: { prefix: 'cf' } }),
		{ type: 'create', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', name: 'hub', values: { prefix: 'cf' } });
	assert.equal(parseLibraryMessage({ type: 'openFile', templateId: 'cloudforge.azure.hub-spoke', version: '1.0.0', fileName: '../main.tf' }), undefined);
	assert.equal(parseLibraryMessage({ type: 'copy', text: 'x'.repeat(600) }), undefined);
	assert.equal(parseLibraryMessage({ type: 'deleteEverything' }), undefined);
	assert.equal(parseLibraryMessage('ready'), undefined);
	assert.equal(templateKey('a.b', '1.0.0'), 'a.b@1.0.0');
});

test('the library page uses a nonce-only CSP and escapes its URIs', () => {
	const html = buildLibraryHtml({ nonce: 'abc123', cspSource: 'https://webview', scriptUri: 'https://webview/library.js', styleUri: 'https://webview/library.css?"x"', fontUri: 'https://webview/font.woff2' });
	assert.match(html, /script-src 'nonce-abc123'/);
	assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
	assert.match(html, /<script nonce="abc123" src="https:\/\/webview\/library\.js"><\/script>/);
	assert.match(html, /library\.css\?&quot;x&quot;/);
	assert.match(html, /font-family: "Mona Sans"/);
});

test('catalogue icons drop the shared placeholder and keep only safe paths', () => {
	const map = parseCatalogueIcons({ entries: [
		{ type: 'aws_vpc', icon: 'azure-resource-groups.svg', label: 'VPC' },
		{ type: 'azurerm_resource_group', icon: 'catalog-icons/azure/azure-resource-groups.svg', label: 'Resource group' },
		{ type: 'evil', icon: '../../secret.svg' },
		{ type: 'aws_route', icon: 'catalog-icons/aws/aws-vpc-router.svg' },
	] });
	assert.equal(map.get('aws_vpc')!.icon, undefined);
	assert.equal(map.get('aws_vpc')!.label, 'VPC');
	assert.equal(map.get('azurerm_resource_group')!.icon, 'catalog-icons/azure/azure-resource-groups.svg');
	assert.equal(map.get('evil')!.icon, undefined);
	assert.equal(map.get('aws_route')!.icon, 'catalog-icons/aws/aws-vpc-router.svg');
});

test('every icon override and provider mark exists in the Studio assets', { skip: !existsSync(join(import.meta.dirname, '..', 'studio', 'assets')) }, () => {
	const assets = join(import.meta.dirname, '..', 'studio', 'assets');
	for (const icon of [...Object.values(TEMPLATE_ICON_OVERRIDES), ...Object.values(PROVIDER_MARKS)]) {
		assert.ok(existsSync(join(assets, icon)), icon);
	}
});

function summary(id: string, source: TemplateSummary['source'], extra: Partial<TemplateSummary> = {}): TemplateSummary {
	return {
		id, name: id, version: '1.0.0', summary: '', templateType: 'architecture', providers: ['azure'], categories: [], difficulty: 'beginner',
		certifications: [], tags: [], lifecycle: 'stable', publisher: 'CloudForge', license: 'MIT', resourceCount: 3, compatibility: {},
		source, trust: source === 'local' ? 'local' : 'official', hasLayout: false, hasParameters: false, highRiskFindings: 0, ...extra,
	};
}

test('Templates view sections: featured built-ins, My Library and downloads', () => {
	const list = [
		summary('a.one', 'builtin'), summary('a.two', 'builtin', { lifecycle: 'deprecated' }), summary('a.three', 'local'),
		summary('a.four', 'remote'), ...['a.b1', 'a.b2', 'a.b3', 'a.b4', 'a.b5', 'a.b6'].map(id => summary(id, 'builtin')),
	];
	assert.deepEqual(sectionTemplates(list, 'featured').map(t => t.id), ['a.one', 'a.b1', 'a.b2', 'a.b3', 'a.b4', 'a.b5']);
	assert.deepEqual(sectionTemplates(list, 'mine').map(t => t.id), ['a.three']);
	assert.deepEqual(sectionTemplates(list, 'downloaded').map(t => t.id), ['a.four']);
	assert.equal(templateDescription(summary('a.x', 'builtin', { providers: ['aws', 'gcp'], resourceCount: 9 })), 'AWS + Google Cloud · 9');
});
