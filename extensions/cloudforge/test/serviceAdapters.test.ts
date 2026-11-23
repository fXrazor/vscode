/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidTfFileName, parseWebviewMessage, type CanvasGraphSnapshot } from '../src/canvas/protocol.ts';
import {
	draftSaveErrorMessage,
	mapRustFormSchemaToCanvasFormSchema,
	mapServiceValidationPollToRun,
	parseCatalogueSnapshots,
	parseCloudRegionsPayload,
	parseDependencyReport,
	parseDetectedEngines,
	parseDraftSaveApply,
	parseDraftSavePreview,
	parseEngineValidateReport,
	parseExportAuditReport,
	parseModuleInspection,
	parseSchemaDiffReport,
	parseValidationPoll,
	parseValidationStart,
	selectBestSnapshotForType
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
							blocks: [],
						},
					},
				],
			},
		},
	});
	assert.ok(adapted);
	assert.equal(adapted.providerSource, 'hashicorp/azurerm');
	assert.equal(adapted.providerVersion, '5.14.0');
	assert.equal(adapted.attributes.length, 3);
	assert.equal(adapted.attributes[1].valueType, 'bool');
	assert.equal(adapted.attributes[2].access, 'computedOnly');
	assert.equal(adapted.attributes[2].sensitive, true);
	assert.equal(adapted.blocks.length, 1);
	assert.equal(adapted.blocks[0].attributes[0].valueType, 'bool');
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
