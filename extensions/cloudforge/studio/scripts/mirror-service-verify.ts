/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseMirrorImportResult, parseMirrorInventory, parseMirrorIntegrityReport, parseMirrorCleanupPlan } from '../../src/providerMirror/model.ts';

// Verifies actual service storage and RPCs using a real release archive. Does not execute providers.
// Keep this evidence separate from native-picker and installed-broker verification.
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [launchArgument, executable, expectedCommit] = process.argv.slice(2);
assert.ok(launchArgument && executable && /^[0-9a-f]{40}$/.test(expectedCommit ?? ''),
	'Usage: node mirror-service-verify.ts <owned-launch.json> <service.exe> <expected-service-commit>');
const launchFile = realpathSync(launchArgument);
const root = path.dirname(launchFile);
const within = (base: string, value: string) => {
	const relative = path.relative(base, value);
	return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
assert.ok(within(realpathSync(path.join(studio, 'output')), launchFile));
const launch = JSON.parse(readFileSync(launchFile, 'utf8'));
assert.equal(realpathSync(launch.root), root);
assert.ok(within(root, realpathSync(launch.fixture)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok(within(root, realpathSync(pkg.archive)));
assert.equal(pkg.address, 'registry.terraform.io/hashicorp/azurerm');
assert.equal(pkg.version, '5.14.0');
assert.equal(pkg.platform, 'windows_amd64');
const hashFile = async (file: string) => {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(file)) { hash.update(chunk); }
	return hash.digest('hex');
};
const archiveSha256 = await hashFile(pkg.archive);
assert.equal(archiveSha256, pkg.sha256);
const metadata = JSON.parse(readFileSync(path.join(root, 'downloads/azurerm-metadata.json'), 'utf8'));
assert.equal(metadata.shasum, archiveSha256);
assert.ok(readFileSync(path.join(root, 'downloads/azurerm-SHA256SUMS'), 'utf8').split(/\r?\n/)
	.some(line => line.startsWith(archiveSha256 + ' ') && line.endsWith(metadata.filename)));
assert.ok(readFileSync(path.join(launch.fixture, '.terraform.lock.hcl'), 'utf8').includes('zh:' + archiveSha256));
const source = readFileSync(path.join(launch.fixture, 'main.tf'), 'utf8');
const serviceSha256 = await hashFile(executable);
const environment: NodeJS.ProcessEnv = {};
for (const name of ['SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
	if (process.env[name]) { environment[name] = process.env[name]; }
}
environment.LOCALAPPDATA = path.join(root, 'local-app-data');
environment.APPDATA = path.join(root, 'roaming');
const child = spawn(executable, [], {env:environment, windowsHide:true, stdio:['pipe','pipe','pipe']});
const exited = once(child, 'exit');
let buffer = Buffer.alloc(0);
let sequence = 0;
let pending: { id: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void } | undefined;
child.stdout.on('data', (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk]);
	while (true) {
		const end = buffer.indexOf('\r\n\r\n');
		if (end < 0) { return; }
		const length = Number(buffer.subarray(0,end).toString().match(/^Content-Length: (\d+)$/)?.[1]);
		assert.ok(Number.isSafeInteger(length) && length > 0 && length <= 8 * 1024 * 1024);
		if (buffer.length < end + 4 + length) { return; }
		const reply = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8'));
		buffer = buffer.subarray(end + 4 + length);
		assert.equal(reply.id, pending?.id);
		pending?.resolve(reply);
		pending = undefined;
	}
});
child.on('error', error => pending?.reject(error));
child.on('exit', () => pending?.reject(new Error('Service exited before replying')));
const request = async (method: string, params: Record<string, unknown> = {}) => {
	assert.ok(!pending, 'requests are sequential');
	const id = String(++sequence);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<Record<string, unknown>>((resolve, reject) => {
			pending = {id,resolve,reject};
			timer = setTimeout(() => reject(new Error('Service request timed out: ' + method)), 30_000);
			const body = Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method,params}));
			child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),body]));
		});
	} finally { if (timer) { clearTimeout(timer); } }
};
const call = async (method: string, params: Record<string, unknown> = {}) => {
	const response = await request(method, params);
	assert.ok(!response.error, JSON.stringify(response.error));
	return response.result as Record<string, unknown>;
};
const checks: string[] = [];
const check = (name: string, condition: unknown) => { assert.ok(condition,name); checks.push(name); console.log('PASS ' + name); };
let complete = false;
try {
	const init = await call('initialize', {supportedProtocolVersions:[1],expectedServiceCommit:expectedCommit});
	check('actual service identity matches expected commit and protocol', init.serviceCommit === expectedCommit && init.protocolVersion === 1);
	const key = {address:pkg.address, version:pkg.version, platform:pkg.platform};
	const before = parseMirrorInventory(await call('listMirrorPackages'));
	assert.ok(before.ok && before.value.packages.length === 0, 'requires an empty disposable mirror');
	const wrongDigest = archiveSha256[0] === '0' ? '1' + archiveSha256.slice(1) : '0' + archiveSha256.slice(1);
	const rejected = await request('importMirrorPackage', {...key,archivePath:pkg.archive,expectedSha256:wrongDigest});
	check('authentic archive with wrong digest is rejected', JSON.stringify(rejected.error).includes('UNSUPPORTED_FORMAT'));
	const afterRejected = parseMirrorInventory(await call('listMirrorPackages'));
	check('checksum rejection publishes no package', afterRejected.ok && afterRejected.value.packages.length === 0);
	const imported = parseMirrorImportResult(await call('importMirrorPackage', {...key,archivePath:pkg.archive,expectedSha256:archiveSha256}));
	check('authentic release archive publishes beyond MAX_PATH', imported.ok && imported.value.created && imported.value.package.sha256 === archiveSha256);
	const duplicate = parseMirrorImportResult(await call('importMirrorPackage', {...key,archivePath:pkg.archive,expectedSha256:archiveSha256}));
	check('same archive import is idempotent', duplicate.ok && !duplicate.value.created);
	const inventory = parseMirrorInventory(await call('listMirrorPackages'));
	check('populated inventory has the exact archive size and digest', inventory.ok && inventory.value.packages.length === 1
		&& inventory.value.packages[0].sizeBytes === statSync(pkg.archive).size && inventory.value.packages[0].sha256 === archiveSha256);
	const integrity = parseMirrorIntegrityReport(await call('verifyMirrorIntegrity'));
	check('real populated integrity validates one intact archive', integrity.ok && integrity.value.healthy && integrity.value.verifiedCount === 1);
	const manifest = path.join(root,'local-app-data/CloudForge/service/mirror/.cloudforge-mirror/entries/registry.terraform.io/hashicorp/azurerm/5.14.0/windows_amd64.json');
	check('published manifest exists beyond traditional Windows path limit', manifest.length > 260 && statSync(manifest).isFile());
	const globalCleanup = parseMirrorCleanupPlan(await call('planMirrorCleanup', {quotaBytes:0}));
	check('unscoped cleanup offers the package for review', globalCleanup.ok && globalCleanup.value.evictable.length === 1 && globalCleanup.value.quotaBytes === 0);
	check('mirror operations preserve fixture Terraform', readFileSync(path.join(launch.fixture,'main.tf'),'utf8') === source);
	complete = true;
	console.log(`${checks.length}/${checks.length} actual service checks passed`);
} finally {
	child.stdin.end();
	const timer = setTimeout(() => child.kill(), 2000);
	await exited;
	clearTimeout(timer);
	writeFileSync(path.join(root,'mirror-service-results.json'),JSON.stringify({complete,checks,expectedCommit,serviceSha256,archiveSha256,executable},null,2)+'\n');
}
