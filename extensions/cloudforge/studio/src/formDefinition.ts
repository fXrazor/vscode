/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Resource, ResourceBlock } from './model.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';

export interface BlockDefinition {
	type: string;
	label: string;
	max: number;
	fields: Record<string, string>;
	children: BlockDefinition[];
	required?: boolean;
	description?: string;
	attributes?: AttrDef[];
}

export function blockDefinitions(attributes: AttrDef[]): BlockDefinition[] {
	return attributes.filter(attribute => attribute.type === 'block').map(attribute => ({
		type: attribute.name, label: attribute.name.replaceAll('_', ' '), max: attribute.repeat ? Infinity : 1,
		required: attribute.required, description: attribute.description,
		attributes: attribute.children?.filter(child => child.type !== 'block') ?? [],
		fields: Object.fromEntries((attribute.children ?? []).filter(child => child.type !== 'block' && child.default !== undefined).map(child => [child.name, typeof child.default === 'string' ? child.default : JSON.stringify(child.default)])),
		children: blockDefinitions(attribute.children ?? [])
	}));
}

/** Merge richer curated metadata with every imported resource's primitive descriptors. */
export function editableFields(resource: Resource): AttrDef[] {
	const curated = getDef(resourceDefinition(resource).type)?.attributes.filter(field => field.type !== 'block') ?? [];
	const fields = new Map(curated.map(field => [field.name, field]));
	for (const field of resource.catalogue?.fields ?? []) {
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
	if (attribute?.type === 'list' || attribute?.type === 'map') {
		try { const parsed: unknown = JSON.parse(value); if (attribute.type === 'list' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return 'Enter a JSON ' + (attribute.type === 'list' ? 'array' : 'object'); } }
		catch { return 'Enter a JSON ' + (attribute.type === 'list' ? 'array' : 'object'); }
	}
	return undefined;
}

export function resourceFormIssues(resource: Resource): string[] {
	const issues: string[] = [];
	if (resource.catalogue) {
		for (const field of editableFields(resource)) {
			if (['name', 'location', 'region'].includes(field.name)) { continue; }
			const issue = fieldIssue(resource.settings[field.name] ?? '', field);
			if (issue) { issues.push(field.name + ': ' + issue); }
		}
	}
	const visit = (blocks: ResourceBlock[], definitions: BlockDefinition[], path: string) => {
		for (const definition of definitions) {
			const matching = blocks.filter(block => block.type === definition.type);
			if (definition.required && !matching.length) { issues.push(path + definition.type + ': Required block'); }
			if (matching.length > definition.max) { issues.push(path + definition.type + ': Too many blocks'); }
			matching.forEach((block, index) => {
				const prefix = path + definition.type + '[' + (index + 1) + '].';
				for (const field of definition.attributes ?? []) {
					const issue = fieldIssue(block.values[field.name] ?? '', field);
					if (issue) { issues.push(prefix + field.name + ': ' + issue); }
				}
				visit(block.blocks, definition.children, prefix);
			});
		}
	};
	visit(resource.blocks, additionalBlocks(resource), '');
	return issues;
}

/** Small explicit preview definitions. Production forms consume Rust FormSchema. */
export function additionalBlocks(resource: Resource): BlockDefinition[] {
	const schema = getDef(resourceDefinition(resource).type);
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
