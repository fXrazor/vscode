/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { iconProviderForType, parseCatalogueIcons } from '../src/resourceIconModel.ts';

test('resource types map to the catalogue of their provider', () => {
	assert.equal(iconProviderForType('azurerm_virtual_network'), 'azure');
	assert.equal(iconProviderForType('aws_vpc'), 'aws');
	assert.equal(iconProviderForType('google_compute_network'), 'gcp');
	assert.equal(iconProviderForType('random_string'), undefined);
	assert.equal(iconProviderForType('azurerm_../x'), undefined);
	assert.equal(iconProviderForType(null), undefined);
});

test('catalogue icons keep only safe types and relative icon paths', () => {
	const icons = parseCatalogueIcons({
		entries: [
			{ type: 'azurerm_virtual_machine', icon: 'catalog-icons/azure/azure-virtual-machine.svg' },
			{ type: 'azurerm_bad', icon: '../../secrets.svg' },
			{ type: 'azurerm_abs', icon: '/etc/x.svg' },
			{ type: 'azurerm_png', icon: 'catalog-icons/azure/x.png' },
			{ type: 'Bad Type', icon: 'x.svg' },
		],
	});
	assert.deepEqual([...icons], [['azurerm_virtual_machine', 'catalog-icons/azure/azure-virtual-machine.svg']]);
	assert.equal(parseCatalogueIcons(null).size, 0);
});

test('the shipped Azure catalogue gives virtual machines and peerings their own icons, not the resource group one', () => {
	const icons = parseCatalogueIcons(JSON.parse(readFileSync(new URL('../studio/assets/catalogue/azure.json', import.meta.url), 'utf8')));
	assert.ok(icons.size > 1000);
	assert.equal(icons.get('azurerm_virtual_machine'), 'catalog-icons/azure/azure-virtual-machine.svg');
	assert.equal(icons.get('azurerm_virtual_network_peering'), 'catalog-icons/azure/azure-virtual-networks.svg');
	assert.equal(icons.get('azurerm_resource_group'), 'catalog-icons/azure/azure-resource-groups.svg');
	for (const provider of ['aws', 'gcp']) {
		assert.ok(parseCatalogueIcons(JSON.parse(readFileSync(new URL(`../studio/assets/catalogue/${provider}.json`, import.meta.url), 'utf8'))).size > 500, provider);
	}
});
