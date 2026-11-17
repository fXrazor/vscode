/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test } from 'node:test';
import { stageServiceArtifact, verifyStagedService } from '../../cloudforge/serviceArtifact.ts';

const desktopCommit = 'a'.repeat(40);
const serviceCommit = 'b'.repeat(40);
// Inert fixture with one PE32+ section header and no executable code.
const peOffset = 0x80;
const optionalHeaderSize = 0xf0;
const bytes = Buffer.alloc(peOffset + 24 + optionalHeaderSize + 40);
bytes.write('MZ');
bytes.writeUInt32LE(peOffset, 0x3c);
bytes.write('PE\0\0', peOffset);
bytes.writeUInt16LE(0x8664, peOffset + 4); // AMD64
bytes.writeUInt16LE(1, peOffset + 6); // NumberOfSections
bytes.writeUInt16LE(optionalHeaderSize, peOffset + 20);
bytes.writeUInt16LE(0x0002, peOffset + 22); // Executable image
bytes.writeUInt16LE(0x020b, peOffset + 24); // PE32+
const sha256 = createHash('sha256').update(bytes).digest('hex');

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudforge-service-artifact-'));
	const appDirectory = path.join(root, 'app');
	const artifactPath = path.join(root, 'service.exe');
	await fs.mkdir(appDirectory);
	await fs.writeFile(path.join(appDirectory, 'product.json'), JSON.stringify({ commit: desktopCommit }));
	await fs.writeFile(artifactPath, bytes);
	return {
		root,
		options: { artifactPath, expectedSha256: sha256, serviceCommit, protocolVersion: 1, desktopCommit, appDirectory },
		output: path.join(appDirectory, 'cloudforge-service'),
		async dispose() {
			// mkdtemp creates this resolved child of the OS temporary directory for this test only.
			assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

suite('CloudForge service artifact', () => {
	test('stages matching bytes and writes the desktop runtime manifest without changing product metadata', async () => {
		const f = await fixture();
		try {
			const result = await stageServiceArtifact({ ...f.options, expectedSha256: sha256.toUpperCase(), serviceCommit: serviceCommit.toUpperCase() });
			const manifestBytes = await fs.readFile(path.join(f.output, 'manifest.json'));
			assert.deepStrictEqual({
				directory: result.directory,
				files: (await fs.readdir(f.output)).sort(),
				manifest: JSON.parse(manifestBytes.toString('utf8')),
				copied: await fs.readFile(path.join(f.output, 'cloudforge-service.exe')),
				product: JSON.parse(await fs.readFile(path.join(f.options.appDirectory, 'product.json'), 'utf8')),
			}, {
				directory: f.output,
				files: ['cloudforge-service.exe', 'manifest.json'],
				// Exactly the fields cloudForgeService.ts verifies before launching the service.
				manifest: { serviceCommit, protocolVersion: 1, architecture: 'x64', sha256 },
				copied: bytes,
				product: { commit: desktopCommit },
			});
			// The desktop reads at most 4 KiB with a fatal UTF-8 decoder; a BOM would break JSON.parse.
			assert.ok(manifestBytes.length <= 4 * 1024);
			assert.notEqual(manifestBytes[0], 0xef);
		} finally {
			await f.dispose();
		}
	});

	for (const [name, overrides] of Object.entries({
		'malformed hash': { expectedSha256: 'not-a-sha256' },
		'hash control character': { expectedSha256: `${'a'.repeat(63)}\n` },
		'malformed service commit': { serviceCommit: '../service' },
		'service commit control character': { serviceCommit: `${'b'.repeat(39)}\n` },
		'malformed desktop commit': { desktopCommit: 'abc' },
		'zero protocol version': { protocolVersion: 0 },
		'negative protocol version': { protocolVersion: -1 },
		'fractional protocol version': { protocolVersion: 1.5 },
		'non-finite protocol version': { protocolVersion: Number.NaN },
		'unsafe protocol version': { protocolVersion: Number.MAX_SAFE_INTEGER + 1 },
		'string protocol version': { protocolVersion: '1' as unknown as number },
	})) {
		test(`rejects ${name} before writing`, async () => {
			const f = await fixture();
			try {
				await assert.rejects(stageServiceArtifact({ ...f.options, ...overrides }));
				assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
			} finally {
				await f.dispose();
			}
		});
	}

	for (const kind of ['tampered', 'empty', 'missing', 'directory'] as const) {
		test(`rejects a ${kind} artifact without creating a bundle`, async () => {
			const f = await fixture();
			try {
				await fs.unlink(f.options.artifactPath);
				if (kind === 'directory') {
					await fs.mkdir(f.options.artifactPath);
				} else if (kind !== 'missing') {
					await fs.writeFile(f.options.artifactPath, kind === 'empty' ? '' : 'changed');
				}
				await assert.rejects(stageServiceArtifact(f.options));
				assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
			} finally {
				await f.dispose();
			}
		});
	}

	test('rejects symbolic-link artifacts and app directories', async () => {
		const f = await fixture();
		try {
			// Directory junctions work without Windows symbolic-link privileges.
			const linkedDirectory = path.join(f.root, 'linked');
			await fs.symlink(f.options.appDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
			await assert.rejects(stageServiceArtifact({ ...f.options, appDirectory: linkedDirectory }), /existing directory/);
			await assert.rejects(stageServiceArtifact({ ...f.options, artifactPath: linkedDirectory }), /regular file/);
			assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
		} finally {
			await f.dispose();
		}
	});

	test('rejects a symbolic link to a regular artifact file', async context => {
		const f = await fixture();
		try {
			const link = path.join(f.root, 'linked.exe');
			try {
				await fs.symlink(f.options.artifactPath, link, 'file');
			} catch (error) {
				if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
					context.skip('Windows file symbolic-link privileges are unavailable; directory junctions are covered separately.');
					return;
				}
				throw error;
			}
			await assert.rejects(stageServiceArtifact({ ...f.options, artifactPath: link }), /regular file/);
			assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
		} finally {
			await f.dispose();
		}
	});

	for (const kind of ['missing app', 'app file', 'missing product', 'product directory', 'oversized product'] as const) {
		test(`rejects an invalid package: ${kind}`, async () => {
			const f = await fixture();
			try {
				const productPath = path.join(f.options.appDirectory, 'product.json');
				await fs.unlink(productPath);
				if (kind === 'missing app' || kind === 'app file') {
					await fs.rmdir(f.options.appDirectory);
					if (kind === 'app file') {
						await fs.writeFile(f.options.appDirectory, 'keep');
					}
				} else if (kind === 'product directory') {
					await fs.mkdir(productPath);
				} else if (kind === 'oversized product') {
					await fs.writeFile(productPath, Buffer.alloc(1024 * 1024 + 1));
				}
				await assert.rejects(stageServiceArtifact(f.options));
				await assert.rejects(fs.lstat(f.output));
			} finally {
				await f.dispose();
			}
		});
	}

	for (const product of ['{}', 'null', 'invalid json', JSON.stringify({ commit: serviceCommit })]) {
		test(`rejects incompatible product metadata: ${product}`, async () => {
			const f = await fixture();
			try {
				await fs.writeFile(path.join(f.options.appDirectory, 'product.json'), product);
				await assert.rejects(stageServiceArtifact(f.options));
				assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
			} finally {
				await f.dispose();
			}
		});
	}

	for (const kind of ['directory', 'file', 'junction'] as const) {
		test(`preserves an existing staging ${kind}`, async () => {
			const f = await fixture();
			try {
				if (kind === 'file') {
					await fs.writeFile(f.output, 'keep');
				} else if (kind === 'junction') {
					await fs.symlink(f.options.appDirectory, f.output, process.platform === 'win32' ? 'junction' : 'dir');
				} else {
					await fs.mkdir(f.output);
					await fs.writeFile(path.join(f.output, 'keep'), 'keep');
				}
				await assert.rejects(stageServiceArtifact(f.options), { code: 'EEXIST' });
				assert.equal(kind === 'junction' ? (await fs.lstat(f.output)).isSymbolicLink() : await fs.readFile(kind === 'file' ? f.output : path.join(f.output, 'keep'), 'utf8'), kind === 'junction' ? true : 'keep');
			} finally {
				await f.dispose();
			}
		});
	}

	for (const kind of ['corrupt copy', 'partial copy failure'] as const) {
		test(`removes its own incomplete bundle after a ${kind}`, async () => {
			const f = await fixture();
			try {
				await assert.rejects(stageServiceArtifact(f.options, async (_source, destination) => {
					await destination.writeFile('changed during copy');
					if (kind === 'partial copy failure') {
						throw new Error('Simulated interrupted copy');
					}
				}));
				assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
			} finally {
				await f.dispose();
			}
		});
	}

	test('reports incomplete cleanup and preserves unrelated files introduced during a failed copy', async () => {
		const f = await fixture();
		try {
			await assert.rejects(stageServiceArtifact(f.options, async () => {
				await fs.writeFile(path.join(f.output, 'unrelated'), 'keep');
				throw new Error('Simulated interrupted copy');
			}), /cleanup was incomplete/);
			assert.deepStrictEqual(await fs.readdir(f.output), ['unrelated']);
		} finally {
			await f.dispose();
		}
	});

	test('preserves a manifest introduced by another writer during the copy', async () => {
		const f = await fixture();
		try {
			await assert.rejects(stageServiceArtifact(f.options, async (_source, destination) => {
				await destination.writeFile(bytes);
				await fs.writeFile(path.join(f.output, 'manifest.json'), 'keep', { flag: 'wx' });
			}), /cleanup was incomplete/);
			assert.equal(await fs.readFile(path.join(f.output, 'manifest.json'), 'utf8'), 'keep');
		} finally {
			await f.dispose();
		}
	});

	test('allows only one concurrent writer to publish a complete bundle', async () => {
		const f = await fixture();
		try {
			const results = await Promise.allSettled([stageServiceArtifact(f.options), stageServiceArtifact(f.options)]);
			assert.deepStrictEqual({
				fulfilled: results.filter(result => result.status === 'fulfilled').length,
				rejected: results.filter(result => result.status === 'rejected').map(result => result.reason.code),
				files: await fs.readdir(f.output),
				copied: await fs.readFile(path.join(f.output, 'cloudforge-service.exe')),
			}, { fulfilled: 1, rejected: ['EEXIST'], files: ['cloudforge-service.exe', 'manifest.json'], copied: bytes });
		} finally {
			await f.dispose();
		}
	});

	test('CLI rejects missing/unknown options and stages a fixture without executing it', async () => {
		const f = await fixture();
		try {
			const script = path.resolve(import.meta.dirname, '../../cloudforge/serviceArtifact.ts');
			const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
			assert.deepStrictEqual({ missing: run([]).status, unknown: run(['--unknown']).status, help: run(['--help']).status }, { missing: 1, unknown: 1, help: 0 });
			const args = (protocol: string) => ['--artifact', f.options.artifactPath, '--sha256', sha256, '--service-commit', serviceCommit, '--protocol', protocol, '--desktop-commit', desktopCommit, '--app-directory', f.options.appDirectory];
			assert.deepStrictEqual(['0', '01', '1.0', '1x', 'test-only', ''].map(protocol => run(args(protocol)).status), [1, 1, 1, 1, 1, 1]);
			assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);
			const staged = run(args('1'));
			assert.deepStrictEqual({ status: staged.status, directory: JSON.parse(staged.stdout).directory, protocolVersion: JSON.parse(staged.stdout).manifest.protocolVersion }, { status: 0, directory: f.output, protocolVersion: 1 });
		} finally {
			await f.dispose();
		}
	});
});

suite('CloudForge staged service verification', () => {
	async function staged() {
		const f = await fixture();
		await stageServiceArtifact(f.options);
		return {
			...f,
			manifestPath: path.join(f.output, 'manifest.json'),
			executablePath: path.join(f.output, 'cloudforge-service.exe'),
			async snapshot() {
				const files = (await fs.readdir(f.output)).sort();
				return Promise.all(files.map(async name => [name, await fs.readFile(path.join(f.output, name))] as const));
			},
		};
	}

	const manifest = { serviceCommit, protocolVersion: 1, architecture: 'x64', sha256 };

	const invalidHeaders: [string, (header: Buffer) => void, RegExp][] = [
		['x86', header => header.writeUInt16LE(0x014c, peOffset + 4), /must target Windows x64/],
		['ARM64', header => header.writeUInt16LE(0xaa64, peOffset + 4), /must target Windows x64/],
		['DLL', header => header.writeUInt16LE(0x2002, peOffset + 22), /must be a Windows PE executable image/],
		['object file', header => header.writeUInt16LE(0, peOffset + 22), /must be a Windows PE executable image/],
		['missing MZ signature', header => header.writeUInt16LE(0, 0), /invalid Windows PE headers/],
		['missing PE signature', header => header.writeUInt32LE(0, peOffset), /invalid Windows PE headers/],
		['out-of-bounds PE header', header => header.writeUInt32LE(0xffffffff, 0x3c), /invalid Windows PE headers/],
		['PE32 optional header', header => header.writeUInt16LE(0x010b, peOffset + 24), /invalid Windows PE headers/],
		['truncated section table', header => header.writeUInt16LE(2, peOffset + 6), /invalid Windows PE headers/],
	];
	for (const [name, changeHeader, message] of invalidHeaders) {
		test(`rejects ${name} even when the executable matches the expected digest`, async () => {
			const f = await fixture();
			try {
				const invalid = Buffer.from(bytes);
				changeHeader(invalid);
				const digest = createHash('sha256').update(invalid).digest('hex');
				await fs.writeFile(f.options.artifactPath, invalid);
				await assert.rejects(stageServiceArtifact({ ...f.options, expectedSha256: digest }), message);
				assert.deepStrictEqual(await fs.readdir(f.options.appDirectory), ['product.json']);

				// A matching manifest also cannot make an invalid binary pass the read-only gate.
				await fs.mkdir(f.output);
				const executablePath = path.join(f.output, 'cloudforge-service.exe');
				const manifestPath = path.join(f.output, 'manifest.json');
				const invalidManifest = JSON.stringify({ ...manifest, sha256: digest });
				await fs.writeFile(executablePath, invalid);
				await fs.writeFile(manifestPath, invalidManifest);
				await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), message);
				assert.deepStrictEqual(await fs.readFile(executablePath), invalid);
				assert.strictEqual(await fs.readFile(manifestPath, 'utf8'), invalidManifest);
			} finally {
				await f.dispose();
			}
		});
	}

	test('accepts a freshly staged folder with only the required protocol or every expectation pinned, read-only', async () => {
		const f = await staged();
		try {
			const before = await f.snapshot();
			const loose = await verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 });
			const pinned = await verifyStagedService({
				appDirectory: f.options.appDirectory,
				expectedSha256: sha256.toUpperCase(),
				expectedServiceCommit: serviceCommit.toUpperCase(),
				expectedProtocolVersion: 1,
				desktopCommit,
			});
			assert.deepStrictEqual({ loose, pinned }, {
				loose: { directory: f.output, manifest, size: bytes.length },
				pinned: { directory: f.output, manifest, size: bytes.length },
			});
			assert.deepStrictEqual(await f.snapshot(), before);
		} finally {
			await f.dispose();
		}
	});

	test('rejects an executable rewritten after staging, as signing would, without changing the folder', async () => {
		const f = await staged();
		try {
			await fs.appendFile(f.executablePath, 'appended signature');
			const before = await f.snapshot();
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), /does not match its manifest\. Restage after signing/);
			assert.deepStrictEqual(await f.snapshot(), before);
		} finally {
			await f.dispose();
		}
	});

	const expectationCases: [string, Partial<Parameters<typeof verifyStagedService>[0]>, RegExp][] = [
		['different digest', { expectedSha256: 'c'.repeat(64) }, /SHA-256 does not match the expected digest/],
		['different service commit', { expectedServiceCommit: 'c'.repeat(40) }, /commit does not match the expected service commit/],
		['different protocol', { expectedProtocolVersion: 2 }, /protocol version does not match/],
		['different desktop commit', { desktopCommit: 'c'.repeat(40) }, /product commit does not match/],
		['malformed digest expectation', { expectedSha256: 'xyz' }, /exactly 64 hexadecimal/],
		['malformed protocol expectation', { expectedProtocolVersion: 0 }, /positive integer/],
	];
	for (const [name, overrides, message] of expectationCases) {
		test(`rejects a ${name}`, async () => {
			const f = await staged();
			try {
				await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1, ...overrides }), message);
			} finally {
				await f.dispose();
			}
		});
	}

	const manifestCases: [string, string | Buffer, RegExp][] = [
		['byte-order mark', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(manifest))]), /byte-order mark/],
		['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d]), /valid UTF-8 JSON/],
		['non-object JSON', '[]', /JSON object/],
		['extra field', JSON.stringify({ ...manifest, extra: true }), /exactly architecture, protocolVersion, serviceCommit, sha256/],
		['missing field', JSON.stringify({ serviceCommit, architecture: 'x64', sha256 }), /exactly architecture/],
		['wrong architecture', JSON.stringify({ ...manifest, architecture: 'arm64' }), /architecture must be x64/],
		['uppercase digest', JSON.stringify({ ...manifest, sha256: sha256.toUpperCase() }), /sha256 must be 64 lowercase/],
		['uppercase commit', JSON.stringify({ ...manifest, serviceCommit: serviceCommit.toUpperCase() }), /serviceCommit must be 40 lowercase/],
		['string protocol', JSON.stringify({ ...manifest, protocolVersion: '1' }), /protocolVersion must be a positive integer/],
		['zero protocol', JSON.stringify({ ...manifest, protocolVersion: 0 }), /protocolVersion must be a positive integer/],
		['negative protocol', JSON.stringify({ ...manifest, protocolVersion: -1 }), /protocolVersion must be a positive integer/],
		['fractional protocol', JSON.stringify({ ...manifest, protocolVersion: 1.5 }), /protocolVersion must be a positive integer/],
		// The desktop launches only its own protocol, so another valid version must fail the gate too.
		['other protocol than required', JSON.stringify({ ...manifest, protocolVersion: 2 }), /protocol version does not match/],
		['one byte over the limit', JSON.stringify(manifest).padEnd(4 * 1024 + 1, ' '), /exceeds the desktop runtime limit/],
	];
	for (const [name, content, message] of manifestCases) {
		test(`rejects a manifest with ${name}`, async () => {
			const f = await staged();
			try {
				await fs.writeFile(f.manifestPath, content);
				await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), message);
			} finally {
				await f.dispose();
			}
		});
	}

	test('accepts a manifest of exactly the desktop limit', async () => {
		const f = await staged();
		try {
			await fs.writeFile(f.manifestPath, JSON.stringify(manifest).padEnd(4 * 1024, ' '));
			assert.equal((await fs.stat(f.manifestPath)).size, 4 * 1024);
			assert.deepStrictEqual((await verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 })).manifest, manifest);
		} finally {
			await f.dispose();
		}
	});

	test('rejects a missing folder, extra content, a missing manifest, and an empty executable', async () => {
		const f = await fixture();
		try {
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), { code: 'ENOENT' });
			await stageServiceArtifact(f.options);
			const extra = path.join(f.output, 'stale.dll');
			await fs.writeFile(extra, 'stale');
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), /must hold exactly/);
			await fs.rm(extra);
			const manifestBytes = await fs.readFile(path.join(f.output, 'manifest.json'));
			await fs.rm(path.join(f.output, 'manifest.json'));
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), /must hold exactly/);
			await fs.writeFile(path.join(f.output, 'manifest.json'), manifestBytes);
			await fs.writeFile(path.join(f.output, 'cloudforge-service.exe'), '');
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), /nonempty regular file/);
		} finally {
			await f.dispose();
		}
	});

	test('rejects a junctioned service folder', async () => {
		const f = await staged();
		try {
			const elsewhere = path.join(f.root, 'elsewhere');
			await fs.rename(f.output, elsewhere);
			await fs.symlink(elsewhere, f.output, 'junction');
			await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), /regular directory, not a link/);
		} finally {
			await f.dispose();
		}
	});

	for (const [name, message] of [['manifest.json', /manifest must be a regular file, not a link/], ['cloudforge-service.exe', /executable must be a nonempty regular file, not a symbolic link/]] as const) {
		test(`rejects a symbolically linked ${name}`, async t => {
			const f = await staged();
			try {
				const target = path.join(f.root, name);
				await fs.rename(path.join(f.output, name), target);
				try {
					await fs.symlink(target, path.join(f.output, name), 'file');
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'EPERM') {
						// Windows file symbolic links need Developer Mode or elevation. Report a skip, not a pass.
						t.skip('file symbolic links are not permitted for this user');
						return;
					}
					throw error;
				}
				await assert.rejects(verifyStagedService({ appDirectory: f.options.appDirectory, expectedProtocolVersion: 1 }), message);
			} finally {
				await f.dispose();
			}
		});
	}

	test('CLI verifies a staged fixture, reports drift with exit code 1, and rejects --artifact in verify mode', async () => {
		const f = await staged();
		try {
			const script = path.resolve(import.meta.dirname, '../../cloudforge/serviceArtifact.ts');
			const run = (args: string[]) => spawnSync(process.execPath, [script, '--verify', ...args], { encoding: 'utf8' });
			const app = ['--app-directory', f.options.appDirectory];
			const ok = run([...app, '--sha256', sha256, '--service-commit', serviceCommit, '--protocol', '1', '--desktop-commit', desktopCommit]);
			assert.deepStrictEqual({ status: ok.status, result: JSON.parse(ok.stdout) }, { status: 0, result: { directory: f.output, manifest, size: bytes.length } });
			const statuses = (cases: Record<string, string[]>) => Object.fromEntries(Object.entries(cases).map(([name, args]) => [name, run(args).status]));
			assert.deepStrictEqual(statuses({
				missingApp: ['--protocol', '1'],
				missingProtocol: app,
				withArtifact: [...app, '--protocol', '1', '--artifact', f.options.artifactPath],
				badProtocol: [...app, '--protocol', '01'],
				otherProtocol: [...app, '--protocol', '2'],
				otherSha256: [...app, '--protocol', '1', '--sha256', 'c'.repeat(64)],
				otherServiceCommit: [...app, '--protocol', '1', '--service-commit', 'c'.repeat(40)],
				otherDesktopCommit: [...app, '--protocol', '1', '--desktop-commit', 'c'.repeat(40)],
			}), { missingApp: 1, missingProtocol: 1, withArtifact: 1, badProtocol: 1, otherProtocol: 1, otherSha256: 1, otherServiceCommit: 1, otherDesktopCommit: 1 });
			await fs.appendFile(f.executablePath, 'signed');
			const drift = run([...app, '--protocol', '1']);
			assert.equal(drift.status, 1);
			assert.match(drift.stderr, /^CloudForge service verification failed: .*Restage after signing/);
		} finally {
			await f.dispose();
		}
	});
});
