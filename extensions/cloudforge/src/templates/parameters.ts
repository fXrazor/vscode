/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Create-from-template parameters: which of a template's variables the wizard asks for, how they
// are checked, and the terraform.tfvars written into the new architecture. When the package has a
// parameters.schema.json only the fields it declares appear (spec §3.5); otherwise every variable
// does. Cloud account ids are never asked for here (they belong to Cloud Connections) and
// sensitive values are never written. Zero vscode imports; tested directly in Node.

import { parseLiteral } from './hclScan.ts';
import type { TemplateVariable } from './preview.ts';

export type ParameterKind = 'string' | 'number' | 'bool' | 'map' | 'list';
export type ParameterSkip = 'cloudAccount' | 'sensitive' | 'complex';

export interface ParameterField {
	readonly name: string;
	readonly title: string;
	readonly kind: ParameterKind;
	readonly format?: string;
	readonly group?: string;
	readonly description?: string;
	readonly required: boolean;
	/** The default, as the text the field starts with. */
	readonly defaultText: string;
	/** Set when the wizard shows the field but does not ask for a value. */
	readonly skip?: ParameterSkip;
	/** Choices for an enum. */
	readonly options?: readonly string[];
}

const CLOUD_ACCOUNT = /^(?:project(?:_id)?|subscription(?:_id)?|tenant(?:_id)?|account(?:_id)?|billing_account(?:_id)?|organization(?:_id)?|org_id|client_id|client_secret)$/;
const MAX_FIELDS = 64;
const MAX_VALUE = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindFromVariable(variable: TemplateVariable | undefined): ParameterKind | 'complex' {
	const type = variable?.type?.replace(/\s+/g, '');
	if (type) {
		if (type === 'string') {
			return 'string';
		}
		if (type === 'number') {
			return 'number';
		}
		if (type === 'bool') {
			return 'bool';
		}
		if (/^map\((string|number|bool)\)$/.test(type)) {
			return 'map';
		}
		if (/^(list|set)\((string|number)\)$/.test(type)) {
			return 'list';
		}
		if (type !== 'any') {
			return 'complex';
		}
	}
	const literal = parseLiteral(variable?.defaultRaw);
	if (typeof literal === 'number') {
		return 'number';
	}
	if (typeof literal === 'boolean') {
		return 'bool';
	}
	if (Array.isArray(literal)) {
		return 'list';
	}
	if (isRecord(literal)) {
		return 'map';
	}
	return literal === undefined && variable?.defaultRaw !== undefined ? 'complex' : 'string';
}

function kindFromSchema(type: unknown): ParameterKind | undefined {
	switch (type) {
		case 'string': return 'string';
		case 'number': case 'integer': return 'number';
		case 'boolean': return 'bool';
		case 'object': return 'map';
		case 'array': return 'list';
		default: return undefined;
	}
}

/** Default text for a field from the variable's HCL default. Complex defaults start empty. */
function defaultText(variable: TemplateVariable | undefined, kind: ParameterKind): string {
	const literal = parseLiteral(variable?.defaultRaw);
	if (literal === undefined) {
		return '';
	}
	if (kind === 'map' && isRecord(literal)) {
		return Object.entries(literal).map(([key, value]) => key + '=' + value).join('\n');
	}
	if (kind === 'list' && Array.isArray(literal)) {
		return literal.join(', ');
	}
	return typeof literal === 'object' ? '' : String(literal);
}

function humanize(name: string): string {
	const words = name.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The wizard's fields, ordered by schema group and order, then variable order. */
export function parameterFields(schema: unknown, variables: readonly TemplateVariable[]): ParameterField[] {
	const byName = new Map(variables.map(variable => [variable.name, variable]));
	const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : undefined;
	const required = new Set(isRecord(schema) && Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []);
	const groups = isRecord(schema) && Array.isArray(schema['x-cloudforge-groups']) ? schema['x-cloudforge-groups'].filter((item): item is string => typeof item === 'string') : [];
	const names = properties ? Object.keys(properties).filter(name => byName.has(name)) : variables.map(variable => variable.name);
	const fields: (ParameterField & { readonly sortGroup: number; readonly sortOrder: number; readonly sortIndex: number })[] = [];
	names.slice(0, MAX_FIELDS).forEach((name, index) => {
		const variable = byName.get(name);
		const property = properties && isRecord(properties[name]) ? properties[name] as Record<string, unknown> : undefined;
		const variableKind = kindFromVariable(variable);
		const kind = kindFromSchema(property?.type) ?? (variableKind === 'complex' ? 'string' : variableKind);
		const group = typeof property?.['x-cloudforge-group'] === 'string' ? property['x-cloudforge-group'] as string : undefined;
		const order = typeof property?.['x-cloudforge-order'] === 'number' ? property['x-cloudforge-order'] as number : 1000;
		const description = typeof property?.description === 'string' ? property.description as string : variable?.description;
		const options = Array.isArray(property?.enum) ? (property!.enum as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 64) : undefined;
		const skip: ParameterSkip | undefined = CLOUD_ACCOUNT.test(name)
			? 'cloudAccount'
			: variable?.sensitive || property?.['x-cloudforge-sensitive'] === true || property?.writeOnly === true
				? 'sensitive'
				: variableKind === 'complex' && !kindFromSchema(property?.type) ? 'complex' : undefined;
		fields.push({
			name,
			title: typeof property?.title === 'string' ? property.title as string : humanize(name),
			kind,
			...(typeof property?.format === 'string' ? { format: property.format as string } : {}),
			...(group ? { group } : {}),
			...(description ? { description } : {}),
			required: required.has(name) || variable?.defaultRaw === undefined,
			defaultText: defaultText(variable, kind),
			...(skip ? { skip } : {}),
			...(options && options.length ? { options } : {}),
			sortGroup: group ? (groups.indexOf(group) + 1 || groups.length + 1) : groups.length + 2,
			sortOrder: order,
			sortIndex: index,
		});
	});
	fields.sort((a, b) => a.sortGroup - b.sortGroup || a.sortOrder - b.sortOrder || a.sortIndex - b.sortIndex);
	return fields.map(({ sortGroup: _g, sortOrder: _o, sortIndex: _i, ...field }) => field);
}

function validCidr(text: string): boolean {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
	return !!match && match.slice(1, 5).every(part => Number(part) <= 255) && Number(match[5]) <= 32;
}

function mapEntries(text: string): [string, string][] | undefined {
	const out: [string, string][] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const index = trimmed.indexOf('=');
		const key = index > 0 ? trimmed.slice(0, index).trim() : '';
		if (!key || key.length > 128) {
			return undefined;
		}
		out.push([key, trimmed.slice(index + 1).trim()]);
	}
	return out;
}

function listItems(text: string): string[] {
	return text.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}

/** A plain-language problem with one value, or undefined when it is fine. */
export function validateParameter(field: ParameterField, text: string): string | undefined {
	if (field.skip) {
		return undefined;
	}
	const value = text.trim();
	if (value.length > MAX_VALUE) {
		return 'This value is too long.';
	}
	if (!value) {
		return field.required && !field.defaultText ? field.title + ' is required.' : undefined;
	}
	if (field.options && !field.options.includes(value)) {
		return 'Choose one of: ' + field.options.join(', ') + '.';
	}
	switch (field.kind) {
		case 'number':
			return /^-?\d+(\.\d+)?$/.test(value) ? undefined : field.title + ' must be a number.';
		case 'bool':
			return value === 'true' || value === 'false' ? undefined : field.title + ' must be true or false.';
		case 'map':
			return mapEntries(value) ? undefined : 'Write one key=value pair per line.';
		case 'list':
			return field.format === 'cidr' && !listItems(value).every(validCidr) ? 'Each address range must look like 10.0.0.0/16.' : undefined;
	}
	if (field.format === 'cidr' && !validCidr(value)) {
		return 'Use an address range like 10.0.0.0/16.';
	}
	if (field.format === 'naming-prefix' && !/^[a-z][a-z0-9-]{0,23}$/.test(value)) {
		return 'Use up to 24 lowercase letters, digits and hyphens, starting with a letter.';
	}
	if (field.format === 'region' && !/^[a-z][a-z0-9-]{1,40}$/.test(value)) {
		return 'Use a region name such as uksouth, eu-west-2 or europe-west2.';
	}
	return undefined;
}

export function validateParameters(fields: readonly ParameterField[], values: Readonly<Record<string, string>>): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of fields) {
		const problem = validateParameter(field, values[field.name] ?? field.defaultText);
		if (problem) {
			errors[field.name] = problem;
		}
	}
	return errors;
}

/** An HCL string literal; `${` and `%{` are escaped so a value can never become an expression. */
export function hclString(value: string): string {
	return '"' + value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/\$\{/g, () => '$${')
		.replace(/%\{/g, () => '%%{') + '"';
}

function hclKey(key: string): string {
	return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : hclString(key);
}

function hclValue(field: ParameterField, value: string): string {
	switch (field.kind) {
		case 'number':
		case 'bool':
			return value;
		case 'map': {
			const entries = mapEntries(value) ?? [];
			return entries.length ? '{\n' + entries.map(([key, item]) => '  ' + hclKey(key) + ' = ' + hclString(item)).join('\n') + '\n}' : '{}';
		}
		case 'list':
			return '[' + listItems(value).map(hclString).join(', ') + ']';
		default:
			return hclString(value);
	}
}

/**
 * terraform.tfvars for the new architecture, or undefined when there is nothing to write. Values
 * equal to the template default are still written, so the file shows what the architecture uses.
 */
export function renderTfvars(
	template: { readonly id: string; readonly version: string },
	fields: readonly ParameterField[],
	values: Readonly<Record<string, string>>,
): string | undefined {
	const lines: string[] = [];
	for (const field of fields) {
		if (field.skip === 'cloudAccount') {
			lines.push(`# ${field.name}: set this yourself. CloudForge does not store cloud account ids in templates.`);
			continue;
		}
		if (field.skip === 'sensitive') {
			lines.push(`# ${field.name}: sensitive. Set it in your terminal (TF_VAR_${field.name}); it is never written here.`);
			continue;
		}
		if (field.skip) {
			continue;
		}
		const value = (values[field.name] ?? field.defaultText).trim();
		if (value) {
			lines.push(field.name + ' = ' + hclValue(field, value));
		}
	}
	if (!lines.length) {
		return undefined;
	}
	return `# Values for this architecture, from CloudForge template ${template.id} ${template.version}.\n# Edit freely. Nothing here is a secret.\n\n${lines.join('\n')}\n`;
}
