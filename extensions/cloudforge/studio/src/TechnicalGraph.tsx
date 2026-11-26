/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Dedicated Technical Graph renderer (extracted from the authoring canvas).
 *
 * Contract: this component receives the canonical Architecture read-only and a narrow `onEdit`
 * that only forwards configuration edits allowed by `graphEditAllowed` (rename, fields, bindings).
 * Dragging, layout, pins, expansion, lens, routes and selection live in GraphPresentation and can
 * never move, reparent, resize, create or delete project elements, or enter project Undo.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import {
	Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MiniMap, Position as HandlePosition, ReactFlow,
	getBezierPath, getSmoothStepPath, getStraightPath,
	type Edge, type EdgeProps, type Node, type NodeProps, type OnNodesChange, type ReactFlowInstance, type Viewport,
} from '@xyflow/react';
import { AlertCircle, AlertTriangle, ChevronDown, Crosshair, FileCode2, Search, SlidersHorizontal, X, ChevronUp, Maximize2, Minus, Pencil, Pin, PinOff, Plus, RotateCcw, Scan } from 'lucide-react';
import type { Action, Architecture, DesignMode } from './model.ts';
import { applyWaves, graphLenses, graphOverlays, layerLabels, lensEdges, matchesQuery, neighbourhood, projectTechnicalGraph, traceNode, type NodeOverlay, type PlanAction, type GraphCategory, type GraphEdge, type GraphNode, type GraphPort, type GraphInput, type TechnicalGraphSnapshot } from './technicalGraph.ts';
import { inputSize, layoutTechnicalGraph, placeInputs, visiblePortCount, type GraphLane } from './technicalGraphLayout.ts';
import { graphEditAllowed, type GraphPresentation, type GraphPresentationAction, type RouteStyle } from './graphPresentation.ts';
import { relationshipNames } from './infrastructureRelationships.ts';
import { resourceIntelligence } from './providerKnowledge.ts';

type CardData = { node: GraphNode; /* state 'soft' = hover context */ overlay?: NodeOverlay; badge?: { kind: 'plan' | 'order' | 'impact'; text: string; tone: string; title: string }; match: boolean; compact: boolean; expanded: boolean; state: 'normal' | 'focus' | 'trace' | 'dim' | 'soft'; pinned: boolean; tracedPorts: ReadonlySet<string>; onRename: (id: string, label: string) => void; onEdit: (id: string) => void; onToggleRows: (id: string) => void; onUnpin: (id: string) => void };
type LaneData = { lane: GraphLane };
type GhostData = { input: GraphInput; state: 'normal' | 'trace' | 'dim'; onSelectConsumer: (id: string) => void };
type GhostNode = Node<GhostData, 'ghost'>;
type CardNode = Node<CardData, 'card'>;
type LaneNode = Node<LaneData, 'lane'>;
type GraphFlowNode = CardNode | LaneNode | GhostNode;
type EdgeData = { edge?: GraphEdge; tree?: boolean; input?: boolean; route: RouteStyle; state: 'normal' | 'trace' | 'dim' | 'selected'; animate: boolean; label: string };
type GraphFlowEdge = Edge<EdgeData, 'graph'>;

export const categoryNames: Record<GraphCategory, string> = relationshipNames;
const categoryOrder: GraphCategory[] = ['ownership', 'attachment', 'execution', 'reference', 'runtime', 'observability', 'unclassified'];

const GraphCard = memo(function GraphCard({ data, selected }: NodeProps<CardNode>) {
	const { node, compact, expanded, state, pinned } = data;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(node.label);
	useEffect(() => { if (!editing) { setDraft(node.label); } }, [node.label, editing]);
	const { shown, hidden } = visiblePortCount(node, expanded);
	const commit = () => { setEditing(false); const value = draft.trim(); if (value && value !== node.label) { data.onRename(node.id, value); } };
	return <div className={'tg-card tg-layer-' + node.layer + ' tg-state-' + state + (selected ? ' is-selected' : '') + (compact ? ' is-compact' : '') + (data.match ? '' : ' is-unmatched')} data-review={node.reviewStatus}>
		<Handle type="target" id="in" position={HandlePosition.Top} className="tg-handle" isConnectable={false} />
		<Handle type="target" id="in-bottom" position={HandlePosition.Bottom} className="tg-handle" isConnectable={false} />
		<Handle type="target" id="in-left" position={HandlePosition.Left} className="tg-handle" isConnectable={false} />
		<Handle type="target" id="in-right" position={HandlePosition.Right} className="tg-handle" isConnectable={false} />
		<Handle type="source" id="out-top" position={HandlePosition.Top} className="tg-handle" isConnectable={false} />
		<Handle type="source" id="out-left" position={HandlePosition.Left} className="tg-handle" isConnectable={false} />
		<Handle type="source" id="out-right" position={HandlePosition.Right} className="tg-handle" isConnectable={false} />
		<div className="tg-card-head">
			<img src={'./assets/' + node.icon} alt="" className="tg-icon" />
			<div className="tg-card-title">
				{editing
					? <input className="tg-rename nodrag nopan" aria-label={'Rename ' + node.label} autoFocus value={draft} onChange={event => setDraft(event.target.value)}
						onBlur={commit} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { commit(); } if (event.key === 'Escape') { setDraft(node.label); setEditing(false); } }} />
					: <strong title={node.address + ' · double-click to rename'} onDoubleClick={event => { event.stopPropagation(); setEditing(true); }}>{node.label}</strong>}
				<span>{node.typeLabel}</span>
			</div>
			<div className="tg-card-actions nodrag">
				{node.inCycle && <span className="tg-badge tg-badge-danger" title="Part of a configured reference cycle"><AlertTriangle size={12} /></span>}
				{!!data.overlay?.errors && <span className="tg-badge tg-badge-danger tg-count" title={data.overlay.messages.filter(item => item.severity === 'error').map(item => item.message).join('\n')}><AlertCircle size={11} />{data.overlay.errors}</span>}
				{!data.overlay?.errors && !!data.overlay?.warnings && <span className="tg-badge tg-badge-warning tg-count" title={data.overlay.messages.map(item => item.message).join('\n')}><AlertTriangle size={11} />{data.overlay.warnings}</span>}
				{pinned && <button className="tg-icon-button" aria-label={'Unpin ' + node.label} title="Unpin (graph only)" onClick={event => { event.stopPropagation(); data.onUnpin(node.id); }}><PinOff size={12} /></button>}
				<button className="tg-icon-button" aria-label={'Rename ' + node.label} title="Rename" onClick={event => { event.stopPropagation(); setEditing(true); }}><Pencil size={12} /></button>
				<button className="tg-icon-button" aria-label={'Edit configuration of ' + node.label} title="Edit configuration" onClick={event => { event.stopPropagation(); data.onEdit(node.id); }}><Maximize2 size={12} /></button>
			</div>
		</div>
		{data.badge && <span className={'tg-overlay-badge tg-tone-' + data.badge.tone} title={data.badge.title}>{data.badge.text}</span>}
		<div className="tg-chips">
			{node.region.known ? <span className="tg-chip">{node.region.value}</span> : <span className="tg-chip tg-chip-unknown" title="No region value in this draft">region unknown</span>}
			{compact && node.ports.length > 0 && <span className="tg-chip">{node.ports.length} input{node.ports.length === 1 ? '' : 's'}</span>}
			{node.sourceFile && <span className="tg-chip" title={node.sourceFile + (node.sourceLine ? ':' + node.sourceLine : '')}>{node.sourceFile.split(/[\\/]/).pop()}{node.sourceLine ? ':' + node.sourceLine : ''}</span>}
			{node.reviewStatus === 'unreviewed' && <span className="tg-chip tg-chip-unknown" title="No reviewed provider profile; relationships are shown as generic references">unreviewed</span>}
		</div>
		{!compact && shown > 0 && <ul className="tg-rows" aria-label={'Configured inputs of ' + node.label}>
			{node.ports.slice(0, shown).map(port => <PortRow key={port.id} port={port} traced={data.tracedPorts.has(port.id)} />)}
			{hidden > 0 && <li className="tg-row tg-row-more"><button className="nodrag" onClick={event => { event.stopPropagation(); data.onToggleRows(node.id); }}><ChevronDown size={12} />{hidden} more input{hidden === 1 ? '' : 's'}</button></li>}
			{expanded && node.ports.length > 5 && <li className="tg-row tg-row-more"><button className="nodrag" onClick={event => { event.stopPropagation(); data.onToggleRows(node.id); }}><ChevronUp size={12} />Show fewer</button></li>}
		</ul>}
		<Handle type="source" id="out" position={HandlePosition.Bottom} className="tg-handle" isConnectable={false} />
	</div>;
});

function PortRow({ port, traced }: { port: GraphPort; traced: boolean }) {
	return <li className={'tg-row tg-cat-' + port.category + (traced ? ' is-traced' : '')} title={categoryNames[port.category] + ': ' + port.field + ' → ' + port.peerLabel}>
		<Handle type="target" id={port.id} position={HandlePosition.Left} className="tg-row-handle" isConnectable={false} />
		<span className="tg-row-dot" /><code>{port.field}</code><span className="tg-row-peer">{port.peerLabel}</span>
	</li>;
}

const inputKindLabel: Record<GraphInput['kind'], string> = { variable: 'Variable', local: 'Local value', data: 'Data source (read)' };
/** Ghost card: an input Terraform reads but does not manage here. Not editable, not a resource. */
const GhostCard = memo(function GhostCard({ data }: NodeProps<GhostNode>) {
	const { input } = data;
	const readers = input.consumers.length;
	return <div className={'tg-ghost tg-ghost-' + input.kind + ' tg-state-' + data.state} style={{ width: inputSize.width, height: inputSize.height }}
		title={input.address + ' · read by ' + readers + ' field' + (readers === 1 ? '' : 's') + ': ' + input.consumers.slice(0, 6).map(item => item.field).join(', ') + (input.declared || input.kind !== 'variable' ? '' : ' · not declared in project variables')}>
		<code>{input.address.length > 34 ? input.address.slice(0, 33) + '…' : input.address}</code>
		<span>{inputKindLabel[input.kind]}{input.sensitive ? ' · sensitive' : ''}{input.kind === 'variable' && !input.declared ? ' · undeclared' : ''} · {readers} use{readers === 1 ? '' : 's'}</span>
		<Handle type="source" id="out" position={HandlePosition.Bottom} className="tg-handle" isConnectable={false} />
	</div>;
});

const LaneBand = memo(function LaneBand({ data }: NodeProps<LaneNode>) {
	return <div className={'tg-lane tg-lane-' + data.lane.kind} style={{ width: data.lane.width, height: data.lane.height }}><span>{data.lane.label}</span></div>;
});

function GraphRoute(props: EdgeProps<GraphFlowEdge>) {
	const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, id } = props;
	const route = data?.route ?? 'curved';
	const under = sourcePosition === HandlePosition.Bottom && targetPosition === HandlePosition.Bottom && Math.abs(sourceY - targetY) < 40;
	const dip = Math.max(sourceY, targetY) + 36 + Math.min(90, Math.abs(targetX - sourceX) * 0.12);
	const [path, labelX, labelY] = under ? [route === 'orthogonal' ? `M ${sourceX} ${sourceY} L ${sourceX} ${dip} L ${targetX} ${dip} L ${targetX} ${targetY}` : `M ${sourceX} ${sourceY} C ${sourceX} ${dip}, ${targetX} ${dip}, ${targetX} ${targetY}`, (sourceX + targetX) / 2, dip - 4] as [string, number, number]
		: route === 'straight' ? getStraightPath({ sourceX, sourceY, targetX, targetY })
		: route === 'orthogonal' ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 18 })
			: getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });
	const category = data?.tree ? 'tree' : data?.input ? 'input' : data?.edge?.category ?? 'unclassified';
	const state = data?.state ?? 'normal';
	return <>
		{state !== 'dim' && <path d={path} className={'tg-edge-halo tg-edge-halo-' + state} />}
		<BaseEdge id={id} path={path} markerEnd={markerEnd} className={'tg-edge tg-cat-' + category + ' tg-edge-' + state} interactionWidth={18} />
		{data?.animate && state !== 'dim' && <circle r={3.2} className={'tg-pulse tg-cat-' + category}><animateMotion dur="2.4s" repeatCount="indefinite" path={path} /></circle>}
		{state === 'selected' && data?.label && <EdgeLabelRenderer>
			<div className={'tg-edge-label tg-cat-' + category} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data.label}</div>
		</EdgeLabelRenderer>}
	</>;
}

const nodeTypes = { card: GraphCard, lane: LaneBand, ghost: GhostCard };
const edgeTypes = { graph: GraphRoute };
const fitPadding = { top: '84px', right: '40px', bottom: '84px', left: '40px' } as const;

export interface TechnicalGraphProps {
	architecture: Architecture;
	theme: 'light' | 'dark';
	presentation: GraphPresentation;
	onPresentation: Dispatch<GraphPresentationAction>;
	selectedId: string;
	onSelect: (id: string) => void;
	onOpenDetails: (id: string) => void;
	/** Narrow configuration-edit channel. Placement actions are refused before reaching the project. */
	onEdit: (action: Action) => void;
	onInit?: (instance: ReactFlowInstance<any, any>) => void;
	/** Local and host diagnostics (already projected to resource ids). */
	diagnostics?: readonly { resourceId: string; severity: 'error' | 'warning'; message: string }[];
	/** Latest engine plan, if one has run. Stale when its source revision differs from the project. */
	plan?: { sourceRevision: string; stale: boolean; changes: readonly { address: string; mode?: string; actionKind: PlanAction; changedAttributePaths: readonly string[]; hasSensitiveAttributes: boolean }[] };
	onOpenSource?: (id: string) => void;
	hasSource?: Readonly<Record<string, boolean>>;
	viewports?: RefObject<Partial<Record<DesignMode, Viewport>>>;
}

/** Refuse any action that could move or restructure the project. */
export function dispatchGraphEdit(onEdit: (action: Action) => void, action: Action): boolean {
	if (!graphEditAllowed(action)) { return false; }
	onEdit(action); return true;
}

export const TechnicalGraph = memo(function TechnicalGraph({ architecture, theme, presentation, onPresentation, selectedId, onSelect, onOpenDetails, onEdit, onInit, viewports, diagnostics = [], plan, onOpenSource, hasSource = {} }: TechnicalGraphProps) {
	const snapshot: TechnicalGraphSnapshot = useMemo(() => projectTechnicalGraph(architecture), [architecture]);
	const [zoom, setZoom] = useState(1);
	const [query, setQuery] = useState('');
	const [hoverNode, setHoverNode] = useState('');
	const [hoverEdge, setHoverEdge] = useState('');
	const overlays = useMemo(() => graphOverlays(snapshot, diagnostics, plan?.changes), [snapshot, diagnostics, plan]);
	const waves = useMemo(() => applyWaves(snapshot), [snapshot]);
	const [selectedEdgeId, setSelectedEdgeId] = useState('');
	const [flow, setFlow] = useState<ReactFlowInstance<GraphFlowNode, GraphFlowEdge>>();
	const reducedMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
	const compact = presentation.density === 'compact' || presentation.density === 'auto' && zoom < 0.42;
	const visibleEdges = useMemo(() => lensEdges(snapshot, presentation.lens, presentation.showMembership), [snapshot, presentation.lens, presentation.showMembership]);
	const expanded = useMemo(() => new Set(presentation.expanded), [presentation.expanded]);
	const focusSet = useMemo(() => presentation.focus && snapshot.nodes.some(node => node.id === presentation.focus!.id) ? neighbourhood(visibleEdges, presentation.focus.id, presentation.focus.depth) : undefined, [presentation.focus, snapshot, visibleEdges]);
	const layout = useMemo(() => layoutTechnicalGraph(snapshot, { layout: presentation.layout, expanded, compact: false, pins: presentation.pins, edges: visibleEdges, visible: focusSet, spacing: presentation.spacing, height: presentation.height }), [snapshot, presentation.layout, expanded, presentation.pins, visibleEdges, focusSet, presentation.spacing, presentation.height]);
	const inputLayout = useMemo(() => presentation.showInputs && presentation.layout !== 'tree' ? placeInputs(snapshot.inputs.map(input => ({ ...input, consumers: input.consumers.filter(consumer => layout.positions[consumer.resourceId]) })), layout) : { positions: {} as Record<string, { x: number; y: number }> }, [presentation.showInputs, presentation.layout, snapshot.inputs, layout]);
	const impact = useMemo(() => Object.fromEntries(snapshot.nodes.map(node => [node.id, traceNode(visibleEdges.filter(edge => edge.ordering), node.id).downstream.size])), [snapshot, visibleEdges]);
	const badgeFor = useCallback((node: GraphNode): CardData['badge'] => {
		if (presentation.overlay === 'plan') {
			const change = overlays.byNode[node.id]?.plan;
			if (!plan) { return undefined; }
			const affected = overlays.byNode[node.id]?.affectedBy;
			const affectedTitle = affected?.length ? ' · depends on planned replace/destroy of ' + affected.map(id => snapshot.nodes.find(item => item.id === id)?.label ?? id).slice(0, 4).join(', ') : '';
			if (!change || change.action === 'noOp') { return affected?.length ? { kind: 'plan', text: '⚠ affected', tone: 'affected', title: 'No planned change of its own' + affectedTitle + '. Check that its references survive.' } : { kind: 'plan', text: 'no change', tone: 'muted', title: 'Not in the latest plan, or no changes planned' }; }
			const symbol: Record<PlanAction, string> = { create: '+ create', update: '~ update', replace: '± replace', delete: '− destroy', read: '↻ read', noOp: 'no change' };
			return { kind: 'plan', text: symbol[change.action] + (change.instances > 1 ? ' ×' + change.instances : ''), tone: change.action, title: (change.changed.length ? 'Changed: ' + change.changed.slice(0, 8).join(', ') : 'Planned action') + (change.sensitive ? ' · includes sensitive values' : '') + affectedTitle + (plan.stale ? ' · plan is older than this draft' : '') };
		}
		if (presentation.overlay === 'order') { const wave = waves[node.id]; return wave === undefined ? { kind: 'order', text: 'cycle', tone: 'delete', title: 'In a reference cycle; Terraform cannot order it' } : { kind: 'order', text: 'wave ' + (wave + 1), tone: 'order', title: 'Longest prerequisite chain before this resource. Resources in the same wave can be created in parallel; destroy runs in reverse.' }; }
		if (presentation.overlay === 'impact') { const count = impact[node.id] ?? 0; return { kind: 'impact', text: count ? 'used by ' + count : 'leaf', tone: count >= 8 ? 'replace' : count >= 3 ? 'update' : 'muted', title: 'Configured resources downstream of this one. Not an outage or replacement prediction.' }; }
		return undefined;
	}, [presentation.overlay, overlays, plan, waves, impact, snapshot.nodes]);
	const selectedNode = snapshot.nodes.find(node => node.id === selectedId);
	const trace = useMemo(() => selectedNode ? traceNode(visibleEdges, selectedNode.id) : undefined, [visibleEdges, selectedNode]);
	const selectedEdge = snapshot.edges.find(edge => edge.id === selectedEdgeId);
	useEffect(() => { if (selectedEdgeId && !selectedEdge) { setSelectedEdgeId(''); } }, [selectedEdgeId, selectedEdge]);

	const rename = useCallback((id: string, label: string) => { dispatchGraphEdit(onEdit, { type: 'update', id, patch: { label } }); }, [onEdit]);
	const toggleRows = useCallback((id: string) => onPresentation({ type: 'toggleExpanded', id }), [onPresentation]);
	const unpin = useCallback((id: string) => onPresentation({ type: 'unpin', id }), [onPresentation]);

	const tracedPorts = useMemo(() => new Set(visibleEdges.filter(edge => trace?.edges.has(edge.id)).map(edge => edge.targetPort)), [visibleEdges, trace]);
	const computedNodes = useMemo<GraphFlowNode[]>(() => {
		const lanes: LaneNode[] = [...layout.columns, ...layout.lanes].map(lane => ({ id: lane.id, type: 'lane', position: { x: lane.x, y: lane.y }, data: { lane }, draggable: false, selectable: false, focusable: false, connectable: false, deletable: false, zIndex: -2 }));
		const hoveredEdge = hoverEdge ? visibleEdges.find(edge => edge.id === hoverEdge) : undefined;
		const hoveredInput = hoverNode.startsWith('input:') ? snapshot.inputs.find(input => input.id === hoverNode) : undefined;
		const hoverPeers = hoveredInput ? new Set(hoveredInput.consumers.map(consumer => consumer.resourceId)) : hoverNode ? new Set(visibleEdges.flatMap(edge => edge.source === hoverNode ? [edge.target] : edge.target === hoverNode ? [edge.source] : [])) : undefined;
		const cards: CardNode[] = snapshot.nodes.filter(node => layout.positions[node.id]).map(node => {
			const state: CardData['state'] = hoveredEdge ? (node.id === hoveredEdge.source || node.id === hoveredEdge.target ? 'trace' : 'soft')
				: hoverNode && !selectedNode ? (node.id === hoverNode ? 'focus' : hoverPeers!.has(node.id) ? 'trace' : 'soft')
				: !selectedNode ? 'normal' : node.id === selectedNode.id ? 'focus' : trace?.upstream.has(node.id) || trace?.downstream.has(node.id) ? 'trace' : 'dim';
			return { id: node.id, type: 'card', position: layout.positions[node.id], selected: node.id === selectedId, draggable: true, connectable: false, deletable: false,
				ariaLabel: node.label + ', ' + node.typeLabel + ', ' + layerLabels[node.layer],
				data: { node, overlay: overlays.byNode[node.id], badge: badgeFor(node), match: !query.trim() || matchesQuery(node, query), compact, expanded: expanded.has(node.id), state, pinned: !!presentation.pins[node.id], tracedPorts, onRename: rename, onEdit: onOpenDetails, onToggleRows: toggleRows, onUnpin: unpin } };
		});
		const ghosts: GhostNode[] = Object.entries(inputLayout.positions).map(([id, position]) => {
			const input = snapshot.inputs.find(item => item.id === id)!;
			const related = id === hoverNode || input.consumers.some(consumer => consumer.resourceId === (hoverNode || selectedId));
			return { id, type: 'ghost', position, draggable: false, selectable: false, connectable: false, deletable: false, focusable: false, ariaLabel: input.address + ', ' + inputKindLabel[input.kind],
				data: { input, state: !(hoverNode || selectedNode) ? 'normal' : related ? 'trace' : 'dim', onSelectConsumer: onSelect } };
		});
		const inputLanes: LaneNode[] = inputLayout.lane ? [{ id: inputLayout.lane.id, type: 'lane', position: { x: inputLayout.lane.x, y: inputLayout.lane.y }, data: { lane: inputLayout.lane }, draggable: false, selectable: false, focusable: false, connectable: false, deletable: false, zIndex: -2 }] : [];
		return [...lanes, ...inputLanes, ...cards, ...ghosts];
	}, [inputLayout, onSelect, layout, snapshot, selectedNode, selectedId, trace, compact, expanded, presentation.pins, tracedPorts, rename, onOpenDetails, toggleRows, unpin, overlays, badgeFor, query, hoverNode, hoverEdge, visibleEdges]);
	// Local copy only so React Flow can show a drag in progress. It is rebuilt from layout + pins.
	const [nodes, setNodes] = useState<GraphFlowNode[]>(computedNodes);
	// Keep React Flow's measurements when presentation changes (hover, selection, overlays), otherwise
	// nodes are hidden until re-measured and the graph flickers or blanks.
	useEffect(() => setNodes(current => { const previous = new Map(current.map(node => [node.id, node])); return computedNodes.map(node => { const old = previous.get(node.id); return old?.measured ? { ...node, measured: old.measured } as GraphFlowNode : node; }); }), [computedNodes]);
	const onNodesChange: OnNodesChange<GraphFlowNode> = useCallback(changes => {
		// Never apply removals, additions or replacements; positions are graph-local until a pin is stored.
		if ([...changes].some(change => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) { return; }
		setNodes(current => changes.applyTo(current));
	}, []);

	const edges = useMemo<GraphFlowEdge[]>(() => {
		const cardIds = new Set(Object.keys(layout.positions));
		const visiblePort = (edge: GraphEdge) => {
			if (compact) { return 'in'; }
			const node = snapshot.nodes.find(item => item.id === edge.target); if (!node) { return 'in'; }
			const { shown } = visiblePortCount(node, expanded.has(node.id));
			return node.ports.slice(0, shown).some(port => port.id === edge.targetPort) ? edge.targetPort : 'in';
		};
		// Pick sides from relative placement so upward and same-band links do not loop around cards.
		const handles = (edge: GraphEdge): [string, string] => {
			const s = layout.positions[edge.source]; const t = layout.positions[edge.target]; const sh = layout.sizes[edge.source].height; const th = layout.sizes[edge.target].height;
			const row = visiblePort(edge);
			if (t.y >= s.y + sh - 4) { return ['out', row]; }
			if (t.y + th <= s.y + 4) { return ['out-top', row === 'in' ? 'in-bottom' : row]; }
			// Same band: neighbours link side to side; distant cards link underneath so lines never cross cards.
			const adjacent = Math.abs(t.x - s.x) <= layout.sizes[edge.source].width + 80;
			if (!adjacent) { return ['out', 'in-bottom']; }
			return t.x >= s.x ? ['out-right', row === 'in' ? 'in-left' : row] : ['out-left', 'in-right'];
		};
		// The ownership tree shows parent links; evidence lines appear only for the selected trace or relationship.
		const treeMode = presentation.layout === 'tree';
		const graphEdges: GraphFlowEdge[] = visibleEdges.filter(edge => cardIds.has(edge.source) && cardIds.has(edge.target) && (!treeMode || trace?.edges.has(edge.id) || edge.id === selectedEdgeId)).map(edge => {
			const [sourceHandle, targetHandle] = handles(edge);
			const hovered = edge.id === hoverEdge || (!!hoverNode && !selectedNode && (edge.source === hoverNode || edge.target === hoverNode));
			const state: EdgeData['state'] = edge.id === selectedEdgeId || edge.id === hoverEdge ? 'selected'
				: hoverEdge ? 'dim'
				: hoverNode && !selectedNode ? (hovered ? 'trace' : 'dim')
				: !trace ? 'normal' : trace.edges.has(edge.id) ? 'trace' : 'dim';
			const sourceLabel = snapshot.nodes.find(node => node.id === edge.source)?.label ?? edge.source;
			return { id: edge.id, type: 'graph', source: edge.source, target: edge.target, sourceHandle, targetHandle, selectable: true, deletable: false, focusable: true,
				ariaLabel: categoryNames[edge.category] + ' from ' + (snapshot.nodes.find(node => node.id === edge.source)?.label ?? edge.source) + ' to ' + (snapshot.nodes.find(node => node.id === edge.target)?.label ?? edge.target),
				markerEnd: { type: 'arrowclosed' as never, width: 16, height: 16, color: 'var(--tg-edge-' + edge.category + ')' },
				data: { edge, route: presentation.route, state, animate: !reducedMotion && !!trace && (state === 'trace' || edge.id === selectedEdgeId), label: sourceLabel + ' → ' + [...new Set(edge.evidence.map(item => item.field))].join(', ') + ' · ' + categoryNames[edge.category] } };
		});
		for (const input of snapshot.inputs) {
			if (!inputLayout.positions[input.id]) { continue; }
			for (const consumerId of new Set(input.consumers.map(consumer => consumer.resourceId))) {
				if (!cardIds.has(consumerId)) { continue; }
				// Input lines appear only for the hovered or selected input/consumer, so they never clutter the graph.
				const related = input.id === hoverNode || consumerId === (hoverNode || selectedId);
				if (!related) { continue; }
				const fields = input.consumers.filter(consumer => consumer.resourceId === consumerId).map(consumer => consumer.field);
				graphEdges.push({ id: 'input:' + input.address + '->' + consumerId, type: 'graph', source: input.id, target: consumerId, sourceHandle: 'out', targetHandle: 'in', selectable: false, focusable: false, deletable: false, zIndex: -1,
					data: { input: true, route: presentation.route, state: 'trace', animate: false, label: input.address + ' → ' + fields.join(', ') } });
			}
		}
		if (presentation.layout === 'tree') {
			for (const node of snapshot.nodes) {
				const parent = [...node.scopePath].reverse().find(id => cardIds.has(id));
				if (parent && cardIds.has(node.id)) { graphEdges.push({ id: 'tree:' + parent + ':' + node.id, type: 'graph', source: parent, target: node.id, sourceHandle: 'out', targetHandle: 'in', selectable: false, focusable: false, deletable: false, zIndex: -1, data: { tree: true, route: presentation.route, state: trace && !(trace.upstream.has(node.id) || node.id === selectedId) ? 'dim' : 'normal', animate: false, label: 'Configured parent' } }); }
			}
		}
		return graphEdges;
	}, [inputLayout, visibleEdges, layout, snapshot, compact, expanded, selectedEdgeId, trace, presentation.route, presentation.layout, reducedMotion, selectedId, hoverNode, hoverEdge, selectedNode]);

	const bounds = useRef<HTMLDivElement>(null);
	const lastFit = useRef('');
	useEffect(() => {
		// Refit when the layout kind or the set of resources changes, not on every edit or pin.
		if (!flow) { return; }
		const key = presentation.layout + ':' + presentation.spacing + ':' + presentation.height + ':' + (presentation.focus ? presentation.focus.id + '/' + presentation.focus.depth : '') + ':' + snapshot.nodes.map(node => node.id).join(',');
		if (lastFit.current === key) { return; }
		const first = !lastFit.current; lastFit.current = key;
		const saved = first ? viewports?.current?.technical : undefined;
		requestAnimationFrame(() => { if (saved) { void flow.setViewport(saved); } else { void flow.fitView({ padding: fitPadding, maxZoom: 1, duration: first ? 0 : 280 }); } });
	}, [flow, presentation.layout, presentation.spacing, presentation.height, presentation.focus, snapshot.nodes, viewports]);

	function handleKeys(event: ReactKeyboardEvent) {
		const target = event.target as HTMLElement;
		if (target.matches('input, textarea, select')) { return; }
		if (event.key === 'Escape') { onSelect(''); setSelectedEdgeId(''); }
		if (event.key === 'Enter' && selectedId && !target.closest('button')) { onOpenDetails(selectedId); }
		if (event.key === 'F2' && selectedId) { (bounds.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"] .tg-card-actions button[title="Rename"]`) as HTMLButtonElement | null)?.click(); }
		// Graph keys never reach project shortcuts such as Delete, Ctrl+D or Ctrl+Z.
		if (['Delete', 'Backspace'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['z', 'y', 'd', 'v', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
	}

	const pinCount = Object.keys(presentation.pins).length;
	const categoriesShown = categoryOrder.filter(category => visibleEdges.some(edge => edge.category === category));
	return <main ref={bounds} tabIndex={0} className={'canvas technical-graph theme-' + theme + (compact ? ' is-compact-view' : '')} data-read-only="true" data-graph="technical" aria-label="Technical graph" onKeyDownCapture={handleKeys}>
		<ReactFlow<GraphFlowNode, GraphFlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
			onInit={instance => { setFlow(instance); onInit?.(instance); setZoom(instance.getZoom()); }}
			onNodesChange={onNodesChange}
			onNodeDragStop={(_, node) => { if (node.type === 'card') { onPresentation({ type: 'pin', id: node.id, position: node.position }); } }}
			onNodeClick={(_, node) => { if (node.type === 'card') { setSelectedEdgeId(''); onSelect(node.id); } }}
			onNodeDoubleClick={(_, node) => { if (node.type === 'card') { onOpenDetails(node.id); } }}
			onNodeMouseEnter={(_, node) => { if (node.type === 'card' || node.type === 'ghost') { setHoverNode(node.id); } }} onNodeMouseLeave={() => setHoverNode('')}
			onEdgeMouseEnter={(_, edge) => { if (!edge.id.startsWith('tree:')) { setHoverEdge(edge.id); } }} onEdgeMouseLeave={() => setHoverEdge('')}
			onEdgeClick={(_, edge) => { if (!edge.id.startsWith('tree:')) { setSelectedEdgeId(edge.id); } }}
			onPaneClick={() => { onSelect(''); setSelectedEdgeId(''); }}
			onMove={(_, viewport) => setZoom(current => Math.abs(current - viewport.zoom) > 0.02 ? viewport.zoom : current)}
			onMoveEnd={(_, viewport) => { if (viewports?.current) { viewports.current.technical = viewport; } }}
			nodesConnectable={false} edgesFocusable elementsSelectable deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
			minZoom={0.08} maxZoom={2.5} proOptions={{ hideAttribution: true }} onlyRenderVisibleElements={snapshot.nodes.length > 300}>
			<Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid-pattern)" bgColor="var(--canvas)" />
			{snapshot.nodes.length > 40 && <MiniMap pannable zoomable nodeColor={node => node.type === 'lane' ? 'transparent' : 'var(--tg-mini)'} />}
		</ReactFlow>
		<div className="tg-toolbar" role="toolbar" aria-label="Technical graph view options">
			<label className="tg-search"><Search size={13} /><input aria-label="Find resource" placeholder="Find resource, address or file" value={query} onChange={event => setQuery(event.target.value)}
				onKeyDown={event => { if (event.key === 'Enter') { const hit = snapshot.nodes.find(node => layout.positions[node.id] && matchesQuery(node, query)); if (hit) { onSelect(hit.id); void flow?.fitView({ nodes: [{ id: hit.id }], padding: 0.6, maxZoom: 1.1, duration: 260 }); } } if (event.key === 'Escape') { setQuery(''); } }} />
				{query && <button className="tg-icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={12} /></button>}</label>
			<div className="tg-segment" role="radiogroup" aria-label="Lens">
				{graphLenses.map(lens => <button key={lens.id} role="radio" aria-checked={presentation.lens === lens.id} title={lens.hint} onClick={() => onPresentation({ type: 'set', patch: { lens: lens.id } })}>{lens.label}</button>)}
			</div>
			<label>Overlay<select aria-label="Card overlay" value={presentation.overlay} onChange={event => onPresentation({ type: 'set', patch: { overlay: event.target.value as GraphPresentation['overlay'] } })}>
				<option value="none">None</option><option value="plan">Plan actions{plan ? '' : ' (no plan)'}</option><option value="order">Apply order</option><option value="impact">Dependents</option></select></label>
			<details className="tg-view-menu"><summary className="tg-text-button" aria-label="View options"><SlidersHorizontal size={13} />View</summary>
				<div className="tg-view-panel">
					<label>Layout<select aria-label="Graph layout" value={presentation.layout} onChange={event => onPresentation({ type: 'set', patch: { layout: event.target.value as GraphPresentation['layout'] } })}>
				<option value="layers">Layers</option><option value="scopes">Scopes</option><option value="tree">Ownership tree</option></select></label>
					<label>Routes<select aria-label="Route style" value={presentation.route} onChange={event => onPresentation({ type: 'set', patch: { route: event.target.value as RouteStyle } })}>
				<option value="curved">Curved</option><option value="orthogonal">Orthogonal</option><option value="straight">Straight</option></select></label>
					<label>Spacing<select aria-label="Graph spacing" value={String(presentation.spacing)} onChange={event => onPresentation({ type: 'set', patch: { spacing: event.target.value === 'auto' ? 'auto' : Number(event.target.value) } })}>
						<option value="auto">Auto (by line density)</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="200">200%</option></select></label>
					<label>Height<select aria-label="Graph height" value={String(presentation.height)} onChange={event => onPresentation({ type: 'set', patch: { height: Number(event.target.value) } })}>
						{[100, 125, 150, 200, 250, 300].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
					<label>Detail<select aria-label="Card detail" value={presentation.density} onChange={event => onPresentation({ type: 'set', patch: { density: event.target.value as GraphPresentation['density'] } })}>
				<option value="auto">Auto</option><option value="detailed">Detailed</option><option value="compact">Compact</option></select></label>
					<button className="tg-text-button" aria-pressed={presentation.showMembership} title="Show resource group membership as lines (otherwise shown on each card)" onClick={() => onPresentation({ type: 'set', patch: { showMembership: !presentation.showMembership } })}>Membership</button>
					<button className="tg-text-button" aria-pressed={presentation.showInputs} disabled={!snapshot.inputs.length} title={snapshot.inputs.length ? 'Show variables, locals and data sources as ghost cards above the graph' : 'No var., local. or data. references in this draft'} onClick={() => onPresentation({ type: 'set', patch: { showInputs: !presentation.showInputs } })}>Inputs{snapshot.inputs.length ? ' (' + snapshot.inputs.length + ')' : ''}</button>
				</div>
			</details>
			{presentation.focus && <button className="tg-text-button" aria-pressed="true" title="Show the whole graph again" onClick={() => onPresentation({ type: 'set', patch: { focus: undefined } })}><Crosshair size={13} />Focused: {snapshot.nodes.find(node => node.id === presentation.focus!.id)?.label ?? 'resource'}<X size={12} /></button>}
			{pinCount > 0 && <button className="tg-text-button" onClick={() => onPresentation({ type: 'clearPins' })} title="Return pinned cards to the automatic layout (graph only)"><RotateCcw size={13} />Reset {pinCount} pin{pinCount === 1 ? '' : 's'}</button>}
		</div>
		<div className="tg-legend" aria-label="Relationship legend">
			{categoriesShown.map(category => <span key={category} className={'tg-legend-item tg-cat-' + category}><i />{categoryNames[category]}</span>)}
			<span className="tg-legend-note"><Pin size={11} />Drag to pin · graph only</span>
		</div>
		<div className="tg-zoom" role="group" aria-label="Zoom">
			<button aria-label="Zoom out" onClick={() => void flow?.zoomOut({ duration: 160 })}><Minus size={14} /></button>
			<span>{Math.round(zoom * 100)}%</span>
			<button aria-label="Zoom in" onClick={() => void flow?.zoomIn({ duration: 160 })}><Plus size={14} /></button>
			<button aria-label="Fit graph" title="Fit graph" onClick={() => void flow?.fitView({ padding: fitPadding, maxZoom: 1, duration: 240 })}><Scan size={14} /></button>
		</div>
		{(selectedEdge || selectedNode) && <WhyPanel snapshot={snapshot} edge={selectedEdge} node={selectedEdge ? undefined : selectedNode} trace={trace} overlay={selectedNode ? overlays.byNode[selectedNode.id] : undefined} wave={selectedNode ? waves[selectedNode.id] : undefined}
			focused={!!selectedNode && presentation.focus?.id === selectedNode.id} onFocus={id => onPresentation({ type: 'set', patch: { focus: presentation.focus?.id === id ? undefined : { id, depth: 2 } } })}
			onOpenSource={selectedNode && hasSource[selectedNode.id] ? onOpenSource : undefined} onEdit={onOpenDetails} onSelect={id => { setSelectedEdgeId(''); onSelect(id); }} onClose={() => { setSelectedEdgeId(''); onSelect(''); }} />}
		{presentation.overlay === 'plan' && <div className="tg-banner tg-banner-info" role="status">{!plan ? 'No plan yet. Run Plan from Issues to see create, update, replace and destroy actions.' : (plan.stale ? 'Plan is older than this draft; actions may have changed. ' : 'Latest plan. ') + (overlays.unmatchedPlan ? overlays.unmatchedPlan + ' planned change' + (overlays.unmatchedPlan === 1 ? '' : 's') + ' are in modules or resources not drawn here.' : '')}</div>}
		{snapshot.cycles.length > 0 && <div className="tg-banner" role="status"><AlertTriangle size={14} />{snapshot.cycles.length} configured reference cycle{snapshot.cycles.length === 1 ? '' : 's'} — Terraform cannot order {snapshot.cycles.map(cycle => cycle.length).reduce((a, b) => a + b, 0)} resources.</div>}
	</main>;
});

function WhyPanel({ snapshot, edge, node, trace, overlay, wave, focused, onFocus, onOpenSource, onEdit, onSelect, onClose }: { snapshot: TechnicalGraphSnapshot; edge?: GraphEdge; node?: GraphNode; trace?: ReturnType<typeof traceNode>; overlay?: NodeOverlay; wave?: number; focused: boolean; onFocus: (id: string) => void; onOpenSource?: (id: string) => void; onEdit: (id: string) => void; onSelect: (id: string) => void; onClose: () => void }) {
	const label = (id: string) => snapshot.nodes.find(item => item.id === id)?.label ?? id;
	if (edge) {
		return <aside className="tg-why" aria-label="Why this relationship exists">
			<header><span className={'tg-why-kind tg-cat-' + edge.category}>{categoryNames[edge.category]}</span><button className="tg-icon-button" aria-label="Close" onClick={onClose}>×</button></header>
			<p className="tg-why-path"><button onClick={() => onSelect(edge.source)}>{label(edge.source)}</button><span>→</span><button onClick={() => onSelect(edge.target)}>{label(edge.target)}</button></p>
			<p className="tg-why-facet">{edge.ordering ? 'Creates Terraform ordering: the prerequisite is created first.' : 'No ordering facet.'} {edge.confidence === 'configured' ? 'From configured fields in this draft.' : edge.confidence === 'source-graph' ? 'From the Terraform source graph.' : 'Edge kind not classified.'}</p>
			{edge.evidence.map(item => <div key={item.field + (item.expression ?? '')} className="tg-why-evidence"><code>{item.field}</code>{item.expression && <code className="tg-why-expr">{item.expression}</code>}<p>{item.meaning}</p><small>{item.origin === 'service' ? 'Source graph' : item.origin === 'inherited' ? 'Inherited from configured parent' : 'Explicit binding'}{item.sourceKey ? ' · ' + item.sourceKey : ''}</small></div>)}
		</aside>;
	}
	if (!node) { return null; }
	const profile = resourceIntelligence(node.type);
	const scope = node.scope ? label(node.scope) : undefined;
	return <aside className="tg-why" aria-label={'Relationships of ' + node.label}>
		<header><div><strong>{node.label}</strong><code>{node.address}</code></div><button className="tg-icon-button" aria-label="Close" onClick={onClose}>×</button></header>
		<dl>
			<dt>Role</dt><dd>{layerLabels[node.layer]}{scope ? ' · in ' + scope : ''}</dd>
			<dt>Uses</dt><dd>{trace?.upstream.size ?? 0} prerequisite{trace?.upstream.size === 1 ? '' : 's'}</dd>
			<dt>Used by</dt><dd>{trace?.downstream.size ?? 0} configured dependent{trace?.downstream.size === 1 ? '' : 's'}</dd>
			<dt>Apply wave</dt><dd>{wave === undefined ? 'cycle — cannot be ordered' : wave + 1}</dd>
			<dt>Shared category</dt><dd>{node.blastRadiusCategory}</dd>
			{!!overlay?.affectedBy?.length && <><dt>Affected by</dt><dd>{overlay.affectedBy.map(id => <button key={id} className="tg-link" onClick={() => onSelect(id)}>{snapshot.nodes.find(item => item.id === id)?.label ?? id}</button>)} <span className="tg-muted">(planned replace or destroy upstream)</span></dd></>}
			{overlay?.plan && <><dt>Planned</dt><dd>{overlay.plan.action}{overlay.plan.instances > 1 ? ' ×' + overlay.plan.instances : ''}{overlay.plan.changed.length ? ' · ' + overlay.plan.changed.slice(0, 6).join(', ') : ''}{overlay.plan.sensitive ? ' · sensitive values' : ''}</dd></>}
			{node.sourceFile && <><dt>Source</dt><dd>{node.sourceFile}{node.sourceLine ? ':' + node.sourceLine : ''}</dd></>}
		</dl>
		<div className="tg-why-actions">
			<button onClick={() => onFocus(node.id)} aria-pressed={focused}><Crosshair size={13} />{focused ? 'Show all' : 'Focus 2 hops'}</button>
			<button onClick={() => onEdit(node.id)}><Pencil size={13} />Edit</button>
			{onOpenSource && <button onClick={() => onOpenSource(node.id)}><FileCode2 size={13} />Source</button>}
		</div>
		{overlay?.messages.length ? <ul className="tg-why-issues">{overlay.messages.slice(0, 5).map((item, index) => <li key={index} className={'tg-issue-' + item.severity}>{item.severity === 'error' ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}<span>{item.message}</span></li>)}{overlay.messages.length > 5 && <li>{overlay.messages.length - 5} more in Issues</li>}</ul> : null}
		{node.inCycle && <p className="tg-why-warn"><AlertTriangle size={13} />Part of a reference cycle. Break one reference or move a rule into its own resource.</p>}
		{profile.troubleshooting.slice(0, 2).map(hint => <p key={hint} className="tg-why-hint">{hint}</p>)}
		<p className="tg-why-boundary">Configured relationships only. Not an outage, replacement or reachability prediction; run a plan for action impact.</p>
	</aside>;
}
