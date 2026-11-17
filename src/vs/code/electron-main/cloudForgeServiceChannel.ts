/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { isAbsolute } from '../../base/common/path.js';
import type { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import type { ILogService } from '../../platform/log/common/log.js';
import type { IWindowsMainService } from '../../platform/windows/electron-main/windows.js';
import { CloudForgeServiceError, CloudForgeServiceProcess } from './cloudForgeService.js';

type CloudForgeMethod = 'openWorkspace' | 'chooseTerraformRoot' | 'selectArchitecture' | 'readArchitecture';

export interface CloudForgeCallSuccess {
	readonly ok: true;
	readonly value: unknown;
}

export interface CloudForgeCallFailure {
	readonly ok: false;
	readonly error: {
		readonly code: string;
		readonly message: string;
	};
}

export type CloudForgeCallResult = CloudForgeCallSuccess | CloudForgeCallFailure;

const serviceErrorMessages: Readonly<Record<string, string>> = {
	INVALID_PARAMS: 'The CloudForge request is invalid.',
	PROTOCOL_MISMATCH: 'The CloudForge service protocol is not supported.',
	SERVICE_COMMIT_MISMATCH: 'The CloudForge service does not match this desktop build.',
	INVALID_STATE: 'The CloudForge workspace is not available in this window.',
	SCOPE_DENIED: 'The requested CloudForge workspace is not active in this window.',
	STALE_SOURCE: 'The workspace source changed. Reopen it to refresh the graph.',
	UNSUPPORTED_FORMAT: 'This workspace format is not supported.',
	WORKSPACE_UNAVAILABLE: 'The selected workspace is not available.',
	LIMIT_EXCEEDED: 'The workspace exceeds the CloudForge inspection limit.',
	SERVICE_UNAVAILABLE: 'The CloudForge service is unavailable.',
	SERVICE_ERROR: 'The CloudForge service could not complete the request.'
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every(key => keys.includes(key));
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateCloudForgeServiceParams(method: string, value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value) || (method !== 'openWorkspace' && method !== 'chooseTerraformRoot' && method !== 'selectArchitecture' && method !== 'readArchitecture')) {
		return undefined;
	}
	switch (method) {
		case 'openWorkspace': {
			if (!hasOnlyKeys(value, ['rootPath']) || typeof value.rootPath !== 'string' || value.rootPath.length === 0 || value.rootPath.length > 32768 || !isAbsolute(value.rootPath) || value.rootPath.includes('\0')) {
				return undefined;
			}
			return { rootPath: value.rootPath };
		}
		case 'chooseTerraformRoot': {
			if (!hasOnlyKeys(value, ['workspaceId', 'candidateId']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.candidateId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, candidateId: value.candidateId };
		}
		case 'selectArchitecture': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, architectureId: value.architectureId };
		}
		case 'readArchitecture': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined && (typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision))) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision })
			};
		}
	}
}

function safeFailure(error: unknown): CloudForgeCallFailure {
	const code = error instanceof CloudForgeServiceError && Object.hasOwn(serviceErrorMessages, error.code) ? error.code : 'SERVICE_ERROR';
	return { ok: false, error: { code, message: serviceErrorMessages[code] } };
}

export class CloudForgeServiceBroker implements IServerChannel<string> {
	private readonly services = new Map<number, CloudForgeServiceProcess>();
	private readonly openListener: { dispose(): void };
	private readonly destroyListener: { dispose(): void };
	private stopped = false;

	constructor(
		private readonly appRoot: string,
		private readonly logService: ILogService,
		private readonly windowsMainService: IWindowsMainService
	) {
		this.openListener = windowsMainService.onDidOpenWindow(window => this.startWindow(window.id));
		this.destroyListener = windowsMainService.onDidDestroyWindow(window => this.stopWindow(window.id));
		for (const window of windowsMainService.getWindows()) {
			this.startWindow(window.id);
		}
	}

	async call<T>(ctx: string, command: string, arg?: unknown): Promise<T> {
		const windowId = /^window:([1-9][0-9]*)$/.exec(ctx)?.[1];
		const window = windowId ? Number(windowId) : undefined;
		const service = window !== undefined && this.windowsMainService.getWindowById(window) ? this.services.get(window) : undefined;
		if (!service || !this.isMethod(command)) {
			return safeFailure(new CloudForgeServiceError('SERVICE_UNAVAILABLE')) as T;
		}
		const params = validateCloudForgeServiceParams(command, arg);
		if (!params) {
			return safeFailure(new CloudForgeServiceError('INVALID_PARAMS')) as T;
		}
		try {
			const result: CloudForgeCallSuccess = { ok: true, value: await service.call(command, params) };
			return result as T;
		} catch (error) {
			return safeFailure(error) as T;
		}
	}

	listen<T>(_ctx: string, _event: string): Event<T> {
		return Event.None;
	}

	async stop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.openListener.dispose();
		this.destroyListener.dispose();
		const services = [...this.services.values()];
		this.services.clear();
		await Promise.all(services.map(service => service.stop()));
	}

	private isMethod(method: string): method is CloudForgeMethod {
		return method === 'openWorkspace' || method === 'chooseTerraformRoot' || method === 'selectArchitecture' || method === 'readArchitecture';
	}

	private startWindow(windowId: number): void {
		if (this.stopped || this.services.has(windowId)) {
			return;
		}
		const service = new CloudForgeServiceProcess(this.appRoot, this.logService);
		this.services.set(windowId, service);
		void service.start();
	}

	private stopWindow(windowId: number): void {
		const service = this.services.get(windowId);
		if (!service) {
			return;
		}
		this.services.delete(windowId);
		void service.stop();
	}
}
