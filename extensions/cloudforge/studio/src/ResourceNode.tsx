/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { resourceGraphic } from './resourceGraphic.ts';
import { shapeDefinition, shapeStrokeDash } from './shapes.ts';
import { inkDefaults } from './ink.ts';
import { DrawingText } from './DrawingText.tsx';
import { memo, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { dragRotation, drawingResizeVisible } from './rotation.ts';
import { LockKeyhole, TriangleAlert, Variable } from 'lucide-react';
import { Handle, Position, NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { DesignMode, Resource, BoardItem, Action, Architecture } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import { isResourceContainer } from './resourceHierarchy.ts';
import type { Dispatch } from 'react';
import { resourceDefinition } from './fixture.ts';
import { catalogueIconsVersion, loadCatalogue, subscribeCatalogueIcons } from './catalogue.ts';
import { iconSizeLimits } from './resourceGeometry.ts';
import type { VariableDefinition } from './variables.ts';
import { isSensitiveProperty } from './variables.ts';
import { fieldDefinition, fieldExpression } from './fieldBindings.ts';
import type { InfrastructureRelationship } from './infrastructureRelationships.ts';
import { resourceIntelligence } from './providerKnowledge.ts';

export type ResourceNodeType = Node<{ resource: Resource; architecture:Architecture; mode: DesignMode; dispatch: Dispatch<Action>; dependencies: string[]; relationships: InfrastructureRelationship[]; autoSpacing: boolean; onConnections:(id:string)=>void; findings: Diagnostic[]; childCount:number; onReview:(id:string)=>void; origin: { x:number; y:number }; variables?: VariableDefinition[] }, 'resource'>;
export type BoardNodeType = Node<{ item: BoardItem; mode: DesignMode; dispatch: Dispatch<Action>; editToken?: number }, 'board'>;
export type CanvasNode = ResourceNodeType | BoardNodeType;

export const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<ResourceNodeType>) {
	// Re-render when a provider catalogue loads, so a projected type swaps its neutral icon for the palette one.
	useSyncExternalStore(subscribeCatalogueIcons, catalogueIconsVersion);
	const needsCatalogueIcon = data.resource.catalogue?.iconMatch === 'fallback';
	useEffect(() => {
		if (needsCatalogueIcon) {
			loadCatalogue(data.resource.provider).catch(() => undefined);
		}
	}, [needsCatalogueIcon, data.resource.provider]);
	const metadata = resourceDefinition(data.resource);
	const graphic = resourceGraphic(data.resource);
	const technical = data.mode === 'technical';
	const boundName = fieldExpression(data.resource,{kind:'name'},data.variables,data.architecture);
	const boundRegion = fieldExpression(data.resource,{kind:'region'},data.variables,data.architecture);
	const incomingCount = new Set(data.relationships.filter(link => link.target === data.resource.id).map(link => link.source)).size;
	const outgoingCount = new Set(data.relationships.filter(link => link.source === data.resource.id).map(link => link.target)).size;
	const knowledge = resourceIntelligence(metadata.type);
	const issueButton = data.findings.length ? <button className="node-form-review nodrag nopan" aria-label={'Review '+data.findings.length+' local issues for '+data.resource.name} title={data.findings.slice(0,4).map(item=>item.message).join('\n')} onClick={event=>{event.stopPropagation();data.onReview(data.resource.id);}}><TriangleAlert size={12}/><span>{data.findings.length}</span></button> : null;
	if(isResourceContainer(data.resource)){
		return <div className={'resource-container '+data.mode+(selected?' is-selected':'')}>
			<NodeResizer isVisible={!technical&&selected&&!data.resource.canvasLocked} minWidth={280} minHeight={180} maxWidth={10000} maxHeight={10000} onResizeEnd={(_,size)=>data.dispatch({type:'resizeContainer',id:data.resource.id,position:{x:size.x+data.origin.x,y:size.y+data.origin.y},width:size.width,height:size.height})}/>
			<Ports label="Infrastructure"/>
			<header className="resource-container-heading"><img src={'./assets/'+graphic.icon} alt=""/><strong>{data.resource.label||data.resource.name}</strong><span>{metadata.label}</span>{data.resource.canvasLocked&&<LockKeyhole size={12}/>}<small>{data.childCount} inside</small>{issueButton}</header>
			{technical&&<div className="container-properties"><code title={metadata.type}>{metadata.type}</code>{Object.entries(data.resource.settings).slice(0,1).map(([name,value])=><span className="container-inline-field" key={name}><span>{name}</span><code>{isSensitiveProperty(name,fieldDefinition(data.resource,{kind:'setting',name})?.sensitive)?'Sensitive value':fieldExpression(data.resource,{kind:'setting',name},data.variables,data.architecture)??value}</code></span>)}{boundRegion?<span title={boundRegion}><Variable size={11}/>{boundRegion}</span>:<span title={data.resource.region}>{data.resource.region}</span>}</div>}
			{!data.childCount&&<div className="container-empty">Drop compatible resources here<span>Configure inheritance and attachments in Parameters</span></div>}
		</div>;
	}
	return (
		<div className={'resource-node ' + data.mode + (selected ? ' is-selected' : '')}>
			<NodeResizer isVisible={!technical && selected && !data.resource.canvasLocked} keepAspectRatio minWidth={iconSizeLimits.min} minHeight={iconSizeLimits.min} maxWidth={iconSizeLimits.max} maxHeight={iconSizeLimits.max}
				onResizeEnd={(_, size) => data.dispatch({type:'resizeResource',id:data.resource.id,iconSize:Math.round(size.width),position:{x:size.x+data.origin.x,y:size.y+data.origin.y}})}/>
			<Ports label="Design link"/>
			<div className="resource-node-heading">
				{data.resource.canvasLocked && <LockKeyhole size={12} aria-label="Canvas locked"/>}
				<img src={'./assets/' + graphic.icon} alt="" />
				{issueButton}
				{technical && <span title={metadata.label}>{metadata.label}</span>}
			</div>
			<strong className={technical ? 'graph-resource-name' : undefined} title={boundName??data.resource.name}>{technical&&boundName ? boundName : data.resource.label || data.resource.name || 'Unnamed resource'}</strong>
			<span className="resource-node-caption" title={technical ? metadata.type : metadata.label}>{technical ? metadata.type : metadata.label}</span>
			{technical && (
				<div className="node-settings">
					<div><span>Region</span><b title={boundRegion??data.resource.region} className={boundRegion?'node-variable':undefined}>{boundRegion??data.resource.region}</b></div>
					{Object.entries(data.resource.settings).slice(0, 2).map(([name, value]) => {
						const text = isSensitiveProperty(name,fieldDefinition(data.resource,{kind:'setting',name})?.sensitive) ? 'Sensitive value' : fieldExpression(data.resource,{kind:'setting',name},data.variables,data.architecture) ?? value;
						return <div className="node-summary-field" key={name}><span>{name}</span><code title={text}>{text}</code></div>;
					})}
					<div className="technical-node-footer"><button className="nodrag nopan node-relationships" aria-label={'Inspect relationships for ' + data.resource.name} onClick={event => { event.stopPropagation(); data.onConnections(data.resource.id); }}><span>{incomingCount} inputs</span><span>{outgoingCount} dependents</span></button><button className={'nodrag nopan '+(data.findings.length?'node-warning':'node-check')} onClick={()=>data.onReview(data.resource.id)}>{data.findings.length?data.findings.length+' local issues · Review':'Local checks clear'}</button><span className="technical-layer" title={knowledge.reviewStatus === 'documented' ? 'Documented infrastructure role; configuration is a draft, not observed cloud state.' : 'Provider semantics have not been reviewed for this type.'}>{knowledge.layer === 'unknown' ? 'Unreviewed type' : knowledge.layer}</span></div></div>
			)}
		</div>
	);
});

/** Four connection points per element, as in Miro. In loose connection mode any point can start or end a line. */
function Ports({ label, className }: { label: string; className?: string }) {
	return <>{([['input', Position.Left], ['output', Position.Right], ['top', Position.Top], ['bottom', Position.Bottom]] as const).map(([id, position]) =>
		<Handle key={id} className={className} type="source" position={position} id={id} aria-label={label + ' ' + id}/>)}</>;
}

export const BoardNode = memo(function BoardNode({ data, selected }: NodeProps<BoardNodeType>) {
	const { item, dispatch } = data;
	const [turning, setTurning] = useState<number>();
	const rotation = turning ?? item.rotation ?? 0;
	return (<>
		<NodeResizer isVisible={data.mode === 'visual' && drawingResizeVisible(item, selected, rotation)} minWidth={item.kind === 'ink' ? 16 : 140} minHeight={item.kind === 'ink' ? 16 : 80}
				onResizeEnd={(_, size) => dispatch({ type: 'resizeItem', id: item.id, mode: data.mode, position: { x: size.x, y: size.y }, width: size.width, height: size.height })} />
		<div className={'board-item ' + item.kind + (selected ? ' is-selected' : '')}
   style={{ rotate: rotation ? rotation + 'deg' : undefined, background: item.kind === 'shape' || item.kind === 'ink' ? undefined : item.fill, opacity: item.opacity ?? 1, ...(item.kind !== 'shape' && item.kind !== 'text' && item.kind !== 'ink' ? { borderColor: item.strokeColor, borderWidth: item.strokeWidth, borderStyle: item.strokeStyle } : {}) }}>
   {item.kind !== 'frame' && <Ports label="Drawing connection" className="drawing-port"/>}
			{item.kind === 'shape' && <svg className="board-shape-geometry" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={shapeDefinition(item.shape).path} fill={item.fill ?? '#eef2ff'} stroke={item.strokeColor ?? '#7565bd'} strokeWidth={item.strokeWidth ?? 1.5} strokeDasharray={shapeStrokeDash(item.strokeStyle, item.strokeWidth)} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
{item.kind === 'ink' && <svg className="board-ink-geometry" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={item.path} fill="none" stroke={item.strokeColor ?? inkDefaults.strokeColor} strokeWidth={item.strokeWidth ?? inkDefaults.strokeWidth} strokeDasharray={shapeStrokeDash(item.strokeStyle, item.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>}
{item.kind !== 'ink' && (data.mode === 'technical' ? <span className="drawing-text-readonly">{item.text}</span> : <DrawingText item={item} dispatch={dispatch} editToken={data.editToken}/>)}{item.canvasLocked && <span className="drawing-lock"><LockKeyhole size={12}/></span>}
   {data.mode === 'visual' && selected && !item.canvasLocked && item.kind !== 'frame' && <RotateHandle angle={rotation} onTurn={setTurning} onCommit={angle => { setTurning(undefined); dispatch({ type: 'canvas', command: { kind: 'rotate', ids: [item.id], angle } }); }}/>}
		</div>
	</>);
});

/** Turn handle above a drawing: drag to rotate about the centre, Shift snaps to 15°, right angles are sticky. */
function RotateHandle({ angle, onTurn, onCommit }: { angle: number; onTurn: (angle: number) => void; onCommit: (angle: number) => void }) {
	const drag = useRef<{ centre: { x: number; y: number }; from: { x: number; y: number }; start: number }>(undefined); const last = useRef(angle);
	const turn = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const state = drag.current; if (!state) { return; }
		last.current = dragRotation(state.start, state.centre, state.from, { x: event.clientX, y: event.clientY }, event.shiftKey); onTurn(last.current);
	};
	return <button type="button" className="rotate-handle nodrag nopan" aria-label={'Rotate drawing, ' + Math.round(angle) + ' degrees'} title="Drag to rotate · Shift snaps to 15° · [ and ] turn by 15°"
		onPointerDown={event => {
			event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
			const box = event.currentTarget.parentElement!.getBoundingClientRect();
			drag.current = { centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, from: { x: event.clientX, y: event.clientY }, start: angle }; last.current = angle;
		}}
		onPointerMove={turn}
		onPointerUp={() => { if (drag.current) { drag.current = undefined; onCommit(last.current); } }}
		onPointerCancel={() => { const state = drag.current; drag.current = undefined; if (state) { onCommit(state.start); } }}>
		{drag.current && <span className="rotate-readout" style={{ rotate: -angle + "deg" }}>{Math.round(angle)}°</span>}
	</button>;
}
