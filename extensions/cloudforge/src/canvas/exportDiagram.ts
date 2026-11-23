/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 5: Deterministic standalone SVG diagram and Markdown architecture report generation.
// Pure TypeScript with zero DOM, network, or `vscode` runtime dependencies.

import type {
	CanvasGroupLayout,
	CanvasProjection,
	PositionedNode,
	RoutedEdge
} from './layout';
import type {
	ArchitectureLayer,
	CanvasAnnotation,
	CanvasDependencyReport,
	CanvasFrame,
	CanvasGraphSnapshot,
	CanvasViewMode
} from './protocol';
import type { ValidationRun } from './validationRunner';

function exportProviderLabel(provider: string): string {
	switch (provider) {
		case 'azure': return 'Azure';
		case 'aws': return 'AWS';
		case 'gcp': return 'Google Cloud';
		case 'kubernetes': return 'Kubernetes';
		case 'module': return 'Modules';
		default: return 'Terraform';
	}
}

function exportLayerLabel(layer: ArchitectureLayer): string {
	switch (layer) {
		case 'infrastructure': return 'Infrastructure';
		case 'platforms': return 'Platforms';
		case 'applications': return 'Applications';
		case 'security': return 'Security';
		case 'operations': return 'Operations';
	}
}

export type ExportScope = 'architecture' | 'selection' | 'frame';

export interface DiagramExportOptions {
	readonly scope: ExportScope;
	readonly frameId?: string;
	readonly selectedIds?: readonly string[];
	readonly theme: 'light' | 'dark';
	readonly mode: CanvasViewMode;
	readonly includeValidation: boolean;
	readonly includeAnnotations: boolean;
	readonly includeProvenance: boolean;
	readonly capturedAtIso?: string;
	readonly frames: readonly CanvasFrame[];
	readonly annotations: readonly CanvasAnnotation[];
	readonly hiddenLayers: readonly ArchitectureLayer[];
	readonly validationRun?: ValidationRun;
	readonly dependencyReport?: CanvasDependencyReport | null;
}

export interface RenderedSvgDiagram {
	readonly svg: string;
	readonly width: number;
	readonly height: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
}

interface Palette {
	readonly bg: string;
	readonly surface: string;
	readonly card: string;
	readonly fg: string;
	readonly muted: string;
	readonly border: string;
	readonly edge: string;
	readonly ok: string;
	readonly warn: string;
	readonly err: string;
}

const DARK_PALETTE: Palette = {
	bg: '#161822',
	surface: '#1b1e2b',
	card: '#222638',
	fg: '#d6dcf4',
	muted: '#8b95b7',
	border: '#323952',
	edge: '#7c88b2',
	ok: '#73daca',
	warn: '#e0af68',
	err: '#f7768e',
};

const LIGHT_PALETTE: Palette = {
	bg: '#f6f7fb',
	surface: '#ffffff',
	card: '#ffffff',
	fg: '#1d2333',
	muted: '#5a647a',
	border: '#d0d7e6',
	edge: '#5a6b8c',
	ok: '#1b7f5f',
	warn: '#9a6700',
	err: '#c93b4b',
};

function providerAccent(provider: string): string {
	switch (provider) {
		case 'azure': return '#3b82f6';
		case 'aws': return '#f59e0b';
		case 'gcp': return '#10b981';
		case 'kubernetes': return '#6366f1';
		case 'module': return '#a855f7';
		default: return '#64748b';
	}
}

function frameColors(color: CanvasFrame['color'], theme: 'light' | 'dark'): { stroke: string; fill: string; text: string } {
	const dark = theme === 'dark';
	switch (color) {
		case 'emerald':
			return { stroke: '#10b981', fill: dark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.07)', text: dark ? '#6ee7b7' : '#047857' };
		case 'amber':
			return { stroke: '#f59e0b', fill: dark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.08)', text: dark ? '#fcd34d' : '#b45309' };
		case 'violet':
			return { stroke: '#a855f7', fill: dark ? 'rgba(168,85,247,0.08)' : 'rgba(168,85,247,0.07)', text: dark ? '#d8b4fe' : '#6d28d9' };
		case 'slate':
			return { stroke: '#64748b', fill: dark ? 'rgba(100,116,139,0.1)' : 'rgba(100,116,139,0.07)', text: dark ? '#cbd5e1' : '#334155' };
		default:
			return { stroke: '#3b82f6', fill: dark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.07)', text: dark ? '#93c5fd' : '#1d4ed8' };
	}
}

function noteColors(color: CanvasAnnotation['color'], theme: 'light' | 'dark'): { stroke: string; fill: string; text: string } {
	const dark = theme === 'dark';
	switch (color) {
		case 'blue':
			return { stroke: '#3b82f6', fill: dark ? '#1d2940' : '#eff6ff', text: dark ? '#dbeafe' : '#1e3a8a' };
		case 'emerald':
			return { stroke: '#10b981', fill: dark ? '#162f29' : '#ecfdf5', text: dark ? '#d1fae5' : '#065f46' };
		case 'rose':
			return { stroke: '#f43f5e', fill: dark ? '#351c27' : '#fff1f2', text: dark ? '#ffe4e6' : '#881337' };
		default:
			return { stroke: '#eab308', fill: dark ? '#332b16' : '#fefce8', text: dark ? '#fef9c3' : '#713f12' };
	}
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, Math.max(1, maxChars - 1))}\u2026`;
}

function rectIntersects(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

interface ScopedSelection {
	readonly scopeLabel: string;
	readonly frames: readonly CanvasFrame[];
	readonly groups: readonly CanvasGroupLayout[];
	readonly nodes: readonly PositionedNode[];
	readonly edges: readonly RoutedEdge[];
	readonly annotations: readonly CanvasAnnotation[];
}

function selectExportScope(projection: CanvasProjection, options: DiagramExportOptions): ScopedSelection {
	if (options.scope === 'frame' && options.frameId) {
		const target = options.frames.find(f => f.id === options.frameId);
		if (target) {
			const nodes = projection.nodes.filter(n => rectIntersects(n, target));
			const nodeIds = new Set(nodes.map(n => n.node.id));
			const edges = projection.edges.filter(e => nodeIds.has(e.fromId) && nodeIds.has(e.toId));
			const annotations = options.includeAnnotations
				? options.annotations.filter(a => rectIntersects({ x: a.x, y: a.y, width: a.width, height: 84 }, target))
				: [];
			return {
				scopeLabel: `Frame: ${target.title}`,
				frames: [target],
				groups: [],
				nodes,
				edges,
				annotations,
			};
		}
	}

	if (options.scope === 'selection' && options.selectedIds && options.selectedIds.length > 0) {
		const selectedSet = new Set(options.selectedIds);
		const nodes = projection.nodes.filter(n => selectedSet.has(n.node.id));
		const nodeIds = new Set(nodes.map(n => n.node.id));
		const edges = projection.edges.filter(e => nodeIds.has(e.fromId) && nodeIds.has(e.toId));
		return {
			scopeLabel: `Selection (${nodes.length})`,
			frames: [],
			groups: [],
			nodes,
			edges,
			annotations: [],
		};
	}

	return {
		scopeLabel: 'Full Architecture',
		frames: options.frames,
		groups: projection.groups,
		nodes: projection.nodes,
		edges: projection.edges,
		annotations: options.includeAnnotations ? options.annotations : [],
	};
}

function edgePathD(edge: RoutedEdge): string {
	if (edge.orientation === 'vertical') {
		const dy = Math.max(36, Math.abs(edge.toY - edge.fromY) * 0.45);
		const dir = edge.toY >= edge.fromY ? 1 : -1;
		return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${edge.fromY + dir * dy}, ${edge.toX} ${edge.toY - dir * dy}, ${edge.toX} ${edge.toY}`;
	}
	const dx = Math.max(40, Math.abs(edge.toX - edge.fromX) * 0.45);
	const dir = edge.toX >= edge.fromX ? 1 : -1;
	return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + dir * dx} ${edge.fromY}, ${edge.toX - dir * dx} ${edge.toY}, ${edge.toX} ${edge.toY}`;
}

function wrapNoteLines(text: string, maxChars: number): string[] {
	const rawLines = (text || 'Note').split(/\r?\n/);
	const out: string[] = [];
	for (const raw of rawLines) {
		const words = raw.split(/\s+/).filter(Boolean);
		if (words.length === 0) {
			out.push('');
			continue;
		}
		let line = '';
		for (const word of words) {
			if (!line) {
				line = word;
			} else if (line.length + 1 + word.length <= maxChars) {
				line += ` ${word}`;
			} else {
				out.push(line);
				line = word;
			}
			if (out.length >= 6) {
				break;
			}
		}
		if (line && out.length < 6) {
			out.push(line);
		}
	}
	return out.slice(0, 6);
}

/** Generates a self-contained, offline-safe SVG diagram from a captured architecture revision. */
export function renderArchitectureSvg(
	graph: CanvasGraphSnapshot,
	projection: CanvasProjection,
	options: DiagramExportOptions
): RenderedSvgDiagram {
	const palette = options.theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
	const scoped = selectExportScope(projection, options);
	const pad = 40;
	const footerH = options.includeProvenance ? 44 : 0;

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	const includeRect = (x: number, y: number, w: number, h: number) => {
		if (x < minX) { minX = x; }
		if (y < minY) { minY = y; }
		if (x + w > maxX) { maxX = x + w; }
		if (y + h > maxY) { maxY = y + h; }
	};

	for (const frame of scoped.frames) {
		includeRect(frame.x, frame.y, frame.width, frame.height);
	}
	for (const group of scoped.groups) {
		includeRect(group.x, group.y, group.width, group.height);
	}
	for (const node of scoped.nodes) {
		includeRect(node.x, node.y, node.width, node.height);
	}
	for (const note of scoped.annotations) {
		const lines = wrapNoteLines(note.text, Math.max(16, Math.floor((note.width - 20) / 7)));
		includeRect(note.x, note.y, note.width, Math.max(64, 28 + lines.length * 16));
	}

	if (!Number.isFinite(minX)) {
		minX = 0;
		minY = 0;
		maxX = 640;
		maxY = 320;
	}

	const width = Math.max(520, Math.ceil(maxX - minX + pad * 2));
	const contentHeight = Math.max(280, Math.ceil(maxY - minY + pad * 2));
	const height = contentHeight + footerH;
	const offsetX = pad - minX;
	const offsetY = pad - minY;

	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif">`,
		`<defs>`,
		`<marker id="cf-exp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
		`<path d="M 0 1 L 10 5 L 0 9 z" fill="${palette.edge}"/>`,
		`</marker>`,
		`</defs>`,
		`<rect x="0" y="0" width="${width}" height="${height}" fill="${palette.bg}"/>`,
		`<g transform="translate(${offsetX} ${offsetY})">`,
	];

	// 1. Visual frames
	for (const frame of scoped.frames) {
		const fc = frameColors(frame.color, options.theme);
		parts.push(
			`<g class="cf-export-frame">`,
			`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="12" fill="${fc.fill}" stroke="${fc.stroke}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
			`<text x="${frame.x + 14}" y="${frame.y + 22}" fill="${fc.text}" font-size="12" font-weight="600">${escapeXml(truncateText(frame.title, 48))}</text>`,
			`</g>`
		);
	}

	// 2. Provider groups
	for (const group of scoped.groups) {
		const accent = providerAccent(group.provider);
		parts.push(
			`<g class="cf-export-group">`,
			`<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="12" fill="${palette.surface}" fill-opacity="0.72" stroke="${palette.border}" stroke-width="1"/>`,
			`<rect x="${group.x}" y="${group.y}" width="${group.width}" height="34" rx="12" fill="${accent}" fill-opacity="0.1"/>`,
			`<text x="${group.x + 14}" y="${group.y + 21}" fill="${palette.fg}" font-size="11.5" font-weight="600">${escapeXml(group.label)}</text>`,
			`<text x="${group.x + group.width - 14}" y="${group.y + 21}" text-anchor="end" fill="${palette.muted}" font-size="10.5">${group.visibleCount}</text>`,
			`</g>`
		);
	}

	// 3. Edges
	for (const edge of scoped.edges) {
		const d = edgePathD(edge);
		const dash = edge.collapsedSummary ? ' stroke-dasharray="5 4"' : '';
		parts.push(`<path d="${d}" fill="none" stroke="${palette.edge}" stroke-width="1.65"${dash} marker-end="url(#cf-exp-arrow)"/>`);
	}

	// 4. Resource cards
	for (const item of scoped.nodes) {
		const accent = providerAccent(item.provider);
		const runRes = options.includeValidation ? options.validationRun?.nodeResults[item.node.id] : undefined;
		const badgeColor = runRes?.status === 'success'
			? palette.ok
			: runRes?.status === 'failed'
				? palette.err
				: runRes?.status === 'warning' || runRes?.status === 'skipped'
					? palette.warn
					: undefined;
		const badgeText = runRes ? runRes.status.toUpperCase() : item.node.kind.toUpperCase();

		parts.push(
			`<g class="cf-export-node">`,
			`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="10" fill="${palette.card}" stroke="${palette.border}" stroke-width="1"/>`,
			`<rect x="${item.x}" y="${item.y + 1}" width="4" height="${item.height - 2}" rx="2" fill="${accent}"/>`,
			`<text x="${item.x + 14}" y="${item.y + 21}" fill="${palette.muted}" font-size="10" font-weight="600">${escapeXml(exportProviderLabel(item.provider).toUpperCase())}</text>`,
			`<text x="${item.x + item.width - 12}" y="${item.y + 21}" text-anchor="end" fill="${badgeColor ?? palette.muted}" font-size="9.5" font-weight="600">${escapeXml(badgeText)}</text>`,
			`<text x="${item.x + 14}" y="${item.y + 44}" fill="${palette.fg}" font-size="13" font-weight="600">${escapeXml(truncateText(item.node.name, 26))}</text>`,
			`<text x="${item.x + 14}" y="${item.y + 62}" fill="${palette.muted}" font-size="10.5" font-family="Consolas, Courier New, monospace">${escapeXml(truncateText(item.node.resourceType ?? item.node.label, 30))}</text>`
		);
		if (options.mode === 'technical') {
			parts.push(
				`<line x1="${item.x + 12}" y1="${item.y + item.height - 26}" x2="${item.x + item.width - 12}" y2="${item.y + item.height - 26}" stroke="${palette.border}" stroke-width="1"/>`,
				`<text x="${item.x + 14}" y="${item.y + item.height - 10}" fill="${palette.muted}" font-size="10">IN ${item.incomingCount}</text>`,
				`<text x="${item.x + item.width - 14}" y="${item.y + item.height - 10}" text-anchor="end" fill="${palette.muted}" font-size="10">OUT ${item.outgoingCount}</text>`
			);
		}
		parts.push(`</g>`);
	}

	// 5. Sticky annotations
	for (const note of scoped.annotations) {
		const nc = noteColors(note.color, options.theme);
		const lines = wrapNoteLines(note.text, Math.max(16, Math.floor((note.width - 20) / 7)));
		const noteH = Math.max(64, 28 + lines.length * 16);
		parts.push(
			`<g class="cf-export-note">`,
			`<rect x="${note.x}" y="${note.y}" width="${note.width}" height="${noteH}" rx="8" fill="${nc.fill}" stroke="${nc.stroke}" stroke-width="1.25"/>`
		);
		lines.forEach((line, idx) => {
			parts.push(`<text x="${note.x + 10}" y="${note.y + 22 + idx * 16}" fill="${nc.text}" font-size="11.5">${escapeXml(line)}</text>`);
		});
		parts.push(`</g>`);
	}

	parts.push(`</g>`);

	// 6. Provenance footer
	if (options.includeProvenance) {
		const captured = options.capturedAtIso ?? new Date().toISOString();
		const hiddenNote = options.hiddenLayers.length > 0
			? ` · Hidden layers: ${options.hiddenLayers.map(exportLayerLabel).join(', ')}`
			: '';
		const leftLabel = `${graph.architectureName} · rev ${graph.sourceRevision.slice(0, 8)} · ${options.mode === 'technical' ? 'Technical Design' : 'Visual Design'} · ${scoped.scopeLabel}${hiddenNote}`;
		const rightLabel = `${scoped.nodes.length} resources · ${scoped.edges.length} edges · ${captured.slice(0, 19).replace('T', ' ')} UTC`;
		parts.push(
			`<rect x="0" y="${contentHeight}" width="${width}" height="${footerH}" fill="${palette.surface}"/>`,
			`<line x1="0" y1="${contentHeight}" x2="${width}" y2="${contentHeight}" stroke="${palette.border}" stroke-width="1"/>`,
			`<text x="16" y="${contentHeight + 26}" fill="${palette.fg}" font-size="11" font-weight="600">${escapeXml(truncateText(leftLabel, 96))}</text>`,
			`<text x="${width - 16}" y="${contentHeight + 26}" text-anchor="end" fill="${palette.muted}" font-size="10.5" font-family="Consolas, Courier New, monospace">${escapeXml(rightLabel)}</text>`
		);
	}

	parts.push(`</svg>`);
	return {
		svg: parts.join('\n'),
		width,
		height,
		nodeCount: scoped.nodes.length,
		edgeCount: scoped.edges.length,
	};
}

/** Generates a structured Markdown Architecture Report from the captured revision. */
export function renderArchitectureMarkdownReport(
	graph: CanvasGraphSnapshot,
	projection: CanvasProjection,
	options: DiagramExportOptions
): string {
	const scoped = selectExportScope(projection, options);
	const captured = options.capturedAtIso ?? new Date().toISOString();
	const lines: string[] = [
		`# ${graph.architectureName} — Architecture Report`,
		'',
		'| Field | Value |',
		'| --- | --- |',
		`| Source Revision | \`${graph.sourceRevision}\` |`,
		`| Coverage | \`${graph.status}\` |`,
		`| Scope | ${scoped.scopeLabel} |`,
		`| Design Mode | ${options.mode === 'technical' ? 'Technical Design' : 'Visual Design'} |`,
		`| Resources / Edges | ${scoped.nodes.length} / ${scoped.edges.length} (total in root: ${graph.nodes.length} / ${graph.edges.length}) |`,
		`| Captured At | ${captured} |`,
	];

	if (options.hiddenLayers.length > 0) {
		lines.push(`| Hidden Layers | ${options.hiddenLayers.map(exportLayerLabel).join(', ')} |`);
	}
	lines.push('');

	if (options.dependencyReport && options.dependencyReport.providers.length > 0) {
		lines.push(
			'## Provider Dependencies & Locks',
			'',
			`Engine: \`${options.dependencyReport.engine}\`${options.dependencyReport.engineInferred ? ' (inferred)' : ''} · Lock file: \`${options.dependencyReport.lockState}\``,
			'',
			'| Provider | Status | Locked Version | Requirements | Conflicts |',
			'| --- | --- | --- | --- | --- |'
		);
		for (const prov of options.dependencyReport.providers) {
			lines.push(`| \`${prov.display}\` | ${prov.status} | ${prov.lockedVersion ? `\`${prov.lockedVersion}\`` : '—'} | ${prov.requirementCount} | ${prov.conflictCount} |`);
		}
		lines.push('');
	}

	lines.push(
		'## Resources',
		'',
		'| Name | Type | Provider | Layer | Validation |',
		'| --- | --- | --- | --- | --- |'
	);
	const sortedNodes = [...scoped.nodes].sort((a, b) => a.layer.localeCompare(b.layer) || a.node.name.localeCompare(b.node.name));
	for (const item of sortedNodes) {
		const valStatus = options.includeValidation && options.validationRun?.nodeResults[item.node.id]
			? options.validationRun.nodeResults[item.node.id].status
			: '—';
		lines.push(`| \`${item.node.name}\` | \`${item.node.resourceType ?? item.node.kind}\` | ${exportProviderLabel(item.provider)} | ${exportLayerLabel(item.layer)} | ${valStatus} |`);
	}
	lines.push('');

	if (scoped.edges.length > 0) {
		const nodeLabelById = new Map(graph.nodes.map(n => [n.id, n.label]));
		lines.push('## Dependencies', '');
		for (const edge of scoped.edges) {
			const from = nodeLabelById.get(edge.fromId) ?? edge.fromId;
			const to = nodeLabelById.get(edge.toId) ?? edge.toId;
			lines.push(`- \`${from}\` \u2192 \`${to}\` (${edge.kind})`);
		}
		lines.push('');
	}

	if (options.includeValidation && options.validationRun) {
		lines.push(
			'## Validation Summary',
			'',
			`- **Run ID:** \`${options.validationRun.runId}\` (attempt #${options.validationRun.attempt})`,
			`- **Outcome:** \`${options.validationRun.outcome}\` · **Coverage:** \`${options.validationRun.coverage}\``,
			''
		);
		for (const note of options.validationRun.coverageNotes) {
			lines.push(`- ${note}`);
		}
		lines.push('');
	}

	if (scoped.annotations.length > 0) {
		lines.push('## Canvas Annotations', '');
		for (const note of scoped.annotations) {
			lines.push(`- ${note.text.replace(/\r?\n/g, ' ')}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
