/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Position } from './model.ts';

export const resizeAnchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ResizeAnchor = typeof resizeAnchors[number];
export const resizeLimits = { minScale: 0.25, maxScale: 4, minItem: 24, maxItem: 4000 };
export type ResizeBounds = Position & { width: number; height: number };
export type ResizeBox = ResizeBounds & { id: string; min: number; max: number };

export function resizeAnchorPoint(bounds: ResizeBounds, anchor: ResizeAnchor): Position {
	return { x: bounds.x + (anchor.endsWith('right') ? bounds.width : 0), y: bounds.y + (anchor.startsWith('bottom') ? bounds.height : 0) };
}

export function resizeBounds(boxes: ResizeBounds[]): ResizeBounds | undefined {
	if (!boxes.length) { return undefined; }
	const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
	return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

/** The preview and semantic command share clamping, rounding and fixed-corner correction. */
export function projectResize(boxes: ResizeBox[], scale: number, anchor: ResizeAnchor = 'top-left') {
	if (!resizeAnchors.includes(anchor) || !Number.isFinite(scale) || scale < resizeLimits.minScale || scale > resizeLimits.maxScale || boxes.some(box => ![box.x, box.y, box.width, box.height, box.min, box.max].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || box.min <= 0 || box.max < box.min)) { return undefined; }
	const before = resizeBounds(boxes);
	if (!before) { return undefined; }
	if (scale === 1) { return { boxes, bounds: before }; }
	const fixed = resizeAnchorPoint(before, anchor);
	const projected = boxes.map(box => ({ ...box,
		x: Math.round(fixed.x + (box.x - fixed.x) * scale), y: Math.round(fixed.y + (box.y - fixed.y) * scale),
		width: Math.round(Math.max(box.min, Math.min(box.max, box.width * scale))), height: Math.round(Math.max(box.min, Math.min(box.max, box.height * scale)))
	}));
	const after = resizeAnchorPoint(resizeBounds(projected)!, anchor);
	const shifted = projected.map(box => ({ ...box, x: box.x + fixed.x - after.x, y: box.y + fixed.y - after.y }));
	return { boxes: shifted, bounds: resizeBounds(shifted)! };
}
