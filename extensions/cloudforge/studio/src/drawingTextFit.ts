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

/** Fractional [top, right, bottom, left] safe-text insets per flowchart/basic shape outline. */
export function shapeTextInsets(shape?: BoardItem['shape']): readonly [number, number, number, number] {
	switch (shape) {
		case 'diamond':
		case 'decision':
			return [0.25, 0.25, 0.25, 0.25];
		case 'triangle':
			return [0.38, 0.24, 0.12, 0.24];
		case 'pentagon':
			return [0.24, 0.22, 0.14, 0.22];
		case 'hexagon':
		case 'preparation':
		case 'data':
		case 'manual':
			return [0.16, 0.22, 0.16, 0.22];
		case 'database':
			return [0.28, 0.14, 0.14, 0.14];
		case 'document':
			return [0.14, 0.14, 0.24, 0.14];
		case 'rectangle':
		case 'process':
			return [0.12, 0.12, 0.12, 0.12];
		case 'subprocess':
			return [0.12, 0.2, 0.12, 0.2];
		default:
			return [0.18, 0.18, 0.18, 0.18];
	}
}

/** Inner content box dimensions available for drawing text, matching CSS `.drawing-content` insets. */
export function drawingTextBox(item: Pick<BoardItem, 'kind' | 'shape' | 'width' | 'height'>): {
	width: number; height: number; insetX: number; insetY: number;
	insetTop: number; insetRight: number; insetBottom: number; insetLeft: number;
} {
	if (item.kind === 'shape') {
		const [topFrac, rightFrac, bottomFrac, leftFrac] = shapeTextInsets(item.shape);
		const insetTop = item.height * topFrac;
		const insetRight = item.width * rightFrac;
		const insetBottom = item.height * bottomFrac;
		const insetLeft = item.width * leftFrac;
		return {
			width: Math.max(16, item.width - insetLeft - insetRight),
			height: Math.max(16, item.height - insetTop - insetBottom),
			insetX: (insetLeft + insetRight) / 2,
			insetY: (insetTop + insetBottom) / 2,
			insetTop, insetRight, insetBottom, insetLeft,
		};
	}
	if (item.kind === 'frame') {
		return { width: Math.max(16, item.width), height: Math.max(16, item.height), insetX: 0, insetY: 0, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0 };
	}
	const inset = 16;
	return { width: Math.max(16, item.width - inset * 2), height: Math.max(16, item.height - inset * 2), insetX: inset, insetY: inset, insetTop: inset, insetRight: inset, insetBottom: inset, insetLeft: inset };
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
export function resolveDrawingTypography(item: Pick<BoardItem, 'kind' | 'shape' | 'text' | 'fontSize' | 'fontFamily' | 'bold' | 'width' | 'height'>): { fontSize: number; lines: string[] } {
	const maxFont = drawingTargetFontSize(item);
	const box = drawingTextBox(item);
	if (item.kind === 'note' || item.kind === 'shape') {
		return fitDrawingFontSize(item.text, box.width, box.height, { maxFont, fontFamily: item.fontFamily, bold: item.bold });
	}
	const ratio = charWidthRatio(item.fontFamily, item.bold);
	const maxChars = Math.max(1, Math.floor(box.width / (maxFont * ratio)));
	return { fontSize: maxFont, lines: wrapTextLines(item.text, maxChars).lines };
}
