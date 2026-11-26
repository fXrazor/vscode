/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';
import { bindingKey, bindingTarget, fieldDefinition, fieldTargetPath, resourceRefBindingIssue, variableBindingIssue, hasRefBinding } from './fieldBindings.ts';
import { inheritedReference } from './resourceHierarchy.ts';
import { liveSchemaAttributes, liveSchemaBlocks, type LiveSchemaMap } from './liveSchema.ts';
import { dynamicBlockConfigured, extraFieldValue } from './additionalTerraform.ts';
import { literalIssue } from '../../src/canvas/literalSchema.ts';

export interface BlockDefinition {
	type: string;
	label: string;
	max: number;
	min?: number;
	fields: Record<string, string>;
	children: BlockDefinition[];
	required?: boolean;
	description?: string;
	attributes?: AttrDef[];
}

export function blockDefinitions(attributes: AttrDef[]): BlockDefinition[] {
	return attributes.filter(attribute => attribute.type === 'block').map(attribute => ({
		type: attribute.name, label: attribute.name.replaceAll('_', ' '), max: attribute.maxItems && attribute.maxItems > 0 ? attribute.maxItems : attribute.repeat ? Infinity : 1,
		required: attribute.required, description: attribute.description, min: attribute.minItems,
		attributes: attribute.children?.filter(child => child.type !== 'block' && !child.readOnly) ?? [],
		fields: Object.fromEntries((attribute.children ?? []).filter(child => child.type !== 'block' && child.default !== undefined).map(child => [child.name, typeof child.default === 'string' ? child.default : JSON.stringify(child.default)])),
		children: blockDefinitions(attribute.children ?? [])
	}));
}

/** Merge live version-matched Rust FormSchema, curated metadata, and imported primitive descriptors. */
export function editableFields(resource: Resource, liveSchemas?: LiveSchemaMap): AttrDef[] {
	const typeName = resourceDefinition(resource).type;
	const curated = getDef(typeName)?.attributes.filter(field => field.type !== 'block' && !field.readOnly) ?? [];
	const live = liveSchemas?.[typeName];
	const base = live ? liveSchemaAttributes(live, curated) : curated;
	const fields = new Map(base.map(field => [field.name, field]));
	for (const field of live || getDef(typeName)?.schemaVersion ? [] : resource.catalogue?.fields ?? []) {
		if (!fields.has(field.name)) { fields.set(field.name, { ...field, description: field.description ?? '' }); }
	}
	return [...fields.values()];
}

/** Local shape checks only. Expressions and provider constraints require Terraform. */
export function fieldIssue(value: string, attribute?: AttrDef): string | undefined {
	if (!value.trim()) { return attribute?.required ? 'Required value' : undefined; }
	if (/^var\.[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) { return undefined; }
	if (attribute?.type === 'number' && !Number.isFinite(Number(value))) { return 'Enter a finite number'; }
	if (attribute?.type === 'bool' && !['true', 'false'].includes(value)) { return 'Choose true or false'; }
	if (attribute?.options?.length && !attribute.options.includes(value)) { return 'Choose a listed value'; }
	if (attribute?.type === 'json') { try { return literalIssue(JSON.parse(value), attribute.literalShape); } catch { return 'Enter a JSON value'; } }
	if (attribute?.type === 'list' || attribute?.type === 'map') {
		try { const parsed: unknown = JSON.parse(value); if (attribute.type === 'list' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return 'Enter a JSON ' + (attribute.type === 'list' ? 'array' : 'object'); } const issue = literalIssue(parsed, attribute.literalShape); if (issue) { return issue; } }
		catch { return 'Enter a JSON ' + (attribute.type === 'list' ? 'array' : 'object'); }
	}
	return undefined;
}

export function resourceFormIssues(resource: Resource, variables?: import('./variables.ts').VariableDefinition[], architecture?: Architecture, liveSchemas?: LiveSchemaMap): string[] {
	const issues: string[] = [];
	for (const [key, binding] of Object.entries(resource.fieldBindings ?? {})) { const target = bindingTarget(key); const issue = variableBindingIssue(binding, variables ?? [], target ? fieldDefinition(resource, target, liveSchemas) : undefined); if (issue) { issues.push((target?.kind === 'setting' || target?.kind === 'block' ? target.name : target?.kind ?? 'Field') + ': ' + issue); } }
	for (const [key, binding] of Object.entries(resource.resourceRefs ?? {})) { const target = bindingTarget(key); const issue = resourceRefBindingIssue(binding, architecture, resource, target ? fieldDefinition(resource, target, liveSchemas) : undefined); if (issue) { issues.push((target?.kind === 'setting' || target?.kind === 'block' ? target.name : target?.kind ?? 'Field') + ': ' + issue); } }
	if (resource.catalogue || liveSchemas?.[resourceDefinition(resource).type]) {
		for (const field of editableFields(resource, liveSchemas)) {
			if (extraFieldValue(resource, {kind:'setting',name:field.name}) !== undefined) { continue; }
			if (['name', 'location', 'region'].includes(field.name)) { continue; }
			if(architecture&&inheritedReference(architecture,resource,[field.name])){continue;}
			const key = bindingKey({kind:'setting',name:field.name});
			const issue = resource.fieldBindings?.[key] || hasRefBinding(resource.resourceRefs?.[key]) ? undefined : fieldIssue(resource.settings[field.name] ?? '', field);
			if (issue) { issues.push(field.name + ': ' + issue); }
		}
	}
	const visit = (blocks: ResourceBlock[], definitions: BlockDefinition[], path: string, parentBlockId?:string) => {
		for (const definition of definitions) {
			const matching = blocks.filter(block => block.type === definition.type);
			if (matching.length < (definition.min ?? (definition.required ? 1 : 0)) && !dynamicBlockConfigured(resource,definition.type,parentBlockId)) { issues.push(path + definition.type + ': Required block count ' + (definition.min ?? 1)); }
			if (matching.length > definition.max) { issues.push(path + definition.type + ': Too many blocks'); }
			matching.forEach((block, index) => {
				const prefix = path + definition.type + '[' + (index + 1) + '].';
				for (const field of definition.attributes ?? []) {
					if (extraFieldValue(resource, {kind:'block',blockId:block.id,name:field.name}) !== undefined) { continue; }
					if(architecture&&inheritedReference(architecture,resource,fieldTargetPath(resource,{kind:'block',blockId:block.id,name:field.name}))){continue;}
					const key = bindingKey({kind:'block',blockId:block.id,name:field.name});
					const issue = resource.fieldBindings?.[key] || hasRefBinding(resource.resourceRefs?.[key]) ? undefined : fieldIssue(block.values[field.name] ?? '', field);
					if (issue) { issues.push(prefix + field.name + ': ' + issue); }
				}
				visit(block.blocks, definition.children, prefix, block.id);
			});
		}
	};
	visit(resource.blocks, additionalBlocks(resource, liveSchemas), '');
	return issues;
}

/** Prefer live version-matched Rust FormSchema when connected; fall back to curated bundled definitions. */
export function additionalBlocks(resource: Resource, liveSchemas?: LiveSchemaMap): BlockDefinition[] {
	const typeName = resourceDefinition(resource).type;
	const schema = getDef(typeName);
	const live = liveSchemas?.[typeName];
	if (live) {
		return liveSchemaBlocks(live, schema?.attributes ?? []).filter(block => !(block.type === 'default_node_pool' && Object.hasOwn(resource.settings, 'Node count')));
	}
	if (schema) {
		// The sample cluster already represents its default pool through shared settings.
		return blockDefinitions(schema.attributes).filter(block => !(block.type === 'default_node_pool' && Object.hasOwn(resource.settings, 'Node count')));
	}
	if (resource.provider !== 'azure') { return []; }
	switch (resource.kind) {
		case 'cluster':
			return [{
				type: 'network_profile', label: 'Network Profile', max: 1,
				fields: { 'Network plugin': 'azure', 'Service CIDR': '10.30.0.0/16' },
				children: [{
					type: 'load_balancer_profile', label: 'Load Balancer Profile', max: 1,
					fields: { 'Managed outbound IP count': '1' }, children: []
				}]
			}];
		case 'network':
			return [{ type: 'subnet', label: 'Subnet', max: 8, fields: { 'Subnet name': 'snet-new', 'Address prefix': '10.20.2.0/24' }, children: [] }];
		case 'storage':
			return [{ type: 'blob_properties', label: 'Blob Properties', max: 1, fields: { 'Versioning enabled': 'true' }, children: [] }];
		case 'gateway':
			return [{ type: 'backend_address_pool', label: 'Backend Address Pool', max: 8, fields: { 'Pool name': 'backend', 'IP address': '10.20.1.4' }, children: [] }];
		default:
			return [];
	}
}
