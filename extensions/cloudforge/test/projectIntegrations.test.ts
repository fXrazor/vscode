/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidArchitectureName } from '../src/importSelections.ts';
import {
	buildArchitectureSwitchItems,
	isSafeFolderName,
	normalizeFsPathForMatch,
	parseProjectResult,
	sanitizeRemoteUrl,
	suggestArchitectureName,
} from '../src/project/model.ts';
import {
	findWorkspacePreset,
	isWorkspacePresetId,
	WORKSPACE_PRESETS,
} from '../src/project/workspacePresets.ts';

test('isSafeFolderName and isValidArchitectureName reject Windows reserved names and staging prefixes', () => {
	const rejected = ['CON', 'con.tf', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'COM¹.txt', 'CONIN$', '.cloudforge-staging-1', 'bad.', ' leading', 'a/b', ''];
	for (const name of rejected) {
		assert.equal(isSafeFolderName(name), false, `isSafeFolderName should reject ${JSON.stringify(name)}`);
		assert.equal(isValidArchitectureName(name), false, `isValidArchitectureName should reject ${JSON.stringify(name)}`);
	}
	for (const valid of ['Production', 'hub-network', 'envs prod', 'console', 'aux-net', 'com10']) {
		assert.equal(isSafeFolderName(valid), true, `isSafeFolderName should accept ${valid}`);
		assert.equal(isValidArchitectureName(valid), true, `isValidArchitectureName should accept ${valid}`);
	}
});

test('suggestArchitectureName avoids Windows reserved names from repository or root paths', () => {
	const reservedRoot = { candidateId: 'r1', displayName: 'CON', rootPath: ['CON'], imported: false };
	assert.equal(suggestArchitectureName(reservedRoot, 'CON', new Set()), 'architecture');
	assert.equal(suggestArchitectureName(reservedRoot, 'CON', new Set(['architecture'])), 'architecture 2');

	const fallbackToDisplay = { candidateId: 'r2', displayName: 'network-hub', rootPath: ['NUL'], imported: false };
	assert.equal(suggestArchitectureName(fallbackToDisplay, 'infra', new Set()), 'network-hub');
});

test('sanitizeRemoteUrl strips embedded HTTP(S) credentials while preserving SSH remotes', () => {
	assert.equal(sanitizeRemoteUrl('https://user:ghp_secret123@github.com/contoso/infra.git'), 'https://github.com/contoso/infra.git');
	assert.equal(sanitizeRemoteUrl('http://token@git.internal.local:8080/team/app.git'), 'http://git.internal.local:8080/team/app.git');
	assert.equal(sanitizeRemoteUrl('https://github.com/contoso/infra.git'), 'https://github.com/contoso/infra.git');
	assert.equal(sanitizeRemoteUrl('git@github.com:contoso/infra.git'), 'git@github.com:contoso/infra.git');
	assert.equal(sanitizeRemoteUrl('ssh://git@bitbucket.org/team/repo.git'), 'ssh://git@bitbucket.org/team/repo.git');
	assert.equal(sanitizeRemoteUrl('file:///C:/repos/infra'), undefined);
	assert.equal(sanitizeRemoteUrl('https://user:pass@/no-host'), undefined);
});

test('normalizeFsPathForMatch handles Windows drive-letter casing, separators, and trailing slashes', () => {
	assert.equal(
		normalizeFsPathForMatch('C:\\Users\\Alice\\Repos\\Infra\\', true),
		normalizeFsPathForMatch('c:/users/alice/repos/infra', true),
	);
	assert.notEqual(
		normalizeFsPathForMatch('/home/Alice/Infra', false),
		normalizeFsPathForMatch('/home/alice/infra', false),
	);
});

test('buildArchitectureSwitchItems orders active first, then available alphabetically, then unavailable with reason', () => {
	const project = parseProjectResult({
		workspaceId: 'w1',
		kind: 'project',
		displayName: 'Platform',
		hasWorkspaceFile: true,
		repositories: [
			{ repositoryId: 'r-ok', displayName: 'core-infra', location: 'project', status: 'available', workspaceFolderIndex: 1 },
			{ repositoryId: 'r-detached', displayName: 'legacy-net', location: 'project', status: 'notInWorkspace' },
			{ repositoryId: 'r-missing', displayName: 'archived', location: 'external', status: 'missing' },
		],
		architectures: [
			{ architectureId: 'a-missing', displayName: 'Archive', source: 'repository', repositoryId: 'r-missing' },
			{ architectureId: 'a-detached', displayName: 'Legacy', source: 'repository', repositoryId: 'r-detached' },
			{ architectureId: 'a-spoke', displayName: 'Spoke', source: 'repository', repositoryId: 'r-ok' },
			{ architectureId: 'a-local', displayName: 'Sandbox', source: 'local' },
			{ architectureId: 'a-hub', displayName: 'Hub', source: 'repository', repositoryId: 'r-ok' },
		],
		unimportedFolders: [],
	})!;

	const items = buildArchitectureSwitchItems(project, 'a-spoke');
	assert.deepEqual(items.map(i => i.architectureId), ['a-spoke', 'a-hub', 'a-local', 'a-missing', 'a-detached']);
	assert.equal(items[0].active, true);
	assert.equal(items[0].available, true);
	assert.equal(items[0].sourceLabel, 'core-infra');
	assert.equal(items[2].sourceLabel, 'Project architecture');
	assert.equal(items[3].available, false);
	assert.equal(items[3].statusReason, 'missing');
	assert.equal(items[4].available, false);
	assert.equal(items[4].statusReason, 'notInWorkspace');
});

test('workspacePresets define valid built-in zero-core-patch layout descriptors', () => {
	assert.equal(WORKSPACE_PRESETS.length, 3);
	for (const id of ['canvas-focus', 'architecture-code', 'project-overview'] as const) {
		assert.equal(isWorkspacePresetId(id), true);
		const preset = findWorkspacePreset(id);
		assert.equal(preset.id, id);
		assert.ok(preset.label.length > 0);
	}
	assert.equal(isWorkspacePresetId('unknown'), false);
	const split = findWorkspacePreset('architecture-code');
	assert.equal(split.focusMode, false);
	assert.deepEqual(split.editorLayout, { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4 }] });
	const focus = findWorkspacePreset('canvas-focus');
	assert.equal(focus.focusMode, true);
	assert.equal(focus.showPrimarySidebar, false);
});
