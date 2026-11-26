/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundleArchitectureName, readProjectBundle } from '../src/project/projectBundle.ts';
import { buildProjectBundle } from '../studio/src/projectBundle.ts';
import { sampleArchitecture } from '../studio/src/fixture.ts';
import { readZip, writeZip } from '../studio/src/zipArchive.ts';

const limits = { maxEntries: 64, maxEntryBytes: 1 << 22, maxTotalBytes: 1 << 24 };

test('extension reads a Studio-exported bundle into starter files and the canvas model', async () => {
	const built = await buildProjectBundle({ architecture: sampleArchitecture(), source: { mode: 'sample' } });
	const bundle = readProjectBundle(Buffer.from(built.bytes));
	assert.equal(bundle.name, 'Production network');
	const names = bundle.terraformFiles.map(file => file.fileName);
	assert.ok(names.includes('main.tf'));
	assert.ok(names.every(name => /\.(tf|tf\.json|tfvars)$/.test(name) && !name.includes('/')));
	assert.ok(bundle.skippedFiles.some(name => name.includes('/') || name.startsWith('.')), 'nested and dot files are reported, not created');
	assert.ok(names.length <= 16);
	assert.deepEqual(bundle.warnings, []);
	assert.equal((bundle.architecture as { resources: unknown[] }).resources.length, sampleArchitecture().resources.length);
});

test('extension bundle reader rejects tampered Terraform and non-bundles', async () => {
	const built = await buildProjectBundle({ architecture: sampleArchitecture(), source: { mode: 'sample' } });
	const entries = await readZip(built.bytes, limits);
	const tampered = entries.map(entry => entry.path === 'terraform/main.tf' ? { ...entry, data: new TextEncoder().encode('resource "x" "y" {}\n') } : entry);
	const tamperedBytes = await writeZip(tampered);
	assert.throws(() => readProjectBundle(Buffer.from(tamperedBytes)), /manifest digest/);
	assert.throws(() => readProjectBundle(Buffer.from('not a zip')), /not a ZIP/);
	const other = await writeZip([{ path: 'readme.txt', data: new TextEncoder().encode('hi') }]);
	assert.throws(() => readProjectBundle(Buffer.from(other)), /not a CloudForge project bundle/);
});

test('bundle architecture names are folder-safe and unique', () => {
	assert.equal(bundleArchitectureName('Production network', new Set()), 'production-network');
	assert.equal(bundleArchitectureName('Production network', new Set(['production-network'])), 'production-network-2');
	assert.equal(bundleArchitectureName('../..', new Set()), 'imported');
});
