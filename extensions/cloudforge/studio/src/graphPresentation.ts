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
	/** Ghost cards for var., local. and data. inputs. */
	showInputs: boolean;
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
export const defaultGraphPresentation: GraphPresentation = { lens: 'all', layout: 'layers', route: 'curved', pins: {}, expanded: [], showMembership: false, showInputs: true, density: 'auto', overlay: 'none', spacing: 'auto', height: 100 };

export type GraphPresentationAction =
	| { type: 'set'; patch: Partial<Omit<GraphPresentation, 'pins' | 'expanded'>> }
	| { type: 'pin'; id: string; position: Position }
	| { type: 'unpin'; id: string }
	| { type: 'clearPins' }
	| { type: 'toggleExpanded'; id: string }
	| { type: 'restore'; state: Partial<GraphPresentation> };

export function graphPresentationReducer(state: GraphPresentation, action: GraphPresentationAction): GraphPresentation {
	switch (action.type) {
		case 'set': return { ...state, ...action.patch };
		case 'pin': return { ...state, pins: { ...state.pins, [action.id]: { x: action.position.x, y: action.position.y } } };
		case 'unpin': { const pins = { ...state.pins }; delete pins[action.id]; return { ...state, pins }; }
		case 'clearPins': return { ...state, pins: {} };
		case 'restore': return { ...defaultGraphPresentation, ...action.state, focus: undefined };
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

const allowed = {
	lens: ['all', 'dependencies', 'topology', 'runtime', 'observability', 'security'],
	layout: ['layers', 'scopes', 'tree', 'bundled'],
	route: ['curved', 'orthogonal', 'straight'],
	density: ['auto', 'detailed', 'compact'],
	overlay: ['none', 'plan', 'order', 'impact'],
} as const;
/** The persisted shape: everything except a transient focus. Pins stay graph-local. */
export function serialiseGraphPresentation(state: GraphPresentation): Omit<GraphPresentation, 'focus'> {
	const { focus: _focus, ...rest } = state;
	const pins: Record<string, Position> = {};
	for (const [id, point] of Object.entries(state.pins).slice(0, 512)) { if (Number.isFinite(point.x) && Number.isFinite(point.y)) { pins[id] = { x: Math.round(point.x), y: Math.round(point.y) }; } }
	return { ...rest, pins, expanded: state.expanded.slice(0, 512) };
}
/** Reads a stored presentation, ignoring unknown values (for example from an older Studio). */
export function parseGraphPresentation(value: unknown): Partial<GraphPresentation> | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const raw = value as Record<string, unknown>; const out: Record<string, unknown> = {};
	for (const [key, values] of Object.entries(allowed)) { if (typeof raw[key] === 'string' && (values as readonly string[]).includes(raw[key] as string)) { out[key] = raw[key]; } }
	if (raw.spacing === 'auto' || (typeof raw.spacing === 'number' && raw.spacing >= 100 && raw.spacing <= 300)) { out.spacing = raw.spacing; }
	if (typeof raw.height === 'number' && raw.height >= 100 && raw.height <= 300) { out.height = raw.height; }
	if (typeof raw.showMembership === 'boolean') { out.showMembership = raw.showMembership; }
	if (typeof raw.showInputs === 'boolean') { out.showInputs = raw.showInputs; }
	if (Array.isArray(raw.expanded)) { out.expanded = raw.expanded.filter(id => typeof id === 'string'); }
	if (raw.pins && typeof raw.pins === 'object') { out.pins = Object.fromEntries(Object.entries(raw.pins as Record<string, Position>).filter(([, point]) => point && Number.isFinite(point.x) && Number.isFinite(point.y)).map(([id, point]) => [id, { x: point.x, y: point.y }])); }
	return out as Partial<GraphPresentation>;
}
