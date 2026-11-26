/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Graph presentation state. It lives beside — never inside — the architecture history:
 * no Resource.positions, parentId, containers, Terraform, Modified state or Undo.
 */
import type { Action, Position } from './model.ts';
import type { GraphLens } from './technicalGraph.ts';
import type { GraphLayoutKind } from './technicalGraphLayout.ts';

export type RouteStyle = 'curved' | 'orthogonal' | 'straight';
export interface GraphPresentation {
	lens: GraphLens;
	layout: GraphLayoutKind;
	route: RouteStyle;
	/** Graph-local pins. Keyed by resource id, valid only for the graph. */
	pins: Record<string, Position>;
	expanded: string[];
	showMembership: boolean;
	density: 'auto' | 'detailed' | 'compact';
	/** Card badge overlay: plan actions, Terraform apply waves or configured dependents. */
	overlay: 'none' | 'plan' | 'order' | 'impact';
	/** Show only the neighbourhood of one resource. */
	focus?: { id: string; depth: number };
	/** 'auto' opens gaps crossed by many lines; a percentage scales all spacing. */
	spacing: 'auto' | number;
	/** Vertical stretch percentage (100–300), independent of spacing. */
	height: number;
}
export const defaultGraphPresentation: GraphPresentation = { lens: 'all', layout: 'layers', route: 'curved', pins: {}, expanded: [], showMembership: false, density: 'auto', overlay: 'none', spacing: 'auto', height: 100 };

export type GraphPresentationAction =
	| { type: 'set'; patch: Partial<Omit<GraphPresentation, 'pins' | 'expanded'>> }
	| { type: 'pin'; id: string; position: Position }
	| { type: 'unpin'; id: string }
	| { type: 'clearPins' }
	| { type: 'toggleExpanded'; id: string };

export function graphPresentationReducer(state: GraphPresentation, action: GraphPresentationAction): GraphPresentation {
	switch (action.type) {
		case 'set': return { ...state, ...action.patch };
		case 'pin': return { ...state, pins: { ...state.pins, [action.id]: { x: action.position.x, y: action.position.y } } };
		case 'unpin': { const pins = { ...state.pins }; delete pins[action.id]; return { ...state, pins }; }
		case 'clearPins': return { ...state, pins: {} };
		case 'toggleExpanded': return { ...state, expanded: state.expanded.includes(action.id) ? state.expanded.filter(id => id !== action.id) : [...state.expanded, action.id] };
	}
}

const editablePatchKeys = new Set(['label', 'name', 'terraformName', 'region', 'settings', 'blocks']);
/**
 * Graph View may edit a resource's configuration (names, fields, bindings) but never its placement.
 * Moves, reparenting, resizing, creation, deletion, connections and history jumps are refused.
 */
export function graphEditAllowed(action: Action): boolean {
	switch (action.type) {
		case 'update': return Object.keys(action.patch).every(key => editablePatchKeys.has(key));
		case 'bindVariable': case 'bindResourceRef': case 'useInheritance': return true;
		default: return false;
	}
}
