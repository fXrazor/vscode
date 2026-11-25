/*---------------------------------------------------------------------------------------------
 *  Rebase semantic undo history onto a refreshed architecture.
 *--------------------------------------------------------------------------------------------*/

import type { Architecture } from './model.ts';

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

/** Three-way merge of one history snapshot. Exported for tests. */
export function rebaseSnapshot(snapshot: Architecture, base: Architecture, incoming: Architecture): Architecture {
	const resources = mergeKeyed(snapshot.resources, base.resources, incoming.resources, (mine, before, after) => mergeRecord(mine, before, after, RESOURCE_NESTED));
	const resourceIds = new Set(resources.map(resource => resource.id));
	const items = mergeKeyed(snapshot.items, base.items, incoming.items);
	const endpointIds = new Set([...resourceIds, ...items.map(item => item.id)]);
	const merged: Architecture = {
		...snapshot,
		name: mergeValue(snapshot.name, base.name, incoming.name),
		resources: resources.map(resource => resource.parentId && !resourceIds.has(resource.parentId)
			? { ...resource, parentId: undefined }
			: resource),
		items,
		connections: mergeKeyed(snapshot.connections, base.connections, incoming.connections)
			.filter(connection => endpointIds.has(connection.source) && endpointIds.has(connection.target)),
	};
	if (snapshot.variables || incoming.variables) {
		merged.variables = mergeKeyed(snapshot.variables, base.variables, incoming.variables);
	}
	const groups = mergeKeyed(snapshot.groups, base.groups, incoming.groups)
		.map(group => ({ ...group, members: group.members.filter(id => endpointIds.has(id)) }))
		.filter(group => group.members.length > 1);
	if (groups.length || snapshot.groups) {
		merged.groups = groups;
	}
	const layerOrder = mergeValue(snapshot.layerOrder, base.layerOrder, incoming.layerOrder);
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
