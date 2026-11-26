/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Offline Provider-Package Management: native QuickPick guided workflow and unified
// truthful-state command handlers (Browse, Details, Import, Verify Integrity, Cleanup Review,
// Single-Package Removal Confirmation, Readiness, Schema Extraction, and Offline Init).
//
// Uses existing protocol-1 broker methods only; never writes workspace files, Architecture,
// Resource.positions, Modified state, or Undo history.

import {
	l10n,
	ProgressLocation,
	QuickInputButtons,
	QuickPickItemKind,
	window,
	type QuickPickItem
} from 'vscode';
import { parseOfflineMirrorReadiness } from '../canvas/serviceAdapters';
import {
	buildCleanupQuickPickRows,
	formatMirrorBytes,
	formatMirrorPackageKey,
	isMirrorScopeCurrent,
	parseMirrorCleanupPlan,
	parseMirrorEvictionResult,
	parseMirrorImportResult,
	parseMirrorIntegrityReport,
	parseMirrorInventory,
	parseQuotaMiBToBytes,
	sameMirrorPackageKey,
	type MirrorCleanupPlan,
	type MirrorIntegrityReport,
	type MirrorPackageKey,
	type MirrorPackageSummary,
	type MirrorScopeContext
} from './model';

export interface MirrorServiceError {
	readonly code: string;
}

export type MirrorServiceCallResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: MirrorServiceError };

export interface OfflineMirrorHost {
	readonly callService: <T>(method: string, params: Record<string, unknown>) => Promise<MirrorServiceCallResult<T>>;
	readonly showServiceError: (error: MirrorServiceError) => void;
	readonly getScope: () => MirrorScopeContext | undefined;
	readonly onMirrorMutated: () => void;
	readonly runExtractSchema: (key?: MirrorPackageKey) => Promise<void>;
	readonly runInitOffline: () => Promise<void>;
}

const BACK_SENTINEL = Symbol('back');

interface ActionPickItem<T> extends QuickPickItem {
	readonly value: T;
}

function showGuidedQuickPick<T>(options: {
	readonly title: string;
	readonly placeholder: string;
	readonly items: readonly (ActionPickItem<T> | QuickPickItem)[];
	readonly canGoBack?: boolean;
	readonly initialSearch?: string;
}): Promise<T | typeof BACK_SENTINEL | undefined> {
	return new Promise(resolve => {
		const qp = window.createQuickPick<QuickPickItem>();
		qp.title = options.title;
		qp.placeholder = options.placeholder;
		qp.items = [...options.items];
		qp.matchOnDescription = true;
		qp.matchOnDetail = true;
		if (options.initialSearch) {
			qp.value = options.initialSearch;
		}
		if (options.canGoBack) {
			qp.buttons = [QuickInputButtons.Back];
		}
		let settled = false;
		const finish = (result: T | typeof BACK_SENTINEL | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			qp.dispose();
			resolve(result);
		};
		qp.onDidTriggerButton(button => {
			if (button === QuickInputButtons.Back) {
				finish(BACK_SENTINEL);
			}
		});
		qp.onDidAccept(() => {
			const picked = qp.selectedItems[0] as ActionPickItem<T> | undefined;
			if (!picked || picked.kind === QuickPickItemKind.Separator || picked.value === undefined) {
				return;
			}
			finish(picked.value);
		});
		qp.onDidHide(() => finish(undefined));
		qp.show();
	});
}

/**
 * Unified modal removal review and commit used by both direct removal and cleanup review.
 * Never evicts on selection alone; validates `bytesReclaimed` without falling back to old size.
 */
export async function confirmAndEvictMirrorPackage(
	host: OfflineMirrorHost,
	key: MirrorPackageKey,
	sizeBytes?: number
): Promise<boolean> {
	const identity = formatMirrorPackageKey(key);
	const sizeNote = sizeBytes !== undefined ? ` (${formatMirrorBytes(sizeBytes)})` : '';
	const confirmAction = l10n.t('Remove Package');
	const confirm = await window.showWarningMessage(
		l10n.t('Remove {0}{1} from the local offline provider mirror? Removing a local archive can prevent later offline initialization if an architecture still requires it.', identity, sizeNote),
		{ modal: true },
		confirmAction
	);
	if (confirm !== confirmAction) {
		return false;
	}
	const evicted = await host.callService<unknown>('evictMirrorPackage', {
		address: key.address,
		version: key.version,
		platform: key.platform,
	});
	if (!evicted.ok) {
		host.showServiceError(evicted.error);
		return false;
	}
	host.onMirrorMutated();
	const parsed = parseMirrorEvictionResult(evicted.value);
	if (!parsed.ok) {
		void window.showWarningMessage(l10n.t('Removal result unavailable; refresh to confirm.'));
		return true;
	}
	void window.showInformationMessage(
		l10n.t('Removed {0} from the local offline mirror ({1} reclaimed).', formatMirrorPackageKey(parsed.value.key), formatMirrorBytes(parsed.value.bytesReclaimed))
	);
	return true;
}

/**
 * Truthful mirror integrity verification. Rejects malformed or inconsistent counter payloads
 * instead of showing a fake healthy-zero notification, and surfaces issue rows in a QuickPick.
 */
export async function runVerifiedMirrorIntegrityCheck(
	host: OfflineMirrorHost,
	options: { readonly allowBack?: boolean } = {}
): Promise<{ readonly report?: MirrorIntegrityReport; readonly back?: boolean; readonly inspectKey?: MirrorPackageKey }> {
	const verified = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: l10n.t('CloudForge: Verifying local offline provider mirror integrity…'),
			cancellable: false,
		},
		() => host.callService<unknown>('verifyMirrorIntegrity', {})
	);
	if (!verified.ok) {
		host.showServiceError(verified.error);
		return {};
	}
	const parsed = parseMirrorIntegrityReport(verified.value);
	if (!parsed.ok) {
		void window.showErrorMessage(l10n.t('Mirror verification report unavailable: {0}', parsed.reason));
		return {};
	}
	const report = parsed.value;
	if (!options.allowBack && report.healthy && !report.truncated) {
		void window.showInformationMessage(
			l10n.t('Verified in this check: {0} intact package(s) ({1} total).', report.verifiedCount, formatMirrorBytes(report.totalBytes))
		);
		return { report };
	}

	const items: (ActionPickItem<{ readonly action: 'refresh' | 'inspect'; readonly key?: MirrorPackageKey }> | QuickPickItem)[] = [];
	items.push({
		label: report.healthy
			? `$(verified) ${l10n.t('Verified in this check: {0} intact package(s)', report.verifiedCount)}`
			: `$(warning) ${l10n.t('{0} verified · {1} missing archive(s) · {2} corrupted', report.verifiedCount, report.missingArchiveCount, report.corruptedCount)}`,
		description: formatMirrorBytes(report.totalBytes) + (report.truncated ? ` · ${l10n.t('Truncated')}` : ''),
		detail: l10n.t('Select to rerun integrity verification'),
		value: { action: 'refresh' },
	});
	const issueEntries = report.entries.filter(entry => entry.status !== 'verified');
	if (issueEntries.length > 0) {
		items.push({ label: l10n.t('Packages needing attention'), kind: QuickPickItemKind.Separator });
		for (const entry of issueEntries) {
			const statusLabel = entry.status === 'missingArchive' ? l10n.t('Missing archive') : l10n.t('Corrupted');
			items.push({
				label: `$(error) ${formatMirrorPackageKey(entry.key)}`,
				description: statusLabel,
				detail: entry.reason ?? l10n.t('Archive failed integrity verification; inspect details or re-import.'),
				value: { action: 'inspect', key: entry.key },
			});
		}
	}
	const verifiedEntries = report.entries.filter(entry => entry.status === 'verified');
	if (verifiedEntries.length > 0) {
		items.push({ label: l10n.t('Verified in this check'), kind: QuickPickItemKind.Separator });
		for (const entry of verifiedEntries) {
			items.push({
				label: `$(pass) ${formatMirrorPackageKey(entry.key)}`,
				description: entry.archiveSize !== undefined ? formatMirrorBytes(entry.archiveSize) : l10n.t('Verified in this check'),
				value: { action: 'inspect', key: entry.key },
			});
		}
	}

	const choice = await showGuidedQuickPick({
		title: l10n.t('Local Provider Mirror Integrity Results'),
		placeholder: report.healthy
			? l10n.t('All packages verified in this check · select a package to inspect or press Escape')
			: l10n.t('Inspect missing or corrupted packages (no automatic deletion or repair)'),
		items,
		canGoBack: options.allowBack,
	});
	if (choice === BACK_SENTINEL) {
		return { report, back: true };
	}
	if (!choice) {
		return { report };
	}
	if (choice.action === 'refresh') {
		return runVerifiedMirrorIntegrityCheck(host, options);
	}
	return { report, inspectKey: choice.key };
}

/**
 * Guided cleanup planner & review. Validates quota MiB safely, surfaces Eligible for Review,
 * In Use (active lease), and Pinned by Active Architecture rows, honestly reports blocked
 * over-quota shortfalls, and ALWAYS requires explicit modal confirmation before eviction.
 */
export async function runGuidedMirrorCleanup(
	host: OfflineMirrorHost,
	options: { readonly allowBack?: boolean } = {}
): Promise<{ readonly mutated: boolean; readonly back?: boolean }> {
	const capturedScope = host.getScope();
	const scopeHint = capturedScope
		? l10n.t('Active architecture "{0}" lockfile pins checked (other projects/windows not checked).', capturedScope.architectureName)
		: l10n.t('Architecture pins not checked (no active architecture selected).');

	const quotaText = await window.showInputBox({
		title: l10n.t('Target Local Provider Mirror Quota (MiB)'),
		prompt: scopeHint,
		value: '512',
		placeHolder: '512',
		validateInput: text => {
			const check = parseQuotaMiBToBytes(text);
			return check.ok ? undefined : check.reason;
		},
	});
	if (quotaText === undefined) {
		return { mutated: false, back: options.allowBack };
	}
	const quotaParsed = parseQuotaMiBToBytes(quotaText);
	if (!quotaParsed.ok) {
		void window.showErrorMessage(quotaParsed.reason);
		return { mutated: false };
	}
	if (!isMirrorScopeCurrent(capturedScope, host.getScope())) {
		void window.showWarningMessage(l10n.t('The active architecture or source changed during cleanup planning. Run cleanup review again.'));
		return { mutated: false };
	}

	const params: Record<string, unknown> = capturedScope
		? {
			quotaBytes: quotaParsed.value.quotaBytes,
			workspaceId: capturedScope.workspaceId,
			architectureId: capturedScope.architectureId,
			expectedSourceRevision: capturedScope.sourceRevision,
		}
		: { quotaBytes: quotaParsed.value.quotaBytes };

	const planned = await host.callService<unknown>('planMirrorCleanup', params);
	if (!planned.ok) {
		host.showServiceError(planned.error);
		return { mutated: false };
	}
	const parsed = parseMirrorCleanupPlan(planned.value);
	if (!parsed.ok) {
		void window.showErrorMessage(l10n.t('Mirror cleanup plan unavailable: {0}', parsed.reason));
		return { mutated: false };
	}
	const plan: MirrorCleanupPlan = parsed.value;
	if (!isMirrorScopeCurrent(capturedScope, host.getScope())) {
		void window.showWarningMessage(l10n.t('The active architecture or source changed while loading the cleanup plan. Please rerun cleanup review.'));
		return { mutated: false };
	}

	if (plan.status === 'within-quota' && plan.protectedActive.length === 0 && plan.pinnedRequiringReview.length === 0 && !plan.truncated) {
		void window.showInformationMessage(
			l10n.t('Local provider mirror is within quota ({0} used; {1} target quota).', formatMirrorBytes(plan.totalBytes), formatMirrorBytes(plan.quotaBytes))
		);
		return { mutated: false, back: options.allowBack };
	}

	const rows = buildCleanupQuickPickRows(plan);
	const items: (ActionPickItem<{ readonly action: 'evict' | 'info' | 'refresh'; readonly key?: MirrorPackageKey; readonly bytes?: number; readonly note?: string }> | QuickPickItem)[] = [];

	const summaryText = plan.status === 'blocked-by-protections'
		? l10n.t('Quota cannot be reached with the current protections ({0} over quota)', formatMirrorBytes(plan.bytesOverQuota))
		: plan.status === 'within-quota'
			? l10n.t('Within quota ({0} used of {1})', formatMirrorBytes(plan.totalBytes), formatMirrorBytes(plan.quotaBytes))
			: l10n.t('{0} over quota · projected after evictable: {1}', formatMirrorBytes(plan.bytesOverQuota), formatMirrorBytes(plan.projectedBytesAfterEviction));

	items.push({
		label: `$(info) ${summaryText}`,
		description: plan.shortfallBytes > 0 ? l10n.t('Shortfall: {0}', formatMirrorBytes(plan.shortfallBytes)) : formatMirrorBytes(plan.totalBytes),
		detail: (plan.truncated ? l10n.t('Plan list truncated; ') : '') + scopeHint,
		value: { action: 'refresh' },
	});

	const evictableRows = rows.filter(r => r.kind === 'evictable');
	if (evictableRows.length > 0) {
		items.push({ label: l10n.t('Eligible for Review'), kind: QuickPickItemKind.Separator });
		for (const row of evictableRows) {
			items.push({
				label: `$(trash) ${row.label}`,
				description: row.description,
				detail: row.detail,
				value: { action: 'evict', key: row.key, bytes: row.bytes },
			});
		}
	}

	const inUseRows = rows.filter(r => r.kind === 'in-use');
	if (inUseRows.length > 0) {
		items.push({ label: l10n.t('In Use (Active Lease)'), kind: QuickPickItemKind.Separator });
		for (const row of inUseRows) {
			items.push({
				label: `$(lock) ${row.label}`,
				description: row.description,
				detail: row.detail,
				value: { action: 'info', note: l10n.t('{0} is currently in use by an active operation lease and cannot be removed.', row.label) },
			});
		}
	}

	const pinnedRows = rows.filter(r => r.kind === 'pinned');
	if (pinnedRows.length > 0) {
		items.push({ label: l10n.t('Pinned by Active Architecture'), kind: QuickPickItemKind.Separator });
		for (const row of pinnedRows) {
			items.push({
				label: `$(pin) ${row.label}`,
				description: row.description,
				detail: row.detail,
				value: { action: 'info', note: l10n.t('{0} is pinned by the active architecture lockfile and is protected from cleanup removal.', row.label) },
			});
		}
	}

	const selected = await showGuidedQuickPick({
		title: l10n.t('Mirror Cleanup Review ({0} used · {1} quota)', formatMirrorBytes(plan.totalBytes), formatMirrorBytes(plan.quotaBytes)),
		placeholder: evictableRows.length > 0
			? l10n.t('Select an eligible package to review removal (confirmation required), or press Escape')
			: l10n.t('No unpinned packages eligible for removal · press Back or Escape'),
		items,
		canGoBack: options.allowBack,
	});
	if (selected === BACK_SENTINEL) {
		return { mutated: false, back: true };
	}
	if (!selected) {
		return { mutated: false };
	}
	if (selected.action === 'refresh') {
		return runGuidedMirrorCleanup(host, options);
	}
	if (selected.action === 'info') {
		if (selected.note) {
			void window.showInformationMessage(selected.note);
		}
		return { mutated: false, back: options.allowBack };
	}
	if (selected.action === 'evict' && selected.key) {
		if (plan.truncated) {
			void window.showWarningMessage(l10n.t('Cleanup plan was truncated; review removal carefully or refresh after clearing space.'));
		}
		if (!isMirrorScopeCurrent(capturedScope, host.getScope())) {
			void window.showWarningMessage(l10n.t('The active architecture or source changed before removal confirmation. Refreshing cleanup plan.'));
			return { mutated: false, back: options.allowBack };
		}
		const removed = await confirmAndEvictMirrorPackage(host, selected.key, selected.bytes);
		return { mutated: removed, back: options.allowBack };
	}
	return { mutated: false };
}

/**
 * Guided provider archive import with optional prefill from a missing readiness package
 * and explicit pre-picker identity/digest review.
 */
export async function runGuidedMirrorImport(
	host: OfflineMirrorHost,
	prefill?: Partial<MirrorPackageKey>
): Promise<{ readonly mutated: boolean; readonly key?: MirrorPackageKey }> {
	const address = await window.showInputBox({
		title: l10n.t('Import Provider Archive (1/4): Provider Address'),
		value: prefill?.address ?? 'registry.terraform.io/hashicorp/azurerm',
		placeHolder: 'registry.terraform.io/hashicorp/azurerm',
		validateInput: text => /^[a-z0-9.-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(text.trim())
			? undefined
			: l10n.t('Enter a full provider address such as registry.terraform.io/hashicorp/azurerm.'),
	});
	if (!address) {
		return { mutated: false };
	}
	const version = await window.showInputBox({
		title: l10n.t('Import Provider Archive (2/4): Version for {0}', address.trim()),
		value: prefill?.version ?? '5.14.0',
		placeHolder: '5.14.0',
		validateInput: text => /^[A-Za-z0-9._+-]+$/.test(text.trim())
			? undefined
			: l10n.t('Enter a provider release version such as 5.14.0.'),
	});
	if (!version) {
		return { mutated: false };
	}

	const preferredPlatform = prefill?.platform === 'linux_amd64' ? 'linux_amd64' : 'windows_amd64';
	const platformItems: ActionPickItem<string>[] = preferredPlatform === 'linux_amd64'
		? [
			{ label: 'linux_amd64', description: l10n.t('CI / Linux offline mirror target (selected from readiness)'), value: 'linux_amd64' },
			{ label: 'windows_amd64', description: l10n.t('Required for local Windows offline init & schema extraction'), value: 'windows_amd64' },
		]
		: [
			{ label: 'windows_amd64', description: l10n.t('Required for local Windows offline init & schema extraction'), value: 'windows_amd64' },
			{ label: 'linux_amd64', description: l10n.t('CI / Linux offline mirror target'), value: 'linux_amd64' },
		];

	const platform = await showGuidedQuickPick({
		title: l10n.t('Import Provider Archive (3/4): Target Platform'),
		placeholder: l10n.t('Choose target platform for {0} {1}', address.trim(), version.trim()),
		items: platformItems,
	});
	if (!platform || platform === BACK_SENTINEL) {
		return { mutated: false };
	}

	const expectedSha256 = await window.showInputBox({
		title: l10n.t('Import Provider Archive (4/4): Expected Archive Digest (SHA-256)'),
		prompt: l10n.t('Supply a trusted 64-character SHA-256 digest; CloudForge verifies the chosen .zip archive against it.'),
		placeHolder: '0123456789abcdef...',
		validateInput: text => /^[0-9a-fA-F]{64}$/.test(text.trim())
			? undefined
			: l10n.t('Enter the verified 64-character SHA-256 hex digest for the provider .zip archive.'),
	});
	if (!expectedSha256) {
		return { mutated: false };
	}

	const normalizedKey: MirrorPackageKey = {
		address: address.trim(),
		version: version.trim(),
		platform,
	};
	const digest = expectedSha256.trim().toLowerCase();

	const reviewChoice = await showGuidedQuickPick<'import'>({
		title: l10n.t('Review Expected Archive Identity & Digest'),
		placeholder: l10n.t('Confirm package identity before opening the native .zip file picker'),
		items: [
			{
				label: `$(archive) ${l10n.t('Choose Archive and Import…')}`,
				description: formatMirrorPackageKey(normalizedKey),
				detail: l10n.t('Expected archive digest: {0}', digest),
				value: 'import',
			},
		],
		canGoBack: false,
	});
	if (reviewChoice !== 'import') {
		return { mutated: false };
	}

	const imported = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: l10n.t('Verifying and importing {0} into local mirror…', formatMirrorPackageKey(normalizedKey)),
			cancellable: false,
		},
		() => host.callService<unknown>('importMirrorPackage', {
			address: normalizedKey.address,
			version: normalizedKey.version,
			platform: normalizedKey.platform,
			expectedSha256: digest,
		})
	);
	if (!imported.ok) {
		if (imported.error.code !== 'CANCELLED') {
			host.showServiceError(imported.error);
		}
		return { mutated: false };
	}
	host.onMirrorMutated();
	const parsed = parseMirrorImportResult(imported.value);
	if (!parsed.ok) {
		void window.showWarningMessage(l10n.t('Import finished, but the service reply could not be validated ({0}). Refresh inventory to confirm.', parsed.reason));
		return { mutated: true, key: normalizedKey };
	}
	const verb = parsed.value.created
		? l10n.t('Verified and stored {0} ({1}) in the local offline provider mirror.', formatMirrorPackageKey(parsed.value.package.key), formatMirrorBytes(parsed.value.package.sizeBytes))
		: l10n.t('{0} ({1}) was already present in the local offline provider mirror.', formatMirrorPackageKey(parsed.value.package.key), formatMirrorBytes(parsed.value.package.sizeBytes));
	void window.showInformationMessage(verb);
	return { mutated: true, key: parsed.value.package.key };
}

/**
 * Native QuickPick hub: `CloudForge: Manage Offline Provider Packages…`.
 * Connects Browse, Details, Import, Integrity Verification, Cleanup Review, Readiness,
 * Schema Extraction, and Offline Initialization into one temporary, keyboard-driven journey.
 */
export async function runOfflineProviderMirrorManager(host: OfflineMirrorHost): Promise<void> {
	let sessionIntegrity: MirrorIntegrityReport | undefined;
	let integrityStale = false;
	let lastBrowseQuery = '';

	const markMutated = () => {
		if (sessionIntegrity) {
			integrityStale = true;
		}
	};

	const inspectPackageDetails = async (pkg: MirrorPackageSummary): Promise<'back' | 'exit'> => {
		const isWindows = pkg.key.platform === 'windows_amd64';
		const integrityEntry = sessionIntegrity?.entries.find(e => sameMirrorPackageKey(e.key, pkg.key));
		const integrityStatus = !sessionIntegrity
			? l10n.t('Not checked in this session')
			: integrityStale
				? l10n.t('Not checked since change')
				: integrityEntry?.status === 'verified'
					? l10n.t('Verified in this check')
					: integrityEntry?.status === 'missingArchive'
						? l10n.t('Missing archive')
						: integrityEntry?.status === 'corrupted'
							? l10n.t('Corrupted')
							: l10n.t('Stored');

		const items: (ActionPickItem<'extract' | 'remove' | 'info'> | QuickPickItem)[] = [
			{
				label: `$(package) ${formatMirrorPackageKey(pkg.key)}`,
				description: `${integrityStatus} · ${formatMirrorBytes(pkg.sizeBytes)}`,
				detail: l10n.t('Recorded SHA-256: {0} · Recorded {1}{2}', pkg.sha256, pkg.recordedAt, pkg.publisher ? ` · ${pkg.publisher}` : ''),
				value: 'info',
			},
			{ label: l10n.t('Actions'), kind: QuickPickItemKind.Separator },
			isWindows
				? {
					label: `$(cloud-download) ${l10n.t('Extract Provider Schema…')}`,
					description: l10n.t('Runs local windows_amd64 provider through detected engine'),
					value: 'extract',
				}
				: {
					label: `$(info) ${l10n.t('Schema Extraction Unavailable for {0}', pkg.key.platform)}`,
					description: l10n.t('Local schema extraction requires windows_amd64'),
					value: 'info',
				},
			{
				label: `$(trash) ${l10n.t('Review Removal…')}`,
				description: l10n.t('Opens explicit confirmation before removing local archive'),
				value: 'remove',
			},
		];

		const choice = await showGuidedQuickPick({
			title: l10n.t('Package Details — {0}', formatMirrorPackageKey(pkg.key)),
			placeholder: l10n.t('Choose an action, press Back to return to Browse, or Escape to close'),
			items,
			canGoBack: true,
		});
		if (choice === BACK_SENTINEL) {
			return 'back';
		}
		if (!choice) {
			return 'exit';
		}
		if (choice === 'extract') {
			await host.runExtractSchema(pkg.key);
			return 'back';
		}
		if (choice === 'remove') {
			const removed = await confirmAndEvictMirrorPackage(host, pkg.key, pkg.sizeBytes);
			if (removed) {
				markMutated();
			}
			return 'back';
		}
		return 'back';
	};

	const browsePackages = async (preselectKey?: MirrorPackageKey): Promise<'back' | 'exit'> => {
		while (true) {
			const listed = await host.callService<unknown>('listMirrorPackages', {});
			if (!listed.ok) {
				host.showServiceError(listed.error);
				return 'back';
			}
			const parsed = parseMirrorInventory(listed.value);
			if (!parsed.ok) {
				const retry = await showGuidedQuickPick<'retry'>({
					title: l10n.t('Offline Provider Packages — Inventory Unavailable'),
					placeholder: parsed.reason,
					items: [{ label: `$(refresh) ${l10n.t('Retry Loading Inventory')}`, value: 'retry' }],
					canGoBack: true,
				});
				if (retry === 'retry') {
					continue;
				}
				return retry === BACK_SENTINEL ? 'back' : 'exit';
			}
			const inventory = parsed.value;
			if (preselectKey) {
				const targetKey = preselectKey;
				preselectKey = undefined;
				const matched = inventory.packages.find(p => sameMirrorPackageKey(p.key, targetKey));
				if (matched) {
					const detailResult = await inspectPackageDetails(matched);
					if (detailResult === 'exit') {
						return 'exit';
					}
					continue;
				}
			}
			if (inventory.packages.length === 0) {
				const emptyChoice = await showGuidedQuickPick<'import'>({
					title: l10n.t('Offline Provider Packages (Empty Mirror)'),
					placeholder: l10n.t('No mirrored provider archives stored locally yet'),
					items: [{ label: `$(archive) ${l10n.t('Import Provider Archive (.zip)…')}`, value: 'import' }],
					canGoBack: true,
				});
				if (emptyChoice === 'import') {
					const res = await runGuidedMirrorImport(host);
					if (res.mutated) {
						markMutated();
					}
					continue;
				}
				return emptyChoice === BACK_SENTINEL ? 'back' : 'exit';
			}

			const items: (ActionPickItem<MirrorPackageSummary> | QuickPickItem)[] = [];
			if (inventory.truncated || inventory.rejectedCount > 0) {
				items.push({
					label: l10n.t('Inventory incomplete ({0} shown{1})', inventory.packages.length, inventory.rejectedCount > 0 ? `, ${inventory.rejectedCount} rejected` : ', truncated'),
					kind: QuickPickItemKind.Separator,
				});
			}
			for (const pkg of inventory.packages) {
				items.push({
					label: formatMirrorPackageKey(pkg.key),
					description: `${formatMirrorBytes(pkg.sizeBytes)} · ${pkg.sha256.slice(0, 12)}`,
					detail: pkg.publisher ? l10n.t('Stored · {0} · recorded {1}', pkg.publisher, pkg.recordedAt) : l10n.t('Stored · recorded {0}', pkg.recordedAt),
					value: pkg,
				});
			}

			const picked = await showGuidedQuickPick({
				title: l10n.t('Browse Offline Provider Packages ({0})', inventory.packages.length),
				placeholder: l10n.t('Search by provider address, version, or platform'),
				items,
				canGoBack: true,
				initialSearch: lastBrowseQuery,
			});
			if (picked === BACK_SENTINEL) {
				return 'back';
			}
			if (!picked) {
				return 'exit';
			}
			lastBrowseQuery = picked.key.address;
			const detailResult = await inspectPackageDetails(picked);
			if (detailResult === 'exit') {
				return 'exit';
			}
		}
	};

	const checkArchitectureReadiness = async (): Promise<'back' | 'exit'> => {
		const captured = host.getScope();
		if (!captured) {
			void window.showInformationMessage(l10n.t('Select an active CloudForge architecture first to check offline readiness.'));
			return 'back';
		}
		const res = await host.callService<unknown>('checkOfflineMirrorReadiness', {
			workspaceId: captured.workspaceId,
			architectureId: captured.architectureId,
			expectedSourceRevision: captured.sourceRevision,
		});
		if (!res.ok) {
			host.showServiceError(res.error);
			return 'back';
		}
		const readiness = parseOfflineMirrorReadiness(res.value);
		if (!readiness) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid offline readiness report.'));
			return 'back';
		}
		if (!isMirrorScopeCurrent(captured, host.getScope())) {
			void window.showWarningMessage(l10n.t('The active architecture or source changed while checking readiness.'));
			return 'back';
		}

		const items: (ActionPickItem<{ readonly action: 'import' | 'init' | 'info'; readonly key?: MirrorPackageKey }> | QuickPickItem)[] = [];
		items.push({
			label: readiness.isReady
				? `$(pass) ${l10n.t('Ready for offline init ({0} lockfile · {1})', readiness.lockState, readiness.engine)}`
				: `$(warning) ${l10n.t('Not ready ({0} lockfile · {1} missing · {2} corrupted)', readiness.lockState, readiness.missing.length, readiness.corrupted.length)}`,
			description: l10n.t('Architecture: {0}', captured.architectureName),
			detail: l10n.t('Source revision {0} · Local Windows init requires windows_amd64 packages', readiness.sourceRevision.slice(0, 12)),
			value: { action: 'info' },
		});
		if (readiness.isReady) {
			items.push({
				label: `$(plug) ${l10n.t('Initialize Architecture Offline…')}`,
				description: l10n.t('Runs read-only lockfile offline init in writable architecture'),
				value: { action: 'init' },
			});
		}
		if (readiness.missing.length > 0) {
			items.push({ label: l10n.t('Missing Packages (select to import prefilled)'), kind: QuickPickItemKind.Separator });
			for (const key of readiness.missing) {
				items.push({
					label: `$(cloud-upload) ${formatMirrorPackageKey(key)}`,
					description: l10n.t('Missing · select to start prefilled import'),
					value: { action: 'import', key },
				});
			}
		}
		if (readiness.corrupted.length > 0) {
			items.push({ label: l10n.t('Corrupted Packages'), kind: QuickPickItemKind.Separator });
			for (const item of readiness.corrupted) {
				items.push({
					label: `$(error) ${formatMirrorPackageKey(item.key)}`,
					description: l10n.t('Corrupted'),
					detail: item.reason,
					value: { action: 'info' },
				});
			}
		}
		if (readiness.ready.length > 0) {
			items.push({ label: l10n.t('Ready Packages'), kind: QuickPickItemKind.Separator });
			for (const key of readiness.ready) {
				items.push({
					label: `$(check) ${formatMirrorPackageKey(key)}`,
					description: l10n.t('Ready in local mirror'),
					value: { action: 'info' },
				});
			}
		}

		const picked = await showGuidedQuickPick({
			title: l10n.t('Offline Readiness — {0}', captured.architectureName),
			placeholder: l10n.t('Select a missing package to import, initialize offline, or press Back'),
			items,
			canGoBack: true,
		});
		if (picked === BACK_SENTINEL) {
			return 'back';
		}
		if (!picked) {
			return 'exit';
		}
		if (picked.action === 'import' && picked.key) {
			const imp = await runGuidedMirrorImport(host, picked.key);
			if (imp.mutated) {
				markMutated();
			}
			return checkArchitectureReadiness();
		}
		if (picked.action === 'init') {
			await host.runInitOffline();
			return 'back';
		}
		return 'back';
	};

	// Main hub loop
	while (true) {
		const scope = host.getScope();
		const integrityHint = !sessionIntegrity
			? l10n.t('Not checked in this session')
			: integrityStale
				? l10n.t('Not checked since change')
				: sessionIntegrity.healthy
					? l10n.t('Verified in this check ({0} intact)', sessionIntegrity.verifiedCount)
					: l10n.t('{0} missing · {1} corrupted', sessionIntegrity.missingArchiveCount, sessionIntegrity.corruptedCount);

		const hubItems: (ActionPickItem<'browse' | 'import' | 'verify' | 'cleanup' | 'readiness'> | QuickPickItem)[] = [
			{
				label: `$(package) ${l10n.t('Browse Packages')}`,
				description: l10n.t('Inspect stored archives, digests, schemas, and removal'),
				value: 'browse',
			},
			{
				label: `$(archive) ${l10n.t('Import Provider Archive (.zip)…')}`,
				description: l10n.t('Verify SHA-256 and store a local provider archive'),
				value: 'import',
			},
			{
				label: `$(verified) ${l10n.t('Verify Mirror Integrity')}`,
				description: integrityHint,
				value: 'verify',
			},
			{
				label: `$(clear-all) ${l10n.t('Review Cleanup…')}`,
				description: scope ? l10n.t('Quota plan with "{0}" pins & active leases', scope.architectureName) : l10n.t('Global quota plan (architecture pins not checked)'),
				value: 'cleanup',
			},
		];
		if (scope) {
			hubItems.push({
				label: `$(shield) ${l10n.t('Check Architecture Readiness')}`,
				description: l10n.t('Active architecture: {0}', scope.architectureName),
				value: 'readiness',
			});
		}

		const action = await showGuidedQuickPick({
			title: scope
				? l10n.t('Offline Provider Packages — {0}', scope.architectureName)
				: l10n.t('Offline Provider Packages — No architecture selected'),
			placeholder: l10n.t('Choose an offline provider mirror action (Escape to close)'),
			items: hubItems,
		});
		if (!action || action === BACK_SENTINEL) {
			return;
		}
		if (action === 'browse') {
			const res = await browsePackages();
			if (res === 'exit') {
				return;
			}
		} else if (action === 'import') {
			const res = await runGuidedMirrorImport(host);
			if (res.mutated) {
				markMutated();
			}
		} else if (action === 'verify') {
			const res = await runVerifiedMirrorIntegrityCheck(host, { allowBack: true });
			if (res.report) {
				sessionIntegrity = res.report;
				integrityStale = false;
			}
			if (res.inspectKey) {
				const detailRes = await browsePackages(res.inspectKey);
				if (detailRes === 'exit') {
					return;
				}
			} else if (!res.back && !res.report) {
				return;
			}
		} else if (action === 'cleanup') {
			const res = await runGuidedMirrorCleanup(host, { allowBack: true });
			if (res.mutated) {
				markMutated();
			}
			if (!res.back) {
				return;
			}
		} else if (action === 'readiness') {
			const res = await checkArchitectureReadiness();
			if (res === 'exit') {
				return;
			}
		}
	}
}
