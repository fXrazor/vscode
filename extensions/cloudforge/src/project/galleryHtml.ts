/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Projects gallery Webview document. Pure: no `vscode` import. All data arrives by postMessage and is
// rendered with textContent, so architecture names never become markup.

export interface GalleryHtmlParams {
	readonly nonce: string;
	readonly cspSource: string;
}

export function buildGalleryHtml({ nonce, cspSource }: GalleryHtmlParams): string {
	const csp = [
		`default-src 'none'`,
		`style-src ${cspSource} 'nonce-${nonce}'`,
		`script-src 'nonce-${nonce}'`,
		`img-src ${cspSource} data:`,
		`font-src ${cspSource}`,
	].join('; ');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Architectures</title>
<style nonce="${nonce}">
:root {
	--cf-violet: #714EFF;
	--cf-accent-text: #5634BA;
	--cf-selected: #EEEBFF;
	--cf-card: var(--vscode-editorWidget-background, #FBFCFE);
	--cf-border: var(--vscode-widget-border, var(--vscode-panel-border, #BFC4D0));
	--cf-muted: var(--vscode-descriptionForeground, #50586D);
	--cf-warning: var(--vscode-editorWarning-foreground, #774708);
}
body.vscode-dark, body.vscode-high-contrast { --cf-accent-text: #CCBEFF; --cf-selected: #3A305A; }
* { box-sizing: border-box; }
body {
	margin: 0; padding: 32px 40px 48px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
	font-family: "Mona Sans", var(--vscode-font-family), "Segoe UI", Arial, sans-serif; font-size: 14px; line-height: 22px;
}
main { max-width: 1040px; margin: 0 auto; }
.crumbs { font-size: 12px; line-height: 18px; color: var(--cf-muted); margin: 0 0 4px; }
h1 { font-size: 22px; line-height: 30px; font-weight: 600; margin: 0 0 20px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 20px; }
.toolbar input, .toolbar select {
	height: 32px; padding: 0 10px; font: inherit; font-size: 13px; color: var(--vscode-input-foreground);
	background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--cf-border)); border-radius: 6px;
}
.toolbar input { flex: 1 1 240px; min-width: 0; }
.spacer { flex: 1 1 0; }
button { font: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; border-radius: 6px; }
.secondary { height: 32px; padding: 0 12px; color: var(--vscode-foreground); background: transparent; border: 1px solid var(--cf-border); }
.primary { height: 32px; padding: 0 14px; color: var(--vscode-button-foreground, #FFFFFF); background: var(--vscode-button-background, #5E3AD2); border: 1px solid transparent; }
.primary:hover { background: var(--vscode-button-hoverBackground, #5131BF); }
.secondary:hover { background: var(--vscode-toolbar-hoverBackground); }
:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--cf-accent-text)); outline-offset: 2px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 16px; list-style: none; padding: 0; margin: 0; }
.card {
	width: 100%; height: 100%; text-align: left; padding: 0; overflow: hidden; display: flex; flex-direction: column;
	color: inherit; background: var(--cf-card); border: 1px solid var(--cf-border); border-radius: 10px;
}
.card:hover { border-color: var(--cf-violet); }
.card[aria-current="true"] { border-color: var(--cf-violet); box-shadow: inset 0 0 0 1px var(--cf-violet); }
.preview { height: 96px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--cf-border); display: block; width: 100%; }
.body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.title { font-size: 14px; line-height: 21px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 12px; line-height: 18px; color: var(--cf-muted); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; line-height: 16px; padding: 1px 6px; border-radius: 999px; background: var(--cf-selected); color: var(--cf-accent-text); }
.status { font-size: 12px; line-height: 18px; color: var(--cf-warning); }
.empty { padding: 32px; text-align: center; color: var(--cf-muted); border: 1px dashed var(--cf-border); border-radius: 10px; }
@media (max-width: 760px) { body { padding: 24px; } }
</style>
</head>
<body>
<main>
	<p class="crumbs" id="crumbs">Projects</p>
	<h1 id="title">Architectures</h1>
	<div class="toolbar" role="toolbar" aria-label="Architecture gallery">
		<input id="search" type="search" placeholder="Search architectures, repositories, providers" aria-label="Search architectures">
		<select id="sort" aria-label="Sort architectures">
			<option value="name">Name</option>
			<option value="recent">Last edited</option>
			<option value="resources">Most resources</option>
		</select>
		<span class="spacer"></span>
		<button class="secondary" id="refresh" type="button">Refresh</button>
		<button class="secondary" id="templates" type="button">Templates</button>
		<button class="primary" id="new" type="button">Add Architecture</button>
	</div>
	<p class="meta" id="count" aria-live="polite"></p>
	<ul class="grid" id="grid" aria-label="Architectures"></ul>
	<div class="empty" id="empty" hidden></div>
</main>
<script nonce="${nonce}">
(() => {
	const vscode = acquireVsCodeApi();
	const saved = vscode.getState() || {};
	const search = document.getElementById('search');
	const sort = document.getElementById('sort');
	const grid = document.getElementById('grid');
	const empty = document.getElementById('empty');
	const countLabel = document.getElementById('count');
	search.value = typeof saved.query === 'string' ? saved.query : '';
	sort.value = ['name', 'recent', 'resources'].includes(saved.sort) ? saved.sort : 'name';
	let state = { projectName: '', cards: [], activeId: undefined };

	function remember() { vscode.setState({ query: search.value, sort: sort.value }); }
	function el(tag, className, text) { const node = document.createElement(tag); if (className) { node.className = className; } if (text !== undefined) { node.textContent = text; } return node; }

	function preview(card) {
		// Deterministic block sketch from the counts: one block per resource up to 12, modules as wide bars.
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('class', 'preview'); svg.setAttribute('viewBox', '0 0 232 96'); svg.setAttribute('aria-hidden', 'true');
		const total = Math.min(card.resourceCount || 0, 12);
		for (let index = 0; index < total; index++) {
			const rect = document.createElementNS(ns, 'rect');
			rect.setAttribute('x', String(16 + (index % 6) * 34)); rect.setAttribute('y', String(18 + Math.floor(index / 6) * 34));
			rect.setAttribute('width', '24'); rect.setAttribute('height', '24'); rect.setAttribute('rx', '5');
			rect.setAttribute('fill', index === 0 ? 'var(--cf-violet)' : 'var(--cf-selected)');
			rect.setAttribute('stroke', 'var(--cf-violet)'); rect.setAttribute('stroke-opacity', '0.5');
			svg.appendChild(rect);
		}
		for (let index = 0; index < Math.min(card.moduleCount || 0, 2); index++) {
			const bar = document.createElementNS(ns, 'rect');
			bar.setAttribute('x', '16'); bar.setAttribute('y', String(80 - index * 8)); bar.setAttribute('width', '200'); bar.setAttribute('height', '4'); bar.setAttribute('rx', '2');
			bar.setAttribute('fill', 'var(--cf-accent-text)'); bar.setAttribute('opacity', '0.4');
			svg.appendChild(bar);
		}
		return svg;
	}

	function render() {
		const terms = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
		const byName = (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
		const cards = state.cards.filter(card => {
			const text = [card.displayName, card.repositoryName || '', ...card.providerLabels].join(' ').toLowerCase();
			return terms.every(term => text.includes(term));
		}).sort((a, b) => {
			if (sort.value === 'recent') { const l = a.lastModified || '', r = b.lastModified || ''; return l === r ? byName(a, b) : r.localeCompare(l); }
			if (sort.value === 'resources') { const d = (b.resourceCount ?? -1) - (a.resourceCount ?? -1); return d || byName(a, b); }
			return byName(a, b);
		});
		grid.replaceChildren();
		for (const card of cards) {
			const item = el('li');
			const button = el('button', 'card');
			button.type = 'button';
			button.dataset.id = card.architectureId;
			if (card.architectureId === state.activeId) { button.setAttribute('aria-current', 'true'); }
			button.appendChild(preview(card));
			const body = el('span', 'body');
			body.appendChild(el('span', 'title', card.displayName));
			const source = card.source === 'repository' ? 'Repository' + (card.repositoryName ? ' · ' + card.repositoryName : '') : 'Local';
			body.appendChild(el('span', 'meta', source));
			if (card.status === 'available') {
				const parts = [card.resourceCount + (card.resourceCount === 1 ? ' resource' : ' resources')];
				if (card.dataSourceCount) { parts.push(card.dataSourceCount + ' data'); }
				if (card.moduleCount) { parts.push(card.moduleCount + (card.moduleCount === 1 ? ' module' : ' modules')); }
				if (card.edited) { parts.push('edited ' + card.edited); }
				body.appendChild(el('span', 'meta', parts.join(' · ')));
				if (card.providerLabels.length) {
					const chips = el('span', 'chips');
					for (const label of card.providerLabels) { chips.appendChild(el('span', 'chip', label)); }
					body.appendChild(chips);
				}
			} else {
				const text = { loading: 'Loading details…', empty: 'No Terraform files yet', unavailable: 'Unavailable: folder missing, changed or too large', skipped: 'Details skipped: project too large to summarize' }[card.status];
				body.appendChild(el('span', card.status === 'empty' || card.status === 'loading' ? 'meta' : 'status', text));
			}
			button.setAttribute('aria-label', card.displayName + ', ' + source);
			button.appendChild(body);
			button.addEventListener('click', () => vscode.postMessage({ type: 'open', architectureId: card.architectureId }));
			item.appendChild(button);
			grid.appendChild(item);
		}
		const total = state.cards.length;
		countLabel.textContent = total === 0 ? '' : (cards.length === total ? total + (total === 1 ? ' architecture' : ' architectures') : cards.length + ' of ' + total + ' architectures');
		empty.hidden = cards.length > 0;
		empty.textContent = total === 0 ? 'This project has no architectures yet. Choose Add Architecture to start blank, from a template, a repo or a project bundle.' : 'No architectures match your search.';
	}

	window.addEventListener('message', event => {
		const message = event.data;
		if (message && message.type === 'state') {
			state = message;
			document.getElementById('title').textContent = message.projectName || 'Architectures';
			document.getElementById('crumbs').textContent = message.projectName ? 'Projects / ' + message.projectName : 'Projects';
			render();
		}
	});
	search.addEventListener('input', () => { remember(); render(); });
	sort.addEventListener('change', () => { remember(); render(); });
	document.getElementById('new').addEventListener('click', () => vscode.postMessage({ type: 'newArchitecture' }));
	document.getElementById('templates').addEventListener('click', () => vscode.postMessage({ type: 'openTemplates' }));
	document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
