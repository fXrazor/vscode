/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Template Library webview document. Pure: no `vscode` import. The page script and styles live in
// resources/templates/ and are loaded by URI under a strict CSP; all data arrives by postMessage
// and is escaped before it becomes markup.

export interface LibraryHtmlParams {
	readonly nonce: string;
	readonly cspSource: string;
	readonly scriptUri: string;
	readonly styleUri: string;
	/** Mona Sans, from the Studio assets, when the build staged them. */
	readonly fontUri?: string;
}

function attr(value: string): string {
	return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]!));
}

export function buildLibraryHtml(params: LibraryHtmlParams): string {
	const csp = [
		`default-src 'none'`,
		`style-src ${params.cspSource} 'nonce-${params.nonce}'`,
		`script-src 'nonce-${params.nonce}'`,
		`img-src ${params.cspSource} data:`,
		`font-src ${params.cspSource}`,
	].join('; ');
	const font = params.fontUri
		? `<style nonce="${params.nonce}">@font-face { font-family: "Mona Sans"; src: url("${attr(params.fontUri)}") format("woff2"); font-weight: 200 900; font-display: swap; }</style>`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Template Library</title>
<link rel="stylesheet" href="${attr(params.styleUri)}" nonce="${params.nonce}">
${font}
</head>
<body>
<main id="view" class="view" aria-live="polite"><p class="loading">Loading templates…</p></main>
<div id="modal-root"></div>
<div id="toast" class="toast" role="status" hidden></div>
<script nonce="${params.nonce}" src="${attr(params.scriptUri)}"></script>
</body>
</html>`;
}
