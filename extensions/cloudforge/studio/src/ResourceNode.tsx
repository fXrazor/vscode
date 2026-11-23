/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { shapeDefinitions, shapeDefinition, shapeTextColor, shapeStrokeDash } from './shapes.ts';
import { CanvasEditbar } from './CanvasEditbar.tsx';
import { ShapeAppearance } from './ShapeAppearance.tsx';
import { memo } from 'react';
import { Bold, Copy, Trash2 } from 'lucide-react';
import { Handle, Position, NodeResizer, NodeToolbar, type Node, type NodeProps } from '@xyflow/react';
import type { DesignMode, Resource, BoardItem, Action } from './model.ts';
import type { Dispatch } from 'react';
import { resourceDefinition } from './fixture.ts';

export type ResourceNodeType = Node<{ resource: Resource; mode: DesignMode; dispatch: Dispatch<Action>; dependencies: string[]; findings: string[] }, 'resource'>;
export type BoardNodeType = Node<{ item: BoardItem; mode: DesignMode; dispatch: Dispatch<Action> }, 'board'>;
export type CanvasNode = ResourceNodeType | BoardNodeType;

export const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<ResourceNodeType>) {
	const metadata = resourceDefinition(data.resource);
	const graphic = data.resource.iconKind ? resourceDefinition({ kind: data.resource.iconKind, provider: data.resource.provider }) : metadata;
	const technical = data.mode === 'technical';
	return (
		<div className={'resource-node ' + data.mode + (selected ? ' is-selected' : '')}>
			<Handle type="target" position={Position.Left} id="input" aria-label="Design link input" />
			<div className="resource-node-heading">
				<img src={'./assets/' + graphic.icon} alt="" />
				{technical && <span>{metadata.label}</span>}
			</div>
			{technical ? <input className="nodrag nopan node-name" aria-label="Resource name on node" value={data.resource.name} onChange={event => data.dispatch({ type: 'update', id: data.resource.id, patch: { name: event.target.value } })} /> : <strong>{data.resource.label || data.resource.name || 'Unnamed resource'}</strong>}
			<span className="resource-node-caption">{technical ? metadata.type : metadata.label}</span>
			{technical && (
				<div className="node-settings">
					<div><span>Region</span><b>{data.resource.region}</b></div>
					{Object.entries(data.resource.settings).slice(0, 2).map(([name, value]) => (
						<label key={name}><span>{name}</span><input className="nodrag nopan" aria-label={name + ' on ' + data.resource.name} value={value} onChange={event => data.dispatch({ type: 'update', id: data.resource.id, patch: { settings: { ...data.resource.settings, [name]: event.target.value } } })} /></label>
					))}
				<details className="nodrag nopan"><summary>{data.dependencies.length} incoming dependencies</summary>{data.dependencies.length ? data.dependencies.map(name => <p key={name}>{name}</p>) : <p>No incoming design links</p>}</details><span className={data.findings.length ? "node-warning" : "node-check"}>{data.findings.length ? data.findings.join(" · ") : "Name check passed"}</span><span className="node-cost" title="Pricing service is not connected">Cost · Not estimated</span></div>
			)}
			<Handle type="source" position={Position.Right} id="output" aria-label="Design link output" />
		</div>
	);
});

export const BoardNode = memo(function BoardNode({ data, selected }: NodeProps<BoardNodeType>) {
	const { item, dispatch } = data;
	return (
		<div className={'board-item ' + item.kind + (selected ? ' is-selected' : '')}
   style={{ background: item.kind === 'shape' ? undefined : item.fill, fontSize: item.fontSize, fontWeight: item.bold ? 700 : undefined }}>
   <NodeToolbar isVisible={selected} position={Position.Top} offset={18}>
    <CanvasEditbar item={item} mode={data.mode}>
     {item.kind === 'shape' && <select aria-label="Shape type" value={item.shape ?? 'rectangle'} onChange={event => dispatch({ type: 'updateItem', id: item.id, patch: { shape: event.target.value as typeof item.shape } })}>{shapeDefinitions.map(shape => <option key={shape.id} value={shape.id}>{shape.label}</option>)}</select>}
     <input aria-label="Element text" value={item.text} onChange={event => dispatch({ type: 'updateItem', id: item.id, patch: { text: event.target.value } })} />
     <select aria-label="Element font size" value={item.fontSize ?? 14} onChange={event => dispatch({ type: 'updateItem', id: item.id, patch: { fontSize: Number(event.target.value) } })}>{[12,14,18,24,32].map(size => <option key={size}>{size}</option>)}</select>
     <button aria-label="Bold element text" aria-pressed={!!item.bold} onClick={() => dispatch({ type: 'updateItem', id: item.id, patch: { bold: !item.bold } })}><Bold /></button>
     <input type="color" aria-label="Element fill colour" value={item.fill ?? (item.kind === 'note' ? '#fff0b5' : item.kind === 'shape' ? '#eef2ff' : '#ffffff')} onChange={event => dispatch({ type: 'updateItem', id: item.id, patch: { fill: event.target.value } })} />
     {item.kind === 'shape' && <ShapeAppearance item={item} dispatch={dispatch} />}
     <button aria-label="Duplicate element" onClick={() => dispatch({ type: 'addItem', item: { ...item, id: crypto.randomUUID(), members: [], positions: { visual: { x: item.positions.visual.x + 30, y: item.positions.visual.y + 30 }, technical: { x: item.positions.technical.x + 30, y: item.positions.technical.y + 30 } } } })}><Copy /></button>
     <button aria-label="Delete element" onClick={() => dispatch({ type: 'deleteItem', id: item.id })}><Trash2 /></button>
    </CanvasEditbar>
   </NodeToolbar>
			<NodeResizer isVisible={selected} minWidth={140} minHeight={80}
				onResizeEnd={(_, size) => dispatch({ type: 'resizeItem', id: item.id, mode: data.mode, position: { x: size.x, y: size.y }, width: size.width / (item.kind === 'frame' && data.mode === 'technical' ? 1.7 : 1), height: size.height / (item.kind === 'frame' && data.mode === 'technical' ? 1.3 : 1) })} />
			{item.kind === 'shape' && <svg className="board-shape-geometry" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={shapeDefinition(item.shape).path} fill={item.fill ?? '#eef2ff'} stroke={item.strokeColor ?? '#7565bd'} strokeWidth={item.strokeWidth ?? 1.5} strokeDasharray={shapeStrokeDash(item.strokeStyle, item.strokeWidth)} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
			{item.kind === 'frame' ? <span className="frame-label">{item.text}</span> : <span className={item.kind === 'shape' ? 'board-shape-label' : undefined} style={item.kind === 'shape' ? { color: shapeTextColor(item.fill ?? '#eef2ff') } : undefined}>{item.text}</span>}
		</div>
	);
});
