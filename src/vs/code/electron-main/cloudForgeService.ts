/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { join } from '../../base/common/path.js';
import type { ILogService } from '../../platform/log/common/log.js';

const protocolVersion = 1;
const requestId = 'startup';
const maxHeaderBytes = 4 * 1024;
const maxResponseBytes = 8 * 1024 * 1024;
const initializeTimeoutMs = 5000;
const shutdownTimeoutMs = 1500;
const headerEnd = Buffer.from('\r\n\r\n');
const commitPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;

class ServiceError extends Error { }

function parseObject(bytes: Buffer): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (isRecord(value)) {
			return value;
		}
	} catch {
		// Never log the wire payload.
	}
	throw new ServiceError('INVALID_JSON');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ServiceManifest {
	readonly serviceCommit: string;
	readonly sha256: string;
}

async function verifyPackage(executable: string, manifestPath: string): Promise<ServiceManifest> {
	let manifest: Record<string, unknown>;
	try {
		const file = await open(manifestPath);
		try {
			const bytes = Buffer.alloc(maxHeaderBytes + 1);
			const { bytesRead } = await file.read(bytes);
			if (bytesRead > maxHeaderBytes) {
				throw new ServiceError('MANIFEST_TOO_LARGE');
			}
			manifest = parseObject(bytes.subarray(0, bytesRead));
		} finally {
			await file.close();
		}
	} catch (error) {
		if (error instanceof ServiceError) {
			throw error;
		}
		throw new ServiceError('MANIFEST_UNAVAILABLE');
	}

	const { architecture, serviceCommit, sha256 } = manifest;
	if (architecture !== 'x64' || typeof serviceCommit !== 'string' || !commitPattern.test(serviceCommit) || typeof sha256 !== 'string' || !hashPattern.test(sha256)) {
		throw new ServiceError('INVALID_MANIFEST');
	}
	if (manifest.protocolVersion !== protocolVersion) {
		throw new ServiceError('PROTOCOL_MISMATCH');
	}

	const hash = createHash('sha256');
	try {
		for await (const bytes of createReadStream(executable)) {
			hash.update(bytes);
		}
	} catch {
		throw new ServiceError('SERVICE_UNAVAILABLE');
	}
	if (hash.digest('hex') !== sha256) {
		throw new ServiceError('SERVICE_HASH_MISMATCH');
	}
	return { serviceCommit, sha256 };
}

export async function readCloudForgeInitializeReply(stream: AsyncIterable<Buffer>, expectedCommit: string): Promise<void> {
	let header = Buffer.alloc(0);
	let body: Buffer | undefined;
	let offset = 0;
	for await (const rawChunk of stream) {
		let chunk = rawChunk;
		if (!body) {
			const prefix = chunk.subarray(0, maxHeaderBytes - header.length);
			const previousHeaderLength = header.length;
			header = Buffer.concat([header, prefix]);
			const delimiter = header.indexOf(headerEnd);
			if (delimiter === -1) {
				if (header.length >= maxHeaderBytes) {
					throw new ServiceError('INVALID_FRAME_HEADER');
				}
				continue;
			}

			const line = header.subarray(0, delimiter).toString('latin1');
			const length = /^Content-Length: ([0-9]+)$/.exec(line)?.[1];
			const bodyLength = length === undefined ? 0 : Number(length);
			if (!Number.isSafeInteger(bodyLength) || bodyLength <= 0 || bodyLength > maxResponseBytes) {
				throw new ServiceError('INVALID_FRAME_LENGTH');
			}
			body = Buffer.alloc(bodyLength);
			chunk = chunk.subarray(delimiter + headerEnd.length - previousHeaderLength);
		}

		if (chunk.length > body.length - offset) {
			throw new ServiceError('UNEXPECTED_SERVICE_OUTPUT');
		}
		offset += chunk.copy(body, offset);
		if (offset !== body.length) {
			continue;
		}

		const reply = parseObject(body);
		if (reply.jsonrpc !== '2.0' || reply.id !== requestId || (reply.result === undefined) === (reply.error === undefined)) {
			throw new ServiceError('INVALID_INITIALIZE_RESPONSE');
		}
		if (isRecord(reply.error)) {
			if (reply.error.code === -32001) {
				throw new ServiceError('PROTOCOL_MISMATCH');
			}
			if (reply.error.code === -32002) {
				throw new ServiceError('SERVICE_COMMIT_MISMATCH');
			}
			throw new ServiceError('INITIALIZE_REJECTED');
		}
		if (!isRecord(reply.result)) {
			throw new ServiceError('INVALID_INITIALIZE_RESPONSE');
		}
		if (reply.result.protocolVersion !== protocolVersion) {
			throw new ServiceError('PROTOCOL_MISMATCH');
		}
		if (reply.result.serviceCommit !== expectedCommit) {
			throw new ServiceError('SERVICE_COMMIT_MISMATCH');
		}
		return;
	}
	throw new ServiceError('SERVICE_EOF_BEFORE_INITIALIZE');
}

async function withTimeout<T>(operation: Promise<T>, ms: number, code: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new ServiceError(code)), ms);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

export class CloudForgeServiceProcess {
	private child: ChildProcessWithoutNullStreams | undefined;
	private closed: Promise<void> | undefined;
	private stopping = false;
	private stopPromise: Promise<void> | undefined;

	constructor(private readonly appRoot: string, private readonly logService: ILogService) { }

	async start(): Promise<void> {
		const directory = join(this.appRoot, 'cloudforge-service');
		const executable = join(directory, 'cloudforge-service.exe');
		try {
			const { serviceCommit } = await verifyPackage(executable, join(directory, 'manifest.json'));
			if (this.stopping) {
				return;
			}

			const child = this.child = spawn(executable, [], {
				cwd: directory,
				env: { SystemRoot: process.env['SystemRoot'], WINDIR: process.env['WINDIR'] },
				shell: false,
				windowsHide: true,
				stdio: ['pipe', 'pipe', 'pipe']
			});
			this.closed = new Promise<void>(resolve => child.once('close', () => resolve()));
			child.stderr.resume();
			child.stdin.on('error', () => { /* The reply/exit path handles a closed pipe. */ });
			const started = new Promise<void>((resolve, reject) => {
				child.once('spawn', resolve);
				child.on('error', () => reject(new ServiceError('SERVICE_SPAWN_FAILED')));
			});

			await withTimeout((async () => {
				await started;
				if (this.stopping) {
					return;
				}
				const body = Buffer.from(JSON.stringify({
					jsonrpc: '2.0',
					id: requestId,
					method: 'initialize',
					params: { supportedProtocolVersions: [protocolVersion], expectedServiceCommit: serviceCommit }
				}));
				child.stdin.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]));
				await readCloudForgeInitializeReply(child.stdout.iterator({ destroyOnReturn: false }), serviceCommit);
			})(), initializeTimeoutMs, 'INITIALIZE_TIMEOUT');
			if (this.stopping) {
				return;
			}

			child.stdout.once('data', () => {
				if (!this.stopping) {
					this.logService.error('[CloudForge Service] UNEXPECTED_SERVICE_OUTPUT');
					void this.stop();
				}
			});
			child.stdout.on('error', () => {
				if (!this.stopping) {
					this.logService.error('[CloudForge Service] SERVICE_STDOUT_FAILED');
					void this.stop();
				}
			});
			child.stdout.resume();
			void this.closed.then(() => {
				if (!this.stopping) {
					this.logService.error('[CloudForge Service] SERVICE_EXITED');
				}
			});
			this.logService.info('[CloudForge Service] Initialized protocol ' + protocolVersion + ', service ' + serviceCommit + ', PID ' + child.pid);
		} catch (error) {
			if (!this.stopping) {
				this.logService.error('[CloudForge Service] ' + (error instanceof ServiceError ? error.message : 'SERVICE_START_FAILED'));
				await this.stop();
			}
		}
	}

	stop(): Promise<void> {
		this.stopping = true;
		return this.stopPromise ??= this.shutdown();
	}

	private async shutdown(): Promise<void> {
		const { child, closed } = this;
		if (!child || !closed) {
			return;
		}

		child.stdin.end();
		try {
			await withTimeout(closed, shutdownTimeoutMs, 'SHUTDOWN_TIMEOUT');
		} catch {
			child.kill();
			try {
				await withTimeout(closed, shutdownTimeoutMs, 'TERMINATION_TIMEOUT');
			} catch {
				this.logService.error('[CloudForge Service] TERMINATION_TIMEOUT');
			}
		}
	}
}
