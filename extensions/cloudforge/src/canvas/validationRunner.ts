/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 3: Deterministic offline Resource & Architecture Validation Runner.
// Pure TypeScript with zero runtime `vscode` or DOM imports.
// Follows docs/cloudforge/runner-view-design.md:
// - Captures one immutable sourceRevision per run.
// - Three stages: read, dependencies (cycle & blocker analysis), checks (diagnostics & schema).
// - Check-level blocking: a failed prerequisite or cycle blocks only dependent work; independent
//   branches continue executing and report truthful status.
// - Explicit partial coverage: a missing schema or partial static graph never claims full pass.

import type { CanvasGraphSnapshot, CanvasNodeSummary } from './protocol';
import type { FormSchema, RenderedDraft, ResourceDraft } from './schemaForm';

export type RunnerNodeStatus = 'pending' | 'running' | 'success' | 'warning' | 'failed' | 'skipped';
export type RunnerStageId = 'read' | 'dependencies' | 'checks';
export type RunnerStageStatus = 'pending' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';
export type RunnerOutcome = 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | 'interrupted';

export interface RunnerFinding {
	readonly id: string;
	readonly nodeId: string | null;
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'info';
	readonly message: string;
	readonly remediation: string;
}

export interface RunnerNodeResult {
	readonly nodeId: string;
	readonly status: RunnerNodeStatus;
	readonly reason?: string;
	readonly blockedBy: readonly string[];
	readonly findings: readonly RunnerFinding[];
	readonly schemaCovered: boolean;
}

export interface RunnerStageSummary {
	readonly id: RunnerStageId;
	readonly label: string;
	readonly status: RunnerStageStatus;
	readonly durationMs: number;
	readonly detail: string;
}

export interface RunnerTimelineEvent {
	readonly sequence: number;
	readonly timestampMs: number;
	readonly stage: RunnerStageId;
	readonly nodeId: string | null;
	readonly status: RunnerNodeStatus | RunnerStageStatus;
	readonly message: string;
}

export interface ValidationRun {
	readonly runId: string;
	readonly attempt: number;
	readonly previousRunId: string | null;
	readonly scope: 'architecture' | 'resource';
	readonly targetNodeId: string | null;
	readonly analyzedNodeIds: readonly string[];
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly capturedRevision: string;
	readonly stale: boolean;
	readonly outcome: RunnerOutcome;
	readonly coverage: 'complete' | 'partial';
	readonly coverageNotes: readonly string[];
	readonly startedAtMs: number;
	readonly finishedAtMs: number | null;
	readonly stages: readonly RunnerStageSummary[];
	readonly nodeResults: Readonly<Record<string, RunnerNodeResult>>;
	readonly cycleNodeIds: readonly string[];
	readonly events: readonly RunnerTimelineEvent[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MAX_EVENTS = 400;

/** Computes the target node plus all transitive upstream dependencies for `Validate Resource`. */
export function computePrerequisiteScope(graph: CanvasGraphSnapshot, targetNodeId: string): readonly string[] {
	const known = new Set(graph.nodes.map(n => n.id));
	if (!known.has(targetNodeId)) {
		return [];
	}
	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!known.has(edge.fromId) || !known.has(edge.toId) || edge.fromId === edge.toId) {
			continue;
		}
		let list = incoming.get(edge.toId);
		if (!list) {
			list = [];
			incoming.set(edge.toId, list);
		}
		list.push(edge.fromId);
	}

	const visited = new Set<string>([targetNodeId]);
	const stack = [targetNodeId];
	while (stack.length > 0) {
		const current = stack.pop()!;
		for (const dep of incoming.get(current) ?? []) {
			if (!visited.has(dep)) {
				visited.add(dep);
				stack.push(dep);
			}
		}
	}
	// Preserve deterministic graph node order.
	return graph.nodes.filter(n => visited.has(n.id)).map(n => n.id);
}

/** Finds all nodes participating in at least one directed dependency cycle (Tarjan SCC). */
export function detectDependencyCycles(graph: CanvasGraphSnapshot, scopeIds: ReadonlySet<string>): ReadonlySet<string> {
	const adj = new Map<string, string[]>();
	for (const id of scopeIds) {
		adj.set(id, []);
	}
	for (const edge of graph.edges) {
		if (scopeIds.has(edge.fromId) && scopeIds.has(edge.toId)) {
			adj.get(edge.fromId)!.push(edge.toId);
		}
	}

	let index = 0;
	const indices = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const cycleNodes = new Set<string>();

	function strongConnect(v: string): void {
		indices.set(v, index);
		lowlink.set(v, index);
		index++;
		stack.push(v);
		onStack.add(v);

		for (const w of adj.get(v) ?? []) {
			if (!indices.has(w)) {
				strongConnect(w);
				lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
			} else if (onStack.has(w)) {
				lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
			}
		}

		if (lowlink.get(v) === indices.get(v)) {
			const component: string[] = [];
			for (; ;) {
				const w = stack.pop()!;
				onStack.delete(w);
				component.push(w);
				if (w === v) {
					break;
				}
			}
			const hasSelfLoop = component.length === 1 && (adj.get(v)?.includes(v) ?? false);
			if (component.length > 1 || hasSelfLoop) {
				for (const member of component) {
					cycleNodes.add(member);
				}
			}
		}
	}

	for (const id of scopeIds) {
		if (!indices.has(id)) {
			strongConnect(id);
		}
	}
	return cycleNodes;
}

export interface RunValidationOptions {
	readonly scope: 'architecture' | 'resource';
	readonly targetNodeId?: string;
	readonly drafts?: ReadonlyMap<string, ResourceDraft>;
	readonly lookupSchema?: (node: CanvasNodeSummary) => FormSchema | undefined;
	readonly renderDraft?: (schema: FormSchema, draft: ResourceDraft) => RenderedDraft;
	readonly previousRun?: ValidationRun;
	readonly nowMs?: number;
}

/**
 * Executes deterministic offline validation over one captured `CanvasGraphSnapshot`.
 * Produces stage summaries, per-node status/blockers, bounded timeline events, and coverage state.
 */
export function runOfflineValidation(graph: CanvasGraphSnapshot, options: RunValidationOptions): ValidationRun {
	const startedAt = options.nowMs ?? Date.now();
	const attempt = (options.previousRun?.attempt ?? 0) + 1;
	const runId = `run-${graph.sourceRevision.slice(0, 8)}-${attempt}`;
	const targetNodeId = options.scope === 'resource' ? (options.targetNodeId ?? null) : null;

	const analyzedNodeIds = options.scope === 'resource' && targetNodeId
		? computePrerequisiteScope(graph, targetNodeId)
		: graph.nodes.map(n => n.id);
	const scopeSet = new Set(analyzedNodeIds);
	const nodeById = new Map<string, CanvasNodeSummary>(graph.nodes.map(n => [n.id, n]));

	const events: RunnerTimelineEvent[] = [];
	let seq = 1;
	const pushEvent = (stage: RunnerStageId, nodeId: string | null, status: RunnerNodeStatus | RunnerStageStatus, message: string, offsetMs: number) => {
		if (events.length < MAX_EVENTS) {
			events.push({ sequence: seq++, timestampMs: startedAt + offsetMs, stage, nodeId, status, message });
		}
	};

	const coverageNotes: string[] = [];

	// Stage 1: Read Architecture
	pushEvent('read', null, 'running', `Captured revision ${graph.sourceRevision.slice(0, 8)} (${analyzedNodeIds.length} resource(s) in scope).`, 0);
	if (graph.status === 'partial') {
		coverageNotes.push('Static graph is partial; unresolved declarations or references cannot be marked passed.');
	}
	const readStageStatus: RunnerStageStatus = graph.status === 'partial' ? 'warning' : 'completed';
	pushEvent('read', null, readStageStatus, graph.status === 'partial'
		? 'Architecture read completed with partial static coverage.'
		: 'Architecture read verified.', 2);

	// Stage 2: Map Dependencies & Cycles
	pushEvent('dependencies', null, 'running', 'Analyzing dependency order and cycles.', 3);
	const cycleSet = detectDependencyCycles(graph, scopeSet);
	const upstreamByNode = new Map<string, string[]>();
	const downstreamByNode = new Map<string, string[]>();
	for (const id of analyzedNodeIds) {
		upstreamByNode.set(id, []);
		downstreamByNode.set(id, []);
	}
	for (const edge of graph.edges) {
		if (scopeSet.has(edge.fromId) && scopeSet.has(edge.toId) && edge.fromId !== edge.toId) {
			upstreamByNode.get(edge.toId)!.push(edge.fromId);
			downstreamByNode.get(edge.fromId)!.push(edge.toId);
		}
	}
	const depStageStatus: RunnerStageStatus = cycleSet.size > 0 ? 'failed' : 'completed';
	pushEvent('dependencies', null, depStageStatus, cycleSet.size > 0
		? `Detected dependency cycle involving ${cycleSet.size} resource(s).`
		: 'No cycles found in verified dependencies.', 5);

	// Stage 3: Static & Schema Checks (topological order where acyclic)
	pushEvent('checks', null, 'running', 'Running identifier, diagnostic, and schema checks.', 6);

	// Check duplicate labels across the architecture.
	const labelCounts = new Map<string, number>();
	for (const node of graph.nodes) {
		const key = `${node.kind}:${node.resourceType ?? ''}:${node.name.toLowerCase()}`;
		labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
	}

	const nodeResults: Record<string, RunnerNodeResult> = {};
	const failedOrBlocked = new Set<string>(cycleSet);

	// Topological sort over acyclic nodes so prerequisites evaluate before dependents.
	const inDeg = new Map<string, number>();
	for (const id of analyzedNodeIds) {
		if (!cycleSet.has(id)) {
			const preds = (upstreamByNode.get(id) ?? []).filter(p => !cycleSet.has(p));
			inDeg.set(id, preds.length);
		}
	}
	const queue = analyzedNodeIds.filter(id => !cycleSet.has(id) && (inDeg.get(id) ?? 0) === 0);
	const evalOrder: string[] = [...cycleSet];
	let head = 0;
	while (head < queue.length) {
		const cur = queue[head++];
		evalOrder.push(cur);
		for (const next of downstreamByNode.get(cur) ?? []) {
			if (cycleSet.has(next)) {
				continue;
			}
			const rem = (inDeg.get(next) ?? 1) - 1;
			inDeg.set(next, rem);
			if (rem === 0) {
				queue.push(next);
			}
		}
	}
	for (const id of analyzedNodeIds) {
		if (!evalOrder.includes(id)) {
			evalOrder.push(id);
		}
	}

	let uncoveredSchemaCount = 0;
	let findingCounter = 1;
	let offsetMs = 8;

	for (const id of evalOrder) {
		const node = nodeById.get(id);
		if (!node) {
			continue;
		}
		const findings: RunnerFinding[] = [];
		const schema = options.lookupSchema?.(node);
		const schemaCovered = schema !== undefined;
		if (!schemaCovered) {
			uncoveredSchemaCount++;
		}

		// Local identifier syntax always runs (check-level blocking: cycles never suppress syntax checks).
		if (!IDENTIFIER_PATTERN.test(node.name)) {
			findings.push({
				id: `f-${findingCounter++}`,
				nodeId: id,
				code: 'INVALID_IDENTIFIER',
				severity: 'error',
				message: `Resource name "${node.name}" is not a valid Terraform identifier.`,
				remediation: 'Use letters, digits, underscores, and dashes, starting with a letter or underscore.',
			});
		}
		const dupKey = `${node.kind}:${node.resourceType ?? ''}:${node.name.toLowerCase()}`;
		if ((labelCounts.get(dupKey) ?? 0) > 1) {
			findings.push({
				id: `f-${findingCounter++}`,
				nodeId: id,
				code: 'DUPLICATE_DECLARATION',
				severity: 'error',
				message: `Duplicate declaration "${node.label}" in this root.`,
				remediation: 'Rename one of the conflicting declarations in Terraform source.',
			});
		}

		if (cycleSet.has(id)) {
			const cyclePeers = [...cycleSet].filter(other => other !== id).map(other => nodeById.get(other)?.name ?? other);
			findings.push({
				id: `f-${findingCounter++}`,
				nodeId: id,
				code: 'DEPENDENCY_CYCLE',
				severity: 'error',
				message: `Dependency cycle detected${cyclePeers.length ? ` with ${cyclePeers.join(', ')}` : ''}.`,
				remediation: 'Break the circular reference between these declarations in Terraform source.',
			});
			nodeResults[id] = {
				nodeId: id,
				status: 'failed',
				reason: 'Dependency cycle prevents deterministic ordering.',
				blockedBy: [...cycleSet].filter(other => other !== id),
				findings,
				schemaCovered,
			};
			pushEvent('checks', id, 'failed', `${node.name}: failed due to dependency cycle.`, offsetMs++);
			continue;
		}

		const blockingPreds = (upstreamByNode.get(id) ?? []).filter(pred => failedOrBlocked.has(pred));
		if (blockingPreds.length > 0) {
			const blockerNames = blockingPreds.map(pred => nodeById.get(pred)?.name ?? pred);
			failedOrBlocked.add(id);
			nodeResults[id] = {
				nodeId: id,
				status: 'skipped',
				reason: `Blocked by prerequisite failure: ${blockerNames.join(', ')}.`,
				blockedBy: blockingPreds,
				findings,
				schemaCovered,
			};
			pushEvent('checks', id, 'skipped', `${node.name}: skipped (blocked by ${blockerNames.join(', ')}).`, offsetMs++);
			continue;
		}

		// Optional Phase 2 draft schema check when user has an active in-memory draft for this node.
		const draft = options.drafts?.get(id);
		if (schema && draft && options.renderDraft) {
			const rendered = options.renderDraft(schema, draft);
			for (const d of rendered.diagnostics) {
				findings.push({
					id: `f-${findingCounter++}`,
					nodeId: id,
					code: 'SCHEMA_DRAFT_CHECK',
					severity: d.severity,
					message: `${d.path || node.name}: ${d.message}`,
					remediation: 'Update the parameter in the Focused Resource Workspace or native HCL.',
				});
			}
		} else if (!schemaCovered) {
			findings.push({
				id: `f-${findingCounter++}`,
				nodeId: id,
				code: 'SCHEMA_UNAVAILABLE',
				severity: 'info',
				message: `No bundled provider schema for "${node.resourceType ?? node.kind}"; only static graph and identifier checks ran.`,
				remediation: 'Inspect native Terraform source or wait for live provider snapshot checks.',
			});
		}

		const hasError = findings.some(f => f.severity === 'error');
		const hasWarning = findings.some(f => f.severity === 'warning');
		const status: RunnerNodeStatus = hasError
			? 'failed'
			: hasWarning
				? 'warning'
				: 'success';

		if (hasError) {
			failedOrBlocked.add(id);
		}
		nodeResults[id] = {
			nodeId: id,
			status,
			...(hasError ? { reason: findings.find(f => f.severity === 'error')?.message } : {}),
			blockedBy: [],
			findings,
			schemaCovered,
		};
		pushEvent('checks', id, status, `${node.name}: ${status === 'success' ? 'passed static checks' : status}.`, offsetMs++);
	}

	if (uncoveredSchemaCount > 0) {
		coverageNotes.push(`${uncoveredSchemaCount} resource(s) lack a bundled provider schema; schema-level checks were not claimed as passed.`);
	}
	if (graph.diagnostics.length > 0) {
		coverageNotes.push(`Architecture reported ${graph.diagnostics.length} static parser diagnostic(s).`);
	}

	const anyNodeFailed = Object.values(nodeResults).some(r => r.status === 'failed');
	const anyGraphError = graph.diagnostics.some(d => d.severity.toLowerCase() === 'error');
	const anyWarning = Object.values(nodeResults).some(r => r.status === 'warning')
		|| graph.diagnostics.some(d => d.severity.toLowerCase() === 'warning')
		|| graph.status === 'partial';

	const checksStageStatus: RunnerStageStatus = anyNodeFailed || anyGraphError
		? 'failed'
		: anyWarning
			? 'warning'
			: 'completed';
	const outcome: RunnerOutcome = anyNodeFailed || anyGraphError
		? 'failed'
		: anyWarning
			? 'completed_with_warnings'
			: 'completed';
	const coverage: 'complete' | 'partial' = graph.status === 'partial' || uncoveredSchemaCount > 0 ? 'partial' : 'complete';
	const finishedAt = startedAt + offsetMs + 2;

	pushEvent('checks', null, checksStageStatus, `Validation finished: ${outcome.replace(/_/g, ' ')} (${coverage} coverage).`, offsetMs + 1);

	const stages: RunnerStageSummary[] = [
		{ id: 'read', label: 'Read Architecture', status: readStageStatus, durationMs: 2, detail: `Revision ${graph.sourceRevision.slice(0, 8)}` },
		{ id: 'dependencies', label: 'Map Dependencies', status: depStageStatus, durationMs: 3, detail: cycleSet.size > 0 ? `${cycleSet.size} cycle member(s)` : 'Acyclic' },
		{ id: 'checks', label: 'Static Checks', status: checksStageStatus, durationMs: Math.max(1, offsetMs - 6), detail: `${analyzedNodeIds.length} resource(s) checked` },
	];

	return {
		runId,
		attempt,
		previousRunId: options.previousRun?.runId ?? null,
		scope: options.scope,
		targetNodeId,
		analyzedNodeIds,
		workspaceId: graph.workspaceId,
		architectureId: graph.architectureId,
		capturedRevision: graph.sourceRevision,
		stale: false,
		outcome,
		coverage,
		coverageNotes,
		startedAtMs: startedAt,
		finishedAtMs: finishedAt,
		stages,
		nodeResults,
		cycleNodeIds: [...cycleSet],
		events,
	};
}

/** Cancels a running validation without allowing later updates to overwrite its terminal state. */
export function cancelValidationRun(run: ValidationRun, nowMs = Date.now()): ValidationRun {
	if (run.outcome === 'cancelled') {
		return run;
	}
	const updatedResults: Record<string, RunnerNodeResult> = {};
	for (const [id, result] of Object.entries(run.nodeResults)) {
		updatedResults[id] = result.status === 'pending' || result.status === 'running'
			? { ...result, status: 'skipped', reason: 'Cancelled by user.' }
			: result;
	}
	const nextSeq = (run.events.at(-1)?.sequence ?? 0) + 1;
	const events: readonly RunnerTimelineEvent[] = run.events.length < MAX_EVENTS
		? [...run.events, { sequence: nextSeq, timestampMs: nowMs, stage: 'checks', nodeId: null, status: 'skipped', message: 'Validation run cancelled by user.' }]
		: run.events;

	return {
		...run,
		outcome: 'cancelled',
		finishedAtMs: run.finishedAtMs ?? nowMs,
		nodeResults: updatedResults,
		events,
	};
}

/** Marks an existing run stale if the active architecture's source revision changes. */
export function syncRunWithRevision(run: ValidationRun | undefined, currentRevision: string): ValidationRun | undefined {
	if (!run) {
		return undefined;
	}
	if (run.capturedRevision === currentRevision) {
		return run;
	}
	return run.stale ? run : { ...run, stale: true };
}
