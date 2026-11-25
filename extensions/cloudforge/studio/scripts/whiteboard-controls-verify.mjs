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

			await page.reload();
			await page.getByLabel('Close resource library', { exact: true }).click();
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Draw freehand', { exact: true }).click();
			await page.getByLabel('Pen options', { exact: true }).click();
			await page.getByLabel('New stroke colour').fill('#1274ab');
			await page.getByLabel('New stroke weight').selectOption('8');
			assert.equal(await page.getByLabel('Undo', { exact: true }).isEnabled(), false, 'pen presets do not enter semantic history');
			await page.screenshot({ path: path.join(output, `pen-${viewport.width}-${theme}.png`) });
			await page.getByLabel('Close pen options', { exact: true }).click();
			await page.getByLabel('Select tool', { exact: true }).click();
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await page.getByLabel('Draw freehand', { exact: true }).click();
			await page.getByLabel('Pen options', { exact: true }).click();
			assert.equal(await page.getByLabel('New stroke weight').inputValue(), '8', 'pen preset survives tool/renderer changes');
			assert.equal(await page.getByLabel('New stroke colour').inputValue(), '#1274ab');
			await page.getByLabel('Close pen options', { exact: true }).click();
			const canvas = await page.locator('main.canvas').boundingBox();
			await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
			await page.mouse.down();
			await page.mouse.move(canvas.x + canvas.width / 2 + 100, canvas.y + canvas.height / 2 + 40, { steps: 8 });
			await page.mouse.up();
			await page.keyboard.press('Escape');
			const stroke = page.locator('.board-ink-geometry path');
			await stroke.waitFor();
			assert.equal(await stroke.getAttribute('stroke'), '#1274ab');
			assert.equal(await stroke.getAttribute('stroke-width'), '8');
			await page.getByLabel('Undo', { exact: true }).click();
			assert.equal(await stroke.count(), 0, 'one Undo removes the stroke');
			assert.equal(await page.getByLabel('Undo', { exact: true }).isEnabled(), false, 'no preset change in history');
			await page.getByLabel('Redo', { exact: true }).click();
			assert.equal(await stroke.getAttribute('stroke-width'), '8');
			assert.deepEqual(errors, [], 'no browser errors');
			console.log(`PASS pen ${viewport.width}×${viewport.height} ${theme} (0 browser errors)`);
			checks++;

			await page.reload();
			await page.getByLabel('Close resource library', { exact: true }).click();
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Canvas zoom', { exact: true }).selectOption({ label: '70%' });
			await page.locator('main.canvas').focus();
			await page.keyboard.press('n');
			const firstId = await page.locator('.react-flow__node.selected').getAttribute('data-id');
			for (let index = 0; index < 26; index++) { await page.keyboard.press('Shift+ArrowLeft'); }
			for (let index = 0; index < 16; index++) { await page.keyboard.press('Shift+ArrowUp'); }
			await page.keyboard.press('n');
			const secondId = await page.locator('.react-flow__node.selected').getAttribute('data-id');
			await page.locator(`.react-flow__node[data-id="${firstId}"]`).click({ modifiers: ['Control'] });
			const selected = page.locator('.react-flow__node.selected');
			assert.equal(await selected.count(), 2);
			const original = await selected.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.id, width: node.style.width, height: node.style.height, transform: node.style.transform })));
			const frame = page.locator('.selection-resize');
			const fixedPoint = (box, corner) => ({ x: box.x + (corner.endsWith('left') ? box.width : 0), y: box.y + (corner.startsWith('top') ? box.height : 0) });
			for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
				assert.equal(await page.locator('.selection-resize-handle').count(), 4);
				const before = await frame.boundingBox();
				const handle = await page.locator(`.selection-resize-handle[data-corner="${corner}"]`).boundingBox();
				const x = handle.x + handle.width / 2; const y = handle.y + handle.height / 2;
				const dx = before.width * (corner.endsWith('left') ? -0.15 : 0.15); const dy = before.height * (corner.startsWith('top') ? -0.15 : 0.15);
				await page.mouse.move(x, y); await page.mouse.down();
				await page.mouse.move(x + dx, y + dy, { steps: 6 });
				assert.equal(await frame.getAttribute('data-active'), 'true', 'group handle receives the gesture');
				if (corner === 'top-left') { await page.screenshot({ path: path.join(output, `corners-${viewport.width}-${theme}.png`) }); }
				await page.mouse.up();
				await page.waitForTimeout(100);
				const after = await frame.boundingBox();
				const a = fixedPoint(before, corner); const b = fixedPoint(after, corner);
				assert.ok(Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1, `${corner}: opposite corner stays fixed`);
				assert.ok(after.width > before.width && after.height > before.height, `${corner}: selection grew`);
				await page.locator('main.canvas').focus(); await page.keyboard.press('Control+z');
				const restored = await selected.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.id, width: node.style.width, height: node.style.height, transform: node.style.transform })));
				assert.deepEqual(restored, original, `${corner}: one Undo restores every dimension and position`);
			}
			assert.ok(firstId !== secondId);
			assert.deepEqual(errors, [], 'no browser errors');
			console.log(`PASS four corners ${viewport.width}×${viewport.height} ${theme} (0 browser errors)`);
			checks++;

			await page.reload();
			await page.getByLabel('Close resource library', { exact: true }).click();
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.locator('main.canvas').focus(); await page.keyboard.press('Control+a');
			const checkFrame = async technical => {
				await page.waitForTimeout(200);
				const boxes = await page.locator('.react-flow__node.selected').evaluateAll((nodes, technical) => nodes.filter(node => !node.querySelector('.resource-container') && (!technical || node.querySelector('.board-item'))).map(node => {
					const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
				}), technical);
				assert.ok(boxes.length > 0);
				const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
				const expected = { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
				const actual = await page.locator('.selection-resize').boundingBox();
				for (const key of ['x', 'y', 'width', 'height']) { assert.ok(Math.abs(actual[key] - expected[key]) < 1, `${key}: frame uses only eligible elements`); }
			};
			await checkFrame(false);
			await page.screenshot({ path: path.join(output, `eligibility-${viewport.width}-${theme}.png`) });
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await checkFrame(true);
			await page.getByRole('button', { name: 'Architecture', exact: true }).click();
			await page.getByLabel('Fit architecture to view').click();
			await page.locator('main.canvas').focus(); await page.keyboard.press('Escape');
			await page.getByRole('group', { name: 'stplatformdata, Storage account', exact: true }).click();
			await page.getByRole('group', { name: 'rg-production, Resource group', exact: true }).locator('.resource-container-heading').click({ modifiers: ['Control'] });
			assert.equal(await page.locator('.react-flow__node.selected').count(), 2);
			await checkFrame(false);
			assert.equal(await page.locator('.selection-resize-handle').count(), 4, 'one eligible icon plus a container still has usable handles');
			await page.getByLabel('Resize selection', { exact: true }).selectOption('2');
			await page.getByLabel('Resize selection', { exact: true }).selectOption('2');
			const clampedBefore = await page.locator('.selection-resize').boundingBox();
			const clampedHandle = await page.locator('.selection-resize-handle[data-corner="bottom-right"]').boundingBox();
			await page.mouse.move(clampedHandle.x + clampedHandle.width / 2, clampedHandle.y + clampedHandle.height / 2);
			await page.mouse.down();
			await page.mouse.move(clampedHandle.x + clampedHandle.width / 2 + 100, clampedHandle.y + clampedHandle.height / 2 + 100, { steps: 6 });
			const clampedPreview = await page.locator('.selection-resize').boundingBox();
			for (const key of ['x', 'y', 'width', 'height']) { assert.ok(Math.abs(clampedPreview[key] - clampedBefore[key]) < 1, 'an icon at its maximum does not overstate the live resize'); }
			await page.mouse.up();
			const clampedCommit = await page.locator('.selection-resize').boundingBox();
			for (const key of ['x', 'y', 'width', 'height']) { assert.ok(Math.abs(clampedPreview[key] - clampedCommit[key]) < 1, 'clamped preview agrees with release'); }
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			assert.equal(await page.locator('.selection-resize').count(), 0, 'a selection with no eligible target has no resize frame');
			assert.deepEqual(errors, [], 'no browser errors');
			console.log(`PASS resize eligibility ${viewport.width}×${viewport.height} ${theme} (0 browser errors)`);
			checks++;
			await page.close();

			const hosted = await browser.newPage({ viewport });
			hosted.setDefaultTimeout(10_000);
			hosted.on('pageerror', error => errors.push(error.message));
			hosted.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
			await hosted.addInitScript(() => {
				window.acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
			});
			await hosted.goto(url);
			const graph = (architectureId, architectureName, revision) => ({ workspaceId: 'whiteboard-check', architectureId, architectureName, sourceRevision: revision.repeat(64), status: 'complete', nodes: [{ id: 'group', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'rg_main', label: 'rg_main', hasSource: true }], edges: [], diagnostics: [] });
			const sendGraph = async snapshot => {
				await hosted.evaluate(({ snapshot, theme }) => window.postMessage({ type: 'graph', graph: snapshot, viewState: { theme, inspectorOpen: false } }, '*'), { snapshot, theme });
				await hosted.waitForTimeout(200);
			};
			await sendGraph(graph('architecture-a', 'Hosted platform', 'a'));
			const name = hosted.getByLabel('Architecture name', { exact: true });
			assert.equal(await name.inputValue(), 'Hosted platform');
			await name.fill('Locally renamed platform');
			await sendGraph(graph('architecture-a', 'Hosted platform', 'b'));
			assert.equal(await name.inputValue(), 'Locally renamed platform', 'refresh preserves local name');
			await hosted.screenshot({ path: path.join(output, `rename-${viewport.width}-${theme}.png`) });
			await hosted.getByLabel('Undo', { exact: true }).click();
			assert.equal(await name.inputValue(), 'Hosted platform');
			await hosted.getByLabel('Redo', { exact: true }).click();
			assert.equal(await name.inputValue(), 'Locally renamed platform');
			await sendGraph(graph('architecture-b', 'Other architecture', 'c'));
			assert.equal(await name.inputValue(), 'Other architecture', 'architecture switch takes the service name');
			assert.equal(await hosted.getByLabel('Undo', { exact: true }).isEnabled(), false);
			assert.deepEqual(errors, [], 'no browser errors');
			console.log(`PASS hosted rename ${viewport.width}×${viewport.height} ${theme} (0 browser errors)`);
			checks++;
			await hosted.close();
		}
	}
} finally {
	await browser.close();
}
console.log(`${checks}/${checks} browser scenarios passed`);
