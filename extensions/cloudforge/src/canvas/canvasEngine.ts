/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for selecting the CloudForge Architecture Canvas engine (`classic` vs `studio`)
// and building strict CSP-hardened Webview HTML documents without runtime `vscode` dependencies.

export type CanvasEngine = 'classic' | 'studio';

export interface CanvasEngineResolution {
	readonly engine: CanvasEngine;
	readonly fellBackFromStudio: boolean;
}

export function normalizeCanvasEngine(value: unknown): CanvasEngine {
	return value === 'studio' ? 'studio' : 'classic';
}

export function resolveCanvasEngine(
	configured: unknown,
	override: CanvasEngine | undefined,
	studioAssetsAvailable: boolean
): CanvasEngineResolution {
	const desired = override ?? normalizeCanvasEngine(configured);
	if (desired === 'studio' && !studioAssetsAvailable) {
		return { engine: 'classic', fellBackFromStudio: true };
	}
	return { engine: desired, fellBackFromStudio: false };
}

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
		'\t<title>CloudForge Studio Canvas</title>',
		`\t<link rel="stylesheet" href="${params.styleUri}">`,
		'</head>',
		'<body>',
		'\t<div id="root"></div>',
		`\t<script type="module" nonce="${params.nonce}" src="${params.scriptUri}"></script>`,
		'</body>',
		'</html>',
	].join('\n');
}
