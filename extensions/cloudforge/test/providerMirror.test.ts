/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildCleanupQuickPickRows,
	formatMirrorBytes,
	isMirrorScopeCurrent,
	parseMirrorCleanupPlan,
	parseMirrorEvictionResult,
	parseMirrorImportResult,
	parseMirrorIntegrityReport,
	parseMirrorInventory,
	parseMirrorReadiness,
	parseQuotaMiBToBytes,
	resolveMirrorExtractTarget
} from '../src/providerMirror/model.ts';

test('readiness distinguishes Windows init from dual-platform availability and validates exact scope', () => {
	const scope = { workspaceId: 'workspace', architectureId: 'architecture', architectureName: 'Fixture', sourceRevision: 'a'.repeat(64) };
	const windows = { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' };
	const linux = { ...windows, platform: 'linux_amd64' };
	const report = { ...scope, engine: 'terraform', engineInferred: true, lockState: 'valid', isReady: false, ready: [windows], missing: [linux], corrupted: [] };
	const both = parseMirrorReadiness(report, scope, ['windows_amd64', 'linux_amd64']);
	assert.ok(both.ok);
	assert.equal(both.value.isReady, false);
	const local = parseMirrorReadiness({ ...report, isReady: true, missing: [] }, scope, ['windows_amd64']);
	assert.ok(local.ok);
	assert.equal(local.value.isReady, true, 'missing Linux archive must not block Windows-only init');
	for (const change of [
		{ workspaceId: 'other' }, { architectureId: 'other' }, { sourceRevision: 'b'.repeat(64) },
		{ ready: [{}] }, { ready: [windows, windows] }, { missing: [windows] },
		{ isReady: true }, { lockState: 'absent', isReady: true }, { corrupted: [{ key: linux }] },
		{ ready: Array.from({ length: 513 }, () => windows) },
	]) {
		assert.equal(parseMirrorReadiness({ ...report, ...change }, scope, ['windows_amd64', 'linux_amd64']).ok, false, JSON.stringify(change));
	}
	assert.equal(parseMirrorReadiness(report, scope, ['windows_amd64']).ok, false, 'unexpected platform cannot authorize local init');
	assert.equal(parseMirrorReadiness({ ...report, lockState: 'invalid', isReady: true, missing: [] }, scope, ['windows_amd64']).ok, false);
	assert.ok(parseMirrorReadiness({ ...report, lockState: 'absent', isReady: true, ready: [], missing: [] }, scope, ['windows_amd64']).ok, 'valid service no-dependency readiness remains explicit');
});

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('parseQuotaMiBToBytes accepts 0 and valid integers and rejects unsafe/malformed inputs', () => {
	const zero = parseQuotaMiBToBytes('0');
	assert.equal(zero.ok, true);
	if (zero.ok) {
		assert.equal(zero.value.mib, 0);
		assert.equal(zero.value.quotaBytes, 0);
	}

	const normal = parseQuotaMiBToBytes(' 512 ');
	assert.equal(normal.ok, true);
	if (normal.ok) {
		assert.equal(normal.value.quotaBytes, 512 * 1024 * 1024);
	}

	for (const bad of ['', '   ', '-1', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740991']) {
		assert.equal(parseQuotaMiBToBytes(bad).ok, false, `expected rejection for "${bad}"`);
	}
});

test('parseMirrorInventory distinguishes validated empty mirror from malformed or rejected payloads', () => {
	const empty = parseMirrorInventory({ packages: [] });
	assert.equal(empty.ok, true);
	if (empty.ok) {
		assert.equal(empty.value.packages.length, 0);
		assert.equal(empty.value.rejectedCount, 0);
		assert.equal(empty.value.truncated, false);
	}

	// Missing packages array is invalid, NEVER silently empty
	assert.equal(parseMirrorInventory({}).ok, false);
	assert.equal(parseMirrorInventory(null).ok, false);

	// All-malformed items fail instead of pretending the mirror is empty
	assert.equal(parseMirrorInventory({ packages: [{ key: { address: 'bad' } }] }).ok, false);

	// Valid packages sort deterministically and count partial rejected rows honestly
	const valid = parseMirrorInventory({
		packages: [
			{ key: { address: 'registry.terraform.io/hashicorp/random', version: '3.6.0', platform: 'linux_amd64' }, sizeBytes: 2048, sha256: SHA_B, recordedAt: '2026-11-26T00:00:00Z' },
			{ key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' }, sizeBytes: 1048576, sha256: SHA_A, recordedAt: '2026-11-26T00:00:00Z', publisher: 'HashiCorp' },
			{ key: { address: 'broken' }, sizeBytes: -5 },
		],
	});
	assert.equal(valid.ok, true);
	if (valid.ok) {
		assert.equal(valid.value.packages.length, 2);
		assert.equal(valid.value.rejectedCount, 1);
		assert.equal(valid.value.packages[0].key.address, 'registry.terraform.io/hashicorp/azurerm');
	}
});

test('parseMirrorIntegrityReport rejects missing/inconsistent counters and never turns {} into healthy zero', () => {
	// Bug fixed: {} must fail validation, never report 0 intact packages
	assert.equal(parseMirrorIntegrityReport({}).ok, false);
	assert.equal(parseMirrorIntegrityReport({ totalBytes: 0, verifiedCount: 0 }).ok, false);

	// Inconsistent summary vs entry count must fail
	assert.equal(parseMirrorIntegrityReport({
		totalBytes: 1024,
		verifiedCount: 2,
		missingArchiveCount: 0,
		corruptedCount: 0,
		entries: [{ key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' }, status: 'verified' }],
	}).ok, false);

	// Valid report with one corrupted package surfaces healthy=false honestly
	const report = parseMirrorIntegrityReport({
		totalBytes: 2097152,
		verifiedCount: 1,
		missingArchiveCount: 0,
		corruptedCount: 1,
		entries: [
			{ key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' }, status: 'verified', archiveSize: 1048576 },
			{ key: { address: 'registry.terraform.io/hashicorp/random', version: '3.6.0', platform: 'windows_amd64' }, status: 'corrupted', reason: 'SHA-256 mismatch' },
		],
	});
	assert.equal(report.ok, true);
	if (report.ok) {
		assert.equal(report.value.healthy, false);
		assert.equal(report.value.corruptedCount, 1);
		assert.equal(report.value.entries[1].reason, 'SHA-256 mismatch');
	}
});

test('parseMirrorCleanupPlan preserves active leases, pins, shortfalls, and separates QuickPick rows safely', () => {
	// Over quota with ONLY protected active lease & pinned package -> status blocked-by-protections (NEVER within-quota!)
	const blocked = parseMirrorCleanupPlan({
		quotaBytes: 1024,
		totalBytes: 4096,
		bytesOverQuota: 3072,
		projectedBytesAfterEviction: 4096,
		protectedActive: [{ address: 'registry.terraform.io/hashicorp/aws', version: '6.73.0', platform: 'windows_amd64' }],
		evictable: [],
		pinnedRequiringReview: [{
			key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' },
			bytes: 2048,
			recordedAt: '2026-11-26T00:00:00Z',
			affectedArchitectures: ['Hub Network'],
		}],
		sourceRevision: SHA_A,
	});
	assert.equal(blocked.ok, true);
	if (blocked.ok) {
		assert.equal(blocked.value.status, 'blocked-by-protections');
		assert.equal(blocked.value.shortfallBytes, 3072);
		const rows = buildCleanupQuickPickRows(blocked.value);
		assert.equal(rows.length, 2);
		assert.equal(rows[0].kind, 'in-use');
		assert.equal(rows[0].canReviewRemoval, false);
		assert.equal(rows[1].kind, 'pinned');
		assert.equal(rows[1].canReviewRemoval, false);
	}

	// Evictable candidate row is marked canReviewRemoval=true (still requires modal confirmation in manager)
	const reclaimable = parseMirrorCleanupPlan({
		quotaBytes: 1024,
		totalBytes: 3072,
		bytesOverQuota: 2048,
		projectedBytesAfterEviction: 1024,
		protectedActive: [],
		evictable: [{
			key: { address: 'registry.terraform.io/hashicorp/random', version: '3.6.0', platform: 'linux_amd64' },
			bytes: 2048,
			recordedAt: '2026-11-26T00:00:00Z',
			affectedArchitectures: [],
		}],
		pinnedRequiringReview: [],
	});
	assert.equal(reclaimable.ok, true);
	if (reclaimable.ok) {
		assert.equal(reclaimable.value.status, 'reclaimable');
		assert.equal(reclaimable.value.shortfallBytes, 0);
		const rows = buildCleanupQuickPickRows(reclaimable.value);
		assert.equal(rows[0].kind, 'evictable');
		assert.equal(rows[0].canReviewRemoval, true);
	}
});

test('parseMirrorImportResult, parseMirrorEvictionResult, formatMirrorBytes, and scope drift guard work truthfully', () => {
	// Eviction rejects missing bytesReclaimed instead of falling back to old size
	const badEvict = parseMirrorEvictionResult({ key: { address: 'registry.terraform.io/hashicorp/random', version: '3.6.0', platform: 'windows_amd64' } });
	assert.equal(badEvict.ok, false);
	if (!badEvict.ok) {
		assert.match(badEvict.reason, /refresh to confirm/i);
	}

	const goodEvict = parseMirrorEvictionResult({
		key: { address: 'registry.terraform.io/hashicorp/random', version: '3.6.0', platform: 'windows_amd64' },
		bytesReclaimed: 4096,
	});
	assert.equal(goodEvict.ok, true);

	const imported = parseMirrorImportResult({
		created: false,
		package: {
			key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' },
			sizeBytes: 2 * 1024 * 1024,
			sha256: SHA_A,
			recordedAt: '2026-11-26T00:00:00Z',
		},
	});
	assert.equal(imported.ok, true);
	if (imported.ok) {
		assert.equal(imported.value.created, false);
	}

	assert.match(formatMirrorBytes(2 * 1024 * 1024), /2\.0 MiB \(2,097,152 bytes\)/);

	const ctx1 = { workspaceId: 'ws-1', architectureId: 'arch-1', architectureName: 'Hub', sourceRevision: SHA_A };
	const ctx2 = { ...ctx1, sourceRevision: SHA_B };
	assert.equal(isMirrorScopeCurrent(ctx1, ctx1), true);
	assert.equal(isMirrorScopeCurrent(ctx1, ctx2), false);
	assert.equal(isMirrorScopeCurrent(undefined, ctx1), false);
});

test('resolveMirrorExtractTarget preselects exact windows_amd64 package and rejects non-Windows or missing targets', () => {
	const winAzure = {
		key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' },
		sizeBytes: 1048576,
		sha256: SHA_A,
		recordedAt: '2026-11-26T00:00:00Z',
	};
	const linuxAzure = {
		key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'linux_amd64' },
		sizeBytes: 1048576,
		sha256: SHA_B,
		recordedAt: '2026-11-26T00:00:00Z',
	};
	const packages = [winAzure, linuxAzure];

	const noSelection = resolveMirrorExtractTarget(packages);
	assert.deepEqual(noSelection, { ok: true, value: undefined });

	const exact = resolveMirrorExtractTarget(packages, winAzure.key);
	assert.equal(exact.ok, true);
	if (exact.ok) {
		assert.deepEqual(exact.value, winAzure);
	}

	const linuxRejected = resolveMirrorExtractTarget(packages, linuxAzure.key);
	assert.equal(linuxRejected.ok, false);
	if (!linuxRejected.ok) {
		assert.match(linuxRejected.reason, /windows_amd64/i);
	}

	const missing = resolveMirrorExtractTarget(packages, {
		address: 'registry.terraform.io/hashicorp/aws',
		version: '6.73.0',
		platform: 'windows_amd64',
	});
	assert.equal(missing.ok, false);
	if (!missing.ok) {
		assert.match(missing.reason, /no longer present/i);
	}
});
