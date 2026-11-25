/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for building strict CSP-hardened CloudForge Studio Webview HTML documents
// without runtime `vscode` dependencies.

export interface StudioWebviewHtmlParams {
	readonly nonce: string;
	readonly cspSource: string;
	readonly studioBaseUri: string;
	readonly scriptUri: string;
	readonly styleUri: string;
}

export function buildStudioWebviewHtml(params: StudioWebviewHtmlParams): string {
	const baseHref = params.studioBaseUri.endsWith('/') ? params.studioBaseUri : `${params.studioBaseUri}/`;
	const csp = [
		`default-src 'none'`,
		`base-uri ${params.cspSource}`,
		`img-src ${params.cspSource} data: blob:`,
		`font-src ${params.cspSource} data:`,
		`style-src ${params.cspSource} 'unsafe-inline'`,
		`script-src ${params.cspSource} 'nonce-${params.nonce}'`,
		`connect-src ${params.cspSource} data: blob:`,
		`worker-src ${params.cspSource} blob:`,
	].join('; ');

	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'\t<meta charset="UTF-8">',
		`\t<base href="${baseHref}">`,
		`\t<meta http-equiv="Content-Security-Policy" content="${csp}">`,
		'\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		'\t<title>CloudForge Architecture Canvas</title>',
		`\t<link rel="stylesheet" href="${params.styleUri}">`,
		'</head>',
		'<body>',
		'\t<div id="root"></div>',
		`\t<script type="module" nonce="${params.nonce}" src="${params.scriptUri}"></script>`,
		'</body>',
		'</html>',
	].join('\n');
}

export function buildStudioUnavailableHtml(message: string): string {
	const escaped = message.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]!));
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'\t<meta charset="UTF-8">',
		'\t<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">',
		'\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		'\t<title>CloudForge Architecture Canvas</title>',
		'\t<style>body{font-family:var(--vscode-font-family,Segoe UI,sans-serif);color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1e1e1e);margin:0;padding:32px;}h1{font-size:16px;margin:0 0 8px;}p{margin:0;opacity:0.85;line-height:1.5;}</style>',
		'</head>',
		'<body>',
		'\t<h1>CloudForge Architecture Canvas</h1>',
		`\t<p>${escaped}</p>`,
		'</body>',
		'</html>',
	].join('\n');
}
