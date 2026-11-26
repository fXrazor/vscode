/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchCanvasAction } from './canvasMutationPolicy.ts';
import { bindingKey } from './fieldBindings.ts';
import { sampleArchitecture } from './fixture.ts';
import { createHistory, historyReducer, type Architecture, type Resource } from './model.ts';
import { terraformCode } from './terraformProjection.ts';
import {
	clearGraphNodePins,
	createTechnicalGraphPresentationState,
	detectOrderingCycles,
	projectTechnicalGraph,
	pruneGraphPresentationState,
	setGraphDensity,
	setGraphHiddenCategories,
	setGraphNodePin,
	setGraphRouteStyle,
	setGraphSelection,
	toggleGraphCollapsedGroup
} from './technicalGraphContract.ts';
import type { FileResourceValues } from './resourceValues.ts';
import type { HostDependencyReport, HostEnginePlanReport, HostEngineValidateReport, HostGraphSnapshot } from './webviewBridge.ts';

function freezeDeep<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	Object.freeze(value);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		freezeDeep((value as Record<string, unknown>)[key]);
	}
	return value;
}

function makeResource(id: string, type: string, refs: Record<string, string> = {}): Resource {
	const base = sampleArchitecture().resources.find(item => item.id === 'vm')!;
	return {
		...base,
		id,
		name: id,
		terraformName: id,
		parentId: undefined,
		visualParentId: undefined,
		kind: 'generic',
		catalogue: { type, label: id, service: id, category: 'Other', icon: 'azure-compute.svg', fields: [] },
		settings: Object.fromEntries(Object.keys(refs).map(field => [field, ''])),
		blocks: [],
		resourceRefs: Object.fromEntries(
			Object.entries(refs).map(([field, resourceId]) => [bindingKey({ kind: 'setting', name: field }), { refs: [{ resourceId, attribute: 'id' }] }])
		),
	};
}

test('Phase 1 invariant: projectTechnicalGraph and presentation actions never mutate Architecture, History, or Terraform', () => {
	const history = createHistory(sampleArchitecture());
	const beforeJson = JSON.stringify(history.present);
	const beforeHcl = terraformCode(history.present);
	const frozenArch = freezeDeep(structuredClone(history.present));

	const projection = projectTechnicalGraph({ architecture: frozenArch });
	assert.equal(Object.isFrozen(projection), true);
	assert.equal(Object.isFrozen(projection.nodes), true);
	assert.equal(Object.isFrozen(projection.edges), true);

	// Graph presentation updates live in a separate immutable store
	let pres = createTechnicalGraphPresentationState();
	pres = setGraphNodePin(pres, 'vm', { x: 920.4, y: 410.6 });
	pres = setGraphRouteStyle(pres, 'orthogonal');
	pres = setGraphDensity(pres, 'compact');
	pres = toggleGraphCollapsedGroup(pres, 'network');
	pres = setGraphHiddenCategories(pres, ['observability']);
	pres = setGraphSelection(pres, 'vm', 'nic');

	assert.deepEqual(pres.pins.vm, { x: 920, y: 411 });
	assert.equal(pres.routeStyle, 'orthogonal');
	assert.equal(pres.density, 'compact');
	assert.deepEqual(pres.collapsedGroupIds, ['network']);

	// Technical canvas dispatch guard still blocks all project mutations
	let dispatched = 0;
	dispatchCanvasAction('technical', () => { dispatched++; }, { type: 'move', id: 'vm', mode: 'visual', position: { x: 0, y: 0 } });
	assert.equal(dispatched, 0);

	// Canonical model and Terraform are byte-identical
	assert.equal(JSON.stringify(frozenArch), beforeJson);
	assert.equal(terraformCode(history.present), beforeHcl);
	assert.equal(history.past.length, 0);
});

test('Phase 1 edges distinguish structural ownership from visual grouping and emit bounded stable attachment ports', () => {
	let history = createHistory(sampleArchitecture());
	// Bind NIC -> VM explicitly, and move VM visually to VNet (visual grouping != ownership)
	history = historyReducer(history, { type: 'bindResourceRef', id: 'vm', target: { kind: 'setting', name: 'network_interface_ids' }, refs: [{ resourceId: 'nic', attribute: 'id' }] });
	history = historyReducer(history, { type: 'placeResource', id: 'vm', visualParentId: 'network', mode: 'visual', positions: { vm: { x: 400, y: 240 } } });

	const projection = projectTechnicalGraph({
		architecture: history.present,
		maxAttachmentPortsPerNode: 1,
	});

	const vmNode = projection.nodes.find(n => n.id === 'vm')!;
	assert.equal(vmNode.structuralParentId, 'resource-group');
	assert.equal(vmNode.visualGroupId, 'network');
	assert.equal(vmNode.attachmentPorts.length, 1);
	assert.ok(vmNode.attachmentOverflowCount >= 1, 'overflow count reports truncated attachment rows honestly');

	const attachmentEdge = projection.edges.find(e => e.sourceId === 'nic' && e.targetId === 'vm' && e.category === 'attachment')!;
	assert.ok(attachmentEdge);
	assert.equal(attachmentEdge.confidence, 'reviewed-rule');
	assert.equal(attachmentEdge.ordering, true);
	assert.equal(attachmentEdge.targetPortId, 'vm:in:network_interface_ids:nic');
	assert.equal(attachmentEdge.provenance[0].origin, 'binding');
	assert.ok(attachmentEdge.provenance[0].sourceKey);

	// Drawings/notes are never projected as infrastructure nodes
	assert.ok(projection.nodes.every(n => history.present.resources.some(r => r.id === n.id)));
});

test('Phase 1 extracts explicit FileResourceValues expressions and flags opaque expressions, redacted secrets, and unreviewed types honestly', () => {
	const rev = 'a'.repeat(64);
	const architecture: Architecture = {
		name: 'SourceExpr',
		items: [],
		connections: [],
		resources: [
			makeResource('rg', 'azurerm_resource_group'),
			makeResource('snet', 'azurerm_subnet'),
			makeResource('nic', 'azurerm_network_interface'),
			makeResource('vm', 'azurerm_linux_virtual_machine'),
			makeResource('mystery', 'azurerm_custom_unreviewed_thing'),
		],
	};
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'SourceExpr',
		sourceRevision: rev,
		status: 'partial',
		nodes: architecture.resources.map(r => ({
			id: r.id,
			kind: 'resource',
			resourceType: r.catalogue!.type,
			name: r.id,
			label: r.id,
			hasSource: true,
			sourceFile: 'main.tf',
			sourceLine: 10,
		})),
		edges: [],
		diagnostics: [],
	};
	const fileValues: FileResourceValues[] = [
		{
			address: 'azurerm_network_interface.nic',
			file: 'main.tf',
			attributes: {
				resource_group_name: { kind: 'expression', text: 'azurerm_resource_group.rg.name' },
			},
			blocks: [
				{
					name: 'ip_configuration',
					attributes: {
						subnet_id: { kind: 'expression', text: 'azurerm_subnet.snet.id' },
					},
					blocks: [],
				},
			],
		},
		{
			address: 'azurerm_linux_virtual_machine.vm',
			file: 'main.tf',
			attributes: {
				network_interface_ids: { kind: 'expression', text: '[azurerm_network_interface.nic.id]' },
				admin_password: { kind: 'redacted' },
				custom_data: { kind: 'expression', text: 'try(local.cloud_init, null)' },
			},
			blocks: [],
		},
	];

	const projection = projectTechnicalGraph({
		architecture,
		snapshot,
		resourceValues: fileValues,
	});

	assert.equal(projection.graphStatus, 'partial');
	assert.equal(projection.capabilities.fileValuesHydratedNodes, 2);

	// NIC -> Subnet extracted from nested block expression and classified via reviewed rule
	const nicSubnet = projection.edges.find(e => e.sourceId === 'snet' && e.targetId === 'nic');
	assert.equal(nicSubnet?.category, 'attachment');
	assert.equal(nicSubnet?.confidence, 'reviewed-rule');
	assert.equal(nicSubnet?.provenance[0].origin, 'source-expression');
	assert.equal(nicSubnet?.provenance[0].field, 'ip_configuration.subnet_id');

	// VM -> NIC extracted from list expression
	const vmNic = projection.edges.find(e => e.sourceId === 'nic' && e.targetId === 'vm');
	assert.equal(vmNic?.category, 'attachment');
	assert.equal(vmNic?.provenance[0].origin, 'source-expression');

	// Redacted secret and opaque expression recorded as explicit unknowns on VM
	const vmNode = projection.nodes.find(n => n.id === 'vm')!;
	assert.ok(vmNode.unknowns.some(u => u.kind === 'redacted-value' && u.field === 'admin_password'));
	assert.ok(vmNode.unknowns.some(u => u.kind === 'opaque-expression' && u.field === 'custom_data'));
	assert.ok(vmNode.unknowns.some(u => u.kind === 'partial-source-graph'));

	// Unreviewed resource type emits explicit unreviewed-type unknown
	const mysteryNode = projection.nodes.find(n => n.id === 'mystery')!;
	assert.equal(mysteryNode.reviewStatus, 'unreviewed');
	assert.ok(mysteryNode.unknowns.some(u => u.kind === 'unreviewed-type'));
});

test('Phase 1 binds live schema versions, lock state, and current vs stale plan/validate overlays by sourceRevision', () => {
	const currentRev = '1'.repeat(64);
	const staleRev = '2'.repeat(64);
	const architecture: Architecture = {
		name: 'Versioned',
		items: [],
		connections: [],
		resources: [
			makeResource('rg', 'azurerm_resource_group'),
			makeResource('vnet', 'azurerm_virtual_network'),
		],
	};
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Versioned',
		sourceRevision: currentRev,
		status: 'complete',
		nodes: architecture.resources.map(r => ({
			id: r.id,
			kind: 'resource',
			resourceType: r.catalogue!.type,
			name: r.id,
			label: r.id,
			hasSource: true,
			sourceFile: 'main.tf',
			sourceLine: 1,
		})),
		edges: [],
		diagnostics: [],
	};
	const dependencyReport: HostDependencyReport = {
		sourceRevision: currentRev,
		engine: 'opentofu',
		engineInferred: false,
		lockState: 'valid',
		providers: [
			{ display: 'registry.terraform.io/hashicorp/azurerm', status: 'locked', lockedVersion: '4.12.0', conflictCount: 0, requirementCount: 1 },
		],
		unusedLockEntries: [],
		diagnosticCount: 0,
	};
	const planReport: HostEnginePlanReport = {
		sourceRevision: currentRev,
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: false,
		status: 'planned',
		errored: false,
		durationMs: 120,
		summary: { create: 0, update: 0, replace: 1, delete: 0, read: 0, noOp: 1, total: 2 },
		resourceChanges: [
			{
				address: 'azurerm_virtual_network.vnet',
				mode: 'managed',
				typeName: 'azurerm_virtual_network',
				name: 'vnet',
				actions: ['delete', 'create'],
				actionKind: 'replace',
				hasSensitiveAttributes: true,
				changedAttributePaths: ['address_space'],
			},
		],
		outputChanges: [],
		diagnostics: [],
		truncated: false,
	};
	const validateReport: HostEngineValidateReport = {
		sourceRevision: currentRev,
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: false,
		valid: false,
		errorCount: 1,
		warningCount: 0,
		durationMs: 45,
		diagnostics: [{ severity: 'error', summary: 'Invalid CIDR', address: 'azurerm_virtual_network.vnet' }],
		truncated: false,
	};

	const currentProj = projectTechnicalGraph({
		architecture,
		snapshot,
		dependencyReport,
		planReport,
		validateReport,
		liveSchemas: {
			azurerm_resource_group: {
				kind: 'resource',
				typeName: 'azurerm_resource_group',
				providerSource: 'hashicorp/azurerm',
				providerVersion: '4.12.0',
				description: 'RG',
				docsUrl: '',
				exampleHcl: '',
				attributes: [],
				blocks: [],
				outputs: [],
				coverage: { complete: true, paths: 3, readOnly: 1, gaps: [] },
			},
		},
	});

	assert.equal(currentProj.nodes.find(n => n.id === 'rg')!.schemaVersion.status, 'live-matched');
	assert.equal(currentProj.nodes.find(n => n.id === 'rg')!.schemaVersion.coverageComplete, true);
	assert.equal(currentProj.nodes.find(n => n.id === 'vnet')!.schemaVersion.status, 'locked-only');
	assert.equal(currentProj.nodes.find(n => n.id === 'vnet')!.planOverlay?.status, 'current');
	assert.equal(currentProj.nodes.find(n => n.id === 'vnet')!.planOverlay?.actionKind, 'replace');
	assert.equal(currentProj.nodes.find(n => n.id === 'vnet')!.diagnosticCounts.errors, 1);
	assert.equal(currentProj.capabilities.planStatus, 'current');
	assert.equal(currentProj.capabilities.liveSchemaNodes, 1);

	// Stale plan report is explicitly marked stale rather than treated as current
	const staleProj = projectTechnicalGraph({
		architecture,
		snapshot,
		planReport: { ...planReport, sourceRevision: staleRev },
	});
	assert.equal(staleProj.capabilities.planStatus, 'stale');
	assert.equal(staleProj.nodes.find(n => n.id === 'vnet')!.planOverlay?.status, 'stale');
	assert.ok(staleProj.nodes.find(n => n.id === 'vnet')!.unknowns.some(u => u.kind === 'stale-plan'));
});

test('Phase 1 detects ordering cycles via Tarjan SCC and prunes vanished presentation pins cleanly', () => {
	const cycles = detectOrderingCycles(
		['a', 'b', 'c', 'd'],
		[
			{ sourceId: 'a', targetId: 'b', ordering: true },
			{ sourceId: 'b', targetId: 'c', ordering: true },
			{ sourceId: 'c', targetId: 'a', ordering: true },
			{ sourceId: 'c', targetId: 'd', ordering: true },
			{ sourceId: 'd', targetId: 'a', ordering: false }, // non-ordering edge does not widen ordering SCC
		]
	);
	assert.deepEqual(cycles, [['a', 'b', 'c']]);

	let pres = createTechnicalGraphPresentationState();
	pres = setGraphNodePin(pres, 'a', { x: 10, y: 20 });
	pres = setGraphNodePin(pres, 'gone', { x: 30, y: 40 });
	pres = toggleGraphCollapsedGroup(pres, 'gone');
	pres = setGraphSelection(pres, 'gone', 'a');

	const pruned = pruneGraphPresentationState(pres, new Set(['a', 'b']));
	assert.deepEqual(pruned.pins, { a: { x: 10, y: 20 } });
	assert.deepEqual(pruned.collapsedGroupIds, []);
	assert.equal(pruned.selectedNodeId, null);
	assert.equal(pruned.tracedNodeId, 'a');

	const cleared = clearGraphNodePins(pruned, ['a']);
	assert.deepEqual(cleared.pins, {});
});

test('Phase 1 enforces multi-provider evidence, distinct multi-NIC ports, Kubernetes manifest warnings, and positive/negative hub-spoke patterns', () => {
	// Negative check: compatible AWS/GCP/Azure types with NO bindings/expressions never invent edges or hub-spoke patterns.
	const unreferencedArch: Architecture = {
		name: 'NoInference',
		items: [],
		connections: [],
		resources: [
			makeResource('aws_snet', 'aws_subnet'),
			makeResource('aws_ec2', 'aws_instance'),
			makeResource('gcp_proxy', 'google_compute_region_target_http_proxy'),
			makeResource('gcp_fr', 'google_compute_forwarding_rule'),
			makeResource('hub', 'azurerm_virtual_network'),
			makeResource('spoke_a', 'azurerm_virtual_network'),
			makeResource('spoke_b', 'azurerm_virtual_network'),
			makeResource('k8s_svc', 'kubernetes_service_v1'),
		],
	};
	const unreferencedProj = projectTechnicalGraph({ architecture: unreferencedArch });
	assert.equal(unreferencedProj.edges.length, 0, 'compatible types and hub/spoke names must never invent edges');
	assert.equal(unreferencedProj.patterns.length, 0, 'unpeered VNets named hub/spoke must never trigger a hub-spoke pattern');
	const k8sNode = unreferencedProj.nodes.find(n => n.id === 'k8s_svc')!;
	assert.ok(k8sNode.unknowns.some(u => u.kind === 'kubernetes-manifest-unmapped'));

	// Positive check: explicit multi-provider bindings, multi-NIC stable port IDs, and source-expression hub-spoke peering.
	const multiArch: Architecture = {
		name: 'MultiProviderEvidenced',
		items: [],
		connections: [],
		resources: [
			makeResource('aws_snet', 'aws_subnet'),
			makeResource('aws_ec2', 'aws_instance', { subnet_id: 'aws_snet' }),
			makeResource('gcp_proxy', 'google_compute_region_target_http_proxy'),
			makeResource('gcp_fr', 'google_compute_forwarding_rule', { target: 'gcp_proxy' }),
			makeResource('nic_a', 'azurerm_network_interface'),
			makeResource('nic_b', 'azurerm_network_interface'),
			{
				...makeResource('vm', 'azurerm_linux_virtual_machine'),
				settings: { network_interface_ids: '' },
				resourceRefs: {
					[bindingKey({ kind: 'setting', name: 'network_interface_ids' })]: {
						refs: [
							{ resourceId: 'nic_a', attribute: 'id' },
							{ resourceId: 'nic_b', attribute: 'id' },
						],
					},
				},
			},
			makeResource('hub', 'azurerm_virtual_network'),
			makeResource('spoke_a', 'azurerm_virtual_network'),
			makeResource('spoke_b', 'azurerm_virtual_network'),
			makeResource('peer_a', 'azurerm_virtual_network_peering'),
			makeResource('peer_b', 'azurerm_virtual_network_peering'),
		],
	};
	const peeringValues: FileResourceValues[] = [
		{
			address: 'azurerm_virtual_network_peering.peer_a',
			file: 'peering.tf',
			attributes: {
				virtual_network_name: { kind: 'expression', text: 'azurerm_virtual_network.hub.name' },
				remote_virtual_network_id: { kind: 'expression', text: 'azurerm_virtual_network.spoke_a.id' },
			},
			blocks: [],
		},
		{
			address: 'azurerm_virtual_network_peering.peer_b',
			file: 'peering.tf',
			attributes: {
				virtual_network_name: { kind: 'expression', text: 'azurerm_virtual_network.hub.name' },
				remote_virtual_network_id: { kind: 'expression', text: 'azurerm_virtual_network.spoke_b.id' },
			},
			blocks: [],
		},
	];
	const multiProj = projectTechnicalGraph({ architecture: multiArch, resourceValues: peeringValues });

	const awsEdge = multiProj.edges.find(e => e.sourceId === 'aws_snet' && e.targetId === 'aws_ec2');
	assert.equal(awsEdge?.confidence, 'reviewed-rule');
	const gcpEdge = multiProj.edges.find(e => e.sourceId === 'gcp_proxy' && e.targetId === 'gcp_fr');
	assert.equal(gcpEdge?.confidence, 'reviewed-rule');

	// Two NIC attachments on the same list field produce distinct, peer-keyed stable port IDs.
	const vmNode = multiProj.nodes.find(n => n.id === 'vm')!;
	const nicPortIds = vmNode.attachmentPorts.filter(p => p.field === 'network_interface_ids').map(p => p.portId);
	assert.deepEqual(nicPortIds, ['vm:in:network_interface_ids:nic_a', 'vm:in:network_interface_ids:nic_b']);

	// Explicit peering expressions produce one hub-spoke pattern with hub + 2 spokes.
	assert.equal(multiProj.patterns.length, 1);
	assert.equal(multiProj.patterns[0].kind, 'hub-spoke');
	assert.equal(multiProj.patterns[0].hubId, 'hub');
	assert.deepEqual([...multiProj.patterns[0].spokeIds].sort(), ['spoke_a', 'spoke_b']);
});
