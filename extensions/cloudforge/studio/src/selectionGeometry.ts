/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, DesignMode, Position } from './model.ts';
import { canvasElements, expandGroups, resizeLimits } from './canvasOperations.ts';
import { resourceDescendants } from './resourceHierarchy.ts';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';
export type ElementSize = { width: number; height: number };

/** Grouped elements and frames are alignment units; their members are never shifted twice. */
export function selectionUnits(architecture: Architecture, ids: string[]): string[][] {
	const expanded = expandGroups(architecture, ids); const selected = new Set(expanded);
	const covered = new Set(architecture.items.filter(item => item.kind === 'frame' && selected.has(item.id)).flatMap(item => item.members));
	for(const resource of architecture.resources.filter(item=>selected.has(item.id))){resourceDescendants(architecture,resource.id).forEach(child=>covered.add(child.id));}
	const roots = expanded.filter(id => !covered.has(id)); const used = new Set<string>(); const units: string[][] = [];
	for (const id of roots) {
		if (used.has(id)) { continue; }
		const group = architecture.groups?.find(group => group.members.includes(id));
		const members = group ? roots.filter(candidate => group.members.includes(candidate)) : [id];
		members.forEach(member => used.add(member)); units.push(members);
	}
	return units;
}

export function layoutSelection(architecture: Architecture, ids: string[], mode: DesignMode, alignment: Alignment, sizes: Record<string, ElementSize>): Record<string, Position> {
	const byId = new Map(canvasElements(architecture).map(item => [item.id, item]));
	const units = selectionUnits(architecture, ids).filter(unit => unit.every(id => !byId.get(id)?.canvasLocked)).map(members => {
		const boxes = members.map(id => { const item = byId.get(id)!; const position = item.positions[mode]; const size = sizes[id] ?? ('width' in item ? { width: item.width, height: item.height } : { width: 112, height: 92 }); return { ...position, ...size }; });
		const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
		return { members, x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
	});
	if (units.length < (alignment === 'horizontal' || alignment === 'vertical' ? 3 : 2)) { return {}; }
	const left = Math.min(...units.map(unit => unit.x)); const right = Math.max(...units.map(unit => unit.x + unit.width));
	const top = Math.min(...units.map(unit => unit.y)); const bottom = Math.max(...units.map(unit => unit.y + unit.height));
	const positions: Record<string, Position> = {};
	if (alignment === 'horizontal') { units.sort((a, b) => a.x - b.x); } else if (alignment === 'vertical') { units.sort((a, b) => a.y - b.y); }
	const gap = alignment === 'horizontal' ? (right - left - units.reduce((sum, unit) => sum + unit.width, 0)) / (units.length - 1) : (bottom - top - units.reduce((sum, unit) => sum + unit.height, 0)) / (units.length - 1);
	let cursor = alignment === 'horizontal' ? left : top;
	for (const unit of units) {
		let x = unit.x; let y = unit.y;
		if (alignment === 'left') { x = left; } else if (alignment === 'center') { x = (left + right - unit.width) / 2; } else if (alignment === 'right') { x = right - unit.width; }
		else if (alignment === 'top') { y = top; } else if (alignment === 'middle') { y = (top + bottom - unit.height) / 2; } else if (alignment === 'bottom') { y = bottom - unit.height; }
		else if (alignment === 'horizontal') { x = cursor; cursor += unit.width + gap; } else { y = cursor; cursor += unit.height + gap; }
		for (const id of unit.members) { const before = byId.get(id)!.positions[mode]; positions[id] = { x: before.x + x - unit.x, y: before.y + y - unit.y }; }
	}
	return positions;
}

export type Bounds = { x: number; y: number; width: number; height: number };

/** Proportional scale from a drag of the bottom-right corner, kept within the resize command's limits. */
export function dragScale(bounds: Bounds, dx: number, dy: number): number {
	const scale = Math.max((bounds.width + dx) / bounds.width, (bounds.height + dy) / bounds.height);
	return Math.min(resizeLimits.maxScale, Math.max(resizeLimits.minScale, Number.isFinite(scale) ? scale : 1));
}

