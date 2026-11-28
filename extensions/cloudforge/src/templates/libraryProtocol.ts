/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Messages from the Template Library webview. Everything the page sends is checked here before
// the extension acts on it; anything that does not match is dropped. Zero vscode imports.

import { isTemplateId, isTemplateVersion } from './model.ts';

export type LibraryMessage =
	| { readonly type: 'ready' | 'refresh' | 'importFile' | 'createFromArchitecture' }
	| { readonly type: 'details' | 'compatibility' | 'remove' | 'addToArchitecture'; readonly templateId: string; readonly version: string }
	| { readonly type: 'validate'; readonly templateId: string; readonly version: string; readonly values: Readonly<Record<string, string>> }
	| { readonly type: 'create'; readonly templateId: string; readonly version: string; readonly name: string; readonly values: Readonly<Record<string, string>> }
	| { readonly type: 'openFile'; readonly templateId: string; readonly version: string; readonly fileName: string }
	| { readonly type: 'copy'; readonly text: string };

const MAX_VALUES = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseValues(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const entries = Object.entries(value);
	if (entries.length > MAX_VALUES) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, item] of entries) {
		if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(key) || typeof item !== 'string' || item.length > 4096) {
			return undefined;
		}
		out[key] = item;
	}
	return out;
}

export function parseLibraryMessage(value: unknown): LibraryMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') {
		return undefined;
	}
	switch (value.type) {
		case 'ready': case 'refresh': case 'importFile': case 'createFromArchitecture':
			return { type: value.type };
		case 'copy':
			return typeof value.text === 'string' && value.text.length > 0 && value.text.length <= 512 ? { type: 'copy', text: value.text } : undefined;
	}
	if (!isTemplateId(value.templateId) || !isTemplateVersion(value.version)) {
		return undefined;
	}
	const templateId = value.templateId;
	const version = value.version;
	switch (value.type) {
		case 'details': case 'compatibility': case 'remove': case 'addToArchitecture':
			return { type: value.type, templateId, version };
		case 'validate': {
			const values = parseValues(value.values);
			return values ? { type: 'validate', templateId, version, values } : undefined;
		}
		case 'create': {
			const values = parseValues(value.values);
			return values && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 255
				? { type: 'create', templateId, version, name: value.name, values }
				: undefined;
		}
		case 'openFile':
			return typeof value.fileName === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value.fileName)
				? { type: 'openFile', templateId, version, fileName: value.fileName }
				: undefined;
		default:
			return undefined;
	}
}

/** A stable key for one template version, used by the page to match replies to requests. */
export function templateKey(templateId: string, version: string): string {
	return templateId + '@' + version;
}
