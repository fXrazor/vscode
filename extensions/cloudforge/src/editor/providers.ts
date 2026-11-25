/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Native VS Code language intelligence for Terraform / OpenTofu files linked to the active
// CloudForge Architecture Canvas: Outline/Breadcrumbs (DocumentSymbolProvider), inline Canvas
// CodeLens (CodeLensProvider), topology/schema/cost Hover (HoverProvider), and intra-workspace
// Go-to-Definition (DefinitionProvider).

import {
	CodeLens,
	DocumentSymbol,
	EventEmitter,
	Hover,
	l10n,
	languages,
	Location,
	MarkdownString,
	Position,
	Range,
	SymbolKind,
	Uri,
	workspace,
	type Disposable,
	type DocumentSelector,
	type TextDocument
} from 'vscode';
import { createDraftDocument } from '../canvas/draftDocument';
import { estimateArchitectureCost, type ResourceCostLine } from '../canvas/planReview';
import type { CanvasGraphSnapshot } from '../canvas/protocol';
import { lookupBundledSchema, type FormSchema } from '../canvas/schemaForm';
import {
	buildTerraformNodeHoverMarkdown,
	buildTerraformSchemaOnlyHoverMarkdown,
	extractTerraformReferenceAtPosition,
	findBlockDefinitionInText,
	findTerraformBlockAtLine,
	matchBlockToGraphNode,
	matchReferenceToGraphNode,
	parseTerraformDocumentBlocks,
	type TerraformBlockKind,
	type TerraformBlockMatch
} from './terraformLanguage';

const TERRAFORM_SELECTOR: DocumentSelector = [
	{ language: 'terraform' },
	{ language: 'hcl' },
	{ scheme: 'file', pattern: '**/*.tf' },
	{ scheme: 'file', pattern: '**/*.tofu' },
	{ scheme: 'file', pattern: '**/*.tfvars' },
];

const MAX_CACHE_ENTRIES = 16;
const MAX_DEFINITION_FILES = 64;
const MAX_DEFINITION_FILE_BYTES = 512 * 1024;

export interface TerraformEditorHost {
	getActiveSnapshot(): CanvasGraphSnapshot | undefined;
	getCachedSchema(kind: 'resource' | 'dataSource', typeName: string): FormSchema | undefined;
}

export interface TerraformEditorRegistration extends Disposable {
	refresh(): void;
}

function symbolKindForBlock(kind: TerraformBlockKind): SymbolKind {
	switch (kind) {
		case 'resource': return SymbolKind.Class;
		case 'data': return SymbolKind.Interface;
		case 'module': return SymbolKind.Module;
		case 'variable': return SymbolKind.Variable;
		case 'output': return SymbolKind.Property;
		case 'provider': return SymbolKind.Namespace;
		case 'locals': return SymbolKind.Object;
		case 'terraform': return SymbolKind.Package;
		default: return SymbolKind.Event;
	}
}

function fileBasename(uri: Uri): string {
	const p = uri.path;
	const idx = p.lastIndexOf('/');
	return idx >= 0 ? p.slice(idx + 1) : p;
}

function directoryPrefix(uri: Uri): string {
	const p = uri.path;
	const idx = p.lastIndexOf('/');
	return idx >= 0 ? p.slice(0, idx) : '';
}

function isTfOrTofuDocument(doc: TextDocument): boolean {
	const lower = doc.uri.path.toLowerCase();
	return lower.endsWith('.tf') || lower.endsWith('.tofu') || doc.languageId === 'terraform' || doc.languageId === 'hcl';
}

export function registerTerraformEditorProviders(host: TerraformEditorHost): TerraformEditorRegistration {
	const codeLensEmitter = new EventEmitter<void>();
	const parseCache = new Map<string, { readonly version: number; readonly blocks: readonly TerraformBlockMatch[] }>();
	let cachedCostRevision: string | undefined;
	let cachedCostByNodeId = new Map<string, ResourceCostLine>();

	function getDocumentBlocks(document: TextDocument): readonly TerraformBlockMatch[] {
		const key = document.uri.toString();
		const hit = parseCache.get(key);
		if (hit && hit.version === document.version) {
			return hit.blocks;
		}
		const blocks = parseTerraformDocumentBlocks(document.getText());
		if (parseCache.size >= MAX_CACHE_ENTRIES) {
			const oldestKey = parseCache.keys().next().value;
			if (oldestKey !== undefined) {
				parseCache.delete(oldestKey);
			}
		}
		parseCache.set(key, { version: document.version, blocks });
		return blocks;
	}

	function getCostLineForNode(snapshot: CanvasGraphSnapshot, nodeId: string): ResourceCostLine | undefined {
		const sig = `${snapshot.workspaceId}:${snapshot.architectureId}:${snapshot.sourceRevision}`;
		if (cachedCostRevision !== sig) {
			cachedCostRevision = sig;
			cachedCostByNodeId = new Map();
			const estimate = estimateArchitectureCost(createDraftDocument(snapshot));
			for (const line of estimate.lines) {
				cachedCostByNodeId.set(line.nodeId, line);
			}
		}
		return cachedCostByNodeId.get(nodeId);
	}

	const documentSymbolDisposable = languages.registerDocumentSymbolProvider(TERRAFORM_SELECTOR, {
		provideDocumentSymbols(document) {
			const blocks = getDocumentBlocks(document);
			return blocks.map(block => {
				const range = new Range(
					new Position(block.startLine, block.startCharacter),
					new Position(block.endLine, block.endCharacter)
				);
				const selectionRange = new Range(
					new Position(block.startLine, block.startCharacter),
					new Position(block.startLine, Math.max(block.startCharacter, block.headerEndCharacter))
				);
				return new DocumentSymbol(
					block.displayName,
					block.detail,
					symbolKindForBlock(block.kind),
					range,
					selectionRange
				);
			});
		}
	});

	const codeLensDisposable = languages.registerCodeLensProvider(TERRAFORM_SELECTOR, {
		onDidChangeCodeLenses: codeLensEmitter.event,
		provideCodeLenses(document) {
			const enabled = workspace.getConfiguration('cloudforge').get<boolean>('editor.codeLens', true);
			if (!enabled || !isTfOrTofuDocument(document)) {
				return [];
			}
			const blocks = getDocumentBlocks(document);
			if (blocks.length === 0) {
				return [];
			}
			const snapshot = host.getActiveSnapshot();
			const lenses: CodeLens[] = [];

			// Concise file-level actions on the first block line when an architecture is active.
			const topRange = new Range(new Position(0, 0), new Position(0, 0));
			if (snapshot) {
				lenses.push(
					new CodeLens(topRange, {
						title: `$(type-hierarchy) ${l10n.t('Open CloudForge Canvas')}`,
						tooltip: l10n.t('Open {0} in the CloudForge Architecture Canvas', snapshot.architectureName),
						command: 'cloudforge.openCanvas',
					}),
					new CodeLens(topRange, {
						title: `$(diff) ${l10n.t('Preview Local Plan')}`,
						tooltip: l10n.t('Run a credential-free OpenTofu / Terraform local plan preview'),
						command: 'cloudforge.runEnginePlan',
					})
				);
			}

			if (!snapshot) {
				return lenses;
			}

			const baseName = fileBasename(document.uri);
			for (const block of blocks) {
				if (block.kind !== 'resource' && block.kind !== 'data' && block.kind !== 'module') {
					continue;
				}
				const node = matchBlockToGraphNode(block, snapshot.nodes, baseName);
				if (!node) {
					continue;
				}
				const range = new Range(
					new Position(block.startLine, block.startCharacter),
					new Position(block.startLine, block.headerEndCharacter)
				);
				lenses.push(
					new CodeLens(range, {
						title: `$(type-hierarchy) ${l10n.t('Reveal in Canvas')}`,
						tooltip: l10n.t('Select {0} in the CloudForge Architecture Canvas', node.label),
						command: 'cloudforge.revealNodeInCanvas',
						arguments: [node.id],
					}),
					new CodeLens(range, {
						title: `$(lightbulb) ${l10n.t('Explain')}`,
						tooltip: l10n.t('Inspect topology, schema, policy, and cost guidance for {0}', node.label),
						command: 'cloudforge.explainResource',
						arguments: [node.id],
					})
				);
			}
			return lenses;
		}
	});

	const hoverDisposable = languages.registerHoverProvider(TERRAFORM_SELECTOR, {
		provideHover(document, position) {
			const lineText = document.lineAt(position.line).text;
			const ref = extractTerraformReferenceAtPosition(lineText, position.character);
			const snapshot = host.getActiveSnapshot();

			if (ref && snapshot) {
				const matched = matchReferenceToGraphNode(ref, snapshot.nodes);
				if (matched) {
					const schemaKind = matched.kind.toLowerCase() === 'data' ? 'dataSource' : 'resource';
					const schema = matched.resourceType
						? (host.getCachedSchema(schemaKind, matched.resourceType)
							?? lookupBundledSchema({ kind: matched.kind, resourceType: matched.resourceType }))
						: undefined;
					const costLine = getCostLineForNode(snapshot, matched.id);
					const md = new MarkdownString(buildTerraformNodeHoverMarkdown({
						node: matched,
						graph: snapshot,
						schema,
						costLine,
					}), true);
					md.isTrusted = {
						enabledCommands: ['cloudforge.revealNodeInCanvas', 'cloudforge.explainResource'],
					};
					return new Hover(md, new Range(
						new Position(position.line, ref.startCharacter),
						new Position(position.line, ref.endCharacter)
					));
				}
			}

			// Fallback: offline CloudForge schema hover even when no graph is loaded yet.
			if (ref?.resourceType) {
				const schemaKind = ref.kind === 'data' ? 'dataSource' : 'resource';
				const schema = host.getCachedSchema(schemaKind, ref.resourceType)
					?? lookupBundledSchema({ kind: ref.kind === 'data' ? 'data' : 'resource', resourceType: ref.resourceType });
				if (schema) {
					const md = new MarkdownString(buildTerraformSchemaOnlyHoverMarkdown(schema), true);
					return new Hover(md, new Range(
						new Position(position.line, ref.startCharacter),
						new Position(position.line, ref.endCharacter)
					));
				}
			}

			// If cursor is on a resource/data/module header without reference match, try matching enclosing block.
			if (snapshot) {
				const blocks = getDocumentBlocks(document);
				const block = findTerraformBlockAtLine(blocks, position.line);
				if (block && position.line === block.startLine) {
					const matched = matchBlockToGraphNode(block, snapshot.nodes, fileBasename(document.uri));
					if (matched) {
						const schemaKind = matched.kind.toLowerCase() === 'data' ? 'dataSource' : 'resource';
						const schema = matched.resourceType
							? (host.getCachedSchema(schemaKind, matched.resourceType)
								?? lookupBundledSchema({ kind: matched.kind, resourceType: matched.resourceType }))
							: undefined;
						const costLine = getCostLineForNode(snapshot, matched.id);
						const md = new MarkdownString(buildTerraformNodeHoverMarkdown({
							node: matched,
							graph: snapshot,
							schema,
							costLine,
						}), true);
						md.isTrusted = {
							enabledCommands: ['cloudforge.revealNodeInCanvas', 'cloudforge.explainResource'],
						};
						return new Hover(md, new Range(
							new Position(block.startLine, block.startCharacter),
							new Position(block.startLine, block.headerEndCharacter)
						));
					}
				}
			}
			return undefined;
		}
	});

	const definitionDisposable = languages.registerDefinitionProvider(TERRAFORM_SELECTOR, {
		async provideDefinition(document, position, token) {
			const lineText = document.lineAt(position.line).text;
			const ref = extractTerraformReferenceAtPosition(lineText, position.character);
			if (!ref) {
				return undefined;
			}

			// 1. Check the active document first.
			const localHit = findBlockDefinitionInText(document.getText(), ref);
			if (localHit) {
				return new Location(
					document.uri,
					new Range(
						new Position(localHit.startLine, localHit.startCharacter),
						new Position(localHit.endLine, localHit.endCharacter)
					)
				);
			}

			// 2. Search sibling `.tf` / `.tofu` files in the workspace (prioritizing the same folder).
			const candidates = await workspace.findFiles('**/*.{tf,tofu}', '**/.terraform/**', MAX_DEFINITION_FILES);
			if (token.isCancellationRequested) {
				return undefined;
			}
			const currentDir = directoryPrefix(document.uri);
			const currentUriStr = document.uri.toString();
			const ordered = candidates
				.filter(uri => uri.toString() !== currentUriStr)
				.sort((a, b) => {
					const aSame = directoryPrefix(a) === currentDir ? 0 : 1;
					const bSame = directoryPrefix(b) === currentDir ? 0 : 1;
					if (aSame !== bSame) {
						return aSame - bSame;
					}
					return a.path.localeCompare(b.path);
				});

			const openByUri = new Map<string, TextDocument>();
			for (const openDoc of workspace.textDocuments) {
				openByUri.set(openDoc.uri.toString(), openDoc);
			}

			for (const uri of ordered) {
				if (token.isCancellationRequested) {
					return undefined;
				}
				let text: string | undefined;
				const openDoc = openByUri.get(uri.toString());
				if (openDoc) {
					text = openDoc.getText();
				} else {
					try {
						const stat = await workspace.fs.stat(uri);
						if (stat.size > MAX_DEFINITION_FILE_BYTES) {
							continue;
						}
						const raw = await workspace.fs.readFile(uri);
						text = Buffer.from(raw).toString('utf8');
					} catch {
						continue;
					}
				}
				const target = findBlockDefinitionInText(text, ref);
				if (target) {
					return new Location(
						uri,
						new Range(
							new Position(target.startLine, target.startCharacter),
							new Position(target.endLine, target.endCharacter)
						)
					);
				}
			}

			return undefined;
		}
	});

	const closeDocDisposable = workspace.onDidCloseTextDocument(doc => {
		parseCache.delete(doc.uri.toString());
	});

	const configDisposable = workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('cloudforge.editor.codeLens')) {
			codeLensEmitter.fire();
		}
	});

	return {
		refresh() {
			cachedCostRevision = undefined;
			codeLensEmitter.fire();
		},
		dispose() {
			documentSymbolDisposable.dispose();
			codeLensDisposable.dispose();
			hoverDisposable.dispose();
			definitionDisposable.dispose();
			closeDocDisposable.dispose();
			configDisposable.dispose();
			codeLensEmitter.dispose();
			parseCache.clear();
		}
	};
}
