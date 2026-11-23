/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyDraftEdit,
	createDraftDocument,
	generateTerraformPreview,
	undoDraftEdit
} from '../src/canvas/draftDocument.ts';
import {
	appendCheckpoint,
	captureCheckpoint,
	checkpointToDraftState,
	compareSemanticSnapshots,
	isSampleContextStale,
	startExperimentSession
} from '../src/canvas/history.ts';
import {
	buildCanvasProjection,
	computeLodLevel
} from '../src/canvas/layout.ts';
import {
	buildExtractModulePreview,
	inspectModuleBoundary,
	instantiateStarterPattern,
	STARTER_PATTERNS
} from '../src/canvas/patterns.ts';
import {
	sanitizeViewState,
	type CanvasGraphSnapshot,
	type CanvasNodeSummary
} from '../src/canvas/protocol.ts';
import { lookupBundledSchema, renderDraftPreview } from '../src/canvas/schemaForm.ts';

function sampleGraphWithModule(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-p67',
		architectureName: 'Platform Core',
		sourceRevision: 'e'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'vnet', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet_hub', label: 'azurerm_virtual_network.vnet_hub', hasSource: true },
			{ id: 'mod_fw', kind: 'module', resourceType: null, name: 'firewall', label: 'module.firewall', hasSource: true },
			{ id: 'subnet', kind: 'resource', resourceType: 'azurerm_subnet', name: 'apps', label: 'azurerm_subnet.apps', hasSource: true },
		],
		edges: [
			{ fromId: 'rg', toId: 'vnet', kind: 'reference' },
			{ fromId: 'vnet', toId: 'mod_fw', kind: 'reference' },
			{ fromId: 'mod_fw', toId: 'subnet', kind: 'reference' },
		],
		diagnostics: [
			{ code: 'MODULE_UNREAD', severity: 'info', message: 'Child module firewall is represented as a call boundary.' },
		],
	};
}

test('Phase 6 starter patterns instantiate atomically, render valid HCL, and undo in one step', () => {
	assert.ok(STARTER_PATTERNS.length >= 3);
	const emptyGraph: CanvasGraphSnapshot = { ...sampleGraphWithModule(), nodes: [], edges: [], diagnostics: [] };
	let doc = createDraftDocument(emptyGraph);

	const hub = instantiateStarterPattern('azure-hub-network', doc.present.nodes, doc.baseSourceRevision, lookupBundledSchema, 1)!;
	assert.equal(hub.nodes.length, 5);
	assert.equal(hub.edges.length, 5);

	doc = applyDraftEdit(doc, {
		type: 'insertPattern',
		patternName: hub.template.name,
		nodes: hub.nodes,
		edges: hub.edges,
		drafts: hub.drafts,
	});
	assert.equal(doc.present.nodes.length, 5);
	assert.equal(doc.past.length, 1);

	const preview = generateTerraformPreview(doc, lookupBundledSchema, renderDraftPreview);
	assert.equal(preview.resourceCount, 5);
	assert.equal(preview.hasErrors, false);
	assert.ok(preview.hcl.includes('azurerm_resource_group.rg_hub.name'));

	// Single atomic undo removes the entire pattern cleanly.
	doc = undoDraftEdit(doc);
	assert.equal(doc.present.nodes.length, 0);
	assert.equal(doc.present.edges.length, 0);
});

test('Phase 6 module drill-down boundary inspection and Extract-to-Module refactoring preview', () => {
	const graph = sampleGraphWithModule();
	const boundary = inspectModuleBoundary(graph, 'mod_fw')!;
	assert.equal(boundary.moduleNode.name, 'firewall');
	assert.equal(boundary.inputs.length, 1);
	assert.equal(boundary.inputs[0].node.id, 'vnet');
	assert.equal(boundary.outputs.length, 1);
	assert.equal(boundary.outputs[0].node.id, 'subnet');
	assert.equal(boundary.diagnostics.length, 1);

	const extract = buildExtractModulePreview(graph, ['vnet', 'mod_fw'], 'edge_networking')!;
	assert.equal(extract.moduleName, 'edge_networking');
	assert.equal(extract.inferredInputs.length, 1);
	assert.equal(extract.inferredInputs[0].fromNode.id, 'rg');
	assert.equal(extract.inferredOutputs.length, 1);
	assert.equal(extract.inferredOutputs[0].toNode.id, 'subnet');
	assert.ok(extract.movedBlocksHcl.includes('to   = module.edge_networking.azurerm_virtual_network.vnet_hub'));
	assert.ok(extract.moduleCallHcl.includes('module "edge_networking"'));
	assert.ok(extract.variablesHcl.includes('variable "hub_id"'));
	assert.ok(extract.outputsHcl.includes('output "firewall_id"'));
});

test('Phase 6 enterprise scale: bounded group pagination pins selected nodes and computes LOD cleanly', () => {
	const manyNodes: CanvasNodeSummary[] = [];
	for (let i = 0; i < 30; i++) {
		manyNodes.push({
			id: `n-${i}`,
			kind: 'resource',
			resourceType: 'azurerm_subnet',
			name: `subnet_${i}`,
			label: `azurerm_subnet.subnet_${i}`,
			hasSource: true,
		});
	}
	const bigGraph: CanvasGraphSnapshot = { ...sampleGraphWithModule(), nodes: manyNodes, edges: [] };
	const paged = buildCanvasProjection(bigGraph, 'visual', '', new Set(), {
		maxNodesPerGroup: 10,
		pinnedNodeIds: new Set(['n-29']),
	});
	assert.equal(paged.groups.length, 1);
	assert.equal(paged.groups[0].visibleCount, 10);
	assert.equal(paged.groups[0].paginatedHiddenCount, 20);
	assert.ok(paged.nodes.some(n => n.node.id === 'n-29'), 'pinned selected node must stay visible inside paginated group');

	const expanded = buildCanvasProjection(bigGraph, 'visual', '', new Set(), {
		maxNodesPerGroup: 10,
		expandedPaginatedGroups: new Set([paged.groups[0].id]),
	});
	assert.equal(expanded.visibleNodes, 30);
	assert.equal(expanded.groups[0].paginatedHiddenCount, 0);

	assert.equal(computeLodLevel(1.0, 10), 'full');
	assert.equal(computeLodLevel(0.6, 10), 'compact');
	assert.equal(computeLodLevel(0.35, 10), 'minimal');
});

test('Phase 7 checkpoints, semantic diff, restore, isolated experiments, and sample validation context', () => {
	const graph = sampleGraphWithModule();
	let doc = createDraftDocument(graph);
	const cpBase = captureCheckpoint(doc, 'Initial Baseline', { id: 'cp-1', createdAtIso: '2026-11-23T10:00:00.000Z' });
	const exp = startExperimentSession(doc, 'Add Spoke', '2026-11-23T10:05:00.000Z');

	const spoke = instantiateStarterPattern('azure-edge-perimeter', doc.present.nodes, doc.baseSourceRevision, lookupBundledSchema, 50)!;
	doc = applyDraftEdit(doc, {
		type: 'insertPattern',
		patternName: spoke.template.name,
		nodes: spoke.nodes,
		edges: spoke.edges,
		drafts: spoke.drafts,
	});

	const diff = compareSemanticSnapshots(
		{ nodes: cpBase.nodes, edges: cpBase.edges, modifiedDraftIds: cpBase.modifiedDraftIds },
		{ nodes: doc.present.nodes, edges: doc.present.edges, modifiedDraftIds: Object.keys(doc.present.drafts) }
	);
	assert.equal(diff.hasChanges, true);
	assert.equal(diff.addedNodes.length, 4);
	assert.equal(diff.addedEdges.length, 3);

	// Restore checkpoint cleanly as one undoable step.
	const restoredState = checkpointToDraftState(cpBase, doc);
	doc = applyDraftEdit(doc, { type: 'restoreSnapshot', reason: 'Restore Initial Baseline', snapshot: restoredState });
	assert.equal(doc.present.nodes.length, 4);
	assert.equal(exp.baselineState.nodes.length, 4);

	// Retention limit & protocol sanitization for checkpoints + sample context
	let list = appendCheckpoint([], cpBase, 2);
	list = appendCheckpoint(list, captureCheckpoint(doc, 'Second', { id: 'cp-2' }), 2);
	list = appendCheckpoint(list, captureCheckpoint(doc, 'Third', { id: 'cp-3' }), 2);
	assert.deepEqual(list.map(c => c.id), ['cp-2', 'cp-3']);

	const sanitized = sanitizeViewState({
		checkpoints: list,
		sampleContext: {
			label: 'Prod Dry Run',
			environment: 'prod',
			region: 'uksouth',
			capturedAtIso: '2026-11-23T10:10:00.000Z',
			sourceRevision: graph.sourceRevision,
			schemaVersion: 'hashicorp/azurerm 5.14.0',
		},
	});
	assert.equal(sanitized.checkpoints.length, 2);
	assert.equal(sanitized.sampleContext?.environment, 'prod');
	assert.equal(isSampleContextStale(sanitized.sampleContext, graph.sourceRevision), false);
	assert.equal(isSampleContextStale(sanitized.sampleContext, 'f'.repeat(64)), true);
});
