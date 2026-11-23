/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 9 (Desktop Foundation): Explain Resource Advisor (offline evidence-backed explanations
// and draft-only change proposals with data-scope disclosure), Reusable Validation/Delivery
// Recipes, and Simulated Run Playback over retained validation events.
// Pure TypeScript with zero DOM, network, or `vscode` runtime dependencies.

import type {
	ArchitectureCostEstimate,
	FullRootPlanReview,
	PlanApprovalRecord,
	PolicyFinding
} from './planReview';
import type { CanvasGraphSnapshot, CanvasNodeSummary } from './protocol';
import type { DraftValue, FormSchema, ResourceDraft } from './schemaForm';
import type { RunnerNodeStatus, ValidationRun } from './validationRunner';

export interface AdvisorProposal {
	readonly id: string;
	readonly title: string;
	readonly rationale: string;
	readonly origin: 'cloudforge-advisor';
	readonly patch: Readonly<Record<string, DraftValue>>;
}

export interface ResourceExplanation {
	readonly node: CanvasNodeSummary;
	readonly dataScopeDisclosure: string;
	readonly schemaProvenance: string;
	readonly summary: string;
	readonly upstreamNames: readonly string[];
	readonly downstreamNames: readonly string[];
	readonly transitiveImpactCount: number;
	readonly findings: readonly PolicyFinding[];
	readonly estimatedMonthlyUsd: number | null;
	readonly costBasis: string;
	readonly proposals: readonly AdvisorProposal[];
}

export type RecipeStepStatus = 'passed' | 'warning' | 'failed' | 'pending' | 'blocked';

export interface EvaluatedRecipeStep {
	readonly id: string;
	readonly label: string;
	readonly status: RecipeStepStatus;
	readonly detail: string;
	readonly affectedNodeIds: readonly string[];
}

export interface WorkflowRecipeMeta {
	readonly id: 'standard-static' | 'security-cost' | 'delivery-pipeline';
	readonly name: string;
	readonly description: string;
}

export interface PlaybackFrame {
	readonly stepIndex: number;
	readonly totalSteps: number;
	readonly label: string;
	readonly activeNodeId: string | null;
	readonly activeStage: string;
	readonly message: string;
	readonly nodeStatuses: Readonly<Record<string, RunnerNodeStatus>>;
}

export const ADVISOR_DATA_SCOPE = 'Local offline analysis only: reads sanitized graph topology, bundled/verified schema metadata, active draft fields, and baseline policy/cost catalogs. No cloud credentials or network requests are used.';

export const WORKFLOW_RECIPES: readonly WorkflowRecipeMeta[] = [
	{
		id: 'standard-static',
		name: 'Standard Static Validation',
		description: 'Parse -> Map Dependencies -> Static & Schema Checks.',
	},
	{
		id: 'security-cost',
		name: 'Security & Cost Readiness',
		description: 'Parse -> Provider Locks -> Baseline Policy Checks -> Cost Estimate Delta -> Review.',
	},
	{
		id: 'delivery-pipeline',
		name: 'Full Deployment Review Pipeline',
		description: 'Validate -> Draft HCL Preview -> Full-Root Plan -> Context-Bound Approval -> Guarded Save / CLI Apply.',
	},
];

function computeTransitiveDependents(graph: CanvasGraphSnapshot, startId: string): number {
	const adj = new Map<string, string[]>();
	for (const edge of graph.edges) {
		let list = adj.get(edge.fromId);
		if (!list) {
			list = [];
			adj.set(edge.fromId, list);
		}
		list.push(edge.toId);
	}
	const visited = new Set<string>([startId]);
	const stack = [startId];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const next of adj.get(cur) ?? []) {
			if (!visited.has(next)) {
				visited.add(next);
				stack.push(next);
			}
		}
	}
	return Math.max(0, visited.size - 1);
}

/** Produces an evidence-backed, offline Explain Resource brief and draft-only change proposals. */
export function explainResource(
	graph: CanvasGraphSnapshot,
	nodeId: string,
	options: {
		readonly schema?: FormSchema;
		readonly draft?: ResourceDraft;
		readonly policyFindings: readonly PolicyFinding[];
		readonly costEstimate?: ArchitectureCostEstimate;
	}
): ResourceExplanation | undefined {
	const node = graph.nodes.find(n => n.id === nodeId);
	if (!node) {
		return undefined;
	}
	const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
	const upstreamNames: string[] = [];
	const downstreamNames: string[] = [];
	for (const edge of graph.edges) {
		if (edge.toId === node.id) {
			const src = nodeById.get(edge.fromId);
			if (src) {
				upstreamNames.push(src.label);
			}
		} else if (edge.fromId === node.id) {
			const dst = nodeById.get(edge.toId);
			if (dst) {
				downstreamNames.push(dst.label);
			}
		}
	}
	const transitiveImpactCount = computeTransitiveDependents(graph, node.id);
	const findings = options.policyFindings.filter(f => f.nodeId === node.id);
	const costLine = options.costEstimate?.lines.find(l => l.nodeId === node.id);

	const proposals: AdvisorProposal[] = [];
	const type = (node.resourceType ?? '').toLowerCase();
	if (options.schema) {
		if (type === 'azurerm_public_ip') {
			const sku = options.draft?.attributes.sku;
			const isStandard = sku?.kind === 'literal' && sku.value === 'Standard';
			if (!isStandard) {
				proposals.push({
					id: 'prop-pip-standard',
					title: 'Upgrade Public IP to Standard Static SKU',
					rationale: 'Standard SKU enables availability zone redundancy and secure-by-default closed inbound posture.',
					origin: 'cloudforge-advisor',
					patch: {
						sku: { kind: 'literal', value: 'Standard' },
						allocation_method: { kind: 'literal', value: 'Static' },
					},
				});
			}
		}
		if (options.schema.attributes.some(a => a.name === 'tags')) {
			const existingTags = options.draft?.attributes.tags;
			if (!existingTags) {
				proposals.push({
					id: 'prop-add-tags',
					title: 'Add governance tags (environment, managed_by)',
					rationale: 'Standardized tags improve Azure cost allocation, ownership tracking, and policy compliance.',
					origin: 'cloudforge-advisor',
					patch: {
						tags: { kind: 'literal', value: { environment: 'staging', managed_by: 'cloudforge' } },
					},
				});
			}
		}
		const hasRgAttr = options.schema.attributes.some(a => a.name === 'resource_group_name');
		const firstRg = graph.nodes.find(n => n.id !== node.id && (n.resourceType ?? '').toLowerCase() === 'azurerm_resource_group');
		if (hasRgAttr && firstRg && !options.draft?.attributes.resource_group_name) {
			proposals.push({
				id: 'prop-bind-rg',
				title: `Bind to ${firstRg.label}`,
				rationale: `References ${firstRg.label}.name and .location via typed HCL expressions instead of duplicating literals.`,
				origin: 'cloudforge-advisor',
				patch: {
					resource_group_name: { kind: 'expression', text: `${firstRg.label}.name` },
					...(options.schema.attributes.some(a => a.name === 'location')
						? { location: { kind: 'expression', text: `${firstRg.label}.location` } }
						: {}),
				},
			});
		}
	}

	const summary = options.schema?.description
		?? `${node.kind} declaration (${node.resourceType ?? node.label}) in ${graph.architectureName}.`;

	return {
		node,
		dataScopeDisclosure: ADVISOR_DATA_SCOPE,
		schemaProvenance: options.schema
			? `${options.schema.providerSource} ${options.schema.providerVersion}`
			: 'No provider form schema installed (static graph metadata only)',
		summary,
		upstreamNames,
		downstreamNames,
		transitiveImpactCount,
		findings,
		estimatedMonthlyUsd: costLine?.projectedMonthlyUsd ?? null,
		costBasis: costLine?.basis ?? 'Unknown — not priced in offline reference catalog',
		proposals,
	};
}

/** Evaluates a reusable validation/delivery recipe against current run, policy, cost, plan, and approval evidence. */
export function evaluateRecipeSteps(
	recipeId: WorkflowRecipeMeta['id'],
	context: {
		readonly graph: CanvasGraphSnapshot;
		readonly validationRun?: ValidationRun;
		readonly policyFindings: readonly PolicyFinding[];
		readonly costEstimate: ArchitectureCostEstimate;
		readonly planReview: FullRootPlanReview;
		readonly approval: PlanApprovalRecord | null;
		readonly approvalValid: boolean;
	}
): readonly EvaluatedRecipeStep[] {
	const allIds = context.graph.nodes.map(n => n.id);
	const valStatus: RecipeStepStatus = !context.validationRun
		? 'pending'
		: context.validationRun.outcome === 'failed'
			? 'failed'
			: context.validationRun.outcome === 'completed'
				? 'passed'
				: 'warning';

	const errPolicies = context.policyFindings.filter(f => f.severity === 'error');
	const warnPolicies = context.policyFindings.filter(f => f.severity === 'warning');
	const policyStatus: RecipeStepStatus = errPolicies.length > 0 ? 'failed' : warnPolicies.length > 0 ? 'warning' : 'passed';
	const policyNodeIds = [...new Set(context.policyFindings.map(f => f.nodeId).filter((id): id is string => id !== null))];

	const planNodeIds = context.planReview.changes.map(c => c.nodeId).filter((id): id is string => id !== null);

	if (recipeId === 'standard-static') {
		return [
			{
				id: 'parse',
				label: '1. Parse Terraform Source',
				status: context.graph.status === 'complete' ? 'passed' : 'warning',
				detail: `${context.graph.nodes.length} declarations, ${context.graph.edges.length} edges (${context.graph.status} static coverage)`,
				affectedNodeIds: allIds,
			},
			{
				id: 'deps',
				label: '2. Map Dependencies & Cycles',
				status: context.validationRun?.cycleNodeIds.length ? 'failed' : (context.validationRun ? 'passed' : 'pending'),
				detail: context.validationRun?.cycleNodeIds.length
					? `${context.validationRun.cycleNodeIds.length} resource(s) in dependency cycle`
					: 'No dependency cycles detected',
				affectedNodeIds: context.validationRun?.cycleNodeIds ?? allIds,
			},
			{
				id: 'static',
				label: '3. Static & Schema Checks',
				status: valStatus,
				detail: context.validationRun
					? `Run #${context.validationRun.attempt} (${context.validationRun.outcome} · ${context.validationRun.coverage} coverage)`
					: 'Click Validate to run static and schema checks',
				affectedNodeIds: allIds,
			},
		];
	}

	if (recipeId === 'security-cost') {
		return [
			{
				id: 'parse',
				label: '1. Parse Architecture',
				status: context.graph.status === 'complete' ? 'passed' : 'warning',
				detail: `rev ${context.graph.sourceRevision.slice(0, 8)} · ${context.graph.nodes.length} resource(s)`,
				affectedNodeIds: allIds,
			},
			{
				id: 'policy',
				label: '2. Security & Governance Policies',
				status: policyStatus,
				detail: `${errPolicies.length} error(s), ${warnPolicies.length} warning(s), ${context.policyFindings.length - errPolicies.length - warnPolicies.length} info`,
				affectedNodeIds: policyNodeIds,
			},
			{
				id: 'cost',
				label: '3. Cost Estimate & Delta',
				status: context.costEstimate.unknownCount > 0 ? 'warning' : 'passed',
				detail: `$${context.costEstimate.projectedTotalUsd.toFixed(2)}/mo (delta ${context.costEstimate.deltaTotalUsd >= 0 ? '+' : ''}$${context.costEstimate.deltaTotalUsd.toFixed(2)}) · ${context.costEstimate.unknownCount} unknown`,
				affectedNodeIds: context.costEstimate.lines.filter(l => (l.deltaMonthlyUsd ?? 0) !== 0).map(l => l.nodeId),
			},
			{
				id: 'review',
				label: '4. Readiness Review',
				status: errPolicies.length > 0 ? 'blocked' : 'passed',
				detail: errPolicies.length > 0 ? 'Blocked by security policy error(s)' : 'Ready for Plan Review',
				affectedNodeIds: policyNodeIds.length > 0 ? policyNodeIds : allIds,
			},
		];
	}

	// delivery-pipeline
	const planStatus: RecipeStepStatus = context.planReview.changes.length === 0
		? 'passed'
		: context.planReview.hasHighRiskChanges
			? 'warning'
			: 'passed';
	const approvalStatus: RecipeStepStatus = errPolicies.length > 0
		? 'blocked'
		: context.approvalValid
			? 'passed'
			: 'pending';

	return [
		{
			id: 'validate',
			label: '1. Validate Architecture',
			status: valStatus,
			detail: context.validationRun ? `Run #${context.validationRun.attempt} · ${context.validationRun.outcome}` : 'Run validation before deployment',
			affectedNodeIds: allIds,
		},
		{
			id: 'policy',
			label: '2. Security & Cost Gate',
			status: policyStatus,
			detail: `${context.policyFindings.length} finding(s) · Est. $${context.costEstimate.projectedTotalUsd.toFixed(2)}/mo`,
			affectedNodeIds: policyNodeIds,
		},
		{
			id: 'plan',
			label: '3. Review Full-Root Plan',
			status: planStatus,
			detail: `+${context.planReview.createdCount} / ~${context.planReview.updatedCount} / \u00b1${context.planReview.replacedCount} / -${context.planReview.deletedCount} (${context.planReview.sourceKind === 'imported_plan_json' ? 'CLI JSON' : 'Draft Preview'})`,
			affectedNodeIds: planNodeIds,
		},
		{
			id: 'approve',
			label: '4. Context-Bound Approval',
			status: approvalStatus,
			detail: context.approvalValid && context.approval
				? `Approved ${context.approval.planFingerprint} at ${context.approval.approvedAtIso.slice(11, 19)} UTC`
				: 'Requires explicit approval bound to exact plan fingerprint & revision',
			affectedNodeIds: planNodeIds,
		},
		{
			id: 'apply',
			label: '5. Guarded Save / CLI Apply',
			status: context.approvalValid ? 'pending' : 'blocked',
			detail: context.approvalValid
				? 'Use Review HCL -> Apply Saved Changes, then run Terraform/OpenTofu apply against your backend'
				: 'Blocked until Step 4 approval matches current revision',
			affectedNodeIds: planNodeIds,
		},
	];
}

/** Computes a single simulated playback frame from retained validation run events. */
export function buildPlaybackFrame(run: ValidationRun, requestedStep: number): PlaybackFrame | undefined {
	if (run.events.length === 0) {
		return undefined;
	}
	const stepIndex = Math.max(0, Math.min(run.events.length - 1, Math.floor(requestedStep)));
	const nodeStatuses: Record<string, RunnerNodeStatus> = {};
	for (const id of run.analyzedNodeIds) {
		nodeStatuses[id] = 'pending';
	}
	for (let i = 0; i <= stepIndex; i++) {
		const ev = run.events[i];
		if (ev.nodeId) {
			if (ev.status === 'failed' || ev.status === 'warning' || ev.status === 'skipped' || ev.status === 'success' || ev.status === 'running') {
				nodeStatuses[ev.nodeId] = ev.status;
			}
		}
	}
	const active = run.events[stepIndex];
	return {
		stepIndex,
		totalSteps: run.events.length,
		label: `Simulated Playback · Run #${run.attempt} (${stepIndex + 1}/${run.events.length})`,
		activeNodeId: active.nodeId ?? null,
		activeStage: active.stage,
		message: active.message,
		nodeStatuses,
	};
}
