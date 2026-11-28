/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, DesignMode, Position } from './model.ts';
import { canvasElements, expandGroups, resizeAnchorPoint, resizeLimits, type ResizeAnchor } from './canvasOperations.ts';
import { resourceDescendants } from './resourceHierarchy.ts';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical' | 'tidy' | 'flip-h' | 'flip-v';
export type ElementSize = { width: number; height: number };
export type SelectionUnitBox = { members: string[]; x: number; y: number; width: number; height: number };
export type SpacingHandle = { id: string; axis: 'x' | 'y'; x: number; y: number; length: number; index: number; gap: number };
export type SpacingLayout = {
	x?: { gap: number; columns: SelectionUnitBox[][]; handles: SpacingHandle[] };
	y?: { gap: number; rows: SelectionUnitBox[][]; handles: SpacingHandle[] };
};

/** Grouped elements and frames are alignment units; their members are never shifted twice. */
export function selectionUnits(architecture: Architecture, ids: string[]): string[][] {
	const expanded = expandGroups(architecture, ids); const selected = new Set(expanded);
	const covered = new Set(architecture.items.filter(item => item.kind === 'frame' && selected.has(item.id)).flatMap(item => item.members));
	for (const resource of architecture.resources.filter(item => selected.has(item.id))) { resourceDescendants(architecture, resource.id).forEach(child => covered.add(child.id)); }
	const roots = expanded.filter(id => !covered.has(id)); const used = new Set<string>(); const units: string[][] = [];
	for (const id of roots) {
		if (used.has(id)) { continue; }
		const group = architecture.groups?.find(group => group.members.includes(id));
		const members = group ? roots.filter(candidate => group.members.includes(candidate)) : [id];
		members.forEach(member => used.add(member)); units.push(members);
	}
	return units;
}

export function selectionUnitBoxes(architecture: Architecture, ids: string[], mode: DesignMode, sizes: Record<string, ElementSize>, displayedPositions: Record<string, Position> = {}): SelectionUnitBox[] {
	const byId = new Map(canvasElements(architecture).map(item => [item.id, item]));
	return selectionUnits(architecture, ids).filter(unit => unit.every(id => !byId.get(id)?.canvasLocked)).map(members => {
		const boxes = members.map(id => { const item = byId.get(id)!; const position = displayedPositions[id] ?? item.positions[mode]; const size = sizes[id] ?? (Object.hasOwn(item, 'width') ? { width: (item as { width: number; height: number }).width, height: (item as { width: number; height: number }).height } : { width: 112, height: 92 }); return { ...position, ...size }; });
		const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
		return { members, x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
	});
}

function groupBands(units: readonly SelectionUnitBox[], axis: 'x' | 'y'): SelectionUnitBox[][] {
	const sorted = [...units].sort((a, b) => axis === 'x' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x);
	const bands: SelectionUnitBox[][] = [];
	for (const unit of sorted) {
		const start = axis === 'x' ? unit.x : unit.y;
		const end = start + (axis === 'x' ? unit.width : unit.height);
		const last = bands[bands.length - 1];
		if (!last) { bands.push([unit]); continue; }
		const bandStart = Math.min(...last.map(item => axis === 'x' ? item.x : item.y));
		const bandEnd = Math.max(...last.map(item => (axis === 'x' ? item.x + item.width : item.y + item.height)));
		const overlap = Math.min(end, bandEnd) - Math.max(start, bandStart);
		const minSpan = Math.min(end - start, bandEnd - bandStart);
		if (overlap > Math.max(4, minSpan * 0.25)) { last.push(unit); } else { bands.push([unit]); }
	}
	return bands;
}

/** Detect Miro-style adjustable horizontal and/or vertical gaps across 2+ selected units. */
export function detectSpacingLayout(units: readonly SelectionUnitBox[]): SpacingLayout | null {
	if (units.length < 2) { return null; }
	const result: SpacingLayout = {};
	const buildAxis = (axis: 'x' | 'y') => {
		const bands = groupBands(units, axis);
		if (bands.length < 2) { return undefined; }
		const spans = bands.map(band => ({
			band,
			start: Math.min(...band.map(item => axis === 'x' ? item.x : item.y)),
			end: Math.max(...band.map(item => axis === 'x' ? item.x + item.width : item.y + item.height)),
			crossStart: Math.min(...band.map(item => axis === 'x' ? item.y : item.x)),
			crossEnd: Math.max(...band.map(item => axis === 'x' ? item.y + item.height : item.x + item.width)),
		}));
		const gaps: number[] = [];
		const handles: SpacingHandle[] = [];
		for (let index = 0; index < spans.length - 1; index++) {
			const a = spans[index]; const b = spans[index + 1];
			const gap = b.start - a.end;
			if (gap < -4) { return undefined; }
			const crossStart = Math.max(a.crossStart, b.crossStart);
			const crossEnd = Math.min(a.crossEnd, b.crossEnd);
			if (crossEnd - crossStart < 8) { return undefined; }
			gaps.push(gap);
			const mid = (a.end + b.start) / 2;
			const length = Math.max(18, Math.min(64, (crossEnd - crossStart) * 0.55));
			const crossMid = (crossStart + crossEnd) / 2;
			handles.push({
				id: axis + ':' + index,
				axis,
				x: axis === 'x' ? mid : crossMid,
				y: axis === 'x' ? crossMid : mid,
				length,
				index,
				gap: Math.round(gap),
			});
		}
		const avgGap = Math.max(0, Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length));
		return { gap: avgGap, bands, handles };
	};
	const xAxis = buildAxis('x');
	if (xAxis) { result.x = { gap: xAxis.gap, columns: xAxis.bands, handles: xAxis.handles }; }
	const yAxis = buildAxis('y');
	if (yAxis) { result.y = { gap: yAxis.gap, rows: yAxis.bands, handles: yAxis.handles }; }
	return result.x || result.y ? result : null;
}

/** Shift every column/row to a uniform gap along the dragged axis, anchoring the first band. */
export function applyUniformSpacing(
	architecture: Architecture,
	ids: string[],
	mode: DesignMode,
	axis: 'x' | 'y',
	targetGap: number,
	sizes: Record<string, ElementSize>,
	displayedPositions: Record<string, Position> = {}
): Record<string, Position> {
	const units = selectionUnitBoxes(architecture, ids, mode, sizes, displayedPositions);
	const spacing = detectSpacingLayout(units);
	const bands = axis === 'x' ? spacing?.x?.columns : spacing?.y?.rows;
	if (!bands || bands.length < 2 || !Number.isFinite(targetGap)) { return {}; }
	const clampedGap = Math.round(Math.max(0, Math.min(320, targetGap)));
	const byId = new Map(canvasElements(architecture).map(item => [item.id, item]));
	const positions: Record<string, Position> = {};
	let cursor = Math.min(...bands[0].map(unit => axis === 'x' ? unit.x : unit.y));
	for (const band of bands) {
		const bandStart = Math.min(...band.map(unit => axis === 'x' ? unit.x : unit.y));
		const bandEnd = Math.max(...band.map(unit => axis === 'x' ? unit.x + unit.width : unit.y + unit.height));
		const delta = cursor - bandStart;
		for (const unit of band) {
			for (const id of unit.members) {
				const before = byId.get(id)!.positions[mode];
				positions[id] = axis === 'x' ? { x: Math.round(before.x + delta), y: before.y } : { x: before.x, y: Math.round(before.y + delta) };
			}
		}
		cursor += (bandEnd - bandStart) + clampedGap;
	}
	return positions;
}

export function layoutSelection(architecture: Architecture, ids: string[], mode: DesignMode, alignment: Alignment, sizes: Record<string, ElementSize>, displayedPositions: Record<string, Position> = {}): Record<string, Position> {
	const byId = new Map(canvasElements(architecture).map(item => [item.id, item]));
	const units = selectionUnitBoxes(architecture, ids, mode, sizes, displayedPositions);
	if (units.length < (alignment === 'horizontal' || alignment === 'vertical' ? 3 : 2)) { return {}; }
	const left = Math.min(...units.map(unit => unit.x)); const right = Math.max(...units.map(unit => unit.x + unit.width));
	const top = Math.min(...units.map(unit => unit.y)); const bottom = Math.max(...units.map(unit => unit.y + unit.height));
	const positions: Record<string, Position> = {};
	if (alignment === 'tidy') {
		const defaultGap = 24;
		const rows = groupBands(units, 'y').map(row => [...row].sort((a, b) => a.x - b.x));
		if (rows.length === 1) {
			const row = rows[0];
			const centreY = (top + bottom) / 2;
			let cursor = left;
			for (const unit of row) {
				const x = Math.round(cursor);
				const y = Math.round(centreY - unit.height / 2);
				for (const id of unit.members) { const before = byId.get(id)!.positions[mode]; positions[id] = { x: before.x + x - unit.x, y: before.y + y - unit.y }; }
				cursor += unit.width + defaultGap;
			}
			return positions;
		}
		if (rows.every(row => row.length === 1)) {
			const col = rows.map(row => row[0]);
			const centreX = (left + right) / 2;
			let cursor = top;
			for (const unit of col) {
				const x = Math.round(centreX - unit.width / 2);
				const y = Math.round(cursor);
				for (const id of unit.members) { const before = byId.get(id)!.positions[mode]; positions[id] = { x: before.x + x - unit.x, y: before.y + y - unit.y }; }
				cursor += unit.height + defaultGap;
			}
			return positions;
		}
		// 2D tidy grid: preserve detected rows if structured, or balance into neat rows x cols.
		const maxCols = Math.max(...rows.map(row => row.length));
		const gridRows = maxCols >= 2 ? rows : (() => {
			const cols = Math.ceil(Math.sqrt(units.length));
			const ordered = [...units].sort((a, b) => a.y - b.y || a.x - b.x);
			const result: SelectionUnitBox[][] = [];
			for (let i = 0; i < ordered.length; i += cols) { result.push(ordered.slice(i, i + cols)); }
			return result;
		})();
		const colCount = Math.max(...gridRows.map(row => row.length));
		const colWidths = Array.from({ length: colCount }, (_, col) => Math.max(...gridRows.map(row => row[col]?.width ?? 0)));
		const rowHeights = gridRows.map(row => Math.max(...row.map(unit => unit.height)));
		let cursorY = top;
		for (let r = 0; r < gridRows.length; r++) {
			let cursorX = left;
			for (let c = 0; c < gridRows[r].length; c++) {
				const unit = gridRows[r][c];
				const x = Math.round(cursorX + (colWidths[c] - unit.width) / 2);
				const y = Math.round(cursorY + (rowHeights[r] - unit.height) / 2);
				for (const id of unit.members) { const before = byId.get(id)!.positions[mode]; positions[id] = { x: before.x + x - unit.x, y: before.y + y - unit.y }; }
				cursorX += colWidths[c] + defaultGap;
			}
			cursorY += rowHeights[r] + defaultGap;
		}
		return positions;
	}
	if (alignment === 'horizontal') { units.sort((a, b) => a.x - b.x); } else if (alignment === 'vertical') { units.sort((a, b) => a.y - b.y); }
	const gap = alignment === 'horizontal' ? (right - left - units.reduce((sum, unit) => sum + unit.width, 0)) / (units.length - 1) : (bottom - top - units.reduce((sum, unit) => sum + unit.height, 0)) / (units.length - 1);
	let cursor = alignment === 'horizontal' ? left : top;
	for (const unit of units) {
		let x = unit.x; let y = unit.y;
		if (alignment === 'left') { x = left; } else if (alignment === 'center') { x = (left + right - unit.width) / 2; } else if (alignment === 'right') { x = right - unit.width; }
		else if (alignment === 'top') { y = top; } else if (alignment === 'middle') { y = (top + bottom - unit.height) / 2; } else if (alignment === 'bottom') { y = bottom - unit.height; }
		else if (alignment === 'flip-h') { x = Math.round(left + right - unit.x - unit.width); }
		else if (alignment === 'flip-v') { y = Math.round(top + bottom - unit.y - unit.height); }
		else if (alignment === 'horizontal') { x = cursor; cursor += unit.width + gap; } else { y = cursor; cursor += unit.height + gap; }
		for (const id of unit.members) { const before = byId.get(id)!.positions[mode]; positions[id] = { x: before.x + x - unit.x, y: before.y + y - unit.y }; }
	}
	return positions;
}

export type Bounds = { x: number; y: number; width: number; height: number };

/** Proportional scale from any corner, kept within the resize command's limits. */
export function dragScale(bounds: Bounds, dx: number, dy: number, corner: ResizeAnchor = 'bottom-right'): number {
	const scale = Math.max((bounds.width + (corner.endsWith('right') ? dx : -dx)) / bounds.width, (bounds.height + (corner.startsWith('bottom') ? dy : -dy)) / bounds.height);
	return Math.min(resizeLimits.maxScale, Math.max(resizeLimits.minScale, Number.isFinite(scale) ? scale : 1));
}

/** Preview a scale about its fixed corner, without moving or copying architecture state. */
export function scaledSelectionBounds(bounds: Bounds, scale: number, anchor: ResizeAnchor): Bounds {
	const fixed = resizeAnchorPoint(bounds, anchor);
	return { x: fixed.x + (bounds.x - fixed.x) * scale, y: fixed.y + (bounds.y - fixed.y) * scale, width: bounds.width * scale, height: bounds.height * scale };
}

