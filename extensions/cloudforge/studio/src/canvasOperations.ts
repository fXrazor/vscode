/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, BoardItem, DesignMode, Position, ResourceBlock } from './model.ts';
import type { ShapeId } from './shapes.ts';
import { bindingKey, bindingTarget } from './fieldBindings.ts';
import { fitResourceContainers, isResourceContainer, resourceDimensions, visualAncestors, visualDescendants, containedDescendants } from './resourceHierarchy.ts';
import { iconSizeLimits, resourceIconSize } from './resourceGeometry.ts';
import { connectionElementIds, elementEndpoint, endpointElementId, pointEndpoint, remapEndpoint, type EndpointPort } from './connectionEndpoints.ts';
import { connectionAnchor } from './designConnections.ts';
import { projectResize, resizeAnchors, resizeLimits, type ResizeAnchor, type ResizeBox } from './resizeGeometry.ts';
export { resizeAnchorPoint, resizeAnchors, resizeLimits, type ResizeAnchor } from './resizeGeometry.ts';

export type TextAppearance = Pick<BoardItem, 'fontSize' | 'bold' | 'italic' | 'underline' | 'textColor' | 'fontFamily' | 'textAlign' | 'verticalAlign' | 'fill' | 'opacity' | 'strokeColor' | 'strokeWidth' | 'strokeStyle'>;
export type CanvasCommand =
	| { kind: 'move'; mode: DesignMode; positions: Record<string, Position>; fit?: boolean }
	| { kind: 'style'; ids: string[]; patch: Partial<TextAppearance> }
	| { kind: 'lock'; ids: string[]; locked: boolean }
	| { kind: 'delete'; ids: string[] }
	| { kind: 'group'; ids: string[]; id: string }
	| { kind: 'ungroup'; ids: string[] }
	| { kind: 'arrange'; ids: string[]; direction: 'front' | 'forward' | 'backward' | 'back' }
	| { kind: 'duplicate'; fragment: Architecture; idMap: Record<string, string>; offset: number; offsetY?: number }
	/** Multi-object resize in one undo step, keeping the chosen corner fixed (top-left by default). */
	| { kind: 'resize'; ids: string[]; mode: DesignMode; scale?: number; match?: 'width' | 'height' | 'size'; anchor?: ResizeAnchor }
	/** Rotate drawings about their centres: `angle` sets an absolute angle, `by` turns each one. Resources stay upright. */
	| { kind: 'rotate'; ids: string[]; angle?: number; by?: number }
	/** Miro-style wrap selection in a new frame sized to fit its members (1 atomic undo step). */
	| { kind: 'frameSelection'; ids: string[]; id: string; mode: DesignMode; sizes?: Record<string, { width: number; height: number }>; label?: string }
	/** Resize an existing frame tightly around its members (or visually enclosed elements if empty). */
	| { kind: 'fitFrame'; id: string; mode: DesignMode; sizes?: Record<string, { width: number; height: number }> }
	/** Miro-style Switch Type: convert sticky notes, shapes, and text boxes in place while preserving text, geometry, and links. */
	| { kind: 'convertItem'; ids: string[]; targetKind: 'note' | 'shape' | 'text'; shape?: ShapeId }
	/** Miro-style flowchart speed shortcut (Ctrl+Arrow): spawn a matching element in a direction and connect with directional ports. */
	| { kind: 'spawnConnected'; sourceId: string; id: string; connectionId: string; direction: 'right' | 'left' | 'up' | 'down'; mode: DesignMode }
	/** Atomic multi-item insertion (e.g. Miro paste-lines-as-sticky-notes cluster in 1 undo step). */
	| { kind: 'addItems'; items: BoardItem[] };

const pasteNotePalette = ['#fff0b5', '#d3f9d8', '#d0ebff', '#e5dbff', '#ffe3c4', '#ffd6e7'] as const;

/** Parse pasted text lines (stripping bullets/numbering) into a tidy Miro sticky-note grid. */
export function stickyClusterFromText(text: string, origin: Position, makeId: () => string, maxItems = 24): BoardItem[] {
	const lines = text
		.split(/\r?\n/)
		.map(line => line.trim().replace(/^(?:[-*•▪◦]+|\d+[.)])\s+/, '').trim())
		.filter(Boolean)
		.slice(0, maxItems);
	if (!lines.length) { return []; }
	const width = 200; const height = 128; const gap = 24;
	const cols = lines.length <= 3 ? lines.length : Math.min(4, Math.ceil(Math.sqrt(lines.length)));
	const rows = Math.ceil(lines.length / cols);
	const totalW = cols * width + (cols - 1) * gap;
	const totalH = rows * height + (rows - 1) * gap;
	const startX = Math.round(origin.x - totalW / 2);
	const startY = Math.round(origin.y - totalH / 2);
	return lines.map((line, index) => {
		const col = index % cols; const row = Math.floor(index / cols);
		const pos = { x: startX + col * (width + gap), y: startY + row * (height + gap) };
		return {
			id: makeId(),
			kind: 'note',
			text: line.slice(0, 400),
			fill: lines.length === 1 ? '#fff0b5' : pasteNotePalette[row % pasteNotePalette.length],
			width,
			height,
			positions: { visual: pos, technical: pos },
			members: [],
		};
	});
}

/** BFS across design connections to find all elements connected to the current selection (Miro Select Connected). */
export function connectedElementIds(architecture: Architecture, seedIds: readonly string[]): string[] {
	const valid = new Set(canvasElements(architecture).map(item => item.id));
	const visited = new Set(expandGroups(architecture, [...seedIds]).filter(id => valid.has(id)));
	if (!visited.size) { return []; }
	const adjacency = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		if (!adjacency.has(a)) { adjacency.set(a, new Set()); }
		adjacency.get(a)!.add(b);
	};
	for (const edge of architecture.connections) {
		const s = endpointElementId(edge.source); const t = endpointElementId(edge.target);
		if (s && t && valid.has(s) && valid.has(t)) { link(s, t); link(t, s); }
	}
	const queue = [...visited];
	while (queue.length) {
		const current = queue.shift()!;
		for (const next of adjacency.get(current) ?? []) {
			if (!visited.has(next)) { visited.add(next); queue.push(next); }
		}
	}
	return expandGroups(architecture, [...visited]);
}

/** Degrees in [0, 360), rounded to 0.1°; 0 is stored as undefined so unrotated drawings stay unchanged. */
export function normaliseRotation(degrees: number): number | undefined {
	const value = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
	return value === 0 || value === 360 ? undefined : value;
}

export function canvasElements(architecture: Architecture) { return [...architecture.resources, ...architecture.items]; }

export function expandGroups(architecture: Architecture, ids: string[]): string[] {
	const selected = new Set(ids.filter(id => canvasElements(architecture).some(element => element.id === id)));
	for (const group of architecture.groups ?? []) { if (group.members.some(id => selected.has(id))) { group.members.forEach(id => selected.add(id)); } }
	return [...selected];
}

/** One eligibility policy for the command, Size menu and selection resize frame. */
export function resizeTargets(architecture: Architecture, ids: string[], mode: DesignMode) {
	const selected = new Set(expandGroups(architecture, ids));
	return {
		items: architecture.items.filter(item => selected.has(item.id) && !item.canvasLocked),
		icons: mode === 'visual' ? architecture.resources.filter(resource => selected.has(resource.id) && !resource.canvasLocked && !isResourceContainer(resource)) : []
	};
}

export function resizeSelectionBoxes(architecture: Architecture, ids: string[], mode: DesignMode): ResizeBox[] {
	const { items, icons } = resizeTargets(architecture, ids, mode);
	return [
		...items.map(item => ({ id: item.id, ...item.positions[mode], width: item.width, height: item.height, min: resizeLimits.minItem, max: resizeLimits.maxItem })),
		...icons.map(icon => ({ id: icon.id, ...icon.positions.visual, width: resourceIconSize(icon), height: resourceIconSize(icon), min: iconSizeLimits.min, max: iconSizeLimits.max }))
	];
}

export function sceneOrder(architecture: Architecture): string[] {
	const frames = architecture.items.filter(item => item.kind === 'frame').map(item => item.id);
	const defaultOrder = [...architecture.resources.map(item => item.id), ...architecture.items.filter(item => item.kind !== 'frame').map(item => item.id)];
	const known = new Set(defaultOrder);
	const containers = architecture.resources.filter(isResourceContainer).sort((a,b)=>visualAncestors(architecture,a).length-visualAncestors(architecture,b).length).map(item=>item.id);
	return [...frames,...containers,...new Set([...(architecture.layerOrder ?? []).filter(id => known.has(id)&&!containers.includes(id)), ...defaultOrder.filter(id=>!containers.includes(id))])];
}

export function selectionFragment(architecture: Architecture, ids: string[], connectionIds: string[] = [], mode: DesignMode = 'visual'): Architecture {
	const selected = new Set(expandGroups(architecture, ids));
	for (const frame of architecture.items.filter(item => item.kind === 'frame' && selected.has(item.id))) { frame.members.forEach(id => selected.add(id)); }
	for (const resource of architecture.resources.filter(item=>selected.has(item.id))) { visualDescendants(architecture,resource.id).forEach(item=>selected.add(item.id)); }
	const connections = architecture.connections.flatMap(link => {
		// Copy source-derived relationships only through copied field bindings, never as invented service evidence.
		if (link.origin?.kind === 'service' || link.id.includes('->')) { return []; }
		const endpoints = connectionElementIds(link);
		if (endpoints.length && endpoints.every(id => selected.has(id))) { return [link]; }
		if (!connectionIds.includes(link.id)) { return []; }
		// Copying a line alone copies its geometry, without duplicating infrastructure resources.
		const source = connectionAnchor(architecture, link.source, 'source', mode); const target = connectionAnchor(architecture, link.target, 'target', mode);
		return source && target ? [{ ...link, source: pointEndpoint(source), target: pointEndpoint(target) }] : [];
	});
	return structuredClone({ name: architecture.name, resources: architecture.resources.filter(item => selected.has(item.id)), items: architecture.items.filter(item => selected.has(item.id)), connections, groups: (architecture.groups ?? []).filter(group => group.members.every(id => selected.has(id))), layerOrder: sceneOrder(architecture).filter(id => selected.has(id)) });
}

export function applyCanvasCommand(architecture: Architecture, command: CanvasCommand): Architecture {
	const elements = canvasElements(architecture); const byId = new Map(elements.map(element => [element.id, element]));
	const expanded = Object.hasOwn(command, 'ids') ? expandGroups(architecture, (command as { ids: string[] }).ids) : [];
	const editable = new Set(expanded.filter(id => !byId.get(id)?.canvasLocked));
	switch (command.kind) {
		case 'move': {
			if (Object.values(command.positions).some(position => !Number.isFinite(position.x) || !Number.isFinite(position.y))) { return architecture; }
			const pinnedContainers=new Set(architecture.resources.filter(resource=>isResourceContainer(resource)&&visualDescendants(architecture,resource.id).some(child=>child.canvasLocked)).map(resource=>resource.id));
			const destinations = new Map(Object.entries(command.positions).filter(([id]) => byId.has(id) && !byId.get(id)?.canvasLocked && !pinnedContainers.has(id)));
			// A moved frame owns the delta for its children, even if a child was also selected.
			for (const frame of architecture.items.filter(item => item.kind === 'frame' && destinations.has(item.id))) {
				const next = destinations.get(frame.id)!; const before = frame.positions[command.mode];
				for (const id of frame.members) { const child = byId.get(id); if (child && !child.canvasLocked) { destinations.set(id, { x: child.positions[command.mode].x + next.x - before.x, y: child.positions[command.mode].y + next.y - before.y }); } }
			}
			for (const container of architecture.resources.filter(item=>destinations.has(item.id)&&isResourceContainer(item)).sort((a,b)=>visualAncestors(architecture,a).length-visualAncestors(architecture,b).length)) {
				const next = destinations.get(container.id)!; const before = container.positions[command.mode];
				for (const child of visualDescendants(architecture,container.id)) { if (!child.canvasLocked) { destinations.set(child.id,{x:child.positions[command.mode].x+next.x-before.x,y:child.positions[command.mode].y+next.y-before.y}); } }
			}
			const changed = [...destinations].some(([id, position]) => { const before = byId.get(id)!.positions[command.mode]; return before.x !== position.x || before.y !== position.y; });
			if (!changed) { return architecture; }
			const move = <T extends typeof elements[number]>(element: T): T => destinations.has(element.id) ? { ...element, positions: { visual:destinations.get(element.id)!,technical:destinations.get(element.id)! } } : element;
			const next = { ...architecture, resources: architecture.resources.map(move), items: architecture.items.map(move) };
			return command.fit===false?next:fitResourceContainers(next);
		}
		case 'style': {
			const patch = command.patch;
			if (patch.fontSize !== undefined && (!Number.isFinite(patch.fontSize) || patch.fontSize < 10 || patch.fontSize > 128)
				|| patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0.1 || patch.opacity > 1)
				|| patch.strokeWidth !== undefined && (!Number.isFinite(patch.strokeWidth) || patch.strokeWidth < 1 || patch.strokeWidth > 8)
				|| patch.fontFamily !== undefined && !['sans', 'serif', 'mono'].includes(patch.fontFamily)
				|| patch.textAlign !== undefined && !['left', 'center', 'right'].includes(patch.textAlign)
				|| patch.verticalAlign !== undefined && !['top', 'middle', 'bottom'].includes(patch.verticalAlign)
				|| patch.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(patch.strokeStyle)
				|| [patch.textColor, patch.strokeColor].some(value => value !== undefined && !/^#[0-9a-f]{6}$/i.test(value))
				|| patch.fill !== undefined && patch.fill !== 'transparent' && !/^#[0-9a-f]{6}$/i.test(patch.fill)) { return architecture; }
			let changed = false;
			const items = architecture.items.map(item => {
				if (!editable.has(item.id) || Object.entries(patch).every(([key, value]) => item[key as keyof BoardItem] === value)) { return item; }
				changed = true;
				const next = { ...item, ...patch };
				if (Object.hasOwn(patch, 'fontSize') && patch.fontSize === undefined) { delete next.fontSize; }
				return next;
			});
			return changed ? { ...architecture, items } : architecture;
		}
		case 'rotate': {
			if ([command.angle, command.by].every(value => value === undefined) || [command.angle, command.by].some(value => value !== undefined && !Number.isFinite(value))) { return architecture; }
			const targets = new Set(expandGroups(architecture, command.ids));
			let changed = false;
			const items = architecture.items.map(item => {
				if (!targets.has(item.id) || item.canvasLocked || item.kind === 'frame') { return item; }
				const rotation = normaliseRotation(command.angle ?? (item.rotation ?? 0) + command.by!);
				if (rotation === item.rotation) { return item; }
				changed = true; const next = { ...item, rotation }; if (rotation === undefined) { delete next.rotation; } return next;
			});
			return changed ? { ...architecture, items } : architecture;
		}
		case 'lock': {
			const selected = new Set(expanded);
			if (!elements.some(item => selected.has(item.id) && !!item.canvasLocked !== command.locked)) { return architecture; }
			return { ...architecture, resources: architecture.resources.map(item => selected.has(item.id) ? { ...item, canvasLocked: command.locked } : item), items: architecture.items.map(item => selected.has(item.id) ? { ...item, canvasLocked: command.locked } : item) };
		}
		case 'delete': {
			for (const resource of architecture.resources.filter(item=>editable.has(item.id))) {
				const descendants = containedDescendants(architecture,resource.id);
				if (descendants.some(item=>item.canvasLocked)) { editable.delete(resource.id); }
				else { descendants.forEach(item=>editable.add(item.id)); }
			}
			if (!editable.size) { return architecture; }
			return { ...architecture, resources: architecture.resources.filter(item => !editable.has(item.id)), items: architecture.items.filter(item => !editable.has(item.id)).map(item => ({ ...item, members: item.members.filter(id => !editable.has(id)) })), connections: architecture.connections.filter(link => !connectionElementIds(link).some(id => editable.has(id))), groups: (architecture.groups ?? []).map(group => ({ ...group, members: group.members.filter(id => !editable.has(id)) })).filter(group => group.members.length > 1), layerOrder: sceneOrder(architecture).filter(id => !editable.has(id)) };
		}
		case 'group': {
			if (expanded.length < 2 || expanded.some(id => byId.get(id)?.canvasLocked) || !command.id || (architecture.groups ?? []).some(group => group.id === command.id)) { return architecture; }
			const members = [...new Set(expanded)];
			return { ...architecture, groups: [...(architecture.groups ?? []).filter(group => !group.members.some(id => members.includes(id))), { id: command.id, label: 'Visual group', members }] };
		}
		case 'ungroup': {
			const groups = (architecture.groups ?? []).filter(group => !group.members.some(id => editable.has(id)));
			return groups.length !== (architecture.groups ?? []).length ? { ...architecture, groups } : architecture;
		}
		case 'arrange': {
			const order = sceneOrder(architecture); const frames = new Set([...architecture.items.filter(item => item.kind === 'frame').map(item => item.id),...architecture.resources.filter(isResourceContainer).map(item=>item.id)]);
			const selected = new Set([...editable].filter(id => !frames.has(id))); const before = order.join('|');
			let next = [...order];
			if (command.direction === 'front') { next = [...order.filter(id => !selected.has(id)), ...order.filter(id => selected.has(id))]; }
			else if (command.direction === 'back') { next = [...order.filter(id => frames.has(id)), ...order.filter(id => selected.has(id)), ...order.filter(id => !frames.has(id) && !selected.has(id))]; }
			else if (command.direction === 'forward') { for (let index = next.length - 2; index >= 0; index--) { if (selected.has(next[index]) && !selected.has(next[index + 1])) { [next[index], next[index + 1]] = [next[index + 1], next[index]]; } } }
			else { for (let index = 1; index < next.length; index++) { if (selected.has(next[index]) && !selected.has(next[index - 1]) && !frames.has(next[index - 1])) { [next[index], next[index - 1]] = [next[index - 1], next[index]]; } } }
			return before === next.join('|') ? architecture : { ...architecture, layerOrder: next };
		}
		case 'resize': {
			const scale = command.scale;
			if (command.anchor !== undefined && !resizeAnchors.includes(command.anchor)) { return architecture; }
			if (!command.match && (scale === undefined || !Number.isFinite(scale) || scale < resizeLimits.minScale || scale > resizeLimits.maxScale || scale === 1)) { return architecture; }
			// Containers fit their children and technical-view cards have fixed widths, so only drawings and visual icons resize.
			const { items, icons } = resizeTargets(architecture, command.ids, command.mode);
			if (items.length + icons.length < (command.match ? 2 : 1)) { return architecture; }
			const clampItem = (value: number) => Math.round(Math.max(resizeLimits.minItem, Math.min(resizeLimits.maxItem, value)));
			const clampIcon = (value: number) => Math.round(Math.max(iconSizeLimits.min, Math.min(iconSizeLimits.max, value)));
			const itemPatch = new Map<string, Partial<BoardItem>>(); const iconPatch = new Map<string, { iconSize: number; position?: Position }>();
			if (command.match) {
				const width = Math.max(...items.map(item => item.width), ...icons.map(resourceIconSize));
				const height = Math.max(...items.map(item => item.height), ...icons.map(resourceIconSize));
				for (const item of items) { itemPatch.set(item.id, { ...(command.match !== 'height' ? { width: clampItem(width) } : {}), ...(command.match !== 'width' ? { height: clampItem(height) } : {}) }); }
				const side = command.match === 'height' ? height : command.match === 'width' ? width : Math.max(width, height);
				for (const icon of icons) { iconPatch.set(icon.id, { iconSize: clampIcon(side) }); }
			} else {
				const projection = projectResize(resizeSelectionBoxes(architecture, command.ids, command.mode), scale!, command.anchor);
				if (!projection) { return architecture; }
				const boxes = new Map(projection.boxes.map(box => [box.id, box]));
				for (const item of items) {
					const box = boxes.get(item.id)!; const position = { x: box.x, y: box.y };
					itemPatch.set(item.id, { width: box.width, height: box.height, positions: { visual: position, technical: position } });
				}
				for (const icon of icons) { const box = boxes.get(icon.id)!; iconPatch.set(icon.id, { iconSize: box.width, position: { x: box.x, y: box.y } }); }
			}
			let changed = false;
			const nextItems = architecture.items.map(item => {
				const patch = itemPatch.get(item.id); if (!patch) { return item; }
				const next = { ...item, ...patch };
				if (next.width === item.width && next.height === item.height && next.positions[command.mode].x === item.positions[command.mode].x && next.positions[command.mode].y === item.positions[command.mode].y) { return item; }
				changed = true; return next;
			});
			const nextResources = architecture.resources.map(resource => {
				const patch = iconPatch.get(resource.id); if (!patch) { return resource; }
				const position = patch.position ?? resource.positions.visual;
				if (patch.iconSize === resourceIconSize(resource) && position.x === resource.positions.visual.x && position.y === resource.positions.visual.y) { return resource; }
				changed = true; return { ...resource, iconSize: patch.iconSize, positions: { visual: position, technical: position } };
			});
			return changed ? fitResourceContainers({ ...architecture, items: nextItems, resources: nextResources }) : architecture;
		}
		case 'duplicate': {
			const fragment = command.fragment; const idMap = command.idMap;
			const dx = command.offset; const dy = command.offsetY ?? command.offset;
			const source = canvasElements(fragment); const newIds = source.map(item => idMap[item.id]);
			if (newIds.some(id => !id || byId.has(id)) || new Set(newIds).size !== newIds.length || !Number.isFinite(dx) || !Number.isFinite(dy)) { return architecture; }
			const names = new Set(architecture.resources.map(resource => resource.name)); const terraformNames = new Set(architecture.resources.map(resource => resource.terraformName ?? resource.name));
			const offset = (positions: Record<DesignMode, Position>) => Object.fromEntries(Object.entries(positions).map(([mode, position]) => [mode, { x: position.x + dx, y: position.y + dy }])) as Record<DesignMode, Position>;
			const resources = structuredClone(fragment.resources).map(resource => {
				let index = 1; let name = resource.name + '-copy'; while (names.has(name)) { name = resource.name + '-copy-' + ++index; } names.add(name);
				const base = (resource.terraformName ?? resource.name).replace(/[^A-Za-z0-9_-]/g, '_').replace(/^(?=[0-9-])/, '_');
				let terraformName = base + '_copy'; index = 1; while (terraformNames.has(terraformName)) { terraformName = base + '_copy_' + ++index; } terraformNames.add(terraformName);
				const cloneBlocks = (blocks: ResourceBlock[]): ResourceBlock[] => blocks.map(block => ({ ...block, id: idMap[resource.id] + ':' + block.id, blocks: cloneBlocks(block.blocks) }));
				const fieldBindings = resource.fieldBindings && Object.fromEntries(Object.entries(resource.fieldBindings).map(([key, binding]) => { const target = bindingTarget(key); return [target?.kind === 'block' ? bindingKey({...target,blockId:idMap[resource.id] + ':' + target.blockId}) : key,binding]; }));
				const resourceRefs = resource.resourceRefs && Object.fromEntries(Object.entries(resource.resourceRefs).map(([key, binding]) => { const target = bindingTarget(key); return [target?.kind === 'block' ? bindingKey({...target,blockId:idMap[resource.id] + ':' + target.blockId}) : key,{ refs: binding.refs.map(entry => ({ resourceId: idMap[entry.resourceId] ?? entry.resourceId, attribute: entry.attribute })), ...(binding.items ? { items: binding.items.map(entry => entry.kind === 'ref' ? { ...entry, resourceId: idMap[entry.resourceId] ?? entry.resourceId } : { ...entry }) } : {}) }]; }));
				return { ...resource, id: idMap[resource.id], parentId:resource.parentId?(idMap[resource.parentId]??(architecture.resources.some(item=>item.id===resource.parentId)?resource.parentId:undefined)):undefined, visualParentId:resource.visualParentId?(idMap[resource.visualParentId]??(architecture.resources.some(item=>item.id===resource.visualParentId)?resource.visualParentId:undefined)):resource.visualParentId, name, terraformName, fieldBindings, resourceRefs, blocks: cloneBlocks(resource.blocks), canvasLocked: false, positions: offset(resource.positions) };
			});
			const items = structuredClone(fragment.items).map(item => ({ ...item, id: idMap[item.id], canvasLocked: false, positions: offset(item.positions), members: item.members.map(id => idMap[id]).filter(Boolean) }));
			const groups = (fragment.groups ?? []).map(group => ({ ...group, id: idMap[group.id], members: group.members.map(id => idMap[id]).filter(Boolean) })).filter(group => group.id && group.members.length > 1);
			const connections = fragment.connections.flatMap(link => {
				const source = remapEndpoint(link.source, idMap, dx, dy); const target = remapEndpoint(link.target, idMap, dx, dy);
				if (!source || !target) { return []; }
				const sourceId = endpointElementId(source); const targetId = endpointElementId(target);
				const waypoint = link.waypoint ? { x: link.waypoint.x + dx, y: link.waypoint.y + dy } : undefined;
				return [{ ...link, id: idMap[link.id] ?? (sourceId && targetId ? sourceId + '-' + targetId : link.id + '-copy'), source, target, ...(waypoint ? { waypoint } : {}) }];
			});
			if ((!source.length && !connections.length) || new Set(connections.map(link => link.id)).size !== connections.length || connections.some(link => architecture.connections.some(existing => existing.id === link.id))) { return architecture; }
			return { ...architecture, resources: [...architecture.resources, ...resources], items: [...architecture.items, ...items], groups: [...(architecture.groups ?? []), ...groups], connections: [...architecture.connections, ...connections], layerOrder: [...sceneOrder(architecture), ...sceneOrder(fragment).map(id => idMap[id])] };
		}
		case 'frameSelection': {
			if (!command.id || byId.has(command.id)) { return architecture; }
			const members = [...editable].filter(id => !architecture.items.some(item => item.id === id && item.kind === 'frame'));
			if (!members.length) { return architecture; }
			const boxOf = (id: string) => {
				const element = byId.get(id)!;
				const pos = element.positions[command.mode];
				if (command.sizes?.[id]) { return { x: pos.x, y: pos.y, width: command.sizes[id].width, height: command.sizes[id].height }; }
				if (Object.hasOwn(element, 'width')) { const item = element as BoardItem; return { x: pos.x, y: pos.y, width: item.width, height: item.height }; }
				const resource = architecture.resources.find(item => item.id === id)!;
				if (isResourceContainer(resource)) { const dim = resourceDimensions(architecture, resource, command.mode); return { x: pos.x, y: pos.y, width: dim.width, height: dim.height }; }
				const side = command.mode === 'visual' ? resourceIconSize(resource) : 220;
				return { x: pos.x, y: pos.y, width: side, height: command.mode === 'visual' ? side : 120 };
			};
			const boxes = members.map(boxOf);
			const minX = Math.min(...boxes.map(box => box.x)); const minY = Math.min(...boxes.map(box => box.y));
			const maxX = Math.max(...boxes.map(box => box.x + box.width)); const maxY = Math.max(...boxes.map(box => box.y + box.height));
			const pos = { x: Math.round(minX - 36), y: Math.round(minY - 40) };
			const width = Math.max(240, Math.round(maxX - minX + 72));
			const height = Math.max(160, Math.round(maxY - minY + 76));
			const frameIndex = architecture.items.filter(item => item.kind === 'frame').length + 1;
			const frame: BoardItem = { id: command.id, kind: 'frame', text: command.label?.trim() || 'Frame ' + frameIndex, width, height, positions: { visual: pos, technical: pos }, members };
			const memberSet = new Set(members);
			const items = [...architecture.items.map(item => item.kind === 'frame' ? { ...item, members: item.members.filter(id => !memberSet.has(id)) } : item), frame];
			return { ...architecture, items, layerOrder: [command.id, ...sceneOrder(architecture)] };
		}
		case 'fitFrame': {
			const frame = architecture.items.find(item => item.id === command.id && item.kind === 'frame');
			if (!frame || frame.canvasLocked) { return architecture; }
			const boxOf = (id: string) => {
				const element = byId.get(id)!;
				const pos = element.positions[command.mode];
				if (command.sizes?.[id]) { return { x: pos.x, y: pos.y, width: command.sizes[id].width, height: command.sizes[id].height }; }
				if (Object.hasOwn(element, 'width')) { const item = element as BoardItem; return { x: pos.x, y: pos.y, width: item.width, height: item.height }; }
				const resource = architecture.resources.find(item => item.id === id)!;
				if (isResourceContainer(resource)) { const dim = resourceDimensions(architecture, resource, command.mode); return { x: pos.x, y: pos.y, width: dim.width, height: dim.height }; }
				const side = command.mode === 'visual' ? resourceIconSize(resource) : 220;
				return { x: pos.x, y: pos.y, width: side, height: command.mode === 'visual' ? side : 120 };
			};
			let members = frame.members.filter(id => byId.has(id) && id !== frame.id);
			if (!members.length) {
				const fp = frame.positions[command.mode];
				members = elements.filter(element => {
					if (element.id === frame.id || element.canvasLocked) { return false; }
					if (architecture.items.some(item => item.id === element.id && item.kind === 'frame')) { return false; }
					const box = boxOf(element.id);
					const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
					return cx >= fp.x && cx <= fp.x + frame.width && cy >= fp.y && cy <= fp.y + frame.height;
				}).map(element => element.id);
			}
			if (!members.length) { return architecture; }
			const boxes = members.map(boxOf);
			const minX = Math.min(...boxes.map(box => box.x)); const minY = Math.min(...boxes.map(box => box.y));
			const maxX = Math.max(...boxes.map(box => box.x + box.width)); const maxY = Math.max(...boxes.map(box => box.y + box.height));
			const pos = { x: Math.round(minX - 36), y: Math.round(minY - 40) };
			const width = Math.max(200, Math.round(maxX - minX + 72));
			const height = Math.max(140, Math.round(maxY - minY + 76));
			const unchanged = frame.positions[command.mode].x === pos.x && frame.positions[command.mode].y === pos.y && frame.width === width && frame.height === height && frame.members.length === members.length && frame.members.every((id, index) => id === members[index]);
			if (unchanged) { return architecture; }
			const memberSet = new Set(members);
			const items = architecture.items.map(item => item.id === frame.id ? { ...item, width, height, positions: { visual: pos, technical: pos }, members } : item.kind === 'frame' ? { ...item, members: item.members.filter(id => !memberSet.has(id)) } : item);
			return { ...architecture, items };
		}
		case 'convertItem': {
			const convertible = new Set(['note', 'shape', 'text']);
			let changed = false;
			const items = architecture.items.map(item => {
				if (!editable.has(item.id) || !convertible.has(item.kind)) { return item; }
				const nextShape = command.targetKind === 'shape' ? (command.shape ?? item.shape ?? 'rectangle') : undefined;
				if (item.kind === command.targetKind && item.shape === nextShape) { return item; }
				changed = true;
				const next: BoardItem = { ...item, kind: command.targetKind };
				if (nextShape) { next.shape = nextShape; } else { delete next.shape; }
				if (command.targetKind === 'note' && (!next.fill || next.fill === 'transparent')) { next.fill = '#fff0b5'; }
				if (command.targetKind === 'text' && next.fill === '#fff0b5') { next.fill = 'transparent'; }
				return next;
			});
			return changed ? { ...architecture, items } : architecture;
		}
		case 'spawnConnected': {
			if (!command.id || !command.connectionId || byId.has(command.id) || architecture.connections.some(link => link.id === command.connectionId)) { return architecture; }
			const source = architecture.items.find(item => item.id === command.sourceId && !item.canvasLocked && (item.kind === 'note' || item.kind === 'shape' || item.kind === 'text'));
			if (!source) { return architecture; }
			const gap = 72;
			const origin = source.positions[command.mode];
			const pos: Position = command.direction === 'right' ? { x: origin.x + source.width + gap, y: origin.y }
				: command.direction === 'left' ? { x: origin.x - source.width - gap, y: origin.y }
				: command.direction === 'down' ? { x: origin.x, y: origin.y + source.height + gap }
				: { x: origin.x, y: origin.y - source.height - gap };
			const ports: Record<'right' | 'left' | 'up' | 'down', [EndpointPort, EndpointPort]> = {
				right: ['output', 'input'],
				left: ['input', 'output'],
				down: ['bottom', 'top'],
				up: ['top', 'bottom'],
			};
			const [fromPort, toPort] = ports[command.direction];
			const spawned: BoardItem = { ...source, id: command.id, text: '', positions: { visual: pos, technical: pos }, members: [], canvasLocked: false };
			const link = { id: command.connectionId, source: elementEndpoint(source.id, fromPort), target: elementEndpoint(command.id, toPort), routing: 'elbow' as const };
			return { ...architecture, items: [...architecture.items, spawned], connections: [...architecture.connections, link], layerOrder: [...sceneOrder(architecture), command.id] };
		}
		case 'addItems': {
			if (!command.items.length || command.items.some(item => !item.id || byId.has(item.id)) || new Set(command.items.map(item => item.id)).size !== command.items.length) { return architecture; }
			return { ...architecture, items: [...architecture.items, ...command.items], layerOrder: [...sceneOrder(architecture), ...command.items.map(item => item.id)] };
		}
	}
}
