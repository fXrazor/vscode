/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useInternalNodes, useViewport, ViewportPortal } from '@xyflow/react';
import { dragScale, scaledSelectionBounds, type Bounds } from './selectionGeometry.ts';
import { resizeAnchors, type ResizeAnchor } from './canvasOperations.ts';

const oppositeCorner: Record<ResizeAnchor, ResizeAnchor> = { 'top-left': 'bottom-right', 'top-right': 'bottom-left', 'bottom-left': 'top-right', 'bottom-right': 'top-left' };

/**
 * Whiteboard-style corner handle for a multi-selection. Dragging previews the scaled bounds and
 * commits one `resize` canvas command on release, so the whole gesture is one undo step. The
 * corner opposite the pointer stays fixed. The Size menu still defaults to top-left.
 */
export function SelectionResizeHandle({ ids, onScale }: { ids: string[]; onScale: (scale: number, anchor: ResizeAnchor) => void }) {
	const { zoom } = useViewport();
	const nodes = useInternalNodes(ids);
	const boxes = nodes.map(node => [node.internals.positionAbsolute.x, node.internals.positionAbsolute.y, node.measured.width ?? 0, node.measured.height ?? 0]);
	const [scale, setScale] = useState<number>();
	const drag = useRef<{ x: number; y: number; bounds: Bounds; corner: ResizeAnchor; zoom: number }>(undefined);
	if (!boxes.length) { return null; }
	const x = Math.min(...boxes.map(box => box[0])); const y = Math.min(...boxes.map(box => box[1]));
	const bounds = { x, y, width: Math.max(...boxes.map(box => box[0] + box[2])) - x, height: Math.max(...boxes.map(box => box[1] + box[3])) - y };
	if (bounds.width <= 0 || bounds.height <= 0) { return null; }
	const shown = scale !== undefined && drag.current ? scaledSelectionBounds(drag.current.bounds, scale, oppositeCorner[drag.current.corner]) : bounds;
	const size = 12 / zoom;

	const down = (event: ReactPointerEvent<HTMLDivElement>, corner: ResizeAnchor) => {
		if (event.button !== 0 || drag.current) { return; }
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY, bounds, corner, zoom }; setScale(1);
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

	return <ViewportPortal>
		<div className="selection-resize nodrag nopan" aria-hidden="true" style={{ transform: `translate(${shown.x}px, ${shown.y}px)`, width: shown.width, height: shown.height, borderWidth: 1 / zoom }} data-active={scale !== undefined || undefined}>
			{scale !== undefined && <span className="selection-resize-label" style={{ fontSize: 11 / zoom, padding: `${2 / zoom}px ${6 / zoom}px`, top: -22 / zoom, borderRadius: 4 / zoom }}>{Math.round(scale * 100)}%</span>}
			{resizeAnchors.map(corner => <div key={corner} className="selection-resize-handle" data-corner={corner} title={'Drag ' + corner + ' corner to resize the selection'} style={{ width: size, height: size, [corner.endsWith('right') ? 'right' : 'left']: -size / 2, [corner.startsWith('bottom') ? 'bottom' : 'top']: -size / 2, borderWidth: 1.5 / zoom, borderRadius: 3 / zoom }}
				onPointerDown={event => down(event, corner)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setScale(undefined); }} onLostPointerCapture={() => { drag.current = undefined; setScale(undefined); }}/>) }
		</div>
	</ViewportPortal>;
}
