/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure report formatters & snapshot upgrade grouping helpers for Workbench-level CloudForge
// tools (Readiness & Cost Audit, Provider Schema Upgrade Diff, Explain Resource, and Multi-Target
// IaC / Markdown Export). Zero runtime `vscode` imports so `node --test` verifies them directly.

import type { ResourceExplanation } from '../canvas/advisorRecipes';
import type { ArchitectureCostEstimate, PolicyFinding } from '../canvas/planReview';
import type {
	CanvasCatalogueSnapshot,
	CanvasDependencyReport,
	CanvasExportAuditReport,
	CanvasSchemaDiffReport
} from '../canvas/protocol';

export interface UpgradeableProviderGroup {
	readonly address: string;
	readonly snapshots: readonly CanvasCatalogueSnapshot[];
}

/**
 * Groups imported provider catalogue snapshots by provider address, keeping only providers with
 * at least 2 distinct versions (or distinct SHA-256 digests) so the user can pick From -> To.
 */
export function groupUpgradeableSnapshots(snapshots: readonly CanvasCatalogueSnapshot[]): UpgradeableProviderGroup[] {
	const byAddress = new Map<string, CanvasCatalogueSnapshot[]>();
	for (const snap of snapshots) {
		const list = byAddress.get(snap.address) ?? [];
		list.push(snap);
		byAddress.set(snap.address, list);
	}
	const groups: UpgradeableProviderGroup[] = [];
	for (const [address, list] of byAddress) {
		if (list.length < 2) {
			continue;
		}
		const sorted = [...list].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
		groups.push({ address, snapshots: sorted });
	}
	return groups.sort((a, b) => a.address.localeCompare(b.address));
}

/** Sanitizes an architecture name into a safe export filename stem. */
export function sanitizeExportStem(architectureName: string): string {
	const slug = architectureName
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return slug || 'cloudforge-architecture';
}

/** Formats the combined Stage 6/8 Dependencies, Export Audit, Policy & Offline Cost report. */
export function formatReadinessReportText(params: {
	readonly architectureName: string;
	readonly sourceRevision: string;
	readonly dependencyReport?: CanvasDependencyReport;
	readonly exportAudit?: CanvasExportAuditReport;
	readonly policyFindings: readonly PolicyFinding[];
	readonly costEstimate: ArchitectureCostEstimate;
}): string {
	const lines: string[] = [
		`CloudForge Architecture Readiness & Cost Report (${params.architectureName})`,
		`Source revision: rev ${params.sourceRevision.slice(0, 8)}`,
		'',
	];

	if (params.exportAudit) {
		const audit = params.exportAudit;
		const engineLabel = audit.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
		lines.push(
			'Reproducible Export Audit (Stage 8):',
			`  Status: ${audit.reproducible ? 'Reproducible' : 'Action required'}`,
			`  Engine: ${engineLabel}${audit.engineInferred ? ' (inferred)' : ''} | Lock file: ${audit.lockState} (${audit.lockEntryCount} entries) | Modules: ${audit.moduleCount}`,
		);
		if (audit.unresolvedReasonKinds.length > 0) {
			lines.push(`  Unresolved items: ${audit.unresolvedReasonKinds.join(', ')}`);
		}
		lines.push('');
	}

	if (params.dependencyReport) {
		const dep = params.dependencyReport;
		lines.push(`Provider Dependencies (Stage 6 - ${dep.providers.length} provider(s), lock: ${dep.lockState}):`);
		if (dep.providers.length === 0) {
			lines.push('  (No provider requirements detected)');
		} else {
			for (const prov of dep.providers) {
				const lock = prov.lockedVersion ? `locked ${prov.lockedVersion}` : 'unlocked';
				lines.push(`  [${prov.status}] ${prov.display} (${lock}, ${prov.requirementCount} reqs, ${prov.conflictCount} conflicts)`);
			}
		}
		lines.push('');
	}

	const cost = params.costEstimate;
	lines.push(
		`Offline Cost Estimate (${cost.pricingCatalog}):`,
		`  Estimated baseline: $${cost.baselineTotalUsd.toFixed(2)}/mo USD (region: ${cost.region})`,
		`  Coverage: ${cost.knownCount} catalogued, ${cost.unknownCount} unknown (not priced offline)`,
	);
	for (const line of cost.lines) {
		const amt = line.projectedMonthlyUsd === null ? 'unknown' : `$${line.projectedMonthlyUsd.toFixed(2)}/mo`;
		lines.push(`  - ${line.resourceLabel} (${line.resourceType}): ${amt} -- ${line.basis}`);
	}
	lines.push('');

	lines.push(`Offline Policy Checks (${params.policyFindings.length} finding(s)):`);
	if (params.policyFindings.length === 0) {
		lines.push('  No policy findings reported.');
	} else {
		for (const finding of params.policyFindings) {
			lines.push(`  [${finding.severity}] ${finding.ruleId} (${finding.resourceLabel}): ${finding.title}`);
			lines.push(`    Remediation: ${finding.remediation}`);
		}
	}

	return lines.join('\n') + '\n';
}

/** Formats a Stage 8 Provider Schema Upgrade Impact Diff for the Output Channel. */
export function formatSchemaDiffReportText(report: CanvasSchemaDiffReport, architectureName: string): string {
	const lines: string[] = [
		`CloudForge Provider Schema Upgrade Diff (${architectureName})`,
		`Provider: ${report.provider}`,
		`Upgrade: ${report.fromVersion} -> ${report.toVersion}`,
		`Summary: +${report.addedTypeCount} added types, -${report.removedTypeCount} removed types, ${report.pathChangeCount} attribute/block changes${report.hasBreakingChanges ? ' (contains breaking changes)' : ''}`,
		`Architecture Impact: ${report.impactedArchitectureItems.length} impacted item(s)${report.hasArchitectureBreakingChanges ? ' (BREAKING CHANGES DETECTED)' : ''}`,
	];
	if (report.impactedArchitectureItems.length > 0) {
		lines.push('', 'Impacted Architecture Resources:');
		for (const item of report.impactedArchitectureItems) {
			const tag = item.breaking ? 'BREAKING' : 'info';
			const field = item.path ? `${item.typeName}.${item.path}` : item.typeName;
			lines.push(`  [${tag}] ${item.resourceAddress} (${field}): ${item.summary}`);
		}
	}
	if (report.truncated) {
		lines.push('', 'Note: Schema diff output exceeded service bounds and was truncated.');
	}
	return lines.join('\n') + '\n';
}

/** Formats an offline Explain Resource brief as a clean Markdown preview document. */
export function formatResourceExplanationMarkdown(explanation: ResourceExplanation, architectureName: string): string {
	const node = explanation.node;
	const sourceLoc = node.sourceFile
		? `${node.sourceFile}${node.sourceLine ? `:${node.sourceLine}` : ''}`
		: 'Not linked to a single .tf file';
	const costText = explanation.estimatedMonthlyUsd === null
		? 'Unknown (not priced in offline reference catalog)'
		: `$${explanation.estimatedMonthlyUsd.toFixed(2)}/mo USD`;

	const lines: string[] = [
		`# ${node.label} (\`${node.resourceType ?? node.kind}\`)`,
		'',
		`> ${explanation.dataScopeDisclosure}`,
		'',
		'| Property | Value |',
		'| --- | --- |',
		`| Architecture | ${architectureName} |`,
		`| Kind | \`${node.kind}\` |`,
		`| Terraform Name | \`${node.name}\` |`,
		`| Project Source | \`${sourceLoc}\` |`,
		`| Schema Provenance | ${explanation.schemaProvenance} |`,
		`| Estimated Cost | ${costText} |`,
		`| Cost Basis | ${explanation.costBasis} |`,
		`| Transitive Dependents | ${explanation.transitiveImpactCount} resource(s) |`,
		'',
		'## Summary',
		'',
		explanation.summary,
		'',
		'## Relationships',
		'',
		`- **Upstream prerequisites (${explanation.upstreamNames.length}):** ${explanation.upstreamNames.length > 0 ? explanation.upstreamNames.map(n => `\`${n}\``).join(', ') : 'None'}`,
		`- **Direct dependents (${explanation.downstreamNames.length}):** ${explanation.downstreamNames.length > 0 ? explanation.downstreamNames.map(n => `\`${n}\``).join(', ') : 'None'}`,
		'',
	];

	if (explanation.findings.length > 0) {
		lines.push('## Policy Findings', '');
		for (const finding of explanation.findings) {
			lines.push(`- **[${finding.severity.toUpperCase()}] ${finding.ruleId}:** ${finding.title} -- ${finding.remediation}`);
		}
		lines.push('');
	}

	if (explanation.proposals.length > 0) {
		lines.push('## Advisor Recommendations', '');
		for (const prop of explanation.proposals) {
			lines.push(`- **${prop.title}:** ${prop.rationale}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
