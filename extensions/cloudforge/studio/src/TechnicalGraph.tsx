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
import { AlertTriangle, ChevronDown, ChevronUp, Maximize2, Minus, Pencil, Pin, PinOff, Plus, RotateCcw, Scan } from 'lucide-react';
import type { Action, Architecture, DesignMode } from './model.ts';
import { graphLenses, layerLabels, lensEdges, projectTechnicalGraph, traceNode, type GraphCategory, type GraphEdge, type GraphNode, type GraphPort, type TechnicalGraphSnapshot } from './technicalGraph.ts';
import { layoutTechnicalGraph, visiblePortCount, type GraphLane } from './technicalGraphLayout.ts';
import { graphEditAllowed, type GraphPresentation, type GraphPresentationAction, type RouteStyle } from './graphPresentation.ts';
import { relationshipNames } from './infrastructureRelationships.ts';
import { resourceIntelligence } from './providerKnowledge.ts';

type CardData = { node: GraphNode; compact: boolean; expanded: boolean; state: 'normal' | 'focus' | 'trace' | 'dim'; pinned: boolean; tracedPorts: ReadonlySet<string>; onRename: (id: string, label: string) => void; onEdit: (id: string) => void; onToggleRows: (id: string) => void; onUnpin: (id: string) => void };
type LaneData = { lane: GraphLane };
type CardNode = Node<CardData, 'card'>;
type LaneNode = Node<LaneData, 'lane'>;
type GraphFlowNode = CardNode | LaneNode;
type EdgeData = { edge?: GraphEdge; tree?: boolean; route: RouteStyle; state: 'normal' | 'trace' | 'dim' | 'selected'; animate: boolean; label: string };
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
	return <div className={'tg-card tg-layer-' + node.layer + ' tg-state-' + state + (selected ? ' is-selected' : '') + (compact ? ' is-compact' : '')} data-review={node.reviewStatus}>
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
				{pinned && <button className="tg-icon-button" aria-label={'Unpin ' + node.label} title="Unpin (graph only)" onClick={event => { event.stopPropagation(); data.onUnpin(node.id); }}><PinOff size={12} /></button>}
				<button className="tg-icon-button" aria-label={'Rename ' + node.label} title="Rename" onClick={event => { event.stopPropagation(); setEditing(true); }}><Pencil size={12} /></button>
				<button className="tg-icon-button" aria-label={'Edit configuration of ' + node.label} title="Edit configuration" onClick={event => { event.stopPropagation(); data.onEdit(node.id); }}><Maximize2 size={12} /></button>
			</div>
		</div>
		<div className="tg-chips">
			<span className="tg-chip tg-chip-layer">{layerLabels[node.layer]}</span>
			{node.region.known ? <span className="tg-chip">{node.region.value}</span> : <span className="tg-chip tg-chip-unknown" title="No region value in this draft">region unknown</span>}
			{compact && node.ports.length > 0 && <span className="tg-chip">{node.ports.length} input{node.ports.length === 1 ? '' : 's'}</span>}
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

const LaneBand = memo(function LaneBand({ data }: NodeProps<LaneNode>) {
	return <div className={'tg-lane tg-lane-' + data.lane.kind} style={{ width: data.lane.width, height: data.lane.height }}><span>{data.lane.label}</span></div>;
});

function GraphRoute(props: EdgeProps<GraphFlowEdge>) {
	const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, id } = props;
	const route = data?.route ?? 'curved';
	const [path, labelX, labelY] = route === 'straight' ? getStraightPath({ sourceX, sourceY, targetX, targetY })
		: route === 'orthogonal' ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 18 })
			: getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });
	const category = data?.tree ? 'tree' : data?.edge?.category ?? 'unclassified';
	const state = data?.state ?? 'normal';
	return <>
		<BaseEdge id={id} path={path} markerEnd={markerEnd} className={'tg-edge tg-cat-' + category + ' tg-edge-' + state} interactionWidth={14} />
		{data?.animate && state !== 'dim' && <circle r={3.2} className={'tg-pulse tg-cat-' + category}><animateMotion dur="2.4s" repeatCount="indefinite" path={path} /></circle>}
		{(state === 'selected' || state === 'trace') && data?.label && <EdgeLabelRenderer>
			<div className={'tg-edge-label tg-cat-' + category} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data.label}</div>
		</EdgeLabelRenderer>}
	</>;
}

const nodeTypes = { card: GraphCard, lane: LaneBand };
const edgeTypes = { graph: GraphRoute };
const fitPadding = { top: '76px', right: '32px', bottom: '96px', left: '32px' } as const;

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
	viewports?: RefObject<Partial<Record<DesignMode, Viewport>>>;
}

/** Refuse any action that could move or restructure the project. */
export function dispatchGraphEdit(onEdit: (action: Action) => void, action: Action): boolean {
	if (!graphEditAllowed(action)) { return false; }
	onEdit(action); return true;
}

export const TechnicalGraph = memo(function TechnicalGraph({ architecture, theme, presentation, onPresentation, selectedId, onSelect, onOpenDetails, onEdit, onInit, viewports }: TechnicalGraphProps) {
	const snapshot: TechnicalGraphSnapshot = useMemo(() => projectTechnicalGraph(architecture), [architecture]);
	const [zoom, setZoom] = useState(1);
	const [selectedEdgeId, setSelectedEdgeId] = useState('');
	const [flow, setFlow] = useState<ReactFlowInstance<GraphFlowNode, GraphFlowEdge>>();
	const reducedMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
	const compact = presentation.density === 'compact' || presentation.density === 'auto' && zoom < 0.42;
	const visibleEdges = useMemo(() => lensEdges(snapshot, presentation.lens, presentation.showMembership), [snapshot, presentation.lens, presentation.showMembership]);
	const expanded = useMemo(() => new Set(presentation.expanded), [presentation.expanded]);
	const layout = useMemo(() => layoutTechnicalGraph(snapshot, { layout: presentation.layout, expanded, compact: false, pins: presentation.pins, edges: visibleEdges }), [snapshot, presentation.layout, expanded, presentation.pins, visibleEdges]);
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
		const cards: CardNode[] = snapshot.nodes.filter(node => layout.positions[node.id]).map(node => {
			const state: CardData['state'] = !selectedNode ? 'normal' : node.id === selectedNode.id ? 'focus' : trace?.upstream.has(node.id) || trace?.downstream.has(node.id) ? 'trace' : 'dim';
			return { id: node.id, type: 'card', position: layout.positions[node.id], selected: node.id === selectedId, draggable: true, connectable: false, deletable: false,
				ariaLabel: node.label + ', ' + node.typeLabel + ', ' + layerLabels[node.layer],
				data: { node, compact, expanded: expanded.has(node.id), state, pinned: !!presentation.pins[node.id], tracedPorts, onRename: rename, onEdit: onOpenDetails, onToggleRows: toggleRows, onUnpin: unpin } };
		});
		return [...lanes, ...cards];
	}, [layout, snapshot, selectedNode, selectedId, trace, compact, expanded, presentation.pins, tracedPorts, rename, onOpenDetails, toggleRows, unpin]);
	// Local copy only so React Flow can show a drag in progress. It is rebuilt from layout + pins.
	const [nodes, setNodes] = useState<GraphFlowNode[]>(computedNodes);
	useEffect(() => setNodes(computedNodes), [computedNodes]);
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
			return t.x >= s.x ? ['out-right', row === 'in' ? 'in-left' : row] : ['out-left', 'in-right'];
		};
		// The ownership tree shows parent links; evidence lines appear only for the selected trace or relationship.
		const treeMode = presentation.layout === 'tree';
		const graphEdges: GraphFlowEdge[] = visibleEdges.filter(edge => cardIds.has(edge.source) && cardIds.has(edge.target) && (!treeMode || trace?.edges.has(edge.id) || edge.id === selectedEdgeId)).map(edge => {
			const [sourceHandle, targetHandle] = handles(edge);
			const state: EdgeData['state'] = edge.id === selectedEdgeId ? 'selected' : !trace ? 'normal' : trace.edges.has(edge.id) ? 'trace' : 'dim';
			return { id: edge.id, type: 'graph', source: edge.source, target: edge.target, sourceHandle, targetHandle, selectable: true, deletable: false, focusable: true,
				ariaLabel: categoryNames[edge.category] + ' from ' + (snapshot.nodes.find(node => node.id === edge.source)?.label ?? edge.source) + ' to ' + (snapshot.nodes.find(node => node.id === edge.target)?.label ?? edge.target),
				zIndex: state === 'trace' || state === 'selected' ? 2 : 0,
				markerEnd: { type: 'arrowclosed' as never, width: 14, height: 14, color: 'var(--tg-edge-' + edge.category + ')' },
				data: { edge, route: presentation.route, state, animate: !reducedMotion && (state === 'trace' || state === 'selected'), label: categoryNames[edge.category] + ' · ' + [...new Set(edge.evidence.map(item => item.field))].join(', ') } };
		});
		if (presentation.layout === 'tree') {
			for (const node of snapshot.nodes) {
				const parent = [...node.scopePath].reverse().find(id => cardIds.has(id));
				if (parent && cardIds.has(node.id)) { graphEdges.push({ id: 'tree:' + parent + ':' + node.id, type: 'graph', source: parent, target: node.id, sourceHandle: 'out', targetHandle: 'in', selectable: false, focusable: false, deletable: false, zIndex: -1, data: { tree: true, route: presentation.route, state: trace && !(trace.upstream.has(node.id) || node.id === selectedId) ? 'dim' : 'normal', animate: false, label: 'Configured parent' } }); }
			}
		}
		return graphEdges;
	}, [visibleEdges, layout, snapshot, compact, expanded, selectedEdgeId, trace, presentation.route, presentation.layout, reducedMotion, selectedId]);

	const bounds = useRef<HTMLDivElement>(null);
	const lastFit = useRef('');
	useEffect(() => {
		// Refit when the layout kind or the set of resources changes, not on every edit or pin.
		if (!flow) { return; }
		const key = presentation.layout + ':' + snapshot.nodes.map(node => node.id).join(',');
		if (lastFit.current === key) { return; }
		const first = !lastFit.current; lastFit.current = key;
		const saved = first ? viewports?.current?.technical : undefined;
		requestAnimationFrame(() => { if (saved) { void flow.setViewport(saved); } else { void flow.fitView({ padding: fitPadding, maxZoom: 1, duration: first ? 0 : 280 }); } });
	}, [flow, presentation.layout, snapshot.nodes, viewports]);

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
	return <main ref={bounds} tabIndex={0} className={'canvas technical-graph theme-' + theme} data-read-only="true" data-graph="technical" aria-label="Technical graph" onKeyDownCapture={handleKeys}>
		<ReactFlow<GraphFlowNode, GraphFlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
			onInit={instance => { setFlow(instance); onInit?.(instance); setZoom(instance.getZoom()); }}
			onNodesChange={onNodesChange}
			onNodeDragStop={(_, node) => { if (node.type === 'card') { onPresentation({ type: 'pin', id: node.id, position: node.position }); } }}
			onNodeClick={(_, node) => { if (node.type === 'card') { setSelectedEdgeId(''); onSelect(node.id); } }}
			onNodeDoubleClick={(_, node) => { if (node.type === 'card') { onOpenDetails(node.id); } }}
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
			<div className="tg-segment" role="radiogroup" aria-label="Lens">
				{graphLenses.map(lens => <button key={lens.id} role="radio" aria-checked={presentation.lens === lens.id} title={lens.hint} onClick={() => onPresentation({ type: 'set', patch: { lens: lens.id } })}>{lens.label}</button>)}
			</div>
			<label>Layout<select aria-label="Graph layout" value={presentation.layout} onChange={event => onPresentation({ type: 'set', patch: { layout: event.target.value as GraphPresentation['layout'] } })}>
				<option value="layers">Layers</option><option value="scopes">Scopes</option><option value="tree">Ownership tree</option></select></label>
			<label>Routes<select aria-label="Route style" value={presentation.route} onChange={event => onPresentation({ type: 'set', patch: { route: event.target.value as RouteStyle } })}>
				<option value="curved">Curved</option><option value="orthogonal">Orthogonal</option><option value="straight">Straight</option></select></label>
			<label>Detail<select aria-label="Card detail" value={presentation.density} onChange={event => onPresentation({ type: 'set', patch: { density: event.target.value as GraphPresentation['density'] } })}>
				<option value="auto">Auto</option><option value="detailed">Detailed</option><option value="compact">Compact</option></select></label>
			<label className="tg-check"><input type="checkbox" checked={presentation.showMembership} onChange={event => onPresentation({ type: 'set', patch: { showMembership: event.target.checked } })} />Group membership lines</label>
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
		{(selectedEdge || selectedNode) && <WhyPanel snapshot={snapshot} edge={selectedEdge} node={selectedEdge ? undefined : selectedNode} trace={trace} onSelect={id => { setSelectedEdgeId(''); onSelect(id); }} onClose={() => { setSelectedEdgeId(''); onSelect(''); }} />}
		{snapshot.cycles.length > 0 && <div className="tg-banner" role="status"><AlertTriangle size={14} />{snapshot.cycles.length} configured reference cycle{snapshot.cycles.length === 1 ? '' : 's'} — Terraform cannot order {snapshot.cycles.map(cycle => cycle.length).reduce((a, b) => a + b, 0)} resources.</div>}
	</main>;
});

function WhyPanel({ snapshot, edge, node, trace, onSelect, onClose }: { snapshot: TechnicalGraphSnapshot; edge?: GraphEdge; node?: GraphNode; trace?: ReturnType<typeof traceNode>; onSelect: (id: string) => void; onClose: () => void }) {
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
			<dt>Shared category</dt><dd>{node.blastRadiusCategory}</dd>
		</dl>
		{node.inCycle && <p className="tg-why-warn"><AlertTriangle size={13} />Part of a reference cycle. Break one reference or move a rule into its own resource.</p>}
		{profile.troubleshooting.slice(0, 2).map(hint => <p key={hint} className="tg-why-hint">{hint}</p>)}
		<p className="tg-why-boundary">Configured relationships only. Not an outage, replacement or reachability prediction; run a plan for action impact.</p>
	</aside>;
}
