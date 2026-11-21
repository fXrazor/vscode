/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'node:path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'canvas-src');
const outDir = path.join(import.meta.dirname, 'media');

run({
	entryPoints: {
		'canvas': path.join(srcDir, 'index.ts'),
		'canvas-style': path.join(srcDir, 'canvas.css'),
	},
	srcDir,
	outdir: outDir,
}, process.argv);
