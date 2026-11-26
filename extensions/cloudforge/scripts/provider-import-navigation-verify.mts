/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Installed Workbench + owned development extension, stopping before archive selection/import.
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(extension, 'studio/output/provider-import-navigation');
const launch = JSON.parse(readFileSync(path.join(output, 'launch.json'), 'utf8'));
assert.equal(realpathSync(launch.root), realpathSync(output));
assert.equal(realpathSync(launch.extension), realpathSync(extension));
assert.ok(Number.isSafeInteger(launch.port) && launch.port > 0 && launch.port < 65536);
const runtime = process.env.PLAYWRIGHT_DIR;
const require = createRequire(runtime ? path.join(runtime, 'package.json') : import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + launch.port);
const page = browser.contexts()[0].pages().find((candidate: { url(): string }) => candidate.url().startsWith('vscode-file://'));
assert.ok(page, 'owned Workbench exists');
page.setDefaultTimeout(10_000);
const widget = page.locator('.quick-input-widget');
const input = (placeholder: string) => widget.getByPlaceholder(placeholder, { exact: true });
const back = () => widget.getByRole('button', { name: 'Back (Alt+LeftArrow)', exact: true }).click();
const address = () => input('registry.terraform.io/hashicorp/azurerm');
const version = () => input('5.14.0');
const digest = () => input('0123456789abcdef...');
const checks: string[] = [];
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };
try {
	for (let attempt = 0; attempt < 3 && await widget.isVisible(); attempt++) {
		await widget.getByRole('textbox').press('Escape');
		await page.waitForTimeout(150);
	}
	await page.getByRole('button', { name: 'Show All Commands (Control+Shift+P)', exact: true }).click();
	await page.getByRole('textbox', { name: 'Type the name of a command to run.', exact: true }).fill('>CloudForge: Manage Offline Provider Packages');
	await page.getByRole('option', { name: /^CloudForge: Manage Offline Provider Packages/ }).click();
	const importOption = () => widget.getByRole('option', { name: /^archive Import Provider Archive/ });
	await importOption().click();
	await address().waitFor();
	check('native import starts at step 1/5 with no Back action', (await widget.textContent()).includes('(1/5)') && await widget.getByRole('button', { name: 'Back (Alt+LeftArrow)', exact: true }).count() === 0);
	await address().fill('registry.terraform.io/hashicorp/aws');
	await page.keyboard.press('Enter');
	await version().fill('6.73.0');
	await back();
	check('Back restores the entered provider address', await address().inputValue() === 'registry.terraform.io/hashicorp/aws');
	await page.keyboard.press('Enter');
	check('Back retains an edited version before it was accepted', await version().inputValue() === '6.73.0');
	await page.keyboard.press('Enter');
	await widget.getByRole('option', { name: /^linux_amd64,/ }).click();
	await digest().fill('unfinished digest');
	await back();
	await input('Choose the archive target platform').waitFor();
	await page.keyboard.press('Enter');
	check('returning through Platform restores the unfinished digest', await digest().inputValue() === 'unfinished digest');
	await page.keyboard.press('Enter');
	await widget.getByText('Enter the verified 64-character SHA-256 hex digest for the provider .zip archive.', { exact: true }).waitFor();
	check('invalid digest stays on its step with validation feedback', await digest().isVisible() && (await widget.textContent()).includes('Enter the verified 64-character SHA-256'));
	await digest().fill('A'.repeat(64));
	await page.keyboard.press('Enter');
	await widget.getByRole('option', { name: /Choose Archive and Import/ }).waitFor();
	let review = await widget.textContent();
	check('review shows the retained Linux platform and full package identity', review.includes('registry.terraform.io/hashicorp/aws') && review.includes('6.73.0') && review.includes('linux_amd64'));
	check('review shows normalized expected digest', review.includes('a'.repeat(64)) && review.includes('(5/5)'));
	await back();
	check('Back from review preserves digest text', await digest().inputValue() === 'A'.repeat(64));
	await back();
	await input('Choose the archive target platform').waitFor();
	await back();
	await version().fill('8.10.0');
	await back();
	await address().fill('registry.terraform.io/hashicorp/google');
	await page.keyboard.press('Enter');
	check('corrected version survives a second Back traversal', await version().inputValue() === '8.10.0');
	await page.keyboard.press('Enter');
	await input('Choose the archive target platform').waitFor();
	await page.keyboard.press('Enter');
	await digest().fill('B'.repeat(64));
	await page.keyboard.press('Enter');
	await widget.getByRole('option', { name: /Choose Archive and Import/ }).waitFor();
	review = await widget.textContent();
	check('review refreshes all corrected values together', review.includes('registry.terraform.io/hashicorp/google') && review.includes('8.10.0') && review.includes('linux_amd64') && review.includes('b'.repeat(64)) && !review.includes('hashicorp/aws'));
	await page.screenshot({ path: path.join(output, 'review.png') });
	await page.keyboard.press('Escape');
	await importOption().waitFor();
	check('Escape from review returns to the manager', await importOption().isVisible());
	await importOption().click();
	check('starting a fresh import does not reuse the cancelled draft', await address().inputValue() === 'registry.terraform.io/hashicorp/azurerm');
	await page.screenshot({ path: path.join(output, 'address.png') });
	await page.keyboard.press('Escape');
	await importOption().waitFor();
	check('Escape at the first step returns without importing', await importOption().isVisible());
	await page.keyboard.press('Escape');
	writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, installedDevelopmentExtension: true, archiveImportExecuted: false }, null, 2));
	console.log(`${checks.length}/${checks.length} installed navigation checks passed`);
} finally {
	await browser.close();
}
