/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildArchitectureStudyGuideMarkdown,
	buildExternalMcpConfigSnippet,
	buildLearningStudioHtml,
	formatLearningNoteHoverMarkdown,
	isAllowlistedDocUrl,
	parseChatTopologyArgs,
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
	assert.deepEqual(parseLearningStudioMessage({ type: 'switchTab', tab: 'task' }), { type: 'switchTab', tab: 'task' });
	assert.equal(parseLearningStudioMessage({ type: 'switchTab', tab: 'exec' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'proposeBlueprint', blueprintId: 'azure-hub-spoke', prefix: 'prod-uk', region: 'westeurope', cidrBaseOctet: '20' }), {
		type: 'proposeBlueprint',
		blueprintId: 'azure-hub-spoke',
		prefix: 'prod-uk',
		region: 'westeurope',
		cidrBaseOctet: 20
	});
	assert.equal(parseLearningStudioMessage({ type: 'proposeBlueprint', blueprintId: '../escape' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'saveTask', title: 'Hub lab', mode: 'guided', objective: 'Build hub', newRequirement: 'Add NSG' }), {
		type: 'saveTask',
		title: 'Hub lab',
		mode: 'guided',
		objective: 'Build hub',
		newRequirement: 'Add NSG'
	});
	assert.equal(parseLearningStudioMessage({ type: 'saveTask', title: 'Bad', mode: 'auto', objective: '' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'toggleRequirement', requirementId: 'req-1' }), { type: 'toggleRequirement', requirementId: 'req-1' });
	assert.deepEqual(parseLearningStudioMessage({ type: 'saveNote', address: 'azurerm_virtual_network.hub', why: 'Central hub', docLabel: 'Docs', docUrl: 'https://learn.microsoft.com/azure' }), {
		type: 'saveNote',
		address: 'azurerm_virtual_network.hub',
		why: 'Central hub',
		docLabel: 'Docs',
		docUrl: 'https://learn.microsoft.com/azure'
	});
	assert.equal(parseLearningStudioMessage({ type: 'saveNote', address: 'bad address with spaces' }), undefined);
	assert.deepEqual(parseLearningStudioMessage({ type: 'copyMcpConfig', client: 'codex' }), { type: 'copyMcpConfig', client: 'codex' });
	assert.equal(parseLearningStudioMessage({ type: 'copyMcpConfig', client: 'evil' }), undefined);
	assert.equal(parseLearningStudioMessage({ type: 'unknown' }), undefined);
});

test('parses @cloudforge /topology slash command arguments safely', () => {
	assert.deepEqual(parseChatTopologyArgs('aws-landing-zone prefix=edge-uk region=eu-west-2 cidr=30'), {
		blueprintQuery: 'aws-landing-zone',
		prefix: 'edge-uk',
		region: 'eu-west-2',
		cidrBaseOctet: 30
	});
	// Rejects invalid prefix, out-of-range octet, and preserves valid blueprint token.
	assert.deepEqual(parseChatTopologyArgs('azure-hub-spoke prefix=../bad cidr=999'), {
		blueprintQuery: 'azure-hub-spoke'
	});
});

test('renders Task & Notes tab with escaped task objective, checklist, and resource notes', () => {
	const html = buildLearningStudioHtml({
		architectureName: 'Hub Lab',
		sourceRevision: 'd'.repeat(64),
		activeTab: 'task',
		skillCategoryFilter: 'all',
		record: {
			workspaceId: 'ws-1',
			architectureId: 'ws-1-arch-1',
			sourceRevision: 'd'.repeat(64),
			task: {
				title: '<img src=x>Lab',
				mode: 'guided',
				objective: 'Deploy hub & spoke',
				requirements: [{ id: 'req-1', text: 'Create hub VNet', status: 'addressed', linkedAddresses: ['azurerm_virtual_network.hub'] }],
				assumptions: [],
				skillIds: []
			},
			notes: {
				'azurerm_virtual_network.hub': { why: 'Core transit VNet', docs: [] }
			},
			proposals: [],
			availableSkills: []
		},
		skills: [],
		blueprints: [],
		grants: [],
		vscodeAgentEnabled: true
	}, 'nonce999');

	assert.ok(html.includes('&lt;img src=x&gt;Lab'));
	assert.ok(html.includes('Create hub VNet'));
	assert.ok(html.includes('Core transit VNet'));
	assert.ok(html.includes('data-action="toggleRequirement"'));
});

test('validates diffProposalFile messages and formats in-editor learning note hover markdown', () => {
	assert.deepEqual(parseLearningStudioMessage({ type: 'diffProposalFile', proposalId: 'prop-1', fileName: 'network.tf' }), {
		type: 'diffProposalFile',
		proposalId: 'prop-1',
		fileName: 'network.tf'
	});
	assert.equal(parseLearningStudioMessage({ type: 'diffProposalFile', proposalId: 'prop-1', fileName: '../escape.tf' }), undefined);
	assert.equal(parseLearningStudioMessage({ type: 'diffProposalFile', proposalId: 'prop-1', fileName: 'secrets.tfvars' }), undefined);

	const hoverMd = formatLearningNoteHoverMarkdown(
		'azurerm_virtual_network.hub',
		{
			why: 'Central transit hub for peered spokes.',
			userNote: 'Keep /16 address space.',
			docs: [
				{ label: 'Azure VNet Docs', url: 'https://learn.microsoft.com/en-us/azure/virtual-network/' },
				{ label: 'Blocked Link', url: 'http://insecure.example.com' }
			]
		},
		[{ id: 'req-1', text: 'Provision hub VNet', status: 'addressed', linkedAddresses: ['azurerm_virtual_network.hub'] }]
	);
	assert.ok(hoverMd);
	assert.ok(hoverMd.includes('Central transit hub for peered spokes'));
	assert.ok(hoverMd.includes('✓ Provision hub VNet'));
	assert.ok(hoverMd.includes('[Azure VNet Docs](https://learn.microsoft.com/en-us/azure/virtual-network/)'));
	assert.ok(!hoverMd.includes('insecure.example.com'));
	assert.ok(hoverMd.includes('command:cloudforge.addResourceNote'));
	assert.equal(formatLearningNoteHoverMarkdown('azurerm_subnet.app', undefined, []), undefined);

	// Audit regression: prevents command-link injection inside trusted hover Markdown and non-allowlisted https hosts.
	const injected = formatLearningNoteHoverMarkdown(
		'azurerm_virtual_network.hub',
		{
			why: '[evil](command:cloudforge.addResourceNote)',
			docs: [{ label: 'Untrusted', url: 'https://evil.example.com/phish' }]
		},
		[]
	);
	assert.ok(injected);
	assert.ok(!injected.includes('[evil](command:'));
	assert.ok(!injected.includes('evil.example.com'));
	assert.equal(isAllowlistedDocUrl('https://learn.microsoft.com/azure'), true);
	assert.equal(isAllowlistedDocUrl('https://evil.example.com/azure'), false);
	assert.equal(isAllowlistedDocUrl('https://learn.microsoft.com/a)b'), false);
});

test('exports portable Architecture Study Guide Markdown with task, notes, topology, and proposals', () => {
	const md = buildArchitectureStudyGuideMarkdown({
		architectureName: 'Azure Hub Lab',
		sourceRevision: 'e'.repeat(64),
		nodes: [{ kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'azurerm_virtual_network.hub', label: 'hub' }],
		edgeCount: 2,
		record: {
			workspaceId: 'ws-1',
			architectureId: 'ws-1-arch-1',
			sourceRevision: 'e'.repeat(64),
			task: {
				title: 'Hub-and-Spoke Lab',
				mode: 'guided',
				objective: 'Build segmented Azure VNets.',
				requirements: [{ id: 'req-1', text: 'Create hub VNet', status: 'addressed', linkedAddresses: ['azurerm_virtual_network.hub'] }],
				assumptions: ['Offline learning only'],
				skillIds: ['cloudforge-diagram-authoring']
			},
			notes: {
				'azurerm_virtual_network.hub': {
					why: 'Central ingress/egress VNet.',
					docs: [
						{ label: 'Azure VNet Docs', url: 'https://learn.microsoft.com/en-us/azure/virtual-network/' },
						{ label: 'Untrusted', url: 'https://untrusted.example.com/' }
					]
				}
			},
			proposals: [{
				proposalId: 'prop-1',
				origin: 'mcp:vscode-agent',
				title: 'Add hub subnet',
				summary: 'Adds shared subnet.',
				baseSourceRevision: 'e'.repeat(64),
				skillIds: [],
				requirementIds: [],
				files: [{ fileName: 'network.tf', contents: '' }],
				findings: [],
				status: 'accepted',
				createdAt: '2026-11-26T19:00:00Z'
			}],
			availableSkills: []
		},
		skills: [{
			id: 'cloudforge-diagram-authoring',
			category: 'cloudforge-diagram',
			repository: 'cloudforge/built-in',
			commit: '0afc60b',
			license: 'MIT',
			purpose: 'Clean diagrams.',
			guidance: [],
			dataOnly: true
		}]
	});
	assert.ok(md.includes('# Azure Hub Lab — Architecture Study Guide'));
	assert.ok(md.includes('- [x] Create hub VNet — `azurerm_virtual_network.hub`'));
	assert.ok(md.includes('Central ingress/egress VNet.'));
	assert.ok(md.includes('[Azure VNet Docs](https://learn.microsoft.com/en-us/azure/virtual-network/)'));
	assert.ok(!md.includes('untrusted.example.com'));
	assert.ok(md.includes('**Add hub subnet** (`accepted`, origin `mcp:vscode-agent`)'));
	assert.ok(md.includes('`cloudforge-diagram-authoring`'));
	assert.deepEqual(parseLearningStudioMessage({ type: 'exportStudyGuide' }), { type: 'exportStudyGuide' });
});

test('validates AI Models & Auth studio messages and renders models tab', () => {
	assert.deepEqual(parseLearningStudioMessage({ type: 'switchTab', tab: 'models' }), { type: 'switchTab', tab: 'models' });
	assert.deepEqual(parseLearningStudioMessage({ type: 'connectAiProvider', providerId: 'github-models' }), { type: 'connectAiProvider', providerId: 'github-models' });
	assert.deepEqual(parseLearningStudioMessage({ type: 'scanLocalModels' }), { type: 'scanLocalModels' });
	assert.deepEqual(parseLearningStudioMessage({
		type: 'addCustomModel',
		id: 'qwen2.5-coder:14b',
		name: 'Qwen Local',
		baseUrl: 'http://127.0.0.1:11434/v1',
		apiFormat: 'openai',
		authKind: 'none',
		maxInputTokens: '65536',
		toolCalling: true
	}), {
		type: 'addCustomModel',
		id: 'qwen2.5-coder:14b',
		name: 'Qwen Local',
		providerId: 'custom-qwen2-5-coder-14b',
		baseUrl: 'http://127.0.0.1:11434/v1',
		apiFormat: 'openai',
		authKind: 'none',
		maxInputTokens: 65536,
		toolCalling: true
	});
	// Rejects plain HTTP remote URLs in custom model form.
	assert.equal(parseLearningStudioMessage({
		type: 'addCustomModel',
		id: 'remote-bad',
		baseUrl: 'http://api.example.com/v1',
		apiFormat: 'openai',
		authKind: 'apiKey'
	}), undefined);

	const html = buildLearningStudioHtml({
		activeTab: 'models',
		skillCategoryFilter: 'all',
		skills: [],
		blueprints: [],
		grants: [],
		vscodeAgentEnabled: true,
		lmProviderEnabled: true,
		aiProviders: [{
			id: 'github-models',
			name: 'GitHub Models',
			kind: 'cloud',
			baseUrl: 'https://models.inference.ai.azure.com',
			apiFormat: 'openai',
			authKind: 'githubOAuth',
			enabled: true,
			connected: false,
			authDetail: 'Not signed in',
			modelCount: 0,
			description: 'One-click GitHub OAuth'
		}],
		customModels: [{
			id: 'qwen2.5-coder:14b',
			name: 'Qwen Local',
			providerId: 'ollama',
			baseUrl: 'http://127.0.0.1:11434/v1',
			maxInputTokens: 65536,
			maxOutputTokens: 8192,
			toolCalling: true
		}]
	}, 'nonce-ai');
	assert.ok(html.includes('Sign in with GitHub'));
	assert.ok(html.includes('Scan Ollama &amp; LM Studio'));
	assert.ok(html.includes('Qwen Local'));
	assert.ok(html.includes('id="custom-model-form"'));
});
