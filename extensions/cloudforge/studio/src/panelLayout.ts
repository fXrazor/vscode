/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CodeDock = 'bottom' | 'left' | 'right' | 'closed';
export type SidePanel = 'library' | 'inspector';

export interface PanelLayoutState {
	readonly libraryOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly codeDock: CodeDock;
	readonly autoHidden?: { readonly side: SidePanel; readonly wasOpen: boolean };
}

export function createPanelLayout(initial?: Partial<Pick<PanelLayoutState, 'libraryOpen' | 'inspectorOpen' | 'codeDock'>>): PanelLayoutState {
	return {
		libraryOpen: initial?.libraryOpen ?? true,
		inspectorOpen: initial?.inspectorOpen ?? true,
		codeDock: initial?.codeDock ?? 'bottom',
	};
}

/**
 * Docks the code panel while hiding a competing side panel and restoring it on return — unless the
 * user manually toggled that side panel in the meantime.
 */
export function dockCodePanel(state: PanelLayoutState, next: CodeDock): PanelLayoutState {
	let libraryOpen = state.libraryOpen;
	let inspectorOpen = state.inspectorOpen;

	if (state.autoHidden?.side === 'library') {
		libraryOpen = state.autoHidden.wasOpen;
	} else if (state.autoHidden?.side === 'inspector') {
		inspectorOpen = state.autoHidden.wasOpen;
	}

	let autoHidden: PanelLayoutState['autoHidden'];
	if (next === 'right') {
		autoHidden = { side: 'inspector', wasOpen: inspectorOpen };
		inspectorOpen = false;
	} else if (next === 'left') {
		autoHidden = { side: 'library', wasOpen: libraryOpen };
		libraryOpen = false;
	}

	return { libraryOpen, inspectorOpen, codeDock: next, ...(autoHidden ? { autoHidden } : {}) };
}

/**
 * Applies an explicit open/close change to a side panel. User choices clear any auto-hidden memory
 * for that side, and opening a side panel that collides with a side-docked code panel moves the
 * code panel back to the bottom so canvas space stays usable.
 */
export function setSidePanelOpen(state: PanelLayoutState, side: SidePanel, open: boolean): PanelLayoutState {
	let libraryOpen = side === 'library' ? open : state.libraryOpen;
	let inspectorOpen = side === 'inspector' ? open : state.inspectorOpen;
	let codeDock = state.codeDock;
	let autoHidden = state.autoHidden?.side === side ? undefined : state.autoHidden;

	if (open && side === 'inspector' && codeDock === 'right') {
		codeDock = 'bottom';
		autoHidden = undefined;
	} else if (open && side === 'library' && codeDock === 'left') {
		codeDock = 'bottom';
		autoHidden = undefined;
	}

	return { libraryOpen, inspectorOpen, codeDock, ...(autoHidden ? { autoHidden } : {}) };
}

export function toggleSidePanel(state: PanelLayoutState, side: SidePanel): PanelLayoutState {
	const currentlyOpen = side === 'library' ? state.libraryOpen : state.inspectorOpen;
	return setSidePanelOpen(state, side, !currentlyOpen);
}
