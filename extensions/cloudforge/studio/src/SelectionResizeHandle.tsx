/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useInternalNodes, useViewport, ViewportPortal } from '@xyflow/react';
import { LayoutGrid, Plus } from 'lucide-react';
import { detectSpacingLayout, dragScale, selectionUnitBoxes, type Bounds, type SelectionUnitBox, type SpacingHandle } from './selectionGeometry.ts';
import { resizeAnchors, type ResizeAnchor } from './canvasOperations.ts';
import { projectResize, type ResizeBox } from './resizeGeometry.ts';
import type { Architecture, DesignMode, Position } from './model.ts';

const oppositeCorner: Record<ResizeAnchor, ResizeAnchor> = { 'top-left': 'bottom-right', 'top-right': 'bottom-left', 'bottom-left': 'top-right', 'bottom-right': 'top-left' };

function previewSpacingBoxes(units: readonly SelectionUnitBox[], bands: readonly SelectionUnitBox[][], axis: 'x' | 'y', targetGap: number): Bounds[] {
	const deltaByMember = new Map<string, number>();
	let cursor = Math.min(...bands[0].map(unit => axis === 'x' ? unit.x : unit.y));
	for (const band of bands) {
		const start = Math.min(...band.map(unit => axis === 'x' ? unit.x : unit.y));
		const end = Math.max(...band.map(unit => axis === 'x' ? unit.x + unit.width : unit.y + unit.height));
		const delta = cursor - start;
		for (const unit of band) { for (const id of unit.members) { deltaByMember.set(id, delta); } }
		cursor += (end - start) + targetGap;
	}
	return units.map(unit => {
		const delta = deltaByMember.get(unit.members[0]) ?? 0;
		return axis === 'x' ? { x: Math.round(unit.x + delta), y: unit.y, width: unit.width, height: unit.height } : { x: unit.x, y: Math.round(unit.y + delta), width: unit.width, height: unit.height };
	});
}

/**
 * Whiteboard-style multi-selection overlay:
 * - Corner handles for proportional multi-object scaling (1 undo step)
 * - Miro-style floating Tidy Up button (auto row/column/grid)
 * - Miro-style interactive gap handles between adjacent units to equalize/adjust spacing live (1 undo step)
 */
export function SelectionResizeHandle({
	architecture, ids, mode, boxes: targets, onScale, onApplySpacing, onTidy
}: {
	architecture: Architecture;
	ids: string[];
	mode: DesignMode;
	boxes: ResizeBox[];
	onScale: (scale: number, anchor: ResizeAnchor) => void;
	onApplySpacing: (axis: 'x' | 'y', gap: number) => void;
	onTidy: () => void;
}) {
	const { zoom } = useViewport();
	const allIds = useMemo(() => [...new Set([...ids, ...targets.map(box => box.id)])], [ids, targets]);
	const nodes = useInternalNodes(allIds);
	const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
	const boxes = targets.flatMap(box => {
		const node = nodeById.get(box.id);
		return node ? [{ ...box, x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width: node.measured.width ?? box.width, height: node.measured.height ?? box.height }] : [];
	});
	const sizes = useMemo(() => Object.fromEntries(nodes.map(node => [node.id, { width: node.measured.width ?? 112, height: node.measured.height ?? 92 }])), [nodes]);
	const displayedPositions = useMemo(() => Object.fromEntries(nodes.map(node => [node.id, { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y } as Position])), [nodes]);
	const units = useMemo(() => selectionUnitBoxes(architecture, ids, mode, sizes, displayedPositions), [architecture, ids, mode, sizes, displayedPositions]);
	const spacing = useMemo(() => detectSpacingLayout(units), [units]);

	const [scale, setScale] = useState<number>();
	const drag = useRef<{ x: number; y: number; bounds: Bounds; boxes: ResizeBox[]; corner: ResizeAnchor; zoom: number }>(undefined);

	const [activeGap, setActiveGap] = useState<{ axis: 'x' | 'y'; gap: number; handle: SpacingHandle; bands: SelectionUnitBox[][] }>();
	const gapDrag = useRef<{ startClient: number; startGap: number; handle: SpacingHandle; bands: SelectionUnitBox[][]; zoom: number; moved: boolean }>(undefined);

	const resizeBoundsBox = boxes.length ? (() => {
		const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
		return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
	})() : undefined;
	const unitBoundsBox = units.length >= 2 ? (() => {
		const x = Math.min(...units.map(unit => unit.x)); const y = Math.min(...units.map(unit => unit.y));
		return { x, y, width: Math.max(...units.map(unit => unit.x + unit.width)) - x, height: Math.max(...units.map(unit => unit.y + unit.height)) - y };
	})() : undefined;

	if (!resizeBoundsBox && !unitBoundsBox) { return null; }
	const shown = resizeBoundsBox && scale !== undefined && drag.current ? projectResize(drag.current.boxes, scale, oppositeCorner[drag.current.corner])?.bounds ?? resizeBoundsBox : resizeBoundsBox;
	const size = 12 / zoom;

	const down = (event: ReactPointerEvent<HTMLDivElement>, corner: ResizeAnchor) => {
		if (event.button !== 0 || drag.current || !resizeBoundsBox) { return; }
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY, bounds: resizeBoundsBox, boxes, corner, zoom }; setScale(1);
	};
	const move = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = drag.current; if (!start) { return; }
		setScale(Math.round(dragScale(start.bounds, (event.clientX - start.x) / start.zoom, (event.clientY - start.y) / start.zoom, start.corner) * 100) / 100);
	};
	const up = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = drag.current; drag.current = undefined; setScale(undefined);
		if (!start) { return; }
		const next = dragScale(start.bounds, (event.clientX - start.x) / start.zoom, (event.clientY - start.y) / start.zoom, start.corner);
		if (Math.abs(next - 1) >= 0.01) { onScale(Math.round(next * 100) / 100, oppositeCorner[start.corner]); }
	};

	const gapDown = (event: ReactPointerEvent<HTMLDivElement>, handle: SpacingHandle, bands: SelectionUnitBox[][], startGap: number) => {
		if (event.button !== 0 || gapDrag.current) { return; }
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		gapDrag.current = { startClient: handle.axis === 'x' ? event.clientX : event.clientY, startGap, handle, bands, zoom, moved: false };
		setActiveGap({ axis: handle.axis, gap: startGap, handle, bands });
	};
	const gapMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = gapDrag.current; if (!start) { return; }
		const deltaPx = (start.handle.axis === 'x' ? event.clientX : event.clientY) - start.startClient;
		if (Math.abs(deltaPx) > 2) { start.moved = true; }
		const nextGap = Math.round(Math.max(0, Math.min(320, start.startGap + (deltaPx / start.zoom) / (start.handle.index + 1))));
		setActiveGap({ axis: start.handle.axis, gap: nextGap, handle: start.handle, bands: start.bands });
	};
	const gapUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = gapDrag.current; gapDrag.current = undefined;
		setActiveGap(undefined);
		if (!start) { return; }
		const deltaPx = (start.handle.axis === 'x' ? event.clientX : event.clientY) - start.startClient;
		const nextGap = Math.round(Math.max(0, Math.min(320, start.startGap + (deltaPx / start.zoom) / (start.handle.index + 1))));
		if (start.moved || start.bands.length >= 3) { onApplySpacing(start.handle.axis, nextGap); }
	};
	const gapCancel = () => { gapDrag.current = undefined; setActiveGap(undefined); };

	const ghostBoxes = activeGap ? previewSpacingBoxes(units, activeGap.bands, activeGap.axis, activeGap.gap) : [];
	const allHandles = scale === undefined ? [
		...(spacing?.x ? spacing.x.handles.map(handle => ({ handle, bands: spacing.x!.columns, baseGap: spacing.x!.gap })) : []),
		...(spacing?.y ? spacing.y.handles.map(handle => ({ handle, bands: spacing.y!.rows, baseGap: spacing.y!.gap })) : []),
	] : [];
	const thickness = 8 / zoom;
	const tidySize = 24 / zoom;

	return <ViewportPortal>
		{shown && shown.width > 0 && shown.height > 0 && <div className="selection-resize nodrag nopan" aria-hidden="true" style={{ transform: `translate(${shown.x}px, ${shown.y}px)`, width: shown.width, height: shown.height, borderWidth: 1 / zoom }} data-active={scale !== undefined || undefined}>
			{scale !== undefined && <span className="selection-resize-label" style={{ fontSize: 11 / zoom, padding: `${2 / zoom}px ${6 / zoom}px`, top: -22 / zoom, borderRadius: 4 / zoom }}>{Math.round(scale * 100)}%</span>}
			{resizeAnchors.map(corner => <div key={corner} className="selection-resize-handle" data-corner={corner} title={'Drag ' + corner + ' corner to resize the selection'} style={{ width: size, height: size, [corner.endsWith('right') ? 'right' : 'left']: -size / 2, [corner.startsWith('bottom') ? 'bottom' : 'top']: -size / 2, borderWidth: 1.5 / zoom, borderRadius: 3 / zoom }}
				onPointerDown={event => down(event, corner)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setScale(undefined); }} onLostPointerCapture={() => { drag.current = undefined; setScale(undefined); }}/>) }
		</div>}
		{unitBoundsBox && scale === undefined && !activeGap && <button type="button" className="selection-tidy-button nodrag nopan" aria-label="Tidy up selection" title="Tidy up spacing and alignment"
			style={{ transform: `translate(${unitBoundsBox.x + unitBoundsBox.width + 8 / zoom}px, ${unitBoundsBox.y}px)`, width: tidySize, height: tidySize, borderRadius: 6 / zoom, borderWidth: 1.5 / zoom }}
			onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onTidy(); }}>
			<LayoutGrid size={13 / zoom} aria-hidden="true" />
		</button>}
		{ghostBoxes.map((box, index) => <div key={index} className="selection-spacing-ghost" aria-hidden="true" style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height, borderWidth: 1.5 / zoom }} />)}
		{allHandles.map(({ handle, bands, baseGap }) => {
			const isActive = activeGap?.handle.id === handle.id;
			const w = handle.axis === 'x' ? thickness : handle.length;
			const h = handle.axis === 'x' ? handle.length : thickness;
			return <div key={handle.id} className="selection-spacing-handle nodrag nopan" data-axis={handle.axis} data-active={isActive || undefined}
				role="slider" tabIndex={0} aria-label={handle.axis === 'x' ? 'Adjust horizontal spacing' : 'Adjust vertical spacing'} aria-valuenow={isActive ? activeGap.gap : baseGap} aria-valuemin={0} aria-valuemax={320}
				title={handle.axis === 'x' ? `Horizontal gap: ${baseGap} px · drag to adjust spacing` : `Vertical gap: ${baseGap} px · drag to adjust spacing`}
				style={{ transform: `translate(${handle.x - w / 2}px, ${handle.y - h / 2}px)`, width: w, height: h, borderWidth: 1.5 / zoom }}
				onPointerDown={event => gapDown(event, handle, bands, baseGap)}
				onPointerMove={gapMove}
				onPointerUp={gapUp}
				onPointerCancel={gapCancel}
				onLostPointerCapture={gapCancel}
				onKeyDown={event => {
					if (event.key === 'Escape') { gapCancel(); return; }
					const delta = event.shiftKey ? 10 : 4;
					if (handle.axis === 'x' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); event.stopPropagation(); onApplySpacing('x', Math.max(0, baseGap + (event.key === 'ArrowRight' ? delta : -delta))); }
					else if (handle.axis === 'y' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); event.stopPropagation(); onApplySpacing('y', Math.max(0, baseGap + (event.key === 'ArrowDown' ? delta : -delta))); }
				}} />;
		})}
		{activeGap && <div className="selection-spacing-badge" aria-live="polite" style={{ left: activeGap.handle.x, top: activeGap.handle.y - 18 / zoom, fontSize: 11 / zoom, padding: `${2 / zoom}px ${6 / zoom}px`, borderRadius: 4 / zoom }}>{activeGap.gap} px</div>}
	</ViewportPortal>;
}

const quickCopyDirs = [
	{ dir: 'right', label: 'Add connected copy to right (Ctrl+Right)', ox: 1, oy: 0.5, dx: 22, dy: 0 },
	{ dir: 'bottom', dirKey: 'down', label: 'Add connected copy below (Ctrl+Down)', ox: 0.5, oy: 1, dx: 0, dy: 22 },
	{ dir: 'left', label: 'Add connected copy to left (Ctrl+Left)', ox: 0, oy: 0.5, dx: -22, dy: 0 },
] as const;

/**
 * Miro-style floating "+" quick-add connected copy dots around a single selected upright drawing.
 * Clicking a dot spawns a matching drawing in that direction linked by a directional arrow (1 undo step).
 */
export function ConnectedCopyHandles({ id, onSpawn }: { id: string; onSpawn: (direction: 'right' | 'left' | 'up' | 'down') => void }) {
	const { zoom } = useViewport();
	const nodes = useInternalNodes([id]);
	const node = nodes[0];
	if (!node || !node.measured.width || !node.measured.height) { return null; }
	const x = node.internals.positionAbsolute.x;
	const y = node.internals.positionAbsolute.y;
	const w = node.measured.width;
	const h = node.measured.height;
	const size = 18 / zoom;
	return <ViewportPortal>
		{quickCopyDirs.map(item => {
			const dir = ('dirKey' in item ? item.dirKey : item.dir) as 'right' | 'left' | 'down';
			const cx = x + w * item.ox + item.dx / zoom;
			const cy = y + h * item.oy + item.dy / zoom;
			return <button key={dir} type="button" className="connected-copy-handle nodrag nopan" data-dir={dir}
				aria-label={item.label} title={item.label}
				style={{ transform: `translate(${cx - size / 2}px, ${cy - size / 2}px)`, width: size, height: size, borderWidth: 1.5 / zoom }}
				onPointerDown={event => event.stopPropagation()}
				onClick={event => { event.stopPropagation(); onSpawn(dir); }}>
				<Plus size={11 / zoom} strokeWidth={2.5} aria-hidden="true" />
			</button>;
		})}
	</ViewportPortal>;
}
