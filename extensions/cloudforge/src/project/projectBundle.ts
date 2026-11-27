/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Reads a CloudForge project bundle (`*.cloudforge.zip`, written by Studio's Export) so the
// Add Architecture flow can hand its Terraform to the Rust `createArchitecture` method and its
// canvas layout to Studio. Read-only: this module never writes files. No vscode imports.

import { createHash } from 'crypto';
import { inflateRawSync } from 'zlib';

export const BUNDLE_FORMAT = 'cloudforge.project-bundle';
export const BUNDLE_FORMAT_VERSION = 1;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
/** `createArchitecture` accepts at most 16 starter files. */
export const MAX_BUNDLE_TERRAFORM_FILES = 16;

export interface BundleContents {
	readonly name: string;
	readonly exportedAt?: string;
	/** Top-level `terraform/*.tf`, `*.tf.json` and `*.tfvars` files, sorted by name. */
	readonly terraformFiles: readonly { readonly fileName: string; readonly contents: string }[];
	/** Files under `terraform/` that cannot be created as starter files (nested folders, other types). */
	readonly skippedFiles: readonly string[];
	/** The canvas model, already JSON-parsed; Studio validates it structurally before use. */
	readonly architecture: unknown;
	readonly warnings: readonly string[];
}

export class BundleReadError extends Error { }

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) { crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8); }
	return (crc ^ 0xffffffff) >>> 0;
}

function isSafePath(path: string): boolean {
	return !!path && path.length <= 512 && !path.startsWith('/') && !path.includes('\\') && !/^[A-Za-z]:/.test(path)
		&& !/[\u0000-\u001f\u007f]/.test(path) && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

/** Stored and deflated entries only; ZIP64, encryption and unsafe paths are rejected. */
export function readZipEntries(bytes: Buffer): Map<string, Buffer> {
	if (bytes.length > MAX_BUNDLE_BYTES) { throw new BundleReadError('This bundle is larger than 32 MB.'); }
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
		if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
	}
	if (end < 0) { throw new BundleReadError('This file is not a ZIP archive.'); }
	const count = bytes.readUInt16LE(end + 10);
	const centralOffset = bytes.readUInt32LE(end + 16);
	if (count === 0xffff || centralOffset === 0xffffffff) { throw new BundleReadError('ZIP64 bundles are not supported.'); }
	if (count > MAX_ENTRIES) { throw new BundleReadError('This bundle has too many files.'); }
	const entries = new Map<string, Buffer>();
	let cursor = centralOffset;
	let total = 0;
	for (let index = 0; index < count; index++) {
		if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) { throw new BundleReadError('The ZIP directory is damaged.'); }
		const flags = bytes.readUInt16LE(cursor + 8);
		const method = bytes.readUInt16LE(cursor + 10);
		const crc = bytes.readUInt32LE(cursor + 16);
		const compressed = bytes.readUInt32LE(cursor + 20);
		const size = bytes.readUInt32LE(cursor + 24);
		const nameLength = bytes.readUInt16LE(cursor + 28);
		const extraLength = bytes.readUInt16LE(cursor + 30);
		const commentLength = bytes.readUInt16LE(cursor + 32);
		const local = bytes.readUInt32LE(cursor + 42);
		const path = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
		cursor += 46 + nameLength + extraLength + commentLength;
		if (path.endsWith('/')) { continue; }
		if (flags & 1) { throw new BundleReadError('Encrypted bundles are not supported.'); }
		if (!isSafePath(path)) { throw new BundleReadError('The bundle contains an unsafe path.'); }
		if (size > MAX_ENTRY_BYTES || (total += size) > 4 * MAX_BUNDLE_BYTES) { throw new BundleReadError('This bundle is too large to open.'); }
		if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) { throw new BundleReadError('A ZIP entry is damaged.'); }
		const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		if (start + compressed > bytes.length) { throw new BundleReadError('A ZIP entry is truncated.'); }
		const raw = bytes.subarray(start, start + compressed);
		let data: Buffer;
		try {
			data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : (() => { throw new BundleReadError('Unsupported ZIP compression.'); })();
		} catch (error) {
			throw error instanceof BundleReadError ? error : new BundleReadError('A ZIP entry is damaged.');
		}
		if (data.length !== size || crc32(data) !== crc) { throw new BundleReadError('A ZIP entry failed its integrity check.'); }
		entries.set(path, data);
	}
	return entries;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function readProjectBundle(bytes: Buffer): BundleContents {
	const entries = readZipEntries(bytes);
	const json = (path: string): unknown => {
		const data = entries.get(path);
		if (!data) { throw new BundleReadError(`This is not a CloudForge project bundle (missing ${path}).`); }
		try { return JSON.parse(data.toString('utf8')); } catch { throw new BundleReadError(`${path} is not valid JSON.`); }
	};
	const manifest = json('cloudforge-project.json');
	if (!isRecord(manifest) || manifest.format !== BUNDLE_FORMAT) { throw new BundleReadError('This is not a CloudForge project bundle.'); }
	if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BUNDLE_FORMAT_VERSION) {
		throw new BundleReadError('This bundle was made by a newer CloudForge. Update CloudForge to open it.');
	}
	const warnings: string[] = [];
	for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
		if (!isRecord(file) || typeof file.path !== 'string' || typeof file.sha256 !== 'string') { continue; }
		const data = entries.get(file.path);
		if (!data) { warnings.push(`${file.path} is listed in the manifest but missing.`); continue; }
		if (createHash('sha256').update(data).digest('hex') !== file.sha256) {
			if (file.path === 'architecture.json' || file.path.startsWith('terraform/')) {
				throw new BundleReadError(`${file.path} does not match its manifest digest; the bundle was changed or damaged.`);
			}
			warnings.push(`${file.path} was changed after export.`);
		}
	}
	const terraformFiles: { fileName: string; contents: string }[] = [];
	const skippedFiles: string[] = [];
	for (const [path, data] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
		if (!path.startsWith('terraform/')) { continue; }
		const fileName = path.slice('terraform/'.length);
		const lower = fileName.toLowerCase();
		const starter = !fileName.includes('/') && (lower.endsWith('.tf') || lower.endsWith('.tf.json') || lower.endsWith('.tfvars')) && !lower.startsWith('.');
		if (starter && terraformFiles.length < MAX_BUNDLE_TERRAFORM_FILES) {
			terraformFiles.push({ fileName, contents: data.toString('utf8') });
		} else {
			skippedFiles.push(fileName);
		}
	}
	if (!terraformFiles.length) { throw new BundleReadError('This bundle has no Terraform files to create an architecture from.'); }
	const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim().slice(0, 120) : 'Imported project';
	return {
		name,
		...(typeof manifest.exportedAt === 'string' ? { exportedAt: manifest.exportedAt.slice(0, 40) } : {}),
		terraformFiles,
		skippedFiles,
		architecture: json('architecture.json'),
		warnings,
	};
}

/** Folder-safe architecture name from a bundle name: `Production network` → `production-network`. */
export function bundleArchitectureName(name: string, taken: ReadonlySet<string>): string {
	const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'imported';
	let candidate = base;
	for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix++) { candidate = `${base}-${suffix}`; }
	return candidate;
}
