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
