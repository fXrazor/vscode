/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const directory = import.meta.dirname;
const output = path.join(directory, 'dist');
await mkdir(output, { recursive: true });
await cp(path.join(directory, 'index.html'), path.join(output, 'index.html'));
await cp(path.join(directory, 'assets'), path.join(output, 'assets'), { recursive: true });
const build = await context({
	entryPoints: { studio: path.join(directory, 'src/preview.tsx') },
	outdir: output,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	loader: { '.woff2': 'file' },
	sourcemap: true,
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
