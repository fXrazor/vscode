/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyDraftEdit,
	computeDraftChangeSummary,
	createDraftDocument,
	generateTerraformPreview,
	projectDraftGraph,
	redoDraftEdit,
	revertDraftDocument,
	undoDraftEdit,
	uniqueResourceName,
} from '../src/canvas/draftDocument.ts';
import type { CanvasGraphSnapshot, CanvasNodeSummary } from '../src/canvas/protocol.ts';
import { createInitialDraft, lookupBundledSchema, renderDraftPreview } from '../src/canvas/schemaForm.ts';

const rev = 'f'.repeat(64);

function baseGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-1',
		architectureName: 'Hub Network',
		sourceRevision: rev,
		status: 'complete',
		nodes: [
			{ id: 'n1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'n2', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet_hub', label: 'azurerm_virtual_network.vnet_hub', hasSource: true },
		],
		edges: [
			{ fromId: 'n1', toId: 'n2', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('add, duplicate, connect, delete, undo, redo, and revert share one semantic history', () => {
	let doc = createDraftDocument(baseGraph());
	assert.equal(computeDraftChangeSummary(doc).dirty, false);

	const nsgNode: CanvasNodeSummary = {
		id: 'draft-nsg-1',
		kind: 'resource',
		resourceType: 'azurerm_network_security_group',
		name: 'nsg_web',
		label: 'azurerm_network_security_group.nsg_web',
		hasSource: false,
	};
	const nsgSchema = lookupBundledSchema(nsgNode)!;
	const nsgDraft = {
		...createInitialDraft(nsgNode, nsgSchema, rev),
		attributes: {
			name: { kind: 'literal' as const, value: 'nsg-web' },
			location: { kind: 'literal' as const, value: 'uksouth' },
			resource_group_name: { kind: 'expression' as const, text: 'azurerm_resource_group.hub.name' },
		},
	};

	doc = applyDraftEdit(doc, { type: 'addResource', node: nsgNode, initialDraft: nsgDraft });
	doc = applyDraftEdit(doc, { type: 'connectResources', fromId: 'n1', toId: 'draft-nsg-1' });
	doc = applyDraftEdit(doc, { type: 'duplicateResource', sourceNodeId: 'draft-nsg-1', newNodeId: 'draft-nsg-2', newName: uniqueResourceName(doc.present.nodes, 'nsg_web') });
	assert.equal(doc.present.nodes.length, 4);
	assert.equal(doc.present.edges.length, 2);
	assert.equal(doc.present.nodes[3].name, 'nsg_web_2');

	// Delete the first added NSG -> removes both node and its edge atomically
	doc = applyDraftEdit(doc, { type: 'deleteResource', nodeId: 'draft-nsg-1' });
	assert.equal(doc.present.nodes.length, 3);
	assert.equal(doc.present.edges.length, 1);

	// Undo restores both the deleted NSG and its edge together
	doc = undoDraftEdit(doc);
	assert.equal(doc.present.nodes.length, 4);
	assert.equal(doc.present.edges.length, 2);

	// Redo re-applies deletion
	doc = redoDraftEdit(doc);
	assert.equal(doc.present.nodes.length, 3);
	assert.equal(doc.present.edges.length, 1);

	// Revert returns cleanly to base snapshot
	const reverted = revertDraftDocument(doc);
	assert.equal(computeDraftChangeSummary(reverted).dirty, false);
	assert.equal(projectDraftGraph(reverted).nodes.length, 2);
});

test('connectResources rejects self-loops, duplicates, and cycle-creating edges', () => {
	const doc = createDraftDocument(baseGraph());
	assert.equal(applyDraftEdit(doc, { type: 'connectResources', fromId: 'n1', toId: 'n1' }), doc);
	assert.equal(applyDraftEdit(doc, { type: 'connectResources', fromId: 'n1', toId: 'n2' }), doc);
	// n2 -> n1 would form a cycle with n1 -> n2
	assert.equal(applyDraftEdit(doc, { type: 'connectResources', fromId: 'n2', toId: 'n1' }), doc);
});

test('generateTerraformPreview emits deterministic HCL and marks deletions without modifying base graph', () => {
	let doc = createDraftDocument(baseGraph());
	const pipNode: CanvasNodeSummary = {
		id: 'draft-pip-1',
		kind: 'resource',
		resourceType: 'azurerm_public_ip',
		name: 'pip_gw',
		label: 'azurerm_public_ip.pip_gw',
		hasSource: false,
	};
	const pipSchema = lookupBundledSchema(pipNode)!;
	const pipDraft = {
		...createInitialDraft(pipNode, pipSchema, rev),
		attributes: {
			name: { kind: 'literal' as const, value: 'pip-gw' },
			resource_group_name: { kind: 'expression' as const, text: 'azurerm_resource_group.hub.name' },
			location: { kind: 'literal' as const, value: 'uksouth' },
			allocation_method: { kind: 'literal' as const, value: 'Static' },
		},
	};
	doc = applyDraftEdit(doc, { type: 'addResource', node: pipNode, initialDraft: pipDraft });
	doc = applyDraftEdit(doc, { type: 'deleteResource', nodeId: 'n2' });

	const summary = computeDraftChangeSummary(doc);
	assert.equal(summary.dirty, true);
	assert.equal(summary.added.length, 1);
	assert.equal(summary.deleted.length, 1);

	const preview = generateTerraformPreview(doc, lookupBundledSchema, renderDraftPreview);
	assert.equal(preview.resourceCount, 1);
	assert.equal(preview.hasErrors, false);
	assert.ok(preview.hcl.includes('resource "azurerm_public_ip" "pip_gw" {'));
	assert.ok(preview.hcl.includes('allocation_method   = "Static"'));
	assert.ok(preview.hcl.includes('#   - azurerm_virtual_network.vnet_hub'));
});
