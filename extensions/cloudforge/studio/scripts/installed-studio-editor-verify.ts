/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Real installed Workbench, current Studio media and packaged Rust. No bridge/state mocks.
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(studio, 'output/studio-continuation-installed');
const launch = JSON.parse(readFileSync(path.join(root, 'launch.json'), 'utf8'));
const within = (base: string, candidate: string) => {
	const relative = path.relative(base, candidate);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
assert.equal(realpathSync(root), realpathSync(launch.root));
assert.equal(realpathSync(path.dirname(studio)), realpathSync(launch.extension));
assert.ok(within(realpathSync(root), realpathSync(launch.fixture)));
assert.ok(within(realpathSync(root), realpathSync(launch.sharedData)));
assert.ok(Number.isSafeInteger(launch.port) && launch.port > 0 && launch.port < 65536);
const source = path.join(launch.fixture, 'main.tf');
assert.ok(within(realpathSync(launch.fixture), realpathSync(source)));
const before = readFileSync(path.join(root, 'before-main.tf'), 'utf8');
assert.equal(readFileSync(source, 'utf8'), before, 'start with the unchanged disposable fixture');
assert.match(before, /resource "azurerm_linux_virtual_machine_scale_set" "fixture"/);
const initial = before.match(/instances\s*=\s*(\d+)/)?.[1];
assert.ok(initial);
const prefix = before.slice(0, before.indexOf('resource "azurerm_linux_virtual_machine_scale_set"'));
const suffix = before.slice(before.indexOf('resource "azurerm_network_interface"'));
assert.ok(prefix && suffix);
const runtime = process.env.PLAYWRIGHT_DIR;
const require = createRequire(runtime ? path.join(runtime, 'package.json') : import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + launch.port);
const checks: string[] = [];
let complete = false;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };
try {
	const page = browser.contexts()[0].pages().find((candidate: { url(): string }) => candidate.url().startsWith('vscode-file://'));
	assert.ok(page);
	page.setDefaultTimeout(10_000);
	const wrapper = await (await page.locator('iframe.webview').elementHandle()).contentFrame();
	assert.ok(wrapper, 'open the owned fixture in Studio first');
	const inner = wrapper.locator('iframe#active-frame');
	// Electron can omit the guest frame from CDP. Use its same-origin document and real UI handlers.
	const read = <T>(fn: (document: Document) => T): Promise<T> => inner.evaluate((element: HTMLIFrameElement, source: string) => Function('document', `return (${source})(document)`)(element.contentDocument), fn.toString());
	const wait = async (fn: (document: Document) => unknown, message: string) => {
		for (let attempt = 0; attempt < 150; attempt++) {
			if (await read(fn)) { return; }
			await page.waitForTimeout(100);
		}
		throw new Error(message);
	};
	const click = (label: string) => inner.evaluate((element: HTMLIFrameElement, label: string) => {
		const document = element.contentDocument!;
		const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
		const scope = dialogs.at(-1) ?? document;
		const button = [...scope.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') === label || button.textContent.trim() === label) && button.getClientRects().length);
		if (!button || button.disabled) { throw new Error('Unavailable active-dialog button: ' + label); }
		// Radix Tabs activates on mousedown; click() alone can select a background control or do nothing.
		button.dispatchEvent(new document.defaultView!.MouseEvent('mousedown', { bubbles: true, button: 0 }));
		button.click();
	}, label);
	const set = (label: string, value: string) => inner.evaluate((element: HTMLIFrameElement, data: { label: string; value: string }) => {
		const document = element.contentDocument!;
		const scope = document.querySelector('dialog.resource-workspace[open]')!;
		const control = [...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find(control => control.getAttribute('aria-label') === data.label && control.getClientRects().length);
		if (!control) { throw new Error('Missing active-editor input: ' + data.label); }
		control.focus();
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')!.set!.call(control, data.value);
		control.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
		control.dispatchEvent(new document.defaultView!.Event('change', { bubbles: true }));
	}, { label, value });
	const open = async (address: string) => {
		if (await read(document => !!document.querySelector('dialog.resource-workspace[open]'))) { await click('Close resource details'); }
		await click('Fit architecture to view');
		await wait(document => document.querySelectorAll('.react-flow__node').length >= 3, 'fixture resources did not fit the viewport');
		await inner.evaluate((element: HTMLIFrameElement, address: string) => {
			const node = [...element.contentDocument!.querySelectorAll<HTMLElement>('.react-flow__node')].find(node => node.textContent.includes(address));
			assertNode(node).click();
			function assertNode(node: HTMLElement | undefined): HTMLElement { if (!node) { throw new Error('Missing canvas resource ' + address); } return node; }
		}, address);
		await click('Configure');
		await wait(document => !!document.querySelector('dialog[open] .resource-fields [data-field-path="admin_username"] input'), 'resource form did not hydrate');
	};
	const closedUndo = async () => { await click('Close resource details'); await click('Undo'); };
	const vm = 'azurerm_linux_virtual_machine.application';
	const vmss = 'azurerm_linux_virtual_machine_scale_set.fixture';
	await open(vm);
	await wait(document => !!document.querySelector('dialog[open] [data-field-path="network_interface_ids"] select'), 'existing NIC references did not open as entries');
	check('existing NIC reference opens in Claude’s entry editor', await read(document => document.querySelector('dialog[open] [data-field-path="network_interface_ids"]')!.textContent.includes('azurerm_network_interface.primary')));
	check('source hydration does not create Undo steps', await read(document => document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled));
	if (await read(document => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent === 'Context' && button.getClientRects().length))) { await click('Context'); }
	await click('Variables');
	await click('Create variable');
	await set('Variable name', 'extra_nic');
	await inner.evaluate((element: HTMLIFrameElement) => element.contentDocument!.querySelector<HTMLInputElement>('dialog[open] [aria-label="Set default value"]')!.click());
	await set('Variable default value', 'qa-extra-nic');
	await click('Save variable');
	check('variable creation uses the current configurator', await read(document => !!document.querySelector('dialog[open] [aria-label="Edit variable extra_nic"]')));
	if (await read(document => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent === 'Parameters' && button.getClientRects().length))) { await click('Parameters'); }
	await click('Add variable entry to Network interface IDs');
	check('variable and existing NIC reference coexist in the same ordered list', await read(document => {
		const field = document.querySelector('dialog[open] [data-field-path="network_interface_ids"]')!;
		return field.textContent.includes('azurerm_network_interface.primary') && field.textContent.includes('var.extra_nic') && field.querySelectorAll('.list-entry').length === 2;
	}));
	check('variable and list edits leave the project source untouched', readFileSync(source, 'utf8') === before);
	if (await read(document => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent === 'Context' && button.getClientRects().length))) { await click('Context'); }
	await click('Variables');
	check('mixed-list use is counted and blocks variable deletion', await read(document => {
		const card = document.querySelector('dialog[open] [aria-label="Edit variable extra_nic"]')!.closest('article')!;
		return card.textContent.includes('1 resource uses') && [...card.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Delete')!.disabled;
	}));
	if (await read(document => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent === 'Parameters' && button.getClientRects().length))) { await click('Parameters'); }
	await read(document => document.querySelector('dialog[open] [data-field-path="network_interface_ids"]')!.scrollIntoView({ block: 'center' }));
	await page.screenshot({ path: path.join(root, 'mixed-list.png') });
	await closedUndo();
	await open(vm);
	check('one Undo restores only the original NIC entry', await read(document => document.querySelector('dialog[open] [data-field-path="network_interface_ids"]')!.querySelectorAll('.list-entry').length === 1));
	await closedUndo();
	check('the next Undo removes variable creation', await read(document => document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled));
	await open(vmss);
	await wait(document => !!(document.defaultView as Window & typeof globalThis & { monaco?: { editor: { getModels(): { getValue(): string }[] } } })!.monaco?.editor.getModels().length, 'resource code editor did not load');
	await read(document => {
		const monaco = (document.defaultView as unknown as { monaco: { editor: { getModels(): { getValue(): string; setValue(value: string): void }[] } } }).monaco;
		const model = monaco.editor.getModels().find(model => model.getValue().includes('scale_set" "fixture"'))!;
		model.setValue(model.getValue().replace(/}\s*$/, '  tags = merge({ owner = "qa" }, { stage = "test" })\n}'));
	});
	await click('Apply');
	await wait(document => !!document.querySelector('.terraform-review'), 'explicit Terraform review did not open');
	check('unapplied Terraform cannot be saved', await read(document => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(button => button.textContent === 'Save main.tf')!.disabled));
	check('review truthfully reports provider validation unavailable', await read(document => document.querySelector('.terraform-review')!.textContent.includes('has not been validated by the provider')));
	await click('Apply reviewed changes');
	check('applied expression is reliably marked as Terraform configuration', await read(document => document.querySelector('dialog[open] .additional-configuration')!.textContent.includes('Configured in Terraform')));
	await inner.evaluate((element: HTMLIFrameElement, value: string) => {
		const control = element.contentDocument!.querySelector<HTMLInputElement>('dialog[open] [data-field-path="instances"] input')!;
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')!.set!.call(control, value);
		control.dispatchEvent(new element.contentDocument!.defaultView!.Event('input', { bubbles: true }));
	}, String(Number(initial) + 1));
	check('form edit preserves additional configuration', await read(document => document.querySelector('dialog[open] .additional-configuration')!.textContent.includes('Configured in Terraform')));
	await closedUndo();
	await open(vmss);
	check('Undo of the form edit retains the preceding Terraform apply', await read(document => document.querySelector('dialog[open] .additional-configuration')!.textContent.includes('Configured in Terraform')));
	await closedUndo();
	await open(vmss);
	check('the next Undo removes exactly the Terraform apply', await read(document => !document.querySelector('dialog[open] .additional-configuration')!.textContent.includes('Configured in Terraform')));
	await click('Close resource details');
	await click('Redo');
	await open(vmss);
	check('Redo restores the same-resource expression', await read(document => document.querySelector('dialog[open] .additional-configuration')!.textContent.includes('Configured in Terraform')));
	check('reviewed draft changes still do not write source', readFileSync(source, 'utf8') === before);
	await click('Save main.tf');
	await wait(document => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].some(button => button.textContent === 'Apply Save' && !button.disabled), 'guarded Rust save preview unavailable');
	check('guarded preview leaves source unchanged', readFileSync(source, 'utf8') === before);
	await page.screenshot({ path: path.join(root, 'additional-guarded-save.png') });
	await click('Cancel');
	check('cancelling guarded save leaves source unchanged', readFileSync(source, 'utf8') === before);
	await click('Save main.tf');
	await wait(document => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].some(button => button.textContent === 'Apply Save' && !button.disabled), 'second guarded preview unavailable');
	await click('Apply Save');
	for (let attempt = 0; attempt < 100; attempt++) {
		try { if (readFileSync(source, 'utf8') !== before) { break; } } catch { /* guarded Windows replacement may briefly move the original */ }
		await page.waitForTimeout(100);
	}
	const saved = readFileSync(source, 'utf8');
	check('guarded save writes the reviewed additional expression', /tags\s*=\s*merge\(/.test(saved));
	check('guarded save preserves all unrelated original blocks exactly', saved.startsWith(prefix) && saved.endsWith(suffix));
	check('undone form and variable changes are absent from the saved file', saved.match(/instances\s*=\s*(\d+)/)?.[1] === initial && !saved.includes('extra_nic'));
	await click('Close resource details');
	await click('Refresh from workspace');
	await open(vmss);
	await wait(document => !!document.querySelector('dialog[open] .additional-configuration')?.textContent.includes('Configured in Terraform'), 'saved expression did not rehydrate after refresh');
	check('saved expression returns to the same resource after refresh', true);
	await page.screenshot({ path: path.join(root, 'additional-after-refresh.png') });
	writeFileSync(path.join(root, 'after-main.tf'), saved);
	complete = true;
	console.log(`${checks.length}/${checks.length} installed Studio checks passed`);
} finally {
	writeFileSync(path.join(root, 'editor-results.json'), JSON.stringify({ complete, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: studio, encoding: 'utf8' }).trim(), runnerSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), checks, source, cloudOperationsExecuted: false }, null, 2));
	await browser.close();
}
