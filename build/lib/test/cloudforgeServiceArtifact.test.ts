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
import { stageServiceArtifact } from '../../cloudforge/serviceArtifact.ts';

const desktopCommit = 'a'.repeat(40);
const serviceCommit = 'b'.repeat(40);
const bytes = Buffer.from('Service artifact fixture. Never executed.');
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
		options: { artifactPath, expectedSha256: sha256, serviceCommit, protocolVersion: 'test-only', desktopCommit, appDirectory },
		output: path.join(appDirectory, 'cloudforge-service'),
		async dispose() {
			// mkdtemp creates this resolved child of the OS temporary directory for this test only.
			assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

suite('CloudForge service artifact', () => {
	test('stages matching bytes and records supplied provenance without changing product metadata', async () => {
		const f = await fixture();
		try {
			const result = await stageServiceArtifact({ ...f.options, expectedSha256: sha256.toUpperCase(), serviceCommit: serviceCommit.toUpperCase() });
			assert.deepStrictEqual({
				directory: result.directory,
				manifest: JSON.parse(await fs.readFile(path.join(f.output, 'service-manifest.json'), 'utf8')),
				copied: await fs.readFile(path.join(f.output, 'cloudforge-service.exe')),
				product: JSON.parse(await fs.readFile(path.join(f.options.appDirectory, 'product.json'), 'utf8')),
			}, {
				directory: f.output,
				manifest: { schemaVersion: 1, executable: 'cloudforge-service.exe', declaredTarget: 'win32-x64', serviceCommit, protocolVersion: 'test-only', desktopCommit, sha256, bytes: bytes.length },
				copied: bytes,
				product: { commit: desktopCommit },
			});
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
		'empty protocol version': { protocolVersion: '' },
		'protocol control character': { protocolVersion: 'test\nversion' },
		'protocol trailing newline': { protocolVersion: 'test\n' },
		'oversized protocol version': { protocolVersion: 'v'.repeat(65) },
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
				await fs.writeFile(path.join(f.output, 'service-manifest.json'), 'keep', { flag: 'wx' });
			}), /cleanup was incomplete/);
			assert.equal(await fs.readFile(path.join(f.output, 'service-manifest.json'), 'utf8'), 'keep');
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
			}, { fulfilled: 1, rejected: ['EEXIST'], files: ['cloudforge-service.exe', 'service-manifest.json'], copied: bytes });
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
			const staged = run(['--artifact', f.options.artifactPath, '--sha256', sha256, '--service-commit', serviceCommit, '--protocol', 'test-only', '--desktop-commit', desktopCommit, '--app-directory', f.options.appDirectory]);
			assert.deepStrictEqual({ status: staged.status, directory: JSON.parse(staged.stdout).directory }, { status: 0, directory: f.output });
		} finally {
			await f.dispose();
		}
	});
});
