/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Offline Provider-Package Management: pure presentation model, strict bounded service
// response adapters, safe quota conversions, scope-drift guards, and cleanup row builders.
//
// Zero vscode, filesystem, or process imports; safe to test directly in Node.

export interface MirrorPackageKey {
	readonly address: string;
	readonly version: string;
	readonly platform: string;
}

export interface MirrorPackageSummary {
	readonly key: MirrorPackageKey;
	readonly sizeBytes: number;
	readonly sha256: string;
	readonly recordedAt: string;
	readonly publisher?: string;
}

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

export interface MirrorInventory {
	readonly packages: readonly MirrorPackageSummary[];
	readonly truncated: boolean;
	readonly rejectedCount: number;
}

export type MirrorIntegrityStatus = 'verified' | 'missingArchive' | 'corrupted';

export interface MirrorIntegrityEntry {
	readonly key: MirrorPackageKey;
	readonly status: MirrorIntegrityStatus;
	readonly archiveSize?: number;
	readonly reason?: string;
}

export interface MirrorIntegrityReport {
	readonly totalBytes: number;
	readonly verifiedCount: number;
	readonly missingArchiveCount: number;
	readonly corruptedCount: number;
	readonly entries: readonly MirrorIntegrityEntry[];
	readonly truncated: boolean;
	readonly healthy: boolean;
}

export interface MirrorCleanupCandidate {
	readonly key: MirrorPackageKey;
	readonly bytes: number;
	readonly recordedAt: string;
	readonly affectedArchitectures: readonly string[];
}

export type MirrorCleanupStatus = 'within-quota' | 'reclaimable' | 'blocked-by-protections';

export interface MirrorCleanupPlan {
	readonly quotaBytes: number;
	readonly totalBytes: number;
	readonly bytesOverQuota: number;
	readonly projectedBytesAfterEviction: number;
	readonly shortfallBytes: number;
	readonly protectedActive: readonly MirrorPackageKey[];
	readonly evictable: readonly MirrorCleanupCandidate[];
	readonly pinnedRequiringReview: readonly MirrorCleanupCandidate[];
	readonly sourceRevision?: string;
	readonly truncated: boolean;
	readonly status: MirrorCleanupStatus;
}

export interface MirrorImportResult {
	readonly created: boolean;
	readonly package: MirrorPackageSummary;
}

export interface MirrorEvictionResult {
	readonly key: MirrorPackageKey;
	readonly bytesReclaimed: number;
}

export interface MirrorScopeContext {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly architectureName: string;
	readonly sourceRevision: string;
}

export interface CleanupPickRow {
	readonly kind: 'evictable' | 'in-use' | 'pinned';
	readonly key: MirrorPackageKey;
	readonly label: string;
	readonly description: string;
	readonly detail: string;
	readonly bytes?: number;
	readonly canReviewRemoval: boolean;
}

const MAX_PACKAGES = 512;
const MAX_CLEANUP_ITEMS = 512;
const MAX_AFFECTED_ARCHITECTURES = 64;
const BYTES_PER_MIB = 1024 * 1024;
const MAX_SAFE_QUOTA_MIB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_MIB);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isNonNegativeSafeInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

export function parseMirrorPackageKeyStrict(value: unknown): MirrorPackageKey | undefined {
	if (
		!isRecord(value)
		|| !isNonEmptyString(value.address, 256)
		|| !isNonEmptyString(value.version, 64)
		|| !isNonEmptyString(value.platform, 64)
	) {
		return undefined;
	}
	return {
		address: value.address,
		version: value.version,
		platform: value.platform,
	};
}

function parseMirrorPackageSummaryStrict(value: unknown): MirrorPackageSummary | undefined {
	if (
		!isRecord(value)
		|| !isNonNegativeSafeInt(value.sizeBytes)
		|| !isSha256(value.sha256)
		|| !isNonEmptyString(value.recordedAt, 64)
	) {
		return undefined;
	}
	const key = parseMirrorPackageKeyStrict(value.key);
	if (!key) {
		return undefined;
	}
	return {
		key,
		sizeBytes: value.sizeBytes,
		sha256: value.sha256.toLowerCase(),
		recordedAt: value.recordedAt,
		...(isNonEmptyString(value.publisher, 128) ? { publisher: value.publisher } : {}),
	};
}

export function formatMirrorPackageKey(key: MirrorPackageKey): string {
	return `${key.address} ${key.version} (${key.platform})`;
}

export function sameMirrorPackageKey(a: MirrorPackageKey, b: MirrorPackageKey): boolean {
	return a.address === b.address && a.version === b.version && a.platform === b.platform;
}

/**
 * Formats a byte size into a human-readable unit paired with exact bytes for truthful review copy.
 */
export function formatMirrorBytes(bytes: number): string {
	const safe = isNonNegativeSafeInt(bytes) ? bytes : 0;
	const exact = safe.toLocaleString('en-US');
	if (safe >= BYTES_PER_MIB) {
		return `${(safe / BYTES_PER_MIB).toFixed(1)} MiB (${exact} bytes)`;
	}
	if (safe >= 1024) {
		return `${(safe / 1024).toFixed(1)} KiB (${exact} bytes)`;
	}
	return `${exact} bytes`;
}

/**
 * Strictly parses a non-negative integer MiB quota string into safe integer bytes.
 * Rejects empty, whitespace-only, fractional, negative, exponential, non-finite, and overflowing values.
 * Zero ('0') is explicitly valid.
 */
export function parseQuotaMiBToBytes(input: string): ParseResult<{ readonly mib: number; readonly quotaBytes: number }> {
	const trimmed = input.trim();
	if (!/^\d+$/.test(trimmed)) {
		return { ok: false, reason: 'Enter a non-negative whole number quota in MiB (0 or greater).' };
	}
	const mib = Number(trimmed);
	if (!Number.isSafeInteger(mib) || mib < 0 || mib > MAX_SAFE_QUOTA_MIB) {
		return { ok: false, reason: `Quota must be between 0 and ${MAX_SAFE_QUOTA_MIB.toLocaleString('en-US')} MiB.` };
	}
	const quotaBytes = mib * BYTES_PER_MIB;
	if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0) {
		return { ok: false, reason: 'Quota byte conversion exceeds safe integer limits.' };
	}
	return { ok: true, value: { mib, quotaBytes } };
}

/**
 * Strictly parses `listMirrorPackages` output, distinguishing a validated empty mirror
 * from a malformed or incomplete service response.
 */
export function parseMirrorInventory(value: unknown): ParseResult<MirrorInventory> {
	if (!isRecord(value) || !Array.isArray(value.packages)) {
		return { ok: false, reason: 'The CloudForge service returned an invalid mirror inventory report.' };
	}
	const truncated = value.packages.length > MAX_PACKAGES;
	const slice = value.packages.slice(0, MAX_PACKAGES);
	const packages: MirrorPackageSummary[] = [];
	let rejectedCount = 0;
	for (const item of slice) {
		const parsed = parseMirrorPackageSummaryStrict(item);
		if (parsed) {
			packages.push(parsed);
		} else {
			rejectedCount++;
		}
	}
	if (slice.length > 0 && packages.length === 0) {
		return { ok: false, reason: 'Every package record in the mirror inventory report failed validation.' };
	}
	packages.sort((a, b) =>
		a.key.address.localeCompare(b.key.address)
		|| a.key.version.localeCompare(b.key.version)
		|| a.key.platform.localeCompare(b.key.platform)
	);
	return { ok: true, value: { packages, truncated, rejectedCount } };
}

/**
 * Strictly parses `verifyMirrorIntegrity` output. Never defaults missing counters to 0
 * or reports a malformed object as a healthy mirror.
 */
export function parseMirrorIntegrityReport(value: unknown): ParseResult<MirrorIntegrityReport> {
	if (
		!isRecord(value)
		|| !isNonNegativeSafeInt(value.totalBytes)
		|| !isNonNegativeSafeInt(value.verifiedCount)
		|| !isNonNegativeSafeInt(value.missingArchiveCount)
		|| !isNonNegativeSafeInt(value.corruptedCount)
		|| !Array.isArray(value.entries)
	) {
		return { ok: false, reason: 'The CloudForge service returned an invalid or incomplete mirror verification report.' };
	}
	const expectedTotal = value.verifiedCount + value.missingArchiveCount + value.corruptedCount;
	if (!Number.isSafeInteger(expectedTotal) || expectedTotal !== value.entries.length) {
		return { ok: false, reason: 'Mirror verification counts do not match the returned package entries.' };
	}

	const truncated = value.entries.length > MAX_PACKAGES;
	const entries: MirrorIntegrityEntry[] = [];
	for (const raw of value.entries.slice(0, MAX_PACKAGES)) {
		if (!isRecord(raw)) {
			return { ok: false, reason: 'Mirror verification report contains a malformed entry.' };
		}
		const key = parseMirrorPackageKeyStrict(raw.key);
		const status = raw.status;
		if (!key || (status !== 'verified' && status !== 'missingArchive' && status !== 'corrupted')) {
			return { ok: false, reason: 'Mirror verification report contains an invalid package key or status.' };
		}
		if (raw.archiveSize !== undefined && !isNonNegativeSafeInt(raw.archiveSize)) {
			return { ok: false, reason: 'Mirror verification report contains an invalid archive size.' };
		}
		const reason = isNonEmptyString(raw.reason, 256) ? raw.reason : undefined;
		entries.push({
			key,
			status,
			...(raw.archiveSize !== undefined ? { archiveSize: raw.archiveSize } : {}),
			...(reason ? { reason } : {}),
		});
	}

	if (!truncated) {
		const countedVerified = entries.filter(e => e.status === 'verified').length;
		const countedMissing = entries.filter(e => e.status === 'missingArchive').length;
		const countedCorrupted = entries.filter(e => e.status === 'corrupted').length;
		if (
			countedVerified !== value.verifiedCount
			|| countedMissing !== value.missingArchiveCount
			|| countedCorrupted !== value.corruptedCount
		) {
			return { ok: false, reason: 'Mirror verification entry statuses disagree with summary counters.' };
		}
	}

	return {
		ok: true,
		value: {
			totalBytes: value.totalBytes,
			verifiedCount: value.verifiedCount,
			missingArchiveCount: value.missingArchiveCount,
			corruptedCount: value.corruptedCount,
			entries,
			truncated,
			healthy: value.missingArchiveCount === 0 && value.corruptedCount === 0,
		},
	};
}

function parseCleanupCandidateStrict(value: unknown): MirrorCleanupCandidate | undefined {
	if (
		!isRecord(value)
		|| !isNonNegativeSafeInt(value.bytes)
		|| !isNonEmptyString(value.recordedAt, 64)
	) {
		return undefined;
	}
	const key = parseMirrorPackageKeyStrict(value.key);
	if (!key) {
		return undefined;
	}
	const affectedRaw = value.affectedArchitectures;
	const affectedArchitectures: string[] = [];
	if (affectedRaw !== undefined) {
		if (!Array.isArray(affectedRaw)) {
			return undefined;
		}
		for (const name of affectedRaw.slice(0, MAX_AFFECTED_ARCHITECTURES)) {
			if (isNonEmptyString(name, 128)) {
				affectedArchitectures.push(name);
			}
		}
	}
	return {
		key,
		bytes: value.bytes,
		recordedAt: value.recordedAt,
		affectedArchitectures,
	};
}

/**
 * Strictly parses `planMirrorCleanup` output, retaining active leases (`protectedActive`),
 * evictable candidates, pinned packages, projected usage, and explicit over-quota shortfall.
 */
export function parseMirrorCleanupPlan(value: unknown): ParseResult<MirrorCleanupPlan> {
	if (
		!isRecord(value)
		|| !isNonNegativeSafeInt(value.quotaBytes)
		|| !isNonNegativeSafeInt(value.totalBytes)
		|| !isNonNegativeSafeInt(value.bytesOverQuota)
		|| !isNonNegativeSafeInt(value.projectedBytesAfterEviction)
		|| !Array.isArray(value.protectedActive)
		|| !Array.isArray(value.evictable)
		|| !Array.isArray(value.pinnedRequiringReview)
	) {
		return { ok: false, reason: 'The CloudForge service returned an invalid or incomplete mirror cleanup plan.' };
	}

	let sourceRevision: string | undefined;
	if (value.sourceRevision !== undefined) {
		if (!isSha256(value.sourceRevision)) {
			return { ok: false, reason: 'Mirror cleanup plan returned an invalid sourceRevision.' };
		}
		sourceRevision = value.sourceRevision.toLowerCase();
	}

	const truncated = value.protectedActive.length > MAX_CLEANUP_ITEMS
		|| value.evictable.length > MAX_CLEANUP_ITEMS
		|| value.pinnedRequiringReview.length > MAX_CLEANUP_ITEMS;

	const protectedActive: MirrorPackageKey[] = [];
	for (const raw of value.protectedActive.slice(0, MAX_CLEANUP_ITEMS)) {
		const key = parseMirrorPackageKeyStrict(raw);
		if (!key) {
			return { ok: false, reason: 'Mirror cleanup plan contains a malformed active-lease key.' };
		}
		protectedActive.push(key);
	}

	const evictable: MirrorCleanupCandidate[] = [];
	for (const raw of value.evictable.slice(0, MAX_CLEANUP_ITEMS)) {
		const candidate = parseCleanupCandidateStrict(raw);
		if (!candidate) {
			return { ok: false, reason: 'Mirror cleanup plan contains a malformed evictable candidate.' };
		}
		evictable.push(candidate);
	}

	const pinnedRequiringReview: MirrorCleanupCandidate[] = [];
	for (const raw of value.pinnedRequiringReview.slice(0, MAX_CLEANUP_ITEMS)) {
		const candidate = parseCleanupCandidateStrict(raw);
		if (!candidate) {
			return { ok: false, reason: 'Mirror cleanup plan contains a malformed pinned candidate.' };
		}
		pinnedRequiringReview.push(candidate);
	}

	const shortfallBytes = Math.max(0, value.projectedBytesAfterEviction - value.quotaBytes);
	const status: MirrorCleanupStatus = value.bytesOverQuota === 0
		? 'within-quota'
		: evictable.length > 0
			? 'reclaimable'
			: 'blocked-by-protections';

	return {
		ok: true,
		value: {
			quotaBytes: value.quotaBytes,
			totalBytes: value.totalBytes,
			bytesOverQuota: value.bytesOverQuota,
			projectedBytesAfterEviction: value.projectedBytesAfterEviction,
			shortfallBytes,
			protectedActive,
			evictable,
			pinnedRequiringReview,
			...(sourceRevision ? { sourceRevision } : {}),
			truncated,
			status,
		},
	};
}

/**
 * Strictly parses `importMirrorPackage` output, distinguishing a newly stored archive
 * from an already-present package without guessing.
 */
export function parseMirrorImportResult(value: unknown): ParseResult<MirrorImportResult> {
	if (!isRecord(value) || typeof value.created !== 'boolean') {
		return { ok: false, reason: 'The CloudForge service returned an invalid mirror import result.' };
	}
	const pkg = parseMirrorPackageSummaryStrict(value.package);
	if (!pkg) {
		return { ok: false, reason: 'Mirror import result did not include a valid package summary.' };
	}
	return { ok: true, value: { created: value.created, package: pkg } };
}

/**
 * Strictly parses `evictMirrorPackage` output. Never falls back to an old inventory size;
 * if the response is invalid after dispatch, returns a truthful refresh prompt.
 */
export function parseMirrorEvictionResult(value: unknown): ParseResult<MirrorEvictionResult> {
	if (!isRecord(value) || !isNonNegativeSafeInt(value.bytesReclaimed)) {
		return { ok: false, reason: 'Removal result unavailable; refresh to confirm.' };
	}
	const key = parseMirrorPackageKeyStrict(value.key);
	if (!key) {
		return { ok: false, reason: 'Removal result unavailable; refresh to confirm.' };
	}
	return { ok: true, value: { key, bytesReclaimed: value.bytesReclaimed } };
}

/**
 * Checks whether the captured architecture/workspace/revision context still matches the
 * live Workbench context before running a scoped operation.
 */
export function isMirrorScopeCurrent(
	captured: MirrorScopeContext | undefined,
	current: MirrorScopeContext | undefined
): boolean {
	if (!captured && !current) {
		return true;
	}
	if (!captured || !current) {
		return false;
	}
	return captured.workspaceId === current.workspaceId
		&& captured.architectureId === current.architectureId
		&& captured.sourceRevision === current.sourceRevision;
}

/**
 * Builds deterministic, accessible cleanup QuickPick rows that separate Eligible for Review,
 * In Use (Active Lease), and Pinned by Active Architecture without allowing direct eviction
 * of protected packages.
 */
export function buildCleanupQuickPickRows(plan: MirrorCleanupPlan): readonly CleanupPickRow[] {
	const rows: CleanupPickRow[] = [];
	for (const item of plan.evictable) {
		rows.push({
			kind: 'evictable',
			key: item.key,
			label: formatMirrorPackageKey(item.key),
			description: `Eligible for Review · ${formatMirrorBytes(item.bytes)}`,
			detail: `Recorded ${item.recordedAt} · Select to review removal (confirmation required)`,
			bytes: item.bytes,
			canReviewRemoval: true,
		});
	}
	for (const key of plan.protectedActive) {
		rows.push({
			kind: 'in-use',
			key,
			label: formatMirrorPackageKey(key),
			description: 'In Use · Protected by active operation lease',
			detail: 'Cannot be removed while another operation holds an active lease',
			canReviewRemoval: false,
		});
	}
	for (const item of plan.pinnedRequiringReview) {
		const scopeLabel = item.affectedArchitectures.length > 0
			? `Pinned by ${item.affectedArchitectures.join(', ')}`
			: 'Pinned by active architecture';
		rows.push({
			kind: 'pinned',
			key: item.key,
			label: formatMirrorPackageKey(item.key),
			description: `Pinned by Active Architecture · ${formatMirrorBytes(item.bytes)}`,
			detail: `${scopeLabel} · Inspection-only in cleanup review (other projects are not checked)`,
			bytes: item.bytes,
			canReviewRemoval: false,
		});
	}
	return rows;
}
