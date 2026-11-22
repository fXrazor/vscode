/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Uri, WorkspaceFolder } from 'vscode';

type FindFilesInFolder = (folder: WorkspaceFolder, include: string, exclude: string, maxResults: number) => Thenable<readonly Uri[]>;

/**
 * Finds folders eligible for an import offer. The caller supplies URI strings for the project
 * folder, registered repositories, and folders the user has ignored. The finder scopes the
 * include glob to the supplied folder using a RelativePattern.
 */
export async function findTerraformImportCandidates(
	folders: readonly WorkspaceFolder[],
	excludedFolderUris: ReadonlySet<string>,
	findFiles: FindFilesInFolder,
): Promise<WorkspaceFolder[]> {
	const candidates: WorkspaceFolder[] = [];
	for (const folder of folders) {
		if (folder.uri.scheme !== 'file' || excludedFolderUris.has(folder.uri.toString())) {
			continue;
		}
		const matches = await findFiles(folder, '**/*.{tf,tf.json}', '**/.terraform/**', 1);
		if (matches.length > 0) {
			candidates.push(folder);
		}
	}
	return candidates;
}

const TERRAFORM_SOURCE_PATTERN = /\.(tf|tf\.json)$/i;
const TERRAFORM_SUPPORT_PATTERN = /\.(tf|tf\.json|tfvars|tfvars\.json)$/i;

/**
 * Finds top-level Terraform files placed directly in a project root folder (by filename only;
 * never reads file contents). Returns an empty array unless at least one `.tf` or `.tf.json`
 * source file is present.
 */
export function findProjectRootTerraformFiles(
	entries: readonly (readonly [string, number])[],
	fileTypeFile = 1,
): string[] {
	const files: string[] = [];
	let hasSource = false;
	for (const [name, type] of entries) {
		if (type !== fileTypeFile || name.startsWith('.')) {
			continue;
		}
		if (TERRAFORM_SOURCE_PATTERN.test(name)) {
			hasSource = true;
			files.push(name);
		} else if (TERRAFORM_SUPPORT_PATTERN.test(name)) {
			files.push(name);
		}
	}
	return hasSource ? files.sort((a, b) => a.localeCompare(b)) : [];
}
