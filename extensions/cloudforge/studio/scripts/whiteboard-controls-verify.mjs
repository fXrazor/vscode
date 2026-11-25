/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Same browser dependency convention as hosted-refresh-verify.mjs; no Studio dependency changes.
const roots = [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url];
let chromium;
for (const root of roots) {
	for (const name of ['playwright', 'playwright-core']) {
		try { chromium = createRequire(root)(name).chromium; break; } catch { /* Try the next location. */ }
	}
	if (chromium) { break; }
}
assert.ok(chromium, 'Set PLAYWRIGHT_DIR to a folder with playwright or playwright-core installed.');
const url = process.argv[2];
assert.ok(url, 'Usage: node scripts/whiteboard-controls-verify.mjs <preview-url> [--channel=msedge]');
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
const output = 'output/playwright/whiteboard-controls';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
let checks = 0;
try {
	for (const viewport of [{ width: 1360, height: 860 }, { width: 1024, height: 768 }]) {
		for (const theme of ['light', 'dark']) {
			const page = await browser.newPage({ viewport });
			page.setDefaultTimeout(10_000);
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
			await page.goto(url);
			await page.getByLabel('Close resource library', { exact: true }).click();
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.locator('main.canvas').focus();
			await page.keyboard.press('n');
			const note = page.locator('.react-flow__node.selected').filter({ has: page.locator('.board-item.note') });
			await note.waitFor();
			assert.equal(await note.locator('.react-flow__resize-control').count(), 8, 'upright note has resize controls');
			await page.getByRole('button', { name: 'Appearance', exact: true }).click();
			await page.getByLabel('Element rotation in degrees', { exact: true }).fill('45');
			assert.equal(await note.locator('.react-flow__resize-control').count(), 0, 'rotated note has no misleading frame');
			await page.getByLabel('Element width', { exact: true }).fill('300');
			assert.equal(await note.evaluate(node => parseFloat(node.style.width)), 300);
			assert.equal(await note.locator('.board-item').evaluate(node => node.style.rotate), '45deg');
			const popover = await page.locator('.context-popover').boundingBox();
			const heading = await page.locator('.context-popover > header').boundingBox();
			assert.ok(heading.y >= popover.y && heading.y + heading.height <= popover.y + popover.height, 'Appearance heading and Close remain visible when dimensions scroll into view');
			await page.screenshot({ path: path.join(output, `rotation-${viewport.width}-${theme}.png`) });
			await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
			await page.locator('main.canvas').focus();
			await page.keyboard.press('Control+z');
			assert.equal(await note.evaluate(node => parseFloat(node.style.width)), 220, 'one Undo restores the dimension');
			assert.equal(await note.locator('.board-item').evaluate(node => node.style.rotate), '45deg');
			await page.keyboard.press('Control+z');
			assert.equal(await note.locator('.react-flow__resize-control').count(), 8, 'another Undo restores rotation and handles');
			assert.deepEqual(errors, [], 'no browser errors');
			console.log(`PASS rotation ${viewport.width}×${viewport.height} ${theme} (0 browser errors)`);
			checks++;
			await page.close();
		}
	}
} finally {
	await browser.close();
}
console.log(`${checks}/${checks} browser scenarios passed`);
