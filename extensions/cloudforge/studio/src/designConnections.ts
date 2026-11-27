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
	const port = value.port ?? (side === 'source' ? 'output' : 'input'); const right = port === 'output';
	const resource = architecture.resources.find(resource => resource.id === id);
	if (resource) {
		const container = isResourceContainer(resource); const box = container ? resourceDimensions(architecture, resource, mode) : undefined;
		const size = box ? box.width : mode === 'visual' ? resourceIconSize(resource) : 244; const height = box ? box.height : mode === 'visual' ? resourceIconSize(resource) : 200;
		const origin = resource.positions[mode];
		if (port === 'top' || port === 'bottom') { return { x: origin.x + size / 2, y: origin.y + (port === 'bottom' ? height : 0) }; }
		return { x: origin.x + (right ? size : 0), y: origin.y + (container ? 22 : mode === 'visual' ? size / 2 : 100) };
	}
	const item = architecture.items.find(item => item.id === id && item.kind !== 'frame');
	if (!item) { return undefined; }
	const angle = (item.rotation ?? 0) * Math.PI / 180; const centre = { x: item.positions[mode].x + item.width / 2, y: item.positions[mode].y + item.height / 2 };
	if (port === 'top' || port === 'bottom') { const radius = (port === 'bottom' ? 1 : -1) * item.height / 2; return { x: centre.x - radius * Math.sin(angle), y: centre.y + radius * Math.cos(angle) }; }
	const radius = (right ? 1 : -1) * item.width / 2;
	return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}
