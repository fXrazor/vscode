/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../base/test/node/testUtils.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import { cloudForgeServiceEnvironment, CloudForgeServiceProcess, readCloudForgeInitializeReply, safeServiceError } from '../../electron-main/cloudForgeService.js';

const commit = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);

function frame(body: string | Buffer, header?: string): Buffer {
	const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
	return Buffer.concat([Buffer.from(header ?? `Content-Length: ${bytes.length}\r\n\r\n`, 'latin1'), bytes]);
}

function reply(value: unknown): Buffer {
	return frame(JSON.stringify(value));
}

function success(result: unknown = { protocolVersion: 1, serviceCommit: commit }): Buffer {
	return reply({ jsonrpc: '2.0', id: 'startup', result });
}

async function* chunks(...values: Buffer[]): AsyncIterable<Buffer> {
	for (const value of values) {
		yield value;
	}
}

function bytewise(value: Buffer): Buffer[] {
	return Array.from(value, byte => Buffer.of(byte));
}

async function rejection(stream: AsyncIterable<Buffer>, expectedCommit = commit): Promise<string> {
	try {
		await readCloudForgeInitializeReply(stream, expectedCommit);
	} catch (error) {
		assert.ok(error instanceof Error);
		return error.message;
	}
	assert.fail('Expected the initialize reply to be rejected.');
}

class CapturingLogService extends NullLogService {
	readonly errors: unknown[] = [];
	readonly infos: unknown[] = [];
	override error(message: string | Error): void { this.errors.push(message); }
	override info(message: string): void { this.infos.push(message); }
}

suite('CloudForge service', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('initialize reply', () => {

		test('accepts a reply delivered in one chunk', async () => {
			await readCloudForgeInitializeReply(chunks(success()), commit);
		});

		test('accepts a reply delivered one byte at a time', async () => {
			await readCloudForgeInitializeReply(chunks(...bytewise(success())), commit);
		});

		test('accepts a delimiter split across chunks', async () => {
			const bytes = success();
			const split = bytes.indexOf('\r\n\r\n') + 3;
			await readCloudForgeInitializeReply(chunks(bytes.subarray(0, split), bytes.subarray(split)), commit);
		});

		test('ignores unknown result fields', async () => {
			await readCloudForgeInitializeReply(chunks(success({ protocolVersion: 1, serviceCommit: commit, serviceVersion: '0.1.0' })), commit);
		});

		test('maps service error codes', async () => {
			const error = (code: number) => chunks(reply({ jsonrpc: '2.0', id: 'startup', error: { code, message: 'rejected' } }));
			assert.strictEqual(await rejection(error(-32001)), 'PROTOCOL_MISMATCH');
			assert.strictEqual(await rejection(error(-32002)), 'SERVICE_COMMIT_MISMATCH');
			assert.strictEqual(await rejection(error(-32600)), 'INITIALIZE_REJECTED');
		});

		test('rejects a negotiated identity that differs from the package', async () => {
			assert.strictEqual(await rejection(chunks(success({ protocolVersion: 2, serviceCommit: commit }))), 'PROTOCOL_MISMATCH');
			assert.strictEqual(await rejection(chunks(success({ protocolVersion: '1', serviceCommit: commit }))), 'PROTOCOL_MISMATCH');
			assert.strictEqual(await rejection(chunks(success({ protocolVersion: 1, serviceCommit: otherCommit }))), 'SERVICE_COMMIT_MISMATCH');
			assert.strictEqual(await rejection(chunks(success({ protocolVersion: 1, serviceCommit: commit.toUpperCase() }))), 'SERVICE_COMMIT_MISMATCH');
		});

		test('rejects malformed JSON-RPC envelopes', async () => {
			for (const value of [
				{ jsonrpc: '1.0', id: 'startup', result: { protocolVersion: 1, serviceCommit: commit } },
				{ jsonrpc: '2.0', id: 'other', result: { protocolVersion: 1, serviceCommit: commit } },
				{ jsonrpc: '2.0', id: 'startup' },
				{ jsonrpc: '2.0', id: 'startup', result: { protocolVersion: 1, serviceCommit: commit }, error: { code: -32001 } },
				{ jsonrpc: '2.0', id: 'startup', result: null, error: { code: -32001 } },
				{ jsonrpc: '2.0', id: 'startup', result: 'ok' },
				{ jsonrpc: '2.0', id: 'startup', error: 'rejected' },
			]) {
				assert.strictEqual(await rejection(chunks(reply(value))), 'INVALID_INITIALIZE_RESPONSE', JSON.stringify(value));
			}
		});

		test('rejects bodies that are not a UTF-8 JSON object', async () => {
			for (const body of [Buffer.from('not json'), Buffer.from('[]'), Buffer.from('null'), Buffer.of(0x7b, 0xff, 0x7d)]) {
				assert.strictEqual(await rejection(chunks(frame(body))), 'INVALID_JSON', body.toString('hex'));
			}
		});

		test('rejects invalid frame lengths', async () => {
			const body = JSON.stringify({ jsonrpc: '2.0', id: 'startup', result: { protocolVersion: 1, serviceCommit: commit } });
			for (const header of [
				'Content-Length: 0\r\n\r\n',
				'Content-Length: -1\r\n\r\n',
				'Content-Length: 1.5\r\n\r\n',
				`Content-Length: ${8 * 1024 * 1024 + 1}\r\n\r\n`,
				'Content-Length: 99999999999999999999\r\n\r\n',
				`content-length: ${body.length}\r\n\r\n`,
				`Content-Length:${body.length}\r\n\r\n`,
				`Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
				'\r\n\r\n',
			]) {
				assert.strictEqual(await rejection(chunks(frame(body, header))), 'INVALID_FRAME_LENGTH', JSON.stringify(header));
			}
		});

		test('rejects a header without a delimiter within 4 KiB', async () => {
			assert.strictEqual(await rejection(chunks(Buffer.alloc(4096, 0x61))), 'INVALID_FRAME_HEADER');
			assert.strictEqual(await rejection(chunks(...Array.from({ length: 5 }, () => Buffer.alloc(1024, 0x61)))), 'INVALID_FRAME_HEADER');
		});

		test('rejects bytes after the initialize frame', async () => {
			assert.strictEqual(await rejection(chunks(Buffer.concat([success(), Buffer.from('x')]))), 'UNEXPECTED_SERVICE_OUTPUT');
			assert.strictEqual(await rejection(chunks(Buffer.concat([success(), success()]))), 'UNEXPECTED_SERVICE_OUTPUT');
		});

		test('rejects end of stream before a complete reply', async () => {
			const bytes = success();
			assert.strictEqual(await rejection(chunks()), 'SERVICE_EOF_BEFORE_INITIALIZE');
			assert.strictEqual(await rejection(chunks(bytes.subarray(0, 10))), 'SERVICE_EOF_BEFORE_INITIALIZE');
			assert.strictEqual(await rejection(chunks(bytes.subarray(0, bytes.length - 1))), 'SERVICE_EOF_BEFORE_INITIALIZE');
		});
	});

	test('maps request error objects to fixed codes', () => {
		const errors: unknown[] = [
			{ code: -32009, message: 'consent', data: { kind: 'CONSENT_REQUIRED' } },
			{ code: -32010, message: 'exists', data: { kind: 'ALREADY_EXISTS' } },
			{ code: -32602, message: 'bad name C:\secret', data: { kind: 'INVALID_PARAMS' } },
			{ code: -32602, message: 'other', data: { kind: 'SOMETHING_ELSE' } },
			{ code: -32004, message: 'denied' },
			{ code: -32099, message: 'unknown' },
			'not an object',
		];
		assert.deepStrictEqual(errors.map(error => {
			const mapped = safeServiceError(error);
			return [mapped.code, mapped.kind, mapped.message];
		}), [
			['CONSENT_REQUIRED', 'CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
			['ALREADY_EXISTS', 'ALREADY_EXISTS', 'ALREADY_EXISTS'],
			['INVALID_PARAMS', 'INVALID_PARAMS', 'INVALID_PARAMS'],
			['SERVICE_ERROR', 'SOMETHING_ELSE', 'SERVICE_ERROR'],
			['SCOPE_DENIED', 'SCOPE_DENIED', 'SCOPE_DENIED'],
			['SERVICE_ERROR', undefined, 'SERVICE_ERROR'],
			['SERVICE_ERROR', undefined, 'SERVICE_ERROR'],
		]);
	});

	test('gives the service the Windows folders it needs and nothing else', () => {
		const environment = cloudForgeServiceEnvironment({
			LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
			ProgramFiles: 'C:\\Program Files',
			SystemRoot: 'C:\\WINDOWS',
			windir: 'C:\\WINDOWS',
			TEMP: '',
			PATH: 'C:\\tools',
			GITHUB_TOKEN: 'sentinel',
			CLOUDFORGE_SERVICE_DATA_DIR: 'C:\\elsewhere',
		});
		assert.deepStrictEqual(environment, {
			LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
			ProgramFiles: 'C:\\Program Files',
			SystemRoot: 'C:\\WINDOWS',
			windir: 'C:\\WINDOWS',
		});
	});

	suite('package verification', () => {

		// The fixture executable holds inert bytes. These cases must fail before any spawn.
		const executableBytes = Buffer.from('inert CloudForge test fixture, never executed');
		const executableSha256 = createHash('sha256').update(executableBytes).digest('hex');
		let appRoot: string;
		let serviceDirectory: string;

		setup(() => {
			appRoot = getRandomTestPath(tmpdir(), 'vsctests', 'cloudforgeservice');
			serviceDirectory = join(appRoot, 'cloudforge-service');
			fs.mkdirSync(serviceDirectory, { recursive: true });
		});

		teardown(() => {
			fs.rmSync(appRoot, { recursive: true, force: true });
		});

		function writeService(manifest: string | Record<string, unknown>, executable: Buffer | null = executableBytes): void {
			fs.writeFileSync(join(serviceDirectory, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
			if (executable) {
				fs.writeFileSync(join(serviceDirectory, 'cloudforge-service.exe'), executable);
			}
		}

		function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
			return { serviceCommit: commit, protocolVersion: 1, architecture: 'x64', sha256: executableSha256, ...overrides };
		}

		async function startError(): Promise<unknown[]> {
			const logService = new CapturingLogService();
			const service = new CloudForgeServiceProcess(appRoot, logService);
			await service.start();
			await service.stop();
			assert.strictEqual((service as unknown as { child: unknown }).child, undefined, 'The service must not be spawned.');
			assert.deepStrictEqual(logService.infos, []);
			return logService.errors;
		}

		test('reports a missing manifest', async () => {
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] MANIFEST_UNAVAILABLE']);
		});

		test('reports a manifest path that is a directory', async () => {
			fs.mkdirSync(join(serviceDirectory, 'manifest.json'));
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] MANIFEST_UNAVAILABLE']);
		});

		test('rejects a manifest larger than 4 KiB', async () => {
			const manifest = JSON.stringify(validManifest());
			writeService(manifest + ' '.repeat(4097 - manifest.length));
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] MANIFEST_TOO_LARGE']);
		});

		test('reads a manifest of exactly 4 KiB', async () => {
			// A wrong digest proves the size and shape checks passed without spawning.
			const manifest = JSON.stringify(validManifest({ sha256: 'c'.repeat(64) }));
			writeService(manifest + ' '.repeat(4096 - manifest.length));
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] SERVICE_HASH_MISMATCH']);
		});

		test('rejects a manifest that is not a JSON object', async () => {
			for (const manifest of ['', '{', '[]', 'null']) {
				writeService(manifest);
				assert.deepStrictEqual(await startError(), ['[CloudForge Service] INVALID_JSON'], JSON.stringify(manifest));
			}
		});

		test('rejects invalid manifest fields', async () => {
			for (const overrides of [
				{ architecture: 'arm64' },
				{ architecture: undefined },
				{ serviceCommit: commit.slice(1) },
				{ serviceCommit: commit.toUpperCase() },
				{ serviceCommit: 1 },
				{ sha256: executableSha256.toUpperCase() },
				{ sha256: executableSha256 + '0' },
				{ sha256: undefined },
			]) {
				writeService(validManifest(overrides));
				assert.deepStrictEqual(await startError(), ['[CloudForge Service] INVALID_MANIFEST'], JSON.stringify(overrides));
			}
		});

		test('rejects a different protocol version', async () => {
			for (const protocolVersion of [2, 0, '1', undefined]) {
				writeService(validManifest({ protocolVersion }));
				assert.deepStrictEqual(await startError(), ['[CloudForge Service] PROTOCOL_MISMATCH'], String(protocolVersion));
			}
		});

		test('reports a missing executable', async () => {
			writeService(validManifest(), null);
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] SERVICE_UNAVAILABLE']);
		});

		test('rejects an executable whose digest differs', async () => {
			writeService(validManifest(), Buffer.concat([executableBytes, Buffer.of(0)]));
			assert.deepStrictEqual(await startError(), ['[CloudForge Service] SERVICE_HASH_MISMATCH']);
		});

		test('does not spawn or log when stopped during verification', async () => {
			writeService(validManifest());
			const logService = new CapturingLogService();
			const service = new CloudForgeServiceProcess(appRoot, logService);
			const started = service.start();
			await service.stop();
			await started;
			assert.strictEqual((service as unknown as { child: unknown }).child, undefined);
			assert.deepStrictEqual(logService.errors, []);
			assert.deepStrictEqual(logService.infos, []);
		});

		test('stop before start is a no-op', async () => {
			const service = new CloudForgeServiceProcess(appRoot, new CapturingLogService());
			await service.stop();
			await service.stop();
		});
	});
});
