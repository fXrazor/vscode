/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildPlaybackFrame,
	evaluateRecipeSteps,
	explainResource,
	WORKFLOW_RECIPES
} from '../src/canvas/advisorRecipes.ts';
import {
	applyDraftEdit,
	createDraftDocument,
	projectDraftGraph
} from '../src/canvas/draftDocument.ts';
import {
	buildDraftPlanReview,
	createPlanApproval,
	estimateArchitectureCost,
	evaluateArchitecturePolicies,
	isPlanApprovalValid,
	parseTerraformPlanJson
} from '../src/canvas/planReview.ts';
import type { CanvasGraphSnapshot } from '../src/canvas/protocol.ts';
import { createInitialDraft, lookupBundledSchema } from '../src/canvas/schemaForm.ts';
import { runOfflineValidation } from '../src/canvas/validationRunner.ts';

function sampleGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-p89',
		architectureName: 'Prod Hub',
		sourceRevision: 'f'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'pip', kind: 'resource', resourceType: 'azurerm_public_ip', name: 'gw', label: 'azurerm_public_ip.gw', hasSource: true },
			{ id: 'custom', kind: 'resource', resourceType: 'azurerm_custom_unpriced_widget', name: 'mystery', label: 'azurerm_custom_unpriced_widget.mystery', hasSource: true },
		],
		edges: [
			{ fromId: 'rg', toId: 'pip', kind: 'reference' },
			{ fromId: 'pip', toId: 'custom', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('Phase 8 full-root plan review, context-bound approval invalidation, and CLI plan JSON import', () => {
	const graph = sampleGraph();
	let doc = createDraftDocument(graph);
	const nsgNode = { id: 'draft:nsg', kind: 'resource', resourceType: 'azurerm_network_security_group', name: 'edge', label: 'azurerm_network_security_group.edge', hasSource: false };
	const nsgSchema = lookupBundledSchema(nsgNode)!;
	doc = applyDraftEdit(doc, { type: 'addResource', node: nsgNode, initialDraft: createInitialDraft(nsgNode, nsgSchema, doc.baseSourceRevision) });

	const plan1 = buildDraftPlanReview(doc, { environment: 'staging', region: 'uksouth' });
	assert.equal(plan1.sourceKind, 'offline_draft_preview');
	assert.equal(plan1.createdCount, 1);
	assert.equal(plan1.hasHighRiskChanges, false);

	const approval = createPlanApproval(plan1, false, '2026-11-23T14:00:00.000Z')!;
	assert.equal(isPlanApprovalValid(approval, plan1).valid, true);

	// Deleting a resource introduces high risk and invalidates prior approval immediately.
	doc = applyDraftEdit(doc, { type: 'deleteResource', nodeId: 'pip' });
	const plan2 = buildDraftPlanReview(doc, { environment: 'staging', region: 'uksouth' });
	assert.equal(plan2.deletedCount, 1);
	assert.equal(plan2.hasHighRiskChanges, true);
	assert.equal(isPlanApprovalValid(approval, plan2).valid, false);
	assert.equal(createPlanApproval(plan2, false), undefined, 'high-risk plan requires explicit acknowledgement');
	assert.ok(createPlanApproval(plan2, true));

	// CLI `terraform show -json` parsing ignores sensitive payloads and classifies replace/create/delete.
	const cliJson = JSON.stringify({
		resource_changes: [
			{ address: 'azurerm_public_ip.gw', type: 'azurerm_public_ip', name: 'gw', change: { actions: ['delete', 'create'], after_unknown: { ip_address: true }, after_sensitive: { secret: 'do-not-expose' } } },
			{ address: 'azurerm_resource_group.hub', type: 'azurerm_resource_group', name: 'hub', change: { actions: ['no-op'] } },
		],
	});
	const parsed = parseTerraformPlanJson(cliJson, graph.sourceRevision, graph.nodes)!;
	assert.equal(parsed.sourceKind, 'imported_plan_json');
	assert.equal(parsed.replacedCount, 1);
	assert.equal(parsed.unchangedCount, 1);
	assert.equal(parsed.hasHighRiskChanges, true);
	assert.equal(parsed.changes[0].hasUnknownAfterApply, true);
});

test('Phase 8 offline security policies and transparent cost estimation with unknown coverage', () => {
	const graph = sampleGraph();
	let doc = createDraftDocument(graph);
	const pipSchema = lookupBundledSchema(graph.nodes[1])!;
	const pipDraft = {
		...createInitialDraft(graph.nodes[1], pipSchema, doc.baseSourceRevision),
		attributes: { name: { kind: 'literal' as const, value: 'pip-gw' }, sku: { kind: 'literal' as const, value: 'Basic' } },
	};
	doc = applyDraftEdit(doc, { type: 'updateDraft', nodeId: 'pip', draft: pipDraft });

	const policies = evaluateArchitecturePolicies(projectDraftGraph(doc), doc.present.drafts, {
		sourceRevision: graph.sourceRevision,
		engine: 'terraform',
		engineInferred: true,
		lockState: 'absent',
		providers: [{ display: 'hashicorp/azurerm', status: 'unlocked', conflictCount: 0, requirementCount: 2 }],
		unusedLockEntries: [],
		diagnosticCount: 0,
	});
	assert.ok(policies.some(f => f.ruleId === 'CF-SEC-001'));
	assert.ok(policies.some(f => f.ruleId === 'CF-GOV-001'));
	assert.ok(policies.some(f => f.ruleId === 'CF-DEP-001'));

	const cost = estimateArchitectureCost(doc, 'uksouth');
	assert.equal(cost.currency, 'USD');
	assert.equal(cost.isEstimate, true);
	assert.equal(cost.projectedTotalUsd, 3.65);
	assert.equal(cost.knownCount, 2);
	assert.equal(cost.unknownCount, 1);
	assert.equal(cost.lines.find(l => l.nodeId === 'custom')?.status, 'unknown');
});

test('Phase 9 Explain Resource advisor, reusable workflow recipes, and simulated run playback', () => {
	const graph = sampleGraph();
	let doc = createDraftDocument(graph);
	const pipSchema = lookupBundledSchema(graph.nodes[1])!;
	const pipDraft = createInitialDraft(graph.nodes[1], pipSchema, doc.baseSourceRevision);
	doc = applyDraftEdit(doc, { type: 'updateDraft', nodeId: 'pip', draft: pipDraft });

	const current = projectDraftGraph(doc);
	const policies = evaluateArchitecturePolicies(current, doc.present.drafts);
	const cost = estimateArchitectureCost(doc, 'uksouth');
	const explanation = explainResource(current, 'pip', {
		schema: pipSchema,
		draft: pipDraft,
		policyFindings: policies,
		costEstimate: cost,
	})!;
	assert.ok(explanation.dataScopeDisclosure.includes('Local offline analysis only'));
	assert.equal(explanation.transitiveImpactCount, 1);
	assert.ok(explanation.proposals.some(p => p.id === 'prop-pip-standard'));
	assert.ok(explanation.proposals.some(p => p.id === 'prop-add-tags'));
	assert.ok(explanation.proposals.some(p => p.id === 'prop-bind-rg'));

	const run = runOfflineValidation(current, { scope: 'architecture' });
	const plan = buildDraftPlanReview(doc);
	assert.equal(WORKFLOW_RECIPES.length, 3);
	const steps = evaluateRecipeSteps('delivery-pipeline', {
		graph: current,
		validationRun: run,
		policyFindings: policies,
		costEstimate: cost,
		planReview: plan,
		approval: null,
		approvalValid: false,
	});
	assert.equal(steps.length, 5);
	assert.equal(steps[4].status, 'blocked', 'Apply step stays blocked until approval matches revision');

	const frame0 = buildPlaybackFrame(run, 0)!;
	const frameLast = buildPlaybackFrame(run, run.events.length - 1)!;
	assert.ok(frame0.label.includes('Simulated Playback'));
	assert.equal(frameLast.stepIndex, run.events.length - 1);
});
