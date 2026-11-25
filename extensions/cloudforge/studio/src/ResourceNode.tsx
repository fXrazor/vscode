/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { shapeDefinition, shapeStrokeDash } from './shapes.ts';
import { DrawingText } from './DrawingText.tsx';
import { memo } from 'react';
import { LockKeyhole, TriangleAlert, Variable } from 'lucide-react';
import { Handle, Position, NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { DesignMode, Resource, BoardItem, Action, Architecture } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import { isResourceContainer } from './resourceHierarchy.ts';
import type { Dispatch } from 'react';
import { resourceDefinition } from './fixture.ts';
import { iconSizeLimits } from './resourceGeometry.ts';
import type { VariableDefinition } from './variables.ts';
import { isSensitiveProperty } from './variables.ts';
import { fieldDefinition, fieldExpression } from './fieldBindings.ts';

export type ResourceNodeType = Node<{ resource: Resource; architecture:Architecture; mode: DesignMode; dispatch: Dispatch<Action>; dependencies: string[]; findings: Diagnostic[]; childCount:number; onReview:(id:string)=>void; origin: { x:number; y:number }; variables?: VariableDefinition[] }, 'resource'>;
export type BoardNodeType = Node<{ item: BoardItem; mode: DesignMode; dispatch: Dispatch<Action>; editToken?: number }, 'board'>;
export type CanvasNode = ResourceNodeType | BoardNodeType;

export const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<ResourceNodeType>) {
	const metadata = resourceDefinition(data.resource);
	const graphic = data.resource.iconKind ? resourceDefinition({ kind: data.resource.iconKind, provider: data.resource.provider }) : metadata;
	const technical = data.mode === 'technical';
	const boundName = fieldExpression(data.resource,{kind:'name'},data.variables,data.architecture);
	const boundRegion = fieldExpression(data.resource,{kind:'region'},data.variables,data.architecture);
	const issueButton = data.findings.length ? <button className="node-form-review nodrag nopan" aria-label={'Review '+data.findings.length+' local issues for '+data.resource.name} title={data.findings.slice(0,4).map(item=>item.message).join('\n')} onClick={event=>{event.stopPropagation();data.onReview(data.resource.id);}}><TriangleAlert size={12}/><span>{data.findings.length}</span></button> : null;
	if(isResourceContainer(data.resource)){
		return <div className={'resource-container '+data.mode+(selected?' is-selected':'')}>
			<NodeResizer isVisible={selected&&!data.resource.canvasLocked} minWidth={280} minHeight={180} maxWidth={10000} maxHeight={10000} onResizeEnd={(_,size)=>data.dispatch({type:'resizeContainer',id:data.resource.id,position:{x:size.x+data.origin.x,y:size.y+data.origin.y},width:size.width,height:size.height})}/>
			<Handle type="target" position={Position.Left} id="input" aria-label="Infrastructure input"/>
			<header className="resource-container-heading"><img src={'./assets/'+graphic.icon} alt=""/><strong>{data.resource.label||data.resource.name}</strong><span>{metadata.label}</span>{data.resource.canvasLocked&&<LockKeyhole size={12}/>}<small>{data.childCount} inside</small>{issueButton}</header>
			{technical&&<div className="container-properties"><code title={metadata.type}>{metadata.type}</code>{Object.entries(data.resource.settings).slice(0,1).map(([name,value])=>{const expression=fieldExpression(data.resource,{kind:'setting',name},data.variables,data.architecture);return <label className="container-inline-field nodrag nopan" key={name}><span>{name}</span>{expression?<span className="node-variable" title={expression}>{expression}</span>:<input disabled={data.resource.canvasLocked} aria-label={name+' on '+data.resource.name} value={value} onChange={event=>data.dispatch({type:'update',id:data.resource.id,patch:{settings:{...data.resource.settings,[name]:event.target.value}}})}/>}</label>;})}{boundRegion?<span title={boundRegion}><Variable size={11}/>{boundRegion}</span>:<span title={data.resource.region}>{data.resource.region}</span>}</div>}
			{!data.childCount&&<div className="container-empty">Drop compatible resources here<span>Inheritance follows the container hierarchy</span></div>}
			<Handle type="source" position={Position.Right} id="output" aria-label="Infrastructure output"/>
		</div>;
	}
	return (
		<div className={'resource-node ' + data.mode + (selected ? ' is-selected' : '')}>
			<NodeResizer isVisible={!technical && selected && !data.resource.canvasLocked} keepAspectRatio minWidth={iconSizeLimits.min} minHeight={iconSizeLimits.min} maxWidth={iconSizeLimits.max} maxHeight={iconSizeLimits.max}
				onResizeEnd={(_, size) => data.dispatch({type:'resizeResource',id:data.resource.id,iconSize:Math.round(size.width),position:{x:size.x+data.origin.x,y:size.y+data.origin.y}})}/>
			<Handle type="target" position={Position.Left} id="input" aria-label="Design link input" />
			<div className="resource-node-heading">
				{data.resource.canvasLocked && <LockKeyhole size={12} aria-label="Canvas locked"/>}
				<img src={'./assets/' + graphic.icon} alt="" />
				{issueButton}
				{technical && <span>{metadata.label}</span>}
			</div>
			{technical ? boundName ? <span className="node-variable"><Variable size={12}/>{boundName}</span> : <input disabled={data.resource.canvasLocked} className="nodrag nopan node-name" aria-label="Resource name on node" value={data.resource.name} onChange={event => data.dispatch({ type: 'update', id: data.resource.id, patch: { name: event.target.value } })} /> : <strong>{data.resource.label || data.resource.name || 'Unnamed resource'}</strong>}
			<span className="resource-node-caption">{technical ? metadata.type : metadata.label}</span>
			{technical && (
				<div className="node-settings">
					<div><span>Region</span><b className={boundRegion?'node-variable':undefined}>{boundRegion??data.resource.region}</b></div>
					{Object.entries(data.resource.settings).slice(0, 2).map(([name, value]) => (
						<label key={name}><span>{name}</span>{fieldExpression(data.resource,{kind:'setting',name},data.variables,data.architecture) ? <span className="node-variable">{fieldExpression(data.resource,{kind:'setting',name},data.variables,data.architecture)}</span> : <input disabled={data.resource.canvasLocked} type={isSensitiveProperty(name,fieldDefinition(data.resource,{kind:'setting',name})?.sensitive)?'password':'text'} className="nodrag nopan" aria-label={name + ' on ' + data.resource.name} value={value} onChange={event => data.dispatch({ type: 'update', id: data.resource.id, patch: { settings: { ...data.resource.settings, [name]: event.target.value } } })} />}</label>
					))}
				<details className="nodrag nopan"><summary>{data.dependencies.length} inherited dependencies</summary>{data.dependencies.length ? data.dependencies.map(name => <p key={name}>{name}</p>) : <p>No inherited dependencies</p>}</details><button className={'nodrag nopan '+(data.findings.length?'node-warning':'node-check')} onClick={()=>data.onReview(data.resource.id)}>{data.findings.length?data.findings.length+' local issues · Review':'Local checks clear'}</button><span className="node-cost" title="Pricing service is not connected">Cost · Not estimated</span></div>
			)}
			<Handle type="source" position={Position.Right} id="output" aria-label="Design link output" />
		</div>
	);
});

export const BoardNode = memo(function BoardNode({ data, selected }: NodeProps<BoardNodeType>) {
	const { item, dispatch } = data;
	return (
		<div className={'board-item ' + item.kind + (selected ? ' is-selected' : '')}
   style={{ background: item.kind === 'shape' ? undefined : item.fill, opacity: item.opacity ?? 1, ...(item.kind !== 'shape' && item.kind !== 'text' ? { borderColor: item.strokeColor, borderWidth: item.strokeWidth, borderStyle: item.strokeStyle } : {}) }}>
   {item.kind !== 'frame' && <Handle className="drawing-port" type="target" position={Position.Left} id="input" aria-label="Drawing connection input"/>}
			<NodeResizer isVisible={selected && !item.canvasLocked} minWidth={140} minHeight={80}
				onResizeEnd={(_, size) => dispatch({ type: 'resizeItem', id: item.id, mode: data.mode, position: { x: size.x, y: size.y }, width: size.width, height: size.height })} />
			{item.kind === 'shape' && <svg className="board-shape-geometry" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={shapeDefinition(item.shape).path} fill={item.fill ?? '#eef2ff'} stroke={item.strokeColor ?? '#7565bd'} strokeWidth={item.strokeWidth ?? 1.5} strokeDasharray={shapeStrokeDash(item.strokeStyle, item.strokeWidth)} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
<DrawingText item={item} dispatch={dispatch} editToken={data.editToken}/>{item.canvasLocked && <span className="drawing-lock"><LockKeyhole size={12}/></span>}
   {item.kind !== 'frame' && <Handle className="drawing-port" type="source" position={Position.Right} id="output" aria-label="Drawing connection output"/>}
		</div>
	);
});
