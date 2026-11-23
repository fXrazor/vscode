/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 8 (Desktop Foundation): Full-root Terraform Plan Review (offline draft preview +
// imported `terraform show -json` plan parser), offline Policy & Cost Estimate overlays with
// explicit provenance/unknown coverage, and context-bound Plan Approval invalidation.
// Pure TypeScript with zero DOM, network, or `vscode` runtime dependencies.

import type { DraftDocument } from './draftDocument';
import type {
	CanvasDependencyReport,
	CanvasGraphSnapshot,
	CanvasNodeSummary
} from './protocol';
import type { ResourceDraft } from './schemaForm';

export type PlanActionKind = 'create' | 'update' | 'replace' | 'delete' | 'no-op';
export type PlanRiskLevel = 'low' | 'medium' | 'high';

export interface PlanResourceChange {
	readonly nodeId: string | null;
	readonly address: string;
	readonly resourceType: string;
	readonly name: string;
	readonly action: PlanActionKind;
	readonly risk: PlanRiskLevel;
	readonly summary: string;
	readonly hasUnknownAfterApply: boolean;
}

export interface FullRootPlanReview {
	readonly sourceKind: 'offline_draft_preview' | 'imported_plan_json';
	readonly baseSourceRevision: string;
	readonly planFingerprint: string;
	readonly environment: string;
	readonly region: string;
	readonly createdCount: number;
	readonly updatedCount: number;
	readonly replacedCount: number;
	readonly deletedCount: number;
	readonly unchangedCount: number;
	readonly hasHighRiskChanges: boolean;
	readonly changes: readonly PlanResourceChange[];
	readonly notice: string;
}

export interface PolicyFinding {
	readonly id: string;
	readonly ruleId: string;
	readonly severity: 'error' | 'warning' | 'info';
	readonly nodeId: string | null;
	readonly resourceLabel: string;
	readonly title: string;
	readonly remediation: string;
	readonly provenance: string;
}

export interface ResourceCostLine {
	readonly nodeId: string;
	readonly resourceLabel: string;
	readonly resourceType: string;
	readonly status: 'estimated' | 'free' | 'unknown';
	readonly baselineMonthlyUsd: number | null;
	readonly projectedMonthlyUsd: number | null;
	readonly deltaMonthlyUsd: number | null;
	readonly basis: string;
}

export interface ArchitectureCostEstimate {
	readonly currency: 'USD';
	readonly region: string;
	readonly pricingCatalog: string;
	readonly isEstimate: true;
	readonly baselineTotalUsd: number;
	readonly projectedTotalUsd: number;
	readonly deltaTotalUsd: number;
	readonly knownCount: number;
	readonly unknownCount: number;
	readonly lines: readonly ResourceCostLine[];
}

export interface PlanApprovalRecord {
	readonly approvedAtIso: string;
	readonly planFingerprint: string;
	readonly baseSourceRevision: string;
	readonly environment: string;
	readonly region: string;
	readonly acknowledgedHighRisk: boolean;
	readonly summary: string;
}

export const POLICY_PROVENANCE = 'CloudForge Offline Baseline Policies (2026.1)';
export const COST_CATALOG_PROVENANCE = 'CloudForge Static Azure Reference Rates (USD/mo, 2026-11 estimate only)';

interface CostReferenceEntry {
	readonly monthlyUsd: number;
	readonly status: 'estimated' | 'free';
	readonly basis: string;
}

const STATIC_AZURE_COST_CATALOG: Readonly<Record<string, CostReferenceEntry>> = {
	azurerm_resource_group: { monthlyUsd: 0, status: 'free', basis: 'Logical Azure container (no direct charge)' },
	azurerm_virtual_network: { monthlyUsd: 0, status: 'free', basis: 'VNet address space (data transfer billed separately)' },
	azurerm_subnet: { monthlyUsd: 0, status: 'free', basis: 'Logical subnet allocation (no direct charge)' },
	azurerm_network_security_group: { monthlyUsd: 0, status: 'free', basis: 'Standard NSG rules (no direct charge)' },
	azurerm_route_table: { monthlyUsd: 0, status: 'free', basis: 'User-defined route table (no direct charge)' },
	azurerm_public_ip: { monthlyUsd: 3.65, status: 'estimated', basis: 'Standard Static Public IP (~730 hrs @ $0.005/hr)' },
	azurerm_storage_account: { monthlyUsd: 18.0, status: 'estimated', basis: 'Standard GPv2 LRS baseline (~1 TB hot estimate)' },
	azurerm_key_vault: { monthlyUsd: 1.5, status: 'estimated', basis: 'Standard Key Vault operations baseline estimate' },
	azurerm_kubernetes_cluster: { monthlyUsd: 73.0, status: 'estimated', basis: 'AKS Standard Uptime SLA control plane (node pools excluded)' },
	azurerm_firewall: { monthlyUsd: 912.5, status: 'estimated', basis: 'Azure Firewall Standard deployment hours (~730 hrs)' },
	azurerm_nat_gateway: { monthlyUsd: 32.85, status: 'estimated', basis: 'NAT Gateway hourly baseline (GB processed excluded)' },
	azurerm_monitor_diagnostic_setting: { monthlyUsd: 5.0, status: 'estimated', basis: 'Log ingestion baseline estimate (volume-dependent)' },
};

function fnv1aHex(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function computePlanFingerprint(
	sourceKind: FullRootPlanReview['sourceKind'],
	baseSourceRevision: string,
	environment: string,
	region: string,
	changes: readonly PlanResourceChange[]
): string {
	const sig = [
		sourceKind,
		baseSourceRevision,
		environment,
		region,
		...changes.map(c => `${c.address}:${c.action}:${c.risk}:${c.summary}`).sort(),
	].join('|');
	return `plan-${fnv1aHex(sig)}-${fnv1aHex(sig.split('').reverse().join(''))}`;
}

/** Builds a full-root offline Plan Review from the active DraftDocument (honestly labeled as draft preview). */
export function buildDraftPlanReview(
	doc: DraftDocument,
	options?: { readonly environment?: string; readonly region?: string }
): FullRootPlanReview {
	const environment = options?.environment ?? 'local-draft';
	const region = options?.region ?? 'uksouth';
	const addedSet = new Set(doc.present.addedIds);
	const deletedSet = new Set(doc.present.deletedIds);
	const changes: PlanResourceChange[] = [];

	let createdCount = 0;
	let updatedCount = 0;
	let replacedCount = 0;
	let deletedCount = 0;
	let unchangedCount = 0;

	for (const node of doc.present.nodes) {
		const isAdded = addedSet.has(node.id);
		const draft = doc.present.drafts[node.id];
		if (isAdded) {
			createdCount++;
			changes.push({
				nodeId: node.id,
				address: node.label,
				resourceType: node.resourceType ?? node.kind,
				name: node.name,
				action: 'create',
				risk: 'low',
				summary: 'New resource in unsaved draft (ID & cloud endpoints known after apply)',
				hasUnknownAfterApply: true,
			});
		} else if (draft) {
			const forcesReplace = Boolean(draft.attributes.location || draft.attributes.resource_group_name);
			const action: PlanActionKind = forcesReplace ? 'replace' : 'update';
			if (action === 'replace') {
				replacedCount++;
			} else {
				updatedCount++;
			}
			changes.push({
				nodeId: node.id,
				address: node.label,
				resourceType: node.resourceType ?? node.kind,
				name: node.name,
				action,
				risk: action === 'replace' ? 'high' : 'medium',
				summary: action === 'replace'
					? 'Draft modifies location or resource_group_name (may force replacement in Azure)'
					: `Draft updates ${Object.keys(draft.attributes).length} attribute(s)`,
				hasUnknownAfterApply: action === 'replace',
			});
		} else {
			unchangedCount++;
		}
	}

	for (const baseNode of doc.baseGraph.nodes) {
		if (deletedSet.has(baseNode.id)) {
			deletedCount++;
			changes.push({
				nodeId: baseNode.id,
				address: baseNode.label,
				resourceType: baseNode.resourceType ?? baseNode.kind,
				name: baseNode.name,
				action: 'delete',
				risk: 'high',
				summary: 'Marked for removal in draft (verify downstream references before applying)',
				hasUnknownAfterApply: false,
			});
		}
	}

	changes.sort((a, b) => a.address.localeCompare(b.address));
	const hasHighRiskChanges = replacedCount > 0 || deletedCount > 0;
	const planFingerprint = computePlanFingerprint('offline_draft_preview', doc.baseSourceRevision, environment, region, changes);

	return {
		sourceKind: 'offline_draft_preview',
		baseSourceRevision: doc.baseSourceRevision,
		planFingerprint,
		environment,
		region,
		createdCount,
		updatedCount,
		replacedCount,
		deletedCount,
		unchangedCount,
		hasHighRiskChanges,
		changes,
		notice: 'Offline full-root draft preview — run Terraform/OpenTofu plan with your cloud backend for authoritative state diff.',
	};
}

/**
 * Parses an imported `terraform show -json <plan>` payload safely into a sanitized FullRootPlanReview.
 * Sensitive before/after literal values are never read or retained.
 */
export function parseTerraformPlanJson(
	rawJson: string,
	baseSourceRevision: string,
	graphNodes: readonly CanvasNodeSummary[],
	options?: { readonly environment?: string; readonly region?: string }
): FullRootPlanReview | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	if (!Array.isArray(record.resource_changes)) {
		return undefined;
	}
	const nodeByLabel = new Map(graphNodes.map(n => [n.label, n]));
	const changes: PlanResourceChange[] = [];
	let createdCount = 0;
	let updatedCount = 0;
	let replacedCount = 0;
	let deletedCount = 0;
	let unchangedCount = 0;

	for (const entry of record.resource_changes.slice(0, 1000)) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			continue;
		}
		const item = entry as Record<string, unknown>;
		const address = typeof item.address === 'string' ? item.address : '';
		const resourceType = typeof item.type === 'string' ? item.type : 'resource';
		const name = typeof item.name === 'string' ? item.name : address;
		const change = item.change && typeof item.change === 'object' && !Array.isArray(item.change)
			? (item.change as Record<string, unknown>)
			: undefined;
		const actions = Array.isArray(change?.actions) ? change.actions.filter((a): a is string => typeof a === 'string') : [];
		if (!address || actions.length === 0) {
			continue;
		}

		let action: PlanActionKind = 'no-op';
		if (actions.includes('create') && actions.includes('delete')) {
			action = 'replace';
			replacedCount++;
		} else if (actions.includes('create')) {
			action = 'create';
			createdCount++;
		} else if (actions.includes('delete')) {
			action = 'delete';
			deletedCount++;
		} else if (actions.includes('update')) {
			action = 'update';
			updatedCount++;
		} else {
			unchangedCount++;
			continue;
		}

		const hasUnknownAfterApply = Boolean(
			change?.after_unknown && typeof change.after_unknown === 'object' && Object.keys(change.after_unknown as Record<string, unknown>).length > 0
		);
		const risk: PlanRiskLevel = action === 'delete' || action === 'replace' ? 'high' : action === 'update' ? 'medium' : 'low';
		const matched = nodeByLabel.get(address);
		changes.push({
			nodeId: matched?.id ?? null,
			address,
			resourceType,
			name,
			action,
			risk,
			summary: `CLI plan action: ${actions.join(' -> ')}${hasUnknownAfterApply ? ' (contains values known after apply)' : ''}`,
			hasUnknownAfterApply,
		});
	}

	const environment = options?.environment ?? 'imported-plan';
	const region = options?.region ?? 'unspecified';
	const planFingerprint = computePlanFingerprint('imported_plan_json', baseSourceRevision, environment, region, changes);
	return {
		sourceKind: 'imported_plan_json',
		baseSourceRevision,
		planFingerprint,
		environment,
		region,
		createdCount,
		updatedCount,
		replacedCount,
		deletedCount,
		unchangedCount,
		hasHighRiskChanges: replacedCount > 0 || deletedCount > 0,
		changes,
		notice: 'Parsed from imported Terraform/OpenTofu JSON plan (sensitive attribute literals excluded).',
	};
}

/** Runs deterministic offline security & governance policy checks across the active graph and drafts. */
export function evaluateArchitecturePolicies(
	graph: CanvasGraphSnapshot,
	drafts: Readonly<Record<string, ResourceDraft>>,
	dependencyReport?: CanvasDependencyReport | null
): readonly PolicyFinding[] {
	const findings: PolicyFinding[] = [];
	let seq = 1;

	for (const node of graph.nodes) {
		const draft = drafts[node.id];
		const type = (node.resourceType ?? '').toLowerCase();

		if (type === 'azurerm_public_ip' && draft) {
			const sku = draft.attributes.sku;
			const skuVal = sku?.kind === 'literal' && typeof sku.value === 'string' ? sku.value : undefined;
			if (!skuVal || skuVal.toLowerCase() === 'basic') {
				findings.push({
					id: `pol-${seq++}`,
					ruleId: 'CF-SEC-001',
					severity: 'warning',
					nodeId: node.id,
					resourceLabel: node.label,
					title: 'Public IP should use Standard SKU',
					remediation: 'Set sku = "Standard" and allocation_method = "Static" for zone redundancy and secure-by-default ingress.',
					provenance: POLICY_PROVENANCE,
				});
			}
		}

		if (type === 'azurerm_network_security_group' && draft) {
			for (const block of draft.blocks) {
				if (block.name !== 'security_rule') {
					continue;
				}
				const dir = block.attributes.direction;
				const acc = block.attributes.access;
				const src = block.attributes.source_address_prefix;
				const dstPort = block.attributes.destination_port_range;
				const isInboundAllow = dir?.kind === 'literal' && dir.value === 'Inbound'
					&& acc?.kind === 'literal' && acc.value === 'Allow';
				const isWildcardSrc = src?.kind === 'literal' && (src.value === '*' || src.value === '0.0.0.0/0' || src.value === 'Internet');
				const isAdminPort = dstPort?.kind === 'literal' && (dstPort.value === '*' || dstPort.value === '22' || dstPort.value === '3389');
				if (isInboundAllow && isWildcardSrc && isAdminPort) {
					findings.push({
						id: `pol-${seq++}`,
						ruleId: 'CF-SEC-002',
						severity: 'error',
						nodeId: node.id,
						resourceLabel: node.label,
						title: 'NSG rule allows unrestricted Internet admin access',
						remediation: 'Restrict source_address_prefix to a trusted CIDR or Azure Bastion subnet instead of * / 0.0.0.0/0.',
						provenance: POLICY_PROVENANCE,
					});
				}
			}
		}

		if (draft && (type === 'azurerm_resource_group' || type === 'azurerm_virtual_network' || type === 'azurerm_network_security_group' || type === 'azurerm_public_ip')) {
			const tags = draft.attributes.tags;
			const hasTags = tags !== undefined && (tags.kind === 'expression' || (tags.kind === 'literal' && typeof tags.value === 'object' && tags.value !== null && Object.keys(tags.value).length > 0));
			if (!hasTags) {
				findings.push({
					id: `pol-${seq++}`,
					ruleId: 'CF-GOV-001',
					severity: 'info',
					nodeId: node.id,
					resourceLabel: node.label,
					title: 'Resource draft is missing governance tags',
					remediation: 'Add environment and owner tags to support Azure cost allocation and operational ownership.',
					provenance: POLICY_PROVENANCE,
				});
			}
		}
	}

	if (dependencyReport) {
		for (const prov of dependencyReport.providers) {
			if (prov.status === 'conflict' || prov.status === 'lockOutsideConstraints' || prov.status === 'unlocked') {
				findings.push({
					id: `pol-${seq++}`,
					ruleId: 'CF-DEP-001',
					severity: prov.status === 'conflict' ? 'error' : 'warning',
					nodeId: null,
					resourceLabel: prov.display,
					title: `Provider ${prov.display} is ${prov.status}`,
					remediation: 'Pin provider constraints and refresh .terraform.lock.hcl before planning a deployment.',
					provenance: POLICY_PROVENANCE,
				});
			}
		}
	}

	return findings;
}

/** Computes transparent offline monthly cost estimates & delta, marking uncatalogued resource types explicitly as unknown. */
export function estimateArchitectureCost(
	doc: DraftDocument,
	region = 'uksouth'
): ArchitectureCostEstimate {
	const baseIds = new Set(doc.baseGraph.nodes.map(n => n.id));
	const deletedSet = new Set(doc.present.deletedIds);
	const lines: ResourceCostLine[] = [];

	let baselineTotalUsd = 0;
	let projectedTotalUsd = 0;
	let knownCount = 0;
	let unknownCount = 0;

	const priceFor = (node: CanvasNodeSummary): CostReferenceEntry | undefined => {
		const type = (node.resourceType ?? '').toLowerCase();
		return STATIC_AZURE_COST_CATALOG[type];
	};

	for (const node of doc.present.nodes) {
		const ref = priceFor(node);
		const inBase = baseIds.has(node.id);
		if (ref) {
			knownCount++;
			const baseAmt = inBase ? ref.monthlyUsd : 0;
			const projAmt = ref.monthlyUsd;
			baselineTotalUsd += baseAmt;
			projectedTotalUsd += projAmt;
			lines.push({
				nodeId: node.id,
				resourceLabel: node.label,
				resourceType: node.resourceType ?? node.kind,
				status: ref.status,
				baselineMonthlyUsd: baseAmt,
				projectedMonthlyUsd: projAmt,
				deltaMonthlyUsd: Number((projAmt - baseAmt).toFixed(2)),
				basis: ref.basis,
			});
		} else {
			unknownCount++;
			lines.push({
				nodeId: node.id,
				resourceLabel: node.label,
				resourceType: node.resourceType ?? node.kind,
				status: 'unknown',
				baselineMonthlyUsd: null,
				projectedMonthlyUsd: null,
				deltaMonthlyUsd: null,
				basis: 'Unknown — not priced in offline reference catalog',
			});
		}
	}

	for (const baseNode of doc.baseGraph.nodes) {
		if (!deletedSet.has(baseNode.id)) {
			continue;
		}
		const ref = priceFor(baseNode);
		if (ref) {
			knownCount++;
			baselineTotalUsd += ref.monthlyUsd;
			lines.push({
				nodeId: baseNode.id,
				resourceLabel: `${baseNode.label} (deleted)`,
				resourceType: baseNode.resourceType ?? baseNode.kind,
				status: ref.status,
				baselineMonthlyUsd: ref.monthlyUsd,
				projectedMonthlyUsd: 0,
				deltaMonthlyUsd: Number((-ref.monthlyUsd).toFixed(2)),
				basis: `Removed from draft: ${ref.basis}`,
			});
		}
	}

	return {
		currency: 'USD',
		region,
		pricingCatalog: COST_CATALOG_PROVENANCE,
		isEstimate: true,
		baselineTotalUsd: Number(baselineTotalUsd.toFixed(2)),
		projectedTotalUsd: Number(projectedTotalUsd.toFixed(2)),
		deltaTotalUsd: Number((projectedTotalUsd - baselineTotalUsd).toFixed(2)),
		knownCount,
		unknownCount,
		lines,
	};
}

/** Creates an explicit plan approval record bound to the exact plan fingerprint and source revision. */
export function createPlanApproval(
	plan: FullRootPlanReview,
	acknowledgedHighRisk: boolean,
	approvedAtIso = new Date().toISOString()
): PlanApprovalRecord | undefined {
	if (plan.hasHighRiskChanges && !acknowledgedHighRisk) {
		return undefined;
	}
	return {
		approvedAtIso,
		planFingerprint: plan.planFingerprint,
		baseSourceRevision: plan.baseSourceRevision,
		environment: plan.environment,
		region: plan.region,
		acknowledgedHighRisk,
		summary: `+${plan.createdCount} create, ~${plan.updatedCount} update, \u00b1${plan.replacedCount} replace, -${plan.deletedCount} delete`,
	};
}

/** Verifies whether an approval still matches the current full-root plan and source revision. */
export function isPlanApprovalValid(
	approval: PlanApprovalRecord | null,
	currentPlan: FullRootPlanReview
): { readonly valid: boolean; readonly reason?: string } {
	if (!approval) {
		return { valid: false, reason: 'No plan approval recorded yet.' };
	}
	if (approval.baseSourceRevision !== currentPlan.baseSourceRevision) {
		return { valid: false, reason: 'Approval invalidated: architecture source revision changed.' };
	}
	if (approval.planFingerprint !== currentPlan.planFingerprint) {
		return { valid: false, reason: 'Approval invalidated: draft changes or target context changed since approval.' };
	}
	return { valid: true };
}
