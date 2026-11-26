/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { explicitResourceReferences, inheritedReferences } from './resourceHierarchy.ts';
import { endpointElementId } from './connectionEndpoints.ts';
import { resourceIntelligence, type RelationshipCategory } from './providerKnowledge.ts';

export const relationshipNames: Record<RelationshipCategory | 'unclassified', string> = { ownership: 'Ownership', attachment: 'Attachment', execution: 'Execution dependency', reference: 'Reference', runtime: 'Runtime intent', observability: 'Observability', unclassified: 'Unclassified source link' };
export interface InfrastructureRelationship {
	id: string;
	/** Rendering direction is prerequisite → consumer, not a packet-flow arrow. */
	source: string; target: string;
	category: RelationshipCategory | 'unclassified';
	ordering: boolean;
	evidence: { origin: 'inherited' | 'binding' | 'service'; field: string; expression?: string; meaning: string; sourceKey?: string }[];
}

/** Only configured draft fields or identified service edges create instance links. Never join by type/proximity. */
export function infrastructureRelationships(architecture: Architecture): InfrastructureRelationship[] {
	const grouped = new Map<string, InfrastructureRelationship>();
	function add(source: string, target: string, category: InfrastructureRelationship['category'], ordering: boolean, evidence: InfrastructureRelationship['evidence'][number]) {
		if (source === target) { return; }
		const id = 'infrastructure:' + JSON.stringify([source, target, category]);
		const current = grouped.get(id) ?? { id, source, target, category, ordering, evidence: [] };
		if (!current.evidence.some(item => item.field === evidence.field && item.expression === evidence.expression)) { current.evidence.push(evidence); }
		grouped.set(id, current);
	}
	for (const consumer of architecture.resources) {
		const profile = resourceIntelligence(resourceDefinition(consumer).type);
		const inherited = inheritedReferences(architecture, consumer);
		const inheritedFields = new Set(inherited.map(reference => reference.path.join('.')));
		for (const origin of ['inherited', 'binding'] as const) {
			for (const reference of origin === 'inherited' ? inherited : explicitResourceReferences(architecture, consumer)) {
				const field = reference.path.filter(part => !/^\d+$/.test(part)).join('.');
				if (origin === 'binding' && inheritedFields.has(field)) { continue; } // The shared field resolver gives inheritance priority.
				const sourceType = resourceDefinition(reference.source).type;
				const rule = profile.fieldSyntax === 'terraform' ? profile.rules.find(rule => rule.field === field && (rule.targets.includes(sourceType) || rule.targets.includes('*'))) : undefined;
				add(reference.source.id, consumer.id, rule?.category ?? 'reference', true, { origin, field, expression: reference.expression, meaning: rule?.meaning ?? 'Configured value reference; no reviewed attachment or ownership rule for this field.', sourceKey: rule ? profile.sourceKey : undefined });
			}
		}
	}
	const ids = new Set(architecture.resources.map(resource => resource.id));
	for (const connection of architecture.connections) {
		if (!connection.origin || connection.origin.kind !== 'service') { continue; }
		const source = endpointElementId(connection.source); const target = endpointElementId(connection.target);
		if (!source || !target || !ids.has(source) || !ids.has(target)) { continue; }
		const explicit = connection.origin.edgeKind === 'explicit';
		const reference = connection.origin.edgeKind === 'reference';
		add(source, target, explicit ? 'execution' : reference ? 'reference' : 'unclassified', explicit || reference, { origin: 'service', field: explicit ? 'depends_on' : 'Source graph: ' + connection.origin.edgeKind, meaning: explicit ? 'Explicit ordering supplied by the source graph. This does not establish an attachment or communication.' : reference ? 'Expression dependency supplied by the source graph; field path is unavailable.' : 'Service edge kind is retained; its infrastructure semantics and ordering are unclassified.' });
	}
	return [...grouped.values()];
}

/** Reachable configured dependents, with cycle protection. This is not an outage/replacement prediction. */
export function configuredImpact(relationships: InfrastructureRelationship[], id: string): { direct: string[]; transitive: string[] } {
	const outgoing = new Map<string, Set<string>>();
	for (const link of relationships.filter(link => link.ordering)) { const list = outgoing.get(link.source) ?? new Set(); list.add(link.target); outgoing.set(link.source, list); }
	const direct = [...(outgoing.get(id) ?? [])].filter(target => target !== id);
	const seen = new Set([id]); const pending = [...direct];
	while (pending.length) { const current = pending.shift()!; if (seen.has(current)) { continue; } seen.add(current); pending.push(...[...(outgoing.get(current) ?? [])].filter(target => !seen.has(target))); }
	return { direct, transitive: [...seen].filter(target => target !== id && !direct.includes(target)) };
}

/** A star requires actual local and remote peering fields. Names and neighbouring VNets never qualify. */
export function documentedHubSpokes(architecture: Architecture, relationships: InfrastructureRelationship[]) {
	const networkIds = new Set(architecture.resources.filter(resource => resourceDefinition(resource).type === 'azurerm_virtual_network').map(resource => resource.id));
	const adjacency = new Map<string, Set<string>>();
	for (const peering of architecture.resources.filter(resource => resourceDefinition(resource).type === 'azurerm_virtual_network_peering')) {
		const links = relationships.filter(link => link.target === peering.id);
		const local = links.find(link => link.evidence.some(item => item.field === 'virtual_network_name'))?.source;
		const remote = links.find(link => link.evidence.some(item => item.field === 'remote_virtual_network_id'))?.source;
		if (!local || !remote || local === remote || !networkIds.has(local) || !networkIds.has(remote)) { continue; }
		for (const [from, to] of [[local, remote], [remote, local]]) { const list = adjacency.get(from) ?? new Set(); list.add(to); adjacency.set(from, list); }
	}
	return [...adjacency].filter(([, spokes]) => spokes.size >= 2 && [...spokes].every(spoke => adjacency.get(spoke)?.size === 1)).map(([hub, spokes]) => ({ hub, spokes: [...spokes], confidence: 'configured-peerings' as const }));
}
