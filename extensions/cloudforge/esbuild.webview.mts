/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const extDir = import.meta.dirname;
const studioDir = path.join(extDir, 'studio');

const outputRootIndex = process.argv.indexOf('--outputRoot');
const outputRoot = outputRootIndex >= 0 ? process.argv[outputRootIndex + 1] : undefined;
const mediaOutDir = outputRoot ? path.join(outputRoot, 'media') : path.join(extDir, 'media');
const studioTargetDir = path.join(mediaOutDir, 'studio');

async function buildStudioMedia(): Promise<void> {
	const studioNodeModules = path.join(studioDir, 'node_modules');
	try {
		await access(studioNodeModules);
	} catch {
		throw new Error('CloudForge Studio dependencies are missing. Run `corepack pnpm install --frozen-lockfile` in extensions/cloudforge/studio.');
	}
	await execFileAsync(
		process.execPath,
		[path.join(studioDir, 'build.ts'), '--stage-media', '--outdir', studioTargetDir],
		{ cwd: studioDir }
	);
}

buildStudioMedia().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
