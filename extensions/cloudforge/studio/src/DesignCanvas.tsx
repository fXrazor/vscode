/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { shapeDefinitions, type ShapeId } from './shapes.ts';
import { DesignEdge, type DesignEdgeType } from './DesignEdge.tsx';
import { ConnectionTools } from './ConnectionTools.tsx';
import { ConnectionCreate } from './ConnectionCreate.tsx';
import { canConnect } from './designConnections.ts';
import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { canvasElements, expandGroups, sceneOrder, selectionFragment } from './canvasOperations.ts';
import { layoutSelection, type Alignment } from './selectionGeometry.ts';
import { CanvasActionMenu, SelectionControls, type SelectionAction } from './SelectionControls.tsx';
import { resourceIconSize } from './resourceGeometry.ts';
import { inheritedDependencies, isResourceContainer, resourceAncestors, resourceDescendants, resourceDimensions, resourcePlacement } from './resourceHierarchy.ts';
import { architectureDiagnostics } from './diagnostics.ts';
import { SelectionAnchor } from './SelectionAnchor.tsx';
import { alignmentGuides, type GuideLine } from './alignmentGuides.ts';
import { AlignmentGuides } from './AlignmentGuides.tsx';
import {
	Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, SelectionMode,
	useNodesState, useViewport, type OnNodesChange, type ReactFlowInstance, type Viewport
} from '@xyflow/react';
import { BoardNode, ResourceNode, type CanvasNode } from './ResourceNode.tsx';
import type { Action, Architecture, BoardItem, DesignMode, Provider, ResourceKind, Position } from './model.ts';
import { resourceDefinition, resourceTypes, providerNames } from './fixture.ts';
import { MousePointer2, SquareDashedMousePointer, Hand, Type, StickyNote, Shapes, Frame, Minus, Plus, Scan, Cable } from 'lucide-react';

const nodeTypes = { resource: ResourceNode, board: BoardNode };
const edgeTypes = { design: DesignEdge };
const multiSelectKeys = ['Control', 'Meta'];
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

/** Fit inside the floating chrome: tool rail (left), View options (top) and zoom controls (bottom). */
const canvasFitPadding = { top: '64px', right: '28px', bottom: '84px', left: '84px' } as const;
export const DesignCanvas = memo(function DesignCanvas({
	architecture, mode, theme, onThemeChange, selectedId, selectedIds, onSelectionChange, dispatch, onSelect, onOpen, onOpenDetails, onInit, viewports, onAddItem, onAddResource, onAddCatalogue, onOpenShapes
}: {
	architecture: Architecture;
	mode: DesignMode;
	theme: 'light' | 'dark';
	onThemeChange: (theme: 'light' | 'dark') => void;
	selectedId: string;
	selectedIds: string[];
	onSelectionChange: (ids: string[]) => void;
	dispatch: Dispatch<Action>;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
	onOpenDetails: (id: string) => void;
	onInit: (instance: ReactFlowInstance<CanvasNode, DesignEdgeType>) => void;
	viewports: RefObject<Partial<Record<DesignMode, Viewport>>>;
 onOpenShapes: () => void;
	onAddItem: (kind: BoardItem['kind'], position: { x: number; y: number }, caption?: string, shape?: ShapeId) => void;
	onAddResource: (kind: ResourceKind, provider: Provider, position?: Position, parentId?: string) => void;
 onAddCatalogue: (type:string, provider:Provider, position:Position, parentId?: string) => void;
}) {
	const [nodes, setNodes] = useNodesState<CanvasNode>([]);
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, DesignEdgeType>>();
	const [grid, setGrid] = useState<'dots' | 'lines' | 'none'>('lines');
	const [snap, setSnap] = useState(false);
	const [guides, setGuides] = useState(true);
	const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
	const [hand, setHand] = useState(false);
	const [additiveSelection, setAdditiveSelection] = useState(false);
	const [minimap, setMinimap] = useState(false);
	const [zoom, setZoom] = useState(1);
	const [selectedConnectionId, setSelectedConnectionId] = useState('');
	const [showConnections, setShowConnections] = useState(true);
	const [technicalDesignLinks, setTechnicalDesignLinks] = useState(false);
	const [allDependencies, setAllDependencies] = useState(false);
	const [dropFeedback, setDropFeedback] = useState<{target?:string;ok:boolean;reason:string}>();
	const [showLabels, setShowLabels] = useState(false);
	const [creatingConnection, setCreatingConnection] = useState(false);
	const [connectionSourceId, setConnectionSourceId] = useState('');
	const clipboard = useRef<Architecture | null>(null);
	const [hasClipboard, setHasClipboard] = useState(false);
	const [editRequest, setEditRequest] = useState({ id: '', token: 0 });
	const selectedConnection = architecture.connections.find(connection => connection.id === selectedConnectionId);
	const bounds = useRef<HTMLDivElement>(null);
	// An automatic first fit is redone when panels settle (e.g. the inspector opens on load), until the user moves the view.
	const autoFit = useRef<{ mode?: DesignMode; at: number }>({ at: 0 });
	useEffect(() => {
		const element = bounds.current; if (!element || !flow) { return; }
		let frame = 0;
		const observer = new ResizeObserver(() => {
			if (autoFit.current.mode !== mode || performance.now() - autoFit.current.at > 2500) { return; }
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => { void flow.fitView({ padding: canvasFitPadding, maxZoom: 1 }).then(() => { viewports.current[mode] = flow.getViewport(); setZoom(flow.getZoom()); }); });
		});
		observer.observe(element);
		return () => { cancelAnimationFrame(frame); observer.disconnect(); };
	}, [flow, mode, viewports]);
	useEffect(() => { if (selectedIds.length) { setSelectedConnectionId(''); } }, [selectedIds]);
	const order = useMemo(() => sceneOrder(architecture), [architecture]);
	const diagnostics = useMemo(() => architectureDiagnostics(architecture), [architecture]);
	const dependencies = useMemo(() => inheritedDependencies(architecture), [architecture]);

	const resourceNodes = useMemo<CanvasNode[]>(() => architecture.resources.map(resource => {
		const parent = architecture.resources.find(item=>item.id===resource.parentId) ?? architecture.items.find(item => item.kind === 'frame' && item.members.includes(resource.id));
		const parentPosition = parent?.positions[mode] ?? { x: 0, y: 0 };
		const container = isResourceContainer(resource);
		return {
			id: resource.id, type: 'resource', parentId: parent?.id,
			style: container ? resourceDimensions(architecture,resource,mode) : mode === 'visual' ? {width:resourceIconSize(resource),height:resourceIconSize(resource)} : undefined,
			position: { x: resource.positions[mode].x - parentPosition.x, y: resource.positions[mode].y - parentPosition.y },
			data: { resource, mode, dispatch, architecture, onReview:onOpen, origin: parentPosition, variables: architecture.variables, childCount:architecture.resources.filter(item=>item.parentId===resource.id).length, dependencies: dependencies.filter(edge => edge.target === resource.id).map(edge => architecture.resources.find(candidate => candidate.id === edge.source)?.name ?? edge.source), findings: diagnostics.filter(finding => finding.resourceId === resource.id) }, ariaLabel: resource.name + ', ' + resourceDefinition(resource).label
		};
	}), [architecture, mode, dispatch, dependencies, diagnostics, onOpen]);

	const boardNodes = useMemo<CanvasNode[]>(() => architecture.items.map(item => ({
		id: item.id, type: 'board', position: item.positions[mode],
		data: { item, mode, dispatch, editToken: editRequest.id === item.id ? editRequest.token : 0 },
		style: {
			width: item.width,
			height: item.height
		},
		zIndex: item.kind === 'frame' ? -1 : 1,
		ariaLabel: item.kind + ', ' + item.text
	})), [architecture.items, mode, dispatch, editRequest]);

	const displayNodes = useMemo(() => [...boardNodes, ...resourceNodes].map(node => ({
		...node, selected: selectedIds.includes(node.id), draggable: !(node.type === 'board' ? node.data.item.canvasLocked : node.data.resource.canvasLocked||isResourceContainer(node.data.resource)&&resourceDescendants(architecture,node.id).some(child=>child.canvasLocked)),
		zIndex: node.type === 'board' && node.data.item.kind === 'frame' ? -100 : node.type==='resource' && isResourceContainer(node.data.resource) ? -80+resourceAncestors(architecture,node.data.resource).length : order.indexOf(node.id) + 1
	})), [boardNodes, resourceNodes, selectedIds, order, architecture]);

	// Synchronise committed edits while React Flow owns transient drag positions.
	useEffect(() => { setNodes(displayNodes); }, [displayNodes, setNodes]);
	function guidedNodes(next: CanvasNode[], movingIds: string[]) {
		const current = new Map(next.map(node => [node.id, node]));
		const boxes = next.map(node => {
			let x = node.position.x; let y = node.position.y; let parent = node.parentId; const seen = new Set<string>();
			while (parent && !seen.has(parent)) { seen.add(parent); const ancestor = current.get(parent); if (!ancestor) { break; } x += ancestor.position.x; y += ancestor.position.y; parent = ancestor.parentId; }
			return { id: node.id, parentId: node.parentId, x, y, width: node.measured?.width ?? (Number(node.style?.width) || 48), height: node.measured?.height ?? (Number(node.style?.height) || 48) };
		});
		const result = alignmentGuides(boxes, movingIds, flow?.getZoom() ?? 1);
		return { nodes: next.map(node => result.roots.has(node.id) ? { ...node, position: { x: node.position.x + result.dx, y: node.position.y + result.dy } } : node), lines: result.lines };
	}
	const onNodesChange: OnNodesChange<CanvasNode> = changes => {
		let next = changes.applyTo(nodes);
		const positions = [...changes].filter(change => change.type === 'position' && change.position && change.dragging !== undefined);
		if (positions.length && guides && !snap) {
			const result = guidedNodes(next, positions.map(change => change.id)); next = result.nodes;
			setGuideLines(positions.some(change => change.type === 'position' && change.dragging) ? result.lines : []);
		}
		setNodes(next);
	};

	const edges = useMemo<DesignEdgeType[]>(() => [...architecture.connections.map(connection => ({
		...connection, sourceHandle: 'output', targetHandle: 'input',
		type: 'design' as const, selected: connection.id === selectedConnectionId, hidden: !showConnections || mode==='technical'&&!technicalDesignLinks,
		markerStart: connection.startArrow ? { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 } : undefined,
		markerEnd: connection.endArrow === false ? undefined : { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 },
		data: { connection, showLabel: showLabels }, ariaLabel: 'Design connection: ' + (connection.label || connection.source + ' to ' + connection.target)
	})), ...dependencies.map(dependency=>{
		const active=selectedIds.includes(dependency.source)||selectedIds.includes(dependency.target);
			return {...dependency,sourceHandle:'output',targetHandle:'input',type:'design' as const,hidden:!showConnections||!active&&!allDependencies,animated:mode==='technical'&&active,className:'infrastructure-dependency',data:{connection:{...dependency,pattern:'dotted' as const,label:dependency.fields.join(', '),endArrow:false},showLabel:showLabels||active,dependency:true},ariaLabel:'Inherited dependency: '+dependency.fields.join(', ')};
	})], [architecture.connections, selectedConnectionId, showConnections, showLabels, dependencies, mode, technicalDesignLinks, allDependencies, selectedIds]);

	function createItem(kind: BoardItem['kind']) {
		const rectangle = bounds.current?.getBoundingClientRect();
		if (flow && rectangle) {
			onAddItem(kind, flow.screenToFlowPosition({ x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }));
		}
	}

	function copySelection() {
		if (!selectedIds.length) { return; }
		clipboard.current = selectionFragment(architecture, selectedIds); setHasClipboard(true);
	}
	function insertCopy(fragment: Architecture) {
		const idMap = Object.fromEntries([...canvasElements(fragment), ...(fragment.groups ?? [])].map(item => [item.id, crypto.randomUUID()]));
		dispatch({ type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: 30 } });
		onSelectionChange(canvasElements(fragment).map(item => idMap[item.id]));
	}
	function run(action: SelectionAction) {
		const ids = expandGroups(architecture, selectedIds);
		if (action === 'clear') { onSelectionChange([]); setSelectedConnectionId(''); setCreatingConnection(false); setAdditiveSelection(false); bounds.current?.focus(); }
		else if (action === 'selectAll') { onSelectionChange(canvasElements(architecture).map(item => item.id)); }
		else if (action === 'copy') { copySelection(); }
		else if (action === 'paste') { if (clipboard.current) { insertCopy(clipboard.current); } }
		else if (action === 'duplicate') { if (ids.length) { insertCopy(selectionFragment(architecture, ids)); } }
		else if (action === 'delete') { dispatch({ type: 'canvas', command: { kind: 'delete', ids } }); }
		else if (action === 'lock' || action === 'unlock') { dispatch({ type: 'canvas', command: { kind: 'lock', ids, locked: action === 'lock' } }); }
		else if (action === 'group') { dispatch({ type: 'canvas', command: { kind: 'group', ids, id: crypto.randomUUID() } }); }
		else if (action === 'ungroup') { dispatch({ type: 'canvas', command: { kind: 'ungroup', ids } }); }
		else if (action === 'front' || action === 'forward' || action === 'backward' || action === 'back') { dispatch({ type: 'canvas', command: { kind: 'arrange', ids, direction: action } }); }
		else if (action === 'fit') { if (ids.length) { void flow?.fitView({ nodes: ids.map(id => ({ id })), padding: 0.25, maxZoom: 2 }); } }
		else if (action === 'edit') {
			if (ids.length !== 1 || canvasElements(architecture).find(item => item.id === ids[0])?.canvasLocked) { return; }
			if (architecture.resources.some(item => item.id === ids[0])) { onOpenDetails(ids[0]); }
			else { setEditRequest(request => ({ id: ids[0], token: request.token + 1 })); }
		} else if (action.startsWith('align-')) {
			const sizes = Object.fromEntries((flow?.getNodes() ?? []).map(node => [node.id, { width: node.measured?.width ?? 112, height: node.measured?.height ?? 92 }]));
			dispatch({ type: 'canvas', command: { kind: 'move', mode, positions: layoutSelection(architecture, ids, mode, action.slice(6) as Alignment, sizes) } });
		} else if (action.startsWith('size-')) {
			const value = action.slice(5);
			dispatch({ type: 'canvas', command: value === 'width' || value === 'height' || value === 'size' ? { kind: 'resize', ids, mode, match: value } : { kind: 'resize', ids, mode, scale: Number(value) } });
		}
	}

	function absolutePosition(node:CanvasNode,current:Map<string,CanvasNode>):Position {
		let {x,y}=node.position; let parent=node.parentId; const seen=new Set([node.id]);
		while(parent&&!seen.has(parent)){seen.add(parent);const ancestor=current.get(parent);if(!ancestor){break;}x+=ancestor.position.x;y+=ancestor.position.y;parent=ancestor.parentId;}
		return {x,y};
	}
	function containerAt(point:Position, movingId?:string) {
		const excluded=new Set(movingId?[movingId,...resourceDescendants(architecture,movingId).map(item=>item.id)]:[]);
		return architecture.resources.filter(item=>isResourceContainer(item)&&!excluded.has(item.id)).filter(item=>{const pos=item.positions[mode];const size=resourceDimensions(architecture,item,mode);return point.x>=pos.x&&point.y>=pos.y&&point.x<=pos.x+size.width&&point.y<=pos.y+size.height;}).sort((a,b)=>resourceAncestors(architecture,b).length-resourceAncestors(architecture,a).length||resourceDimensions(architecture,a,mode).width*resourceDimensions(architecture,a,mode).height-resourceDimensions(architecture,b,mode).width*resourceDimensions(architecture,b,mode).height)[0];
	}
	function placementAt(node:CanvasNode,client:{clientX:number;clientY:number}) {
		if(node.type!=='resource'||!flow){return undefined;}
		const excluded=new Set([node.id,...resourceDescendants(architecture,node.id).map(item=>item.id)]);
		// Hit-test current rendered bounds: opening a panel or a viewport move can change
		// screen geometry during a drag. The domain model still validates the candidate.
		const target=architecture.resources.filter(item=>isResourceContainer(item)&&!excluded.has(item.id)).filter(item=>{
			const element=bounds.current?.querySelector<HTMLElement>('.react-flow__node[data-id="'+CSS.escape(item.id)+'"]');const rectangle=element?.getBoundingClientRect();
			return rectangle&&client.clientX>=rectangle.left&&client.clientX<=rectangle.right&&client.clientY>=rectangle.top&&client.clientY<=rectangle.bottom;
		}).sort((a,b)=>resourceAncestors(architecture,b).length-resourceAncestors(architecture,a).length)[0];
		const placement=resourcePlacement(architecture,node.data.resource,target?.id);
		return {...placement,target:placement.ok?placement.parentId:target?.id};
	}
	function commitDrag(moved: CanvasNode[], event?:{clientX:number;clientY:number}) {
		const current = new Map((flow?.getNodes() ?? nodes).map(node => [node.id, node]));
		moved.forEach(node => current.set(node.id, node));
		if (guides && !snap) { guidedNodes([...current.values()], moved.map(node=>node.id)).nodes.forEach(node=>current.set(node.id,node)); }
		setGuideLines([]);
		const positions = Object.fromEntries(moved.map(node => [node.id,absolutePosition(current.get(node.id)!,current)]));
		const placement=moved.length===1&&event?placementAt(moved[0],event):undefined;
		setDropFeedback(undefined);
		if(placement&&!placement.ok){setNodes(displayNodes);setDropFeedback({ok:false,reason:placement.reason});return;}
		if(placement){dispatch({type:'placeResource',id:moved[0].id,parentId:placement.parentId,mode,positions});}
		else{dispatch({ type: 'canvas', command: { kind: 'move', mode, positions } });}
	}

	function handleKeys(event: ReactKeyboardEvent<HTMLElement>) {
		const target = event.target as HTMLElement;
		const mod = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); let action: SelectionAction | undefined;
		if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]') || (!mod && target.closest('button, summary'))) { return; }
		const edgeId = target.closest<SVGElement>('.react-flow__edge')?.dataset.id;
		const dependency = dependencies.find(item=>item.id===edgeId);
		if(dependency){if(key==='enter'||key===' '){event.preventDefault();onOpen(dependency.target);}else if(key==='delete'||key==='backspace'){event.preventDefault();}return;}
		if (edgeId && (key === 'enter' || key === ' ')) {
			event.preventDefault(); event.stopPropagation(); setCreatingConnection(false); onSelectionChange([]); setSelectedConnectionId(edgeId); return;
		}
		if ((edgeId || selectedConnectionId) && (key === 'delete' || key === 'backspace')) {
			event.preventDefault(); event.stopPropagation(); dispatch({ type: 'deleteConnection', id: edgeId ?? selectedConnectionId }); setSelectedConnectionId(''); return;
		}
		if (event.altKey && key === 'f10') {
			// Standard toolbar shortcut: move focus into the selection toolbar.
			const first = bounds.current?.querySelector<HTMLElement>('.selection-controls button, .selection-controls select');
			if (first) { event.preventDefault(); event.stopPropagation(); first.focus(); }
			return;
		}
		if (mod) {
			if (key === 'a') { action = 'selectAll'; } else if (key === 'c') { action = 'copy'; } else if (key === 'v') { action = 'paste'; }
			else if (key === 'd') { action = 'duplicate'; } else if (key === 'g') { action = event.shiftKey ? 'ungroup' : 'group'; }
			else if (key === 'l') { action = canvasElements(architecture).some(item => selectedIds.includes(item.id) && item.canvasLocked) ? 'unlock' : 'lock'; }
		} else if (key === 'delete' || key === 'backspace') { action = 'delete'; }
		else if (key === 'enter') { action = 'edit'; } else if (key === 'f') { action = 'fit'; }
		else if (key === 'escape') { action = 'clear'; }
		else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedIds.length) {
			const step = event.shiftKey ? 10 : 1; const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0; const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
			const ids = expandGroups(architecture, selectedIds);
			const positions = Object.fromEntries(canvasElements(architecture).filter(item => ids.includes(item.id)).map(item => [item.id, { x: item.positions[mode].x + dx, y: item.positions[mode].y + dy }]));
			event.preventDefault(); event.stopPropagation(); dispatch({ type: 'canvas', command: { kind: 'move', mode, positions } }); return;
		} else if (key === 'v') { setHand(false); } else if (key === 'h') { setHand(true); }
		else if (key === 't') { createItem('text'); } else if (key === 'n') { createItem('note'); }
		if (action) { event.preventDefault(); event.stopPropagation(); run(action); }
	}

	return (
		<CanvasActionMenu architecture={architecture} ids={selectedIds} hasClipboard={hasClipboard} run={run} container={bounds.current}>
		<main ref={bounds} tabIndex={0} className="canvas" aria-label={mode === 'visual' ? 'Visual design canvas' : 'Technical design canvas'} onKeyDownCapture={handleKeys}
			onContextMenuCapture={event => {
				const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
				if (node?.dataset.id && !selectedIds.includes(node.dataset.id)) { onSelectionChange(expandGroups(architecture, [node.dataset.id])); }
			}}
			onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
			onDrop={event => {
				event.preventDefault();
    const shape = shapeDefinitions.find(candidate => candidate.id === event.dataTransfer.getData('application/x-cloudforge-shape'));
    if (shape && flow) { onAddItem('shape', flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), shape.label, shape.id); return; }
				const catalogue = event.dataTransfer.getData('application/x-cloudforge-catalogue');
    if (catalogue && catalogue.length < 512 && flow) {
     try { const data=JSON.parse(catalogue); if(typeof data.type === 'string' && Object.hasOwn(providerNames,data.provider)) { const point=flow.screenToFlowPosition({x:event.clientX,y:event.clientY}); onAddCatalogue(data.type,data.provider,point,containerAt(point)?.id); } } catch { /* Foreign payload. */ }
     return;
    }
    const value = event.dataTransfer.getData('application/x-cloudforge-resource');
				if (!flow || !value || value.length > 256) { return; }
				try {
					const data = JSON.parse(value);
					if (Object.hasOwn(resourceTypes, data.kind) && Object.hasOwn(providerNames, data.provider)) {
						const point=flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); onAddResource(data.kind, data.provider, point, containerAt(point)?.id);
					}
				} catch { /* Ignore foreign drag payloads. */ }
			}}>
			<div className="canvas-tools" role="toolbar" aria-label="Canvas creation tools">
				<button aria-label="Select tool" title="Select tool" aria-pressed={!hand} onClick={() => setHand(false)}><MousePointer2 /></button>
				<button aria-label="Pan tool" title="Pan tool (hold Space)" aria-pressed={hand} onClick={() => setHand(true)}><Hand /></button>
				<button aria-label="Extend selection" title="Select multiple elements (Ctrl / Cmd + click)" aria-pressed={additiveSelection} onClick={() => { setHand(false); setAdditiveSelection(value => !value); }}><SquareDashedMousePointer /></button>
				<span className="tool-divider" />
				<button aria-label="Add text" title="Add text" onClick={() => createItem('text')}><Type /></button>
				<button aria-label="Add sticky note" title="Add sticky note" onClick={() => createItem('note')}><StickyNote /></button>
				<button aria-label="Add shape" title="Add shape" onClick={onOpenShapes}><Shapes /></button>
				<button aria-label="Add frame" title="Add frame" onClick={() => createItem('frame')}><Frame /></button>
				<button aria-label="Connect elements" title="Connect elements" aria-expanded={creatingConnection} onClick={() => { setSelectedConnectionId(''); if (!creatingConnection) { setConnectionSourceId(selectedId); onSelect(''); } setCreatingConnection(value => !value); }}><Cable /></button>
			</div>
			<ReactFlow<CanvasNode, DesignEdgeType>
				key={mode} defaultViewport={viewports.current[mode]} fitView={!viewports.current[mode]} fitViewOptions={{padding:canvasFitPadding,maxZoom:1}}
				forceColorMode={theme}
				nodes={(nodes[0]?.data.mode===mode ? nodes : displayNodes).map(node=>({...node,className:dropFeedback?.target===node.id?'container-drop-'+(dropFeedback.ok?'valid':'invalid'):undefined}))} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
				onInit={instance => { setFlow(instance); setZoom(instance.getZoom()); onInit(instance); if(!viewports.current[mode]){autoFit.current={mode,at:performance.now()};requestAnimationFrame(()=>{void instance.fitView({padding:canvasFitPadding,maxZoom:1}).then(()=>{viewports.current[mode]=instance.getViewport();setZoom(instance.getZoom());});});} }}
				onMoveStart={event => { if (event) { autoFit.current = { at: 0 }; } }}
				onConnect={connection => dispatch({ type: 'connect', source: connection.source, target: connection.target })}
				isValidConnection={connection => canConnect(architecture, connection.source, connection.target)}
				minZoom={0.1} maxZoom={20}
				onSelectionEnd={() => requestAnimationFrame(() => onSelectionChange(expandGroups(architecture, (flow?.getNodes() ?? []).filter(node => node.selected).map(node => node.id))))}
				onNodeClick={(event, node) => {
					if (!creatingConnection) {
						setSelectedConnectionId('');
						const group = expandGroups(architecture, [node.id]);
						if (additiveSelection || event.ctrlKey || event.metaKey || event.shiftKey) {
							onSelectionChange(selectedIds.includes(node.id) ? selectedIds.filter(id => !group.includes(id)) : [...new Set([...selectedIds, ...group])]);
						} else { onSelectionChange(group); if(node.type==='resource'&&group.length===1){onOpen(node.id);} }
					}
				}}
				onPaneClick={() => { setSelectedConnectionId(''); onSelect(''); }}
				onEdgeClick={(_, edge) => { setCreatingConnection(false); if(edge.data?.dependency){onOpen(edge.target);}else{setSelectedConnectionId(edge.id); onSelect('');} }}
				onNodeDoubleClick={(_, node) => { if (node.type === 'resource') { onOpenDetails(node.id); } }}
				onNodeDragStart={(_, node, moved) => onSelectionChange(expandGroups(architecture, (moved.length ? moved : [node]).map(item=>item.id)))}
				onNodeDrag={(event,node,moved)=>{if(moved.length<=1&&'clientX' in event){setDropFeedback(placementAt(node,event));}}}
				onNodeDragStop={(event, node, moved) => commitDrag(moved.length ? moved : [node], 'clientX' in event ? event : undefined)}
				onSelectionDragStop={(event, moved) => commitDrag(moved,'clientX' in event?event:undefined)}
				onMoveEnd={(_, next) => { viewports.current[mode] = next; setZoom(next.zoom); }}
				onViewportChange={next => { setZoom(next.zoom); }}
				panOnDrag={hand ? true : [1, 2]} panActivationKeyCode="Space"
				nodesDraggable={!hand} selectionOnDrag={!hand} selectionMode={SelectionMode.Partial}
				elevateNodesOnSelect={false}
				multiSelectionKeyCode={multiSelectKeys} selectionKeyCode="Shift"
				deleteKeyCode={null} snapToGrid={snap} snapGrid={[20, 20]} onlyRenderVisibleElements
			>
				<CanvasBackground grid={grid} />
				<AlignmentGuides lines={guideLines}/>
				{minimap && <MiniMap<CanvasNode> pannable zoomable nodeColor={node => node.type === 'board' && node.data.item.kind === 'frame' ? 'transparent' : '#8e79d9'} />}
				{!creatingConnection && (selectedConnection && showConnections ? <SelectionAnchor ids={[selectedConnection.source,selectedConnection.target]} canvas={bounds}><ConnectionTools connection={selectedConnection} dispatch={dispatch} onClose={() => { setSelectedConnectionId(''); bounds.current?.focus(); }}/></SelectionAnchor> : selectedIds.some(id=>canvasElements(architecture).some(item=>item.id===id)) && <SelectionAnchor ids={selectedIds.filter(id=>canvasElements(architecture).some(item=>item.id===id))} canvas={bounds}><SelectionControls architecture={architecture} ids={selectedIds} dispatch={dispatch} run={run} hasClipboard={hasClipboard} mode={mode} onInspect={onOpen} container={bounds.current}/></SelectionAnchor>)}
			</ReactFlow>
			{creatingConnection ? <ConnectionCreate architecture={architecture} selectedId={connectionSourceId} dispatch={dispatch} onClose={() => { setCreatingConnection(false); bounds.current?.querySelector<HTMLButtonElement>('[aria-label="Connect elements"]')?.focus(); }}/> : null}
			<details className="canvas-options"><summary>View</summary><div className="view-options-content">
				<label>Theme<select aria-label="Canvas theme" value={theme} onChange={event => onThemeChange(event.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
				<label>Grid<select aria-label="Canvas grid" value={grid} onChange={event => setGrid(event.target.value as typeof grid)}><option value="dots">Dots</option><option value="lines">Lines</option><option value="none">None</option></select></label>
				<label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap</label>
				<label title="Align edges and centres within 6 screen pixels. Grid snapping takes precedence."><input type="checkbox" checked={guides} onChange={event => {setGuides(event.target.checked);setGuideLines([]);}} />Alignment guides</label>
				<label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} />Show connections</label>
				{mode==='technical'&&<label><input type="checkbox" checked={technicalDesignLinks} onChange={event=>setTechnicalDesignLinks(event.target.checked)}/>Include design links</label>}
				<label><input type="checkbox" checked={allDependencies} onChange={event=>setAllDependencies(event.target.checked)}/>All inherited dependencies</label>
				<label><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} />Always show connection labels</label>
				<button aria-pressed={minimap} onClick={() => setMinimap(value => !value)}>Minimap</button>
				<details className="canvas-shortcuts"><summary>Keyboard shortcuts</summary><p>Ctrl / Cmd + click: extend selection<br/>Shift + drag: select an area<br/>Arrows: move 1 px; Shift + arrows: 10 px<br/>Enter: edit; Escape: clear selection<br/>V: select; H: pan; T: text; N: note<br/>F: focus selection; Space + drag: pan<br/>Copy, duplicate, group and layer actions are in the selection menu.</p></details>
			</div></details>
			{dropFeedback&&<div className={'container-drop-status '+(dropFeedback.ok?'valid':'invalid')} role="status">{dropFeedback.reason}</div>}
			<div className="canvas-navigation" role="group" aria-label="Zoom and navigation">
				<button aria-label="Zoom out" title="Zoom out" onClick={() => { autoFit.current = { at: 0 }; void flow?.zoomOut(); }}><Minus /></button>
				<select aria-label="Canvas zoom" value={zoom.toFixed(3)} onChange={event => { autoFit.current = { at: 0 }; void flow?.zoomTo(Number(event.target.value)); }}>
					{!zoomPresets.some(value => value.toFixed(3) === zoom.toFixed(3)) && <option value={zoom.toFixed(3)}>{Math.round(zoom * 100)}%</option>}
					{zoomPresets.map(value => <option key={value} value={value.toFixed(3)}>{Math.round(value * 100)}%</option>)}
				</select>
				<button aria-label="Zoom in" title="Zoom in" onClick={() => { autoFit.current = { at: 0 }; void flow?.zoomIn(); }}><Plus /></button>
				<button aria-label="Fit architecture to view" title="Fit architecture to view" onClick={() => { autoFit.current = { at: 0 }; void flow?.fitView({ padding: canvasFitPadding }); }}><Scan /></button>
			</div>
		</main>
		</CanvasActionMenu>
	);
});
