/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Fills canvas resources with the values written in the Terraform files (Rust
// `readResourceValues`), so the canvas shows what the files say instead of catalogue defaults.
// Pure: no React or DOM. Only plain literals are copied; expressions, references and redacted
// secrets keep the canvas value, and the three-way save keeps the file's text for those.

import { providerRegions } from './fixture.ts';
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { projectTerraform } from './terraformProjection.ts';
import type { HostGraphSnapshot } from './webviewBridge.ts';
import { bindingKey, type FieldTarget } from './fieldBindings.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';
import { parseHcl } from './cloudlab-core/hcl.ts';
import type { TerraformExtraBody } from './additionalTerraform.ts';
import { hasTerraformExtras, pruneTerraformExtras } from './additionalTerraform.ts';
import { variableTypes, type VariableDefinition, type VariableValue } from './variables.ts';

export type FileValue =
	| { readonly kind: 'literal'; readonly value: unknown }
	| { readonly kind: 'expression'; readonly text: string }
	| { readonly kind: 'redacted' };

export interface FileBlockValues {
	readonly name: string;
	readonly attributes: Readonly<Record<string, FileValue>>;
	readonly blocks: readonly FileBlockValues[];
}

export interface FileVariable {
	readonly name: string;
	readonly file: string;
	readonly type?: string;
	readonly description?: string;
	readonly sensitive: boolean;
	readonly default?: FileValue;
}

export interface FileResourceValues {
	readonly address: string;
	readonly file: string;
	readonly attributes: Readonly<Record<string, FileValue>>;
	readonly blocks: readonly FileBlockValues[];
}

const MAX_RESOURCES = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttributes(value: unknown): Record<string, FileValue> {
	const out: Record<string, FileValue> = {};
	if (!isRecord(value)) {
		return out;
	}
	for (const [name, entry] of Object.entries(value).slice(0, 256)) {
		if (!isRecord(entry)) {
			continue;
		}
		if (entry.kind === 'literal' && 'value' in entry) {
			out[name] = { kind: 'literal', value: entry.value };
		} else if (entry.kind === 'expression' && typeof entry.text === 'string') {
			out[name] = { kind: 'expression', text: entry.text };
		} else if (entry.kind === 'redacted') {
			out[name] = { kind: 'redacted' };
		}
	}
	return out;
}

function parseBlocks(value: unknown, depth: number): FileBlockValues[] {
	if (!Array.isArray(value) || depth > 8) {
		return [];
	}
	return value.slice(0, 256).filter(isRecord).filter(block => typeof block.name === 'string').map(block => ({
		name: block.name as string,
		attributes: parseAttributes(block.attributes),
		blocks: parseBlocks(block.blocks, depth + 1),
	}));
}

/** Validates a `readResourceValues` result; anything malformed is dropped. */
export function parseResourceValues(value: unknown): { readonly sourceRevision: string; readonly resources: readonly FileResourceValues[]; readonly variables: readonly FileVariable[] } | undefined {
	if (!isRecord(value) || typeof value.sourceRevision !== 'string' || !Array.isArray(value.resources)) {
		return undefined;
	}
	const resources = value.resources.slice(0, MAX_RESOURCES).filter(isRecord)
		.filter(item => typeof item.address === 'string' && typeof item.file === 'string')
		.map(item => ({
			address: item.address as string,
			file: item.file as string,
			attributes: parseAttributes(item.attributes),
			blocks: parseBlocks(item.blocks, 0),
		}));
	const variables: FileVariable[] = (Array.isArray(value.variables) ? value.variables : []).slice(0, MAX_RESOURCES).filter(isRecord)
		.filter(item => typeof item.name === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(item.name) && typeof item.file === 'string')
		.map(item => {
			const parsedDefault = parseAttributes({ default: item.default }).default;
			return {
				name: item.name as string,
				file: item.file as string,
				sensitive: item.sensitive === true,
				...(typeof item.type === 'string' ? { type: item.type } : {}),
				...(typeof item.description === 'string' ? { description: item.description } : {}),
				...(parsedDefault ? { default: parsedDefault } : {}),
			};
		});
	return { sourceRevision: value.sourceRevision, resources, variables };
}

const variableTypeOf = (text: string | undefined): VariableDefinition['type'] => {
	const compact = (text ?? '').replace(/\s+/g, '');
	return (variableTypes as readonly string[]).includes(compact) ? compact as VariableDefinition['type'] : text === undefined ? 'string' : 'any';
};

function isVariableValue(value: unknown): value is VariableValue {
	if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.every(isVariableValue);
	}
	return isRecord(value) && Object.values(value).every(isVariableValue);
}

/** Canvas variables for the file's `variable` blocks that the canvas does not have yet. */
export function variablesFromFiles(existing: readonly VariableDefinition[] | undefined, variables: readonly FileVariable[]): VariableDefinition[] {
	const names = new Set((existing ?? []).map(item => item.name));
	const added: VariableDefinition[] = [];
	for (const variable of variables) {
		if (names.has(variable.name)) {
			continue;
		}
		names.add(variable.name);
		const fallback = variable.default?.kind === 'literal' && isVariableValue(variable.default.value) ? variable.default.value : undefined;
		added.push({
			id: 'file-variable:' + variable.name,
			name: variable.name,
			type: variableTypeOf(variable.type),
			description: variable.description ?? '',
			sensitive: variable.sensitive,
			...(fallback !== undefined ? { defaultValue: fallback } : {}),
		});
	}
	return added;
}

/** The file value at a projection path such as `['ip_configuration', '0', 'name']`. */
function valueAt(values: { attributes: Readonly<Record<string, FileValue>>; blocks: readonly FileBlockValues[] }, path: readonly string[]): FileValue | undefined {
	let cursor = values;
	for (let index = 0; index < path.length; index++) {
		const segment = path[index];
		if (index === path.length - 1) {
			return cursor.attributes[segment];
		}
		const matching = cursor.blocks.filter(block => block.name === segment);
		let position = 0;
		if (/^\d+$/.test(path[index + 1] ?? '')) {
			position = Number(path[index + 1]);
			index++;
			if (index === path.length - 1) {
				return undefined;
			}
		}
		const next = matching[position];
		if (!next) {
			return undefined;
		}
		cursor = next;
	}
	return undefined;
}

/** Canvas text for a file literal, keeping `original` when it already means the same value. */
function textFor(value: unknown, original: string): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	const meaning = (text: string): unknown => {
		if (text === 'Enabled' || text === 'true') {
			return true;
		}
		if (text === 'Disabled' || text === 'false') {
			return false;
		}
		if (text.trim() && Number.isFinite(Number(text))) {
			return Number(text);
		}
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	};
	if (JSON.stringify(meaning(original)) === JSON.stringify(value) || original === value) {
		return original;
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'boolean' && (original === 'Enabled' || original === 'Disabled')) {
		return value ? 'Enabled' : 'Disabled';
	}
	return typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function nodeAddress(node: HostGraphSnapshot['nodes'][number]): string | undefined {
	if (node.kind === 'resource' && node.resourceType) {
		return `${node.resourceType}.${node.name}`;
	}
	if (node.kind === 'data' && node.resourceType) {
		return `data.${node.resourceType}.${node.name}`;
	}
	return node.kind === 'module' ? `module.${node.name}` : undefined;
}

const regionCode = (name: string) => name.toLowerCase().replace(/\s/g, '');

/**
 * `architecture` with each resource's name, region, settings and block values taken from the
 * files. Returns the same object when nothing changes.
 */
export function hydrateResourceValues(architecture: Architecture, snapshot: HostGraphSnapshot, values: readonly FileResourceValues[], fileVariables: readonly FileVariable[] = []): Architecture {
	const newVariables = variablesFromFiles(architecture.variables, fileVariables);
	const variables = [...(architecture.variables ?? []), ...newVariables];
	const variableIdByName = new Map(variables.map(item => [item.name, item.id]));
	const byAddress = new Map(values.map(item => [item.address, item]));
	const addressById = new Map<string, string>();
	for (const node of snapshot.nodes) {
		const address = nodeAddress(node);
		if (address) {
			addressById.set(node.id, address);
		}
	}
	const { bindings } = projectTerraform(architecture);
	let changed = false;
	const resources = architecture.resources.map(resource => {
		const address = addressById.get(resource.id);
		const file = address ? byAddress.get(address) : undefined;
		if (!file) {
			return resource;
		}
		const next: Resource = { ...resource, settings: { ...resource.settings }, blocks: structuredClone(resource.blocks) };
		let touched = false;
		const literal = (path: readonly string[]) => {
			const found = valueAt(file, path);
			return found?.kind === 'literal' ? found.value : undefined;
		};
		// A field written as exactly `var.NAME` becomes a canvas variable binding.
		const bindVariable = (path: readonly string[], target: FieldTarget) => {
			const found = valueAt(file, path);
			const name = found?.kind === 'expression' ? /^var\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(found.text.trim())?.[1] : undefined;
			const variableId = name ? variableIdByName.get(name) : undefined;
			const key = bindingKey(target);
			if (variableId && next.fieldBindings?.[key]?.variableId !== variableId) {
				next.fieldBindings = { ...next.fieldBindings, [key]: { variableId } };
				touched = true;
			}
		};
		if (resource.kind === 'module') {
			for (const [setting, attribute] of [['Source', 'source'], ['Version', 'version']] as const) {
				const value = literal([attribute]);
				if (typeof value === 'string' && value !== next.settings[setting]) {
					next.settings[setting] = value;
					touched = true;
				}
			}
		} else {
			const findBlock = (blocks: ResourceBlock[], id: string): ResourceBlock | undefined => {
				for (const block of blocks) {
					if (block.id === id) {
						return block;
					}
					const child = findBlock(block.blocks, id);
					if (child) {
						return child;
					}
				}
				return undefined;
			};
			for (const binding of bindings.get(resource.id) ?? []) {
				const target: FieldTarget = binding.target === 'name' ? { kind: 'name' } : binding.target === 'region' ? { kind: 'region' }
					: binding.target === 'setting' ? { kind: 'setting', name: binding.key } : { kind: 'block', blockId: binding.blockId!, name: binding.key };
				bindVariable(binding.path, target);
				const value = literal(binding.path);
				if (value === undefined) {
					continue;
				}
				if (binding.target === 'name') {
					if (typeof value === 'string' && value !== next.name) {
						next.name = value;
						touched = true;
					}
				} else if (binding.target === 'region') {
					const region = typeof value === 'string' ? providerRegions[resource.provider].find(item => regionCode(item) === regionCode(value)) : undefined;
					if (region && region !== next.region) {
						next.region = region;
						touched = true;
					}
				} else if (binding.target === 'setting') {
					const text = textFor(value, binding.original);
					if (text !== undefined && text !== next.settings[binding.key]) {
						next.settings[binding.key] = text;
						touched = true;
					}
				} else if (binding.blockId) {
					const block = findBlock(next.blocks, binding.blockId);
					const text = textFor(value, binding.original);
					if (block && text !== undefined && text !== block.values[binding.key]) {
						block.values[binding.key] = text;
						touched = true;
					}
				}
			}
			// Catalogue resources use attribute names as setting keys: add literal fields the file sets.
			for (const field of resource.catalogue?.fields ?? []) {
				if (next.settings[field.name] !== undefined) {
					continue;
				}
				const value = literal([field.name]);
				if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
					next.settings[field.name] = String(value);
					touched = true;
				}
			}
		}
		// Definitions can arrive after source values. Reconcile the actual source paths once known.
		// Labelled/dynamic bodies are excluded: this protocol does not carry their labels.
		if (resource.kind !== 'module') {
			const definitions = getDef(resourceDefinition(resource).type)?.attributes;
			if (definitions) {
				const existingBindings = bindings.get(resource.id) ?? [];
				const transfer = (source: Pick<FileResourceValues, 'attributes' | 'blocks'>, fields: readonly AttrDef[], previous: readonly ResourceBlock[], oldExtras: TerraformExtraBody | undefined, blockId?: string): { values: Record<string, string>; blocks: ResourceBlock[]; extras: TerraformExtraBody } => {
					const result: { values: Record<string, string>; blocks: ResourceBlock[]; extras: TerraformExtraBody } = { values: {}, blocks: [], extras: structuredClone(oldExtras ?? { attrs: {}, blocks: [] }) };
					for (const definition of fields.filter(field => field.type !== 'block' && !field.readOnly)) {
						const field = source.attributes[definition.name];
						if (!field || field.kind === 'redacted') { continue; }
						const key = !blockId ? existingBindings.find(binding => binding.path.length === 1 && binding.path[0] === definition.name && binding.target === 'setting')?.key ?? definition.name : definition.name;
						const target: FieldTarget = blockId ? { kind: 'block', blockId, name: definition.name } : definition.name === 'name' ? { kind: 'name' } : ['location', 'region'].includes(definition.name) ? { kind: 'region' } : { kind: 'setting', name: key };
						const clearBinding = () => { const id = bindingKey(target); if (next.fieldBindings?.[id]) { next.fieldBindings = { ...next.fieldBindings }; delete next.fieldBindings[id]; } if (next.resourceRefs?.[id]) { next.resourceRefs = { ...next.resourceRefs }; delete next.resourceRefs[id]; } };
						if (field.kind === 'expression' && typeof field.text === 'string' && field.text.length < 128 * 1024) {
							const variable = /^var\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(field.text.trim())?.[1];
							if (variable && variableIdByName.has(variable)) { clearBinding(); next.fieldBindings = { ...next.fieldBindings, [bindingKey(target)]: { variableId: variableIdByName.get(variable)! } }; delete result.extras.attrs[definition.name]; continue; }
							try {
								const parsed = parseHcl('value = ' + field.text);
								if (!parsed.blocks.length && Object.keys(parsed.attrs).length === 1 && Object.hasOwn(parsed.attrs, 'value')) { clearBinding(); result.extras.attrs[definition.name] = parsed.attrs.value; }
							} catch { /* Preserve the source file; do not claim an unparsed expression is configured in the model. */ }
						} else if (field.kind === 'literal') {
							clearBinding();
							delete result.extras.attrs[definition.name];
							const text = textFor(field.value, blockId ? previous.find(block => block.id === blockId)?.values[key] ?? '' : next.settings[key] ?? '');
							if (text !== undefined) {
								if (!blockId && definition.name === 'name') { next.name = text; }
								else if (!blockId && ['location', 'region'].includes(definition.name)) { if (!next.region || regionCode(next.region) !== regionCode(text)) { next.region = text; } }
								else { result.values[key] = text; }
							}
						}
					}
					const occurrences = new Map<string, number>();
					for (const block of source.blocks) {
						const definition = fields.find(field => field.type === 'block' && field.name === block.name);
						if (!definition) { continue; }
						const index = occurrences.get(block.name) ?? 0; occurrences.set(block.name, index + 1);
						const existing = previous.filter(item => item.type === block.name)[index];
						const id = existing?.id ?? crypto.randomUUID();
						const old = result.extras.blocks.find(item => item.resourceBlockId === id)?.body;
						const converted = transfer(block, definition.children ?? [], existing?.blocks ?? [], old, id);
						result.blocks.push({ id, type: block.name, values: { ...existing?.values, ...converted.values }, blocks: converted.blocks });
						result.extras.blocks = result.extras.blocks.filter(item => item.resourceBlockId !== id);
						if (hasTerraformExtras(converted.extras)) { result.extras.blocks.push({ type: block.name, labels: [], resourceBlockId: id, body: converted.extras }); }
					}
					return result;
				};
				const transferred = transfer(file, definitions, next.blocks, next.terraformExtras);
				next.settings = { ...next.settings, ...transferred.values }; next.blocks = transferred.blocks;
				next.terraformExtras = pruneTerraformExtras({ ...next, terraformExtras: transferred.extras }, next.blocks);
				if (!hasTerraformExtras(next.terraformExtras)) { delete next.terraformExtras; }
				touched ||= JSON.stringify(next) !== JSON.stringify(resource);
			}
		}
		if (!touched) {
			return resource;
		}
		changed = true;
		return next;
	});
	if (!changed && newVariables.length === 0) {
		return architecture;
	}
	return { ...architecture, resources, ...(newVariables.length ? { variables } : {}) };
}
