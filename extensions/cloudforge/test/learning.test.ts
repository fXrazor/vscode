/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildExternalMcpConfigSnippet,
	buildLearningStudioHtml,
	parseIssuedMcpGrant,
	parseLearningRecord,
	parseLearningStudioMessage,
	parseMcpGrantsList,
	parseSkillsList,
	parseTopologyBlueprint,
	parseTopologyBlueprintList
} from '../src/learning/model.ts';

test('parses baked-in skills list and rejects malformed entries', () => {
	const parsed = parseSkillsList({
		count: 2,
		categories: ['cloudforge-diagram', 'terraform'],
		safetyNotice: 'Data-only guidance.',
		skills: [
			{
				id: 'cloudforge-diagram-authoring',
				category: 'cloudforge-diagram',
				repository: 'cloudforge/built-in',
				commit: 'd05224e000000000000000000000000000000000',
				version: '0.1.0',
				license: 'MIT',
				purpose: 'Author diagrams cleanly.',
				guidance: ['Use explicit HCL references.'],
				dataOnly: true
			},
			{
				id: 'bad-category',
				category: 'not-valid',
				repository: 'x',
				commit: 'y',
				license: 'MIT',
				purpose: 'Should be dropped.'
			}
		]
	});
	assert.ok(parsed);
	assert.equal(parsed.count, 1);
	assert.equal(parsed.skills[0].id, 'cloudforge-diagram-authoring');
	assert.equal(parsed.skills[0].dataOnly, true);
});

test('parses topology blueprint summaries and full multi-file blueprints', () => {
	const list = parseTopologyBlueprintList({
		blueprints: [
			{
				id: 'azure-hub-spoke',
				title: 'Azure Hub-and-Spoke Network',
				cloud: 'azure',
				technicalGraphPattern: 'azure-hub-spoke',
				summary: 'Hub and spoke VNets.',
				skillIds: ['cloudforge-topology-azure-hub-spoke'],
				fileNames: ['versions.tf', 'network.tf']
			}
		]
	});
	assert.ok(list);
	assert.equal(list.length, 1);
	assert.equal(list[0].technicalGraphPattern, 'azure-hub-spoke');

	const full = parseTopologyBlueprint({
		id: 'gcp-regional-lb',
		title: 'GCP Regional Load Balancer',
		cloud: 'gcp',
		technicalGraphPattern: 'gcp-load-balancer-chain',
		summary: '4-hop forwarding chain.',
		skillIds: ['cloudforge-topology-gcp-network'],
		files: [{ fileName: 'network.tf', rationale: 'VPC and LB chain', contents: 'resource "google_compute_network" "main" {}\n' }]
	});
	assert.ok(full);
	assert.equal(full.files.length, 1);
	assert.equal(parseTopologyBlueprint({ id: 'empty', title: 'Empty', cloud: 'aws', technicalGraphPattern: 'x', summary: 'y', files: [] }), undefined);
});

test('parses learning record with proposals, notes, and allowlisted https docs only', () => {
	const rec = parseLearningRecord({
		workspaceId: 'ws-1',
		architectureId: 'ws-1-arch-1',
		sourceRevision: 'a'.repeat(64),
		task: {
			title: 'Hub lab',
			mode: 'guided',
			objective: 'Build hub VNet',
			requirements: [{ id: 'req-1', text: 'Create hub VNet', status: 'open', linkedAddresses: ['azurerm_virtual_network.hub'] }],
			assumptions: ['Offline'],
			skillIds: ['cloudforge-diagram-authoring']
		},
		notes: {
			'azurerm_virtual_network.hub': {
				why: 'Central hub',
				docs: [
					{ label: 'Valid', url: 'https://learn.microsoft.com/en-us/azure/' },
					{ label: 'Unsafe', url: 'javascript:alert(1)' }
				]
			}
		},
		proposals: [
			{
				proposalId: 'prop-1',
				origin: 'mcp:vscode-agent',
				title: 'Add subnet',
				summary: 'Adds app subnet',
				baseSourceRevision: 'a'.repeat(64),
				skillIds: ['terraform-style-guide'],
				requirementIds: ['req-1'],
				files: [{ fileName: 'network.tf', contents: 'resource "azurerm_subnet" "app" {}\n' }],
				findings: [],
				status: 'pending',
				createdAt: '2026-11-26T18:00:00Z'
			}
		],
		availableSkills: []
	});
	assert.ok(rec);
	assert.equal(rec.task?.mode, 'guided');
	assert.equal(rec.notes['azurerm_virtual_network.hub'].docs.length, 1);
	assert.equal(rec.proposals.length, 1);
	assert.equal(rec.proposals[0].origin, 'mcp:vscode-agent');
});

test('formats Codex CLI TOML and Claude Code JSON MCP config snippets cleanly', () => {
	const grant = parseIssuedMcpGrant({
		grantId: 'cfmcp-secretgrant123',
		grantIdPreview: 'cfmcp-se…23',
		displayName: 'Contoso Hub',
		clientLabel: 'codex',
		readOnly: false,
		createdAt: '2026-11-26T18:00:00Z',
		expiresAtEpoch: 1999999999,
		active: true,
		revoked: false,
		mcpCommand: 'C:\\Program Files\\CloudForge\\cloudforge-service\\cloudforge-service.exe',
		mcpArgs: ['--mcp', '--grant', 'cfmcp-secretgrant123']
	});
	assert.ok(grant);

	const codexToml = buildExternalMcpConfigSnippet('codex', grant);
	assert.ok(codexToml.includes('[mcp_servers.cloudforge]'));
	assert.ok(codexToml.includes('C:\\\\Program Files\\\\CloudForge\\\\cloudforge-service\\\\cloudforge-service.exe'));
	assert.ok(codexToml.includes('"--grant", "cfmcp-secretgrant123"'));

	const claudeJson = JSON.parse(buildExternalMcpConfigSnippet('claude-code', grant)) as { mcpServers: { cloudforge: { command: string; args: string[] } } };
	assert.equal(claudeJson.mcpServers.cloudforge.command, grant.mcpCommand);
	assert.deepEqual(claudeJson.mcpServers.cloudforge.args, ['--mcp', '--grant', 'cfmcp-secretgrant123']);

	const listed = parseMcpGrantsList({
		grants: [{ grantIdPreview: 'cfmcp-se…23', displayName: 'Contoso Hub', clientLabel: 'codex', readOnly: false, createdAt: '2026-11-26T18:00:00Z', expiresAtEpoch: 1999999999, active: true, revoked: false }]
	});
	assert.ok(listed);
	assert.equal(listed.length, 1);
});

test('renders CSP-hardened Learning Studio HTML and escapes untrusted strings', () => {
	const html = buildLearningStudioHtml({
		architectureName: '<script>alert(1)</script>Hub',
		sourceRevision: 'b'.repeat(64),
		activeTab: 'proposals',
		skillCategoryFilter: 'all',
		record: {
			workspaceId: 'ws-1',
			architectureId: 'ws-1-arch-1',
			sourceRevision: 'b'.repeat(64),
			notes: {},
			availableSkills: [],
			proposals: [{
				proposalId: 'prop-1',
				origin: 'mcp:codex',
				title: '<b>Injected</b>',
				summary: 'Safe summary',
				baseSourceRevision: 'b'.repeat(64),
				skillIds: [],
				requirementIds: [],
				files: [{ fileName: 'main.tf', contents: 'resource "x" "y" { a = "</script>" }\n' }],
				findings: [],
				status: 'pending',
				createdAt: '2026-11-26T18:00:00Z'
			}]
		},
		skills: [],
		blueprints: [],
		grants: [],
		vscodeAgentEnabled: true
	}, 'testnonce123');

	assert.ok(html.includes(`default-src 'none'; style-src 'nonce-testnonce123'; script-src 'nonce-testnonce123';`));
	assert.ok(!html.includes('<script>alert(1)</script>'));
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;Hub'));
	assert.ok(html.includes('&lt;b&gt;Injected&lt;/b&gt;'));
	assert.ok(!html.includes('onclick='));
});

test('validates webview studio messages and rejects unknown or malformed actions', () => {
	assert.deepEqual(parseLearningStudioMessage({ type: 'switchTab', tab: 'skills' }), { type: 'switchTab', tab: 'skills' });
	assert.equal(parseLearningStudioMessage({ type: 'switchTab', tab: 'exec' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'proposeBlueprint', blueprintId: 'azure-hub-spoke' }), { type: 'proposeBlueprint', blueprintId: 'azure-hub-spoke' });
	assert.equal(parseLearningStudioMessage({ type: 'proposeBlueprint', blueprintId: '../escape' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'copyMcpConfig', client: 'codex' }), { type: 'copyMcpConfig', client: 'codex' });
	assert.equal(parseLearningStudioMessage({ type: 'copyMcpConfig', client: 'evil' }), undefined);
	assert.equal(parseLearningStudioMessage({ type: 'unknown' }), undefined);
});
