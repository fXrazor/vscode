/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, DesignConnection, Position } from './model.ts';

/** Element sides: input = left, output = right, plus top and bottom (four points like Miro). */
export type EndpointPort = 'input' | 'output' | 'top' | 'bottom';
export const endpointPorts: readonly EndpointPort[] = ['input', 'output', 'top', 'bottom'];
/** Normalised [0..1] x [0..1] attachment position on an element's perimeter (Miro-style arbitrary edge snapping). */
export type PerimeterAnchor = { x: number; y: number };
export type DesignEndpoint = { kind: 'element'; elementId: string; port?: EndpointPort; anchor?: PerimeterAnchor } | { kind: 'point'; position: Position };
type LegacyConnection = Omit<DesignConnection, 'source' | 'target'> & { source: DesignEndpoint | string; target: DesignEndpoint | string };
export type ArchitectureInput = Omit<Architecture, 'connections'> & { connections: (DesignConnection | LegacyConnection)[] };

const roundAnchor = (value: number) => Math.round(value * 1000) / 1000;
export function normaliseAnchor(value: unknown): PerimeterAnchor | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const { x, y } = value as { x?: unknown; y?: unknown };
	if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) { return undefined; }
	return { x: roundAnchor(x), y: roundAnchor(y) };
}

/** Project a world point onto the nearest perimeter point of a box (un-rotating by `rotationDeg` when rotated). */
export function projectPerimeterAnchor(
	box: { x: number; y: number; width: number; height: number },
	point: Position,
	rotationDeg = 0
): { port: EndpointPort; anchor?: PerimeterAnchor } {
	const w = Math.max(1, box.width); const h = Math.max(1, box.height);
	const cx = box.x + w / 2; const cy = box.y + h / 2;
	const rad = -rotationDeg * Math.PI / 180;
	const dx = point.x - cx; const dy = point.y - cy;
	const localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
	const localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
	const nx = Math.max(0, Math.min(1, (localX - box.x) / w));
	const ny = Math.max(0, Math.min(1, (localY - box.y) / h));
	const sides: { port: EndpointPort; dist: number; anchor: PerimeterAnchor; along: number }[] = [
		{ port: 'input', dist: nx, anchor: { x: 0, y: roundAnchor(ny) }, along: ny },
		{ port: 'output', dist: 1 - nx, anchor: { x: 1, y: roundAnchor(ny) }, along: ny },
		{ port: 'top', dist: ny, anchor: { x: roundAnchor(nx), y: 0 }, along: nx },
		{ port: 'bottom', dist: 1 - ny, anchor: { x: roundAnchor(nx), y: 1 }, along: nx },
	];
	const best = sides.reduce((a, b) => b.dist < a.dist ? b : a);
	// Snap gently to the classic cardinal centre port within 10% of the side midpoint.
	if (Math.abs(best.along - 0.5) <= 0.1) { return { port: best.port }; }
	return { port: best.port, anchor: best.anchor };
}

export const elementEndpoint = (elementId: string, port?: EndpointPort, anchor?: PerimeterAnchor): DesignEndpoint => ({ kind: 'element', elementId, ...(port ? { port } : {}), ...(anchor ? { anchor: { x: roundAnchor(anchor.x), y: roundAnchor(anchor.y) } } : {}) });
export const pointEndpoint = (position: Position): DesignEndpoint => ({ kind: 'point', position: { ...position } });

/** Single compatibility boundary for diagrams saved with element-id strings. */
export function normaliseEndpoint(value: unknown): DesignEndpoint | undefined {
	if (typeof value === 'string' && value) { return elementEndpoint(value); }
	if (!value || typeof value !== 'object') { return undefined; }
	const endpoint = value as DesignEndpoint;
	if (endpoint.kind === 'element' && typeof endpoint.elementId === 'string' && endpoint.elementId && (endpoint.port === undefined || endpointPorts.includes(endpoint.port))) {
		if (endpoint.anchor !== undefined) {
			const anchor = normaliseAnchor(endpoint.anchor);
			if (!anchor) { return undefined; }
			return { kind: 'element', elementId: endpoint.elementId, ...(endpoint.port ? { port: endpoint.port } : {}), anchor };
		}
		return endpoint;
	}
	if (endpoint.kind === 'point' && endpoint.position && Number.isFinite(endpoint.position.x) && Number.isFinite(endpoint.position.y)) { return endpoint; }
	return undefined;
}

export function endpointElementId(endpoint: DesignEndpoint | string): string | undefined {
	const value = normaliseEndpoint(endpoint);
	return value?.kind === 'element' ? value.elementId : undefined;
}

export function endpointKey(endpoint: DesignEndpoint | string, side: 'source' | 'target'): string {
	const value = normaliseEndpoint(endpoint);
	return !value ? 'invalid' : value.kind === 'point' ? `point:${value.position.x},${value.position.y}` : `element:${value.elementId}:${value.port ?? (side === 'source' ? 'output' : 'input')}${value.anchor ? `@${value.anchor.x},${value.anchor.y}` : ''}`;
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

/** React Flow's strict source/target handles do not represent bare points, arbitrary perimeter anchors, or reversed physical ports. */
export function needsConnectionOverlay(connection: DesignConnection): boolean {
	return hasPointEndpoint(connection)
		|| (connection.source.kind === 'element' && (connection.source.port === 'input' || !!connection.source.anchor))
		|| (connection.target.kind === 'element' && (connection.target.port === 'output' || !!connection.target.anchor));
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

export function remapEndpoint(endpoint: DesignEndpoint, ids: Record<string, string>, offsetX: number, offsetY = offsetX): DesignEndpoint | undefined {
	const value = normaliseEndpoint(endpoint);
	if (!value) { return undefined; }
	return value.kind === 'point' ? pointEndpoint({ x: value.position.x + offsetX, y: value.position.y + offsetY }) : ids[value.elementId] ? { ...value, elementId: ids[value.elementId] } : undefined;
}
