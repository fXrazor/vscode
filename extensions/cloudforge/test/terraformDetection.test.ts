/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Uri, WorkspaceFolder } from 'vscode';
import { findTerraformImportCandidates } from '../src/terraformDetection.ts';

function folder(name: string, scheme = 'file'): WorkspaceFolder {
	return { name, uri: { scheme, toString: () => `${scheme}:///project/${name}` } } as unknown as WorkspaceFolder;
}

test('offers only eligible local folders that contain Terraform source', async () => {
	const [project, registered, ignored, remote, terraform, python] = [
		folder('project'), folder('registered'), folder('ignored'), folder('remote', 'vscode-remote'), folder('terraform'), folder('python'),
	];
	const visited: WorkspaceFolder[] = [];
	const candidates = await findTerraformImportCandidates(
		[project, terraform, registered, python, ignored, remote],
		new Set([project, registered, ignored].map(item => item.uri.toString())),
		async (candidate, include, exclude, maxResults) => {
			visited.push(candidate);
			assert.equal(include, '**/*.{tf,tf.json}');
			assert.equal(exclude, '**/.terraform/**');
			assert.equal(maxResults, 1);
			return candidate === terraform ? [{ path: '/project/terraform/main.tf.json' } as unknown as Uri] : [];
		},
	);
	assert.deepEqual(visited, [terraform, python]);
	assert.deepEqual(candidates, [terraform]);
});

test('skips file searches when the window has no workspace folders', async () => {
	const candidates = await findTerraformImportCandidates([], new Set(), async () => {
		assert.fail('A file search needs a workspace folder');
	});
	assert.deepEqual(candidates, []);
});
