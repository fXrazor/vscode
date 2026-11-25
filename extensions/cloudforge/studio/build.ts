/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const directory = import.meta.dirname;
const stageMedia = process.argv.includes('--stage-media');
const outdirFlagIndex = process.argv.indexOf('--outdir');
const explicitOutdir = outdirFlagIndex >= 0 ? process.argv[outdirFlagIndex + 1] : undefined;
const output = explicitOutdir
	? path.resolve(explicitOutdir)
	: stageMedia
		? path.resolve(directory, '..', 'media', 'studio')
		: path.join(directory, 'dist');

async function copyStudioAssets(targetDir: string, slimMonaco: boolean): Promise<void> {
	const srcAssets = path.join(directory, 'assets');
	const dstAssets = path.join(targetDir, 'assets');
	await mkdir(dstAssets, { recursive: true });
	if (!slimMonaco) {
		await cp(srcAssets, dstAssets, { recursive: true });
		return;
	}
	await cp(srcAssets, dstAssets, {
		recursive: true,
		filter: src => {
			const rel = path.relative(srcAssets, src).replace(/\\/g, '/');
			if (!rel || !rel.startsWith('monaco/')) {
				return true;
			}
			// Keep only Monaco loader, core base/editor bundles, and HCL language for Webview packaging.
			if (rel === 'monaco' || rel === 'monaco/vs' || rel === 'monaco/vs/loader.js') {
				return true;
			}
			if (rel.startsWith('monaco/vs/base') || rel.startsWith('monaco/vs/editor')) {
				return true;
			}
			if (rel === 'monaco/vs/basic-languages' || rel.startsWith('monaco/vs/basic-languages/hcl')) {
				return true;
			}
			return false;
		},
	});
}

if (stageMedia) {
	await rm(output, { recursive: true, force: true });
}
await mkdir(output, { recursive: true });
if (!stageMedia) {
	await cp(path.join(directory, 'index.html'), path.join(output, 'index.html'));
}
await copyStudioAssets(output, stageMedia);
const build = await context({
	entryPoints: { studio: path.join(directory, 'src/preview.tsx') },
	outdir: output,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	loader: { '.woff2': 'file' },
	sourcemap: !stageMedia,
	minify: stageMedia,
	logLevel: 'info'
});
if (process.argv.includes('--serve')) {
	await build.watch();
	const server = await build.serve({ host: '127.0.0.1', port: 0, servedir: output });
	console.log('CloudForge Studio preview: http://127.0.0.1:' + server.port);
} else {
	await build.rebuild();
	await build.dispose();
}
