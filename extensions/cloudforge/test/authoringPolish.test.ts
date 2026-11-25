/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createInitialDraft,
	lookupBundledSchema,
	renderDraftPreview
} from '../src/canvas/schemaForm.ts';
import {
	applyDraftEdit,
	copySelectionToClipboard,
	createDraftDocument,
	pasteClipboardEdit,
	undoDraftEdit
} from '../src/canvas/draftDocument.ts';
import type { CanvasGraphSnapshot } from '../src/canvas/protocol.ts';

const rev = 'c'.repeat(64);

function sampleAwsGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'ws-aws',
		architectureId: 'arch-aws',
		architectureName: 'AwsFoundation',
		sourceRevision: rev,
		status: 'complete',
		nodes: [
			{ id: 'n-vpc', kind: 'resource', resourceType: 'aws_vpc', name: 'main', label: 'aws_vpc.main', hasSource: true },
			{ id: 'n-sub', kind: 'resource', resourceType: 'aws_subnet', name: 'public', label: 'aws_subnet.public', hasSource: true },
			{ id: 'n-igw', kind: 'resource', resourceType: 'aws_internet_gateway', name: 'edge', label: 'aws_internet_gateway.edge', hasSource: true },
		],
		edges: [
			{ fromId: 'n-vpc', toId: 'n-sub', kind: 'reference' },
			{ fromId: 'n-vpc', toId: 'n-igw', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('Multi-cloud bundled schemas cover AWS, GCP, and Kubernetes resources with valid HCL preview', () => {
	const types = [
		'aws_vpc',
		'aws_subnet',
		'aws_internet_gateway',
		'aws_security_group',
		'google_compute_network',
		'google_compute_subnetwork',
		'google_compute_firewall',
		'kubernetes_namespace',
		'kubernetes_config_map',
		'kubernetes_network_policy',
	];
	for (const typeName of types) {
		const schema = lookupBundledSchema({ kind: 'resource', resourceType: typeName });
		assert.ok(schema, `expected bundled schema for ${typeName}`);
		assert.ok(schema.outputs.length >= 1, `expected outputs for ${typeName}`);
	}

	const vpcSchema = lookupBundledSchema({ kind: 'resource', resourceType: 'aws_vpc' })!;
	const vpcNode = sampleAwsGraph().nodes[0];
	const draft = createInitialDraft(vpcNode, vpcSchema, rev);
	const rendered = renderDraftPreview(vpcSchema, {
		...draft,
		attributes: {
			cidr_block: { kind: 'literal', value: '10.20.0.0/16' },
			enable_dns_hostnames: { kind: 'literal', value: true },
		},
	});
	assert.equal(rendered.hasErrors, false);
	assert.ok(rendered.hcl.includes('resource "aws_vpc" "main"'));
	assert.ok(rendered.hcl.includes('cidr_block           = "10.20.0.0/16"'));
});

test('Copy/paste clones selected resources, drafts, and internal edges in one atomic undoable edit', () => {
	const vpcSchema = lookupBundledSchema({ kind: 'resource', resourceType: 'aws_vpc' })!;
	let doc = createDraftDocument(sampleAwsGraph());
	const vpcDraft = {
		...createInitialDraft(doc.present.nodes[0], vpcSchema, rev),
		attributes: { cidr_block: { kind: 'literal' as const, value: '10.99.0.0/16' } },
	};
	doc = applyDraftEdit(doc, { type: 'updateDraft', nodeId: 'n-vpc', draft: vpcDraft });

	const clip = copySelectionToClipboard(doc, ['n-vpc', 'n-sub']);
	assert.ok(clip);
	assert.equal(clip.nodes.length, 2);
	assert.equal(clip.edges.length, 1);

	const pasted = pasteClipboardEdit(doc, clip, 'paste-1');
	assert.ok(pasted);
	assert.equal(pasted.edit.nodes.length, 2);
	assert.equal(pasted.edit.edges.length, 1);
	assert.equal(pasted.edit.nodes[0].name, 'main_copy');
	assert.equal(pasted.edit.nodes[1].name, 'public_copy');

	const afterPaste = applyDraftEdit(doc, pasted.edit);
	assert.equal(afterPaste.present.nodes.length, 5);
	assert.equal(afterPaste.present.edges.length, 3);
	const newVpcId = pasted.idMap.get('n-vpc')!;
	assert.equal(afterPaste.present.drafts[newVpcId]?.attributes.cidr_block?.kind, 'literal');

	const undone = undoDraftEdit(afterPaste);
	assert.equal(undone.present.nodes.length, 3);
	assert.equal(undone.present.edges.length, 2);
});

test('deleteResources removes multiple selected nodes and their incident edges in one atomic undoable step', () => {
	const doc = createDraftDocument(sampleAwsGraph());
	const afterDelete = applyDraftEdit(doc, { type: 'deleteResources', nodeIds: ['n-sub', 'n-igw'] });
	assert.equal(afterDelete.present.nodes.length, 1);
	assert.equal(afterDelete.present.edges.length, 0);
	assert.deepEqual(afterDelete.present.deletedIds, ['n-sub', 'n-igw']);

	const undone = undoDraftEdit(afterDelete);
	assert.equal(undone.present.nodes.length, 3);
	assert.equal(undone.present.edges.length, 2);
	assert.deepEqual(undone.present.deletedIds, []);
});
