/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTemplateClient, describeProviderFit, parseTemplateCompatibility, parseTemplateDetails, parseTemplateImport,
	parseTemplateList, parseTemplateSummary, templateErrorMessage, type ServiceCall
} from '../src/templates/model.ts';

const AZ = 'registry.terraform.io/hashicorp/azurerm';

// Shapes as `service/src/templates/service.rs` serializes them.
const summary = {
	id: 'cloudforge.azure.hub-spoke', name: 'Azure hub and spoke', version: '1.0.0', summary: 'Hub VNet with two peered spokes.',
	templateType: 'architecture', providers: ['azure'], categories: ['networking'], difficulty: 'intermediate',
	certifications: ['az-104'], tags: ['hub-spoke'], lifecycle: 'experimental', publisher: 'CloudForge', license: 'MIT',
	resourceCount: 9, compatibility: { [AZ]: '~> 4.0' }, source: 'builtin', trust: 'official', availability: 'downloaded',
	hasLayout: true, hasParameters: false, highRiskFindings: 0
};

const page = {
	templates: [summary, { ...summary, id: 'BAD ID' }],
	total: 2, offset: 0,
	facets: { providers: { azure: 2 }, difficulties: { intermediate: 2 }, unknownFacet: { x: 1 } },
	sources: [
		{ id: 'builtin', name: 'Built-in', trust: 'official', templateCount: 12, offline: true, removable: false },
		{ id: 'local', name: 'Imported', trust: 'local', templateCount: 0, offline: true, removable: true }
	]
};

test('parses a listTemplates page and drops malformed templates', () => {
	const parsed = parseTemplateList(page);
	assert.ok(parsed);
	assert.equal(parsed.templates.length, 1);
	assert.equal(parsed.templates[0].compatibility[AZ], '~> 4.0');
	assert.deepEqual(parsed.facets.providers, { azure: 2 });
	assert.equal('unknownFacet' in parsed.facets, false);
	assert.equal(parsed.sources[1].removable, true);
	assert.equal(parseTemplateList({ ...page, sources: 'x' }), undefined);
	assert.equal(parseTemplateList({ ...page, templates: 'x' }), undefined);
});

test('refuses summaries with unknown enums or bad versions', () => {
	assert.ok(parseTemplateSummary(summary));
	assert.equal(parseTemplateSummary({ ...summary, difficulty: 'expert' }), undefined);
	assert.equal(parseTemplateSummary({ ...summary, version: 'latest' }), undefined);
	assert.equal(parseTemplateSummary({ ...summary, trust: 'root' }), undefined);
	assert.equal(parseTemplateSummary({ ...summary, compatibility: { [AZ]: 4 } }), undefined);
	assert.equal(parseTemplateSummary({ ...summary, id: '../x' }), undefined);
});

const details = {
	summary, manifest: {}, archiveSha256: 'a'.repeat(64), readme: '# Hub and spoke',
	terraformFiles: [{ fileName: 'versions.tf', contents: 'terraform {}' }, { fileName: 'main.tf', contents: '' }],
	addresses: ['azurerm_resource_group.hub'], variables: ['location'], layout: { nodes: {} }, parameters: null,
	problems: [{ code: 'LICENSE_MISSING', severity: 'warning', message: 'No licence file.' }],
	findings: [{ code: 'MODULE_REMOTE_SOURCE', risk: 'notice', file: 'main.tf', line: 3, message: 'Remote module.' }],
	usable: true
};

test('parses template details and refuses unsafe file names', () => {
	const parsed = parseTemplateDetails(details);
	assert.ok(parsed);
	assert.equal(parsed.terraformFiles.length, 2);
	assert.equal(parsed.findings[0].line, 3);
	assert.equal('parameters' in parsed, false);
	assert.deepEqual(parsed.layout, { nodes: {} });
	assert.equal(parseTemplateDetails({ ...details, terraformFiles: [{ fileName: '../main.tf', contents: '' }] }), undefined);
	assert.equal(parseTemplateDetails({ ...details, archiveSha256: 'xyz' }), undefined);
	assert.equal(parseTemplateDetails({ ...details, findings: [{ code: 'X', risk: 'critical', file: 'a', message: '' }] }), undefined);
});

test('compatibility never reports compatible when a row conflicts', () => {
	const report = {
		templateId: summary.id, version: '1.0.0', workspaceId: 'w', architectureId: 'a', sourceRevision: 'b'.repeat(64),
		compatible: true, unknownResourceTypes: [], highRiskFindings: 0,
		providers: [{ provider: 'hashicorp/azurerm', templateConstraint: '~> 4.0', status: 'conflictWithLock', locked: '5.14.0' }]
	};
	const parsed = parseTemplateCompatibility(report);
	assert.ok(parsed);
	assert.equal(parsed.compatible, false);
	assert.equal(parsed.providers[0].locked, '5.14.0');
	assert.match(describeProviderFit(parsed.providers[0]), /needs ~> 4\.0, but this project is locked to 5\.14\.0/);
	assert.equal(parseTemplateCompatibility({ ...report, providers: [{ provider: 'x', status: 'maybe' }] }), undefined);
	assert.match(describeProviderFit({ provider: 'hashicorp/random', status: 'notInProject' }), /random: not used/);
});

test('parses both import outcomes', () => {
	const added = parseTemplateImport({ imported: true, outcome: 'added', templateId: 'example.team.net', version: '1.0.0', summary: { ...summary, id: 'example.team.net', source: 'local', trust: 'local' }, problems: [], findings: [] });
	assert.ok(added && added.imported && added.summary.source === 'local');
	const blocked = parseTemplateImport({ imported: false, reason: 'HIGH_RISK_NOT_ACCEPTED', templateId: 'example.team.net', version: '1.0.0', problems: [], findings: [{ code: 'PROVISIONER', risk: 'high', file: 'main.tf', message: 'Runs a command.' }] });
	assert.ok(blocked && !blocked.imported && blocked.findings[0].risk === 'high');
	assert.equal(parseTemplateImport({ imported: true, outcome: 'merged', templateId: 'example.team.net', version: '1.0.0', summary }), undefined);
});

test('client sends only documented params, validates ids, and maps faults to plain text', async () => {
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const replies: Record<string, unknown> = { listTemplates: page, listTemplateSources: { sources: page.sources }, removeCachedTemplate: { removed: true } };
	const call: ServiceCall = async <T>(method: string, params: Record<string, unknown>) => {
		calls.push({ method, params });
		if (method === 'importTemplatePackageFile') {
			return { ok: false as const, error: { code: 'TEMPLATE_EXISTS' } };
		}
		return { ok: true as const, value: replies[method] as T };
	};
	const client = createTemplateClient(call);
	const listed = await client.list({ query: 'hub', providers: ['azure'], categories: [], sort: 'name' });
	assert.ok(listed.ok);
	assert.deepEqual(calls[0], { method: 'listTemplates', params: { query: 'hub', providers: ['azure'], sort: 'name' } });

	const bad = await client.details('../etc');
	assert.equal(bad.ok, false);
	assert.equal(calls.length, 1, 'invalid ids never reach the service');

	const imported = await client.importFile({ replace: true });
	assert.deepEqual(calls[1], { method: 'importTemplatePackageFile', params: { replace: true } });
	assert.ok(!imported.ok && imported.message === templateErrorMessage('TEMPLATE_EXISTS'));

	const sources = await client.sources();
	assert.ok(sources.ok && sources.value.length === 2);
	const removed = await client.remove('example.team.net', '1.0.0');
	assert.ok(removed.ok);

	// A reply that does not match the contract is a service error, not data.
	replies.listTemplates = { templates: 'nope' };
	const broken = await client.list();
	assert.ok(!broken.ok && broken.code === 'SERVICE_ERROR');
});
