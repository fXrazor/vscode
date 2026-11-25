/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import type { VariableDefinition } from './variables.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';
import { inheritedReference } from './resourceHierarchy.ts';

export type FieldTarget = { kind: 'name' } | { kind: 'region' } | { kind: 'setting'; name: string } | { kind: 'block'; blockId: string; name: string };
export type VariableBinding = { variableId: string };
export const fieldAliases: Record<string, string> = {
	'Address space': 'address_space', 'Address prefix': 'address_prefixes', SKU: 'sku.name', Capacity: 'sku.capacity',
	'Node count': 'default_node_pool.node_count', 'VM size': 'default_node_pool.vm_size', 'Private cluster': 'private_cluster_enabled',
	Tier: 'account_tier', Replication: 'account_replication_type', 'Retention days': 'retention_in_days', 'Service tier': 'sku_name', Size: 'size',
	'Network plugin': 'network_plugin', 'Service CIDR': 'service_cidr', 'Managed outbound IP count': 'managed_outbound_ip_count',
	'Subnet name': 'name', 'Versioning enabled': 'versioning_enabled', 'Pool name': 'name', 'IP address': 'ip_addresses'
};
export const fieldPath = (name: string) => (fieldAliases[name] ?? name.toLowerCase().replace(/\s+/g, '_')).split('.');
export function fieldTargetPath(resource: Resource, target: FieldTarget): string[] {
	if (target.kind==='name') { return ['name']; }
	if (target.kind==='region') { return [regionAttribute(resource)??'location']; }
	if (target.kind==='setting') { return resource.catalogue?[target.name]:fieldPath(target.name); }
	const visit = (blocks: ResourceBlock[], prefix: string[]): string[]|undefined => {
		for (const block of blocks) { const path = [...prefix,block.type]; if (block.id===target.blockId) { return [...path,...fieldPath(target.name)]; } const found = visit(block.blocks,path); if (found) { return found; } }
		return undefined;
	};
	return visit(resource.blocks,[])??[target.name];
}
export const bindingKey = (target: FieldTarget) => JSON.stringify(target.kind === 'block' ? ['block', target.blockId, target.name] : target.kind === 'setting' ? ['setting', target.name] : [target.kind]);
export function bindingTarget(key: string): FieldTarget | undefined {
	try { const path = JSON.parse(key); if (!Array.isArray(path)) { return undefined; } if (path[0] === 'name' || path[0] === 'region') { return {kind:path[0]}; } if (path[0] === 'setting' && typeof path[1] === 'string') { return {kind:'setting',name:path[1]}; } if (path[0] === 'block' && typeof path[1] === 'string' && typeof path[2] === 'string') { return {kind:'block',blockId:path[1],name:path[2]}; } } catch { /* Unknown imported metadata is not an expression. */ }
	return undefined;
}

export function pruneBlockBindings(resource: Resource, blocks: ResourceBlock[]) {
	return resource.fieldBindings && Object.fromEntries(Object.entries(resource.fieldBindings).filter(([key]) => { const target = bindingTarget(key); return target?.kind !== 'block' || !!findResourceBlock(blocks, target.blockId); }));
}

export function findResourceBlock(blocks: ResourceBlock[], id: string): ResourceBlock | undefined {
	for (const block of blocks) { if (block.id === id) { return block; } const found = findResourceBlock(block.blocks, id); if (found) { return found; } }
	return undefined;
}

export function regionAttribute(resource: Resource): 'location' | 'region' | undefined {
	const fields = getDef(resourceDefinition(resource).type)?.attributes ?? resource.catalogue?.fields ?? [];
	return fields.some(field=>field.name==='location') ? 'location' : fields.some(field=>field.name==='region') ? 'region' : undefined;
}

export function canBindField(resource: Resource, target: FieldTarget): boolean {
	if (resource.kind === 'module') { return false; }
	if (target.kind === 'region') { return !!regionAttribute(resource); }
	if (target.kind === 'name') { const fields = getDef(resourceDefinition(resource).type)?.attributes ?? resource.catalogue?.fields; return !fields || fields.some(field=>field.name==='name'); }
	return target.kind === 'setting' ? Object.hasOwn(resource.settings,target.name) || !!fieldDefinition(resource,target) : !!findResourceBlock(resource.blocks,target.blockId);
}

export function fieldDefinition(resource: Resource, target: FieldTarget): AttrDef | undefined {
	const attrs = getDef(resourceDefinition(resource).type)?.attributes ?? [];
	const lookup = (attributes: AttrDef[], path: string[]): AttrDef | undefined => { const field = attributes.find(item => item.name === path[0]); return path.length > 1 ? lookup(field?.children ?? [], path.slice(1)) : field; };
	if (target.kind === 'name' || target.kind === 'region') { return { name: target.kind, type: 'string', description: '' }; }
	if (target.kind === 'setting') { const field = lookup(attrs, resource.catalogue ? [target.name] : fieldPath(target.name)); const descriptor = resource.catalogue?.fields.find(field => field.name === target.name); return field ?? (descriptor ? { ...descriptor, description: descriptor.description ?? '' } : undefined); }
	const visit = (blocks: ResourceBlock[], attributes: AttrDef[]): AttrDef | undefined => {
		for (const block of blocks) { const definition = attributes.find(item => item.name === block.type); if (block.id === target.blockId) { return lookup(definition?.children ?? [], fieldPath(target.name)); } const found = visit(block.blocks, definition?.children ?? []); if (found) { return found; } }
		return undefined;
	};
	return visit(resource.blocks, attrs);
}

export function acceptsVariable(variable: VariableDefinition, definition?: Pick<AttrDef, 'type'>): boolean {
	if (!definition || variable.type === 'any') { return true; }
	const type = definition.type;
	return type === 'list' ? variable.type === 'list(string)' : type === 'map' ? variable.type === 'map(string)' : !['string', 'number', 'bool'].includes(type) || variable.type === type;
}

export function variableBindingIssue(binding: VariableBinding | undefined, variables: VariableDefinition[], definition?: Pick<AttrDef, 'type'>): string | undefined {
	if (!binding) { return undefined; }
	const variable = variables.find(item => item.id === binding.variableId);
	return !variable ? 'The bound variable is missing. Choose another variable or a fixed value.' : !acceptsVariable(variable, definition) ? 'Variable type does not match this field.' : undefined;
}

export function boundVariable(architecture: Architecture, resource: Resource, target: FieldTarget) {
	const binding = resource.fieldBindings?.[bindingKey(target)];
	return binding ? architecture.variables?.find(item => item.id === binding.variableId) : undefined;
}

export function fieldExpression(resource: Resource, target: FieldTarget, variables?: VariableDefinition[], architecture?: Architecture): string | undefined {
	const inherited = architecture && inheritedReference(architecture,resource,fieldTargetPath(resource,target));
	if (inherited) { return inherited.expression; }
	const binding = resource.fieldBindings?.[bindingKey(target)];
	if (!binding) { return undefined; }
	const variable = variables?.find(item=>item.id===binding.variableId);
	return variable ? 'var.'+variable.name : 'Missing variable';
}

export function variablePreview(variable: VariableDefinition, sensitiveField = false): string {
	if (sensitiveField || variable.sensitive) { return 'Sensitive value'; }
	const value = variable.value !== undefined ? variable.value : variable.defaultValue;
	return value === undefined ? 'Required input · value not set' : typeof value === 'string' ? value || 'Empty string' : JSON.stringify(value);
}
