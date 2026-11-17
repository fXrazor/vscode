/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import * as git from './git.ts';

export function getVersion(root: string): string | undefined {
	let version = process.env['BUILD_SOURCEVERSION'];

	if (!version || !/^[0-9a-f]{40}$/i.test(version.trim())) {
		version = git.getVersion(root);
		if (!version) {
			// A linked worktree has a .git file instead of the directory used by git.getVersion.
			try {
				const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
				version = /^[0-9a-f]{40}$/i.test(head) ? head : undefined;
			} catch {
				// Source exports and hosts without Git can still build without revision metadata.
			}
		}
	}

	return version;
}
