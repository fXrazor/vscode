/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidTfFileName, parseWebviewMessage, type CanvasGraphSnapshot } from '../src/canvas/protocol.ts';
import {
	draftSaveErrorMessage,
	formatEnginePlanReportText,
	mapRustFormSchemaToCanvasFormSchema,
	mapServiceValidationPollToRun,
	parseCatalogueSnapshots,
	parseCloudRegionsPayload,
	parseDependencyReport,
	parseDetectedEngines,
	parseDraftSaveApply,
	parseDraftSavePreview,
	parseSaveAllApply,
	parseSaveAllPreview,
	parseSchemaPreview,
	parseEngineInitOfflineReport,
	parseEnginePlanReport,
	parseEngineValidateReport,
	parseExportAuditReport,
	parseMirrorPackages,
	parseModuleInspection,
	parseOfflineMirrorReadiness,
	parseSchemaDiffReport,
	parseValidationPoll,
	parseValidationStart,
	selectBestSnapshotForType,
	newestPaletteSnapshots,
	parseCatalogueTypes,
	parseFormCoverage,
} from '../src/canvas/serviceAdapters.ts';

function sampleGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'workspace-' + 'a'.repeat(32) + '-architecture-1',
		architectureName: 'Hub Network',
		sourceRevision: 'b'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'node-1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'node-2', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet', label: 'azurerm_virtual_network.vnet', hasSource: true },
			{ id: 'node-3', kind: 'resource', resourceType: 'azurerm_subnet', name: 'app', label: 'azurerm_subnet.app', hasSource: true },
		],
		edges: [
			{ fromId: 'node-1', toId: 'node-2', kind: 'reference' },
			{ fromId: 'node-2', toId: 'node-3', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('Stage 3 catalogue adapters parse snapshots, pick newest provider version, and map Rust FormSchema', () => {
	const shaA = '1'.repeat(64);
	const shaB = '2'.repeat(64);
	const snapshots = parseCatalogueSnapshots({
		snapshots: [
			{
				manifestVersion: 1,
				key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '4.12.0', formatVersion: '1.0', sha256: shaA },
				provenance: { engine: { name: 'opentofu', version: '1.13.9' }, recordedAt: '2026-11-22T00:00:00Z' },
				counts: { resources: 900, dataSources: 200 },
			},
			{
				manifestVersion: 1,
				key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: shaB },
				provenance: { engine: { name: 'opentofu', version: '1.13.9' }, recordedAt: '2026-11-22T00:00:00Z' },
				counts: { resources: 1050, dataSources: 240 },
			},
		],
	});
	assert.equal(snapshots.length, 2);
	const best = selectBestSnapshotForType(snapshots, 'azurerm_storage_account');
	assert.equal(best?.version, '5.14.0');
	assert.equal(selectBestSnapshotForType(snapshots, 'aws_s3_bucket'), undefined);

	const adapted = mapRustFormSchemaToCanvasFormSchema({
		key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: shaB },
		form: {
			kind: 'resource',
			typeName: 'azurerm_storage_account',
			description: 'Manages an Azure Storage Account.',
			block: {
				attributes: [
					{ name: 'name', path: 'name', access: 'required', editor: 'text', encoding: 'plain', description: 'Storage account name.' },
					{ name: 'https_traffic_only_enabled', path: 'https_traffic_only_enabled', access: 'optional', editor: 'checkbox', encoding: 'plain' },
					{ name: 'primary_access_key', path: 'primary_access_key', access: 'computedOnly', editor: 'secret', encoding: 'plain', sensitive: true },
					{ name: 'tuple_value', path: 'tuple_value', access: 'optional', editor: 'text', typeExpr: { kind: 'tuple', elements: [{ kind: 'number' }, { kind: 'bool' }] } },
					{ name: 'dynamic_value', path: 'dynamic_value', access: 'optional', editor: { gap: 'Complex value' }, typeExpr: { kind: 'dynamic' } },
					{ name: 'nested_values', path: 'nested_values', access: 'optional', nested: { mode: 'list', attributes: [] } },
				],
				blocks: [
					{
						name: 'blob_properties',
						path: 'blob_properties',
						mode: 'list',
						maxItems: 1,
						block: {
							attributes: [
								{ name: 'versioning_enabled', path: 'blob_properties.versioning_enabled', access: 'optional', editor: 'checkbox', encoding: 'plain' },
							],
							blocks: [{ name: 'delete_retention_policy', path: 'blob_properties.delete_retention_policy', maxItems: 1, block: { attributes: [{ name: 'days', path: 'blob_properties.delete_retention_policy.days', access: 'optional', typeExpr: { kind: 'number' } }], blocks: [] } }],
						},
					},
				],
			},
		},
	});
	assert.ok(adapted);
	assert.equal(adapted.providerSource, 'hashicorp/azurerm');
	assert.equal(adapted.providerVersion, '5.14.0');
	assert.equal(adapted.attributes.length, 6);
	assert.equal(adapted.attributes[1].valueType, 'bool');
	assert.equal(adapted.attributes[2].access, 'computedOnly');
	assert.equal(adapted.attributes[2].sensitive, true);
	assert.equal(adapted.attributes[3].valueType, 'listString');
	assert.equal(adapted.attributes[4].valueType, 'json');
	assert.equal(adapted.attributes[5].valueType, 'listString');
	assert.equal(adapted.blocks.length, 2);
	assert.equal(adapted.blocks[0].attributes[0].valueType, 'bool');
	assert.equal(adapted.blocks[1].path, 'blob_properties.delete_retention_policy');
	assert.equal(adapted.blocks[1].attributes[0].valueType, 'number');
	assert.ok(adapted.outputs.some(o => o.name === 'primary_access_key' && o.knownAtApply));
});

test('Stage 4 validation runner adapter projects Rust poll response with cycle/blocker states into ValidationRun', () => {
	const graph = sampleGraph();
	const start = parseValidationStart({
		runId: `${graph.workspaceId}-run-1`,
		workspaceId: graph.workspaceId,
		architectureId: graph.architectureId,
		sourceRevision: graph.sourceRevision,
		state: 'running',
		reused: false,
	});
	assert.ok(start);

	const poll = parseValidationPoll({
		runId: start.runId,
		workspaceId: graph.workspaceId,
		architectureId: graph.architectureId,
		sourceRevision: graph.sourceRevision,
		state: 'failed',
		stage: 'static_checks',
		coverage: 'partial',
		coverageGaps: ['UNRESOLVED_REFERENCE'],
		elapsedMs: 14,
		nextCursor: 4,
		hasMore: false,
		cursorGap: false,
		events: [
			{ seq: 1, elapsedMs: 1, kind: 'stageStarted', payload: { stage: 'read_architecture' } },
			{ seq: 2, elapsedMs: 4, kind: 'stageFinished', payload: { stage: 'read_architecture', status: 'completed', durationMs: 3 } },
			{ seq: 3, elapsedMs: 10, kind: 'nodeUpdated', payload: { nodeId: 'node-1', state: 'failed', reasonCode: 'DEPENDENCY_CYCLE' } },
			{ seq: 4, elapsedMs: 14, kind: 'runFinished', payload: { state: 'failed' } },
		],
		snapshot: {
			nodes: [
				{ nodeId: 'node-1', state: 'failed', blockedBy: ['node-2'], reasonCode: 'DEPENDENCY_CYCLE' },
				{ nodeId: 'node-2', state: 'failed', blockedBy: ['node-1'], reasonCode: 'DEPENDENCY_CYCLE' },
				{ nodeId: 'node-3', state: 'skipped', blockedBy: ['node-2'], reasonCode: 'PREREQUISITE_CYCLE' },
			],
			findings: [
				{ code: 'DEPENDENCY_CYCLE', severity: 'error', message: 'Cycle detected', nodeId: 'node-1' },
			],
		},
	});
	assert.ok(poll);

	const run = mapServiceValidationPollToRun(poll, {
		graph,
		scope: 'architecture',
		targetNodeId: null,
		attempt: 1,
		previousRunId: null,
		startedAtMs: 1000,
		accumulatedEvents: poll.events,
	});

	assert.equal(run.outcome, 'failed');
	assert.equal(run.coverage, 'partial');
	assert.equal(run.coverageNotes.length, 1);
	assert.equal(run.nodeResults['node-1'].status, 'failed');
	assert.equal(run.nodeResults['node-3'].status, 'skipped');
	assert.deepEqual(run.nodeResults['node-3'].blockedBy, ['node-2']);
	assert.deepEqual(run.cycleNodeIds.sort(), ['node-1', 'node-2']);
	assert.equal(run.stages.length, 3);
	assert.equal(run.events.length, 4);
});

test('Stage 5 guarded save parsers and Webview protocol validation enforce strict .tf boundaries', () => {
	assert.equal(isValidTfFileName('cloudforge_draft.tf'), true);
	assert.equal(isValidTfFileName('.hidden.tf'), false);
	assert.equal(isValidTfFileName('sub/main.tf'), false);
	assert.equal(isValidTfFileName('main.tf.json'), false);
	assert.equal(isValidTfFileName('.tf'), false);

	assert.deepEqual(
		parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'network.tf', contents: 'resource "null_resource" "a" {}\n' }),
		{ type: 'requestDraftSavePreview', fileName: 'network.tf', contents: 'resource "null_resource" "a" {}\n' }
	);
	assert.equal(
		parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: '..\\escape.tf', contents: '' }),
		undefined
	);
	assert.deepEqual(
		parseWebviewMessage({ type: 'applyDraftSave', fileName: 'network.tf', contents: 'locals {}', previewToken: 'save-' + 'a'.repeat(32) }),
		{ type: 'applyDraftSave', fileName: 'network.tf', contents: 'locals {}', previewToken: 'save-' + 'a'.repeat(32) }
	);
	assert.equal(
		parseWebviewMessage({ type: 'requestValidation', scope: 'resource', nodeId: 'node-2' })?.type,
		'requestValidation'
	);
	assert.deepEqual(
		parseWebviewMessage({ type: 'requestSchema', kind: 'resource', typeName: 'azurerm_storage_account' }),
		{ type: 'requestSchema', kind: 'resource', typeName: 'azurerm_storage_account' }
	);
	assert.equal(
		parseWebviewMessage({ type: 'requestSchema', kind: 'resource', typeName: '../bad' }),
		undefined
	);

	const preview = parseDraftSavePreview({
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'workspace-' + 'a'.repeat(32) + '-architecture-1',
		sourceRevision: 'b'.repeat(64),
		fileName: 'network.tf',
		created: true,
		afterSha256: 'c'.repeat(64),
		addedLines: 5,
		removedLines: 0,
		findings: [{ code: 'SENSITIVE_LITERAL', file: 'network.tf', line: 3 }],
		previewToken: 'save-' + 'd'.repeat(32),
	});
	assert.ok(preview);
	assert.equal(preview.created, true);
	assert.equal(preview.findings.length, 1);
	assert.equal(preview.merge, undefined);

	const focusedBase = {
		sourceRevision: 'b'.repeat(64), fileName: 'network.tf', created: false, afterSha256: 'c'.repeat(64),
		addedLines: 1, removedLines: 1, findings: [], previewToken: 'save-' + 'd'.repeat(32), focused: true,
	};
	const focused = parseDraftSavePreview({
		...focusedBase,
		merge: { updated: ['aws_vpc.main'], added: [], removed: [], unchanged: 1, preserved: 2, skipped: [''] },
	});
	assert.deepEqual(focused?.merge, { updated: ['aws_vpc.main'], added: [], removed: [], unchanged: 1, preserved: 2, skipped: [], renamed: [] });
	assert.equal(parseDraftSavePreview({ ...focusedBase, merge: { updated: 'x' } })?.merge, undefined);
	assert.equal(parseDraftSavePreview({ ...focusedBase, focused: false, merge: { updated: [], added: [], removed: [], unchanged: 0, preserved: 0, skipped: [] } })?.merge, undefined);

	const applied = parseDraftSaveApply({
		fileName: 'network.tf',
		created: true,
		newSourceRevision: 'e'.repeat(64),
		bytesWritten: 128,
	});
	assert.ok(applied);
	assert.equal(applied.bytesWritten, 128);

	assert.match(draftSaveErrorMessage('SCOPE_DENIED').message, /read-only/i);
	assert.match(draftSaveErrorMessage('STALE_SOURCE').message, /Refresh/i);
});

test('Stage 6 cloud regions and dependency report adapters parse sanitized payloads and reject invalid fields', () => {
	const regions = parseCloudRegionsPayload({
		provider: 'azure',
		source: 'bundledPublicFallback',
		refreshedAt: '2026-11-16T00:00:00Z',
		stale: false,
		isFallback: true,
		regions: [
			{ name: 'uksouth', displayName: 'UK South', availabilityZones: ['1', '2', '3'], geography: 'United Kingdom' },
			{ name: 'westeurope', displayName: 'West Europe', availabilityZones: ['1', '2', '3'], geography: 'Europe' },
		],
	});
	assert.ok(regions);
	assert.equal(regions.provider, 'azure');
	assert.equal(regions.regions.length, 2);
	assert.equal(regions.regions[0].name, 'uksouth');
	assert.equal(parseCloudRegionsPayload({ provider: 'unknown', source: 'bundledPublicFallback', refreshedAt: 'x', stale: false, isFallback: true, regions: [] }), undefined);

	const deps = parseDependencyReport({
		sourceRevision: 'a'.repeat(64),
		engine: 'terraform',
		engineInferred: true,
		lockFile: { state: 'valid', entries: [] },
		providers: [
			{ display: 'hashicorp/azurerm', status: 'locked', lock: { version: '5.14.0', rejectedBy: [] }, conflicts: [], requirements: [{}, {}] },
			{ display: 'hashicorp/random', status: 'conflict', conflicts: [{ message: 'conflict' }], requirements: [{}, {}] },
		],
		unusedLockEntries: ['registry.terraform.io/hashicorp/null'],
		diagnostics: [{ severity: 'warning', message: 'skipped' }],
	});
	assert.ok(deps);
	assert.equal(deps.engine, 'terraform');
	assert.equal(deps.lockState, 'valid');
	assert.equal(deps.providers.length, 2);
	assert.equal(deps.providers[0].lockedVersion, '5.14.0');
	assert.equal(deps.providers[1].conflictCount, 1);
	assert.equal(deps.unusedLockEntries.length, 1);
	assert.equal(deps.diagnosticCount, 1);
});

test('Stage 7 module inspection adapter and Webview requestModule validation sanitize inputs', () => {
	assert.deepStrictEqual(parseWebviewMessage({ type: 'requestModule', modulePath: ['net', 'sub'] }), {
		type: 'requestModule',
		modulePath: ['net', 'sub'],
	});
	assert.equal(parseWebviewMessage({ type: 'requestModule', modulePath: [] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestModule', modulePath: ['../outside'] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestModule', modulePath: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }), undefined);

	const parsed = parseModuleInspection({
		workspaceId: 'ws-1',
		architectureId: 'ws-1-arch-1',
		sourceRevision: 'a'.repeat(64),
		moduleRevision: 'b'.repeat(64),
		modulePath: ['net'],
		status: 'local',
		sourceKind: 'local',
		source: './modules/net',
		passedInputs: ['resource_group_name'],
		variables: [
			{ name: 'resource_group_name', typeExpr: 'string', description: 'RG name', required: true, sensitive: false, hasDefault: false },
		],
		outputs: [
			{ name: 'vnet_id', description: 'VNet ID', sensitive: false },
		],
		childModules: [{ name: 'sub', source: './sub', isLocal: true }],
		graph: {
			workspaceId: 'ws-1',
			architectureId: 'ws-1-arch-1',
			sourceRevision: 'b'.repeat(64),
			status: 'complete',
			nodes: [
				{ id: 'node-1', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet', label: 'azurerm_virtual_network.vnet' },
				{ id: 'node-2', kind: 'module', resourceType: null, name: 'sub', label: 'module.sub' },
			],
			edges: [{ from: 'node-2', to: 'node-1', kind: 'reference' }],
			diagnostics: [],
		},
	}, 'Hub');
	assert.ok(parsed);
	assert.equal(parsed.status, 'local');
	assert.equal(parsed.variables.length, 1);
	assert.equal(parsed.outputs.length, 1);
	assert.equal(parsed.childModules.length, 1);
	assert.ok(parsed.graph);
	assert.equal(parsed.graph.nodes.length, 2);
	assert.deepStrictEqual(parsed.graph.edges[0], { fromId: 'node-1', toId: 'node-2', kind: 'reference' });
});

test('Stage 8 schema upgrade impact diff and reproducible export audit adapters sanitize payloads', () => {
	const shaA = 'a'.repeat(64);
	const shaB = 'b'.repeat(64);
	assert.deepStrictEqual(
		parseWebviewMessage({
			type: 'requestSchemaDiff',
			fromKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: shaA },
			toKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '6.0.0', formatVersion: '1.0', sha256: shaB },
		}),
		{
			type: 'requestSchemaDiff',
			fromKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: shaA },
			toKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '6.0.0', formatVersion: '1.0', sha256: shaB },
		}
	);
	assert.equal(
		parseWebviewMessage({
			type: 'requestSchemaDiff',
			fromKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256: 'not-a-sha' },
			toKey: { address: 'registry.terraform.io/hashicorp/azurerm', version: '6.0.0', formatVersion: '1.0', sha256: shaB },
		}),
		undefined
	);

	const diff = parseSchemaDiffReport({
		provider: 'registry.terraform.io/hashicorp/azurerm',
		fromVersion: '5.14.0',
		toVersion: '6.0.0',
		addedTypes: [{ kind: 'resource', typeName: 'azurerm_public_ip' }],
		removedTypes: [],
		pathChanges: [{ kind: 'resource', typeName: 'azurerm_resource_group', path: 'legacy_tag', change: { kind: 'removed' }, breaking: true }],
		impactedArchitectureItems: [
			{ resourceAddress: 'azurerm_resource_group.hub', kind: 'resource', typeName: 'azurerm_resource_group', path: 'legacy_tag', breaking: true, summary: 'legacy_tag was removed' },
		],
		hasBreakingChanges: true,
		hasArchitectureBreakingChanges: true,
		truncated: false,
	});
	assert.ok(diff);
	assert.equal(diff.addedTypeCount, 1);
	assert.equal(diff.impactedArchitectureItems.length, 1);
	assert.equal(diff.hasArchitectureBreakingChanges, true);

	const audit = parseExportAuditReport({
		sourceRevision: 'a'.repeat(64),
		engine: 'openTofu',
		engineInferred: true,
		reproducible: false,
		lockFile: { state: 'valid', entries: [{ address: 'registry.opentofu.org/hashicorp/azurerm', version: '5.14.0', hashCount: 0, hasH1Hash: false, hasZhHash: false }] },
		moduleProvenance: [{ name: 'net' }],
		unresolvedReasons: [{ kind: 'missingLockHashes' }, { kind: 'unpinnedModule' }],
	});
	assert.ok(audit);
	assert.equal(audit.reproducible, false);
	assert.equal(audit.lockEntryCount, 1);
	assert.deepStrictEqual(audit.unresolvedReasonKinds, ['missingLockHashes', 'unpinnedModule']);
});

test('Stage 9A local engine discovery and CLI validate adapters sanitize payloads', () => {
	assert.deepStrictEqual(parseWebviewMessage({ type: 'requestEngineValidate' }), { type: 'requestEngineValidate' });
	assert.deepStrictEqual(parseWebviewMessage({ type: 'requestEngineValidate', engine: 'openTofu' }), { type: 'requestEngineValidate', engine: 'openTofu' });
	assert.equal(parseWebviewMessage({ type: 'requestEngineValidate', engine: 'bash' }), undefined);

	const engines = parseDetectedEngines({
		engines: [
			{ engine: 'openTofu', status: 'available', version: '1.11.4', platform: 'windows_amd64' },
			{ engine: 'terraform', status: 'missing', message: 'terraform.exe was not found.' },
			{ engine: 'bad', status: 'available' },
		],
	});
	assert.equal(engines.length, 2);
	assert.equal(engines[0].engine, 'openTofu');
	assert.equal(engines[0].version, '1.11.4');
	assert.equal(engines[1].status, 'missing');

	const report = parseEngineValidateReport({
		sourceRevision: 'a'.repeat(64),
		engine: 'openTofu',
		engineVersion: '1.11.4',
		engineInferred: true,
		valid: false,
		errorCount: 1,
		warningCount: 0,
		durationMs: 120,
		diagnostics: [
			{ severity: 'error', summary: 'Missing required argument', detail: 'location is required', filename: 'main.tf', line: 3, column: 2 },
		],
		truncated: false,
	});
	assert.ok(report);
	assert.equal(report.valid, false);
	assert.equal(report.errorCount, 1);
	assert.equal(report.diagnostics[0].filename, 'main.tf');
	assert.equal(report.diagnostics[0].line, 3);
});

test('palette uses the newest imported snapshot per provider and validates its types and coverage', () => {
	const snap = (address: string, version: string) => ({ address, version, formatVersion: '1.0', sha256: 'c'.repeat(64), resourceCount: 1, dataSourceCount: 0 });
	const newest = newestPaletteSnapshots([
		snap('registry.terraform.io/hashicorp/azurerm', '5.14.0'),
		snap('registry.terraform.io/hashicorp/azurerm', '5.15.0'),
		snap('registry.terraform.io/hashicorp/aws', '6.73.0'),
		snap('registry.terraform.io/hashicorp/random', '3.6.0'),
	]);
	assert.deepEqual(newest.map(item => [item.provider, item.snapshot.version]).sort(), [['aws', '6.73.0'], ['azure', '5.15.0']]);
	assert.deepEqual(parseCatalogueTypes({ resources: ['azurerm_new_thing', 'Bad Type', 7] }, 'azure', '5.15.0'), { provider: 'azure', version: '5.15.0', resources: ['azurerm_new_thing'] });
	assert.equal(parseCatalogueTypes({}, 'azure', '5.15.0'), undefined);
	assert.deepEqual(parseFormCoverage({ complete: false, paths: 12, readOnly: 2, gaps: [{ path: 'a.b', reason: 'dynamic' }, { path: 3 }] }), { complete: false, paths: 12, readOnly: 2, gaps: [{ path: 'a.b', reason: 'dynamic' }] });
	assert.equal(parseFormCoverage({ complete: 'yes', paths: 1, readOnly: 0, gaps: [] }), undefined);
});

test('renderResourceDraft messages and results are validated before reaching the service or Studio', () => {
	const draft = { kind: 'resource', typeName: 'azurerm_virtual_network', label: 'hub', body: { attributes: {}, blocks: [] } };
	assert.deepEqual(parseWebviewMessage({ type: 'renderResourceDraft', resourceId: 'network', draft }), { type: 'renderResourceDraft', resourceId: 'network', draft });
	assert.equal(parseWebviewMessage({ type: 'renderResourceDraft', resourceId: 'network', draft: { ...draft, kind: 'module' } }), undefined);
	assert.equal(parseWebviewMessage({ type: 'renderResourceDraft', resourceId: '', draft }), undefined);
	assert.equal(parseWebviewMessage({ type: 'renderResourceDraft', resourceId: 'network', draft: { ...draft, label: 'x'.repeat(50_000) } }), undefined);

	const preview = parseSchemaPreview({ hcl: 'resource "a" "b" {}\n', diagnostics: [{ path: 'location', message: 'Required attribute', severity: 'error' }, { path: 'x', message: '', severity: 'error' }], hasErrors: true }, 'network', '4.0.0');
	assert.deepEqual(preview, { resourceId: 'network', hcl: 'resource "a" "b" {}\n', diagnostics: [{ path: 'location', message: 'Required attribute', severity: 'error' }], hasErrors: true, providerVersion: '4.0.0' });
	assert.equal(parseSchemaPreview({ hcl: 1, diagnostics: [] }, 'network', '4.0.0'), undefined);
});

test('draft save previews carry bounded canvas deletions', () => {
	assert.deepEqual(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', removeAddresses: ['aws_vpc.old'] }), { type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', removeAddresses: ['aws_vpc.old'] });
	assert.deepEqual(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', removeAddresses: [] }), { type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '' });
	assert.equal(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', removeAddresses: [''] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', removeAddresses: 'aws_vpc.old' }), undefined);
	assert.deepEqual(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', renames: [{ from: 'a.b', to: 'a.c' }] }), { type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', renames: [{ from: 'a.b', to: 'a.c' }] });
	assert.equal(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: '', renames: [{ from: 'a.b', to: 'a.c', extra: 1 }] }), undefined);
	assert.deepEqual(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: 'a', baseContents: 'b' }), { type: 'requestDraftSavePreview', fileName: 'main.tf', contents: 'a', baseContents: 'b' });
	assert.equal(parseWebviewMessage({ type: 'requestDraftSavePreview', fileName: 'main.tf', contents: 'a', baseContents: 1 }), undefined);
});

test('save-all preview and apply results are validated and messages are bounded', () => {
	const merge = { updated: ['aws_vpc.main'], added: [], removed: [], unchanged: 0, preserved: 1, skipped: [], renamed: [] };
	const preview = parseSaveAllPreview({
		workspaceId: 'w', architectureId: 'a', sourceRevision: 'a'.repeat(64), focused: true, previewToken: 'save-' + 'd'.repeat(32),
		files: [
			{ fileName: 'main.tf', created: false, changed: true, addedLines: 1, removedLines: 1, findings: [{ code: 'X', file: 'main.tf', line: 2 }], merge },
			{ fileName: 'new.tf', created: true, changed: false, addedLines: 0, removedLines: 0, findings: [] },
		],
	});
	assert.equal(preview?.files.length, 2);
	assert.deepEqual(preview?.files[0].merge, merge);
	assert.equal(preview?.files[1].merge, undefined);
	assert.equal(parseSaveAllPreview({ sourceRevision: 'a'.repeat(64), previewToken: 't', files: [{ fileName: 'main.tf' }] }), undefined);
	assert.deepEqual(parseSaveAllApply({ newSourceRevision: 'e'.repeat(64), files: [{ fileName: 'main.tf', created: false, bytesWritten: 9 }] }), {
		newSourceRevision: 'e'.repeat(64), files: [{ fileName: 'main.tf', created: false, bytesWritten: 9 }],
	});
	assert.equal(parseSaveAllApply({ newSourceRevision: 'bad', files: [] }), undefined);

	assert.deepEqual(parseWebviewMessage({ type: 'requestSaveAllPreview', files: [{ fileName: 'main.tf', contents: 'x', baseContents: 'y', renames: [{ from: 'a.b', to: 'a.c' }] }] }), {
		type: 'requestSaveAllPreview', files: [{ fileName: 'main.tf', contents: 'x', baseContents: 'y', renames: [{ from: 'a.b', to: 'a.c' }] }],
	});
	assert.equal(parseWebviewMessage({ type: 'requestSaveAllPreview', files: [] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestSaveAllPreview', files: [{ fileName: 'a.tf', contents: '' }, { fileName: 'A.tf', contents: '' }] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestSaveAllPreview', files: [{ fileName: '../a.tf', contents: '' }] }), undefined);
	assert.equal(parseWebviewMessage({ type: 'requestSaveAllPreview', files: [{ type: 'applyDraftSave', fileName: 'a.tf', contents: '' }] }), undefined);
	assert.deepEqual(parseWebviewMessage({ type: 'applySaveAll', previewToken: 'save-' + 'd'.repeat(32) }), { type: 'applySaveAll', previewToken: 'save-' + 'd'.repeat(32) });
});

test('Stage 9B guarded local engine plan adapters sanitize planned/failed responses and never carry literal values', () => {
	assert.deepStrictEqual(parseWebviewMessage({ type: 'requestEnginePlan' }), { type: 'requestEnginePlan' });
	assert.deepStrictEqual(parseWebviewMessage({ type: 'requestEnginePlan', engine: 'terraform' }), { type: 'requestEnginePlan', engine: 'terraform' });
	assert.equal(parseWebviewMessage({ type: 'requestEnginePlan', engine: 'powershell' }), undefined);

	const planned = parseEnginePlanReport({
		sourceRevision: 'b'.repeat(64),
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: true,
		status: 'planned',
		formatVersion: '1.2',
		errored: false,
		durationMs: 312,
		summary: { create: 1, update: 1, replace: 0, delete: 0, read: 0, noOp: 0, total: 2 },
		resourceChanges: [
			{
				address: 'azurerm_resource_group.hub',
				mode: 'managed',
				typeName: 'azurerm_resource_group',
				name: 'hub',
				providerName: 'registry.opentofu.org/hashicorp/azurerm',
				actions: ['create'],
				actionKind: 'create',
				hasSensitiveAttributes: false,
				changedAttributePaths: ['location', 'name'],
				after: { secret_value: 'SHOULD_BE_STRIPPED' },
			},
			{
				address: 'azurerm_key_vault_secret.api',
				mode: 'managed',
				typeName: 'azurerm_key_vault_secret',
				name: 'api',
				actions: ['update'],
				actionKind: 'update',
				hasSensitiveAttributes: true,
				changedAttributePaths: ['value'],
			},
		],
		outputChanges: [
			{ name: 'db_password', actions: ['create'], sensitive: true, after: 'TOP_SECRET' },
		],
		diagnostics: [],
		truncated: false,
	});
	assert.ok(planned);
	assert.equal(planned.status, 'planned');
	assert.equal(planned.summary.create, 1);
	assert.equal(planned.summary.update, 1);
	assert.equal(planned.resourceChanges.length, 2);
	assert.equal(planned.resourceChanges[1].hasSensitiveAttributes, true);
	assert.equal(planned.outputChanges[0].sensitive, true);
	assert.equal(JSON.stringify(planned).includes('SHOULD_BE_STRIPPED'), false);
	assert.equal(JSON.stringify(planned).includes('TOP_SECRET'), false);

	const formatted = formatEnginePlanReportText(planned, 'Hub Network');
	assert.ok(formatted.includes('OpenTofu 1.13.9'));
	assert.ok(formatted.includes('+1 create · ~1 update'));
	assert.ok(formatted.includes('[create] azurerm_resource_group.hub [location, name]'));
	assert.ok(formatted.includes('(sensitive attributes redacted)'));
	assert.ok(formatted.includes('output.db_password (sensitive)'));

	const failed = parseEnginePlanReport({
		sourceRevision: 'b'.repeat(64),
		engine: 'terraform',
		engineVersion: '1.15.8',
		engineInferred: false,
		status: 'failed',
		errored: true,
		durationMs: 85,
		summary: { create: 0, update: 0, replace: 0, delete: 0, read: 0, noOp: 0, total: 0 },
		resourceChanges: [],
		outputChanges: [],
		diagnostics: [
			{ severity: 'error', summary: 'Inconsistent dependency lock file', filename: 'main.tf', line: 1 },
		],
		truncated: false,
	});
	assert.ok(failed);
	assert.equal(failed.status, 'failed');
	assert.equal(failed.diagnostics.length, 1);
	assert.equal(parseEnginePlanReport({ status: 'unknown' }), undefined);
});

test('Stage 10 mirror package, readiness, offline init adapters and webview protocol enforce bounds', () => {
	const sha = 'c'.repeat(64);
	const packages = parseMirrorPackages({
		packages: [
			{
				key: { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' },
				sizeBytes: 1024,
				sha256: sha,
				recordedAt: '2026-11-25T00:00:00Z',
				publisher: 'HashiCorp',
			},
			{ key: { address: '', version: '1.0.0', platform: 'windows_amd64' }, sizeBytes: 10, sha256: sha, recordedAt: '2026-11-25T00:00:00Z' },
		],
	});
	assert.equal(packages.length, 1);
	assert.equal(packages[0].key.address, 'registry.terraform.io/hashicorp/azurerm');
	assert.equal(packages[0].publisher, 'HashiCorp');

	const readiness = parseOfflineMirrorReadiness({
		sourceRevision: sha,
		engine: 'openTofu',
		engineInferred: true,
		lockState: 'valid',
		isReady: false,
		ready: [{ address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'windows_amd64' }],
		missing: [{ address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', platform: 'linux_amd64' }],
		corrupted: [],
	});
	assert.ok(readiness);
	assert.equal(readiness.isReady, false);
	assert.equal(readiness.ready.length, 1);
	assert.equal(readiness.missing.length, 1);
	assert.equal(parseOfflineMirrorReadiness({ isReady: true }), undefined);

	const initReport = parseEngineInitOfflineReport({
		sourceRevision: sha,
		engine: 'openTofu',
		engineVersion: '1.13.9',
		engineInferred: true,
		status: 'initialized',
		exitCode: 0,
		durationMs: 140,
		summary: 'Offline mirror initialization succeeded (lock file: valid, 1 provider package(s)).',
	});
	assert.ok(initReport);
	assert.equal(initReport.status, 'initialized');
	assert.equal(initReport.exitCode, 0);
	assert.equal(parseEngineInitOfflineReport({ status: 'weird' }), undefined);

	assert.deepEqual(parseWebviewMessage({ type: 'requestEngineInitOffline' }), { type: 'requestEngineInitOffline' });
	assert.deepEqual(parseWebviewMessage({ type: 'requestEngineInitOffline', engine: 'terraform' }), { type: 'requestEngineInitOffline', engine: 'terraform' });
	assert.equal(parseWebviewMessage({ type: 'requestEngineInitOffline', engine: 'bash' }), undefined);
});
