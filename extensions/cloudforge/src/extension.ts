/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, l10n, window, type ExtensionContext } from 'vscode';

export function activate(context: ExtensionContext): void {
	context.subscriptions.push(commands.registerCommand('cloudforge.showProofStatus', () => {
		return window.showInformationMessage(l10n.t('The CloudForge built-in extension is active.'));
	}));
}
