/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, ResourceBlock } from './model.ts';
import { parseHcl, HclError } from './cloudlab-core/hcl.ts';
import { isExpr, isRef, type Value } from './cloudlab-core/model.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { resourceDefinition } from './fixture.ts';
import type { TerraformExtraBody } from './additionalTerraform.ts';

export const variableTypes = ['string', 'number', 'bool', 'list(string)', 'map(string)', 'object', 'any'] as const;
export type VariableValue = string | number | boolean | null | VariableValue[] | { [key: string]: VariableValue };
export interface VariableDefinition {
	id: string; name: string; type: typeof variableTypes[number]; description: string;
	sensitive: boolean; defaultValue?: VariableValue; value?: VariableValue; updatedAt?: string;
	/** Imported `object({...})` constraint, kept exactly so an import never loses optional() or declared types. */
	typeConstraint?: string;
}
const reserved = new Set(['source', 'version', 'providers', 'count', 'for_each', 'lifecycle', 'depends_on', 'locals']);
export const isSensitiveProperty = (name: string, declared = false) => declared || /(?:password|secret|token|private[_ ]?key|access[_ ]?key|api[_ ]?key)$/i.test(name);
export function variableError(variable: VariableDefinition, variables: VariableDefinition[]): string | undefined {
	if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(variable.name) || reserved.has(variable.name)) { return 'Use a valid, non-reserved Terraform variable name.'; }
	if (variables.some(item => item.id !== variable.id && item.name === variable.name)) { return 'A variable with this name already exists.'; }
	if (!variableTypes.includes(variable.type)) { return 'Choose a supported variable type.'; }
	for (const value of [variable.defaultValue, variable.value]) {
		if (value !== undefined && !finiteJson(value)) { return 'Use finite JSON values.'; }
		if (value === undefined || value === null || variable.type === 'any') { continue; }
		const valid = variable.type === 'string' ? typeof value === 'string' : variable.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : variable.type === 'bool' ? typeof value === 'boolean' : variable.type === 'object' ? isObjectValue(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) : variable.type === 'list(string)' ? Array.isArray(value) && value.every(item => typeof item === 'string') : typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string');
		if (!valid) { return 'The default and value must match the selected type.'; }
	}
	return undefined;
}

/** Bounded preview discovery, not a Terraform parser or proof of reference validity. */
export function variableUses(architecture: Architecture): Map<string, Set<string>> {
	const uses = new Map<string, Set<string>>();
	const values = (blocks: ResourceBlock[]): string[] => blocks.flatMap(block => [...Object.values(block.values), ...values(block.blocks)]);
	const expressions = (body: TerraformExtraBody | undefined): string[] => {
		const visit = (value: Value): string[] => isExpr(value) ? [value.$expr] : Array.isArray(value) ? value.flatMap(visit) : value !== null && typeof value === 'object' ? Object.values(value).flatMap(visit) : [];
		return body ? [...Object.values(body.attrs).flatMap(visit), ...body.blocks.flatMap(block => expressions(block.body))] : [];
	};
	for (const resource of architecture.resources) {
		for (const binding of Object.values(resource.fieldBindings ?? {})) {
			const variable = architecture.variables?.find(item => item.id === binding.variableId);
			if (variable) { const ids = uses.get(variable.name) ?? new Set<string>(); ids.add(resource.id); uses.set(variable.name, ids); }
		}
		for (const binding of Object.values(resource.resourceRefs ?? {})) {
			for (const entry of binding.items ?? []) {
				if (entry.kind !== 'variable') { continue; }
				const variable = architecture.variables?.find(item => item.id === entry.variableId);
				if (variable) { const ids = uses.get(variable.name) ?? new Set<string>(); ids.add(resource.id); uses.set(variable.name, ids); }
			}
		}
  const attrs = getDef(resourceDefinition(resource).type)?.attributes ?? [];
  for (const name of Object.keys(resource.settings)) {
   if (isSensitiveProperty(name, resource.catalogue?.fields.find(field => field.name === name)?.sensitive || attrs.find(attr => attr.name === name)?.sensitive)) {
    const localName = resource.terraformName ?? (/^[A-Za-z_]/.test(resource.name) ? resource.name.replace(/[^A-Za-z0-9_-]/g, '_') : '_' + resource.name.replace(/[^A-Za-z0-9_-]/g, '_'));
    const input = localName + '_' + name.toLowerCase().replace(/\s+/g, '_');
    const ids = uses.get(input) ?? new Set<string>(); ids.add(resource.id); uses.set(input, ids);
   }
  }
		for (const value of [resource.region, ...Object.values(resource.settings), ...values(resource.blocks), ...expressions(resource.terraformExtras)]) {
			for (const match of value.matchAll(/\bvar\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
				const ids = uses.get(match[1]) ?? new Set<string>(); ids.add(resource.id); uses.set(match[1], ids);
			}
		}
	}
	return uses;
}

export const isObjectValue = (value: VariableValue | undefined): value is { [key: string]: VariableValue } => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Terraform type of a literal value, used to declare object variables from their default. */
function literalType(value: VariableValue): string {
	if (typeof value === 'string') { return 'string'; }
	if (typeof value === 'number') { return 'number'; }
	if (typeof value === 'boolean') { return 'bool'; }
	if (Array.isArray(value)) { const types = [...new Set(value.map(literalType))]; return types.length === 1 ? 'list(' + types[0] + ')' : 'list(any)'; }
	if (isObjectValue(value)) { return 'object({ ' + Object.entries(value).map(([key, item]) => key + ' = ' + literalType(item)).join(', ') + ' })'; }
	return 'any';
}

/** The `type =` constraint written for a variable. An object variable takes its shape from its default or value. */
export function variableTypeConstraint(variable: VariableDefinition): string {
	if (variable.type !== 'object') { return variable.type; }
	if (variable.typeConstraint && /^object\s*\(/.test(variable.typeConstraint)) { return variable.typeConstraint; }
	const sample = variable.defaultValue ?? variable.value;
	return isObjectValue(sample) ? literalType(sample) : 'object({})';
}

/** Every attribute path inside an object variable (leaves and nested objects), with its value. */
export function objectVariablePaths(variable: VariableDefinition): { path: string[]; value: VariableValue }[] {
	if (variable.type !== 'object') { return []; }
	const sample = variable.value ?? variable.defaultValue;
	const out: { path: string[]; value: VariableValue }[] = [];
	const visit = (value: VariableValue, path: string[]) => {
		if (path.length) { out.push({ path, value }); }
		if (isObjectValue(value) && path.length < 6) { for (const [key, item] of Object.entries(value)) { visit(item, [...path, key]); } }
	};
	if (isObjectValue(sample)) { visit(sample, []); }
	return out;
}

/** The value at an attribute path of an object variable, or undefined when the path does not exist. */
export function variableValueAt(variable: VariableDefinition, path: readonly string[] | undefined): VariableValue | undefined {
	let current: VariableValue | undefined = variable.value ?? variable.defaultValue;
	for (const key of path ?? []) { current = isObjectValue(current) && Object.hasOwn(current, key) ? current[key] : undefined; }
	return current;
}

function finiteJson(value: VariableValue): boolean {
 if (typeof value === 'number') { return Number.isFinite(value); }
 if (Array.isArray(value)) { return value.every(finiteJson); }
 if (value !== null && typeof value === 'object') { return Object.values(value).every(finiteJson); }
 return value === null || typeof value === 'string' || typeof value === 'boolean';
}

function hclValue(value: VariableValue): string {
 if (Array.isArray(value)) { return '[' + value.map(hclValue).join(', ') + ']'; }
 if (value !== null && typeof value === 'object') {
  return '{ ' + Object.entries(value).map(([key, item]) => `${hclValue(key)} = ${hclValue(item)}`).join(', ') + ' }';
 }
 return JSON.stringify(value).replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{');
}

export function variableDeclarations(variables: VariableDefinition[]): string {
	return variables.map(variable => `variable ${JSON.stringify(variable.name)} {\n  type = ${variableTypeConstraint(variable)}\n  description = ${hclValue(variable.description)}\n${variable.sensitive ? '  sensitive = true\n  # Sensitive defaults are omitted from this preview.\n' : variable.defaultValue !== undefined ? `  default = ${hclValue(variable.defaultValue)}\n` : ''}}`).join('\n\n');
}

export function exportableArchitecture(architecture: Architecture): Architecture {
	const key = (name: string) => name.toLowerCase().replace(/\s+/g, '_');
	const blocks = (items: ResourceBlock[], attrs: AttrDef[]): ResourceBlock[] => items.map(block => {
		const fields = attrs.find(attr => attr.name === block.type)?.children ?? [];
		return { ...block, values: Object.fromEntries(Object.entries(block.values).map(([name, value]) => [name, isSensitiveProperty(name, fields.find(field => field.name === key(name))?.sensitive) ? '<sensitive value omitted>' : value])), blocks: blocks(block.blocks, fields) };
	});
	return { ...architecture, resources: architecture.resources.map(resource => {
		const attrs = getDef(resourceDefinition(resource).type)?.attributes ?? [];
		return { ...resource, settings: Object.fromEntries(Object.entries(resource.settings).map(([name, value]) => [name, isSensitiveProperty(name, resource.catalogue?.fields.find(field => field.name === name)?.sensitive || attrs.find(attr => attr.name === key(name))?.sensitive) ? '<sensitive value omitted>' : value])), blocks: blocks(resource.blocks, attrs) };
	}), variables: architecture.variables?.map(variable => variable.sensitive ? { ...variable, defaultValue: undefined, value: undefined } : variable) };
}

/** Literal-only import. Unsupported source stays in the import draft, never evaluated. */
export function importVariableDraft(source: string, current: VariableDefinition[], format: 'tf' | 'tfvars'): VariableDefinition[] {
	if (source.length > 1_000_000) { throw new Error('Choose a variable file smaller than 1 MB.'); }
	let file;
	try { file = parseHcl(source); } catch (error) { throw new Error(error instanceof HclError ? `Check the HCL syntax near line ${error.line}.` : 'Unable to parse the variable file.'); }
	const literal = (value: Value): VariableValue => {
		if (isExpr(value) || isRef(value)) { throw new Error('Expression values require the advanced typed editor. The import draft is retained.'); }
		if (Array.isArray(value)) { return value.map(literal); }
		if (value !== null && typeof value === 'object') { return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literal(child)])); }
		return value;
	};
	const definition = (name: string): VariableDefinition => ({ id: current.find(variable => variable.name === name)?.id ?? crypto.randomUUID(), name, type: 'any', description: '', sensitive: /password|secret|token|private.?key|credential/i.test(name), updatedAt: new Date().toISOString() });
	if (format === 'tf' && Object.keys(file.attrs).length) { throw new Error('Choose tfvars format for value assignments.'); }
	const imported = format === 'tfvars' ? (() => {
		if (file.blocks.length) { throw new Error('A tfvars import must contain value assignments, not blocks.'); }
		return Object.entries(file.attrs).map(([name, value]) => ({ ...definition(name), ...current.find(variable => variable.name === name), value: literal(value), updatedAt: new Date().toISOString() }));
	})() : file.blocks.filter(block => block.type === 'variable').map(block => {
		if (block.labels.length !== 1 || block.blocks.length || Object.keys(block.attrs).some(key => !['type', 'description', 'default', 'sensitive'].includes(key))) { throw new Error('This variable has validation or advanced attributes that this importer cannot preserve yet. Keep the source unchanged.'); }
		if (block.attrs.type !== undefined && !isExpr(block.attrs.type)) { throw new Error('Use a Terraform type constraint, not a quoted type name.'); }
		const base = definition(block.labels[0]);
		const declared = isExpr(block.attrs.type) ? block.attrs.type.$expr.trim() : 'any';
		const type = /^object\s*\(/.test(declared) ? 'object' : declared;
		if (!variableTypes.includes(type as VariableDefinition['type'])) { throw new Error('This structural type requires the advanced typed editor.'); }
		if (block.attrs.description !== undefined && typeof block.attrs.description !== 'string') { throw new Error('Variable descriptions must be text.'); }
		if (block.attrs.sensitive !== undefined && typeof block.attrs.sensitive !== 'boolean') { throw new Error('Sensitive must be true or false.'); }
		return { ...base, type: type as VariableDefinition['type'], ...(type === 'object' ? { typeConstraint: declared } : {}), description: block.attrs.description as string ?? '', sensitive: block.attrs.sensitive === true || base.sensitive, ...(block.attrs.default !== undefined ? { defaultValue: literal(block.attrs.default) } : {}) };
	});
	if (!imported.length) { throw new Error('No variable declarations or assignments were found.'); }
	if (new Set(imported.map(variable => variable.name)).size !== imported.length) { throw new Error('The import contains duplicate variable names.'); }
	for (const variable of imported) { const error = variableError(variable, imported); if (error) { throw new Error(error); } }
	return imported;
}
