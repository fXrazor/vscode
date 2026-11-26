/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Action, DesignMode } from './model.ts';

/** The technical graph is a derived viewer. It never dispatches project/architecture commands. */
export function dispatchCanvasAction(mode: DesignMode, editArchitecture: (action: Action) => void, action: Action): void {
	if (mode === 'visual') { editArchitecture(action); }
}
