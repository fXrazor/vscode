/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal, dependency-free ZIP writer and reader for CloudForge project bundles.
 *
 * Writes standard PKZIP archives (UTF-8 names, deflate when it helps, otherwise stored) that
 * Windows Explorer, macOS Archive Utility and `unzip` open. Reads stored and deflated entries
 * only; ZIP64, encryption and multi-disk archives are rejected rather than guessed at.
 */

export interface ZipEntry {
	readonly path: string;
	readonly data: Uint8Array;
}

export interface ZipReadLimits {
	readonly maxEntries: number;
	readonly maxEntryBytes: number;
	readonly maxTotalBytes: number;
}

export class ZipError extends Error { }

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) { crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8); }
	return (crc ^ 0xffffffff) >>> 0;
}

async function streamThrough(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | undefined> {
	if (typeof CompressionStream !== 'function') { return undefined; }
	try { return await streamThrough(data, new CompressionStream('deflate-raw')); } catch { return undefined; }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') { throw new ZipError('This window cannot read compressed ZIP entries.'); }
	try { return await streamThrough(data, new DecompressionStream('deflate-raw')); } catch { throw new ZipError('A ZIP entry is damaged and cannot be decompressed.'); }
}

function dosDateTime(date: Date): { time: number; date: number } {
	const year = Math.max(1980, Math.min(2107, date.getFullYear()));
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

/** Safe relative path: forward slashes, no empty, `.` or `..` segments, no drive or root. */
export function isSafeZipPath(path: string): boolean {
	if (!path || path.length > 512 || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) { return false; }
	if (/[\u0000-\u001f\u007f]/.test(path)) { return false; }
	return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

export async function writeZip(entries: readonly ZipEntry[], modified = new Date()): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const stamp = dosDateTime(modified);
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!isSafeZipPath(entry.path) || seen.has(entry.path)) { throw new ZipError('Invalid or duplicate bundle path: ' + entry.path); }
		seen.add(entry.path);
		const name = encoder.encode(entry.path);
		const crc = crc32(entry.data);
		const deflated = entry.data.length > 64 ? await deflateRaw(entry.data) : undefined;
		const useDeflate = !!deflated && deflated.length < entry.data.length;
		const body = useDeflate ? deflated! : entry.data;
		const method = useDeflate ? 8 : 0;

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0x0800, true); // UTF-8 names
		lv.setUint16(8, method, true);
		lv.setUint16(10, stamp.time, true);
		lv.setUint16(12, stamp.date, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, body.length, true);
		lv.setUint32(22, entry.data.length, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 0, true);
		local.set(name, 30);

		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, method, true);
		cv.setUint16(12, stamp.time, true);
		cv.setUint16(14, stamp.date, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, body.length, true);
		cv.setUint32(24, entry.data.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);

		locals.push(local, body);
		centrals.push(central);
		offset += local.length + body.length;
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	const out = new Uint8Array(offset + centralSize + end.length);
	let cursor = 0;
	for (const part of [...locals, ...centrals, end]) { out.set(part, cursor); cursor += part.length; }
	return out;
}

/** Read every file entry (directories are skipped). Unsafe paths are rejected, not normalised. */
export async function readZip(bytes: Uint8Array, limits: ZipReadLimits): Promise<ZipEntry[]> {
	if (bytes.length < 22) { throw new ZipError('This file is not a ZIP archive.'); }
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let endAt = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === 0x06054b50) { endAt = i; break; }
	}
	if (endAt < 0) { throw new ZipError('This file is not a ZIP archive.'); }
	const count = view.getUint16(endAt + 10, true);
	const centralOffset = view.getUint32(endAt + 16, true);
	if (count === 0xffff || centralOffset === 0xffffffff) { throw new ZipError('ZIP64 archives are not supported for project bundles.'); }
	if (count > limits.maxEntries) { throw new ZipError('This bundle has too many files.'); }
	const decoder = new TextDecoder('utf-8', { fatal: false });
	const entries: ZipEntry[] = [];
	let total = 0;
	let cursor = centralOffset;
	for (let index = 0; index < count; index++) {
		if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) { throw new ZipError('The ZIP directory is damaged.'); }
		const flags = view.getUint16(cursor + 8, true);
		const method = view.getUint16(cursor + 10, true);
		const crc = view.getUint32(cursor + 16, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const size = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
		cursor += 46 + nameLength + extraLength + commentLength;
		if (path.endsWith('/')) { continue; }
		if (flags & 0x1) { throw new ZipError('Encrypted ZIP entries are not supported.'); }
		if (!isSafeZipPath(path)) { throw new ZipError('The bundle contains an unsafe path: ' + path); }
		if (size > limits.maxEntryBytes) { throw new ZipError('A file in this bundle is too large: ' + path); }
		total += size;
		if (total > limits.maxTotalBytes) { throw new ZipError('This bundle is too large to open.'); }
		if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) { throw new ZipError('The ZIP entry for ' + path + ' is damaged.'); }
		const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
		if (dataStart + compressedSize > bytes.length) { throw new ZipError('The ZIP entry for ' + path + ' is truncated.'); }
		const raw = bytes.subarray(dataStart, dataStart + compressedSize);
		let data: Uint8Array;
		if (method === 0) { data = raw.slice(); }
		else if (method === 8) { data = await inflateRaw(raw); }
		else { throw new ZipError('Unsupported ZIP compression in ' + path + '.'); }
		if (data.length !== size || crc32(data) !== crc) { throw new ZipError('The ZIP entry for ' + path + ' failed its integrity check.'); }
		entries.push({ path, data });
	}
	return entries;
}
