/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { checkVsix, readZipEntries, updateProductJson, type PinnedExtension } from '../../cloudforge/pinOpenVsx.ts';

/** Minimal zip writer for fixtures: entries are deflated unless `store` is set. */
function makeZip(files: Record<string, string>, store = false): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const raw = Buffer.from(text);
		const data = store ? raw : deflateRawSync(raw);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(store ? 0 : 8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(store ? 0 : 8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBytes, data);
		centrals.push(central, nameBytes);
		offset += 30 + nameBytes.length + data.length;
	}
	const centralBytes = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(centralBytes.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBytes, end]);
}

const manifest = JSON.stringify({ name: 'jsoncrack-vscode', publisher: 'AykutSarac', version: '5.1.0', license: 'MIT' });

suite('CloudForge Open VSX pinning', () => {
	test('reads stored and deflated entries', () => {
		for (const store of [false, true]) {
			const entries = readZipEntries(makeZip({ 'a.txt': 'alpha', 'b.txt': 'beta' }, store), n => n === 'b.txt');
			assert.deepEqual([...entries.keys()], ['b.txt']);
			assert.equal(entries.get('b.txt')!.toString(), 'beta');
		}
	});

	test('accepts a matching MIT VSIX with a licence file', () => {
		const zip = makeZip({ 'extension/package.json': manifest, 'extension/LICENSE.md': 'MIT License', 'extension/build/extension.js': '' });
		assert.deepEqual(checkVsix(zip, 'AykutSarac.jsoncrack-vscode', '5.1.0', 'MIT'), ['extension/LICENSE.md']);
	});

	test('rejects the wrong id, version, licence or a missing licence file', () => {
		const good = { 'extension/package.json': manifest, 'extension/LICENSE.md': 'MIT License' };
		assert.throws(() => checkVsix(makeZip(good), 'Other.ext', '5.1.0', 'MIT'), /expected Other\.ext/);
		assert.throws(() => checkVsix(makeZip(good), 'AykutSarac.jsoncrack-vscode', '5.0.0', 'MIT'), /expected 5\.0\.0/);
		assert.throws(() => checkVsix(makeZip(good), 'AykutSarac.jsoncrack-vscode', '5.1.0', 'Apache-2.0'), /licence is MIT/);
		assert.throws(() => checkVsix(makeZip({ 'extension/package.json': manifest }), 'AykutSarac.jsoncrack-vscode', '5.1.0', 'MIT'), /no licence file/);
		assert.throws(() => checkVsix(Buffer.from('not a zip at all, just text padding for the scan'), 'a.b', '1', 'MIT'), /not a zip/);
	});

	test('adds or replaces the product.json entry and keeps tab formatting', () => {
		const original = JSON.stringify({ nameShort: 'CloudForge', builtInExtensions: [{ name: 'ms-vscode.js-debug', version: '1.140.1' }] }, null, '\t') + '\n';
		const entry: PinnedExtension = {
			name: 'AykutSarac.jsoncrack-vscode', version: '5.1.0', sha256: 'f'.repeat(64), repo: 'https://github.com/AykutSarac/jsoncrack.com',
			vsix: '.build/cloudforge/AykutSarac.jsoncrack-vscode.5.1.0.vsix',
			metadata: { id: 'x', publisherId: { publisherId: 'y', publisherName: 'AykutSarac', displayName: 'Aykut Saraç', flags: '' }, publisherDisplayName: 'Aykut Saraç' },
		};
		const added = updateProductJson(original, entry);
		assert.match(added, /^\{\n\t"nameShort"/);
		assert.deepEqual(JSON.parse(added).builtInExtensions.map((e: { name: string }) => e.name), ['ms-vscode.js-debug', 'AykutSarac.jsoncrack-vscode']);
		const replaced = updateProductJson(added, { ...entry, version: '5.2.0' });
		assert.equal(JSON.parse(replaced).builtInExtensions.length, 2);
		assert.equal(JSON.parse(replaced).builtInExtensions[1].version, '5.2.0');
	});
});
