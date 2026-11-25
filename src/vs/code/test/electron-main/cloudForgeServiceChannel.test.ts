/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as electron from 'electron';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import type { ICodeWindow } from '../../../platform/window/electron-main/window.js';
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
	constructor(private readonly reply: Reply) { }
	async start(): Promise<void> { }
	async stop(): Promise<void> { }
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

function createBroker(windows: readonly FakeWindow[], options: { readonly reply?: Reply; readonly picked?: readonly string[] } = {}) {
	const services = new Map<number, FakeService>();
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
		() => {
			const window = pending.shift()!;
			const service = new FakeService(options.reply ?? (() => ({})));
			services.set(window.id, service);
			return service;
		}
	);
	const call = (windowId: number, method: string, params: unknown) => broker.call<CloudForgeCallResult>(`window:${windowId}`, method, params);
	const callsByWindow = () => Object.fromEntries([...services].map(([id, service]) => [id, service.calls]));
	return { broker, call, callsByWindow, dialogs };
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

	test('accepts createArchitecture names and .tf starter files and rejects anything else', () => {
		const starter = { fileName: 'main.tf', contents: '# Hub\n' };
		assert.deepStrictEqual(validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Network' }), { workspaceId, name: 'Network' });
		assert.deepStrictEqual(validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Legacy', adoptRootFiles: ['main.tf', 'outputs.tf'] }), { workspaceId, name: 'Legacy', adoptRootFiles: ['main.tf', 'outputs.tf'] });
		assert.strictEqual(validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Legacy', adoptRootFiles: ['..\\x.tf'] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Legacy', adoptRootFiles: ['notes.txt'] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Legacy', adoptRootFiles: [] }), undefined);
		assert.deepStrictEqual(
			validateCloudForgeServiceParams('createArchitecture', { workspaceId, name: 'Network', files: [starter, { fileName: 'variables.tf.json', contents: '{}' }] }),
			{ workspaceId, name: 'Network', files: [starter, { fileName: 'variables.tf.json', contents: '{}' }] }
		);
		const rejected: unknown[] = [
			{ workspaceId, name: '..' },
			{ workspaceId, name: 'nested\\name' },
			{ workspaceId, name: 'Network', path: 'C:\\Elsewhere' },
			{ workspaceId, name: 'Network', files: [{ fileName: 'notes.txt', contents: '' }] },
			{ workspaceId, name: 'Network', files: [{ fileName: '..\\main.tf', contents: '' }] },
			{ workspaceId, name: 'Network', files: [{ fileName: 'main.tf', contents: 'x'.repeat(2 * 1024 * 1024 + 1) }] },
			{ workspaceId, name: 'Network', files: [{ fileName: 'main.tf', contents: '', mode: 'overwrite' }] },
			{ workspaceId, name: 'Network', files: Array.from({ length: 17 }, (_, index) => ({ fileName: `f${index}.tf`, contents: '' })) },
		];
		assert.deepStrictEqual(rejected.map(params => validateCloudForgeServiceParams('createArchitecture', params)), rejected.map(() => undefined));
	});

	test('accepts summarizeArchitectures with only the workspace id', () => {
		assert.deepStrictEqual(validateCloudForgeServiceParams('summarizeArchitectures', { workspaceId }), { workspaceId });
		assert.strictEqual(validateCloudForgeServiceParams('summarizeArchitectures', {}), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('summarizeArchitectures', { workspaceId, architectureId: `${workspaceId}-architecture-1` }), undefined);
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

	test('validates Stage 3 catalogue and Stage 4 validation runner parameters and rejects extra fields', async () => {
		const sha256 = 'a'.repeat(64);
		const key = { address: 'registry.terraform.io/hashicorp/azurerm', version: '5.14.0', formatVersion: '1.0', sha256 };
		assert.deepStrictEqual(validateCloudForgeServiceParams('listCatalogueSnapshots', {}), {});
		assert.strictEqual(validateCloudForgeServiceParams('listCatalogueSnapshots', { path: 'C:\\Windows' }), undefined);
		assert.ok(validateCloudForgeServiceParams('listCatalogueTypes', { key }));
		assert.strictEqual(validateCloudForgeServiceParams('listCatalogueTypes', { key: { ...key, address: '../escape/azurerm' } }), undefined);
		assert.ok(validateCloudForgeServiceParams('getResourceFormSchema', { key, kind: 'resource', typeName: 'azurerm_resource_group' }));
		assert.strictEqual(validateCloudForgeServiceParams('getResourceFormSchema', { key, kind: 'provider', typeName: 'azurerm_resource_group' }), undefined);
		assert.ok(validateCloudForgeServiceParams('getCatalogueCoverage', { key }));
		assert.ok(validateCloudForgeServiceParams('getCatalogueCoverage', { key, kind: 'resource', typeName: 'azurerm_resource_group' }));
		assert.strictEqual(validateCloudForgeServiceParams('getCatalogueCoverage', { key, kind: 'resource' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('getCatalogueCoverage', { key, typeName: 'azurerm_resource_group' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('getCatalogueCoverage', { key, path: 'C:\\x' }), undefined);
		assert.ok(validateCloudForgeServiceParams('renderResourceDraft', {
			key,
			draft: { kind: 'dataSource', typeName: 'azurerm_resource_group', label: 'hub', body: { attributes: { name: { kind: 'literal', value: 'rg-hub' } }, blocks: [] } }
		}));

		assert.ok(validateCloudForgeServiceParams('startValidationRun', { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256 }));
		assert.strictEqual(validateCloudForgeServiceParams('startValidationRun', { workspaceId, architectureId: `${workspaceId}-architecture-1`, rootPath: 'C:\\Windows' }), undefined);
		assert.ok(validateCloudForgeServiceParams('pollValidationRun', { workspaceId, runId: `${workspaceId}-run-1`, cursor: 0, maxEvents: 128, includeSnapshot: true }));
		assert.strictEqual(validateCloudForgeServiceParams('pollValidationRun', { workspaceId, runId: `${workspaceId}-run-1`, maxEvents: 0 }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('pollValidationRun', { workspaceId, runId: `${workspaceId}-run-1`, maxEvents: 513 }), undefined);
		assert.ok(validateCloudForgeServiceParams('cancelValidationRun', { workspaceId, runId: `${workspaceId}-run-1` }));

		const draftBase = { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256, fileName: 'main.tf', contents: 'resource "x" "y" {}\n' };
		assert.ok(validateCloudForgeServiceParams('previewDraftSave', draftBase));
		assert.strictEqual(validateCloudForgeServiceParams('previewDraftSave', { ...draftBase, fileName: '../escape.tf' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewDraftSave', { ...draftBase, fileName: 'secrets.tfvars' }), undefined);
		assert.ok(validateCloudForgeServiceParams('applyDraftSave', { ...draftBase, previewToken: 'save-0123456789abcdef0123456789abcdef' }));
		assert.strictEqual(validateCloudForgeServiceParams('applyDraftSave', { ...draftBase, previewToken: 'save-0123', extra: true }), undefined);
		assert.ok(validateCloudForgeServiceParams('previewFocusedSave', draftBase));
		assert.deepStrictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, removeAddresses: ['aws_vpc.main'] }), { ...draftBase, removeAddresses: ['aws_vpc.main'] });
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, removeAddresses: [''] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, removeAddresses: 'aws_vpc.main' }), undefined);
		assert.deepStrictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, renames: [{ from: 'a.b', to: 'a.c' }] }), { ...draftBase, renames: [{ from: 'a.b', to: 'a.c' }] });
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, renames: [{ from: 'a.b' }] }), undefined);
		assert.deepStrictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, baseContents: 'resource "x" "y" {}\n' }), { ...draftBase, baseContents: 'resource "x" "y" {}\n' });
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSave', { ...draftBase, baseContents: 3 }), undefined);
		const { contents: _contents, ...focusedApply } = { ...draftBase, previewToken: 'save-0123456789abcdef0123456789abcdef' };
		assert.ok(validateCloudForgeServiceParams('applyFocusedSave', focusedApply));
		assert.strictEqual(validateCloudForgeServiceParams('applyFocusedSave', { ...focusedApply, contents: 'x' }), undefined);
		const batchBase = { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256 };
		assert.deepStrictEqual(
			validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: [{ fileName: 'main.tf', contents: 'a', baseContents: 'b' }, { fileName: 'net.tf', contents: 'c', renames: [{ from: 'a.b', to: 'a.c' }] }] }),
			{ ...batchBase, files: [{ fileName: 'main.tf', contents: 'a', baseContents: 'b' }, { fileName: 'net.tf', contents: 'c', renames: [{ from: 'a.b', to: 'a.c' }] }] }
		);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: [] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: [{ fileName: 'main.tf', contents: 'a' }, { fileName: 'MAIN.tf', contents: 'b' }] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: [{ fileName: '../x.tf', contents: 'a' }] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: [{ fileName: 'main.tf', contents: 'a', workspaceId }] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('previewFocusedSaveBatch', { ...batchBase, files: Array.from({ length: 17 }, (_, index) => ({ fileName: `f${index}.tf`, contents: '' })) }), undefined);
		assert.ok(validateCloudForgeServiceParams('applyFocusedSaveBatch', { ...batchBase, previewToken: 'save-0123456789abcdef0123456789abcdef' }));
		assert.strictEqual(validateCloudForgeServiceParams('applyFocusedSaveBatch', { ...batchBase, previewToken: 'save-0123456789abcdef0123456789abcdef', fileName: 'main.tf' }), undefined);

		assert.ok(validateCloudForgeServiceParams('readResourceValues', { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256 }));
		assert.strictEqual(validateCloudForgeServiceParams('readResourceValues', { workspaceId, architectureId: `${workspaceId}-architecture-1`, rootPath: 'C:\\Windows' }), undefined);
		assert.ok(validateCloudForgeServiceParams('inspectDependencies', { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256, engine: 'opentofu' }));
		assert.strictEqual(validateCloudForgeServiceParams('inspectDependencies', { workspaceId, architectureId: `${workspaceId}-architecture-1`, engine: 'pulumi' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('inspectDependencies', { workspaceId, architectureId: `${workspaceId}-architecture-1`, rootPath: 'C:\\Windows' }), undefined);
		assert.ok(validateCloudForgeServiceParams('readModule', { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256, modulePath: ['net', 'sub'] }));
		assert.strictEqual(validateCloudForgeServiceParams('readModule', { workspaceId, architectureId: `${workspaceId}-architecture-1`, modulePath: [] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('readModule', { workspaceId, architectureId: `${workspaceId}-architecture-1`, modulePath: ['../outside'] }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('readModule', { workspaceId, architectureId: `${workspaceId}-architecture-1`, modulePath: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }), undefined);
		const keyV2 = { ...key, version: '6.0.0', sha256: 'b'.repeat(64) };
		assert.ok(validateCloudForgeServiceParams('diffCatalogueSnapshots', { fromKey: key, toKey: keyV2 }));
		assert.ok(validateCloudForgeServiceParams('diffCatalogueSnapshots', { fromKey: key, toKey: keyV2, workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256 }));
		assert.strictEqual(validateCloudForgeServiceParams('diffCatalogueSnapshots', { fromKey: key, toKey: keyV2, workspaceId }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('diffCatalogueSnapshots', { fromKey: key, toKey: keyV2, expectedSourceRevision: sha256 }), undefined);
		assert.ok(validateCloudForgeServiceParams('auditExportReadiness', { workspaceId, architectureId: `${workspaceId}-architecture-1`, expectedSourceRevision: sha256, engine: 'openTofu' }));
		assert.strictEqual(validateCloudForgeServiceParams('auditExportReadiness', { workspaceId, architectureId: `${workspaceId}-architecture-1`, engine: 'pulumi' }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('auditExportReadiness', { workspaceId, architectureId: `${workspaceId}-architecture-1`, rootPath: 'C:\\Windows' }), undefined);
		assert.ok(validateCloudForgeServiceParams('listCloudRegions', {
			provider: 'azure',
			scope: { provider: 'azure', cloud: 'AzureCloud', tenantId: 'tenant-1', subscriptionId: 'sub-1' },
			configuredRegions: ['uksouth', 'eastus']
		}));
		assert.strictEqual(validateCloudForgeServiceParams('listCloudRegions', { provider: 'azure', scope: { provider: 'aws', partition: 'aws', accountId: '123' } }), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('listCloudRegions', { provider: 'digitalocean' }), undefined);

		const { broker, call } = createBroker([contosoWindow], { reply: () => { throw new CloudForgeServiceError('SCHEMA_UNAVAILABLE'); } });
		const schemaErr = await call(1, 'listCatalogueTypes', { key });
		assert.deepStrictEqual(schemaErr, { ok: false, error: { code: 'SCHEMA_UNAVAILABLE', message: 'The requested provider schema snapshot or resource type is not available.' } });
		await broker.stop();
	});

	test('picks a local schema JSON file in Electron main for inspectCatalogueSchemaFile and validates importCatalogueSnapshot', async () => {
		assert.deepStrictEqual(validateCloudForgeServiceParams('inspectCatalogueSchemaFile', {}), {});
		assert.strictEqual(validateCloudForgeServiceParams('inspectCatalogueSchemaFile', { schemaPath: 'C:\\schema.json' }), undefined);
		assert.ok(validateCloudForgeServiceParams('importCatalogueSnapshot', {
			previewId: 'schema-1',
			address: 'registry.terraform.io/hashicorp/azurerm',
			version: '5.14.0',
			engineName: 'openTofu',
			engineVersion: '1.11.0'
		}));
		assert.strictEqual(validateCloudForgeServiceParams('importCatalogueSnapshot', {
			previewId: 'schema-1',
			address: 'hashicorp/azurerm',
			version: '5.14.0',
			engineName: 'openTofu',
			engineVersion: '1.11.0'
		}), undefined);
		assert.strictEqual(validateCloudForgeServiceParams('importCatalogueSnapshot', {
			previewId: 'schema-1',
			address: 'registry.terraform.io/hashicorp/azurerm',
			version: '5.14.0',
			engineName: 'pulumi',
			engineVersion: '1.11.0'
		}), undefined);

		const cancelled = createBroker([contosoWindow]);
		assert.deepStrictEqual(await cancelled.call(1, 'inspectCatalogueSchemaFile', {}), {
			ok: false,
			error: { code: 'CANCELLED', message: 'The CloudForge request was cancelled.' }
		});
		assert.deepStrictEqual(cancelled.dialogs.map(dialog => dialog.properties), [['openFile']]);
		assert.deepStrictEqual(cancelled.callsByWindow(), { 1: [] });

		const unc = createBroker([contosoWindow], { picked: ['\\\\server\\share\\schema.json'] });
		assert.deepStrictEqual(await unc.call(1, 'inspectCatalogueSchemaFile', {}), {
			ok: false,
			error: { code: 'SCOPE_DENIED', message: 'The requested CloudForge workspace is not active in this window.' }
		});
		assert.deepStrictEqual(unc.callsByWindow(), { 1: [] });

		const local = createBroker([contosoWindow], {
			picked: ['D:\\Schemas\\azurerm.json'],
			reply: () => ({ previewId: 'schema-1', fileName: 'azurerm.json', formatVersion: '1.0', providers: [] })
		});
		const inspected = await local.call(1, 'inspectCatalogueSchemaFile', {});
		assert.strictEqual(inspected.ok, true);
		assert.deepStrictEqual(local.callsByWindow(), {
			1: [{ method: 'inspectCatalogueSchemaFile', params: { schemaPath: 'D:\\Schemas\\azurerm.json' } }]
		});

		await Promise.all([cancelled, unc, local].map(item => item.broker.stop()));
	});

	test('validates Stage 9 detectEngines and runEngineValidate parameters and rejects extra fields', () => {
		const rev = 'a'.repeat(64);
		assert.deepStrictEqual(validateCloudForgeServiceParams('detectEngines', {}), {});
		assert.strictEqual(validateCloudForgeServiceParams('detectEngines', { path: 'C:\\Tools' }), undefined);
		assert.deepStrictEqual(validateCloudForgeServiceParams('runEngineValidate', {
			workspaceId: 'workspace-1',
			architectureId: 'workspace-1-architecture-1',
			expectedSourceRevision: rev,
			engine: 'openTofu'
		}), {
			workspaceId: 'workspace-1',
			architectureId: 'workspace-1-architecture-1',
			expectedSourceRevision: rev,
			engine: 'openTofu'
		});
		assert.strictEqual(validateCloudForgeServiceParams('runEngineValidate', {
			workspaceId: 'workspace-1',
			architectureId: 'workspace-1-architecture-1',
			engine: 'bash'
		}), undefined);
	});
});
