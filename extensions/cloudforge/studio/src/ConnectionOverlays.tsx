/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useInternalNodes, useViewport, ViewportPortal } from '@xyflow/react';
import type { Action, Architecture, DesignConnection, DesignEndpoint, DesignMode, Position } from './model.ts';
import { connectionElementIds, elementEndpoint, endpointPorts, type EndpointPort, endpointElementId, needsConnectionOverlay, pointEndpoint, projectPerimeterAnchor } from './connectionEndpoints.ts';
import { canConnectEndpoints, connectableElements, connectionAnchor } from './designConnections.ts';
import { connectionDash, connectionPath } from './connectionGeometry.ts';
import { ConnectionTools } from './ConnectionTools.tsx';

type Projector = { screenToFlowPosition: (point: Position) => Position };
type Preview = { side: 'source' | 'target'; endpoint: DesignEndpoint; valid: boolean; label: string };

/** Bare coordinates are SVG/HTML viewport overlays, never fabricated React Flow nodes. */
export function ConnectionOverlays({ architecture, mode, selectedId, showLabels, canvas, flow, dispatch, onSelect, onClose }: {
	architecture: Architecture; mode: DesignMode; selectedId: string; showLabels: boolean;
	canvas: RefObject<HTMLElement | null>; flow: Projector; dispatch: Dispatch<Action>; onSelect: (id: string) => void; onClose: () => void;
}) {
	const viewport = useViewport(); const { zoom } = viewport;
	const selected = architecture.connections.find(link => link.id === selectedId);
	const overlays = architecture.connections.filter(link => needsConnectionOverlay(link) || link.id === selectedId);
	const nodes = useInternalNodes([...new Set([...overlays, ...(selected ? [selected] : [])].flatMap(connectionElementIds))]);
	const [preview, setPreview] = useState<Preview>();
	const drag = useRef<{ side: 'source' | 'target' }>(undefined);
	const [waypointPreview, setWaypointPreview] = useState<Position>();
	const bendDrag = useRef(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const [area, setArea] = useState({ width: 1000, height: 700, toolHeight: 210 });
	useLayoutEffect(() => {
		if (!selected || !canvas.current || !toolbar.current) { return; }
		const measure = () => {
			const next = { width: canvas.current!.clientWidth, height: canvas.current!.clientHeight, toolHeight: toolbar.current!.offsetHeight };
			setArea(previous => Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
		};
		const observer = new ResizeObserver(measure); observer.observe(canvas.current); observer.observe(toolbar.current); measure();
		return () => observer.disconnect();
	}, [selectedId, canvas, !!selected]);

	function anchor(link: DesignConnection, side: 'source' | 'target', usePreview = true): Position | undefined {
		const endpoint = usePreview && link.id === selectedId && preview?.side === side ? preview.endpoint : link[side];
		const point = connectionAnchor(architecture, endpoint, side, mode);
		if (!point || endpoint.kind === 'point') { return point; }
		const node = nodes.find(item => item.id === endpoint.elementId);
		if (!node) { return point; }
		const drawing = architecture.items.find(item => item.id === endpoint.elementId);
		const port = endpoint.port ?? (side === 'source' ? 'output' : 'input');
		const handle = [...node.internals.handleBounds?.source ?? [], ...node.internals.handleBounds?.target ?? []].find(handle => handle.id === port);
		if (handle && !drawing?.rotation && !endpoint.anchor) {
			return { x: node.internals.positionAbsolute.x + handle.x + handle.width / 2, y: node.internals.positionAbsolute.y + handle.y + handle.height / 2 };
		}
		const element = drawing ?? architecture.resources.find(item => item.id === endpoint.elementId);
		return element ? { x: point.x + node.internals.positionAbsolute.x - element.positions[mode].x, y: point.y + node.internals.positionAbsolute.y - element.positions[mode].y } : point;
	}

	/** Ctrl / Cmd drops the end freely without snapping to an element (as in Miro); Shift keeps the line at 45° steps. */
	function candidate(clientX: number, clientY: number, side: 'source' | 'target', keys: { free?: boolean; straight?: boolean } = {}): Preview {
		let position = flow.screenToFlowPosition({ x: clientX, y: clientY });
		const other = selected && anchor(selected, side === 'source' ? 'target' : 'source', false);
		if (keys.straight && other) { position = constrainAngle(other, position); }
		let endpoint = pointEndpoint(position);
		const hit = keys.free || keys.straight ? undefined : document.elementsFromPoint(clientX, clientY).find(element => element.closest('.react-flow__node'));
		const node = hit?.closest<HTMLElement>('.react-flow__node');
		const id = node?.dataset.id;
		const target = connectableElements(architecture).find(item => item.id === id);
		// Empty infrastructure container space is still canvas, not an invisible connection target.
		if (target && (!node?.querySelector('.resource-container') || hit?.closest('.resource-container-heading, .react-flow__handle'))) {
			const port = hit?.closest<HTMLElement>('.react-flow__handle')?.dataset.handleid;
			if (port && endpointPorts.includes(port as EndpointPort)) {
				endpoint = elementEndpoint(target.id, port as EndpointPort);
			} else {
				const drawing = architecture.items.find(item => item.id === target.id);
				const rect = node?.getBoundingClientRect();
				const topLeft = rect ? flow.screenToFlowPosition({ x: rect.left, y: rect.top }) : drawing?.positions[mode];
				const bottomRight = rect ? flow.screenToFlowPosition({ x: rect.right, y: rect.bottom }) : undefined;
				const box = drawing
					? { x: drawing.positions[mode].x, y: drawing.positions[mode].y, width: drawing.width, height: drawing.height }
					: topLeft && bottomRight ? { x: topLeft.x, y: topLeft.y, width: Math.max(1, bottomRight.x - topLeft.x), height: Math.max(1, bottomRight.y - topLeft.y) } : undefined;
				if (box) {
					const projected = projectPerimeterAnchor(box, position, drawing?.rotation ?? 0);
					endpoint = elementEndpoint(target.id, projected.port, projected.anchor);
				} else {
					endpoint = elementEndpoint(target.id, side === 'source' ? 'output' : 'input');
				}
			}
		}
		const valid = !!selected && canConnectEndpoints(architecture, side === 'source' ? endpoint : selected.source, side === 'target' ? endpoint : selected.target, selected.id);
		const perimeterNote = endpoint.kind === 'element' && endpoint.anchor ? ' (perimeter)' : '';
		return { side, endpoint, valid, label: !valid ? 'Cannot connect here' : endpoint.kind === 'point' ? keys.free ? 'Free point · snapping off' : keys.straight ? 'Straight · 45° steps' : 'Loose point · hold Ctrl to place freely' : 'Attach to ' + target!.label + perimeterNote };
	}

	const cancel = () => { drag.current = undefined; setPreview(undefined); };
	function move(event: ReactPointerEvent<HTMLButtonElement>) {
		if (drag.current) { setPreview(candidate(event.clientX, event.clientY, drag.current.side, modifierKeys(event))); }
	}
	function release(event: ReactPointerEvent<HTMLButtonElement>) {
		const state = drag.current; if (!state || !selected) { return; }
		const next = candidate(event.clientX, event.clientY, state.side, modifierKeys(event)); cancel();
		if (next.valid) { dispatch({ type: 'reconnectConnection', id: selected.id, side: state.side, endpoint: next.endpoint }); }
	}
	const update = (side: 'source' | 'target', endpoint: DesignEndpoint) => {
		if (selected) { dispatch({ type: 'reconnectConnection', id: selected.id, side, endpoint }); }
	};
	const cancelBend = () => { bendDrag.current = false; setWaypointPreview(undefined); };
	const moveBend = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!bendDrag.current) { return; }
		const pos = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
		setWaypointPreview({ x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 });
	};
	const releaseBend = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!bendDrag.current || !selected) { return; }
		const pos = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
		cancelBend();
		dispatch({ type: 'updateConnection', id: selected.id, patch: { waypoint: { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 } } });
	};

	const source = selected && anchor(selected, 'source', false); const target = selected && anchor(selected, 'target', false);
	const effectiveSelected = selected && waypointPreview ? { ...selected, waypoint: waypointPreview } : selected;
	const selectedGeometry = effectiveSelected && source && target ? connectionPath(effectiveSelected, source.x, source.y, target.x, target.y) : undefined;
	const midpoint = selectedGeometry ? { x: selectedGeometry[1], y: selectedGeometry[2] } : undefined;
	const toolWidth = Math.min(900, Math.max(200, area.width - 80));
	const centreX = source && target ? (source.x + target.x) / 2 * zoom + viewport.x : 80;
	const upper = source && target ? Math.min(source.y, target.y) * zoom + viewport.y - area.toolHeight - 18 : 12;
	const lower = source && target ? Math.max(source.y, target.y) * zoom + viewport.y + 18 : 12;
	const top = Math.max(12, Math.min(area.height - area.toolHeight - 12, upper >= 12 ? upper : lower + area.toolHeight <= area.height - 12 ? lower : 12));
	const left = Math.max(64, Math.min(area.width - toolWidth - 12, centreX - toolWidth / 2));
	const world = { x: (left - viewport.x) / zoom, y: (top - viewport.y) / zoom };

	return <ViewportPortal>
		<svg className="loose-connections" width="1" height="1" aria-label="Canvas design connections">
			{overlays.map(link => {
				const start = anchor(link, 'source'); const end = anchor(link, 'target'); if (!start || !end) { return null; }
				const activeLink = link.id === selectedId && waypointPreview ? { ...link, waypoint: waypointPreview } : link;
				const [path, labelX, labelY] = connectionPath(activeLink, start.x, start.y, end.x, end.y);
				const marker = 'loose-arrow-' + encodeURIComponent(link.id); const active = link.id === selectedId;
				const colour = link.stroke ?? 'var(--accent)'; const font = link.labelFontSize ?? 11;
				const textY = labelY + (link.labelPosition === 'above' ? -18 : link.labelPosition === 'below' ? 18 : 0);
				return <g key={link.id} className="react-flow__edge loose-connection" data-id={link.id} role="group" aria-roledescription="design connection" tabIndex={0} aria-label={'Design connection: ' + (link.label || 'canvas link')}
					onClick={event => { event.stopPropagation(); onSelect(link.id); }}>
					<defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={colour}/></marker></defs>
					{active && <path className="connection-selection-halo" d={path} fill="none" stroke="var(--accent)" strokeOpacity={0.22} strokeWidth={(link.width ?? 1.5) + 8} strokeLinecap="round" pointerEvents="none"/>}
						<path className="react-flow__edge-path" d={path} fill="none" stroke={colour} strokeWidth={link.width ?? 1.5} strokeDasharray={connectionDash(link)} strokeLinecap="round" markerStart={link.startArrow ? `url(#${marker})` : undefined} markerEnd={link.endArrow === false ? undefined : `url(#${marker})`}/>
					<path className="loose-connection-hit" d={path} fill="none" stroke="transparent" strokeWidth={20 / zoom}/>
					{link.label && (showLabels || active || labelIsAuthored(link)) && <g className="loose-connection-label"><rect x={labelX - (link.label.length * font * 0.6 + 12) / 2} y={textY - font * 0.7} width={link.label.length * font * 0.6 + 12} height={font * 1.4} rx={3} fill="var(--panel-solid)"/><text x={labelX} y={textY} textAnchor="middle" dominantBaseline="middle" fill={link.labelColor ?? 'var(--text)'} fontSize={font}>{link.label}</text></g>}
				</g>;
			})}
		</svg>
		{selected && !selected.id.includes('->') && (['source', 'target'] as const).map(side => {
			const point = anchor(selected, side); if (!point) { return null; }
			return <button key={side} className="connection-endpoint nodrag nopan" data-side={side} data-valid={preview?.side === side ? preview.valid : undefined} aria-label={(side === 'source' ? 'Start' : 'End') + ' connection endpoint'} title="Drag to move or reconnect · Hold Ctrl to place freely without snapping · Shift keeps 45° steps · Arrow keys move · Escape cancels"
				style={{ transform: `translate(${point.x}px,${point.y}px) scale(${1 / zoom})` }}
				onPointerDown={event => { if (event.button !== 0) { return; } event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { side }; }}
				onPointerMove={move} onPointerUp={release} onPointerCancel={cancel} onLostPointerCapture={cancel}
				onKeyDown={event => {
					if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
					if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); dispatch({ type: 'deleteConnection', id: selected.id }); onClose(); return; }
					const directions: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
					const direction = directions[event.key];
					if (direction) { event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1; update(side, pointEndpoint({ x: point.x + direction[0] * step, y: point.y + direction[1] * step })); }
				}}/>;
		})}
		{selected && midpoint && <button className="connection-midpoint nodrag nopan" data-bent={selected.waypoint ? 'true' : undefined} aria-label="Drag to bend connection route"
			title={selected.waypoint ? 'Drag to reshape route · Double-click or press Backspace to reset to automatic route · Arrow keys nudge · Escape cancels' : 'Drag to bend connection route around elements · Arrow keys nudge · Escape cancels'}
			style={{ transform: `translate(${midpoint.x}px,${midpoint.y}px) scale(${1 / zoom}) rotate(45deg)` }}
			onPointerDown={event => { if (event.button !== 0) { return; } event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); bendDrag.current = true; setWaypointPreview(midpoint); }}
			onPointerMove={moveBend} onPointerUp={releaseBend} onPointerCancel={cancelBend} onLostPointerCapture={cancelBend}
			onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); cancelBend(); if (selected.waypoint) { dispatch({ type: 'updateConnection', id: selected.id, patch: { waypoint: undefined } }); } }}
			onKeyDown={event => {
				if (event.key === 'Escape' && bendDrag.current) { event.preventDefault(); event.stopPropagation(); cancelBend(); return; }
				if ((event.key === 'Delete' || event.key === 'Backspace' || event.key === '0') && selected.waypoint) { event.preventDefault(); event.stopPropagation(); dispatch({ type: 'updateConnection', id: selected.id, patch: { waypoint: undefined } }); return; }
				const directions: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
				const direction = directions[event.key];
				if (direction) { event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1; const basePt = selected.waypoint ?? midpoint; dispatch({ type: 'updateConnection', id: selected.id, patch: { waypoint: { x: basePt.x + direction[0] * step, y: basePt.y + direction[1] * step } } }); }
			}}/>}
		{waypointPreview && selected && <span className="connection-drop-feedback" role="status" style={{ transform: `translate(${waypointPreview.x}px,${waypointPreview.y}px) scale(${1 / zoom})` }} data-valid="true">Bend route · double-click to reset</span>}
		{preview && selected && <span className="connection-drop-feedback" role="status" style={{ transform: `translate(${anchor(selected, preview.side)?.x ?? 0}px,${anchor(selected, preview.side)?.y ?? 0}px) scale(${1 / zoom})` }} data-valid={preview.valid}>{preview.label}</span>}
		{selected && source && target && <div ref={toolbar} className="selection-anchor connection-overlay-tools" style={{ transform: `translate(${world.x}px,${world.y}px) scale(${1 / zoom})`, width: toolWidth, '--selection-max-width': toolWidth + 'px' } as React.CSSProperties}>
			<ConnectionTools connection={selected} dispatch={dispatch} onClose={onClose}>
				{!selected.id.includes('->') && <div className="endpoint-field-list">
					{(['source', 'target'] as const).map(side => <EndpointField key={side} architecture={architecture} connection={selected} side={side} point={side === 'source' ? source : target} onChange={endpoint => update(side, endpoint)}/>)}
				</div>}
			</ConnectionTools>
		</div>}
	</ViewportPortal>;
}

/** A label someone typed stays visible; only the automatic service edge-kind labels hide until hover or Show labels. */
export const labelIsAuthored = (link: DesignConnection) => !!link.label && (!link.origin || link.label !== link.origin.edgeKind);

const modifierKeys = (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ({ free: event.ctrlKey || event.metaKey, straight: event.shiftKey });

/** Keep a dragged end on the nearest 45° ray from the fixed end. */
export function constrainAngle(from: Position, to: Position): Position {
	const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.hypot(dx, dy);
	const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
	return { x: Math.round((from.x + Math.cos(angle) * length) * 100) / 100, y: Math.round((from.y + Math.sin(angle) * length) * 100) / 100 };
}

function EndpointField({ architecture, connection, side, point, onChange }: { architecture: Architecture; connection: DesignConnection; side: 'source' | 'target'; point: Position; onChange: (endpoint: DesignEndpoint) => void }) {
	const endpoint = connection[side]; const name = side === 'source' ? 'Start' : 'End';
	return <fieldset><legend>{name}</legend><label>Attach to<select aria-label={name + ' endpoint target'} value={endpointElementId(endpoint) ?? ''} onChange={event => onChange(event.target.value ? elementEndpoint(event.target.value) : pointEndpoint(point))}>
		<option value="">Loose canvas point</option>{connectableElements(architecture).map(element => <option key={element.id} value={element.id} disabled={!canConnectEndpoints(architecture, side === 'source' ? elementEndpoint(element.id) : connection.source, side === 'target' ? elementEndpoint(element.id) : connection.target, connection.id)}>{element.label}</option>)}
	</select></label>
		{endpoint.kind === 'element' ? <label>Port<select aria-label={name + ' endpoint port'} value={endpoint.port ?? (side === 'source' ? 'output' : 'input')} onChange={event => onChange({ ...endpoint, port: event.target.value as EndpointPort })}><option value="input">Input / left</option><option value="output">Output / right</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label> : <div className="endpoint-coordinates">
			{(['x', 'y'] as const).map(axis => <CoordinateInput key={axis + ':' + endpoint.position[axis]} label={name + ' endpoint ' + axis.toUpperCase()} value={endpoint.position[axis]} onCommit={value => onChange(pointEndpoint({ ...endpoint.position, [axis]: value }))}/>)}
		</div>}
	</fieldset>;
}

function CoordinateInput({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
	const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
	const edited = useRef(false);
	const number = Number(draft); const valid = draft.trim() !== '' && Number.isFinite(number);
	return <label>{label.endsWith('X') ? 'X' : 'Y'}<input aria-label={label} aria-invalid={!valid || undefined} type="number" step="any" value={draft} onChange={event => { edited.current = true; setDraft(event.target.value); }} onBlur={() => { if (edited.current && valid) { onCommit(number); } else if (!valid) { setDraft(String(Math.round(value * 100) / 100)); } edited.current = false; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/></label>;
}
