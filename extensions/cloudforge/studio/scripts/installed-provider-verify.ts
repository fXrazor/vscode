/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Real Workbench + packaged service proof. No bridge mocks, grant seeding, or cloud operations.
// Launch an isolated development host first; see research/installed-provider-verification.md.
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchFile = path.resolve(process.argv[2] ?? '');
const within = (root: string, candidate: string) => {
	const relative = path.relative(root, candidate);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
assert.ok(within(path.join(studio, 'output'), launchFile), 'launch.json must be in this worktree’s ignored Studio output');
const launch = JSON.parse(readFileSync(launchFile, 'utf8'));
const root = path.dirname(launchFile);
assert.equal(path.resolve(launch.root), root);
assert.equal(path.resolve(launch.extension), path.dirname(studio));
assert.ok(within(realpathSync(root), realpathSync(launch.fixture)), 'only an owned disposable fixture may be saved');
assert.ok(typeof launch.sharedData === 'string' && within(realpathSync(root), realpathSync(launch.sharedData)), 'shared app storage must also be isolated');
assert.ok(Number.isSafeInteger(launch.port) && launch.port > 0 && launch.port < 65536);
const sourcePath = path.join(launch.fixture, 'main.tf');
assert.ok(within(realpathSync(launch.fixture), realpathSync(sourcePath)), 'source file must remain inside the disposable fixture');
const before = readFileSync(sourcePath, 'utf8');
assert.match(before, /resource "azurerm_linux_virtual_machine_scale_set" "fixture"/);
assert.match(before, /name\s*=\s*"provider-editor-fixture"/);
const match = before.match(/instances\s*=\s*(\d+)/);
assert.ok(match, 'fixture has one literal instance count');
const initial = Number(match[1]);
assert.ok(initial >= 1 && initial < 1000);
const changed = initial + 1;
const runtime = process.env.PLAYWRIGHT_DIR;
const require = createRequire(runtime ? path.join(runtime, 'package.json') : import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.port}`);
const checks: string[] = [];
let complete = false;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };
try {
	const page = browser.contexts()[0].pages().find((p: { url(): string }) => p.url().startsWith('vscode-file://'));
	assert.ok(page, 'owned Workbench page exists');
	page.setDefaultTimeout(10_000);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(150);
	await page.keyboard.press('Escape');
	if (!await page.locator('iframe.webview').count()) {
		await page.keyboard.press('Control+Shift+P');
		await page.getByRole('textbox', { name: 'Type the name of a command to run.', exact: true }).fill('>CloudForge: Open Workspace');
		await page.getByRole('option', { name: 'CloudForge: Open Workspace', exact: true }).click();
		await page.getByRole('textbox', { name: 'Folder path - Open a CloudForge Workspace', exact: true }).fill(launch.fixture + path.sep);
		await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
		await page.locator('iframe.webview').waitFor();
	}
	const wrapper = await (await page.locator('iframe.webview').elementHandle()).contentFrame();
	assert.ok(wrapper);
	// Some Electron CDP versions omit the inner webview frame from Page.getFrameTree.
	// Read its same-origin document through the wrapper; interact with actual controls only.
	const inner = wrapper.locator('iframe#active-frame');
	const read = <T>(fn: (document: Document) => T): Promise<T> => inner.evaluate((e: HTMLIFrameElement, source: string) => {
		const document = e.contentDocument;
		return Function('document', `return (${source})(document)`)(document);
	}, fn.toString());
	const wait = async (fn: (document: Document) => unknown, message: string) => {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			if (await read(fn)) { return; }
			await page.waitForTimeout(100);
		}
		throw new Error(message);
	};
	const click = (label: string) => inner.evaluate((e: HTMLIFrameElement, label: string) => {
		const button = [...e.contentDocument!.querySelectorAll('button')].find(b =>
			(b.getAttribute('aria-label') === label || b.textContent.trim() === label) && b.getClientRects().length);
		if (!button || button.disabled) { throw new Error(`Unavailable button: ${label}`); }
		button.click();
	}, label);
	const field = (name: string): Promise<string | undefined> => inner.evaluate((e: HTMLIFrameElement, name: string) => {
		const area = e.contentDocument!.querySelector('dialog.resource-workspace[open]');
		const control = area?.querySelector<HTMLInputElement>(`[data-field-path="${name}"] input`);
		return control?.value;
	}, name);
	const setInstances = async (value: number) => {
		await read(d => d.querySelector<HTMLInputElement>('dialog.resource-workspace[open] [data-field-path="instances"] input')!.focus());
		await page.keyboard.press('Control+A');
		await page.keyboard.insertText(String(value));
		await page.keyboard.press('Tab');
		assert.equal(await field('instances'), String(value));
	};
	const open = async () => {
		if (!await read(d => !!d.querySelector('dialog.resource-workspace[open]'))) {
			if (!await read(d => [...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Configure' && b.getClientRects().length))) {
				await read(d => d.querySelector<HTMLElement>('.react-flow__node-resource')!.click());
				await wait(d => [...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Configure' && b.getClientRects().length), 'Selecting fixture did not reveal Configure');
			}
			await click('Configure');
		}
		await wait(d => !!d.querySelector('dialog.resource-workspace[open] [data-field-path="instances"] input'), 'VMSS form did not load');
	};
	await open();
	check('live VMSS source values hydrate', await field('instances') === String(initial) && await field('admin_username') === 'cloudforge' && await field('sku') === 'Standard_D2s_v5');
	check('required disk and nested NIC/IP values hydrate', await read(d => {
		const w = d.querySelector('dialog.resource-workspace[open]');
		const values = [...w!.querySelectorAll('input')].map(e => e.value);
		return values.includes('ReadWrite') && values.includes('Standard_LRS') && values.some(v => v.endsWith('/subnets/primary'));
	}));
	check('captured schema version is explicit', await read(d => d.querySelector('dialog.resource-workspace[open]')!.textContent.includes('registry.terraform.io/hashicorp/azurerm 5.14.0')));
	await setInstances(changed);
	check('form edit does not write the file', readFileSync(sourcePath, 'utf8') === before);
	await click('Close resource details');
	await click('Undo');
	await open();
	check('semantic Undo restores source value', await field('instances') === String(initial));
	await setInstances(changed);
	await click('Save main.tf');
	await wait(d => d.body.textContent.includes('Keeps 1 other block exactly as written') && [...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Apply Save' && !b.disabled), 'Rust guarded preview did not arrive');
	check('guarded preview leaves source untouched', readFileSync(sourcePath, 'utf8') === before);
	await page.screenshot({ path: path.join(root, 'guarded-save.png') });
	await click('Apply Save');
	const expected = before.replace(match[0], match[0].replace(match[1], String(changed)));
	for (let retry = 0; retry < 100; retry++) {
		try {
			if (readFileSync(sourcePath, 'utf8') === expected) { break; }
		} catch (error) {
			// Windows guarded replacement can briefly move the original before publishing its replacement.
			if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT')) { throw error; }
		}
		await page.waitForTimeout(100);
	}
	check('Rust save changes only the reviewed instance count', readFileSync(sourcePath, 'utf8') === expected);
	await click('Close resource details');
	await click('Refresh from workspace');
	await wait(d => !d.querySelector<HTMLButtonElement>('[aria-label="Refresh from workspace"]')?.disabled, 'Refresh did not complete');
	await open();
	check('saved source rehydrates after refresh', await field('instances') === String(changed));
	await page.screenshot({ path: path.join(root, 'vmss-installed.png') });
	writeFileSync(path.join(root, 'vmss-installed.txt'), await read(d => d.body.innerText));
	await click('Close resource details');
	const manager = async () => {
		await page.keyboard.press('Control+Shift+P');
		await page.getByRole('textbox', { name: 'Type the name of a command to run.', exact: true }).fill('>CloudForge: Manage Offline Provider Packages');
		await page.getByRole('option', { name: /CloudForge: Manage Offline Provider Packages/ }).click();
	};
	const choose = async (text: string) => {
		await page.getByRole('textbox', { name: /^Choose an offline provider mirror action/ }).fill(text);
		await page.getByRole('option').filter({ hasText: text }).waitFor();
		await page.keyboard.press('Enter');
	};
	await manager();
	await choose('Browse Packages');
	await page.getByText('Offline Provider Packages (Empty Mirror)', { exact: true }).waitFor();
	check('real empty inventory is distinguished', (await page.locator('.quick-input-widget').innerText()).includes('Empty Mirror'));
	await page.keyboard.press('Escape');
	await page.getByText('Offline Provider Packages (Empty Mirror)', { exact: true }).waitFor({state:'hidden'});
	await manager();
	await choose('Verify Mirror Integrity');
	await page.getByRole('option', { name: /Verified in this check: 0 intact package/ }).waitFor();
	check('real empty integrity report is validated', (await page.locator('.quick-input-widget').innerText()).includes('0 bytes'));
	await page.screenshot({ path: path.join(root, 'mirror-installed.png') });
	writeFileSync(path.join(root, 'mirror-installed.txt'), await page.locator('body').ariaSnapshot());
	await page.keyboard.press('Escape');
	await page.getByRole('option', { name: /clear-all Review Cleanup/ }).waitFor();
	await choose('Review Cleanup');
	await page.getByRole('textbox', { name: /Target Local Provider Mirror Quota/ }).fill('0');
	await page.keyboard.press('Enter');
	await page.getByRole('alert').filter({ hasText: 'Local provider mirror is within quota (0 bytes used; 0 bytes target quota).' }).waitFor();
	check('zero MiB quota remains zero in real service cleanup', true);
	await choose('Check Architecture Readiness');
	await page.getByRole('option', { name: /Not ready \(valid lockfile · 2 missing · 0 corrupted\)/ }).waitFor();
	const readinessText = await page.locator('.quick-input-widget').innerText();
	check('exact locked Windows package is reported missing', readinessText.includes('registry.terraform.io/hashicorp/azurerm 5.14.0 (windows_amd64)'));
	check('offline initialization is unavailable for missing packages', !readinessText.includes('Initialize Architecture Offline'));
	writeFileSync(path.join(root, 'readiness-installed.txt'), await page.locator('body').ariaSnapshot());
	await page.keyboard.press('Escape');
	complete = true;
	console.log(`${checks.length}/${checks.length} installed checks passed`);
} finally {
	const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:studio, encoding:'utf8'}).trim();
	const runnerSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
	writeFileSync(path.join(root, 'installed-results.json'), JSON.stringify({ complete, sourceRevision, runnerSha256, checks, changedFixture: sourcePath }, null, 2) + '\n');
	await browser.close();
}
