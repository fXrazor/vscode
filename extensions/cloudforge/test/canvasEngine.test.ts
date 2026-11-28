/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioUnavailableHtml, buildStudioWebviewHtml } from '../src/canvas/canvasEngine.ts';
import { parseWebviewMessage } from '../src/canvas/protocol.ts';

test('buildStudioWebviewHtml sets strict CSP, base href, root container, and module nonce without unsafe script directives', () => {
	const html = buildStudioWebviewHtml({
		nonce: 'test-nonce-123',
		cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
		studioBaseUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/media/studio',
		scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/media/studio/studio.js',
		styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/media/studio/studio.css',
	});

	assert.match(html, /<base href="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/ext\/media\/studio\/">/);
	assert.match(html, /<div id="root"><\/div>/);
	assert.match(html, /<script type="module" nonce="test-nonce-123" src="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/ext\/media\/studio\/studio\.js"><\/script>/);
	assert.match(html, /default-src 'none'/);
	assert.match(html, /base-uri https:\/\/file\+\.vscode-resource\.vscode-cdn\.net/);
	assert.match(html, /connect-src https:\/\/file\+\.vscode-resource\.vscode-cdn\.net data: blob:/);
	assert.match(html, /font-src https:\/\/file\+\.vscode-resource\.vscode-cdn\.net data:/);
	assert.match(html, /script-src https:\/\/file\+\.vscode-resource\.vscode-cdn\.net 'nonce-test-nonce-123'/);
	assert.doesNotMatch(html, /unsafe-eval/);
	assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
});

test('buildStudioUnavailableHtml escapes message text and enforces scriptless CSP', () => {
	const html = buildStudioUnavailableHtml('Missing <script>alert(1)</script> assets');
	assert.match(html, /default-src 'none'/);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('parseWebviewMessage validates toggleFocusMode intents and rejects invalid types', () => {
	assert.deepEqual(parseWebviewMessage({ type: 'toggleFocusMode' }), { type: 'toggleFocusMode' });
	assert.deepEqual(parseWebviewMessage({ type: 'toggleFocusMode', active: true }), { type: 'toggleFocusMode', active: true });
	assert.deepEqual(parseWebviewMessage({ type: 'toggleFocusMode', active: false }), { type: 'toggleFocusMode', active: false });
	assert.equal(parseWebviewMessage({ type: 'toggleFocusMode', active: 'yes' }), undefined);
});

test('parseWebviewMessage strictly allowlists runHostAction intents', () => {
	assert.deepEqual(parseWebviewMessage({ type: 'runHostAction', action: 'formatArchitecture' }), { type: 'runHostAction', action: 'formatArchitecture' });
	assert.deepEqual(parseWebviewMessage({ type: 'runHostAction', action: 'exportPortableBundle' }), { type: 'runHostAction', action: 'exportPortableBundle' });
	assert.deepEqual(parseWebviewMessage({ type: 'runHostAction', action: 'upgradeProvider' }), { type: 'runHostAction', action: 'upgradeProvider' });
	assert.equal(parseWebviewMessage({ type: 'runHostAction', action: 'workbench.action.terminal.new' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'runHostAction', action: '' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'runHostAction' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'runHostAction', action: 42 }), undefined);
});
