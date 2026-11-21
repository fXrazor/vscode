/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	id: string;
	kind: ResourceKind;
	catalogue?: CatalogueEntry;
	provider: Provider;
	name: string;
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
	name: string;
	resources: Resource[];
	items: BoardItem[];
	connections: { id: string; source: string; target: string }[];
}

export interface BoardItem {
	id: string;
	kind: 'frame' | 'note' | 'text' | 'shape';
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
	| { type: 'update'; id: string; patch: Partial<Pick<Resource, 'name' | 'label' | 'iconKind' | 'region' | 'settings' | 'blocks'>> }
	| { type: 'move'; id: string; mode: DesignMode; position: Position }
	| { type: 'add'; resource: Resource }
	| { type: 'insert'; architecture: Architecture }
	| { type: 'delete'; id: string }
	| { type: 'addItem'; item: BoardItem }
	| { type: 'updateItem'; id: string; patch: Partial<Pick<BoardItem, 'text' | 'width' | 'height' | 'fill' | 'fontSize' | 'bold'>> }
	| { type: 'moveItem'; id: string; mode: DesignMode; position: Position }
	| { type: 'deleteItem'; id: string }
	| { type: 'renameArchitecture'; name: string }
	| { type: 'connect'; source: string; target: string };

export type Action = Edit | { type: 'undo' } | { type: 'redo' };

export function createHistory(architecture: Architecture): History {
	return { past: [], present: architecture, future: [] };
}

function editArchitecture(architecture: Architecture, action: Edit): Architecture {
	switch (action.type) {
		case 'renameArchitecture':
			return { ...architecture, name: action.name };
		case 'update':
			if (!architecture.resources.some(resource => resource.id === action.id && Object.entries(action.patch).some(([key, value]) => resource[key as keyof Resource] !== value))) { return architecture; }
			return {
				...architecture,
				resources: architecture.resources.map(resource => resource.id === action.id ? { ...resource, ...action.patch } : resource)
			};
		case 'move':
			if (!architecture.resources.some(resource => resource.id === action.id
				&& (resource.positions[action.mode].x !== action.position.x || resource.positions[action.mode].y !== action.position.y))) { return architecture; }
			return {
				...architecture,
				resources: architecture.resources.map(resource => resource.id === action.id
					? { ...resource, positions: { ...resource.positions, [action.mode]: action.position } }
					: resource)
			};
		case 'insert':
   return { ...architecture, resources: [...architecture.resources, ...action.architecture.resources], items: [...architecture.items, ...action.architecture.items], connections: [...architecture.connections, ...action.architecture.connections] };
  case 'add':
			return { ...architecture, resources: [...architecture.resources, action.resource] };
		case 'delete':
			return {
				...architecture,
				resources: architecture.resources.filter(resource => resource.id !== action.id),
				items: architecture.items.map(item => ({ ...item, members: item.members.filter(id => id !== action.id) })),
				connections: architecture.connections.filter(connection => connection.source !== action.id && connection.target !== action.id)
			};
		case 'addItem':
			return { ...architecture, items: [...architecture.items, action.item] };
		case 'updateItem':
			return { ...architecture, items: architecture.items.map(item => item.id === action.id ? { ...item, ...action.patch } : item) };
		case 'deleteItem':
			return { ...architecture, items: architecture.items.filter(item => item.id !== action.id) };
		case 'moveItem': {
			const moved = architecture.items.find(item => item.id === action.id);
			if (!moved) { return architecture; }
			const deltaX = action.position.x - moved.positions[action.mode].x;
			const deltaY = action.position.y - moved.positions[action.mode].y;
			if (deltaX === 0 && deltaY === 0) { return architecture; }
			const members = new Set(moved.members);
			return {
				...architecture,
				items: architecture.items.map(item => item.id === moved.id
					? { ...item, positions: { ...item.positions, [action.mode]: action.position } }
					: item),
				resources: architecture.resources.map(resource => members.has(resource.id) ? {
					...resource,
					positions: { ...resource.positions, [action.mode]: {
						x: resource.positions[action.mode].x + deltaX,
						y: resource.positions[action.mode].y + deltaY
					} }
				} : resource)
			};
		}
		case 'connect':
			if (action.source === action.target
				|| !architecture.resources.some(resource => resource.id === action.source)
				|| !architecture.resources.some(resource => resource.id === action.target)
				|| architecture.connections.some(connection => connection.source === action.source && connection.target === action.target)) {
				return architecture;
			}
			return {
				...architecture,
				connections: [...architecture.connections, {
					id: action.source + '-' + action.target,
					source: action.source,
					target: action.target
				}]
			};
	}
}

export function historyReducer(history: History, action: Action): History {
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
