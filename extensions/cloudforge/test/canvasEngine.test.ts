/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioWebviewHtml, normalizeCanvasEngine, resolveCanvasEngine } from '../src/canvas/canvasEngine.ts';

test('resolveCanvasEngine defaults to classic, honours studio when staged, and falls back gracefully when absent', () => {
	assert.equal(normalizeCanvasEngine(undefined), 'classic');
	assert.equal(normalizeCanvasEngine('studio'), 'studio');
	assert.equal(normalizeCanvasEngine('unknown'), 'classic');

	assert.deepEqual(resolveCanvasEngine('classic', undefined, true), { engine: 'classic', fellBackFromStudio: false });
	assert.deepEqual(resolveCanvasEngine('studio', undefined, true), { engine: 'studio', fellBackFromStudio: false });
	assert.deepEqual(resolveCanvasEngine('classic', 'studio', true), { engine: 'studio', fellBackFromStudio: false });
	assert.deepEqual(resolveCanvasEngine('studio', undefined, false), { engine: 'classic', fellBackFromStudio: true });
	assert.deepEqual(resolveCanvasEngine('classic', 'studio', false), { engine: 'classic', fellBackFromStudio: true });
});

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
