import type { Architecture, DesignMode } from './model.ts';
import { resourceIconSize } from './resourceGeometry.ts';
import { isResourceContainer, resourceDimensions } from './resourceHierarchy.ts';

export function connectableElements(architecture: Architecture) {
	return [
		...architecture.resources.map(resource => ({ id: resource.id, label: resource.label || resource.name, kind: 'resource' })),
		...architecture.items.filter(item => item.kind !== 'frame').map(item => ({ id: item.id, label: item.text || 'Untitled ' + item.kind, kind: item.kind }))
	];
}

export function canConnect(architecture: Architecture, source: string, target: string) {
	const elements = connectableElements(architecture);
	return source !== target && elements.some(element => element.id === source) && elements.some(element => element.id === target)
		&& !architecture.connections.some(connection => connection.source === source && connection.target === target);
}

/** Fixed left/right ports; free endpoints and precise shape intersections are future work. */
export function connectionAnchor(architecture: Architecture, id: string, side: 'source' | 'target', mode: DesignMode) {
	const resource = architecture.resources.find(resource => resource.id === id);
	if (resource) { const container=isResourceContainer(resource); const size = container ? resourceDimensions(architecture,resource,mode).width : mode === 'visual' ? resourceIconSize(resource) : 244; return { x: resource.positions[mode].x + (side === 'source' ? size : 0), y: resource.positions[mode].y + (container?22:mode === 'visual' ? size / 2 : 100) }; }
	const item = architecture.items.find(item => item.id === id && item.kind !== 'frame');
	return item ? { x: item.positions[mode].x + (side === 'source' ? item.width : 0), y: item.positions[mode].y + item.height / 2 } : undefined;
}
