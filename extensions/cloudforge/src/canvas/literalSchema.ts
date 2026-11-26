/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export interface LiteralMember {
	readonly shape?: LiteralShape;
	readonly access?: 'required' | 'optional' | 'computedOnly';
	readonly description?: string;
	readonly sensitive?: boolean;
}
export interface LiteralShape {
	readonly kind: 'string' | 'number' | 'bool' | 'dynamic' | 'object' | 'list' | 'set' | 'map' | 'tuple';
	readonly members?: Readonly<Record<string, LiteralMember>>;
	readonly element?: LiteralShape;
	readonly elements?: readonly LiteralShape[];
	readonly minItems?: number;
	readonly maxItems?: number;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Local literal shape/access checks. This does not replace provider validators or a plan. */
export function literalIssue(value: unknown, shape: LiteralShape | undefined, path = ''): string | undefined {
	const issue = (message: string) => (path ? path + ': ' : '') + message;
	if (!shape || shape.kind === 'dynamic' || value === null) { return undefined; }
	if (shape.kind === 'string' || shape.kind === 'number' || shape.kind === 'bool') {
		return typeof value === (shape.kind === 'bool' ? 'boolean' : shape.kind) && (shape.kind !== 'number' || Number.isFinite(value)) ? undefined : issue('Expected ' + shape.kind);
	}
	if (shape.kind === 'list' || shape.kind === 'set' || shape.kind === 'tuple') {
		if (!Array.isArray(value)) { return issue('Expected an array'); }
		if (shape.kind === 'tuple' && value.length !== shape.elements?.length) { return issue('Expected ' + shape.elements?.length + ' tuple entries'); }
		if (shape.minItems !== undefined && value.length < shape.minItems) { return issue('Requires at least ' + shape.minItems + ' entries'); }
		if (shape.maxItems !== undefined && value.length > shape.maxItems) { return issue('Allows at most ' + shape.maxItems + ' entries'); }
		if (shape.kind === 'set') {
			const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : item;
			if (new Set(value.map(item => JSON.stringify(canonical(item)))).size !== value.length) { return issue('Set entries must be unique'); }
		}
		for (const [index, item] of value.entries()) { const found = literalIssue(item, shape.kind === 'tuple' ? shape.elements?.[index] : shape.element, path + '[' + index + ']'); if (found) { return found; } }
		return undefined;
	}
	if (!record(value)) { return issue('Expected an object'); }
	if (shape.kind === 'map') {
		const count = Object.keys(value).length;
		if (shape.minItems !== undefined && count < shape.minItems) { return issue('Requires at least ' + shape.minItems + ' entries'); }
		if (shape.maxItems !== undefined && count > shape.maxItems) { return issue('Allows at most ' + shape.maxItems + ' entries'); }
		for (const [key, child] of Object.entries(value)) { const found = literalIssue(child, shape.element, path ? path + '.' + key : key); if (found) { return found; } }
		return undefined;
	}
	for (const [name, member] of Object.entries(shape.members ?? {})) {
		const memberPath = path ? path + '.' + name : name;
		if (member.access === 'computedOnly' && Object.hasOwn(value, name)) { return memberPath + ': Provider output is read-only; omit it from configuration'; }
		if (member.access === 'required' && (!Object.hasOwn(value, name) || value[name] === null)) { return memberPath + ': Required value'; }
		if (Object.hasOwn(value, name)) {
			if (member.sensitive && value[name] !== null && value[name] !== '') { return memberPath + ': Use a sensitive variable instead of a literal value'; }
			const found = literalIssue(value[name], member.shape, memberPath); if (found) { return found; }
		}
	}
	if (shape.members) { for (const name of Object.keys(value)) { if (!Object.hasOwn(shape.members, name)) { return issue('Unknown object member ' + name); } } }
	return undefined;
}
