/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatReadinessReportText,
	formatResourceExplanationMarkdown,
	formatSchemaDiffReportText,
	groupUpgradeableSnapshots,
	sanitizeExportStem,
} from '../src/project/architectureTools.ts';

test('groupUpgradeableSnapshots keeps only providers with 2+ snapshots sorted numerically by version', () => {
	const groups = groupUpgradeableSnapshots([
		{ address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: 'a'.repeat(64), resourceCount: 1110, dataSourceCount: 300 },
		{ address: 'registry.terraform.io/hashicorp/azurerm', version: '5.2.0', formatVersion: '1.0', sha256: 'b'.repeat(64), resourceCount: 1090, dataSourceCount: 295 },
		{ address: 'registry.terraform.io/hashicorp/aws', version: '5.0.0', formatVersion: '1.0', sha256: 'c'.repeat(64), resourceCount: 1200, dataSourceCount: 400 },
	]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].address, 'registry.terraform.io/hashicorp/azurerm');
	assert.deepEqual(groups[0].snapshots.map(s => s.version), ['5.2.0', '5.14.0']);
});

test('sanitizeExportStem produces safe deterministic filename stems', () => {
	assert.equal(sanitizeExportStem('Production Hub / UK South!'), 'production-hub-uk-south');
	assert.equal(sanitizeExportStem('   ...   '), 'cloudforge-architecture');
});

test('formatReadinessReportText combines Stage 6/8 audit, offline cost coverage, and policy findings honestly', () => {
	const text = formatReadinessReportText({
		architectureName: 'Hub Network',
		sourceRevision: 'a'.repeat(64),
		exportAudit: {
			sourceRevision: 'a'.repeat(64),
			engine: 'openTofu',
			engineInferred: true,
			reproducible: false,
			lockState: 'valid',
			lockEntryCount: 1,
			moduleCount: 0,
			unresolvedReasonKinds: ['missingLockHashes'],
		},
		dependencyReport: {
			sourceRevision: 'a'.repeat(64),
			engine: 'opentofu',
			engineInferred: true,
			lockState: 'valid',
			providers: [
				{
					display: 'hashicorp/azurerm',
					status: 'locked',
					lockedVersion: '5.14.0',
					requirementCount: 1,
					conflictCount: 0,
				},
			],
			unusedLockEntries: [],
			diagnosticCount: 0,
		},
		policyFindings: [
			{
				id: 'pol-1',
				ruleId: 'CF-SEC-001',
				severity: 'warning',
				nodeId: 'n1',
				resourceLabel: 'pip_hub',
				title: 'Public IP should use Standard SKU',
				remediation: 'Set sku = "Standard"',
				provenance: 'CloudForge Offline Baseline Policies',
			},
		],
		costEstimate: {
			currency: 'USD',
			region: 'uksouth',
			pricingCatalog: 'CloudForge Static Azure Reference Rates',
			isEstimate: true,
			baselineTotalUsd: 3.65,
			projectedTotalUsd: 3.65,
			deltaTotalUsd: 0,
			knownCount: 1,
			unknownCount: 1,
			lines: [
				{
					nodeId: 'n1',
					resourceLabel: 'pip_hub',
					resourceType: 'azurerm_public_ip',
					status: 'estimated',
					baselineMonthlyUsd: 3.65,
					projectedMonthlyUsd: 3.65,
					deltaMonthlyUsd: 0,
					basis: 'Standard Static Public IP',
				},
				{
					nodeId: 'n2',
					resourceLabel: 'custom_res',
					resourceType: 'azurerm_custom',
					status: 'unknown',
					baselineMonthlyUsd: null,
					projectedMonthlyUsd: null,
					deltaMonthlyUsd: null,
					basis: 'Unknown',
				},
			],
		},
	});
	assert.ok(text.includes('Action required'));
	assert.ok(text.includes('missingLockHashes'));
	assert.ok(text.includes('hashicorp/azurerm'));
	assert.ok(text.includes('$3.65/mo USD'));
	assert.ok(text.includes('1 catalogued, 1 unknown'));
	assert.ok(text.includes('CF-SEC-001'));
});

test('formatSchemaDiffReportText and formatResourceExplanationMarkdown produce structured output with source links', () => {
	const diffText = formatSchemaDiffReportText({
		provider: 'registry.terraform.io/hashicorp/azurerm',
		fromVersion: '5.14.0',
		toVersion: '6.0.0',
		addedTypeCount: 2,
		removedTypeCount: 1,
		pathChangeCount: 3,
		impactedArchitectureItems: [
			{
				resourceAddress: 'azurerm_resource_group.hub',
				kind: 'resource',
				typeName: 'azurerm_resource_group',
				path: 'legacy_tag',
				breaking: true,
				summary: 'legacy_tag was removed',
			},
		],
		hasBreakingChanges: true,
		hasArchitectureBreakingChanges: true,
		truncated: false,
	}, 'Hub Network');
	assert.ok(diffText.includes('5.14.0 -> 6.0.0'));
	assert.ok(diffText.includes('BREAKING CHANGES DETECTED'));
	assert.ok(diffText.includes('[BREAKING] azurerm_resource_group.hub'));

	const md = formatResourceExplanationMarkdown({
		node: {
			id: 'n1',
			kind: 'resource',
			resourceType: 'azurerm_subnet',
			name: 'azurerm_subnet.snet_app',
			label: 'snet_app',
			hasSource: true,
			sourceFile: 'network.tf',
			sourceLine: 8,
		},
		dataScopeDisclosure: 'Local offline analysis only.',
		schemaProvenance: 'hashicorp/azurerm 5.14.0',
		summary: 'Manages an Azure virtual network subnet.',
		upstreamNames: ['vnet_hub'],
		downstreamNames: ['nic_app'],
		transitiveImpactCount: 2,
		findings: [],
		estimatedMonthlyUsd: 0,
		costBasis: 'Logical subnet allocation',
		proposals: [
			{
				id: 'p1',
				title: 'Bind to rg_hub',
				rationale: 'Use typed reference expressions.',
				origin: 'cloudforge-advisor',
				patch: {},
			},
		],
	}, 'Hub Network');
	assert.ok(md.includes('`network.tf:8`'));
	assert.ok(md.includes('Transitive Dependents | 2 resource(s)'));
	assert.ok(md.includes('`vnet_hub`'));
	assert.ok(md.includes('Bind to rg_hub'));
});
