/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, l10n, window } from 'vscode';

export type ProjectServiceResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly code: string };

/**
 * Calls a Stage 2 project method through the workbench bridge. The extension never sends a path:
 * Electron main fills project, folder, and parent paths from the calling window.
 */
export async function callProjectService(method: string, params: Record<string, unknown>): Promise<ProjectServiceResult> {
	let result: unknown;
	try {
		result = await commands.executeCommand<unknown>('_cloudforge.callService', method, params);
	} catch {
		return { ok: false, code: 'SERVICE_ERROR' };
	}
	if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
		return { ok: false, code: 'SERVICE_ERROR' };
	}
	const typed = result as { ok: boolean; value?: unknown; error?: { code?: unknown } };
	if (typed.ok) {
		return { ok: true, value: typed.value };
	}
	return { ok: false, code: typeof typed.error?.code === 'string' ? typed.error.code : 'SERVICE_ERROR' };
}

export function projectErrorMessage(code: string): string {
	switch (code) {
		case 'ALREADY_EXISTS': return l10n.t('A project, architecture, or workspace file with that name already exists.');
		case 'STALE_SOURCE': return l10n.t('The project changed on disk. CloudForge reloaded it; try again.');
		case 'UNSUPPORTED_FORMAT': return l10n.t('CloudForge did not find a supported project or Terraform configuration there.');
		case 'WORKSPACE_UNAVAILABLE': return l10n.t('That folder is not available or has changed.');
		case 'LIMIT_EXCEEDED': return l10n.t('The folder is larger than CloudForge can inspect.');
		case 'SCOPE_DENIED': return l10n.t('That folder is not part of this window, or the project is no longer active.');
		case 'INVALID_STATE': return l10n.t('Open a CloudForge project in this window first.');
		case 'INVALID_PARAMS': return l10n.t('CloudForge could not use those details. Check the names and try again.');
		case 'SERVICE_UNAVAILABLE': return l10n.t('The CloudForge service is not running.');
		default: return l10n.t('The CloudForge service could not complete the request.');
	}
}

/** Shows an error unless the user simply cancelled. */
export function showProjectError(code: string): void {
	if (code !== 'CANCELLED') {
		void window.showErrorMessage(projectErrorMessage(code));
	}
}
