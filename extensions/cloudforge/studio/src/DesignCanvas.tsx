/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { shapeDefinitions, type ShapeId } from './shapes.ts';
import { DesignEdge, type DesignEdgeType } from './DesignEdge.tsx';
import { ConnectionOverlays, labelIsAuthored } from './ConnectionOverlays.tsx';
import { DependencyTools, dependencyStyle } from './DependencyTools.tsx';
import { ConnectionCreate } from './ConnectionCreate.tsx';
import { canConnect, connectionAnchor } from './designConnections.ts';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { canvasElements, connectedElementIds, expandGroups, resizeSelectionBoxes, sceneOrder, selectionFragment, stickyClusterFromText, type TextAppearance } from './canvasOperations.ts';
import { applyUniformSpacing, layoutSelection, type Alignment } from './selectionGeometry.ts';
import { CanvasActionMenu, SelectionControls, resizable, type SelectionAction } from './SelectionControls.tsx';
import { SelectionResizeHandle } from './SelectionResizeHandle.tsx';
import { InkCapture } from './InkCapture.tsx';
import { PenOptions } from './PenOptions.tsx';
import type { InkStyle } from './ink.ts';
import { ConnectorDropMenu } from './ConnectorDropMenu.tsx';
import { droppedItem } from './connectorDrop.ts';
import { elementEndpoint, endpointElementId, needsConnectionOverlay, pointEndpoint, type EndpointPort } from './connectionEndpoints.ts';
import { connectionPathBounds } from './connectionGeometry.ts';
import { resizeBounds } from './resizeGeometry.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { inheritedDependencies, isResourceContainer, visualAncestors, visualDescendants, resourceDimensions, visualResourcePlacement, visualParentId } from './resourceHierarchy.ts';
import { architectureDiagnostics } from './diagnostics.ts';
import { infrastructureRelationships } from './infrastructureRelationships.ts';
import { dispatchCanvasAction } from './canvasMutationPolicy.ts';
import { SelectionAnchor } from './SelectionAnchor.tsx';
import { alignmentGuides, type GuideLine } from './alignmentGuides.ts';
import { AlignmentGuides } from './AlignmentGuides.tsx';
import {
	Background, BackgroundVariant, ConnectionMode, MarkerType, MiniMap, ReactFlow, SelectionMode,
	useNodesState, useViewport, type OnNodesChange, type ReactFlowInstance, type Viewport
} from '@xyflow/react';
import { BoardNode, ResourceNode, type CanvasNode } from './ResourceNode.tsx';
import type { Action, Architecture, BoardItem, DesignMode, Provider, ResourceKind, Position } from './model.ts';
import { resourceDefinition, resourceTypes, providerNames } from './fixture.ts';
import { MousePointer2, SquareDashedMousePointer, Hand, Type, StickyNote, Shapes, Frame, Minus, Plus, Scan, Cable, PenLine, ChevronLeft, ChevronRight, Lock, Search, ChevronUp, ChevronDown, X } from 'lucide-react';

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
	architecture, mode, theme, onThemeChange, selectedId, selectedIds, onSelectionChange, dispatch: editArchitecture, onSelect, onOpen, onOpenDetails, onInit, viewports, onAddItem, onAddResource, onAddCatalogue, onOpenShapes, ink, onInkChange: setInk
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
	/** Pen preset lives in App so it survives the Configuration view unmounting this canvas. */
	ink: InkStyle;
	onInkChange: (ink: InkStyle) => void;
}) {
	const dispatch = useCallback((action: Action) => dispatchCanvasAction(mode, editArchitecture, action), [mode, editArchitecture]);
	const [nodes, setNodes] = useNodesState<CanvasNode>([]);
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, DesignEdgeType>>();
	const [grid, setGrid] = useState<'dots' | 'lines' | 'none'>('lines');
	const [snap, setSnap] = useState(false);
	const [guides, setGuides] = useState(true);
	const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
	const altCloneDrag = useRef(false);
	const [hand, setHand] = useState(false);
	const [pen, setPen] = useState(false);
	const resizeBoxes = resizeSelectionBoxes(architecture, selectedIds, mode);
	const [connectorDrop, setConnectorDrop] = useState<{ source: string; point: Position; left: number; top: number }>();
	const [additiveSelection, setAdditiveSelection] = useState(false);
	const [minimap, setMinimap] = useState(false);
	const [zoom, setZoom] = useState(1);
	const [selectedConnectionId, setSelectedConnectionId] = useState('');
	const [dependencyPick, setDependencyPick] = useState<{ id: string; left: number; top: number }>();
	const [showConnections, setShowConnections] = useState(true);
	const [allDependencies, setAllDependencies] = useState(false);
	const [dropFeedback, setDropFeedback] = useState<{target?:string;ok:boolean;reason:string}>();
	const [showLabels, setShowLabels] = useState(false);
	const [creatingConnection, setCreatingConnection] = useState(false);
	const [connectionSourceId, setConnectionSourceId] = useState('');
	const clipboard = useRef<Architecture | null>(null);
	const [hasClipboard, setHasClipboard] = useState(false);
	const styleClipboard = useRef<Partial<TextAppearance> | null>(null);
	const [hasStyleClipboard, setHasStyleClipboard] = useState(false);
	/** Miro/Figma smart duplicate: tracks last clone+move delta so repeating Ctrl+D stamps evenly. */
	const repeatStep = useRef<{ ids: string[]; dx: number; dy: number } | null>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState('');
	const [findIndex, setFindIndex] = useState(0);
	const findInput = useRef<HTMLInputElement>(null);
	const [editRequest, setEditRequest] = useState({ id: '', token: 0 });
	const selectedConnection = architecture.connections.find(connection => connection.id === selectedConnectionId);
	const bounds = useRef<HTMLDivElement>(null);
	// Ctrl / Cmd held while drawing a connector turns off snapping to elements.
	const freeDrop = useRef(false);
	useEffect(() => {
		const track = (event: KeyboardEvent | PointerEvent) => { freeDrop.current = event.ctrlKey || event.metaKey; };
		window.addEventListener('keydown', track, true); window.addEventListener('keyup', track, true); window.addEventListener('pointermove', track, true);
		return () => { window.removeEventListener('keydown', track, true); window.removeEventListener('keyup', track, true); window.removeEventListener('pointermove', track, true); };
	}, []);
	// An automatic first fit is redone when panels settle (e.g. the inspector opens on load), until the user moves the view.
	const autoFit = useRef<{ mode?: DesignMode; at: number }>({ at: 0 });
	useEffect(() => {
		const element = bounds.current; if (!element || !flow) { return; }
		let frame = 0;
		const observer = new ResizeObserver(() => {
			if (autoFit.current.mode !== mode || performance.now() - autoFit.current.at > 2500) { return; }
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				if (autoFit.current.mode !== mode) { return; }
				void flow.fitView({ padding: canvasFitPadding, maxZoom: 1 }).then(() => { viewports.current[mode] = flow.getViewport(); setZoom(flow.getZoom()); });
			});
		});
		observer.observe(element);
		return () => { cancelAnimationFrame(frame); observer.disconnect(); };
	}, [flow, mode, viewports]);
	useEffect(() => { if (selectedIds.length) { setSelectedConnectionId(''); } }, [selectedIds]);
	const order = useMemo(() => sceneOrder(architecture), [architecture]);
	const frames = useMemo(() => architecture.items.filter(item => item.kind === 'frame'), [architecture.items]);
	const [activeFrameIndex, setActiveFrameIndex] = useState(0);
	const jumpToFrame = useCallback((frame: BoardItem, index: number) => {
		if (!flow) { return; }
		autoFit.current = { at: 0 };
		setActiveFrameIndex(index);
		setSelectedConnectionId('');
		onSelectionChange([frame.id]);
		const pos = frame.positions[mode];
		void flow.fitBounds({ x: pos.x, y: pos.y, width: Math.max(1, frame.width), height: Math.max(1, frame.height) }, { padding: 0.16, duration: 240 });
	}, [flow, mode, onSelectionChange]);
	const stepFrame = useCallback((delta: number) => {
		if (!frames.length) { return; }
		const currentIdx = frames.findIndex(item => selectedIds.includes(item.id));
		const baseIdx = currentIdx >= 0 ? currentIdx : activeFrameIndex % frames.length;
		const nextIdx = (baseIdx + delta + frames.length) % frames.length;
		jumpToFrame(frames[nextIdx], nextIdx);
	}, [frames, selectedIds, activeFrameIndex, jumpToFrame]);

	const findMatches = useMemo(() => {
		const needle = findQuery.trim().toLowerCase();
		if (!needle) { return [] as { kind: 'element' | 'connection'; id: string; label: string }[]; }
		return [
			...architecture.resources.filter(resource => {
				const hay = [resource.label, resource.name, resource.terraformName, resource.catalogue?.type, resource.catalogue?.label, resource.kind].filter(Boolean).join(' ').toLowerCase();
				return hay.includes(needle);
			}).map(resource => ({ kind: 'element' as const, id: resource.id, label: resource.label || resource.name })),
			...architecture.items.filter(item => item.text.toLowerCase().includes(needle)).map(item => ({ kind: 'element' as const, id: item.id, label: item.text })),
			...architecture.connections.filter(link => (link.label ?? '').toLowerCase().includes(needle)).map(link => ({ kind: 'connection' as const, id: link.id, label: link.label ?? '' })),
		];
	}, [architecture.resources, architecture.items, architecture.connections, findQuery]);
	const focusMatch = useCallback((match: { kind: 'element' | 'connection'; id: string }) => {
		if (!flow) { return; }
		autoFit.current = { at: 0 };
		if (match.kind === 'connection') {
			onSelectionChange([]); setSelectedConnectionId(match.id);
			fitConnectionsAndNodes(match.id);
		} else {
			setSelectedConnectionId(''); onSelectionChange([match.id]);
			void flow.fitView({ nodes: [{ id: match.id }], padding: 0.45, maxZoom: 1.4, duration: 220 });
		}
	}, [flow, onSelectionChange]);
	const stepFind = useCallback((delta: number) => {
		if (!findMatches.length) { return; }
		const next = (findIndex + delta + findMatches.length) % findMatches.length;
		setFindIndex(next);
		focusMatch(findMatches[next]);
	}, [findMatches, findIndex, focusMatch]);
	const diagnostics = useMemo(() => architectureDiagnostics(architecture), [architecture]);
	const dependencies = useMemo(() => inheritedDependencies(architecture), [architecture]);
	const relationships = useMemo(() => infrastructureRelationships(architecture), [architecture]);
	const selectedDependency = dependencyPick && dependencies.find(dependency => dependency.id === dependencyPick.id);
	// The Technical Graph is a separate renderer (TechnicalGraph.tsx); this canvas only authors the design.
	const resourcePosition = (id: string): Position => architecture.resources.find(resource => resource.id === id)?.positions[mode] ?? { x: 0, y: 0 };

	const resourceNodes = useMemo<CanvasNode[]>(() => architecture.resources.map(resource => {
		const parent = architecture.resources.find(item=>item.id===visualParentId(resource)) ?? architecture.items.find(item => item.kind === 'frame' && item.members.includes(resource.id));
		const parentPosition = parent ? parent.positions[mode] : { x: 0, y: 0 };
		const position = resourcePosition(resource.id);
		const container = isResourceContainer(resource);
		return {
			id: resource.id, type: 'resource', parentId: parent?.id,
			style: container ? resourceDimensions(architecture,resource,mode) : mode === 'visual' ? {width:resourceIconSize(resource),height:resourceIconSize(resource)} : undefined,
			position: { x: position.x - parentPosition.x, y: position.y - parentPosition.y },
			data: { resource, mode, dispatch, architecture, autoSpacing: false, onConnections: onOpenDetails, relationships, onReview:onOpen, origin: parentPosition, variables: architecture.variables, childCount:architecture.resources.filter(item=>visualParentId(item)===resource.id).length, dependencies: dependencies.filter(edge => edge.target === resource.id).map(edge => architecture.resources.find(candidate => candidate.id === edge.source)?.name ?? edge.source), findings: diagnostics.filter(finding => finding.resourceId === resource.id) }, ariaLabel: resource.name + ', ' + resourceDefinition(resource).label
		};
	}), [architecture, mode, dispatch, dependencies, diagnostics, onOpen, onOpenDetails, relationships]);

	const boardNodes = useMemo<CanvasNode[]>(() => architecture.items.map(item => ({
		id: item.id, type: 'board', position: item.positions[mode],
		data: { item, mode, dispatch, editToken: editRequest.id === item.id ? editRequest.token : 0 },
		style: {
			width: item.width,
			height: item.height
		},
		zIndex: item.kind === 'frame' ? -1 : 1, 
		ariaLabel: item.kind === 'ink' ? 'Freehand drawing' : item.kind + ', ' + item.text
	})), [architecture.items, mode, dispatch, editRequest]);

	const displayNodes = useMemo(() => [...boardNodes, ...resourceNodes].map(node => ({
		...node, selected: selectedIds.includes(node.id), draggable: mode === 'visual' && !(node.type === 'board' ? node.data.item.canvasLocked : node.data.resource.canvasLocked||isResourceContainer(node.data.resource)&&visualDescendants(architecture,node.id).some(child=>child.canvasLocked)), connectable: mode === 'visual', deletable: mode === 'visual',
		zIndex: node.type === 'board' && node.data.item.kind === 'frame' ? -100 : node.type==='resource' && isResourceContainer(node.data.resource) ? -80+visualAncestors(architecture,node.data.resource).length : order.indexOf(node.id) + 1
	})).sort((a, b) => {
		const depth = (node: CanvasNode) => { let parent = node.parentId; let count = 0; const seen = new Set<string>(); while (parent && !seen.has(parent)) { seen.add(parent); count++; parent = [...boardNodes, ...resourceNodes].find(node => node.id === parent)?.parentId; } return count; };
		return depth(a) - depth(b);
	}), [boardNodes, resourceNodes, selectedIds, order, architecture, mode]);

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

	const edges = useMemo<DesignEdgeType[]>(() => [...architecture.connections.filter(connection => !needsConnectionOverlay(connection) && connection.id !== selectedConnectionId).map(connection => ({
		...connection, source: endpointElementId(connection.source)!, target: endpointElementId(connection.target)!,
		sourceHandle: connection.source.kind === 'element' ? connection.source.port ?? 'output' : 'output', targetHandle: connection.target.kind === 'element' ? connection.target.port ?? 'input' : 'input',
		type: 'design' as const, selected: connection.id === selectedConnectionId, hidden: !showConnections,
		markerStart: connection.startArrow ? { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 } : undefined,
		markerEnd: connection.endArrow === false ? undefined : { type: MarkerType.ArrowClosed, color: connection.stroke ?? '#7565bd', width: 15, height: 15 },
		data: { connection, showLabel: showLabels || labelIsAuthored(connection) }, ariaLabel: 'Design connection: ' + (connection.label || endpointElementId(connection.source) + ' to ' + endpointElementId(connection.target))
	})), ...dependencies.map(dependency=>{
		const active=selectedIds.includes(dependency.source)||selectedIds.includes(dependency.target);
			return {...dependency,sourceHandle:'output',targetHandle:'input',type:'design' as const,hidden:!showConnections||!active&&!allDependencies&&dependency.id!==selectedDependency?.id,animated:false,className:'infrastructure-dependency',selected:dependency.id===selectedDependency?.id,data:{connection:{...dependency,source:elementEndpoint(dependency.source),target:elementEndpoint(dependency.target),pattern:'dotted' as const,...dependencyStyle(architecture,dependency.id),label:dependency.fields.join(', '),endArrow:false},showLabel:showLabels||active||dependency.id===selectedDependency?.id,dependency:true},ariaLabel:'Inherited dependency: '+dependency.fields.join(', ')};
		})], [architecture.connections, selectedConnectionId, showConnections, showLabels, dependencies, mode, allDependencies, selectedIds, architecture.dependencyStyles, selectedDependency]);

	function createItem(kind: BoardItem['kind'], shape?: ShapeId) {
		if (mode !== 'visual') { return; }
		const rectangle = bounds.current?.getBoundingClientRect();
		if (flow && rectangle) {
			const def = shape ? shapeDefinitions.find(item => item.id === shape) : undefined;
			onAddItem(kind, flow.screenToFlowPosition({ x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }), def?.label, shape);
		}
	}

	function copySelection() {
		if (!selectedIds.length && !selectedConnectionId) { return; }
		clipboard.current = selectionFragment(architecture, selectedIds, selectedConnectionId ? [selectedConnectionId] : [], mode); setHasClipboard(true);
	}
	function insertCopy(fragment: Architecture, dx = 30, dy = 30, trackRepeat = false) {
		const idMap = Object.fromEntries([...canvasElements(fragment), ...(fragment.groups ?? []), ...fragment.connections].map(item => [item.id, crypto.randomUUID()]));
		dispatch({ type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: dx, offsetY: dy } });
		const newIds = canvasElements(fragment).map(item => idMap[item.id]);
		onSelectionChange(newIds);
		repeatStep.current = trackRepeat && newIds.length ? { ids: newIds, dx, dy } : null;
		if (!canvasElements(fragment).length && fragment.connections.length === 1) { setSelectedConnectionId(idMap[fragment.connections[0].id]); }
	}
	function sameSelection(a: readonly string[], b: readonly string[]) { return a.length === b.length && a.every(id => b.includes(id)); }
	function nodeSizes() { return Object.fromEntries((flow?.getNodes() ?? []).map(node => [node.id, { width: node.measured?.width ?? 112, height: node.measured?.height ?? 92 }])); }
	function fitConnectionsAndNodes(connectionId?: string) {
		if (!flow) { return; }
		const links = architecture.connections.filter(link => connectionId ? link.id === connectionId : needsConnectionOverlay(link));
		const linkBounds = links.flatMap(link => {
			const source = connectionAnchor(architecture, link.source, 'source', mode); const target = connectionAnchor(architecture, link.target, 'target', mode);
			return source && target ? [connectionPathBounds(link, source.x, source.y, target.x, target.y)] : [];
		});
		if (!linkBounds.length) { void flow.fitView({ padding: canvasFitPadding, maxZoom: 1 }); return; }
		const current = new Map(flow.getNodes().map(node => [node.id, node]));
		const boxes = connectionId ? linkBounds : [...linkBounds, ...[...current.values()].map(node => ({ ...absolutePosition(node, current), width: node.measured?.width ?? (Number(node.style?.width) || 48), height: node.measured?.height ?? (Number(node.style?.height) || 48) }))];
		const box = resizeBounds(boxes);
		if (box) { void flow.fitBounds({ ...box, width: Math.max(1, box.width), height: Math.max(1, box.height) }, { padding: canvasFitPadding }); }
	}
	function run(action: SelectionAction) {
		const ids = expandGroups(architecture, selectedIds);
		if (action === 'clear') { repeatStep.current = null; onSelectionChange([]); setSelectedConnectionId(''); setDependencyPick(undefined); setCreatingConnection(false); setAdditiveSelection(false); bounds.current?.focus(); }
		else if (action === 'selectAll') { repeatStep.current = null; onSelectionChange(canvasElements(architecture).map(item => item.id)); }
		else if (action === 'selectConnected') {
			const connected = connectedElementIds(architecture, ids);
			if (connected.length) { repeatStep.current = null; onSelectionChange(connected); }
		}
		else if (action === 'selectSimilar') {
			const boardKinds = new Set(architecture.items.filter(item => ids.includes(item.id)).map(item => item.kind));
			const resourceKeys = new Set(architecture.resources.filter(item => ids.includes(item.id)).map(item => item.catalogue?.type ?? item.kind));
			const matching = [
				...architecture.items.filter(item => boardKinds.has(item.kind)).map(item => item.id),
				...architecture.resources.filter(item => resourceKeys.has(item.catalogue?.type ?? item.kind)).map(item => item.id),
			];
			if (matching.length) { repeatStep.current = null; onSelectionChange(expandGroups(architecture, matching)); }
		}
		else if (action === 'copy') { copySelection(); }
		else if (action === 'paste') { if (clipboard.current) { insertCopy(clipboard.current); } }
		else if (action === 'duplicate') {
			if (ids.length || selectedConnectionId) {
				const repeat = repeatStep.current && sameSelection(repeatStep.current.ids, ids) ? repeatStep.current : undefined;
				insertCopy(selectionFragment(architecture, ids, selectedConnectionId ? [selectedConnectionId] : [], mode), repeat?.dx ?? 30, repeat?.dy ?? 30, true);
			}
		}
		else if (action === 'copyStyle') {
			if (ids.length !== 1) { return; }
			const item = architecture.items.find(candidate => candidate.id === ids[0]);
			if (!item) { return; }
			const keys: (keyof TextAppearance)[] = ['fontSize', 'bold', 'italic', 'underline', 'textColor', 'fontFamily', 'textAlign', 'verticalAlign', 'fill', 'opacity', 'strokeColor', 'strokeWidth', 'strokeStyle'];
			const patch: Partial<TextAppearance> = {};
			for (const key of keys) { if (item[key] !== undefined) { (patch as Record<string, unknown>)[key] = item[key]; } }
			styleClipboard.current = patch; setHasStyleClipboard(true);
		}
		else if (action === 'pasteStyle') {
			if (!styleClipboard.current || !ids.length) { return; }
			dispatch({ type: 'canvas', command: { kind: 'style', ids, patch: styleClipboard.current } });
		}
		else if (action === 'delete') { repeatStep.current = null; dispatch({ type: 'canvas', command: { kind: 'delete', ids } }); }
		else if (action === 'lock' || action === 'unlock') { dispatch({ type: 'canvas', command: { kind: 'lock', ids, locked: action === 'lock' } }); }
		else if (action === 'group') { dispatch({ type: 'canvas', command: { kind: 'group', ids, id: crypto.randomUUID() } }); }
		else if (action === 'ungroup') { dispatch({ type: 'canvas', command: { kind: 'ungroup', ids } }); }
		else if (action === 'frameSelection') {
			const frameId = crypto.randomUUID();
			dispatch({ type: 'canvas', command: { kind: 'frameSelection', ids, id: frameId, mode, sizes: nodeSizes() } });
			onSelectionChange([frameId]);
		}
		else if (action === 'fitFrame') {
			if (ids.length === 1) { dispatch({ type: 'canvas', command: { kind: 'fitFrame', id: ids[0], mode, sizes: nodeSizes() } }); }
		}
		else if (action === 'front' || action === 'forward' || action === 'backward' || action === 'back') { dispatch({ type: 'canvas', command: { kind: 'arrange', ids, direction: action } }); }
		else if (action === 'fit') { if (selectedConnectionId) { fitConnectionsAndNodes(selectedConnectionId); } else if (ids.length) { void flow?.fitView({ nodes: ids.map(id => ({ id })), padding: 0.25, maxZoom: 2 }); } }
		else if (action === 'edit') {
			if (ids.length !== 1 || canvasElements(architecture).find(item => item.id === ids[0])?.canvasLocked) { return; }
			if (architecture.resources.some(item => item.id === ids[0])) { onOpenDetails(ids[0]); }
			else { setEditRequest(request => ({ id: ids[0], token: request.token + 1 })); }
		} else if (action.startsWith('align-')) {
			dispatch({ type: 'canvas', command: { kind: 'move', mode, positions: layoutSelection(architecture, ids, mode, action.slice(6) as Alignment, nodeSizes(), undefined) } });
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
		const excluded=new Set(movingId?[movingId,...visualDescendants(architecture,movingId).map(item=>item.id)]:[]);
		return architecture.resources.filter(item=>isResourceContainer(item)&&!excluded.has(item.id)).filter(item=>{const pos=resourcePosition(item.id);const size=resourceDimensions(architecture,item,mode);return point.x>=pos.x&&point.y>=pos.y&&point.x<=pos.x+size.width&&point.y<=pos.y+size.height;}).sort((a,b)=>visualAncestors(architecture,b).length-visualAncestors(architecture,a).length)[0];
	}
	function placementAt(node:CanvasNode,client:{clientX:number;clientY:number}) {
		if(node.type!=='resource'||!flow){return undefined;}
		const excluded=new Set([node.id,...visualDescendants(architecture,node.id).map(item=>item.id)]);
		// Hit-test current rendered bounds: opening a panel or a viewport move can change
		// screen geometry during a drag. The domain model still validates the candidate.
		const target=architecture.resources.filter(item=>isResourceContainer(item)&&!excluded.has(item.id)).filter(item=>{
			const element=bounds.current?.querySelector<HTMLElement>('.react-flow__node[data-id="'+CSS.escape(item.id)+'"]');const rectangle=element?.getBoundingClientRect();
			return rectangle&&client.clientX>=rectangle.left&&client.clientX<=rectangle.right&&client.clientY>=rectangle.top&&client.clientY<=rectangle.bottom;
		}).sort((a,b)=>visualAncestors(architecture,b).length-visualAncestors(architecture,a).length)[0];
		const placement=visualResourcePlacement(architecture,node.data.resource,target?.id);
		return {...placement,target:target?.id,visualParentId:target?.id??null};
	}
	function commitDrag(moved: CanvasNode[], event?:{clientX:number;clientY:number;altKey?:boolean}) {
		const altClone = altCloneDrag.current || !!event?.altKey;
		altCloneDrag.current = false;
		if (mode !== 'visual') { setNodes(displayNodes); return; }
		const current = new Map((flow?.getNodes() ?? nodes).map(node => [node.id, node]));
		moved.forEach(node => current.set(node.id, node));
		if (guides && !snap) { guidedNodes([...current.values()], moved.map(node=>node.id)).nodes.forEach(node=>current.set(node.id,node)); }
		setGuideLines([]);
		const positions = Object.fromEntries(moved.map(node => [node.id, absolutePosition(current.get(node.id)!, current)]));
		setDropFeedback(undefined);
		if (altClone && moved.length > 0) {
			const lead = moved[0];
			const original = canvasElements(architecture).find(item => item.id === lead.id);
			const nextPos = positions[lead.id];
			if (original && nextPos) {
				const dx = Math.round((nextPos.x - original.positions[mode].x) * 10) / 10;
				const dy = Math.round((nextPos.y - original.positions[mode].y) * 10) / 10;
				setNodes(displayNodes);
				if (Math.hypot(dx, dy) >= 2) {
					const fragment = selectionFragment(architecture, moved.map(node => node.id), [], mode);
					const idMap = Object.fromEntries([...canvasElements(fragment), ...(fragment.groups ?? []), ...fragment.connections].map(item => [item.id, crypto.randomUUID()]));
					dispatch({ type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: dx, offsetY: dy } });
					const newIds = canvasElements(fragment).map(item => idMap[item.id]);
					onSelectionChange(newIds);
					repeatStep.current = { ids: newIds, dx, dy };
				}
				return;
			}
		}
		if (repeatStep.current && moved.length > 0 && sameSelection(repeatStep.current.ids, moved.map(node => node.id))) {
			const lead = moved[0];
			const original = canvasElements(architecture).find(item => item.id === lead.id);
			const nextPos = positions[lead.id];
			if (original && nextPos) {
				repeatStep.current = { ids: repeatStep.current.ids, dx: repeatStep.current.dx + Math.round((nextPos.x - original.positions[mode].x) * 10) / 10, dy: repeatStep.current.dy + Math.round((nextPos.y - original.positions[mode].y) * 10) / 10 };
			}
		}
		const placement=moved.length===1&&event?placementAt(moved[0],event):undefined;
		if(placement&&!placement.ok){setNodes(displayNodes);setDropFeedback({ok:false,reason:placement.reason});return;}
		if(placement){dispatch({type:'placeResource',id:moved[0].id,parentId:placement.parentId,visualParentId:placement.visualParentId,mode,positions});}
		else{dispatch({ type: 'canvas', command: { kind: 'move', mode, positions } });}
	}

	function handleKeys(event: ReactKeyboardEvent<HTMLElement>) {
		const target = event.target as HTMLElement;
		const mod = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); let action: SelectionAction | undefined;
		if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) { return; }
		// Escape leaves pen mode even while focus is still on the Pen button.
		if (pen && key === 'escape') { event.preventDefault(); event.stopPropagation(); setPen(false); return; }
		if (!mod && target.closest('button, summary')) { return; }
		const edgeId = target.closest<SVGElement>('.react-flow__edge')?.dataset.id;
		const dependency = [...dependencies, ...relationships].find(item=>item.id===edgeId);
		if(dependency){if(key==='enter'||key===' '){event.preventDefault();onOpen(dependency.target);}else if(key==='delete'||key==='backspace'){event.preventDefault();}return;}
		if (edgeId && (key === 'enter' || key === ' ')) {
			event.preventDefault(); event.stopPropagation(); setCreatingConnection(false); onSelectionChange([]); setSelectedConnectionId(edgeId);
			// Opened from the keyboard: move focus into the connection tools so Tab continues there.
			requestAnimationFrame(() => requestAnimationFrame(() => bounds.current?.querySelector<HTMLElement>('.connection-tools input, .connection-tools select, .connection-tools button')?.focus()));
			return;
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
			if (key === 'a') { action = 'selectAll'; } else if (key === 'c') { action = event.altKey ? 'copyStyle' : 'copy'; } else if (key === 'v') {
				if (event.altKey) { action = 'pasteStyle'; }
				else if (clipboard.current) { action = 'paste'; }
				// When no internal canvas copy is buffered, let native onPaste turn external text lines into Miro sticky notes!
			}
			else if (key === '0') { event.preventDefault(); event.stopPropagation(); autoFit.current = { at: 0 }; void flow?.zoomTo(1, { duration: 180 }); return; }
			else if (key === 'd') { action = 'duplicate'; } else if (key === 'g') { action = event.shiftKey ? 'ungroup' : 'group'; }
			else if (key === 'f' && event.altKey) { action = 'frameSelection'; }
			else if (key === 'f' && !event.altKey) {
				event.preventDefault(); event.stopPropagation();
				setFindOpen(true);
				requestAnimationFrame(() => findInput.current?.focus());
				return;
			}
			else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && mode === 'visual' && selectedIds.length === 1) {
				const source = architecture.items.find(item => item.id === selectedIds[0] && !item.canvasLocked && (item.kind === 'note' || item.kind === 'shape' || item.kind === 'text'));
				if (source) {
					event.preventDefault(); event.stopPropagation();
					const id = crypto.randomUUID(); const connectionId = crypto.randomUUID();
					const direction = key === 'arrowright' ? 'right' : key === 'arrowleft' ? 'left' : key === 'arrowdown' ? 'down' : 'up';
					dispatch({ type: 'canvas', command: { kind: 'spawnConnected', sourceId: source.id, id, connectionId, direction, mode } });
					onSelectionChange([id]);
					setShowConnections(true);
					return;
				}
			}
			else if (key === 'l') { action = canvasElements(architecture).some(item => selectedIds.includes(item.id) && item.canvasLocked) ? 'unlock' : 'lock'; }
		} else if (key === 'tab' && mode === 'visual' && selectedIds.length === 1) {
			const note = architecture.items.find(item => item.id === selectedIds[0] && item.kind === 'note' && !item.canvasLocked);
			if (note) {
				// Miro rapid sticky-note cluster authoring: Tab adds a matching note to the right, Shift+Tab below.
				event.preventDefault(); event.stopPropagation();
				const nextId = crypto.randomUUID();
				const pos = event.shiftKey ? { x: note.positions[mode].x, y: note.positions[mode].y + note.height + 24 } : { x: note.positions[mode].x + note.width + 24, y: note.positions[mode].y };
				dispatch({ type: 'addItem', item: { ...note, id: nextId, text: '', positions: { visual: pos, technical: pos }, members: [], canvasLocked: false } });
				onSelectionChange([nextId]);
				return;
			}
		} else if (key === 'delete' || key === 'backspace') { action = 'delete'; }
		else if ((key === 'pageup' || key === 'pagedown') && frames.length > 0) {
			event.preventDefault(); event.stopPropagation(); stepFrame(key === 'pagedown' ? 1 : -1); return;
		}
		else if (key === 'enter') { action = 'edit'; } else if (key === 'f') { action = 'fit'; }
		else if (key === 'escape') { action = 'clear'; }
		else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedIds.length) {
			const step = event.shiftKey ? 10 : 1; const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0; const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
			const ids = expandGroups(architecture, selectedIds);
			const positions = Object.fromEntries(canvasElements(architecture).filter(item => ids.includes(item.id)).map(item => [item.id, { x: item.positions[mode].x + dx, y: item.positions[mode].y + dy }]));
			if (repeatStep.current && sameSelection(repeatStep.current.ids, ids)) { repeatStep.current = { ids: repeatStep.current.ids, dx: repeatStep.current.dx + dx, dy: repeatStep.current.dy + dy }; }
			event.preventDefault(); event.stopPropagation(); dispatch({ type: 'canvas', command: { kind: 'move', mode, positions } }); return;
		} else if (key === 'v') { setHand(false); setPen(false); } else if (key === 'h') { setPen(false); setHand(true); } else if (key === 'p') { setHand(false); setPen(value => !value); }
		else if ((event.key === '[' || event.key === ']') && selectedIds.length) {
			// Turn selected drawings by 15° (Shift: 1°). Resources and frames stay upright.
			const step = (event.shiftKey ? 1 : 15) * (event.key === ']' ? 1 : -1);
			event.preventDefault(); event.stopPropagation(); dispatch({ type: 'canvas', command: { kind: 'rotate', ids: selectedIds, by: step } }); return;
		}
		else if (event.shiftKey && event.code === 'Digit1') { event.preventDefault(); event.stopPropagation(); autoFit.current = { at: 0 }; fitConnectionsAndNodes(); return; }
		else if (event.shiftKey && event.code === 'Digit2') { action = 'fit'; }
		else if (event.shiftKey && event.code === 'Digit0') { event.preventDefault(); event.stopPropagation(); autoFit.current = { at: 0 }; void flow?.zoomTo(1, { duration: 180 }); return; }
		else if (event.key === '+' || event.key === '=') { event.preventDefault(); event.stopPropagation(); autoFit.current = { at: 0 }; void flow?.zoomIn({ duration: 140 }); return; }
		else if (event.key === '-') { event.preventDefault(); event.stopPropagation(); autoFit.current = { at: 0 }; void flow?.zoomOut({ duration: 140 }); return; }
		else if (key === 'r' && !event.shiftKey && !event.altKey) { createItem('shape', 'rectangle'); }
		else if (key === 'o' && !event.shiftKey && !event.altKey) { createItem('shape', 'ellipse'); }
		else if (key === 'd' && !event.shiftKey && !event.altKey) { createItem('shape', 'diamond'); }
		else if (key === 'l' && !event.shiftKey && !event.altKey && mode === 'visual') { setSelectedConnectionId(''); setConnectionSourceId(selectedId); onSelect(''); setCreatingConnection(value => !value); }
		else if (key === 't') { createItem('text'); } else if (key === 'n') { createItem('note'); }
		if (action) { event.preventDefault(); event.stopPropagation(); run(action); }
	}

	return (
		<CanvasActionMenu architecture={architecture} ids={selectedIds} hasClipboard={hasClipboard} hasStyleClipboard={hasStyleClipboard} run={run} container={bounds.current} readOnly={false}>
		<main ref={bounds} tabIndex={0} className="canvas" aria-label="Visual design canvas" onKeyDownCapture={handleKeys}
			onPaste={event => {
				const target = event.target as HTMLElement;
				if (mode !== 'visual' || target.closest('input, textarea, select, [contenteditable="true"]')) { return; }
				const text = event.clipboardData?.getData('text/plain');
				const rectangle = bounds.current?.getBoundingClientRect();
				if (!text?.trim() || !flow || !rectangle) { return; }
				const origin = flow.screenToFlowPosition({ x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 });
				const created = stickyClusterFromText(text, origin, () => crypto.randomUUID());
				if (!created.length) { return; }
				event.preventDefault();
				dispatch({ type: 'canvas', command: { kind: 'addItems', items: created } });
				onSelectionChange(created.map(item => item.id));
			}}
			onContextMenuCapture={event => {
				const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
				if (node?.dataset.id && !selectedIds.includes(node.dataset.id)) { onSelectionChange(expandGroups(architecture, [node.dataset.id])); }
			}}
			onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
			onDrop={event => {
				event.preventDefault(); if (mode !== 'visual') { return; }
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
			<div className="canvas-tools" role="toolbar" aria-label={mode === 'visual' ? 'Canvas creation tools' : 'Graph navigation tools'}>
				<button aria-label="Select tool" title="Select tool" aria-pressed={!hand && !pen} onClick={() => { setHand(false); setPen(false); }}><MousePointer2 /></button>
				<button aria-label="Pan tool" title="Pan tool (hold Space)" aria-pressed={hand} onClick={() => { setPen(false); setHand(true); }}><Hand /></button>
				<button aria-label="Extend selection" title="Select multiple elements (Ctrl / Cmd + click)" aria-pressed={additiveSelection} onClick={() => { setHand(false); setAdditiveSelection(value => !value); }}><SquareDashedMousePointer /></button>
				{mode === 'visual' && <>
				<span className="tool-divider" />
				<button aria-label="Add text" title="Add text" onClick={() => createItem('text')}><Type /></button>
				<div className="pen-tool"><button aria-label="Draw freehand" title="Pen (P) · draw freehand, Escape to stop" aria-pressed={pen} onClick={() => { setHand(false); setPen(value => !value); }}><PenLine /></button>{pen && <PenOptions ink={ink} onChange={setInk} container={bounds.current}/>}</div>
				<button aria-label="Add sticky note" title="Add sticky note" onClick={() => createItem('note')}><StickyNote /></button>
				<button aria-label="Add shape" title="Add shape" onClick={onOpenShapes}><Shapes /></button>
				<button aria-label="Add frame" title="Add frame" onClick={() => createItem('frame')}><Frame /></button>
				<button aria-label="Connect elements" title="Connect elements" aria-expanded={creatingConnection} onClick={() => { setSelectedConnectionId(''); if (!creatingConnection) { setConnectionSourceId(selectedId); onSelect(''); } setCreatingConnection(value => !value); }}><Cable /></button>
				</>}
			</div>
			<ReactFlow<CanvasNode, DesignEdgeType>
				key={mode} defaultViewport={viewports.current[mode]} fitView={!viewports.current[mode]} fitViewOptions={{padding:canvasFitPadding,maxZoom:1}}
				forceColorMode={theme}
				zIndexMode="manual"
				nodes={(nodes[0]?.data.mode===mode ? nodes : displayNodes).map(node=>({...node,className:dropFeedback?.target===node.id?'container-drop-'+(dropFeedback.ok?'valid':'invalid'):undefined}))} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
				onInit={instance => { setFlow(instance); setZoom(instance.getZoom()); onInit(instance); if(!viewports.current[mode]){autoFit.current={mode,at:performance.now()};requestAnimationFrame(()=>{if(autoFit.current.mode!==mode){return;}void instance.fitView({padding:canvasFitPadding,maxZoom:1}).then(()=>{viewports.current[mode]=instance.getViewport();setZoom(instance.getZoom());});});} }}
				onMoveStart={event => { if (event) { autoFit.current = { at: 0 }; } }}
				onConnect={connection => {
					// Default sides keep the compact form; any other side (top, bottom, a reversed side) is stored on the endpoint.
					const from = connection.sourceHandle ?? 'output'; const to = connection.targetHandle ?? 'input';
					if (from === 'output' && to === 'input') { dispatch({ type: 'connect', source: connection.source, target: connection.target }); return; }
					dispatch({ type: 'connectEndpoints', id: crypto.randomUUID(), source: elementEndpoint(connection.source, from as EndpointPort), target: elementEndpoint(connection.target, to as EndpointPort) });
				}}
				connectionMode={ConnectionMode.Loose}
				onConnectEnd={(event, state) => {
					// A connector released on empty canvas offers to create the element it points at.
					const client = 'changedTouches' in event ? event.changedTouches[0] : event; const area = bounds.current?.getBoundingClientRect();
					// Holding Ctrl / Cmd drops a free end where the pointer is, even over another element (no snapping).
					if (freeDrop.current && mode === 'visual' && state.fromNode && state.fromHandle?.type === 'source' && flow && client) {
						const id = crypto.randomUUID(); dispatch({ type: 'connectEndpoints', id, source: elementEndpoint(state.fromNode.id), target: pointEndpoint(flow.screenToFlowPosition({ x: client.clientX, y: client.clientY })) });
						onSelectionChange([]); setSelectedConnectionId(id); setShowConnections(true); return;
					}
					if (mode !== 'visual' || state.isValid || state.toNode || !state.fromNode || state.fromHandle?.type !== 'source' || !flow || !area || !(client && (event.target as Element | null)?.closest?.('.react-flow__pane'))) { return; }
					setConnectorDrop({ source: state.fromNode.id, point: flow.screenToFlowPosition({ x: client.clientX, y: client.clientY }), left: Math.min(client.clientX - area.left + 8, area.width - 196), top: Math.min(client.clientY - area.top - 12, area.height - 236) });
				}}
				isValidConnection={connection => mode === 'visual' && !freeDrop.current && canConnect(architecture, connection.source, connection.target)}
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
				onPaneClick={() => { setSelectedConnectionId(''); setDependencyPick(undefined); onSelect(''); }}
				onEdgeClick={(event, edge) => { setCreatingConnection(false); if(edge.data?.dependency){
					// A dependency line is selected for its appearance tools; Enter or the tools open its target.
					const area = bounds.current?.getBoundingClientRect(); if (!area) { return; }
					setSelectedConnectionId(''); setDependencyPick({ id: edge.id, left: Math.max(12, Math.min(event.clientX - area.left + 12, area.width - 372)), top: Math.max(12, Math.min(event.clientY - area.top + 12, area.height - 236)) });
				}else{setDependencyPick(undefined); setSelectedConnectionId(edge.id); onSelect('');} }}
				onNodeDoubleClick={(_, node) => { if (node.type === 'resource') { onOpenDetails(node.id); } }}
				onNodeDragStart={(event, node, moved) => { autoFit.current = { at: 0 }; altCloneDrag.current = 'altKey' in event && !!event.altKey; onSelectionChange(expandGroups(architecture, (moved.length ? moved : [node]).map(item=>item.id))); }}
				onNodeDrag={(event,node,moved)=>{if(!altCloneDrag.current&&moved.length<=1&&'clientX' in event){setDropFeedback(placementAt(node,event));}}}
				onNodeDragStop={(event, node, moved) => commitDrag(moved.length ? moved : [node], 'clientX' in event ? event : undefined)}
				onSelectionDragStart={event => { altCloneDrag.current = 'altKey' in event && !!event.altKey; }}
				onSelectionDragStop={(event, moved) => commitDrag(moved,'clientX' in event?event:undefined)}
				onMoveEnd={(_, next) => { viewports.current[mode] = next; setZoom(next.zoom); }}
				onViewportChange={next => { setZoom(next.zoom); }}
				panOnDrag={hand ? true : [1, 2]} panActivationKeyCode="Space"
				nodesDraggable={mode === 'visual' && !hand} nodesConnectable={mode === 'visual'} selectionOnDrag={!hand} selectionMode={SelectionMode.Partial}
				elevateNodesOnSelect={false}
				multiSelectionKeyCode={multiSelectKeys} selectionKeyCode="Shift"
				deleteKeyCode={null} snapToGrid={snap} snapGrid={[20, 20]} onlyRenderVisibleElements
			>
				<CanvasBackground grid={grid} />
				<AlignmentGuides lines={guideLines}/>
				{mode === 'visual' && flow && showConnections && <ConnectionOverlays architecture={architecture} mode={mode} selectedId={selectedConnectionId} showLabels={showLabels} canvas={bounds} flow={flow} dispatch={dispatch} onSelect={id => { setCreatingConnection(false); onSelectionChange([]); setSelectedConnectionId(id); }} onClose={() => { setSelectedConnectionId(''); bounds.current?.focus(); }}/>}
				{mode === 'visual' && !hand && !pen && !creatingConnection && selectedIds.length > 1 && <SelectionResizeHandle architecture={architecture} ids={selectedIds} mode={mode} boxes={resizeBoxes} onScale={(scale, anchor) => dispatch({ type: 'canvas', command: { kind: 'resize', ids: selectedIds, mode, scale, anchor } })} onApplySpacing={(axis, gap) => dispatch({ type: 'canvas', command: { kind: 'move', mode, positions: applyUniformSpacing(architecture, selectedIds, mode, axis, gap, nodeSizes()) } })} onTidy={() => run('align-tidy')}/>}
				{minimap && <MiniMap<CanvasNode> pannable zoomable nodeColor={node => node.type === 'board' && node.data.item.kind === 'frame' ? 'transparent' : '#8e79d9'} />}
				{!creatingConnection && !selectedConnection && selectedIds.some(id=>canvasElements(architecture).some(item=>item.id===id)) && <SelectionAnchor ids={selectedIds.filter(id=>canvasElements(architecture).some(item=>item.id===id))} canvas={bounds}>{mode === 'visual' ? <SelectionControls architecture={architecture} ids={selectedIds} dispatch={dispatch} run={run} hasClipboard={hasClipboard} hasStyleClipboard={hasStyleClipboard} mode={mode} onInspect={onOpen} container={bounds.current}/> : <section className="selection-controls" aria-label="Graph inspection controls">{selectedIds.length === 1 && architecture.resources.some(resource => resource.id === selectedIds[0]) && <button onClick={() => onOpenDetails(selectedIds[0])}>Inspect resource</button>}<button onClick={() => run('fit')}>Focus selection</button><button onClick={() => run('clear')}>Clear selection</button></section>}</SelectionAnchor>}
			</ReactFlow>
			{selectedDependency && dependencyPick && mode === 'visual' && <DependencyTools architecture={architecture} dependency={selectedDependency} at={dependencyPick} dispatch={dispatch} onOpen={id => { setDependencyPick(undefined); onOpen(id); }} onClose={() => { setDependencyPick(undefined); bounds.current?.focus(); }}/>}
			{connectorDrop && <ConnectorDropMenu at={connectorDrop} onClose={() => { setConnectorDrop(undefined); bounds.current?.focus(); }} onKeepLooseEnd={() => {
				const id = crypto.randomUUID(); dispatch({ type: 'connectEndpoints', id, source: elementEndpoint(connectorDrop.source), target: pointEndpoint(connectorDrop.point) });
				setConnectorDrop(undefined); onSelectionChange([]); setSelectedConnectionId(id); setShowConnections(true); bounds.current?.focus();
			}} onPick={choice => {
				const id = crypto.randomUUID(); dispatch({ type: 'addConnectedItem', source: connectorDrop.source, item: droppedItem(choice, id, connectorDrop.point) });
				setConnectorDrop(undefined); onSelectionChange([id]); bounds.current?.focus();
			}}/>}
			{pen && flow && <InkCapture flow={flow} zoom={zoom} ink={ink} onStroke={(position, size, path, ink) => { const id = crypto.randomUUID(); dispatch({ type: 'addItem', item: { id, kind: 'ink', text: '', path, strokeColor: ink.strokeColor, strokeWidth: ink.strokeWidth, positions: { visual: position, technical: position }, width: size.width, height: size.height, members: [] } }); }}/>}
			{creatingConnection ? <ConnectionCreate architecture={architecture} selectedId={connectionSourceId} dispatch={dispatch} onClose={() => { setCreatingConnection(false); bounds.current?.querySelector<HTMLButtonElement>('[aria-label="Connect elements"]')?.focus(); }}/> : null}
			{findOpen && <div className="canvas-find-bar nodrag nopan" role="search" aria-label="Find on canvas">
				<Search size={14} aria-hidden="true" />
				<input ref={findInput} aria-label="Find on canvas" placeholder="Find resource, note, shape or frame…" value={findQuery}
					onChange={event => { const next = event.target.value; setFindQuery(next); setFindIndex(0); }}
					onKeyDown={event => {
						if (event.key === 'Escape') { event.preventDefault(); setFindOpen(false); bounds.current?.focus(); }
						else if (event.key === 'Enter') { event.preventDefault(); if (findMatches.length) { stepFind(event.shiftKey ? -1 : 1); } }
					}} />
				<span className="canvas-find-count" aria-live="polite">{findQuery.trim() ? (findMatches.length ? `${(findIndex % findMatches.length) + 1}/${findMatches.length}` : '0/0') : ''}</span>
				<button type="button" aria-label="Previous match" disabled={!findMatches.length} onClick={() => stepFind(-1)}><ChevronUp size={14} /></button>
				<button type="button" aria-label="Next match" disabled={!findMatches.length} onClick={() => stepFind(1)}><ChevronDown size={14} /></button>
				<button type="button" aria-label="Close find" onClick={() => { setFindOpen(false); bounds.current?.focus(); }}><X size={14} /></button>
			</div>}
			<details className="canvas-options"><summary>View</summary><div className="view-options-content">
				<label>Theme<select aria-label="Canvas theme" value={theme} onChange={event => onThemeChange(event.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
				<label>Grid<select aria-label="Canvas grid" value={grid} onChange={event => setGrid(event.target.value as typeof grid)}><option value="dots">Dots</option><option value="lines">Lines</option><option value="none">None</option></select></label>
				<label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap</label>
				<label title="Snap to aligned edges and centres, or to equal spacing between neighbours, within 6 screen pixels. Grid snapping takes precedence."><input type="checkbox" checked={guides} onChange={event => {setGuides(event.target.checked);setGuideLines([]);}} />Alignment guides</label>
				<label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} />Show connections</label>
				<label><input type="checkbox" checked={allDependencies} onChange={event=>setAllDependencies(event.target.checked)}/>All inherited dependencies</label>
				<label><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} />Show automatic and dependency labels</label>
				<button aria-pressed={minimap} onClick={() => setMinimap(value => !value)}>Minimap</button>
				<details className="canvas-shortcuts"><summary>Keyboard shortcuts</summary><p>Ctrl / Cmd + F: find on canvas<br/>Shift + 1 / 2 / 0: fit all / selection / 100%; + / -: zoom<br/>Ctrl / Cmd + V (text lines): paste as sticky-note cluster<br/>Ctrl / Cmd + click: extend selection<br/>Shift + drag: select an area; Alt + drag: clone<br/>Ctrl / Cmd + D: duplicate (repeats last move)<br/>Ctrl / Cmd + Arrows: spawn connected shape / note<br/>Ctrl / Cmd + Alt + C / V: copy / paste style<br/>Ctrl / Cmd + Alt + F: wrap selection in frame<br/>Tab / Shift + Tab on sticky note: spawn adjacent note<br/>PageUp / PageDown: step between frames<br/>Arrows: move 1 px; Shift + arrows: 10 px<br/>Enter: edit; Escape: clear selection<br/>V: select; H: pan; P: pen; T: text; N: note; R/O/D: shapes; L: connect<br/>[ and ]: rotate drawings 15° (Shift: 1°)<br/>F: focus selection; Space + drag: pan<br/>Alt + F10: move to the selection toolbar; Escape: back to the canvas<br/>Copy, duplicate, group and layer actions are in the selection menu.</p></details>
			</div></details>
			{dropFeedback&&<div className={'container-drop-status '+(dropFeedback.ok?'valid':'invalid')} role="status">{dropFeedback.reason}</div>}
			<div className="canvas-navigation" role="group" aria-label="Zoom and navigation">
				{frames.length > 0 && <details className="canvas-frames-nav">
					<summary aria-label={'Frames navigator (' + frames.length + ')'} title="Jump between frames (PageUp / PageDown)"><Frame size={14} aria-hidden="true" /><span>{frames.length}</span></summary>
					<div className="canvas-frames-panel" role="region" aria-label="Frames list">
						<header>
							<strong>Frames ({frames.length})</strong>
							<div className="canvas-frames-step">
								<button type="button" aria-label="Previous frame" title="Previous frame (PageUp)" onClick={() => stepFrame(-1)}><ChevronLeft size={14} /></button>
								<button type="button" aria-label="Next frame" title="Next frame (PageDown)" onClick={() => stepFrame(1)}><ChevronRight size={14} /></button>
							</div>
						</header>
						<ul>
							{frames.map((frame, index) => <li key={frame.id}>
								<button type="button" aria-current={selectedIds.includes(frame.id) ? 'true' : undefined} onClick={() => jumpToFrame(frame, index)}>
									<span className="canvas-frame-name">{frame.text.trim() || 'Frame ' + (index + 1)}</span>
									<small>{frame.members.length > 0 ? frame.members.length + ' item' + (frame.members.length === 1 ? '' : 's') : 'frame'}</small>
									{frame.canvasLocked && <Lock size={11} aria-label="Locked" />}
								</button>
							</li>)}
						</ul>
						{mode === 'visual' && <button type="button" className="canvas-frames-add" onClick={() => createItem('frame')}><Plus size={13} />New frame</button>}
					</div>
				</details>}
				<button aria-label="Zoom out" title="Zoom out" onClick={() => { autoFit.current = { at: 0 }; void flow?.zoomOut(); }}><Minus /></button>
				<select aria-label="Canvas zoom" value={zoom.toFixed(3)} onChange={event => { autoFit.current = { at: 0 }; void flow?.zoomTo(Number(event.target.value)); }}>
					{!zoomPresets.some(value => value.toFixed(3) === zoom.toFixed(3)) && <option value={zoom.toFixed(3)}>{Math.round(zoom * 100)}%</option>}
					{zoomPresets.map(value => <option key={value} value={value.toFixed(3)}>{Math.round(value * 100)}%</option>)}
				</select>
				<button aria-label="Zoom in" title="Zoom in" onClick={() => { autoFit.current = { at: 0 }; void flow?.zoomIn(); }}><Plus /></button>
				<button aria-label="Fit architecture to view" title="Fit architecture to view" onClick={() => { autoFit.current = { at: 0 }; fitConnectionsAndNodes(); }}><Scan /></button>
			</div>
		</main>
		</CanvasActionMenu>
	);
});
