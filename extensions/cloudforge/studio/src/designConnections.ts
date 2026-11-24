import type { Architecture, DesignMode } from './model.ts';

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
	if (resource) { return { x: resource.positions[mode].x + (side === 'source' ? 78 : 18), y: resource.positions[mode].y + 20 }; }
	const item = architecture.items.find(item => item.id === id && item.kind !== 'frame');
	return item ? { x: item.positions[mode].x + (side === 'source' ? item.width : 0), y: item.positions[mode].y + item.height / 2 } : undefined;
}
