/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure adapter from the Rust service's `FormSchema` (`extensions/cloudforge/src/canvas/schemaForm.ts`)
 * into CloudForge Studio's `AttrDef` and `BlockDefinition` models.
 *
 * Curated `cloudlab-core` metadata (`refTypes`, `refAttr`, `cidr`, `default`) is preserved when
 * present so imported Rust provider schemas enrich forms and diagnostics without
 * losing typed reference or inheritance constraints.
 */

import type { AttrDef, AttrType } from './cloudlab-core/catalog/types.ts';
import type { BlockDefinition } from './formDefinition.ts';
import type { LiteralShape } from '../../src/canvas/literalSchema.ts';

export type HostSchemaKind = 'resource' | 'dataSource';
export type HostFieldAccess = 'required' | 'optional' | 'computedOnly';
export type HostFieldValueType = 'string' | 'number' | 'bool' | 'listString' | 'mapString' | 'json';

export interface HostFormAttribute {
	readonly literalShape?: LiteralShape;
	readonly name: string;
	readonly path: string;
	readonly access: HostFieldAccess;
	readonly valueType: HostFieldValueType;
	readonly description: string;
	readonly sensitive?: boolean;
	readonly deprecated?: boolean;
	readonly options?: readonly string[];
	readonly placeholder?: string;
}

export interface HostFormBlockType {
	readonly name: string;
	readonly path: string;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly description: string;
	readonly attributes: readonly HostFormAttribute[];
}

export interface HostSchemaOutput {
	readonly name: string;
	readonly valueType: HostFieldValueType;
	readonly description: string;
	readonly knownAtApply: boolean;
}

/** Visual form coverage for one type, from the service's `getCatalogueCoverage`. */
export interface HostFormCoverage {
	readonly complete: boolean;
	readonly paths: number;
	readonly readOnly: number;
	readonly gaps: readonly { readonly path: string; readonly reason: string }[];
}

export interface HostFormSchema {
	readonly selection?: { readonly sourceRevision: string; readonly address: string; readonly snapshotSha256: string; readonly lockedVersionVerified: true };
	readonly kind: HostSchemaKind;
	readonly typeName: string;
	readonly providerSource: string;
	readonly providerVersion: string;
	readonly description: string;
	readonly docsUrl: string;
	readonly exampleHcl: string;
	readonly attributes: readonly HostFormAttribute[];
	readonly blocks: readonly HostFormBlockType[];
	readonly outputs: readonly HostSchemaOutput[];
	readonly coverage?: HostFormCoverage;
}

export type LiveSchemaMap = Readonly<Record<string, HostFormSchema>>;

/** JSON controls can represent complex literal collections which older coverage reports marked code-only. */
export function formCoverageGaps(schema: HostFormSchema): HostFormCoverage['gaps'] {
	const normalize = (path: string) => path.replace(/\[(?:\d*|\*)\]/g, '');
	const attributes = [...schema.attributes, ...schema.blocks.flatMap(block => block.attributes)];
	return (schema.coverage?.gaps ?? []).filter(gap => !attributes.some(attribute => {
		const path = normalize(attribute.path), target = normalize(gap.path);
		return target === path || (['listString','mapString','json'].includes(attribute.valueType) && target.startsWith(path + '.'));
	}));
}

function mapFieldType(valueType: HostFieldValueType): AttrType {
	switch (valueType) {
		case 'number': return 'number';
		case 'bool': return 'bool';
		case 'listString': return 'list';
		case 'mapString': return 'map';
		case 'json': return 'json';
		case 'string':
		default:
			return 'string';
	}
}

function toAttrDef(attribute: HostFormAttribute, curated?: AttrDef): AttrDef {
	return {
		name: attribute.name,
		...(attribute.literalShape ? { literalShape: attribute.literalShape } : {}),
		type: mapFieldType(attribute.valueType),
		required: attribute.access === 'required',
		description: attribute.description || curated?.description || '',
		...(attribute.options?.length ? { options: [...attribute.options] } : {}),
		...(curated?.refTypes?.length ? { refTypes: [...curated.refTypes] } : {}),
		...(curated?.refAttr ? { refAttr: curated.refAttr } : {}),
		...(curated?.cidr ? { cidr: true } : {}),
		...(attribute.sensitive || curated?.sensitive ? { sensitive: true } : {}),
		...(attribute.placeholder ? { placeholder: attribute.placeholder } : curated?.placeholder ? { placeholder: curated.placeholder } : {}),
		...(attribute.deprecated || curated?.deprecated ? { deprecated: true } : {}),
	};
}

/** Convert editable (non-computedOnly) live Rust `FormSchema` attributes to `AttrDef[]`. */
export function liveSchemaAttributes(schema: HostFormSchema, curatedAttributes: readonly AttrDef[] = []): AttrDef[] {
	const curatedByName = new Map(curatedAttributes.filter(attr => attr.type !== 'block').map(attr => [attr.name, attr]));
	const merged = new Map<string, AttrDef>();
	for (const attr of schema.attributes) {
		if (attr.access === 'computedOnly') {
			continue;
		}
		merged.set(attr.name, toAttrDef(attr, curatedByName.get(attr.name)));
	}
	return [...merged.values()];
}

/** Convert live Rust `FormSchema` nested blocks to Studio `BlockDefinition[]`, preserving curated child rules. */
export function liveSchemaBlocks(schema: HostFormSchema, curatedAttributes: readonly AttrDef[] = []): BlockDefinition[] {
	const definitions = new Map<string, BlockDefinition>();
	const pathOf = (path: string) => path.replace(/\[(?:\d*|\*)\]/g, '').split('.').filter(Boolean);
	const curatedAt = (path: string[]): AttrDef | undefined => {
		let attributes = curatedAttributes;
		let found: AttrDef | undefined;
		for (const name of path) { found = attributes.find(attribute => attribute.name === name); attributes = found?.children ?? []; }
		return found;
	};

	for (const block of schema.blocks) {
		const path = pathOf(block.path || block.name);
		const curated = curatedAt(path);
		const curatedChildren = new Map((curated?.children ?? []).filter(child => child.type !== 'block').map(child => [child.name, child]));
		const attributes: AttrDef[] = block.attributes
			.filter(attr => attr.access !== 'computedOnly')
			.map(attr => toAttrDef(attr, curatedChildren.get(attr.name)));
		const fields = Object.fromEntries(
			attributes
				.filter(attr => attr.default !== undefined)
				.map(attr => [attr.name, typeof attr.default === 'string' ? attr.default : JSON.stringify(attr.default)])
		);
		const max = typeof block.maxItems === 'number' && block.maxItems > 0 ? block.maxItems : Infinity;
		definitions.set(path.join('.'), {
			type: block.name,
			label: block.name.replaceAll('_', ' '),
			max,
			min: block.minItems,
			required: typeof block.minItems === 'number' && block.minItems > 0,
			description: block.description || curated?.description,
			attributes,
			fields,
			children: [],
		});
	}

	// Rust sends a flat list with full paths. Reconstruct the actual nesting, never a second root block.
	const out: BlockDefinition[] = [];
	for (const [path, definition] of definitions) {
		const parts = path.split('.');
		if (parts.length === 1) { out.push(definition); }
		else { definitions.get(parts.slice(0, -1).join('.'))?.children.push(definition); }
	}
	return out;
}

/** Shared recursive tree for field binding/validation, matching the nested form exactly. */
export function liveSchemaDefinitionTree(schema: HostFormSchema, curatedAttributes: readonly AttrDef[] = []): AttrDef[] {
	const convert = (block: BlockDefinition): AttrDef => ({
		name: block.type, type: 'block', description: block.description ?? '', required: block.required,
		repeat: block.max > 1, children: [...block.attributes ?? [], ...block.children.map(convert)],
	});
	return [...liveSchemaAttributes(schema, curatedAttributes), ...liveSchemaBlocks(schema, curatedAttributes).map(convert)];
}

/** Exported attribute names known for a resource from its live Rust `FormSchema`. */
export function liveSchemaOutputs(schema: HostFormSchema | undefined): string[] {
	if (!schema) {
		return [];
	}
	const names = new Set<string>();
	for (const output of schema.outputs) {
		names.add(output.name);
	}
	for (const attr of schema.attributes) {
		if (attr.access === 'computedOnly') {
			names.add(attr.name);
		}
	}
	return [...names];
}
