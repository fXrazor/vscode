/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPanelLayout, dockCodePanel, setSidePanelOpen, toggleSidePanel } from './panelLayout.ts';

test('side docking hides the competing panel and restores it when returning to bottom', () => {
	const initial = createPanelLayout({ libraryOpen: true, inspectorOpen: true, codeDock: 'bottom' });
	const right = dockCodePanel(initial, 'right');
	assert.equal(right.inspectorOpen, false);
	assert.equal(right.libraryOpen, true);
	assert.equal(right.codeDock, 'right');

	const left = dockCodePanel(right, 'left');
	assert.equal(left.inspectorOpen, true);
	assert.equal(left.libraryOpen, false);
	assert.equal(left.codeDock, 'left');

	const bottom = dockCodePanel(left, 'bottom');
	assert.equal(bottom.libraryOpen, true);
	assert.equal(bottom.inspectorOpen, true);
	assert.equal(bottom.codeDock, 'bottom');
});

test('side docking remembers when the competing panel was already closed', () => {
	const closedInspector = createPanelLayout({ libraryOpen: true, inspectorOpen: false, codeDock: 'bottom' });
	const right = dockCodePanel(closedInspector, 'right');
	const bottom = dockCodePanel(right, 'bottom');
	assert.equal(bottom.inspectorOpen, false);
});

test('manually opening an auto-hidden panel moves side-docked code to bottom and keeps the user choice', () => {
	const initial = createPanelLayout({ libraryOpen: true, inspectorOpen: true, codeDock: 'bottom' });
	const right = dockCodePanel(initial, 'right');
	const reopened = toggleSidePanel(right, 'inspector');
	assert.equal(reopened.inspectorOpen, true);
	assert.equal(reopened.codeDock, 'bottom');
	assert.equal(reopened.autoHidden, undefined);

	// Closing the inspector manually afterward stays closed even if code dock changes.
	const closedAgain = setSidePanelOpen(reopened, 'inspector', false);
	const closedCode = dockCodePanel(closedAgain, 'closed');
	assert.equal(closedCode.inspectorOpen, false);
});

test('explicitly closing an unrelated panel is preserved across dock transitions', () => {
	const initial = createPanelLayout({ libraryOpen: true, inspectorOpen: true, codeDock: 'bottom' });
	const right = dockCodePanel(initial, 'right');
	const libraryClosed = setSidePanelOpen(right, 'library', false);
	const bottom = dockCodePanel(libraryClosed, 'bottom');
	assert.equal(bottom.libraryOpen, false);
	assert.equal(bottom.inspectorOpen, true);
});
