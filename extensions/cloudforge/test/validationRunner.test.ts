/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CanvasGraphSnapshot } from '../src/canvas/protocol.ts';
import { createInitialDraft, lookupBundledSchema, renderDraftPreview } from '../src/canvas/schemaForm.ts';
import {
	cancelValidationRun,
	computePrerequisiteScope,
	detectDependencyCycles,
	runOfflineValidation,
	syncRunWithRevision,
} from '../src/canvas/validationRunner.ts';

const rev1 = '1'.repeat(64);
const rev2 = '2'.repeat(64);

function mixedGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-1',
		architectureName: 'Mixed Validation Fixture',
		sourceRevision: rev1,
		status: 'complete',
		nodes: [
			// Independent healthy branch
			{ id: 'indep', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_indep', label: 'azurerm_resource_group.rg_indep', hasSource: true },
			// Failing prerequisite -> downstream blocked node
			{ id: 'bad_pre', kind: 'resource', resourceType: 'azurerm_virtual_network', name: '123_invalid', label: 'azurerm_virtual_network.123_invalid', hasSource: true },
			{ id: 'blocked', kind: 'resource', resourceType: 'azurerm_subnet', name: 'snet_blocked', label: 'azurerm_subnet.snet_blocked', hasSource: true },
			// Cycle between c1 and c2 -> downstream c3 blocked
			{ id: 'c1', kind: 'resource', resourceType: 'azurerm_route_table', name: 'rt_a', label: 'azurerm_route_table.rt_a', hasSource: true },
			{ id: 'c2', kind: 'resource', resourceType: 'azurerm_route_table', name: 'rt_b', label: 'azurerm_route_table.rt_b', hasSource: true },
			{ id: 'c3', kind: 'resource', resourceType: 'azurerm_public_ip', name: 'pip_after_cycle', label: 'azurerm_public_ip.pip_after_cycle', hasSource: true },
		],
		edges: [
			{ fromId: 'bad_pre', toId: 'blocked', kind: 'reference' },
			{ fromId: 'c1', toId: 'c2', kind: 'reference' },
			{ fromId: 'c2', toId: 'c1', kind: 'reference' },
			{ fromId: 'c2', toId: 'c3', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('validation reports cycles and failed prerequisites while allowing independent branches to succeed', () => {
	const graph = mixedGraph();
	const run = runOfflineValidation(graph, {
		scope: 'architecture',
		lookupSchema: lookupBundledSchema,
		renderDraft: renderDraftPreview,
		nowMs: 1000,
	});

	assert.equal(run.outcome, 'failed');
	assert.equal(run.coverage, 'complete');
	assert.equal(run.capturedRevision, rev1);
	assert.equal(run.stages.length, 3);
	assert.equal(run.stages[1].status, 'failed');

	// Independent branch still passes!
	assert.equal(run.nodeResults.indep.status, 'success');
	// Bad identifier fails and blocks downstream subnet
	assert.equal(run.nodeResults.bad_pre.status, 'failed');
	assert.equal(run.nodeResults.blocked.status, 'skipped');
	assert.deepEqual(run.nodeResults.blocked.blockedBy, ['bad_pre']);
	// Cycle members fail and block downstream public IP
	assert.deepEqual([...run.cycleNodeIds].sort(), ['c1', 'c2']);
	assert.equal(run.nodeResults.c1.status, 'failed');
	assert.equal(run.nodeResults.c2.status, 'failed');
	assert.equal(run.nodeResults.c3.status, 'skipped');
	assert.deepEqual(run.nodeResults.c3.blockedBy, ['c2']);

	// Monotonic timeline sequence
	for (let i = 1; i < run.events.length; i++) {
		assert.ok(run.events[i].sequence > run.events[i - 1].sequence);
	}
});

test('scoped Validate Resource analyzes only the target and its transitive prerequisites', () => {
	const graph = mixedGraph();
	const scope = computePrerequisiteScope(graph, 'blocked');
	assert.deepEqual(scope, ['bad_pre', 'blocked']);

	const run = runOfflineValidation(graph, { scope: 'resource', targetNodeId: 'blocked', nowMs: 2000 });
	assert.equal(run.scope, 'resource');
	assert.equal(run.targetNodeId, 'blocked');
	assert.deepEqual(run.analyzedNodeIds, ['bad_pre', 'blocked']);
	assert.equal(run.nodeResults.indep, undefined);
	assert.equal(run.nodeResults.blocked.status, 'skipped');
});

test('partial static graph and uncovered provider schemas report partial coverage honestly', () => {
	const graph: CanvasGraphSnapshot = {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-2',
		architectureName: 'Partial Graph',
		sourceRevision: rev1,
		status: 'partial',
		nodes: [
			{ id: 'u1', kind: 'module', resourceType: null, name: 'ext_mod', label: 'module.ext_mod', hasSource: true },
		],
		edges: [],
		diagnostics: [{ code: 'UNRESOLVED_REFERENCE', severity: 'warning', message: 'External module output unresolved.' }],
	};
	const run = runOfflineValidation(graph, { scope: 'architecture', nowMs: 3000 });
	assert.equal(run.coverage, 'partial');
	assert.equal(run.outcome, 'completed_with_warnings');
	assert.equal(run.nodeResults.u1.schemaCovered, false);
	assert.ok(run.nodeResults.u1.findings.some(f => f.code === 'SCHEMA_UNAVAILABLE'));
	assert.ok(run.coverageNotes.length >= 2);
});

test('draft schema checks integrate into validation, and rerun/cancel/stale semantics hold', () => {
	const graph = mixedGraph();
	const rg = graph.nodes[0];
	const schema = lookupBundledSchema(rg)!;
	const incompleteDraft = createInitialDraft(rg, schema, rev1); // missing required `location`
	const drafts = new Map([[rg.id, incompleteDraft]]);

	const run1 = runOfflineValidation(graph, {
		scope: 'resource',
		targetNodeId: rg.id,
		drafts,
		lookupSchema: lookupBundledSchema,
		renderDraft: renderDraftPreview,
		nowMs: 4000,
	});
	assert.equal(run1.attempt, 1);
	assert.equal(run1.previousRunId, null);
	assert.equal(run1.nodeResults[rg.id].status, 'failed');
	assert.ok(run1.nodeResults[rg.id].findings.some(f => f.code === 'SCHEMA_DRAFT_CHECK'));

	const run2 = runOfflineValidation(graph, { scope: 'resource', targetNodeId: rg.id, previousRun: run1, nowMs: 5000 });
	assert.equal(run2.attempt, 2);
	assert.equal(run2.previousRunId, run1.runId);
	assert.equal(run2.nodeResults[rg.id].status, 'success');

	const cancelled = cancelValidationRun(run2, 5500);
	assert.equal(cancelled.outcome, 'cancelled');
	assert.equal(cancelValidationRun(cancelled, 6000), cancelled);

	const stale = syncRunWithRevision(run2, rev2)!;
	assert.equal(stale.stale, true);
	assert.equal(detectDependencyCycles(graph, new Set(['indep'])).size, 0);
});
