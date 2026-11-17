/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImportSelections } from '../src/importSelections.ts';

const candidates = [
	{ candidateId: 'root-1', imported: false },
	{ candidateId: 'root-2', imported: true },
	{ candidateId: 'root-3', imported: false },
];
const hub = { candidateId: 'root-1', displayName: 'Hub network' };
const sandbox = { candidateId: 'root-3', displayName: 'Sandbox' };

test('accepts two selected roots with distinct architecture names', () => {
	assert.equal(validateImportSelections(candidates, [hub, sandbox], ['Production']), undefined);
});

test('rejects empty, repeated, already imported, and unknown selections', () => {
	assert.equal(validateImportSelections(candidates, [], []), 'noSelection');
	assert.equal(validateImportSelections(candidates, [hub, { ...sandbox, candidateId: hub.candidateId }], []), 'duplicateCandidate');
	assert.equal(validateImportSelections(candidates, [{ ...hub, candidateId: 'root-2' }], []), 'candidateUnavailable');
	assert.equal(validateImportSelections(candidates, [{ ...hub, candidateId: 'root-4' }], []), 'candidateUnavailable');
});

test('rejects invalid Windows names and case-insensitive architecture name collisions', () => {
	for (const displayName of ['', ' trailing ', 'bad.', 'sub/folder', 'COM¹.txt', '.cloudforge-staging-1', '😀'.repeat(128)]) {
		assert.equal(validateImportSelections(candidates, [{ ...hub, displayName }], []), 'invalidName');
	}
	assert.equal(validateImportSelections(candidates, [{ ...hub, displayName: '😀'.repeat(127) + 'a' }], []), undefined);
	assert.equal(validateImportSelections(candidates, [hub, { ...sandbox, displayName: 'HUB NETWORK' }], []), 'duplicateName');
	assert.equal(validateImportSelections(candidates, [sandbox], ['sandbox']), 'duplicateName');
});
