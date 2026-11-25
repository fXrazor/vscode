/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { variableError, variableUses, type VariableDefinition } from './variables.ts';
import { canConnect, canConnectEndpoints } from './designConnections.ts';
import { elementEndpoint, endpointKey, normaliseArchitectureConnections, type ArchitectureInput, type DesignEndpoint } from './connectionEndpoints.ts';
export type { DesignEndpoint } from './connectionEndpoints.ts';
import { applyCanvasCommand, canvasElements, type CanvasCommand } from './canvasOperations.ts';
import { bindingKey, acceptsResourceRefs, acceptsVariable, canBindField, fieldDefinition, fieldTargetPath, findResourceBlock, pruneBlockBindings, pruneBlockResourceRefs, type FieldTarget, type ResourceRefBinding, type ResourceRefEntry, type VariableBinding } from './fieldBindings.ts';
import { fitResourceContainers, isResourceContainer, reparentResource, resourcePlacement, terraformIdentifier } from './resourceHierarchy.ts';
import type { ShapeId } from './shapes.ts';
import { rebaseHistory } from './historyRebase.ts';
export type DesignMode = 'visual' | 'technical';
export type ResourceKind = 'network' | 'subnet' | 'gateway' | 'cluster' | 'storage' | 'monitor' | 'group' | 'compute' | 'database' | 'module' | 'generic';
export type Provider = 'azure' | 'aws' | 'gcp';
export type Position = { x: number; y: number };

export interface CatalogueField {
 name: string; type: 'string' | 'number' | 'bool'; required?: boolean;
 description?: string; default?: string | number | boolean; options?: string[]; sensitive?: boolean;
}
export interface CatalogueEntry {
 type: string; label: string; service: string; category: string; icon: string; fields: CatalogueField[]; curated?: boolean; iconMatch?: string;
}

export interface Resource {
	parentId?: string;
	containerSize?: { width: number; height: number };
	inheritanceOverrides?: string[];
	canvasLocked?: boolean;
	iconSize?: number;
	fieldBindings?: Record<string, VariableBinding>;
	resourceRefs?: Record<string, ResourceRefBinding>;
	id: string;
	kind: ResourceKind;
	catalogue?: CatalogueEntry;
	provider: Provider;
	name: string;
	terraformName?: string;
	sourceFile?: string;
	sourceLine?: number;
	label?: string;
	iconKind?: ResourceKind;
	region: string;
	settings: Record<string, string>;
	blocks: ResourceBlock[];
	positions: Record<DesignMode, Position>;
}

export interface ResourceBlock {
	id: string;
	type: string;
	values: Record<string, string>;
	blocks: ResourceBlock[];
}

export interface Architecture {
	groups?: { id: string; label: string; members: string[] }[];
	layerOrder?: string[];
	name: string;
	variables?: VariableDefinition[];
	resources: Resource[];
	items: BoardItem[];
	connections: DesignConnection[];
}

export interface DesignConnection {
	id: string; source: DesignEndpoint; target: DesignEndpoint;
	label?: string;
	labelFontSize?: number;
	labelColor?: string;
	labelPosition?: 'above' | 'center' | 'below';
	routing?: 'straight' | 'elbow' | 'curve';
	stroke?: string;
	width?: number;
	pattern?: 'solid' | 'dashed' | 'dotted';
	startArrow?: boolean;
	endArrow?: boolean;
}

export interface BoardItem {
	canvasLocked?: boolean;
	italic?: boolean;
	underline?: boolean;
	textColor?: string;
	fontFamily?: 'sans' | 'serif' | 'mono';
	textAlign?: 'left' | 'center' | 'right';
	verticalAlign?: 'top' | 'middle' | 'bottom';
	opacity?: number;
	id: string;
	kind: 'frame' | 'note' | 'text' | 'shape' | 'ink';
	shape?: ShapeId;
	/** Clockwise degrees about the element's centre; drawings only (frames and resources stay upright). */
	rotation?: number;
	/** Freehand stroke for `ink` drawings, in a 0–100 viewBox stretched to the element. */
	path?: string;
	strokeColor?: string;
	strokeWidth?: number;
	strokeStyle?: 'solid' | 'dashed' | 'dotted';
	text: string;
	fill?: string;
	fontSize?: number;
	bold?: boolean;
	positions: Record<DesignMode, Position>;
	width: number;
	height: number;
	members: string[];
}

export interface History {
	past: Architecture[];
	present: Architecture;
	future: Architecture[];
}

export type Edit =
	| { type: 'placeResource'; id: string; parentId?: string; mode: DesignMode; positions?: Record<string,Position> }
	| { type: 'resizeContainer'; id: string; position: Position; width: number; height: number }
	| { type: 'useInheritance'; id: string; target: FieldTarget; enabled: boolean }
	| { type: 'canvas'; command: CanvasCommand }
	| { type: 'resizeResource'; id: string; position: Position; iconSize: number }
	| { type: 'bindVariable'; id: string; target: FieldTarget; variableId?: string }
	| { type: 'bindResourceRef'; id: string; target: FieldTarget; refs?: ResourceRefEntry[] }
	| { type: 'updateConnection'; id: string; patch: Partial<Omit<DesignConnection, 'id' | 'source' | 'target'>> }
	| { type: 'reverseConnection'; id: string }
	| { type: 'deleteConnection'; id: string }
	| { type: 'connectEndpoints'; id: string; source: DesignEndpoint; target: DesignEndpoint }
	| { type: 'reconnectConnection'; id: string; side: 'source' | 'target'; endpoint: DesignEndpoint }
	| { type: 'update'; id: string; patch: Partial<Pick<Resource, 'name' | 'terraformName' | 'label' | 'iconKind' | 'region' | 'settings' | 'blocks'>> }
	| { type: 'move'; id: string; mode: DesignMode; position: Position }
	| { type: 'applyResourceCode'; resources: Resource[] }
	| { type: 'add'; resource: Resource }
	| { type: 'insert'; architecture: Architecture }
	| { type: 'delete'; id: string }
	| { type: 'addItem'; item: BoardItem }
	/** Drop a connector on empty canvas: create the drawing there and link to it, as one undo step. */
	| { type: 'addConnectedItem'; source: string; item: BoardItem }
	| { type: 'updateItem'; id: string; patch: Partial<Pick<BoardItem, 'text' | 'width' | 'height' | 'fill' | 'fontSize' | 'bold' | 'shape' | 'strokeColor' | 'strokeWidth' | 'strokeStyle'>> }
	| { type: 'moveItem'; id: string; mode: DesignMode; position: Position }
	| { type: 'resizeItem'; id: string; mode: DesignMode; position: Position; width: number; height: number }
	| { type: 'deleteItem'; id: string }
	| { type: 'importVariables'; variables: VariableDefinition[]; override: boolean }
	| { type: 'addVariables'; variables: VariableDefinition[] }
	| { type: 'saveVariable'; variable: VariableDefinition }
	| { type: 'deleteVariable'; id: string }
	| { type: 'renameArchitecture'; name: string }
	| { type: 'connect'; source: string; target: string };

export type Action = Edit | { type: 'undo' } | { type: 'redo' } | { type: 'replace'; architecture: Architecture }
	/** A live refresh of the same architecture: keeps undo/redo, rebased onto the refreshed state. */
	| { type: 'rebase'; architecture: Architecture };

export function createHistory(architecture: ArchitectureInput): History {
	return { past: [], present: normaliseArchitectureConnections(architecture), future: [] };
}

function editArchitecture(architecture: Architecture, action: Edit): Architecture {
	switch (action.type) {
		case 'placeResource': {
			const resource = architecture.resources.find(item=>item.id===action.id);
			if (!resource || resource.canvasLocked || !resourcePlacement(architecture,resource,action.parentId).ok) { return architecture; }
			const moved = action.positions ? applyCanvasCommand(architecture,{kind:'move',mode:action.mode,positions:action.positions,fit:false}) : architecture;
			return fitResourceContainers(reparentResource(moved,action.id,action.parentId));
		}
		case 'resizeContainer': {
			const resource = architecture.resources.find(item=>item.id===action.id);
			if (!resource || !isResourceContainer(resource) || resource.canvasLocked || ![action.position.x,action.position.y,action.width,action.height].every(Number.isFinite) || action.width<280 || action.height<180 || action.width>10000 || action.height>10000) { return architecture; }
			if(resource.positions.visual.x===action.position.x&&resource.positions.visual.y===action.position.y&&resource.containerSize?.width===action.width&&resource.containerSize?.height===action.height){return architecture;}
			return fitResourceContainers({...architecture,resources:architecture.resources.map(item=>item.id===action.id?{...item,positions:{visual:action.position,technical:action.position},containerSize:{width:action.width,height:action.height}}:item)});
		}
		case 'useInheritance': {
			const resource = architecture.resources.find(item=>item.id===action.id); if (!resource) { return architecture; }
			const path = fieldTargetPath(resource,action.target).join('.'); const key = bindingKey(action.target);
			const fieldBindings = {...resource.fieldBindings}; const resourceRefs = {...resource.resourceRefs};
			if (action.enabled) { delete fieldBindings[key]; delete resourceRefs[key]; }
			const inheritanceOverrides = action.enabled ? (resource.inheritanceOverrides??[]).filter(item=>item!==path) : [...new Set([...(resource.inheritanceOverrides??[]),path])];
			if (inheritanceOverrides.join('|')===(resource.inheritanceOverrides??[]).join('|') && fieldBindings[key]===resource.fieldBindings?.[key] && resourceRefs[key]===resource.resourceRefs?.[key]) { return architecture; }
			return {...architecture,resources:architecture.resources.map(item=>item.id===action.id?{...item,fieldBindings,resourceRefs,inheritanceOverrides}:item)};
		}
		case 'canvas': return applyCanvasCommand(architecture, action.command);
		case 'bindVariable': {
			const resource = architecture.resources.find(item => item.id === action.id);
			if (!resource || !canBindField(resource,action.target)) { return architecture; }
			const target = action.target;
			if (target.kind === 'block' && !findResourceBlock(resource.blocks, target.blockId)) { return architecture; }
			const variable = architecture.variables?.find(item => item.id === action.variableId);
			if (action.variableId && (!variable || !acceptsVariable(variable, fieldDefinition(resource, target)))) { return architecture; }
			const key = bindingKey(target); const fieldBindings = { ...resource.fieldBindings }; const resourceRefs = { ...resource.resourceRefs };
			if (fieldBindings[key]?.variableId === action.variableId && (!action.variableId || !resourceRefs[key])) { return architecture; }
			if (action.variableId) { fieldBindings[key] = { variableId: action.variableId }; delete resourceRefs[key]; } else { delete fieldBindings[key]; }
			const blocks = structuredClone(resource.blocks);
			const settings = { ...resource.settings };
			if (target.kind === 'setting' && action.variableId) { settings[target.name] ??= ''; }
			if (target.kind === 'block' && action.variableId) { const block = findResourceBlock(blocks, target.blockId)!; block.values[target.name] ??= ''; }
			const inheritanceOverrides = action.variableId ? [...new Set([...(resource.inheritanceOverrides??[]),fieldTargetPath(resource,target).join('.')])] : resource.inheritanceOverrides;
			return { ...architecture, resources: architecture.resources.map(item => item.id === action.id ? { ...item, fieldBindings, resourceRefs, blocks, settings, inheritanceOverrides } : item) };
		}
		case 'bindResourceRef': {
			const resource = architecture.resources.find(item => item.id === action.id);
			if (!resource || !canBindField(resource, action.target)) { return architecture; }
			const target = action.target;
			if (target.kind === 'block' && !findResourceBlock(resource.blocks, target.blockId)) { return architecture; }
			const refs = action.refs?.length ? action.refs : undefined;
			const definition = fieldDefinition(resource, target);
			if (refs && !acceptsResourceRefs(architecture, resource, refs, definition)) { return architecture; }
			const key = bindingKey(target);
			const resourceRefs = { ...resource.resourceRefs };
			const fieldBindings = { ...resource.fieldBindings };
			if (JSON.stringify(resourceRefs[key]?.refs ?? null) === JSON.stringify(refs ?? null) && (!refs || !fieldBindings[key])) { return architecture; }
			if (refs) { resourceRefs[key] = { refs: refs.map(entry => ({ resourceId: entry.resourceId, attribute: entry.attribute })) }; delete fieldBindings[key]; }
			else { delete resourceRefs[key]; }
			const blocks = structuredClone(resource.blocks);
			const settings = { ...resource.settings };
			if (target.kind === 'setting' && refs) { settings[target.name] ??= ''; }
			if (target.kind === 'block' && refs) { const block = findResourceBlock(blocks, target.blockId)!; block.values[target.name] ??= ''; }
			const inheritanceOverrides = refs ? [...new Set([...(resource.inheritanceOverrides ?? []), fieldTargetPath(resource, target).join('.')])] : resource.inheritanceOverrides;
			return { ...architecture, resources: architecture.resources.map(item => item.id === action.id ? { ...item, fieldBindings, resourceRefs, blocks, settings, inheritanceOverrides } : item) };
		}
		case 'resizeResource': {
			const resource = architecture.resources.find(item => item.id === action.id);
			if (!resource || isResourceContainer(resource) || resource.canvasLocked || ![action.position.x, action.position.y, action.iconSize].every(Number.isFinite) || action.iconSize < 24 || action.iconSize > 160) { return architecture; }
			if ((resource.iconSize ?? 48) === action.iconSize && resource.positions.visual.x === action.position.x && resource.positions.visual.y === action.position.y) { return architecture; }
			return fitResourceContainers({ ...architecture, resources: architecture.resources.map(item => item.id === action.id ? { ...item, iconSize: action.iconSize, positions: { visual: action.position, technical: action.position } } : item) });
		}
		case 'reverseConnection': {
			const connection = architecture.connections.find(item => item.id === action.id);
			if (!connection || !canConnectEndpoints(architecture, connection.target, connection.source, connection.id)) { return architecture; }
			return { ...architecture, connections: architecture.connections.map(item => item.id === action.id ? { ...item, source: item.target, target: item.source } : item) };
		}
		case 'updateConnection': {
			const connection = architecture.connections.find(connection => connection.id === action.id);
			if (!connection) { return architecture; }
			const patch = action.patch;
			if ('source' in patch || 'target' in patch || 'id' in patch) { return architecture; }
			if (patch.width !== undefined && (!Number.isFinite(patch.width) || patch.width < 1 || patch.width > 8)
				|| patch.stroke !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.stroke)
				|| patch.routing !== undefined && !['straight', 'elbow', 'curve'].includes(patch.routing)
				|| patch.pattern !== undefined && !['solid', 'dashed', 'dotted'].includes(patch.pattern)
				|| patch.labelFontSize !== undefined && (!Number.isFinite(patch.labelFontSize) || patch.labelFontSize < 10 || patch.labelFontSize > 32)
				|| patch.labelColor !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.labelColor)
				|| patch.labelPosition !== undefined && !['above', 'center', 'below'].includes(patch.labelPosition)
				|| patch.label !== undefined && patch.label.length > 200) { return architecture; }
			if (Object.entries(patch).every(([key, value]) => connection[key as keyof DesignConnection] === value)) { return architecture; }
			return { ...architecture, connections: architecture.connections.map(item => item.id === action.id ? { ...item, ...patch } : item) };
		}
		case 'deleteConnection':
			return architecture.connections.some(connection => connection.id === action.id) ? { ...architecture, connections: architecture.connections.filter(connection => connection.id !== action.id) } : architecture;
		case 'connectEndpoints': {
			if (!action.id || action.id.includes('->') || architecture.connections.some(link => link.id === action.id) || !canConnectEndpoints(architecture, action.source, action.target)) { return architecture; }
			return { ...architecture, connections: [...architecture.connections, { id: action.id, source: action.source, target: action.target }] };
		}
		case 'reconnectConnection': {
			const link = architecture.connections.find(item => item.id === action.id);
			if (!link || link.id.includes('->') || !['source', 'target'].includes(action.side) || endpointKey(link[action.side], action.side) === endpointKey(action.endpoint, action.side)) { return architecture; }
			const next = { ...link, [action.side]: action.endpoint };
			if (!canConnectEndpoints(architecture, next.source, next.target, link.id)) { return architecture; }
			return { ...architecture, connections: architecture.connections.map(item => item.id === link.id ? next : item) };
		}
		case 'importVariables': {
			const variables = [...(architecture.variables ?? [])];
			for (const imported of action.variables) {
				const index = variables.findIndex(variable => variable.name === imported.name);
				if (index < 0) { variables.push(imported); } else if (action.override) { variables[index] = { ...imported, id: variables[index].id }; }
			}
			if (new Set(variables.map(variable => variable.id)).size !== variables.length || variables.some(variable => variableError(variable, variables))) { return architecture; }
			return { ...architecture, variables };
		}
		case 'addVariables': {
			const existing = architecture.variables ?? [];
			const variables = [...existing, ...action.variables];
			if (!action.variables.length || new Set(variables.map(variable => variable.id)).size !== variables.length || action.variables.some(variable => variableError(variable, variables))) { return architecture; }
			return { ...architecture, variables };
		}
		case 'saveVariable': {
			const variables = architecture.variables ?? [];
			if (variableError(action.variable, variables)) { return architecture; }
			const previous = variables.find(variable => variable.id === action.variable.id);
			if (previous && previous.name !== action.variable.name && variableUses(architecture).has(previous.name)) { return architecture; }
			return { ...architecture, variables: previous ? variables.map(variable => variable.id === previous.id ? action.variable : variable) : [...variables, action.variable] };
		}
		case 'deleteVariable': {
			const variable = architecture.variables?.find(variable => variable.id === action.id);
			if (!variable || variableUses(architecture).has(variable.name)) { return architecture; }
			return { ...architecture, variables: architecture.variables!.filter(variable => variable.id !== action.id) };
		}
		case 'applyResourceCode': {
			const updates = new Map(action.resources.map(resource => [resource.id, resource]));
			if (action.resources.some(resource => !architecture.resources.some(existing => existing.id === resource.id))) { return architecture; }
			return { ...architecture, resources: architecture.resources.map(resource => updates.get(resource.id) ?? resource) };
		}
		case 'renameArchitecture':
			return { ...architecture, name: action.name };
		case 'update':
			if (!architecture.resources.some(resource => resource.id === action.id && Object.entries(action.patch).some(([key, value]) => resource[key as keyof Resource] !== value))) { return architecture; }
			return {
				...architecture,
				resources: architecture.resources.map(resource => resource.id === action.id ? { ...resource, ...(action.patch.name!==undefined?{terraformName:terraformIdentifier(resource)}:{}), ...action.patch, ...(action.patch.blocks ? {fieldBindings:pruneBlockBindings(resource,action.patch.blocks),resourceRefs:pruneBlockResourceRefs(resource,action.patch.blocks)} : {}) } : resource)
			};
		case 'move': return applyCanvasCommand(architecture,{kind:'move',mode:action.mode,positions:{[action.id]:action.position}});
		case 'insert':
   return fitResourceContainers({ ...architecture, resources: [...architecture.resources, ...action.architecture.resources], items: [...architecture.items, ...action.architecture.items], connections: [...architecture.connections, ...action.architecture.connections] });
  case 'add':
			return fitResourceContainers({ ...architecture, resources: [...architecture.resources, action.resource] });
		case 'delete':
			return applyCanvasCommand(architecture, { kind: 'delete', ids: [action.id] });
		case 'addItem':
			return { ...architecture, items: [...architecture.items, action.item] };
		case 'addConnectedItem': {
			if (architecture.items.some(item => item.id === action.item.id) || !canvasElements(architecture).some(element => element.id === action.source)) { return architecture; }
			return editArchitecture({ ...architecture, items: [...architecture.items, action.item] }, { type: 'connect', source: action.source, target: action.item.id });
		}
		case 'updateItem':
			if (architecture.items.find(item => item.id === action.id)?.canvasLocked) { return architecture; }
			if (!architecture.items.some(item => item.id === action.id && Object.entries(action.patch).some(([key, value]) => item[key as keyof BoardItem] !== value))) { return architecture; }
			return { ...architecture, items: architecture.items.map(item => item.id === action.id ? { ...item, ...action.patch } : item) };
		case 'resizeItem':
			if (architecture.items.find(item => item.id === action.id)?.canvasLocked) { return architecture; }
			if (![action.width, action.height, action.position.x, action.position.y].every(Number.isFinite) || action.width <= 0 || action.height <= 0) { return architecture; }
			return editArchitecture(editArchitecture(architecture, { type: 'moveItem', id: action.id, mode: action.mode, position: action.position }), { type: 'updateItem', id: action.id, patch: { width: action.width, height: action.height } });
		case 'deleteItem':
			return applyCanvasCommand(architecture, { kind: 'delete', ids: [action.id] });
		case 'moveItem': {
			return applyCanvasCommand(architecture, { kind: 'move', mode: action.mode, positions: { [action.id]: action.position } });
		}
		case 'connect':
			if (!canConnect(architecture, action.source, action.target)) {
				return architecture;
			}
			return {
				...architecture,
				connections: [...architecture.connections, {
					id: action.source + '-' + action.target,
					source: elementEndpoint(action.source),
					target: elementEndpoint(action.target)
				}]
			};
	}
}

export function historyReducer(history: History, action: Action): History {
	if (action.type === 'replace') {
		return createHistory(action.architecture);
	}
	if (action.type === 'rebase') {
		return rebaseHistory(history, normaliseArchitectureConnections(action.architecture));
	}
	if (action.type === 'undo') {
		const previous = history.past.at(-1);
		return previous ? {
			past: history.past.slice(0, -1),
			present: previous,
			future: [history.present, ...history.future]
		} : history;
	}
	if (action.type === 'redo') {
		const next = history.future[0];
		return next ? {
			past: [...history.past, history.present],
			present: next,
			future: history.future.slice(1)
		} : history;
	}
	const next = editArchitecture(history.present, action);
	if (next === history.present) {
		return history;
	}
	return { past: [...history.past.slice(-99), history.present], present: next, future: [] };
}

export interface Finding {
	resourceId: string;
	message: string;
}

/** Local draft checks only. Provider, source and cloud validation belong to Rust. */
export function checkDraft(architecture: Architecture): Finding[] {
	const findings: Finding[] = [];
	const names = new Set<string>();
	for (const resource of architecture.resources) {
		if (!resource.name.trim()) {
			findings.push({ resourceId: resource.id, message: 'Enter a resource name.' });
		} else if (names.has(resource.name.trim().toLowerCase())) {
			findings.push({ resourceId: resource.id, message: 'Use a unique name in this sample architecture.' });
		}
		names.add(resource.name.trim().toLowerCase());
	}
	return findings;
}
