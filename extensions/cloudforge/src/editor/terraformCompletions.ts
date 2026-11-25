/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure Terraform / OpenTofu autocomplete engine: context detection, workspace symbol indexing
// (`var.*`, `local.*`, `module.*`, `data.*`, `<resource_type>.<name>.<attr>`), schema-backed
// attribute & block completion, and HCL2 snippet generation. Zero runtime `vscode` or relative
// runtime imports so `node --test` tests every code path directly.

import type { CanvasGraphSnapshot } from '../canvas/protocol';
import type { FormAttribute, FormSchema } from '../canvas/schemaForm';

export interface WorkspaceTerraformSymbols {
	readonly variables: readonly { readonly name: string; readonly fileName: string }[];
	readonly locals: readonly { readonly name: string; readonly fileName: string }[];
	readonly modules: readonly { readonly name: string; readonly fileName: string }[];
	readonly resources: readonly { readonly resourceType: string; readonly name: string; readonly fileName: string }[];
	readonly dataSources: readonly { readonly resourceType: string; readonly name: string; readonly fileName: string }[];
}

export type TerraformCompletionContext =
	| { readonly kind: 'topLevel'; readonly prefix: string }
	| { readonly kind: 'resourceTypeLabel'; readonly blockKind: 'resource' | 'data'; readonly prefix: string }
	| {
		readonly kind: 'blockAttribute';
		readonly blockKind: 'resource' | 'data';
		readonly resourceType: string;
		readonly existingAttributes: ReadonlySet<string>;
		readonly existingBlocks: ReadonlySet<string>;
		readonly prefix: string;
	}
	| {
		readonly kind: 'valueExpression';
		readonly blockKind?: 'resource' | 'data';
		readonly resourceType?: string;
		readonly attributeName: string;
		readonly prefix: string;
		readonly insideString: boolean;
	}
	| {
		readonly kind: 'referenceMember';
		readonly segments: readonly string[];
		readonly trailingPrefix: string;
	};

export type TerraformCompletionItemKind =
	| 'snippet'
	| 'class'
	| 'property'
	| 'field'
	| 'variable'
	| 'module'
	| 'value'
	| 'reference';

export interface TerraformCompletionCandidate {
	readonly label: string;
	readonly kind: TerraformCompletionItemKind;
	readonly detail: string;
	readonly documentation?: string;
	readonly insertText: string;
	readonly isSnippet: boolean;
	readonly sortText: string;
}

const MAX_FILE_CHARS = 512 * 1024;
const MAX_FILES = 128;

function stripLineComment(line: string): string {
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
			return line.slice(0, i);
		}
	}
	return line;
}

/**
 * Extracts variables, locals keys, modules, resources, and data sources from bounded `.tf` / `.tofu`
 * text files for fast offline autocomplete.
 */
export function collectWorkspaceTerraformSymbols(
	files: readonly { readonly fileName: string; readonly text: string }[]
): WorkspaceTerraformSymbols {
	const variables: { name: string; fileName: string }[] = [];
	const locals: { name: string; fileName: string }[] = [];
	const modules: { name: string; fileName: string }[] = [];
	const resources: { resourceType: string; name: string; fileName: string }[] = [];
	const dataSources: { resourceType: string; name: string; fileName: string }[] = [];

	const seenVar = new Set<string>();
	const seenLocal = new Set<string>();
	const seenModule = new Set<string>();
	const seenResource = new Set<string>();
	const seenData = new Set<string>();

	const limit = Math.min(files.length, MAX_FILES);
	for (let f = 0; f < limit; f++) {
		const { fileName, text } = files[f];
		if (!text || text.length > MAX_FILE_CHARS) {
			continue;
		}
		const lines = text.split('\n');
		let braceDepth = 0;
		let inBlockComment = false;
		let inLocals = false;
		let heredoc: { marker: string; indented: boolean } | undefined;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const rawLine = lines[lineIdx];
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

			if (heredoc) {
				const candidate = heredoc.indented ? line.trim() : line;
				if (candidate === heredoc.marker) {
					heredoc = undefined;
				}
				continue;
			}

			let scanFrom = 0;
			if (inBlockComment) {
				const close = line.indexOf('*/');
				if (close === -1) {
					continue;
				}
				inBlockComment = false;
				scanFrom = close + 2;
			}

			const code = stripLineComment(line.slice(scanFrom));

			if (braceDepth === 0) {
				const resMatch = /^\s*resource\s+"([A-Za-z0-9_-]+)"\s+"([A-Za-z0-9_-]+)"/.exec(code);
				if (resMatch) {
					const key = `${resMatch[1]}.${resMatch[2]}`;
					if (!seenResource.has(key)) {
						seenResource.add(key);
						resources.push({ resourceType: resMatch[1], name: resMatch[2], fileName });
					}
				} else {
					const dataMatch = /^\s*data\s+"([A-Za-z0-9_-]+)"\s+"([A-Za-z0-9_-]+)"/.exec(code);
					if (dataMatch) {
						const key = `${dataMatch[1]}.${dataMatch[2]}`;
						if (!seenData.has(key)) {
							seenData.add(key);
							dataSources.push({ resourceType: dataMatch[1], name: dataMatch[2], fileName });
						}
					} else {
						const varMatch = /^\s*variable\s+"([A-Za-z0-9_-]+)"/.exec(code);
						if (varMatch && !seenVar.has(varMatch[1])) {
							seenVar.add(varMatch[1]);
							variables.push({ name: varMatch[1], fileName });
						}
						const modMatch = /^\s*module\s+"([A-Za-z0-9_-]+)"/.exec(code);
						if (modMatch && !seenModule.has(modMatch[1])) {
							seenModule.add(modMatch[1]);
							modules.push({ name: modMatch[1], fileName });
						}
						if (/^\s*locals\b/.test(code)) {
							inLocals = true;
							const openBrace = code.indexOf('{');
							if (openBrace !== -1) {
								const inlineLocal = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)/.exec(code.slice(openBrace + 1));
								if (inlineLocal && !seenLocal.has(inlineLocal[1])) {
									seenLocal.add(inlineLocal[1]);
									locals.push({ name: inlineLocal[1], fileName });
								}
							}
						}
					}
				}
			} else if (braceDepth === 1 && inLocals) {
				const localMatch = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)/.exec(code);
				if (localMatch && !seenLocal.has(localMatch[1])) {
					seenLocal.add(localMatch[1]);
					locals.push({ name: localMatch[1], fileName });
				}
			}

			let inStr = false;
			for (let i = 0; i < code.length; i++) {
				const ch = code[i];
				if (inBlockComment) {
					const close = code.indexOf('*/', i);
					if (close === -1) {
						break;
					}
					inBlockComment = false;
					i = close + 1;
					continue;
				}
				if (inStr) {
					if (ch === '\\' && i + 1 < code.length) {
						i++;
						continue;
					}
					if (ch === '"') {
						inStr = false;
					}
					continue;
				}
				if (ch === '/' && code[i + 1] === '*') {
					inBlockComment = true;
					i++;
					continue;
				}
				if (ch === '"') {
					inStr = true;
					continue;
				}
				if (ch === '<' && code[i + 1] === '<') {
					const hm = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)\s*$/.exec(code.slice(i));
					if (hm) {
						heredoc = { indented: hm[1] === '-', marker: hm[2] };
						break;
					}
				}
				if (ch === '{') {
					braceDepth++;
				} else if (ch === '}' && braceDepth > 0) {
					braceDepth--;
					if (braceDepth === 0) {
						inLocals = false;
					}
				}
			}
		}
	}

	return { variables, locals, modules, resources, dataSources };
}

/** Merges active CloudForge graph nodes into workspace symbols without duplicating existing entries. */
export function mergeGraphNodesIntoSymbols(
	base: WorkspaceTerraformSymbols,
	snapshot: CanvasGraphSnapshot | undefined
): WorkspaceTerraformSymbols {
	if (!snapshot || snapshot.nodes.length === 0) {
		return base;
	}
	const resources = [...base.resources];
	const dataSources = [...base.dataSources];
	const modules = [...base.modules];
	const seenResource = new Set(resources.map(r => `${r.resourceType}.${r.name}`));
	const seenData = new Set(dataSources.map(d => `${d.resourceType}.${d.name}`));
	const seenModule = new Set(modules.map(m => m.name));

	for (const node of snapshot.nodes) {
		const kind = node.kind.toLowerCase();
		const fileName = node.sourceFile ?? snapshot.architectureName;
		if (kind === 'module') {
			const name = node.label || node.name.replace(/^module\./, '');
			if (name && !seenModule.has(name)) {
				seenModule.add(name);
				modules.push({ name, fileName });
			}
		} else if ((kind === 'data' || kind === 'datasource') && node.resourceType) {
			const name = node.label || node.name.split('.').pop() || node.name;
			const key = `${node.resourceType}.${name}`;
			if (!seenData.has(key)) {
				seenData.add(key);
				dataSources.push({ resourceType: node.resourceType, name, fileName });
			}
		} else if (kind === 'resource' && node.resourceType) {
			const name = node.label || node.name.split('.').pop() || node.name;
			const key = `${node.resourceType}.${name}`;
			if (!seenResource.has(key)) {
				seenResource.add(key);
				resources.push({ resourceType: node.resourceType, name, fileName });
			}
		}
	}

	return {
		variables: base.variables,
		locals: base.locals,
		modules,
		resources,
		dataSources,
	};
}

interface EnclosingBlockInfo {
	readonly kind: 'resource' | 'data' | 'other';
	readonly resourceType?: string;
	readonly startLine: number;
	readonly depthAtCursor: number;
}

function scanEnclosingBlock(lines: readonly string[], targetLine: number, targetChar: number): EnclosingBlockInfo {
	let braceDepth = 0;
	let inBlockComment = false;
	let heredoc: { marker: string; indented: boolean } | undefined;
	let topKind: 'resource' | 'data' | 'other' = 'other';
	let topResourceType: string | undefined;
	let topStartLine = 0;

	const maxLine = Math.min(targetLine, lines.length - 1);
	for (let lineIdx = 0; lineIdx <= maxLine; lineIdx++) {
		const rawLine = lines[lineIdx];
		const fullLine = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const line = lineIdx === targetLine ? fullLine.slice(0, targetChar) : fullLine;

		if (heredoc) {
			if (lineIdx < targetLine) {
				const candidate = heredoc.indented ? line.trim() : line;
				if (candidate === heredoc.marker) {
					heredoc = undefined;
				}
			}
			continue;
		}

		let scanFrom = 0;
		if (inBlockComment) {
			const close = line.indexOf('*/');
			if (close === -1) {
				continue;
			}
			inBlockComment = false;
			scanFrom = close + 2;
		}

		const code = stripLineComment(line.slice(scanFrom));
		if (braceDepth === 0) {
			const resMatch = /^\s*resource\s+"([A-Za-z0-9_-]+)"/.exec(code);
			if (resMatch) {
				topKind = 'resource';
				topResourceType = resMatch[1];
				topStartLine = lineIdx;
			} else {
				const dataMatch = /^\s*data\s+"([A-Za-z0-9_-]+)"/.exec(code);
				if (dataMatch) {
					topKind = 'data';
					topResourceType = dataMatch[1];
					topStartLine = lineIdx;
				} else if (/^\s*(?:module|variable|output|provider|locals|terraform|moved|import|check|removed)\b/.test(code)) {
					topKind = 'other';
					topResourceType = undefined;
					topStartLine = lineIdx;
				}
			}
		}

		let inStr = false;
		for (let i = 0; i < code.length; i++) {
			const ch = code[i];
			if (inBlockComment) {
				const close = code.indexOf('*/', i);
				if (close === -1) {
					break;
				}
				inBlockComment = false;
				i = close + 1;
				continue;
			}
			if (inStr) {
				if (ch === '\\' && i + 1 < code.length) {
					i++;
					continue;
				}
				if (ch === '"') {
					inStr = false;
				}
				continue;
			}
			if (ch === '/' && code[i + 1] === '*') {
				inBlockComment = true;
				i++;
				continue;
			}
			if (ch === '"') {
				inStr = true;
				continue;
			}
			if (ch === '<' && code[i + 1] === '<') {
				const hm = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)\s*$/.exec(code.slice(i));
				if (hm) {
					heredoc = { indented: hm[1] === '-', marker: hm[2] };
					break;
				}
			}
			if (ch === '{') {
				braceDepth++;
			} else if (ch === '}' && braceDepth > 0) {
				braceDepth--;
				if (braceDepth === 0) {
					topKind = 'other';
					topResourceType = undefined;
				}
			}
		}
	}

	return { kind: topKind, resourceType: topResourceType, startLine: topStartLine, depthAtCursor: braceDepth };
}

function collectExistingAttributesInBlock(lines: readonly string[], startLine: number): {
	readonly attributes: Set<string>;
	readonly blocks: Set<string>;
} {
	const attributes = new Set<string>();
	const blocks = new Set<string>();
	let braceDepth = 0;
	let started = false;

	for (let i = startLine; i < lines.length; i++) {
		const raw = lines[i];
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		const code = stripLineComment(line);

		if (braceDepth === 1) {
			const attrMatch = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)/.exec(code);
			if (attrMatch) {
				attributes.add(attrMatch[1]);
			} else {
				const nestedBlock = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\{/.exec(code);
				if (nestedBlock) {
					blocks.add(nestedBlock[1]);
				}
			}
		}

		let inStr = false;
		for (let c = 0; c < code.length; c++) {
			const ch = code[c];
			if (inStr) {
				if (ch === '\\' && c + 1 < code.length) {
					c++;
					continue;
				}
				if (ch === '"') {
					inStr = false;
				}
				continue;
			}
			if (ch === '"') {
				inStr = true;
				continue;
			}
			if (ch === '{') {
				braceDepth++;
				started = true;
			} else if (ch === '}' && braceDepth > 0) {
				braceDepth--;
				if (started && braceDepth === 0) {
					return { attributes, blocks };
				}
			}
		}
	}
	return { attributes, blocks };
}

function isCursorInsideComment(linePrefix: string): boolean {
	return stripLineComment(linePrefix).length < linePrefix.length;
}

/**
 * Determines what kind of Terraform completion should be offered at `(line, character)`.
 */
export function detectTerraformCompletionContext(
	text: string,
	line: number,
	character: number
): TerraformCompletionContext | undefined {
	if (text.length > MAX_FILE_CHARS || line < 0 || character < 0) {
		return undefined;
	}
	const lines = text.split('\n');
	if (line >= lines.length) {
		return undefined;
	}
	const rawLine = lines[line];
	const fullLine = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
	const linePrefix = fullLine.slice(0, Math.min(character, fullLine.length));

	if (isCursorInsideComment(linePrefix)) {
		return undefined;
	}

	// 1. Inside `resource "<cursor>` or `data "<cursor>` type label.
	const labelMatch = /^\s*(resource|data)\s+"([A-Za-z0-9_-]*)$/.exec(linePrefix);
	if (labelMatch) {
		return {
			kind: 'resourceTypeLabel',
			blockKind: labelMatch[1] as 'resource' | 'data',
			prefix: labelMatch[2],
		};
	}

	// 2. Dotted reference completion: `var.`, `local.`, `module.`, `data.type.`, `azurerm_rg.hub.`, inside `${...}` or expressions.
	const refChainMatch = /([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\.([A-Za-z0-9_-]*)$/.exec(linePrefix);
	if (refChainMatch) {
		// Verify we are either outside strings or inside `${ ... }` interpolation.
		const beforeMatch = linePrefix.slice(0, refChainMatch.index);
		let inStr = false;
		let interpDepth = 0;
		for (let i = 0; i < beforeMatch.length; i++) {
			const ch = beforeMatch[i];
			if (inStr) {
				if (ch === '\\' && i + 1 < beforeMatch.length) {
					i++;
					continue;
				}
				if (ch === '"') {
					inStr = false;
					continue;
				}
				if ((ch === '$' || ch === '%') && beforeMatch[i + 1] === '{') {
					inStr = false;
					interpDepth++;
					i++;
				}
			} else {
				if (ch === '"') {
					inStr = true;
				} else if (ch === '}' && interpDepth > 0) {
					interpDepth--;
					inStr = true;
				}
			}
		}
		if (!inStr) {
			return {
				kind: 'referenceMember',
				segments: refChainMatch[1].split('.'),
				trailingPrefix: refChainMatch[2],
			};
		}
	}

	const enclosing = scanEnclosingBlock(lines, line, character);

	// 3. Top-level block / snippet completion.
	if (enclosing.depthAtCursor === 0) {
		const topPrefix = /^\s*([A-Za-z_][A-Za-z0-9_-]*)?$/.exec(linePrefix);
		if (topPrefix) {
			return { kind: 'topLevel', prefix: topPrefix[1] ?? '' };
		}
		return undefined;
	}

	// 4. Value expression after `attribute = ...`.
	const assignMatch = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)\s*(.*)$/.exec(linePrefix);
	if (assignMatch) {
		const attrName = assignMatch[1];
		const rhs = assignMatch[2];
		const insideStringMatch = /^"([^"]*)$/.exec(rhs);
		if (insideStringMatch) {
			return {
				kind: 'valueExpression',
				...(enclosing.kind !== 'other' ? { blockKind: enclosing.kind, resourceType: enclosing.resourceType } : {}),
				attributeName: attrName,
				prefix: insideStringMatch[1],
				insideString: true,
			};
		}
		const exprPrefix = /([A-Za-z0-9_-]*)$/.exec(rhs)?.[1] ?? '';
		return {
			kind: 'valueExpression',
			...(enclosing.kind !== 'other' ? { blockKind: enclosing.kind, resourceType: enclosing.resourceType } : {}),
			attributeName: attrName,
			prefix: exprPrefix,
			insideString: false,
		};
	}

	// 5. Attribute / nested block completion directly inside a `resource` or `data` body (depth 1).
	if (enclosing.depthAtCursor === 1 && enclosing.kind !== 'other' && enclosing.resourceType) {
		const keyPrefix = /^\s*([A-Za-z_][A-Za-z0-9_-]*)?$/.exec(linePrefix);
		if (keyPrefix) {
			const existing = collectExistingAttributesInBlock(lines, enclosing.startLine);
			return {
				kind: 'blockAttribute',
				blockKind: enclosing.kind,
				resourceType: enclosing.resourceType,
				existingAttributes: existing.attributes,
				existingBlocks: existing.blocks,
				prefix: keyPrefix[1] ?? '',
			};
		}
	}

	return undefined;
}

function snippetForAttribute(attr: FormAttribute): string {
	switch (attr.valueType) {
		case 'bool':
			return `${attr.name} = \${1|true,false|}`;
		case 'number':
			return `${attr.name} = \${1:${attr.placeholder ?? '1'}}`;
		case 'listString':
			return `${attr.name} = ["\${1:${attr.placeholder ?? ''}}"]`;
		case 'mapString':
			return `${attr.name} = {\n  \${1:key} = "\${2:value}"\n}`;
		default:
			if (attr.options && attr.options.length > 0) {
				const choices = attr.options.slice(0, 8).map(o => o.replace(/[,|}]/g, '')).join(',');
				return `${attr.name} = "\${1|${choices}|}"`;
			}
			return `${attr.name} = "\${1:${attr.placeholder ?? ''}}"`;
	}
}

function buildResourceBlockSnippet(schema: FormSchema): string {
	const requiredAttrs = schema.attributes.filter(a => a.access === 'required');
	const lines: string[] = [
		`${schema.kind === 'dataSource' ? 'data' : 'resource'} "${schema.typeName}" "\${1:main}" {`,
	];
	let tab = 2;
	for (const attr of requiredAttrs.slice(0, 6)) {
		const placeholder = attr.placeholder ?? (attr.options?.[0] ?? '');
		if (attr.valueType === 'listString') {
			lines.push(`  ${attr.name} = ["\${${tab}:${placeholder}}"]`);
		} else if (attr.valueType === 'bool') {
			lines.push(`  ${attr.name} = \${${tab}|true,false|}`);
		} else if (attr.valueType === 'number') {
			lines.push(`  ${attr.name} = \${${tab}:${placeholder || '1'}}`);
		} else {
			lines.push(`  ${attr.name} = "\${${tab}:${placeholder}}"`);
		}
		tab++;
	}
	if (requiredAttrs.length === 0) {
		lines.push(`  \${${tab}}`);
	}
	lines.push('}');
	return lines.join('\n');
}

const TOP_LEVEL_HCL_SNIPPETS: readonly TerraformCompletionCandidate[] = [
	{
		label: 'resource',
		kind: 'snippet',
		detail: 'Terraform managed resource block',
		insertText: 'resource "${1:azurerm_resource_group}" "${2:main}" {\n  $0\n}',
		isSnippet: true,
		sortText: '0_resource',
	},
	{
		label: 'data',
		kind: 'snippet',
		detail: 'Terraform data source block',
		insertText: 'data "${1:azurerm_client_config}" "${2:current}" {\n  $0\n}',
		isSnippet: true,
		sortText: '0_data',
	},
	{
		label: 'module',
		kind: 'snippet',
		detail: 'Terraform module call block',
		insertText: 'module "${1:network}" {\n  source = "${2:./modules/network}"\n  $0\n}',
		isSnippet: true,
		sortText: '0_module',
	},
	{
		label: 'variable',
		kind: 'snippet',
		detail: 'Terraform input variable declaration',
		insertText: 'variable "${1:location}" {\n  type        = ${2|string,number,bool,list(string),map(string)|}\n  description = "${3}"\n  default     = "${4:uksouth}"\n}',
		isSnippet: true,
		sortText: '0_variable',
	},
	{
		label: 'output',
		kind: 'snippet',
		detail: 'Terraform output value declaration',
		insertText: 'output "${1:id}" {\n  description = "${2}"\n  value       = ${3}\n}',
		isSnippet: true,
		sortText: '0_output',
	},
	{
		label: 'locals',
		kind: 'snippet',
		detail: 'Terraform local values block',
		insertText: 'locals {\n  ${1:common_tags} = {\n    ${2:environment} = "${3:dev}"\n  }\n}',
		isSnippet: true,
		sortText: '0_locals',
	},
	{
		label: 'provider',
		kind: 'snippet',
		detail: 'Terraform provider configuration block',
		insertText: 'provider "${1|azurerm,aws,google,kubernetes|}" {\n  $0\n}',
		isSnippet: true,
		sortText: '0_provider',
	},
	{
		label: 'terraform',
		kind: 'snippet',
		detail: 'Terraform settings & required_providers block',
		insertText: 'terraform {\n  required_version = ">= 1.6.0"\n  required_providers {\n    ${1:azurerm} = {\n      source  = "hashicorp/${1:azurerm}"\n      version = "~> ${2:4.0}"\n    }\n  }\n}',
		isSnippet: true,
		sortText: '0_terraform',
	},
];

/**
 * Generates deterministic, schema-aware Terraform completion candidates for the detected cursor context.
 */
export function buildTerraformCompletionItems(
	context: TerraformCompletionContext,
	params: {
		readonly schemas: readonly FormSchema[];
		readonly symbols: WorkspaceTerraformSymbols;
		readonly lookupSchema?: (kind: 'resource' | 'dataSource', typeName: string) => FormSchema | undefined;
	}
): TerraformCompletionCandidate[] {
	const { schemas, symbols } = params;
	const findSchema = (kind: 'resource' | 'dataSource', typeName: string): FormSchema | undefined =>
		params.lookupSchema?.(kind, typeName)
		?? schemas.find(s => s.kind === kind && s.typeName === typeName);

	switch (context.kind) {
		case 'topLevel': {
			const items: TerraformCompletionCandidate[] = [...TOP_LEVEL_HCL_SNIPPETS];
			const seen = new Set<string>();
			for (const schema of schemas) {
				if (seen.has(schema.typeName)) {
					continue;
				}
				seen.add(schema.typeName);
				const kw = schema.kind === 'dataSource' ? 'data' : 'resource';
				items.push({
					label: `${kw} "${schema.typeName}"`,
					kind: 'snippet',
					detail: `CloudForge schema (${schema.providerSource} ${schema.providerVersion})`,
					documentation: schema.description,
					insertText: buildResourceBlockSnippet(schema),
					isSnippet: true,
					sortText: `1_${schema.typeName}`,
				});
			}
			return items;
		}

		case 'resourceTypeLabel': {
			const wantedKind = context.blockKind === 'data' ? 'dataSource' : 'resource';
			const seen = new Set<string>();
			const items: TerraformCompletionCandidate[] = [];
			for (const schema of schemas) {
				if (schema.kind !== wantedKind || seen.has(schema.typeName)) {
					continue;
				}
				seen.add(schema.typeName);
				items.push({
					label: schema.typeName,
					kind: 'class',
					detail: `${schema.providerSource} ${schema.providerVersion}`,
					documentation: schema.description,
					insertText: schema.typeName,
					isSnippet: false,
					sortText: `0_${schema.typeName}`,
				});
			}
			return items;
		}

		case 'blockAttribute': {
			const schemaKind = context.blockKind === 'data' ? 'dataSource' : 'resource';
			const schema = findSchema(schemaKind, context.resourceType);
			const items: TerraformCompletionCandidate[] = [];

			if (schema) {
				for (const attr of schema.attributes) {
					if (attr.access === 'computedOnly' || context.existingAttributes.has(attr.name)) {
						continue;
					}
					const requiredTag = attr.access === 'required' ? 'required' : 'optional';
					items.push({
						label: attr.name,
						kind: 'property',
						detail: `${requiredTag} (${attr.valueType})`,
						documentation: attr.description,
						insertText: snippetForAttribute(attr),
						isSnippet: true,
						sortText: `${attr.access === 'required' ? '0' : '1'}_${attr.name}`,
					});
				}
				for (const blk of schema.blocks) {
					if (blk.maxItems === 1 && context.existingBlocks.has(blk.name)) {
						continue;
					}
					const reqLines = blk.attributes
						.filter(a => a.access === 'required')
						.slice(0, 4)
						.map((a, idx) => `  ${a.name} = "\${${idx + 1}:${a.placeholder ?? ''}}"`);
					const body = reqLines.length > 0 ? reqLines.join('\n') : '  $0';
					items.push({
						label: blk.name,
						kind: 'field',
						detail: `block${blk.minItems ? ' (required)' : ''}`,
						documentation: blk.description,
						insertText: `${blk.name} {\n${body}\n}`,
						isSnippet: true,
						sortText: `${blk.minItems ? '0' : '2'}_${blk.name}`,
					});
				}
			}

			// Standard HCL meta-arguments.
			for (const meta of [
				{ name: 'depends_on', snippet: 'depends_on = [${1}]', doc: 'Explicit dependency list for this block.' },
				{ name: 'count', snippet: 'count = ${1:1}', doc: 'Create multiple instances indexed by count.index.' },
				{ name: 'for_each', snippet: 'for_each = ${1:toset([])}', doc: 'Create one instance per map entry or set element.' },
				{ name: 'lifecycle', snippet: 'lifecycle {\n  ${1|create_before_destroy,prevent_destroy|} = true\n}', doc: 'Customize resource lifecycle behavior.' },
			]) {
				if (!context.existingAttributes.has(meta.name) && !context.existingBlocks.has(meta.name)) {
					items.push({
						label: meta.name,
						kind: 'field',
						detail: 'HCL meta-argument',
						documentation: meta.doc,
						insertText: meta.snippet,
						isSnippet: true,
						sortText: `3_${meta.name}`,
					});
				}
			}
			return items;
		}

		case 'valueExpression': {
			const items: TerraformCompletionCandidate[] = [];
			if (context.blockKind && context.resourceType) {
				const schema = findSchema(context.blockKind === 'data' ? 'dataSource' : 'resource', context.resourceType);
				const attr = schema?.attributes.find(a => a.name === context.attributeName);
				if (attr?.options) {
					for (const opt of attr.options) {
						items.push({
							label: opt,
							kind: 'value',
							detail: `${context.resourceType}.${context.attributeName} option`,
							insertText: context.insideString ? opt : `"${opt}"`,
							isSnippet: false,
							sortText: `0_${opt}`,
						});
					}
				}
			}
			if (!context.insideString) {
				for (const root of [
					{ label: 'var', detail: 'Input variable reference', count: symbols.variables.length },
					{ label: 'local', detail: 'Local value reference', count: symbols.locals.length },
					{ label: 'module', detail: 'Module output reference', count: symbols.modules.length },
					{ label: 'data', detail: 'Data source reference', count: symbols.dataSources.length },
				]) {
					items.push({
						label: `${root.label}.`,
						kind: 'reference',
						detail: `${root.detail} (${root.count} in workspace)`,
						insertText: `${root.label}.`,
						isSnippet: false,
						sortText: `1_${root.label}`,
					});
				}
				for (const res of symbols.resources) {
					items.push({
						label: `${res.resourceType}.${res.name}`,
						kind: 'reference',
						detail: `Resource in ${res.fileName}`,
						insertText: `${res.resourceType}.${res.name}.`,
						isSnippet: false,
						sortText: `2_${res.resourceType}.${res.name}`,
					});
				}
			}
			return items;
		}

		case 'referenceMember': {
			const segs = context.segments;
			const head = segs[0];
			if (head === 'var' && segs.length === 1) {
				return symbols.variables.map(v => ({
					label: v.name,
					kind: 'variable',
					detail: `variable (${v.fileName})`,
					insertText: v.name,
					isSnippet: false,
					sortText: `0_${v.name}`,
				}));
			}
			if (head === 'local' && segs.length === 1) {
				return symbols.locals.map(l => ({
					label: l.name,
					kind: 'variable',
					detail: `local (${l.fileName})`,
					insertText: l.name,
					isSnippet: false,
					sortText: `0_${l.name}`,
				}));
			}
			if (head === 'module' && segs.length === 1) {
				return symbols.modules.map(m => ({
					label: m.name,
					kind: 'module',
					detail: `module (${m.fileName})`,
					insertText: m.name,
					isSnippet: false,
					sortText: `0_${m.name}`,
				}));
			}
			if (head === 'data') {
				if (segs.length === 1) {
					const types = Array.from(new Set(symbols.dataSources.map(d => d.resourceType)));
					return types.map(t => ({
						label: t,
						kind: 'class',
						detail: 'data source type',
						insertText: t,
						isSnippet: false,
						sortText: `0_${t}`,
					}));
				}
				if (segs.length === 2) {
					return symbols.dataSources
						.filter(d => d.resourceType === segs[1])
						.map(d => ({
							label: d.name,
							kind: 'reference',
							detail: `data.${d.resourceType} (${d.fileName})`,
							insertText: d.name,
							isSnippet: false,
							sortText: `0_${d.name}`,
						}));
				}
				if (segs.length === 3) {
					const schema = findSchema('dataSource', segs[1]);
					const outputs = schema?.outputs ?? [
						{ name: 'id', valueType: 'string' as const, description: 'Data source ID.', knownAtApply: false },
					];
					return outputs.map(o => ({
						label: o.name,
						kind: 'property',
						detail: `${o.valueType}${o.knownAtApply ? ' (known after apply)' : ''}`,
						documentation: o.description,
						insertText: o.name,
						isSnippet: false,
						sortText: `0_${o.name}`,
					}));
				}
				return [];
			}

			// Managed resource: `<type>.<cursor>` or `<type>.<name>.<cursor>`.
			if (segs.length === 1) {
				return symbols.resources
					.filter(r => r.resourceType === head)
					.map(r => ({
						label: r.name,
						kind: 'reference',
						detail: `${r.resourceType} (${r.fileName})`,
						insertText: r.name,
						isSnippet: false,
						sortText: `0_${r.name}`,
					}));
			}
			if (segs.length === 2) {
				const matched = symbols.resources.some(r => r.resourceType === head && r.name === segs[1]);
				const schema = findSchema('resource', head);
				if (!matched && !schema) {
					return [];
				}
				const outputs = schema?.outputs ?? [
					{ name: 'id', valueType: 'string' as const, description: 'Resource ID (known after apply).', knownAtApply: true },
					{ name: 'name', valueType: 'string' as const, description: 'Resource name.', knownAtApply: false },
				];
				return outputs.map(o => ({
					label: o.name,
					kind: 'property',
					detail: `${o.valueType}${o.knownAtApply ? ' (known after apply)' : ''}`,
					documentation: o.description,
					insertText: o.name,
					isSnippet: false,
					sortText: `0_${o.name}`,
				}));
			}
			return [];
		}
	}
}
