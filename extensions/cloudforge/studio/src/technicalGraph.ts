/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Technical Graph projection contract (Phase 1).
 *
 * The snapshot is a detached, deeply frozen projection of the canonical Architecture. It copies
 * primitive values only, so a renderer or layout engine (React Flow, D3 force/hierarchy, a worker)
 * can never reach `Resource.positions`, `parentId`, containers or connection records through it.
 * Every edge carries the instance-level evidence that produced it; nothing is joined by type
 * compatibility, name or proximity. Missing facts stay `unknown`.
 */
import type { Architecture, Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { infrastructureLayers, resourceIntelligence, type InfrastructureLayer, type RelationshipCategory } from './providerKnowledge.ts';
import { documentedHubSpokes, infrastructureRelationships, type InfrastructureRelationship } from './infrastructureRelationships.ts';
import { resourceAddress, resourceAncestors } from './resourceHierarchy.ts';

export type GraphCategory = RelationshipCategory | 'unclassified';
/** Focused lenses. One universal arrow direction would misrepresent these meanings. */
export type GraphLens = 'all' | 'dependencies' | 'topology' | 'runtime' | 'observability';
export const graphLenses: { id: GraphLens; label: string; hint: string }[] = [
	{ id: 'all', label: 'All', hint: 'Every evidenced relationship' },
	{ id: 'dependencies', label: 'Dependencies', hint: 'Prerequisite → consumer (Terraform ordering)' },
	{ id: 'topology', label: 'Topology', hint: 'Ownership and attachments' },
	{ id: 'runtime', label: 'Runtime', hint: 'Configured runtime intent' },
	{ id: 'observability', label: 'Observability', hint: 'Telemetry source → destination' },
];
export const lensCategories: Record<GraphLens, readonly GraphCategory[]> = {
	all: ['ownership', 'attachment', 'execution', 'reference', 'runtime', 'observability', 'unclassified'],
	dependencies: ['ownership', 'attachment', 'execution', 'reference', 'unclassified'],
	topology: ['ownership', 'attachment'],
	runtime: ['runtime'],
	observability: ['observability'],
};

export interface GraphEvidence {
	readonly origin: 'inherited' | 'binding' | 'service';
	readonly field: string;
	readonly expression?: string;
	readonly meaning: string;
	readonly sourceKey?: string;
}
export interface GraphPort {
	/** Stable: resource id + field path + peer id. Never an array index or a screen position. */
	readonly id: string;
	readonly field: string;
	readonly peer: string;
	readonly peerLabel: string;
	readonly category: GraphCategory;
	readonly edgeId: string;
}
export interface GraphNode {
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly address: string;
	readonly type: string;
	readonly typeLabel: string;
	readonly icon: string;
	readonly provider: string;
	readonly layer: InfrastructureLayer;
	readonly reviewStatus: 'documented' | 'unreviewed';
	readonly region: { readonly value: string; readonly known: boolean };
	/** Nearest ownership scope (resource group, VNet, VPC …) from configured parentage, or undefined. */
	readonly scope?: string;
	/** Ownership chain root → nearest, for tree and scope layouts. */
	readonly scopePath: readonly string[];
	readonly isScope: boolean;
	readonly costCategory: string;
	readonly blastRadiusCategory: string;
	readonly sourceFile?: string;
	readonly sourceLine?: number;
	/** Inputs this resource consumes, as labelled attachment rows. */
	readonly ports: readonly GraphPort[];
	readonly inDegree: number;
	readonly outDegree: number;
	readonly inCycle: boolean;
}
export interface GraphEdge {
	readonly id: string;
	/** Prerequisite → consumer. */
	readonly source: string;
	readonly target: string;
	readonly category: GraphCategory;
	readonly ordering: boolean;
	readonly confidence: 'configured' | 'source-graph' | 'unclassified';
	/** Membership in a scope node (e.g. resource_group_name) is shown as a chip, not a line, unless asked. */
	readonly membership: boolean;
	readonly targetPort: string;
	readonly evidence: readonly GraphEvidence[];
}
/** A Terraform input a resource reads but that is not a managed resource card: var., local. or data. */
export interface GraphInput {
	readonly id: string;
	readonly kind: 'variable' | 'local' | 'data';
	/** Terraform address, e.g. `var.kubernetes_version` or `data.azurerm_client_config.current`. */
	readonly address: string;
	readonly label: string;
	readonly sensitive: boolean;
	/** Declared in the project (variables list) or only referenced in an expression. */
	readonly declared: boolean;
	readonly consumers: readonly { readonly resourceId: string; readonly field: string }[];
}
export interface TechnicalGraphSnapshot {
	readonly revision: string;
	/** Ghost inputs. Never part of `nodes`/`edges`, so ordering, waves, cycles and impact stay resource-only. */
	readonly inputs: readonly GraphInput[];
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly hubSpokes: readonly { readonly hub: string; readonly spokes: readonly string[] }[];
	readonly cycles: readonly (readonly string[])[];
	readonly coverage: { readonly documented: number; readonly unreviewed: number; readonly unknownRegion: number };
}

const scopeTypes = new Set(['azurerm_resource_group', 'azurerm_virtual_network', 'azurerm_subnet', 'aws_vpc', 'aws_subnet', 'google_compute_network', 'google_compute_subnetwork', 'kubernetes_namespace_v1']);
const kindLayer: Record<Resource['kind'], InfrastructureLayer> = { network: 'network', subnet: 'network', gateway: 'network', cluster: 'compute', compute: 'compute', storage: 'data', database: 'data', monitor: 'monitoring', group: 'scope', module: 'application', generic: 'unknown' };

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) { deepFreeze(item); } }
	return value;
}
function hash(text: string): string { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }

/** Tarjan strongly connected components over ordering edges; only components of size > 1 (or self loops). */
export function orderingCycles(ids: readonly string[], edges: readonly Pick<GraphEdge, 'source' | 'target' | 'ordering'>[]): string[][] {
	const out = new Map<string, string[]>(ids.map(id => [id, []]));
	for (const edge of edges) { if (edge.ordering && out.has(edge.source) && out.has(edge.target)) { out.get(edge.source)!.push(edge.target); } }
	let index = 0; const stack: string[] = []; const on = new Set<string>(); const idx = new Map<string, number>(); const low = new Map<string, number>(); const result: string[][] = [];
	const visit = (v: string) => {
		idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
		for (const w of out.get(v)!) {
			if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
			else if (on.has(w)) { low.set(v, Math.min(low.get(v)!, idx.get(w)!)); }
		}
		if (low.get(v) === idx.get(v)) { const component: string[] = []; let w: string; do { w = stack.pop()!; on.delete(w); component.push(w); } while (w !== v); if (component.length > 1) { result.push(component.reverse()); } }
	};
	for (const id of ids) { if (!idx.has(id)) { visit(id); } }
	return result;
}

export function graphLayer(resource: Resource): InfrastructureLayer {
	const profile = resourceIntelligence(resourceDefinition(resource).type);
	return profile.layer !== 'unknown' ? profile.layer : kindLayer[resource.kind];
}

/** Build the detached, frozen graph snapshot. Pure: never mutates or retains the architecture. */
export function projectTechnicalGraph(architecture: Architecture): TechnicalGraphSnapshot {
	const relationships: InfrastructureRelationship[] = infrastructureRelationships(architecture);
	const byId = new Map(architecture.resources.map(resource => [resource.id, resource]));
	const labelOf = (id: string) => { const resource = byId.get(id); return resource ? resource.label || resource.name : id; };
	const isScopeResource = (resource: Resource) => scopeTypes.has(resourceDefinition(resource).type) || resource.kind === 'group';
	const edges: GraphEdge[] = relationships.map(link => {
		const source = byId.get(link.source);
		const membership = link.category !== 'attachment' && !!source && resourceDefinition(source).type === 'azurerm_resource_group'
			|| link.category === 'ownership' && !!source && source.kind === 'group';
		const field = link.evidence[0]?.field ?? 'source';
		return {
			id: link.id, source: link.source, target: link.target, category: link.category, ordering: link.ordering,
			confidence: link.evidence.every(item => item.origin === 'service') ? (link.category === 'unclassified' ? 'unclassified' : 'source-graph') : 'configured',
			membership, targetPort: portId(link.target, field, link.source),
			evidence: link.evidence.map(item => ({ origin: item.origin, field: item.field, expression: item.expression, meaning: item.meaning, sourceKey: item.sourceKey })),
		};
	});
	const cycles = orderingCycles(architecture.resources.map(resource => resource.id), edges);
	const inCycle = new Set(cycles.flat());
	const nodes: GraphNode[] = architecture.resources.map(resource => {
		const definition = resourceDefinition(resource);
		const profile = resourceIntelligence(definition.type);
		const chain = resourceAncestors(architecture, resource).filter(isScopeResource).map(item => item.id).reverse();
		const ports: GraphPort[] = edges.filter(edge => edge.target === resource.id && !edge.membership).flatMap(edge => {
			const fields = [...new Set(edge.evidence.map(item => item.field))];
			return fields.map(field => ({ id: portId(resource.id, field, edge.source), field, peer: edge.source, peerLabel: labelOf(edge.source), category: edge.category, edgeId: edge.id }));
		});
		const region = resource.region?.trim();
		return {
			id: resource.id, label: resource.label || resource.name, name: resource.name, address: safeAddress(resource), type: definition.type, typeLabel: definition.label, icon: definition.icon,
			provider: resource.provider, layer: graphLayer(resource), reviewStatus: profile.reviewStatus,
			region: { value: region || 'Unknown', known: !!region },
			scope: chain.at(-1), scopePath: chain, isScope: isScopeResource(resource),
			costCategory: profile.costCategory, blastRadiusCategory: profile.blastRadiusCategory,
			sourceFile: resource.sourceFile, sourceLine: resource.sourceLine, ports,
			inDegree: edges.filter(edge => edge.target === resource.id && !edge.membership).length,
			outDegree: edges.filter(edge => edge.source === resource.id && !edge.membership).length,
			inCycle: inCycle.has(resource.id),
		};
	});
	const hubSpokes = documentedHubSpokes(architecture, relationships).map(star => ({ hub: star.hub, spokes: [...star.spokes] }));
	const revision = hash(JSON.stringify([nodes.map(node => [node.id, node.label, node.type, node.scope, node.region.value]), edges.map(edge => [edge.id, edge.evidence.length])]));
	return deepFreeze({
		revision, nodes, edges, hubSpokes, cycles, inputs: graphInputs(architecture),
		coverage: { documented: nodes.filter(node => node.reviewStatus === 'documented').length, unreviewed: nodes.filter(node => node.reviewStatus === 'unreviewed').length, unknownRegion: nodes.filter(node => !node.region.known).length },
	});
}

const inputPattern = /\b(?:(var|local)\.([A-Za-z_][\w-]*)|data\.([A-Za-z_]\w*)\.([A-Za-z_][\w-]*))/g;
/** Variables bound to fields and var./local./data. references found in field expressions. */
export function graphInputs(architecture: Architecture): GraphInput[] {
	const inputs = new Map<string, { kind: GraphInput['kind']; address: string; label: string; sensitive: boolean; declared: boolean; consumers: Map<string, { resourceId: string; field: string }> }>();
	const add = (kind: GraphInput['kind'], address: string, label: string, resourceId: string, field: string, declared = false, sensitive = false) => {
		const item = inputs.get(address) ?? { kind, address, label, sensitive, declared, consumers: new Map() };
		item.declared ||= declared; item.sensitive ||= sensitive; item.consumers.set(resourceId + '\u0000' + field, { resourceId, field }); inputs.set(address, item);
	};
	const variables = new Map((architecture.variables ?? []).map(variable => [variable.id, variable]));
	const declaredNames = new Map((architecture.variables ?? []).map(variable => [variable.name, variable]));
	const scan = (resourceId: string, field: string, value: unknown) => {
		if (typeof value !== 'string' || !value) { return; }
		for (const match of value.matchAll(inputPattern)) {
			if (match[1]) { const declared = match[1] === 'var' ? declaredNames.get(match[2]) : undefined; add(match[1] === 'var' ? 'variable' : 'local', match[1] + '.' + match[2], match[2], resourceId, field, !!declared, !!declared?.sensitive); }
			else { add('data', 'data.' + match[3] + '.' + match[4], match[4] + ' (' + match[3] + ')', resourceId, field); }
		}
	};
	const walkBlocks = (resourceId: string, blocks: readonly Resource['blocks'][number][], prefix: string) => {
		for (const block of blocks) { for (const [key, value] of Object.entries(block.values ?? {})) { scan(resourceId, prefix + block.type + '.' + key, value); } walkBlocks(resourceId, block.blocks ?? [], prefix + block.type + '.'); }
	};
	for (const resource of architecture.resources) {
		for (const [key, binding] of Object.entries(resource.fieldBindings ?? {})) {
			const variable = variables.get(binding.variableId); if (!variable) { continue; }
			let field = key; try { const parsed = JSON.parse(key) as string[]; field = parsed.at(-1) ?? key; } catch { /* Legacy key. */ }
			add('variable', 'var.' + variable.name, variable.name, resource.id, field, true, variable.sensitive);
		}
		for (const [field, value] of Object.entries(resource.settings ?? {})) { scan(resource.id, field, value); }
		walkBlocks(resource.id, resource.blocks ?? [], '');
	}
	return [...inputs.values()].sort((a, b) => a.address.localeCompare(b.address)).slice(0, 200).map(item => ({ id: 'input:' + item.address, kind: item.kind, address: item.address, label: item.label, sensitive: item.sensitive, declared: item.declared, consumers: [...item.consumers.values()] }));
}

export function portId(resourceId: string, field: string, peer: string): string { return 'port:' + JSON.stringify([resourceId, field, peer]); }
function safeAddress(resource: Resource): string { try { return resourceAddress(resource); } catch { return resourceDefinition(resource).type + '.' + resource.name; } }

/** Edges visible in a lens. Membership edges only appear in Topology, or when explicitly requested. */
export function lensEdges(snapshot: TechnicalGraphSnapshot, lens: GraphLens, showMembership: boolean): GraphEdge[] {
	const allowed = new Set(lensCategories[lens]);
	return snapshot.edges.filter(edge => allowed.has(edge.category) && (!edge.membership || showMembership));
}

/** Upstream prerequisites and downstream configured dependents of one node (cycle-safe). */
export function traceNode(edges: readonly GraphEdge[], id: string): { upstream: Set<string>; downstream: Set<string>; edges: Set<string> } {
	const walk = (forward: boolean) => {
		const seen = new Set<string>(); const used = new Set<string>(); const pending = [id];
		while (pending.length) {
			const current = pending.pop()!;
			for (const edge of edges) {
				const from = forward ? edge.source : edge.target; const to = forward ? edge.target : edge.source;
				if (from === current && to !== id) { used.add(edge.id); if (!seen.has(to)) { seen.add(to); pending.push(to); } }
				else if (from === current) { used.add(edge.id); }
			}
		}
		return { seen, used };
	};
	const down = walk(true); const up = walk(false);
	return { upstream: up.seen, downstream: down.seen, edges: new Set([...up.used, ...down.used]) };
}

export const layerLabels: Record<InfrastructureLayer, string> = { scope: 'Scope', identity: 'Identity', network: 'Networking', security: 'Security', compute: 'Compute', application: 'Application', data: 'Data', monitoring: 'Monitoring', unknown: 'Unclassified' };
export { infrastructureLayers };

/**
 * Terraform apply waves: the longest prerequisite chain before each resource (0 = no ordering inputs).
 * Terraform walks the same dependency graph and runs independent nodes concurrently (default
 * parallelism 10), so equal waves can be created together. Cycle members get no wave.
 */
export function applyWaves(snapshot: TechnicalGraphSnapshot): Record<string, number | undefined> {
	const cyclic = new Set(snapshot.cycles.flat());
	const incoming = new Map(snapshot.nodes.map(node => [node.id, [] as string[]]));
	for (const edge of snapshot.edges) { if (edge.ordering && incoming.has(edge.target) && incoming.has(edge.source) && edge.source !== edge.target) { incoming.get(edge.target)!.push(edge.source); } }
	const wave: Record<string, number | undefined> = {};
	const visit = (id: string, stack: Set<string>): number | undefined => {
		if (id in wave) { return wave[id]; }
		if (cyclic.has(id) || stack.has(id)) { wave[id] = undefined; return undefined; }
		stack.add(id); let level = 0;
		for (const source of incoming.get(id)!) { const value = visit(source, stack); if (value === undefined) { stack.delete(id); wave[id] = undefined; return undefined; } level = Math.max(level, value + 1); }
		stack.delete(id); wave[id] = level; return level;
	};
	for (const node of snapshot.nodes) { visit(node.id, new Set()); }
	return wave;
}

export type PlanAction = 'create' | 'update' | 'replace' | 'delete' | 'read' | 'noOp';
export interface NodeOverlay {
	readonly errors: number;
	readonly warnings: number;
	readonly messages: readonly { severity: 'error' | 'warning'; message: string }[];
	readonly plan?: { readonly action: PlanAction; readonly instances: number; readonly changed: readonly string[]; readonly sensitive: boolean };
	/** Planned replace/destroy resources this one configurably depends on (directly or transitively). */
	readonly affectedBy?: readonly string[];
}
type PlanChangeInput = { address: string; mode?: string; actionKind: PlanAction; changedAttributePaths: readonly string[]; hasSensitiveAttributes: boolean };
const actionRank: Record<PlanAction, number> = { delete: 5, replace: 4, create: 3, update: 2, read: 1, noOp: 0 };

/**
 * Join diagnostics by resource id and plan changes by Terraform address (root module only; an
 * indexed instance `type.name[0]`/`["key"]` belongs to `type.name`). Unmatched plan entries are
 * returned so the view can say they exist outside the drawn graph instead of hiding them.
 */
export function graphOverlays(snapshot: TechnicalGraphSnapshot, diagnostics: readonly { resourceId: string; severity: 'error' | 'warning'; message: string }[], plan?: readonly PlanChangeInput[]): { byNode: Record<string, NodeOverlay>; unmatchedPlan: number } {
	const byAddress = new Map(snapshot.nodes.map(node => [node.address, node.id]));
	const byNode: Record<string, { errors: number; warnings: number; messages: { severity: 'error' | 'warning'; message: string }[]; plan?: { action: PlanAction; instances: number; changed: string[]; sensitive: boolean }; affectedBy?: string[] }> = {};
	const entry = (id: string) => byNode[id] ??= { errors: 0, warnings: 0, messages: [] };
	for (const item of diagnostics) { if (!byAddress.size || !snapshot.nodes.some(node => node.id === item.resourceId)) { continue; } const target = entry(item.resourceId); target[item.severity === 'error' ? 'errors' : 'warnings']++; target.messages.push({ severity: item.severity, message: item.message }); }
	let unmatchedPlan = 0;
	for (const change of plan ?? []) {
		if (change.mode === 'data') { continue; }
		const base = change.address.replace(/\[[^\]]*\]$/, '');
		const id = byAddress.get(base);
		if (!id) { if (change.actionKind !== 'noOp') { unmatchedPlan++; } continue; }
		const target = entry(id); const current = target.plan;
		target.plan = !current ? { action: change.actionKind, instances: 1, changed: [...change.changedAttributePaths], sensitive: change.hasSensitiveAttributes }
			: { action: actionRank[change.actionKind] > actionRank[current.action] ? change.actionKind : current.action, instances: current.instances + 1, changed: [...new Set([...current.changed, ...change.changedAttributePaths])], sensitive: current.sensitive || change.hasSensitiveAttributes };
	}
	// Configured consumers of a planned replace/destroy may be recreated, lose a reference or fail.
	const ordering = snapshot.edges.filter(edge => edge.ordering && !edge.membership);
	for (const [id, overlay] of Object.entries(byNode)) {
		if (overlay.plan?.action !== 'replace' && overlay.plan?.action !== 'delete') { continue; }
		for (const downstream of traceNode(ordering, id).downstream) {
			const target = entry(downstream);
			if (target.plan?.action === 'replace' || target.plan?.action === 'delete') { continue; }
			(target.affectedBy ??= []).push(id);
		}
	}
	return { byNode, unmatchedPlan };
}

/** Nodes within `depth` hops of `id` over the given edges (both directions). */
export function neighbourhood(edges: readonly Pick<GraphEdge, 'source' | 'target'>[], id: string, depth: number): Set<string> {
	const seen = new Set([id]); let frontier = [id];
	for (let hop = 0; hop < depth; hop++) {
		const next: string[] = [];
		for (const edge of edges) { for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) { if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b); } } }
		frontier = next;
	}
	return seen;
}

/** Case-insensitive match on name, label, address, type label and source file. */
export function matchesQuery(node: GraphNode, query: string): boolean {
	const q = query.trim().toLowerCase(); if (!q) { return true; }
	return [node.label, node.name, node.address, node.typeLabel, node.sourceFile ?? ''].some(value => value.toLowerCase().includes(q));
}
