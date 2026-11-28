/*---------------------------------------------------------------------------------------------
 *  Rebase semantic undo history onto a refreshed architecture.
 *--------------------------------------------------------------------------------------------*/

import type { Architecture, DesignConnection, Resource } from './model.ts';
import { endpointExists } from './connectionEndpoints.ts';
import { resourceDefinition } from './fixture.ts';
import { terraformIdentifier } from './resourceHierarchy.ts';

/**
 * Snapshot-based history cannot simply survive a live refresh: undoing would restore a stale
 * architecture and silently discard what the service just reported. Instead, every past and
 * future snapshot is rebased with a three-way merge against the state the refresh replaced
 * (`base`): anything the refresh changed, added or removed is taken from `incoming`, and
 * everything the refresh left alone keeps the snapshot's own state. Undo/redo therefore keep
 * stepping through the user's edits while external changes stay applied in every state.
 */
export interface SnapshotHistory {
	past: Architecture[];
	present: Architecture;
	future: Architecture[];
}

const MAX_PAST = 100;

function same(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	if (Array.isArray(a)) {
		const other = b as unknown[];
		return a.length === other.length && a.every((value, index) => same(value, other[index]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left).filter(key => left[key] !== undefined);
	const otherKeys = Object.keys(right).filter(key => right[key] !== undefined);
	return keys.length === otherKeys.length && keys.every(key => same(left[key], right[key]));
}

function mergeKeyed<T extends { id: string }>(snapshot: readonly T[] | undefined, base: readonly T[] | undefined, incoming: readonly T[] | undefined, mergeEntry?: (snapshot: T, base: T, incoming: T) => T): T[] {
	const baseById = new Map((base ?? []).map(entry => [entry.id, entry]));
	const incomingById = new Map((incoming ?? []).map(entry => [entry.id, entry]));
	const refreshChanged = (id: string) => !same(baseById.get(id), incomingById.get(id));
	const result: T[] = [];
	const seen = new Set<string>();
	for (const entry of snapshot ?? []) {
		seen.add(entry.id);
		if (!refreshChanged(entry.id)) {
			result.push(entry);
		} else {
			const replacement = incomingById.get(entry.id);
			const before = baseById.get(entry.id);
			if (replacement && before && mergeEntry) {
				result.push(mergeEntry(entry, before, replacement));
			} else if (replacement) {
				result.push(structuredClone(replacement));
			}
		}
	}
	for (const entry of incoming ?? []) {
		if (!seen.has(entry.id) && refreshChanged(entry.id)) {
			result.push(structuredClone(entry));
		}
	}
	return result;
}

function mergeValue<T>(snapshot: T, base: T, incoming: T): T {
	return same(base, incoming) ? snapshot : structuredClone(incoming);
}

/**
 * Field-level merge of one resource changed by both the refresh and the user: each property the
 * refresh left alone keeps the user's value, and `settings` merge key by key. So a value edited
 * in the `.tf` file reaches the canvas without discarding an unsaved canvas edit to another field
 * of the same resource. Where both changed the same field, the file wins.
 */
function mergeRecord<T extends object>(snapshot: T, base: T, incoming: T, nested: ReadonlySet<string> = new Set()): T {
	const left = snapshot as Record<string, unknown>;
	const before = base as Record<string, unknown>;
	const after = incoming as Record<string, unknown>;
	const merged: Record<string, unknown> = {};
	for (const key of new Set([...Object.keys(left), ...Object.keys(before), ...Object.keys(after)])) {
		let value: unknown;
		if (same(before[key], after[key])) {
			value = left[key];
		} else if (nested.has(key) && isPlainRecord(left[key]) && isPlainRecord(before[key]) && isPlainRecord(after[key])) {
			value = mergeRecord(left[key] as object, before[key] as object, after[key] as object);
		} else {
			value = structuredClone(after[key]);
		}
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged as T;
}

function isPlainRecord(value: unknown): boolean {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RESOURCE_NESTED = new Set(['settings', 'fieldBindings']);

function resourceTypeKey(resource: Resource): string {
	return `${resource.provider}:${resource.kind}:${resourceDefinition(resource).type}`;
}

function resourceIdentityKey(resource: Resource): string {
	const name = terraformIdentifier(resource);
	return resource.kind === 'module'
		? `module:${name}`
		: `resource:${resourceDefinition(resource).type}.${name}`;
}

function sameResourceType(a: Resource, b: Resource): boolean {
	return resourceTypeKey(a) === resourceTypeKey(b);
}

/**
 * Detect opaque Rust node ID shifts between `from` and `to` (for example when saving a new
 * resource shifts `node-5` -> `node-6` in BTreeMap order). Matches resources that keep the same
 * canonical Terraform address (`type.name` / `module.name`) under a new opaque ID.
 */
function buildIdentityIdRemap(from: readonly Resource[], to: readonly Resource[]): Map<string, string> {
	const remap = new Map<string, string>();
	const toByIdentity = new Map<string, Resource[]>();
	for (const resource of to) {
		const key = resourceIdentityKey(resource);
		const list = toByIdentity.get(key) ?? [];
		list.push(resource);
		toByIdentity.set(key, list);
	}
	const claimedToIds = new Set<string>();
	for (const resource of from) {
		const candidates = toByIdentity.get(resourceIdentityKey(resource)) ?? [];
		const match = candidates.find(candidate => !claimedToIds.has(candidate.id) && candidate.id === resource.id)
			?? candidates.find(candidate => !claimedToIds.has(candidate.id));
		if (match) {
			claimedToIds.add(match.id);
			if (match.id !== resource.id) {
				remap.set(resource.id, match.id);
			}
		}
	}
	return remap;
}

function remapEndpointForRebase(endpoint: DesignConnection['source'], idRemap: ReadonlyMap<string, string>): DesignConnection['source'] {
	if (endpoint.kind === 'element') {
		const nextId = idRemap.get(endpoint.elementId);
		return nextId ? { ...endpoint, elementId: nextId } : endpoint;
	}
	return endpoint;
}

function remapArchitectureIds(architecture: Architecture, idRemap: ReadonlyMap<string, string>): Architecture {
	if (idRemap.size === 0) {
		return architecture;
	}
	const mapId = (id: string) => idRemap.get(id) ?? id;
	const resources = architecture.resources.map(resource => {
		const nextId = mapId(resource.id);
		const nextParentId = resource.parentId ? mapId(resource.parentId) : undefined;
		const nextVisualParentId = typeof resource.visualParentId === 'string' ? mapId(resource.visualParentId) : resource.visualParentId;
		const nextResourceRefs = resource.resourceRefs
			? Object.fromEntries(Object.entries(resource.resourceRefs).map(([key, binding]) => [
				key,
				{
					refs: binding.refs.map(entry => ({ ...entry, resourceId: mapId(entry.resourceId) })),
					...(binding.items ? { items: binding.items.map(item => item.kind === 'ref' ? { ...item, resourceId: mapId(item.resourceId) } : item) } : {}),
				},
			]))
			: undefined;
		return {
			...resource,
			id: nextId,
			...(nextParentId !== undefined ? { parentId: nextParentId } : {}),
			...(resource.visualParentId !== undefined ? { visualParentId: nextVisualParentId } : {}),
			...(nextResourceRefs ? { resourceRefs: nextResourceRefs } : {}),
		};
	});
	const items = architecture.items.map(item => item.members.length > 0
		? { ...item, members: [...new Set(item.members.map(mapId))] }
		: item
	);
	const connections = architecture.connections.map(connection => {
		const source = remapEndpointForRebase(connection.source, idRemap);
		const target = remapEndpointForRebase(connection.target, idRemap);
		let id = connection.id;
		if (id.includes('->')) {
			const [fromOld, toOld] = id.split('->');
			if (fromOld && toOld) {
				id = `${mapId(fromOld)}->${mapId(toOld)}`;
			}
		}
		return { ...connection, id, source, target };
	});
	const groups = architecture.groups?.map(group => ({ ...group, members: [...new Set(group.members.map(mapId))] }));
	const layerOrder = architecture.layerOrder ? [...new Set(architecture.layerOrder.map(mapId))] : undefined;
	return {
		...architecture,
		resources,
		items,
		connections,
		...(groups ? { groups } : {}),
		...(layerOrder ? { layerOrder } : {}),
	};
}

function hasParentCycle(byId: ReadonlyMap<string, Resource>, startId: string, readParent: (r: Resource) => string | undefined): boolean {
	const seen = new Set<string>([startId]);
	let current = readParent(byId.get(startId)!);
	while (current) {
		if (seen.has(current)) {
			return true;
		}
		seen.add(current);
		const parent = byId.get(current);
		if (!parent) {
			return false;
		}
		current = readParent(parent);
	}
	return false;
}

/** Three-way merge of one history snapshot. Exported for tests. */
export function rebaseSnapshot(snapshot: Architecture, base: Architecture, incoming: Architecture): Architecture {
	// If Rust shifted opaque node IDs between `base` and `incoming`, align `snapshot` and `base`
	// to the new IDs before merging so edits follow each resource instead of colliding across types.
	const idRemap = buildIdentityIdRemap(base.resources, incoming.resources);
	// Also align any canvas-only resources in `snapshot` that just became saved nodes in `incoming`.
	const snapshotRemap = new Map(idRemap);
	const extraRemap = buildIdentityIdRemap(snapshot.resources, incoming.resources);
	for (const [oldId, newId] of extraRemap) {
		if (!snapshotRemap.has(oldId)) {
			snapshotRemap.set(oldId, newId);
		}
	}
	const alignedSnapshot = remapArchitectureIds(snapshot, snapshotRemap);
	const alignedBase = remapArchitectureIds(base, idRemap);

	const resources = mergeKeyed(
		alignedSnapshot.resources,
		alignedBase.resources,
		incoming.resources,
		(mine, before, after) => sameResourceType(mine, after) && sameResourceType(before, after)
			? mergeRecord(mine, before, after, RESOURCE_NESTED)
			: structuredClone(after)
	);
	const resourceIds = new Set(resources.map(resource => resource.id));
	const sanitizedResources = resources.map(resource =>
		(resource.parentId && !resourceIds.has(resource.parentId) || typeof resource.visualParentId === 'string' && !resourceIds.has(resource.visualParentId))
			? {
				...resource,
				parentId: resource.parentId && resourceIds.has(resource.parentId) ? resource.parentId : undefined,
				visualParentId: typeof resource.visualParentId === 'string' && !resourceIds.has(resource.visualParentId) ? undefined : resource.visualParentId,
			}
			: resource
	);
	// Break any parent or visual-parent cycle so layout and Terraform generation always terminate.
	const byId = new Map(sanitizedResources.map(resource => [resource.id, resource]));
	for (let index = 0; index < sanitizedResources.length; index++) {
		let resource = sanitizedResources[index];
		if (resource.parentId && hasParentCycle(byId, resource.id, r => r.parentId)) {
			resource = { ...resource, parentId: undefined };
			sanitizedResources[index] = resource;
			byId.set(resource.id, resource);
		}
		if (typeof resource.visualParentId === 'string' && hasParentCycle(byId, resource.id, r => r.visualParentId === undefined ? r.parentId : r.visualParentId ?? undefined)) {
			resource = { ...resource, visualParentId: undefined };
			sanitizedResources[index] = resource;
			byId.set(resource.id, resource);
		}
	}
	const items = mergeKeyed(alignedSnapshot.items, alignedBase.items, incoming.items);
	const endpointIds = new Set([...resourceIds, ...items.map(item => item.id)]);
	const merged: Architecture = {
		...alignedSnapshot,
		name: mergeValue(alignedSnapshot.name, alignedBase.name, incoming.name),
		resources: sanitizedResources,
		items,
		connections: mergeKeyed(alignedSnapshot.connections, alignedBase.connections, incoming.connections)
			.filter(connection => endpointExists(connection.source, endpointIds) && endpointExists(connection.target, endpointIds)),
	};
	if (alignedSnapshot.variables || incoming.variables) {
		merged.variables = mergeKeyed(alignedSnapshot.variables, alignedBase.variables, incoming.variables);
	}
	const groups = mergeKeyed(alignedSnapshot.groups, alignedBase.groups, incoming.groups)
		.map(group => ({ ...group, members: group.members.filter(id => endpointIds.has(id)) }))
		.filter(group => group.members.length > 1);
	if (groups.length || alignedSnapshot.groups) {
		merged.groups = groups;
	}
	const layerOrder = mergeValue(alignedSnapshot.layerOrder, alignedBase.layerOrder, incoming.layerOrder);
	if (layerOrder) {
		merged.layerOrder = layerOrder.filter(id => endpointIds.has(id));
	} else {
		delete merged.layerOrder;
	}
	return merged;
}

/**
 * Rebase the history onto `incoming`, a refresh of the same architecture.
 *
 * Without `base`, `incoming` was projected from the present (the old behaviour): it becomes the
 * present and only past and future steps are rebased. With `base` (the state the files said
 * before this refresh), the present is rebased too, so unsaved canvas edits survive a refresh
 * and file changes are applied on top of them. Steps that become no-ops are dropped.
 */
export function rebaseHistory<H extends SnapshotHistory>(history: H, incoming: Architecture, base?: Architecture): H {
	const from = base ?? history.present;
	if (same(from, incoming)) {
		if (!base || history.present === base) {
			// Typically the echo of the user's own save: nothing to rebase, but adopt the loaded object
			// so callers can compare the present against the service baseline by identity.
			return { ...history, present: incoming };
		}
		return history;
	}
	const rebasedPresent = base && history.present !== base ? rebaseSnapshot(history.present, from, incoming) : incoming;
	const present = same(rebasedPresent, incoming) ? incoming : rebasedPresent;
	const past = history.past.map(snapshot => rebaseSnapshot(snapshot, from, incoming));
	const future = history.future.map(snapshot => rebaseSnapshot(snapshot, from, incoming));

	// Walk outward from the new present so each kept step differs from its neighbour.
	const keptPast: Architecture[] = [];
	let neighbour = present;
	for (let index = past.length - 1; index >= 0; index--) {
		if (!same(past[index], neighbour)) {
			keptPast.unshift(past[index]);
			neighbour = past[index];
		}
	}
	const keptFuture: Architecture[] = [];
	neighbour = present;
	for (const snapshot of future) {
		if (!same(snapshot, neighbour)) {
			keptFuture.push(snapshot);
			neighbour = snapshot;
		}
	}
	return { ...history, past: keptPast.slice(-MAX_PAST), present, future: keptFuture };
}
