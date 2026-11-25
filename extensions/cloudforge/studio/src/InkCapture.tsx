/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Position } from './model.ts';
import { strokePath, strokeToInk, type InkStyle } from './ink.ts';

type Projector = { screenToFlowPosition: (point: Position) => Position };

/**
 * Pen mode: a transparent layer over the canvas that records one stroke per press. The live
 * stroke is drawn in screen space; on release it becomes one `ink` drawing (one undo step).
 * Wheel events pass through to the canvas so zoom and scroll keep working while drawing.
 */
export function InkCapture({ flow, zoom, ink, onStroke }: { flow: Projector; zoom: number; ink: InkStyle; onStroke: (position: Position, size: { width: number; height: number }, path: string, ink: InkStyle) => void }) {
	const layer = useRef<HTMLDivElement>(null);
	const points = useRef<Position[]>([]);
	const [live, setLive] = useState('');
	const strokeInk = useRef(ink);
	const local = (event: ReactPointerEvent) => { const box = layer.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };

	const down = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) { return; }
		event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
		layer.current?.closest<HTMLElement>('main')?.focus({ preventScroll: true }); // keyboard shortcuts keep working while drawing
		points.current = [{ x: event.clientX, y: event.clientY }];
		strokeInk.current = { ...ink };
		const start = local(event); setLive(strokePath([start]));
	};
	const move = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!points.current.length) { return; }
		const events = 'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
		for (const sample of events.length ? events : [event.nativeEvent]) { points.current.push({ x: sample.clientX, y: sample.clientY }); }
		const box = layer.current!.getBoundingClientRect();
		setLive(strokePath(points.current.map(point => ({ x: point.x - box.left, y: point.y - box.top }))));
	};
	const up = () => {
		const stroke = points.current; points.current = []; setLive('');
		if (!stroke.length) { return; }
		const result = strokeToInk(stroke.map(point => flow.screenToFlowPosition(point)), strokeInk.current.strokeWidth, zoom);
		if (result) { onStroke(result.position, { width: result.width, height: result.height }, result.path, strokeInk.current); }
	};

	return <div ref={layer} className="ink-capture nodrag nopan" aria-hidden="true"
		onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { points.current = []; setLive(''); }}
		onWheel={event => {
			// Hand the wheel to the canvas underneath so zoom and pan still work in pen mode.
			const pane = layer.current?.parentElement?.querySelector('.react-flow__pane');
			pane?.dispatchEvent(new WheelEvent('wheel', event.nativeEvent));
		}}>
		<span className="ink-hint">Pen · draw on the canvas · Esc or V to stop</span>
		<svg><path d={live} stroke={strokeInk.current.strokeColor} strokeWidth={strokeInk.current.strokeWidth * zoom}/></svg>
	</div>;
}
