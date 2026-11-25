/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Position } from './model.ts';

/** Angle of a pointer around a centre: 0° points up, clockwise positive, in [0, 360). */
export function pointerAngle(centre: Position, pointer: Position): number {
	const degrees = Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180 / Math.PI + 90;
	return ((degrees % 360) + 360) % 360;
}

/** Shift snaps to 15°; otherwise right angles are sticky within 4° so levelling a drawing is easy. */
export function snapRotation(degrees: number, snap15 = false): number {
	const value = ((degrees % 360) + 360) % 360;
	if (snap15) { return (Math.round(value / 15) * 15) % 360; }
	const right = Math.round(value / 90) * 90;
	return Math.abs(value - right) <= 4 ? right % 360 : Math.round(value * 10) / 10;
}

/** Drag rotation: the drawing turns by however far the pointer has swept around the centre since the press. */
export function dragRotation(startAngle: number, centre: Position, from: Position, to: Position, snap15 = false): number {
	return snapRotation(startAngle + pointerAngle(centre, to) - pointerAngle(centre, from), snap15);
}

/** Corners of a w×h box at (x, y) rotated about its centre: used for export bounds and hit tests. */
export function rotatedCorners(x: number, y: number, width: number, height: number, degrees: number): Position[] {
	const radians = degrees * Math.PI / 180; const cx = x + width / 2; const cy = y + height / 2;
	const cos = Math.cos(radians); const sin = Math.sin(radians);
	return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([px, py]) => ({ x: cx + (px - cx) * cos - (py - cy) * sin, y: cy + (px - cx) * sin + (py - cy) * cos }));
}
