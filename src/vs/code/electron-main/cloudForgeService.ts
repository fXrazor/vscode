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
// Matches the service limit: a 512 KiB draft plus its three-way base fit after JSON escaping.
const maxRequestBytes = 2 * 1024 * 1024;
const maxResponseBytes = 8 * 1024 * 1024;
const initializeTimeoutMs = 5000;
const requestTimeoutMs = 30000;
const shutdownTimeoutMs = 1500;
const headerEnd = Buffer.from('\r\n\r\n');
const commitPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;

/**
 * The only environment variables the service receives: non-secret Windows folders and system
 * facts. The service finds its consent store, winget, and Git through them, and passes this same
 * set on to winget. Keep it in step with `ENVIRONMENT` in the service's `git.rs`.
 */
const serviceEnvironmentNames = [
	'ALLUSERSPROFILE', 'APPDATA', 'COMPUTERNAME', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
	'NUMBER_OF_PROCESSORS', 'OS', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles',
	'ProgramFiles(x86)', 'ProgramW6432', 'PUBLIC', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP',
	'USERNAME', 'USERPROFILE', 'windir',
] as const;

/** Copies the allowed variables that are set; everything else, including PATH and tokens, is left out. */
export function cloudForgeServiceEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const name of serviceEnvironmentNames) {
		const value = source[name];
		if (value) {
			environment[name] = value;
		}
	}
	return environment;
}

/** Methods the broker may send after `initialize`. */
export type CloudForgeServiceMethod =
	| 'openWorkspace' | 'chooseTerraformRoot' | 'selectArchitecture' | 'readArchitecture'
	| 'createProject' | 'openProject' | 'grantProject' | 'forgetProjectAccess' | 'createWorkspaceFile'
	| 'inspectRepository' | 'importRepository' | 'removeRepository' | 'createArchitecture' | 'summarizeArchitectures' | 'installGit'
	| 'inspectCatalogueSchemaFile' | 'importCatalogueSnapshot'
	| 'listCatalogueSnapshots' | 'listCatalogueTypes' | 'getResourceFormSchema' | 'getCatalogueCoverage' | 'renderResourceDraft'
	| 'startValidationRun' | 'pollValidationRun' | 'cancelValidationRun'
	| 'previewDraftSave' | 'applyDraftSave' | 'previewFocusedSave' | 'applyFocusedSave' | 'readResourceValues'
	| 'previewFocusedSaveBatch' | 'applyFocusedSaveBatch'
	| 'summarizeState' | 'listCloudConnections' | 'setCloudConnection' | 'storeCloudKey' | 'removeCloudConnection' | 'checkCloudSignIn'
	| 'inspectDependencies' | 'listCloudRegions' | 'readModule'
	| 'diffCatalogueSnapshots' | 'auditExportReadiness' | 'exportPortableBundle'
	| 'detectEngines' | 'runEngineValidate' | 'runEnginePlan' | 'runEngineFmt'
	| 'listMirrorPackages' | 'checkOfflineMirrorReadiness' | 'runEngineInitOffline' | 'extractProviderSchemaFromMirror'
	| 'importMirrorPackage' | 'evictMirrorPackage' | 'verifyMirrorIntegrity' | 'planMirrorCleanup'
	| 'selectTerraformSkills' | 'listBuiltinSkills' | 'getTopologyBlueprint'
	| 'getLearningRecord' | 'saveLearningRecord' | 'submitProposal' | 'reviewProposal'
	| 'issueMcpGrant' | 'listMcpGrants' | 'revokeMcpGrant';

export class CloudForgeServiceError extends Error {
	constructor(readonly code: string, readonly kind?: string) {
		super(code);
	}
}

function parseObject(bytes: Buffer): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (isRecord(value)) {
			return value;
		}
	} catch {
		// Never log the wire payload.
	}
	throw new CloudForgeServiceError('INVALID_JSON');
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
				throw new CloudForgeServiceError('MANIFEST_TOO_LARGE');
			}
			manifest = parseObject(bytes.subarray(0, bytesRead));
		} finally {
			await file.close();
		}
	} catch (error) {
		if (error instanceof CloudForgeServiceError) {
			throw error;
		}
		throw new CloudForgeServiceError('MANIFEST_UNAVAILABLE');
	}

	const { architecture, serviceCommit, sha256 } = manifest;
	if (architecture !== 'x64' || typeof serviceCommit !== 'string' || !commitPattern.test(serviceCommit) || typeof sha256 !== 'string' || !hashPattern.test(sha256)) {
		throw new CloudForgeServiceError('INVALID_MANIFEST');
	}
	if (manifest.protocolVersion !== protocolVersion) {
		throw new CloudForgeServiceError('PROTOCOL_MISMATCH');
	}

	const hash = createHash('sha256');
	try {
		for await (const bytes of createReadStream(executable)) {
			hash.update(bytes);
		}
	} catch {
		throw new CloudForgeServiceError('SERVICE_UNAVAILABLE');
	}
	if (hash.digest('hex') !== sha256) {
		throw new CloudForgeServiceError('SERVICE_HASH_MISMATCH');
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
					throw new CloudForgeServiceError('INVALID_FRAME_HEADER');
				}
				continue;
			}

			const line = header.subarray(0, delimiter).toString('latin1');
			const length = /^Content-Length: ([0-9]+)$/.exec(line)?.[1];
			const bodyLength = length === undefined ? 0 : Number(length);
			if (!Number.isSafeInteger(bodyLength) || bodyLength <= 0 || bodyLength > maxResponseBytes) {
				throw new CloudForgeServiceError('INVALID_FRAME_LENGTH');
			}
			body = Buffer.alloc(bodyLength);
			chunk = chunk.subarray(delimiter + headerEnd.length - previousHeaderLength);
		}

		if (chunk.length > body.length - offset) {
			throw new CloudForgeServiceError('UNEXPECTED_SERVICE_OUTPUT');
		}
		offset += chunk.copy(body, offset);
		if (offset !== body.length) {
			continue;
		}

		const reply = parseObject(body);
		if (reply.jsonrpc !== '2.0' || reply.id !== requestId || (reply.result === undefined) === (reply.error === undefined)) {
			throw new CloudForgeServiceError('INVALID_INITIALIZE_RESPONSE');
		}
		if (isRecord(reply.error)) {
			if (reply.error.code === -32001) {
				throw new CloudForgeServiceError('PROTOCOL_MISMATCH');
			}
			if (reply.error.code === -32002) {
				throw new CloudForgeServiceError('SERVICE_COMMIT_MISMATCH');
			}
			throw new CloudForgeServiceError('INITIALIZE_REJECTED');
		}
		if (!isRecord(reply.result)) {
			throw new CloudForgeServiceError('INVALID_INITIALIZE_RESPONSE');
		}
		if (reply.result.protocolVersion !== protocolVersion) {
			throw new CloudForgeServiceError('PROTOCOL_MISMATCH');
		}
		if (reply.result.serviceCommit !== expectedCommit) {
			throw new CloudForgeServiceError('SERVICE_COMMIT_MISMATCH');
		}
		return;
	}
	throw new CloudForgeServiceError('SERVICE_EOF_BEFORE_INITIALIZE');
}

async function withTimeout<T>(operation: Promise<T>, ms: number, code: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new CloudForgeServiceError(code)), ms);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

function frameRequest(id: string, method: string, params: Record<string, unknown>): Buffer {
	const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
	if (body.length > maxRequestBytes) {
		throw new CloudForgeServiceError('LIMIT_EXCEEDED');
	}
	return Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]);
}

/** Maps a JSON-RPC error object to a fixed code. Service messages are never passed on. */
export function safeServiceError(error: unknown): CloudForgeServiceError {
	if (!isRecord(error)) {
		return new CloudForgeServiceError('SERVICE_ERROR');
	}
	const kind = isRecord(error.data) && typeof error.data.kind === 'string' ? error.data.kind : undefined;
	switch (error.code) {
		case -32001: return new CloudForgeServiceError('PROTOCOL_MISMATCH', 'PROTOCOL_MISMATCH');
		case -32002: return new CloudForgeServiceError('SERVICE_COMMIT_MISMATCH', 'SERVICE_COMMIT_MISMATCH');
		case -32003: return new CloudForgeServiceError('INVALID_STATE', 'INVALID_STATE');
		case -32004: return new CloudForgeServiceError('SCOPE_DENIED', 'SCOPE_DENIED');
		case -32005: return new CloudForgeServiceError('STALE_SOURCE', 'STALE_SOURCE');
		case -32006: return new CloudForgeServiceError('UNSUPPORTED_FORMAT', 'UNSUPPORTED_FORMAT');
		case -32007: return new CloudForgeServiceError('WORKSPACE_UNAVAILABLE', 'WORKSPACE_UNAVAILABLE');
		case -32008: return new CloudForgeServiceError('LIMIT_EXCEEDED', 'LIMIT_EXCEEDED');
		case -32009: return new CloudForgeServiceError('CONSENT_REQUIRED', 'CONSENT_REQUIRED');
		case -32010: return new CloudForgeServiceError('ALREADY_EXISTS', 'ALREADY_EXISTS');
		case -32011: return new CloudForgeServiceError('SCHEMA_UNAVAILABLE', 'SCHEMA_UNAVAILABLE');
		case -32602: return kind === 'INVALID_PARAMS' ? new CloudForgeServiceError('INVALID_PARAMS', kind) : new CloudForgeServiceError('SERVICE_ERROR', kind);
		default: return new CloudForgeServiceError('SERVICE_ERROR', kind);
	}
}

class CloudForgeResponseReader {
	private buffer = Buffer.alloc(0);
	private readonly waiters: { resolve: (message: Record<string, unknown>) => void; reject: (error: Error) => void }[] = [];
	private failure: Error | undefined;

	constructor(
		private readonly stream: NodeJS.ReadableStream,
		private readonly onFailure: (error: Error) => void
	) {
		stream.on('data', this.onData);
		stream.on('end', this.onEnd);
		stream.on('error', this.onError);
	}

	readMessage(): Promise<Record<string, unknown>> {
		if (this.failure) {
			return Promise.reject(this.failure);
		}
		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	dispose(): void {
		this.stream.off('data', this.onData);
		this.stream.off('end', this.onEnd);
		this.stream.off('error', this.onError);
		this.fail(new CloudForgeServiceError('SERVICE_STOPPED'));
	}

	private readonly onData = (chunk: Buffer): void => {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		this.parseFrames();
	};

	private readonly onEnd = (): void => this.fail(new CloudForgeServiceError('SERVICE_EOF'));
	private readonly onError = (): void => this.fail(new CloudForgeServiceError('SERVICE_STDOUT_FAILED'));

	private parseFrames(): void {
		try {
			while (true) {
				const delimiter = this.buffer.indexOf(headerEnd);
				if (delimiter === -1) {
					if (this.buffer.length >= maxHeaderBytes) {
						throw new CloudForgeServiceError('INVALID_FRAME_HEADER');
					}
					return;
				}
				if (delimiter > maxHeaderBytes) {
					throw new CloudForgeServiceError('INVALID_FRAME_HEADER');
				}
				const header = this.buffer.subarray(0, delimiter).toString('latin1');
				const length = /^Content-Length: ([0-9]+)$/.exec(header)?.[1];
				const bodyLength = length === undefined ? 0 : Number(length);
				if (!Number.isSafeInteger(bodyLength) || bodyLength <= 0 || bodyLength > maxResponseBytes) {
					throw new CloudForgeServiceError('INVALID_FRAME_LENGTH');
				}
				const frameLength = delimiter + headerEnd.length + bodyLength;
				if (this.buffer.length < frameLength) {
					return;
				}
				const body = this.buffer.subarray(delimiter + headerEnd.length, frameLength);
				this.buffer = this.buffer.subarray(frameLength);
				const message = parseObject(body);
				const waiter = this.waiters.shift();
				if (!waiter) {
					throw new CloudForgeServiceError('UNEXPECTED_SERVICE_OUTPUT');
				}
				waiter.resolve(message);
			}
		} catch (error) {
			this.fail(error instanceof Error ? error : new CloudForgeServiceError('INVALID_FRAME'));
		}
	}

	private fail(error: Error): void {
		if (this.failure) {
			return;
		}
		this.failure = error;
		for (const waiter of this.waiters.splice(0)) {
			waiter.reject(error);
		}
		this.onFailure(error);
	}
}

export class CloudForgeServiceProcess {
	private child: ChildProcessWithoutNullStreams | undefined;
	private closed: Promise<void> | undefined;
	private stopping = false;
	private startPromise: Promise<void> | undefined;
	private stopPromise: Promise<void> | undefined;
	private responseReader: CloudForgeResponseReader | undefined;
	private requestQueue: Promise<void> = Promise.resolve();
	private nextRequestId = 0;
	private ready = false;

	constructor(private readonly appRoot: string, private readonly logService: ILogService) { }

	start(): Promise<void> {
		return this.startPromise ??= this.startCore();
	}

	private async startCore(): Promise<void> {
		const directory = join(this.appRoot, 'cloudforge-service');
		const executable = join(directory, 'cloudforge-service.exe');
		try {
			const { serviceCommit } = await verifyPackage(executable, join(directory, 'manifest.json'));
			if (this.stopping) {
				return;
			}

			const child = this.child = spawn(executable, [], {
				cwd: directory,
				env: cloudForgeServiceEnvironment(process.env),
				shell: false,
				windowsHide: true,
				stdio: ['pipe', 'pipe', 'pipe']
			});
			this.closed = new Promise<void>(resolve => child.once('close', () => resolve()));
			child.stderr.resume();
			child.stdin.on('error', () => { /* The reply/exit path handles a closed pipe. */ });
			const started = new Promise<void>((resolve, reject) => {
				child.once('spawn', resolve);
				child.on('error', () => reject(new CloudForgeServiceError('SERVICE_SPAWN_FAILED')));
			});

			await withTimeout((async () => {
				await started;
				if (this.stopping) {
					return;
				}
				const reader = this.responseReader = new CloudForgeResponseReader(child.stdout, error => {
					if (!this.stopping) {
						this.logService.error('[CloudForge Service] ' + (error instanceof CloudForgeServiceError ? error.code : 'SERVICE_PROTOCOL_FAILED'));
						void this.stop();
					}
				});
				const replyPromise = reader.readMessage();
				child.stdin.write(frameRequest(requestId, 'initialize', { supportedProtocolVersions: [protocolVersion], expectedServiceCommit: serviceCommit }));
				const reply = await replyPromise;
				if (reply.jsonrpc !== '2.0' || reply.id !== requestId || (reply.result === undefined) === (reply.error === undefined)) {
					throw new CloudForgeServiceError('INVALID_INITIALIZE_RESPONSE');
				}
				if (reply.error !== undefined) {
					const error = safeServiceError(reply.error);
					throw new CloudForgeServiceError(error.code);
				}
				if (!isRecord(reply.result)) {
					throw new CloudForgeServiceError('INVALID_INITIALIZE_RESPONSE');
				}
				if (reply.result.protocolVersion !== protocolVersion) {
					throw new CloudForgeServiceError('PROTOCOL_MISMATCH');
				}
				if (reply.result.serviceCommit !== serviceCommit) {
					throw new CloudForgeServiceError('SERVICE_COMMIT_MISMATCH');
				}
			})(), initializeTimeoutMs, 'INITIALIZE_TIMEOUT');
			if (this.stopping) {
				return;
			}

			this.ready = true;
			void this.closed.then(() => {
				if (!this.stopping) {
					this.logService.error('[CloudForge Service] SERVICE_EXITED');
				}
			});
			this.logService.info('[CloudForge Service] Initialized protocol ' + protocolVersion + ', service ' + serviceCommit + ', PID ' + child.pid);
		} catch (error) {
			if (!this.stopping) {
				this.logService.error('[CloudForge Service] ' + (error instanceof CloudForgeServiceError ? error.message : 'SERVICE_START_FAILED'));
				await this.stop();
			}
		}
	}

	call(method: CloudForgeServiceMethod, params: Record<string, unknown>, timeoutMs = requestTimeoutMs): Promise<unknown> {
		const request = this.requestQueue.then(async () => {
			await this.startPromise;
			return this.performRequest(method, params, timeoutMs);
		});
		this.requestQueue = request.then(() => undefined, () => undefined);
		return request;
	}

	stop(): Promise<void> {
		this.stopping = true;
		return this.stopPromise ??= this.shutdown();
	}

	private async performRequest(method: CloudForgeServiceMethod, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
		const child = this.child;
		const reader = this.responseReader;
		if (!this.ready || this.stopping || !child || !reader) {
			throw new CloudForgeServiceError('SERVICE_UNAVAILABLE');
		}
		const id = 'request-' + (++this.nextRequestId);
		const frame = frameRequest(id, method, params);
		const responsePromise = withTimeout(reader.readMessage(), timeoutMs, 'REQUEST_TIMEOUT');
		try {
			child.stdin.write(frame);
		} catch {
			await this.stop();
			throw new CloudForgeServiceError('SERVICE_STDIN_FAILED');
		}
		let response: Record<string, unknown>;
		try {
			response = await responsePromise;
		} catch (error) {
			if (error instanceof CloudForgeServiceError && error.code === 'REQUEST_TIMEOUT') {
				await this.stop();
			}
			throw error;
		}
		if (response.jsonrpc !== '2.0' || response.id !== id || (response.result === undefined) === (response.error === undefined)) {
			await this.stop();
			throw new CloudForgeServiceError('INVALID_RPC_RESPONSE');
		}
		if (response.error !== undefined) {
			throw safeServiceError(response.error);
		}
		return response.result;
	}

	private async shutdown(): Promise<void> {
		this.ready = false;
		this.responseReader?.dispose();
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
