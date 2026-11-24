/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { shapeDefinitions, type ShapeId } from './shapes.ts';
import { DesignEdge, type DesignEdgeType } from './DesignEdge.tsx';
import { ConnectionTools } from './ConnectionTools.tsx';
import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject } from 'react';
import {
	Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, SelectionMode,
	useNodesState, useViewport, type ReactFlowInstance, type Viewport
} from '@xyflow/react';
import { BoardNode, ResourceNode, type CanvasNode } from './ResourceNode.tsx';
import type { Action, Architecture, BoardItem, DesignMode, Provider, ResourceKind, Position } from './model.ts';
import { checkDraft } from './model.ts';
import { resourceDefinition, resourceTypes, providerNames } from './fixture.ts';
import { MousePointer2, Hand, Type, StickyNote, Shapes, Frame, Minus, Plus, Scan } from 'lucide-react';

const nodeTypes = { resource: ResourceNode, board: BoardNode };
const edgeTypes = { design: DesignEdge };
/** Isolate live zoom subscription from graph projections and parameter editors. */
function CanvasBackground({ grid }: { grid: 'dots' | 'lines' | 'none' }) {
 const { zoom } = useViewport();
 // Subdivide on world-aligned powers of two so the grid stays legible at every zoom.
 const gap = 80 / 2 ** Math.floor(Math.log2(Math.max(zoom, 0.001) * 1.4));
 if (grid === 'none') { return null; }
 return <Background variant={grid === 'dots' ? BackgroundVariant.Dots : BackgroundVariant.Lines}
  gap={gap} size={1 / zoom} lineWidth={0.7} color="var(--grid-pattern)" bgColor="var(--canvas)" />;
}

const zoomPresets = [0.1, 0.25, 0.5, 0.7, 1, 2, 4, 12, 20];

/** Keep pointer/viewport state here so dragging never rerenders the parameter editor. */
export const DesignCanvas = memo(function DesignCanvas({
	architecture, mode, theme, onThemeChange, selectedId, dispatch, onSelect, onOpen, onInit, viewports, onAddItem, onAddResource, onAddCatalogue, onOpenShapes
}: {
	architecture: Architecture;
	mode: DesignMode;
	theme: 'light' | 'dark';
	onThemeChange: (theme: 'light' | 'dark') => void;
	selectedId: string;
	dispatch: Dispatch<Action>;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
	onInit: (instance: ReactFlowInstance<CanvasNode, DesignEdgeType>) => void;
	viewports: RefObject<Partial<Record<DesignMode, Viewport>>>;
 onOpenShapes: () => void;
	onAddItem: (kind: BoardItem['kind'], position: { x: number; y: number }, caption?: string, shape?: ShapeId) => void;
	onAddResource: (kind: ResourceKind, provider: Provider, position?: Position) => void;
 onAddCatalogue: (type:string, provider:Provider, position:Position) => void;
}) {
	const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, DesignEdgeType>>();
	const [grid, setGrid] = useState<'dots' | 'lines' | 'none'>('lines');
	const [snap, setSnap] = useState(false);
	const [hand, setHand] = useState(false);
	const [minimap, setMinimap] = useState(false);
	const [zoom, setZoom] = useState(1);
	const [selectedConnectionId, setSelectedConnectionId] = useState('');
	const [showConnections, setShowConnections] = useState(true);
	const [showLabels, setShowLabels] = useState(false);
	const selectedConnection = architecture.connections.find(connection => connection.id === selectedConnectionId);
	const bounds = useRef<HTMLDivElement>(null);
	useEffect(() => { if (selectedId) { setSelectedConnectionId(''); } }, [selectedId]);

	const resourceNodes = useMemo<CanvasNode[]>(() => architecture.resources.map(resource => {
		const parent = architecture.items.find(item => item.kind === 'frame' && item.members.includes(resource.id));
		const parentPosition = parent?.positions[mode] ?? { x: 0, y: 0 };
		return {
			id: resource.id, type: 'resource', parentId: parent?.id,
			position: { x: resource.positions[mode].x - parentPosition.x, y: resource.positions[mode].y - parentPosition.y },
			data: { resource, mode, dispatch, dependencies: architecture.connections.filter(edge => edge.target === resource.id).map(edge => architecture.resources.find(candidate => candidate.id === edge.source)?.name ?? edge.source), findings: checkDraft(architecture).filter(finding => finding.resourceId === resource.id).map(finding => finding.message) }, ariaLabel: resource.name + ', ' + resourceDefinition(resource).label
		};
	}), [architecture, mode, dispatch]);

	const boardNodes = useMemo<CanvasNode[]>(() => architecture.items.map(item => ({
		id: item.id, type: 'board', position: item.positions[mode],
		data: { item, mode, dispatch },
		style: {
			width: item.width * (item.kind === 'frame' && mode === 'technical' ? 1.7 : 1),
			height: item.height * (item.kind === 'frame' && mode === 'technical' ? 1.3 : 1)
		},
		zIndex: item.kind === 'frame' ? -1 : 1,
		ariaLabel: item.kind + ', ' + item.text
	})), [architecture.items, mode, dispatch]);

	const displayNodes = useMemo(() => [...boardNodes, ...resourceNodes].map(node => ({
		...node, selected: node.id === selectedId,
	})), [boardNodes, resourceNodes, selectedId]);

	// Synchronise committed edits while React Flow owns transient drag positions.
	useEffect(() => { setNodes(displayNodes); }, [displayNodes, setNodes]);
	useEffect(() => {
		if (!flow) { return; }
		const frame = requestAnimationFrame(() => {
			const saved = viewports.current[mode];
			if (saved) { void flow.setViewport(saved); }
			else { void flow.setViewport({ x: 40, y: 50, zoom: 1 }); }
		});
		return () => cancelAnimationFrame(frame);
	}, [mode, flow, viewports]);

	const edges = useMemo<DesignEdgeType[]>(() => architecture.connections.map(connection => ({
		...connection, sourceHandle: 'output', targetHandle: 'input',
		type: 'design', selected: connection.id === selectedConnectionId, hidden: !showConnections,
		markerStart: connection.startArrow ? { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 } : undefined,
		markerEnd: connection.endArrow === false ? undefined : { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 },
		data: { connection, showLabel: showLabels }, ariaLabel: 'Design connection: ' + (connection.label || connection.source + ' to ' + connection.target)
	})), [architecture.connections, selectedConnectionId, showConnections, showLabels]);

	function createItem(kind: BoardItem['kind']) {
		const rectangle = bounds.current?.getBoundingClientRect();
		if (flow && rectangle) {
			onAddItem(kind, flow.screenToFlowPosition({ x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }));
		}
	}

	return (
		<main ref={bounds} tabIndex={-1} className="canvas" aria-label={mode === 'visual' ? 'Visual design canvas' : 'Technical design canvas'}
			onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
			onDrop={event => {
				event.preventDefault();
    const shape = shapeDefinitions.find(candidate => candidate.id === event.dataTransfer.getData('application/x-cloudforge-shape'));
    if (shape && flow) { onAddItem('shape', flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), shape.label, shape.id); return; }
				const catalogue = event.dataTransfer.getData('application/x-cloudforge-catalogue');
    if (catalogue && catalogue.length < 512 && flow) {
     try { const data=JSON.parse(catalogue); if(typeof data.type === 'string' && Object.hasOwn(providerNames,data.provider)) { onAddCatalogue(data.type,data.provider,flow.screenToFlowPosition({x:event.clientX,y:event.clientY})); } } catch { /* Foreign payload. */ }
     return;
    }
    const value = event.dataTransfer.getData('application/x-cloudforge-resource');
				if (!flow || !value || value.length > 256) { return; }
				try {
					const data = JSON.parse(value);
					if (Object.hasOwn(resourceTypes, data.kind) && Object.hasOwn(providerNames, data.provider)) {
						onAddResource(data.kind, data.provider, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
					}
				} catch { /* Ignore foreign drag payloads. */ }
			}}>
			<div className="canvas-tools" role="toolbar" aria-label="Canvas creation tools">
				<button aria-label="Select tool" title="Select tool" aria-pressed={!hand} onClick={() => setHand(false)}><MousePointer2 /></button>
				<button aria-label="Pan tool" title="Pan tool (hold Space)" aria-pressed={hand} onClick={() => setHand(true)}><Hand /></button>
				<span className="tool-divider" />
				<button aria-label="Add text" title="Add text" onClick={() => createItem('text')}><Type /></button>
				<button aria-label="Add sticky note" title="Add sticky note" onClick={() => createItem('note')}><StickyNote /></button>
				<button aria-label="Add shape" title="Add shape" onClick={onOpenShapes}><Shapes /></button>
				<button aria-label="Add frame" title="Add frame" onClick={() => createItem('frame')}><Frame /></button>
			</div>
			<ReactFlow<CanvasNode, DesignEdgeType>
				forceColorMode={theme}
				nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
				onInit={instance => { setFlow(instance); onInit(instance); }}
				onConnect={connection => dispatch({ type: 'connect', source: connection.source, target: connection.target })}
				minZoom={0.1} maxZoom={20}
				onNodeClick={(_, node) => { setSelectedConnectionId(''); onSelect(node.id); }}
				onPaneClick={() => { setSelectedConnectionId(''); onSelect(''); }}
				onEdgeClick={(_, edge) => { setSelectedConnectionId(edge.id); onSelect(''); }}
				onNodeDoubleClick={(_, node) => { if (node.type === 'resource') { onOpen(node.id); } }}
				onNodeDragStop={(_, node) => {
					if (node.type === 'board') {
						dispatch({ type: 'moveItem', id: node.id, mode, position: node.position });
					} else {
						const parent = architecture.items.find(item => item.id === node.parentId);
						const offset = parent?.positions[mode] ?? { x: 0, y: 0 };
						dispatch({ type: 'move', id: node.id, mode, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } });
					}
				}}
				onMoveEnd={(_, next) => { viewports.current[mode] = next; setZoom(next.zoom); }}
				onViewportChange={next => { viewports.current[mode] = next; setZoom(next.zoom); }}
				panOnDrag={hand ? true : [1, 2]} panActivationKeyCode="Space"
				nodesDraggable={!hand} selectionOnDrag={!hand} selectionMode={SelectionMode.Partial}
				deleteKeyCode={null} snapToGrid={snap} snapGrid={[20, 20]} onlyRenderVisibleElements
			>
				<CanvasBackground grid={grid} />
				{minimap && <MiniMap<CanvasNode> pannable zoomable nodeColor={node => node.type === 'board' && node.data.item.kind === 'frame' ? 'transparent' : '#8e79d9'} />}
			</ReactFlow>
			{selectedConnection && showConnections && <ConnectionTools connection={selectedConnection} dispatch={dispatch} onClose={() => { setSelectedConnectionId(''); bounds.current?.focus(); }}/>}
			<details className="canvas-options"><summary>View</summary><div className="view-options-content">
				<label>Theme<select aria-label="Canvas theme" value={theme} onChange={event => onThemeChange(event.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
				<label>Grid<select aria-label="Canvas grid" value={grid} onChange={event => setGrid(event.target.value as typeof grid)}><option value="dots">Dots</option><option value="lines">Lines</option><option value="none">None</option></select></label>
				<label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap</label>
				<label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} />Show connections</label>
				<label><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} />Always show connection labels</label>
				<button aria-pressed={minimap} onClick={() => setMinimap(value => !value)}>Minimap</button>
			</div></details>
			<div className="canvas-navigation" role="group" aria-label="Zoom and navigation">
				<button aria-label="Zoom out" title="Zoom out" onClick={() => { void flow?.zoomOut(); }}><Minus /></button>
				<select aria-label="Canvas zoom" value={zoom.toFixed(3)} onChange={event => { void flow?.zoomTo(Number(event.target.value)); }}>
					{!zoomPresets.some(value => value.toFixed(3) === zoom.toFixed(3)) && <option value={zoom.toFixed(3)}>{Math.round(zoom * 100)}%</option>}
					{zoomPresets.map(value => <option key={value} value={value.toFixed(3)}>{Math.round(value * 100)}%</option>)}
				</select>
				<button aria-label="Zoom in" title="Zoom in" onClick={() => { void flow?.zoomIn(); }}><Plus /></button>
				<button aria-label="Fit architecture to view" title="Fit architecture to view" onClick={() => { void flow?.fitView({ padding: 0.12 }); }}><Scan /></button>
			</div>
		</main>
	);
});
