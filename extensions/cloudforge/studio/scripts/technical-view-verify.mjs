/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
let chromium;
for (const root of [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url]) {
	for (const name of ['playwright', 'playwright-core']) { try { chromium = createRequire(root)(name).chromium; break; } catch { /* Next installed runtime. */ } }
	if (chromium) { break; }
}
assert.ok(chromium, 'Set PLAYWRIGHT_DIR to an installed runtime.');
const url = process.argv[2]; assert.ok(url, 'Pass an owned preview URL.');
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
const quick = process.argv.includes('--quick');
const output = 'output/playwright/technical-view'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
const results = []; const browserErrors = [];
try {
	for (const viewport of (quick ? [{ width: 1360, height: 860 }] : [{ width: 1360, height: 860 }, { width: 1024, height: 768 }])) {
		for (const theme of (quick ? ['light'] : ['light', 'dark'])) {
			const page = await browser.newPage({ viewport }); page.setDefaultTimeout(15_000);
			page.on('pageerror', error => browserErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') { browserErrors.push(message.text()); } });
			await page.goto(url);
			const pass = name => { results.push({ name, width: viewport.width, theme }); console.log(`PASS ${name} ${viewport.width} ${theme}`); };
			const graph = async () => {
				await page.getByLabel('Export architecture', { exact: true }).click();
				const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Graph JSON', exact: true }).click();
				const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream) { chunks.push(chunk); }
				await page.getByLabel('Export architecture', { exact: true }).click();
				return JSON.parse(Buffer.concat(chunks).toString('utf8'));
			};
			const settle = async () => page.waitForFunction(() => {
				const signature = [...document.querySelectorAll('.react-flow__node')].map(node => node.dataset.id + ':' + node.style.transform + ':' + node.offsetWidth + ':' + node.offsetHeight).join('|');
				if (window.__spacingSignature !== signature) { window.__spacingSignature = signature; window.__spacingAt = performance.now(); return false; }
				return performance.now() - window.__spacingAt > 180;
			});
			const view = async () => { if (!(await page.locator('.canvas-options').getAttribute('open'))) { const open = await page.locator('.canvas-options').evaluate(element => element.open); if (!open) { await page.locator('.canvas-options > summary').click(); } } };
			const closeView = async () => { if (await page.locator('.canvas-options').evaluate(element => element.open)) { await page.locator('.canvas-options > summary').click(); } };
			const hideInspector = async () => { if (await page.getByLabel('Toggle resource inspector', { exact: true }).getAttribute('aria-expanded') === 'true') { await page.getByLabel('Toggle resource inspector', { exact: true }).click(); } };
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Close resource library', { exact: true }).click(); await hideInspector();
			assert.equal(await page.getByLabel('Undo', { exact: true }).isDisabled(), true);
			await page.locator('.react-flow__node[data-id="subnet"] .resource-container-heading').click();
			await page.locator('main.canvas').focus(); await page.keyboard.press('Control+d');
			await page.waitForFunction(() => document.querySelector('.shell-resources')?.textContent?.includes('12') || document.querySelectorAll('.react-flow__node-resource').length >= 12);
			await page.getByLabel('Fit architecture to view').click(); await hideInspector(); await settle();
			await page.locator('main.canvas').focus(); await page.keyboard.press('Escape');
			await page.locator('.react-flow__node[data-id="vm"] .resource-node-heading img').click();
			await page.locator('main.canvas').focus();
			for (let index = 0; index < 7; index++) { await page.keyboard.press('Control+d'); }
			await hideInspector();
			const original = await graph(); assert.equal(original.resources.length, 19);
			await page.getByRole('button', { name: 'Configuration', exact: true }).click(); await hideInspector();
			await view(); assert.equal(await page.getByLabel('Technical layout', { exact: true }).inputValue(), 'spaced'); await page.getByLabel('Alignment guides', { exact: true }).uncheck(); await page.getByLabel('Include diagram annotations', { exact: true }).uncheck(); await closeView();
			await page.getByLabel('Fit architecture to view').click(); await settle();
			const boxes = await page.locator('.react-flow__node-resource').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { id: node.dataset.id, x: box.x, y: box.y, width: box.width, height: box.height }; }));
			assert.equal(boxes.length, 19, 'all projected resources are measured and visible after fit');
			const ancestorIds = id => { const seen = []; let resource = original.resources.find(resource => resource.id === id); while (resource) { const parent = resource.visualParentId === undefined ? resource.parentId : resource.visualParentId; if (!parent || seen.includes(parent)) { break; } seen.push(parent); resource = original.resources.find(resource => resource.id === parent); } return seen; };
			for (const first of boxes) {
				for (const second of boxes.filter(box => box.id !== first.id)) {
					if (ancestorIds(first.id).includes(second.id) || ancestorIds(second.id).includes(first.id)) { continue; }
					assert.ok(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1 || first.y + first.height <= second.y + 1 || second.y + second.height <= first.y + 1, first.id + ' overlaps ' + second.id);
				}
				const parentId = ancestorIds(first.id)[0]; if (!parentId) { continue; } const parent = boxes.find(box => box.id === parentId);
				assert.ok(first.x > parent.x && first.y > parent.y && first.x + first.width < parent.x + parent.width && first.y + first.height < parent.y + parent.height, first.id + ' is contained');
			}
			await page.locator('main.canvas').focus(); await page.keyboard.press('Escape');
			await page.waitForFunction(() => [...document.querySelectorAll('.resource-node img, .resource-container img')].every(image => image.complete && image.naturalWidth));
			await page.screenshot({ path: path.join(output, `spaced-19-${viewport.width}-${theme}.png`) });
			assert.deepEqual(await graph(), original, 'switching changes no architecture data'); pass('19 nested resources have no card overlaps');

			await view(); await page.getByRole('button', { name: 'Space resources', exact: true }).click(); await closeView(); await settle();
			await view(); await page.getByLabel('Technical layout', { exact: true }).selectOption('design'); await closeView();
			await page.getByRole('button', { name: 'Architecture', exact: true }).click(); await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await view(); await page.getByLabel('Technical layout', { exact: true }).selectOption('spaced'); await closeView(); await settle();
			assert.deepEqual(await graph(), original);
			await page.getByLabel('Undo', { exact: true }).click(); assert.equal((await graph()).resources.length, 18, 'one Undo removes the last copy, not a layout event');
			await page.getByLabel('Redo', { exact: true }).click(); assert.deepEqual(await graph(), original); pass('layout stays outside semantic history');

			await page.getByLabel('Fit architecture to view').click(); await settle();
			const vm = page.locator('.react-flow__node[data-id="vm"]'); const before = await graph();
			const cluster = page.locator('.react-flow__node[data-id="cluster"]');
			const header = await cluster.locator('.resource-node-heading').boundingBox();
			await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2); await page.mouse.down(); await page.mouse.move(header.x + header.width / 2 - 240, header.y + header.height / 2 + 160, { steps: 8 }); await page.mouse.up();
			await cluster.focus();
			for (const key of ['ArrowRight', 'Shift+ArrowDown', 'Delete', 'Control+d', 'Control+v', 'Control+z']) { await page.keyboard.press(key); }
			assert.equal(await page.locator('.resource-node.technical input, .resource-container.technical input').count(), 0, 'graph cards do not expose editors');
			assert.equal(await page.locator('.react-flow__resize-control').count(), 0, 'graph has no design resize handles');
			assert.equal(await page.getByLabel('Connect elements', {exact:true}).count(), 0);
			await cluster.click({ button: 'right' });
			assert.equal(await page.getByRole('menuitem', { name: /Duplicate|Delete|Paste|Group selection/ }).count(), 0);
			await page.keyboard.press('Escape');
			assert.deepEqual(await graph(), before, 'AKS drag and authoring shortcuts leave the entire architecture unchanged');
			await page.getByRole('button', { name: 'Architecture', exact: true }).click(); assert.deepEqual(await graph(), before);
			pass('AKS graph drag and mutation gestures cannot change the project');

			await page.getByRole('button', { name: 'Configuration', exact: true }).click(); await page.getByLabel('Fit architecture to view').click(); await settle();
			await vm.getByLabel('Inspect relationships for vm-application', { exact: true }).click();
			const workspace = page.locator('dialog.resource-workspace');
			const picker = workspace.getByLabel('Choose resource reference for network_interface_ids', { exact: true }); await picker.click();
			await page.getByRole('button', { name: /^Reference azurerm_network_interface\.nic-application\.id$/, exact: true }).click(); await page.getByRole('button', { name: 'Done (1 selected)', exact: true }).click();
			const context = workspace.getByRole('button', { name: 'Context', exact: true }); if (await context.isVisible()) { await context.click(); }
			await workspace.getByRole('tab', { name: 'Connections', exact: true }).click();
			assert.ok((await workspace.locator('.relationship-context').innerText()).includes('Attachment'));
			await workspace.locator('.relationship-evidence summary').filter({ hasText: 'network_interface_ids' }).click();
			assert.ok((await workspace.locator('.relationship-context').innerText()).includes('Attach NICs to a VM'));
			await workspace.getByText('Provider investigation guide', { exact: true }).click();
			assert.ok((await workspace.locator('.provider-investigation').innerText()).includes('Guest collection'));
			await page.screenshot({ path: path.join(output, `relationship-context-${viewport.width}-${theme}.png`) });
			await workspace.getByLabel('Close resource details', { exact: true }).click(); pass('field-evidenced attachment and provider context');
			await page.emulateMedia({ reducedMotion: 'reduce' });
			assert.ok(await page.locator('.infrastructure-dependency path').evaluateAll(paths => paths.every(path => getComputedStyle(path).animationName === 'none')));
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			assert.ok(await page.locator('.studio').evaluate((element, theme) => element.classList.contains('theme-' + theme), theme));
			pass('reduced motion, theme and viewport boundaries');
			await page.close();
		}
	}
	assert.deepEqual(browserErrors, []);
	writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks: results.length, results, browserErrors }, null, 2));
	console.log(JSON.stringify({ checks: results.length, browserErrors }));
} finally { await browser.close(); }
