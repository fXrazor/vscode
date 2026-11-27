/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Browser preview proof using the real Studio, draft, Save, export and history.
// No service, installed Workbench, provider execution or workspace writes are involved.
const url = process.argv[2];
assert.ok(url && new URL(url).hostname === '127.0.0.1', 'provide the owned local preview URL');
const runtime = process.env.PLAYWRIGHT_DIR;
const require = createRequire(runtime ? path.join(runtime, 'package.json') : import.meta.url);
const { chromium } = require('playwright-core');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
const output = path.resolve('output/playwright/variable-collections');
mkdirSync(output, { recursive: true });
const checks: string[] = [];
const errors: string[] = [];
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10_000);
page.on('pageerror', (error: Error) => errors.push(error.message));
page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') { errors.push(message.text()); } });
const workspace = page.locator('dialog.resource-workspace[open]');
const form = page.locator('.variable-configurator');
const button = (name: string) => page.getByRole('button', { name, exact: true });
const input = (name: string) => page.getByRole('textbox', { name, exact: true });
const defaultGroup = page.getByRole('group', { name: 'Variable default value', exact: true });
const valueGroup = page.getByRole('group', { name: 'Variable value', exact: true });
async function openVariables() {
	await page.getByRole('group', { name: 'vm-application, Virtual machine', exact: true }).click();
	await button('Open focused resource workspace').click();
	if (await button('Context').isVisible()) { await button('Context').click(); }
	await workspace.getByRole('tab', { name: 'Variables', exact: true }).click();
}
async function create(name: string, type: string) {
	await button('Create variable').click();
	await input('Variable name').fill(name);
	await page.getByRole('combobox', { name: 'Variable type', exact: true }).selectOption(type);
	await page.getByRole('checkbox', { name: 'Set default value', exact: true }).check();
}
async function json(group: typeof defaultGroup, label: string) {
	await group.getByRole('button', { name: 'Edit JSON', exact: true }).click();
	const value = await input(label + ' JSON').inputValue();
	await group.getByRole('button', { name: 'Use entry fields', exact: true }).click();
	return value;
}
async function exported() {
	await button('Close resource details').click();
	await page.locator('summary').filter({ hasText: /^Export$/ }).click();
	const downloadPromise = page.waitForEvent('download');
	await button('Graph JSON').click();
	const download = await downloadPromise;
	await page.locator('summary').filter({ hasText: /^Export$/ }).click();
	return JSON.parse(readFileSync(await download.path(), 'utf8'));
}
try {
	await page.goto(url);
	await openVariables();
	await create('application_names', 'list(string)');
	check('enabling a list does not silently initialize its draft', (await form.getByLabel('Effective variable value').textContent()).includes('Complete the value'));
	await button('Save variable').click();
	check('unset collection cannot be saved as an empty list', await form.getByRole('alert').count() === 1);
	await button('Add entry to Variable default value').click();
	await input('Variable default value entry 1').fill('web');
	await button('Add entry to Variable default value').click();
	await input('Variable default value entry 2').fill('api "quoted" ☁');
	await button('Add entry to Variable default value').click();
	assert.deepEqual(JSON.parse(await json(defaultGroup, 'Variable default value')), ['web', 'api "quoted" ☁', '']);
	check('list fields and JSON preserve order, empty strings, quotes and Unicode', true);
	await button('Remove Variable default value entry 1').click();
	check('remove returns keyboard focus to Add entry', await button('Add entry to Variable default value').evaluate((element: HTMLElement) => element === document.activeElement));
	assert.deepEqual(JSON.parse(await json(defaultGroup, 'Variable default value')), ['api "quoted" ☁', '']);
	check('removing a list entry preserves its remaining values', true);
	await page.getByRole('checkbox', { name: 'Set architecture value', exact: true }).check();
	await valueGroup.getByRole('button', { name: 'Use empty list', exact: true }).click();
	assert.equal(await json(valueGroup, 'Variable value'), '[]');
	assert.deepEqual(JSON.parse(await json(defaultGroup, 'Variable default value')), ['api "quoted" ☁', '']);
	check('default and architecture value have independent drafts', true);
	await defaultGroup.getByRole('button', { name: 'Edit JSON', exact: true }).click();
	await input('Variable default value JSON').fill('[');
	check('incomplete JSON remains visible and cannot switch to fields', await input('Variable default value JSON').inputValue() === '[' && await defaultGroup.getByRole('button', { name: 'Use entry fields', exact: true }).isDisabled());
	await input('Variable default value JSON').fill('[1]');
	check('wrong member types keep JSON visible and disable field mode', await defaultGroup.getByRole('button', { name: 'Use entry fields', exact: true }).isDisabled());
	await button('Save variable').click();
	check('invalid JSON type blocks Save without losing the draft', await input('Variable default value JSON').inputValue() === '[1]' && await form.getByRole('alert').count() === 1);
	await input('Variable default value JSON').fill('["recovered"]');
	check('correcting JSON waits for the explicit field-mode action', await input('Variable default value JSON').isVisible());
	await defaultGroup.getByRole('button', { name: 'Use entry fields', exact: true }).focus();
	await page.keyboard.press('Enter');
	check('corrected JSON hydrates the same fields', await input('Variable default value entry 1').inputValue() === 'recovered');
	await defaultGroup.getByRole('button', { name: 'Use null', exact: true }).click();
	check('null is explicit and distinct from empty or unset', await json(defaultGroup, 'Variable default value') === 'null');
	await defaultGroup.getByRole('button', { name: 'Use empty list', exact: true }).click();
	check('empty list is explicit', await json(defaultGroup, 'Variable default value') === '[]');
	await button('Save variable').click();
	check('Save returns to variables', await button('Edit variable application_names').isVisible());
	let snapshot = await exported();
	assert.deepEqual(snapshot.variables.find((item: { name: string }) => item.name === 'application_names').defaultValue, []);
	assert.deepEqual(snapshot.variables.find((item: { name: string }) => item.name === 'application_names').value, []);
	check('canonical architecture export contains typed collections', true);
	await button('Undo').click();
	check('all draft edits and mode switches produce one semantic Save step', await button('Undo').isDisabled());
	await button('Redo').click();
	await openVariables();
	check('Redo restores the saved variable', await button('Edit variable application_names').isVisible());
	await create('resource_tags', 'map(string)');
	await input('Variable default value new key').fill('team');
	await button('Add entry to Variable default value').click();
	await input('Variable default value key "team"').fill('platform');
	await input('Variable default value new key').fill('team');
	check('duplicate keys cannot overwrite a previous value', await button('Add entry to Variable default value').isDisabled() && await input('Variable default value key "team"').inputValue() === 'platform');
	await input('Variable default value new key').fill('__proto__');
	await button('Add entry to Variable default value').click();
	await input('Variable default value key "__proto__"').fill('literal key');
	const mapJson = await json(defaultGroup, 'Variable default value');
	assert.deepEqual(JSON.parse(mapJson), JSON.parse('{"team":"platform","__proto__":"literal key"}'));
	check('special object keys remain ordinary editable map entries', true);
	await defaultGroup.getByRole('button', { name: 'Edit JSON', exact: true }).click();
	await input('Variable default value JSON').fill('{"":"empty key","team":"platform"}');
	await defaultGroup.getByRole('button', { name: 'Use entry fields', exact: true }).click();
	check('existing empty JSON keys remain editable', await input('Variable default value key ""').inputValue() === 'empty key');
	await button('Remove Variable default value key ""').click();
	check('removing a map entry returns focus to the new-key input', await input('Variable default value new key').evaluate((element: HTMLElement) => element === document.activeElement));
	check('map removal preserves the other entries', await json(defaultGroup, 'Variable default value') === '{"team":"platform"}');
	await page.getByRole('checkbox', { name: 'Sensitive input Hide values in previews and exports.', exact: true }).check();
	check('sensitive collection uses the existing masked input', await page.getByLabel('Variable default value', { exact: true }).getAttribute('type') === 'password' && await defaultGroup.count() === 0 && (await form.getByLabel('Effective variable value').textContent()).includes('Sensitive value hidden'));
	await page.getByRole('checkbox', { name: 'Sensitive input Hide values in previews and exports.', exact: true }).uncheck();
	check('returning from sensitive mode retains the collection', await input('Variable default value key "team"').inputValue() === 'platform');
	await page.getByRole('checkbox', { name: 'Set default value', exact: true }).uncheck();
	await page.getByRole('checkbox', { name: 'Set default value', exact: true }).check();
	check('disabling and enabling a default retains its unsaved text', await input('Variable default value key "team"').inputValue() === 'platform');
	await button('Save variable').click();
	await button('Edit variable resource_tags').click();
	await input('Variable default value key "team"').fill('cancelled change');
	await button('Cancel').click();
	await button('Edit variable resource_tags').click();
	check('Cancel leaves canonical values unchanged', await input('Variable default value key "team"').inputValue() === 'platform');
	await page.getByRole('checkbox', { name: 'Set default value', exact: true }).uncheck();
	await button('Save variable').click();
	snapshot = await exported();
	check('disabled default saves as unset, not empty or null', !Object.hasOwn(snapshot.variables.find((item: { name: string }) => item.name === 'resource_tags'), 'defaultValue'));
	await openVariables();
	await button('Edit variable resource_tags').click();
	await page.getByRole('checkbox', { name: 'Set default value', exact: true }).check();
	await input('Variable default value new key').fill('deployment_owner');
	await button('Add entry to Variable default value').click();
	await input('Variable default value key "deployment_owner"').fill('platform team');
	const longKey = 'deployment_owner_'.repeat(8);
	await input('Variable default value new key').fill(longKey);
	await button('Add entry to Variable default value').click();
	await input('Variable default value key ' + JSON.stringify(longKey)).fill('Long imported keys wrap within the panel');
	for (const size of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
		for (const theme of ['light', 'dark']) {
			if (await page.locator('.studio.theme-' + theme).count() === 0) {
				await button('Close resource details').click();
				await page.setViewportSize({ width: 1440, height: 1000 });
				await button('Toggle light or dark theme').click();
				await openVariables();
				check('reopening retains the variable draft ' + size.width + ' ' + theme, await input('Variable default value key "deployment_owner"').inputValue() === 'platform team');
			}
			await page.setViewportSize(size);
			if (size.width <= 1100 && await button('Context').isVisible()) { await button('Context').click(); }
			await defaultGroup.scrollIntoViewIfNeeded();
			const fits = await form.evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth + 1);
			const fieldsFit = await defaultGroup.evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth + 1);
			check('collection fits the existing variable panel ' + size.width + ' ' + theme, fits && fieldsFit && await button('Save variable').isVisible());
			await page.screenshot({ path: path.join(output, `map-${size.width}-${theme}.png`) });
		}
	}
	check('no browser errors', errors.length === 0);
	writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, errors, url, installedProof: false }, null, 2));
	console.log(`${checks.length}/${checks.length} browser-preview checks passed`);
} finally {
	await browser.close();
}
