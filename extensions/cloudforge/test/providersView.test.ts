/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROWSE_GROUPS, buildProvidersModel, compareVersionsDesc, isProviderAddress, newestMatchingVersion, parseProviderVersions, projectNextAction, shortProviderName, versionMatchesConstraint } from '../src/providers/model.ts';
import type { CanvasDependencyReport } from '../src/canvas/protocol.ts';

const AZ = 'registry.terraform.io/hashicorp/azurerm';
const AWS = 'registry.terraform.io/hashicorp/aws';
const RANDOM = 'registry.terraform.io/hashicorp/random';
const GOOGLE = 'registry.terraform.io/hashicorp/google';
const pkg = (address: string, version: string, platform = 'windows_amd64') => ({ key: { address, version, platform }, sizeBytes: 1000, sha256: 'a'.repeat(64), recordedAt: '2026-11-26T00:00:00Z' });
const snap = (address: string, version: string) => ({ address, version, formatVersion: '1.0', sha256: 'b'.repeat(64), resourceCount: 10, dataSourceCount: 2 });

const report: CanvasDependencyReport = {
	sourceRevision: 'c'.repeat(64), engine: 'terraform', engineInferred: false, lockState: 'valid',
	lockEntries: [{ address: AZ, version: '3.116.0' }, { address: AWS, version: '4.67.0' }, { address: RANDOM, version: '3.6.0' }],
	providers: [
		{ display: 'hashicorp/azurerm', address: AZ, status: 'locked', lockedVersion: '3.116.0', conflictCount: 0, requirementCount: 1 },
		{ display: 'hashicorp/aws', address: AWS, status: 'locked', lockedVersion: '4.67.0', conflictCount: 0, requirementCount: 1 },
		{ display: 'hashicorp/random', address: RANDOM, status: 'locked', conflictCount: 0, requirementCount: 1 },
		{ display: 'hashicorp/google', address: GOOGLE, status: 'unlocked', conflictCount: 0, requirementCount: 1 },
		{ display: 'hashicorp/time', status: 'conflict', conflictCount: 1, requirementCount: 2 },
	],
	unusedLockEntries: [], diagnosticCount: 0,
};

test('providers model: project rows get one status and next step each', () => {
	const model = buildProvidersModel({
		report,
		packages: [pkg(AZ, '3.116.0'), pkg(AZ, '3.116.0', 'linux_amd64'), pkg(AWS, '4.67.0', 'linux_amd64'), pkg(AZ, '4.12.0')],
		snapshots: [snap(RANDOM, '3.6.0'), snap(AZ, '4.12.0')],
	});
	const byName = Object.fromEntries(model.project.map(row => [row.display, row]));
	assert.equal(byName['hashicorp/azurerm'].status, 'schemaNotExtracted');
	assert.equal(byName['hashicorp/azurerm'].otherSchemaVersion, '4.12.0');
	assert.deepEqual(byName['hashicorp/azurerm'].platforms, ['linux_amd64', 'windows_amd64']);
	assert.equal(byName['hashicorp/aws'].status, 'notDownloaded', 'a linux-only package cannot give a local schema');
	assert.equal(byName['hashicorp/random'].status, 'ready', 'lock entry fills in the version');
	assert.equal(byName['hashicorp/google'].status, 'unlocked');
	assert.equal(byName['hashicorp/time'].status, 'conflict');
	assert.equal(model.attentionCount, 4);
	assert.equal(projectNextAction(byName['hashicorp/azurerm']), 'extractSchema');
	assert.equal(projectNextAction(byName['hashicorp/aws']), 'download');
	assert.equal(projectNextAction(byName['hashicorp/random']), undefined);
});

test('providers model: downloaded section groups versions newest first', () => {
	const model = buildProvidersModel({
		report,
		packages: [pkg(AZ, '3.116.0'), pkg(AZ, '3.116.0', 'linux_amd64'), pkg(AZ, '4.12.0'), pkg(AZ, '3.9.0')],
		snapshots: [snap(AZ, '4.12.0'), snap(RANDOM, '3.6.0')],
	});
	const azurerm = model.installed.find(row => row.address === AZ)!;
	assert.deepEqual(azurerm.versions.map(row => row.version), ['4.12.0', '3.116.0', '3.9.0']);
	const locked = azurerm.versions.find(row => row.version === '3.116.0')!;
	assert.equal(locked.usedByProject, true);
	assert.equal(locked.sizeBytes, 2000);
	assert.deepEqual(locked.platforms, ['linux_amd64', 'windows_amd64']);
	assert.equal(azurerm.versions[0].hasSchema, true);
	const random = model.installed.find(row => row.address === RANDOM)!;
	assert.equal(random.versions[0].schemaOnly, true);
});

test('providers model: works without an open architecture', () => {
	const model = buildProvidersModel({ packages: [pkg(AZ, '4.12.0')], snapshots: [] });
	assert.equal(model.hasArchitecture, false);
	assert.equal(model.project.length, 0);
	assert.equal(model.attentionCount, 0);
	assert.equal(model.installed.length, 1);
});

test('providers helpers', () => {
	assert.equal(shortProviderName(AZ), 'hashicorp/azurerm');
	assert.deepEqual(['3.9.0', '4.0.0-beta1', '3.116.0', '4.0.0'].sort(compareVersionsDesc), ['4.0.0', '4.0.0-beta1', '3.116.0', '3.9.0']);
});

test('provider address validation', () => {
	assert.equal(isProviderAddress('registry.terraform.io/hashicorp/azurerm'), true);
	assert.equal(isProviderAddress('hashicorp/azurerm'), false);
	assert.equal(isProviderAddress('registry.terraform.io/../azurerm'), false);
	assert.equal(isProviderAddress('localhost/a/b'), false);
});

test('browse list and registry version parsing', () => {
	const addresses = BROWSE_GROUPS.flatMap(group => group.providers.map(provider => provider.address));
	assert.equal(new Set(addresses).size, addresses.length, 'no duplicates');
	assert.ok(addresses.every(isProviderAddress));
	assert.ok(addresses.every(address => address === address.toLowerCase()));
	assert.deepEqual(parseProviderVersions({ versions: ['4.12.0', '3.116.0', '../bad', 7], stale: true, refreshedAt: '2026-11-26T00:00:00Z' }), { versions: ['4.12.0', '3.116.0'], stale: true, refreshedAt: '2026-11-26T00:00:00Z' });
	assert.equal(parseProviderVersions({ versions: 'x', stale: false }), undefined);
	assert.equal(parseProviderVersions(null), undefined);
});

test('version constraints match like the Rust engine report', () => {
	assert.equal(versionMatchesConstraint('5.14.2', '~> 5.14'), true);
	assert.equal(versionMatchesConstraint('6.0.0', '~> 5.14'), false);
	assert.equal(versionMatchesConstraint('5.15.0', '~> 5.14.0'), false);
	assert.equal(versionMatchesConstraint('5.14.9', '~> 5.14.0'), true);
	assert.equal(versionMatchesConstraint('3.116.0', '>= 3.0, < 4.0, != 3.115.0'), true);
	assert.equal(versionMatchesConstraint('3.115.0', '>= 3.0, < 4.0, != 3.115.0'), false);
	assert.equal(versionMatchesConstraint('4.0.0-beta1', '>= 3.0'), false, 'prereleases need an exact pin');
	assert.equal(versionMatchesConstraint('4.0.0-beta1', '= 4.0.0-beta1'), true);
	assert.equal(versionMatchesConstraint('2.1.0', '2.1.0'), true, 'a bare version is an exact pin');
	assert.equal(versionMatchesConstraint('2.1.0', 'nonsense'), false);
});

test('newest matching version picks the highest release that fits', () => {
	const versions = ['3.117.1', '4.1.0', '4.0.0-beta2', '3.116.0', '2.99.0'];
	assert.equal(newestMatchingVersion(versions, '~> 3.100'), '3.117.1');
	assert.equal(newestMatchingVersion(versions, '< 3.117.0'), '3.116.0');
	assert.equal(newestMatchingVersion(versions, undefined), '4.1.0');
	assert.equal(newestMatchingVersion(versions, '>= 5.0'), undefined);
});

test('unlocked project rows carry their constraint', () => {
	const report: CanvasDependencyReport = {
		sourceRevision: 'c'.repeat(64), engine: 'terraform', engineInferred: false, lockState: 'absent', lockEntries: [],
		providers: [{ display: 'hashicorp/aws', address: AWS, status: 'unlocked', conflictCount: 0, requirementCount: 1, constraint: '~> 5.0' }],
		unusedLockEntries: [], diagnosticCount: 0,
	};
	const model = buildProvidersModel({ report, packages: [], snapshots: [] });
	assert.equal(model.project[0].status, 'unlocked');
	assert.equal(model.project[0].constraint, '~> 5.0');
});
