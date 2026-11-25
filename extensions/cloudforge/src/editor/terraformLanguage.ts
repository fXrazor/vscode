/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure Terraform / OpenTofu HCL2 document parser, cursor reference extractor, active-graph node
// matcher, local definition finder, and hover Markdown builder. Zero runtime `vscode` or relative
// module imports so `node --test` verifies every code path directly.

import type { ResourceCostLine } from '../canvas/planReview';
import type { CanvasGraphSnapshot, CanvasNodeSummary } from '../canvas/protocol';
import type { FormSchema } from '../canvas/schemaForm';

export type TerraformBlockKind =
	| 'resource'
	| 'data'
	| 'module'
	| 'variable'
	| 'output'
	| 'provider'
	| 'locals'
	| 'terraform'
	| 'moved'
	| 'import'
	| 'check'
	| 'removed';

export interface TerraformBlockMatch {
	readonly kind: TerraformBlockKind;
	readonly labels: readonly string[];
	readonly resourceType?: string;
	readonly name: string;
	readonly address: string;
	readonly displayName: string;
	readonly detail: string;
	readonly startLine: number;
	readonly startCharacter: number;
	readonly headerEndCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

export interface TerraformReferenceMatch {
	readonly kind: 'resource' | 'data' | 'module' | 'variable' | 'local';
	readonly address: string;
	readonly resourceType?: string;
	readonly name: string;
	readonly attributePath?: string;
	readonly startCharacter: number;
	readonly endCharacter: number;
}

export interface TerraformDefinitionTarget {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

const MAX_PARSE_CHARS = 512 * 1024;
const MAX_BLOCKS = 2000;

const BLOCK_KINDS = new Set<TerraformBlockKind>([
	'resource',
	'data',
	'module',
	'variable',
	'output',
	'provider',
	'locals',
	'terraform',
	'moved',
	'import',
	'check',
	'removed',
]);

const RESERVED_REFERENCE_ROOTS = new Set<string>([
	'var',
	'local',
	'module',
	'data',
	'each',
	'self',
	'count',
	'path',
	'terraform',
]);

function isIdentStart(ch: string): boolean {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '-';
}

interface ParsedHeader {
	readonly kind: TerraformBlockKind;
	readonly labels: readonly string[];
	readonly startCharacter: number;
	readonly headerEndCharacter: number;
	readonly openBraceIndex: number; // -1 if '{' is on a subsequent line
}

function parseTopLevelHeader(line: string, startIndex: number): ParsedHeader | undefined {
	const len = line.length;
	let i = startIndex;
	while (i < len && (line[i] === ' ' || line[i] === '\t')) {
		i++;
	}
	if (i >= len || !isIdentStart(line[i])) {
		return undefined;
	}
	const kwStart = i;
	while (i < len && isIdentPart(line[i])) {
		i++;
	}
	const keyword = line.slice(kwStart, i) as TerraformBlockKind;
	if (!BLOCK_KINDS.has(keyword)) {
		return undefined;
	}

	const labels: string[] = [];
	let lastTokenEnd = i;

	while (i < len) {
		while (i < len && (line[i] === ' ' || line[i] === '\t')) {
			i++;
		}
		if (i >= len) {
			break;
		}
		const ch = line[i];
		if (ch === '{') {
			return {
				kind: keyword,
				labels,
				startCharacter: kwStart,
				headerEndCharacter: lastTokenEnd,
				openBraceIndex: i,
			};
		}
		if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
			break;
		}
		if (ch === '/' && line[i + 1] === '*') {
			const endComment = line.indexOf('*/', i + 2);
			if (endComment === -1) {
				break;
			}
			i = endComment + 2;
			continue;
		}
		if (ch === '"') {
			if (labels.length >= 2) {
				return undefined;
			}
			let j = i + 1;
			let value = '';
			let closed = false;
			while (j < len) {
				if (line[j] === '\\' && j + 1 < len) {
					value += line[j + 1];
					j += 2;
					continue;
				}
				if (line[j] === '"') {
					closed = true;
					j++;
					break;
				}
				value += line[j];
				j++;
			}
			if (!closed) {
				return undefined;
			}
			labels.push(value);
			lastTokenEnd = j;
			i = j;
			continue;
		}
		if (isIdentStart(ch) && labels.length < 2) {
			const labelStart = i;
			while (i < len && isIdentPart(line[i])) {
				i++;
			}
			labels.push(line.slice(labelStart, i));
			lastTokenEnd = i;
			continue;
		}
		return undefined;
	}

	// Header without '{' on the same line (possibly '{' on the next line).
	return {
		kind: keyword,
		labels,
		startCharacter: kwStart,
		headerEndCharacter: lastTokenEnd,
		openBraceIndex: -1,
	};
}

function buildBlockMeta(kind: TerraformBlockKind, labels: readonly string[]): {
	readonly resourceType?: string;
	readonly name: string;
	readonly address: string;
	readonly displayName: string;
	readonly detail: string;
} {
	switch (kind) {
		case 'resource': {
			const resourceType = labels[0] ?? 'resource';
			const name = labels[1] ?? resourceType;
			return {
				resourceType,
				name,
				address: labels.length >= 2 ? `${resourceType}.${name}` : resourceType,
				displayName: labels.length >= 2 ? `${resourceType}.${name}` : resourceType,
				detail: `resource (${resourceType})`,
			};
		}
		case 'data': {
			const resourceType = labels[0] ?? 'data';
			const name = labels[1] ?? resourceType;
			return {
				resourceType,
				name,
				address: labels.length >= 2 ? `data.${resourceType}.${name}` : `data.${resourceType}`,
				displayName: labels.length >= 2 ? `data.${resourceType}.${name}` : `data.${resourceType}`,
				detail: `data (${resourceType})`,
			};
		}
		case 'module': {
			const name = labels[0] ?? 'module';
			return {
				name,
				address: `module.${name}`,
				displayName: `module.${name}`,
				detail: 'module',
			};
		}
		case 'variable': {
			const name = labels[0] ?? 'variable';
			return {
				name,
				address: `var.${name}`,
				displayName: `var.${name}`,
				detail: 'variable',
			};
		}
		case 'output': {
			const name = labels[0] ?? 'output';
			return {
				name,
				address: `output.${name}`,
				displayName: `output.${name}`,
				detail: 'output',
			};
		}
		case 'provider': {
			const name = labels[0] ?? 'provider';
			return {
				name,
				address: `provider.${name}`,
				displayName: `provider "${name}"`,
				detail: 'provider',
			};
		}
		case 'check': {
			const name = labels[0] ?? 'check';
			return {
				name,
				address: `check.${name}`,
				displayName: `check "${name}"`,
				detail: 'check',
			};
		}
		default:
			return {
				name: labels[0] ?? kind,
				address: labels[0] ? `${kind}.${labels[0]}` : kind,
				displayName: labels[0] ? `${kind} "${labels[0]}"` : kind,
				detail: kind,
			};
	}
}

interface PendingBlock {
	readonly kind: TerraformBlockKind;
	readonly labels: readonly string[];
	readonly startLine: number;
	readonly startCharacter: number;
	readonly headerEndCharacter: number;
	opened: boolean;
}

/**
 * Linear-time, bounded HCL2 top-level block parser for `.tf` / `.tofu` documents.
 * Correctly handles nested blocks, comments (`#`, `//`, `/* *\/`), double-quoted strings with
 * `${...}` interpolation, and heredocs (`<<EOF` / `<<-EOF`).
 */
export function parseTerraformDocumentBlocks(text: string): TerraformBlockMatch[] {
	if (!text || text.length > MAX_PARSE_CHARS) {
		return [];
	}

	const rawLines = text.split('\n');
	const blocks: TerraformBlockMatch[] = [];
	let braceDepth = 0;
	let inBlockComment = false;
	let heredoc: { readonly marker: string; readonly indented: boolean } | undefined;
	let currentBlock: PendingBlock | undefined;

	for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
		if (blocks.length >= MAX_BLOCKS) {
			break;
		}
		const rawLine = rawLines[lineIdx];
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const len = line.length;

		if (heredoc) {
			const candidate = heredoc.indented ? line.trim() : line;
			if (candidate === heredoc.marker) {
				heredoc = undefined;
			}
			continue;
		}

		let i = 0;

		if (inBlockComment) {
			const closeIdx = line.indexOf('*/');
			if (closeIdx === -1) {
				continue;
			}
			inBlockComment = false;
			i = closeIdx + 2;
		}

		// If we are at top level and waiting for a block header or its delayed '{'.
		if (braceDepth === 0) {
			let ws = i;
			while (ws < len && (line[ws] === ' ' || line[ws] === '\t')) {
				ws++;
			}
			if (ws < len) {
				if (currentBlock && !currentBlock.opened) {
					if (line[ws] === '{') {
						currentBlock.opened = true;
						braceDepth = 1;
						i = ws + 1;
					} else if (line[ws] !== '#' && !(line[ws] === '/' && (line[ws + 1] === '/' || line[ws + 1] === '*'))) {
						// Not a valid multi-line header; discard pending candidate.
						currentBlock = undefined;
					}
				}
				if (!currentBlock && braceDepth === 0) {
					const header = parseTopLevelHeader(line, ws);
					if (header) {
						currentBlock = {
							kind: header.kind,
							labels: header.labels,
							startLine: lineIdx,
							startCharacter: header.startCharacter,
							headerEndCharacter: header.headerEndCharacter,
							opened: header.openBraceIndex !== -1,
						};
						if (header.openBraceIndex !== -1) {
							braceDepth = 1;
							i = header.openBraceIndex + 1;
						} else {
							continue;
						}
					}
				}
			}
		}

		// Scan characters on this line tracking strings, interpolations, comments, heredocs & braces.
		// Mode stack: 'code' or 'string' (entered on '"', interrupted by '${' pushing 'code').
		const modeStack: ('code' | 'string')[] = ['code'];
		const interpBraceDepths: number[] = [];

		while (i < len) {
			const mode = modeStack[modeStack.length - 1];
			const ch = line[i];

			if (inBlockComment) {
				const closeIdx = line.indexOf('*/', i);
				if (closeIdx === -1) {
					break;
				}
				inBlockComment = false;
				i = closeIdx + 2;
				continue;
			}

			if (mode === 'string') {
				if (ch === '\\' && i + 1 < len) {
					i += 2;
					continue;
				}
				if (ch === '"') {
					modeStack.pop();
					i++;
					continue;
				}
				if ((ch === '$' || ch === '%') && line[i + 1] === '{') {
					// Escaped $${ or %%{ does not open interpolation.
					if (i > 0 && line[i - 1] === ch) {
						i += 2;
						continue;
					}
					modeStack.push('code');
					interpBraceDepths.push(0);
					i += 2;
					continue;
				}
				i++;
				continue;
			}

			// Code mode
			if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
				break;
			}
			if (ch === '/' && line[i + 1] === '*') {
				inBlockComment = true;
				i += 2;
				continue;
			}
			if (ch === '"') {
				modeStack.push('string');
				i++;
				continue;
			}
			if (ch === '<' && line[i + 1] === '<') {
				const rest = line.slice(i);
				const match = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)\s*$/.exec(rest);
				if (match) {
					heredoc = { indented: match[1] === '-', marker: match[2] };
					break;
				}
			}
			if (ch === '{') {
				if (interpBraceDepths.length > 0) {
					interpBraceDepths[interpBraceDepths.length - 1]++;
				} else {
					braceDepth++;
				}
				i++;
				continue;
			}
			if (ch === '}') {
				if (interpBraceDepths.length > 0) {
					if (interpBraceDepths[interpBraceDepths.length - 1] === 0) {
						interpBraceDepths.pop();
						modeStack.pop();
					} else {
						interpBraceDepths[interpBraceDepths.length - 1]--;
					}
				} else if (braceDepth > 0) {
					braceDepth--;
					if (braceDepth === 0 && currentBlock?.opened) {
						const meta = buildBlockMeta(currentBlock.kind, currentBlock.labels);
						blocks.push({
							kind: currentBlock.kind,
							labels: currentBlock.labels,
							...(meta.resourceType ? { resourceType: meta.resourceType } : {}),
							name: meta.name,
							address: meta.address,
							displayName: meta.displayName,
							detail: meta.detail,
							startLine: currentBlock.startLine,
							startCharacter: currentBlock.startCharacter,
							headerEndCharacter: currentBlock.headerEndCharacter,
							endLine: lineIdx,
							endCharacter: i + 1,
						});
						currentBlock = undefined;
					}
				}
				i++;
				continue;
			}
			i++;
		}
	}

	// Flush an unclosed top-level block cleanly at EOF so Outline still displays it while typing.
	if (currentBlock?.opened && blocks.length < MAX_BLOCKS) {
		const lastLineIdx = Math.max(0, rawLines.length - 1);
		const lastLineRaw = rawLines[lastLineIdx] ?? '';
		const lastLine = lastLineRaw.endsWith('\r') ? lastLineRaw.slice(0, -1) : lastLineRaw;
		const meta = buildBlockMeta(currentBlock.kind, currentBlock.labels);
		blocks.push({
			kind: currentBlock.kind,
			labels: currentBlock.labels,
			...(meta.resourceType ? { resourceType: meta.resourceType } : {}),
			name: meta.name,
			address: meta.address,
			displayName: meta.displayName,
			detail: meta.detail,
			startLine: currentBlock.startLine,
			startCharacter: currentBlock.startCharacter,
			headerEndCharacter: currentBlock.headerEndCharacter,
			endLine: lastLineIdx,
			endCharacter: lastLine.length,
		});
	}

	return blocks;
}

/** Finds the line-comment start index on a single line (ignoring `#` or `//` inside double quotes). */
function findLineCommentStart(line: string): number {
	let inString = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inString) {
			if (ch === '\\' && i + 1 < line.length) {
				i++;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
			return i;
		}
	}
	return line.length;
}

/**
 * Extracts the Terraform reference (`azurerm_subnet.snet_app.id`, `data.azurerm_client_config.current`,
 * `module.network.vnet_id`, `var.location`, `local.tags`) or block header under a given cursor column.
 */
export function extractTerraformReferenceAtPosition(lineText: string, character: number): TerraformReferenceMatch | undefined {
	if (!lineText || character < 0 || character > lineText.length) {
		return undefined;
	}
	const codeEnd = findLineCommentStart(lineText);
	if (character >= codeEnd) {
		return undefined;
	}
	const codeSlice = lineText.slice(0, codeEnd);

	// 1. Check if cursor sits on a top-level block declaration header.
	const header = parseTopLevelHeader(codeSlice, 0);
	if (header && character >= header.startCharacter && character <= header.headerEndCharacter) {
		if (header.kind === 'resource' && header.labels.length >= 2) {
			const [resourceType, name] = header.labels;
			return {
				kind: 'resource',
				resourceType,
				name,
				address: `${resourceType}.${name}`,
				startCharacter: header.startCharacter,
				endCharacter: header.headerEndCharacter,
			};
		}
		if (header.kind === 'data' && header.labels.length >= 2) {
			const [resourceType, name] = header.labels;
			return {
				kind: 'data',
				resourceType,
				name,
				address: `data.${resourceType}.${name}`,
				startCharacter: header.startCharacter,
				endCharacter: header.headerEndCharacter,
			};
		}
		if (header.kind === 'module' && header.labels.length >= 1) {
			const [name] = header.labels;
			return {
				kind: 'module',
				name,
				address: `module.${name}`,
				startCharacter: header.startCharacter,
				endCharacter: header.headerEndCharacter,
			};
		}
		if (header.kind === 'variable' && header.labels.length >= 1) {
			const [name] = header.labels;
			return {
				kind: 'variable',
				name,
				address: `var.${name}`,
				startCharacter: header.startCharacter,
				endCharacter: header.headerEndCharacter,
			};
		}
	}

	// 2. Expand around cursor across identifier & dot characters to capture dotted HCL references.
	const isRefChar = (ch: string) => isIdentPart(ch) || ch === '.';
	let pivot = character;
	if (pivot === codeEnd || (pivot > 0 && !isRefChar(codeSlice[pivot]) && isRefChar(codeSlice[pivot - 1]))) {
		pivot = pivot - 1;
	}
	if (pivot < 0 || pivot >= codeEnd || !isRefChar(codeSlice[pivot])) {
		return undefined;
	}

	let start = pivot;
	while (start > 0 && isRefChar(codeSlice[start - 1])) {
		start--;
	}
	let end = pivot + 1;
	while (end < codeEnd && isRefChar(codeSlice[end])) {
		end++;
	}

	// Trim leading/trailing dots.
	while (start < end && codeSlice[start] === '.') {
		start++;
	}
	while (end > start && codeSlice[end - 1] === '.') {
		end--;
	}
	if (start >= end) {
		return undefined;
	}

	const rawExpr = codeSlice.slice(start, end);
	const parts = rawExpr.split('.');
	if (parts.length < 2 || parts.some(p => p.length === 0 || !isIdentStart(p[0]))) {
		return undefined;
	}

	const head = parts[0];
	if (head === 'data') {
		if (parts.length < 3) {
			return undefined;
		}
		const resourceType = parts[1];
		const name = parts[2];
		const attr = parts.length > 3 ? parts.slice(3).join('.') : undefined;
		return {
			kind: 'data',
			resourceType,
			name,
			address: `data.${resourceType}.${name}`,
			...(attr ? { attributePath: attr } : {}),
			startCharacter: start,
			endCharacter: end,
		};
	}
	if (head === 'module') {
		const name = parts[1];
		const attr = parts.length > 2 ? parts.slice(2).join('.') : undefined;
		return {
			kind: 'module',
			name,
			address: `module.${name}`,
			...(attr ? { attributePath: attr } : {}),
			startCharacter: start,
			endCharacter: end,
		};
	}
	if (head === 'var') {
		const name = parts[1];
		const attr = parts.length > 2 ? parts.slice(2).join('.') : undefined;
		return {
			kind: 'variable',
			name,
			address: `var.${name}`,
			...(attr ? { attributePath: attr } : {}),
			startCharacter: start,
			endCharacter: end,
		};
	}
	if (head === 'local') {
		const name = parts[1];
		const attr = parts.length > 2 ? parts.slice(2).join('.') : undefined;
		return {
			kind: 'local',
			name,
			address: `local.${name}`,
			...(attr ? { attributePath: attr } : {}),
			startCharacter: start,
			endCharacter: end,
		};
	}
	if (RESERVED_REFERENCE_ROOTS.has(head)) {
		return undefined;
	}
	// Managed resource reference: `<provider>_<type>.<name>(.<attr>)*`.
	if (!head.includes('_')) {
		return undefined;
	}
	const resourceType = head;
	const name = parts[1];
	const attr = parts.length > 2 ? parts.slice(2).join('.') : undefined;
	return {
		kind: 'resource',
		resourceType,
		name,
		address: `${resourceType}.${name}`,
		...(attr ? { attributePath: attr } : {}),
		startCharacter: start,
		endCharacter: end,
	};
}

/** Finds the top-level Terraform block enclosing a 0-based line number. */
export function findTerraformBlockAtLine(blocks: readonly TerraformBlockMatch[], line: number): TerraformBlockMatch | undefined {
	for (const block of blocks) {
		if (line >= block.startLine && line <= block.endLine) {
			return block;
		}
	}
	return undefined;
}

function normalizedFileBase(filePath: string | undefined): string | undefined {
	if (!filePath) {
		return undefined;
	}
	const normalized = filePath.replace(/\\/g, '/');
	const slash = normalized.lastIndexOf('/');
	const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
	return base ? base.toLowerCase() : undefined;
}

/** Matches a parsed Terraform block declaration to a node in the active CloudForge graph snapshot. */
export function matchBlockToGraphNode(
	block: TerraformBlockMatch,
	nodes: readonly CanvasNodeSummary[],
	currentFileName?: string
): CanvasNodeSummary | undefined {
	if (block.kind !== 'resource' && block.kind !== 'data' && block.kind !== 'module') {
		return undefined;
	}
	const fileBase = normalizedFileBase(currentFileName);

	const candidates = nodes.filter(node => {
		if (node.name === block.address) {
			return true;
		}
		if (block.kind === 'module') {
			return node.kind.toLowerCase() === 'module'
				&& (node.label === block.name || node.name === `module.${block.name}` || node.name === block.name);
		}
		const kindMatches = block.kind === 'data'
			? node.kind.toLowerCase() === 'data' || node.kind.toLowerCase() === 'datasource'
			: node.kind.toLowerCase() === 'resource';
		if (!kindMatches) {
			return false;
		}
		if (block.resourceType && node.resourceType !== block.resourceType) {
			return false;
		}
		return node.label === block.name || node.name === block.name || node.name.endsWith(`.${block.name}`);
	});

	if (candidates.length === 0) {
		return undefined;
	}
	if (candidates.length === 1 || !fileBase) {
		return candidates[0];
	}
	return candidates.find(node => normalizedFileBase(node.sourceFile) === fileBase) ?? candidates[0];
}

/** Matches a Terraform cursor reference (`azurerm_subnet.snet_app`, `data.*`, `module.*`) to a graph node. */
export function matchReferenceToGraphNode(
	ref: TerraformReferenceMatch,
	nodes: readonly CanvasNodeSummary[]
): CanvasNodeSummary | undefined {
	if (ref.kind !== 'resource' && ref.kind !== 'data' && ref.kind !== 'module') {
		return undefined;
	}
	return nodes.find(node => {
		if (node.name === ref.address) {
			return true;
		}
		if (ref.kind === 'module') {
			return node.kind.toLowerCase() === 'module'
				&& (node.label === ref.name || node.name === `module.${ref.name}` || node.name === ref.name);
		}
		const kindMatches = ref.kind === 'data'
			? node.kind.toLowerCase() === 'data' || node.kind.toLowerCase() === 'datasource'
			: node.kind.toLowerCase() === 'resource';
		if (!kindMatches) {
			return false;
		}
		if (ref.resourceType && node.resourceType !== ref.resourceType) {
			return false;
		}
		return node.label === ref.name || node.name === ref.name || node.name.endsWith(`.${ref.name}`);
	});
}

/**
 * Locates the definition target for a Terraform reference inside a single `.tf` document's text.
 * Supports `resource`, `data`, `module`, `variable`, and `local.<key>` assignments inside `locals {}`.
 */
export function findBlockDefinitionInText(text: string, ref: TerraformReferenceMatch): TerraformDefinitionTarget | undefined {
	const blocks = parseTerraformDocumentBlocks(text);
	if (ref.kind !== 'local') {
		const matched = blocks.find(block => block.kind === ref.kind && block.address === ref.address);
		if (!matched) {
			return undefined;
		}
		return {
			startLine: matched.startLine,
			startCharacter: matched.startCharacter,
			endLine: matched.startLine,
			endCharacter: matched.headerEndCharacter,
		};
	}

	const rawLines = text.split('\n');
	for (const block of blocks) {
		if (block.kind !== 'locals') {
			continue;
		}
		for (let lineIdx = block.startLine; lineIdx <= block.endLine && lineIdx < rawLines.length; lineIdx++) {
			const rawLine = rawLines[lineIdx];
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
			const code = line.slice(0, findLineCommentStart(line));
			const match = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)/.exec(code);
			if (match && match[1] === ref.name) {
				const startCharacter = code.indexOf(match[1]);
				return {
					startLine: lineIdx,
					startCharacter,
					endLine: lineIdx,
					endCharacter: startCharacter + match[1].length,
				};
			}
		}
	}
	return undefined;
}

function escapeMarkdownInline(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+.!|]/g, ch => `\\${ch}`);
}

function commandLink(title: string, commandId: string, args: readonly unknown[]): string {
	const encoded = encodeURIComponent(JSON.stringify(args));
	return `[${title}](command:${commandId}?${encoded})`;
}

/**
 * Formats rich, offline, zero-secret Markdown hover content for a matched CloudForge architecture node.
 */
export function buildTerraformNodeHoverMarkdown(params: {
	readonly node: CanvasNodeSummary;
	readonly graph: CanvasGraphSnapshot;
	readonly schema?: FormSchema;
	readonly costLine?: ResourceCostLine;
}): string {
	const { node, graph, schema, costLine } = params;
	const lines: string[] = [];

	const typeTag = node.resourceType ?? node.kind;
	lines.push(`**CloudForge** \`${node.name}\` (${escapeMarkdownInline(typeTag)})`);

	if (schema?.description) {
		const summary = schema.description.trim().slice(0, 240);
		lines.push('', escapeMarkdownInline(summary), '', `*Schema: ${escapeMarkdownInline(schema.providerSource)} ${escapeMarkdownInline(schema.providerVersion)}*`);
	}

	const metaParts: string[] = [];
	if (node.sourceFile) {
		metaParts.push(`Source: \`${node.sourceFile}${node.sourceLine ? `:${node.sourceLine}` : ''}\``);
	}
	metaParts.push(`Architecture: ${escapeMarkdownInline(graph.architectureName)}`);
	lines.push('', metaParts.join(' | '));

	const upstreamNames: string[] = [];
	const downstreamNames: string[] = [];
	const nodeById = new Map<string, CanvasNodeSummary>();
	for (const item of graph.nodes) {
		nodeById.set(item.id, item);
	}
	for (const edge of graph.edges) {
		if (edge.fromId === node.id) {
			const target = nodeById.get(edge.toId);
			if (target && !downstreamNames.includes(target.label)) {
				downstreamNames.push(target.label);
			}
		} else if (edge.toId === node.id) {
			const source = nodeById.get(edge.fromId);
			if (source && !upstreamNames.includes(source.label)) {
				upstreamNames.push(source.label);
			}
		}
	}

	const formatNeighborList = (items: readonly string[]): string => {
		if (items.length === 0) {
			return 'none';
		}
		const shown = items.slice(0, 4).map(item => `\`${item}\``).join(', ');
		return items.length > 4 ? `${shown} (+${items.length - 4} more)` : shown;
	};

	lines.push(
		'',
		`**Topology:** ${upstreamNames.length} upstream (${formatNeighborList(upstreamNames)}) | ${downstreamNames.length} downstream (${formatNeighborList(downstreamNames)})`
	);

	if (costLine) {
		const amount = costLine.projectedMonthlyUsd === null
			? 'unknown offline'
			: costLine.status === 'free'
				? '$0.00/mo (free)'
				: `~$${costLine.projectedMonthlyUsd.toFixed(2)}/mo USD`;
		lines.push('', `**Offline Cost Estimate:** ${amount} -- ${escapeMarkdownInline(costLine.basis)}`);
	}

	lines.push(
		'',
		`${commandLink('$(type-hierarchy) Reveal in Canvas', 'cloudforge.revealNodeInCanvas', [node.id])} | ${commandLink('$(lightbulb) Explain Resource', 'cloudforge.explainResource', [node.id])}`
	);

	return lines.join('\n');
}

/**
 * Formats an offline schema-only hover when no CloudForge architecture graph is loaded yet
 * (or for a resource type not yet present in the active snapshot).
 */
export function buildTerraformSchemaOnlyHoverMarkdown(schema: FormSchema): string {
	const required = schema.attributes.filter(a => a.access === 'required').map(a => `\`${a.name}\``);
	const lines: string[] = [
		`**CloudForge Schema** \`${schema.typeName}\` (${schema.kind})`,
		'',
		escapeMarkdownInline(schema.description.trim().slice(0, 240)),
		'',
		`*Provider: ${escapeMarkdownInline(schema.providerSource)} ${escapeMarkdownInline(schema.providerVersion)}*`,
	];
	if (required.length > 0) {
		lines.push('', `**Required attributes:** ${required.slice(0, 8).join(', ')}${required.length > 8 ? ` (+${required.length - 8} more)` : ''}`);
	}
	return lines.join('\n');
}
