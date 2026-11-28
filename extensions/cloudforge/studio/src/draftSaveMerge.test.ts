/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMerge, describeSaveFinding } from './draftSaveMerge.ts';

test('describeSaveFinding translates known Rust security/hygiene codes into plain English', () => {
	assert.equal(describeSaveFinding('SENSITIVE_LITERAL'), 'Possible hard-coded secret — replace with a variable reference');
	assert.equal(describeSaveFinding('TFVARS_FILE'), 'Variable values file present in repository');
	assert.equal(describeSaveFinding('STATE_FILE'), 'Terraform state file present in repository');
	assert.equal(describeSaveFinding('PROVIDER_CACHE'), 'Local provider cache (.terraform) present in repository');
	assert.equal(describeSaveFinding('FUTURE_WARNING_CODE'), 'future warning code');
});

test('describeMerge summarizes updated, added, renamed, removed, and kept blocks', () => {
	const lines = describeMerge({
		updated: ['azurerm_resource_group.main'],
		added: ['azurerm_virtual_network.hub'],
		removed: [],
		renamed: [{ from: 'azurerm_subnet.old', to: 'azurerm_subnet.app' }],
		unchanged: 2,
		preserved: 1,
		skipped: [],
	});
	assert.ok(lines.some(line => line.includes('Updates azurerm_resource_group.main')));
	assert.ok(lines.some(line => line.includes('Adds azurerm_virtual_network.hub')));
	assert.ok(lines.some(line => line.includes('Renames azurerm_subnet.old to azurerm_subnet.app')));
	assert.ok(lines.some(line => line.includes('Keeps 3 other blocks exactly as written')));
});
