/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Technical Graph Rebuild — Phase 4 (Provider Topology & Patterns) + Phase 5 (Deterministic
// Diagnostics & Shortest-Path Evidence over TechnicalGraphSnapshot).
//
// Invariants:
//   - Evidence-backed only: names, labels, or canvas proximity NEVER create patterns or links.
//   - Mixed provider, module, unknown-region, and Kubernetes manifest boundaries remain honest.
//   - Pure & deeply frozen; never mutates Architecture, Resource.positions, or History.

import { resourceIntelligence } from './providerKnowledge.ts';
import type { GraphEdge, GraphNode, TechnicalGraphSnapshot } from './technicalGraph.ts';

export type TopologyPatternKind =
	| 'azure-hub-spoke'
	| 'aws-vpc-network'
	| 'aws-landing-zone'
	| 'managed-kubernetes'
	| 'gcp-load-balancer-chain';

export interface DetectedTopologyPattern {
	readonly id: string;
	readonly kind: TopologyPatternKind;
	readonly provider: 'azure' | 'aws' | 'gcp';
	readonly title: string;
	readonly primaryNodeId: string;
	readonly memberNodeIds: readonly string[];
	readonly roles: Readonly<Record<string, string>>;
	readonly evidenceSummary: string;
	readonly caveat: string;
}

export interface GraphBoundarySummary {
	readonly providers: readonly string[];
	readonly mixedProviders: boolean;
	readonly knownRegions: readonly string[];
	readonly multiRegion: boolean;
	readonly unknownRegionCount: number;
	readonly moduleCallIds: readonly string[];
	readonly hasModules: boolean;
	readonly kubernetesManifestNodeIds: readonly string[];
	readonly kubernetesAdapterStatus: 'none' | 'manifest-adapter-required';
}

export type SnapshotFindingKind =
	| 'ordering-cycle'
	| 'missing-expected-parent'
	| 'missing-expected-attachment'
	| 'kubernetes-adapter-required';

export interface SnapshotTroubleshootingFinding {
	readonly id: string;
	readonly kind: SnapshotFindingKind;
	readonly severity: 'error' | 'warning' | 'info';
	readonly nodeIds: readonly string[];
	readonly title: string;
	readonly detail: string;
	readonly nextCheck: string;
}

export interface SnapshotPathHop {
	readonly edgeId: string;
	readonly fromId: string;
	readonly toId: string;
	readonly category: GraphEdge['category'];
	readonly ordering: boolean;
	readonly primaryField: string;
	readonly expression?: string;
}

export interface SnapshotShortestPath {
	readonly nodeIds: readonly string[];
	readonly hops: readonly SnapshotPathHop[];
	readonly length: number;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) {
			deepFreeze(item);
		}
	}
	return value;
}

function linkedPeerIds(edges: readonly GraphEdge[], nodeId: string): Set<string> {
	const peers = new Set<string>();
	for (const edge of edges) {
		if (edge.source === nodeId) {
			peers.add(edge.target);
		} else if (edge.target === nodeId) {
			peers.add(edge.source);
		}
	}
	return peers;
}

function hasDirectedOrReverseEdge(edges: readonly GraphEdge[], a: string, b: string): boolean {
	return edges.some(edge => (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a));
}

const GCP_REGIONAL_LB_CHAIN = [
	'google_compute_forwarding_rule',
	'google_compute_region_target_http_proxy',
	'google_compute_region_url_map',
	'google_compute_region_backend_service',
] as const;

const GCP_GLOBAL_LB_CHAIN = [
	'google_compute_global_forwarding_rule',
	'google_compute_target_http_proxy',
	'google_compute_url_map',
	'google_compute_backend_service',
] as const;

const GCP_LB_ROLE: Readonly<Record<string, string>> = {
	google_compute_forwarding_rule: 'forwarding-rule',
	google_compute_global_forwarding_rule: 'forwarding-rule',
	google_compute_region_target_http_proxy: 'http-proxy',
	google_compute_target_http_proxy: 'http-proxy',
	google_compute_region_url_map: 'url-map',
	google_compute_url_map: 'url-map',
	google_compute_region_backend_service: 'backend-service',
	google_compute_backend_service: 'backend-service',
};

const K8S_CLUSTER_TYPES: Readonly<Record<string, { readonly provider: 'azure' | 'aws' | 'gcp'; readonly label: string }>> = {
	azurerm_kubernetes_cluster: { provider: 'azure', label: 'AKS' },
	aws_eks_cluster: { provider: 'aws', label: 'EKS' },
	google_container_cluster: { provider: 'gcp', label: 'GKE' },
};

/**
 * Detects evidence-backed cloud topology patterns across Azure, AWS, and GCP.
 * Names and visual proximity never qualify; every pattern requires real resource types
 * and/or evidenced configuration edges.
 */
export function detectTechnicalGraphPatterns(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	hubSpokes: readonly { readonly hub: string; readonly spokes: readonly string[] }[]
): readonly DetectedTopologyPattern[] {
	const patterns: DetectedTopologyPattern[] = [];
	const byId = new Map(nodes.map(node => [node.id, node]));

	// 1. Azure Hub-Spoke (backed by verified azurerm_virtual_network_peering endpoints)
	for (const star of hubSpokes) {
		const roles: Record<string, string> = { [star.hub]: 'hub' };
		const members = [star.hub];
		for (const spoke of [...star.spokes].sort()) {
			roles[spoke] = 'spoke';
			members.push(spoke);
		}
		patterns.push({
			id: `pattern:azure-hub-spoke:${star.hub}`,
			kind: 'azure-hub-spoke',
			provider: 'azure',
			title: 'Azure Hub-Spoke Network',
			primaryNodeId: star.hub,
			memberNodeIds: members,
			roles,
			evidenceSummary: `Hub VNet linked to ${star.spokes.length} spoke VNets via explicit azurerm_virtual_network_peering references.`,
			caveat: 'Verify reciprocal peering flags, gateway transit, UDR route tables, and NSGs; peering resources alone do not prove packet reachability.',
		});
	}

	// 2. AWS VPC Network (evidenced aws_vpc + >= 1 aws_subnet referencing it, plus linked IGW/NAT/route tables)
	for (const vpc of nodes.filter(node => node.type === 'aws_vpc')) {
		const directPeers = linkedPeerIds(edges, vpc.id);
		const subnets = [...directPeers].map(id => byId.get(id)).filter((n): n is GraphNode => !!n && n.type === 'aws_subnet');
		if (subnets.length === 0) {
			continue;
		}
		const roles: Record<string, string> = { [vpc.id]: 'vpc' };
		const memberSet = new Set<string>([vpc.id]);
		for (const subnet of subnets) {
			roles[subnet.id] = 'subnet';
			memberSet.add(subnet.id);
		}
		// Attach gateways and route tables linked to the VPC or any of its subnets.
		const networkAnchorIds = new Set(memberSet);
		let gatewayCount = 0;
		let routeTableCount = 0;
		for (const anchorId of networkAnchorIds) {
			for (const peerId of linkedPeerIds(edges, anchorId)) {
				const peer = byId.get(peerId);
				if (!peer || memberSet.has(peer.id)) {
					continue;
				}
				if (peer.type === 'aws_internet_gateway' || peer.type === 'aws_nat_gateway') {
					roles[peer.id] = peer.type === 'aws_internet_gateway' ? 'internet-gateway' : 'nat-gateway';
					memberSet.add(peer.id);
					gatewayCount++;
				} else if (peer.type === 'aws_route_table' || peer.type === 'aws_route_table_association') {
					roles[peer.id] = 'routing';
					memberSet.add(peer.id);
					routeTableCount++;
				}
			}
		}
		const parts = [`${subnets.length} subnet${subnets.length === 1 ? '' : 's'}`];
		if (gatewayCount > 0) {
			parts.push(`${gatewayCount} gateway${gatewayCount === 1 ? '' : 's'}`);
		}
		if (routeTableCount > 0) {
			parts.push(`${routeTableCount} routing resource${routeTableCount === 1 ? '' : 's'}`);
		}
		patterns.push({
			id: `pattern:aws-vpc-network:${vpc.id}`,
			kind: 'aws-vpc-network',
			provider: 'aws',
			title: 'AWS VPC Network',
			primaryNodeId: vpc.id,
			memberNodeIds: [...memberSet].sort(),
			roles,
			evidenceSummary: `Evidenced AWS VPC with ${parts.join(', ')} connected via explicit references.`,
			caveat: 'AWS research docs are not version-matched to catalogue 6.73.1; verify route tables, NACLs, and security groups in live schema/plan.',
		});
	}

	// 3. AWS Organizations Landing Zone (requires real aws_organizations_organization + >= 1 aws_organizations_account)
	const awsOrgs = nodes.filter(node => node.type === 'aws_organizations_organization');
	const awsAccounts = nodes.filter(node => node.type === 'aws_organizations_account');
	if (awsOrgs.length > 0 && awsAccounts.length > 0) {
		const primaryOrg = awsOrgs[0];
		const roles: Record<string, string> = {};
		const memberSet = new Set<string>();
		for (const org of awsOrgs) {
			roles[org.id] = 'organization';
			memberSet.add(org.id);
		}
		for (const account of awsAccounts) {
			roles[account.id] = 'account';
			memberSet.add(account.id);
		}
		// Include evidenced IAM / logging / security resources directly referencing org or accounts.
		for (const anchorId of [...memberSet]) {
			for (const peerId of linkedPeerIds(edges, anchorId)) {
				const peer = byId.get(peerId);
				if (!peer || memberSet.has(peer.id)) {
					continue;
				}
				if (peer.layer === 'identity' || peer.layer === 'security' || peer.layer === 'monitoring') {
					roles[peer.id] = peer.layer;
					memberSet.add(peer.id);
				}
			}
		}
		patterns.push({
			id: `pattern:aws-landing-zone:${primaryOrg.id}`,
			kind: 'aws-landing-zone',
			provider: 'aws',
			title: 'AWS Organizations Landing Zone',
			primaryNodeId: primaryOrg.id,
			memberNodeIds: [...memberSet].sort(),
			roles,
			evidenceSummary: `${awsOrgs.length} AWS Organization resource and ${awsAccounts.length} AWS Organization account${awsAccounts.length === 1 ? '' : 's'} detected.`,
			caveat: 'Multi-account SCPs, OU hierarchy, and centralized CloudTrail/GuardDuty guardrails still require explicit configuration verification.',
		});
	}

	// 4. Managed Kubernetes Control Plane Topology (AKS / EKS / GKE with >= 1 evidenced infrastructure attachment)
	for (const cluster of nodes) {
		const meta = K8S_CLUSTER_TYPES[cluster.type];
		if (!meta) {
			continue;
		}
		const nonMembershipEdges = edges.filter(edge => !edge.membership && (edge.source === cluster.id || edge.target === cluster.id));
		if (nonMembershipEdges.length === 0) {
			continue;
		}
		const roles: Record<string, string> = { [cluster.id]: 'cluster' };
		const memberSet = new Set<string>([cluster.id]);
		let nodeGroupCount = 0;
		let networkCount = 0;
		let identityCount = 0;
		let monitoringCount = 0;
		for (const edge of nonMembershipEdges) {
			const peerId = edge.source === cluster.id ? edge.target : edge.source;
			const peer = byId.get(peerId);
			if (!peer || memberSet.has(peer.id)) {
				continue;
			}
			if (peer.type === 'aws_eks_node_group' || peer.type === 'azurerm_kubernetes_cluster_node_pool' || peer.type === 'google_container_node_pool') {
				roles[peer.id] = 'node-group';
				memberSet.add(peer.id);
				nodeGroupCount++;
			} else if (peer.layer === 'network') {
				roles[peer.id] = 'network';
				memberSet.add(peer.id);
				networkCount++;
			} else if (peer.layer === 'identity' || peer.layer === 'security') {
				roles[peer.id] = peer.layer;
				memberSet.add(peer.id);
				identityCount++;
			} else if (peer.layer === 'monitoring') {
				roles[peer.id] = 'monitoring';
				memberSet.add(peer.id);
				monitoringCount++;
			}
		}
		if (memberSet.size <= 1) {
			continue;
		}
		const parts = [
			nodeGroupCount ? `${nodeGroupCount} node pool${nodeGroupCount === 1 ? '' : 's'}` : null,
			networkCount ? `${networkCount} network link${networkCount === 1 ? '' : 's'}` : null,
			identityCount ? `${identityCount} identity/security link${identityCount === 1 ? '' : 's'}` : null,
			monitoringCount ? `${monitoringCount} monitoring link${monitoringCount === 1 ? '' : 's'}` : null,
		].filter(Boolean);
		patterns.push({
			id: `pattern:managed-kubernetes:${cluster.id}`,
			kind: 'managed-kubernetes',
			provider: meta.provider,
			title: `Managed Kubernetes (${meta.label})`,
			primaryNodeId: cluster.id,
			memberNodeIds: [...memberSet].sort(),
			roles,
			evidenceSummary: `${meta.label} cluster wired to ${parts.join(', ')} via evidenced Terraform references.`,
			caveat: 'Shows cloud control-plane infrastructure only; in-cluster Kubernetes Pods, Services, and NetworkPolicies require an explicit Kubernetes adapter.',
		});
	}

	// 5. GCP Regional vs Global HTTP Load-Balancing Chains (strictly separate regional vs global types)
	const detectGcpChain = (chainTypes: readonly string[], scopeLabel: 'Regional' | 'Global') => {
		const entries = nodes.filter(node => node.type === chainTypes[0]);
		for (const entry of entries) {
			const chainNodes: GraphNode[] = [entry];
			let current = entry;
			for (let step = 1; step < chainTypes.length; step++) {
				const expectedType = chainTypes[step];
				const next = nodes.find(candidate => candidate.type === expectedType && hasDirectedOrReverseEdge(edges, current.id, candidate.id));
				if (!next) {
					break;
				}
				chainNodes.push(next);
				current = next;
			}
			// Require at least 2 consecutive evidenced hops (3 nodes) or 1 forwarding-rule -> proxy hop (2 nodes) of matching scope.
			if (chainNodes.length < 2) {
				continue;
			}
			const roles: Record<string, string> = {};
			for (const member of chainNodes) {
				roles[member.id] = GCP_LB_ROLE[member.type] ?? 'hop';
			}
			patterns.push({
				id: `pattern:gcp-lb-${scopeLabel.toLowerCase()}:${entry.id}`,
				kind: 'gcp-load-balancer-chain',
				provider: 'gcp',
				title: `GCP ${scopeLabel} HTTP Load Balancer Chain`,
				primaryNodeId: entry.id,
				memberNodeIds: chainNodes.map(n => n.id),
				roles,
				evidenceSummary: `${chainNodes.length}-stage ${scopeLabel.toLowerCase()} HTTP load-balancing chain connected by explicit references.`,
				caveat: 'Regional and global GCP load-balancing resources remain strictly scoped; backend health checks and firewall rules are not evaluated.',
			});
		}
	};
	detectGcpChain(GCP_REGIONAL_LB_CHAIN, 'Regional');
	detectGcpChain(GCP_GLOBAL_LB_CHAIN, 'Global');

	patterns.sort((a, b) => a.id.localeCompare(b.id));
	return deepFreeze(patterns);
}

/**
 * Summarizes provider, known-region, module, and Kubernetes manifest boundaries honestly.
 * Missing/unknown regions are counted separately and never inflate `multiRegion`.
 */
export function summarizeGraphBoundaries(nodes: readonly GraphNode[]): GraphBoundarySummary {
	const providers = [...new Set(nodes.map(node => node.provider).filter(Boolean))].sort();
	const knownRegions = [...new Set(nodes.filter(node => node.region.known && node.region.value).map(node => node.region.value))].sort();
	const unknownRegionCount = nodes.filter(node => !node.region.known).length;
	const moduleCallIds = nodes.filter(node => !!node.module).map(node => node.id).sort();
	const kubernetesManifestNodeIds = nodes
		.filter(node => resourceIntelligence(node.type).fieldSyntax === 'kubernetes-manifest')
		.map(node => node.id)
		.sort();

	return deepFreeze({
		providers,
		mixedProviders: providers.length > 1,
		knownRegions,
		multiRegion: knownRegions.length > 1,
		unknownRegionCount,
		moduleCallIds,
		hasModules: moduleCallIds.length > 0,
		kubernetesManifestNodeIds,
		kubernetesAdapterStatus: kubernetesManifestNodeIds.length > 0 ? 'manifest-adapter-required' : 'none',
	});
}

/**
 * Produces deterministic, evidence-scoped troubleshooting findings directly over a
 * `TechnicalGraphSnapshot` (ordering cycles, missing documented structural parents/attachments,
 * and Kubernetes manifest adapter notices).
 */
export function snapshotTroubleshootingFindings(
	snapshot: Pick<TechnicalGraphSnapshot, 'nodes' | 'edges' | 'cycles'>
): readonly SnapshotTroubleshootingFinding[] {
	const findings: SnapshotTroubleshootingFinding[] = [];
	const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
	const incomingByNode = new Map<string, GraphEdge[]>();
	for (const edge of snapshot.edges) {
		const list = incomingByNode.get(edge.target) ?? [];
		list.push(edge);
		incomingByNode.set(edge.target, list);
	}

	for (const cycle of snapshot.cycles) {
		const labels = cycle.map(id => byId.get(id)?.label ?? id);
		findings.push({
			id: `cycle:${cycle.join(',')}`,
			kind: 'ordering-cycle',
			severity: 'error',
			nodeIds: [...cycle],
			title: `Reference cycle (${cycle.length} resources)`,
			detail: `Ordering references loop across ${labels.join(' -> ')}. Terraform cannot compute an apply order.`,
			nextCheck: 'Break one reference in the loop or move a rule into a separate association resource.',
		});
	}

	for (const node of snapshot.nodes) {
		const profile = resourceIntelligence(node.type);
		const incoming = incomingByNode.get(node.id) ?? [];

		if (profile.fieldSyntax === 'kubernetes-manifest') {
			findings.push({
				id: `k8s-adapter:${node.id}`,
				kind: 'kubernetes-adapter-required',
				severity: 'info',
				nodeIds: [node.id],
				title: 'Kubernetes manifest adapter required',
				detail: `${node.type} uses Kubernetes manifest paths rather than Terraform provider fields; selector/owner links are not inferred automatically.`,
				nextCheck: 'Use an explicit Kubernetes topology adapter before expecting pod/service/network-policy edges.',
			});
			continue;
		}

		if (
			profile.reviewStatus === 'documented'
			&& profile.fieldSyntax === 'terraform'
			&& profile.parentTypes.length > 0
			&& !node.scope
			&& !incoming.some(edge => edge.category === 'ownership')
		) {
			findings.push({
				id: `missing-parent:${node.id}`,
				kind: 'missing-expected-parent',
				severity: 'warning',
				nodeIds: [node.id],
				title: 'No evidenced structural parent',
				detail: `${node.type} typically belongs to ${profile.parentTypes.join(' or ')}, but no ownership link is evidenced here.`,
				nextCheck: 'Check whether the parent is provided via a variable, external data source, or missing configuration.',
			});
		}

		const attachmentRules = profile.reviewStatus === 'documented' && profile.fieldSyntax === 'terraform'
			? profile.rules.filter(rule => rule.category === 'attachment')
			: [];
		if (attachmentRules.length > 0 && !incoming.some(edge => edge.category === 'attachment')) {
			const fields = [...new Set(attachmentRules.map(rule => rule.field))];
			findings.push({
				id: `missing-attachment:${node.id}`,
				kind: 'missing-expected-attachment',
				severity: 'info',
				nodeIds: [node.id],
				title: 'No evidenced attachment configured',
				detail: `Reviewed attachment field(s) (${fields.join(', ')}) have no resolved resource target in this graph.`,
				nextCheck: 'Confirm whether this attachment points to an external ID or still needs to be linked.',
			});
		}
	}

	const rank: Record<SnapshotTroubleshootingFinding['severity'], number> = { error: 0, warning: 1, info: 2 };
	findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
	return deepFreeze(findings);
}

/**
 * Bounded BFS shortest directed path over `GraphEdge[]` with per-hop field provenance.
 */
export function shortestSnapshotPath(
	edges: readonly GraphEdge[],
	fromId: string,
	toId: string,
	maxDepth = 8
): SnapshotShortestPath | null {
	if (fromId === toId) {
		return null;
	}
	const limit = Math.max(1, Math.min(16, maxDepth));
	const outgoing = new Map<string, GraphEdge[]>();
	for (const edge of edges) {
		const list = outgoing.get(edge.source) ?? [];
		list.push(edge);
		outgoing.set(edge.source, list);
	}
	const queue: { readonly id: string; readonly nodes: readonly string[]; readonly pathEdges: readonly GraphEdge[] }[] = [
		{ id: fromId, nodes: [fromId], pathEdges: [] },
	];
	const visited = new Set<string>([fromId]);

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current.pathEdges.length >= limit) {
			continue;
		}
		for (const edge of outgoing.get(current.id) ?? []) {
			if (visited.has(edge.target)) {
				continue;
			}
			const nextNodes = [...current.nodes, edge.target];
			const nextEdges = [...current.pathEdges, edge];
			if (edge.target === toId) {
				const hops: SnapshotPathHop[] = nextEdges.map(hop => ({
					edgeId: hop.id,
					fromId: hop.source,
					toId: hop.target,
					category: hop.category,
					ordering: hop.ordering,
					primaryField: hop.evidence[0]?.field ?? hop.category,
					...(hop.evidence[0]?.expression ? { expression: hop.evidence[0].expression } : {}),
				}));
				return deepFreeze({ nodeIds: nextNodes, hops, length: hops.length });
			}
			visited.add(edge.target);
			queue.push({ id: edge.target, nodes: nextNodes, pathEdges: nextEdges });
		}
	}
	return null;
}
