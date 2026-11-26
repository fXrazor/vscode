/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../base/common/network.js';
import { dirname } from '../../base/common/resources.js';
import { URI } from '../../base/common/uri.js';
import { Range } from '../../editor/common/core/range.js';
import { localize } from '../../nls.js';
import { CommandsRegistry } from '../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../platform/dialogs/common/dialogs.js';
import type { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { IEditorService } from '../services/editor/common/editorService.js';
import { ITextFileService } from '../services/textfile/common/textfiles.js';

interface CloudForgeCallSuccess {
	readonly ok: true;
	readonly value: unknown;
}

interface CloudForgeCallFailure {
	readonly ok: false;
	readonly error: { readonly code: string; readonly message: string };
}

type CloudForgeCallResult = CloudForgeCallSuccess | CloudForgeCallFailure;
type CloudForgeServiceMethod =
	| 'chooseTerraformRoot' | 'selectArchitecture' | 'readArchitecture'
	| 'startValidationRun' | 'pollValidationRun' | 'cancelValidationRun'
	| 'previewDraftSave' | 'applyDraftSave' | 'previewFocusedSave' | 'applyFocusedSave' | 'readResourceValues'
	| 'previewFocusedSaveBatch' | 'applyFocusedSaveBatch'
	| 'summarizeState' | 'listCloudConnections' | 'setCloudConnection' | 'storeCloudKey' | 'removeCloudConnection' | 'checkCloudSignIn'
	| 'inspectDependencies' | 'readModule' | 'auditExportReadiness' | 'runEngineValidate' | 'runEnginePlan'
	| 'checkOfflineMirrorReadiness' | 'runEngineInitOffline';
type CloudForgeCatalogueMethod = 'inspectCatalogueSchemaFile' | 'importCatalogueSnapshot' | 'listCatalogueSnapshots' | 'listCatalogueTypes' | 'getResourceFormSchema' | 'getCatalogueCoverage' | 'renderResourceDraft' | 'listCloudRegions' | 'diffCatalogueSnapshots' | 'detectEngines' | 'listMirrorPackages' | 'extractProviderSchemaFromMirror' | 'importMirrorPackage' | 'downloadProviderPackage' | 'evictMirrorPackage' | 'verifyMirrorIntegrity' | 'planMirrorCleanup';
type CloudForgeProjectMethod = 'createProject' | 'openProject' | 'grantProject' | 'forgetProjectAccess' | 'createWorkspaceFile' | 'inspectRepository' | 'importRepository' | 'removeRepository' | 'createArchitecture' | 'summarizeArchitectures' | 'installGit';

const catalogueMethods: ReadonlySet<string> = new Set<CloudForgeCatalogueMethod>([
	'inspectCatalogueSchemaFile', 'importCatalogueSnapshot', 'listCatalogueSnapshots', 'listCatalogueTypes', 'getResourceFormSchema', 'getCatalogueCoverage', 'renderResourceDraft', 'listCloudRegions', 'diffCatalogueSnapshots', 'detectEngines', 'listMirrorPackages', 'extractProviderSchemaFromMirror', 'importMirrorPackage', 'downloadProviderPackage', 'evictMirrorPackage', 'verifyMirrorIntegrity', 'planMirrorCleanup'
]);

/**
 * Stage 2 project methods. Electron main validates their parameters and fills every path
 * (project folder, workspace folders, repository folder, parent of a new project); this bridge
 * only forwards them and tracks the resulting grant.
 */
const projectMethods: ReadonlySet<string> = new Set<CloudForgeProjectMethod>([
	'createProject', 'openProject', 'grantProject', 'forgetProjectAccess', 'createWorkspaceFile',
	'inspectRepository', 'importRepository', 'removeRepository', 'createArchitecture', 'summarizeArchitectures', 'installGit'
]);
const scopedProjectMethods: ReadonlySet<string> = new Set<CloudForgeProjectMethod>(['createWorkspaceFile', 'inspectRepository', 'importRepository', 'removeRepository', 'createArchitecture', 'summarizeArchitectures']);

interface WorkspaceChoice {
	readonly workspaceId: string;
	readonly kind: 'project' | 'terraform';
	readonly selectionRequired: boolean;
	readonly architectures: readonly { readonly architectureId: string; readonly displayName: string }[];
	readonly terraformRoots: readonly { readonly candidateId: string; readonly displayName: string }[];
}

let activeRoot: URI | undefined;
let activeWorkspaceId: string | undefined;
let activeArchitectureId: string | undefined;
let architectureIds = new Set<string>();
let terraformCandidateIds = new Set<string>();
/** For a Stage 2 project grant: each available repository's index in the window's folders. */
let repositoryFolders = new Map<string, number>();

function clearActiveGrant(): void {
	activeRoot = undefined;
	activeWorkspaceId = undefined;
	activeArchitectureId = undefined;
	architectureIds = new Set();
	terraformCandidateIds = new Set();
	repositoryFolders = new Map();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSourceSegment(segment: unknown): segment is string {
	return typeof segment === 'string' && segment.length > 0 && segment.length <= 255 && segment.trim() === segment && !segment.endsWith('.') && !/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(segment);
}

function failure(code: string, message: string): CloudForgeCallFailure {
	return { ok: false, error: { code, message } };
}

function isSuccess(value: CloudForgeCallResult): value is CloudForgeCallSuccess {
	return isRecord(value) && value.ok === true && 'value' in value;
}

function readWorkspaceChoice(value: unknown): WorkspaceChoice | undefined {
	if (!isRecord(value) || !isOpaqueId(value.workspaceId) || (value.kind !== 'project' && value.kind !== 'terraform') || typeof value.selectionRequired !== 'boolean' || !Array.isArray(value.architectures) || value.architectures.length > 256) {
		return undefined;
	}
	const architectures: { architectureId: string; displayName: string }[] = [];
	for (const item of value.architectures) {
		if (!isRecord(item) || !isOpaqueId(item.architectureId) || typeof item.displayName !== 'string' || item.displayName.length > 256) {
			return undefined;
		}
		architectures.push({ architectureId: item.architectureId, displayName: item.displayName });
	}
	const terraformRoots: { candidateId: string; displayName: string }[] = [];
	if (value.terraformRoots !== undefined) {
		if (!Array.isArray(value.terraformRoots) || value.terraformRoots.length > 64) {
			return undefined;
		}
		for (const item of value.terraformRoots) {
			if (!isRecord(item) || !isOpaqueId(item.candidateId) || typeof item.displayName !== 'string' || item.displayName.length > 256) {
				return undefined;
			}
			terraformRoots.push({ candidateId: item.candidateId, displayName: item.displayName });
		}
	}
	return {
		workspaceId: value.workspaceId,
		kind: value.kind,
		selectionRequired: value.selectionRequired,
		architectures,
		terraformRoots
	};
}

function serviceChannel(accessor: ServicesAccessor) {
	return accessor.get(IMainProcessService).getChannel('cloudforge');
}

/** The project folder: the folder of the window's workspace file, or its single folder. */
function projectFolder(workspaceContext: IWorkspaceContextService): URI | undefined {
	const workspace = workspaceContext.getWorkspace();
	if (workspace.configuration?.scheme === Schemas.file) {
		return dirname(workspace.configuration);
	}
	return workspace.folders.length === 1 && workspace.folders[0].uri.scheme === Schemas.file ? workspace.folders[0].uri : undefined;
}

/** Records a project result (open, grant, import, remove) as the window's active grant. */
function applyProjectResult(workspaceContext: IWorkspaceContextService, value: unknown): boolean {
	if (!isRecord(value) || value.kind !== 'project' || !isOpaqueId(value.workspaceId) || !Array.isArray(value.architectures) || value.architectures.length > 1024 || !Array.isArray(value.repositories) || value.repositories.length > 1024) {
		return false;
	}
	const folders = new Map<string, number>();
	for (const repository of value.repositories) {
		if (!isRecord(repository) || !isOpaqueId(repository.repositoryId)) {
			return false;
		}
		const index = repository.workspaceFolderIndex;
		if (repository.status === 'available' && typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) {
			folders.set(repository.repositoryId, index);
		}
	}
	const ids = new Set<string>();
	for (const architecture of value.architectures) {
		if (!isRecord(architecture) || !isOpaqueId(architecture.architectureId)) {
			return false;
		}
		ids.add(architecture.architectureId);
	}
	const root = projectFolder(workspaceContext);
	if (!root) {
		return false;
	}
	if (activeWorkspaceId !== value.workspaceId || (activeArchitectureId !== undefined && !ids.has(activeArchitectureId))) {
		activeArchitectureId = undefined;
	}
	activeRoot = root;
	activeWorkspaceId = value.workspaceId;
	architectureIds = ids;
	terraformCandidateIds = new Set();
	repositoryFolders = folders;
	return true;
}

async function callProjectMethod(accessor: ServicesAccessor, method: CloudForgeProjectMethod, params: Record<string, unknown>): Promise<CloudForgeCallResult> {
	if (scopedProjectMethods.has(method) && (!isOpaqueId(params.workspaceId) || params.workspaceId !== activeWorkspaceId)) {
		return failure('SCOPE_DENIED', 'The requested CloudForge project is not active in this window.');
	}
	// The accessor is valid only until the first await: take the services now.
	const channel = serviceChannel(accessor);
	const workspaceContext = accessor.get(IWorkspaceContextService);
	if (method === 'openProject' || method === 'grantProject') {
		// Opening a project revokes the previous grant, as the service does.
		clearActiveGrant();
	}
	let result: CloudForgeCallResult;
	try {
		result = await channel.call<CloudForgeCallResult>(method, params);
	} catch {
		return failure('SERVICE_UNAVAILABLE', 'The CloudForge service is unavailable.');
	}
	if (!isSuccess(result)) {
		return result;
	}
	switch (method) {
		case 'openProject':
		case 'grantProject':
		case 'importRepository':
		case 'removeRepository':
		case 'createArchitecture':
			if (!applyProjectResult(workspaceContext, result.value)) {
				clearActiveGrant();
				return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid project.');
			}
			break;
		case 'forgetProjectAccess':
			clearActiveGrant();
			break;
	}
	return result;
}

CommandsRegistry.registerCommand('_cloudforge.openWorkspace', async accessor => {
	const channel = serviceChannel(accessor);
	const folders = await accessor.get(IFileDialogService).showOpenDialog({
		title: localize('cloudForge.pickWorkspace', 'Open a CloudForge Workspace'),
		openLabel: localize('cloudForge.openFolder', 'Open Folder'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		availableFileSystems: [Schemas.file]
	});
	const root = folders?.[0];
	if (!root) {
		return { cancelled: true };
	}
	if (root.scheme !== Schemas.file) {
		return { cancelled: false, result: failure('WORKSPACE_UNAVAILABLE', 'Choose a local folder.') };
	}

	clearActiveGrant();

	let result: CloudForgeCallResult;
	try {
		result = await channel.call<CloudForgeCallResult>('openWorkspace', { rootPath: root.fsPath });
	} catch {
		return { cancelled: false, result: failure('SERVICE_UNAVAILABLE', 'The CloudForge service is unavailable.') };
	}
	if (!isSuccess(result)) {
		return { cancelled: false, result };
	}
	const choice = readWorkspaceChoice(result.value);
	if (!choice) {
		return { cancelled: false, result: failure('SERVICE_ERROR', 'The CloudForge service returned an invalid workspace.') };
	}

	activeRoot = root;
	activeWorkspaceId = choice.workspaceId;
	architectureIds = new Set(choice.architectures.map(architecture => architecture.architectureId));
	terraformCandidateIds = new Set(choice.terraformRoots.map(candidate => candidate.candidateId));
	if (choice.kind === 'terraform' && !choice.selectionRequired && choice.architectures.length === 1) {
		activeArchitectureId = choice.architectures[0].architectureId;
	}
	return { cancelled: false, result };
});

CommandsRegistry.registerCommand('_cloudforge.callService', async (accessor, method: unknown, params: unknown): Promise<CloudForgeCallResult> => {
	if (typeof method === 'string' && projectMethods.has(method)) {
		return isRecord(params)
			? callProjectMethod(accessor, method as CloudForgeProjectMethod, params)
			: failure('INVALID_PARAMS', 'The CloudForge request is invalid.');
	}
	if (typeof method === 'string' && catalogueMethods.has(method)) {
		if (!isRecord(params)) {
			return failure('INVALID_PARAMS', 'The CloudForge request is invalid.');
		}
		if ((method === 'diffCatalogueSnapshots' || method === 'planMirrorCleanup') && (params.workspaceId !== undefined || params.architectureId !== undefined)) {
			if (!isOpaqueId(params.workspaceId) || params.workspaceId !== activeWorkspaceId || !isOpaqueId(params.architectureId) || params.architectureId !== activeArchitectureId) {
				return failure('SCOPE_DENIED', 'The requested architecture is not active in this window.');
			}
		}
		try {
			return await serviceChannel(accessor).call<CloudForgeCallResult>(method, params);
		} catch {
			return failure('SERVICE_UNAVAILABLE', 'The CloudForge service is unavailable.');
		}
	}
	if (
		method !== 'chooseTerraformRoot' && method !== 'selectArchitecture' && method !== 'readArchitecture' &&
		method !== 'startValidationRun' && method !== 'pollValidationRun' && method !== 'cancelValidationRun' &&
		method !== 'previewDraftSave' && method !== 'applyDraftSave' && method !== 'previewFocusedSave' && method !== 'applyFocusedSave' &&
		method !== 'previewFocusedSaveBatch' && method !== 'applyFocusedSaveBatch' &&
		method !== 'summarizeState' && method !== 'listCloudConnections' && method !== 'setCloudConnection' && method !== 'storeCloudKey' && method !== 'removeCloudConnection' && method !== 'checkCloudSignIn' &&
		method !== 'inspectDependencies' && method !== 'readResourceValues' &&
		method !== 'readModule' && method !== 'auditExportReadiness' && method !== 'runEngineValidate' &&
		method !== 'runEnginePlan' && method !== 'checkOfflineMirrorReadiness' && method !== 'runEngineInitOffline'
	) {
		return failure('INVALID_PARAMS', 'The CloudForge request is invalid.');
	}
	if (!isRecord(params) || !isOpaqueId(params.workspaceId) || params.workspaceId !== activeWorkspaceId) {
		return failure('SCOPE_DENIED', 'The requested CloudForge workspace is not active in this window.');
	}

	switch (method as CloudForgeServiceMethod) {
		case 'chooseTerraformRoot':
			if (!isOpaqueId(params.candidateId) || !terraformCandidateIds.has(params.candidateId)) {
				return failure('INVALID_PARAMS', 'Choose a Terraform root from the current workspace.');
			}
			break;
		case 'selectArchitecture':
			if (!isOpaqueId(params.architectureId) || !architectureIds.has(params.architectureId)) {
				return failure('INVALID_PARAMS', 'Choose an architecture from the current workspace.');
			}
			break;
		case 'readArchitecture':
		case 'startValidationRun':
		case 'inspectDependencies':
		case 'readResourceValues':
		case 'summarizeState':
		case 'readModule':
		case 'auditExportReadiness':
		case 'runEngineValidate':
		case 'runEnginePlan':
		case 'checkOfflineMirrorReadiness':
		case 'runEngineInitOffline':
			if (!isOpaqueId(params.architectureId) || params.architectureId !== activeArchitectureId || (params.expectedSourceRevision !== undefined && (typeof params.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(params.expectedSourceRevision)))) {
				return failure('SCOPE_DENIED', 'The requested architecture is not active in this window.');
			}
			break;
		case 'previewDraftSave':
		case 'applyDraftSave':
		case 'previewFocusedSave':
		case 'applyFocusedSave':
		case 'previewFocusedSaveBatch':
		case 'applyFocusedSaveBatch':
			if (!isOpaqueId(params.architectureId) || params.architectureId !== activeArchitectureId || typeof params.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(params.expectedSourceRevision)) {
				return failure('SCOPE_DENIED', 'The requested architecture is not active in this window.');
			}
			break;
		case 'listCloudConnections':
		case 'setCloudConnection':
		case 'storeCloudKey':
		case 'removeCloudConnection':
		case 'checkCloudSignIn':
			// Workspace-scoped (checked above); Electron main validates the provider and fields.
			break;
		case 'pollValidationRun':
		case 'cancelValidationRun':
			if (!isOpaqueId(params.runId)) {
				return failure('INVALID_PARAMS', 'The CloudForge request is invalid.');
			}
			break;
	}

	const result = await serviceChannel(accessor).call<CloudForgeCallResult>(method, params);
	if (!isSuccess(result)) {
		return result;
	}
	if (method === 'chooseTerraformRoot') {
		const selected = readWorkspaceChoice(result.value);
		if (!selected || selected.kind !== 'terraform' || selected.architectures.length !== 1) {
			return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid Terraform root.');
		}
		activeWorkspaceId = selected.workspaceId;
		activeArchitectureId = selected.architectures[0].architectureId;
		architectureIds = new Set([activeArchitectureId]);
		terraformCandidateIds.clear();
	} else if (method === 'selectArchitecture') {
		const selected = result.value;
		if (!isRecord(selected) || selected.workspaceId !== activeWorkspaceId || !isOpaqueId(selected.architectureId) || selected.architectureId !== params.architectureId) {
			return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid architecture.');
		}
		activeArchitectureId = selected.architectureId;
	}
	return result;
});

type ArchitectureSource = { readonly graph: Record<string, unknown> & { readonly nodes: unknown[]; readonly sourceRoot: string[] }; readonly root: URI };

/**
 * Re-reads the active architecture at `sourceRevision` and resolves the folder its sources live in
 * (the project, or a linked repository's workspace folder). Shared by the source navigation commands.
 */
async function resolveArchitectureSource(accessor: ServicesAccessor, workspaceId: unknown, architectureId: unknown, sourceRevision: unknown): Promise<ArchitectureSource | CloudForgeCallFailure> {
	if (!isOpaqueId(workspaceId) || workspaceId !== activeWorkspaceId || !isOpaqueId(architectureId) || architectureId !== activeArchitectureId || typeof sourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(sourceRevision)) {
		return failure('SCOPE_DENIED', 'The requested source is not active in this window.');
	}
	const projectRoot = activeRoot;
	if (!projectRoot || projectRoot.scheme !== Schemas.file) {
		return failure('WORKSPACE_UNAVAILABLE', 'The selected workspace is not available.');
	}
	const workspaceContext = accessor.get(IWorkspaceContextService);
	const result = await serviceChannel(accessor).call<CloudForgeCallResult>('readArchitecture', {
		workspaceId,
		architectureId,
		expectedSourceRevision: sourceRevision
	});
	if (!isSuccess(result)) {
		return result;
	}
	if (projectRoot !== activeRoot || workspaceId !== activeWorkspaceId || architectureId !== activeArchitectureId) {
		return failure('SCOPE_DENIED', 'The requested source is no longer active in this window.');
	}
	const graph = result.value;
	if (!isRecord(graph) || graph.workspaceId !== workspaceId || graph.architectureId !== architectureId || graph.sourceRevision !== sourceRevision || !Array.isArray(graph.nodes)) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid graph.');
	}
	// A linked architecture's source lives in its repository's workspace folder (Stage 2).
	let root = projectRoot;
	if (isRecord(graph.sourceBase) && graph.sourceBase.kind === 'repository') {
		const index = isOpaqueId(graph.sourceBase.repositoryId) ? repositoryFolders.get(graph.sourceBase.repositoryId) : undefined;
		const folder = index === undefined ? undefined : workspaceContext.getWorkspace().folders[index];
		if (!folder || folder.uri.scheme !== Schemas.file) {
			return failure('WORKSPACE_UNAVAILABLE', 'The repository for this architecture is not open in this window.');
		}
		root = folder.uri;
	} else if (graph.sourceBase !== undefined && !(isRecord(graph.sourceBase) && graph.sourceBase.kind === 'project')) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid source location.');
	}
	if (!Array.isArray(graph.sourceRoot) || graph.sourceRoot.length > 8 || !graph.sourceRoot.every(isSourceSegment)) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid source location.');
	}
	return { graph: graph as ArchitectureSource['graph'], root };
}

function isFailure(value: ArchitectureSource | CloudForgeCallFailure): value is CloudForgeCallFailure {
	return 'ok' in value && value.ok === false;
}

CommandsRegistry.registerCommand('_cloudforge.openSource', async (accessor, workspaceId: unknown, architectureId: unknown, sourceRevision: unknown, nodeId: unknown): Promise<CloudForgeCallResult> => {
	if (!isOpaqueId(nodeId)) {
		return failure('SCOPE_DENIED', 'The requested source is not active in this window.');
	}
	const editorService = accessor.get(IEditorService);
	const textFileService = accessor.get(ITextFileService);
	const resolved = await resolveArchitectureSource(accessor, workspaceId, architectureId, sourceRevision);
	if (isFailure(resolved)) {
		return resolved;
	}
	const { graph, root } = resolved;
	const node = graph.nodes.find(candidate => isRecord(candidate) && candidate.id === nodeId);
	if (!isRecord(node) || !isRecord(node.source)) {
		return failure('UNSUPPORTED_FORMAT', 'This resource has no navigable source location.');
	}
	const source = node.source;
	if (!isSourceSegment(source.file)) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid source location.');
	}
	if (typeof source.line !== 'number' || !Number.isSafeInteger(source.line) || source.line < 1 || typeof source.column !== 'number' || !Number.isSafeInteger(source.column) || source.column < 1 || typeof source.endLine !== 'number' || !Number.isSafeInteger(source.endLine) || source.endLine < source.line || typeof source.endColumn !== 'number' || !Number.isSafeInteger(source.endColumn) || source.endColumn < 1 || (source.endLine === source.line && source.endColumn < source.column)) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid source location.');
	}

	const resource = URI.joinPath(root, ...graph.sourceRoot, source.file);
	if (textFileService.isDirty(resource)) {
		return failure('STALE_SOURCE', 'The source has unsaved changes. Save it and refresh the graph before navigating.');
	}
	await editorService.openEditor({
		resource,
		options: {
			selection: new Range(source.line, source.column, source.endLine, source.endColumn),
			pinned: true
		}
	});
	return { ok: true, value: true };
});

/**
 * Opens a diagnostic's reported file and line (for example from `runEngineValidate`) inside the active
 * architecture's verified root. The file must be a single `.tf` / `.tf.json` name; the revision must still
 * be current, so a stale diagnostic never opens a line in changed source.
 */
CommandsRegistry.registerCommand('_cloudforge.openSourceLocation', async (accessor, workspaceId: unknown, architectureId: unknown, sourceRevision: unknown, fileName: unknown, line: unknown, column: unknown): Promise<CloudForgeCallResult> => {
	if (!isSourceSegment(fileName) || !/\.tf(\.json)?$/i.test(fileName) || (line !== undefined && (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1)) || (column !== undefined && (typeof column !== 'number' || !Number.isSafeInteger(column) || column < 1))) {
		return failure('SCOPE_DENIED', 'The requested source is not active in this window.');
	}
	const editorService = accessor.get(IEditorService);
	const resolved = await resolveArchitectureSource(accessor, workspaceId, architectureId, sourceRevision);
	if (isFailure(resolved)) {
		return resolved;
	}
	const resource = URI.joinPath(resolved.root, ...resolved.graph.sourceRoot, fileName);
	const startLine = typeof line === 'number' ? line : 1;
	const startColumn = typeof column === 'number' ? column : 1;
	await editorService.openEditor({
		resource,
		options: { selection: new Range(startLine, startColumn, startLine, startColumn), pinned: true }
	});
	return { ok: true, value: true };
});
