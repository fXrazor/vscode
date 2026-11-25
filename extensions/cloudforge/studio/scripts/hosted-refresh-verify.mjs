/*---------------------------------------------------------------------------------------------
 *  Hosted-mode E2E: semantic undo, Modified badge and drawing presentation across live refreshes.
 *
 *  Usage: start the preview (`node build.ts --serve`), then
 *    node scripts/hosted-refresh-verify.mjs <preview-url> [out-dir] [--channel=msedge]
 *  Studio runs in hosted mode via a mocked `acquireVsCodeApi`; `graph` messages simulate the
 *  extension host. Prints one PASS/FAIL line per check and exits non-zero on any failure.
 *--------------------------------------------------------------------------------------------*/
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Use `playwright` when installed; otherwise the repository root's `playwright-core` with an installed browser channel.
function loadChromium() {
	// PLAYWRIGHT_DIR: a folder whose node_modules holds playwright or playwright-core (e.g. a scratch `npm install --prefix`).
	const roots = [...(process.env.PLAYWRIGHT_DIR ? [path.join(process.env.PLAYWRIGHT_DIR, 'package.json')] : []), import.meta.url, path.join(process.cwd(), 'package.json'), new URL('../../../../package.json', import.meta.url)];
	for (const root of roots) {
		for (const name of ['playwright', 'playwright-core']) {
			try { return createRequire(root)(name).chromium; } catch { /* try the next location */ }
		}
	}
	throw new Error('Playwright not found: set PLAYWRIGHT_DIR to a folder with playwright-core installed (npm install --prefix <dir> playwright-core) and pass --channel=msedge.');
}
const chromium = loadChromium();
const url = process.argv[2];
const outDir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'output/hosted-refresh';
const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
if (!url) { console.error('usage: node scripts/hosted-refresh-verify.mjs <preview-url> [out-dir] [--channel=msedge]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const node = (id, resourceType, name) => ({ id, kind: 'resource', resourceType, name, label: name, hasSource: true });
const baseNodes = [node('rg-1', 'azurerm_resource_group', 'rg_main'), node('st-1', 'azurerm_storage_account', 'stmain'), node('la-1', 'azurerm_log_analytics_workspace', 'logs')];
const graph = (architectureId, revision, nodes) => ({ workspaceId: 'ws-e2e', architectureId, architectureName: 'E2E ' + architectureId, sourceRevision: revision.repeat(64).slice(0, 64), status: 'complete', nodes, edges: [], diagnostics: [] });

const results = []; const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

// Never hang: a stuck browser or preview ends the run with a clear message.
const watchdog = setTimeout(() => { console.error('FAIL watchdog — run exceeded 180 s; ' + results.length + ' checks done'); process.exit(3); }, 180_000);
console.log('launching ' + (channel ?? 'bundled chromium') + ' …');
const browser = await chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
page.setDefaultTimeout(10_000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
await page.addInitScript(() => {
	window.__posted = [];
	window.acquireVsCodeApi = () => ({ postMessage: message => window.__posted.push(message), getState: () => undefined, setState: () => {} });
});
await page.goto(url, { timeout: 20_000 });
console.log('preview loaded');
await page.waitForTimeout(1500);
const send = async message => { await page.evaluate(data => window.postMessage(data, '*'), message); await page.waitForTimeout(500); };
const undoEnabled = () => page.getByLabel('Undo', { exact: true }).isEnabled();
const badge = () => page.evaluate(() => [...document.querySelectorAll('header *')].map(element => element.textContent ?? '').find(text => /^rev [0-9a-f]{8}/.test(text.trim()))?.trim() ?? '');
const nodeIds = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(element => element.getAttribute('data-id')));
const shot = name => page.screenshot({ path: path.join(outDir, name + '.png') });

// a. Load architecture A and make user edits: move a resource, add a note, connect it, group two elements.
await send({ type: 'graph', graph: graph('arch-a', 'a', baseNodes) });
check('hosted load shows clean revision badge', /^rev a{8}$/.test(await badge()), await badge());
await page.locator('.react-flow__node[data-id="st-1"]').click();
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
await page.locator('main.canvas').focus(); await page.keyboard.press('n'); await page.waitForTimeout(400);
const noteId = (await nodeIds()).find(id => !baseNodes.some(entry => entry.id === id));
check('sticky note added', !!noteId, String(noteId));
await page.getByLabel('Connect elements').click();
await page.getByLabel('Connection source').selectOption(noteId);
await page.getByLabel('Connection target').selectOption('rg-1');
await page.getByRole('button', { name: 'Add connection' }).click(); await page.waitForTimeout(300);
const edgesBefore = await page.locator('.react-flow__edge').count();
check('drawing connection added', edgesBefore >= 1, 'edges=' + edgesBefore);
await page.locator(`.react-flow__node[data-id="${noteId}"]`).click();
await page.locator('.react-flow__node[data-id="la-1"]').click({ modifiers: ['Control'] });
await page.locator('main.canvas').focus(); await page.keyboard.press('Control+g'); await page.waitForTimeout(300);
check('badge shows Modified after edits', / · Modified$/.test(await badge()), await badge());
await shot('a-edited');

// b. Same architecture, new revision, identical nodes (the refresh that follows a save).
await send({ type: 'graph', graph: graph('arch-a', 'b', baseNodes) });
check('undo still enabled after same-architecture refresh', await undoEnabled());
check('badge clean right after refresh', /^rev b{8}$/.test(await badge()), await badge());
check('note survives refresh', (await nodeIds()).includes(noteId));
check('drawing connection survives refresh', await page.locator('.react-flow__edge').count() === edgesBefore, 'edges=' + await page.locator('.react-flow__edge').count());
await page.locator(`.react-flow__node[data-id="${noteId}"]`).click(); await page.waitForTimeout(300);
check('group survives refresh (selecting a member selects the group)', /Visual group/.test(await page.locator('.selection-caption').first().textContent() ?? ''));
await page.keyboard.press('Escape');
await shot('b-refreshed');

// c. Undo after refresh undoes the last user edit (group), not a reset.
await page.locator('main.canvas').focus(); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
await page.locator(`.react-flow__node[data-id="${noteId}"]`).click(); await page.waitForTimeout(300);
check('Ctrl+Z after refresh undoes the group only', !/Visual group/.test(await page.locator('.selection-caption').first().textContent() ?? '') && (await nodeIds()).includes(noteId));
check('badge shows Modified again after undo', / · Modified$/.test(await badge()), await badge());
await page.keyboard.press('Escape');

// d. External addition survives undo.
await send({ type: 'graph', graph: graph('arch-a', 'c', [...baseNodes, node('kv-1', 'azurerm_key_vault', 'kvmain')]) });
await page.locator('main.canvas').focus(); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
check('external addition survives undo', (await nodeIds()).includes('kv-1'));
await shot('d-external');

// e. Different architecture starts a fresh history.
await send({ type: 'graph', graph: graph('arch-b', 'd', baseNodes) });
check('different architecture disables undo', !(await undoEnabled()));

// f. Multi-object resize and toolbar placement at two widths.
for (const width of [1360, 1024]) {
	await page.setViewportSize({ width, height: width === 1360 ? 860 : 768 }); await page.waitForTimeout(400);
	await page.getByLabel('Fit architecture to view').click(); await page.waitForTimeout(400);
	await page.locator('main.canvas').focus(); await page.keyboard.press('Control+a'); await page.waitForTimeout(400);
	const size = page.getByLabel('Resize selection');
	check(width + 'px Size menu visible for multi-selection', await size.isVisible());
	const overlap = await page.evaluate(() => {
		const toolbar = document.querySelector('.selection-controls')?.getBoundingClientRect(); const view = document.querySelector('.canvas-options')?.getBoundingClientRect();
		return !!toolbar && !!view && toolbar.left < view.right && toolbar.right > view.left && toolbar.top < view.bottom && toolbar.bottom > view.top;
	});
	check(width + 'px selection toolbar clear of View button', !overlap);
	// Compare unscaled model sizes (screen width / zoom) keyed by node id, so pan or culling cannot skew the result.
	const widths = () => page.evaluate(() => { const zoom = Number(document.querySelector('.react-flow__viewport')?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1); return [...document.querySelectorAll('.react-flow__node')].map(element => element.getAttribute('data-id') + ':' + Math.round(element.getBoundingClientRect().width / zoom)).sort().join(','); });
	const before = await widths();
	await size.selectOption('1.5'); await page.waitForTimeout(400);
	const scaled = await widths();
	await page.locator('main.canvas').focus(); await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
	const restored = await widths();
	check(width + 'px scale 150% then Ctrl+Z restores sizes', scaled !== before && restored === before, 'before=' + before + ' scaled=' + scaled + ' restored=' + restored);
	await shot('f-' + width);
	await page.keyboard.press('Escape');
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
clearTimeout(watchdog);
await browser.close();
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed; screenshots in ${outDir}`);
process.exit(failed ? 1 : 0);
