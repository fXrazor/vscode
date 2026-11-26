/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Builds the Rust `ResourceDraft` for one canvas resource, so the service can render and check
// it against the exact pinned provider schema (`renderResourceDraft`). Pure: no React or DOM.

import { address, inCode, isExpr, isRef, nodeById, type Value } from './cloudlab-core/model.ts';
import type { HostFormSchema } from './liveSchema.ts';
import type { Architecture } from './model.ts';
import { projectTerraform } from './terraformProjection.ts';

export type DraftValue =
	| { readonly kind: 'literal'; readonly value: unknown }
	| { readonly kind: 'expression'; readonly text: string };

export interface DraftBody {
	readonly attributes: Record<string, DraftValue>;
	readonly blocks: DraftBlock[];
}

export interface DraftBlock {
	readonly name: string;
	readonly body: DraftBody;
}

export interface ResourceDraft {
	readonly kind: 'resource';
	readonly typeName: string;
	readonly label: string;
	readonly body: DraftBody;
}

/** Diagnostic returned by `renderResourceDraft`. */
export interface SchemaPreviewDiagnostic {
	readonly path: string;
	readonly message: string;
	readonly severity: 'error' | 'warning';
}

export interface SchemaPreview {
	readonly resourceId: string;
	readonly hcl: string;
	readonly diagnostics: readonly SchemaPreviewDiagnostic[];
	readonly hasErrors: boolean;
	readonly providerVersion?: string;
}

const MAX_DEPTH = 8;

function isPlainObject(value: Value | undefined): value is Record<string, Value> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && !isRef(value) && !isExpr(value);
}

/**
 * The draft for `resourceId`, or `undefined` for modules, icon-only items and resources whose
 * live schema is not loaded. Nested objects become blocks when the schema names them as blocks,
 * and literals otherwise; references and `var.` bindings become expressions.
 */
export function buildResourceDraft(architecture: Architecture, resourceId: string, schema: HostFormSchema | undefined): ResourceDraft | undefined {
	if (!schema || schema.kind !== 'resource') {
		return undefined;
	}
	const { project } = projectTerraform(architecture);
	const node = project.nodes.find(item => item.id === resourceId);
	if (!node || node.kind !== 'resource' || node.type !== schema.typeName || !inCode(node)) {
		return undefined;
	}
	const normalize = (path: string) => path.replace(/\[(?:\d*|\*)\]/g, '');
	const blockPaths = new Set(schema.blocks.map(block => normalize(block.path || block.name)));

	const expression = (value: Value): DraftValue | undefined => {
		if (isRef(value)) {
			const target = nodeById(project, value.$ref);
			return target && inCode(target) ? { kind: 'expression', text: `${address(target)}.${value.attr}` } : undefined;
		}
		if (isExpr(value)) {
			return { kind: 'expression', text: value.$expr };
		}
		return undefined;
	};
	const literal = (value: Value): unknown => {
		if (Array.isArray(value)) {
			return value.map(literal);
		}
		if (isPlainObject(value)) {
			return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, literal(item)]));
		}
		return value;
	};
	const hasReference = (value: Value): boolean =>
		isRef(value) || isExpr(value) || (Array.isArray(value) ? value.some(hasReference) : isPlainObject(value) && Object.values(value).some(hasReference));
	const listExpression = (items: Value[]): DraftValue | undefined => {
		const parts = items.map(item => expression(item)?.kind === 'expression' ? (expression(item) as { text: string }).text : typeof item === 'string' ? JSON.stringify(item) : typeof item === 'number' || typeof item === 'boolean' ? String(item) : undefined);
		return parts.every(part => part !== undefined) ? { kind: 'expression', text: `[${parts.join(', ')}]` } : undefined;
	};

	const body = (config: Record<string, Value>, prefix: string, depth: number): DraftBody => {
		const attributes: Record<string, DraftValue> = {};
		const blocks: DraftBlock[] = [];
		for (const [key, value] of Object.entries(config)) {
			const path = prefix ? `${prefix}.${key}` : key;
			const nested = Array.isArray(value) && value.length > 0 && value.every(isPlainObject) ? value : isPlainObject(value) ? [value] : undefined;
			if (nested && depth < MAX_DEPTH && blockPaths.has(path)) {
				for (const item of nested) {
					blocks.push({ name: key, body: body(item as Record<string, Value>, path, depth + 1) });
				}
				continue;
			}
			const direct = expression(value);
			if (direct) {
				attributes[key] = direct;
			} else if (Array.isArray(value) && hasReference(value)) {
				const list = listExpression(value);
				if (list) {
					attributes[key] = list;
				}
			} else if (!hasReference(value) && value !== undefined) {
				attributes[key] = { kind: 'literal', value: literal(value) };
			}
		}
		return { attributes, blocks };
	};

	return { kind: 'resource', typeName: node.type, label: node.name, body: body(node.config, '', 0) };
}

/** Validates a host `resourceDraftRendered` payload; anything malformed is dropped. */
export function parseSchemaPreview(value: unknown): SchemaPreview | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.resourceId !== 'string' || typeof record.hcl !== 'string' || record.hcl.length > 256 * 1024 || !Array.isArray(record.diagnostics)) {
		return undefined;
	}
	const diagnostics: SchemaPreviewDiagnostic[] = [];
	for (const item of record.diagnostics.slice(0, 200)) {
		if (item && typeof item === 'object') {
			const entry = item as Record<string, unknown>;
			if (typeof entry.path === 'string' && typeof entry.message === 'string' && (entry.severity === 'error' || entry.severity === 'warning')) {
				diagnostics.push({ path: entry.path, message: entry.message, severity: entry.severity });
			}
		}
	}
	return {
		resourceId: record.resourceId,
		hcl: record.hcl,
		diagnostics,
		hasErrors: record.hasErrors === true || diagnostics.some(item => item.severity === 'error'),
		...(typeof record.providerVersion === 'string' && record.providerVersion.length <= 64 ? { providerVersion: record.providerVersion } : {}),
	};
}
