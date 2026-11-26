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
import type { ICodeWindow } from '../../platform/window/electron-main/window.js';
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
	'inspectRepository', 'importRepository', 'removeRepository', 'createArchitecture', 'summarizeArchitectures', 'installGit',
	'inspectCatalogueSchemaFile', 'importCatalogueSnapshot',
	'listCatalogueSnapshots', 'listCatalogueTypes', 'getResourceFormSchema', 'getCatalogueCoverage', 'renderResourceDraft',
	'startValidationRun', 'pollValidationRun', 'cancelValidationRun',
	'previewDraftSave', 'applyDraftSave', 'previewFocusedSave', 'applyFocusedSave',
	'previewFocusedSaveBatch', 'applyFocusedSaveBatch',
	'inspectDependencies', 'readResourceValues', 'listCloudRegions', 'readModule',
	'summarizeState', 'listCloudConnections', 'setCloudConnection', 'storeCloudKey', 'removeCloudConnection', 'checkCloudSignIn',
	'diffCatalogueSnapshots', 'auditExportReadiness',
	'detectEngines', 'runEngineValidate', 'runEnginePlan',
	'listMirrorPackages', 'checkOfflineMirrorReadiness', 'runEngineInitOffline', 'extractProviderSchemaFromMirror',
	'importMirrorPackage', 'evictMirrorPackage', 'verifyMirrorIntegrity', 'planMirrorCleanup',
	'selectTerraformSkills', 'listBuiltinSkills', 'getTopologyBlueprint',
	'getLearningRecord', 'saveLearningRecord', 'submitProposal', 'reviewProposal',
	'issueMcpGrant', 'listMcpGrants', 'revokeMcpGrant'
]);

/** The service allows `installGit` 10 minutes; the broker waits a little longer for its reply. */
const installGitTimeoutMs = 11 * 60 * 1000;
/** Stage 9B `runEnginePlan` allows 60 s for `plan` + 30 s for `show -json`; the broker waits 120 s. */
const enginePlanTimeoutMs = 2 * 60 * 1000;
/** Stage 10 `runEngineInitOffline` allows 120 s; the broker waits 125 s. */
const engineInitOfflineTimeoutMs = 125 * 1000;
/** Stage 10 `extractProviderSchemaFromMirror` allows 120 s init + 120 s schema; the broker waits 245 s. */
const extractMirrorSchemaTimeoutMs = 245 * 1000;
/** Stage 10B `importMirrorPackage` streams & verifies large provider ZIP archives; wait 65 s. */
const importMirrorPackageTimeoutMs = 65 * 1000;
const maxPathLength = 32767;
const maxNameLength = 255;
const maxRemoteBytes = 2048;
const cloudProviders: ReadonlySet<string> = new Set(['azure', 'aws', 'google']);
/** A batch save must fit in one service request (2 MiB) with room for the envelope. */
const maxBatchBytes = 1_900_000;
const maxSelections = 32;
const maxWorkspaceFolders = 1024;
const maxPollEvents = 512;
const maxDraftBytes = 512 * 1024;
const maxStarterFiles = 16;
const maxStarterBytes = 2 * 1024 * 1024;
const maxConfiguredRegions = 128;
const maxScopeFieldLength = 128;

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
	SCHEMA_UNAVAILABLE: 'The requested provider schema snapshot or resource type is not available.',
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

function isSnapshotSegment(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '.' && value !== '..' && /^[A-Za-z0-9._+-]+$/.test(value);
}

function validateSnapshotKey(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value) || !hasOnlyKeys(value, ['address', 'version', 'formatVersion', 'sha256'])) {
		return undefined;
	}
	if (typeof value.address !== 'string') {
		return undefined;
	}
	const segments = value.address.split('/');
	if (segments.length !== 3 || !segments.every(isSnapshotSegment)) {
		return undefined;
	}
	if (!isSnapshotSegment(value.version) || !isSnapshotSegment(value.formatVersion)) {
		return undefined;
	}
	if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
		return undefined;
	}
	return { address: value.address, version: value.version, formatVersion: value.formatVersion, sha256: value.sha256 };
}

function isTypeName(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isSchemaKind(value: unknown): value is 'resource' | 'dataSource' {
	return value === 'resource' || value === 'dataSource';
}

function isScopeText(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maxScopeFieldLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateCloudScope(provider: 'azure' | 'aws' | 'google', value: unknown): Record<string, string> | undefined {
	if (!isRecord(value) || value.provider !== provider) {
		return undefined;
	}
	switch (provider) {
		case 'azure':
			if (!hasOnlyKeys(value, ['provider', 'cloud', 'tenantId', 'subscriptionId']) || !isScopeText(value.cloud) || !isScopeText(value.tenantId) || !isScopeText(value.subscriptionId)) {
				return undefined;
			}
			return { provider: 'azure', cloud: value.cloud, tenantId: value.tenantId, subscriptionId: value.subscriptionId };
		case 'aws':
			if (!hasOnlyKeys(value, ['provider', 'partition', 'accountId']) || !isScopeText(value.partition) || !isScopeText(value.accountId)) {
				return undefined;
			}
			return { provider: 'aws', partition: value.partition, accountId: value.accountId };
		case 'google':
			if (!hasOnlyKeys(value, ['provider', 'projectId']) || !isScopeText(value.projectId)) {
				return undefined;
			}
			return { provider: 'google', projectId: value.projectId };
	}
}

function validateDraftBody(value: unknown, depth: number): Record<string, unknown> | undefined {
	if (depth > 8 || !isRecord(value) || !hasOnlyKeys(value, ['attributes', 'blocks'])) {
		return undefined;
	}
	const attributes = value.attributes === undefined ? {} : value.attributes;
	const blocks = value.blocks === undefined ? [] : value.blocks;
	if (!isRecord(attributes) || !Array.isArray(blocks) || blocks.length > 256) {
		return undefined;
	}
	const cleanAttrs: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(attributes)) {
		if (!isTypeName(key) || !isRecord(entry)) {
			return undefined;
		}
		if (entry.kind === 'literal' && hasOnlyKeys(entry, ['kind', 'value']) && Object.hasOwn(entry, 'value')) {
			cleanAttrs[key] = { kind: 'literal', value: entry.value };
		} else if (entry.kind === 'expression' && hasOnlyKeys(entry, ['kind', 'text']) && typeof entry.text === 'string' && entry.text.length <= 16384) {
			cleanAttrs[key] = { kind: 'expression', text: entry.text };
		} else {
			return undefined;
		}
	}
	const cleanBlocks: Record<string, unknown>[] = [];
	for (const block of blocks) {
		if (!isRecord(block) || !hasOnlyKeys(block, ['name', 'origin', 'body']) || !isTypeName(block.name)) {
			return undefined;
		}
		if (block.origin !== undefined && (typeof block.origin !== 'number' || !Number.isSafeInteger(block.origin) || block.origin < 0)) {
			return undefined;
		}
		const body = block.body === undefined ? { attributes: {}, blocks: [] } : validateDraftBody(block.body, depth + 1);
		if (!body) {
			return undefined;
		}
		cleanBlocks.push({
			name: block.name,
			...(block.origin === undefined ? {} : { origin: block.origin }),
			body
		});
	}
	return { attributes: cleanAttrs, blocks: cleanBlocks };
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
		case 'summarizeArchitectures': {
			return hasOnlyKeys(value, ['workspaceId']) && isOpaqueId(value.workspaceId) ? { workspaceId: value.workspaceId } : undefined;
		}
		case 'createArchitecture': {
			if (!hasOnlyKeys(value, ['workspaceId', 'name', 'files', 'adoptRootFiles']) || !isOpaqueId(value.workspaceId) || !isPathComponent(value.name)) {
				return undefined;
			}
			const adopt = value.adoptRootFiles;
			if (adopt !== undefined && (!Array.isArray(adopt) || adopt.length === 0 || adopt.length > maxStarterFiles ||
				!adopt.every(name => isPathComponent(name) && /\.tf(\.json)?$/i.test(name)))) {
				return undefined;
			}
			const adoptRootFiles = adopt === undefined ? {} : { adoptRootFiles: [...adopt as string[]] };
			if (value.files === undefined) {
				return { workspaceId: value.workspaceId, name: value.name, ...adoptRootFiles };
			}
			if (!Array.isArray(value.files) || value.files.length > maxStarterFiles) {
				return undefined;
			}
			const files: { fileName: string; contents: string }[] = [];
			for (const file of value.files) {
				if (
					!isRecord(file) || !hasOnlyKeys(file, ['fileName', 'contents']) ||
					!isPathComponent(file.fileName) || !/\.tf(\.json)?$/i.test(file.fileName) ||
					typeof file.contents !== 'string' || Buffer.byteLength(file.contents, 'utf8') > maxStarterBytes
				) {
					return undefined;
				}
				files.push({ fileName: file.fileName, contents: file.contents });
			}
			return { workspaceId: value.workspaceId, name: value.name, files, ...adoptRootFiles };
		}
		case 'inspectCatalogueSchemaFile':
		case 'listCatalogueSnapshots': {
			return Object.keys(value).length === 0 ? {} : undefined;
		}
		case 'importCatalogueSnapshot': {
			if (
				!hasOnlyKeys(value, ['previewId', 'address', 'version', 'engineName', 'engineVersion']) ||
				typeof value.previewId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.previewId) ||
				typeof value.address !== 'string' ||
				!isSnapshotSegment(value.version) ||
				(value.engineName !== 'terraform' && value.engineName !== 'openTofu') ||
				!isSnapshotSegment(value.engineVersion)
			) {
				return undefined;
			}
			const segments = value.address.split('/');
			if (segments.length !== 3 || !segments.every(isSnapshotSegment)) {
				return undefined;
			}
			return {
				previewId: value.previewId,
				address: value.address,
				version: value.version,
				engineName: value.engineName,
				engineVersion: value.engineVersion
			};
		}
		case 'listCatalogueTypes': {
			if (!hasOnlyKeys(value, ['key'])) {
				return undefined;
			}
			const key = validateSnapshotKey(value.key);
			return key ? { key } : undefined;
		}
		case 'getResourceFormSchema': {
			if (!hasOnlyKeys(value, ['key', 'kind', 'typeName']) || !isSchemaKind(value.kind) || !isTypeName(value.typeName)) {
				return undefined;
			}
			const key = validateSnapshotKey(value.key);
			return key ? { key, kind: value.kind, typeName: value.typeName } : undefined;
		}
		case 'getCatalogueCoverage': {
			if (!hasOnlyKeys(value, ['key', 'kind', 'typeName']) || (value.kind === undefined) !== (value.typeName === undefined)) {
				return undefined;
			}
			const key = validateSnapshotKey(value.key);
			if (!key) {
				return undefined;
			}
			if (value.kind === undefined) {
				return { key };
			}
			return isSchemaKind(value.kind) && isTypeName(value.typeName) ? { key, kind: value.kind, typeName: value.typeName } : undefined;
		}
		case 'renderResourceDraft': {
			if (!hasOnlyKeys(value, ['key', 'draft']) || !isRecord(value.draft)) {
				return undefined;
			}
			const key = validateSnapshotKey(value.key);
			const draft = value.draft;
			if (!key || !hasOnlyKeys(draft, ['kind', 'typeName', 'label', 'body']) || !isSchemaKind(draft.kind) || !isTypeName(draft.typeName) || typeof draft.label !== 'string' || draft.label.length > 256 || /[\u0000-\u001f\u007f]/.test(draft.label)) {
				return undefined;
			}
			const body = draft.body === undefined ? { attributes: {}, blocks: [] } : validateDraftBody(draft.body, 0);
			if (!body) {
				return undefined;
			}
			return { key, draft: { kind: draft.kind, typeName: draft.typeName, label: draft.label, body } };
		}
		case 'startValidationRun': {
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
		case 'pollValidationRun': {
			if (!hasOnlyKeys(value, ['workspaceId', 'runId', 'cursor', 'maxEvents', 'includeSnapshot']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.runId)) {
				return undefined;
			}
			if (value.cursor !== undefined && (typeof value.cursor !== 'number' || !Number.isSafeInteger(value.cursor) || value.cursor < 0)) {
				return undefined;
			}
			if (value.maxEvents !== undefined && (typeof value.maxEvents !== 'number' || !Number.isSafeInteger(value.maxEvents) || value.maxEvents < 1 || value.maxEvents > maxPollEvents)) {
				return undefined;
			}
			if (value.includeSnapshot !== undefined && typeof value.includeSnapshot !== 'boolean') {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				runId: value.runId,
				...(value.cursor === undefined ? {} : { cursor: value.cursor }),
				...(value.maxEvents === undefined ? {} : { maxEvents: value.maxEvents }),
				...(value.includeSnapshot === undefined ? {} : { includeSnapshot: value.includeSnapshot })
			};
		}
		case 'cancelValidationRun': {
			if (!hasOnlyKeys(value, ['workspaceId', 'runId']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.runId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, runId: value.runId };
		}
		case 'previewDraftSave': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'fileName', 'contents']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!isPathComponent(value.fileName) || value.fileName.startsWith('.') || !value.fileName.toLowerCase().endsWith('.tf') || value.fileName.length <= 3 ||
				typeof value.contents !== 'string' || Buffer.byteLength(value.contents, 'utf8') > maxDraftBytes
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				fileName: value.fileName,
				contents: value.contents
			};
		}
		case 'applyDraftSave': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'fileName', 'contents', 'previewToken']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!isPathComponent(value.fileName) || value.fileName.startsWith('.') || !value.fileName.toLowerCase().endsWith('.tf') || value.fileName.length <= 3 ||
				typeof value.contents !== 'string' || Buffer.byteLength(value.contents, 'utf8') > maxDraftBytes ||
				!isOpaqueId(value.previewToken)
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				fileName: value.fileName,
				contents: value.contents,
				previewToken: value.previewToken
			};
		}
		case 'previewFocusedSave': {
			const removeAddresses = value.removeAddresses;
			const renames = value.renames;
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'fileName', 'contents', 'removeAddresses', 'renames', 'baseContents']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!isPathComponent(value.fileName) || value.fileName.startsWith('.') || !value.fileName.toLowerCase().endsWith('.tf') || value.fileName.length <= 3 ||
				typeof value.contents !== 'string' || Buffer.byteLength(value.contents, 'utf8') > maxDraftBytes ||
				(removeAddresses !== undefined && (!Array.isArray(removeAddresses) || removeAddresses.length > 256 ||
					!removeAddresses.every(address => typeof address === 'string' && address.length > 0 && address.length <= 512))) ||
				(renames !== undefined && (!Array.isArray(renames) || renames.length > 256 ||
					!renames.every(rename => isRecord(rename) && hasOnlyKeys(rename, ['from', 'to']) &&
						typeof rename.from === 'string' && rename.from.length > 0 && rename.from.length <= 512 &&
						typeof rename.to === 'string' && rename.to.length > 0 && rename.to.length <= 512))) ||
				(value.baseContents !== undefined && (typeof value.baseContents !== 'string' || Buffer.byteLength(value.baseContents, 'utf8') > maxDraftBytes))
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				fileName: value.fileName,
				contents: value.contents,
				...(removeAddresses === undefined ? {} : { removeAddresses: [...removeAddresses as string[]] }),
				...(renames === undefined ? {} : { renames: (renames as { from: string; to: string }[]).map(({ from, to }) => ({ from, to })) }),
				...(typeof value.baseContents === 'string' ? { baseContents: value.baseContents } : {})
			};
		}
		case 'applyFocusedSave': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'fileName', 'previewToken']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!isPathComponent(value.fileName) || value.fileName.startsWith('.') || !value.fileName.toLowerCase().endsWith('.tf') || value.fileName.length <= 3 ||
				!isOpaqueId(value.previewToken)
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				fileName: value.fileName,
				previewToken: value.previewToken
			};
		}
		case 'previewFocusedSaveBatch': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'files']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 16
			) {
				return undefined;
			}
			const files: Record<string, unknown>[] = [];
			const names = new Set<string>();
			let total = 0;
			for (const file of value.files) {
				if (!isRecord(file) || Object.hasOwn(file, 'workspaceId') || Object.hasOwn(file, 'architectureId') || Object.hasOwn(file, 'expectedSourceRevision')) {
					return undefined;
				}
				const checked = validateCloudForgeServiceParams('previewFocusedSave', {
					...file,
					workspaceId: value.workspaceId,
					architectureId: value.architectureId,
					expectedSourceRevision: value.expectedSourceRevision
				});
				if (!checked || names.has(String(checked.fileName).toLowerCase())) {
					return undefined;
				}
				names.add(String(checked.fileName).toLowerCase());
				total += Buffer.byteLength(String(checked.contents), 'utf8') + (typeof checked.baseContents === 'string' ? Buffer.byteLength(checked.baseContents, 'utf8') : 0);
				delete checked.workspaceId;
				delete checked.architectureId;
				delete checked.expectedSourceRevision;
				files.push(checked);
			}
			if (total > maxBatchBytes) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				files
			};
		}
		case 'applyFocusedSaveBatch': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'previewToken']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision) ||
				!isOpaqueId(value.previewToken)
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				expectedSourceRevision: value.expectedSourceRevision,
				previewToken: value.previewToken
			};
		}
		case 'summarizeState':
			return validateCloudForgeServiceParams('readResourceValues', value);
		case 'listCloudConnections':
			return hasOnlyKeys(value, ['workspaceId']) && isOpaqueId(value.workspaceId) ? { workspaceId: value.workspaceId } : undefined;
		case 'checkCloudSignIn':
			// Read-only: the service runs the provider CLI's identity command, never a caller-supplied one.
			return hasOnlyKeys(value, ['workspaceId', 'provider']) && isOpaqueId(value.workspaceId) && cloudProviders.has(value.provider as string)
				? { workspaceId: value.workspaceId, provider: value.provider }
				: undefined;
		case 'setCloudConnection':
		case 'storeCloudKey':
		case 'removeCloudConnection': {
			const field = method === 'setCloudConnection' ? 'binding' : method === 'storeCloudKey' ? 'key' : undefined;
			const keys = ['workspaceId', 'provider', ...(field ? [field] : ['keyOnly'])];
			if (!hasOnlyKeys(value, keys) || !isOpaqueId(value.workspaceId) || !cloudProviders.has(value.provider as string)) {
				return undefined;
			}
			if (field) {
				// Shape only: the service checks every field. A key is passed through once and never logged.
				const body = value[field];
				if (!isRecord(body) || Object.keys(body).length > 8 || !Object.values(body).every(item => item === null || (typeof item === 'string' && item.length <= 512))) {
					return undefined;
				}
				return { workspaceId: value.workspaceId, provider: value.provider, [field]: { ...body } };
			}
			if (value.keyOnly !== undefined && typeof value.keyOnly !== 'boolean') {
				return undefined;
			}
			return { workspaceId: value.workspaceId, provider: value.provider, ...(value.keyOnly === true ? { keyOnly: true } : {}) };
		}
		case 'readResourceValues': {
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
		case 'inspectDependencies': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'engine']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined && (typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision))) {
				return undefined;
			}
			if (value.engine !== undefined && value.engine !== 'opentofu' && value.engine !== 'terraform') {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision }),
				...(value.engine === undefined ? {} : { engine: value.engine })
			};
		}
		case 'readModule': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'modulePath']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined && (typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision))) {
				return undefined;
			}
			if (!Array.isArray(value.modulePath) || value.modulePath.length === 0 || value.modulePath.length > 8) {
				return undefined;
			}
			const modulePath: string[] = [];
			for (const seg of value.modulePath) {
				if (typeof seg !== 'string' || seg.length === 0 || seg.length > 128 || !/^[A-Za-z0-9_-]+$/.test(seg)) {
					return undefined;
				}
				modulePath.push(seg);
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision }),
				modulePath
			};
		}
		case 'diffCatalogueSnapshots': {
			if (!hasOnlyKeys(value, ['fromKey', 'toKey', 'workspaceId', 'architectureId', 'expectedSourceRevision'])) {
				return undefined;
			}
			const fromKey = validateSnapshotKey(value.fromKey);
			const toKey = validateSnapshotKey(value.toKey);
			if (!fromKey || !toKey) {
				return undefined;
			}
			const hasWs = value.workspaceId !== undefined;
			const hasArch = value.architectureId !== undefined;
			if (hasWs !== hasArch) {
				return undefined;
			}
			if (hasWs && (!isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId))) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined) {
				if (!hasWs || typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision)) {
					return undefined;
				}
			}
			return {
				fromKey,
				toKey,
				...(hasWs ? { workspaceId: value.workspaceId, architectureId: value.architectureId } : {}),
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision })
			};
		}
		case 'auditExportReadiness':
		case 'runEngineValidate':
		case 'runEnginePlan':
		case 'runEngineInitOffline': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'engine']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined && (typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision))) {
				return undefined;
			}
			if (value.engine !== undefined && value.engine !== 'openTofu' && value.engine !== 'terraform') {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision }),
				...(value.engine === undefined ? {} : { engine: value.engine })
			};
		}
		case 'checkOfflineMirrorReadiness': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'expectedSourceRevision', 'engine', 'platforms']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined && (typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision))) {
				return undefined;
			}
			if (value.engine !== undefined && value.engine !== 'openTofu' && value.engine !== 'terraform') {
				return undefined;
			}
			let platforms: string[] | undefined;
			if (value.platforms !== undefined) {
				if (!Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.length > 8) {
					return undefined;
				}
				platforms = [];
				for (const item of value.platforms) {
					if (typeof item !== 'string' || !/^[a-z0-9]{1,32}_[a-z0-9]{1,32}$/.test(item)) {
						return undefined;
					}
					platforms.push(item);
				}
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision }),
				...(value.engine === undefined ? {} : { engine: value.engine }),
				...(platforms === undefined ? {} : { platforms })
			};
		}
		case 'extractProviderSchemaFromMirror': {
			if (!hasOnlyKeys(value, ['address', 'version', 'engine']) || typeof value.address !== 'string' || !isSnapshotSegment(value.version)) {
				return undefined;
			}
			const segments = value.address.split('/');
			if (segments.length !== 3 || !segments.every(isSnapshotSegment)) {
				return undefined;
			}
			if (value.engine !== undefined && value.engine !== 'openTofu' && value.engine !== 'terraform') {
				return undefined;
			}
			return {
				address: value.address,
				version: value.version,
				...(value.engine === undefined ? {} : { engine: value.engine })
			};
		}
		case 'importMirrorPackage': {
			// `archivePath` is strictly broker-owned (supplied via Electron-main native .zip picker).
			if (
				!hasOnlyKeys(value, ['address', 'version', 'platform', 'expectedSha256', 'publisher']) ||
				typeof value.address !== 'string' ||
				!isSnapshotSegment(value.version) ||
				typeof value.platform !== 'string' || !/^[a-z0-9]{1,32}_[a-z0-9]{1,32}$/.test(value.platform) ||
				typeof value.expectedSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value.expectedSha256)
			) {
				return undefined;
			}
			const segments = value.address.split('/');
			if (segments.length !== 3 || !segments.every(isSnapshotSegment)) {
				return undefined;
			}
			if (value.publisher !== undefined && !isScopeText(value.publisher)) {
				return undefined;
			}
			return {
				address: value.address,
				version: value.version,
				platform: value.platform,
				expectedSha256: value.expectedSha256.toLowerCase(),
				...(value.publisher === undefined ? {} : { publisher: value.publisher.trim() })
			};
		}
		case 'evictMirrorPackage': {
			if (
				!hasOnlyKeys(value, ['address', 'version', 'platform']) ||
				typeof value.address !== 'string' ||
				!isSnapshotSegment(value.version) ||
				typeof value.platform !== 'string' || !/^[a-z0-9]{1,32}_[a-z0-9]{1,32}$/.test(value.platform)
			) {
				return undefined;
			}
			const segments = value.address.split('/');
			if (segments.length !== 3 || !segments.every(isSnapshotSegment)) {
				return undefined;
			}
			return {
				address: value.address,
				version: value.version,
				platform: value.platform
			};
		}
		case 'planMirrorCleanup': {
			if (!hasOnlyKeys(value, ['quotaBytes', 'workspaceId', 'architectureId', 'expectedSourceRevision', 'engine'])) {
				return undefined;
			}
			if (typeof value.quotaBytes !== 'number' || !Number.isSafeInteger(value.quotaBytes) || value.quotaBytes < 0) {
				return undefined;
			}
			const hasWs = value.workspaceId !== undefined;
			const hasArch = value.architectureId !== undefined;
			if (hasWs !== hasArch) {
				return undefined;
			}
			if (hasWs && (!isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId))) {
				return undefined;
			}
			if (value.expectedSourceRevision !== undefined) {
				if (!hasWs || typeof value.expectedSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSourceRevision)) {
					return undefined;
				}
			}
			if (value.engine !== undefined && value.engine !== 'openTofu' && value.engine !== 'terraform') {
				return undefined;
			}
			return {
				quotaBytes: value.quotaBytes,
				...(hasWs ? { workspaceId: value.workspaceId, architectureId: value.architectureId } : {}),
				...(value.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: value.expectedSourceRevision }),
				...(value.engine === undefined ? {} : { engine: value.engine })
			};
		}
		case 'detectEngines':
		case 'listMirrorPackages':
		case 'verifyMirrorIntegrity':
			return hasOnlyKeys(value, []) ? {} : undefined;
		case 'listCloudRegions': {
			if (!hasOnlyKeys(value, ['provider', 'scope', 'configuredRegions'])) {
				return undefined;
			}
			if (value.provider !== 'azure' && value.provider !== 'aws' && value.provider !== 'google') {
				return undefined;
			}
			let scope: Record<string, string> | undefined;
			if (value.scope !== undefined) {
				scope = validateCloudScope(value.provider, value.scope);
				if (!scope) {
					return undefined;
				}
			}
			let configuredRegions: string[] | undefined;
			if (value.configuredRegions !== undefined) {
				if (!Array.isArray(value.configuredRegions) || value.configuredRegions.length > maxConfiguredRegions) {
					return undefined;
				}
				configuredRegions = [];
				for (const item of value.configuredRegions) {
					if (typeof item !== 'string' || item.length > maxScopeFieldLength || /[\u0000-\u001f\u007f]/.test(item)) {
						return undefined;
					}
					configuredRegions.push(item);
				}
			}
			return {
				provider: value.provider,
				...(scope === undefined ? {} : { scope }),
				...(configuredRegions === undefined ? {} : { configuredRegions })
			};
		}
		case 'selectTerraformSkills': {
			const validKinds = new Set(['generate', 'diagram', 'topology', 'refactor', 'review', 'test']);
			if (!hasOnlyKeys(value, ['taskKind', 'prompt', 'runtime']) || typeof value.taskKind !== 'string' || !validKinds.has(value.taskKind)) {
				return undefined;
			}
			if (value.prompt !== undefined && (typeof value.prompt !== 'string' || value.prompt.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.prompt))) {
				return undefined;
			}
			if (value.runtime !== undefined && value.runtime !== 'openTofu' && value.runtime !== 'terraform' && value.runtime !== 'auto') {
				return undefined;
			}
			return {
				taskKind: value.taskKind,
				...(value.prompt === undefined ? {} : { prompt: value.prompt }),
				...(value.runtime === undefined ? {} : { runtime: value.runtime })
			};
		}
		case 'listBuiltinSkills': {
			const validCategories = new Set(['cloudforge-diagram', 'cloudforge-topology', 'cloudforge-workflow', 'terraform']);
			if (!hasOnlyKeys(value, ['category'])) {
				return undefined;
			}
			if (value.category !== undefined && (typeof value.category !== 'string' || !validCategories.has(value.category))) {
				return undefined;
			}
			return value.category === undefined ? {} : { category: value.category };
		}
		case 'getTopologyBlueprint': {
			if (!hasOnlyKeys(value, ['blueprintId'])) {
				return undefined;
			}
			if (value.blueprintId !== undefined && (typeof value.blueprintId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.blueprintId))) {
				return undefined;
			}
			return value.blueprintId === undefined ? {} : { blueprintId: value.blueprintId };
		}
		case 'getLearningRecord': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			return { workspaceId: value.workspaceId, architectureId: value.architectureId };
		}
		case 'saveLearningRecord': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'task', 'notes']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			const result: Record<string, unknown> = { workspaceId: value.workspaceId, architectureId: value.architectureId };
			if (value.task !== undefined) {
				if (value.task !== null) {
					if (!isRecord(value.task) || !hasOnlyKeys(value.task, ['title', 'mode', 'objective', 'requirements', 'assumptions', 'skillIds'])) {
						return undefined;
					}
					if (typeof value.task.title !== 'string' || value.task.title.length === 0 || value.task.title.length > 200) {
						return undefined;
					}
					if (value.task.mode !== 'hint' && value.task.mode !== 'guided' && value.task.mode !== 'workedExample') {
						return undefined;
					}
					if (typeof value.task.objective !== 'string' || value.task.objective.length > 4000) {
						return undefined;
					}
					if (value.task.requirements !== undefined && (!Array.isArray(value.task.requirements) || value.task.requirements.length > 64)) {
						return undefined;
					}
					if (value.task.assumptions !== undefined && (!Array.isArray(value.task.assumptions) || value.task.assumptions.length > 32)) {
						return undefined;
					}
					if (value.task.skillIds !== undefined && (!Array.isArray(value.task.skillIds) || value.task.skillIds.length > 16)) {
						return undefined;
					}
				}
				result.task = value.task;
			}
			if (value.notes !== undefined) {
				if (!isRecord(value.notes) || Object.keys(value.notes).length > 256) {
					return undefined;
				}
				result.notes = value.notes;
			}
			return result;
		}
		case 'submitProposal': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'origin', 'title', 'summary', 'baseSourceRevision', 'skillIds', 'requirementIds', 'files']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 200 ||
				typeof value.summary !== 'string' || value.summary.length > 2000 ||
				typeof value.baseSourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.baseSourceRevision) ||
				!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 16
			) {
				return undefined;
			}
			if (value.origin !== undefined && (typeof value.origin !== 'string' || value.origin.length === 0 || value.origin.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(value.origin))) {
				return undefined;
			}
			if (value.skillIds !== undefined && (!Array.isArray(value.skillIds) || value.skillIds.length > 16 || !value.skillIds.every(item => typeof item === 'string' && /^[a-z0-9-]{1,64}$/.test(item)))) {
				return undefined;
			}
			if (value.requirementIds !== undefined && (!Array.isArray(value.requirementIds) || value.requirementIds.length > 64 || !value.requirementIds.every(item => isOpaqueId(item)))) {
				return undefined;
			}
			const files: { fileName: string; contents: string; rationale?: string }[] = [];
			const seen = new Set<string>();
			let totalBytes = 0;
			for (const file of value.files) {
				if (
					!isRecord(file) || !hasOnlyKeys(file, ['fileName', 'contents', 'rationale']) ||
					!isPathComponent(file.fileName) || file.fileName.startsWith('.') || !file.fileName.toLowerCase().endsWith('.tf') || file.fileName.length <= 3 ||
					typeof file.contents !== 'string' || Buffer.byteLength(file.contents, 'utf8') > maxDraftBytes ||
					(file.rationale !== undefined && (typeof file.rationale !== 'string' || file.rationale.length > 500))
				) {
					return undefined;
				}
				const lower = file.fileName.toLowerCase();
				if (seen.has(lower)) {
					return undefined;
				}
				seen.add(lower);
				totalBytes += Buffer.byteLength(file.contents, 'utf8');
				files.push({
					fileName: file.fileName,
					contents: file.contents,
					...(file.rationale === undefined ? {} : { rationale: file.rationale })
				});
			}
			if (totalBytes > maxBatchBytes) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.origin === undefined ? {} : { origin: value.origin }),
				title: value.title,
				summary: value.summary,
				baseSourceRevision: value.baseSourceRevision,
				...(value.skillIds === undefined ? {} : { skillIds: [...value.skillIds as string[]] }),
				...(value.requirementIds === undefined ? {} : { requirementIds: [...value.requirementIds as string[]] }),
				files
			};
		}
		case 'reviewProposal': {
			if (
				!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'proposalId', 'action']) ||
				!isOpaqueId(value.workspaceId) ||
				!isOpaqueId(value.architectureId) ||
				!isOpaqueId(value.proposalId) ||
				(value.action !== 'markAccepted' && value.action !== 'reject')
			) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				proposalId: value.proposalId,
				action: value.action
			};
		}
		case 'issueMcpGrant': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId', 'clientLabel', 'ttlMinutes']) || !isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId)) {
				return undefined;
			}
			if (value.clientLabel !== undefined && (typeof value.clientLabel !== 'string' || value.clientLabel.trim().length === 0 || value.clientLabel.length > 64 || !/^[A-Za-z0-9._ -]+$/.test(value.clientLabel))) {
				return undefined;
			}
			if (value.ttlMinutes !== undefined && (typeof value.ttlMinutes !== 'number' || !Number.isSafeInteger(value.ttlMinutes) || value.ttlMinutes < 5 || value.ttlMinutes > 1440)) {
				return undefined;
			}
			return {
				workspaceId: value.workspaceId,
				architectureId: value.architectureId,
				...(value.clientLabel === undefined ? {} : { clientLabel: value.clientLabel.trim() }),
				...(value.ttlMinutes === undefined ? {} : { ttlMinutes: value.ttlMinutes })
			};
		}
		case 'listMcpGrants': {
			if (!hasOnlyKeys(value, ['workspaceId', 'architectureId'])) {
				return undefined;
			}
			const hasWs = value.workspaceId !== undefined;
			const hasArch = value.architectureId !== undefined;
			if (hasWs !== hasArch) {
				return undefined;
			}
			if (hasWs && (!isOpaqueId(value.workspaceId) || !isOpaqueId(value.architectureId))) {
				return undefined;
			}
			return hasWs ? { workspaceId: value.workspaceId, architectureId: value.architectureId } : {};
		}
		case 'revokeMcpGrant': {
			if (!hasOnlyKeys(value, ['grantId']) || !isOpaqueId(value.grantId)) {
				return undefined;
			}
			return { grantId: value.grantId };
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
	/** Opens a native schema JSON file picker owned by the calling window. `undefined` when cancelled. */
	pickSchemaFile?(): Promise<string | undefined>;
	/** Opens a native provider `.zip` archive picker owned by the calling window. `undefined` when cancelled. */
	pickMirrorArchive?(): Promise<string | undefined>;
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
		case 'inspectCatalogueSchemaFile': {
			const schemaPath = await context.pickSchemaFile?.();
			if (schemaPath === undefined) {
				return { kind: 'failure', code: 'CANCELLED' };
			}
			if (!isLocalPath(schemaPath)) {
				return { kind: 'failure', code: 'SCOPE_DENIED' };
			}
			return { kind: 'call', params: { schemaPath } };
		}
		case 'importMirrorPackage': {
			const archivePath = await context.pickMirrorArchive?.();
			if (archivePath === undefined) {
				return { kind: 'failure', code: 'CANCELLED' };
			}
			if (!isLocalPath(archivePath)) {
				return { kind: 'failure', code: 'SCOPE_DENIED' };
			}
			return { kind: 'call', params: { ...params, archivePath } };
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

/**
 * Adds the packaged `cloudforge-service.exe` command path to an `issueMcpGrant` response so
 * VS Code's open-source Agent View (`McpStdioServerDefinition`) and external CLI configs can
 * launch the verified sidecar without ever letting extensions or webviews supply executable paths.
 */
function completeIssueMcpGrant(value: unknown, appRoot: string): unknown {
	if (!isRecord(value) || typeof value.grantId !== 'string' || !Array.isArray(value.mcpArgs) || !value.mcpArgs.every(arg => typeof arg === 'string')) {
		throw new CloudForgeServiceError('SERVICE_ERROR');
	}
	return {
		...value,
		mcpCommand: join(appRoot, 'cloudforge-service', 'cloudforge-service.exe')
	};
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

export class CloudForgeServiceBroker implements IServerChannel<string> {
	private readonly services = new Map<number, ICloudForgeServiceConnection>();
	private readonly openListener: { dispose(): void };
	private readonly destroyListener: { dispose(): void };
	private stopped = false;

	constructor(
		private readonly appRoot: string,
		private readonly logService: ILogService,
		private readonly windowsMainService: ICloudForgeWindows,
		private readonly workspacesManagementMainService: ICloudForgeWorkspaces,
		private readonly dialogMainService: ICloudForgeDialogs,
		private readonly createService: (appRoot: string, logService: ILogService) => ICloudForgeServiceConnection = (appRoot, logService) => new CloudForgeServiceProcess(appRoot, logService)
	) {
		this.openListener = windowsMainService.onDidOpenWindow(window => this.startWindow(window.id));
		this.destroyListener = windowsMainService.onDidDestroyWindow(window => this.stopWindow(window.id));
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
				pickParentFolder: () => this.pickParentFolder(window.win ?? undefined),
				pickSchemaFile: () => this.pickSchemaFile(window.win ?? undefined),
				pickMirrorArchive: () => this.pickMirrorArchive(window.win ?? undefined)
			});
			if (request.kind === 'failure') {
				return safeFailure(new CloudForgeServiceError(request.code)) as T;
			}
			const timeoutMs = method === 'installGit'
				? installGitTimeoutMs
				: method === 'runEnginePlan'
					? enginePlanTimeoutMs
					: method === 'runEngineInitOffline'
						? engineInitOfflineTimeoutMs
						: method === 'extractProviderSchemaFromMirror'
							? extractMirrorSchemaTimeoutMs
							: method === 'importMirrorPackage' || method === 'verifyMirrorIntegrity'
								? importMirrorPackageTimeoutMs
								: undefined;
			let value = await service.call(method, request.params, timeoutMs);
			if (method === 'createProject') {
				value = completeCreateProject(value, request.params.parentPath);
			} else if (method === 'issueMcpGrant') {
				value = completeIssueMcpGrant(value, this.appRoot);
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

	private async pickSchemaFile(window: electron.BrowserWindow | undefined): Promise<string | undefined> {
		const result = await this.dialogMainService.showOpenDialog({
			title: localize('cloudForge.pickSchemaFile', "Choose Provider Schema JSON File"),
			buttonLabel: localize('cloudForge.inspectSchema', "Inspect Schema"),
			properties: ['openFile'],
			filters: [{ name: localize('cloudForge.schemaJsonFilter', "Provider Schema JSON"), extensions: ['json'] }]
		}, window);
		if (result.canceled || result.filePaths.length !== 1) {
			return undefined;
		}
		return result.filePaths[0];
	}

	private async pickMirrorArchive(window: electron.BrowserWindow | undefined): Promise<string | undefined> {
		const result = await this.dialogMainService.showOpenDialog({
			title: localize('cloudForge.pickMirrorArchive', "Choose Provider Archive (.zip) to Import into Local Mirror"),
			buttonLabel: localize('cloudForge.importMirrorArchive', "Import Archive"),
			properties: ['openFile'],
			filters: [{ name: localize('cloudForge.providerZipFilter', "Provider Archive (.zip)"), extensions: ['zip'] }]
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
