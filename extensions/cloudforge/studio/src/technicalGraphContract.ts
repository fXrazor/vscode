/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Technical Graph Rebuild — Phase 1: Immutable, evidence-backed Technical Graph projection
// contract, source-expression & revision-bound plan/schema/lock adapters, Tarjan SCC cycle
// detection, capability audit, and strictly isolated graph-presentation state.
//
// Critical invariant:
//   Everything in this module is strictly read-only with respect to `Architecture` and `History`.
//   Graph layout, pins, route styles, density, filters, and selection live exclusively in
//   `TechnicalGraphPresentationState` and NEVER mutate `Resource.positions`, `parentId`,
//   `visualParentId`, container sizes, Terraform, Modified state, or project Undo.

import { resourceDefinition } from './fixture.ts';
import {
	configuredImpact,
	documentedHubSpokes,
	infrastructureRelationships,
	type InfrastructureRelationship
} from './infrastructureRelationships.ts';
import type { HostFormSchema, LiveSchemaMap } from './liveSchema.ts';
import type { Architecture, Position, Provider, Resource } from './model.ts';
import {
	resourceIntelligence,
	type InfrastructureLayer,
	type RelationshipCategory
} from './providerKnowledge.ts';
import { terraformIdentifier, visualParentId } from './resourceHierarchy.ts';
import type { FileBlockValues, FileResourceValues, FileValue } from './resourceValues.ts';
import type {
	HostDependencyReport,
	HostEnginePlanReport,
	HostEnginePlanResourceChange,
	HostEngineValidateReport,
	HostGraphSnapshot
} from './webviewBridge.ts';

export type TechnicalGraphPlanActionKind = HostEnginePlanResourceChange['actionKind'];

export type TechnicalGraphEdgeCategory = RelationshipCategory | 'unclassified';

export type TechnicalGraphEvidenceOrigin =
	| 'inherited'
	| 'binding'
	| 'source-expression'
	| 'service';

export type TechnicalGraphEdgeConfidence =
	| 'reviewed-rule'
	| 'configured-reference'
	| 'source-graph-summary'
	| 'unclassified';

export interface TechnicalGraphEvidence {
	readonly origin: TechnicalGraphEvidenceOrigin;
	readonly field: string;
	readonly expression?: string;
	readonly meaning: string;
	readonly sourceKey?: string;
	readonly providerVersion?: string;
}

export type TechnicalGraphUnknownKind =
	| 'unreviewed-type'
	| 'unverified-schema-version'
	| 'opaque-expression'
	| 'redacted-value'
	| 'partial-source-graph'
	| 'stale-plan'
	| 'stale-validate'
	| 'missing-provider-lock'
	| 'kubernetes-manifest-unmapped';

export interface TechnicalGraphUnknown {
	readonly kind: TechnicalGraphUnknownKind;
	readonly field?: string;
	readonly detail: string;
}

export interface TechnicalGraphAttachmentPort {
	readonly portId: string;
	readonly direction: 'incoming' | 'outgoing';
	readonly field: string;
	readonly category: TechnicalGraphEdgeCategory;
	readonly peerNodeId: string;
	readonly peerLabel: string;
	readonly evidenceOrigin: TechnicalGraphEvidenceOrigin;
	readonly expression?: string;
}

export interface TechnicalGraphSchemaVersion {
	readonly status: 'live-matched' | 'locked-only' | 'bundled-fallback' | 'unknown';
	readonly providerSource?: string;
	readonly providerVersion?: string;
	readonly coverageComplete?: boolean;
}

export interface TechnicalGraphPlanOverlay {
	readonly status: 'current' | 'stale';
	readonly engine: 'openTofu' | 'terraform';
	readonly engineVersion: string;
	readonly actionKind: TechnicalGraphPlanActionKind;
	readonly changedAttributePaths: readonly string[];
	readonly hasSensitiveAttributes: boolean;
}

export interface TechnicalGraphNode {
	readonly id: string;
	readonly address: string;
	readonly resourceType: string;
	readonly displayName: string;
	readonly provider: Provider;
	readonly layer: InfrastructureLayer;
	readonly reviewStatus: 'documented' | 'unreviewed';
	readonly source?: { readonly file: string; readonly line?: number };
	/** Provider-backed ownership parent only; never inferred from visual grouping alone. */
	readonly structuralParentId?: string;
	/** Visual grouping container when distinct from structural ownership. */
	readonly visualGroupId?: string;
	/** Bounded attachment/relationship port rows with stable IDs for dense graphs. */
	readonly attachmentPorts: readonly TechnicalGraphAttachmentPort[];
	readonly attachmentOverflowCount: number;
	readonly schemaVersion: TechnicalGraphSchemaVersion;
	readonly planOverlay?: TechnicalGraphPlanOverlay;
	readonly diagnosticCounts: { readonly errors: number; readonly warnings: number };
	readonly configuredDependentCounts: { readonly direct: number; readonly transitive: number };
	readonly unknowns: readonly TechnicalGraphUnknown[];
}

export interface TechnicalGraphEdge {
	readonly id: string;
	/** Prerequisite -> consumer direction for ordering edges; never a claimed packet-flow arrow. */
	readonly sourceId: string;
	readonly targetId: string;
	readonly sourcePortId: string;
	readonly targetPortId: string;
	readonly category: TechnicalGraphEdgeCategory;
	readonly ordering: boolean;
	readonly confidence: TechnicalGraphEdgeConfidence;
	readonly provenance: readonly TechnicalGraphEvidence[];
}

export interface TechnicalGraphPattern {
	readonly kind: 'hub-spoke';
	readonly hubId: string;
	readonly spokeIds: readonly string[];
	readonly confidence: 'configured-peerings';
}

export interface TechnicalGraphCapabilityAudit {
	readonly totalNodes: number;
	readonly documentedNodes: number;
	readonly unreviewedNodes: number;
	readonly liveSchemaNodes: number;
	readonly lockedProviderCount: number;
	readonly lockState: HostDependencyReport['lockState'] | 'unavailable';
	readonly fileValuesHydratedNodes: number;
	readonly planStatus: 'current' | 'stale' | 'failed' | 'absent';
	readonly validateStatus: 'current' | 'stale' | 'absent';
	readonly totalEdges: number;
	readonly reviewedRuleEdges: number;
	readonly sourceExpressionEdges: number;
	readonly unclassifiedEdges: number;
	readonly cycleCount: number;
	readonly totalUnknowns: number;
}

export interface TechnicalGraphProjection {
	readonly projectionVersion: 1;
	readonly architectureName: string;
	readonly sourceRevision: string | null;
	readonly graphStatus: 'complete' | 'partial' | 'sample';
	readonly nodes: readonly TechnicalGraphNode[];
	readonly edges: readonly TechnicalGraphEdge[];
	readonly patterns: readonly TechnicalGraphPattern[];
	readonly cycles: readonly (readonly string[])[];
	readonly capabilities: TechnicalGraphCapabilityAudit;
}

export interface TechnicalGraphProjectionInput {
	readonly architecture: Architecture;
	readonly snapshot?: HostGraphSnapshot | null;
	readonly resourceValues?: readonly FileResourceValues[];
	readonly liveSchemas?: LiveSchemaMap;
	readonly dependencyReport?: HostDependencyReport | null;
	readonly planReport?: HostEnginePlanReport | null;
	readonly validateReport?: HostEngineValidateReport | null;
	/** Maximum attachment port rows emitted per node before summarizing overflow (default 8). */
	readonly maxAttachmentPortsPerNode?: number;
}

export type GraphRouteStyle = 'curved' | 'orthogonal' | 'straight';
export type GraphDensityMode = 'compact' | 'standard' | 'detailed';

/**
 * Presentation-only state for the Technical Graph viewer.
 * Stored strictly apart from `Architecture`, `History`, and `Resource.positions`.
 */
export interface TechnicalGraphPresentationState {
	readonly routeStyle: GraphRouteStyle;
	readonly density: GraphDensityMode;
	readonly pins: Readonly<Record<string, Position>>;
	readonly collapsedGroupIds: readonly string[];
	readonly hiddenCategories: readonly TechnicalGraphEdgeCategory[];
	readonly selectedNodeId: string | null;
	readonly tracedNodeId: string | null;
}

const DEFAULT_MAX_PORTS_PER_NODE = 8;
const MAX_EXPRESSION_DEPTH = 8;

const RESERVED_REF_HEADS = new Set([
	'var',
	'local',
	'module',
	'data',
	'each',
	'self',
	'count',
	'path',
	'terraform',
	'true',
	'false',
	'null',
]);

function resourceAddress(resource: Resource, snapshotNodeById: ReadonlyMap<string, HostGraphSnapshot['nodes'][number]>): string {
	const snapNode = snapshotNodeById.get(resource.id);
	if (snapNode) {
		if (snapNode.kind === 'resource' && snapNode.resourceType) {
			return snapNode.name.includes('.') ? snapNode.name : `${snapNode.resourceType}.${snapNode.name}`;
		}
		if (snapNode.kind === 'data' && snapNode.resourceType) {
			return snapNode.name.startsWith('data.') ? snapNode.name : `data.${snapNode.resourceType}.${snapNode.name}`;
		}
		if (snapNode.kind === 'module') {
			return snapNode.name.startsWith('module.') ? snapNode.name : `module.${snapNode.name}`;
		}
	}
	const def = resourceDefinition(resource);
	const tfName = terraformIdentifier(resource);
	return resource.kind === 'module' ? `module.${tfName}` : `${def.type}.${tfName}`;
}

function providerPrefixOf(resourceType: string): 'azurerm' | 'aws' | 'google' | 'kubernetes' | undefined {
	if (resourceType.startsWith('azurerm_')) { return 'azurerm'; }
	if (resourceType.startsWith('aws_')) { return 'aws'; }
	if (resourceType.startsWith('google_')) { return 'google'; }
	if (resourceType.startsWith('kubernetes_')) { return 'kubernetes'; }
	return undefined;
}

function findLockedProviderVersion(
	resourceType: string,
	dependencyReport: HostDependencyReport | null | undefined
): { readonly source?: string; readonly version?: string } | undefined {
	if (!dependencyReport || dependencyReport.providers.length === 0) {
		return undefined;
	}
	const prefix = providerPrefixOf(resourceType);
	if (!prefix) {
		return undefined;
	}
	const match = dependencyReport.providers.find(prov => {
		const lower = prov.display.toLowerCase();
		return lower === prefix || lower.endsWith(`/${prefix}`);
	});
	if (!match) {
		return undefined;
	}
	return {
		source: match.display,
		...(match.lockedVersion ? { version: match.lockedVersion } : {}),
	};
}

interface ExtractedSourceExpressionResult {
	readonly edges: readonly {
		readonly sourceId: string;
		readonly targetId: string;
		readonly field: string;
		readonly expression: string;
	}[];
	readonly unknowns: readonly TechnicalGraphUnknown[];
}

const RESOURCE_REF_REGEX = /\b(data\.[A-Za-z_][A-Za-z0-9_-]*\.[A-Za-z_][A-Za-z0-9_-]*|[A-Za-z_][A-Za-z0-9_-]*_[A-Za-z0-9_-]*\.[A-Za-z_][A-Za-z0-9_-]*)\b/g;
const OPAQUE_EXPR_REGEX = /\b(for|lookup|merge|try|coalesce|flatten|toset|tolist|tomap|module|local)\b|\?/;

/**
 * Inspects sanitized `FileResourceValues` from Rust `readResourceValues` to extract explicit
 * HCL reference expressions without guessing dynamic/opaque expressions or leaking redacted values.
 */
export function extractFileExpressionEvidence(
	targetId: string,
	fileValues: FileResourceValues,
	addressToNodeId: ReadonlyMap<string, string>
): ExtractedSourceExpressionResult {
	const edges: { sourceId: string; targetId: string; field: string; expression: string }[] = [];
	const unknowns: TechnicalGraphUnknown[] = [];
	const seenEdge = new Set<string>();
	const seenUnknown = new Set<string>();

	function pushUnknown(kind: TechnicalGraphUnknownKind, field: string, detail: string) {
		const key = `${kind}:${field}`;
		if (seenUnknown.has(key)) {
			return;
		}
		seenUnknown.add(key);
		unknowns.push({ kind, field, detail });
	}

	function inspectValue(fieldPath: string, value: FileValue) {
		if (value.kind === 'redacted') {
			pushUnknown('redacted-value', fieldPath, `Field "${fieldPath}" is redacted in source summary; graph analysis never inspects sensitive values.`);
			return;
		}
		if (value.kind !== 'expression') {
			return;
		}
		const expr = value.text.trim();
		if (!expr) {
			return;
		}
		// Simple `var.NAME` bindings are represented as variable bindings, not opaque expressions.
		if (/^var\.[A-Za-z_][A-Za-z0-9_-]*$/.test(expr)) {
			return;
		}

		let matchedAnyKnownNode = false;
		RESOURCE_REF_REGEX.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = RESOURCE_REF_REGEX.exec(expr)) !== null) {
			const candidateAddress = match[1];
			const head = candidateAddress.split('.')[0];
			if (RESERVED_REF_HEADS.has(head) && head !== 'data') {
				continue;
			}
			const sourceId = addressToNodeId.get(candidateAddress);
			if (sourceId && sourceId !== targetId) {
				matchedAnyKnownNode = true;
				const edgeKey = `${sourceId}:${fieldPath}:${candidateAddress}`;
				if (!seenEdge.has(edgeKey)) {
					seenEdge.add(edgeKey);
					edges.push({ sourceId, targetId, field: fieldPath, expression: expr });
				}
			}
		}

		if (!matchedAnyKnownNode && OPAQUE_EXPR_REGEX.test(expr)) {
			pushUnknown(
				'opaque-expression',
				fieldPath,
				`Dynamic or indirect expression on "${fieldPath}" is not statically expanded into an inferred link.`
			);
		}
	}

	function walkAttributes(prefix: string, attrs: Readonly<Record<string, FileValue>>) {
		for (const [key, val] of Object.entries(attrs)) {
			const path = prefix ? `${prefix}.${key}` : key;
			inspectValue(path, val);
		}
	}

	function walkBlocks(prefix: string, blocks: readonly FileBlockValues[], depth: number) {
		if (depth > MAX_EXPRESSION_DEPTH) {
			return;
		}
		for (const block of blocks) {
			const nextPrefix = prefix ? `${prefix}.${block.name}` : block.name;
			walkAttributes(nextPrefix, block.attributes);
			walkBlocks(nextPrefix, block.blocks, depth + 1);
		}
	}

	walkAttributes('', fileValues.attributes);
	walkBlocks('', fileValues.blocks, 0);

	return { edges, unknowns };
}

/**
 * Tarjan strongly-connected-components cycle finder across `ordering === true` edges.
 * Returns only true cycles (size >= 2, or self-loops if present) in deterministic node order.
 */
export function detectOrderingCycles(
	nodeIds: readonly string[],
	edges: readonly Pick<TechnicalGraphEdge, 'sourceId' | 'targetId' | 'ordering'>[]
): readonly (readonly string[])[] {
	const adjacency = new Map<string, string[]>();
	for (const id of nodeIds) {
		adjacency.set(id, []);
	}
	for (const edge of edges) {
		if (!edge.ordering) {
			continue;
		}
		const list = adjacency.get(edge.sourceId);
		if (list && adjacency.has(edge.targetId) && !list.includes(edge.targetId)) {
			list.push(edge.targetId);
		}
	}

	let indexCounter = 0;
	const indexMap = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const cycles: string[][] = [];

	function strongConnect(v: string) {
		indexMap.set(v, indexCounter);
		lowlink.set(v, indexCounter);
		indexCounter++;
		stack.push(v);
		onStack.add(v);

		for (const w of adjacency.get(v) ?? []) {
			if (!indexMap.has(w)) {
				strongConnect(w);
				lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
			} else if (onStack.has(w)) {
				lowlink.set(v, Math.min(lowlink.get(v)!, indexMap.get(w)!));
			}
		}

		if (lowlink.get(v) === indexMap.get(v)) {
			const component: string[] = [];
			while (stack.length > 0) {
				const w = stack.pop()!;
				onStack.delete(w);
				component.push(w);
				if (w === v) {
					break;
				}
			}
			if (component.length > 1 || (component.length === 1 && (adjacency.get(v)?.includes(v) ?? false))) {
				component.sort();
				cycles.push(component);
			}
		}
	}

	for (const id of nodeIds) {
		if (!indexMap.has(id)) {
			strongConnect(id);
		}
	}
	return cycles;
}

function stablePortId(nodeId: string, direction: 'in' | 'out', field: string, peerNodeId: string): string {
	const safeField = field.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'link';
	return `${nodeId}:${direction}:${safeField}:${peerNodeId}`;
}

function confidenceFor(
	category: TechnicalGraphEdgeCategory,
	evidence: readonly TechnicalGraphEvidence[]
): TechnicalGraphEdgeConfidence {
	if (category === 'unclassified') {
		return 'unclassified';
	}
	if (evidence.some(item => item.sourceKey !== undefined)) {
		return 'reviewed-rule';
	}
	if (evidence.some(item => item.origin === 'binding' || item.origin === 'inherited' || item.origin === 'source-expression')) {
		return 'configured-reference';
	}
	return 'source-graph-summary';
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	Object.freeze(value);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

/**
 * Projects a deeply immutable, evidence-backed `TechnicalGraphProjection` from the canonical
 * `Architecture` plus optional revision-checked host payloads. Never mutates inputs.
 */
export function projectTechnicalGraph(input: TechnicalGraphProjectionInput): TechnicalGraphProjection {
	const {
		architecture,
		snapshot,
		resourceValues,
		liveSchemas,
		dependencyReport,
		planReport,
		validateReport,
	} = input;
	const maxPorts = Math.max(1, input.maxAttachmentPortsPerNode ?? DEFAULT_MAX_PORTS_PER_NODE);

	const sourceRevision = snapshot?.sourceRevision ?? null;
	const graphStatus: TechnicalGraphProjection['graphStatus'] = snapshot ? snapshot.status : 'sample';
	const snapshotNodeById = new Map((snapshot?.nodes ?? []).map(node => [node.id, node]));
	const resourceById = new Map(architecture.resources.map(res => [res.id, res]));
	const addressById = new Map<string, string>();
	const addressToNodeId = new Map<string, string>();

	for (const res of architecture.resources) {
		const addr = resourceAddress(res, snapshotNodeById);
		addressById.set(res.id, addr);
		if (!addressToNodeId.has(addr)) {
			addressToNodeId.set(addr, res.id);
		}
	}

	const fileValuesByAddress = new Map((resourceValues ?? []).map(item => [item.address, item]));

	// 1. Collect base relationships from canonical model & service edges.
	const baseRelationships: InfrastructureRelationship[] = infrastructureRelationships(architecture);
	const groupedEdges = new Map<string, {
		readonly id: string;
		readonly sourceId: string;
		readonly targetId: string;
		readonly category: TechnicalGraphEdgeCategory;
		ordering: boolean;
		readonly provenance: TechnicalGraphEvidence[];
	}>();

	function addEdgeEvidence(
		sourceId: string,
		targetId: string,
		category: TechnicalGraphEdgeCategory,
		ordering: boolean,
		evidence: TechnicalGraphEvidence
	) {
		if (sourceId === targetId || !resourceById.has(sourceId) || !resourceById.has(targetId)) {
			return;
		}
		const id = `graph-edge:${JSON.stringify([sourceId, targetId, category])}`;
		let current = groupedEdges.get(id);
		if (!current) {
			current = { id, sourceId, targetId, category, ordering, provenance: [] };
			groupedEdges.set(id, current);
		} else if (ordering) {
			current.ordering = true;
		}
		if (!current.provenance.some(item =>
			item.field === evidence.field && item.expression === evidence.expression && item.origin === evidence.origin
		)) {
			current.provenance.push(evidence);
		}
	}

	for (const rel of baseRelationships) {
		const consumer = resourceById.get(rel.target);
		const consumerType = consumer ? resourceDefinition(consumer).type : '';
		const locked = findLockedProviderVersion(consumerType, dependencyReport);
		for (const ev of rel.evidence) {
			addEdgeEvidence(rel.source, rel.target, rel.category, rel.ordering, {
				origin: ev.origin,
				field: ev.field,
				...(ev.expression ? { expression: ev.expression } : {}),
				meaning: ev.meaning,
				...(ev.sourceKey ? { sourceKey: ev.sourceKey } : {}),
				...(locked?.version ? { providerVersion: locked.version } : {}),
			});
		}
	}

	// 2. Augment with explicit HCL expressions from Rust `readResourceValues` (never guessing opaque expressions).
	const nodeUnknowns = new Map<string, TechnicalGraphUnknown[]>();
	let fileValuesHydratedNodes = 0;

	for (const res of architecture.resources) {
		const unknowns: TechnicalGraphUnknown[] = [];
		nodeUnknowns.set(res.id, unknowns);
		const addr = addressById.get(res.id)!;
		const fv = fileValuesByAddress.get(addr);
		if (!fv) {
			continue;
		}
		fileValuesHydratedNodes++;
		const consumerType = resourceDefinition(res).type;
		const profile = resourceIntelligence(consumerType);
		const locked = findLockedProviderVersion(consumerType, dependencyReport);
		const extracted = extractFileExpressionEvidence(res.id, fv, addressToNodeId);
		unknowns.push(...extracted.unknowns);

		for (const exprEdge of extracted.edges) {
			const sourceRes = resourceById.get(exprEdge.sourceId);
			if (!sourceRes) {
				continue;
			}
			const sourceType = resourceDefinition(sourceRes).type;
			const rule = profile.fieldSyntax === 'terraform'
				? profile.rules.find(item => item.field === exprEdge.field && (item.targets.includes(sourceType) || item.targets.includes('*')))
				: undefined;
			addEdgeEvidence(exprEdge.sourceId, exprEdge.targetId, rule?.category ?? 'reference', true, {
				origin: 'source-expression',
				field: exprEdge.field,
				expression: exprEdge.expression,
				meaning: rule?.meaning ?? 'Source HCL expression reference; no reviewed attachment or ownership rule for this field.',
				...(rule && profile.sourceKey ? { sourceKey: profile.sourceKey } : {}),
				...(locked?.version ? { providerVersion: locked.version } : {}),
			});
		}
	}

	// 3. Finalize immutable edges with stable attachment port IDs derived from (node, field, peer).
	const edges: TechnicalGraphEdge[] = [...groupedEdges.values()].map(edge => {
		const primaryField = edge.provenance[0]?.field ?? edge.category;
		return {
			id: edge.id,
			sourceId: edge.sourceId,
			targetId: edge.targetId,
			sourcePortId: stablePortId(edge.sourceId, 'out', primaryField, edge.targetId),
			targetPortId: stablePortId(edge.targetId, 'in', primaryField, edge.sourceId),
			category: edge.category,
			ordering: edge.ordering,
			confidence: confidenceFor(edge.category, edge.provenance),
			provenance: edge.provenance,
		};
	});

	// 4. Plan & validation overlay revision checks.
	const planStatus: TechnicalGraphCapabilityAudit['planStatus'] = !planReport
		? 'absent'
		: planReport.status === 'failed'
			? 'failed'
			: sourceRevision && planReport.sourceRevision !== sourceRevision
				? 'stale'
				: 'current';
	const validateStatus: TechnicalGraphCapabilityAudit['validateStatus'] = !validateReport
		? 'absent'
		: sourceRevision && validateReport.sourceRevision !== sourceRevision
			? 'stale'
			: 'current';

	const planByAddress = new Map((planReport?.resourceChanges ?? []).map(change => [change.address, change]));
	const diagCountsByAddress = new Map<string, { errors: number; warnings: number }>();
	if (validateReport && validateStatus === 'current') {
		for (const diag of validateReport.diagnostics) {
			if (!diag.address) {
				continue;
			}
			const counts = diagCountsByAddress.get(diag.address) ?? { errors: 0, warnings: 0 };
			if (diag.severity === 'error') {
				counts.errors++;
			} else {
				counts.warnings++;
			}
			diagCountsByAddress.set(diag.address, counts);
		}
	}

	// 5. Build immutable nodes with schema version provenance, bounded attachment ports, impact, and explicit unknowns.
	const allRelationships: InfrastructureRelationship[] = edges.map(edge => ({
		id: edge.id,
		source: edge.sourceId,
		target: edge.targetId,
		category: edge.category,
		ordering: edge.ordering,
		evidence: edge.provenance.map(ev => ({
			origin: ev.origin === 'source-expression' ? 'binding' : ev.origin,
			field: ev.field,
			expression: ev.expression,
			meaning: ev.meaning,
			sourceKey: ev.sourceKey,
		})),
	}));

	let documentedNodes = 0;
	let unreviewedNodes = 0;
	let liveSchemaNodes = 0;
	let totalUnknowns = 0;

	const nodes: TechnicalGraphNode[] = architecture.resources.map(res => {
		const def = resourceDefinition(res);
		const addr = addressById.get(res.id)!;
		const snapNode = snapshotNodeById.get(res.id);
		const profile = resourceIntelligence(def.type);
		const unknowns = [...(nodeUnknowns.get(res.id) ?? [])];

		if (profile.reviewStatus === 'documented') {
			documentedNodes++;
		} else {
			unreviewedNodes++;
			unknowns.push({
				kind: 'unreviewed-type',
				detail: `No reviewed provider relationship rules for "${def.type}"; inspect its version-matched schema.`,
			});
		}
		if (profile.fieldSyntax === 'kubernetes-manifest') {
			unknowns.push({
				kind: 'kubernetes-manifest-unmapped',
				detail: `Kubernetes manifest paths for "${def.type}" require an explicit Terraform provider adapter before field matching.`,
			});
		}
		if (graphStatus === 'partial') {
			unknowns.push({
				kind: 'partial-source-graph',
				detail: 'Source graph is partial; some dependencies or attributes may be absent.',
			});
		}

		// Schema version provenance (reusing liveSchemas, dependencyReport, and catalogue metadata).
		const liveSchema: HostFormSchema | undefined = liveSchemas?.[def.type];
		const lockedProvider = findLockedProviderVersion(def.type, dependencyReport);
		let schemaVersion: TechnicalGraphSchemaVersion;
		if (liveSchema) {
			liveSchemaNodes++;
			schemaVersion = {
				status: 'live-matched',
				providerSource: liveSchema.providerSource,
				providerVersion: liveSchema.providerVersion,
				...(liveSchema.coverage ? { coverageComplete: liveSchema.coverage.complete } : {}),
			};
		} else if (lockedProvider?.version) {
			schemaVersion = {
				status: 'locked-only',
				providerSource: lockedProvider.source,
				providerVersion: lockedProvider.version,
			};
			unknowns.push({
				kind: 'unverified-schema-version',
				detail: `Provider lock pins ${lockedProvider.source ?? def.type} ${lockedProvider.version}, but no live schema snapshot is loaded for this type.`,
			});
		} else if (res.catalogue?.providerVersion || res.catalogue?.providerSource) {
			schemaVersion = {
				status: 'bundled-fallback',
				...(res.catalogue.providerSource ? { providerSource: res.catalogue.providerSource } : {}),
				...(res.catalogue.providerVersion ? { providerVersion: res.catalogue.providerVersion } : {}),
			};
			unknowns.push({
				kind: 'unverified-schema-version',
				detail: 'Using bundled catalogue metadata; import a version-matched provider schema snapshot to verify constraints.',
			});
		} else {
			schemaVersion = { status: 'unknown' };
			unknowns.push({
				kind: 'unverified-schema-version',
				detail: `No live schema or lock-file version is available for "${def.type}".`,
			});
		}

		if (dependencyReport && dependencyReport.lockState === 'absent') {
			unknowns.push({
				kind: 'missing-provider-lock',
				detail: 'No .terraform.lock.hcl file was found; provider version applicability is unpinned.',
			});
		}

		// Structural ownership parent (provider-backed ownership edge ONLY) vs visual grouping.
		const ownershipEdge = edges.find(edge => edge.targetId === res.id && edge.category === 'ownership');
		const structuralParentId = ownershipEdge?.sourceId;
		const visualParent = visualParentId(res);
		const visualGroupId = visualParent && visualParent !== structuralParentId && resourceById.has(visualParent)
			? visualParent
			: undefined;

		// Bounded attachment/relationship port rows with deterministic ordering & overflow count.
		const allPorts: TechnicalGraphAttachmentPort[] = [];
		for (const edge of edges) {
			if (edge.targetId === res.id) {
				const peer = resourceById.get(edge.sourceId);
				const primary = edge.provenance[0];
				allPorts.push({
					portId: edge.targetPortId,
					direction: 'incoming',
					field: primary?.field ?? edge.category,
					category: edge.category,
					peerNodeId: edge.sourceId,
					peerLabel: peer?.name ?? edge.sourceId,
					evidenceOrigin: primary?.origin ?? 'service',
					...(primary?.expression ? { expression: primary.expression } : {}),
				});
			} else if (edge.sourceId === res.id) {
				const peer = resourceById.get(edge.targetId);
				const primary = edge.provenance[0];
				allPorts.push({
					portId: edge.sourcePortId,
					direction: 'outgoing',
					field: primary?.field ?? edge.category,
					category: edge.category,
					peerNodeId: edge.targetId,
					peerLabel: peer?.name ?? edge.targetId,
					evidenceOrigin: primary?.origin ?? 'service',
					...(primary?.expression ? { expression: primary.expression } : {}),
				});
			}
		}
		allPorts.sort((a, b) =>
			(a.direction === b.direction ? 0 : a.direction === 'incoming' ? -1 : 1)
			|| a.category.localeCompare(b.category)
			|| a.field.localeCompare(b.field)
			|| a.peerNodeId.localeCompare(b.peerNodeId)
		);
		const attachmentPorts = allPorts.slice(0, maxPorts);
		const attachmentOverflowCount = Math.max(0, allPorts.length - attachmentPorts.length);

		// Revision-bound plan overlay.
		const matchedPlan = planByAddress.get(addr);
		let planOverlay: TechnicalGraphPlanOverlay | undefined;
		if (planReport && matchedPlan) {
			const isStale = planStatus === 'stale';
			planOverlay = {
				status: isStale ? 'stale' : 'current',
				engine: planReport.engine,
				engineVersion: planReport.engineVersion,
				actionKind: matchedPlan.actionKind,
				changedAttributePaths: [...matchedPlan.changedAttributePaths],
				hasSensitiveAttributes: matchedPlan.hasSensitiveAttributes,
			};
			if (isStale) {
				unknowns.push({
					kind: 'stale-plan',
					detail: 'Local plan report was captured against an older source revision; rerun plan to refresh change impact.',
				});
			}
		}
		if (validateStatus === 'stale') {
			unknowns.push({
				kind: 'stale-validate',
				detail: 'CLI validate diagnostics were captured against an older source revision.',
			});
		}

		const impact = configuredImpact(allRelationships, res.id);
		const diagCounts = diagCountsByAddress.get(addr) ?? { errors: 0, warnings: 0 };
		const sourceFile = res.sourceFile ?? snapNode?.sourceFile;
		const sourceLine = res.sourceLine ?? snapNode?.sourceLine;
		totalUnknowns += unknowns.length;

		return {
			id: res.id,
			address: addr,
			resourceType: def.type,
			displayName: res.name,
			provider: res.provider,
			layer: profile.layer,
			reviewStatus: profile.reviewStatus,
			...(sourceFile ? { source: { file: sourceFile, ...(sourceLine ? { line: sourceLine } : {}) } } : {}),
			...(structuralParentId ? { structuralParentId } : {}),
			...(visualGroupId ? { visualGroupId } : {}),
			attachmentPorts,
			attachmentOverflowCount,
			schemaVersion,
			...(planOverlay ? { planOverlay } : {}),
			diagnosticCounts: diagCounts,
			configuredDependentCounts: { direct: impact.direct.length, transitive: impact.transitive.length },
			unknowns,
		};
	});

	// 6. Evidence-backed patterns & dependency cycles (reusing all evidenced relationships, including source expressions).
	const patterns: TechnicalGraphPattern[] = documentedHubSpokes(architecture, allRelationships).map(star => ({
		kind: 'hub-spoke',
		hubId: star.hub,
		spokeIds: [...star.spokes],
		confidence: star.confidence,
	}));
	const cycles = detectOrderingCycles(nodes.map(node => node.id), edges);

	const capabilities: TechnicalGraphCapabilityAudit = {
		totalNodes: nodes.length,
		documentedNodes,
		unreviewedNodes,
		liveSchemaNodes,
		lockedProviderCount: dependencyReport?.providers.filter(p => p.status === 'locked').length ?? 0,
		lockState: dependencyReport ? dependencyReport.lockState : 'unavailable',
		fileValuesHydratedNodes,
		planStatus,
		validateStatus,
		totalEdges: edges.length,
		reviewedRuleEdges: edges.filter(e => e.confidence === 'reviewed-rule').length,
		sourceExpressionEdges: edges.filter(e => e.provenance.some(p => p.origin === 'source-expression')).length,
		unclassifiedEdges: edges.filter(e => e.category === 'unclassified').length,
		cycleCount: cycles.length,
		totalUnknowns,
	};

	return deepFreeze({
		projectionVersion: 1 as const,
		architectureName: architecture.name,
		sourceRevision,
		graphStatus,
		nodes,
		edges,
		patterns,
		cycles,
		capabilities,
	});
}

// ---------------------------------------------------------------------------
// Isolated Graph Presentation State (NEVER touches Architecture or History)
// ---------------------------------------------------------------------------

export function createTechnicalGraphPresentationState(): TechnicalGraphPresentationState {
	return deepFreeze({
		routeStyle: 'curved' as const,
		density: 'standard' as const,
		pins: {},
		collapsedGroupIds: [],
		hiddenCategories: [],
		selectedNodeId: null,
		tracedNodeId: null,
	});
}

export function setGraphNodePin(
	state: TechnicalGraphPresentationState,
	nodeId: string,
	position: Position
): TechnicalGraphPresentationState {
	if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
		return state;
	}
	return deepFreeze({
		...state,
		pins: { ...state.pins, [nodeId]: { x: Math.round(position.x), y: Math.round(position.y) } },
	});
}

export function clearGraphNodePins(
	state: TechnicalGraphPresentationState,
	nodeIds?: readonly string[]
): TechnicalGraphPresentationState {
	if (!nodeIds) {
		return deepFreeze({ ...state, pins: {} });
	}
	const remove = new Set(nodeIds);
	const nextPins: Record<string, Position> = {};
	for (const [id, pos] of Object.entries(state.pins)) {
		if (!remove.has(id)) {
			nextPins[id] = pos;
		}
	}
	return deepFreeze({ ...state, pins: nextPins });
}

export function setGraphRouteStyle(
	state: TechnicalGraphPresentationState,
	routeStyle: GraphRouteStyle
): TechnicalGraphPresentationState {
	return state.routeStyle === routeStyle ? state : deepFreeze({ ...state, routeStyle });
}

export function setGraphDensity(
	state: TechnicalGraphPresentationState,
	density: GraphDensityMode
): TechnicalGraphPresentationState {
	return state.density === density ? state : deepFreeze({ ...state, density });
}

export function toggleGraphCollapsedGroup(
	state: TechnicalGraphPresentationState,
	groupId: string
): TechnicalGraphPresentationState {
	const exists = state.collapsedGroupIds.includes(groupId);
	const collapsedGroupIds = exists
		? state.collapsedGroupIds.filter(id => id !== groupId)
		: [...state.collapsedGroupIds, groupId];
	return deepFreeze({ ...state, collapsedGroupIds });
}

export function setGraphHiddenCategories(
	state: TechnicalGraphPresentationState,
	hiddenCategories: readonly TechnicalGraphEdgeCategory[]
): TechnicalGraphPresentationState {
	return deepFreeze({ ...state, hiddenCategories: [...new Set(hiddenCategories)] });
}

export function setGraphSelection(
	state: TechnicalGraphPresentationState,
	selectedNodeId: string | null,
	tracedNodeId: string | null = state.tracedNodeId
): TechnicalGraphPresentationState {
	return deepFreeze({ ...state, selectedNodeId, tracedNodeId });
}

/** Prunes pins, collapsed groups, and selection referencing nodes removed by a refresh. */
export function pruneGraphPresentationState(
	state: TechnicalGraphPresentationState,
	validNodeIds: ReadonlySet<string>
): TechnicalGraphPresentationState {
	const pins: Record<string, Position> = {};
	for (const [id, pos] of Object.entries(state.pins)) {
		if (validNodeIds.has(id)) {
			pins[id] = pos;
		}
	}
	return deepFreeze({
		...state,
		pins,
		collapsedGroupIds: state.collapsedGroupIds.filter(id => validNodeIds.has(id)),
		selectedNodeId: state.selectedNodeId && validNodeIds.has(state.selectedNodeId) ? state.selectedNodeId : null,
		tracedNodeId: state.tracedNodeId && validNodeIds.has(state.tracedNodeId) ? state.tracedNodeId : null,
	});
}
