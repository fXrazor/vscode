/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure adapter from the Rust service's `FormSchema` (`extensions/cloudforge/src/canvas/schemaForm.ts`)
 * into CloudForge Studio's `AttrDef` and `BlockDefinition` models.
 *
 * Curated `cloudlab-core` metadata (`refTypes`, `refAttr`, `cidr`, `default`) is preserved when
 * present so live version-matched Rust provider schemas enrich forms and diagnostics without
 * losing typed reference or inheritance constraints.
 */

import type { AttrDef, AttrType } from './cloudlab-core/catalog/types.ts';
import type { BlockDefinition } from './formDefinition.ts';

export type HostSchemaKind = 'resource' | 'dataSource';
export type HostFieldAccess = 'required' | 'optional' | 'computedOnly';
export type HostFieldValueType = 'string' | 'number' | 'bool' | 'listString' | 'mapString';

export interface HostFormAttribute {
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

function mapFieldType(valueType: HostFieldValueType): AttrType {
	switch (valueType) {
		case 'number': return 'number';
		case 'bool': return 'bool';
		case 'listString': return 'list';
		case 'mapString': return 'map';
		case 'string':
		default:
			return 'string';
	}
}

function toAttrDef(attribute: HostFormAttribute, curated?: AttrDef): AttrDef {
	return {
		name: attribute.name,
		type: mapFieldType(attribute.valueType),
		required: attribute.access === 'required',
		description: attribute.description || curated?.description || '',
		...(curated?.default !== undefined ? { default: curated.default } : {}),
		...(attribute.options?.length ? { options: [...attribute.options] } : curated?.options?.length ? { options: [...curated.options] } : {}),
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
	const computedOnly = new Set(schema.attributes.filter(attr => attr.access === 'computedOnly').map(attr => attr.name));
	const merged = new Map<string, AttrDef>();
	for (const attr of schema.attributes) {
		if (attr.access === 'computedOnly') {
			continue;
		}
		merged.set(attr.name, toAttrDef(attr, curatedByName.get(attr.name)));
	}
	for (const curated of curatedAttributes) {
		if (curated.type !== 'block' && !computedOnly.has(curated.name) && !merged.has(curated.name)) {
			merged.set(curated.name, curated);
		}
	}
	return [...merged.values()];
}

/** Convert live Rust `FormSchema` nested blocks to Studio `BlockDefinition[]`, preserving curated child rules. */
export function liveSchemaBlocks(schema: HostFormSchema, curatedAttributes: readonly AttrDef[] = []): BlockDefinition[] {
	const curatedBlocks = new Map(curatedAttributes.filter(attr => attr.type === 'block').map(attr => [attr.name, attr]));
	const out: BlockDefinition[] = [];
	const seen = new Set<string>();

	for (const block of schema.blocks) {
		seen.add(block.name);
		const curated = curatedBlocks.get(block.name);
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
		out.push({
			type: block.name,
			label: block.name.replaceAll('_', ' '),
			max,
			required: typeof block.minItems === 'number' && block.minItems > 0,
			description: block.description || curated?.description,
			attributes,
			fields,
			children: [],
		});
	}

	// Retain curated nested blocks not yet emitted by a flat block summary (if any).
	for (const curated of curatedBlocks.values()) {
		if (seen.has(curated.name)) {
			continue;
		}
		const children = (curated.children ?? []).filter(child => child.type !== 'block');
		out.push({
			type: curated.name,
			label: curated.name.replaceAll('_', ' '),
			max: curated.repeat ? Infinity : 1,
			required: curated.required,
			description: curated.description,
			attributes: children,
			fields: Object.fromEntries(children.filter(c => c.default !== undefined).map(c => [c.name, typeof c.default === 'string' ? c.default : JSON.stringify(c.default)])),
			children: [],
		});
	}

	return out;
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
