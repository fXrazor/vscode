/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Portable SVG of the Technical Graph as currently laid out (lens, layout, spacing, pins, focus).
 * Built from the frozen snapshot and layout, not from the DOM, so it needs no foreignObject and
 * never reads or writes project state. Icons are passed in as data URLs by the caller.
 */
import { layerLabels, type GraphEdge, type GraphInput, type GraphNode, type NodeOverlay, type TechnicalGraphSnapshot } from './technicalGraph.ts';
import { inputSize, type GraphLane, type GraphLayoutResult } from './technicalGraphLayout.ts';
import { bundleLayout } from './technicalGraphBundle.ts';
import { forceSettings, hullPath, type ForceNode, type NetworkOptions } from './technicalGraphForce.ts';
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

export interface NetworkGraphSvgInput {
	snapshot: TechnicalGraphSnapshot;
	simNodes: readonly ForceNode[];
	edges: readonly GraphEdge[];
	membership: readonly GraphEdge[];
	network: NetworkOptions;
	theme: 'light' | 'dark';
	title: string;
	overlays?: { byNode: Record<string, NodeOverlay> };
	icons?: Record<string, string>;
	spotlight?: ReadonlySet<string>;
}

/** Portable SVG of the live Network (force-directed) view, preserving gradual sizing, sleek rings, hulls, and spotlight. */
export function networkGraphSvg({ snapshot, simNodes, edges, membership, network, theme, title, overlays, icons = {}, spotlight }: NetworkGraphSvgInput): string {
	const colours = palette[theme];
	const byId = new Map(simNodes.map(node => [node.id, node]));
	const info = new Map(snapshot.nodes.map(node => [node.id, node]));
	const activeNodes = simNodes.filter(node => info.has(node.id));
	if (!activeNodes.length) { return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><text x="20" y="60">${escape(title)}: nothing to show</text></svg>`; }
	const maxR = Math.max(forceSettings.radius, ...activeNodes.map(node => node.r));
	const pad = 78 + maxR;
	const minX = Math.min(...activeNodes.map(node => node.x)) - pad;
	const minY = Math.min(...activeNodes.map(node => node.y)) - pad - 42;
	const maxX = Math.max(...activeNodes.map(node => node.x)) + pad;
	const maxY = Math.max(...activeNodes.map(node => node.y)) + pad + 26;
	const width = Math.ceil(maxX - minX);
	const height = Math.ceil(maxY - minY);

	const visibleEdges = edges.filter(edge => byId.has(edge.source) && byId.has(edge.target) && edge.source !== edge.target);
	const usedCategories = [...new Set(visibleEdges.map(edge => edge.category))];
	const markers = usedCategories.map(category => `<marker id="tg-net-arrow-${category}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${edgeColours[category]?.[theme] ?? colours.muted}"/></marker>`).join('');

	const linkPath = (a: ForceNode, b: ForceNode) => {
		const dx = b.x - a.x; const dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; const ux = dx / l; const uy = dy / l;
		if (network.links === 'straight') { return `M ${a.x + ux * (a.r + 2)} ${a.y + uy * (a.r + 2)} L ${b.x - ux * (b.r + 5)} ${b.y - uy * (b.r + 5)}`; }
		const bend = 0.18;
		const sx = a.x + (ux * Math.cos(bend) - uy * Math.sin(bend)) * (a.r + 2);
		const sy = a.y + (uy * Math.cos(bend) + ux * Math.sin(bend)) * (a.r + 2);
		const ex = b.x - (ux * Math.cos(-bend) - uy * Math.sin(-bend)) * (b.r + 5);
		const ey = b.y - (uy * Math.cos(-bend) + ux * Math.sin(-bend)) * (b.r + 5);
		const mx = (sx + ex) / 2 - uy * l * 0.12;
		const my = (sy + ey) / 2 + ux * l * 0.12;
		return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
	};

	const hulls = network.clusters === 'none' ? [] : [...activeNodes.reduce((groups, node) => {
		if (node.group) { groups.set(node.group, [...(groups.get(node.group) ?? []), node]); }
		return groups;
	}, new Map<string, ForceNode[]>())].filter(([, members]) => members.length > 1).map(([group, members]) => {
		const label = network.clusters === 'layer' ? layerLabels[members[0].layer as keyof typeof layerLabels] ?? members[0].layer : info.get(group)?.label ?? snapshot.nodes.find(node => node.id === group)?.label ?? group;
		const top = members.reduce((best, node) => node.y - node.r < best.y - best.r ? node : best, members[0]);
		const cx = members.reduce((sum, node) => sum + node.x, 0) / members.length;
		const stripe = layerColours[members[0].layer] ?? colours.muted;
		const outside = spotlight && !members.some(node => spotlight.has(node.id)) ? ' opacity="0.3"' : '';
		return `<g${outside}><path d="${hullPath(members)}" fill="${stripe}" fill-opacity="0.07" stroke="${stripe}" stroke-opacity="0.34" stroke-width="1.2" stroke-dasharray="4 5"/><text x="${cx}" y="${top.y - top.r - 24}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing=".05em" fill="${colours.muted}">${escape(label.toUpperCase())}</text></g>`;
	}).join('');

	const membershipMarkup = membership.filter(edge => byId.has(edge.source) && byId.has(edge.target)).map(edge => {
		const a = byId.get(edge.source)!; const b = byId.get(edge.target)!;
		const outside = spotlight && !(spotlight.has(edge.source) && spotlight.has(edge.target)) ? ' opacity="0.08"' : ' opacity="0.35"';
		return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${edgeColours.ownership[theme]}" stroke-width="1.4" stroke-dasharray="1 5" stroke-linecap="round"${outside}/>`;
	}).join('');

	const edgeMarkup = visibleEdges.map(edge => {
		const a = byId.get(edge.source)!; const b = byId.get(edge.target)!;
		const colour = edgeColours[edge.category]?.[theme] ?? colours.muted;
		const dash = edge.category === 'reference' || edge.category === 'unclassified' ? ' stroke-dasharray="5 4"' : edge.category === 'observability' ? ' stroke-dasharray="2 4"' : '';
		const outside = spotlight && !(spotlight.has(edge.source) && spotlight.has(edge.target)) ? ' opacity="0.08"' : ' opacity="0.65"';
		return `<path d="${linkPath(a, b)}" fill="none" stroke="${colour}" stroke-width="1.6"${dash}${outside} marker-end="url(#tg-net-arrow-${edge.category})"><title>${escape(edge.category + ': ' + edge.evidence.map(item => item.field).join(', '))}</title></path>`;
	}).join('');

	const base = forceSettings.radius;
	const nodeMarkup = [...activeNodes].sort((a, b) => a.r - b.r).map(simNode => {
		const node = info.get(simNode.id)!;
		const r = simNode.r; const iconSize = Math.round(r * 1.25);
		const prominence = maxR > base ? Math.min(1, Math.max(0, (r - base) / (maxR - base))) : 0;
		const discStroke = Math.round((1.6 + prominence * 1.0) * 10) / 10;
		const labelSize = Math.round((10.5 + prominence * 4.5) * 10) / 10;
		const stripe = layerColours[node.layer] ?? colours.border;
		const icon = icons[node.id];
		const overlay = overlays?.byNode[node.id];
		const issues = (overlay?.errors ?? 0) + (overlay?.warnings ?? 0);
		const outside = spotlight && !spotlight.has(node.id) ? ' opacity="0.22"' : '';
		const exposed = node.exposure && node.exposure.kind !== 'behind-entry' ? `<circle r="${r + 7}" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="3 3"/>` : '';
		const issueBadge = issues > 0 ? `<g transform="translate(${(r * 0.72).toFixed(1)} ${(-r * 0.72).toFixed(1)})"><circle r="7.5" fill="${overlay?.errors ? '#c0392b' : '#c5861a'}" stroke="${colours.card}" stroke-width="2"/><text dy="0.35em" text-anchor="middle" font-size="9" font-weight="750" fill="#ffffff">${issues > 9 ? '9+' : issues}</text></g>` : '';
		const showLabel = network.labels !== 'none';
		const labelMarkup = showLabel ? `<text y="${r + 15}" text-anchor="middle" font-size="${labelSize}" font-weight="${prominence >= 0.55 ? 700 : 550}" fill="${colours.text}" paint-order="stroke" stroke="${colours.canvas}" stroke-width="4" stroke-linejoin="round">${escape(truncate(node.label, 24))}</text>` : '';
		return `<g data-id="${escape(node.id)}" data-r="${r}" transform="translate(${simNode.x.toFixed(1)} ${simNode.y.toFixed(1)})"${outside}><title>${escape(node.address)}</title>${exposed}<circle r="${r}" fill="${colours.card}" stroke="${stripe}" stroke-width="${discStroke}"/>${icon ? `<image href="${escape(icon)}" x="${-iconSize / 2}" y="${-iconSize / 2}" width="${iconSize}" height="${iconSize}"/>` : ''}${issueBadge}${labelMarkup}</g>`;
	}).join('');

	const legend = usedCategories.map((category, index) => `<g transform="translate(${minX + 20 + index * 120} ${minY + 48})"><line x1="0" y1="-4" x2="22" y2="-4" stroke="${edgeColours[category]?.[theme] ?? colours.muted}" stroke-width="2"/><text x="28" y="0" font-size="11" fill="${colours.muted}">${escape(category)}</text></g>`).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="Segoe UI, Mona Sans, sans-serif"><defs>${markers}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${colours.canvas}"/><text x="${minX + 20}" y="${minY + 26}" font-size="15" font-weight="700" fill="${colours.text}">${escape(title)}</text>${legend}${hulls}${membershipMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

export interface BundledGraphSvgInput {
	snapshot: TechnicalGraphSnapshot;
	edges: readonly GraphEdge[];
	visible?: ReadonlySet<string>;
	theme: 'light' | 'dark';
	title: string;
	spotlight?: ReadonlySet<string>;
}

/** Portable SVG of the radial Bundled relationship view, with colour-preserving Scope Spotlight dimming. */
export function bundledGraphSvg({ snapshot, edges, visible, theme, title, spotlight }: BundledGraphSvgInput): string {
	const colours = palette[theme];
	const bundle = bundleLayout(snapshot, edges, { visible });
	if (!bundle.leaves.length) { return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><text x="20" y="60">${escape(title)}: nothing to show</text></svg>`; }
	const margin = 195;
	const half = bundle.radius + margin;
	const minX = -half;
	const minY = -half - 44;
	const width = Math.ceil(half * 2);
	const height = Math.ceil(half * 2 + 44);
	const arc = (start: number, end: number, r: number) => {
		const a = start - 0.02; const b = end + 0.02;
		const [x0, y0] = [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
		const [x1, y1] = [Math.cos(b - Math.PI / 2) * r, Math.sin(b - Math.PI / 2) * r];
		return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
	};
	const usedCategories = [...new Set(bundle.paths.map(path => path.category))];
	const groupsMarkup = bundle.groups.map(group => {
		const stripe = layerColours[group.layer] ?? colours.muted;
		const mid = (group.start + group.end) / 2;
		const angle = mid - Math.PI / 2;
		const lx = Math.cos(angle) * (bundle.radius + 168);
		const ly = Math.sin(angle) * (bundle.radius + 168);
		return `<g><path d="${arc(group.start, group.end, bundle.radius + 150)}" fill="none" stroke="${stripe}" stroke-width="6" stroke-linecap="round" opacity="0.55"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="11.5" font-weight="700" letter-spacing=".06em" fill="${colours.muted}">${escape(group.label.toUpperCase())}</text></g>`;
	}).join('');
	const pathsMarkup = bundle.paths.map(path => {
		const colour = edgeColours[path.category]?.[theme] ?? colours.muted;
		const outside = spotlight && !(spotlight.has(path.source) && spotlight.has(path.target)) ? ' opacity="0.08"' : ' opacity="0.52"';
		return `<path d="${path.d}" fill="none" stroke="${colour}" stroke-width="1.4"${outside}/>`;
	}).join('');
	const leavesMarkup = bundle.leaves.map(leaf => {
		const degrees = (leaf.angle * 180 / Math.PI - 90).toFixed(2);
		const flip = leaf.angle > Math.PI;
		const stripe = layerColours[leaf.layer] ?? colours.muted;
		const outside = spotlight && !spotlight.has(leaf.id) ? ' opacity="0.22"' : '';
		return `<g data-id="${escape(leaf.id)}" transform="rotate(${degrees}) translate(${bundle.radius + 8},0)${flip ? ' rotate(180)' : ''}"${outside}><circle cx="${flip ? 4 : -4}" r="3.5" fill="${stripe}"/><text x="${flip ? -6 : 6}" dy="0.32em" text-anchor="${flip ? 'end' : 'start'}" font-size="12.5" fill="${colours.text}">${escape(truncate(leaf.label, 26))}</text></g>`;
	}).join('');
	const legend = usedCategories.map((category, index) => `<g transform="translate(${minX + 20 + index * 120} ${minY + 48})"><line x1="0" y1="-4" x2="22" y2="-4" stroke="${edgeColours[category]?.[theme] ?? colours.muted}" stroke-width="2"/><text x="28" y="0" font-size="11" fill="${colours.muted}">${escape(category)}</text></g>`).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="Segoe UI, Mona Sans, sans-serif"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${colours.canvas}"/><text x="${minX + 20}" y="${minY + 26}" font-size="15" font-weight="700" fill="${colours.text}">${escape(title)}</text>${legend}${groupsMarkup}${pathsMarkup}${leavesMarkup}</svg>`;
}

/** Fetch each visible card icon once and inline it as a data URL. */
export async function graphIcons(nodes: readonly GraphNode[]): Promise<Record<string, string>> {
	const cache = new Map<string, Promise<string>>();
	const load = (icon: string) => cache.get(icon) ?? (cache.set(icon, fetch('./assets/' + icon).then(response => response.ok ? response.blob() : Promise.reject(new Error('icon'))).then(blob => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); })).catch(() => '')), cache.get(icon)!);
	return Object.fromEntries(await Promise.all(nodes.map(async node => [node.id, await load(node.icon)] as const)));
}

