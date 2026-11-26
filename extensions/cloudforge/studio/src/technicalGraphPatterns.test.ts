/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingKey } from './fieldBindings.ts';
import { sampleArchitecture } from './fixture.ts';
import { hubSpokeArchitecture } from './graphFixtures.ts';
import type { Architecture, Provider, Resource } from './model.ts';
import { projectTechnicalGraph } from './technicalGraph.ts';
import {
	shortestSnapshotPath,
	snapshotTroubleshootingFindings
} from './technicalGraphPatterns.ts';

function makeResource(
	id: string,
	type: string,
	options: {
		readonly provider?: Provider;
		readonly region?: string;
		readonly label?: string;
		readonly kind?: Resource['kind'];
		readonly refs?: Record<string, string>;
		readonly settings?: Record<string, string>;
	} = {}
): Resource {
	const base = sampleArchitecture().resources.find(item => item.id === 'vm')!;
	const provider: Provider = options.provider
		?? (type.startsWith('aws_') ? 'aws' : type.startsWith('google_') ? 'gcp' : 'azure');
	const refs = options.refs ?? {};
	return {
		...base,
		id,
		name: id,
		label: options.label ?? id,
		terraformName: id.replace(/[^a-zA-Z0-9_]/g, '_'),
		provider,
		region: options.region ?? '',
		parentId: undefined,
		visualParentId: undefined,
		kind: options.kind ?? 'generic',
		catalogue: { type, label: id, service: id, category: 'Other', icon: 'azure-compute.svg', fields: [] },
		settings: { ...Object.fromEntries(Object.keys(refs).map(field => [field, ''])), ...(options.settings ?? {}) },
		blocks: [],
		resourceRefs: Object.fromEntries(
			Object.entries(refs).map(([field, resourceId]) => [bindingKey({ kind: 'setting', name: field }), { refs: [{ resourceId, attribute: 'id' }] }])
		),
	};
}

test('Phase 4 Azure hub-spoke and AKS topology: positive recognition on hubSpokeArchitecture and negative on unlinked lookalikes', () => {
	// Positive: official hub-spoke + AKS fixture
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	assert.equal(Object.isFrozen(snapshot.patterns), true);
	assert.equal(Object.isFrozen(snapshot.boundaries), true);

	const hubSpoke = snapshot.patterns.find(p => p.kind === 'azure-hub-spoke');
	assert.ok(hubSpoke, 'hubSpokeArchitecture detects Azure Hub-Spoke pattern');
	assert.equal(hubSpoke.roles[hubSpoke.primaryNodeId], 'hub');
	assert.ok(hubSpoke.memberNodeIds.length >= 3);

	const aksPattern = snapshot.patterns.find(p => p.kind === 'managed-kubernetes');
	assert.ok(aksPattern, 'hubSpokeArchitecture detects Managed Kubernetes (AKS) topology');
	assert.equal(aksPattern.title, 'Managed Kubernetes (AKS)');
	assert.match(aksPattern.caveat, /explicit Kubernetes adapter/i);

	// Negative: unpeered VNets named hub/spoke and standalone AKS with zero edges NEVER create patterns
	const negativeArch: Architecture = {
		name: 'LookalikeAzure',
		items: [],
		connections: [],
		resources: [
			makeResource('vnet_hub', 'azurerm_virtual_network', { label: 'hub-vnet', region: 'eastus' }),
			makeResource('vnet_spoke1', 'azurerm_virtual_network', { label: 'spoke-1', region: 'eastus' }),
			makeResource('vnet_spoke2', 'azurerm_virtual_network', { label: 'spoke-2', region: 'eastus' }),
			makeResource('aks_alone', 'azurerm_kubernetes_cluster', { label: 'aks-prod', region: 'eastus' }),
		],
	};
	const negSnapshot = projectTechnicalGraph(negativeArch);
	assert.equal(negSnapshot.patterns.length, 0, 'names and standalone clusters must never invent patterns');
});

test('Phase 4 AWS VPC network, EKS cluster, and Organizations landing-zone: positive & negative recognition', () => {
	// Positive: VPC + 2 subnets + IGW + route table, EKS + node group + IAM role, Organizations + 2 accounts
	const awsArch: Architecture = {
		name: 'AwsLandingZone',
		items: [],
		connections: [],
		resources: [
			makeResource('org', 'aws_organizations_organization', { region: 'us-east-1' }),
			makeResource('acct_sec', 'aws_organizations_account', { region: 'us-east-1' }),
			makeResource('acct_app', 'aws_organizations_account', { region: 'us-east-1' }),
			makeResource('vpc_main', 'aws_vpc', { region: 'us-east-1' }),
			makeResource('snet_a', 'aws_subnet', { region: 'us-east-1', refs: { vpc_id: 'vpc_main' } }),
			makeResource('snet_b', 'aws_subnet', { region: 'us-east-1', refs: { vpc_id: 'vpc_main' } }),
			makeResource('igw', 'aws_internet_gateway', { region: 'us-east-1', refs: { vpc_id: 'vpc_main' } }),
			makeResource('rtb', 'aws_route_table', { region: 'us-east-1', refs: { vpc_id: 'vpc_main' } }),
			makeResource('eks_role', 'aws_iam_role', { region: 'us-east-1' }),
			makeResource('eks', 'aws_eks_cluster', { region: 'us-east-1', refs: { role_arn: 'eks_role' } }),
			makeResource('eks_ng', 'aws_eks_node_group', { region: 'us-east-1', refs: { cluster_name: 'eks', node_role_arn: 'eks_role' } }),
		],
	};
	const awsSnap = projectTechnicalGraph(awsArch);

	const vpcPattern = awsSnap.patterns.find(p => p.kind === 'aws-vpc-network');
	assert.ok(vpcPattern);
	assert.equal(vpcPattern.roles.vpc_main, 'vpc');
	assert.equal(vpcPattern.roles.snet_a, 'subnet');
	assert.equal(vpcPattern.roles.igw, 'internet-gateway');
	assert.equal(vpcPattern.roles.rtb, 'routing');

	const lzPattern = awsSnap.patterns.find(p => p.kind === 'aws-landing-zone');
	assert.ok(lzPattern);
	assert.equal(lzPattern.roles.org, 'organization');
	assert.equal(lzPattern.roles.acct_sec, 'account');
	assert.equal(lzPattern.roles.acct_app, 'account');

	const eksPattern = awsSnap.patterns.find(p => p.kind === 'managed-kubernetes');
	assert.ok(eksPattern);
	assert.equal(eksPattern.title, 'Managed Kubernetes (EKS)');
	assert.equal(eksPattern.roles.eks_ng, 'node-group');
	assert.equal(eksPattern.roles.eks_role, 'identity');

	// Negative: VPCs named "landing-zone" + unlinked subnet NEVER trigger VPC or landing-zone patterns
	const fakeAws: Architecture = {
		name: 'FakeAws',
		items: [],
		connections: [],
		resources: [
			makeResource('vpc_lz', 'aws_vpc', { label: 'landing-zone-vpc', region: 'us-east-1' }),
			makeResource('snet_unlinked', 'aws_subnet', { label: 'security-account-subnet', region: 'us-east-1' }),
		],
	};
	assert.equal(projectTechnicalGraph(fakeAws).patterns.length, 0);
});

test('Phase 4 GCP regional vs global HTTP LB chains stay strictly separate', () => {
	// Positive: complete regional chain + complete global chain
	const gcpArch: Architecture = {
		name: 'GcpLbChains',
		items: [],
		connections: [],
		resources: [
			makeResource('r_be', 'google_compute_region_backend_service', { region: 'us-central1' }),
			makeResource('r_url', 'google_compute_region_url_map', { region: 'us-central1', refs: { default_service: 'r_be' } }),
			makeResource('r_proxy', 'google_compute_region_target_http_proxy', { region: 'us-central1', refs: { url_map: 'r_url' } }),
			makeResource('r_fr', 'google_compute_forwarding_rule', { region: 'us-central1', refs: { target: 'r_proxy' } }),
			makeResource('g_be', 'google_compute_backend_service', { region: 'global' }),
			makeResource('g_url', 'google_compute_url_map', { region: 'global', refs: { default_service: 'g_be' } }),
			makeResource('g_proxy', 'google_compute_target_http_proxy', { region: 'global', refs: { url_map: 'g_url' } }),
			makeResource('g_fr', 'google_compute_global_forwarding_rule', { region: 'global', refs: { target: 'g_proxy' } }),
		],
	};
	const gcpSnap = projectTechnicalGraph(gcpArch);
	const lbPatterns = gcpSnap.patterns.filter(p => p.kind === 'gcp-load-balancer-chain');
	assert.equal(lbPatterns.length, 2);
	const regional = lbPatterns.find(p => p.title.includes('Regional'))!;
	const global = lbPatterns.find(p => p.title.includes('Global'))!;
	assert.deepEqual(regional.memberNodeIds, ['r_fr', 'r_proxy', 'r_url', 'r_be']);
	assert.deepEqual(global.memberNodeIds, ['g_fr', 'g_proxy', 'g_url', 'g_be']);

	// Negative: regional forwarding rule pointing at global proxy must NOT match a regional chain
	const mixedScopeArch: Architecture = {
		name: 'MixedGcpScope',
		items: [],
		connections: [],
		resources: [
			makeResource('g_proxy', 'google_compute_target_http_proxy', { region: 'global' }),
			makeResource('r_fr', 'google_compute_forwarding_rule', { region: 'us-central1', refs: { target: 'g_proxy' } }),
		],
	};
	assert.equal(projectTechnicalGraph(mixedScopeArch).patterns.length, 0);
});

test('Phase 4/5 boundary honesty (multi-region, mixed-provider, module, K8s adapter), deterministic findings, and shortest path', () => {
	// Unknown regions never fake multi-region; mixed providers, modules, and K8s manifest nodes are reported honestly.
	const mixedArch: Architecture = {
		name: 'Boundaries',
		items: [],
		connections: [],
		resources: [
			makeResource('rg_east', 'azurerm_resource_group', { region: 'eastus' }),
			makeResource('vnet_east', 'azurerm_virtual_network', { region: 'eastus', refs: { resource_group_name: 'rg_east' } }),
			makeResource('snet_east', 'azurerm_subnet', { region: 'eastus', refs: { virtual_network_name: 'vnet_east' } }),
			makeResource('vm_orphan', 'azurerm_linux_virtual_machine', { region: '' }), // unknown region, missing parent & NIC
			makeResource('aws_vpc_west', 'aws_vpc', { region: 'us-west-2' }),
			makeResource('mod_net', 'module', { kind: 'module', region: '', settings: { source: './modules/net' } }),
			makeResource('k8s_svc', 'kubernetes_service_v1', { region: '' }),
		],
	};
	const snap = projectTechnicalGraph(mixedArch);
	assert.equal(snap.boundaries.mixedProviders, true);
	assert.deepEqual(snap.boundaries.providers, ['aws', 'azure']);
	assert.equal(snap.boundaries.multiRegion, true);
	assert.deepEqual(snap.boundaries.knownRegions, ['eastus', 'us-west-2']);
	assert.equal(snap.boundaries.unknownRegionCount, 3);
	assert.deepEqual(snap.boundaries.moduleCallIds, ['mod_net']);
	assert.equal(snap.boundaries.kubernetesAdapterStatus, 'manifest-adapter-required');
	assert.deepEqual(snap.boundaries.kubernetesManifestNodeIds, ['k8s_svc']);

	// Single known region + unknown regions is NOT multi-region
	const singleKnownRegion = projectTechnicalGraph({
		name: 'SingleRegion',
		items: [],
		connections: [],
		resources: [
			makeResource('rg1', 'azurerm_resource_group', { region: 'eastus' }),
			makeResource('rg2', 'azurerm_resource_group', { region: '' }),
		],
	});
	assert.equal(singleKnownRegion.boundaries.multiRegion, false);
	assert.equal(singleKnownRegion.boundaries.unknownRegionCount, 1);

	// Phase 5 deterministic findings and shortest path
	const findings = snapshotTroubleshootingFindings(snap);
	assert.ok(findings.some(f => f.kind === 'missing-expected-parent' && f.nodeIds.includes('vm_orphan')));
	assert.ok(findings.some(f => f.kind === 'missing-expected-attachment' && f.nodeIds.includes('vm_orphan')));
	assert.ok(findings.some(f => f.kind === 'kubernetes-adapter-required' && f.nodeIds.includes('k8s_svc')));

	const path = shortestSnapshotPath(snap.edges, 'rg_east', 'snet_east');
	assert.ok(path);
	assert.deepEqual(path.nodeIds, ['rg_east', 'vnet_east', 'snet_east']);
	assert.equal(path.length, 2);
	assert.equal(path.hops[0].primaryField, 'resource_group_name');
	assert.equal(path.hops[1].primaryField, 'virtual_network_name');
});
