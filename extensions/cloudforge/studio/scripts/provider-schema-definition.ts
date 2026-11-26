/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { AttrDef } from '../src/cloudlab-core/catalog/types.ts';
import type { LiteralShape } from '../../src/canvas/literalSchema.ts';
import { readLiteralShape } from '../../src/canvas/serviceAdapters.ts';

type RawAttribute = { type?: unknown; nested_type?: { nesting_mode: string; min_items?: number; max_items?: number; attributes: Record<string, RawAttribute> }; description?: string; required?: boolean; optional?: boolean; computed?: boolean; sensitive?: boolean; write_only?: boolean; deprecated?: boolean };
export type RawBlock = { attributes?: Record<string, RawAttribute>; block_types?: Record<string, { nesting_mode: string; min_items?: number; max_items?: number; block: RawBlock }> };
function typeExpression(raw: unknown): unknown {
	if (typeof raw === 'string') { return { kind: raw }; }
	if (!Array.isArray(raw) || typeof raw[0] !== 'string') { return undefined; }
	const [kind, content] = raw;
	if (kind === 'object' && content && typeof content === 'object') { return { kind, members: Object.fromEntries(Object.entries(content).map(([name, type]) => [name, typeExpression(type)])) }; }
	if (kind === 'tuple' && Array.isArray(content)) { return { kind, elements: content.map(typeExpression) }; }
	return { kind, element: typeExpression(content) };
}
function nestedType(nested: RawAttribute['nested_type']): unknown {
	return nested && { mode: nested.nesting_mode, minItems: nested.min_items, maxItems: nested.max_items, attributes: Object.entries(nested.attributes).map(([name, attribute]) => ({ name, access: attribute.required ? 'required' : attribute.computed && !attribute.optional ? 'computedOnly' : 'optional', description: attribute.description, sensitive: attribute.sensitive || attribute.write_only, typeExpr: typeExpression(attribute.type), nested: nestedType(attribute.nested_type) })) };
}
export function providerSchemaAttributes(block: RawBlock, documented: readonly AttrDef[] = [], reviewed: readonly AttrDef[] = []): AttrDef[] {
	const attributes: AttrDef[] = Object.entries(block.attributes ?? {}).map(([name, attribute]) => {
		const literalShape = readLiteralShape(typeExpression(attribute.type), nestedType(attribute.nested_type));
		const previous = reviewed.find(field => field.name === name);
		return { name, type: literalShape?.kind === 'list' || literalShape?.kind === 'set' || literalShape?.kind === 'tuple' ? 'list' : literalShape?.kind === 'map' || literalShape?.kind === 'object' ? 'map' : literalShape?.kind === 'number' || literalShape?.kind === 'bool' || literalShape?.kind === 'string' ? literalShape.kind : 'json', description: attribute.description || previous?.description || '', required: attribute.required === true, readOnly: attribute.computed === true && attribute.optional !== true && attribute.required !== true, sensitive: attribute.sensitive || attribute.write_only || undefined, deprecated: attribute.deprecated || undefined, literalShape,
			// Only reviewed reference metadata is carried across; prose guesses cannot restrict schema fields.
			...(previous?.refTypes ? { refTypes: previous.refTypes, refAttr: previous.refAttr } : {}), ...(previous?.cidr ? { cidr: true } : {}) };
	});
	for (const [name, nested] of Object.entries(block.block_types ?? {})) {
		attributes.push({ name, type: 'block', description: documented.find(field => field.name === name)?.description ?? '', required: (nested.min_items ?? 0) > 0, minItems: nested.min_items, maxItems: nested.max_items, repeat: nested.nesting_mode !== 'single' && nested.nesting_mode !== 'group' && nested.max_items !== 1, children: providerSchemaAttributes(nested.block, documented.find(field => field.name === name)?.children, reviewed.find(field => field.name === name)?.children) });
	}
	return attributes;
}

/** Exact schema/member paths for the documentation audit, including computed outputs. */
export function providerFieldPaths(attributes: readonly AttrDef[], prefix = '', inheritedReadOnly = false): { path: string; readOnly: boolean }[] {
	const out: { path: string; readOnly: boolean }[] = [];
	const members = (shape: LiteralShape | undefined, path: string, readOnly: boolean) => {
		if (shape?.kind === 'object') { for (const [name, member] of Object.entries(shape.members ?? {})) { const child = path + '.' + name; const output = readOnly || member.access === 'computedOnly'; out.push({ path: child, readOnly: output }); members(member.shape, child, output); } }
		if (shape?.element) { members(shape.element, path, readOnly); }
		for (const element of shape?.elements ?? []) { members(element, path, readOnly); }
	};
	for (const attribute of attributes) {
		const path = prefix + attribute.name, readOnly = inheritedReadOnly || attribute.readOnly === true;
		out.push({ path, readOnly }); members(attribute.literalShape, path, readOnly);
		out.push(...providerFieldPaths(attribute.children ?? [], path + '.', readOnly));
	}
	return out;
}
