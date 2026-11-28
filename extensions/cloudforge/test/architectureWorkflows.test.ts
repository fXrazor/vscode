/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	defaultUpgradeConstraint,
	formatEngineFmtSummary,
	formatPortableBundleSummaryMarkdown,
	formatProviderUpgradePreviewMarkdown,
	isValidBundleName,
	isValidSemverVersion,
	parseEngineFmtResult,
	parsePortableBundleExport,
	parseProviderUpgradeApply,
	parseProviderUpgradePreview,
	parseUpgradeJournalRecovery
} from '../src/project/architectureWorkflows.ts';

const REV_A = 'a'.repeat(64);
const REV_B = 'b'.repeat(64);
const PROPOSAL_ID = 'upgrade-' + '1'.repeat(32);

test('validators enforce safe bundle names, semver versions, and pessimistic upgrade constraints', () => {
	assert.equal(isValidBundleName('prod-network-bundle'), true);
	assert.equal(isValidBundleName('.hidden'), false);
	assert.equal(isValidBundleName('../escape'), false);
	assert.equal(isValidBundleName('CON'), false);
	assert.equal(isValidBundleName('a/b'), false);
	assert.equal(isValidBundleName(''), false);

	assert.equal(isValidSemverVersion('4.25.0'), true);
	assert.equal(isValidSemverVersion('4.25.0-beta1'), false);
	assert.equal(isValidSemverVersion('4.25'), false);
	assert.equal(defaultUpgradeConstraint('4.25.0'), '~> 4.25');
});

test('parsePortableBundleExport parses valid manifest and formats secret-free Markdown report', () => {
	const parsed = parsePortableBundleExport({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		sourceRevision: REV_A,
		bundleName: 'landing-zone-bundle',
		engine: 'openTofu',
		engineInferred: true,
		verificationStatus: 'verified',
		bundleSha256: REV_B,
		fileCount: 5,
		totalBytes: 4096,
		excludedCount: 2,
		warningCount: 1,
		unresolvedReasons: [],
		warnings: ['Lock file targets windows_amd64 only.'],
		excludedArtifacts: [
			{ path: 'terraform.tfvars', reason: 'variable values excluded' },
			{ path: 'terraform.tfstate', reason: 'state excluded' },
		],
		files: ['main.tf', 'terraform.tfvars.example', 'PREREQUISITES.md', 'EXPORT-MANIFEST.json'],
	});
	assert.ok(parsed);
	assert.equal(parsed.bundleName, 'landing-zone-bundle');
	assert.equal(parsed.excludedArtifacts.length, 2);

	const md = formatPortableBundleSummaryMarkdown(parsed, 'Landing Zone');
	assert.match(md, /# Portable Terraform Bundle — landing-zone-bundle/);
	assert.match(md, /terraform\.tfvars/);
	assert.match(md, new RegExp(REV_B));
	assert.equal(parsePortableBundleExport({ workspaceId: 'ws-1', bundleSha256: 'bad' }), undefined);
});

test('parseEngineFmtResult parses check and apply responses and rejects invalid revisions', () => {
	const check = parseEngineFmtResult({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		sourceRevision: REV_A,
		engine: 'openTofu',
		engineVersion: '1.9.1',
		engineInferred: false,
		mode: 'check',
		formatted: false,
		changedFiles: ['main.tf', 'network.tf'],
		durationMs: 38,
	});
	assert.ok(check);
	assert.match(formatEngineFmtSummary(check), /2 file\(s\) need formatting.*main\.tf, network\.tf/);

	const applied = parseEngineFmtResult({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		sourceRevision: REV_A,
		newSourceRevision: REV_B,
		engine: 'terraform',
		engineVersion: '1.15.8',
		engineInferred: true,
		mode: 'apply',
		formatted: true,
		changedFiles: ['main.tf'],
		durationMs: 54,
	});
	assert.ok(applied);
	assert.match(formatEngineFmtSummary(applied), /Formatted 1 file\(s\) with Terraform 1\.15\.8.*rev bbbbbbbb/);

	assert.equal(parseEngineFmtResult({ workspaceId: 'ws-1', mode: 'invalid' }), undefined);
});

test('Stage 8C provider upgrade preview, apply, and journal recovery parsers & Markdown formatter', () => {
	const preview = parseProviderUpgradePreview({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		proposalId: PROPOSAL_ID,
		sourceRevision: REV_A,
		providerAddress: 'registry.terraform.io/hashicorp/azurerm',
		currentVersion: '4.10.0',
		targetVersion: '4.25.0',
		targetConstraint: '~> 4.25',
		engine: 'terraform',
		engineInferred: false,
		targetPlatforms: ['windows_amd64', 'linux_amd64'],
		fileChanges: [
			{
				file: 'versions.tf',
				beforeSha256: REV_A,
				afterSha256: REV_B,
				unifiedDiff: '--- a/versions.tf\n+++ b/versions.tf\n@@ -3,1 +3,1 @@\n- version = "~> 4.10"\n+ version = "~> 4.25"\n',
			},
		],
		schemaDiffs: [
			{
				provider: 'registry.terraform.io/hashicorp/azurerm',
				fromVersion: '4.10.0',
				toVersion: '4.25.0',
				hasBreakingChanges: true,
				hasArchitectureBreakingChanges: true,
				impactedArchitectureItems: [
					{
						resourceAddress: 'azurerm_virtual_network.vnet',
						typeName: 'azurerm_virtual_network',
						path: 'dns_servers',
						breaking: true,
						summary: 'Attribute changed type',
					},
				],
			},
		],
		hasBreakingSchemaChanges: true,
		hasArchitectureBreakingChanges: true,
		mirrorReady: false,
		missingMirrorPlatforms: ['linux_amd64'],
		checksRan: ['static-hcl-syntax', 'catalogue-schema-diff'],
		checksPending: ['engine-lock-refresh', 'engine-validate'],
	});
	assert.ok(preview);
	const md = formatProviderUpgradePreviewMarkdown(preview, 'Core Network');
	assert.match(md, /# Provider Upgrade Preview — registry\.terraform\.io\/hashicorp\/azurerm/);
	assert.match(md, /BREAKING.*azurerm_virtual_network\.vnet/);
	assert.match(md, /Missing target package for: linux_amd64/);
	assert.match(md, /```diff/);

	const applied = parseProviderUpgradeApply({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		proposalId: PROPOSAL_ID,
		updatedFiles: ['versions.tf'],
		newSourceRevision: REV_B,
		lockRefreshRequired: true,
	});
	assert.ok(applied);
	assert.deepEqual(applied.updatedFiles, ['versions.tf']);
	assert.equal(parseProviderUpgradeApply({ proposalId: 'bad-id' }), undefined);

	const recovery = parseUpgradeJournalRecovery({
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		recovered: true,
		proposalId: PROPOSAL_ID,
		priorState: 'applying',
		restoredFiles: ['versions.tf'],
		sourceRevision: REV_A,
	});
	assert.ok(recovery);
	assert.equal(recovery.recovered, true);
	assert.deepEqual(recovery.restoredFiles, ['versions.tf']);
});
