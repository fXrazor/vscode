/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Technical Graph Rebuild — Phase 2: Pure engineering workflows (focused lenses,
// upstream/downstream neighborhood & path tracing, contextual node inspection,
// troubleshooting & missing-prerequisite findings, and high-degree edge aggregation).
//
// Strictly read-only over `TechnicalGraphProjection`; never mutates `Architecture`,
// `History`, `Resource.positions`, or Terraform.

import { resourceIntelligence } from './providerKnowledge.ts';
import type {
	TechnicalGraphEdge,
	TechnicalGraphEdgeCategory,
	TechnicalGraphEdgeConfidence,
	TechnicalGraphEvidence,
	TechnicalGraphLens,
	TechnicalGraphNode,
	TechnicalGraphPattern,
	TechnicalGraphPlanOverlay,
	TechnicalGraphProjection,
	TechnicalGraphSchemaVersion,
	TechnicalGraphUnknown
} from './technicalGraphContract.ts';

export type LensArrowSemantics =
	| 'category-specific'
	| 'prerequisite-to-consumer'
	| 'owner-or-attachment'
	| 'runtime-intent-not-observed'
	| 'telemetry-collection-to-destination';

export interface TechnicalGraphLensDefinition {
	readonly id: TechnicalGraphLens;
	readonly label: string;
	readonly arrowSemantics: LensArrowSemantics;
	readonly arrowCaption: string;
	readonly categories: readonly TechnicalGraphEdgeCategory[];
	readonly orderingOnly: boolean;
	readonly boundaryNote: string;
}

export const TECHNICAL_GRAPH_LENSES: Readonly<Record<TechnicalGraphLens, TechnicalGraphLensDefinition>> = Object.freeze({
	all: Object.freeze({
		id: 'all',
		label: 'All Evidenced',
		arrowSemantics: 'category-specific',
		arrowCaption: 'Prerequisite / source -> consumer (see per-edge category)',
		categories: ['ownership', 'attachment', 'execution', 'reference', 'runtime', 'observability', 'unclassified'] as const,
		orderingOnly: false,
		boundaryNote: 'Displays every evidenced link without collapsing distinct semantic categories into a single traffic arrow.',
	}),
	dependencies: Object.freeze({
		id: 'dependencies',
		label: 'Dependencies',
		arrowSemantics: 'prerequisite-to-consumer',
		arrowCaption: 'Prerequisite -> consumer (configuration ordering)',
		categories: ['ownership', 'attachment', 'execution', 'reference'] as const,
		orderingOnly: true,
		boundaryNote: 'Configured creation/reference ordering only. This does not represent live network packet flow.',
	}),
	topology: Object.freeze({
		id: 'topology',
		label: 'Topology',
		arrowSemantics: 'owner-or-attachment',
		arrowCaption: 'Container / attachment -> resource',
		categories: ['ownership', 'attachment'] as const,
		orderingOnly: false,
		boundaryNote: 'Provider-backed structural ownership and evidenced attachments only; visual groups stay separate.',
	}),
	runtime: Object.freeze({
		id: 'runtime',
		label: 'Runtime Intent',
		arrowSemantics: 'runtime-intent-not-observed',
		arrowCaption: 'Configured runtime intent (not observed traffic)',
		categories: ['runtime', 'attachment'] as const,
		orderingOnly: false,
		boundaryNote: 'Configured runtime intent from declarations only; live reachability, firewall health, and cloud telemetry require runtime observation.',
	}),
	observability: Object.freeze({
		id: 'observability',
		label: 'Observability',
		arrowSemantics: 'telemetry-collection-to-destination',
		arrowCaption: 'Telemetry source -> sink / alert target',
		categories: ['observability'] as const,
		orderingOnly: false,
		boundaryNote: 'Shows evidenced diagnostic settings, log sinks, and alert targets declared in configuration.',
	}),
});

export interface LensFilteredGraph {
	readonly lens: TechnicalGraphLensDefinition;
	readonly visibleEdges: readonly TechnicalGraphEdge[];
	readonly hiddenEdgeCount: number;
	readonly connectedNodeIds: readonly string[];
	readonly isolatedNodeIds: readonly string[];
}

export type TraceHighlightRole = 'selected' | 'upstream' | 'downstream' | 'cycle' | 'dimmed';

export interface NodeNeighborhoodTrace {
	readonly focusNodeId: string;
	readonly lens: TechnicalGraphLens;
	readonly upstreamDirect: readonly string[];
	readonly upstreamTransitive: readonly string[];
	readonly downstreamDirect: readonly string[];
	readonly downstreamTransitive: readonly string[];
	readonly upstreamDistance: Readonly<Record<string, number>>;
	readonly downstreamDistance: Readonly<Record<string, number>>;
	readonly cycleMembers: readonly string[];
	readonly highlightedNodeIds: readonly string[];
	readonly highlightedEdgeIds: readonly string[];
	readonly dimmedNodeIds: readonly string[];
	readonly dimmedEdgeIds: readonly string[];
	readonly roleByNodeId: Readonly<Record<string, TraceHighlightRole>>;
}

export interface TracedPathHop {
	readonly edgeId: string;
	readonly fromId: string;
	readonly toId: string;
	readonly category: TechnicalGraphEdgeCategory;
	readonly ordering: boolean;
	readonly confidence: TechnicalGraphEdgeConfidence;
	readonly primaryField: string;
	readonly expression?: string;
	readonly meaning: string;
}

export interface TracedGraphPath {
	readonly nodeIds: readonly string[];
	readonly hops: readonly TracedPathHop[];
	readonly length: number;
	readonly allOrdering: boolean;
}

export interface TracePathsResult {
	readonly fromNodeId: string;
	readonly toNodeId: string;
	readonly lens: TechnicalGraphLens;
	readonly paths: readonly TracedGraphPath[];
	readonly truncated: boolean;
}

export type TroubleshootingFindingKind =
	| 'ordering-cycle'
	| 'validation-error'
	| 'validation-warning'
	| 'stale-overlay'
	| 'missing-expected-parent'
	| 'missing-expected-attachment'
	| 'unverified-evidence';

export type TroubleshootingSeverity = 'error' | 'warning' | 'info';

export interface TechnicalGraphTroubleshootingFinding {
	readonly id: string;
	readonly kind: TroubleshootingFindingKind;
	readonly severity: TroubleshootingSeverity;
	readonly nodeIds: readonly string[];
	readonly title: string;
	readonly detail: string;
	readonly evidence: string;
	readonly sourceRevision: string | null;
	readonly sourceTarget?: { readonly file: string; readonly line?: number };
	readonly nextCheck: string;
}

export interface InspectedLinkSummary {
	readonly edgeId: string;
	readonly direction: 'incoming' | 'outgoing';
	readonly peerNodeId: string;
	readonly peerDisplayName: string;
	readonly peerResourceType: string;
	readonly category: TechnicalGraphEdgeCategory;
	readonly ordering: boolean;
	readonly confidence: TechnicalGraphEdgeConfidence;
	readonly orderingVsTrafficNote: string;
	readonly provenance: readonly TechnicalGraphEvidence[];
}

export interface TechnicalGraphNodeInspection {
	readonly nodeId: string;
	readonly address: string;
	readonly displayName: string;
	readonly resourceType: string;
	readonly provider: TechnicalGraphNode['provider'];
	readonly layer: TechnicalGraphNode['layer'];
	readonly reviewStatus: TechnicalGraphNode['reviewStatus'];
	readonly schemaVersion: TechnicalGraphSchemaVersion;
	readonly sourceNavigation:
	| { readonly available: true; readonly file: string; readonly line?: number }
	| { readonly available: false; readonly reason: string };
	readonly structuralParentId?: string;
	readonly visualGroupId?: string;
	readonly uses: readonly InspectedLinkSummary[];
	readonly usedBy: readonly InspectedLinkSummary[];
	readonly impact: {
		readonly configuredDirectIds: readonly string[];
		readonly configuredTransitiveIds: readonly string[];
		readonly planOverlay?: TechnicalGraphPlanOverlay;
		readonly boundaryDisclaimer: string;
	};
	readonly patterns: readonly TechnicalGraphPattern[];
	readonly cycles: readonly (readonly string[])[];
	readonly findings: readonly TechnicalGraphTroubleshootingFinding[];
	readonly unknowns: readonly TechnicalGraphUnknown[];
	readonly neighborhood: NodeNeighborhoodTrace;
}

export interface AggregatedEdgeBundle {
	readonly bundleId: string;
	readonly hubNodeId: string;
	readonly direction: 'incoming' | 'outgoing';
	readonly category: TechnicalGraphEdgeCategory;
	readonly label: string;
	readonly count: number;
	readonly memberEdgeIds: readonly string[];
	readonly peerNodeIds: readonly string[];
}

export interface EdgeAggregationResult {
	readonly individualEdges: readonly TechnicalGraphEdge[];
	readonly bundles: readonly AggregatedEdgeBundle[];
	readonly threshold: number;
}

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

/**
 * Filters a `TechnicalGraphProjection` through a focused engineering lens and optional
 * user-hidden categories without mutating or duplicating the canonical architecture.
 */
export function filterTechnicalGraphByLens(
	projection: TechnicalGraphProjection,
	lensId: TechnicalGraphLens = 'all',
	hiddenCategories: readonly TechnicalGraphEdgeCategory[] = []
): LensFilteredGraph {
	const lens = TECHNICAL_GRAPH_LENSES[lensId];
	const allowed = new Set<TechnicalGraphEdgeCategory>(lens.categories);
	const hidden = new Set<TechnicalGraphEdgeCategory>(hiddenCategories);

	const visibleEdges = projection.edges.filter(edge => {
		if (!allowed.has(edge.category) || hidden.has(edge.category)) {
			return false;
		}
		if (lens.orderingOnly && !edge.ordering) {
			return false;
		}
		return true;
	});

	const connected = new Set<string>();
	for (const edge of visibleEdges) {
		connected.add(edge.sourceId);
		connected.add(edge.targetId);
	}

	const connectedNodeIds: string[] = [];
	const isolatedNodeIds: string[] = [];
	for (const node of projection.nodes) {
		if (connected.has(node.id)) {
			connectedNodeIds.push(node.id);
		} else {
			isolatedNodeIds.push(node.id);
		}
	}

	return freezeDeep({
		lens,
		visibleEdges,
		hiddenEdgeCount: projection.edges.length - visibleEdges.length,
		connectedNodeIds,
		isolatedNodeIds,
	});
}

/**
 * Traces upstream prerequisites and downstream configured dependents around `focusNodeId`
 * under the active lens, classifying every node and edge for focus/dim highlighting.
 */
export function traceNodeNeighborhood(
	projection: TechnicalGraphProjection,
	focusNodeId: string,
	options: {
		readonly lens?: TechnicalGraphLens;
		readonly hiddenCategories?: readonly TechnicalGraphEdgeCategory[];
		readonly orderingOnly?: boolean;
		readonly maxHops?: number;
	} = {}
): NodeNeighborhoodTrace {
	const lens = options.lens ?? 'all';
	const maxHops = Math.max(1, options.maxHops ?? 16);
	const filtered = filterTechnicalGraphByLens(projection, lens, options.hiddenCategories);
	const activeEdges = options.orderingOnly
		? filtered.visibleEdges.filter(edge => edge.ordering)
		: filtered.visibleEdges;

	const outgoingByNode = new Map<string, TechnicalGraphEdge[]>();
	const incomingByNode = new Map<string, TechnicalGraphEdge[]>();
	for (const edge of activeEdges) {
		const outList = outgoingByNode.get(edge.sourceId) ?? [];
		outList.push(edge);
		outgoingByNode.set(edge.sourceId, outList);
		const inList = incomingByNode.get(edge.targetId) ?? [];
		inList.push(edge);
		incomingByNode.set(edge.targetId, inList);
	}

	// Upstream BFS (follow incoming edges: consumer <- prerequisite)
	const upstreamDistance: Record<string, number> = {};
	const upstreamEdgeIds = new Set<string>();
	{
		const queue: { id: string; depth: number }[] = [{ id: focusNodeId, depth: 0 }];
		const visited = new Set<string>([focusNodeId]);
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.depth >= maxHops) {
				continue;
			}
			for (const edge of incomingByNode.get(current.id) ?? []) {
				upstreamEdgeIds.add(edge.id);
				if (!visited.has(edge.sourceId)) {
					visited.add(edge.sourceId);
					upstreamDistance[edge.sourceId] = current.depth + 1;
					queue.push({ id: edge.sourceId, depth: current.depth + 1 });
				}
			}
		}
	}

	// Downstream BFS (follow outgoing edges: prerequisite -> consumer)
	const downstreamDistance: Record<string, number> = {};
	const downstreamEdgeIds = new Set<string>();
	{
		const queue: { id: string; depth: number }[] = [{ id: focusNodeId, depth: 0 }];
		const visited = new Set<string>([focusNodeId]);
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.depth >= maxHops) {
				continue;
			}
			for (const edge of outgoingByNode.get(current.id) ?? []) {
				downstreamEdgeIds.add(edge.id);
				if (!visited.has(edge.targetId)) {
					visited.add(edge.targetId);
					downstreamDistance[edge.targetId] = current.depth + 1;
					queue.push({ id: edge.targetId, depth: current.depth + 1 });
				}
			}
		}
	}

	const cycleMemberSet = new Set<string>();
	for (const cycle of projection.cycles) {
		if (cycle.includes(focusNodeId)) {
			for (const member of cycle) {
				cycleMemberSet.add(member);
			}
		}
	}

	const upstreamDirect = Object.entries(upstreamDistance).filter(([, d]) => d === 1).map(([id]) => id).sort();
	const upstreamTransitive = Object.entries(upstreamDistance).filter(([, d]) => d > 1).map(([id]) => id).sort();
	const downstreamDirect = Object.entries(downstreamDistance).filter(([, d]) => d === 1).map(([id]) => id).sort();
	const downstreamTransitive = Object.entries(downstreamDistance).filter(([, d]) => d > 1).map(([id]) => id).sort();

	const highlightedNodeSet = new Set<string>([
		...(projection.nodes.some(n => n.id === focusNodeId) ? [focusNodeId] : []),
		...Object.keys(upstreamDistance),
		...Object.keys(downstreamDistance),
		...cycleMemberSet,
	]);

	const highlightedEdgeSet = new Set<string>([...upstreamEdgeIds, ...downstreamEdgeIds]);
	for (const edge of activeEdges) {
		if (cycleMemberSet.has(edge.sourceId) && cycleMemberSet.has(edge.targetId)) {
			highlightedEdgeSet.add(edge.id);
		}
	}

	const roleByNodeId: Record<string, TraceHighlightRole> = {};
	const dimmedNodeIds: string[] = [];
	for (const node of projection.nodes) {
		if (node.id === focusNodeId) {
			roleByNodeId[node.id] = 'selected';
		} else if (cycleMemberSet.has(node.id)) {
			roleByNodeId[node.id] = 'cycle';
		} else if (upstreamDistance[node.id] !== undefined) {
			roleByNodeId[node.id] = 'upstream';
		} else if (downstreamDistance[node.id] !== undefined) {
			roleByNodeId[node.id] = 'downstream';
		} else {
			roleByNodeId[node.id] = 'dimmed';
			dimmedNodeIds.push(node.id);
		}
	}

	const dimmedEdgeIds = activeEdges.filter(edge => !highlightedEdgeSet.has(edge.id)).map(edge => edge.id);

	return freezeDeep({
		focusNodeId,
		lens,
		upstreamDirect,
		upstreamTransitive,
		downstreamDirect,
		downstreamTransitive,
		upstreamDistance,
		downstreamDistance,
		cycleMembers: [...cycleMemberSet].sort(),
		highlightedNodeIds: [...highlightedNodeSet].sort(),
		highlightedEdgeIds: [...highlightedEdgeSet].sort(),
		dimmedNodeIds,
		dimmedEdgeIds,
		roleByNodeId,
	});
}

/**
 * Finds bounded simple directed paths from `fromNodeId` to `toNodeId` in shortest-first order,
 * preserving per-hop field/expression provenance so engineers can explain why two resources link.
 */
export function tracePathsBetweenNodes(
	projection: TechnicalGraphProjection,
	fromNodeId: string,
	toNodeId: string,
	options: {
		readonly lens?: TechnicalGraphLens;
		readonly hiddenCategories?: readonly TechnicalGraphEdgeCategory[];
		readonly orderingOnly?: boolean;
		readonly maxDepth?: number;
		readonly maxPaths?: number;
	} = {}
): TracePathsResult {
	const lens = options.lens ?? 'all';
	const maxDepth = Math.max(1, Math.min(12, options.maxDepth ?? 6));
	const maxPaths = Math.max(1, Math.min(25, options.maxPaths ?? 8));
	const filtered = filterTechnicalGraphByLens(projection, lens, options.hiddenCategories);
	const activeEdges = options.orderingOnly
		? filtered.visibleEdges.filter(edge => edge.ordering)
		: filtered.visibleEdges;

	if (fromNodeId === toNodeId) {
		return freezeDeep({ fromNodeId, toNodeId, lens, paths: [], truncated: false });
	}

	const outgoing = new Map<string, TechnicalGraphEdge[]>();
	for (const edge of activeEdges) {
		const list = outgoing.get(edge.sourceId) ?? [];
		list.push(edge);
		outgoing.set(edge.sourceId, list);
	}
	for (const list of outgoing.values()) {
		list.sort((a, b) => a.targetId.localeCompare(b.targetId) || a.id.localeCompare(b.id));
	}

	const paths: TracedGraphPath[] = [];
	let truncated = false;
	const queue: { readonly nodeIds: readonly string[]; readonly edges: readonly TechnicalGraphEdge[] }[] = [
		{ nodeIds: [fromNodeId], edges: [] },
	];
	let expandedStates = 0;
	const MAX_QUEUE_EXPANSIONS = 5000;

	while (queue.length > 0) {
		if (expandedStates >= MAX_QUEUE_EXPANSIONS) {
			truncated = true;
			break;
		}
		const state = queue.shift()!;
		expandedStates++;
		const tail = state.nodeIds[state.nodeIds.length - 1];
		if (state.edges.length >= maxDepth) {
			continue;
		}

		for (const edge of outgoing.get(tail) ?? []) {
			if (state.nodeIds.includes(edge.targetId)) {
				continue;
			}
			const nextNodes = [...state.nodeIds, edge.targetId];
			const nextEdges = [...state.edges, edge];
			if (edge.targetId === toNodeId) {
				const hops: TracedPathHop[] = nextEdges.map(hop => {
					const primary = hop.provenance[0];
					return {
						edgeId: hop.id,
						fromId: hop.sourceId,
						toId: hop.targetId,
						category: hop.category,
						ordering: hop.ordering,
						confidence: hop.confidence,
						primaryField: primary?.field ?? hop.category,
						...(primary?.expression ? { expression: primary.expression } : {}),
						meaning: primary?.meaning ?? 'Evidenced relationship.',
					};
				});
				paths.push({
					nodeIds: nextNodes,
					hops,
					length: hops.length,
					allOrdering: hops.every(h => h.ordering),
				});
				if (paths.length >= maxPaths) {
					truncated = queue.length > 0;
					return freezeDeep({ fromNodeId, toNodeId, lens, paths, truncated });
				}
			} else if (nextEdges.length < maxDepth) {
				queue.push({ nodeIds: nextNodes, edges: nextEdges });
			}
		}
	}

	return freezeDeep({ fromNodeId, toNodeId, lens, paths, truncated });
}

/**
 * Collects deterministic, evidence-scoped troubleshooting findings across a `TechnicalGraphProjection`.
 * Never predicts outages, prices, or live network reachability from generic edges.
 */
export function collectGraphTroubleshootingFindings(
	projection: TechnicalGraphProjection
): readonly TechnicalGraphTroubleshootingFinding[] {
	const findings: TechnicalGraphTroubleshootingFinding[] = [];
	const nodeById = new Map(projection.nodes.map(node => [node.id, node]));
	const incomingByNode = new Map<string, TechnicalGraphEdge[]>();
	for (const edge of projection.edges) {
		const list = incomingByNode.get(edge.targetId) ?? [];
		list.push(edge);
		incomingByNode.set(edge.targetId, list);
	}

	// 1. Ordering cycles (Tarjan SCCs)
	for (const cycle of projection.cycles) {
		const labels = cycle.map(id => nodeById.get(id)?.address ?? id);
		const firstSource = cycle.map(id => nodeById.get(id)?.source).find(Boolean);
		findings.push({
			id: `cycle:${cycle.join(',')}`,
			kind: 'ordering-cycle',
			severity: 'error',
			nodeIds: [...cycle],
			title: `Circular ordering dependency (${cycle.length} resources)`,
			detail: `Ordering references form a cycle across: ${labels.join(' -> ')}. Terraform/OpenTofu cannot resolve a circular resource graph.`,
			evidence: 'Detected via Tarjan strongly connected components over ordering edges.',
			sourceRevision: projection.sourceRevision,
			...(firstSource ? { sourceTarget: firstSource } : {}),
			nextCheck: 'Break one reference in the cycle (for example by extracting an explicit association resource or removing a redundant depends_on).',
		});
	}

	// 2. Per-node deterministic checks
	for (const node of projection.nodes) {
		const profile = resourceIntelligence(node.resourceType);
		const incoming = incomingByNode.get(node.id) ?? [];

		if (node.diagnosticCounts.errors > 0) {
			findings.push({
				id: `validate-err:${node.id}`,
				kind: 'validation-error',
				severity: 'error',
				nodeIds: [node.id],
				title: `${node.diagnosticCounts.errors} CLI validation error${node.diagnosticCounts.errors === 1 ? '' : 's'} on ${node.displayName}`,
				detail: `Current validate report flagged ${node.diagnosticCounts.errors} error(s) for ${node.address}.`,
				evidence: 'Current revision-matched engine validate report.',
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Open the resource source location or Issues panel to inspect exact CLI diagnostics.',
			});
		} else if (node.diagnosticCounts.warnings > 0) {
			findings.push({
				id: `validate-warn:${node.id}`,
				kind: 'validation-warning',
				severity: 'warning',
				nodeIds: [node.id],
				title: `${node.diagnosticCounts.warnings} CLI validation warning${node.diagnosticCounts.warnings === 1 ? '' : 's'} on ${node.displayName}`,
				detail: `Current validate report flagged ${node.diagnosticCounts.warnings} warning(s) for ${node.address}.`,
				evidence: 'Current revision-matched engine validate report.',
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Review validation warnings before running apply.',
			});
		}

		// Stale overlays
		const hasStalePlan = node.planOverlay?.status === 'stale';
		const hasStaleValidate = node.unknowns.some(u => u.kind === 'stale-validate');
		if (hasStalePlan || hasStaleValidate) {
			const parts = [hasStalePlan ? 'plan' : null, hasStaleValidate ? 'validate' : null].filter(Boolean);
			findings.push({
				id: `stale:${node.id}`,
				kind: 'stale-overlay',
				severity: 'warning',
				nodeIds: [node.id],
				title: `Stale ${parts.join(' and ')} overlay on ${node.displayName}`,
				detail: `Overlay data for ${node.address} belongs to an earlier source revision than the current graph.`,
				evidence: 'sourceRevision mismatch between graph snapshot and engine report.',
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Rerun local plan or validate against the current source revision.',
			});
		}

		// Missing expected structural parent (documented Terraform types only)
		if (
			profile.reviewStatus === 'documented'
			&& profile.fieldSyntax === 'terraform'
			&& profile.parentTypes.length > 0
			&& !node.structuralParentId
		) {
			findings.push({
				id: `missing-parent:${node.id}`,
				kind: 'missing-expected-parent',
				severity: 'warning',
				nodeIds: [node.id],
				title: `No evidenced structural parent for ${node.displayName}`,
				detail: `${node.resourceType} typically belongs to ${profile.parentTypes.join(' or ')}, but no ownership reference is evidenced in this graph.`,
				evidence: `Documented provider profile (${profile.sourceKey ?? node.resourceType}) with no incoming ownership edge.`,
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Verify whether the parent container is supplied by a variable, external data source, or missing configuration field.',
			});
		}

		// Missing expected attachment (documented Terraform types with reviewed attachment rules)
		const reviewedAttachmentRules = profile.reviewStatus === 'documented' && profile.fieldSyntax === 'terraform'
			? profile.rules.filter(rule => rule.category === 'attachment')
			: [];
		if (reviewedAttachmentRules.length > 0 && !incoming.some(edge => edge.category === 'attachment')) {
			const expectedFields = [...new Set(reviewedAttachmentRules.map(rule => rule.field))];
			findings.push({
				id: `missing-attachment:${node.id}`,
				kind: 'missing-expected-attachment',
				severity: 'info',
				nodeIds: [node.id],
				title: `No evidenced attachment on ${node.displayName}`,
				detail: `${node.resourceType} has reviewed attachment field(s) (${expectedFields.join(', ')}) with no resolved attachment edge in this graph.`,
				evidence: `Documented attachment rule(s) in ${profile.sourceKey ?? node.resourceType}; absence may reflect external IDs or unconfigured bindings.`,
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Check whether the attachment target is referenced via a variable/module output or needs to be configured.',
			});
		}

		// Surface high-signal unknowns (redacted secrets, opaque expressions, k8s manifest unmapped, partial graph)
		const highSignalUnknowns = node.unknowns.filter(u =>
			u.kind === 'opaque-expression'
			|| u.kind === 'redacted-value'
			|| u.kind === 'kubernetes-manifest-unmapped'
			|| u.kind === 'partial-source-graph'
			|| u.kind === 'missing-provider-lock'
		);
		if (highSignalUnknowns.length > 0) {
			findings.push({
				id: `unknowns:${node.id}`,
				kind: 'unverified-evidence',
				severity: 'info',
				nodeIds: [node.id],
				title: `${highSignalUnknowns.length} unverified evidence item${highSignalUnknowns.length === 1 ? '' : 's'} on ${node.displayName}`,
				detail: highSignalUnknowns.map(u => u.detail).join(' '),
				evidence: `Kinds: ${[...new Set(highSignalUnknowns.map(u => u.kind))].join(', ')}.`,
				sourceRevision: projection.sourceRevision,
				...(node.source ? { sourceTarget: node.source } : {}),
				nextCheck: 'Inspect the underlying HCL source or lock file; graph analysis intentionally avoids guessing opaque or redacted fields.',
			});
		}
	}

	const severityRank: Record<TroubleshootingSeverity, number> = { error: 0, warning: 1, info: 2 };
	findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id));
	return freezeDeep(findings);
}

/**
 * Builds a complete, readonly contextual inspection view-model for a selected node so any
 * Phase 2/3 details pane can explain every link, distinguish ordering from traffic, surface
 * missing prerequisites/cycles/unknowns, and offer direct source navigation.
 */
export function inspectTechnicalGraphNode(
	projection: TechnicalGraphProjection,
	nodeId: string,
	options: {
		readonly lens?: TechnicalGraphLens;
		readonly hiddenCategories?: readonly TechnicalGraphEdgeCategory[];
	} = {}
): TechnicalGraphNodeInspection | null {
	const node = projection.nodes.find(item => item.id === nodeId);
	if (!node) {
		return null;
	}
	const nodeById = new Map(projection.nodes.map(item => [item.id, item]));
	const neighborhood = traceNodeNeighborhood(projection, nodeId, options);
	const allFindings = collectGraphTroubleshootingFindings(projection);

	function toLinkSummary(edge: TechnicalGraphEdge, direction: 'incoming' | 'outgoing'): InspectedLinkSummary {
		const peerId = direction === 'incoming' ? edge.sourceId : edge.targetId;
		const peer = nodeById.get(peerId);
		const orderingVsTrafficNote = edge.category === 'runtime'
			? 'Configured runtime intent only; live network reachability requires observed cloud/cluster telemetry.'
			: edge.ordering
				? 'Establishes Terraform/OpenTofu configuration ordering. This is not a live traffic-flow arrow.'
				: 'Retained semantic/source relationship without proven configuration ordering.';
		return {
			edgeId: edge.id,
			direction,
			peerNodeId: peerId,
			peerDisplayName: peer?.displayName ?? peerId,
			peerResourceType: peer?.resourceType ?? 'unknown',
			category: edge.category,
			ordering: edge.ordering,
			confidence: edge.confidence,
			orderingVsTrafficNote,
			provenance: edge.provenance,
		};
	}

	const uses = projection.edges
		.filter(edge => edge.targetId === nodeId)
		.map(edge => toLinkSummary(edge, 'incoming'))
		.sort((a, b) => a.category.localeCompare(b.category) || a.peerDisplayName.localeCompare(b.peerDisplayName));

	const usedBy = projection.edges
		.filter(edge => edge.sourceId === nodeId)
		.map(edge => toLinkSummary(edge, 'outgoing'))
		.sort((a, b) => a.category.localeCompare(b.category) || a.peerDisplayName.localeCompare(b.peerDisplayName));

	const orderingImpact = traceNodeNeighborhood(projection, nodeId, { lens: 'all', orderingOnly: true });
	const boundaryDisclaimer = node.planOverlay?.status === 'current'
		? 'Plan action comes from a current local plan report. Configured dependents reflect declared references only and do not predict live outages or external resources.'
		: 'Configured dependents reflect declared references in this model only. Run a current Terraform/OpenTofu plan for actual replace/update/delete action impact.';

	return freezeDeep({
		nodeId: node.id,
		address: node.address,
		displayName: node.displayName,
		resourceType: node.resourceType,
		provider: node.provider,
		layer: node.layer,
		reviewStatus: node.reviewStatus,
		schemaVersion: node.schemaVersion,
		sourceNavigation: node.source
			? { available: true, file: node.source.file, ...(node.source.line !== undefined ? { line: node.source.line } : {}) }
			: { available: false, reason: 'This resource has no linked workspace .tf source location yet.' },
		...(node.structuralParentId ? { structuralParentId: node.structuralParentId } : {}),
		...(node.visualGroupId ? { visualGroupId: node.visualGroupId } : {}),
		uses,
		usedBy,
		impact: {
			configuredDirectIds: orderingImpact.downstreamDirect,
			configuredTransitiveIds: orderingImpact.downstreamTransitive,
			...(node.planOverlay ? { planOverlay: node.planOverlay } : {}),
			boundaryDisclaimer,
		},
		patterns: projection.patterns.filter(pattern => pattern.hubId === nodeId || pattern.spokeIds.includes(nodeId)),
		cycles: projection.cycles.filter(cycle => cycle.includes(nodeId)),
		findings: allFindings.filter(finding => finding.nodeIds.includes(nodeId)),
		unknowns: node.unknowns,
		neighborhood,
	});
}

/**
 * Aggregates high-degree edge fans per `(node, direction, category)` when count exceeds `threshold`,
 * preserving category distinctions and full inspectable membership lists. Edges touching `expandedNodeIds`
 * or `focusedNodeId` stay expanded so selection reveals exact paths.
 */
export function aggregateHighDegreeEdges(
	edges: readonly TechnicalGraphEdge[],
	options: {
		readonly threshold?: number;
		readonly expandedNodeIds?: ReadonlySet<string>;
		readonly focusedNodeId?: string | null;
	} = {}
): EdgeAggregationResult {
	const threshold = Math.max(2, options.threshold ?? 6);
	const expanded = options.expandedNodeIds ?? new Set<string>();
	const focused = options.focusedNodeId ?? null;

	const outgoingGroups = new Map<string, TechnicalGraphEdge[]>();
	const incomingGroups = new Map<string, TechnicalGraphEdge[]>();

	for (const edge of edges) {
		if (focused && (edge.sourceId === focused || edge.targetId === focused)) {
			continue;
		}
		if (!expanded.has(edge.sourceId)) {
			const outKey = `${edge.sourceId}|outgoing|${edge.category}`;
			const outList = outgoingGroups.get(outKey) ?? [];
			outList.push(edge);
			outgoingGroups.set(outKey, outList);
		}
		if (!expanded.has(edge.targetId)) {
			const inKey = `${edge.targetId}|incoming|${edge.category}`;
			const inList = incomingGroups.get(inKey) ?? [];
			inList.push(edge);
			incomingGroups.set(inKey, inList);
		}
	}

	const candidateBundles: AggregatedEdgeBundle[] = [];
	const collectCandidates = (groups: Map<string, TechnicalGraphEdge[]>, direction: 'incoming' | 'outgoing') => {
		for (const [key, list] of groups) {
			if (list.length <= threshold) {
				continue;
			}
			const [hubNodeId, , category] = key.split('|') as [string, string, TechnicalGraphEdgeCategory];
			const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
			const peerNodeIds = sorted.map(e => (direction === 'outgoing' ? e.targetId : e.sourceId));
			candidateBundles.push({
				bundleId: `bundle:${hubNodeId}:${direction}:${category}`,
				hubNodeId,
				direction,
				category,
				label: `+${sorted.length} ${category}${sorted.length === 1 ? '' : 's'}`,
				count: sorted.length,
				memberEdgeIds: sorted.map(e => e.id),
				peerNodeIds,
			});
		}
	};

	collectCandidates(outgoingGroups, 'outgoing');
	collectCandidates(incomingGroups, 'incoming');
	// Prefer largest fans first so an edge belongs to at most one bundle.
	candidateBundles.sort((a, b) => b.count - a.count || a.bundleId.localeCompare(b.bundleId));

	const claimedEdgeIds = new Set<string>();
	const bundles: AggregatedEdgeBundle[] = [];
	for (const candidate of candidateBundles) {
		const unclaimedIds = candidate.memberEdgeIds.filter(id => !claimedEdgeIds.has(id));
		if (unclaimedIds.length <= threshold) {
			continue;
		}
		const unclaimedSet = new Set(unclaimedIds);
		const peerNodeIds: string[] = [];
		for (let i = 0; i < candidate.memberEdgeIds.length; i++) {
			if (unclaimedSet.has(candidate.memberEdgeIds[i])) {
				claimedEdgeIds.add(candidate.memberEdgeIds[i]);
				peerNodeIds.push(candidate.peerNodeIds[i]);
			}
		}
		bundles.push({
			...candidate,
			count: unclaimedIds.length,
			label: `+${unclaimedIds.length} ${candidate.category}${unclaimedIds.length === 1 ? '' : 's'}`,
			memberEdgeIds: unclaimedIds,
			peerNodeIds,
		});
	}

	const individualEdges = edges.filter(edge => !claimedEdgeIds.has(edge.id));
	return freezeDeep({ individualEdges, bundles, threshold });
}
