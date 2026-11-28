/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
/* CloudForge Template Library page. Plain browser script, no framework. Every value from the
   extension is escaped with esc() before it becomes markup, and no inline styles are written, so
   the page runs under a nonce-only CSP. The design is the approved Checkpoint 3 mock-up. */
(function () {
	'use strict';
	// @ts-ignore acquireVsCodeApi is provided by the webview host.
	const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() { }, getState() { return undefined; }, setState() { } };
	const post = message => vscode.postMessage(message);

	/* ---------- Small helpers ---------- */
	const $ = (s, r = document) => r.querySelector(s);
	const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
	const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const keyOf = t => t.id + '@' + t.version;
	const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
	const P = { azure: 'Azure', aws: 'AWS', gcp: 'Google Cloud', kubernetes: 'Kubernetes', other: 'Other', multi: 'Multi-cloud' };
	const PROVIDER_MARK = { azure: 'provider-azure.svg', aws: 'provider-aws.svg', gcp: 'provider-gcp.svg' };
	const TRUST = { official: 'Official', verified: 'Verified', community: 'Community', local: 'My Library' };
	const SOURCE = { builtin: 'Built in', local: 'My Library', remote: 'Downloaded' };
	const LEVEL = { beginner: 1, intermediate: 2, advanced: 3 };
	const ICON = {
		ok: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M5.2 8.2l1.9 1.9 3.8-4"/></svg>',
		warn: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/></svg>',
		err: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/></svg>',
		info: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4M8 4.8v.1"/></svg>',
		search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/></svg>',
		grid: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
		list: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="2" rx="1"/><rect x="2" y="7" width="12" height="2" rx="1"/><rect x="2" y="11" width="12" height="2" rx="1"/></svg>',
		filter: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3 1V8.5z"/></svg>',
		import: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3M3 12.5h10"/></svg>',
		refresh: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8"/></svg>',
		close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
	};
	const st = (kind, text) => '<span class="st ' + kind + '">' + ICON[kind] + esc(text) + '</span>';

	/* ---------- State ---------- */
	const saved = (() => { try { return vscode.getState() || {}; } catch { return {}; } })();
	const S = {
		assets: '', project: undefined, page: undefined, error: undefined, loading: true,
		route: saved.route === 'details' ? 'details' : 'library', key: saved.key, detailTab: saved.detailTab || 'overview', tfFile: undefined,
		q: '', sort: saved.sort || 'recommended', layout: saved.layout === 'list' ? 'list' : 'grid', provider: 'all',
		facets: { templateType: new Set(), categories: new Set(), difficulty: new Set(), trust: new Set(), source: new Set() },
		drawer: false, menu: false, previews: {}, details: {}, compat: {}, wizard: undefined, quick: undefined, heroVB: undefined,
		modal: undefined, pending: undefined,
	};
	function remember() {
		try { vscode.setState({ route: S.route, key: S.key, detailTab: S.detailTab, sort: S.sort, layout: S.layout }); } catch { /* ignore */ }
	}
	const templates = () => (S.page && S.page.templates) || [];
	const byKey = key => templates().find(t => keyOf(t) === key);
	const providerOf = t => t.providers.length > 1 ? 'multi' : (P[t.providers[0]] ? t.providers[0] : 'other');
	const constraintText = t => Object.entries(t.compatibility).map(([address, range]) => address.split('/').pop() + ' ' + range).join(', ');

	let toastTimer;
	function toast(message, kind = 'ok') {
		const el = $('#toast');
		el.innerHTML = '<span class="ic ' + kind + '">' + ICON[kind] + '</span><span>' + esc(message) + '</span>';
		el.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
	}

	/* ---------- Compatibility labels ---------- */
	function compatSummary(t) {
		const entry = S.compat[keyOf(t)];
		const arch = S.project && S.project.activeName;
		if (!entry || !entry.result) {
			return { kind: '', short: constraintText(t), long: '' };
		}
		const rows = entry.result.providers;
		const conflict = rows.find(p => p.status === 'conflictWithLock' || p.status === 'conflictWithConstraint');
		if (conflict) {
			return { kind: 'warn', short: conflict.status === 'conflictWithLock' ? 'Conflicts with lock' : 'Conflicts with constraint', long: (entry.lines || []).join(' ') };
		}
		const fits = rows.filter(p => p.status === 'compatible' || p.status === 'compatibleUntested');
		const adds = rows.filter(p => p.status === 'notInProject');
		if (!fits.length && adds.length) {
			return { kind: 'info', short: 'Adds ' + adds.map(p => p.provider.split('/').pop()).join(', '), long: (entry.lines || []).join(' ') };
		}
		if (rows.some(p => p.status === 'compatibleUntested')) {
			return { kind: 'ok', short: 'Fits, untested', long: (entry.lines || []).join(' ') };
		}
		return { kind: 'ok', short: arch ? 'Fits ' + arch : 'Fits', long: (entry.lines || []).join(' ') };
	}
	const compatHtml = t => { const c = compatSummary(t); return c.kind ? st(c.kind, c.short) : '<span class="st mono">' + esc(c.short) + '</span>'; };
	function trustPill(t) {
		let out = '<span class="pill ' + (t.trust === 'local' ? 'local' : 'official') + '">' + esc(TRUST[t.trust] || t.trust) + '</span>';
		if (t.lifecycle === 'experimental') { out += ' <span class="pill exp">Experimental</span>'; }
		if (t.lifecycle === 'deprecated') { out += ' <span class="pill exp">Deprecated</span>'; }
		if (t.highRiskFindings > 0) { out += ' <span class="pill risk">' + ICON.warn + 'High risk accepted</span>'; }
		return out;
	}

	/* ---------- Architecture diagrams ----------
	   Drawn the way the Studio canvas draws them: a provider boundary, resource groups and networks as nested containers,
	   resources as icon nodes and Terraform references as arrows. Cards use the same drawing without node text. */
	const GLYPH = {
		rg: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke-dasharray="2 1.5"/><path d="M5 6.5h6"/>',
		net: '<circle cx="8" cy="3.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M7 5L4.5 10.4M9 5l2.5 5.4M5.3 12h5.4"/>',
		subnet: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.2 1.6"/><path d="M5.5 8h5"/>',
		peer: '<circle cx="4" cy="8" r="2.3"/><circle cx="12" cy="8" r="2.3"/><path d="M6.3 8h3.4"/>',
		shield: '<path d="M8 1.8l5 2v4.1c0 3-2.1 5.1-5 6.3-2.9-1.2-5-3.3-5-6.3V3.8z"/>',
		link: '<path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.3 2.3 0 0 0 3.3 3.3l1.2-1.2M11 8.5l1.2-1.2a2.3 2.3 0 0 0-3.3-3.3L7.7 5.2"/>',
		route: '<path d="M2.5 5.5h9.5l-2.2-2.2M13.5 10.5H4l2.2 2.2"/>',
		wheel: '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="1.6"/><path d="M8 2.2v4.2M8 9.6v4.2M2.2 8h4.2M9.6 8h4.2"/>',
		key: '<circle cx="5" cy="8" r="2.6"/><path d="M7.6 8h6M11.6 8v2.4M13.6 8v1.8"/>',
		stack: '<rect x="3" y="2.5" width="10" height="3" rx="1"/><rect x="3" y="6.5" width="10" height="3" rx="1"/><rect x="3" y="10.5" width="10" height="3" rx="1"/>',
		hub: '<circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="2.4" r="1.2"/><circle cx="8" cy="13.6" r="1.2"/><circle cx="2.4" cy="8" r="1.2"/><circle cx="13.6" cy="8" r="1.2"/><path d="M8 3.6v2M8 10.4v2M3.6 8h2M10.4 8h2"/>',
		doc: '<path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M6 8h4.5M6 10.6h4.5"/>',
		brace: '<path d="M6 2.5c-1.8 0-1.8 1.2-1.8 2.6S3.6 7.6 2.5 8c1.1.4 1.7 1.5 1.7 2.9s0 2.6 1.8 2.6M10 2.5c1.8 0 1.8 1.2 1.8 2.6s.6 2.5 1.7 2.9c-1.1.4-1.7 1.5-1.7 2.9s0 2.6-1.8 2.6"/>',
		module: '<rect x="2.5" y="2.5" width="5" height="5" rx="1"/><rect x="8.5" y="2.5" width="5" height="5" rx="1"/><rect x="2.5" y="8.5" width="5" height="5" rx="1"/><rect x="8.5" y="8.5" width="5" height="5" rx="1"/>',
		data: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4"/>',
		box: '<rect x="3" y="3" width="10" height="10" rx="1.5"/>',
		cloud: '<path d="M4.5 12.5h7.2a3 3 0 0 0 .3-6 4 4 0 0 0-7.7.9A2.6 2.6 0 0 0 4.5 12.5z"/>',
	};
	const GLYPH_OF = [
		[/resource_group$/, 'rg'], [/(virtual_network|_vpc|compute_network)$/, 'net'], [/subnet(work)?$/, 'subnet'], [/peering|attachment/, 'peer'],
		[/security_group|firewall|network_policy|policy/, 'shield'], [/association|_link$/, 'link'], [/route|router/, 'route'],
		[/kubernetes_cluster|eks_cluster|container_cluster|deployment/, 'wheel'], [/iam|role|identity/, 'key'], [/node_group|backend|versioning/, 'stack'],
		[/transit_gateway$|service$/, 'hub'], [/log|config_map|flow/, 'doc'], [/namespace/, 'brace'],
	];
	function glyphKey(node) {
		if (node.role === 'module') { return 'module'; }
		if (node.role === 'data') { return 'data'; }
		const hit = GLYPH_OF.find(([re]) => re.test(node.type));
		return hit ? hit[1] : 'box';
	}
	const glyph = (k, x, y, s) => '<g class="glyph" transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + (GLYPH[k] || GLYPH.box) + '</g>';
	const iconUrl = path => path && S.assets ? S.assets + '/' + path.split('/').map(encodeURIComponent).join('/') : '';
	function iconImg(path, fallback, x, y, size) {
		const src = iconUrl(path);
		return src ? '<image href="' + esc(src) + '" x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '"/>' : glyph(fallback, x + size * .1, y + size * .1, size * .8 / 16);
	}
	function fit(text, px, max) { const n = Math.floor(max / px); return text.length > n ? text.slice(0, Math.max(1, n - 1)) + '…' : text; }
	function edgePath(a, b) {
		const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
		if (b.x >= a.x + a.w - 4 || b.x + b.w <= a.x + 4) {
			const right = bcx > acx;
			const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x : b.x + b.w;
			const y1 = a.leaf ? acy : clamp(bcy, a.y + 20, a.y + a.h - 20), y2 = b.leaf ? bcy : clamp(acy, b.y + 20, b.y + b.h - 20);
			const m = (x1 + x2) / 2;
			return 'M' + x1 + ' ' + y1 + ' C' + m + ' ' + y1 + ' ' + m + ' ' + y2 + ' ' + x2 + ' ' + y2;
		}
		const down = bcy > acy;
		const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h;
		const x1 = a.leaf ? acx : clamp(bcx, a.x + 20, a.x + a.w - 20), x2 = b.leaf ? bcx : clamp(acx, b.x + 20, b.x + b.w - 20);
		const m = (y1 + y2) / 2;
		return 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + m + ' ' + x2 + ' ' + m + ' ' + x2 + ' ' + y2;
	}
	/* Same proportions as the Studio canvas: icon-first resource nodes and containers with a heading row. */
	const DIM = { full: { NW: 128, NH: 104, PAD: 18, TOP: 46, GAP: 28, CH: 7.2 }, card: { NW: 84, NH: 84, PAD: 16, TOP: 50, GAP: 20, CH: 12.4 } };
	function groupKind(e) {
		if (e.cloud) { return 'cloud'; }
		const type = e.node.type;
		if (/resource_group$/.test(type)) { return 'rg'; }
		if (/namespace/.test(type)) { return 'ns'; }
		if (/subnet(work)?$/.test(type)) { return 'subnet'; }
		return 'net';
	}
	const GSTYLE = { cloud: ['cloud', '', .03], rg: ['rg', '6 4', 0], net: ['net', '', .07], subnet: ['subnet', '5 4', .07], ns: ['brace', '', .07] };
	const groupName = e => e.cloud ? P[e.provider] || 'Resources' : e.node.label + ' ' + e.node.name;
	const groupDetail = e => e.cloud ? '' : e.node.detail || '';
	function buildTree(dg) {
		const byId = new Map(dg.nodes.map(n => [n.id, n]));
		const kids = new Map();
		const roots = {};
		for (const n of dg.nodes) {
			const parent = n.parent && byId.has(n.parent) && byId.get(n.parent).container ? n.parent : undefined;
			if (parent) { (kids.get(parent) || kids.set(parent, []).get(parent)).push(n); } else { (roots[n.provider] = roots[n.provider] || []).push(n); }
		}
		const make = n => n.container ? { group: true, node: n, kids: (kids.get(n.id) || []).map(make) } : { leaf: true, node: n };
		const frames = dg.providers.filter(p => roots[p]).map(p => ({ group: true, cloud: true, provider: p, kids: roots[p].map(make) }));
		return frames.length === 1 ? frames[0] : { flow: true, kids: frames };
	}
	/** Lays items out in rows, choosing the column count whose shape is closest to `target` with little waste. */
	function pack(items, gap, target) {
		let best;
		for (let cols = 1; cols <= items.length; cols++) {
			const rows = [];
			for (let i = 0; i < items.length; i += cols) { rows.push(items.slice(i, i + cols)); }
			const widths = rows.map(r => r.reduce((s, c) => s + c.w, 0) + gap * (r.length - 1));
			const heights = rows.map(r => Math.max(...r.map(c => c.h)));
			const W = Math.max(...widths), H = heights.reduce((s, h) => s + h, 0) + gap * (rows.length - 1);
			const area = items.reduce((s, c) => s + c.w * c.h, 0);
			const score = Math.abs(Math.log((W / H) / target)) + (1 - area / (W * H)) * .9;
			if (!best || score < best.score) { best = { score, W, H, rows, widths, heights }; }
		}
		const pos = [];
		let y = 0;
		best.rows.forEach((row, r) => {
			let x = (best.W - best.widths[r]) / 2;
			row.forEach(c => { pos.push({ c, x, y: y + (best.heights[r] - c.h) / 2 }); x += c.w + gap; });
			y += best.heights[r] + gap;
		});
		return { w: best.W, h: best.H, pos };
	}
	function measure(e, D, card) {
		if (e.leaf) { e.w = D.NW; e.h = D.NH; return; }
		e.kids.forEach(k => measure(k, D, card));
		const groups = e.kids.filter(k => !k.leaf), leaves = e.kids.filter(k => k.leaf);
		const items = groups.slice();
		if (leaves.length) {
			const block = { block: true, kids: leaves };
			const laid = pack(leaves, D.GAP, leaves.length <= 3 ? 99 : 1.4);
			block.w = laid.w; block.h = laid.h; block.laid = laid;
			items.push(block);
		}
		if (e.flow) {
			const laid = items.length ? pack(items, D.GAP * 1.5, 1.6) : { w: 0, h: 0, pos: [] };
			e.laid = laid; e.w = laid.w; e.h = laid.h;
			return;
		}
		const head = card ? groupName(e).length * D.CH + 84 : groupName(e).length * D.CH + groupDetail(e).length * 6.6 + 120;
		if (!items.length) { e.w = Math.max(card ? 200 : 210, head); e.h = card ? 110 : 96; e.laid = { w: 0, h: 0, pos: [] }; return; }
		const laid = pack(items, D.GAP, e.cloud ? 1.7 : 1.5);
		e.laid = laid;
		e.w = Math.max(D.PAD * 2 + laid.w, head);
		e.h = D.TOP + D.PAD + laid.h;
	}
	function place(e, x, y, D, out) {
		e.x = x; e.y = y;
		if (e.leaf) { out.nodes.push(e); out.boxes[e.node.id] = e; return; }
		if (e.block) { e.laid.pos.forEach(p => place(p.c, x + p.x, y + p.y, D, out)); return; }
		if (!e.flow) { out.groups.push(e); if (e.node) { out.boxes[e.node.id] = e; } }
		const ox = e.flow ? 0 : D.PAD + ((e.w - D.PAD * 2) - e.laid.w) / 2, oy = e.flow ? 0 : D.TOP;
		e.laid.pos.forEach(p => place(p.c, x + ox + p.x, y + oy + p.y, D, out));
	}
	const countInside = e => e.kids.length;
	let dgSeq = 0;
	function layoutDiagram(dg, mode) {
		const D = mode === 'card' ? DIM.card : DIM.full;
		const root = buildTree(dg);
		measure(root, D, mode === 'card');
		const out = { boxes: {}, groups: [], nodes: [] };
		place(root, 0, 0, D, out);
		return { root, D, ...out };
	}
	function diagramSvg(t, dg, mode) {
		if (!dg || !dg.nodes.length) { return ''; }
		const card = mode === 'card';
		const { root, D, boxes, groups, nodes } = layoutDiagram(dg, mode);
		const M = card ? 12 : 28, W = Math.max(root.w, 40) + M * 2, H = Math.max(root.h, 40) + M * 2, id = 'ah' + (++dgSeq);
		const provider = dg.providers.length === 1 ? dg.providers[0] : 'other';
		let s = '<svg class="dg' + (card ? ' thumb' : '') + ' p-' + esc(provider) + '" viewBox="' + (-M) + ' ' + (-M) + ' ' + W + ' ' + H + '" data-vb="' + (-M) + ' ' + (-M) + ' ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc('Architecture of ' + t.name + ': ' + plural(dg.nodes.length, 'resource', 'resources')) + '">' +
			'<defs><marker id="' + id + '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="' + (card ? 3.6 : 5) + '" markerHeight="' + (card ? 3.6 : 5) + '" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" class="ah"/></marker></defs>';
		groups.forEach(gr => {
			const kind = groupKind(gr), style = GSTYLE[kind], name = groupName(gr), detail = groupDetail(gr);
			const prov = gr.cloud ? gr.provider : gr.node.provider;
			const tip = gr.node ? '<title>' + esc(gr.node.id + ' · ' + gr.node.file) + '</title>' : '';
			s += '<g class="grp ' + kind + ' p-' + esc(prov) + '"' + (gr.node && !card ? ' data-node="' + esc(gr.node.id) + '"' : '') + '>' + tip +
				'<rect class="frame" x="' + gr.x + '" y="' + gr.y + '" width="' + gr.w + '" height="' + gr.h + '" rx="' + (card ? 14 : 12) + '" fill-opacity="' + style[2] + '" stroke-opacity="' + (kind === 'cloud' ? .5 : .75) + '" stroke-width="' + (card ? 2.4 : 1.4) + '"' + (style[1] ? ' stroke-dasharray="' + style[1] + '"' : '') + '/>';
			const iy = gr.y + (card ? 10 : 11), isz = card ? 30 : 24;
			const icon = gr.cloud ? PROVIDER_MARK[gr.provider] : gr.node.icon;
			s += icon && S.assets
				? '<rect class="htile" x="' + (gr.x + 10) + '" y="' + (iy - 2) + '" width="' + (isz + 4) + '" height="' + (isz + 4) + '" rx="' + (card ? 8 : 6) + '"/>' + iconImg(icon, style[0], gr.x + 12, iy, isz)
				: glyph(gr.cloud && gr.provider === 'kubernetes' ? 'wheel' : style[0], gr.x + 14, iy + 2, card ? 1.6 : 1.25);
			const tx = gr.x + 18 + isz;
			if (card) {
				s += '<text class="gl" x="' + tx + '" y="' + (gr.y + 34) + '">' + esc(fit(name, D.CH, gr.w - isz - 34)) + '</text>';
			} else {
				s += '<text class="gl" x="' + tx + '" y="' + (gr.y + 28) + '">' + esc(name) + (detail ? '<tspan class="gd" dx="8">' + esc(detail) + '</tspan>' : '') + '</text>';
				if (!gr.cloud && gr.kids.length) { s += '<text class="gc" x="' + (gr.x + gr.w - 14) + '" y="' + (gr.y + 28) + '" text-anchor="end">' + countInside(gr) + ' inside</text>'; }
			}
			s += '</g>';
		});
		dg.edges.forEach(([a, b]) => { if (boxes[a] && boxes[b]) { s += '<path class="edge" d="' + edgePath(boxes[a], boxes[b]) + '" marker-end="url(#' + id + ')"/>'; } });
		nodes.forEach(nd => {
			const n = nd.node, k = glyphKey(n);
			const tip = '<title>' + esc(n.id + ' · ' + n.file) + '</title>';
			if (card) {
				s += '<g class="node' + (n.role === 'data' ? ' data' : '') + '" transform="translate(' + nd.x + ' ' + nd.y + ')">' + tip + '<rect class="box ctile" width="' + D.NW + '" height="' + D.NH + '" rx="16"/>' + iconImg(n.icon, k, 14, 14, 56) + '</g>';
			} else {
				s += '<g class="node' + (n.role === 'data' ? ' data' : '') + '" data-node="' + esc(n.id) + '" transform="translate(' + nd.x + ' ' + nd.y + ')">' + tip +
					'<rect class="box" width="' + D.NW + '" height="' + D.NH + '" rx="12"/>' +
					'<rect class="tile" x="' + (D.NW / 2 - 25) + '" y="10" width="50" height="50" rx="11"/>' + iconImg(n.icon, k, D.NW / 2 - 19, 16, 38) +
					'<text class="nk" x="' + (D.NW / 2) + '" y="78" text-anchor="middle">' + esc(fit(n.name, 6.9, D.NW - 14)) + '</text>' +
					'<text class="nn" x="' + (D.NW / 2) + '" y="94" text-anchor="middle">' + esc(fit((n.role === 'data' ? 'Data · ' : '') + n.label, 6.1, D.NW - 12)) + '</text></g>';
			}
		});
		return s + '</svg>';
	}
	function previewHtml(t) {
		const dg = S.previews[keyOf(t)];
		if (dg === undefined) { return '<div class="skel" aria-hidden="true"></div>'; }
		return diagramSvg(t, dg, 'card') || '';
	}
	function panHtml(t, dg, id) {
		if (!dg) { return '<div class="pan-wrap" id="' + id + '"><div class="pan-area empty skel" aria-label="Loading the architecture"></div></div>'; }
		const svg = diagramSvg(t, dg, 'full');
		const containers = dg.nodes.filter(n => n.container).length;
		return '<div class="pan-wrap" id="' + id + '"><div class="pan-tools"><button type="button" class="iconbtn big" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button><button type="button" class="iconbtn big" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button><button type="button" class="btn ghost" data-zoom="fit">Fit</button><span class="hint">Drag to move · scroll to zoom · click a resource</span></div>' +
			(svg ? '<div class="pan-area" data-pan>' + svg + '</div>' : '<div class="pan-area empty">No resources to draw</div>') +
			'<div class="pan-foot"><span>' + plural(dg.nodes.length, 'resource', 'resources') + '</span><span>' + plural(containers, 'container', 'containers') + '</span><span>' + plural(dg.edges.length, 'connection', 'connections') + '</span><span>Drawn from the template’s Terraform, so it cannot drift from the code.</span></div></div>';
	}
	/** The pan area takes the diagram's own shape, so it is not letterboxed. Set through CSSOM: the CSP allows no style attributes. */
	function sizePanAreas() {
		document.querySelectorAll('[data-pan]').forEach(area => {
			const svg = area.querySelector('svg');
			const vb = svg && svg.dataset.vb ? svg.dataset.vb.split(' ').map(Number) : undefined;
			if (vb) { area.style.aspectRatio = vb[2] + ' / ' + vb[3]; }
		});
	}
	function setVB(svg, vb) {
		svg.setAttribute('viewBox', vb.map(v => v.toFixed(1)).join(' '));
		if (svg.closest('#hero')) { S.heroVB = { key: S.key, vb }; }
	}
	function zoomSvg(svg, f, px, py) {
		const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number), base = svg.dataset.vb.split(' ').map(Number);
		const w = clamp(vb[2] * f, base[2] / 5, base[2] * 3), h = vb[3] * (w / vb[2]);
		setVB(svg, [vb[0] + (vb[2] - w) * (px == null ? .5 : px), vb[1] + (vb[3] - h) * (py == null ? .5 : py), w, h]);
	}
	function restoreHero() {
		const svg = $('#hero svg');
		if (svg && S.heroVB && S.heroVB.key === S.key) { svg.setAttribute('viewBox', S.heroVB.vb.map(v => v.toFixed(1)).join(' ')); }
	}

	/* ---------- Library ---------- */
	const FACETS = [
		['templateType', 'Type', t => [t.templateType]],
		['categories', 'Category', t => t.categories],
		['difficulty', 'Difficulty', t => [t.difficulty]],
		['trust', 'Certification', t => [t.trust]],
		['source', 'Source', t => [t.source]],
	];
	const FACET_ORDER = { difficulty: ['beginner', 'intermediate', 'advanced'], trust: ['official', 'verified', 'community', 'local'], source: ['builtin', 'remote', 'local'] };
	const facetLabel = (key, v) => key === 'trust' ? TRUST[v] || cap(v) : key === 'source' ? SOURCE[v] || cap(v) : cap(v);
	function matchesQuery(t) {
		if (!S.q) { return true; }
		const hay = (t.name + ' ' + t.id + ' ' + t.summary + ' ' + t.tags.join(' ') + ' ' + t.categories.join(' ') + ' ' + t.providers.join(' ') + ' ' + ((S.previews[keyOf(t)] || { nodes: [] }).nodes.map(n => n.type + ' ' + n.label).join(' '))).toLowerCase();
		return S.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
	}
	function matchesProvider(t) {
		if (S.provider === 'all') { return true; }
		if (S.provider === 'mine') { return t.source === 'local'; }
		return providerOf(t) === S.provider;
	}
	function filtered(skipFacet) {
		return templates().filter(t => matchesQuery(t) && matchesProvider(t) && FACETS.every(([key, , get]) => key === skipFacet || S.facets[key].size === 0 || get(t).some(v => S.facets[key].has(v))));
	}
	function sorted(list) {
		const l = list.slice();
		if (S.sort === 'name') { l.sort((a, b) => a.name.localeCompare(b.name)); }
		else if (S.sort === 'provider') { l.sort((a, b) => (P[providerOf(a)] || '').localeCompare(P[providerOf(b)] || '') || a.name.localeCompare(b.name)); }
		else if (S.sort === 'difficulty') { l.sort((a, b) => LEVEL[a.difficulty] - LEVEL[b.difficulty] || a.name.localeCompare(b.name)); }
		else if (S.sort === 'resources') { l.sort((a, b) => b.resourceCount - a.resourceCount || a.name.localeCompare(b.name)); }
		return l;
	}
	const facetCount = () => FACETS.reduce((n, [k]) => n + S.facets[k].size, 0);
	const isFiltering = () => !!S.q || S.provider !== 'all' || facetCount() > 0;
	function providerBadge(t, size) {
		const p = providerOf(t), mark = PROVIDER_MARK[p];
		return '<span class="pbadge s' + size + '" title="' + esc(P[p] || p) + '">' + (mark && S.assets ? '<img src="' + esc(iconUrl(mark)) + '" alt="">' : '<svg viewBox="0 0 16 16" aria-hidden="true">' + glyph(p === 'kubernetes' ? 'wheel' : 'cloud', 0, 0, 1) + '</svg>') + '</span>';
	}
	const levelHtml = d => '<span class="lvl" title="' + esc(cap(d)) + '"><span class="bars" aria-hidden="true">' + [1, 2, 3].map(i => '<i' + (i <= (LEVEL[d] || 0) ? ' class="on"' : '') + '></i>').join('') + '</span>' + esc(cap(d)) + '</span>';
	function cardLabel(t) {
		return t.name + ', ' + (TRUST[t.trust] || t.trust) + ', ' + cap(t.difficulty) + ', ' + plural(t.resourceCount, 'resource', 'resources') + ', ' + (SOURCE[t.source] || t.source);
	}
	function cardHtml(t) {
		const key = keyOf(t);
		const tags = t.categories.map(x => '<span class="tag">' + esc(cap(x)) + '</span>').join('') + trustPill(t);
		return '<article class="card" data-open="' + esc(key) + '" aria-label="' + esc(cardLabel(t)) + '">' +
			'<div class="preview" data-pv="' + esc(key) + '">' + previewHtml(t) + '<div class="pv-actions"><button type="button" class="btn secondary" data-quick="' + esc(key) + '">Quick look</button><button type="button" class="btn primary" data-wizard="' + esc(key) + '"' + (canCreate(t) ? '' : ' disabled') + '>Use template</button></div></div>' +
			'<div class="card-body">' +
			'<div class="card-head">' + providerBadge(t, 26) + '<h3><button type="button" class="card-title" data-open="' + esc(key) + '">' + esc(t.name) + '</button></h3></div>' +
			'<p class="sum">' + esc(t.summary) + '</p>' +
			'<div class="labels">' + tags + '</div>' +
			'<div class="facts2"><span class="foot-l"><span class="count">' + plural(t.resourceCount, 'resource', 'resources') + '</span>' + levelHtml(t.difficulty) + '</span><span data-cs="' + esc(key) + '" title="' + esc(constraintText(t)) + '">' + compatHtml(t) + '</span></div>' +
			'</div></article>';
	}
	function listHtml(list) {
		return '<div class="list"><table><thead><tr><th>Name</th><th>Provider</th><th>Type</th><th>Difficulty</th><th class="num">Resources</th><th>Constraint</th><th>Fit</th></tr></thead><tbody>' +
			list.map(t => '<tr data-open="' + esc(keyOf(t)) + '" tabindex="0"><td><strong>' + esc(t.name) + '</strong><br><span class="mono">' + esc(t.id + ' · v' + t.version) + '</span></td><td><span class="prov-dot ' + esc(providerOf(t)) + '"></span>' + esc(P[providerOf(t)] || providerOf(t)) + '</td><td>' + esc(cap(t.templateType)) + '</td><td>' + esc(cap(t.difficulty)) + '</td><td class="num">' + t.resourceCount + '</td><td><code>' + esc(constraintText(t)) + '</code></td><td>' + compatHtml(t) + '</td></tr>').join('') +
			'</tbody></table></div>';
	}
	const collection = (list, featured) => S.layout === 'grid' ? '<div class="grid' + (featured ? ' featured' : '') + '">' + list.map(cardHtml).join('') + '</div>' : listHtml(list);
	function freshness() {
		const sources = (S.page && S.page.sources) || [];
		const parts = sources.map(src => st('ok', src.templateCount + ' ' + (src.id === 'builtin' ? 'built in' : src.trust === 'local' ? 'in My Library' : 'from ' + src.name) + ', checked'));
		if (!sources.some(src => src.id !== 'builtin' && src.trust !== 'local')) { parts.push(st('info', 'Online catalogue not set up')); }
		return parts.map(p => '<span>' + p + '</span>').join('');
	}
	function renderLibrary() {
		const all = templates();
		const view = $('#view');
		if (S.loading && !S.page) {
			view.innerHTML = '<div class="lib"><div class="lib-hero"><div class="t"><h1>Template Library</h1><p>Loading templates…</p></div></div><div class="grid">' + [1, 2, 3, 4, 5, 6].map(() => '<div class="card"><div class="preview"><div class="skel"></div></div><div class="card-body"><div class="skel">&nbsp;</div><div class="skel">&nbsp;</div></div></div>').join('') + '</div></div>';
			return;
		}
		if (S.error && !S.page) {
			view.innerHTML = '<div class="lib"><div class="lib-hero"><div class="t"><h1>Template Library</h1></div></div><div class="banner err"><span class="ic">' + ICON.err + '</span><p><strong>The template library could not load.</strong> ' + esc(S.error) + '</p></div><div><button type="button" class="btn secondary" data-refresh>' + ICON.refresh + 'Try again</button></div></div>';
			return;
		}
		const shown = filtered();
		const chip = (key, label) => {
			const n = key === 'all' ? all.filter(matchesQuery).length : all.filter(t => matchesQuery(t) && (key === 'mine' ? t.source === 'local' : providerOf(t) === key)).length;
			if (n === 0 && key !== 'all' && key !== 'mine' && S.provider !== key) { return ''; }
			return '<button type="button" class="chip" data-chip="' + key + '" aria-pressed="' + (S.provider === key) + '"' + (n === 0 && key !== 'all' && S.provider !== key ? ' disabled' : '') + '>' + esc(label) + '<span class="n">' + n + '</span></button>';
		};
		const facets = FACETS.map(([key, label, get]) => {
			const values = [...new Set(all.flatMap(get))];
			const order = FACET_ORDER[key];
			values.sort((a, b) => order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b));
			if (values.length < 2 && !S.facets[key].size) { return ''; }
			const base = filtered(key);
			return '<fieldset class="facet"><h3>' + esc(label) + '</h3>' + values.map(v => {
				const n = base.filter(t => get(t).includes(v)).length;
				const id = 'f-' + key + '-' + v.replace(/[^a-z0-9-]/gi, '_');
				return '<label class="' + (n ? '' : 'zero') + '" for="' + esc(id) + '"><input type="checkbox" id="' + esc(id) + '" data-facet="' + key + '" value="' + esc(v) + '"' + (S.facets[key].has(v) ? ' checked' : '') + '>' + esc(facetLabel(key, v)) + '<span class="n">' + n + '</span></label>';
			}).join('') + '</fieldset>';
		}).join('');
		let results;
		if (isFiltering()) {
			results = shown.length
				? '<section class="shelf"><div class="shelf-head"><h2>Results</h2><span class="n">' + shown.length + ' of ' + all.length + '</span></div>' + collection(sorted(shown)) + '</section>'
				: '<div class="empty-state"><strong>No templates match</strong><span>Try fewer filters, or search by resource type such as “nat_gateway”.</span><button type="button" class="btn secondary" data-clear>Clear filters</button></div>';
		} else if (!all.length) {
			results = '<div class="empty-state"><strong>No templates yet</strong><span>Import a .cftemplate.zip package to add one to My Library.</span><button type="button" class="btn secondary" data-import>Import file…</button></div>';
		} else {
			const featured = all.filter(t => t.source === 'builtin' && t.trust === 'official' && t.lifecycle !== 'deprecated').slice(0, 6);
			const mine = all.filter(t => t.source === 'local');
			const downloaded = all.filter(t => t.source === 'remote');
			results = (featured.length ? '<section class="shelf"><div class="shelf-head"><h2>Featured</h2><span class="sub">Good places to start, picked by CloudForge</span></div>' + collection(featured, true) + '</section>' : '') +
				(mine.length ? '<section class="shelf"><div class="shelf-head"><h2>My Library</h2><span class="n">' + mine.length + '</span></div>' + collection(sorted(mine)) + '</section>' : '') +
				'<section class="shelf"><div class="shelf-head"><h2>Downloaded</h2><span class="n">' + downloaded.length + '</span></div>' + (downloaded.length ? collection(sorted(downloaded)) : '<p class="hint">Templates you download from an online source appear here. The CloudForge official catalogue is not set up yet, so there is nothing to download.</p>') + '</section>' +
				'<section class="shelf"><div class="shelf-head"><h2>All templates</h2><span class="n">' + all.length + '</span></div>' + collection(sorted(all)) + '</section>';
		}
		const activeChip = S.provider;
		view.innerHTML =
			'<div class="lib">' +
			'<div class="lib-hero"><div class="t"><h1>Template Library</h1><p>Start from an architecture that already works. Every template is checked on this computer before you use it, and nothing is ever run.</p></div><button type="button" class="btn ghost" data-refresh title="Check the library again">' + ICON.refresh + 'Refresh</button><button type="button" class="btn secondary" data-import>' + ICON.import + 'Import file…</button></div>' +
			'<p class="fresh">' + freshness() + (S.project && S.project.activeName ? '<span>' + st('info', 'Fit is checked against ' + S.project.activeName) + '</span>' : '') + '</p>' +
			'<div class="toolbar"><div class="search">' + ICON.search + '<input class="input" id="q" type="search" placeholder="Search names, tags or resource types" aria-label="Search templates" value="' + esc(S.q) + '">' + (S.q ? '' : '<span class="kbd" aria-hidden="true">/</span>') + '</div>' +
			'<label for="sort" class="note">Sort</label><select class="input" id="sort">' +
			[['recommended', 'Recommended'], ['name', 'Name'], ['provider', 'Cloud provider'], ['difficulty', 'Difficulty'], ['resources', 'Resource count']].map(([v, l]) => '<option value="' + v + '"' + (S.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
			'<div class="seg" role="group" aria-label="Layout"><button type="button" data-layout="grid" aria-pressed="' + (S.layout === 'grid') + '" title="Grid" aria-label="Grid">' + ICON.grid + '</button><button type="button" data-layout="list" aria-pressed="' + (S.layout === 'list') + '" title="List" aria-label="List">' + ICON.list + '</button></div>' +
			'<button type="button" class="btn secondary filters-btn" data-drawer>' + ICON.filter + 'Filters' + (facetCount() ? ' (' + facetCount() + ')' : '') + '</button></div>' +
			'<div class="chips" role="group" aria-label="Provider">' + chip('all', 'All') + chip('azure', 'Azure') + chip('aws', 'AWS') + chip('gcp', 'Google Cloud') + chip('kubernetes', 'Kubernetes') + chip('multi', 'Multi-cloud') + chip('mine', 'My Library') + (activeChip === 'other' ? chip('other', 'Other') : '') + '</div>' +
			'<div class="lib-body"><aside class="facets' + (S.drawer ? ' open' : '') + '" aria-label="Filters">' + facets + '<button type="button" class="btn ghost clear" data-clear>Clear filters</button>' + (S.drawer ? '<button type="button" class="btn primary" data-drawer>Show ' + plural(shown.length, 'result', 'results') + '</button>' : '') + '</aside>' +
			'<div class="results">' + results + '</div></div></div>' + (S.drawer ? '<div class="drawer-scrim" data-drawer></div>' : '');
	}

	/* ---------- Details ---------- */
	const DTABS = [['overview', 'Overview'], ['architecture', 'Architecture'], ['resources', 'Resources'], ['parameters', 'Parameters'], ['terraform', 'Terraform'], ['compatibility', 'Compatibility'], ['security', 'Safety check'], ['docs', 'Docs'], ['source', 'Source & licence'], ['costs', 'Costs (later)']];
	function canCreate() { return !!S.project; }
	/** A free architecture name from the template id: hub-spoke, then hub-spoke-2 and so on. */
	function suggestName(t) {
		const base = (t.id.split('.').pop() || 'architecture').replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'architecture';
		const taken = new Set(((S.project && S.project.architectures) || []).map(a => a.toLowerCase()));
		if (!taken.has(base)) { return base; }
		for (let n = 2; n < 1000; n++) { if (!taken.has(base + '-' + n)) { return base + '-' + n; } }
		return base + '-copy';
	}
	function createBlocker(t, d) {
		if (!S.project) { return 'Open a CloudForge project first. The new architecture is created inside it.'; }
		if (d && d.details && !d.details.usable) { return 'This template has safety problems and cannot be used. See Safety check.'; }
		return '';
	}
	function hclHtml(text) {
		const KW = /^(\s*)(resource|data|variable|output|module|provider|terraform|locals|moved|import|check|required_providers|backend)\b/;
		return text.split('\n').map(line => {
			let out = '', i = 0;
			const kw = KW.exec(line);
			if (kw) { out += esc(kw[1]) + '<span class="k">' + kw[2] + '</span>'; i = kw[0].length; }
			while (i < line.length) {
				const ch = line[i];
				if (ch === '#' || (ch === '/' && line[i + 1] === '/')) { out += '<span class="c">' + esc(line.slice(i)) + '</span>'; break; }
				if (ch === '"') {
					let j = i + 1;
					while (j < line.length && line[j] !== '"') { j += line[j] === '\\' ? 2 : 1; }
					out += '<span class="s">' + esc(line.slice(i, j + 1)) + '</span>';
					i = j + 1;
					continue;
				}
				out += esc(ch);
				i++;
			}
			return out;
		}).join('\n');
	}
	function markdownHtml(text) {
		const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 <span class="mono">($2)</span>');
		const lines = text.split(/\r?\n/);
		let out = '', para = [], list = [], code = null;
		const flush = () => { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } if (list.length) { out += '<ul>' + list.map(li => '<li>' + inline(li) + '</li>').join('') + '</ul>'; list = []; } };
		for (const line of lines) {
			if (code !== null) { if (/^```/.test(line)) { out += '<pre class="mono">' + esc(code.join('\n')) + '</pre>'; code = null; } else { code.push(line); } continue; }
			if (/^```/.test(line)) { flush(); code = []; continue; }
			const h = /^(#{1,6})\s+(.*)$/.exec(line);
			if (h) { flush(); out += (h[1].length <= 2 ? '<h3>' : '<h4>') + inline(h[2]) + (h[1].length <= 2 ? '</h3>' : '</h4>'); continue; }
			const li = /^\s*[-*]\s+(.*)$/.exec(line);
			if (li) { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } list.push(li[1]); continue; }
			if (!line.trim()) { flush(); continue; }
			if (list.length) { out += '<ul>' + list.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'; list = []; }
			para.push(line.trim());
		}
		if (code !== null) { out += '<pre class="mono">' + esc(code.join('\n')) + '</pre>'; }
		flush();
		return '<div class="readme">' + out + '</div>';
	}
	function containerRows(dg) {
		const kids = id => dg.nodes.filter(n => n.parent === id);
		return dg.nodes.filter(n => n.container).map(c => '<tr><td>' + esc(c.label + ' ' + c.name) + (c.detail ? ' <span class="mono">' + esc(c.detail) + '</span>' : '') + '<br><span class="mono note">' + esc(c.id) + '</span></td><td>' + esc(kids(c.id).map(k => k.label + ' ' + k.name).join(', ') || 'Nothing yet; you add workloads here') + '</td></tr>').join('');
	}
	function detailPanel(t, d) {
		const det = d.details, dg = d.diagram;
		switch (S.detailTab) {
			case 'overview': {
				const byType = new Map();
				dg.nodes.forEach(n => { const e = byType.get(n.label) || { n: 0, icon: n.icon }; e.n++; byType.set(n.label, e); });
				const high = det.findings.filter(f => f.risk === 'high').length;
				return '<div class="two"><div class="panel"><h2>What you get</h2><div class="tbl"><table><tbody>' + [...byType].map(([label, e]) => '<tr><td><span class="ty">' + (e.icon && S.assets ? '<img src="' + esc(iconUrl(e.icon)) + '" alt="">' : '') + esc(label) + '</span></td><td class="num">' + e.n + '</td></tr>').join('') + '</tbody></table></div></div>' +
					'<div class="panel"><h2>Tags</h2><div class="tags">' + (t.tags.length ? t.tags.map(g => '<span class="pill">' + esc(g) + '</span>').join('') : '<span class="note">No tags</span>') + '</div>' +
					(t.certifications.length ? '<h2>Certifications</h2><div class="tags">' + t.certifications.map(g => '<span class="pill">' + esc(g.toUpperCase()) + '</span>').join('') + '</div>' : '') +
					'<h2>Safety check</h2><p>' + (det.usable ? st(high ? 'warn' : 'ok', high ? plural(high, 'high-risk finding', 'high-risk findings') + ', accepted on import' : 'No high-risk findings') : st('err', 'Cannot be used')) + '</p><p class="note">Checked on this computer for provisioners, external programs, web requests during plan, unpinned modules, files outside the template and secret-looking values. Nothing is run.</p></div></div>';
			}
			case 'architecture': {
				const rows = containerRows(dg);
				return '<div class="two"><div class="panel"><h2>Containers</h2>' + (rows ? '<div class="tbl"><table><thead><tr><th>Container</th><th>Holds</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>No containers; the resources sit directly in the provider.</p>') + '</div>' +
					'<div class="panel"><h2>Connections</h2>' + (dg.edges.length ? '<div class="tbl"><table><thead><tr><th>From</th><th>Uses</th></tr></thead><tbody>' + dg.edges.map(([a, b]) => '<tr><td class="mono">' + esc(a) + '</td><td class="mono">' + esc(b) + '</td></tr>').join('') + '</tbody></table></div>' : '<p>No references between resources; containment shows how they fit.</p>') +
					'<p class="note">Arrows are Terraform references, so the diagram cannot drift from the code.</p></div></div>';
			}
			case 'resources':
				return '<div class="panel"><div class="tbl"><table><thead><tr><th>Address</th><th>Kind</th><th>File</th></tr></thead><tbody>' + dg.nodes.map(n => '<tr><td class="mono">' + esc(n.id) + '</td><td><span class="ty">' + (n.icon && S.assets ? '<img src="' + esc(iconUrl(n.icon)) + '" alt="">' : '') + esc(n.label) + '</span></td><td class="mono">' + esc(n.file + ':' + n.line) + '</td></tr>').join('') + '</tbody></table></div></div>';
			case 'parameters':
				return d.fields.length
					? '<div class="panel"><div class="tbl"><table><thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>' + d.fields.map(f => '<tr><td class="mono">' + esc(f.name) + '</td><td class="mono">' + esc(f.kind) + '</td><td class="mono">' + esc(f.skip === 'sensitive' ? '(sensitive)' : f.defaultText || (f.required ? '(required)' : '')) + '</td><td>' + esc(f.description || '') + (f.skip === 'cloudAccount' ? ' <span class="note">Not asked for: cloud account ids belong to Cloud Connections.</span>' : f.skip === 'complex' ? ' <span class="note">Set this in terraform.tfvars after creating.</span>' : '') + '</td></tr>').join('') + '</tbody></table></div><p class="note">Passwords, keys and tokens are always sensitive variables. A template never carries their values, and CloudForge never writes them.</p></div>'
					: '<div class="panel"><p>This template has no parameters. Its values are written into the Terraform, so edit them on the canvas after you create it.</p></div>';
			case 'terraform': {
				const files = det.terraformFiles;
				const f = files.find(x => x.fileName === S.tfFile) || files[0];
				if (!f) { return '<div class="panel"><p>No Terraform files.</p></div>'; }
				return '<div class="panel"><div class="files" role="group" aria-label="Files">' + files.map(x => '<button type="button" data-tf="' + esc(x.fileName) + '" aria-pressed="' + (x === f) + '">' + esc(x.fileName) + '</button>').join('') + '<span class="sp"></span><button type="button" class="btn ghost" data-openfile="' + esc(f.fileName) + '">Open in editor</button></div><pre class="code">' + hclHtml(f.contents) + '</pre><p class="note">Read-only. The template’s files are copied as they are; you edit the copy in your architecture.</p></div>';
			}
			case 'compatibility': {
				const entry = S.compat[keyOf(t)];
				const declared = '<div class="tbl"><table><thead><tr><th>Provider</th><th>Template allows</th></tr></thead><tbody>' + Object.entries(t.compatibility).map(([a, r]) => '<tr><td class="mono">' + esc(a) + '</td><td class="mono">' + esc(r) + '</td></tr>').join('') + '</tbody></table></div>';
				if (!S.project || !S.project.activeName) {
					return '<div class="panel"><div class="banner info"><span class="ic">' + ICON.info + '</span><p>Open an architecture to check this template against its provider lock file. A new architecture always gets its own lock file, so creating one from a template never conflicts.</p></div>' + declared + '</div>';
				}
				if (!entry || entry.pending) { return '<div class="panel"><p>Checking against <strong>' + esc(S.project.activeName) + '</strong>…</p>' + declared + '</div>'; }
				if (entry.error) { return '<div class="panel"><div class="banner err"><span class="ic">' + ICON.err + '</span><p>' + esc(entry.error) + '</p></div>' + declared + '</div>'; }
				const STATUS = { compatible: ['ok', 'Fits'], compatibleUntested: ['ok', 'Allowed, untested'], conflictWithLock: ['warn', 'Conflicts with lock'], conflictWithConstraint: ['warn', 'Conflicts with constraint'], notInProject: ['info', 'Will be added'] };
				const c = compatSummary(t);
				return '<div class="panel"><p>Checked against <strong>' + esc(S.project.activeName) + '</strong> with no network access.</p><div class="tbl"><table><thead><tr><th>Provider</th><th>Template allows</th><th>This architecture</th><th>Result</th></tr></thead><tbody>' +
					entry.result.providers.map(p => '<tr><td class="mono">' + esc(p.provider) + '</td><td class="mono">' + esc(p.templateConstraint || '') + '</td><td class="mono">' + esc(p.locked ? p.locked + ' (lock file)' : p.projectConstraint || 'Not used yet') + '</td><td>' + st(STATUS[p.status][0], STATUS[p.status][1]) + '</td></tr>').join('') + '</tbody></table></div>' +
					(entry.result.unknownResourceTypes.length ? '<p class="note">Not in the provider catalogue on this computer: ' + esc(entry.result.unknownResourceTypes.join(', ')) + '.</p>' : '') +
					(c.kind === 'warn' ? '<div class="banner warn"><span class="ic">' + ICON.warn + '</span><p><strong>How to use it here.</strong> Create it as a new architecture, which gets its own lock file. Adding it to ' + esc(S.project.activeName) + ' needs a template version that allows the locked provider.</p></div>' : '') + '</div>';
			}
			case 'security': {
				const problems = det.problems, findings = det.findings;
				return '<div class="panel">' + (det.usable ? '<p>' + st('ok', 'Usable') + '</p>' : '<div class="banner err"><span class="ic">' + ICON.err + '</span><p><strong>This template cannot be used.</strong> Fix the problems below in the package and import it again.</p></div>') +
					'<h2>Findings</h2>' + (findings.length ? '<div class="tbl"><table><thead><tr><th>Risk</th><th>Where</th><th>What</th></tr></thead><tbody>' + findings.map(f => '<tr><td>' + st(f.risk === 'high' ? 'warn' : 'info', f.risk === 'high' ? 'High' : 'Notice') + '</td><td class="mono">' + esc(f.file + (f.line ? ':' + f.line : '')) + '</td><td>' + esc(f.message) + '</td></tr>').join('') + '</tbody></table></div>' : '<p>' + st('ok', 'No findings') + '</p>') +
					(problems.length ? '<h2>Package problems</h2><div class="tbl"><table><tbody>' + problems.map(p => '<tr><td>' + st(p.severity === 'error' ? 'err' : 'warn', cap(p.severity)) + '</td><td>' + esc(p.message) + (p.field ? ' <span class="mono note">' + esc(p.field) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '') +
					'<p class="note">Checked on this computer. CloudForge never runs a template’s Terraform.</p></div>';
			}
			case 'docs':
				return '<div class="panel">' + (det.readme ? markdownHtml(det.readme) : '<p>' + esc(t.summary) + '</p><p class="note">This template has no README.</p>') + '</div>';
			case 'source':
				return '<div class="panel"><dl class="kv"><dt>Id</dt><dd class="mono">' + esc(t.id) + '</dd><dt>Version</dt><dd class="mono">' + esc(t.version) + '</dd><dt>Source</dt><dd>' + esc(t.source === 'builtin' ? 'Built into CloudForge' : t.source === 'local' ? 'Imported from a file into My Library' : 'Downloaded') + '</dd><dt>Publisher</dt><dd>' + esc(t.publisher) + '</dd><dt>Trust</dt><dd>' + trustPill(t) + '</dd><dt>Licence</dt><dd>' + esc(t.license) + '</dd><dt>Package SHA-256</dt><dd class="mono">' + esc(det.archiveSha256) + '</dd></dl><p class="note">Every file matched its SHA-256 in the manifest when the package was opened.</p></div>';
			case 'costs':
				return '<div class="panel"><div class="banner info"><span class="ic">' + ICON.info + '</span><p><strong>Not in v1.</strong> A cost estimate for the template, from the same cost engine the builder uses, is planned. The builder keeps the real figure for your project.</p></div></div>';
		}
		return '';
	}
	function renderDetails() {
		const t = byKey(S.key);
		const view = $('#view');
		if (!t) {
			view.innerHTML = '<div class="det"><div class="crumbs"><button type="button" data-go="library">Template Library</button></div><div class="empty-state"><strong>That template is no longer available</strong><button type="button" class="btn secondary" data-go="library">Back to the library</button></div></div>';
			return;
		}
		const d = S.details[S.key];
		const blocker = createBlocker(t, d);
		const c = compatSummary(t);
		const head = '<div class="crumbs"><button type="button" data-go="library">Template Library</button><span aria-hidden="true">›</span><span>' + esc(t.name) + '</span></div>';
		const info = '<aside class="det-info">' +
			'<div class="titlerow">' + providerBadge(t, 42) + '<div class="titles"><h1>' + esc(t.name) + '</h1><div class="idline"><span class="mono">' + esc(t.id) + '</span><span>v' + esc(t.version) + '</span>' + trustPill(t) + '</div></div></div>' +
			'<p>' + esc(t.summary) + '</p>' +
			'<div class="det-actions"><button type="button" class="btn primary" data-wizard="' + esc(S.key) + '"' + (blocker ? ' disabled aria-describedby="why-create"' : '') + '>Create architecture</button>' +
			'<button type="button" class="btn secondary" data-add="' + esc(S.key) + '">Add to current architecture</button>' +
			'<button type="button" class="btn ghost" data-menu aria-haspopup="menu" aria-expanded="' + S.menu + '" title="More actions" aria-label="More actions">⋯</button>' +
			(S.menu ? '<div class="menu" role="menu"><button role="menuitem" type="button" data-copy="' + esc(t.id) + '">Copy template id</button>' + (t.source === 'local' ? '<button role="menuitem" type="button" data-remove="' + esc(S.key) + '">Remove from My Library…</button>' : '') + '</div>' : '') +
			(blocker ? '<span class="why" id="why-create">' + st('info', blocker) + '</span>' : '') +
			'</div>' +
			(c.kind && c.long ? '<div class="banner ' + c.kind + '"><span class="ic">' + ICON[c.kind] + '</span><p>' + esc(c.long) + '</p></div>' : '') +
			'<dl class="kv"><dt>Type</dt><dd>' + esc(cap(t.templateType)) + '</dd><dt>Categories</dt><dd>' + esc(t.categories.map(cap).join(', ')) + '</dd><dt>Difficulty</dt><dd>' + esc(cap(t.difficulty)) + '</dd><dt>Resources</dt><dd>' + t.resourceCount + (d && d.details ? ' in ' + plural(d.details.terraformFiles.length, 'file', 'files') : '') + '</dd><dt>Provider</dt><dd><code>' + esc(constraintText(t)) + '</code></dd><dt>Parameters</dt><dd>' + (d && d.fields ? (d.fields.filter(f => !f.skip).length || 'None') : '…') + '</dd><dt>Publisher</dt><dd>' + esc(t.publisher) + '</dd></dl>' +
			'</aside>';
		if (!d || d.pending) {
			view.innerHTML = '<div class="det">' + head + '<div class="det-top">' + panHtml(t, undefined, 'hero') + info + '</div></div>';
			return;
		}
		if (d.error) {
			view.innerHTML = '<div class="det">' + head + '<div class="banner err"><span class="ic">' + ICON.err + '</span><p><strong>The template could not be opened.</strong> ' + esc(d.error) + '</p></div></div>';
			return;
		}
		view.innerHTML = '<div class="det">' + head + '<div class="det-top">' + panHtml(t, d.diagram, 'hero') + info + '</div>' +
			'<div class="dtabs" role="tablist" aria-label="Template details">' + DTABS.map(([k, l]) => '<button type="button" role="tab" id="dt-' + k + '" aria-selected="' + (S.detailTab === k) + '" tabindex="' + (S.detailTab === k ? 0 : -1) + '" data-dtab="' + k + '"' + (k === 'costs' ? ' class="later"' : '') + '>' + l + '</button>').join('') + '</div>' +
			'<div role="tabpanel" aria-labelledby="dt-' + S.detailTab + '">' + detailPanel(t, d) + '</div></div>';
		restoreHero();
	}

	/* ---------- Quick look and create wizard ---------- */
	let lastFocus = null;
	function openModal(html, size) {
		lastFocus = document.activeElement;
		$('#modal-root').innerHTML = '<div class="modal-wrap" data-scrim><div class="modal' + (size ? ' ' + size : '') + '" role="dialog" aria-modal="true" aria-labelledby="m-title">' + html + '</div></div>';
		sizePanAreas();
		const f = $('#modal-root .modal [autofocus]') || $('#modal-root .modal button, #modal-root .modal input');
		if (f) { f.focus(); }
	}
	function closeModal() {
		$('#modal-root').innerHTML = '';
		S.modal = undefined; S.quick = undefined; S.wizard = undefined;
		if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) { lastFocus.focus(); }
	}
	const modalOpen = () => !!$('#modal-root .modal');
	function quickHtml(t) {
		const d = S.details[keyOf(t)];
		return '<div class="m-head"><div class="top"><h2 id="m-title">' + esc(t.name) + '</h2>' + trustPill(t) + '<button type="button" class="iconbtn" data-close-modal title="Close (Esc)" aria-label="Close">' + ICON.close + '</button></div></div>' +
			'<div class="m-body ql">' + panHtml(t, d && d.diagram || S.previews[keyOf(t)], 'ql') + '<p>' + esc(t.summary) + '</p></div>' +
			'<div class="m-foot"><span class="note">' + esc((P[providerOf(t)] || '') + ' · ' + plural(t.resourceCount, 'resource', 'resources') + ' · ') + compatHtml(t) + '</span><span class="sp"></span><button type="button" class="btn secondary" data-open="' + esc(keyOf(t)) + '">Open details</button><button type="button" class="btn primary" data-wizard="' + esc(keyOf(t)) + '"' + (canCreate(t) ? '' : ' disabled') + '>Use template</button></div>';
	}
	const NAME_BAD = /[<>:"/\\|?*\u0000-\u001f]/;
	const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
	function nameProblem(name) {
		const n = name.trim();
		if (!n) { return 'Give the architecture a name.'; }
		if (n.length > 255 || NAME_BAD.test(n) || n.endsWith('.') || RESERVED.test(n.split('.')[0])) { return 'Use a valid folder name: no < > : " / \\ | ? * and no trailing dot.'; }
		if (((S.project && S.project.architectures) || []).some(a => a.toLowerCase() === n.toLowerCase())) { return 'An architecture with that name already exists. Choose another name; CloudForge never overwrites one.'; }
		return '';
	}
	const STEPS = ['Name', 'Providers', 'Parameters', 'Review'];
	function fieldHtml(f, W) {
		const value = W.values[f.name] ?? f.defaultText;
		const problem = W.errors[f.name];
		const id = 'p-' + f.name;
		const ty = '<span class="ty mono"> ' + esc(f.kind) + (f.required && !f.defaultText ? ' · required' : '') + '</span>';
		if (f.skip) {
			const why = f.skip === 'cloudAccount' ? 'Not asked for here. Cloud account ids belong to Cloud Connections; set it yourself before you plan.' : f.skip === 'sensitive' ? 'Sensitive. Set it in your terminal (TF_VAR_' + f.name + '); CloudForge never writes it.' : 'A complex value. Set it in terraform.tfvars after creating.';
			return '<div class="field skipped"><span class="label">' + esc(f.title) + ty + '</span><span class="help">' + esc(why) + '</span></div>';
		}
		let input;
		if (f.kind === 'bool') {
			input = '<select class="input" id="' + esc(id) + '" data-param="' + esc(f.name) + '"><option value="true"' + (value === 'true' ? ' selected' : '') + '>On</option><option value="false"' + (value !== 'true' ? ' selected' : '') + '>Off</option></select>';
		} else if (f.options) {
			input = '<select class="input" id="' + esc(id) + '" data-param="' + esc(f.name) + '">' + f.options.map(o => '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
		} else if (f.kind === 'map') {
			input = '<textarea class="input mono" id="' + esc(id) + '" data-param="' + esc(f.name) + '" rows="3" placeholder="key=value, one per line"' + (problem ? ' aria-invalid="true"' : '') + '>' + esc(value) + '</textarea>';
		} else {
			input = '<input class="input mono" id="' + esc(id) + '" data-param="' + esc(f.name) + '" value="' + esc(value) + '"' + (f.kind === 'number' ? ' inputmode="decimal"' : '') + (f.required && !f.defaultText ? ' placeholder="Required"' : f.kind === 'list' ? ' placeholder="Comma separated"' : '') + (problem ? ' aria-invalid="true" aria-describedby="' + esc(id) + '-err"' : '') + '>';
		}
		return '<div class="field"><label for="' + esc(id) + '">' + esc(f.title) + ty + '</label>' + input +
			(f.description ? '<span class="help">' + esc(f.description) + '</span>' : '') +
			(problem ? '<span class="problem" id="' + esc(id) + '-err">' + ICON.err + esc(problem) + '</span>' : '') + '</div>';
	}
	function wizardHtml() {
		const W = S.wizard, t = byKey(W.key), d = S.details[W.key];
		if (!t) { return ''; }
		let body = '';
		const ready = d && d.details;
		if (W.step === 1) {
			const problem = nameProblem(W.name);
			body = '<div class="field"><label for="w-name">Architecture name</label><input class="input" id="w-name" value="' + esc(W.name) + '" autofocus' + (problem ? ' aria-invalid="true" aria-describedby="w-name-err"' : '') + '><span class="help">Created as architectures/&lt;name&gt;/ in ' + esc(S.project ? S.project.name : 'this project') + '. It must be new; CloudForge never writes into an existing folder.</span>' +
				(problem ? '<span class="problem" id="w-name-err">' + ICON.err + esc(problem) + '</span>' : '<span class="st ok">' + ICON.ok + 'Name is free</span>') + '</div>';
		} else if (W.step === 2) {
			const entry = S.compat[W.key];
			body = '<p>The new architecture gets its own provider lock file the first time you run init, so it keeps the versions the author tested.</p>' +
				'<div class="tbl"><table><thead><tr><th>Provider</th><th>Template allows</th></tr></thead><tbody>' + Object.entries(t.compatibility).map(([a, r]) => '<tr><td class="mono">' + esc(a) + '</td><td class="mono">' + esc(r) + '</td></tr>').join('') + '</tbody></table></div>' +
				(entry && entry.result && S.project && S.project.activeName ? '<div class="banner ' + (compatSummary(t).kind || 'info') + '"><span class="ic">' + ICON[compatSummary(t).kind || 'info'] + '</span><p><strong>Compared with ' + esc(S.project.activeName) + ':</strong> ' + esc((entry.lines || []).join(' ')) + ' This only matters if you later copy resources between the two.</p></div>' : '') +
				'<p class="note">CloudForge does not download providers here. Get Ready does that when you choose, and runs init and plan offline.</p>';
		} else if (W.step === 3) {
			if (!ready) {
				body = '<p>Reading the template…</p>';
			} else if (!d.fields.length) {
				body = '<p>This template has no parameters. Its values are written into the Terraform; edit them on the canvas after you create it.</p>';
			} else {
				let group;
				body = d.fields.map(f => { const g = f.group && f.group !== group ? '<p class="group-title">' + esc(f.group) + '</p>' : ''; group = f.group; return g + fieldHtml(f, W); }).join('') +
					'<p class="note">Values go into terraform.tfvars in the new folder. Sensitive values are never written there.</p>';
			}
		} else {
			const files = ready ? d.details.terraformFiles.map(f => f.fileName) : [];
			const writesVars = ready && d.fields.some(f => !f.skip || f.skip === 'cloudAccount' || f.skip === 'sensitive');
			body = '<dl class="kv"><dt>Template</dt><dd>' + esc(t.name) + ' <span class="mono">v' + esc(t.version) + '</span></dd><dt>Name</dt><dd>' + esc(W.name.trim()) + '</dd><dt>Folder</dt><dd class="mono">architectures/' + esc(W.name.trim()) + '/</dd><dt>Providers</dt><dd class="mono">' + esc(constraintText(t)) + '</dd></dl>' +
				'<div><strong>Files to write</strong><div class="files">' + files.concat(writesVars ? ['terraform.tfvars'] : []).map(f => '<span class="pill mono">' + esc(f) + '</span>').join('') + '</div></div>' +
				(W.failure ? '<div class="banner err"><span class="ic">' + ICON.err + '</span><p>' + esc(W.failure) + '</p></div>' : '') +
				'<div class="banner info"><span class="ic">' + ICON.info + '</span><p><strong>Nothing is run.</strong> CloudForge writes these files and opens the canvas. It does not run terraform init, plan or apply.</p></div>';
		}
		const nextDisabled = (W.step === 1 && !!nameProblem(W.name)) || (W.step === 3 && (!ready || W.busy));
		return '<div class="m-head"><div class="top"><h2 id="m-title">Create architecture from ' + esc(t.name) + '</h2><button type="button" class="iconbtn" data-close-modal title="Close (Esc)" aria-label="Close">' + ICON.close + '</button></div>' +
			'<ol class="steps">' + STEPS.map((s, i) => '<li' + (i + 1 === W.step ? ' aria-current="step"' : i + 1 < W.step ? ' class="done"' : '') + '><b>' + (i + 1 < W.step ? '✓' : i + 1) + '</b>' + s + '</li>').join('') + '</ol></div>' +
			'<div class="m-body">' + body + '</div>' +
			'<div class="m-foot"><span class="note">Step ' + W.step + ' of 4</span><span class="sp"></span>' + (W.step > 1 ? '<button type="button" class="btn secondary" data-wstep="-1"' + (W.busy ? ' disabled' : '') + '>Back</button>' : '<button type="button" class="btn secondary" data-close-modal>Cancel</button>') +
			(W.step < 4 ? '<button type="button" class="btn primary" data-wstep="1"' + (nextDisabled ? ' disabled' : '') + '>Next</button>' : '<button type="button" class="btn primary" data-wcreate' + (W.busy || !ready ? ' disabled' : '') + '>' + (W.busy ? 'Creating…' : 'Create architecture') + '</button>') + '</div>';
	}
	function refreshModal(focusId) {
		const body = $('#modal-root .m-body'); const top = body ? body.scrollTop : 0;
		const active = document.activeElement;
		const keep = focusId || (active && active.id);
		const pos = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
		const html = S.modal === 'create' ? wizardHtml() : S.modal === 'quick' && S.quick ? quickHtml(byKey(S.quick)) : '';
		if (!html) { closeModal(); return; }
		$('#modal-root .modal').innerHTML = html;
		sizePanAreas();
		const nb = $('#modal-root .m-body'); if (nb) { nb.scrollTop = top; }
		const again = keep && document.getElementById(keep);
		if (again) { again.focus(); if (pos !== null && typeof again.setSelectionRange === 'function') { try { again.setSelectionRange(pos, pos); } catch { /* not a text input */ } } }
	}
	function needDetails(key) {
		const t = byKey(key);
		if (t && !S.details[key]) { S.details[key] = { pending: true }; post({ type: 'details', templateId: t.id, version: t.version }); }
	}
	function needCompat(key) {
		const t = byKey(key);
		if (t && S.project && S.project.activeName && !S.compat[key]) { S.compat[key] = { pending: true }; post({ type: 'compatibility', templateId: t.id, version: t.version }); }
	}
	function openWizard(key) {
		const t = byKey(key);
		if (!t || !canCreate(t)) { return; }
		needDetails(key);
		needCompat(key);
		S.wizard = { key, step: 1, name: suggestName(t), values: {}, errors: {}, busy: false };
		S.modal = 'create';
		openModal(wizardHtml());
	}
	function openQuick(key) {
		needDetails(key);
		S.quick = key; S.modal = 'quick';
		openModal(quickHtml(byKey(key)), 'xl');
	}

	/* ---------- Routing and render ---------- */
	function render() {
		const q = $('#q');
		const typing = q && document.activeElement === q;
		const pos = typing ? q.selectionStart : null;
		if (S.route === 'details') { renderDetails(); } else { renderLibrary(); }
		sizePanAreas();
		if (typing) { const again = $('#q'); if (again) { again.focus(); again.setSelectionRange(pos, pos); } }
		remember();
	}
	function go(route, key) {
		S.route = route; S.menu = false;
		if (route === 'details') {
			if (S.key !== key) { S.detailTab = 'overview'; S.tfFile = undefined; S.heroVB = undefined; }
			S.key = key; needDetails(key); needCompat(key);
		}
		render();
		window.scrollTo(0, 0);
	}
	/** Updates one card's preview and fit label without re-rendering the page. */
	function patchCards(key) {
		const t = byKey(key);
		if (!t) { return; }
		document.querySelectorAll('[data-pv="' + CSS.escape(key) + '"]').forEach(el => {
			const actions = el.querySelector('.pv-actions');
			el.innerHTML = previewHtml(t);
			if (actions) { el.appendChild(actions); }
		});
		document.querySelectorAll('[data-cs="' + CSS.escape(key) + '"]').forEach(el => { el.innerHTML = compatHtml(t); });
	}

	/* ---------- Messages from the extension ---------- */
	window.addEventListener('message', event => {
		const m = event.data;
		if (!m || typeof m.type !== 'string') { return; }
		switch (m.type) {
			case 'init':
				S.assets = typeof m.assets === 'string' ? m.assets.replace(/\/$/, '') : '';
				S.project = m.project;
				if (m.focus) { applyFocus(m.focus); }
				render();
				break;
			case 'project':
				S.project = m.project;
				S.compat = {};
				templates().slice(0, 60).forEach(t => needCompat(keyOf(t)));
				render();
				if (S.modal) { refreshModal(); }
				break;
			case 'list':
				S.loading = false;
				if (m.page) { S.page = m.page; S.error = undefined; } else { S.error = m.error || 'Unknown error.'; }
				if (S.route === 'details' && S.key) { needDetails(S.key); needCompat(S.key); }
				// With an architecture open, each card shows whether the template fits it.
				templates().slice(0, 60).forEach(t => needCompat(keyOf(t)));
				if (S.pendingFocus) { const f = S.pendingFocus; S.pendingFocus = undefined; applyFocus(f); }
				render();
				break;
			case 'preview':
				S.previews[m.key] = m.diagram || null;
				if (S.route === 'library') { patchCards(m.key); }
				break;
			case 'details':
				S.details[m.key] = m.error ? { error: m.error } : { details: m.details, diagram: m.diagram, fields: m.fields || [] };
				if (m.diagram && S.previews[m.key] === undefined) { S.previews[m.key] = m.diagram; }
				if (S.route === 'details' && S.key === m.key) { render(); }
				if (S.modal && (S.wizard && S.wizard.key === m.key || S.quick === m.key)) { refreshModal(); }
				break;
			case 'compatibility':
				S.compat[m.key] = m.error ? { error: m.error } : { result: m.result, lines: m.lines || [] };
				if (S.route === 'details' && S.key === m.key) { render(); } else { patchCards(m.key); }
				if (S.modal) { refreshModal(); }
				break;
			case 'validation':
				if (S.wizard && S.wizard.key === m.key) {
					S.wizard.busy = false;
					S.wizard.errors = m.errors || {};
					if (!Object.keys(S.wizard.errors).length) { S.wizard.step = 4; }
					refreshModal();
				}
				break;
			case 'created':
				if (S.wizard && S.wizard.key === m.key) { closeModal(); }
				toast(m.message || 'Architecture created.', 'ok');
				break;
			case 'createFailed':
				if (S.wizard && S.wizard.key === m.key) {
					S.wizard.busy = false;
					S.wizard.failure = m.message;
					if (m.errors && Object.keys(m.errors).length) { S.wizard.errors = m.errors; S.wizard.step = 3; }
					refreshModal();
				}
				break;
			case 'focus':
				applyFocus(m);
				break;
			case 'toast':
				toast(m.message, m.kind || 'info');
				break;
		}
	});
	function applyFocus(f) {
		const t = templates().find(x => x.id === f.templateId && (!f.version || x.version === f.version));
		if (!t) { if (!S.page) { S.pendingFocus = f; } return; }
		if (modalOpen()) { closeModal(); }
		if (f.mode === 'create') { go('details', keyOf(t)); openWizard(keyOf(t)); } else { go('details', keyOf(t)); }
	}

	/* ---------- Events ---------- */
	let dragMoved = false;
	document.addEventListener('click', e => {
		const el = e.target.closest('[data-open],[data-go],[data-chip],[data-layout],[data-clear],[data-drawer],[data-dtab],[data-tf],[data-menu],[data-wizard],[data-add],[data-close-modal],[data-scrim],[data-wstep],[data-wcreate],[data-quick],[data-zoom],[data-node],[data-refresh],[data-import],[data-copy],[data-remove],[data-openfile]');
		if (!el) { if (S.menu) { S.menu = false; render(); } return; }
		const d = el.dataset;
		if (d.node !== undefined) {
			if (dragMoved) { return; }
			const key = S.modal === 'quick' ? S.quick : S.key;
			const dg = (S.details[key] && S.details[key].diagram) || S.previews[key];
			const n = dg && dg.nodes.find(x => x.id === d.node);
			if (n) { toast(n.id + ' is in ' + n.file + ' at line ' + n.line + '. After you create the architecture, it opens on the canvas.', 'info'); }
			return;
		}
		if (d.zoom) {
			const svg = el.closest('.pan-wrap').querySelector('[data-pan] svg');
			if (!svg) { return; }
			if (d.zoom === 'fit') { setVB(svg, svg.dataset.vb.split(' ').map(Number)); if (svg.closest('#hero')) { S.heroVB = undefined; } } else { zoomSvg(svg, d.zoom === 'in' ? 1 / 1.25 : 1.25); }
			return;
		}
		if (d.scrim !== undefined) { if (e.target === el) { closeModal(); } return; }
		if (d.closeModal !== undefined) { closeModal(); return; }
		if (d.quick) { e.stopPropagation(); openQuick(d.quick); return; }
		if (d.wizard) { e.stopPropagation(); if (!el.disabled) { openWizard(d.wizard); } return; }
		if (d.add) { const t = byKey(d.add); if (t) { post({ type: 'addToArchitecture', templateId: t.id, version: t.version }); } return; }
		if (d.open) { if (modalOpen()) { closeModal(); } go('details', d.open); return; }
		if (d.go) { go(d.go); return; }
		if (d.refresh !== undefined) { S.previews = {}; S.details = {}; S.compat = {}; S.loading = true; post({ type: 'refresh' }); render(); return; }
		if (d.import !== undefined) { post({ type: 'importFile' }); return; }
		if (d.copy) { S.menu = false; post({ type: 'copy', text: d.copy }); render(); return; }
		if (d.remove) { S.menu = false; const t = byKey(d.remove); if (t) { post({ type: 'remove', templateId: t.id, version: t.version }); } render(); return; }
		if (d.openfile) { const t = byKey(S.key); if (t) { post({ type: 'openFile', templateId: t.id, version: t.version, fileName: d.openfile }); } return; }
		if (d.chip) { S.provider = d.chip; render(); return; }
		if (d.layout) { S.layout = d.layout; render(); return; }
		if (d.clear !== undefined) { S.q = ''; S.provider = 'all'; FACETS.forEach(([k]) => S.facets[k].clear()); S.drawer = false; render(); return; }
		if (d.drawer !== undefined) { S.drawer = !S.drawer; render(); return; }
		if (d.dtab) { S.detailTab = d.dtab; render(); const tab = $('#dt-' + d.dtab); if (tab) { tab.focus(); } return; }
		if (d.tf) { S.tfFile = d.tf; render(); return; }
		if (d.menu !== undefined) { e.stopPropagation(); S.menu = !S.menu; render(); return; }
		if (d.wstep && S.wizard) {
			const W = S.wizard, delta = Number(d.wstep);
			if (delta > 0 && W.step === 3 && S.details[W.key] && S.details[W.key].fields && S.details[W.key].fields.some(f => !f.skip)) {
				const t = byKey(W.key);
				W.busy = true; W.failure = undefined;
				post({ type: 'validate', templateId: t.id, version: t.version, values: W.values });
				refreshModal();
				return;
			}
			W.step = clamp(W.step + delta, 1, 4); W.failure = undefined;
			refreshModal();
			return;
		}
		if (d.wcreate !== undefined && S.wizard) {
			const W = S.wizard, t = byKey(W.key);
			if (!t || W.busy || nameProblem(W.name)) { return; }
			W.busy = true; W.failure = undefined;
			post({ type: 'create', templateId: t.id, version: t.version, name: W.name.trim(), values: W.values });
			refreshModal();
		}
	});
	document.addEventListener('input', e => {
		const t = e.target;
		if (t.id === 'q') { S.q = t.value; render(); return; }
		if (t.id === 'w-name' && S.wizard) {
			const was = nameProblem(S.wizard.name);
			S.wizard.name = t.value;
			if (was !== nameProblem(S.wizard.name)) { refreshModal('w-name'); }
			return;
		}
		if (t.dataset && t.dataset.param && S.wizard) {
			S.wizard.values[t.dataset.param] = t.value;
			if (S.wizard.errors[t.dataset.param]) { delete S.wizard.errors[t.dataset.param]; }
		}
	});
	document.addEventListener('change', e => {
		const t = e.target;
		if (t.id === 'sort') { S.sort = t.value; render(); return; }
		if (t.dataset && t.dataset.facet) { const set = S.facets[t.dataset.facet]; if (t.checked) { set.add(t.value); } else { set.delete(t.value); } const id = t.id; render(); const again = document.getElementById(id); if (again) { again.focus(); } return; }
		if (t.dataset && t.dataset.param && S.wizard) { S.wizard.values[t.dataset.param] = t.value; }
	});
	document.addEventListener('keydown', e => {
		const active = document.activeElement;
		const typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
		if (e.key === 'Escape') {
			if (modalOpen()) { closeModal(); }
			else if (S.drawer) { S.drawer = false; render(); }
			else if (S.menu) { S.menu = false; render(); }
			return;
		}
		if (e.key === '/' && !typing && !modalOpen()) {
			e.preventDefault();
			if (S.route !== 'library') { go('library'); }
			const q = $('#q'); if (q) { q.focus(); }
			return;
		}
		const row = e.target.closest && e.target.closest('tr[data-open]');
		if (row && row === e.target && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go('details', row.dataset.open); return; }
		const card = e.target.classList && e.target.classList.contains('card-title') ? e.target.closest('.card') : null;
		if (card && /^Arrow(Right|Left|Down|Up)$/.test(e.key)) {
			// Roving focus across the grid: arrows move between card titles.
			const grid = card.closest('.grid');
			const cards = [...grid.querySelectorAll('.card')];
			const i = cards.indexOf(card);
			const cols = Math.max(1, Math.round(grid.clientWidth / card.offsetWidth));
			const next = cards[i + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols)];
			if (next) { e.preventDefault(); next.querySelector('.card-title').focus(); }
			return;
		}
		const dt = e.target.closest && e.target.closest('[data-dtab]');
		if (dt && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
			e.preventDefault();
			const i = DTABS.findIndex(x => x[0] === dt.dataset.dtab);
			const n = DTABS[(i + (e.key === 'ArrowRight' ? 1 : DTABS.length - 1)) % DTABS.length][0];
			S.detailTab = n; render(); const tab = $('#dt-' + n); if (tab) { tab.focus(); }
			return;
		}
		if (e.key === 'Tab' && modalOpen()) {
			const f = [...document.querySelectorAll('#modal-root .modal button:not([disabled]), #modal-root .modal input:not([disabled]), #modal-root .modal select, #modal-root .modal textarea')];
			if (!f.length) { return; }
			const first = f[0], last = f[f.length - 1];
			if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
		}
	});
	let drag = null;
	document.addEventListener('pointerdown', e => {
		const area = e.target.closest && e.target.closest('[data-pan]');
		if (!area || e.button !== 0) { return; }
		const svg = area.querySelector('svg');
		drag = { area, svg, x: e.clientX, y: e.clientY, vb: svg.getAttribute('viewBox').split(/\s+/).map(Number), moved: false };
	});
	document.addEventListener('pointermove', e => {
		if (!drag) { return; }
		const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; drag.area.classList.add('dragging'); }
		if (!drag.moved) { return; }
		const r = drag.area.getBoundingClientRect(), k = Math.max(drag.vb[2] / r.width, drag.vb[3] / r.height);
		setVB(drag.svg, [drag.vb[0] - dx * k, drag.vb[1] - dy * k, drag.vb[2], drag.vb[3]]);
	});
	document.addEventListener('pointerup', () => {
		if (!drag) { return; }
		drag.area.classList.remove('dragging'); dragMoved = drag.moved; drag = null;
		setTimeout(() => { dragMoved = false; }, 0);
	});
	document.addEventListener('wheel', e => {
		const area = e.target.closest && e.target.closest('[data-pan]');
		if (!area) { return; }
		e.preventDefault();
		const r = area.getBoundingClientRect();
		zoomSvg(area.querySelector('svg'), e.deltaY > 0 ? 1.12 : 1 / 1.12, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
	}, { passive: false });

	render();
	post({ type: 'ready' });
})();
