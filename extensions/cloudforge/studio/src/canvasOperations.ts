/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, BoardItem, DesignMode, Position, ResourceBlock } from './model.ts';
import { bindingKey, bindingTarget } from './fieldBindings.ts';
import { fitResourceContainers, isResourceContainer, resourceAncestors, resourceDescendants } from './resourceHierarchy.ts';
import { iconSizeLimits, resourceIconSize } from './resourceGeometry.ts';

export type TextAppearance = Pick<BoardItem, 'fontSize' | 'bold' | 'italic' | 'underline' | 'textColor' | 'fontFamily' | 'textAlign' | 'verticalAlign' | 'fill' | 'opacity' | 'strokeColor' | 'strokeWidth' | 'strokeStyle'>;
export const resizeAnchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ResizeAnchor = typeof resizeAnchors[number];

/** World-space fixed corner of an unrotated selection bounds rectangle. */
export function resizeAnchorPoint(bounds: { x: number; y: number; width: number; height: number }, anchor: ResizeAnchor): Position {
	return { x: bounds.x + (anchor.endsWith('right') ? bounds.width : 0), y: bounds.y + (anchor.startsWith('bottom') ? bounds.height : 0) };
}

export type CanvasCommand =
	| { kind: 'move'; mode: DesignMode; positions: Record<string, Position>; fit?: boolean }
	| { kind: 'style'; ids: string[]; patch: Partial<TextAppearance> }
	| { kind: 'lock'; ids: string[]; locked: boolean }
	| { kind: 'delete'; ids: string[] }
	| { kind: 'group'; ids: string[]; id: string }
	| { kind: 'ungroup'; ids: string[] }
	| { kind: 'arrange'; ids: string[]; direction: 'front' | 'forward' | 'backward' | 'back' }
	| { kind: 'duplicate'; fragment: Architecture; idMap: Record<string, string>; offset: number }
	/** Multi-object resize in one undo step, keeping the chosen corner fixed (top-left by default). */
	| { kind: 'resize'; ids: string[]; mode: DesignMode; scale?: number; match?: 'width' | 'height' | 'size'; anchor?: ResizeAnchor }
	/** Rotate drawings about their centres: `angle` sets an absolute angle, `by` turns each one. Resources stay upright. */
	| { kind: 'rotate'; ids: string[]; angle?: number; by?: number };

/** Degrees in [0, 360), rounded to 0.1°; 0 is stored as undefined so unrotated drawings stay unchanged. */
export function normaliseRotation(degrees: number): number | undefined {
	const value = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
	return value === 0 || value === 360 ? undefined : value;
}

export const resizeLimits = { minScale: 0.25, maxScale: 4, minItem: 24, maxItem: 4000 };

export function canvasElements(architecture: Architecture) { return [...architecture.resources, ...architecture.items]; }

export function expandGroups(architecture: Architecture, ids: string[]): string[] {
	const selected = new Set(ids.filter(id => canvasElements(architecture).some(element => element.id === id)));
	for (const group of architecture.groups ?? []) { if (group.members.some(id => selected.has(id))) { group.members.forEach(id => selected.add(id)); } }
	return [...selected];
}

export function sceneOrder(architecture: Architecture): string[] {
	const frames = architecture.items.filter(item => item.kind === 'frame').map(item => item.id);
	const defaultOrder = [...architecture.resources.map(item => item.id), ...architecture.items.filter(item => item.kind !== 'frame').map(item => item.id)];
	const known = new Set(defaultOrder);
	const containers = architecture.resources.filter(isResourceContainer).sort((a,b)=>resourceAncestors(architecture,a).length-resourceAncestors(architecture,b).length).map(item=>item.id);
	return [...frames,...containers,...new Set([...(architecture.layerOrder ?? []).filter(id => known.has(id)&&!containers.includes(id)), ...defaultOrder.filter(id=>!containers.includes(id))])];
}

export function selectionFragment(architecture: Architecture, ids: string[]): Architecture {
	const selected = new Set(expandGroups(architecture, ids));
	for (const frame of architecture.items.filter(item => item.kind === 'frame' && selected.has(item.id))) { frame.members.forEach(id => selected.add(id)); }
	for (const resource of architecture.resources.filter(item=>selected.has(item.id))) { resourceDescendants(architecture,resource.id).forEach(item=>selected.add(item.id)); }
	return structuredClone({ name: architecture.name, resources: architecture.resources.filter(item => selected.has(item.id)), items: architecture.items.filter(item => selected.has(item.id)), connections: architecture.connections.filter(link => selected.has(link.source) && selected.has(link.target)), groups: (architecture.groups ?? []).filter(group => group.members.every(id => selected.has(id))), layerOrder: sceneOrder(architecture).filter(id => selected.has(id)) });
}

export function applyCanvasCommand(architecture: Architecture, command: CanvasCommand): Architecture {
	const elements = canvasElements(architecture); const byId = new Map(elements.map(element => [element.id, element]));
	const expanded = 'ids' in command ? expandGroups(architecture, command.ids) : [];
	const editable = new Set(expanded.filter(id => !byId.get(id)?.canvasLocked));
	switch (command.kind) {
		case 'move': {
			if (Object.values(command.positions).some(position => !Number.isFinite(position.x) || !Number.isFinite(position.y))) { return architecture; }
			const pinnedContainers=new Set(architecture.resources.filter(resource=>isResourceContainer(resource)&&resourceDescendants(architecture,resource.id).some(child=>child.canvasLocked)).map(resource=>resource.id));
			const destinations = new Map(Object.entries(command.positions).filter(([id]) => byId.has(id) && !byId.get(id)?.canvasLocked && !pinnedContainers.has(id)));
			// A moved frame owns the delta for its children, even if a child was also selected.
			for (const frame of architecture.items.filter(item => item.kind === 'frame' && destinations.has(item.id))) {
				const next = destinations.get(frame.id)!; const before = frame.positions[command.mode];
				for (const id of frame.members) { const child = byId.get(id); if (child && !child.canvasLocked) { destinations.set(id, { x: child.positions[command.mode].x + next.x - before.x, y: child.positions[command.mode].y + next.y - before.y }); } }
			}
			for (const container of architecture.resources.filter(item=>destinations.has(item.id)&&isResourceContainer(item)).sort((a,b)=>resourceAncestors(architecture,a).length-resourceAncestors(architecture,b).length)) {
				const next = destinations.get(container.id)!; const before = container.positions[command.mode];
				for (const child of resourceDescendants(architecture,container.id)) { if (!child.canvasLocked) { destinations.set(child.id,{x:child.positions[command.mode].x+next.x-before.x,y:child.positions[command.mode].y+next.y-before.y}); } }
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
				changed = true; return { ...item, ...patch };
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
				const descendants = resourceDescendants(architecture,resource.id);
				if (descendants.some(item=>item.canvasLocked)) { editable.delete(resource.id); }
				else { descendants.forEach(item=>editable.add(item.id)); }
			}
			if (!editable.size) { return architecture; }
			return { ...architecture, resources: architecture.resources.filter(item => !editable.has(item.id)), items: architecture.items.filter(item => !editable.has(item.id)).map(item => ({ ...item, members: item.members.filter(id => !editable.has(id)) })), connections: architecture.connections.filter(link => !editable.has(link.source) && !editable.has(link.target)), groups: (architecture.groups ?? []).map(group => ({ ...group, members: group.members.filter(id => !editable.has(id)) })).filter(group => group.members.length > 1), layerOrder: sceneOrder(architecture).filter(id => !editable.has(id)) };
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
			const items = architecture.items.filter(item => editable.has(item.id));
			const icons = command.mode === 'visual' ? architecture.resources.filter(resource => editable.has(resource.id) && !isResourceContainer(resource)) : [];
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
				const left = Math.min(...items.map(item => item.positions[command.mode].x), ...icons.map(icon => icon.positions.visual.x));
				const top = Math.min(...items.map(item => item.positions[command.mode].y), ...icons.map(icon => icon.positions.visual.y));
				const right = Math.max(...items.map(item => item.positions[command.mode].x + item.width), ...icons.map(icon => icon.positions.visual.x + resourceIconSize(icon)));
				const bottom = Math.max(...items.map(item => item.positions[command.mode].y + item.height), ...icons.map(icon => icon.positions.visual.y + resourceIconSize(icon)));
				const anchor = command.anchor ?? 'top-left';
				const origin = resizeAnchorPoint({ x: left, y: top, width: right - left, height: bottom - top }, anchor);
				const place = (position: Position): Position => ({ x: Math.round(origin.x + (position.x - origin.x) * scale!), y: Math.round(origin.y + (position.y - origin.y) * scale!) });
				for (const item of items) { const position = place(item.positions[command.mode]); itemPatch.set(item.id, { width: clampItem(item.width * scale!), height: clampItem(item.height * scale!), positions: { visual: position, technical: position } }); }
				for (const icon of icons) { iconPatch.set(icon.id, { iconSize: clampIcon(resourceIconSize(icon) * scale!), position: place(icon.positions.visual) }); }
				// Size clamps and pixel rounding must not move the fixed corner. Correct the whole
				// resized selection together inside this command, never as a second move/history step.
				const boxes = [
					...items.map(item => { const patch = itemPatch.get(item.id)!; return { ...patch.positions![command.mode], width: patch.width!, height: patch.height! }; }),
					...icons.map(icon => { const patch = iconPatch.get(icon.id)!; return { ...patch.position!, width: patch.iconSize, height: patch.iconSize }; })
				];
				const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
				const after = resizeAnchorPoint({ x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y }, anchor);
				const shift = (position: Position) => ({ x: position.x + origin.x - after.x, y: position.y + origin.y - after.y });
				for (const patch of itemPatch.values()) { const position = shift(patch.positions![command.mode]); patch.positions = { visual: position, technical: position }; }
				for (const patch of iconPatch.values()) { patch.position = shift(patch.position!); }
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
			const source = canvasElements(fragment); const newIds = source.map(item => idMap[item.id]);
			if (!source.length || newIds.some(id => !id || byId.has(id)) || new Set(newIds).size !== newIds.length || !Number.isFinite(command.offset)) { return architecture; }
			const names = new Set(architecture.resources.map(resource => resource.name)); const terraformNames = new Set(architecture.resources.map(resource => resource.terraformName ?? resource.name));
			const offset = (positions: Record<DesignMode, Position>) => Object.fromEntries(Object.entries(positions).map(([mode, position]) => [mode, { x: position.x + command.offset, y: position.y + command.offset }])) as Record<DesignMode, Position>;
			const resources = structuredClone(fragment.resources).map(resource => {
				let index = 1; let name = resource.name + '-copy'; while (names.has(name)) { name = resource.name + '-copy-' + ++index; } names.add(name);
				const base = (resource.terraformName ?? resource.name).replace(/[^A-Za-z0-9_-]/g, '_').replace(/^(?=[0-9-])/, '_');
				let terraformName = base + '_copy'; index = 1; while (terraformNames.has(terraformName)) { terraformName = base + '_copy_' + ++index; } terraformNames.add(terraformName);
				const cloneBlocks = (blocks: ResourceBlock[]): ResourceBlock[] => blocks.map(block => ({ ...block, id: idMap[resource.id] + ':' + block.id, blocks: cloneBlocks(block.blocks) }));
				const fieldBindings = resource.fieldBindings && Object.fromEntries(Object.entries(resource.fieldBindings).map(([key, binding]) => { const target = bindingTarget(key); return [target?.kind === 'block' ? bindingKey({...target,blockId:idMap[resource.id] + ':' + target.blockId}) : key,binding]; }));
				const resourceRefs = resource.resourceRefs && Object.fromEntries(Object.entries(resource.resourceRefs).map(([key, binding]) => { const target = bindingTarget(key); return [target?.kind === 'block' ? bindingKey({...target,blockId:idMap[resource.id] + ':' + target.blockId}) : key,{ refs: binding.refs.map(entry => ({ resourceId: idMap[entry.resourceId] ?? entry.resourceId, attribute: entry.attribute })) }]; }));
				return { ...resource, id: idMap[resource.id], parentId:resource.parentId?(idMap[resource.parentId]??(architecture.resources.some(item=>item.id===resource.parentId)?resource.parentId:undefined)):undefined, name, terraformName, fieldBindings, resourceRefs, blocks: cloneBlocks(resource.blocks), canvasLocked: false, positions: offset(resource.positions) };
			});
			const items = structuredClone(fragment.items).map(item => ({ ...item, id: idMap[item.id], canvasLocked: false, positions: offset(item.positions), members: item.members.map(id => idMap[id]).filter(Boolean) }));
			const groups = (fragment.groups ?? []).map(group => ({ ...group, id: idMap[group.id], members: group.members.map(id => idMap[id]).filter(Boolean) })).filter(group => group.id && group.members.length > 1);
			const connections = fragment.connections.filter(link => idMap[link.source] && idMap[link.target]).map(link => ({ ...link, id: idMap[link.source] + '-' + idMap[link.target], source: idMap[link.source], target: idMap[link.target] }));
			return { ...architecture, resources: [...architecture.resources, ...resources], items: [...architecture.items, ...items], groups: [...(architecture.groups ?? []), ...groups], connections: [...architecture.connections, ...connections], layerOrder: [...sceneOrder(architecture), ...sceneOrder(fragment).map(id => idMap[id])] };
		}
	}
}
