/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectLockedSnapshot } from '../src/canvas/lockedCatalogue.ts';
import { parseCatalogueSnapshots, parseDependencyReport } from '../src/canvas/serviceAdapters.ts';

const revision = 'a'.repeat(64);
const snapshots = parseCatalogueSnapshots({ snapshots: ['4.12.0', '5.14.0'].map((version, index) => ({ manifestVersion: 1, key: { address: 'registry.terraform.io/hashicorp/azurerm', version, formatVersion: '1.0', sha256: String(index + 1).repeat(64) }, provenance: { engine: { name: 'terraform', version: '1.15.8' }, recordedAt: '2026-11-26T00:00:00Z' }, counts: { resources: 1, dataSources: 0 } })) });
const report = () => parseDependencyReport({ sourceRevision: revision, engine: 'terraform', engineInferred: false, lockFile: { state: 'valid', entries: [{ address: 'registry.terraform.io/hashicorp/azurerm', version: '4.12.0' }] }, providers: [{ address: 'registry.terraform.io/hashicorp/azurerm', display: 'hashicorp/azurerm', status: 'locked', lock: { version: '4.12.0' }, conflicts: [], requirements: [{}] }] })!;

test('forms select the architecture lock release rather than the newest catalogue snapshot', () => {
	assert.equal(selectLockedSnapshot(snapshots, 'azurerm_resource_group', report(), revision)?.version, '4.12.0');
	assert.equal(selectLockedSnapshot(snapshots.slice(1), 'azurerm_resource_group', report(), revision), undefined);
	assert.equal(selectLockedSnapshot(snapshots, 'azurerm_resource_group', { ...report(), sourceRevision: 'b'.repeat(64) }, revision), undefined);
});

test('missing, conflicting, ambiguous and wrong-registry lock evidence never silently selects a schema', () => {
	for (const lockState of ['absent', 'invalid', 'unreadable'] as const) { assert.equal(selectLockedSnapshot(snapshots, 'azurerm_resource_group', { ...report(), lockState }, revision), undefined); }
	assert.equal(selectLockedSnapshot(snapshots, 'azurerm_resource_group', { ...report(), providers: [{ ...report().providers[0], status: 'lockOutsideConstraints' }] }, revision), undefined);
	assert.equal(selectLockedSnapshot(snapshots.map(snapshot => ({ ...snapshot, address: 'registry.opentofu.org/hashicorp/azurerm' })), 'azurerm_resource_group', report(), revision), undefined);
	assert.equal(selectLockedSnapshot([...snapshots, { ...snapshots[0], sha256: 'f'.repeat(64) }], 'azurerm_resource_group', report(), revision), undefined);
	assert.equal(selectLockedSnapshot(snapshots, 'azurerm_resource_group', { ...report(), providers: [...report().providers, { ...report().providers[0], address: 'registry.terraform.io/another/azurerm' }] }, revision), undefined);
});
