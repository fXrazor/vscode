/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { key, parseHcl, quote, type HclBlock } from './cloudlab-core/hcl.ts';
import { isExpr, isRef, type Value } from './cloudlab-core/model.ts';
import { resourceDefinition } from './fixture.ts';
import { bindingKey, fieldPath, parseMixedListHclValue, type FieldTarget } from './fieldBindings.ts';
import { liveSchemaDefinitionTree, type HostFormSchema } from './liveSchema.ts';
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { isSensitiveProperty } from './variables.ts';
import { literalIssue } from '../../src/canvas/literalSchema.ts';

/** Only configuration the form cannot represent. Ordinary fields stay in settings/blocks. */
export interface TerraformExtraBody {
	attrs: Record<string, Value>;
	blocks: { type: string; labels: string[]; resourceBlockId?: string; body: TerraformExtraBody }[];
}
const empty = (): TerraformExtraBody => ({ attrs: {}, blocks: [] });
export const hasTerraformExtras = (body: TerraformExtraBody | undefined): boolean => !!body && (Object.keys(body.attrs).length > 0 || body.blocks.some(block => !block.resourceBlockId || hasTerraformExtras(block.body)));

function containsExpression(value: Value): boolean {
	return isExpr(value) || isRef(value) || (Array.isArray(value) ? value.some(containsExpression) : !!value && typeof value === 'object' && Object.values(value).some(containsExpression));
}

export function terraformValueText(value: Value): string {
	if (isExpr(value)) { return value.$expr; }
	if (isRef(value)) { throw new Error('Resolve a typed resource reference before writing additional Terraform.'); }
	if (Array.isArray(value)) { return '[' + value.map(terraformValueText).join(', ') + ']'; }
	if (value !== null && typeof value === 'object') { return '{ ' + Object.entries(value).map(([name, child]) => key(name) + ' = ' + terraformValueText(child)).join(', ') + ' }'; }
	return typeof value === 'string' ? quote(value) : JSON.stringify(value);
}

function writeBlock(block: HclBlock, indent = ''): string {
	const head = [block.type, ...block.labels.map(quote)].join(' ');
	const lines = Object.entries(block.attrs).map(([name, value]) => indent + '  ' + key(name) + ' = ' + terraformValueText(value));
	lines.push(...block.blocks.map(child => writeBlock(child, indent + '  ')));
	return indent + head + ' {\n' + lines.join('\n') + '\n' + indent + '}';
}

function mergeBody(block: HclBlock, extras: TerraformExtraBody, resourceBlocks: readonly ResourceBlock[]): HclBlock {
	const result = structuredClone(block);
	Object.assign(result.attrs, extras.attrs);
	for (const extra of extras.blocks) {
		if (extra.resourceBlockId) {
			const resourceBlock = resourceBlocks.find(item => item.id === extra.resourceBlockId);
			if (!resourceBlock) { continue; } // Form deletion cannot resurrect a removed block.
			const index = resourceBlocks.filter(item => item.type === resourceBlock.type).findIndex(item => item.id === resourceBlock.id);
			const target = result.blocks.filter(item => item.type === resourceBlock.type)[index];
			if (target) { result.blocks[result.blocks.indexOf(target)] = mergeBody(target, extra.body, resourceBlock.blocks); }
		} else {
			result.blocks.push(mergeBody({ type: extra.type, labels: extra.labels, attrs: {}, blocks: [], order: [] }, extra.body, []));
		}
	}
	return result;
}

/** Merge sparse additional configuration into a generated file, preserving labelled dynamic blocks. */
export function includeAdditionalTerraform(code: string, resources: readonly Resource[]): string {
	if (!resources.some(resource => hasTerraformExtras(resource.terraformExtras))) { return code; }
	const file = parseHcl(code);
	const blocks = file.blocks.map(block => {
		const resource = resources.find(item => block.type === 'resource' && block.labels[0] === resourceDefinition(item).type && block.labels[1] === (item.terraformName ?? item.name));
		return resource?.terraformExtras ? mergeBody(block, resource.terraformExtras, resource.blocks) : block;
	});
	return [...Object.entries(file.attrs).map(([name, value]) => key(name) + ' = ' + terraformValueText(value)), ...blocks.map(block => writeBlock(block))].join('\n\n');
}

export function extraFieldValue(resource: Resource, target: FieldTarget): Value | undefined {
	if (target.kind !== 'block') { return resource.terraformExtras?.attrs[target.kind === 'name' ? 'name' : target.kind === 'region' ? (getDef(resourceDefinition(resource).type)?.attributes.some(attribute => attribute.name === 'location') ? 'location' : 'region') : resource.catalogue ? target.name : fieldPath(target.name).join('.')]; }
	const visit = (body: TerraformExtraBody | undefined): Value | undefined => {
		for (const block of body?.blocks ?? []) {
			if (block.resourceBlockId === target.blockId) { return block.body.attrs[target.name]; }
			const found = visit(block.body); if (found !== undefined) { return found; }
		}
		return undefined;
	};
	return visit(resource.terraformExtras);
}

export function pruneTerraformExtras(resource: Resource, blocks: readonly ResourceBlock[]): TerraformExtraBody | undefined {
	const ids = new Set<string>();
	const collect = (items: readonly ResourceBlock[]) => { for (const block of items) { ids.add(block.id); collect(block.blocks); } };
	collect(blocks);
	const prune = (body: TerraformExtraBody): TerraformExtraBody => ({ attrs: body.attrs, blocks: body.blocks.filter(block => !block.resourceBlockId || ids.has(block.resourceBlockId)).map(block => ({ ...block, body: prune(block.body) })) });
	return resource.terraformExtras ? prune(resource.terraformExtras) : undefined;
}

export function dynamicBlockConfigured(resource: Resource, type: string, parentBlockId?: string): boolean {
	const at = (body: TerraformExtraBody | undefined): TerraformExtraBody | undefined => {
		if (!parentBlockId) { return body; }
		for (const block of body?.blocks ?? []) { if (block.resourceBlockId === parentBlockId) { return block.body; } const found = atNested(block.body); if (found) { return found; } }
		return undefined;
	};
	const atNested = (body: TerraformExtraBody): TerraformExtraBody | undefined => {
		for (const block of body.blocks) { if (block.resourceBlockId === parentBlockId) { return block.body; } const found = atNested(block.body); if (found) { return found; } }
		return undefined;
	};
	return !!at(resource.terraformExtras)?.blocks.some(block => !block.resourceBlockId && block.type === 'dynamic' && block.labels[0] === type);
}

export function additionalTerraformItems(resource: Resource): { path: string; query: string; description: string }[] {
	const items: { path: string; query: string; description: string }[] = [];
	const visit = (body: TerraformExtraBody, prefix: string) => {
		for (const name of Object.keys(body.attrs)) { items.push({ path: prefix + name, query: name, description: 'Terraform expression or configuration outside the current form schema.' }); }
		for (const block of body.blocks) {
			if (block.resourceBlockId) { visit(block.body, prefix + block.type + '.'); }
			else { items.push({ path: prefix + block.type + (block.labels.length ? '.' + block.labels.join('.') : ''), query: [block.type, ...block.labels.map(quote)].join(' '), description: block.type === 'dynamic' ? 'Terraform generates these nested blocks from an expression.' : 'This labelled or schema-unavailable block is preserved in Terraform.' }); }
		}
	};
	if (resource.terraformExtras) { visit(resource.terraformExtras, ''); }
	return items;
}

/** New literal fields/blocks go into forms; only expressions/unknown schema structure stay sparse. */
export function resourceFromTerraform(resource: Resource, block: HclBlock, baseline: HclBlock, schema?: HostFormSchema, architecture?: Architecture): Resource {
	const attributes = schema ? liveSchemaDefinitionTree(schema, getDef(block.labels[0])?.attributes) : getDef(block.labels[0])?.attributes ?? [];
	const next: Resource = { ...resource, settings: { ...resource.settings }, blocks: [], fieldBindings: { ...resource.fieldBindings }, resourceRefs: { ...resource.resourceRefs } };
	const before = baseline;
	const convert = (source: HclBlock, definitions: readonly AttrDef[], previous: readonly ResourceBlock[], old: HclBlock | undefined, prefix: string, blockId?: string): { values: Record<string, string>; blocks: ResourceBlock[]; extras: TerraformExtraBody } => {
		const values: Record<string, string> = {};
		const blocks: ResourceBlock[] = [];
		const extras = empty();
		for (const [name, value] of Object.entries(source.attrs)) {
			const definition = definitions.find(attribute => attribute.name === name && attribute.type !== 'block');
			const fullPath = prefix + name;
			if (definition?.readOnly) { throw new Error(fullPath + ' is a provider output and cannot be configured.'); }
			if (schema && [...schema.attributes, ...schema.blocks.flatMap(item => item.attributes)].some(attribute => attribute.path === fullPath && attribute.access === 'computedOnly')) { throw new Error(fullPath + ' is a provider output and cannot be configured.'); }
			const originalKey = !blockId ? Object.keys(resource.settings).find(key => fieldPath(key).join('.') === name) : undefined;
			const target: FieldTarget = blockId ? { kind: 'block', blockId, name } : name === 'name' ? { kind: 'name' } : ['location', 'region'].includes(name) ? { kind: 'region' } : { kind: 'setting', name: originalKey ?? name };
			const binding = bindingKey(target);
			if (containsExpression(value) && JSON.stringify(value) === JSON.stringify(old?.attrs[name]) && !extraFieldValue(resource, target)) { continue; }
			delete next.fieldBindings![binding]; delete next.resourceRefs![binding];
			if (!definition && !['count', 'for_each', 'depends_on'].includes(name)) { throw new Error('The schema does not describe ' + fullPath + '. Import the matching provider schema before applying it.'); }
			if (containsExpression(value)) {
				const mixed = architecture ? parseMixedListHclValue(value, architecture, resource, definition) : undefined;
				if (mixed) {
					next.resourceRefs![binding] = mixed;
					values[originalKey ?? name] = (blockId ? previous.find(item => item.id === blockId)?.values[name] : resource.settings[originalKey ?? name]) ?? '';
					continue;
				}
				extras.attrs[name] = value;
				continue;
			}
			if (!definition) { throw new Error('This meta-argument needs its typed form definition before applying a literal value.'); }
			if (isSensitiveProperty(name, definition.sensitive) && typeof value === 'string' && value !== '') { throw new Error('Use a sensitive variable for ' + fullPath + '; literal secrets are not applied from this editor.'); }
			const valid = definition.type === 'json' ? true : definition.type === 'string' ? typeof value === 'string' : definition.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : definition.type === 'bool' ? typeof value === 'boolean' : definition.type === 'list' ? Array.isArray(value) : definition.type === 'map' ? value !== null && typeof value === 'object' && !Array.isArray(value) : false;
			if (!valid) { throw new Error(fullPath + ' needs a ' + definition.type + ' value.'); }
			const issue = literalIssue(value, definition.literalShape, fullPath);
			if (issue) { throw new Error(issue); }
			const text = typeof value === 'string' && definition.type !== 'json' ? value : JSON.stringify(value);
			if (!blockId && name === 'name') { next.name = text; }
			else if (!blockId && ['location', 'region'].includes(name)) { next.region = text; }
			else { values[originalKey ?? name] = text; }
		}
		const occurrences = new Map<string, number>();
		for (const child of source.blocks) {
			const definition = definitions.find(attribute => attribute.name === child.type && attribute.type === 'block');
			const index = occurrences.get(child.type) ?? 0; occurrences.set(child.type, index + 1);
			if (!definition || child.labels.length) {
				const opaque = (value: HclBlock): TerraformExtraBody => {
					for (const [name, literal] of Object.entries(value.attrs)) { if (isSensitiveProperty(name) && typeof literal === 'string' && literal) { throw new Error('Use a sensitive variable for ' + name + '; literal secrets are not applied from this editor.'); } }
					return { attrs: structuredClone(value.attrs), blocks: value.blocks.map(nested => ({ type: nested.type, labels: nested.labels, body: opaque(nested) })) };
				};
				extras.blocks.push({ type: child.type, labels: child.labels, body: opaque(child) }); continue;
			}
			const existing = previous.filter(item => item.type === child.type)[index];
			const id = existing?.id ?? crypto.randomUUID();
			const converted = convert(child, definition.children ?? [], existing?.blocks ?? [], old?.blocks.filter(item => item.type === child.type)[index], prefix + child.type + '.', id);
			blocks.push({ id, type: child.type, values: { ...existing?.values, ...converted.values }, blocks: converted.blocks });
			if (hasTerraformExtras(converted.extras)) { extras.blocks.push({ type: child.type, labels: [], resourceBlockId: id, body: converted.extras }); }
		}
		// Preserve the previous guarded-apply boundary for deleting existing form configuration.
		for (const name of Object.keys(old?.attrs ?? {})) {
			if (!Object.hasOwn(source.attrs, name) && definitions.some(attribute => attribute.name === name) && !extraFieldValue(resource, blockId ? { kind: 'block', blockId, name } : { kind: 'setting', name })) { throw new Error('Remove existing form fields in Form before applying this code.'); }
		}
		return { values, blocks, extras };
	};
	const converted = convert(block, attributes, resource.blocks, before, '');
	next.settings = { ...next.settings, ...converted.values };
	next.blocks = converted.blocks;
	if (hasTerraformExtras(converted.extras)) { next.terraformExtras = converted.extras; }
	else { delete next.terraformExtras; }
	return next;
}
