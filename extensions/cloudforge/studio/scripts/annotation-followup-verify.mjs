/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
let chromium;
for (const root of [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url]) {
	for (const name of ['playwright', 'playwright-core']) { try { chromium = createRequire(root)(name).chromium; break; } catch { /* Next runtime. */ } }
	if (chromium) { break; }
}
assert.ok(chromium, 'Set PLAYWRIGHT_DIR to an installed Playwright runtime.');
const url = process.argv[2]; assert.ok(url, 'Usage: node scripts/annotation-followup-verify.mjs <preview-url> [--channel=msedge]');
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
const quick = process.argv.includes('--quick');
const output = 'output/playwright/annotation-followup'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 }); let count = 0;
try {
	for (const viewport of (quick ? [{ width: 1360, height: 860 }] : [{ width: 1360, height: 860 }, { width: 1024, height: 768 }])) {
		for (const theme of (quick ? ['light'] : ['light', 'dark'])) {
			const page = await browser.newPage({ viewport }); page.setDefaultTimeout(12_000);
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
			await page.goto(url);
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByRole('button', { name: /^Open Container Apps \(/ }).hover();
			const tile = page.getByRole('button', { name: /^Open Container Apps \(/ }).locator('..');
			assert.notEqual(await tile.evaluate(element => getComputedStyle(element).borderTopColor), await tile.evaluate(element => { const test = document.createElement('span'); test.style.color = 'var(--border)'; element.append(test); const value = getComputedStyle(test).color; test.remove(); return value; }), 'hover activates a distinct light purple border');
			await page.getByLabel('Cloud provider', { exact: true }).selectOption('aws');
			await page.waitForFunction(() => document.querySelector('.lib-docs')?.textContent?.includes('hashicorp/aws'));
			await page.getByLabel('Provider version and schema').click();
			assert.ok((await page.locator('.provider-schema[open]').textContent()).includes('Catalogue snapshot'));
			await page.getByLabel('Provider version and schema').click();
			for (const provider of ['gcp', 'azure']) {
				await page.getByLabel('Cloud provider', { exact: true }).selectOption(provider);
				await page.waitForFunction(prov => document.querySelector('.lib-provider img')?.getAttribute('src')?.includes('provider-' + prov), provider);
				await page.waitForFunction(() => { const image = document.querySelector('.lib-provider img'); return image?.complete && image.naturalWidth > 0; });
			}
			await page.waitForFunction(() => [...document.querySelectorAll('.lab-catalogue img')].every(image => image.complete && image.naturalWidth > 0));
			await page.screenshot({ path: path.join(output, `catalogue-${viewport.width}-${theme}.png`) });
			console.log(`PASS catalogue identity / versions / highlight ${viewport.width} ${theme}`); count++;

			await page.getByLabel('Close resource library', { exact: true }).click();
			if (await page.getByLabel('Toggle resource inspector', { exact: true }).getAttribute('aria-expanded') === 'false') { await page.getByLabel('Toggle resource inspector', { exact: true }).click(); }
			await page.getByLabel('Variables', { exact: true }).click();
			const create = async (name, type, value, sensitive = false) => {
				await page.getByLabel('Create variable', { exact: true }).click();
				await page.getByLabel('Variable name', { exact: true }).fill(name);
				await page.getByLabel('Variable type', { exact: true }).selectOption(type);
				await page.getByLabel('Set default value', { exact: true }).check();
				await page.getByLabel('Variable default value', { exact: true }).fill(value);
				if (sensitive) { await page.getByLabel('Sensitive input', { exact: false }).check(); }
				await page.getByRole('button', { name: 'Save variable', exact: true }).click();
			};
			await create('deployment_region', 'string', 'uksouth');
			await create('capacity', 'number', '3');
			await create('private_key', 'string', 'never-show-this-secret', true);
			await page.getByLabel('Edit variable capacity', { exact: true }).click();
			await page.getByLabel('Delete variable', { exact: true }).click();
			assert.equal(await page.getByLabel('Edit variable capacity', { exact: true }).count(), 0);
			await page.getByLabel('Undo', { exact: true }).click();
			assert.equal(await page.getByLabel('Edit variable capacity', { exact: true }).count(), 1, 'delete is undoable');
			await page.locator('.react-flow__node[data-id="vm"]').click();
			const region = page.locator('.schema-field[data-field-path="location"]').first();
			await region.getByLabel('Choose variable for Region', { exact: true }).click();
			const picker = page.getByRole('dialog', { name: 'Choose variable', exact: true });
			await picker.getByLabel('Search variables', { exact: true }).fill('capacity');
			assert.equal(await picker.getByLabel('Bind variable capacity', { exact: true }).isDisabled(), true);
			await picker.getByLabel('Search variables', { exact: true }).fill('private');
			assert.ok(!(await picker.textContent()).includes('never-show-this-secret'), 'sensitive input preview is masked');
			await picker.getByLabel('Search variables', { exact: true }).fill('deployment');
			await picker.getByLabel('Search variables', { exact: true }).press('ArrowDown'); await page.keyboard.press('Enter');
			assert.ok((await region.textContent()).includes('deployment_region'));
			await region.getByLabel('Choose variable for Region', { exact: true }).click();
			assert.ok((await picker.locator('.variable-picker-current').textContent()).includes('deployment_region'));
			await page.screenshot({ path: path.join(output, `variables-${viewport.width}-${theme}.png`) });
			await page.keyboard.press('Escape');
			await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Choose variable for Region');
			assert.equal(await region.getByLabel('Choose variable for Region', { exact: true }).evaluate(element => element === document.activeElement), true);
			await page.getByLabel('Variables', { exact: true }).click();
			await page.getByLabel('Edit variable deployment_region', { exact: true }).click();
			assert.equal(await page.getByLabel('Delete variable', { exact: true }).isDisabled(), true);
			await page.getByLabel('Variable name', { exact: true }).fill('renamed_draft');
			assert.equal(await page.getByLabel('Delete variable', { exact: true }).isDisabled(), true, 'draft rename cannot bypass in-use guard');
			await page.getByRole('button', { name: 'Cancel', exact: true }).click();
			console.log(`PASS variable search / types / privacy / keyboard / delete ${viewport.width} ${theme}`); count++;

			await page.locator('.react-flow__node[data-id="vm"]').click();
			await page.locator('.resource-fields > details').filter({ has: page.locator('summary', { hasText: /^Graphics$/ }) }).locator('summary').click();
			await page.getByRole('button', { name: 'Replace icon', exact: true }).click();
			const graphic = page.getByRole('dialog', { name: 'Replace icon', exact: true });
			await graphic.getByLabel('Icon provider', { exact: true }).selectOption('aws');
			await graphic.getByLabel('Search icons', { exact: true }).fill('EC2');
			await graphic.locator('.graphic-icon-grid button').first().click();
			await graphic.locator('.graphic-icon-grid img').first().evaluate(async image => { await image.decode(); });
			await graphic.locator('.provider-mark').evaluate(async image => { await image.decode(); });
			await page.screenshot({ path: path.join(output, `icons-${viewport.width}-${theme}.png`) });
			await page.getByLabel('Close replace icon', { exact: true }).click();
			assert.ok((await page.locator('.react-flow__node[data-id="vm"] .resource-node-heading img').getAttribute('src')).includes('/aws/'));
			if (viewport.width === 1360 && theme === 'light') {
				await page.getByLabel('Open focused resource workspace', { exact: true }).click();
				const workspace = page.locator('dialog.resource-workspace[open]');
				await workspace.getByLabel('Choose variable for Region', { exact: true }).click();
				await picker.getByLabel('Search variables', { exact: true }).fill('private');
				assert.ok(!(await picker.textContent()).includes('never-show-this-secret'));
				await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' });
				assert.equal(await workspace.count(), 1, 'Escape closes the picker before the resource workspace');
				await page.getByLabel('Close resource details', { exact: true }).click();
			}
			await page.locator('.react-flow__node[data-id="resource-group"] .resource-container-heading').click();
			assert.equal(await page.locator('.field-impact').count(), 2, 'name and location have sourced replacement guidance');
			await page.screenshot({ path: path.join(output, `impact-${viewport.width}-${theme}.png`) });
			console.log(`PASS icon catalogue / replacement guidance ${viewport.width} ${theme}`); count++;

			await page.getByLabel('Toggle resource inspector', { exact: true }).click();
			await page.getByLabel('Canvas zoom', { exact: true }).selectOption({ label: '50%' });
			await page.locator('.react-flow__node[data-id="vm"]').click();
			await page.locator('main.canvas').focus(); await page.keyboard.press('Control+d');
			const clone = page.locator('.react-flow__node.selected'); const id = await clone.getAttribute('data-id');
			assert.notEqual(id, 'vm');
			if (await page.getByLabel('Toggle resource inspector', { exact: true }).getAttribute('aria-expanded') === 'true') { await page.getByLabel('Toggle resource inspector', { exact: true }).click(); }
			const heading = await page.locator('.react-flow__node[data-id="network"] .resource-container-heading').boundingBox();
			const from = await clone.locator('.resource-node-heading img').boundingBox();
			await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
			await page.mouse.move(heading.x + heading.width - 25, heading.y + heading.height + 4, { steps: 15 });
			assert.ok((await page.locator('.container-drop-status').textContent()).includes('vnet-production'));
			await page.screenshot({ path: path.join(output, `nesting-drag-${viewport.width}-${theme}.png`) });
			await page.mouse.up();
			const exportGraph = async () => {
				await page.getByLabel('Export architecture', { exact: true }).click(); const download = page.waitForEvent('download');
				await page.getByRole('button', { name: 'Graph JSON', exact: true }).click(); const file = await download;
				const value = JSON.parse(readFileSync(await file.path(), 'utf8')); await page.getByLabel('Export architecture', { exact: true }).click(); return value;
			};
			const moved = (await exportGraph()).resources.find(resource => resource.id === id);
			assert.equal(moved.visualParentId, 'network'); assert.equal(moved.parentId, 'resource-group');
			assert.equal(moved.provider, 'azure'); assert.equal(moved.kind, 'compute');
			await page.getByLabel('Undo', { exact: true }).click();
			assert.equal((await exportGraph()).resources.find(resource => resource.id === id).parentId, 'subnet', 'one Undo restores original parent');
			await page.getByLabel('Redo', { exact: true }).click();
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await page.getByRole('button', { name: 'Architecture', exact: true }).click();
			assert.deepEqual((await exportGraph()).resources.find(resource => resource.id === id).positions, moved.positions);
			if (viewport.width === 1360 && theme === 'light') {
				await page.locator('main.canvas').focus(); await page.keyboard.press('Escape');
				await page.getByLabel('Toggle resource library', { exact: true }).click();
				await page.getByLabel('Search resource library', { exact: true }).fill('azurerm_linux_virtual_machine');
				const resource = page.locator('.res-list .res-pick').filter({ has: page.locator('.res-type', { hasText: /^azurerm_linux_virtual_machine$/ }) });
				await resource.dragTo(page.locator('.react-flow__node[data-id="network"] .resource-container-heading'));
				const created = (await exportGraph()).resources.find(resource => resource.catalogue?.type === 'azurerm_linux_virtual_machine');
				assert.ok(created, 'catalogue drag creates a resource');
				assert.equal(created.visualParentId, 'network'); assert.equal(created.parentId, 'resource-group');
			}
			assert.deepEqual(errors, [], 'no console/page errors');
			console.log(`PASS duplicate VM / visual VNet / inheritance / Undo / renderer ${viewport.width} ${theme}`); count++;
			await page.close();
		}
	}
} finally { await browser.close(); }
console.log(`${count}/${quick ? 4 : 16} annotation scenarios passed`);
