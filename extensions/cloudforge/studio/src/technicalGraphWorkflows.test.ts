/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingKey } from './fieldBindings.ts';
import { sampleArchitecture } from './fixture.ts';
import { createHistory, historyReducer, type Architecture, type Resource } from './model.ts';
import {
	createTechnicalGraphPresentationState,
	projectTechnicalGraph,
	pruneGraphPresentationState,
	setGraphLens,
	toggleGraphExpandedNode
} from './technicalGraphContract.ts';
import {
	aggregateHighDegreeEdges,
	collectGraphTroubleshootingFindings,
	filterTechnicalGraphByLens,
	inspectTechnicalGraphNode,
	TECHNICAL_GRAPH_LENSES,
	traceNodeNeighborhood,
	tracePathsBetweenNodes
} from './technicalGraphWorkflows.ts';
import type { FileResourceValues } from './resourceValues.ts';
import type { HostEnginePlanReport, HostEngineValidateReport, HostGraphSnapshot } from './webviewBridge.ts';

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

test('Phase 2 focused lenses filter categories honestly and preserve explicit arrow semantics', () => {
	let history = createHistory(sampleArchitecture());
	history = historyReducer(history, {
		type: 'bindResourceRef',
		id: 'vm',
		target: { kind: 'setting', name: 'network_interface_ids' },
		refs: [{ resourceId: 'nic', attribute: 'id' }],
	});
	const projection = projectTechnicalGraph({ architecture: history.present });

	const depLens = filterTechnicalGraphByLens(projection, 'dependencies');
	assert.equal(depLens.lens.arrowSemantics, 'prerequisite-to-consumer');
	assert.ok(depLens.visibleEdges.length > 0);
	assert.ok(depLens.visibleEdges.every(edge => edge.ordering === true));

	const topoLens = filterTechnicalGraphByLens(projection, 'topology');
	assert.equal(topoLens.lens.arrowSemantics, 'owner-or-attachment');
	assert.ok(topoLens.visibleEdges.every(edge => edge.category === 'ownership' || edge.category === 'attachment'));
	assert.ok(topoLens.visibleEdges.some(edge => edge.sourceId === 'nic' && edge.targetId === 'vm'));

	const obsLens = filterTechnicalGraphByLens(projection, 'observability');
	assert.equal(obsLens.lens.arrowSemantics, 'telemetry-collection-to-destination');
	assert.equal(obsLens.visibleEdges.length, 0);
	assert.equal(obsLens.isolatedNodeIds.length, projection.nodes.length);

	assert.match(TECHNICAL_GRAPH_LENSES.runtime.boundaryNote, /not observed|runtime observation/i);
	assert.match(TECHNICAL_GRAPH_LENSES.dependencies.boundaryNote, /not represent live network packet flow/i);

	// Presentation state tracks lens & expandedNodeIds and prunes vanished IDs cleanly
	let pres = createTechnicalGraphPresentationState();
	pres = setGraphLens(pres, 'topology');
	pres = toggleGraphExpandedNode(pres, 'vm');
	pres = toggleGraphExpandedNode(pres, 'vanished');
	assert.equal(pres.lens, 'topology');
	assert.deepEqual(pres.expandedNodeIds, ['vm', 'vanished']);
	const pruned = pruneGraphPresentationState(pres, new Set(['vm']));
	assert.deepEqual(pruned.expandedNodeIds, ['vm']);
});

test('Phase 2 traces upstream/downstream neighborhoods and shortest multi-hop paths with provenance', () => {
	const architecture: Architecture = {
		name: 'Chain',
		items: [],
		connections: [],
		resources: [
			makeResource('rg', 'azurerm_resource_group'),
			makeResource('vnet', 'azurerm_virtual_network', { resource_group_name: 'rg' }),
			makeResource('snet', 'azurerm_subnet', { virtual_network_name: 'vnet' }),
			makeResource('nic', 'azurerm_network_interface'),
			makeResource('vm', 'azurerm_linux_virtual_machine', { network_interface_ids: 'nic' }),
			makeResource('orphan', 'azurerm_storage_account'),
		],
	};
	const fileValues: FileResourceValues[] = [
		{
			address: 'azurerm_network_interface.nic',
			file: 'network.tf',
			attributes: {},
			blocks: [{ name: 'ip_configuration', attributes: { subnet_id: { kind: 'expression', text: 'azurerm_subnet.snet.id' } }, blocks: [] }],
		},
	];
	const projection = projectTechnicalGraph({ architecture, resourceValues: fileValues });

	// Neighborhood centered on snet: upstream = vnet (1), rg (2); downstream = nic (1), vm (2); orphan dimmed
	const trace = traceNodeNeighborhood(projection, 'snet', { lens: 'dependencies' });
	assert.deepEqual(trace.upstreamDirect, ['vnet']);
	assert.deepEqual(trace.upstreamTransitive, ['rg']);
	assert.deepEqual(trace.downstreamDirect, ['nic']);
	assert.deepEqual(trace.downstreamTransitive, ['vm']);
	assert.equal(trace.roleByNodeId.snet, 'selected');
	assert.equal(trace.roleByNodeId.rg, 'upstream');
	assert.equal(trace.roleByNodeId.vm, 'downstream');
	assert.equal(trace.roleByNodeId.orphan, 'dimmed');
	assert.ok(trace.dimmedNodeIds.includes('orphan'));

	// Multi-hop path finder explains why vm depends on rg
	const pathResult = tracePathsBetweenNodes(projection, 'rg', 'vm', { lens: 'dependencies' });
	assert.equal(pathResult.paths.length, 1);
	assert.deepEqual(pathResult.paths[0].nodeIds, ['rg', 'vnet', 'snet', 'nic', 'vm']);
	assert.equal(pathResult.paths[0].length, 4);
	assert.equal(pathResult.paths[0].allOrdering, true);
	assert.equal(pathResult.paths[0].hops[2].primaryField, 'ip_configuration.subnet_id');
	assert.equal(pathResult.paths[0].hops[3].primaryField, 'network_interface_ids');
});

test('Phase 2 node inspection surfaces troubleshooting findings, cycles, stale plan overlays, and honest source links', () => {
	const rev = 'a'.repeat(64);
	const staleRev = 'b'.repeat(64);
	const architecture: Architecture = {
		name: 'Troubleshoot',
		items: [],
		connections: [],
		resources: [
			makeResource('vm_detached', 'azurerm_linux_virtual_machine'), // missing structural parent & missing NIC attachment
			makeResource('cyc_a', 'azurerm_subnet', { virtual_network_name: 'cyc_b' }),
			makeResource('cyc_b', 'azurerm_subnet', { virtual_network_name: 'cyc_a' }),
		],
	};
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Troubleshoot',
		sourceRevision: rev,
		status: 'complete',
		nodes: [
			{ id: 'vm_detached', kind: 'resource', resourceType: 'azurerm_linux_virtual_machine', name: 'vm_detached', label: 'vm_detached', hasSource: true, sourceFile: 'compute.tf', sourceLine: 18 },
			{ id: 'cyc_a', kind: 'resource', resourceType: 'azurerm_subnet', name: 'cyc_a', label: 'cyc_a', hasSource: true, sourceFile: 'net.tf', sourceLine: 4 },
			{ id: 'cyc_b', kind: 'resource', resourceType: 'azurerm_subnet', name: 'cyc_b', label: 'cyc_b', hasSource: false },
		],
		edges: [],
		diagnostics: [],
	};
	const stalePlan: HostEnginePlanReport = {
		sourceRevision: staleRev,
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: false,
		status: 'planned',
		errored: false,
		durationMs: 80,
		summary: { create: 0, update: 1, replace: 0, delete: 0, read: 0, noOp: 0, total: 1 },
		resourceChanges: [{
			address: 'azurerm_linux_virtual_machine.vm_detached',
			mode: 'managed',
			typeName: 'azurerm_linux_virtual_machine',
			name: 'vm_detached',
			actions: ['update'],
			actionKind: 'update',
			hasSensitiveAttributes: false,
			changedAttributePaths: ['size'],
		}],
		outputChanges: [],
		diagnostics: [],
		truncated: false,
	};
	const validateReport: HostEngineValidateReport = {
		sourceRevision: rev,
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: false,
		valid: false,
		errorCount: 1,
		warningCount: 0,
		durationMs: 25,
		diagnostics: [{ severity: 'error', summary: 'Missing required argument network_interface_ids', address: 'azurerm_linux_virtual_machine.vm_detached' }],
		truncated: false,
	};

	const projection = projectTechnicalGraph({ architecture, snapshot, planReport: stalePlan, validateReport });
	const findings = collectGraphTroubleshootingFindings(projection);

	// Ordering cycle is surfaced as top-severity error
	assert.ok(findings.some(f => f.kind === 'ordering-cycle' && f.severity === 'error' && f.nodeIds.includes('cyc_a')));
	// Detached VM flags CLI error, stale plan overlay, missing parent, and missing attachment honestly
	const vmInspection = inspectTechnicalGraphNode(projection, 'vm_detached')!;
	assert.equal(vmInspection.sourceNavigation.available, true);
	if (vmInspection.sourceNavigation.available) {
		assert.equal(vmInspection.sourceNavigation.file, 'compute.tf');
		assert.equal(vmInspection.sourceNavigation.line, 18);
	}
	assert.ok(vmInspection.findings.some(f => f.kind === 'validation-error'));
	assert.ok(vmInspection.findings.some(f => f.kind === 'stale-overlay'));
	assert.ok(vmInspection.findings.some(f => f.kind === 'missing-expected-parent'));
	assert.ok(vmInspection.findings.some(f => f.kind === 'missing-expected-attachment'));
	assert.match(vmInspection.impact.boundaryDisclaimer, /do not predict|Run a current Terraform\/OpenTofu plan/i);

	// Node without source file reports unavailable honestly (never fabricates main.tf)
	const cycBInspection = inspectTechnicalGraphNode(projection, 'cyc_b')!;
	assert.equal(cycBInspection.sourceNavigation.available, false);
	assert.equal(cycBInspection.cycles.length, 1);
	assert.equal(cycBInspection.neighborhood.roleByNodeId.cyc_a, 'cycle');
});

test('Phase 2 aggregates high-degree fans by category without merging distinct categories or hiding focused node links', () => {
	const resources: Resource[] = [makeResource('vm', 'azurerm_linux_virtual_machine')];
	const nicRefs: { resourceId: string; attribute: string }[] = [];
	for (let i = 1; i <= 12; i++) {
		const id = `nic_${i}`;
		resources.push(makeResource(id, 'azurerm_network_interface'));
		nicRefs.push({ resourceId: id, attribute: 'id' });
	}
	resources[0] = {
		...resources[0],
		settings: { network_interface_ids: '' },
		resourceRefs: { [bindingKey({ kind: 'setting', name: 'network_interface_ids' })]: { refs: nicRefs } },
	};
	const rg = makeResource('rg', 'azurerm_resource_group');
	resources.push(rg);
	resources[0].settings.resource_group_name = '';
	resources[0].resourceRefs![bindingKey({ kind: 'setting', name: 'resource_group_name' })] = { refs: [{ resourceId: 'rg', attribute: 'name' }] };

	const projection = projectTechnicalGraph({ architecture: { name: 'Dense', items: [], connections: [], resources } });

	// Default collapsed: 12 incoming attachment edges collapse into one inspectable bundle, while 1 ownership edge stays individual
	const collapsed = aggregateHighDegreeEdges(projection.edges, { threshold: 6 });
	assert.equal(collapsed.bundles.length, 1);
	assert.equal(collapsed.bundles[0].hubNodeId, 'vm');
	assert.equal(collapsed.bundles[0].category, 'attachment');
	assert.equal(collapsed.bundles[0].count, 12);
	assert.equal(collapsed.bundles[0].label, '+12 attachments');
	assert.equal(collapsed.bundles[0].memberEdgeIds.length, 12);
	assert.equal(collapsed.individualEdges.length, 1);
	assert.equal(collapsed.individualEdges[0].category, 'ownership');

	// Selecting/focusing vm expands all 12 attachment edges for inspection
	const focused = aggregateHighDegreeEdges(projection.edges, { threshold: 6, focusedNodeId: 'vm' });
	assert.equal(focused.bundles.length, 0);
	assert.equal(focused.individualEdges.length, 13);
});
