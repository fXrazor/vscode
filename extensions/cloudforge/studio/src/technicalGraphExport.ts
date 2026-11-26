/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Portable SVG of the Technical Graph as currently laid out (lens, layout, spacing, pins, focus).
 * Built from the frozen snapshot and layout, not from the DOM, so it needs no foreignObject and
 * never reads or writes project state. Icons are passed in as data URLs by the caller.
 */
import type { GraphEdge, GraphInput, GraphNode, TechnicalGraphSnapshot } from './technicalGraph.ts';
import { inputSize, type GraphLane, type GraphLayoutResult } from './technicalGraphLayout.ts';
import type { Position } from './model.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' })[character]!);
const palette = {
	light: { canvas: '#f7f8fb', card: '#ffffff', border: '#d9dce6', text: '#1d2233', muted: '#6b7285', lane: '#eceef4', laneLine: '#dfe2ec', input: '#8a7fb8' },
	dark: { canvas: '#15161d', card: '#1f2029', border: '#353849', text: '#e7e9f2', muted: '#9aa0b5', lane: '#20222d', laneLine: '#31344a', input: '#a99ee0' },
};
export const edgeColours: Record<string, { light: string; dark: string }> = {
	ownership: { light: '#8a91a6', dark: '#8f96ad' }, attachment: { light: '#6d4fe0', dark: '#a993ff' }, execution: { light: '#b07316', dark: '#e0a656' },
	reference: { light: '#2a8681', dark: '#63c2bb' }, runtime: { light: '#2d6ad3', dark: '#79a7f2' }, observability: { light: '#3b8a57', dark: '#7fc99a' },
	unclassified: { light: '#9aa0b2', dark: '#7d8297' },
};
const layerColours: Record<string, string> = { network: '#6d8fd6', security: '#c46b6b', identity: '#b28a3f', compute: '#7d63d8', application: '#4f9a8f', data: '#3f87a8', monitoring: '#5a9a63', scope: '#8a91a6', unknown: '#b4b8c6' };

export interface GraphSvgInput {
	snapshot: TechnicalGraphSnapshot;
	layout: GraphLayoutResult;
	edges: readonly GraphEdge[];
	inputs?: { positions: Record<string, Position>; lane?: GraphLane };
	theme: 'light' | 'dark';
	title: string;
	/** Optional per-node badge text (overlay), e.g. "+/- replace" or "wave 3". */
	badges?: Record<string, string>;
	icons?: Record<string, string>;
	/** Optional scope spotlight: outside cards and edges dim softly while preserving colour. */
	spotlight?: ReadonlySet<string>;
}

function truncate(text: string, max: number): string { return text.length > max ? text.slice(0, max - 1) + '…' : text; }

export function technicalGraphSvg({ snapshot, layout, edges, inputs, theme, title, badges = {}, icons = {}, spotlight }: GraphSvgInput): string {
	const colours = palette[theme];
	const cards = snapshot.nodes.filter(node => layout.positions[node.id]);
	const ghostEntries = Object.entries(inputs?.positions ?? {});
	const lanes = [...layout.columns, ...layout.lanes, ...(inputs?.lane ? [inputs.lane] : [])];
	const boxes = [...cards.map(node => ({ ...layout.positions[node.id], ...layout.sizes[node.id] })), ...ghostEntries.map(([, p]) => ({ ...p, ...inputSize })), ...lanes];
	if (!boxes.length) { return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><text x="20" y="60">${escape(title)}: nothing to show</text></svg>`; }
	const minX = Math.min(...boxes.map(box => box.x)) - 40; const minY = Math.min(...boxes.map(box => box.y)) - 70;
	const maxX = Math.max(...boxes.map(box => box.x + box.width)) + 40; const maxY = Math.max(...boxes.map(box => box.y + box.height)) + 40;
	const width = Math.ceil(maxX - minX); const height = Math.ceil(maxY - minY);
	const centreBottom = (id: string) => { const p = layout.positions[id]; const s = layout.sizes[id]; return { x: p.x + s.width / 2, y: p.y + s.height }; };
	const centreTop = (id: string) => { const p = layout.positions[id]; const s = layout.sizes[id]; return { x: p.x + s.width / 2, y: p.y }; };
	const curve = (a: Position, b: Position) => { const dy = Math.max(40, Math.abs(b.y - a.y) * 0.45); return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`; };
	const usedCategories = [...new Set(edges.map(edge => edge.category))];
	const markers = usedCategories.map(category => `<marker id="tg-arrow-${category}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${edgeColours[category]?.[theme] ?? colours.muted}"/></marker>`).join('');
	const laneMarkup = lanes.map(lane => `<g><rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" fill="${lane.kind === 'inputs' ? 'none' : colours.lane}" fill-opacity="0.65" stroke="${colours.laneLine}" ${lane.kind === 'inputs' ? 'stroke-dasharray="4 4"' : ''}/><text x="${lane.x + 10}" y="${lane.y + 18}" font-size="10.5" font-weight="700" letter-spacing=".06em" fill="${colours.muted}">${escape(lane.label.toUpperCase())}</text></g>`).join('');
	const edgeMarkup = edges.filter(edge => layout.positions[edge.source] && layout.positions[edge.target]).map(edge => {
		const a = centreBottom(edge.source); let b = centreTop(edge.target);
		// Same band or upward: dip underneath both cards, as the live graph does, instead of looping through them.
		let d = curve(a, b);
		if (b.y < a.y + 10) { b = centreBottom(edge.target); const dip = Math.max(a.y, b.y) + 36 + Math.min(90, Math.abs(b.x - a.x) * 0.12); d = `M ${a.x} ${a.y} C ${a.x} ${dip}, ${b.x} ${dip}, ${b.x} ${b.y}`; }
		const colour = edgeColours[edge.category]?.[theme] ?? colours.muted;
		const dash = edge.category === 'reference' ? ' stroke-dasharray="6 4"' : edge.category === 'observability' ? ' stroke-dasharray="2 4"' : '';
		const outside = spotlight && !(spotlight.has(edge.source) && spotlight.has(edge.target)) ? ' opacity="0.12"' : '';
		return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="1.6"${dash}${outside} marker-end="url(#tg-arrow-${edge.category})"><title>${escape(edge.category + ': ' + edge.evidence.map(item => item.field).join(', '))}</title></path>`;
	}).join('');
	// Input lines are interactive-only; the ghost card states its uses instead.
	const card = (node: GraphNode) => {
		const { x, y } = layout.positions[node.id]; const { width: w, height: h } = layout.sizes[node.id];
		const stripe = layerColours[node.layer] ?? colours.border; const icon = icons[node.id];
		const rows = h >= 110 ? node.ports.slice(0, Math.max(0, Math.floor((h - 90) / 26))) : [];
		const rowMarkup = rows.map((port, index) => `<g transform="translate(14 ${84 + index * 26})"><circle cx="4" cy="-4" r="3" fill="${edgeColours[port.category]?.[theme] ?? colours.muted}"/><text x="14" y="0" font-size="11" font-family="Consolas, monospace" fill="${colours.text}">${escape(truncate(port.field, 18))}</text><text x="${w - 28}" y="0" font-size="11" text-anchor="end" fill="${colours.muted}">${escape(truncate(port.peerLabel, 12))}</text></g>`).join('');
		const badge = badges[node.id] ? `<g transform="translate(${w - 12} -9)"><rect x="${-badges[node.id].length * 6.4 - 14}" y="0" width="${badges[node.id].length * 6.4 + 14}" height="18" rx="9" fill="${colours.card}" stroke="${colours.muted}"/><text x="-7" y="12.5" font-size="10.5" font-weight="650" text-anchor="end" fill="${colours.text}">${escape(badges[node.id])}</text></g>` : '';
		const exposure = node.exposure && node.exposure.kind !== 'behind-entry' ? `<text x="54" y="66" font-size="10.5" font-weight="650" fill="#c0392b">${node.exposure.kind === 'entry' ? 'public entry' : 'public access'}</text>` : '';
		const outside = spotlight && !spotlight.has(node.id) ? ' opacity="0.22"' : '';
		return `<g data-id="${escape(node.id)}" transform="translate(${x} ${y})"${outside}><title>${escape(node.address)}</title><rect width="${w}" height="${h}" rx="10" fill="${colours.card}" stroke="${colours.border}"/><rect width="4" height="${h}" rx="2" fill="${stripe}"/>${icon ? `<image href="${escape(icon)}" x="14" y="14" width="30" height="30"/>` : ''}<text x="54" y="28" font-size="13" font-weight="650" fill="${colours.text}">${escape(truncate(node.label, 26))}</text><text x="54" y="46" font-size="11" fill="${colours.muted}">${escape(truncate(node.typeLabel + ' · ' + node.region.value, 32))}</text>${exposure}${rowMarkup}${badge}</g>`;
	};
	const ghost = ([id, p]: [string, Position]) => {
		const input = snapshot.inputs.find(item => item.id === id) as GraphInput | undefined; if (!input) { return ''; }
		return `<g transform="translate(${p.x} ${p.y})"><rect width="${inputSize.width}" height="${inputSize.height}" rx="10" fill="none" stroke="${colours.input}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="10" y="22" font-size="11.5" font-weight="650" font-family="Consolas, monospace" fill="${colours.text}">${escape(truncate(input.address, 30))}</text><text x="10" y="39" font-size="10.5" fill="${colours.muted}">${escape(input.kind + (input.sensitive ? ' · sensitive' : '') + ' · ' + input.consumers.length + ' use' + (input.consumers.length === 1 ? '' : 's'))}</text></g>`;
	};
	const legend = usedCategories.map((category, index) => `<g transform="translate(${minX + 20 + index * 120} ${minY + 48})"><line x1="0" y1="-4" x2="22" y2="-4" stroke="${edgeColours[category]?.[theme] ?? colours.muted}" stroke-width="2"/><text x="28" y="0" font-size="11" fill="${colours.muted}">${escape(category)}</text></g>`).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="Segoe UI, Mona Sans, sans-serif"><defs>${markers}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${colours.canvas}"/><text x="${minX + 20}" y="${minY + 26}" font-size="15" font-weight="700" fill="${colours.text}">${escape(title)}</text>${legend}${laneMarkup}${edgeMarkup}${cards.map(card).join('')}${ghostEntries.map(ghost).join('')}</svg>`;
}

/** Fetch each visible card icon once and inline it as a data URL. */
export async function graphIcons(nodes: readonly GraphNode[]): Promise<Record<string, string>> {
	const cache = new Map<string, Promise<string>>();
	const load = (icon: string) => cache.get(icon) ?? (cache.set(icon, fetch('./assets/' + icon).then(response => response.ok ? response.blob() : Promise.reject(new Error('icon'))).then(blob => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); })).catch(() => '')), cache.get(icon)!);
	return Object.fromEntries(await Promise.all(nodes.map(async node => [node.id, await load(node.icon)] as const)));
}

