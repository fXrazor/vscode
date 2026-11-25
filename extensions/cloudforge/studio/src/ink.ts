/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Position } from './model.ts';

/** Freehand strokes are drawings only: they never reach Terraform. */
export const inkDefaults = { strokeColor: '#5b4bb7', strokeWidth: 3, minSize: 16 };

/** Drop points closer than `spacing` to the last kept point, always keeping the final point. */
export function thinStroke(points: Position[], spacing: number): Position[] {
	const kept: Position[] = [];
	for (const point of points) {
		const last = kept[kept.length - 1];
		if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= spacing) { kept.push(point); }
	}
	const final = points[points.length - 1];
	if (final && kept[kept.length - 1] !== final && kept.length > 1) { kept.push(final); }
	return kept;
}

/** Smooth path through the points using quadratic curves between midpoints. */
export function strokePath(points: Position[]): string {
	const round = (value: number) => Math.round(value * 100) / 100;
	if (!points.length) { return ''; }
	if (points.length === 1) { return `M${round(points[0].x)} ${round(points[0].y)}l0 0`; }
	let path = `M${round(points[0].x)} ${round(points[0].y)}`;
	for (let index = 1; index < points.length - 1; index++) {
		const point = points[index]; const next = points[index + 1];
		path += `Q${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
	}
	const last = points[points.length - 1];
	return path + `L${round(last.x)} ${round(last.y)}`;
}

/**
 * Turn a stroke in flow coordinates into a drawing's box and a path in a 0–100 viewBox, so
 * the stroke stretches with the element when it is resized. The box is padded by the stroke
 * width and never thinner than `inkDefaults.minSize`.
 */
export function strokeToInk(points: Position[], strokeWidth = inkDefaults.strokeWidth, zoom = 1): { position: Position; width: number; height: number; path: string } | undefined {
	const thinned = thinStroke(points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)), 2 / Math.max(0.1, zoom));
	if (!thinned.length) { return undefined; }
	const pad = strokeWidth;
	const left = Math.min(...thinned.map(point => point.x)); const top = Math.min(...thinned.map(point => point.y));
	const right = Math.max(...thinned.map(point => point.x)); const bottom = Math.max(...thinned.map(point => point.y));
	const width = Math.round(Math.max(inkDefaults.minSize, right - left + pad * 2)); const height = Math.round(Math.max(inkDefaults.minSize, bottom - top + pad * 2));
	const x = Math.round((left + right - width) / 2); const y = Math.round((top + bottom - height) / 2);
	const normalised = thinned.map(point => ({ x: (point.x - x) / width * 100, y: (point.y - y) / height * 100 }));
	return { position: { x, y }, width, height, path: strokePath(normalised) };
}
