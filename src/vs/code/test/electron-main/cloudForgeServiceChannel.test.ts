/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { validateCloudForgeServiceParams } from '../../electron-main/cloudForgeServiceChannel.js';

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
});
