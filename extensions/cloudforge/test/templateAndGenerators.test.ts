/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	filterTemplates,
	findTemplateById,
	TEMPLATE_LIBRARY
} from '../src/canvas/templateLibrary.ts';
import {
	generateTargetIac,
	GENERATOR_PROVENANCE
} from '../src/canvas/generators.ts';
import {
	parseWebviewMessage,
	type CanvasGraphSnapshot
} from '../src/canvas/protocol.ts';
import type { ResourceDraft } from '../src/canvas/schemaForm.ts';

function sampleAzureGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'HubSpoke',
		sourceRevision: 'a'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'n-rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_hub', label: 'azurerm_resource_group.rg_hub', hasSource: true },
			{ id: 'n-vnet', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet_hub', label: 'azurerm_virtual_network.vnet_hub', hasSource: true },
			{ id: 'n-sub', kind: 'resource', resourceType: 'azurerm_subnet', name: 'snet_apps', label: 'azurerm_subnet.snet_apps', hasSource: true },
			{ id: 'n-nsg', kind: 'resource', resourceType: 'azurerm_network_security_group', name: 'nsg_hub', label: 'azurerm_network_security_group.nsg_hub', hasSource: true },
			{ id: 'n-pip', kind: 'resource', resourceType: 'azurerm_public_ip', name: 'pip_edge', label: 'azurerm_public_ip.pip_edge', hasSource: true },
			{ id: 'n-mod', kind: 'module', resourceType: null, name: 'audit_logs', label: 'module.audit_logs', hasSource: true },
		],
		edges: [
			{ fromId: 'n-rg', toId: 'n-vnet', kind: 'reference' },
			{ fromId: 'n-vnet', toId: 'n-sub', kind: 'reference' },
		],
		diagnostics: [],
	};
}

function sampleMultiCloudGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'ws-2',
		architectureId: 'arch-2',
		architectureName: 'MultiCloud',
		sourceRevision: 'b'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'aws-vpc', kind: 'resource', resourceType: 'aws_vpc', name: 'main', label: 'aws_vpc.main', hasSource: true },
			{ id: 'aws-sub', kind: 'resource', resourceType: 'aws_subnet', name: 'public', label: 'aws_subnet.public', hasSource: true },
			{ id: 'aws-igw', kind: 'resource', resourceType: 'aws_internet_gateway', name: 'edge', label: 'aws_internet_gateway.edge', hasSource: true },
			{ id: 'k8s-ns', kind: 'resource', resourceType: 'kubernetes_namespace', name: 'app', label: 'kubernetes_namespace.app', hasSource: true },
			{ id: 'k8s-cm', kind: 'resource', resourceType: 'kubernetes_config_map', name: 'app_config', label: 'kubernetes_config_map.app_config', hasSource: true },
			{ id: 'k8s-np', kind: 'resource', resourceType: 'kubernetes_network_policy', name: 'default_deny', label: 'kubernetes_network_policy.default_deny', hasSource: true },
		],
		edges: [],
		diagnostics: [],
	};
}

test('Template Library exposes offline multi-cloud templates with search, provider filter, and sort', () => {
	assert.ok(TEMPLATE_LIBRARY.length >= 6);
	const providers = new Set(TEMPLATE_LIBRARY.map(t => t.provider));
	assert.deepEqual([...providers].sort(), ['aws', 'azure', 'gcp', 'kubernetes']);

	for (const tpl of TEMPLATE_LIBRARY) {
		assert.ok(tpl.starterMainTf.includes('resource "'), `template ${tpl.id} should include Terraform resources`);
		assert.ok(tpl.thumbnailNodes.length >= 3, `template ${tpl.id} should define thumbnail nodes`);
		assert.equal(findTemplateById(tpl.id)?.name, tpl.name);
	}

	const azureOnly = filterTemplates(TEMPLATE_LIBRARY, '', 'azure', 'name');
	assert.equal(azureOnly.length, 3);
	assert.ok(azureOnly.every(t => t.provider === 'azure'));

	const byTag = filterTemplates(TEMPLATE_LIBRARY, 'firewall', 'all', 'name');
	assert.equal(byTag.length, 1);
	assert.equal(byTag[0].id, 'tpl-gcp-custom-vpc');

	const byResources = filterTemplates(TEMPLATE_LIBRARY, '', 'all', 'resources');
	assert.ok(byResources[0].resourceCount >= byResources[byResources.length - 1].resourceCount);
});

test('Multi-target generator produces deterministic Azure Bicep and ARM JSON with draft overrides and honest loss reporting', () => {
	const graph = sampleAzureGraph();
	const drafts: Record<string, ResourceDraft> = {
		'n-vnet': {
			nodeId: 'n-vnet',
			kind: 'resource',
			typeName: 'azurerm_virtual_network',
			name: 'vnet_hub',
			baseSourceRevision: graph.sourceRevision,
			attributes: {
				name: { kind: 'literal', value: 'vnet-custom-hub' },
				address_space: { kind: 'literal', value: ['10.42.0.0/16'] },
			},
			blocks: [],
		},
	};

	const bicep = generateTargetIac(graph, drafts, 'bicep');
	assert.equal(bicep.fileExtension, '.bicep');
	assert.equal(bicep.provenance, GENERATOR_PROVENANCE);
	assert.equal(bicep.mappedCount, 5);
	assert.equal(bicep.unmappedCount, 1);
	assert.deepEqual(bicep.unmappedTypes, ['module']);
	assert.ok(bicep.code.includes(`name: 'vnet-custom-hub'`));
	assert.ok(bicep.code.includes(`addressPrefixes: ['10.42.0.0/16']`));
	assert.ok(bicep.code.includes('Microsoft.Network/publicIPAddresses@2024-01-01'));
	assert.ok(bicep.lossNotes.some(n => n.includes('1 declaration(s)')));

	const arm = generateTargetIac(graph, drafts, 'arm');
	assert.equal(arm.fileExtension, '.json');
	const parsed = JSON.parse(arm.code) as { resources: { type: string; name: string }[]; metadata: { architecture: string } };
	assert.equal(parsed.metadata.architecture, 'HubSpoke');
	assert.ok(parsed.resources.some(r => r.type === 'Microsoft.Network/virtualNetworks' && r.name === 'vnet-custom-hub'));
	assert.ok(arm.unmappedCount >= 1);
	assert.ok(arm.lossNotes.length >= 1);
});

test('Multi-target generator produces AWS CloudFormation YAML and Kubernetes YAML with accurate unmapped counts', () => {
	const graph = sampleMultiCloudGraph();

	const cfn = generateTargetIac(graph, {}, 'cloudformation');
	assert.equal(cfn.fileExtension, '.yaml');
	assert.equal(cfn.mappedCount, 3);
	assert.equal(cfn.unmappedCount, 3);
	assert.ok(cfn.code.includes('AWSTemplateFormatVersion:'));
	assert.ok(cfn.code.includes('Type: AWS::EC2::VPC'));
	assert.ok(cfn.code.includes('Type: AWS::EC2::Subnet'));
	assert.ok(cfn.code.includes('Type: AWS::EC2::InternetGateway'));
	assert.ok(cfn.lossNotes.some(n => n.includes('3 non-AWS')));

	const k8s = generateTargetIac(graph, {}, 'k8s');
	assert.equal(k8s.fileExtension, '.yaml');
	assert.equal(k8s.mappedCount, 3);
	assert.equal(k8s.unmappedCount, 3);
	assert.ok(k8s.code.includes('kind: Namespace'));
	assert.ok(k8s.code.includes('kind: ConfigMap'));
	assert.ok(k8s.code.includes('kind: NetworkPolicy'));
	assert.ok(k8s.lossNotes.some(n => n.includes('3 non-Kubernetes')));
});

test('Protocol validates multi-target export formats and useTemplateAsArchitecture messages', () => {
	const validBicep = parseWebviewMessage({
		type: 'exportArtifact',
		format: 'bicep',
		suggestedFileName: 'hub-aaaaaaaa.bicep',
		content: `targetScope = 'resourceGroup'\n`,
		encoding: 'utf8',
	});
	assert.ok(validBicep && validBicep.type === 'exportArtifact' && validBicep.format === 'bicep');

	const mismatchExt = parseWebviewMessage({
		type: 'exportArtifact',
		format: 'bicep',
		suggestedFileName: 'hub-aaaaaaaa.yaml',
		content: 'x',
		encoding: 'utf8',
	});
	assert.equal(mismatchExt, undefined);

	const validK8s = parseWebviewMessage({
		type: 'exportArtifact',
		format: 'k8s',
		suggestedFileName: 'app-bbbbbbbb.yaml',
		content: 'kind: Namespace\n',
		encoding: 'utf8',
	});
	assert.ok(validK8s && validK8s.type === 'exportArtifact' && validK8s.format === 'k8s');

	const validTpl = parseWebviewMessage({
		type: 'useTemplateAsArchitecture',
		templateId: 'tpl-azure-hub-network',
	});
	assert.deepEqual(validTpl, { type: 'useTemplateAsArchitecture', templateId: 'tpl-azure-hub-network' });

	const badTpl = parseWebviewMessage({
		type: 'useTemplateAsArchitecture',
		templateId: '',
	});
	assert.equal(badTpl, undefined);
});
