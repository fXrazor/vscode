/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, DesignMode, Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { getDef } from './cloudlab-core/catalog/index.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { bindingTarget, fieldTargetPath } from './fieldBindings.ts';

export const isResourceContainer = (resource: Resource) => !!getDef(resourceDefinition(resource).type)?.container;
export const terraformIdentifier = (resource: Resource) => resource.terraformName ?? resource.name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
export const resourceAddress = (resource: Resource) => resourceDefinition(resource).type + '.' + terraformIdentifier(resource);

export function resourceAncestors(architecture: Architecture, resource: Resource): Resource[] {
	const byId = new Map(architecture.resources.map(item=>[item.id,item])); const result: Resource[] = []; const seen = new Set([resource.id]);
	let parent = resource.parentId;
	while (parent && !seen.has(parent)) { seen.add(parent); const item = byId.get(parent); if (!item) { break; } result.push(item); parent = item.parentId; }
	return result;
}
export function resourceDescendants(architecture: Architecture, id: string): Resource[] {
	return architecture.resources.filter(resource=>resourceAncestors(architecture,resource).some(parent=>parent.id===id));
}
export const visualParentId = (resource: Resource) => resource.visualParentId === undefined ? resource.parentId : resource.visualParentId ?? undefined;
export function visualAncestors(architecture: Architecture, resource: Resource): Resource[] {
	const byId = new Map(architecture.resources.map(item => [item.id, item])); const result: Resource[] = []; const seen = new Set([resource.id]);
	let parent = visualParentId(resource);
	while (parent && !seen.has(parent)) { seen.add(parent); const item = byId.get(parent); if (!item || !isResourceContainer(item) || item.provider !== resource.provider) { break; } result.push(item); parent = visualParentId(item); }
	return result;
}
export function visualDescendants(architecture: Architecture, id: string): Resource[] {
	return architecture.resources.filter(resource => visualAncestors(architecture, resource).some(parent => parent.id === id));
}
/** Container deletion includes both owned resources and visual contents, including locked checks. */
export function containedDescendants(architecture: Architecture, id: string): Resource[] {
	const ids = new Set([id]); let size = 0;
	while (size !== ids.size) { size = ids.size; for (const resource of architecture.resources) { if (resource.parentId && ids.has(resource.parentId) || visualParentId(resource) && ids.has(visualParentId(resource)!)) { ids.add(resource.id); } } }
	return architecture.resources.filter(resource => resource.id !== id && ids.has(resource.id));
}
/** Diagram ownership is independent of the nearest provider-compatible inheritance container. */
export function visualResourcePlacement(architecture: Architecture, child: Resource, parentId?: string): Placement {
	if (!parentId) { return { ok: true, reason: 'Move to the canvas · clear container inheritance' }; }
	const parent = architecture.resources.find(item => item.id === parentId);
	if (!parent || !isResourceContainer(parent) || child.provider !== parent.provider) { return { ok: false, reason: 'Choose a container from the same cloud provider.' }; }
	if (parent.id === child.id || [...visualAncestors(architecture, parent), ...resourceAncestors(architecture, parent)].some(item => item.id === child.id)) { return { ok: false, reason: 'A container cannot be placed inside itself or its descendants.' }; }
	const semantic = resourcePlacement(architecture, child, parentId);
	const inheritedParent = semantic.ok ? semantic.parentId : child.parentId;
	return { ok: true, parentId: inheritedParent, reason: 'Place visually inside ' + (parent.label || parent.name) + (inheritedParent !== parentId ? ' · Terraform inheritance ' + (inheritedParent ? 'from ' + (architecture.resources.find(item => item.id === inheritedParent)?.name ?? inheritedParent) : 'unchanged') : '') };
}
export type Placement = { ok: boolean; parentId?: string; reason: string };
export function resourcePlacement(architecture: Architecture, child: Resource, parentId?: string): Placement {
	if (!parentId) { return {ok:true,reason:'Move to the canvas'}; }
	const parent = architecture.resources.find(item=>item.id===parentId);
	if (!parent || !isResourceContainer(parent)) { return {ok:false,reason:'Choose an infrastructure container.'}; }
	if (parent.id===child.id || resourceAncestors(architecture,parent).some(item=>item.id===child.id)) { return {ok:false,reason:'A resource cannot be nested inside itself or its descendants.'}; }
	if (child.provider!==parent.provider) { return {ok:false,reason:'Resources from different cloud providers cannot share an infrastructure container.'}; }
	const definition = getDef(resourceDefinition(child).type);
	const candidates = [parent,...resourceAncestors(architecture,parent)];
	const accepted = candidates.find(candidate=>candidate.provider===child.provider && (child.kind==='module' || definition?.parents.includes(resourceDefinition(candidate).type) || !definition && resourceDefinition(candidate).type==='azurerm_resource_group'));
	if (accepted) { return {ok:true,parentId:accepted.id,reason:'Place inside '+(accepted.label||accepted.name)+(accepted.id!==parent.id?' (nearest compatible ancestor)':'')}; }
	return {ok:false,reason:definition ? resourceDefinition(child).label+' cannot be placed inside '+resourceDefinition(parent).label+'.'+(definition.parents.length?' Choose '+definition.parents.map(type=>getDef(type)?.displayName??type).join(' or ')+'.':' This resource belongs at the top level.') : 'No nesting rule is available for this resource. Use a visual frame instead.'};
}

export type InheritedReference = { path: string[]; source: Resource; attribute: string; expression: string };
export function inheritedReferences(architecture: Architecture, resource: Resource): InheritedReference[] {
	const ancestors = resourceAncestors(architecture,resource).filter(item=>item.provider===resource.provider);
	return (getDef(resourceDefinition(resource).type)?.inherit??[]).flatMap(rule=>{
		if (resource.inheritanceOverrides?.includes(rule.attr)) { return []; }
		const path=rule.attr.split('.');
		const materialized=(blocks:Resource['blocks'],parts:string[]):boolean=>parts.length===0||blocks.some(block=>block.type===parts[0]&&materialized(block.blocks,parts.slice(1)));
		if(path.length>1&&!Object.hasOwn(resource.settings,rule.attr)&&!materialized(resource.blocks,path.slice(0,-1))){return [];}
		const source = ancestors.find(item=>resourceDefinition(item).type===rule.fromType);
		return source ? [{path,source,attribute:rule.fromAttr,expression:resourceAddress(source)+'.'+rule.fromAttr}] : [];
	});
}
export function inheritedReference(architecture: Architecture, resource: Resource, path: string[]): InheritedReference | undefined {
	return inheritedReferences(architecture,resource).find(reference=>reference.path.join('.')===path.filter(part=>!/^\d+$/.test(part)).join('.'));
}
export function explicitResourceReferences(architecture: Architecture, resource: Resource): InheritedReference[] {
	const out: InheritedReference[] = [];
	for (const [key, binding] of Object.entries(resource.resourceRefs ?? {})) {
		const target = bindingTarget(key);
		if (!target) { continue; }
		const path = fieldTargetPath(resource, target);
		for (const entry of binding.refs) {
			const source = architecture.resources.find(item => item.id === entry.resourceId);
			if (source) {
				out.push({ path, source, attribute: entry.attribute, expression: resourceAddress(source) + '.' + entry.attribute });
			}
		}
	}
	return out;
}
export function inheritedDependencies(architecture:Architecture) {
	return architecture.resources.flatMap(resource=>{
		const references=[...inheritedReferences(architecture,resource),...explicitResourceReferences(architecture,resource)];
		const sources=[...new Set(references.map(reference=>reference.source.id))];
		return sources.map(source=>({id:'dependency:'+source+':'+resource.id,source,target:resource.id,fields:[...new Set(references.filter(reference=>reference.source.id===source).map(reference=>reference.path.join('.')))]}));
	});
}

/** Absolute model positions are projected to React Flow only at the rendering boundary. */
export function resourceDimensions(architecture: Architecture, resource: Resource, mode: DesignMode, visited = new Set<string>()): {width:number;height:number} {
	if (!isResourceContainer(resource) || visited.has(resource.id)) { return mode==='visual'?{width:resourceIconSize(resource),height:resourceIconSize(resource)}:{width:244,height:310}; }
	const seen = new Set(visited).add(resource.id); const position = resource.positions[mode];
	let width = resource.containerSize?.width??440; let height = resource.containerSize?.height??300;
	for (const child of architecture.resources.filter(item=>visualParentId(item)===resource.id)) {
		const size = resourceDimensions(architecture,child,mode,seen);
		width = Math.max(width,child.positions[mode].x-position.x+size.width+32);
		height = Math.max(height,child.positions[mode].y-position.y+size.height+(mode==='visual'&&!isResourceContainer(child)?64:32));
	}
	return {width,height};
}
export function fitResourceContainers(architecture: Architecture): Architecture {
	let resources = architecture.resources;
	for (const container of [...resources].filter(isResourceContainer).sort((a,b)=>visualAncestors(architecture,b).length-visualAncestors(architecture,a).length)) {
		const current = {...architecture,resources}; const children = resources.filter(item=>visualParentId(item)===container.id); if (!children.length) { continue; }
		const original = resources.find(item=>item.id===container.id)!;
		const x = Math.min(original.positions.visual.x,...children.map(item=>item.positions.visual.x-32));
		const y = Math.min(original.positions.visual.y,...children.map(item=>item.positions.visual.y-68));
		const shifted = {...original,positions:{visual:{x,y},technical:{x,y}}};
		const interim = {...current,resources:resources.map(item=>item.id===container.id?shifted:item)};
		const visual = resourceDimensions(interim,shifted,'visual'); const technical = resourceDimensions(interim,shifted,'technical');
		const containerSize = {width:Math.max(visual.width,technical.width),height:Math.max(visual.height,technical.height)};
		if (x!==original.positions.visual.x || y!==original.positions.visual.y || containerSize.width!==original.containerSize?.width || containerSize.height!==original.containerSize?.height) { resources = resources.map(item=>item.id===container.id?{...shifted,containerSize}:item); }
	}
	return resources===architecture.resources?architecture:{...architecture,resources};
}
export function reparentResource(architecture: Architecture, id: string, parentId: string|undefined, visualContainerId?: string|null): Architecture {
	const child = architecture.resources.find(item=>item.id===id); if (!child || child.canvasLocked) { return architecture; }
	const placement = resourcePlacement(architecture,child,parentId); if (!placement.ok) { return architecture; }
	if (visualContainerId && !visualResourcePlacement(architecture, child, visualContainerId).ok) { return architecture; }
	const visual = visualContainerId === placement.parentId ? undefined : visualContainerId;
	if (child.parentId===placement.parentId && child.visualParentId===visual && !architecture.items.some(item=>item.members.includes(id))) { return architecture; }
	const next = {...architecture,resources:architecture.resources.map(resource=>resource.id===id?{...resource,parentId:placement.parentId,visualParentId:visual}:resource),items:architecture.items.map(item=>({...item,members:item.members.filter(member=>member!==id)}))};
	return fitResourceContainers(next);
}
