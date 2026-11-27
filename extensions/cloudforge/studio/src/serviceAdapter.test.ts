/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer } from './model.ts';
import { liveSchemaAttributes, liveSchemaBlocks, liveSchemaOutputs, type HostFormSchema } from './liveSchema.ts';
import { additionalBlocks, editableFields } from './formDefinition.ts';
import { architectureDiagnostics, isStaleDiagnostic } from './diagnostics.ts';
import { sourceChanges, buildDraftSavePayload, changedFilePayloads, refreshPrevious, adoptSavedFiles, buildHostViewState, defaultTargetTfFile, projectGraphSnapshotToArchitecture, projectHostDiagnostics, resolveProviderRegions } from './serviceAdapter.ts';
import { projectResourceFiles, terraformCode, terraformCode as codeFor } from './terraformProjection.ts';
import { describeMerge } from './draftSaveMerge.ts';
import { buildResourceDraft, parseSchemaPreview } from './resourceDraft.ts';
import { hydrateResourceValues, parseResourceValues } from './resourceValues.ts';
import { sampleArchitecture as schemaSample } from './fixture.ts';
import { explicitResourceReferences, inheritedDependencies } from './resourceHierarchy.ts';
import type { HostCloudRegionsPayload, HostEngineValidateReport, HostGraphSnapshot, HostValidationRun } from './webviewBridge.ts';

const SAMPLE_LIVE_SCHEMA: HostFormSchema = {
	kind: 'resource',
	typeName: 'azurerm_custom_firewall',
	providerSource: 'hashicorp/azurerm',
	providerVersion: '5.14.0',
	description: 'Manages an Azure Firewall with live Rust schema coverage.',
	docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/firewall',
	exampleHcl: 'resource "azurerm_custom_firewall" "fw" {}',
	attributes: [
		{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Firewall name.' },
		{ name: 'sku_tier', path: 'sku_tier', access: 'required', valueType: 'string', description: 'SKU tier.', options: ['Standard', 'Premium'] },
		{ name: 'threat_intel_mode', path: 'threat_intel_mode', access: 'optional', valueType: 'string', description: 'Threat intel mode.' },
		{ name: 'dns_servers', path: 'dns_servers', access: 'optional', valueType: 'listString', description: 'DNS servers.' },
		{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Resource ID.' },
	],
	blocks: [
		{
			name: 'ip_configuration',
			path: 'ip_configuration',
			minItems: 1,
			maxItems: 4,
			description: 'IP configuration for firewall.',
			attributes: [
				{ name: 'name', path: 'ip_configuration.name', access: 'required', valueType: 'string', description: 'Config name.' },
				{ name: 'subnet_id', path: 'ip_configuration.subnet_id', access: 'optional', valueType: 'string', description: 'Subnet ID.' },
			],
		},
	],
	outputs: [
		{ name: 'id', valueType: 'string', description: 'Firewall ID.', knownAtApply: true },
		{ name: 'private_ip_address', valueType: 'string', description: 'Private IP.', knownAtApply: true },
	],
};

test('live Rust FormSchema converts attributes, nested blocks, outputs, and replaces primitive-only warning', () => {
	const attrs = liveSchemaAttributes(SAMPLE_LIVE_SCHEMA);
	assert.equal(attrs.some(a => a.name === 'id'), false, 'computedOnly attributes must not be editable');
	assert.equal(attrs.find(a => a.name === 'sku_tier')?.required, true);
	assert.deepEqual(attrs.find(a => a.name === 'sku_tier')?.options, ['Standard', 'Premium']);
	assert.equal(attrs.find(a => a.name === 'dns_servers')?.type, 'list');

	const blocks = liveSchemaBlocks(SAMPLE_LIVE_SCHEMA);
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, 'ip_configuration');
	assert.equal(blocks[0].required, true);
	assert.equal(blocks[0].max, 4);
	assert.deepEqual(liveSchemaOutputs(SAMPLE_LIVE_SCHEMA).sort(), ['id', 'private_ip_address']);

	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Hub Firewall',
		sourceRevision: 'a'.repeat(64),
		status: 'complete',
		nodes: [{ id: 'n-fw', kind: 'resource', resourceType: 'azurerm_custom_firewall', name: 'fw_hub', label: 'fw_hub', hasSource: true }],
		edges: [],
		diagnostics: [],
	};
	const { architecture } = projectGraphSnapshotToArchitecture(snapshot);
	const fw = architecture.resources[0];

	// Without live schema: primitive-only warning is emitted.
	const withoutLive = architectureDiagnostics(architecture);
	assert.equal(withoutLive.some(d => d.message.includes('complete nested schema is unavailable')), true);

	// With live Rust schema: warning is cleared, live required fields & required nested block are enforced!
	const liveSchemas = { azurerm_custom_firewall: SAMPLE_LIVE_SCHEMA };
	assert.equal(editableFields(fw, liveSchemas).some(f => f.name === 'sku_tier'), true);
	assert.equal(additionalBlocks(fw, liveSchemas).some(b => b.type === 'ip_configuration' && b.required), true);

	const withLive = architectureDiagnostics(architecture, liveSchemas);
	assert.equal(withLive.some(d => d.message.includes('complete nested schema is unavailable')), false);
	assert.equal(withLive.some(d => d.path === 'sku_tier' && d.severity === 'error'), true);
	assert.equal(withLive.some(d => d.path === 'ip_configuration' && d.severity === 'error'), true);
});

test('source summaries suggest visual nesting, preserve reference evidence without guessed bindings, and retain positions on refresh', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-azure',
		architectureName: 'Azure Landing Zone',
		sourceRevision: '1'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'rg-1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_hub', label: 'rg_hub', hasSource: true },
			{ id: 'vnet-1', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet_hub', label: 'vnet_hub', hasSource: true },
			{ id: 'snet-1', kind: 'resource', resourceType: 'azurerm_subnet', name: 'snet_app', label: 'snet_app', hasSource: true },
			{ id: 'nic-1', kind: 'resource', resourceType: 'azurerm_network_interface', name: 'nic_app', label: 'nic_app', hasSource: true },
			{ id: 'vm-1', kind: 'resource', resourceType: 'azurerm_linux_virtual_machine', name: 'vm_app', label: 'vm_app', hasSource: true },
			{ id: 'fw-1', kind: 'resource', resourceType: 'azurerm_custom_firewall', name: 'fw_hub', label: 'fw_hub', hasSource: true },
			{ id: 'mod-1', kind: 'module', resourceType: null, name: 'monitoring', label: './modules/monitoring', hasSource: true },
		],
		edges: [
			{ fromId: 'vnet-1', toId: 'rg-1', kind: 'reference' },
			{ fromId: 'snet-1', toId: 'vnet-1', kind: 'reference' },
			{ fromId: 'nic-1', toId: 'snet-1', kind: 'reference' },
			{ fromId: 'nic-1', toId: 'rg-1', kind: 'reference' },
			{ fromId: 'vm-1', toId: 'snet-1', kind: 'reference' },
			{ fromId: 'vm-1', toId: 'nic-1', kind: 'reference' },
			{ fromId: 'fw-1', toId: 'rg-1', kind: 'reference' },
		],
		diagnostics: [],
	};

	const first = projectGraphSnapshotToArchitecture(snapshot);
	const byId = new Map(first.architecture.resources.map(r => [r.id, r]));

	assert.equal(first.hasSourceById['vm-1'], true);
	assert.equal(byId.get('rg-1')?.parentId, undefined);
	assert.equal(byId.get('vnet-1')?.visualParentId, 'rg-1');
	assert.equal(byId.get('vnet-1')?.parentId, undefined, 'a summary edge does not prove an inheritance field');
	assert.equal(byId.get('snet-1')?.visualParentId, 'vnet-1');
	assert.equal(byId.get('snet-1')?.parentId, undefined, 'a summary edge does not prove an inheritance field');
	// Most specific container (Subnet) wins over broader container (Resource Group)!
	assert.equal(byId.get('nic-1')?.visualParentId, 'snet-1');
	assert.equal(byId.get('nic-1')?.parentId, undefined, 'a summary edge does not prove an inheritance field');
	assert.equal(byId.get('vm-1')?.visualParentId, 'snet-1');
	assert.equal(byId.get('vm-1')?.parentId, undefined, 'a summary edge does not prove an inheritance field');
	assert.equal(byId.get('fw-1')?.visualParentId, 'rg-1');
	assert.equal(byId.get('fw-1')?.parentId, undefined, 'a summary edge does not prove an inheritance field');
	assert.equal(byId.get('mod-1')?.kind, 'module');

	// Sibling firewall must not overlap the expanded VNet container!
	const vnet = byId.get('vnet-1')!;
	const fw = byId.get('fw-1')!;
	const vnetRight = vnet.positions.visual.x + (vnet.containerSize?.width ?? 0);
	const vnetBottom = vnet.positions.visual.y + (vnet.containerSize?.height ?? 0);
	assert.equal(fw.positions.visual.x >= vnetRight || fw.positions.visual.y >= vnetBottom, true, 'Sibling firewall must not overlap expanded VNet container');

	// The source edge remains a reference. A typed VM NIC binding needs actual field evidence.
	const vm = byId.get('vm-1')!;
	const refs = explicitResourceReferences(first.architecture, vm);
	assert.equal(refs.length, 0);
	assert.ok(first.architecture.connections.some(link => link.origin?.edgeKind === 'reference'));
	const deps = inheritedDependencies(first.architecture);
	assert.equal(deps.length, 0, 'no guessed inheritance or field references');
	const vmHcl = terraformCode(first.architecture, 'vm-1');
	assert.doesNotMatch(vmHcl, /azurerm_network_interface\.nic_app\.id/);

	// User moves vm-1; refreshing at a new sourceRevision preserves its custom position!
	const moved = {
		...first.architecture,
		resources: first.architecture.resources.map(r => r.id === 'vm-1' ? { ...r, positions: { visual: { x: 999, y: 777 }, technical: { x: 999, y: 777 } } } : r),
	};
	const refreshed = projectGraphSnapshotToArchitecture(
		{ ...snapshot, sourceRevision: '2'.repeat(64) },
		{ previousArchitecture: moved }
	);
	const refreshedVm = refreshed.architecture.resources.find(r => r.id === 'vm-1')!;
	assert.deepEqual(refreshedVm.positions.visual, { x: 999, y: 777 });

	// Guarded draft save payload produces valid `.tf` filename + generated HCL.
	const payload = buildDraftSavePayload(refreshed.architecture);
	assert.equal(payload.fileName, 'azure-landing-zone.tf');
	assert.match(payload.contents, /resource "azurerm_linux_virtual_machine" "vm_app"/);
});

test('projectHostDiagnostics unifies graph, Rust validation, and CLI validate -json findings with address resolution', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Net',
		sourceRevision: '3'.repeat(64),
		status: 'partial',
		nodes: [
			{ id: 'vnet-1', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'hub', label: 'hub', hasSource: true },
		],
		edges: [],
		diagnostics: [{ code: 'CF_PARTIAL', severity: 'warning', message: 'Dynamic block skipped' }],
	};
	const { architecture } = projectGraphSnapshotToArchitecture(snapshot);

	const run: HostValidationRun = {
		runId: 'run-1',
		scope: 'architecture',
		targetNodeId: null,
		capturedRevision: '3'.repeat(64),
		stale: false,
		outcome: 'completed_with_warnings',
		coverage: 'partial',
		coverageNotes: [],
		nodeResults: {
			'vnet-1': {
				nodeId: 'vnet-1',
				status: 'warning',
				blockedBy: [],
				schemaCovered: true,
				findings: [{ id: 'f-1', nodeId: 'vnet-1', code: 'CF_CIDR', severity: 'warning', message: 'CIDR range is broad', remediation: 'Use a /16 or smaller block' }],
			},
		},
	};

	const cliReport: HostEngineValidateReport = {
		sourceRevision: '3'.repeat(64),
		engine: 'openTofu',
		engineVersion: '1.9.1',
		engineInferred: false,
		valid: false,
		errorCount: 1,
		warningCount: 0,
		durationMs: 142,
		diagnostics: [{ severity: 'error', summary: 'Missing required argument', detail: 'address_space is required', address: 'azurerm_virtual_network.hub', filename: 'main.tf', line: 12 }],
		truncated: false,
	};

	const diags = projectHostDiagnostics(architecture, snapshot, run, cliReport);
	assert.equal(diags.length, 3);
	assert.equal(diags.find(d => d.source === 'graph')?.code, 'CF_PARTIAL');
	assert.equal(diags.find(d => d.source === 'validation')?.remediation, 'Use a /16 or smaller block');
	const cli = diags.find(d => d.source === 'cli');
	assert.equal(cli?.resourceId, 'vnet-1');
	assert.equal(cli?.severity, 'error');
	assert.match(cli?.message ?? '', /Missing required argument/);
	assert.deepEqual(cli?.location, { fileName: 'main.tf', line: 12 });
	assert.ok(diags.every(d => d.sourceRevision === '3'.repeat(64)));
	assert.equal(diags.some(d => isStaleDiagnostic(d, architecture, '3'.repeat(64))), false);
	assert.equal(isStaleDiagnostic(cli!, architecture, '9'.repeat(64)), true, 'a newer source revision makes host findings stale');
	const validation = diags.find(d => d.source === 'validation')!;
	assert.equal(isStaleDiagnostic({ ...validation, resourceId: 'deleted-node' }, architecture, '3'.repeat(64)), true, 'a deleted target makes the finding stale');
});

test('historyReducer replace resets undo/redo history cleanly for live workspace loads', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Initial',
		sourceRevision: '4'.repeat(64),
		status: 'complete',
		nodes: [{ id: 'rg-1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_one', label: 'rg_one', hasSource: true }],
		edges: [],
		diagnostics: [],
	};
	const { architecture } = projectGraphSnapshotToArchitecture(snapshot);
	let h = createHistory(architecture);
	h = historyReducer(h, { type: 'renameArchitecture', name: 'Edited' });
	assert.equal(h.past.length, 1);

	h = historyReducer(h, { type: 'replace', architecture });
	assert.equal(h.past.length, 0);
	assert.equal(h.future.length, 0);
	assert.equal(h.present.name, 'Initial');
});

test('buildHostViewState serializes positions, mode, theme, selection, and viewports cleanly', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-1',
		architectureName: 'Persist',
		sourceRevision: '5'.repeat(64),
		status: 'complete',
		nodes: [{ id: 'rg-1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_one', label: 'rg_one', hasSource: true }],
		edges: [],
		diagnostics: [],
	};
	const { architecture } = projectGraphSnapshotToArchitecture(snapshot);
	const state = buildHostViewState({
		architecture,
		mode: 'technical',
		theme: 'dark',
		selectedId: 'rg-1',
		focusedWorkspaceOpen: true,
		inspectorOpen: true,
		libraryOpen: false,
		viewports: { technical: { x: 10, y: 20, zoom: 1.25 }, visual: { x: 0, y: 0, zoom: 99 } },
	});
	assert.equal(state.mode, 'technical');
	assert.equal(state.theme, 'dark');
	assert.equal(state.selectedId, 'rg-1');
	assert.equal(state.focusedWorkspaceOpen, true);
	assert.equal(state.inspectorOpen, true);
	assert.equal(state.listOpen, false);
	assert.deepEqual(state.viewports.technical, { x: 10, y: 20, zoom: 1.25 });
	assert.equal(state.viewports.visual, undefined, 'out-of-bounds zoom must be omitted');
	assert.equal(typeof state.nodePositions.visual?.['rg-1']?.x, 'number');
});

test('resolveProviderRegions merges live Rust Stage 6 cloudRegions with fallback defaults', () => {
	const azurePayload: HostCloudRegionsPayload = {
		provider: 'azure',
		source: 'authenticatedScopeApi',
		refreshedAt: '2026-11-25T12:00:00Z',
		stale: false,
		isFallback: false,
		regions: [
			{ name: 'swedencentral', displayName: 'Sweden Central', availabilityZones: ['1', '2', '3'] },
			{ name: 'uksouth', displayName: 'UK South', availabilityZones: ['1', '2', '3'] },
		],
	};
	const regions = resolveProviderRegions('azure', { azure: azurePayload });
	assert.equal(regions[0], 'Sweden Central');
	assert.equal(regions.includes('UK South'), true);
	assert.equal(regions.filter(r => r === 'UK South').length, 1, 'no duplicate regions');
	assert.equal(regions.includes('West Europe'), true, 'fallback regions preserved');

	const gcpFallback = resolveProviderRegions('gcp', { azure: azurePayload });
	assert.equal(gcpFallback.includes('europe-west2'), true);
});

test('multi-file Terraform projects preserve per-resource sourceFile and scope guarded draft save to the corresponding .tf file', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-multi',
		architectureName: 'Multi File Project',
		sourceRevision: '6'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'rg-1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_hub', label: 'rg_hub', hasSource: true, sourceFile: 'main.tf', sourceLine: 1 },
			{ id: 'vnet-1', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet_hub', label: 'vnet_hub', hasSource: true, sourceFile: 'network.tf', sourceLine: 4 },
			{ id: 'vm-1', kind: 'resource', resourceType: 'azurerm_linux_virtual_machine', name: 'vm_app', label: 'vm_app', hasSource: true, sourceFile: 'compute.tf', sourceLine: 10 },
		],
		edges: [
			{ fromId: 'vnet-1', toId: 'rg-1', kind: 'reference' },
			{ fromId: 'vm-1', toId: 'rg-1', kind: 'reference' },
		],
		diagnostics: [],
	};
	const projected = projectGraphSnapshotToArchitecture(snapshot).architecture;
	// This test configures inheritance explicitly, as the form does. A summary reference alone
	// no longer invents a resource_group_name binding.
	const architecture = historyReducer(createHistory(projected), { type: 'placeResource', id: 'vnet-1', parentId: 'rg-1', mode: 'visual' }).present;
	assert.deepEqual(projectResourceFiles(architecture), ['main.tf', 'compute.tf', 'network.tf']);
	assert.equal(architecture.resources.find(r => r.id === 'vnet-1')?.sourceFile, 'network.tf');
	assert.equal(architecture.resources.find(r => r.id === 'vnet-1')?.sourceLine, 4);

	// Selecting vnet-1 defaults Save to network.tf and emits ONLY network.tf resources (preserving cross-file rg_hub reference)!
	assert.equal(defaultTargetTfFile(architecture, 'vnet-1'), 'network.tf');
	const networkPayload = buildDraftSavePayload(architecture, undefined, 'vnet-1');
	assert.equal(networkPayload.fileName, 'network.tf');
	assert.match(networkPayload.contents, /resource "azurerm_virtual_network" "vnet_hub"/);
	assert.match(networkPayload.contents, /azurerm_resource_group\.rg_hub\.name/);
	assert.doesNotMatch(networkPayload.contents, /resource "azurerm_linux_virtual_machine" "vm_app"/);

	// Selecting compute.tf emits ONLY vm_app!
	const computePayload = buildDraftSavePayload(architecture, 'compute.tf');
	assert.equal(computePayload.fileName, 'compute.tf');
	assert.match(computePayload.contents, /resource "azurerm_linux_virtual_machine" "vm_app"/);
	assert.doesNotMatch(computePayload.contents, /resource "azurerm_virtual_network" "vnet_hub"/);
});

test('focused save summary says what changes and what is kept', () => {
	assert.deepEqual(describeMerge({ updated: ['aws_vpc.main'], added: ['aws_subnet.a'], removed: [], unchanged: 1, preserved: 2, skipped: [] }), [
		'Updates aws_vpc.main',
		'Adds aws_subnet.a',
		'Keeps 3 other blocks exactly as written',
		'Comments and fields the canvas does not show are kept',
	]);
	assert.ok(describeMerge({ updated: [], added: [], removed: [], unchanged: 0, preserved: 0, skipped: [], renamed: [{ from: 'a.b', to: 'a.c' }] }).includes('Renames a.b to a.c and adds a moved block'));
	assert.deepEqual(describeMerge({ updated: [], added: [], removed: [], unchanged: 1, preserved: 0, skipped: ['a.b'] }), [
		'No changes to write',
		'Keeps 1 other block exactly as written',
		'Comments and fields the canvas does not show are kept',
		'Left alone because the address appears twice: a.b',
	]);
});

test('resource drafts for the Rust schema check keep literals and turn references into expressions', () => {
	const architecture = schemaSample();
	const schema = { kind: 'resource' as const, typeName: 'azurerm_virtual_network', providerSource: 'registry.terraform.io/hashicorp/azurerm', providerVersion: '4.0.0', description: '', docsUrl: '', exampleHcl: '', attributes: [], blocks: [], outputs: [] };
	const draft = buildResourceDraft(architecture, 'network', schema);
	assert.equal(draft?.typeName, 'azurerm_virtual_network');
	assert.deepEqual(draft?.body.attributes.address_space, { kind: 'literal', value: ['10.20.0.0/16'] });
	assert.deepEqual(draft?.body.attributes.location, { kind: 'expression', text: 'azurerm_resource_group.rg-production.location' });
	assert.equal(buildResourceDraft(architecture, 'network', { ...schema, typeName: 'azurerm_subnet' }), undefined);
	assert.equal(buildResourceDraft(architecture, 'network', undefined), undefined);

	const preview = parseSchemaPreview({ resourceId: 'network', hcl: 'resource "x" "y" {}\n', diagnostics: [{ path: 'location', message: 'Required', severity: 'error' }, { path: 1 }], hasErrors: false, providerVersion: '4.0.0' });
	assert.equal(preview?.hasErrors, true);
	assert.equal(preview?.diagnostics.length, 1);
	assert.equal(parseSchemaPreview({ resourceId: 'network', hcl: 3, diagnostics: [] }), undefined);
});

test('focused saves remove only blocks deleted or renamed on the canvas', () => {
	const architecture = schemaSample();
	const keep = architecture.resources.find(resource => resource.id === 'network')!;
	const node = (id: string, kind: string, resourceType: string | null, name: string, sourceFile = 'main.tf') => ({ id, kind, resourceType, name, label: name, hasSource: true, sourceFile });
	const snapshot = {
		workspaceId: 'w', architectureId: 'a', architectureName: 'a', sourceRevision: 'f'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [],
		nodes: [
			node('network', 'resource', 'azurerm_virtual_network', keep.terraformName ?? keep.name),
			node('gone', 'resource', 'azurerm_subnet', 'old'),
			node('gone-data', 'data', 'azurerm_client_config', 'current'),
			node('gone-module', 'module', null, 'net'),
			node('other-file', 'resource', 'azurerm_subnet', 'x', 'other.tf'),
		],
	};
	assert.deepEqual(sourceChanges(architecture, snapshot, 'main.tf'), { removeAddresses: ['azurerm_subnet.old', 'data.azurerm_client_config.current', 'module.net'], renames: [] });
	const renamed = { ...architecture, resources: architecture.resources.map(resource => resource.id === 'network' ? { ...resource, terraformName: 'hub' } : resource) };
	assert.deepEqual(sourceChanges(renamed, snapshot, 'main.tf').renames, [{ from: 'azurerm_virtual_network.' + (keep.terraformName ?? keep.name), to: 'azurerm_virtual_network.hub' }]);
	assert.deepEqual(sourceChanges(architecture, null, 'main.tf'), { removeAddresses: [], renames: [] });
});

test('save payloads carry the load-time canvas text so the service applies only canvas edits', () => {
	const baseline = schemaSample();
	const edited = { ...baseline, resources: baseline.resources.map(resource => resource.id === 'network' ? { ...resource, name: resource.name + '-x' } : resource) };
	const payload = buildDraftSavePayload(edited, 'main.tf', 'network', null, baseline);
	assert.equal(typeof payload.baseContents, 'string');
	assert.notEqual(payload.baseContents, payload.contents);
	assert.equal(buildDraftSavePayload(baseline, 'main.tf', 'network', null, baseline).baseContents, undefined);
});

test('save all sends only the files the canvas changed, including a file emptied by a move', () => {
	const baseline = schemaSample();
	const files = projectResourceFiles(baseline);
	assert.deepEqual(changedFilePayloads(baseline, null, baseline), []);
	assert.deepEqual(changedFilePayloads(baseline, null, null), []);
	const renamedVnet = { ...baseline, resources: baseline.resources.map(resource => resource.id === 'network' ? { ...resource, name: resource.name + '-x' } : resource) };
	const one = changedFilePayloads(renamedVnet, null, baseline);
	assert.equal(one.length, 1);
	assert.equal(one[0].fileName, files.length === 1 ? 'main.tf' : one[0].fileName);
	assert.notEqual(one[0].contents, one[0].baseContents);
	const moved = { ...baseline, resources: baseline.resources.map(resource => resource.id === 'network' ? { ...resource, sourceFile: 'network.tf' } : resource) };
	const both = changedFilePayloads(moved, null, baseline);
	assert.deepEqual(both.map(payload => payload.fileName).sort(), ['main.tf', 'network.tf'].sort());
	const added = both.find(payload => payload.fileName === 'network.tf')!;
	assert.equal(added.baseContents, '');
	assert.match(added.contents, /azurerm_virtual_network/);
});

test('the canvas takes literal values from the files and keeps its own for expressions and secrets', () => {
	const architecture = schemaSample();
	const network = architecture.resources.find(resource => resource.id === 'network')!;
	const name = network.terraformName ?? network.name;
	const snapshot = {
		workspaceId: 'w', architectureId: 'a', architectureName: 'a', sourceRevision: 'f'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [],
		nodes: [{ id: 'network', kind: 'resource', resourceType: 'azurerm_virtual_network', name, label: name, hasSource: true, sourceFile: 'main.tf' }],
	};
	const parsed = parseResourceValues({
		sourceRevision: 'f'.repeat(64),
		resources: [{
			address: 'azurerm_virtual_network.' + name, file: 'main.tf',
			attributes: { name: { kind: 'literal', value: 'vnet-from-file' }, location: { kind: 'literal', value: 'westeurope' }, address_space: { kind: 'expression', text: 'var.space' }, secret: { kind: 'redacted' } },
			blocks: [],
		}, { bad: true }],
	});
	assert.equal(parsed?.resources.length, 1);
	const hydrated = hydrateResourceValues(architecture, snapshot, parsed!.resources);
	const next = hydrated.resources.find(resource => resource.id === 'network')!;
	assert.equal(next.name, 'vnet-from-file');
	assert.equal(next.region, 'West Europe');
	assert.deepEqual(next.settings, network.settings);
	assert.equal(hydrateResourceValues(architecture, snapshot, []), architecture);
	assert.equal(parseResourceValues({ resources: [] }), undefined);
});

test('variables declared in the files become canvas variables and var. fields become bindings', () => {
	const architecture = { ...schemaSample(), variables: [] };
	const network = architecture.resources.find(resource => resource.id === 'network')!;
	const name = network.terraformName ?? network.name;
	const snapshot = {
		workspaceId: 'w', architectureId: 'a', architectureName: 'a', sourceRevision: 'f'.repeat(64), status: 'complete' as const, edges: [], diagnostics: [],
		nodes: [{ id: 'network', kind: 'resource', resourceType: 'azurerm_virtual_network', name, label: name, hasSource: true, sourceFile: 'main.tf' }],
	};
	const parsed = parseResourceValues({
		sourceRevision: 'f'.repeat(64),
		resources: [{ address: 'azurerm_virtual_network.' + name, file: 'main.tf', attributes: { address_space: { kind: 'expression', text: 'var.space' } }, blocks: [] }],
		variables: [
			{ name: 'space', file: 'variables.tf', type: 'list(string)', description: 'Ranges', sensitive: false, default: { kind: 'literal', value: ['10.0.0.0/16'] } },
			{ name: 'key', file: 'variables.tf', sensitive: true, default: { kind: 'redacted' } },
			{ name: '../bad', file: 'variables.tf', sensitive: false },
		],
	})!;
	assert.equal(parsed.variables.length, 2);
	const hydrated = hydrateResourceValues(architecture, snapshot, parsed.resources, parsed.variables);
	assert.deepEqual(hydrated.variables?.map(item => [item.name, item.type, item.sensitive, item.defaultValue]), [['space', 'list(string)', false, ['10.0.0.0/16']], ['key', 'string', true, undefined]]);
	assert.match(codeFor(hydrated, 'network'), /address_space\s*=\s*var\.space/);
});

test('a refresh is projected from the file baseline plus resources that exist only on the canvas', () => {
	const baseline = schemaSample();
	const added = { ...baseline.resources[0], id: 'canvas-only', name: 'canvas-only' };
	const edited = { ...baseline, resources: [...baseline.resources.map(resource => ({ ...resource, name: resource.name + '-edited' })), added] };
	const previous = refreshPrevious(baseline, edited);
	assert.equal(previous.resources.length, baseline.resources.length + 1);
	assert.equal(previous.resources[0].name, baseline.resources[0].name, 'file baseline wins for known resources');
	assert.equal(previous.resources.at(-1)?.id, 'canvas-only');
	assert.equal(refreshPrevious(null, edited), edited);
});

test('after a save the saved files take the canvas version in the next baseline', () => {
	const baseline = schemaSample();
	const target = baseline.resources[0];
	const saved = { ...baseline, resources: baseline.resources.map(resource => resource.id === target.id ? { ...resource, name: 'saved-name' } : resource) };
	const file = projectResourceFiles(baseline)[0];
	assert.equal(adoptSavedFiles(baseline, saved, new Set([file])).resources.find(resource => resource.id === target.id)?.name, 'saved-name');
	assert.equal(adoptSavedFiles(baseline, saved, new Set(['other.tf'])).resources.find(resource => resource.id === target.id)?.name, target.name);
	const deleted = { ...baseline, resources: baseline.resources.filter(resource => resource.id !== target.id) };
	assert.equal(adoptSavedFiles(baseline, deleted, new Set([file])).resources.some(resource => resource.id === target.id), false);
});

test('hosted snapshot icon projection never double-prefixes catalog-icons paths', () => {
	const projected = projectGraphSnapshotToArchitecture({
		workspaceId: 'ws-icon',
		architectureId: 'arch-icon',
		architectureName: 'IconCheck',
		sourceRevision: 'a'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'kv-1', kind: 'resource', resourceType: 'azurerm_key_vault', name: 'kvmain', label: 'kvmain', hasSource: true },
		],
		edges: [],
		diagnostics: [],
	});
	const kv = projected.architecture.resources.find(r => r.id === 'kv-1');
	assert.ok(kv?.catalogue?.icon);
	assert.doesNotMatch(kv.catalogue.icon, /^catalog-icons\/catalog-icons\//);
});

test('opaque Rust node ID shifts after saving a newly added resource never cross-contaminate settings or break Terraform projection', () => {
	// Before save: 8 Azure resources assigned node-1..node-8 in BTreeMap alphabetical order.
	const beforeSnapshot: HostGraphSnapshot = {
		workspaceId: 'ws-1',
		architectureId: 'arch-test-1',
		architectureName: 'ArchitectureTest1',
		sourceRevision: '1'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'node-1', kind: 'resource', resourceType: 'azurerm_managed_disk', name: 'managed_disk_1', label: 'managed_disk_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-2', kind: 'resource', resourceType: 'azurerm_network_interface', name: 'network_interface_1', label: 'network_interface_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-3', kind: 'resource', resourceType: 'azurerm_network_interface', name: 'network_interface_2', label: 'network_interface_2', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-4', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'new-group-1', label: 'new-group-1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-5', kind: 'resource', resourceType: 'azurerm_subnet', name: 'snet-applications-54d6', label: 'snet-applications-54d6', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-6', kind: 'resource', resourceType: 'azurerm_subnet_network_security_group_association', name: 'assoc_1', label: 'assoc_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-7', kind: 'resource', resourceType: 'azurerm_virtual_machine', name: 'virtual_machine_1', label: 'virtual_machine_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-8', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet-production', label: 'vnet-production', hasSource: true, sourceFile: 'architecturetest1.tf' },
		],
		edges: [
			{ fromId: 'node-8', toId: 'node-4', kind: 'reference' },
			{ fromId: 'node-5', toId: 'node-8', kind: 'reference' },
			{ fromId: 'node-2', toId: 'node-5', kind: 'reference' },
			{ fromId: 'node-7', toId: 'node-2', kind: 'reference' },
		],
		diagnostics: [],
	};

	const initial = projectGraphSnapshotToArchitecture(beforeSnapshot);
	// User repositions the VM (leaf node-7 -> shifts to node-8) before adding an Application Load Balancer and saving.
	const movedBeforeSave = {
		...initial.architecture,
		resources: initial.architecture.resources.map(r => r.id === 'node-7'
			? { ...r, positions: { visual: { x: 444, y: 555 }, technical: { x: 444, y: 555 } } }
			: r),
	};

	// After save: azurerm_application_load_balancer sorts first -> EVERY existing node shifts by +1!
	// Critically, old node-8 (azurerm_virtual_network with 'Address space') shifts to node-9,
	// while azurerm_virtual_machine (generic catalogue resource) now occupies node-8!
	const afterSnapshot: HostGraphSnapshot = {
		...beforeSnapshot,
		sourceRevision: '64d0dd12'.padEnd(64, '0'),
		nodes: [
			{ id: 'node-1', kind: 'resource', resourceType: 'azurerm_application_load_balancer', name: 'application_load_balancer_1', label: 'application_load_balancer_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-2', kind: 'resource', resourceType: 'azurerm_managed_disk', name: 'managed_disk_1', label: 'managed_disk_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-3', kind: 'resource', resourceType: 'azurerm_network_interface', name: 'network_interface_1', label: 'network_interface_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-4', kind: 'resource', resourceType: 'azurerm_network_interface', name: 'network_interface_2', label: 'network_interface_2', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-5', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'new-group-1', label: 'new-group-1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-6', kind: 'resource', resourceType: 'azurerm_subnet', name: 'snet-applications-54d6', label: 'snet-applications-54d6', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-7', kind: 'resource', resourceType: 'azurerm_subnet_network_security_group_association', name: 'assoc_1', label: 'assoc_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-8', kind: 'resource', resourceType: 'azurerm_virtual_machine', name: 'virtual_machine_1', label: 'virtual_machine_1', hasSource: true, sourceFile: 'architecturetest1.tf' },
			{ id: 'node-9', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet-production', label: 'vnet-production', hasSource: true, sourceFile: 'architecturetest1.tf' },
		],
		edges: [
			{ fromId: 'node-1', toId: 'node-5', kind: 'reference' },
			{ fromId: 'node-9', toId: 'node-5', kind: 'reference' },
			{ fromId: 'node-6', toId: 'node-9', kind: 'reference' },
			{ fromId: 'node-3', toId: 'node-6', kind: 'reference' },
			{ fromId: 'node-8', toId: 'node-3', kind: 'reference' },
		],
	};

	const refreshed = projectGraphSnapshotToArchitecture(afterSnapshot, { previousArchitecture: movedBeforeSave });
	assert.equal(refreshed.idRemap['node-8'], 'node-9', 'VNet opaque ID shift is tracked');
	assert.equal(refreshed.idRemap['node-7'], 'node-8', 'VM opaque ID shift is tracked');
	assert.equal(refreshed.idRemap['node-5'], 'node-6', 'Subnet opaque ID shift is tracked');
	assert.equal(refreshed.idRemap['node-4'], 'node-5', 'RG opaque ID shift is tracked');

	const vm = refreshed.architecture.resources.find(r => r.id === 'node-8')!;
	const vnet = refreshed.architecture.resources.find(r => r.id === 'node-9')!;
	const subnet = refreshed.architecture.resources.find(r => r.id === 'node-6')!;
	assert.equal(vm.catalogue?.type, 'azurerm_virtual_machine');
	assert.equal(vm.settings['Address space'], undefined, 'VM must never inherit VNet display setting keys');
	assert.deepEqual(vm.positions.visual, { x: 444, y: 555 }, 'VM keeps its custom position across ID shift');
	assert.equal(vnet.visualParentId, 'node-5', 'VNet visualParentId remaps to new RG node ID');
	assert.equal(subnet.visualParentId, 'node-9', 'Subnet visualParentId remaps to new VNet node ID');

	// Hydrate Terraform expression attributes (which populate terraformExtras) and project HCL:
	// previously this threw an uncaught HclError inside CodePanel render and blanked Studio!
	const hydrated = hydrateResourceValues(refreshed.architecture, afterSnapshot, [
		{
			address: 'azurerm_application_load_balancer.application_load_balancer_1',
			file: 'architecturetest1.tf',
			attributes: { resource_group_name: { kind: 'expression', text: 'azurerm_resource_group.new-group-1.name' } },
			blocks: [],
		},
		{
			address: 'azurerm_virtual_machine.virtual_machine_1',
			file: 'architecturetest1.tf',
			attributes: { resource_group_name: { kind: 'expression', text: 'azurerm_resource_group.new-group-1.name' } },
			blocks: [],
		},
	]);
	const projectedHcl = terraformCode(hydrated);
	assert.match(projectedHcl, /resource "azurerm_virtual_machine" "virtual_machine_1"/);
	assert.match(projectedHcl, /resource "azurerm_virtual_network" "vnet-production"/);
	assert.doesNotMatch(projectedHcl, /"Address space"/);
});

test('terraformCode does not throw when a generic resource has a spaced setting key alongside terraformExtras', () => {
	const snapshot: HostGraphSnapshot = {
		workspaceId: 'ws-safe',
		architectureId: 'arch-safe',
		architectureName: 'SafeHcl',
		sourceRevision: 'c'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'node-1', kind: 'resource', resourceType: 'azurerm_virtual_machine', name: 'vm_1', label: 'vm_1', hasSource: true },
		],
		edges: [],
		diagnostics: [],
	};
	const { architecture } = projectGraphSnapshotToArchitecture(snapshot);
	const corrupted = {
		...architecture,
		resources: architecture.resources.map(r => ({
			...r,
			settings: { ...r.settings, 'Address space': '10.0.0.0/16' },
			terraformExtras: { attrs: { resource_group_name: { $expr: 'azurerm_resource_group.rg.name' } }, blocks: [] },
		})),
	};
	assert.doesNotThrow(() => terraformCode(corrupted));
	const hcl = terraformCode(corrupted);
	assert.match(hcl, /resource "azurerm_virtual_machine" "vm_1"/);
});
