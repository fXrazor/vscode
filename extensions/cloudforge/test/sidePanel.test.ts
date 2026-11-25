/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	cloudAccountPickItems, parseCloudAccountList, buildStatusHtml, describeConnection, describeSignInCheck, describeState, escapeHtml, parseCloudConnections, parseSignInCheck, parseStateSummary, parseStatusPageMessage, providersInUse, signInLabel, stateDrift,
} from '../src/sidePanel/model.ts';

const summary = {
	workspaceId: 'w', architectureId: 'a', sourceRevision: 'a'.repeat(64),
	backend: { type: 'azurerm', declared: true, file: 'backend.tf', settings: ['key', 'storage_account_name'] },
	initializedBackend: { type: 'local', matchesConfiguration: false },
	workspaces: ['staging'],
	localState: {
		present: true, readable: true, terraformVersion: '1.9.5', serial: 4, truncated: false,
		resources: [
			{ address: 'azurerm_resource_group.old', mode: 'managed', type: 'azurerm_resource_group', provider: 'hashicorp/azurerm', instances: 1 },
			{ address: 'azurerm_resource_group.hub', mode: 'managed', type: 'azurerm_resource_group', provider: 'hashicorp/azurerm', instances: 1 },
			{ address: 'module.net.azurerm_subnet.a', mode: 'managed', type: 'azurerm_subnet', provider: 'hashicorp/azurerm', instances: 1 },
		],
		outputs: [{ name: 'id', sensitive: true }],
	},
};

test('state summaries are parsed, described and compared with the configuration', () => {
	const state = parseStateSummary(summary);
	assert.ok(state);
	assert.equal(describeState(state), 'azurerm backend · 3 resources in state · serial 4 · run init: backend changed');
	assert.deepEqual(stateDrift(state, ['azurerm_resource_group.hub', 'azurerm_virtual_network.new']), {
		onlyInState: ['azurerm_resource_group.old'],
		notInState: ['azurerm_virtual_network.new'],
	});
	assert.equal(parseStateSummary({ ...summary, backend: null }), undefined);
	const missing = parseStateSummary({ ...summary, backend: { type: 'local', declared: false, settings: [] }, initializedBackend: null, localState: { present: false } });
	assert.equal(missing && describeState(missing), 'local state (no backend block)');
});

test('cloud connections show masked targets and which providers an architecture uses', () => {
	const rows = parseCloudConnections({
		connections: [
			{ provider: 'azure', signIn: 'Azure CLI', cliFound: true, linked: true, keyStored: false, binding: { cloud: 'AzureCloud', subscriptionId: '…eeee', label: 'Prod' } },
			{ provider: 'aws', signIn: 'AWS CLI', cliFound: false, linked: false, keyStored: false },
			{ provider: 'oracle', linked: true },
		],
	});
	assert.equal(rows?.length, 2);
	assert.equal(describeConnection(rows![0]), 'Prod · subscription …eeee');
	assert.equal(describeConnection(rows![1]), 'Not linked · AWS CLI not found');
	assert.deepEqual(providersInUse(['aws_vpc', 'azurerm_subnet', null, 'random_id']), ['azure', 'aws']);
});

test('the status page escapes text and accepts only known messages', () => {
	const state = parseStateSummary(summary)!;
	const html = buildStatusHtml({
		projectName: '<script>alert(1)</script>', architectureName: 'Hub', sourceRevision: 'a'.repeat(64),
		resourceCount: 2, errorCount: 0, warningCount: 1, declaredAddresses: ['azurerm_resource_group.hub'], providersInUse: ['azure', 'aws'],
		state, connections: parseCloudConnections({ connections: [{ provider: 'aws', signIn: 'AWS CLI', cliFound: true, linked: false, keyStored: false }] }),
	}, 'nonce123', 'vscode-resource:');
	assert.doesNotMatch(html, /<script>alert/);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /Used by this architecture but not linked/);
	assert.match(html, /azurerm_resource_group\.old/);
	assert.match(html, /script-src 'nonce-nonce123'/);
	assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
	assert.deepEqual(parseStatusPageMessage({ type: 'linkConnection', provider: 'azure' }), { type: 'linkConnection', provider: 'azure' });
	assert.equal(parseStatusPageMessage({ type: 'linkConnection', provider: 'oracle' }), undefined);
	assert.equal(parseStatusPageMessage({ type: 'runShell' }), undefined);
});

test('sign-in checks are parsed strictly and shown without secrets', () => {
	assert.equal(parseSignInCheck({ provider: 'azure', status: 'weird', detail: 'x' }), undefined);
	assert.equal(parseSignInCheck({ provider: 'oracle', status: 'ok', detail: 'x' }), undefined);
	const ok = parseSignInCheck({ provider: 'azure', status: 'ok', detail: 'Signed in.', signedInAs: 'd…@contoso.com', accountType: 'user', targetName: 'Prod', checkedAt: 1764000000, stderr: 'token=abc' });
	assert.deepEqual(ok, { provider: 'azure', status: 'ok', detail: 'Signed in.', signedInAs: 'd…@contoso.com', accountType: 'user', targetName: 'Prod', checkedAt: 1764000000 });
	assert.equal(describeSignInCheck(ok!), 'Signed in as d…@contoso.com · Prod');
	const expired = parseSignInCheck({ provider: 'aws', status: 'expired', detail: 'Run aws sso login for this profile.' })!;
	assert.equal(signInLabel(expired.status), 'Sign-in expired');
	assert.deepEqual(parseStatusPageMessage({ type: 'checkSignIn', provider: 'aws' }), { type: 'checkSignIn', provider: 'aws' });
	assert.equal(parseStatusPageMessage({ type: 'checkSignIn', provider: 'az login' }), undefined);

	const connections = parseCloudConnections({ connections: [
		{ provider: 'azure', signIn: 'Azure CLI', cliFound: true, linked: true, keyStored: false, binding: { cloud: 'AzureCloud', tenantId: '…aaaa', subscriptionId: '…eeee' } },
		{ provider: 'aws', signIn: 'AWS CLI', cliFound: true, linked: true, keyStored: false, binding: { profile: 'dev' } },
	] });
	const html = buildStatusHtml({
		resourceCount: 0, errorCount: 0, warningCount: 0, declaredAddresses: [], providersInUse: ['azure'],
		connections, signInChecks: { azure: ok!, aws: { ...expired, detail: '<img src=x>' } },
	}, 'nonce', 'vscode-resource:');
	assert.match(html, /data-message="checkSignIn" data-provider="azure"/);
	assert.match(html, /Signed in as d…@contoso.com · Prod/);
	assert.match(html, /Sign-in expired/);
	assert.ok(!html.includes('<img src=x>'));
	assert.match(html, /&lt;img src=x&gt;/);
});

test('the link picker keeps only accounts that make a valid link, default and current first', () => {
	const azure = parseCloudAccountList({
		provider: 'azure', status: 'ok', truncated: false,
		accounts: [
			{ subscriptionId: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', tenantId: '11111111-2222-3333-4444-555555555555', name: 'Prod', cloud: 'AzureCloud', isDefault: true },
			{ subscriptionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', tenantId: '11111111-2222-3333-4444-555555555555', name: 'Dev', cloud: 'AzureCloud', isDefault: false },
			{ subscriptionId: 'not-a-guid', tenantId: '11111111-2222-3333-4444-555555555555', name: 'Bad', cloud: 'AzureCloud' },
			{ subscriptionId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', tenantId: '11111111-2222-3333-4444-555555555555', name: 'Gov', cloud: 'MarsCloud' },
		],
	})!;
	assert.equal(azure.accounts.length, 2);
	assert.equal(azure.accounts[0].provider === 'azure' && azure.accounts[0].subscriptionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
	const rows = cloudAccountPickItems(azure, { subscriptionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' });
	assert.deepEqual(rows.map(row => row.label), ['Dev', 'Prod']);
	assert.equal(rows[0].description, 'subscription …eeee · tenant …5555 · linked now');
	assert.match(rows[1].description, /CLI default/);

	const aws = parseCloudAccountList({ provider: 'aws', status: 'ok', accounts: [{ profile: 'prod' }, { profile: 'default' }, { profile: 'bad name' }] })!;
	assert.deepEqual(cloudAccountPickItems(aws).map(row => row.label), ['default', 'prod']);

	const google = parseCloudAccountList({ provider: 'google', status: 'ok', accounts: [{ projectId: 'my-proj-123', name: 'My project' }, { projectId: 'Bad_Id' }] })!;
	assert.deepEqual(cloudAccountPickItems(google).map(row => [row.label, row.description]), [['My project', 'my-proj-123']]);

	assert.equal(parseCloudAccountList({ provider: 'azure', status: 'notSignedIn', accounts: [] })?.accounts.length, 0);
	assert.equal(parseCloudAccountList({ provider: 'oracle', status: 'ok', accounts: [] }), undefined);
	assert.equal(parseCloudAccountList({ provider: 'azure', status: 'hacked', accounts: [] }), undefined);
});
