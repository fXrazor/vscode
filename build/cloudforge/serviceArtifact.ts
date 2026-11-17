/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { sha256OfFile } from '../agent-sdk/common.ts';

interface ServiceArtifactOptions {
	artifactPath: string;
	expectedSha256: string;
	serviceCommit: string;
	protocolVersion: number;
	desktopCommit: string;
	appDirectory: string;
}

/**
 * The runtime manifest read by `src/vs/code/electron-main/cloudForgeService.ts`. The desktop reads
 * at most 4 KiB, requires `architecture: 'x64'`, compares `protocolVersion` with its own protocol,
 * and verifies `sha256` against the packaged executable before every launch.
 */
interface ServiceArtifactManifest {
	serviceCommit: string;
	protocolVersion: number;
	architecture: 'x64';
	sha256: string;
}

export const serviceDirectoryName = 'cloudforge-service';
export const serviceExecutableName = 'cloudforge-service.exe';
export const serviceManifestName = 'manifest.json';
const maxManifestBytes = 4 * 1024;

function validateHex(value: string, length: number, name: string): string {
	if (typeof value !== 'string' || value.length !== length || !/^[a-f\d]+$/i.test(value)) {
		throw new Error(`${name} must contain exactly ${length} hexadecimal characters.`);
	}
	return value.toLowerCase();
}

async function verifyArtifact(artifactPath: string, expectedSha256: string): Promise<number> {
	const stat = await fs.lstat(artifactPath);
	if (!stat.isFile() || stat.size === 0) {
		throw new Error('Service artifact must be a nonempty regular file, not a symbolic link.');
	}
	if (await sha256OfFile(artifactPath) !== expectedSha256) {
		throw new Error('Service artifact SHA-256 does not match the expected digest.');
	}
	return stat.size;
}

async function copyArtifact(source: string, destination: fs.FileHandle): Promise<void> {
	await pipeline(createReadStream(source), destination.createWriteStream());
}

/**
 * Stages a locally supplied service in a fresh packaged app. The manifest records caller-supplied
 * source/protocol/target declarations; hashing proves byte identity, not those declarations.
 * The copy dependency allows testing source changes and I/O failures during staging.
 */
export async function stageServiceArtifact(options: ServiceArtifactOptions, copy: (source: string, destination: fs.FileHandle) => Promise<void> = copyArtifact): Promise<{ directory: string; manifest: ServiceArtifactManifest }> {
	const sha256 = validateHex(options.expectedSha256, 64, 'SHA-256');
	const serviceCommit = validateHex(options.serviceCommit, 40, 'Service commit');
	const desktopCommit = validateHex(options.desktopCommit, 40, 'Desktop commit');
	if (!Number.isSafeInteger(options.protocolVersion) || options.protocolVersion < 1) {
		throw new Error('Protocol version must be a positive integer.');
	}

	const appDirectory = path.resolve(options.appDirectory);
	if (!(await fs.lstat(appDirectory)).isDirectory()) {
		throw new Error('App directory must be an existing directory, not a symbolic link.');
	}
	const productPath = path.join(appDirectory, 'product.json');
	const productStat = await fs.lstat(productPath);
	if (!productStat.isFile() || productStat.size > 1024 * 1024) {
		throw new Error('Packaged product.json must be a regular file of at most 1 MiB.');
	}
	const product = JSON.parse(await fs.readFile(productPath, 'utf8')) as { commit?: string } | null;
	if (!product || typeof product.commit !== 'string' || product.commit.toLowerCase() !== desktopCommit) {
		throw new Error('Packaged product commit does not match the expected desktop commit.');
	}

	const artifactPath = path.resolve(options.artifactPath);
	await verifyArtifact(artifactPath, sha256);
	const directory = path.join(appDirectory, serviceDirectoryName);
	const executablePath = path.join(directory, serviceExecutableName);
	const manifestPath = path.join(directory, serviceManifestName);

	// Reserve this exact directory exclusively. Failure here must never clean an existing bundle.
	await fs.mkdir(directory);
	let executableOwned = false;
	let manifestOwned = false;
	try {
		const executable = await fs.open(executablePath, 'wx');
		executableOwned = true;
		try {
			await copy(artifactPath, executable);
		} finally {
			await executable.close();
		}
		// Verify the copied bytes too: the source may have changed since the first hash.
		await verifyArtifact(executablePath, sha256);
		const manifest: ServiceArtifactManifest = {
			serviceCommit,
			protocolVersion: options.protocolVersion,
			architecture: 'x64',
			sha256,
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, undefined, '\t')}\n`, 'utf8');
		if (manifestBytes.length > maxManifestBytes) {
			throw new Error('Service manifest exceeds the desktop runtime limit.');
		}
		// The manifest is the completion marker. Packaging must await this function's success.
		const manifestFile = await fs.open(manifestPath, 'wx');
		manifestOwned = true;
		try {
			await manifestFile.writeFile(manifestBytes);
		} finally {
			await manifestFile.close();
		}
		return { directory, manifest };
	} catch (error) {
		// Remove only our two staging files and the directory we reserved. Never recurse.
		const cleanup = await Promise.allSettled([
			...(executableOwned ? [fs.rm(executablePath, { force: true })] : []),
			...(manifestOwned ? [fs.rm(manifestPath, { force: true })] : []),
		]);
		const removal = await Promise.allSettled([fs.rmdir(directory)]);
		const cleanupErrors = [...cleanup, ...removal].filter(result => result.status === 'rejected').map(result => result.reason);
		if (cleanupErrors.length > 0) {
			throw new AggregateError([error, ...cleanupErrors], 'Service staging failed and cleanup was incomplete; inspect the staging directory.');
		}
		throw error;
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			artifact: { type: 'string' },
			sha256: { type: 'string' },
			'service-commit': { type: 'string' },
			protocol: { type: 'string' },
			'desktop-commit': { type: 'string' },
			'app-directory': { type: 'string' },
			help: { type: 'boolean' },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.help) {
		console.log('Usage: node build/cloudforge/serviceArtifact.ts --artifact <exe> --sha256 <digest> --service-commit <sha> --protocol <positive integer> --desktop-commit <sha> --app-directory <packaged resources/app>');
		return;
	}
	for (const name of ['artifact', 'sha256', 'service-commit', 'protocol', 'desktop-commit', 'app-directory'] as const) {
		if (!values[name]) {
			throw new Error(`Missing required option --${name}.`);
		}
	}
	if (!/^[1-9]\d{0,8}$/.test(values.protocol!)) {
		throw new Error('--protocol must be a positive decimal integer without leading zeros.');
	}
	const result = await stageServiceArtifact({
		artifactPath: values.artifact!,
		expectedSha256: values.sha256!,
		serviceCommit: values['service-commit']!,
		protocolVersion: Number(values.protocol),
		desktopCommit: values['desktop-commit']!,
		appDirectory: values['app-directory']!,
	});
	console.log(JSON.stringify(result, undefined, '\t'));
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`CloudForge service staging failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
