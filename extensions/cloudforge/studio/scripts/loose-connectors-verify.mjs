/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const roots = [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url];
let chromium;
for (const root of roots) {
	for (const name of ['playwright', 'playwright-core']) {
		try { chromium = createRequire(root)(name).chromium; break; } catch { /* Next installed runtime. */ }
	}
	if (chromium) { break; }
}
assert.ok(chromium, 'Set PLAYWRIGHT_DIR to an installed Playwright runtime.');
const url = process.argv[2];
assert.ok(url, 'Usage: node scripts/loose-connectors-verify.mjs <preview-url> [--channel=msedge]');
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
const output = 'output/playwright/loose-connectors';
mkdirSync(output, { recursive: true });
const graph = revision => ({ workspaceId: 'ws-endpoints', architectureId: 'endpoints', architectureName: 'Endpoint checks', sourceRevision: revision.repeat(64), status: 'complete', nodes: [], edges: [], diagnostics: [] });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
let checks = 0;
try {
	for (const viewport of [{ width: 1360, height: 860 }, { width: 1024, height: 768 }]) {
		for (const theme of ['light', 'dark']) {
			const page = await browser.newPage({ viewport });
			await page.context().addInitScript(() => { window.print = () => { window.__printRequested = true; }; });
			page.setDefaultTimeout(10_000);
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
			await page.addInitScript(() => {
				window.__posted = [];
				window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} });
			});
			await page.goto(url);
			await page.getByLabel('Close resource library', { exact: true }).click();
			if (await page.getByLabel('Toggle resource inspector', { exact: true }).getAttribute('aria-expanded') === 'true') { await page.getByLabel('Toggle resource inspector', { exact: true }).click(); }
			await page.evaluate(data => window.postMessage({ type: 'graph', graph: data }, '*'), graph('a'));
			await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 0);
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Canvas zoom', { exact: true }).selectOption({ label: '100%' });
			await page.locator('main.canvas').focus(); await page.keyboard.press('n');
			const source = page.locator('.react-flow__node.selected');
			await source.waitFor();
			const sourceId = await source.getAttribute('data-id');
			for (let index = 0; index < 18; index++) { await page.keyboard.press('Shift+ArrowLeft'); }
			for (let index = 0; index < 10; index++) { await page.keyboard.press('Shift+ArrowUp'); }
			const canvas = await page.locator('main.canvas').boundingBox();
			const port = await source.getByLabel('Drawing connection output', { exact: true }).boundingBox();
			const end = { x: canvas.x + canvas.width - 100, y: canvas.y + canvas.height - 180 };
			await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2); await page.mouse.down();
			await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
			await page.getByRole('menuitem', { name: 'Keep loose end', exact: true }).click();
			const endGrip = page.getByLabel('End connection endpoint', { exact: true });
			await endGrip.waitFor();
			assert.equal(await page.locator('.react-flow__node').count(), 1, 'loose end creates no ghost resource');
			const linkId = await page.locator('.loose-connection').getAttribute('data-id');
			const exportGraph = async () => {
				await page.getByLabel('Export architecture', { exact: true }).click();
				const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Graph JSON', exact: true }).click();
				const file = await download; const json = JSON.parse(readFileSync(await file.path(), 'utf8'));
				await page.getByLabel('Export architecture', { exact: true }).click(); return json;
			};
			const original = (await exportGraph()).connections[0];
			assert.equal(original.source.elementId, sourceId); assert.equal(original.target.kind, 'point');
			const dragEnd = async (dx, dy, cancel = false) => {
				const box = await endGrip.boundingBox();
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
				await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
				if (cancel) { await page.keyboard.press('Escape'); }
				await page.mouse.up();
			};
			await dragEnd(-70, 50);
			const moved = (await exportGraph()).connections[0];
			assert.notDeepEqual(moved.target, original.target);
			await page.getByLabel('Undo', { exact: true }).click();
			assert.deepEqual((await exportGraph()).connections[0], original, 'endpoint drag is one Undo');
			await page.getByLabel('Redo', { exact: true }).click();
			await dragEnd(-25, -30, true);
			assert.deepEqual((await exportGraph()).connections[0], moved, 'cancelled drag makes no edit');
			await page.getByLabel('Undo', { exact: true }).click();
			assert.deepEqual((await exportGraph()).connections[0], original, 'cancelled drag adds no history');
			await page.getByLabel('Redo', { exact: true }).click();
			await page.evaluate(data => window.postMessage({ type: 'graph', graph: data }, '*'), graph('b'));
			await page.waitForFunction(() => document.querySelector('.shell-preview')?.textContent?.startsWith('rev b'));
			assert.deepEqual((await exportGraph()).connections[0], moved, 'hosted refresh preserves exact endpoint coordinates');
			await page.getByLabel('Undo', { exact: true }).click();
			assert.deepEqual((await exportGraph()).connections[0], original, 'endpoint Undo survives hosted refresh');
			await page.getByLabel('Redo', { exact: true }).click();
			console.log(`PASS loose endpoint / cancel / history / refresh ${viewport.width} ${theme}`); checks++;

			await page.locator('.connection-endpoint-fields > summary').click();
			await page.getByLabel('End endpoint X', { exact: true }).fill('-180');
			await page.getByLabel('End endpoint X', { exact: true }).press('Enter');
			await page.getByLabel('End endpoint Y', { exact: true }).fill('-90');
			await page.getByLabel('End endpoint Y', { exact: true }).press('Enter');
			await page.getByLabel('Connection label', { exact: true }).fill('Loose <endpoint> & route');
			await page.getByRole('radiogroup', { name: 'Connection path' }).getByRole('radio', { name: 'Curve' }).click();
			await page.getByLabel('Connection stroke style', { exact: true }).selectOption('dotted');
			await page.locator('main.canvas').focus(); await page.keyboard.press('f');
			await page.locator('.connection-endpoint-fields > summary').click();
			await page.screenshot({ path: path.join(output, `endpoints-${viewport.width}-${theme}.png`) });
			const focusedGrip = await endGrip.boundingBox();
			assert.ok(focusedGrip.x >= canvas.x && focusedGrip.x + focusedGrip.width <= canvas.x + canvas.width && focusedGrip.y >= canvas.y, 'focus includes distant loose point');
			await endGrip.focus(); await page.keyboard.press('Shift+ArrowRight');
			assert.equal((await exportGraph()).connections[0].target.position.x, -170, 'keyboard nudge uses world units');
			await page.locator('main.canvas').focus(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
			const copied = await exportGraph();
			assert.equal(copied.resources.length, 0); assert.equal(copied.items.length, 1); assert.equal(copied.connections.length, 2);
			const standalone = copied.connections.find(link => link.id !== linkId);
			assert.equal(standalone.source.kind, 'point'); assert.equal(standalone.target.kind, 'point');
			await page.locator('main.canvas').focus(); await page.keyboard.press('Delete');
			assert.equal((await exportGraph()).connections.length, 1);
			await page.getByLabel('Undo', { exact: true }).click();
			assert.equal((await exportGraph()).connections.length, 2);
			await page.getByLabel('Redo', { exact: true }).click();
			console.log(`PASS endpoints / focus / copy / delete ${viewport.width} ${theme}`); checks++;

			await page.locator(`.loose-connection[data-id="${linkId}"]`).focus(); await page.keyboard.press('Enter');
			await page.locator('.connection-endpoint-fields > summary').click();
			await page.getByLabel('Start endpoint target', { exact: true }).selectOption('');
			assert.equal((await exportGraph()).connections[0].source.kind, 'point', 'detach start endpoint');
			await page.getByLabel('Start endpoint target', { exact: true }).selectOption(sourceId);
			await page.getByLabel('Start endpoint port', { exact: true }).selectOption('input');
			assert.equal((await exportGraph()).connections[0].source.port, 'input');
			await page.getByLabel('Start endpoint port', { exact: true }).selectOption('output');
			await page.getByLabel('Close connection tools', { exact: true }).click();
			await page.locator('main.canvas').focus(); await page.keyboard.press('n');
			const secondId = await page.locator('.react-flow__node.selected').getAttribute('data-id');
			for (let index = 0; index < 23; index++) { await page.keyboard.press('Shift+ArrowRight'); }
			await page.getByLabel('Fit architecture to view', { exact: true }).click();
			await page.locator(`.loose-connection[data-id="${linkId}"]`).focus(); await page.keyboard.press('Enter');
			const second = await page.locator(`.react-flow__node[data-id="${secondId}"] .board-item`).boundingBox();
			const grip = await endGrip.boundingBox();
			await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
			await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 10 }); await page.mouse.up();
			const reconnected = (await exportGraph()).connections[0];
			assert.equal(reconnected.id, linkId); assert.equal(reconnected.target.elementId, secondId); assert.equal(reconnected.label, 'Loose <endpoint> & route');
			await page.getByLabel('Close connection tools', { exact: true }).click();
			assert.equal(await page.locator('.loose-connection').count(), 0, 'ordinary element endpoints return to native edge renderer');
			assert.equal(await page.locator('.react-flow__node').count(), 2);
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await page.getByRole('button', { name: 'Architecture', exact: true }).click();
			assert.equal(await page.locator('.studio').evaluate(element => element.classList.contains('theme-dark') ? 'dark' : 'light'), theme, 'renderer keeps theme');
			assert.deepEqual((await exportGraph()).connections[0], reconnected, 'renderer switch preserves typed endpoints');
			console.log(`PASS detach / physical ports / reconnect / renderer ${viewport.width} ${theme}`); checks++;

			await page.locator(`.react-flow__edge[data-id="${linkId}"]`).focus(); await page.keyboard.press('Enter');
			await page.locator('.connection-endpoint-fields > summary').click();
			await page.getByLabel('End endpoint target', { exact: true }).selectOption('');
			await page.getByLabel('End endpoint X', { exact: true }).fill('-700'); await page.getByLabel('End endpoint X', { exact: true }).press('Enter');
			await page.getByLabel('End endpoint Y', { exact: true }).fill('-500'); await page.getByLabel('End endpoint Y', { exact: true }).press('Enter');
			await page.getByLabel('Export architecture', { exact: true }).click(); await page.getByRole('button', { name: 'SVG image', exact: true }).click();
			await page.waitForFunction(() => window.__posted.some(item => item.type === 'exportArtifact' && item.format === 'svg'));
			const svg = await page.evaluate(() => window.__posted.findLast(item => item.type === 'exportArtifact' && item.format === 'svg').content);
			assert.ok(svg.includes('Loose &lt;endpoint&gt; &amp; route'));
			const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
			assert.ok(viewBox[0] < -700 && viewBox[1] < -500 && viewBox[0] + viewBox[2] > -700, 'export encloses loose point');
			writeFileSync(path.join(output, `endpoint-${viewport.width}-${theme}.svg`), svg);
			if (viewport.width === 1360 && theme === 'light') {
				await page.getByRole('button', { name: 'PNG image', exact: true }).click();
				await page.waitForFunction(() => window.__posted.some(item => item.type === 'exportArtifact' && item.format === 'png'));
				const png = await page.evaluate(() => window.__posted.findLast(item => item.type === 'exportArtifact' && item.format === 'png').content);
				writeFileSync(path.join(output, 'endpoint.png'), Buffer.from(png, 'base64'));
				const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
				const print = await popup; await print.locator('svg').waitFor();
				assert.equal(await print.locator('svg').getAttribute('viewBox'), viewBox.join(' '));
				await print.waitForFunction(() => window.__printRequested === true);
				await print.pdf({ path: path.join(output, 'endpoint.pdf') }); await print.close();
			}
			assert.deepEqual(errors, [], 'no console/page errors');
			console.log(`PASS exports ${viewport.width} ${theme} (0 browser errors)`); checks++;
			await page.close();
		}
	}
} finally { await browser.close(); }
console.log(`${checks}/16 endpoint scenarios passed`);
