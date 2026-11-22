/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
	findingSummary,
	parseCreatedProject,
	parseGitInstall,
	parseInspection,
	parseProjectResult,
	repositoryFolderName,
	selectDefaultArchitecture,
	suggestArchitectureName,
	validateCloneUrl,
} from '../src/project/model.ts';

/** The canonical Stage 2 fixtures live in the CloudForge repository (sibling checkout). */
function fixtureDirectory(): string | undefined {
	const fromEnvironment = process.env.CLOUDFORGE_REPO;
	if (fromEnvironment) {
		return join(fromEnvironment, 'docs', 'protocol', 'fixtures', 'stage2');
	}
	for (let directory = resolve(import.meta.dirname); dirname(directory) !== directory; directory = dirname(directory)) {
		const candidate = join(dirname(directory), 'CloudForge', 'docs', 'protocol', 'fixtures', 'stage2');
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

const sample: Record<string, string> = { workspaceId: 'workspace-' + 'a'.repeat(32), workspaceId2: 'workspace-' + 'b'.repeat(32), sha256: 'c'.repeat(64), gitVersion: 'git version 2.47.1.windows.1' };

function fill(value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('$')) {
		const name = /^\$([A-Za-z0-9]+)/.exec(value)![1];
		return sample[name] + value.slice(name.length + 1);
	}
	if (Array.isArray(value)) {
		return value.map(fill);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
	}
	return value;
}

const parsers: Record<string, (value: unknown) => unknown> = {
	openProject: parseProjectResult,
	grantProject: parseProjectResult,
	importRepository: parseProjectResult,
	removeRepository: parseProjectResult,
	inspectRepository: parseInspection,
	installGit: parseGitInstall,
};

test('every Stage 2 fixture result parses', { skip: fixtureDirectory() === undefined && 'CloudForge checkout not found; set CLOUDFORGE_REPO' }, () => {
	const directory = fixtureDirectory()!;
	let checked = 0;
	for (const file of readdirSync(directory).filter(name => name.endsWith('.json'))) {
		const fixture = JSON.parse(readFileSync(join(directory, file), 'utf8'));
		for (const exchange of fixture.exchanges) {
			const parse = parsers[exchange.request?.method];
			if (!parse || !exchange.response.result) {
				continue;
			}
			assert.ok(parse(fill(exchange.response.result)), `${file}: ${exchange.request.method} result did not parse`);
			checked++;
		}
	}
	assert.ok(checked >= 15, `only ${checked} results checked`);
});

test('project results keep repository and architecture links and folder indexes', () => {
	const result = parseProjectResult({
		workspaceId: sample.workspaceId, kind: 'project', displayName: 'Contoso', hasWorkspaceFile: true,
		repositories: [
			{ repositoryId: 'r1', displayName: 'infra', location: 'project', status: 'available', workspaceFolderIndex: 1, remote: 'https://github.com/contoso/infra.git' },
			{ repositoryId: 'r2', displayName: 'old', location: 'external', status: 'missing' },
		],
		architectures: [
			{ architectureId: 'a1', displayName: 'Sandbox', source: 'local' },
			{ architectureId: 'a2', displayName: 'Hub', source: 'repository', repositoryId: 'r1' },
		],
		unimportedFolders: [{ workspaceFolderIndex: 2 }],
		importedArchitectureIds: ['a2'],
	});
	assert.deepEqual(result?.repositories.map(repository => repository.workspaceFolderIndex), [1, undefined]);
	assert.deepEqual(result?.unimportedFolders, [2]);
	assert.deepEqual(result?.importedArchitectureIds, ['a2']);
});

test('project results with unsafe or inconsistent data are refused', () => {
	const base = (): any => ({
		workspaceId: sample.workspaceId, kind: 'project', displayName: 'Contoso', hasWorkspaceFile: true,
		repositories: [{ repositoryId: 'r1', displayName: 'infra', location: 'project', status: 'available', workspaceFolderIndex: 1 }],
		architectures: [{ architectureId: 'a1', displayName: 'Hub', source: 'repository', repositoryId: 'r1' }],
		unimportedFolders: [],
	});
	const cases: Record<string, (value: any) => void> = {
		credentialRemote: value => { value.repositories[0].remote = 'https://user:token@github.com/x.git'; },
		indexOnMissingRepository: value => { value.repositories[0].status = 'missing'; },
		availableWithoutIndex: value => { delete value.repositories[0].workspaceFolderIndex; },
		unknownRepositoryLink: value => { value.architectures[0].repositoryId = 'r9'; },
		localWithRepository: value => { value.architectures[0].source = 'local'; },
		importedUnknownArchitecture: value => { value.importedArchitectureIds = ['a9']; },
		negativeFolderIndex: value => { value.unimportedFolders = [{ workspaceFolderIndex: -1 }]; },
		stage1Shape: value => { value.kind = 'terraform'; },
	};
	assert.ok(parseProjectResult(base()));
	for (const [name, mutate] of Object.entries(cases)) {
		const value = base();
		mutate(value);
		assert.equal(parseProjectResult(value), undefined, name);
	}
});

test('inspections refuse findings that carry values or unsafe paths', () => {
	const inspection = (value: unknown) => parseInspection({
		inspectionId: 'i1', displayName: 'platform-infra', truncated: false,
		terraformRoots: [{ candidateId: 'root-1', displayName: 'hub', rootPath: ['envs', 'hub'], imported: false }],
		findings: [value],
	});
	assert.ok(inspection({ code: 'SENSITIVE_LITERAL', file: 'envs/hub/main.tf', line: 7 }));
	assert.equal(inspection({ code: 'SENSITIVE_LITERAL', file: 'envs/hub/main.tf', line: 7, value: 'sentinel' }), undefined);
	assert.equal(inspection({ code: 'TFVARS_FILE', file: '../outside.tfvars' }), undefined);
	assert.equal(inspection({ code: 'TFVARS_FILE', file: 'C:\\repo\\x.tfvars' }), undefined);
	assert.equal(inspection({ code: 'UNKNOWN', file: 'a.tf' }), undefined);
	assert.equal(findingSummary({ code: 'SENSITIVE_LITERAL', file: 'envs/hub/main.tf', line: 7 }), 'envs/hub/main.tf:7: a secret-like attribute is set to a literal value');
});

test('created projects need a file URI and a workspace file name', () => {
	assert.ok(parseCreatedProject({ folderName: 'Contoso', workspaceFileName: 'Contoso.code-workspace', workspaceFile: 'file:///c%3A/p/Contoso/Contoso.code-workspace' }));
	assert.equal(parseCreatedProject({ folderName: 'Contoso', workspaceFileName: 'Contoso.json', workspaceFile: 'file:///c%3A/p/Contoso.json' }), undefined);
	assert.equal(parseCreatedProject({ folderName: '..', workspaceFileName: 'a.code-workspace', workspaceFile: 'file:///x' }), undefined);
	assert.equal(parseCreatedProject({ folderName: 'Contoso', workspaceFileName: 'Contoso.code-workspace', workspaceFile: 'https://example.com/x' }), undefined);
});

test('clone URLs accept remote forms and refuse local or unsupported ones', () => {
	for (const url of ['https://github.com/contoso/infra.git', 'https://gitlab.contoso.local/group/sub/repo', 'http://git.local/repo', 'ssh://git@bitbucket.org/team/repo.git', 'git@github.com:contoso/infra.git']) {
		assert.equal(validateCloneUrl(url), undefined, url);
	}
	for (const [url, reason] of [['', 'empty'], ['file:///C:/repo', 'scheme'], ['C:\\repos\\infra', 'invalid'], ['ftp://example.com/repo', 'scheme'], ['https://github.com/', 'invalid'], ['https://exa mple.com/repo', 'invalid'], ['https://', 'invalid']]) {
		assert.equal(validateCloneUrl(url), reason, url);
	}
	assert.equal(repositoryFolderName('https://github.com/contoso/infra.git'), 'infra');
	assert.equal(repositoryFolderName('git@github.com:contoso/platform-infra.git/'), 'platform-infra');
	assert.equal(repositoryFolderName('https://example.com/CON'), 'CON');
});

test('suggested architecture names avoid existing names', () => {
	const hub = { candidateId: 'root-1', displayName: 'hub', rootPath: ['envs', 'hub'], imported: false };
	const top = { candidateId: 'root-2', displayName: 'infra', rootPath: [], imported: false };
	assert.equal(suggestArchitectureName(hub, 'infra', new Set()), 'envs hub');
	assert.equal(suggestArchitectureName(hub, 'infra', new Set(['envs hub', 'envs hub 2'])), 'envs hub 3');
	assert.equal(suggestArchitectureName(top, 'platform-infra', new Set(['sandbox'])), 'platform-infra');
});

test('git install results are typed', () => {
	assert.deepEqual(parseGitInstall({ status: 'installed', gitVersion: 'git version 2.47.1' }), { status: 'installed', gitVersion: 'git version 2.47.1' });
	assert.deepEqual(parseGitInstall({ status: 'wingetMissing' }), { status: 'wingetMissing' });
	assert.equal(parseGitInstall({ status: 'installed', gitVersion: 'rm -rf' }), undefined);
	assert.equal(parseGitInstall({ status: 'done' }), undefined);
});

test('selectDefaultArchitecture prefers remembered available architecture and skips unavailable repos', () => {
	const project = parseProjectResult({
		workspaceId: 'w1',
		kind: 'project',
		displayName: 'Contoso',
		hasWorkspaceFile: true,
		repositories: [
			{ repositoryId: 'r-missing', displayName: 'old-repo', location: 'project', status: 'missing' },
			{ repositoryId: 'r-ok', displayName: 'infra', location: 'project', status: 'available', workspaceFolderIndex: 1 },
		],
		architectures: [
			{ architectureId: 'a-missing', displayName: 'Gone', source: 'repository', repositoryId: 'r-missing' },
			{ architectureId: 'a-local', displayName: 'Sandbox', source: 'local' },
			{ architectureId: 'a-hub', displayName: 'Hub Network', source: 'repository', repositoryId: 'r-ok' },
		],
		unimportedFolders: [],
	})!;

	// Falls back to first available (skipping missing repo architecture).
	assert.equal(selectDefaultArchitecture(project)?.architectureId, 'a-local');
	// Remembers previously opened architecture case-insensitively across grant ID changes.
	assert.equal(selectDefaultArchitecture(project, 'hub network')?.architectureId, 'a-hub');
	// Ignores remembered architecture whose repo is currently unavailable.
	assert.equal(selectDefaultArchitecture(project, 'Gone')?.architectureId, 'a-local');
	// Empty project returns undefined.
	const empty = parseProjectResult({
		workspaceId: 'w2',
		kind: 'project',
		displayName: 'Empty',
		hasWorkspaceFile: true,
		repositories: [],
		architectures: [],
		unimportedFolders: [],
	})!;
	assert.equal(selectDefaultArchitecture(empty), undefined);
});
