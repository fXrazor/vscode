/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/** Original normalized SVG geometry; no third-party stencil assets. */
export const shapeDefinitions = [
	{ id: 'rectangle', label: 'Rectangle', path: 'M 2 2 H 98 V 98 H 2 Z' },
	{ id: 'ellipse', label: 'Ellipse', path: 'M 98 50 A 48 48 0 1 1 2 50 A 48 48 0 1 1 98 50 Z' },
	{ id: 'diamond', label: 'Diamond', path: 'M 50 2 L 98 50 L 50 98 L 2 50 Z' },
	{ id: 'hexagon', label: 'Hexagon', path: 'M 25 2 H 75 L 98 50 L 75 98 H 25 L 2 50 Z' },
	{ id: 'pentagon', label: 'Pentagon', path: 'M 50 2 L 98 39 L 80 98 H 20 L 2 39 Z' },
	{ id: 'triangle', label: 'Triangle', path: 'M 50 2 L 98 98 H 2 Z' }
] as const;

export type ShapeId = typeof shapeDefinitions[number]['id'];
export function shapeStrokeDash(style: 'solid' | 'dashed' | 'dotted' = 'solid', width = 1.5): string | undefined {
	return style === 'solid' ? undefined : style === 'dashed' ? `${width * 4} ${width * 3}` : `${width} ${width * 3}`;
}
export function shapeDefinition(id?: ShapeId) {
	return shapeDefinitions.find(shape => shape.id === id) ?? shapeDefinitions[0];
}

export function shapeTextColor(fill: string): string {
	const channels = /^#[0-9a-f]{6}$/i.test(fill) ? fill.slice(1).match(/../g)!.map(value => {
		const channel = parseInt(value, 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	}) : [1, 1, 1];
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
}
