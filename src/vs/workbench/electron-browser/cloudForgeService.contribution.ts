/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../base/common/network.js';
import { URI } from '../../base/common/uri.js';
import { Range } from '../../editor/common/core/range.js';
import { localize } from '../../nls.js';
import { CommandsRegistry } from '../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../platform/dialogs/common/dialogs.js';
import type { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
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
type CloudForgeServiceMethod = 'chooseTerraformRoot' | 'selectArchitecture' | 'readArchitecture';

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

	activeRoot = undefined;
	activeWorkspaceId = undefined;
	activeArchitectureId = undefined;
	architectureIds.clear();
	terraformCandidateIds.clear();

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
	if (method !== 'chooseTerraformRoot' && method !== 'selectArchitecture' && method !== 'readArchitecture') {
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
			if (!isOpaqueId(params.architectureId) || params.architectureId !== activeArchitectureId || (params.expectedSourceRevision !== undefined && (typeof params.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(params.expectedSourceRevision)))) {
				return failure('SCOPE_DENIED', 'The requested architecture is not active in this window.');
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

CommandsRegistry.registerCommand('_cloudforge.openSource', async (accessor, workspaceId: unknown, architectureId: unknown, sourceRevision: unknown, nodeId: unknown): Promise<CloudForgeCallResult> => {
	if (!isOpaqueId(workspaceId) || workspaceId !== activeWorkspaceId || !isOpaqueId(architectureId) || architectureId !== activeArchitectureId || typeof sourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(sourceRevision) || !isOpaqueId(nodeId)) {
		return failure('SCOPE_DENIED', 'The requested source is not active in this window.');
	}
	const root = activeRoot;
	if (!root || root.scheme !== Schemas.file) {
		return failure('WORKSPACE_UNAVAILABLE', 'The selected workspace is not available.');
	}
	const editorService = accessor.get(IEditorService);
	const textFileService = accessor.get(ITextFileService);

	const result = await serviceChannel(accessor).call<CloudForgeCallResult>('readArchitecture', {
		workspaceId,
		architectureId,
		expectedSourceRevision: sourceRevision
	});
	if (!isSuccess(result)) {
		return result;
	}
	if (root !== activeRoot || workspaceId !== activeWorkspaceId || architectureId !== activeArchitectureId) {
		return failure('SCOPE_DENIED', 'The requested source is no longer active in this window.');
	}
	const graph = result.value;
	if (!isRecord(graph) || graph.workspaceId !== workspaceId || graph.architectureId !== architectureId || graph.sourceRevision !== sourceRevision || !Array.isArray(graph.nodes)) {
		return failure('SERVICE_ERROR', 'The CloudForge service returned an invalid graph.');
	}
	const node = graph.nodes.find(candidate => isRecord(candidate) && candidate.id === nodeId);
	if (!isRecord(node) || !isRecord(node.source)) {
		return failure('UNSUPPORTED_FORMAT', 'This resource has no navigable source location.');
	}

	const source = node.source;
	if (!isSourceSegment(source.file) || !Array.isArray(graph.sourceRoot) || graph.sourceRoot.length > 4 || !graph.sourceRoot.every(isSourceSegment)) {
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
