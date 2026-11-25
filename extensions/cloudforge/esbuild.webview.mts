/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { run } from '../esbuild-webview-common.mts';

const execFileAsync = promisify(execFile);
const extDir = import.meta.dirname;
const srcDir = path.join(extDir, 'canvas-src');
const outDir = path.join(extDir, 'media');
const studioDir = path.join(extDir, 'studio');

async function stageStudioMedia(resolvedMediaOutDir: string): Promise<void> {
	const studioNodeModules = path.join(studioDir, 'node_modules');
	try {
		await access(studioNodeModules);
	} catch {
		console.log('[cloudforge] Skipping Studio Webview media staging (extensions/cloudforge/studio/node_modules not installed).');
		return;
	}
	const studioTargetDir = path.join(resolvedMediaOutDir, 'studio');
	await execFileAsync(
		process.execPath,
		[path.join(studioDir, 'build.ts'), '--stage-media', '--outdir', studioTargetDir],
		{ cwd: studioDir }
	);
}

run({
	entryPoints: {
		'canvas': path.join(srcDir, 'index.ts'),
		'canvas-style': path.join(srcDir, 'canvas.css'),
	},
	srcDir,
	outdir: outDir,
}, process.argv, stageStudioMedia);
