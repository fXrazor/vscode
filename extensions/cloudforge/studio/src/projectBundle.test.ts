/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleArchitecture } from './fixture.ts';
import { createHistory, historyReducer, type Architecture } from './model.ts';
import { buildProjectBundle, bundleConflicts, bundleFileName, bundleTerraformFiles, readProjectBundle, toBase64, BundleError, MANIFEST_PATH, ARCHITECTURE_PATH } from './projectBundle.ts';
import { readZip, writeZip, crc32, isSafeZipPath } from './zipArchive.ts';

const limits = { maxEntries: 64, maxEntryBytes: 1 << 20, maxTotalBytes: 1 << 22 };
const text = (data: Uint8Array) => new TextDecoder().decode(data);

function withExtras(): Architecture {
	const base = sampleArchitecture();
	return {
		...base,
		items: [...base.items, { id: 'note-1', kind: 'note', text: 'Ask SRE about failover', positions: { visual: { x: 10, y: 20 }, technical: { x: 10, y: 20 } }, width: 180, height: 120, members: [] }],
		variables: [
			{ id: 'v1', name: 'cost_centre', type: 'string', description: 'Billing code', sensitive: false, defaultValue: 'dev', value: 'prod' },
			{ id: 'v2', name: 'admin_password', type: 'string', description: '', sensitive: true, value: 'hunter2' },
		],
	};
}

test('crc32 matches the PKZIP reference value', () => {
	assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round-trips stored and deflated entries', async () => {
	const big = new TextEncoder().encode('resource "x" "y" {}\n'.repeat(500));
	const small = new TextEncoder().encode('hi');
	const bytes = await writeZip([{ path: 'a/big.tf', data: big }, { path: 'small.txt', data: small }]);
	assert.ok(bytes.length < big.length, 'large text is deflated');
	const entries = await readZip(bytes, limits);
	assert.deepEqual(entries.map(entry => entry.path), ['a/big.tf', 'small.txt']);
	assert.equal(text(entries[0].data), text(big));
	assert.equal(text(entries[1].data), 'hi');
});

test('zip rejects unsafe paths on write and read', async () => {
	for (const path of ['../evil', '/abs', 'C:/x', 'a//b', 'a\\b', 'a/./b']) { assert.equal(isSafeZipPath(path), false, path); }
	await assert.rejects(writeZip([{ path: '../evil', data: new Uint8Array(1) }]));
	const bytes = await writeZip([{ path: 'okay.txt', data: new TextEncoder().encode('x') }]);
	// Rewrite the name in both headers to a traversal path of the same length.
	const tampered = bytes.slice();
	const replace = (from: string, to: string) => { const a = new TextEncoder().encode(from); const b = new TextEncoder().encode(to); for (let i = 0; i <= tampered.length - a.length; i++) { if (a.every((v, j) => tampered[i + j] === v)) { tampered.set(b, i); } } };
	replace('okay.txt', '../a.txt');
	await assert.rejects(readZip(tampered, limits), /unsafe path/);
});

test('zip detects corrupted entries', async () => {
	const bytes = await writeZip([{ path: 'x.txt', data: new TextEncoder().encode('abc') }]);
	const broken = bytes.slice(); broken[30 + 'x.txt'.length] ^= 0xff;
	await assert.rejects(readZip(broken, limits), /integrity/);
});

test('bundle file name is a safe slug', () => {
	assert.equal(bundleFileName('Production network'), 'production-network.cloudforge.zip');
	assert.equal(bundleFileName('  ../../  '), 'cloudforge-project.cloudforge.zip');
});

test('bundle terraform folds Studio variables in and never exports sensitive values', () => {
	const files = bundleTerraformFiles(withExtras());
	assert.ok(files['main.tf']?.includes('resource '));
	assert.match(files['variables.tf'], /variable "cost_centre"/);
	assert.match(files['variables.tf'], /variable "admin_password"[\s\S]*sensitive\s+= true/);
	assert.match(files['terraform.tfvars'], /cost_centre = "prod"/);
	assert.doesNotMatch(Object.values(files).join('\n'), /hunter2/);
});

test('bundle round-trips the canvas model with manifest digests', async () => {
	const architecture = withExtras();
	const built = await buildProjectBundle({ architecture, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', source: { mode: 'hosted', sourceRevision: 'abc123def456', status: 'complete', unsavedChanges: true }, exportedAt: new Date('2026-11-26T09:00:00Z') });
	assert.equal(built.fileName, 'production-network.cloudforge.zip');
	const entries = await readZip(built.bytes, limits);
	const paths = entries.map(entry => entry.path);
	assert.equal(paths[0], MANIFEST_PATH);
	for (const path of [ARCHITECTURE_PATH, 'terraform/main.tf', 'terraform/variables.tf', 'diagram/architecture.svg', 'README.md']) { assert.ok(paths.includes(path), path); }
	assert.equal(built.manifest.contents.resources, architecture.resources.length);
	assert.equal(built.manifest.contents.drawings, architecture.items.length);
	assert.ok(built.manifest.notes.some(note => note.includes('unsaved')));
	assert.doesNotMatch(entries.map(entry => text(entry.data)).join('\n'), /hunter2/);

	const opened = await readProjectBundle(built.bytes);
	assert.deepEqual(opened.warnings, []);
	assert.equal(opened.architecture.name, architecture.name);
	assert.deepEqual(opened.architecture.resources.map(resource => [resource.id, resource.positions]), architecture.resources.map(resource => [resource.id, resource.positions]));
	assert.deepEqual(opened.architecture.items.map(item => item.id), architecture.items.map(item => item.id));
	assert.equal(opened.architecture.connections.length, architecture.connections.length);
	assert.deepEqual(opened.architecture.variables?.map(variable => [variable.name, variable.value]), [['cost_centre', 'prod'], ['admin_password', undefined]]);
	assert.ok(opened.terraformFiles.includes('main.tf'));
	assert.ok(toBase64(built.bytes).length > 0);
});

test('import rejects non-bundles and tampered models', async () => {
	const plain = await writeZip([{ path: 'readme.txt', data: new TextEncoder().encode('hello') }]);
	await assert.rejects(readProjectBundle(plain), BundleError);
	await assert.rejects(readProjectBundle(new TextEncoder().encode('not a zip at all, just text')), /not a ZIP/);

	const built = await buildProjectBundle({ architecture: sampleArchitecture(), source: { mode: 'sample' } });
	const entries = await readZip(built.bytes, limits);
	const swapped = entries.map(entry => entry.path === ARCHITECTURE_PATH ? { ...entry, data: new TextEncoder().encode(text(entry.data).replace('Production network', 'Tampered network')) } : entry);
	await assert.rejects(readProjectBundle(await writeZip(swapped)), /manifest digest/);

	const future = entries.map(entry => entry.path === MANIFEST_PATH ? { ...entry, data: new TextEncoder().encode(text(entry.data).replace('"formatVersion": 1', '"formatVersion": 99')) } : entry);
	await assert.rejects(readProjectBundle(await writeZip(future)), /newer CloudForge/);
});

test('hosted import merges as one undo step and refuses duplicates', async () => {
	const imported = (await readProjectBundle((await buildProjectBundle({ architecture: withExtras(), source: { mode: 'sample' } })).bytes)).architecture;
	const empty: Architecture = { name: 'Workspace', resources: [], items: [], connections: [] };
	const merged = historyReducer(createHistory(empty), { type: 'mergeArchitecture', architecture: imported });
	assert.equal(merged.present.name, 'Workspace');
	assert.equal(merged.present.resources.length, imported.resources.length);
	assert.equal(merged.present.items.length, imported.items.length);
	assert.equal(merged.present.variables?.length, 2);
	assert.equal(merged.past.length, 1);
	assert.ok(bundleConflicts(merged.present, imported).length > 0);
	const again = historyReducer(merged, { type: 'mergeArchitecture', architecture: imported });
	assert.equal(again, merged, 'a second import of the same bundle is a no-op');
	assert.equal(historyReducer(merged, { type: 'undo' }).present.resources.length, 0);
});
