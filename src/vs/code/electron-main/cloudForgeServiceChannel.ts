/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as electron from 'electron';
import { Event } from '../../base/common/event.js';
import { Schemas } from '../../base/common/network.js';
import { dirname, isAbsolute, join } from '../../base/common/path.js';
import { URI } from '../../base/common/uri.js';
import type { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { localize } from '../../nls.js';
import type { ILogService } from '../../platform/log/common/log.js';
import { LoadReason, type ICodeWindow } from '../../platform/window/electron-main/window.js';
import { hasWorkspaceFileExtension, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, type IResolvedWorkspace } from '../../platform/workspace/common/workspace.js';
import { CloudForgeServiceError, CloudForgeServiceProcess, type CloudForgeServiceMethod } from './cloudForgeService.js';

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

const cloudForgeMethods: ReadonlySet<string> = new Set<CloudForgeServiceMethod>([
	'openWorkspace', 'chooseTerraformRoot', 'selectArchitecture', 'readArchitecture',
	'createProject', 'openProject', 'grantProject', 'forgetProjectAccess', 'createWorkspaceFile',
	'inspectRepository', 'importRepository', 'removeRepository', 'installGit'
]);

/** The service allows `installGit` 10 minutes; the broker waits a little longer for its reply. */
const installGitTimeoutMs = 11 * 60 * 1000;
const maxPathLength = 32767;
const maxNameLength = 255;
const maxRemoteBytes = 2048;
const maxSelections = 32;
const maxWorkspaceFolders = 1024;

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
	CONSENT_REQUIRED: 'CloudForge needs your permission to read this project.',
	ALREADY_EXISTS: 'A CloudForge project or workspace file with that name already exists.',
	CANCELLED: 'The CloudForge request was cancelled.',
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

/** A display or folder name. The service applies the full Windows naming rules. */
function isName(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maxNameLength && !/[\u0000-\u001f\u007f]/.test(value);
}

/** A single path component the broker may join onto a path it chose. */
function isPathComponent(value: unknown): value is string {
	return isName(value) && value !== '.' && value !== '..' && !/[<>:"/\\|?*]/.test(value);
}

/** A local absolute Windows path with a drive letter. UNC and device paths are refused. */
function isLocalPath(value: string): boolean {
	return value.length > 0 && value.length <= maxPathLength && /^[a-zA-Z]:\\/.test(value) && !value.includes('\0');
}

/**
 * Validates the parameters the extension host may send. Parameters that the broker supplies,
 * such as project and repository paths, are rejected here so that a renderer or extension
 * can never choose them.
 */
export function validateCloudForgeServiceParams(method: string, value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value) || !cloudForgeMethods.has(method)) {
		return undefined;
	}
	switch (method as CloudForgeServiceMethod) {
		case 'openWorkspace': {
			if (!hasOnlyKeys(value, ['rootPath']) || typeof value.rootPath !== 'string' || value.rootPath.length === 0 || value.rootPath.length > maxPathLength || !isAbsolute(value.rootPath) || value.rootPath.includes('\0')) {
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
		case 'createProject': {
			if (!hasOnlyKeys(value, ['name']) || !isPathComponent(value.name)) {
				return undefined;
			}
			return { name: value.name };
		}
		case 'openProject':
		case 'grantProject':
		case 'forgetProjectAccess':
		case 'installGit': {
			return Object.keys(value).length === 0 ? {} : undefined;
		}
		case 'createWorkspaceFile': {
			if (!hasOnlyKeys(value, ['workspaceId']) || !isOpaqueId(value.workspaceId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId };
		}
		case 'inspectRepository': {
			const index = value.workspaceFolderIndex;
			if (!hasOnlyKeys(value, ['workspaceId', 'workspaceFolderIndex']) || !isOpaqueId(value.workspaceId) || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= maxWorkspaceFolders) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, workspaceFolderIndex: index };
		}
		case 'importRepository': {
			if (!hasOnlyKeys(value, ['workspaceId', 'inspectionId', 'selections', 'remote']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.inspectionId)) {
				return undefined;
			}
			if (!Array.isArray(value.selections) || value.selections.length === 0 || value.selections.length > maxSelections) {
				return undefined;
			}
			const selections: { candidateId: string; displayName: string }[] = [];
			for (const selection of value.selections) {
				if (!isRecord(selection) || !hasOnlyKeys(selection, ['candidateId', 'displayName']) || !isOpaqueId(selection.candidateId) || !isName(selection.displayName)) {
					return undefined;
				}
				selections.push({ candidateId: selection.candidateId, displayName: selection.displayName });
			}
			const remote = value.remote;
			if (remote !== undefined && (typeof remote !== 'string' || remote.length === 0 || Buffer.byteLength(remote, 'utf8') > maxRemoteBytes || /[\u0000-\u001f\u007f]/.test(remote))) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				inspectionId: value.inspectionId,
				selections,
				...(remote === undefined ? {} : { remote })
			};
		}
		case 'removeRepository': {
			if (!hasOnlyKeys(value, ['workspaceId', 'repositoryId']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.repositoryId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, repositoryId: value.repositoryId };
		}
	}
}

/**
 * The calling window's project scope, resolved in Electron main. The project folder is the
 * folder containing the window's saved `.code-workspace` file, or its single opened folder.
 * `workspaceFolders` lists the window's folders in window order.
 */
export interface ICloudForgeWindowScope {
	readonly projectPath: string;
	readonly workspaceFolders: readonly string[];
}

/**
 * Resolves the scope of a window's opened workspace. Returns `undefined` for an empty window,
 * an untitled or remote workspace, or any folder that is not a local drive path, so that the
 * indexes the extension sees always match the list sent to the service.
 */
export async function resolveCloudForgeWindowScope(
	openedWorkspace: ICodeWindow['openedWorkspace'],
	resolveLocalWorkspace: (configPath: URI) => Promise<IResolvedWorkspace | undefined>
): Promise<ICloudForgeWindowScope | undefined> {
	if (isSingleFolderWorkspaceIdentifier(openedWorkspace)) {
		if (openedWorkspace.uri.scheme !== Schemas.file || !isLocalPath(openedWorkspace.uri.fsPath)) {
			return undefined;
		}
		return { projectPath: openedWorkspace.uri.fsPath, workspaceFolders: [openedWorkspace.uri.fsPath] };
	}
	if (!isWorkspaceIdentifier(openedWorkspace)) {
		return undefined;
	}
	const configPath = openedWorkspace.configPath;
	if (configPath.scheme !== Schemas.file || !hasWorkspaceFileExtension(configPath) || !isLocalPath(configPath.fsPath)) {
		return undefined;
	}
	const resolved = await resolveLocalWorkspace(configPath);
	if (!resolved || resolved.remoteAuthority || resolved.folders.length > maxWorkspaceFolders) {
		return undefined;
	}
	const workspaceFolders: string[] = [];
	for (const folder of resolved.folders) {
		if (folder.uri.scheme !== Schemas.file || !isLocalPath(folder.uri.fsPath)) {
			return undefined;
		}
		workspaceFolders.push(folder.uri.fsPath);
	}
	return { projectPath: dirname(configPath.fsPath), workspaceFolders };
}

/** What the broker needs from the calling window to fill broker-owned parameters. */
export interface ICloudForgeRequestContext {
	resolveScope(): Promise<ICloudForgeWindowScope | undefined>;
	/** Opens a native folder picker owned by the calling window. `undefined` when cancelled. */
	pickParentFolder(): Promise<string | undefined>;
}

export type CloudForgeResolvedRequest =
	| { readonly kind: 'call'; readonly params: Record<string, unknown> }
	| { readonly kind: 'failure'; readonly code: string };

/**
 * Adds the parameters the broker owns to validated extension parameters. Nothing here reads
 * a path from the extension: project paths and workspace folders come from the calling
 * window, a repository folder is chosen only by index into that window's folders, and the
 * parent of a new project comes from a native picker.
 */
export async function resolveCloudForgeRequest(method: CloudForgeServiceMethod, params: Record<string, unknown>, context: ICloudForgeRequestContext): Promise<CloudForgeResolvedRequest> {
	switch (method) {
		case 'createProject': {
			const parentPath = await context.pickParentFolder();
			if (parentPath === undefined) {
				return { kind: 'failure', code: 'CANCELLED' };
			}
			if (!isLocalPath(parentPath)) {
				return { kind: 'failure', code: 'SCOPE_DENIED' };
			}
			return { kind: 'call', params: { parentPath, name: params.name } };
		}
		case 'openProject':
		case 'grantProject': {
			const scope = await context.resolveScope();
			return scope ? { kind: 'call', params: { projectPath: scope.projectPath, workspaceFolders: [...scope.workspaceFolders] } } : { kind: 'failure', code: 'INVALID_STATE' };
		}
		case 'forgetProjectAccess': {
			const scope = await context.resolveScope();
			return scope ? { kind: 'call', params: { projectPath: scope.projectPath } } : { kind: 'failure', code: 'INVALID_STATE' };
		}
		case 'inspectRepository': {
			const scope = await context.resolveScope();
			if (!scope) {
				return { kind: 'failure', code: 'INVALID_STATE' };
			}
			const folderPath = scope.workspaceFolders[params.workspaceFolderIndex as number];
			if (folderPath === undefined) {
				return { kind: 'failure', code: 'SCOPE_DENIED' };
			}
			return { kind: 'call', params: { workspaceId: params.workspaceId, folderPath } };
		}
		default:
			return { kind: 'call', params };
	}
}

/**
 * Adds the new workspace file's location to a `createProject` result, so the desktop can open
 * it. The broker joins only names it validated onto the folder the user picked.
 */
function completeCreateProject(value: unknown, parentPath: unknown): unknown {
	if (!isRecord(value) || typeof parentPath !== 'string' || !isPathComponent(value.folderName) || !isPathComponent(value.workspaceFileName) || !hasWorkspaceFileExtension(value.workspaceFileName)) {
		throw new CloudForgeServiceError('SERVICE_ERROR');
	}
	const workspaceFile = URI.file(join(parentPath, value.folderName, value.workspaceFileName));
	return { folderName: value.folderName, workspaceFileName: value.workspaceFileName, workspaceFile: workspaceFile.toString() };
}

function safeFailure(error: unknown): CloudForgeCallFailure {
	const code = error instanceof CloudForgeServiceError && Object.hasOwn(serviceErrorMessages, error.code) ? error.code : 'SERVICE_ERROR';
	return { ok: false, error: { code, message: serviceErrorMessages[code] } };
}

/** The part of a sidecar process the broker uses. */
export interface ICloudForgeServiceConnection {
	start(): Promise<void>;
	stop(): Promise<void>;
	call(method: CloudForgeServiceMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
}

/** The part of the windows main service the broker uses. */
export interface ICloudForgeWindows {
	readonly onDidOpenWindow: Event<{ readonly id: number }>;
	readonly onDidDestroyWindow: Event<{ readonly id: number }>;
	getWindows(): readonly { readonly id: number }[];
	getWindowById(windowId: number): Pick<ICodeWindow, 'openedWorkspace' | 'win'> | undefined;
}

export interface ICloudForgeWorkspaces {
	resolveLocalWorkspace(configPath: URI): Promise<IResolvedWorkspace | undefined>;
}

export interface ICloudForgeDialogs {
	showOpenDialog(options: electron.OpenDialogOptions, window?: electron.BrowserWindow): Promise<electron.OpenDialogReturnValue>;
}

/** The part of the lifecycle main service the broker uses. */
export interface ICloudForgeWindowLoads {
	readonly onWillLoadWindow: Event<{ readonly window: { readonly id: number }; readonly reason: LoadReason }>;
}

export class CloudForgeServiceBroker implements IServerChannel<string> {
	private readonly services = new Map<number, ICloudForgeServiceConnection>();
	private readonly openListener: { dispose(): void };
	private readonly destroyListener: { dispose(): void };
	private readonly loadListener: { dispose(): void };
	private stopped = false;

	constructor(
		private readonly appRoot: string,
		private readonly logService: ILogService,
		private readonly windowsMainService: ICloudForgeWindows,
		private readonly workspacesManagementMainService: ICloudForgeWorkspaces,
		private readonly dialogMainService: ICloudForgeDialogs,
		lifecycleMainService: ICloudForgeWindowLoads,
		private readonly createService: (appRoot: string, logService: ILogService) => ICloudForgeServiceConnection = (appRoot, logService) => new CloudForgeServiceProcess(appRoot, logService)
	) {
		this.openListener = windowsMainService.onDidOpenWindow(window => this.startWindow(window.id));
		this.destroyListener = windowsMainService.onDidDestroyWindow(window => this.stopWindow(window.id));
		// A window that loads another workspace, or reloads, gets a fresh service with no grant.
		// The old process is stopped, so it releases the previous workspace's folder handles.
		this.loadListener = lifecycleMainService.onWillLoadWindow(event => {
			if (event.reason === LoadReason.LOAD || event.reason === LoadReason.RELOAD) {
				this.stopWindow(event.window.id);
				this.startWindow(event.window.id);
			}
		});
		for (const window of windowsMainService.getWindows()) {
			this.startWindow(window.id);
		}
	}

	async call<T>(ctx: string, command: string, arg?: unknown): Promise<T> {
		const windowId = /^window:(?<id>[1-9][0-9]*)$/.exec(ctx)?.groups?.id;
		const id = windowId ? Number(windowId) : undefined;
		const window = id !== undefined ? this.windowsMainService.getWindowById(id) : undefined;
		const service = id !== undefined && window ? this.services.get(id) : undefined;
		if (!window || !service || !cloudForgeMethods.has(command)) {
			return safeFailure(new CloudForgeServiceError('SERVICE_UNAVAILABLE')) as T;
		}
		const method = command as CloudForgeServiceMethod;
		const params = validateCloudForgeServiceParams(method, arg);
		if (!params) {
			return safeFailure(new CloudForgeServiceError('INVALID_PARAMS')) as T;
		}
		try {
			const request = await resolveCloudForgeRequest(method, params, {
				resolveScope: () => resolveCloudForgeWindowScope(window.openedWorkspace, configPath => this.workspacesManagementMainService.resolveLocalWorkspace(configPath)),
				pickParentFolder: () => this.pickParentFolder(window.win ?? undefined)
			});
			if (request.kind === 'failure') {
				return safeFailure(new CloudForgeServiceError(request.code)) as T;
			}
			let value = await service.call(method, request.params, method === 'installGit' ? installGitTimeoutMs : undefined);
			if (method === 'createProject') {
				value = completeCreateProject(value, request.params.parentPath);
			}
			const result: CloudForgeCallSuccess = { ok: true, value };
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
		this.loadListener.dispose();
		const services = [...this.services.values()];
		this.services.clear();
		await Promise.all(services.map(service => service.stop()));
	}

	private async pickParentFolder(window: electron.BrowserWindow | undefined): Promise<string | undefined> {
		const result = await this.dialogMainService.showOpenDialog({
			title: localize('cloudForge.createProjectLocation', "Choose Where to Create the CloudForge Project"),
			buttonLabel: localize('cloudForge.createProjectHere', "Create Project Here"),
			properties: ['openDirectory', 'createDirectory']
		}, window);
		if (result.canceled || result.filePaths.length !== 1) {
			return undefined;
		}
		return result.filePaths[0];
	}

	private startWindow(windowId: number): void {
		if (this.stopped || this.services.has(windowId)) {
			return;
		}
		const service = this.createService(this.appRoot, this.logService);
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
