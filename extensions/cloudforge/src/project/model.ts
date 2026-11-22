/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure Stage 2 project logic: parsers for service results, clone URL rules, and naming.
// No runtime `vscode` import, so `node --test` can load it directly.
// Contract: CloudForge docs/protocol/cloudforge-service-v1.md, "Stage 2: projects with repositories".

export type RepositoryStatus = 'available' | 'notInWorkspace' | 'missing' | 'changed';

export interface ProjectRepository {
	readonly repositoryId: string;
	readonly displayName: string;
	readonly location: 'project' | 'external';
	readonly status: RepositoryStatus;
	readonly workspaceFolderIndex?: number;
	readonly remote?: string;
}

export interface ProjectArchitecture {
	readonly architectureId: string;
	readonly displayName: string;
	readonly source: 'local' | 'repository';
	readonly repositoryId?: string;
}

export interface ProjectResult {
	readonly workspaceId: string;
	readonly displayName: string;
	readonly hasWorkspaceFile: boolean;
	readonly repositories: readonly ProjectRepository[];
	readonly architectures: readonly ProjectArchitecture[];
	readonly unimportedFolders: readonly number[];
	readonly importedArchitectureIds: readonly string[];
}

export type FindingCode = 'TFVARS_FILE' | 'STATE_FILE' | 'PROVIDER_CACHE' | 'SENSITIVE_LITERAL';

export interface Finding {
	readonly code: FindingCode;
	/** Repository-relative path with `/` separators. */
	readonly file: string;
	readonly line?: number;
}

export interface RootCandidate {
	readonly candidateId: string;
	readonly displayName: string;
	readonly rootPath: readonly string[];
	readonly imported: boolean;
}

export interface Inspection {
	readonly inspectionId: string;
	readonly displayName: string;
	readonly terraformRoots: readonly RootCandidate[];
	readonly findings: readonly Finding[];
	readonly truncated: boolean;
}

export interface CreatedProject {
	readonly folderName: string;
	readonly workspaceFileName: string;
	/** A `file:` URI string added by the broker. */
	readonly workspaceFile: string;
}

export type GitInstallStatus = 'installed' | 'wingetMissing' | 'failed' | 'cancelled';

export type CloneProvider = 'github' | 'gitlab' | 'bitbucket' | 'url';

const MAX_ITEMS = 1024;
const findingCodes: ReadonlySet<string> = new Set<FindingCode>(['TFVARS_FILE', 'STATE_FILE', 'PROVIDER_CACHE', 'SENSITIVE_LITERAL']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isText(value: unknown, limit = 256): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}

function isIndex(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < MAX_ITEMS;
}

/** A single Windows path component, as the service validates it. */
export function isPathComponent(value: unknown): value is string {
	return isText(value, 255) && value.trim() === value && !value.endsWith('.') && !/[<>:"/\\|?*]/.test(value);
}

function parseRepository(value: unknown): ProjectRepository | undefined {
	if (!isRecord(value) || !isOpaqueId(value.repositoryId) || !isText(value.displayName) || (value.location !== 'project' && value.location !== 'external')) {
		return undefined;
	}
	const status = value.status;
	if (status !== 'available' && status !== 'notInWorkspace' && status !== 'missing' && status !== 'changed') {
		return undefined;
	}
	if ((status === 'available') !== isIndex(value.workspaceFolderIndex) || (value.workspaceFolderIndex !== undefined && !isIndex(value.workspaceFolderIndex))) {
		return undefined;
	}
	if (value.remote !== undefined && (!isText(value.remote, 2048) || /\/\/[^/]*@/.test(value.remote))) {
		return undefined;
	}
	return {
		repositoryId: value.repositoryId,
		displayName: value.displayName,
		location: value.location,
		status,
		...(isIndex(value.workspaceFolderIndex) ? { workspaceFolderIndex: value.workspaceFolderIndex } : {}),
		...(typeof value.remote === 'string' ? { remote: value.remote } : {}),
	};
}

/** Parses `openProject`, `grantProject`, `importRepository`, and `removeRepository` results. */
export function parseProjectResult(value: unknown): ProjectResult | undefined {
	if (!isRecord(value) || !isOpaqueId(value.workspaceId) || value.kind !== 'project' || !isText(value.displayName) || typeof value.hasWorkspaceFile !== 'boolean') {
		return undefined;
	}
	if (!Array.isArray(value.repositories) || value.repositories.length > MAX_ITEMS || !Array.isArray(value.architectures) || value.architectures.length > MAX_ITEMS || !Array.isArray(value.unimportedFolders) || value.unimportedFolders.length > MAX_ITEMS) {
		return undefined;
	}
	const repositories: ProjectRepository[] = [];
	for (const item of value.repositories) {
		const repository = parseRepository(item);
		if (!repository || repositories.some(known => known.repositoryId === repository.repositoryId)) {
			return undefined;
		}
		repositories.push(repository);
	}
	const architectures: ProjectArchitecture[] = [];
	for (const item of value.architectures) {
		if (!isRecord(item) || !isOpaqueId(item.architectureId) || !isText(item.displayName) || architectures.some(known => known.architectureId === item.architectureId)) {
			return undefined;
		}
		if (item.source === 'local' && item.repositoryId === undefined) {
			architectures.push({ architectureId: item.architectureId, displayName: item.displayName, source: 'local' });
		} else if (item.source === 'repository' && repositories.some(repository => repository.repositoryId === item.repositoryId)) {
			architectures.push({ architectureId: item.architectureId, displayName: item.displayName, source: 'repository', repositoryId: item.repositoryId as string });
		} else {
			return undefined;
		}
	}
	const unimportedFolders: number[] = [];
	for (const item of value.unimportedFolders) {
		if (!isRecord(item) || !isIndex(item.workspaceFolderIndex)) {
			return undefined;
		}
		unimportedFolders.push(item.workspaceFolderIndex);
	}
	let importedArchitectureIds: string[] = [];
	if (value.importedArchitectureIds !== undefined) {
		if (!Array.isArray(value.importedArchitectureIds) || !value.importedArchitectureIds.every(id => architectures.some(architecture => architecture.architectureId === id))) {
			return undefined;
		}
		importedArchitectureIds = value.importedArchitectureIds as string[];
	}
	return {
		workspaceId: value.workspaceId,
		displayName: value.displayName,
		hasWorkspaceFile: value.hasWorkspaceFile,
		repositories,
		architectures,
		unimportedFolders,
		importedArchitectureIds,
	};
}

/** Parses an `inspectRepository` result. Findings never carry values. */
export function parseInspection(value: unknown): Inspection | undefined {
	if (!isRecord(value) || !isOpaqueId(value.inspectionId) || !isText(value.displayName) || typeof value.truncated !== 'boolean') {
		return undefined;
	}
	if (!Array.isArray(value.terraformRoots) || value.terraformRoots.length === 0 || value.terraformRoots.length > 64 || !Array.isArray(value.findings) || value.findings.length > 200) {
		return undefined;
	}
	const terraformRoots: RootCandidate[] = [];
	for (const item of value.terraformRoots) {
		if (!isRecord(item) || !isOpaqueId(item.candidateId) || !isText(item.displayName) || typeof item.imported !== 'boolean' || !Array.isArray(item.rootPath) || item.rootPath.length > 8 || !item.rootPath.every(isPathComponent)) {
			return undefined;
		}
		terraformRoots.push({ candidateId: item.candidateId, displayName: item.displayName, rootPath: item.rootPath as string[], imported: item.imported });
	}
	const findings: Finding[] = [];
	for (const item of value.findings) {
		const keys = isRecord(item) ? Object.keys(item) : [];
		if (!isRecord(item) || !findingCodes.has(item.code as string) || !isText(item.file, 1024) || item.file.split('/').some(part => !isPathComponent(part)) || keys.some(key => key !== 'code' && key !== 'file' && key !== 'line') || (item.line !== undefined && !(typeof item.line === 'number' && Number.isSafeInteger(item.line) && item.line > 0))) {
			return undefined;
		}
		findings.push({ code: item.code as FindingCode, file: item.file, ...(typeof item.line === 'number' ? { line: item.line } : {}) });
	}
	return { inspectionId: value.inspectionId, displayName: value.displayName, terraformRoots, findings, truncated: value.truncated };
}

export function parseCreatedProject(value: unknown): CreatedProject | undefined {
	if (!isRecord(value) || !isPathComponent(value.folderName) || !isPathComponent(value.workspaceFileName) || !value.workspaceFileName.toLowerCase().endsWith('.code-workspace') || typeof value.workspaceFile !== 'string' || !value.workspaceFile.startsWith('file:///')) {
		return undefined;
	}
	return { folderName: value.folderName, workspaceFileName: value.workspaceFileName, workspaceFile: value.workspaceFile };
}

export function parseGitInstall(value: unknown): { readonly status: GitInstallStatus; readonly gitVersion?: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const status = value.status;
	if (status !== 'installed' && status !== 'wingetMissing' && status !== 'failed' && status !== 'cancelled') {
		return undefined;
	}
	if (value.gitVersion !== undefined && !(isText(value.gitVersion, 200) && value.gitVersion.startsWith('git version '))) {
		return undefined;
	}
	return { status, ...(typeof value.gitVersion === 'string' ? { gitVersion: value.gitVersion } : {}) };
}

/** The prefilled host for each clone provider (GitHub uses the built-in picker instead). */
export function cloneUrlPrefix(provider: CloneProvider): string {
	switch (provider) {
		case 'gitlab': return 'https://gitlab.com/';
		case 'bitbucket': return 'https://bitbucket.org/';
		default: return 'https://';
	}
}

/**
 * Checks a clone URL typed by the user. Returns `undefined` when it is acceptable, or a short
 * reason. Accepts `https://`, `http://`, `ssh://`, and scp-like `user@host:path` forms; refuses
 * local paths and `file://`. Self-managed hosts are allowed for every provider.
 */
export function validateCloneUrl(input: string): string | undefined {
	const url = input.trim();
	if (url.length === 0) {
		return 'empty';
	}
	if (url.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(url)) {
		return 'invalid';
	}
	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
	if (scheme !== undefined) {
		if (scheme !== 'https' && scheme !== 'http' && scheme !== 'ssh') {
			return 'scheme';
		}
		const rest = url.slice(scheme.length + 3);
		const authority = rest.split('/')[0];
		const host = authority.slice(authority.lastIndexOf('@') + 1).split(':')[0];
		const path = rest.slice(authority.length);
		return host.length > 0 && /^[a-z0-9.-]+$/i.test(host) && path.length > 1 ? undefined : 'invalid';
	}
	// scp-like: user@host:path. A drive letter such as C:\repo is not a remote.
	return /^[a-z0-9._-]+@[a-z0-9.-]{2,}:[^\\]+$/i.test(url) ? undefined : 'invalid';
}

/** The folder name `git clone` would create for a URL, used to show where it will land. */
export function repositoryFolderName(url: string): string | undefined {
	const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
	const name = last.replace(/\.git$/i, '');
	return isPathComponent(name) ? name : undefined;
}

/** A default architecture name for a root that does not clash with existing names. */
export function suggestArchitectureName(candidate: RootCandidate, repositoryName: string, taken: ReadonlySet<string>): string {
	const base = candidate.rootPath.length === 0 ? repositoryName : candidate.rootPath.join(' ');
	let name = isPathComponent(base) ? base : candidate.displayName;
	for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) {
		name = `${base} ${suffix}`;
	}
	return name;
}

/** Describes a finding's kind without ever showing a value. */
export function findingDescription(code: FindingCode): string {
	switch (code) {
		case 'TFVARS_FILE': return 'variable values file that may contain secrets';
		case 'STATE_FILE': return 'Terraform state file, which can contain secrets';
		case 'PROVIDER_CACHE': return 'provider cache folder that should not be committed';
		case 'SENSITIVE_LITERAL': return 'a secret-like attribute is set to a literal value';
	}
}

/** One line per finding: where it is and what it is, never a value. */
export function findingSummary(finding: Finding): string {
	const where = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
	return `${where}: ${findingDescription(finding.code)}`;
}

/**
 * Picks which architecture to open automatically when a CloudForge project connects.
 * Considers only architectures whose backing repository (if linked) is `available`, preferring
 * the previously opened architecture by display name before falling back to the first available.
 */
export function selectDefaultArchitecture(project: ProjectResult, lastArchitectureName?: string): ProjectArchitecture | undefined {
	const availableRepos = new Set(
		project.repositories.filter(repo => repo.status === 'available').map(repo => repo.repositoryId)
	);
	const available = project.architectures.filter(arch =>
		arch.source === 'local' || (arch.repositoryId !== undefined && availableRepos.has(arch.repositoryId))
	);
	if (available.length === 0) {
		return undefined;
	}
	if (lastArchitectureName) {
		const remembered = available.find(arch => arch.displayName.toLowerCase() === lastArchitectureName.toLowerCase());
		if (remembered) {
			return remembered;
		}
	}
	return available[0];
}
