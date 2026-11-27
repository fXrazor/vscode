/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { BoardItem } from './model.ts';

export const DRAWING_LINE_HEIGHT = 1.35;
export const DRAWING_MIN_FONT = 8;

/** Average glyph width factor by font family (slightly conservative so SVG and pre-paint estimates avoid overflow). */
function charWidthRatio(fontFamily: BoardItem['fontFamily'], bold?: boolean): number {
	const base = fontFamily === 'mono' ? 0.62 : fontFamily === 'serif' ? 0.57 : 0.56;
	return bold ? base * 1.06 : base;
}

/** Inner content box dimensions available for drawing text, matching CSS `.drawing-content` insets. */
export function drawingTextBox(item: Pick<BoardItem, 'kind' | 'width' | 'height'>): { width: number; height: number; insetX: number; insetY: number } {
	if (item.kind === 'shape') {
		const insetX = item.width * 0.18;
		const insetY = item.height * 0.18;
		return { width: Math.max(16, item.width - insetX * 2), height: Math.max(16, item.height - insetY * 2), insetX, insetY };
	}
	if (item.kind === 'frame') {
		return { width: Math.max(16, item.width), height: Math.max(16, item.height), insetX: 0, insetY: 0 };
	}
	const inset = 16;
	return { width: Math.max(16, item.width - inset * 2), height: Math.max(16, item.height - inset * 2), insetX: inset, insetY: inset };
}

/**
 * Target upper-bound font size before box-fitting:
 * - Sticky notes (`note`) default to Miro-style `Auto` scaling when `fontSize` is unset:
 *   calm 16px for empty placeholder text, or proportionally scaled up to ~42% of inner height for authored text.
 * - Explicit `fontSize` acts as the desired / ceiling font size so text fits at the exact chosen size when it fits,
 *   and scales down cleanly rather than spilling outside the sticky note or shape when the box is too small.
 */
export function drawingTargetFontSize(item: Pick<BoardItem, 'kind' | 'fontSize' | 'text' | 'width' | 'height'>): number {
	if (item.fontSize !== undefined) { return item.fontSize; }
	if (item.kind === 'text') { return 20; }
	if (item.kind === 'frame') { return 12; }
	if (item.kind === 'note') {
		if (!item.text.trim()) { return 16; }
		const { height } = drawingTextBox(item);
		return Math.max(16, Math.min(48, Math.round(height * 0.42)));
	}
	return 16;
}

/** Word-aware line wrapping; only breaks mid-word when a single token exceeds `maxChars`. */
export function wrapTextLines(text: string, maxChars: number): { lines: string[]; forcedBreak: boolean } {
	const limit = Math.max(1, maxChars);
	const lines: string[] = [];
	let forcedBreak = false;
	for (const paragraph of text.split('\n')) {
		if (!paragraph) { lines.push(''); continue; }
		const words = paragraph.split(/(\s+)/);
		let current = '';
		for (const token of words) {
			if (!token) { continue; }
			if (/^\s+$/.test(token)) {
				if (current && current.length + token.length <= limit) { current += token; }
				continue;
			}
			if (!current) {
				if (token.length <= limit) {
					current = token;
				} else {
					forcedBreak = true;
					let rest = token;
					while (rest.length > limit) { lines.push(rest.slice(0, limit)); rest = rest.slice(limit); }
					current = rest;
				}
			} else if (current.length + token.length <= limit) {
				current += token;
			} else {
				lines.push(current.trimEnd());
				if (token.length <= limit) {
					current = token;
				} else {
					forcedBreak = true;
					let rest = token;
					while (rest.length > limit) { lines.push(rest.slice(0, limit)); rest = rest.slice(limit); }
					current = rest;
				}
			}
		}
		lines.push(current.trimEnd());
	}
	return { lines: lines.length ? lines : [''], forcedBreak };
}

/**
 * Deterministic font-size fit inside `(innerWidth, innerHeight)` for sticky notes and shapes.
 * Used both as the zero-flash initial size in `DrawingText` and for portable SVG/PNG/PDF exports.
 */
export function fitDrawingFontSize(
	text: string,
	innerWidth: number,
	innerHeight: number,
	options: { maxFont: number; minFont?: number; lineHeight?: number; fontFamily?: BoardItem['fontFamily']; bold?: boolean }
): { fontSize: number; lines: string[] } {
	const minFont = Math.min(options.minFont ?? DRAWING_MIN_FONT, options.maxFont);
	const maxFont = Math.max(minFont, options.maxFont);
	const lineHeight = options.lineHeight ?? DRAWING_LINE_HEIGHT;
	const ratio = charWidthRatio(options.fontFamily, options.bold);
	const sample = text || 'Double-click to add text';

	const fitsAt = (size: number): { ok: boolean; lines: string[] } => {
		const maxChars = Math.max(1, Math.floor(innerWidth / (size * ratio)));
		const { lines, forcedBreak } = wrapTextLines(sample, maxChars);
		const totalHeight = lines.length * size * lineHeight;
		return { ok: !forcedBreak && totalHeight <= innerHeight + 0.5, lines };
	};

	const atMax = fitsAt(maxFont);
	if (atMax.ok) { return { fontSize: maxFont, lines: atMax.lines }; }

	let lo = minFont;
	let hi = maxFont;
	let best = minFont;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (fitsAt(mid).ok) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	const maxChars = Math.max(1, Math.floor(innerWidth / (best * ratio)));
	return { fontSize: best, lines: wrapTextLines(sample, maxChars).lines };
}

/** Resolve fitted font size and wrapped lines for any `BoardItem` (notes and shapes auto-fit; text and frame keep exact size). */
export function resolveDrawingTypography(item: Pick<BoardItem, 'kind' | 'text' | 'fontSize' | 'fontFamily' | 'bold' | 'width' | 'height'>): { fontSize: number; lines: string[] } {
	const maxFont = drawingTargetFontSize(item);
	const box = drawingTextBox(item);
	if (item.kind === 'note' || item.kind === 'shape') {
		return fitDrawingFontSize(item.text, box.width, box.height, { maxFont, fontFamily: item.fontFamily, bold: item.bold });
	}
	const ratio = charWidthRatio(item.fontFamily, item.bold);
	const maxChars = Math.max(1, Math.floor(box.width / (maxFont * ratio)));
	return { fontSize: maxFont, lines: wrapTextLines(item.text, maxChars).lines };
}
