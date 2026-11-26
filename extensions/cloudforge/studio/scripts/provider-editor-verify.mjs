/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const runtime = process.env.PLAYWRIGHT_DIR;
const require = createRequire(runtime ? path.join(runtime, 'package.json') : import.meta.url);
const { chromium } = require('playwright-core');
const url = process.argv[2];
if (!url) { throw new Error('Usage: node scripts/provider-editor-verify.mjs <owned-preview-url> [--channel=msedge]'); }
const channel = process.argv.find(argument => argument.startsWith('--channel='))?.slice(10);
const nestedOnly = process.argv.includes('--nested-only');
const output = 'output/playwright/provider-editor';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
let count = 0;
const errors = [];
const check = (name, condition) => { assert.ok(condition, name); console.log('PASS ' + name); count++; };
const send = (page, message) => page.evaluate(data => window.postMessage(data, '*'), message);
const graph = (type, provider) => ({
	workspaceId: 'provider-editor', architectureId: provider, architectureName: 'Provider form verification', sourceRevision: 'a'.repeat(64), status: 'complete', edges: [], diagnostics: [],
	nodes: [{ id: 'resource', kind: 'resource', resourceType: type, name: 'example', label: 'Provider resource', hasSource: true }],
});
try {
	for (const viewport of nestedOnly ? [] : [{ width: 1920, height: 1080 }, { width: 1360, height: 860 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
		for (const theme of ['light', 'dark']) {
			const page = await browser.newPage({ viewport });
			page.setDefaultTimeout(15_000);
			page.on('pageerror', error => errors.push(error.message));
			page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
			await page.addInitScript(() => { window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} }); });
			await page.goto(url);
			await page.waitForFunction(() => window.__posted?.some(message => message.type === 'ready'));
			await send(page, { type: 'graph', graph: graph('azurerm_linux_virtual_machine_scale_set', 'azure'), viewState: { mode: 'visual', theme } });
			await page.locator('.react-flow__node[data-id="resource"]').click();
			await page.getByLabel('Open focused resource workspace', { exact: true }).click();
			const workspace = page.locator('dialog.resource-workspace[open]');
			await workspace.locator('[data-field-path="sku"] input').waitFor();
			const label = viewport.width + ' ' + theme;
			check('VMSS required fields and instance count visible ' + label, await workspace.locator('[data-field-path="admin_username"] input').count() === 1 && await workspace.locator('[data-field-path="resource_group_name"] input').count() === 1 && await workspace.locator('[data-field-path="instances"] input').count() === 1);
			const help = await workspace.locator('[data-field-path="sku"] .field-label-help').evaluate(element => { const label = element.querySelector('label').getBoundingClientRect(); const help = element.querySelector('button').getBoundingClientRect(); return help.left - label.right; });
			check('help icon stays beside its label ' + label, help >= 0 && help <= 8);
			check('metadata starts collapsed ' + label, !(await workspace.locator('.form-section').filter({ has: page.locator('summary', { hasText: /^Metadata/ }) }).getAttribute('open')));
			check('loading metadata preserves clean history ' + label, !(await page.getByLabel('Undo', { exact: true }).isEnabled()));
			const space = await workspace.locator('.resource-fields').evaluate(element => ({ align: getComputedStyle(element).alignContent, overflow: element.scrollWidth > element.clientWidth + 1 }));
			check('form content follows natural height ' + label, space.align === 'start' && !space.overflow);
			await page.screenshot({ path: path.join(output, `vmss-${viewport.width}-${theme}.png`) });
			if (viewport.width === 1920 && theme === 'light') {
				await workspace.locator('.resource-fields > .nested-blocks > .add-blocks > summary').click();
				await workspace.getByRole('button', { name: 'Add network interface to resource', exact: true }).click();
				const nic = workspace.locator('.nested-block[data-block-type="network_interface"]');
				await nic.locator(':scope > .nested-block-body > .nested-blocks > .add-blocks > summary').click();
				await nic.getByRole('button', { name: 'Add ip configuration to network interface', exact: true }).click();
				check('nested VMSS IP configuration is editable', await workspace.locator('[data-field-path="network_interface.ip_configuration.subnet_id"] input').count() === 1);
				check('nested booleans keep typed controls', await workspace.locator('[data-field-path="network_interface.ip_configuration.primary"] :is(select, [role=radiogroup])').count() === 1);
			}
			if (viewport.width <= 1100) { await workspace.getByRole('button', { name: 'Context', exact: true }).click(); }
			await workspace.getByRole('tab', { name: 'Variables', exact: true }).click();
			await workspace.getByLabel('Create variable', { exact: true }).click();
			await workspace.getByLabel('Variable name', { exact: true }).waitFor();
			const geometry = await workspace.locator('.variable-configurator').evaluate(element => {
				const header = element.querySelector('.configurator-heading').getBoundingClientRect();
				const body = element.querySelector('.configurator-body');
				const input = element.querySelector('[aria-label="Variable name"]').getBoundingClientRect();
				return { headerBottom: header.bottom, inputTop: input.top, scroll: body.scrollHeight > body.clientHeight, overflow: element.scrollWidth > element.clientWidth + 1 };
			});
			check('variable heading never clips first input ' + label, geometry.inputTop >= geometry.headerBottom && !geometry.overflow);
			check('variable fields have one scrolling region ' + label, geometry.scroll);
			await workspace.locator('.configurator-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
			check('variable save stays reachable ' + label, await workspace.getByRole('button', { name: 'Save variable', exact: true }).isVisible());
			await page.screenshot({ path: path.join(output, `variable-${viewport.width}-${theme}.png`) });
			await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
			await workspace.getByLabel('Close resource details', { exact: true }).click();
			check('closing resource workspace returns focus ' + label, await page.evaluate(() => document.activeElement !== document.body));
			await page.close();
		}
	}
	for (const [provider, type, field] of nestedOnly ? [] : [['aws', 'aws_autoscaling_group', 'max_size'], ['gcp', 'google_compute_instance_template', 'machine_type']]) {
		const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
		await page.addInitScript(() => { window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} }); });
		await page.goto(url);
		await page.waitForFunction(() => window.__posted?.some(message => message.type === 'ready'));
		await send(page, { type: 'graph', graph: graph(type, provider) });
		await page.locator('.react-flow__node[data-id="resource"]').click();
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		await page.locator(`dialog [data-field-path="${field}"] input`).waitFor();
		check(provider + ' hosted placeholder loads real field definitions', await page.locator(`dialog [data-field-path="${field}"] input`).count() === 1);
		await page.close();
	}
	for (const theme of ['light', 'dark']) {
		const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
		page.setDefaultTimeout(15_000);
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
		await page.addInitScript(() => { window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} }); });
		await page.goto(url);
		await page.waitForFunction(() => window.__posted?.some(message => message.type === 'ready'));
		const typeName = 'aws_nested_schema_test';
		await send(page, { type: 'graph', graph: graph(typeName, 'aws'), viewState: { mode: 'visual', theme } });
		await page.locator('.react-flow__node[data-id="resource"]').click();
		await send(page, { type: 'liveSchema', typeName, schema: { kind: 'resource', typeName, providerSource: 'hashicorp/aws', providerVersion: 'test', description: '', docsUrl: '', exampleHcl: '', blocks: [], outputs: [], attributes: [{ name: 'configurations', path: 'configurations', access: 'required', valueType: 'listString', description: 'Nested test configuration.', literalShape: { kind: 'list', minItems: 1, maxItems: 2, element: { kind: 'object', members: { name: { access: 'required', shape: { kind: 'string' } }, ratio: { access: 'optional', description: 'An exact numeric member.', shape: { kind: 'number' } }, enabled: { access: 'optional', shape: { kind: 'bool' } }, id: { access: 'computedOnly', shape: { kind: 'string' } } } } } }] } });
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		const field = page.locator('dialog[open] [data-field-path="configurations"]');
		await field.getByRole('button', { name: 'Add entry to configurations', exact: true }).click();
		await field.locator('details.literal-group').nth(1).locator(':scope > summary').click();
		await field.getByRole('textbox', { name: 'name', exact: true }).fill('example');
		await field.getByLabel('ratio', { exact: true }).fill('1.');
		check('nested numeric drafts retain incomplete decimals ' + theme, await field.getByLabel('ratio', { exact: true }).inputValue() === '1.');
		await field.getByLabel('ratio', { exact: true }).press('End');
		await field.getByLabel('ratio', { exact: true }).pressSequentially('5');
		await field.getByLabel('enabled', { exact: true }).selectOption('true');
		check('computed nested member has no editable control ' + theme, await field.getByLabel('id', { exact: true }).evaluate(element => element.tagName === 'OUTPUT'));
		await field.getByRole('button', { name: 'Edit JSON', exact: true }).click();
		const json = field.getByRole('textbox', { name: 'configurations JSON', exact: true });
		check('nested fields store typed canonical JSON ' + theme, await json.inputValue() === '[{"name":"example","ratio":1.5,"enabled":true}]');
		await json.fill('[{"name":"example","id":"read-only"}]');
		check('bulk JSON cannot bypass computed member checks ' + theme, (await field.locator('.schema-field-error').textContent()).includes('read-only'));
		await page.screenshot({ path: path.join(output, 'nested-members-' + theme + '.png') });
		await page.getByLabel('Close resource details', { exact: true }).click();
		await page.getByLabel('Undo', { exact: true }).click();
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		if (await field.getByRole('button', { name: 'Edit JSON', exact: true }).count()) { await field.getByRole('button', { name: 'Edit JSON', exact: true }).click(); }
		check('nested edit uses the same semantic Undo ' + theme, await field.getByRole('textbox', { name: 'configurations JSON', exact: true }).inputValue() === '[{"name":"example","ratio":1.5,"enabled":true}]');
		await page.close();
	}
	if (!nestedOnly) {
		const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
		page.setDefaultTimeout(20_000);
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
		await page.addInitScript(() => { window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} }); });
		await page.goto(url);
		await page.waitForFunction(() => window.__posted?.some(message => message.type === 'ready'));
		await send(page, { type: 'graph', graph: graph('azurerm_linux_virtual_machine_scale_set', 'azure') });
		await page.locator('.react-flow__node[data-id="resource"]').click();
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		const workspace = page.locator('dialog.resource-workspace[open]');
		await workspace.locator('[data-field-path="sku"] input').waitFor();
		await workspace.locator('.additional-configuration > summary').click();
		await workspace.getByRole('button', { name: 'Configure in Terraform', exact: true }).click();
		await page.waitForFunction(() => window.monaco?.editor?.getModels().length > 0);
		const source = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
		const code = source.replace(/}\s*$/, '  instances = 4\n  dynamic "network_interface" {\n    for_each = var.interfaces\n    content {\n      name = network_interface.value.name\n    }\n  }\n}');
		const editor = workspace.locator('.monaco-editor textarea');
		await editor.press('Control+a'); await page.keyboard.insertText(code); await editor.press('Control+s');
		await workspace.getByRole('button', { name: 'Apply reviewed changes', exact: true }).waitFor();
		check('additional Terraform requires explicit review', await workspace.getByRole('region', { name: 'Review resource Terraform changes' }).count() === 1 || await workspace.locator('.terraform-review').count() === 1);
		check('unapplied code cannot be saved', await workspace.getByRole('button', { name: 'Save main.tf', exact: true }).isDisabled());
		await workspace.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click();
		await workspace.locator('[data-field-path="instances"] input').waitFor();
		check('literal HCL edits return to real form controls', await workspace.locator('[data-field-path="instances"] input').inputValue() === '4');
		check('additional configuration reports its actual persisted state', (await workspace.locator('.additional-configuration').textContent()).includes('Configured in Terraform'));
		check('validation availability is truthful', (await workspace.locator('.schema-check').textContent()).includes('unavailable'));
		await workspace.getByRole('button', { name: 'Configure in Terraform', exact: true }).click();
		await page.waitForFunction(() => window.monaco?.editor?.getModels().length > 0);
		await page.waitForFunction(() => window.monaco.editor.getEditors?.().some(editor => editor.getModel()?.getValue().includes('dynamic "network_interface"')) ?? true);
		const highlighted = await page.evaluate(() => { const editor = window.monaco.editor.getEditors()[0]; const selection = editor.getSelection(); return editor.getModel().getValueInRange(selection); });
		check('Configure in Terraform highlights a uniquely known section', highlighted === 'dynamic "network_interface"');
		await workspace.locator('[data-field-path="sku"] input').fill('Standard_D8_v5');
		await workspace.getByLabel('Close resource details', { exact: true }).click();
		await page.getByLabel('Undo', { exact: true }).click();
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		check('semantic Undo keeps the earlier code configuration', (await page.locator('dialog[open] .additional-configuration').textContent()).includes('Configured in Terraform'));
		await page.screenshot({ path: path.join(output, 'additional-terraform-review.png') });
		await page.getByLabel('Close resource details', { exact: true }).click();
		await page.getByLabel('Undo', { exact: true }).click();
		await page.getByLabel('Open focused resource workspace', { exact: true }).click();
		check('the next Undo removes the single code apply', !(await page.locator('dialog[open] .additional-configuration').textContent()).includes('Configured in Terraform'));
		await page.close();
	}
	if (errors.length) { console.error(JSON.stringify({ errors })); }
	check('zero console and page errors', errors.length === 0);
	console.log(JSON.stringify({ checks: count, errors, output }));
} finally { await browser.close(); }
