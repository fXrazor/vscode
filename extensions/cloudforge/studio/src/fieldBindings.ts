/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { withInferredReferenceTypes } from './referenceInference.ts';
import { isExpr, type Value } from './cloudlab-core/model.ts';
import { isObjectValue, isSensitiveProperty, variableValueAt, type VariableDefinition } from './variables.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';
import { inheritedReference, inheritedReferences, resourceAddress } from './resourceHierarchy.ts';
import { liveSchemaDefinitionTree, liveSchemaOutputs, type LiveSchemaMap } from './liveSchema.ts';

export type FieldTarget = { kind: 'name' } | { kind: 'region' } | { kind: 'setting'; name: string } | { kind: 'block'; blockId: string; name: string };
/** `path` picks one attribute of an object variable: { variableId, path: ['dns', 'enabled'] } writes var.NAME.dns.enabled. */
export type VariableBinding = { variableId: string; path?: string[] };
export type ResourceRefEntry = { resourceId: string; attribute: string };
/** One entry of a mixed list: a typed value, a variable or a resource reference, written in order as [a, var.b, type.name.id]. */
export type ListEntry = { kind: 'value'; value: string } | { kind: 'variable'; variableId: string; path?: string[] } | { kind: 'ref'; resourceId: string; attribute: string };
/** `refs` lists every referenced resource (dependencies, cycles, validation); `items`, when set, is the full mixed list in order. */
export type ResourceRefBinding = { refs: ResourceRefEntry[]; items?: ListEntry[] };
export const hasRefBinding = (binding?: ResourceRefBinding) => !!(binding?.refs.length || binding?.items?.length);
export function listEntryExpression(entry: ListEntry, architecture?: Architecture): string {
	if (entry.kind === 'value') { return JSON.stringify(entry.value); }
	if (entry.kind === 'variable') { return variableBindingExpression(architecture?.variables?.find(item => item.id === entry.variableId), entry); }
	const source = architecture?.resources.find(item => item.id === entry.resourceId);
	return source ? resourceAddress(source) + '.' + entry.attribute : 'Missing resource';
}
export type ResourceRefCandidate = { resource: Resource; attribute: string; expression: string };
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

export function pruneBlockResourceRefs(resource: Resource, blocks: ResourceBlock[]) {
	return resource.resourceRefs && Object.fromEntries(Object.entries(resource.resourceRefs).filter(([key]) => { const target = bindingTarget(key); return target?.kind !== 'block' || !!findResourceBlock(blocks, target.blockId); }));
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

export function fieldDefinition(resource: Resource, target: FieldTarget, liveSchemas?: LiveSchemaMap): AttrDef | undefined {
	const typeName = resourceDefinition(resource).type;
	const curatedAttrs = getDef(typeName)?.attributes ?? [];
	const live = liveSchemas?.[typeName];
	const attrs: AttrDef[] = live
		? liveSchemaDefinitionTree(live, curatedAttrs)
		: curatedAttrs;
	const lookup = (attributes: AttrDef[], path: string[]): AttrDef | undefined => { const field = attributes.find(item => item.name === path[0]); return path.length > 1 ? lookup(field?.children ?? [], path.slice(1)) : field; };
	if (target.kind === 'name' || target.kind === 'region') { return { name: target.kind, type: 'string', description: '' }; }
	if (target.kind === 'setting') { const field = lookup(attrs, resource.catalogue ? [target.name] : fieldPath(target.name)); const descriptor = resource.catalogue?.fields.find(field => field.name === target.name); return withInferredReferenceTypes(typeName, field ?? (!live && descriptor ? { ...descriptor, description: descriptor.description ?? '' } : undefined)); }
	const visit = (blocks: ResourceBlock[], attributes: AttrDef[]): AttrDef | undefined => {
		for (const block of blocks) { const definition = attributes.find(item => item.name === block.type); if (block.id === target.blockId) { return withInferredReferenceTypes(typeName, lookup(definition?.children ?? [], fieldPath(target.name))); } const found = visit(block.blocks, definition?.children ?? []); if (found) { return found; } }
		return undefined;
	};
	return visit(resource.blocks, attrs);
}

export function acceptsVariable(variable: VariableDefinition, definition?: Pick<AttrDef, 'type'>, path?: readonly string[]): boolean {
	if (path?.length) {
		const value = variableValueAt(variable, path);
		if (value === undefined) { return false; }
		if (!definition || value === null) { return true; }
		const kind = typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : Array.isArray(value) ? 'list' : isObjectValue(value) ? 'map' : 'any';
		return ['string', 'number', 'bool', 'list', 'map'].includes(definition.type) ? definition.type === kind : true;
	}
	if (!definition || variable.type === 'any') { return true; }
	const type = definition.type;
	return type === 'list' ? variable.type === 'list(string)' : type === 'map' ? variable.type === 'map(string)' : !['string', 'number', 'bool'].includes(type) || variable.type === type;
}

export function variableBindingIssue(binding: VariableBinding | undefined, variables: VariableDefinition[], definition?: Pick<AttrDef, 'type'>): string | undefined {
	if (!binding) { return undefined; }
	const variable = variables.find(item => item.id === binding.variableId);
	if (variable && binding.path?.length && variableValueAt(variable, binding.path) === undefined) { return 'var.' + variable.name + '.' + binding.path.join('.') + ' no longer exists in the object. Choose another value.'; }
	return !variable ? 'The bound variable is missing. Choose another variable or a fixed value.' : !acceptsVariable(variable, definition, binding.path) ? 'Variable type does not match this field.' : undefined;
}

/** The Terraform expression for a variable binding: var.NAME, or var.NAME.a.b for one attribute of an object variable. */
export function variableBindingExpression(variable: VariableDefinition | undefined, binding: VariableBinding | undefined): string {
	return variable ? 'var.' + variable.name + (binding?.path?.length ? '.' + binding.path.join('.') : '') : 'Missing variable';
}

export function boundVariable(architecture: Architecture, resource: Resource, target: FieldTarget) {
	const binding = resource.fieldBindings?.[bindingKey(target)];
	return binding ? architecture.variables?.find(item => item.id === binding.variableId) : undefined;
}

export function fieldExpression(resource: Resource, target: FieldTarget, variables?: VariableDefinition[], architecture?: Architecture): string | undefined {
	const inherited = architecture && inheritedReference(architecture,resource,fieldTargetPath(resource,target));
	if (inherited) { return inherited.expression; }
	const key = bindingKey(target);
	const refBinding = resource.resourceRefs?.[key];
	if (refBinding?.items?.length) { return '[' + refBinding.items.map(entry => listEntryExpression(entry, architecture)).join(', ') + ']'; }
	if (refBinding?.refs.length) {
		const parts = refBinding.refs.map(entry => {
			const source = architecture?.resources.find(item => item.id === entry.resourceId);
			return source ? resourceAddress(source) + '.' + entry.attribute : 'Missing resource';
		});
		const def = fieldDefinition(resource, target);
		return def?.type === 'list' ? '[' + parts.join(', ') + ']' : parts[0];
	}
	const binding = resource.fieldBindings?.[key];
	if (!binding) { return undefined; }
	const variable = variables?.find(item=>item.id===binding.variableId);
	return variableBindingExpression(variable, binding);
}

export function wouldCreateReferenceCycle(architecture: Architecture, consumerId: string, providerId: string): boolean {
	if (consumerId === providerId) { return true; }
	const upstreamOf = new Map<string, string[]>();
	const addDep = (consumer: string, upstream: string) => {
		const list = upstreamOf.get(consumer) ?? [];
		if (!list.includes(upstream)) { list.push(upstream); upstreamOf.set(consumer, list); }
	};
	for (const res of architecture.resources) {
		for (const inh of inheritedReferences(architecture, res)) { addDep(res.id, inh.source.id); }
		for (const refBind of Object.values(res.resourceRefs ?? {})) {
			for (const entry of refBind.refs) { addDep(res.id, entry.resourceId); }
		}
	}
	// Adding edge consumerId -> providerId creates a cycle iff consumerId is reachable upstream from providerId.
	const visited = new Set<string>([providerId]);
	const stack = [providerId];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const next of upstreamOf.get(cur) ?? []) {
			if (next === consumerId) { return true; }
			if (!visited.has(next)) { visited.add(next); stack.push(next); }
		}
	}
	return false;
}

export function eligibleReferenceTargets(architecture: Architecture, resource: Resource, definition?: AttrDef, liveSchemas?: LiveSchemaMap): ResourceRefCandidate[] {
	if (!definition?.refTypes?.length || isSensitiveProperty(definition.name, definition.sensitive)) { return []; }
	const attribute = definition.refAttr ?? 'id';
	return architecture.resources
		.filter(candidate => {
			if (candidate.id === resource.id || candidate.kind === 'module' || candidate.provider !== resource.provider) { return false; }
			const candidateType = resourceDefinition(candidate).type;
			if (!definition.refTypes!.includes(candidateType)) { return false; }
			const candidateDef = getDef(candidateType);
			const liveOutputs = liveSchemaOutputs(liveSchemas?.[candidateType]);
			const exported = liveOutputs.length ? [...new Set([...liveOutputs, ...(candidateDef?.exported ?? ['id'])])] : (candidateDef?.exported ?? ['id']);
			if (!exported.includes(attribute)) { return false; }
			return !wouldCreateReferenceCycle(architecture, resource.id, candidate.id);
		})
		.map(candidate => ({
			resource: candidate,
			attribute,
			expression: resourceAddress(candidate) + '.' + attribute,
		}));
}

export function acceptsResourceRefs(architecture: Architecture, resource: Resource, refs: readonly ResourceRefEntry[], definition?: AttrDef): boolean {
	if (!definition?.refTypes?.length || isSensitiveProperty(definition.name, definition.sensitive)) { return false; }
	if (definition.type !== 'list' && refs.length > 1) { return false; }
	const eligible = eligibleReferenceTargets(architecture, resource, definition);
	const seen = new Set<string>();
	for (const entry of refs) {
		const idKey = entry.resourceId + ':' + entry.attribute;
		if (seen.has(idKey)) { return false; }
		seen.add(idKey);
		if (!eligible.some(candidate => candidate.resource.id === entry.resourceId && candidate.attribute === entry.attribute)) { return false; }
	}
	return true;
}

export function resourceRefBindingIssue(binding: ResourceRefBinding | undefined, architecture: Architecture | undefined, resource: Resource, definition?: AttrDef): string | undefined {
	if (binding?.items?.length) {
		if (definition && definition.type !== 'list') { return 'Only list fields can mix values, variables and references.'; }
		for (const entry of binding.items) {
			if (entry.kind === 'variable' && architecture && !architecture.variables?.some(item => item.id === entry.variableId)) { return 'A variable in this list no longer exists. Choose another variable or a value.'; }
			if (entry.kind === 'value' && !entry.value.trim()) { return 'An entry in this list is empty. Fill it in or remove it.'; }
		}
	}
	if (!binding || !binding.refs.length) { return undefined; }
	if (!definition?.refTypes?.length || isSensitiveProperty(definition.name, definition.sensitive)) {
		return 'This field does not support typed resource references.';
	}
	if (definition.type !== 'list' && binding.refs.length > 1) {
		return 'Choose a single referenced resource for this field.';
	}
	if (!architecture) { return undefined; }
	for (const entry of binding.refs) {
		const target = architecture.resources.find(item => item.id === entry.resourceId);
		if (!target) { return 'The referenced resource is missing. Choose another resource or switch to a fixed value.'; }
		if (target.id === resource.id) { return 'A resource cannot reference itself.'; }
		const targetType = resourceDefinition(target).type;
		if (!definition.refTypes.includes(targetType) || target.provider !== resource.provider) {
			return 'The referenced resource type does not match this field.';
		}
		const exported = getDef(targetType)?.exported ?? ['id'];
		if (!exported.includes(entry.attribute)) {
			return 'The referenced attribute is not exported by this resource.';
		}
	}
	return undefined;
}

export function variablePreview(variable: VariableDefinition, sensitiveField = false, path?: readonly string[]): string {
	if (sensitiveField || variable.sensitive) { return 'Sensitive value'; }
	const value = path?.length ? variableValueAt(variable, path) : variable.value !== undefined ? variable.value : variable.defaultValue;
	return value === undefined ? 'Required input · value not set' : typeof value === 'string' ? value || 'Empty string' : JSON.stringify(value);
}

/**
 * Parses an HCL list containing expressions (e.g. `[azurerm_network_interface.nic.id, var.extra, "manual"]`)
 * into a validated mixed `ResourceRefBinding` (`refs` + ordered `items`). Returns `undefined` for plain
 * literal lists or any element that cannot round-trip losslessly (such as function calls, non-string
 * literals, unknown targets, duplicate refs, or reference cycles), leaving complex HCL in `terraformExtras`.
 */
export function parseMixedListHclValue(
	value: Value,
	architecture: Architecture,
	resource: Resource,
	definition?: AttrDef,
	variables?: readonly VariableDefinition[]
): ResourceRefBinding | undefined {
	if (definition?.type !== 'list' || !Array.isArray(value) || value.length === 0 || !value.some(isExpr)) {
		return undefined;
	}
	const elementType: AttrDef['type'] = (definition.literalShape?.kind === 'list' || definition.literalShape?.kind === 'set')
		&& definition.literalShape.element?.kind === 'number' ? 'number' : 'string';
	const availableVars = variables ?? architecture.variables ?? [];
	const eligibleRefs = eligibleReferenceTargets(architecture, resource, definition);
	const items: ListEntry[] = [];
	const refs: ResourceRefEntry[] = [];

	for (const element of value) {
		if (typeof element === 'string') {
			items.push({ kind: 'value', value: element });
			continue;
		}
		if (!isExpr(element)) {
			return undefined;
		}
		const expr = element.$expr.trim();
		const varMatch = /^var\.([A-Za-z_][A-Za-z0-9_-]*)((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/.exec(expr);
		if (varMatch) {
			const variable = availableVars.find(item => item.name === varMatch[1]);
			const path = varMatch[2] ? varMatch[2].slice(1).split('.') : [];
			if (!variable || !acceptsVariable(variable, { type: elementType }, path.length ? path : undefined)) {
				return undefined;
			}
			items.push({ kind: 'variable', variableId: variable.id, ...(path.length ? { path } : {}) });
			continue;
		}
		const candidate = eligibleRefs.find(item => item.expression === expr);
		if (candidate) {
			items.push({ kind: 'ref', resourceId: candidate.resource.id, attribute: candidate.attribute });
			refs.push({ resourceId: candidate.resource.id, attribute: candidate.attribute });
			continue;
		}
		return undefined;
	}

	if (refs.length > 0 && !acceptsResourceRefs(architecture, resource, refs, definition)) {
		return undefined;
	}
	return { refs, items };
}
