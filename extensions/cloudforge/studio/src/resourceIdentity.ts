/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource } from './model.ts';
import type { HostNodeSummary } from './webviewBridge.ts';
import type { DesignEndpoint } from './connectionEndpoints.ts';
import { resourceDefinition } from './fixture.ts';
import { terraformIdentifier } from './resourceHierarchy.ts';

/**
 * The service numbers its graph nodes by position (`node-1`, `node-2`, …), so a save that adds, removes or
 * reorders a block shifts every id after it, and a resource drawn on the canvas has its own id until its
 * block is first read back. A resource's lasting identity is its Terraform address. Before each refresh the
 * Studio renames its own ids to the ids the new snapshot gives the same addresses, so positions, sizes,
 * settings, references and unsaved edits stay on the right resource instead of landing on a neighbour.
 */

export function nodeAddress(node: Pick<HostNodeSummary, 'kind' | 'resourceType' | 'name'>): string | undefined {
	if (node.kind === 'module') { return 'module.' + node.name; }
	return node.resourceType ? node.resourceType + '.' + node.name : undefined;
}

export function resourceIdentity(resource: Resource): string {
	return resource.kind === 'module' ? 'module.' + terraformIdentifier(resource) : resourceDefinition(resource).type + '.' + terraformIdentifier(resource);
}

/**
 * Old Studio id → snapshot id, for every resource whose address the snapshot still has under another id.
 * The most recent architecture wins (unsaved renames), then older ones (the address the files last had).
 * A resource the snapshot no longer has, whose id the snapshot now gives to something else, moves to a
 * fresh id so it can never pass its settings to the newcomer.
 */
export function snapshotIdMap(nodes: readonly Pick<HostNodeSummary, 'id' | 'kind' | 'resourceType' | 'name'>[], architectures: readonly (Architecture | null | undefined)[]): Map<string, string> {
	const byAddress = new Map<string, string>();
	for (const node of nodes) {
		const address = nodeAddress(node);
		if (address && !byAddress.has(address)) { byAddress.set(address, node.id); }
	}
	const nodeIds = new Set(nodes.map(node => node.id));
	const sources = architectures.filter((item): item is Architecture => !!item);
	const ids = [...new Set(sources.flatMap(architecture => architecture.resources.map(resource => resource.id)))];
	const assigned = new Map<string, string>();
	const claimed = new Set<string>();
	for (const architecture of sources) {
		for (const resource of architecture.resources) {
			if (assigned.has(resource.id)) { continue; }
			const target = byAddress.get(resourceIdentity(resource));
			if (target && !claimed.has(target)) {
				assigned.set(resource.id, target);
				claimed.add(target);
			}
		}
	}
	const taken = new Set([...ids, ...nodeIds]);
	const map = new Map<string, string>();
	for (const id of ids) {
		const target = assigned.get(id);
		if (target !== undefined) {
			if (target !== id) { map.set(id, target); }
		} else if (nodeIds.has(id) || claimed.has(id)) {
			let fresh = id + '~stale';
			for (let index = 2; taken.has(fresh); index++) { fresh = id + '~stale' + index; }
			taken.add(fresh);
			map.set(id, fresh);
		}
	}
	return map;
}

function remapEndpoint(endpoint: DesignEndpoint, map: ReadonlyMap<string, string>): DesignEndpoint {
	return endpoint.kind === 'element' && map.has(endpoint.elementId) ? { ...endpoint, elementId: map.get(endpoint.elementId)! } : endpoint;
}

/** Rename resource ids everywhere an architecture refers to them. Returns the same object when nothing changes. */
export function rekeyArchitecture(architecture: Architecture, map: ReadonlyMap<string, string>): Architecture {
	if (!map.size) { return architecture; }
	const id = (value: string) => map.get(value) ?? value;
	const touches = architecture.resources.some(resource => map.has(resource.id) || (resource.parentId && map.has(resource.parentId)) || (resource.visualParentId && map.has(resource.visualParentId)) || Object.values(resource.resourceRefs ?? {}).some(binding => binding.refs.some(entry => map.has(entry.resourceId))))
		|| architecture.connections.some(link => (link.source.kind === 'element' && map.has(link.source.elementId)) || (link.target.kind === 'element' && map.has(link.target.elementId)))
		|| architecture.items.some(item => item.members.some(member => map.has(member)))
		|| (architecture.groups ?? []).some(group => group.members.some(member => map.has(member)))
		|| (architecture.layerOrder ?? []).some(member => map.has(member))
		|| Object.keys(architecture.dependencyStyles ?? {}).some(key => key.startsWith('dependency:'));
	if (!touches) { return architecture; }
	const resources = architecture.resources.map(resource => ({
		...resource,
		id: id(resource.id),
		...(resource.parentId ? { parentId: id(resource.parentId) } : {}),
		...(resource.visualParentId ? { visualParentId: id(resource.visualParentId) } : {}),
		...(resource.resourceRefs ? {
			resourceRefs: Object.fromEntries(Object.entries(resource.resourceRefs).map(([key, binding]) => [key, {
				refs: binding.refs.map(entry => ({ ...entry, resourceId: id(entry.resourceId) })),
				...(binding.items ? { items: binding.items.map(entry => entry.kind === 'ref' ? { ...entry, resourceId: id(entry.resourceId) } : entry) } : {}),
			}])),
		} : {}),
	}));
	const connections = architecture.connections.map(link => {
		const parts = link.id.split('->');
		return {
			...link,
			id: parts.length === 2 ? id(parts[0]) + '->' + id(parts[1]) : link.id,
			source: remapEndpoint(link.source, map),
			target: remapEndpoint(link.target, map),
		};
	});
	const dependencyStyles = architecture.dependencyStyles && Object.fromEntries(Object.entries(architecture.dependencyStyles).map(([key, style]) => {
		const parts = key.split(':');
		return [parts.length === 3 && parts[0] === 'dependency' ? 'dependency:' + id(parts[1]) + ':' + id(parts[2]) : key, style];
	}));
	return {
		...architecture,
		resources,
		connections,
		items: architecture.items.map(item => item.members.some(member => map.has(member)) ? { ...item, members: item.members.map(id) } : item),
		...(architecture.groups ? { groups: architecture.groups.map(group => ({ ...group, members: group.members.map(id) })) } : {}),
		...(architecture.layerOrder ? { layerOrder: architecture.layerOrder.map(id) } : {}),
		...(dependencyStyles ? { dependencyStyles } : {}),
	};
}

/** One rename for many architectures: an object seen twice maps to the same result, so identity checks still hold. */
export function createRekeyer(map: ReadonlyMap<string, string>): <A extends Architecture | null | undefined>(architecture: A) => A {
	const memo = new Map<Architecture, Architecture>();
	return <A extends Architecture | null | undefined>(architecture: A): A => {
		if (!architecture || !map.size) { return architecture; }
		let result = memo.get(architecture);
		if (!result) { result = rekeyArchitecture(architecture, map); memo.set(architecture, result); }
		return result as A;
	};
}

/**
 * Saved view state names resources by the ids they had when it was written. With the addresses saved beside
 * them, an id the service has since given to another block maps to the id its resource has now.
 */
export function viewStateIdMap(nodes: readonly Pick<HostNodeSummary, 'id' | 'kind' | 'resourceType' | 'name'>[], addresses: Readonly<Record<string, string>> | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!addresses) { return map; }
	const byAddress = new Map<string, string>();
	for (const node of nodes) {
		const address = nodeAddress(node);
		if (address && !byAddress.has(address)) { byAddress.set(address, node.id); }
	}
	for (const [id, address] of Object.entries(addresses)) {
		const target = byAddress.get(address);
		if (target !== undefined && target !== id) { map.set(id, target); }
	}
	return map;
}

/** Id → Terraform address, saved with the view state so the next load can tell renumbered ids apart. */
export function resourceAddresses(architecture: Architecture): Record<string, string> {
	return Object.fromEntries(architecture.resources.slice(0, 512).map(resource => [resource.id, resourceIdentity(resource)]));
}
