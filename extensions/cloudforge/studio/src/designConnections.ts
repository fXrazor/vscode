import type { Architecture, DesignMode } from './model.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { isResourceContainer, resourceDimensions } from './resourceHierarchy.ts';
import { elementEndpoint, endpointElementId, endpointExists, endpointKey, normaliseEndpoint, type DesignEndpoint } from './connectionEndpoints.ts';

export function connectableElements(architecture: Architecture) {
	return [
		...architecture.resources.map(resource => ({ id: resource.id, label: resource.label || resource.name, kind: 'resource' })),
		...architecture.items.filter(item => item.kind !== 'frame').map(item => ({ id: item.id, label: item.text || 'Untitled ' + item.kind, kind: item.kind }))
	];
}

export function canConnect(architecture: Architecture, source: string, target: string) {
	return canConnectEndpoints(architecture, elementEndpoint(source), elementEndpoint(target));
}

export function canConnectEndpoints(architecture: Architecture, source: DesignEndpoint, target: DesignEndpoint, ignoredId?: string): boolean {
	const ids = new Set(connectableElements(architecture).map(element => element.id));
	if (!endpointExists(source, ids) || !endpointExists(target, ids)) { return false; }
	const sourceId = endpointElementId(source); const targetId = endpointElementId(target);
	if (sourceId && sourceId === targetId) { return false; }
	if (source.kind === 'point' && target.kind === 'point' && source.position.x === target.position.x && source.position.y === target.position.y) { return false; }
	return !architecture.connections.some(link => link.id !== ignoredId && endpointKey(link.source, 'source') === endpointKey(source, 'source') && endpointKey(link.target, 'target') === endpointKey(target, 'target'));
}

/** World-space ports and loose endpoints share screen/export geometry. */
export function connectionAnchor(architecture: Architecture, endpoint: DesignEndpoint | string, side: 'source' | 'target', mode: DesignMode) {
	const value = normaliseEndpoint(endpoint);
	if (!value) { return undefined; }
	if (value.kind === 'point') { return value.position; }
	const id = value.elementId;
	const right = (value.port ?? (side === 'source' ? 'output' : 'input')) === 'output';
	const resource = architecture.resources.find(resource => resource.id === id);
	if (resource) { const container=isResourceContainer(resource); const size = container ? resourceDimensions(architecture,resource,mode).width : mode === 'visual' ? resourceIconSize(resource) : 244; return { x: resource.positions[mode].x + (right ? size : 0), y: resource.positions[mode].y + (container?22:mode === 'visual' ? size / 2 : 100) }; }
	const item = architecture.items.find(item => item.id === id && item.kind !== 'frame');
	if (!item) { return undefined; }
	const angle = (item.rotation ?? 0) * Math.PI / 180; const radius = (right ? 1 : -1) * item.width / 2;
	return { x: item.positions[mode].x + item.width / 2 + radius * Math.cos(angle), y: item.positions[mode].y + item.height / 2 + radius * Math.sin(angle) };
}
