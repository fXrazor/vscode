/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as electron from 'electron';
import { Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import { LoadReason, type ICodeWindow } from '../../../platform/window/electron-main/window.js';
import { toWorkspaceFolder, type IResolvedWorkspace } from '../../../platform/workspace/common/workspace.js';
import { CloudForgeServiceError, type CloudForgeServiceMethod } from '../../electron-main/cloudForgeService.js';
import { CloudForgeServiceBroker, resolveCloudForgeWindowScope, validateCloudForgeServiceParams, type CloudForgeCallResult, type ICloudForgeServiceConnection } from '../../electron-main/cloudForgeServiceChannel.js';

const workspaceId = 'workspace-0123456789abcdef0123456789abcdef';
const contosoWorkspace = 'C:\\Projects\\Contoso Platform\\Contoso Platform.code-workspace';
const fabrikamWorkspace = 'D:\\Work\\Fabrikam\\Fabrikam.code-workspace';

function fsPath(path: string): string {
	return URI.file(path).fsPath;
}

function workspace(configPath: string): ICodeWindow['openedWorkspace'] {
	return { id: configPath, configPath: URI.file(configPath) };
}

function resolved(configPath: string, folders: readonly URI[], remoteAuthority?: string): IResolvedWorkspace {
	return { id: configPath, configPath: URI.file(configPath), folders: folders.map(toWorkspaceFolder), remoteAuthority };
}

type Reply = (method: CloudForgeServiceMethod, params: Record<string, unknown>) => unknown;

interface ServiceCall {
	readonly method: CloudForgeServiceMethod;
	readonly params: Record<string, unknown>;
	readonly timeoutMs?: number;
}

class FakeService implements ICloudForgeServiceConnection {
	readonly calls: ServiceCall[] = [];
	state: 'created' | 'started' | 'stopped' = 'created';
	constructor(private readonly reply: Reply) { }
	async start(): Promise<void> { this.state = 'started'; }
	async stop(): Promise<void> { this.state = 'stopped'; }
	async call(method: CloudForgeServiceMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
		this.calls.push(timeoutMs === undefined ? { method, params } : { method, params, timeoutMs });
		return this.reply(method, params);
	}
}

interface FakeWindow {
	readonly id: number;
	readonly openedWorkspace: ICodeWindow['openedWorkspace'];
	readonly resolved?: IResolvedWorkspace;
}

const contosoWindow: FakeWindow = {
	id: 1,
	openedWorkspace: workspace(contosoWorkspace),
	resolved: resolved(contosoWorkspace, [
		URI.file('C:\\Projects\\Contoso Platform'),
		URI.file('C:\\Projects\\Contoso Platform\\repos\\infra'),
		URI.file('C:\\Projects\\platform-infra')
	])
};

const fabrikamWindow: FakeWindow = {
	id: 2,
	openedWorkspace: workspace(fabrikamWorkspace),
	resolved: resolved(fabrikamWorkspace, [URI.file('D:\\Work\\Fabrikam'), URI.file('D:\\Work\\fabrikam-network')])
};

type WindowLoad = { readonly window: { readonly id: number }; readonly reason: LoadReason };

function createBroker(windows: readonly FakeWindow[], options: { readonly reply?: Reply; readonly picked?: readonly string[]; readonly onWillLoadWindow?: Event<WindowLoad> } = {}) {
	const services = new Map<number, FakeService>();
	const created: FakeService[] = [];
	const dialogs: electron.OpenDialogOptions[] = [];
	const pending = [...windows];
	const broker = new CloudForgeServiceBroker(
		'C:\\app',
		new NullLogService(),
		{
			onDidOpenWindow: Event.None,
			onDidDestroyWindow: Event.None,
			getWindows: () => windows,
			getWindowById: id => {
				const window = windows.find(candidate => candidate.id === id);
				return window ? { openedWorkspace: window.openedWorkspace, win: null } : undefined;
			}
		},
		{
			resolveLocalWorkspace: async configPath => windows.find(window => window.resolved?.configPath.toString() === configPath.toString())?.resolved
		},
		{
			showOpenDialog: async dialogOptions => {
				dialogs.push(dialogOptions);
				return options.picked ? { canceled: false, filePaths: [...options.picked] } : { canceled: true, filePaths: [] };
			}
		},
		{ onWillLoadWindow: options.onWillLoadWindow ?? Event.None },
		() => {
			const service = new FakeService(options.reply ?? (() => ({})));
			created.push(service);
			const window = pending.shift();
			if (window) {
				services.set(window.id, service);
			}
			return service;
		}
	);
	const call = (windowId: number, method: string, params: unknown) => broker.call<CloudForgeCallResult>(`window:${windowId}`, method, params);
	const callsByWindow = () => Object.fromEntries([...services].map(([id, service]) => [id, service.calls]));
	return { broker, call, callsByWindow, dialogs, created };
}

suite('CloudForgeServiceChannel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts only absolute, bounded open-workspace paths', () => {
		assert.ok(validateCloudForgeServiceParams('openWorkspace', { rootPath: process.cwd() }));
		assert.strictEqual(validateCloudForgeServiceParams('openWorkspace', { rootPath: 'relative\\folder' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('openWorkspace', { rootPath: process.cwd(), extra: true }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('openWorkspace', { rootPath: 'C:\\folder\0bad' }), undefined);
	});

	test('restricts workspace calls to the selected opaque IDs and supported methods', () => {
		assert.deepStrictEqual(
			validateCloudForgeServiceParams('chooseTerraformRoot', { workspaceId: 'workspace-1', candidateId: 'root-1' }),
			{ workspaceId: 'workspace-1', candidateId: 'root-1' }
		);
		assert.strictEqual(validateCloudForgeServiceParams('chooseTerraformRoot', { workspaceId: 'workspace-1', candidateId: 'root-1', rootPath: process.cwd() }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('readArchitecture', { workspaceId: 'workspace-1', architectureId: 'architecture-1', expectedSourceRevision: 'stale' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('initialize', { supportedProtocolVersions: [1] }), undefined);
	});

	test('accepts the Stage 2 parameters the extension may send', () => {
		const selections = [{ candidateId: 'root-1', displayName: 'Hub network' }];
		assert.deepStrictEqual([
			validateCloudForgeServiceParams('createProject', { name: 'Contoso Platform' }),
			validateCloudForgeServiceParams('openProject', {}),
			validateCloudForgeServiceParams('grantProject', {}),
			validateCloudForgeServiceParams('forgetProjectAccess', {}),
			validateCloudForgeServiceParams('installGit', {}),
			validateCloudForgeServiceParams('createWorkspaceFile', { workspaceId }),
			validateCloudForgeServiceParams('inspectRepository', { workspaceId, workspaceFolderIndex: 2 }),
			validateCloudForgeServiceParams('importRepository', { workspaceId, inspectionId: `${workspaceId}-inspection-1`, selections }),
			validateCloudForgeServiceParams('importRepository', { workspaceId, inspectionId: `${workspaceId}-inspection-1`, selections, remote: 'https://github.com/contoso/infra.git' }),
			validateCloudForgeServiceParams('removeRepository', { workspaceId, repositoryId: `${workspaceId}-repository-1` }),
		], [
			{ name: 'Contoso Platform' },
			{},
			{},
			{},
			{},
			{ workspaceId },
			{ workspaceId, workspaceFolderIndex: 2 },
			{ workspaceId, inspectionId: `${workspaceId}-inspection-1`, selections },
			{ workspaceId, inspectionId: `${workspaceId}-inspection-1`, selections, remote: 'https://github.com/contoso/infra.git' },
			{ workspaceId, repositoryId: `${workspaceId}-repository-1` },
		]);
	});

	test('rejects broker-owned paths and malformed Stage 2 parameters from the extension', () => {
		const inspectionId = `${workspaceId}-inspection-1`;
		const selection = { candidateId: 'root-1', displayName: 'Hub network' };
		const rejected: [string, unknown][] = [
			['createProject', { name: 'Contoso', parentPath: 'C:\\Projects' }],
			['createProject', { name: '..' }],
			['createProject', { name: 'nested\\name' }],
			['createProject', { name: '' }],
			['createProject', { name: 'x'.repeat(256) }],
			['openProject', { projectPath: 'C:\\Projects\\Contoso' }],
			['grantProject', { workspaceFolders: ['C:\\Projects\\Contoso'] }],
			['forgetProjectAccess', { projectPath: 'C:\\Projects\\Contoso' }],
			['installGit', { arguments: ['--force'] }],
			['inspectRepository', { workspaceId, folderPath: 'C:\\Windows' }],
			['inspectRepository', { workspaceId, workspaceFolderIndex: -1 }],
			['inspectRepository', { workspaceId, workspaceFolderIndex: 1.5 }],
			['inspectRepository', { workspaceId, workspaceFolderIndex: '1' }],
			['importRepository', { workspaceId, inspectionId, selections: [] }],
			['importRepository', { workspaceId, inspectionId, selections: Array.from({ length: 33 }, () => selection) }],
			['importRepository', { workspaceId, inspectionId, selections: [{ ...selection, rootPath: ['envs'] }] }],
			['importRepository', { workspaceId, inspectionId, selections: [{ candidateId: 'root-1', displayName: '' }] }],
			['importRepository', { workspaceId, inspectionId, selections: [selection], remote: 'https://example.com/\nrepo' }],
			['importRepository', { workspaceId, inspectionId, selections: [selection], remote: 'x'.repeat(2049) }],
			['importRepository', { workspaceId, inspectionId, selections: [selection], folderPath: 'C:\\repo' }],
			['removeRepository', { workspaceId }],
			['createWorkspaceFile', { workspaceId, projectPath: 'C:\\Projects\\Contoso' }],
		];
		assert.deepStrictEqual(rejected.map(([method, params]) => validateCloudForgeServiceParams(method, params)), rejected.map(() => undefined));
	});

	test('resolves the project scope from the window, never from the request', async () => {
		const contosoFolders = contosoWindow.resolved!.folders.map(folder => folder.uri.fsPath);
		const single = URI.file('C:\\Projects\\Single');
		const lookup = async (configPath: URI) => [contosoWindow.resolved, resolved('C:\\Remote\\R.code-workspace', [URI.file('C:\\Remote')], 'ssh-remote+host'), resolved('C:\\Mixed\\M.code-workspace', [URI.file('C:\\Mixed'), URI.from({ scheme: 'vscode-remote', path: '/repo' })])]
			.find(candidate => candidate?.configPath.toString() === configPath.toString());
		assert.deepStrictEqual(await Promise.all([
			resolveCloudForgeWindowScope(contosoWindow.openedWorkspace, lookup),
			resolveCloudForgeWindowScope({ id: 'single', uri: single }, lookup),
			resolveCloudForgeWindowScope(undefined, lookup),
			resolveCloudForgeWindowScope({ id: 'untitled', configPath: URI.file('C:\\Users\\me\\AppData\\Roaming\\CloudForge\\Workspaces\\1\\workspace.json') }, lookup),
			resolveCloudForgeWindowScope(workspace('C:\\Remote\\R.code-workspace'), lookup),
			resolveCloudForgeWindowScope(workspace('C:\\Mixed\\M.code-workspace'), lookup),
			resolveCloudForgeWindowScope(workspace('C:\\Missing\\Missing.code-workspace'), lookup),
			resolveCloudForgeWindowScope({ id: 'unc', uri: URI.file('\\\\server\\share\\project') }, lookup),
			resolveCloudForgeWindowScope({ id: 'remote', uri: URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+host', path: '/project' }) }, lookup),
		]), [
			{ projectPath: fsPath('C:\\Projects\\Contoso Platform'), workspaceFolders: contosoFolders },
			{ projectPath: single.fsPath, workspaceFolders: [single.fsPath] },
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});

	test('supplies project paths from the calling window only', async () => {
		const { broker, call, callsByWindow } = createBroker([contosoWindow, fabrikamWindow]);
		const results = [
			await call(1, 'openProject', {}),
			await call(2, 'grantProject', {}),
			await call(1, 'forgetProjectAccess', {}),
		];
		assert.deepStrictEqual(results.map(result => result.ok), [true, true, true]);
		assert.deepStrictEqual(callsByWindow(), {
			1: [
				{ method: 'openProject', params: { projectPath: fsPath('C:\\Projects\\Contoso Platform'), workspaceFolders: contosoWindow.resolved!.folders.map(folder => folder.uri.fsPath) } },
				{ method: 'forgetProjectAccess', params: { projectPath: fsPath('C:\\Projects\\Contoso Platform') } },
			],
			2: [
				{ method: 'grantProject', params: { projectPath: fsPath('D:\\Work\\Fabrikam'), workspaceFolders: fabrikamWindow.resolved!.folders.map(folder => folder.uri.fsPath) } },
			],
		});
		await broker.stop();
	});

	test('chooses a repository only by index into the calling window\'s folders', async () => {
		const { broker, call, callsByWindow } = createBroker([contosoWindow, fabrikamWindow]);
		const results = [
			await call(1, 'inspectRepository', { workspaceId, workspaceFolderIndex: 2 }),
			await call(2, 'inspectRepository', { workspaceId, workspaceFolderIndex: 2 }),
			await call(1, 'inspectRepository', { workspaceId, folderPath: 'D:\\Work\\fabrikam-network' }),
		];
		assert.deepStrictEqual(results, [
			{ ok: true, value: {} },
			{ ok: false, error: { code: 'SCOPE_DENIED', message: 'The requested CloudForge workspace is not active in this window.' } },
			{ ok: false, error: { code: 'INVALID_PARAMS', message: 'The CloudForge request is invalid.' } },
		]);
		assert.deepStrictEqual(callsByWindow(), {
			1: [{ method: 'inspectRepository', params: { workspaceId, folderPath: fsPath('C:\\Projects\\platform-infra') } }],
			2: [],
		});
		await broker.stop();
	});

	test('sends no project request from a window without a saved local workspace', async () => {
		const emptyWindow: FakeWindow = { id: 3, openedWorkspace: undefined };
		const { broker, call, callsByWindow } = createBroker([emptyWindow]);
		const results = await Promise.all(['openProject', 'grantProject', 'forgetProjectAccess'].map(method => call(3, method, {})));
		results.push(await call(3, 'inspectRepository', { workspaceId, workspaceFolderIndex: 0 }));
		assert.deepStrictEqual(results.map(result => result.ok ? 'ok' : result.error.code), ['INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE']);
		assert.deepStrictEqual(callsByWindow(), { 3: [] });
		await broker.stop();
	});

	test('refuses calls from unknown windows', async () => {
		const { broker, call, callsByWindow } = createBroker([contosoWindow]);
		const result = await call(9, 'openProject', {});
		const malformed = await broker.call<CloudForgeCallResult>('window:01', 'openProject', {});
		assert.deepStrictEqual([result, malformed].map(item => item.ok ? 'ok' : item.error.code), ['SERVICE_UNAVAILABLE', 'SERVICE_UNAVAILABLE']);
		assert.deepStrictEqual(callsByWindow(), { 1: [] });
		await broker.stop();
	});

	test('sends nothing when the project location picker is cancelled', async () => {
		const { broker, call, callsByWindow, dialogs } = createBroker([contosoWindow]);
		const result = await call(1, 'createProject', { name: 'Contoso Platform' });
		assert.deepStrictEqual(result, { ok: false, error: { code: 'CANCELLED', message: 'The CloudForge request was cancelled.' } });
		assert.deepStrictEqual(dialogs.map(dialog => dialog.properties), [['openDirectory', 'createDirectory']]);
		assert.deepStrictEqual(callsByWindow(), { 1: [] });
		await broker.stop();
	});

	test('creates a project in the picked folder and returns the new workspace file', async () => {
		const { broker, call, callsByWindow } = createBroker([contosoWindow], {
			picked: ['D:\\Projects'],
			reply: () => ({ folderName: 'Contoso Platform', workspaceFileName: 'Contoso Platform.code-workspace' })
		});
		const result = await call(1, 'createProject', { name: 'Contoso Platform' });
		assert.deepStrictEqual(result, {
			ok: true,
			value: {
				folderName: 'Contoso Platform',
				workspaceFileName: 'Contoso Platform.code-workspace',
				workspaceFile: URI.file('D:\\Projects\\Contoso Platform\\Contoso Platform.code-workspace').toString()
			}
		});
		assert.deepStrictEqual(callsByWindow(), { 1: [{ method: 'createProject', params: { parentPath: 'D:\\Projects', name: 'Contoso Platform' } }] });
		await broker.stop();
	});

	test('refuses a picked folder that is not a local drive path, and unsafe service names', async () => {
		const unc = createBroker([contosoWindow], { picked: ['\\\\server\\share'] });
		const multiple = createBroker([contosoWindow], { picked: ['C:\\One', 'C:\\Two'] });
		const traversal = createBroker([contosoWindow], { picked: ['D:\\Projects'], reply: () => ({ folderName: '..', workspaceFileName: 'x.code-workspace' }) });
		const wrongExtension = createBroker([contosoWindow], { picked: ['D:\\Projects'], reply: () => ({ folderName: 'Contoso', workspaceFileName: 'payload.exe' }) });
		const results = [
			await unc.call(1, 'createProject', { name: 'Contoso' }),
			await multiple.call(1, 'createProject', { name: 'Contoso' }),
			await traversal.call(1, 'createProject', { name: 'Contoso' }),
			await wrongExtension.call(1, 'createProject', { name: 'Contoso' }),
		];
		assert.deepStrictEqual(results.map(result => result.ok ? 'ok' : result.error.code), ['SCOPE_DENIED', 'CANCELLED', 'SERVICE_ERROR', 'SERVICE_ERROR']);
		assert.deepStrictEqual([unc, multiple, traversal, wrongExtension].map(item => item.callsByWindow()[1].length), [0, 0, 1, 1]);
		await Promise.all([unc, multiple, traversal, wrongExtension].map(item => item.broker.stop()));
	});

	test('passes ID-only requests through and allows installGit its longer limit', async () => {
		const { broker, call, callsByWindow } = createBroker([contosoWindow]);
		await call(1, 'createWorkspaceFile', { workspaceId });
		await call(1, 'removeRepository', { workspaceId, repositoryId: `${workspaceId}-repository-1` });
		await call(1, 'installGit', {});
		assert.deepStrictEqual(callsByWindow(), {
			1: [
				{ method: 'createWorkspaceFile', params: { workspaceId } },
				{ method: 'removeRepository', params: { workspaceId, repositoryId: `${workspaceId}-repository-1` } },
				{ method: 'installGit', params: {}, timeoutMs: 11 * 60 * 1000 },
			]
		});
		await broker.stop();
	});

	test('returns fixed messages for Stage 2 service errors', async () => {
		const codes = ['CONSENT_REQUIRED', 'ALREADY_EXISTS', 'INVALID_PARAMS', 'STALE_SOURCE', 'NOT_A_KNOWN_CODE'];
		const results: CloudForgeCallResult[] = [];
		for (const code of codes) {
			const { broker, call } = createBroker([contosoWindow], { reply: () => { throw new CloudForgeServiceError(code); } });
			results.push(await call(1, 'openProject', {}));
			await broker.stop();
		}
		assert.deepStrictEqual(results, [
			{ ok: false, error: { code: 'CONSENT_REQUIRED', message: 'CloudForge needs your permission to read this project.' } },
			{ ok: false, error: { code: 'ALREADY_EXISTS', message: 'A CloudForge project or workspace file with that name already exists.' } },
			{ ok: false, error: { code: 'INVALID_PARAMS', message: 'The CloudForge request is invalid.' } },
			{ ok: false, error: { code: 'STALE_SOURCE', message: 'The workspace source changed. Reopen it to refresh the graph.' } },
			{ ok: false, error: { code: 'SERVICE_ERROR', message: 'The CloudForge service could not complete the request.' } },
		]);
	});
	test('gives a window a fresh service when it loads another workspace or reloads', async () => {
		const disposables = new DisposableStore();
		const loads = disposables.add(new Emitter<WindowLoad>());
		const { broker, call, created } = createBroker([contosoWindow, fabrikamWindow], { onWillLoadWindow: loads.event });
		await call(1, 'openProject', {});
		loads.fire({ window: { id: 1 }, reason: LoadReason.LOAD });
		await call(1, 'openProject', {});
		loads.fire({ window: { id: 2 }, reason: LoadReason.RELOAD });
		loads.fire({ window: { id: 1 }, reason: LoadReason.INITIAL });
		await call(2, 'grantProject', {});
		assert.deepStrictEqual(created.map(service => [service.state, service.calls.map(item => item.method)]), [
			['stopped', ['openProject']],
			['stopped', []],
			['started', ['openProject']],
			['started', ['grantProject']],
		]);
		await broker.stop();
		assert.deepStrictEqual(created.map(service => service.state), ['stopped', 'stopped', 'stopped', 'stopped']);
		loads.fire({ window: { id: 1 }, reason: LoadReason.RELOAD });
		assert.strictEqual(created.length, 4, 'A stopped broker starts no service.');
		disposables.dispose();
	});

	test('keeps the service started on the initial window load', async () => {
		const disposables = new DisposableStore();
		const loads = disposables.add(new Emitter<WindowLoad>());
		const { broker, created } = createBroker([contosoWindow], { onWillLoadWindow: loads.event });
		loads.fire({ window: { id: 1 }, reason: LoadReason.INITIAL });
		assert.deepStrictEqual(created.map(service => service.state), ['started']);
		await broker.stop();
		disposables.dispose();
	});
});
