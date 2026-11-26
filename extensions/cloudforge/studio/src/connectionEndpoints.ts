/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, DesignConnection, Position } from './model.ts';

/** Element sides: input = left, output = right, plus top and bottom (four points like Miro). */
export type EndpointPort = 'input' | 'output' | 'top' | 'bottom';
export const endpointPorts: readonly EndpointPort[] = ['input', 'output', 'top', 'bottom'];
export type DesignEndpoint = { kind: 'element'; elementId: string; port?: EndpointPort } | { kind: 'point'; position: Position };
type LegacyConnection = Omit<DesignConnection, 'source' | 'target'> & { source: DesignEndpoint | string; target: DesignEndpoint | string };
export type ArchitectureInput = Omit<Architecture, 'connections'> & { connections: (DesignConnection | LegacyConnection)[] };

export const elementEndpoint = (elementId: string, port?: EndpointPort): DesignEndpoint => ({ kind: 'element', elementId, ...(port ? { port } : {}) });
export const pointEndpoint = (position: Position): DesignEndpoint => ({ kind: 'point', position: { ...position } });

/** Single compatibility boundary for diagrams saved with element-id strings. */
export function normaliseEndpoint(value: unknown): DesignEndpoint | undefined {
	if (typeof value === 'string' && value) { return elementEndpoint(value); }
	if (!value || typeof value !== 'object') { return undefined; }
	const endpoint = value as DesignEndpoint;
	if (endpoint.kind === 'element' && typeof endpoint.elementId === 'string' && endpoint.elementId && (endpoint.port === undefined || endpointPorts.includes(endpoint.port))) { return endpoint; }
	if (endpoint.kind === 'point' && endpoint.position && Number.isFinite(endpoint.position.x) && Number.isFinite(endpoint.position.y)) { return endpoint; }
	return undefined;
}

export function endpointElementId(endpoint: DesignEndpoint | string): string | undefined {
	const value = normaliseEndpoint(endpoint);
	return value?.kind === 'element' ? value.elementId : undefined;
}

export function endpointKey(endpoint: DesignEndpoint | string, side: 'source' | 'target'): string {
	const value = normaliseEndpoint(endpoint);
	return !value ? 'invalid' : value.kind === 'point' ? `point:${value.position.x},${value.position.y}` : `element:${value.elementId}:${value.port ?? (side === 'source' ? 'output' : 'input')}`;
}

export function endpointExists(endpoint: DesignEndpoint | string, ids: ReadonlySet<string>): boolean {
	const value = normaliseEndpoint(endpoint);
	return !!value && (value.kind === 'point' || ids.has(value.elementId));
}

export function connectionElementIds(connection: DesignConnection): string[] {
	return [endpointElementId(connection.source), endpointElementId(connection.target)].filter((id): id is string => !!id);
}

export function hasPointEndpoint(connection: DesignConnection): boolean {
	return connection.source.kind === 'point' || connection.target.kind === 'point';
}

/** React Flow's strict source/target handles do not represent bare points or reversed physical ports. */
export function needsConnectionOverlay(connection: DesignConnection): boolean {
	return hasPointEndpoint(connection) || connection.source.kind === 'element' && connection.source.port === 'input' || connection.target.kind === 'element' && connection.target.port === 'output';
}

export function normaliseArchitectureConnections(architecture: ArchitectureInput): Architecture {
	const ids = new Set([...architecture.resources.map(item => item.id), ...architecture.items.filter(item => item.kind !== 'frame').map(item => item.id)]);
	let changed = false;
	const connections = architecture.connections.flatMap(connection => {
		const source = normaliseEndpoint(connection.source); const target = normaliseEndpoint(connection.target);
		if (!source || !target || !endpointExists(source, ids) || !endpointExists(target, ids)) { changed = true; return []; }
		if (source === connection.source && target === connection.target) { return [connection as DesignConnection]; }
		changed = true; return [{ ...connection, source, target }];
	});
	return changed ? { ...architecture, connections } : architecture as Architecture;
}

export function remapEndpoint(endpoint: DesignEndpoint, ids: Record<string, string>, offset: number): DesignEndpoint | undefined {
	const value = normaliseEndpoint(endpoint);
	if (!value) { return undefined; }
	return value.kind === 'point' ? pointEndpoint({ x: value.position.x + offset, y: value.position.y + offset }) : ids[value.elementId] ? { ...value, elementId: ids[value.elementId] } : undefined;
}
