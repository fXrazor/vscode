/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A small, read-only scanner for the Terraform files inside a template package. It finds top-level
// blocks (resource, data, module, variable, ...), their bodies and their top-level attributes, and
// reads simple literal values. It never evaluates anything. It is used only to draw previews and to
// list a template's variables; the Rust service remains the authority on what a package contains.
// Zero vscode imports; tested directly in Node.

export interface TerraformBlock {
	readonly kind: string;
	readonly labels: readonly string[];
	readonly body: string;
	readonly file: string;
	/** 1-based line of the block keyword. */
	readonly line: number;
}

export type HclLiteral = string | number | boolean | readonly string[] | Readonly<Record<string, string>>;

const MAX_BLOCKS = 2000;

function isIdentStart(ch: string): boolean {
	return /[A-Za-z_]/.test(ch);
}

function isIdent(ch: string): boolean {
	return /[A-Za-z0-9_-]/.test(ch);
}

/** Index just past a comment starting at `i`, or `i` when there is none. */
function skipComment(text: string, i: number): number {
	if (text[i] === '#' || (text[i] === '/' && text[i + 1] === '/')) {
		const end = text.indexOf('\n', i);
		return end < 0 ? text.length : end;
	}
	if (text[i] === '/' && text[i + 1] === '*') {
		const end = text.indexOf('*/', i + 2);
		return end < 0 ? text.length : end + 2;
	}
	return i;
}

/** Index just past a template interpolation body (`${` or `%{` already consumed up to `{`). */
function skipTemplateExpression(text: string, i: number): number {
	let depth = 1;
	while (i < text.length && depth > 0) {
		const ch = text[i];
		if (ch === '"') {
			i = skipString(text, i);
			continue;
		}
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
		}
		i++;
	}
	return i;
}

/** Index just past a quoted string starting at `i` (which must be `"`). */
export function skipString(text: string, i: number): number {
	i++;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (ch === '"') {
			return i + 1;
		}
		if ((ch === '$' || ch === '%') && text[i + 1] === '{') {
			i = skipTemplateExpression(text, i + 2);
			continue;
		}
		if (ch === '\n') {
			// Quoted strings cannot span lines; stop so one bad quote cannot swallow the file.
			return i;
		}
		i++;
	}
	return i;
}

/** Index just past a heredoc starting at `i` (`<<EOF` or `<<-EOF`), or `i` when it is not one. */
function skipHeredoc(text: string, i: number): number {
	const match = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(text.slice(i, i + 80));
	if (!match) {
		return i;
	}
	const marker = match[1];
	let pos = i + match[0].length;
	while (pos < text.length) {
		const end = text.indexOf('\n', pos);
		const lineEnd = end < 0 ? text.length : end;
		if (text.slice(pos, lineEnd).trim() === marker) {
			return lineEnd;
		}
		if (end < 0) {
			return text.length;
		}
		pos = end + 1;
	}
	return text.length;
}

/** Index of the `}` matching the `{` at `open`, or -1. Strings, heredocs and comments are skipped. */
export function matchingBrace(text: string, open: number): number {
	let depth = 0;
	let i = open;
	while (i < text.length) {
		const ch = text[i];
		const afterComment = skipComment(text, i);
		if (afterComment !== i) {
			i = afterComment;
			continue;
		}
		if (ch === '"') {
			i = skipString(text, i);
			continue;
		}
		if (ch === '<' && text[i + 1] === '<') {
			const after = skipHeredoc(text, i);
			if (after !== i) {
				i = after;
				continue;
			}
		}
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
		i++;
	}
	return -1;
}

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

/** Top-level blocks of one Terraform file. Malformed tails are ignored rather than guessed. */
export function scanTerraformBlocks(text: string, file: string): TerraformBlock[] {
	const blocks: TerraformBlock[] = [];
	let i = 0;
	while (i < text.length && blocks.length < MAX_BLOCKS) {
		const ch = text[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		const afterComment = skipComment(text, i);
		if (afterComment !== i) {
			i = afterComment;
			continue;
		}
		if (!isIdentStart(ch)) {
			// Not a block start: skip to the next line.
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end + 1;
			continue;
		}
		const start = i;
		while (i < text.length && isIdent(text[i])) {
			i++;
		}
		const kind = text.slice(start, i);
		const labels: string[] = [];
		let open = -1;
		while (i < text.length) {
			const c = text[i];
			if (c === ' ' || c === '\t') {
				i++;
			} else if (c === '"') {
				const end = skipString(text, i);
				labels.push(text.slice(i + 1, Math.max(i + 1, end - 1)));
				i = end;
			} else if (isIdentStart(c)) {
				const s = i;
				while (i < text.length && isIdent(text[i])) {
					i++;
				}
				labels.push(text.slice(s, i));
			} else if (c === '{') {
				open = i;
				break;
			} else {
				break;
			}
		}
		if (open < 0) {
			// An attribute or something unexpected at the top level: skip the line.
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end + 1;
			continue;
		}
		const close = matchingBrace(text, open);
		if (close < 0) {
			break;
		}
		blocks.push({ kind, labels, body: text.slice(open + 1, close), file, line: lineAt(text, start) });
		i = close + 1;
	}
	return blocks;
}

/** Top-level `name = expression` attributes of a block body, as raw expression text. */
export function readAttributes(body: string): Map<string, string> {
	const out = new Map<string, string>();
	let i = 0;
	let depth = 0;
	let lineStart = true;
	while (i < body.length) {
		const ch = body[i];
		const afterComment = skipComment(body, i);
		if (afterComment !== i) {
			i = afterComment;
			continue;
		}
		if (ch === '\n') {
			lineStart = true;
			i++;
			continue;
		}
		if (ch === ' ' || ch === '\t' || ch === '\r') {
			i++;
			continue;
		}
		if (ch === '"') {
			i = skipString(body, i);
			lineStart = false;
			continue;
		}
		if (ch === '<' && body[i + 1] === '<') {
			const after = skipHeredoc(body, i);
			if (after !== i) {
				i = after;
				continue;
			}
		}
		if (depth === 0 && lineStart && isIdentStart(ch)) {
			const s = i;
			while (i < body.length && isIdent(body[i])) {
				i++;
			}
			const name = body.slice(s, i);
			let j = i;
			while (body[j] === ' ' || body[j] === '\t') {
				j++;
			}
			if (body[j] === '=' && body[j + 1] !== '=') {
				const valueStart = j + 1;
				const valueEnd = expressionEnd(body, valueStart);
				if (!out.has(name)) {
					out.set(name, body.slice(valueStart, valueEnd).trim());
				}
				i = valueEnd;
				lineStart = false;
				continue;
			}
			lineStart = false;
			continue;
		}
		if (ch === '{' || ch === '[' || ch === '(') {
			depth++;
		} else if (ch === '}' || ch === ']' || ch === ')') {
			depth = Math.max(0, depth - 1);
		}
		lineStart = false;
		i++;
	}
	return out;
}

/** End of an attribute expression: the first newline outside brackets, strings and heredocs. */
function expressionEnd(body: string, i: number): number {
	let depth = 0;
	while (i < body.length) {
		const ch = body[i];
		if (ch === '"') {
			i = skipString(body, i);
			continue;
		}
		if (ch === '<' && body[i + 1] === '<') {
			const after = skipHeredoc(body, i);
			if (after !== i) {
				i = after;
				continue;
			}
		}
		if (ch === '#' || (ch === '/' && (body[i + 1] === '/' || body[i + 1] === '*'))) {
			if (depth === 0) {
				return i;
			}
			i = skipComment(body, i);
			continue;
		}
		if (ch === '{' || ch === '[' || ch === '(') {
			depth++;
		} else if (ch === '}' || ch === ']' || ch === ')') {
			depth--;
			if (depth < 0) {
				return i;
			}
		} else if (ch === '\n' && depth === 0) {
			return i;
		}
		i++;
	}
	return i;
}

function unquote(raw: string): string | undefined {
	if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
		return undefined;
	}
	const inner = raw.slice(1, -1);
	if (/\$\{|%\{/.test(inner)) {
		return undefined;
	}
	let out = '';
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === '\\' && i + 1 < inner.length) {
			const next = inner[++i];
			out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
		} else if (ch === '"') {
			return undefined;
		} else {
			out += ch;
		}
	}
	return out;
}

/** Splits `a, b, c` at top-level commas or newlines, ignoring empties. */
function splitItems(inner: string): string[] {
	const items: string[] = [];
	let depth = 0;
	let start = 0;
	let i = 0;
	while (i < inner.length) {
		const ch = inner[i];
		if (ch === '"') {
			i = skipString(inner, i);
			continue;
		}
		if (ch === '{' || ch === '[' || ch === '(') {
			depth++;
		} else if (ch === '}' || ch === ']' || ch === ')') {
			depth--;
		} else if ((ch === ',' || ch === '\n') && depth === 0) {
			items.push(inner.slice(start, i));
			start = i + 1;
		}
		i++;
	}
	items.push(inner.slice(start));
	return items.map(item => item.replace(/(^|\s)(#|\/\/).*$/, '').trim()).filter(Boolean);
}

/**
 * Reads a literal value: a string, number, bool, list of strings or map of strings. Anything with
 * a reference, function call or interpolation returns undefined.
 */
export function parseLiteral(raw: string | undefined): HclLiteral | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const text = raw.trim();
	if (text === 'true' || text === 'false') {
		return text === 'true';
	}
	if (/^-?\d+(\.\d+)?$/.test(text)) {
		return Number(text);
	}
	if (text.startsWith('"')) {
		return unquote(text);
	}
	if (text.startsWith('[') && text.endsWith(']')) {
		const values: string[] = [];
		for (const item of splitItems(text.slice(1, -1))) {
			const value = unquote(item);
			if (value === undefined) {
				return undefined;
			}
			values.push(value);
		}
		return values;
	}
	if (text.startsWith('{') && text.endsWith('}')) {
		const map: Record<string, string> = {};
		for (const item of splitItems(text.slice(1, -1))) {
			const match = /^("?)([A-Za-z0-9_.\-/: ]+)\1\s*[=:]\s*(.+)$/.exec(item);
			const value = match ? unquote(match[3].trim()) : undefined;
			if (!match || value === undefined) {
				return undefined;
			}
			map[match[2].trim()] = value;
		}
		return map;
	}
	return undefined;
}
