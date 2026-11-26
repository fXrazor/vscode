/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildStatusHtml, describeConnection, describeSignInCheck, describeState, escapeHtml, parseCloudConnections, parseSignInCheck, parseStateSummary, parseStatusPageMessage, providersInUse, signInLabel, stateDrift,
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

	const checkingHtml = buildStatusHtml({
		resourceCount: 0, errorCount: 0, warningCount: 0, declaredAddresses: [], providersInUse: ['azure'],
		connections, checking: ['azure'],
	}, 'nonce', 'vscode-resource:');
	assert.match(checkingHtml, /data-message="checkSignIn" data-provider="azure" disabled aria-busy="true">Checking…<\/button>/);
	assert.match(checkingHtml, /Checking CLI sign-in…/);
});
