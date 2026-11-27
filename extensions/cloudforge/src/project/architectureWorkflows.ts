/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure parsers, validators, and report formatters for Stage 8B (`exportPortableBundle`),
// Stage 8C (`previewProviderUpgrade`, `applyProviderUpgrade`, `recoverUpgradeJournal`), and
// Stage 9C (`runEngineFmt`). Zero runtime `vscode` imports so `node --test` verifies them directly.

export type WorkflowEngine = 'openTofu' | 'terraform';

export interface PortableBundleExcludedArtifact {
	readonly path: string;
	readonly reason: string;
}

export interface PortableBundleExportResult {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly bundleName: string;
	readonly engine: WorkflowEngine;
	readonly engineInferred: boolean;
	readonly verificationStatus: string;
	readonly bundleSha256: string;
	readonly fileCount: number;
	readonly totalBytes: number;
	readonly excludedCount: number;
	readonly warningCount: number;
	readonly unresolvedReasons: readonly string[];
	readonly warnings: readonly string[];
	readonly excludedArtifacts: readonly PortableBundleExcludedArtifact[];
	readonly files: readonly string[];
}

export interface EngineFmtResult {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly newSourceRevision?: string;
	readonly engine: WorkflowEngine;
	readonly engineVersion: string;
	readonly engineInferred: boolean;
	readonly mode: 'check' | 'apply';
	readonly formatted: boolean;
	readonly changedFiles: readonly string[];
	readonly durationMs: number;
}

export interface ProviderUpgradeFileChange {
	readonly file: string;
	readonly beforeSha256: string;
	readonly afterSha256: string;
	readonly unifiedDiff: string;
}

export interface ProviderUpgradeSchemaImpactItem {
	readonly resourceAddress: string;
	readonly typeName: string;
	readonly path?: string;
	readonly breaking: boolean;
	readonly summary: string;
}

export interface ProviderUpgradeSchemaDiff {
	readonly provider: string;
	readonly fromVersion: string;
	readonly toVersion: string;
	readonly hasBreakingChanges: boolean;
	readonly hasArchitectureBreakingChanges: boolean;
	readonly impactedArchitectureItems: readonly ProviderUpgradeSchemaImpactItem[];
}

export interface ProviderUpgradePreview {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly proposalId: string;
	readonly sourceRevision: string;
	readonly providerAddress: string;
	readonly currentVersion: string | null;
	readonly targetVersion: string;
	readonly targetConstraint: string;
	readonly engine: WorkflowEngine;
	readonly engineInferred: boolean;
	readonly targetPlatforms: readonly string[];
	readonly fileChanges: readonly ProviderUpgradeFileChange[];
	readonly schemaDiffs: readonly ProviderUpgradeSchemaDiff[];
	readonly hasBreakingSchemaChanges: boolean;
	readonly hasArchitectureBreakingChanges: boolean;
	readonly mirrorReady: boolean;
	readonly missingMirrorPlatforms: readonly string[];
	readonly checksRan: readonly string[];
	readonly checksPending: readonly string[];
}

export interface ProviderUpgradeApplyResult {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly proposalId: string;
	readonly updatedFiles: readonly string[];
	readonly newSourceRevision: string;
	readonly lockRefreshRequired: boolean;
}

export interface UpgradeJournalRecoveryResult {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly recovered: boolean;
	readonly proposalId?: string;
	readonly priorState?: string;
	readonly restoredFiles: readonly string[];
	readonly sourceRevision: string;
}

const REVISION_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PROPOSAL_ID_RE = /^upgrade-[0-9a-f]{32}$/;
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEngine(value: unknown): value is WorkflowEngine {
	return value === 'openTofu' || value === 'terraform';
}

function isSafeString(value: unknown, maxLen = 512): value is string {
	return typeof value === 'string' && value.length <= maxLen && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function parseStringList(value: unknown, maxItems = 256, maxLen = 512): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: string[] = [];
	for (const item of value.slice(0, maxItems)) {
		if (isSafeString(item, maxLen)) {
			out.push(item);
		}
	}
	return out;
}

/** Validates a single-component portable bundle directory name for Windows & POSIX safety. */
export function isValidBundleName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed.length > 96) {
		return false;
	}
	if (trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.endsWith(' ')) {
		return false;
	}
	if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(trimmed) || WINDOWS_RESERVED_RE.test(trimmed)) {
		return false;
	}
	return true;
}

/** Validates a stable `major.minor.patch` provider version string (matching Rust Stage 8C). */
export function isValidSemverVersion(version: string): boolean {
	return SEMVER_RE.test(version.trim());
}

/** Computes the default pessimistic constraint (`~> major.minor`) for a target release. */
export function defaultUpgradeConstraint(version: string): string {
	const trimmed = version.trim();
	const parts = trimmed.split('.');
	if (parts.length === 3 && SEMVER_RE.test(trimmed)) {
		return `~> ${parts[0]}.${parts[1]}`;
	}
	return `= ${trimmed}`;
}

export function parsePortableBundleExport(value: unknown): PortableBundleExportResult | undefined {
	if (
		!isRecord(value)
		|| !isSafeString(value.workspaceId, 256)
		|| !isSafeString(value.architectureId, 256)
		|| typeof value.sourceRevision !== 'string' || !REVISION_RE.test(value.sourceRevision)
		|| !isSafeString(value.bundleName, 128)
		|| !isEngine(value.engine)
		|| typeof value.engineInferred !== 'boolean'
		|| !isSafeString(value.verificationStatus, 128)
		|| typeof value.bundleSha256 !== 'string' || !REVISION_RE.test(value.bundleSha256)
		|| typeof value.fileCount !== 'number' || !Number.isFinite(value.fileCount)
		|| typeof value.totalBytes !== 'number' || !Number.isFinite(value.totalBytes)
		|| typeof value.excludedCount !== 'number' || !Number.isFinite(value.excludedCount)
		|| typeof value.warningCount !== 'number' || !Number.isFinite(value.warningCount)
	) {
		return undefined;
	}
	const excludedArtifacts: PortableBundleExcludedArtifact[] = [];
	if (Array.isArray(value.excludedArtifacts)) {
		for (const item of value.excludedArtifacts.slice(0, 256)) {
			if (isRecord(item) && isSafeString(item.path, 256) && isSafeString(item.reason, 256)) {
				excludedArtifacts.push({ path: item.path, reason: item.reason });
			}
		}
	}
	const files: string[] = [];
	if (Array.isArray(value.files)) {
		for (const entry of value.files.slice(0, 512)) {
			if (isSafeString(entry, 256)) {
				files.push(entry);
			} else if (isRecord(entry) && isSafeString(entry.path, 256)) {
				files.push(entry.path);
			}
		}
	}
	const unresolvedReasons: string[] = [];
	if (Array.isArray(value.unresolvedReasons)) {
		for (const reason of value.unresolvedReasons.slice(0, 128)) {
			if (isSafeString(reason, 256)) {
				unresolvedReasons.push(reason);
			} else if (isRecord(reason) && isSafeString(reason.kind, 128)) {
				const detail = isSafeString(reason.message, 256) ? `: ${reason.message}` : '';
				unresolvedReasons.push(`${reason.kind}${detail}`);
			}
		}
	}
	return {
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		sourceRevision: value.sourceRevision,
		bundleName: value.bundleName,
		engine: value.engine,
		engineInferred: value.engineInferred,
		verificationStatus: value.verificationStatus,
		bundleSha256: value.bundleSha256,
		fileCount: value.fileCount,
		totalBytes: value.totalBytes,
		excludedCount: value.excludedCount,
		warningCount: value.warningCount,
		unresolvedReasons,
		warnings: parseStringList(value.warnings, 128, 512),
		excludedArtifacts,
		files,
	};
}

export function parseEngineFmtResult(value: unknown): EngineFmtResult | undefined {
	if (
		!isRecord(value)
		|| !isSafeString(value.workspaceId, 256)
		|| !isSafeString(value.architectureId, 256)
		|| typeof value.sourceRevision !== 'string' || !REVISION_RE.test(value.sourceRevision)
		|| !isEngine(value.engine)
		|| !isSafeString(value.engineVersion, 64)
		|| typeof value.engineInferred !== 'boolean'
		|| (value.mode !== 'check' && value.mode !== 'apply')
		|| typeof value.formatted !== 'boolean'
		|| typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs)
	) {
		return undefined;
	}
	if (value.newSourceRevision !== undefined && (typeof value.newSourceRevision !== 'string' || !REVISION_RE.test(value.newSourceRevision))) {
		return undefined;
	}
	return {
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		sourceRevision: value.sourceRevision,
		...(typeof value.newSourceRevision === 'string' ? { newSourceRevision: value.newSourceRevision } : {}),
		engine: value.engine,
		engineVersion: value.engineVersion,
		engineInferred: value.engineInferred,
		mode: value.mode,
		formatted: value.formatted,
		changedFiles: parseStringList(value.changedFiles, 256, 255),
		durationMs: value.durationMs,
	};
}

export function parseProviderUpgradePreview(value: unknown): ProviderUpgradePreview | undefined {
	if (
		!isRecord(value)
		|| !isSafeString(value.workspaceId, 256)
		|| !isSafeString(value.architectureId, 256)
		|| typeof value.proposalId !== 'string' || !PROPOSAL_ID_RE.test(value.proposalId)
		|| typeof value.sourceRevision !== 'string' || !REVISION_RE.test(value.sourceRevision)
		|| !isSafeString(value.providerAddress, 256)
		|| (value.currentVersion !== null && !isSafeString(value.currentVersion, 64))
		|| !isSafeString(value.targetVersion, 64)
		|| !isSafeString(value.targetConstraint, 128)
		|| !isEngine(value.engine)
		|| typeof value.engineInferred !== 'boolean'
		|| typeof value.hasBreakingSchemaChanges !== 'boolean'
		|| typeof value.hasArchitectureBreakingChanges !== 'boolean'
		|| typeof value.mirrorReady !== 'boolean'
		|| !Array.isArray(value.fileChanges)
	) {
		return undefined;
	}
	const fileChanges: ProviderUpgradeFileChange[] = [];
	for (const change of value.fileChanges.slice(0, 128)) {
		if (
			!isRecord(change)
			|| !isSafeString(change.file, 255)
			|| typeof change.beforeSha256 !== 'string'
			|| typeof change.afterSha256 !== 'string'
			|| typeof change.unifiedDiff !== 'string'
		) {
			return undefined;
		}
		fileChanges.push({
			file: change.file,
			beforeSha256: change.beforeSha256,
			afterSha256: change.afterSha256,
			unifiedDiff: change.unifiedDiff,
		});
	}
	const schemaDiffs: ProviderUpgradeSchemaDiff[] = [];
	if (Array.isArray(value.schemaDiffs)) {
		for (const diff of value.schemaDiffs.slice(0, 32)) {
			if (!isRecord(diff)) {
				continue;
			}
			const impacted: ProviderUpgradeSchemaImpactItem[] = [];
			const rawImpacted = Array.isArray(diff.impactedArchitectureItems)
				? diff.impactedArchitectureItems
				: Array.isArray(diff.impacted_architecture_items)
					? diff.impacted_architecture_items
					: [];
			for (const item of rawImpacted.slice(0, 200)) {
				if (!isRecord(item)) {
					continue;
				}
				const address = (typeof item.resourceAddress === 'string' ? item.resourceAddress : item.resource_address) as string | undefined;
				const typeName = (typeof item.typeName === 'string' ? item.typeName : item.type_name) as string | undefined;
				const summary = typeof item.summary === 'string' ? item.summary : undefined;
				if (address && typeName && summary) {
					impacted.push({
						resourceAddress: address,
						typeName,
						...(typeof item.path === 'string' ? { path: item.path } : {}),
						breaking: Boolean(item.breaking),
						summary,
					});
				}
			}
			const provider = typeof diff.provider === 'string' ? diff.provider : value.providerAddress;
			const fromVersion = typeof diff.fromVersion === 'string' ? diff.fromVersion : typeof diff.from_version === 'string' ? diff.from_version : (value.currentVersion ?? '');
			const toVersion = typeof diff.toVersion === 'string' ? diff.toVersion : typeof diff.to_version === 'string' ? diff.to_version : value.targetVersion;
			schemaDiffs.push({
				provider,
				fromVersion,
				toVersion,
				hasBreakingChanges: Boolean(diff.hasBreakingChanges ?? diff.has_breaking_changes),
				hasArchitectureBreakingChanges: Boolean(diff.hasArchitectureBreakingChanges ?? diff.has_architecture_breaking_changes),
				impactedArchitectureItems: impacted,
			});
		}
	}
	return {
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		proposalId: value.proposalId,
		sourceRevision: value.sourceRevision,
		providerAddress: value.providerAddress,
		currentVersion: value.currentVersion,
		targetVersion: value.targetVersion,
		targetConstraint: value.targetConstraint,
		engine: value.engine,
		engineInferred: value.engineInferred,
		targetPlatforms: parseStringList(value.targetPlatforms, 16, 64),
		fileChanges,
		schemaDiffs,
		hasBreakingSchemaChanges: value.hasBreakingSchemaChanges,
		hasArchitectureBreakingChanges: value.hasArchitectureBreakingChanges,
		mirrorReady: value.mirrorReady,
		missingMirrorPlatforms: parseStringList(value.missingMirrorPlatforms, 16, 64),
		checksRan: parseStringList(value.checksRan, 32, 64),
		checksPending: parseStringList(value.checksPending, 32, 64),
	};
}

export function parseProviderUpgradeApply(value: unknown): ProviderUpgradeApplyResult | undefined {
	if (
		!isRecord(value)
		|| !isSafeString(value.workspaceId, 256)
		|| !isSafeString(value.architectureId, 256)
		|| typeof value.proposalId !== 'string' || !PROPOSAL_ID_RE.test(value.proposalId)
		|| typeof value.newSourceRevision !== 'string' || !REVISION_RE.test(value.newSourceRevision)
		|| typeof value.lockRefreshRequired !== 'boolean'
	) {
		return undefined;
	}
	return {
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		proposalId: value.proposalId,
		updatedFiles: parseStringList(value.updatedFiles, 256, 255),
		newSourceRevision: value.newSourceRevision,
		lockRefreshRequired: value.lockRefreshRequired,
	};
}

export function parseUpgradeJournalRecovery(value: unknown): UpgradeJournalRecoveryResult | undefined {
	if (
		!isRecord(value)
		|| !isSafeString(value.workspaceId, 256)
		|| !isSafeString(value.architectureId, 256)
		|| typeof value.recovered !== 'boolean'
		|| typeof value.sourceRevision !== 'string' || !REVISION_RE.test(value.sourceRevision)
	) {
		return undefined;
	}
	return {
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		recovered: value.recovered,
		...(typeof value.proposalId === 'string' ? { proposalId: value.proposalId } : {}),
		...(typeof value.priorState === 'string' ? { priorState: value.priorState } : {}),
		restoredFiles: parseStringList(value.restoredFiles, 256, 255),
		sourceRevision: value.sourceRevision,
	};
}

export function formatEngineFmtSummary(result: EngineFmtResult): string {
	const engineLabel = result.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
	if (result.mode === 'check') {
		return result.formatted
			? `All Terraform files are already formatted (${engineLabel} ${result.engineVersion} · ${result.durationMs} ms).`
			: `${result.changedFiles.length} file(s) need formatting (${engineLabel} ${result.engineVersion}): ${result.changedFiles.join(', ')}.`;
	}
	const rev = result.newSourceRevision ? ` · rev ${result.newSourceRevision.slice(0, 8)}` : '';
	return result.changedFiles.length > 0
		? `Formatted ${result.changedFiles.length} file(s) with ${engineLabel} ${result.engineVersion} (${result.changedFiles.join(', ')})${rev}.`
		: `All Terraform files are already formatted (${engineLabel} ${result.engineVersion})${rev}.`;
}

export function formatPortableBundleSummaryMarkdown(result: PortableBundleExportResult, architectureName: string): string {
	const engineLabel = result.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
	const lines: string[] = [
		`# Portable Terraform Bundle — ${result.bundleName}`,
		'',
		`- **Architecture:** ${architectureName}`,
		`- **Source revision:** \`${result.sourceRevision.slice(0, 12)}\``,
		`- **Engine:** ${engineLabel}${result.engineInferred ? ' (inferred)' : ''}`,
		`- **Verification status:** \`${result.verificationStatus}\``,
		`- **Bundle SHA-256:** \`${result.bundleSha256}\``,
		`- **Exported files:** ${result.fileCount} (${result.totalBytes.toLocaleString('en-US')} bytes)`,
		`- **Excluded sensitive/local artifacts:** ${result.excludedCount}`,
		'',
	];

	if (result.excludedArtifacts.length > 0) {
		lines.push('## Excluded Local & Secret Artifacts (Never Copied)', '');
		for (const item of result.excludedArtifacts) {
			lines.push(`- \`${item.path}\` — ${item.reason}`);
		}
		lines.push('');
	}

	if (result.unresolvedReasons.length > 0) {
		lines.push('## Unresolved Reproducibility Items', '');
		for (const reason of result.unresolvedReasons) {
			lines.push(`- ${reason}`);
		}
		lines.push('');
	}

	if (result.warnings.length > 0) {
		lines.push('## Warnings', '');
		for (const warning of result.warnings) {
			lines.push(`- ${warning}`);
		}
		lines.push('');
	}

	if (result.files.length > 0) {
		lines.push('## Included Files', '');
		for (const file of result.files) {
			lines.push(`- \`${file}\``);
		}
		lines.push('');
	}

	return lines.join('\n');
}

export function formatProviderUpgradePreviewMarkdown(preview: ProviderUpgradePreview, architectureName: string): string {
	const engineLabel = preview.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
	const fromLabel = preview.currentVersion ?? 'unlocked';
	const lines: string[] = [
		`# Provider Upgrade Preview — ${preview.providerAddress}`,
		'',
		`- **Architecture:** ${architectureName}`,
		`- **Proposal ID:** \`${preview.proposalId}\``,
		`- **Source revision:** \`${preview.sourceRevision.slice(0, 12)}\``,
		`- **Upgrade:** \`${fromLabel}\` → \`${preview.targetVersion}\` (constraint \`${preview.targetConstraint}\`)`,
		`- **Engine:** ${engineLabel}${preview.engineInferred ? ' (inferred)' : ''}`,
		`- **Offline mirror:** ${preview.mirrorReady ? 'Ready for all target platforms' : `Missing target package for: ${preview.missingMirrorPlatforms.join(', ')}`}`,
		`- **Breaking schema changes:** ${preview.hasArchitectureBreakingChanges ? 'YES — impacts resources in this architecture' : preview.hasBreakingSchemaChanges ? 'Yes (outside current architecture resources)' : 'None detected in available catalogue snapshots'}`,
		'',
	];

	const impacted = preview.schemaDiffs.flatMap(diff => diff.impactedArchitectureItems);
	if (impacted.length > 0) {
		lines.push('## Impacted Architecture Resources', '');
		for (const item of impacted) {
			const tag = item.breaking ? '**BREAKING**' : 'info';
			const field = item.path ? `${item.typeName}.${item.path}` : item.typeName;
			lines.push(`- [${tag}] \`${item.resourceAddress}\` (\`${field}\`): ${item.summary}`);
		}
		lines.push('');
	}

	lines.push('## Proposed File Edits', '');
	for (const change of preview.fileChanges) {
		lines.push(`### \`${change.file}\``, '', '```diff', change.unifiedDiff.trimEnd(), '```', '');
	}

	if (preview.checksRan.length > 0 || preview.checksPending.length > 0) {
		lines.push('## Verification Checklist', '');
		if (preview.checksRan.length > 0) {
			lines.push(`- **Completed:** ${preview.checksRan.join(', ')}`);
		}
		if (preview.checksPending.length > 0) {
			lines.push(`- **Pending after apply:** ${preview.checksPending.join(', ')}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
