/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Technical Graph browser verification (dedicated TechnicalGraph renderer, 26 November 2026).
 * Usage: node scripts/technical-view-verify.mjs <owned preview URL> [--channel=msedge] [--quick]
 * Invariants: graph drag/keys/layout (incl. bundled) and inputs never change the exported project; card rename does, and is
 * undoable from Architecture view; layouts never overlap cards; no browser errors.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
let chromium;
for (const root of [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url, path.join(process.cwd(), 'package.json')]) {
	for (const name of ['playwright', 'playwright-core']) { try { chromium = createRequire(root)(name).chromium; break; } catch { /* Next installed runtime. */ } }
	if (chromium) { break; }
}
assert.ok(chromium, 'Set PLAYWRIGHT_DIR to an installed runtime.');
const base = process.argv[2]; assert.ok(base, 'Pass an owned preview URL.');
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
const quick = process.argv.includes('--quick');
const output = 'output/playwright/technical-view'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
const results = []; const browserErrors = [];
const withSample = (sample) => base + (base.includes('?') ? '&' : '?') + 'sample=' + sample;
try {
	for (const viewport of (quick ? [{ width: 1360, height: 860 }] : [{ width: 1360, height: 860 }, { width: 1024, height: 768 }])) {
		for (const theme of (quick ? ['light'] : ['light', 'dark'])) {
			const page = await browser.newPage({ viewport }); page.setDefaultTimeout(15_000);
			page.on('pageerror', error => browserErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') { browserErrors.push(message.text()); } });
			const pass = name => { results.push({ name, width: viewport.width, theme }); console.log(`PASS ${name} ${viewport.width} ${theme}`); };
			const exported = async () => {
				await page.getByLabel('Export architecture', { exact: true }).click();
				const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Graph JSON', exact: true }).click();
				const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream) { chunks.push(chunk); }
				await page.getByLabel('Export architecture', { exact: true }).click();
				return JSON.parse(Buffer.concat(chunks).toString('utf8'));
			};
			const view = async (label, value) => {
				const open = await page.locator('details.tg-view-menu').evaluate(element => element.open);
				if (!open) { await page.getByLabel('View options', { exact: true }).click(); }
				await page.getByLabel(label, { exact: true }).selectOption(value);
				await page.getByLabel('View options', { exact: true }).click(); await page.waitForTimeout(500);
			};
			const layoutTo = async id => { await page.getByRole('radio', { name: { layers: 'Layers', scopes: 'Scopes', tree: 'Ownership tree', bundled: 'Bundled', force: 'Network' }[id], exact: true }).click(); await page.waitForTimeout(500); };
			const noOverlap = async () => {
				const boxes = await page.locator('.react-flow__node-card').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { id: node.dataset.id, x: box.x, y: box.y, w: box.width, h: box.height }; }));
				for (const a of boxes) { for (const b of boxes) { if (a.id < b.id) { assert.ok(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, a.id + ' overlaps ' + b.id); } } }
				return boxes.length;
			};
			await page.goto(withSample('hub-spoke'));
			if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Toggle resource library', { exact: true }).click();
			const original = await exported();
			await page.getByRole('button', { name: 'Configuration', exact: true }).click();
			await page.locator('main.technical-graph').waitFor();
			assert.equal(await page.locator('.react-flow__node-card').count(), original.resources.length); pass('every resource is a graph card');
			await view('Card detail', 'detailed');
			for (const layout of ['layers', 'scopes', 'tree']) { await layoutTo(layout); assert.ok(await noOverlap() > 0); }
			await layoutTo('bundled');
			assert.equal(await page.locator('.tg-bundle-leaf').count(), original.resources.length);
			await page.getByRole('button', { name: 'snet-aks-nodes', exact: true }).click();
			assert.ok(await page.locator('.tg-bundle-path.is-uses, .tg-bundle-path.is-used-by').count() > 0); pass('bundled view shows every resource and highlights its relationships');
			await page.keyboard.press('Escape');
			await layoutTo('force');
			assert.equal(await page.locator('.tg-force-node').count(), original.resources.length);
			{ const node = await page.locator('[data-node="aks"]').boundingBox(); await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2); await page.mouse.down(); await page.mouse.move(node.x + 160, node.y + 90, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400); }
			assert.deepEqual(await exported(), original); pass('network view shows every resource as an icon and dragging there never changes the project');
			await view('Size by connections', '0');
			assert.equal(new Set(await page.locator('.tg-force-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-r')))).size, 1);
			await view('Size by connections', '200');
			{ const radii = (await page.locator('.tg-force-node').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-r'))))); assert.ok(Math.max(...radii) >= Math.min(...radii) * 1.5, 'hub is much bigger'); }
			assert.ok(await page.locator('.tg-force-hull').count() > 0);
			{ const span = async () => page.locator('.tg-force-node').evaluateAll(nodes => { const at = nodes.map(node => node.getAttribute('transform').match(/-?[\d.]+/g).map(Number)); const xs = at.map(p => p[0]); const ys = at.map(p => p[1]); return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys)); });
				const before = await span(); const dial = page.getByLabel('Network spread', { exact: true }); await dial.fill('300'); await dial.blur(); await page.waitForTimeout(600);
				assert.ok(await span() > before * 1.4, 'spread dial spreads the graph'); await dial.fill('150'); await dial.blur(); await page.waitForTimeout(400); }
			assert.deepEqual(await exported(), original); pass('the spread dial spreads the network without project changes');
			await view('Clusters', 'layer'); await view('Link shape', 'straight'); await view('Labels', 'all');
			assert.equal(await page.locator('.tg-force-label').count(), original.resources.length);
			assert.deepEqual(await exported(), original); pass('network options size nodes by connections, cluster and relabel without project changes');
			await layoutTo('tree');
			await page.getByRole('button', { name: 'Collapse vnet-spoke-aks', exact: true }).click(); await page.waitForTimeout(300);
			assert.ok(await page.getByRole('button', { name: 'Expand vnet-spoke-aks', exact: true }).isVisible()); await page.getByRole('button', { name: 'Expand vnet-spoke-aks', exact: true }).click();
			assert.deepEqual(await exported(), original); pass('tree branches fold and unfold without project changes');
			await layoutTo('layers'); pass('layers, scopes and tree layouts have no overlapping cards');
			// Multi-cloud estate: 126 resources in 11 top-level scopes (Azure resource groups, AWS VPCs, Google Cloud projects).
			await page.goto(withSample('estate')); if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Toggle resource library', { exact: true }).click(); const estate = await exported();
			await page.getByRole('button', { name: 'Configuration', exact: true }).click(); await page.locator('main.technical-graph').waitFor();
			await layoutTo('scopes'); assert.ok(await noOverlap() > 100);
			await page.getByLabel('Spotlight scope').selectOption('rg-prod'); await page.waitForTimeout(500);
			{ const outside = await page.locator('.tg-card.is-outside').count(); const inside = await page.locator('.tg-card:not(.is-outside)').count(); assert.ok(outside > 80 && inside >= 20 && inside < 40, inside + ' in, ' + outside + ' out'); }
			assert.match(await page.locator('.tg-card.is-outside').first().evaluate(el => getComputedStyle(el).filter), /grayscale/, 'scope spotlight greys out cards outside the scope');
			await layoutTo('force'); await page.waitForTimeout(800);
			assert.equal(await page.locator('.tg-force-node').count(), estate.resources.length);
			assert.ok(await page.locator('.tg-force-node:not(.is-outside)').count() < 40 && await page.locator('.tg-force-hull.is-lit').count() === 1);
			assert.match(await page.locator('.tg-force-node.is-outside').first().evaluate(el => getComputedStyle(el).filter), /grayscale/, 'scope spotlight greys out Network nodes outside the scope');
			await page.locator('.tg-scope-pick button').click(); await page.waitForTimeout(400);
			assert.equal(await page.locator('.tg-force-node.is-outside').count(), 0);
			{ const hulls = await page.locator('.tg-force-hull path').evaluateAll(paths => paths.map(path => { const box = path.getBBox(); return { x: box.x, y: box.y, w: box.width, h: box.height }; }));
				assert.ok(hulls.length >= 9, hulls.length + ' hulls');
				const centre = box => ({ x: box.x + box.w / 2, y: box.y + box.h / 2, r: Math.min(box.w, box.h) / 2 });
				for (const [i, a] of hulls.entries()) { for (const b of hulls.slice(i + 1)) { const p = centre(a); const q = centre(b); assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > (p.r + q.r) * 0.9, 'scope outlines overlap'); } } }
			assert.deepEqual(await exported(), estate); pass('large multi-cloud estate: scope spotlight greys out the rest and network scopes sit apart without project changes');
			await page.goto(withSample('hub-spoke')); if (theme === 'dark') { await page.getByLabel('Toggle light or dark theme').click(); }
			await page.getByLabel('Toggle resource library', { exact: true }).click();
			await page.getByRole('button', { name: 'Configuration', exact: true }).click(); await page.locator('main.technical-graph').waitFor();
			await layoutTo('layers'); await view('Card detail', 'detailed');
			assert.ok(await page.locator('.react-flow__node-card[data-id="aks"] .tg-row').count() >= 3); pass('AKS shows its configured input rows');
			// Drag AKS far away: a graph pin appears and the project is unchanged.
			const card = page.locator('.react-flow__node-card[data-id="aks"]'); const box = await card.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x - 300, box.y + 200, { steps: 12 }); await page.mouse.up();
			await page.waitForTimeout(300);
			assert.ok(await page.getByRole('button', { name: /Reset 1 pin/ }).isVisible()); pass('dragging creates a graph-only pin');
			await card.click(); await page.locator('main.technical-graph').focus();
			for (const key of ['Delete', 'Backspace', 'Control+z', 'Control+d', 'Control+x', 'Control+v']) { await page.keyboard.press(key); }
			assert.deepEqual(await exported(), original); pass('drag, pins and graph shortcuts leave the exported project unchanged');
			assert.equal(await page.getByLabel('Undo', { exact: true }).isDisabled(), true); pass('graph actions add no Undo step');
			// Lenses, overlays, focus.
			for (const lens of ['Dependencies', 'Topology', 'Runtime', 'Observability', 'Exposure', 'All']) { await page.getByRole('radio', { name: lens }).click(); }
			for (const overlay of ['order', 'impact', 'plan', 'none']) { await page.getByLabel('Card overlay').selectOption(overlay); }
			await card.click(); await page.getByRole('button', { name: 'Focus 2 hops' }).click(); await page.waitForTimeout(400);
			assert.ok(await page.locator('.react-flow__node-card').count() < original.resources.length); await page.getByRole('button', { name: 'Show all' }).click(); pass('lenses, overlays and focus switch without project changes');
			assert.deepEqual(await exported(), original);
			assert.equal(await page.locator('.react-flow__node-ghost').count(), 4); pass('var., local. and data. inputs appear as ghost cards');
			// Rename through the card: this is a deliberate configuration edit and is undoable.
			await page.getByRole('button', { name: 'Rename aks-platform' }).first().click();
			await page.getByRole('textbox', { name: 'Rename aks-platform' }).fill('aks-renamed'); await page.keyboard.press('Enter');
			const renamed = await exported(); assert.equal(renamed.resources.find(resource => resource.id === 'aks').label, 'aks-renamed');
			assert.deepEqual(renamed.resources.find(resource => resource.id === 'aks').positions, original.resources.find(resource => resource.id === 'aks').positions);
			await page.getByRole('button', { name: 'Architecture', exact: true }).click(); await page.getByLabel('Undo', { exact: true }).click();
			assert.deepEqual(await exported(), original); pass('card rename edits the project and is undoable from Architecture view');
			await page.getByRole('button', { name: 'Configuration', exact: true }).click(); await page.waitForTimeout(400);
			assert.ok(await page.getByRole('button', { name: /Reset 1 pin/ }).isVisible()); pass('graph pins survive a mode switch');
			await page.screenshot({ path: `${output}/graph-${viewport.width}-${theme}.png` });
			await page.close();
		}
	}
} finally { await browser.close(); }
writeFileSync(`${output}/report.json`, JSON.stringify({ results, browserErrors }, null, 2));
assert.deepEqual(browserErrors, []);
console.log(`${results.length}/${results.length} technical graph checks passed with no browser errors.`);
