/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useInternalNodes, useViewport, ViewportPortal } from '@xyflow/react';
import { dragScale, type Bounds } from './selectionGeometry.ts';

/**
 * Whiteboard-style corner handle for a multi-selection. Dragging previews the scaled bounds and
 * commits one `resize` canvas command on release, so the whole gesture is one undo step. The
 * scale anchors at the selection's top-left, matching the Size menu.
 */
export function SelectionResizeHandle({ ids, onScale }: { ids: string[]; onScale: (scale: number) => void }) {
	const { zoom } = useViewport();
	const nodes = useInternalNodes(ids);
	const boxes = nodes.map(node => [node.internals.positionAbsolute.x, node.internals.positionAbsolute.y, node.measured.width ?? 0, node.measured.height ?? 0]);
	const [scale, setScale] = useState<number>();
	const drag = useRef<{ x: number; y: number; bounds: Bounds }>(undefined);
	if (boxes.length < 2) { return null; }
	const x = Math.min(...boxes.map(box => box[0])); const y = Math.min(...boxes.map(box => box[1]));
	const bounds = { x, y, width: Math.max(...boxes.map(box => box[0] + box[2])) - x, height: Math.max(...boxes.map(box => box[1] + box[3])) - y };
	if (bounds.width <= 0 || bounds.height <= 0) { return null; }
	const shown = scale ?? 1; const size = 12 / zoom;

	const down = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY, bounds }; setScale(1);
	};
	const move = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = drag.current; if (!start) { return; }
		setScale(dragScale(start.bounds, (event.clientX - start.x) / zoom, (event.clientY - start.y) / zoom));
	};
	const up = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = drag.current; drag.current = undefined; setScale(undefined);
		if (!start) { return; }
		const next = dragScale(start.bounds, (event.clientX - start.x) / zoom, (event.clientY - start.y) / zoom);
		if (Math.abs(next - 1) >= 0.01) { onScale(Math.round(next * 100) / 100); }
	};

	return <ViewportPortal>
		<div className="selection-resize nodrag nopan" aria-hidden="true" style={{ transform: `translate(${bounds.x}px, ${bounds.y}px)`, width: bounds.width * shown, height: bounds.height * shown, borderWidth: 1 / zoom }} data-active={scale !== undefined || undefined}>
			{scale !== undefined && <span className="selection-resize-label" style={{ fontSize: 11 / zoom, padding: `${2 / zoom}px ${6 / zoom}px`, top: -22 / zoom, borderRadius: 4 / zoom }}>{Math.round(scale * 100)}%</span>}
			<div className="selection-resize-handle" title="Drag to resize the selection" style={{ width: size, height: size, right: -size / 2, bottom: -size / 2, borderWidth: 1.5 / zoom, borderRadius: 3 / zoom }}
				onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setScale(undefined); }}/>
		</div>
	</ViewportPortal>;
}
