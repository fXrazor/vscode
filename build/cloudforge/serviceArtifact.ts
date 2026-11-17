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

interface VerifyServiceOptions {
	appDirectory: string;
	expectedSha256?: string;
	expectedServiceCommit?: string;
	/** Required: the desktop launches only its own protocol version, so verification must pin it. */
	expectedProtocolVersion: number;
	desktopCommit?: string;
}

const manifestKeys = ['architecture', 'protocolVersion', 'serviceCommit', 'sha256'];

async function readPackagedCommit(appDirectory: string): Promise<string | undefined> {
	const productPath = path.join(appDirectory, 'product.json');
	const productStat = await fs.lstat(productPath);
	if (!productStat.isFile() || productStat.size > 1024 * 1024) {
		throw new Error('Packaged product.json must be a regular file of at most 1 MiB.');
	}
	const product = JSON.parse(await fs.readFile(productPath, 'utf8')) as { commit?: unknown } | null;
	return product && typeof product.commit === 'string' ? product.commit.toLowerCase() : undefined;
}

/**
 * Rechecks a staged or installed service folder without changing it. The checks are at least as
 * strict as the desktop's launch checks: a regular directory holding exactly the executable and the
 * manifest, neither a link, a BOM-free UTF-8 manifest of at most 4 KiB with exactly the runtime
 * fields in canonical lowercase form, and an executable whose bytes match the recorded digest.
 * The protocol version is required because the desktop accepts only its own version. Run this
 * after any step that may rewrite the executable, such as Authenticode signing, so a pre-sign
 * digest cannot reach an installer. The optional expectations pin the other build inputs.
 */
export async function verifyStagedService(options: VerifyServiceOptions): Promise<{ directory: string; manifest: ServiceArtifactManifest; size: number }> {
	const expectedSha256 = options.expectedSha256 === undefined ? undefined : validateHex(options.expectedSha256, 64, 'SHA-256');
	const expectedServiceCommit = options.expectedServiceCommit === undefined ? undefined : validateHex(options.expectedServiceCommit, 40, 'Service commit');
	const desktopCommit = options.desktopCommit === undefined ? undefined : validateHex(options.desktopCommit, 40, 'Desktop commit');
	if (!Number.isSafeInteger(options.expectedProtocolVersion) || options.expectedProtocolVersion < 1) {
		throw new Error('Protocol version must be a positive integer.');
	}

	const appDirectory = path.resolve(options.appDirectory);
	if (!(await fs.lstat(appDirectory)).isDirectory()) {
		throw new Error('App directory must be an existing directory, not a symbolic link.');
	}
	if (desktopCommit !== undefined && await readPackagedCommit(appDirectory) !== desktopCommit) {
		throw new Error('Packaged product commit does not match the expected desktop commit.');
	}

	const directory = path.join(appDirectory, serviceDirectoryName);
	if (!(await fs.lstat(directory)).isDirectory()) {
		throw new Error('Service directory must be a regular directory, not a link or file.');
	}
	const entries = (await fs.readdir(directory)).sort();
	if (entries.length !== 2 || entries[0] !== serviceExecutableName || entries[1] !== serviceManifestName) {
		throw new Error(`Service directory must hold exactly ${serviceExecutableName} and ${serviceManifestName}.`);
	}

	const manifestPath = path.join(directory, serviceManifestName);
	const manifestStat = await fs.lstat(manifestPath);
	if (!manifestStat.isFile()) {
		throw new Error('Service manifest must be a regular file, not a link.');
	}
	if (manifestStat.size > maxManifestBytes) {
		throw new Error('Service manifest exceeds the desktop runtime limit.');
	}
	const manifestBytes = await fs.readFile(manifestPath);
	if (manifestBytes.length > maxManifestBytes) {
		throw new Error('Service manifest exceeds the desktop runtime limit.');
	}
	if (manifestBytes[0] === 0xef && manifestBytes[1] === 0xbb && manifestBytes[2] === 0xbf) {
		throw new Error('Service manifest must not start with a byte-order mark.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
	} catch {
		throw new Error('Service manifest must be valid UTF-8 JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Service manifest must be a JSON object.');
	}
	const record = parsed as Record<string, unknown>;
	if (Object.keys(record).sort().join() !== manifestKeys.join()) {
		throw new Error(`Service manifest must contain exactly ${manifestKeys.join(', ')}.`);
	}
	const { serviceCommit, protocolVersion, architecture, sha256 } = record;
	if (architecture !== 'x64') {
		throw new Error('Service manifest architecture must be x64.');
	}
	if (typeof serviceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(serviceCommit)) {
		throw new Error('Service manifest serviceCommit must be 40 lowercase hexadecimal characters.');
	}
	if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
		throw new Error('Service manifest sha256 must be 64 lowercase hexadecimal characters.');
	}
	if (typeof protocolVersion !== 'number' || !Number.isSafeInteger(protocolVersion) || protocolVersion < 1) {
		throw new Error('Service manifest protocolVersion must be a positive integer.');
	}
	if (expectedServiceCommit !== undefined && serviceCommit !== expectedServiceCommit) {
		throw new Error('Service manifest commit does not match the expected service commit.');
	}
	if (protocolVersion !== options.expectedProtocolVersion) {
		throw new Error('Service manifest protocol version does not match the expected protocol version.');
	}
	if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
		throw new Error('Service manifest SHA-256 does not match the expected digest.');
	}

	const executablePath = path.join(directory, serviceExecutableName);
	const executableStat = await fs.lstat(executablePath);
	if (!executableStat.isFile() || executableStat.size === 0) {
		throw new Error('Service executable must be a nonempty regular file, not a symbolic link.');
	}
	if (await sha256OfFile(executablePath) !== sha256) {
		throw new Error('Service executable SHA-256 does not match its manifest. Restage after signing or any other change to the executable.');
	}
	return { directory, manifest: { serviceCommit, protocolVersion, architecture, sha256 }, size: executableStat.size };
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

const usage = [
	'Usage: node build/cloudforge/serviceArtifact.ts --artifact <exe> --sha256 <digest> --service-commit <sha> --protocol <positive integer> --desktop-commit <sha> --app-directory <packaged resources/app>',
	'       node build/cloudforge/serviceArtifact.ts --verify --app-directory <packaged or installed resources/app> --protocol <positive integer> [--sha256 <digest>] [--service-commit <sha>] [--desktop-commit <sha>]',
].join('\n');

function parseProtocol(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!/^[1-9]\d{0,8}$/.test(value)) {
		throw new Error('--protocol must be a positive decimal integer without leading zeros.');
	}
	return Number(value);
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
			verify: { type: 'boolean' },
			help: { type: 'boolean' },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.help) {
		console.log(usage);
		return;
	}
	if (values.verify) {
		if (values.artifact !== undefined) {
			throw new Error('--verify checks a staged folder and does not take --artifact.');
		}
		for (const name of ['app-directory', 'protocol'] as const) {
			if (!values[name]) {
				throw new Error(`Missing required option --${name}.`);
			}
		}
		const result = await verifyStagedService({
			appDirectory: values['app-directory']!,
			expectedSha256: values.sha256,
			expectedServiceCommit: values['service-commit'],
			expectedProtocolVersion: parseProtocol(values.protocol)!,
			desktopCommit: values['desktop-commit'],
		});
		console.log(JSON.stringify(result, undefined, '\t'));
		return;
	}
	for (const name of ['artifact', 'sha256', 'service-commit', 'protocol', 'desktop-commit', 'app-directory'] as const) {
		if (!values[name]) {
			throw new Error(`Missing required option --${name}.`);
		}
	}
	const result = await stageServiceArtifact({
		artifactPath: values.artifact!,
		expectedSha256: values.sha256!,
		serviceCommit: values['service-commit']!,
		protocolVersion: parseProtocol(values.protocol)!,
		desktopCommit: values['desktop-commit']!,
		appDirectory: values['app-directory']!,
	});
	console.log(JSON.stringify(result, undefined, '\t'));
}

if (import.meta.main) {
	const action = process.argv.includes('--verify') ? 'verification' : 'staging';
	try {
		await main();
	} catch (error) {
		console.error(`CloudForge service ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
