/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pins a third-party Open VSX extension as a CloudForge built-in extension.
//
//   node build/cloudforge/pinOpenVsx.ts                       # JSON Crack, newest Open VSX version
//   node build/cloudforge/pinOpenVsx.ts --version 5.1.0       # a specific version
//   node build/cloudforge/pinOpenVsx.ts --id ns.name --license MIT
//   node build/cloudforge/pinOpenVsx.ts --vsix <file>         # pin a VSIX you already downloaded
//
// The script downloads the VSIX to .build/cloudforge/<id>.<version>.vsix, checks that the archive's
// own manifest matches the requested id/version, carries the expected licence and ships a licence
// file, then writes (or replaces) the builtInExtensions entry in product.json with its SHA-256.
// package-win32-x64.ps1 re-downloads the same file when it is missing and checks that digest, and
// the upstream build (build/lib/extensions.ts fromVsix) checks it again while bundling.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const OPEN_VSX = 'https://open-vsx.org';

export interface PinnedExtension {
	name: string;
	version: string;
	sha256: string;
	repo: string;
	vsix: string;
	metadata: {
		id: string;
		publisherId: { publisherId: string; publisherName: string; displayName: string; flags: string };
		publisherDisplayName: string;
	};
}

/** Reads the named entries from a zip archive (stored or deflated), without extra dependencies. */
export function readZipEntries(zip: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
	const result = new Map<string, Buffer>();
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) {
		throw new Error('The VSIX is not a zip archive.');
	}
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	for (let n = 0; n < count; n++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error('The VSIX central directory is damaged.');
		}
		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const localOffset = zip.readUInt32LE(offset + 42);
		const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		if (!wanted(name)) {
			continue;
		}
		const localNameLength = zip.readUInt16LE(localOffset + 26);
		const localExtraLength = zip.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + localNameLength + localExtraLength;
		const data = zip.subarray(start, start + compressedSize);
		if (method === 0) {
			result.set(name, Buffer.from(data));
		} else if (method === 8) {
			result.set(name, inflateRawSync(data));
		} else {
			throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
		}
	}
	return result;
}

/** Checks the VSIX manifest and licence; returns the licence file names it found. */
export function checkVsix(zip: Buffer, id: string, version: string, license: string): string[] {
	const isLicense = (name: string) => /^extension\/licen[cs]e(\.[a-z]+)?$/i.test(name);
	const entries = readZipEntries(zip, name => name === 'extension/package.json' || isLicense(name));
	const manifestBytes = entries.get('extension/package.json');
	if (!manifestBytes) {
		throw new Error('The VSIX has no extension/package.json.');
	}
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	const actualId = `${manifest.publisher}.${manifest.name}`;
	if (actualId.toLowerCase() !== id.toLowerCase()) {
		throw new Error(`The VSIX is ${actualId}, expected ${id}.`);
	}
	if (manifest.version !== version) {
		throw new Error(`The VSIX is version ${manifest.version}, expected ${version}.`);
	}
	if (manifest.license !== license) {
		throw new Error(`The VSIX licence is ${manifest.license ?? 'missing'}, expected ${license}. Review it before pinning.`);
	}
	const licenseFiles = [...entries.keys()].filter(isLicense);
	if (licenseFiles.length === 0) {
		throw new Error('The VSIX ships no licence file, so its notice would be missing from the installer.');
	}
	return licenseFiles;
}

/** Inserts or replaces the entry in product.json text, keeping the file's tab formatting. */
export function updateProductJson(text: string, entry: PinnedExtension): string {
	const product = JSON.parse(text);
	const list: PinnedExtension[] = product.builtInExtensions ?? [];
	const index = list.findIndex(e => e.name.toLowerCase() === entry.name.toLowerCase());
	if (index >= 0) {
		list[index] = entry;
	} else {
		list.push(entry);
	}
	product.builtInExtensions = list;
	return JSON.stringify(product, null, '\t') + '\n';
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`${url} answered ${response.status}.`);
	}
	return response.json();
}

async function galleryIds(id: string): Promise<{ extensionId?: string; publisherId?: string; flags?: string }> {
	try {
		const body = {
			filters: [{ criteria: [{ filterType: 7, value: id }], pageNumber: 1, pageSize: 1 }],
			flags: 0x200,
		};
		const result = await fetchJson(`${OPEN_VSX}/vscode/gallery/extensionquery`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
			body: JSON.stringify(body),
		});
		const ext = result?.results?.[0]?.extensions?.[0];
		return { extensionId: ext?.extensionId, publisherId: ext?.publisher?.publisherId, flags: ext?.publisher?.flags };
	} catch {
		return {};
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			id: { type: 'string', default: 'AykutSarac.jsoncrack-vscode' },
			version: { type: 'string' },
			license: { type: 'string', default: 'MIT' },
			vsix: { type: 'string' },
		},
	});
	const id = values.id!;
	const [namespace, extName] = id.split('.');
	if (!namespace || !extName) {
		throw new Error(`Use --id publisher.name, not ${id}.`);
	}

	const info = await fetchJson(`${OPEN_VSX}/api/${namespace}/${extName}${values.version ? `/${values.version}` : ''}`);
	const version: string = info.version;
	const engine: string | undefined = info.engines?.vscode;
	const codeVersion: string = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
	const engineMinor = /^\^?1\.(\d+)/.exec(engine ?? '')?.[1];
	const codeMinor = /^1\.(\d+)/.exec(codeVersion)?.[1];
	if (engineMinor && codeMinor && Number(engineMinor) > Number(codeMinor)) {
		throw new Error(`${id} ${version} needs VS Code ${engine}; this build is ${codeVersion}. Pick an older --version.`);
	}

	const vsixRel = `.build/cloudforge/${id}.${version}.vsix`;
	const vsixPath = path.join(repoRoot, vsixRel);
	await fs.mkdir(path.dirname(vsixPath), { recursive: true });
	let bytes: Buffer;
	if (values.vsix) {
		bytes = await fs.readFile(values.vsix);
	} else {
		const url: string = info.files?.download ?? `${OPEN_VSX}/api/${namespace}/${extName}/${version}/file/${id}-${version}.vsix`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`${url} answered ${response.status}.`);
		}
		bytes = Buffer.from(await response.arrayBuffer());
	}
	const licenseFiles = checkVsix(bytes, id, version, values.license!);
	await fs.writeFile(vsixPath, bytes);
	const sha256 = createHash('sha256').update(bytes).digest('hex');

	const ids = await galleryIds(id);
	const displayName: string = info.namespaceDisplayName ?? namespace;
	const entry: PinnedExtension = {
		name: id,
		version,
		sha256,
		repo: info.repository ?? `${OPEN_VSX}/extension/${namespace}/${extName}`,
		vsix: vsixRel,
		metadata: {
			id: ids.extensionId ?? id,
			publisherId: {
				publisherId: ids.publisherId ?? namespace,
				publisherName: namespace,
				displayName,
				flags: ids.flags ?? '',
			},
			publisherDisplayName: displayName,
		},
	};

	const productPath = path.join(repoRoot, 'product.json');
	await fs.writeFile(productPath, updateProductJson(await fs.readFile(productPath, 'utf8'), entry));
	console.log(JSON.stringify({ pinned: id, version, sha256, licence: values.license, licenseFiles, vsix: vsixRel, engine }, null, 2));
	console.log('Review the product.json change, then commit it before running package-win32-x64.ps1.');
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
