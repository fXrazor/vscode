/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 12E: In-Editor Learning Rationale Notes (Hover + CodeLens + Cursor Address Detection).
// Supplements CloudForge's Terraform editor language features without modifying `editor/providers.ts`:
// VS Code natively merges Hover and CodeLens contributions across providers.

import {
	CodeLens,
	EventEmitter,
	Hover,
	l10n,
	languages,
	MarkdownString,
	Position,
	Range,
	window,
	workspace,
	type Disposable,
	type DocumentSelector,
	type Event,
	type TextDocument
} from 'vscode';
import {
	extractTerraformReferenceAtPosition,
	findTerraformBlockAtLine,
	parseTerraformDocumentBlocks,
	type TerraformBlockMatch
} from '../editor/terraformLanguage';
import {
	formatLearningNoteHoverMarkdown,
	type LearningRecord,
	type LearningRequirement
} from './model';

const MAX_PARSE_CACHE = 16;

const TERRAFORM_NOTE_SELECTOR: DocumentSelector = [
	{ language: 'terraform' },
	{ language: 'hcl' },
	{ scheme: 'file', pattern: '**/*.tf' },
	{ scheme: 'file', pattern: '**/*.tofu' }
];

export interface EditorNotesHost {
	getRecord(): LearningRecord | undefined;
	readonly onDidChangeRecord: Event<void>;
}

function isTfDocument(doc: TextDocument): boolean {
	const lower = doc.uri.path.toLowerCase();
	return lower.endsWith('.tf') || lower.endsWith('.tofu') || doc.languageId === 'terraform' || doc.languageId === 'hcl';
}

function requirementsForAddress(record: LearningRecord | undefined, address: string): readonly LearningRequirement[] {
	const reqs = record?.task?.requirements ?? [];
	return reqs.filter(req => req.linkedAddresses.includes(address));
}

export function detectCursorResourceAddress(): string | undefined {
	const editor = window.activeTextEditor;
	if (!editor || !isTfDocument(editor.document)) {
		return undefined;
	}
	const blocks = parseTerraformDocumentBlocks(editor.document.getText());
	const block = findTerraformBlockAtLine(blocks, editor.selection.active.line);
	if (!block) {
		return undefined;
	}
	if (block.kind === 'resource' || block.kind === 'data' || block.kind === 'module') {
		return block.address;
	}
	return undefined;
}

export function registerLearningEditorProviders(host: EditorNotesHost): Disposable {
	const lensEmitter = new EventEmitter<void>();
	const recordListener = host.onDidChangeRecord(() => lensEmitter.fire());
	const parseCache = new Map<string, { readonly version: number; readonly blocks: readonly TerraformBlockMatch[] }>();

	function getDocumentBlocks(document: TextDocument): readonly TerraformBlockMatch[] {
		const key = document.uri.toString();
		const hit = parseCache.get(key);
		if (hit && hit.version === document.version) {
			return hit.blocks;
		}
		const blocks = parseTerraformDocumentBlocks(document.getText());
		if (parseCache.size >= MAX_PARSE_CACHE) {
			const oldest = parseCache.keys().next().value;
			if (oldest !== undefined) {
				parseCache.delete(oldest);
			}
		}
		parseCache.set(key, { version: document.version, blocks });
		return blocks;
	}

	const codeLensDisposable = languages.registerCodeLensProvider(TERRAFORM_NOTE_SELECTOR, {
		onDidChangeCodeLenses: lensEmitter.event,
		provideCodeLenses(document) {
			const enabled = workspace.getConfiguration('cloudforge').get<boolean>('editor.codeLens', true);
			if (!enabled || !isTfDocument(document)) {
				return [];
			}
			const record = host.getRecord();
			if (!record) {
				return [];
			}
			const hasNotes = Object.keys(record.notes).length > 0;
			const hasReqs = (record.task?.requirements.length ?? 0) > 0;
			if (!hasNotes && !hasReqs) {
				return [];
			}

			const blocks = getDocumentBlocks(document);
			const lenses: CodeLens[] = [];
			for (const block of blocks) {
				if (block.kind !== 'resource' && block.kind !== 'data' && block.kind !== 'module') {
					continue;
				}
				const note = record.notes[block.address];
				const linkedReqs = requirementsForAddress(record, block.address);
				if (!note && linkedReqs.length === 0) {
					continue;
				}
				const range = new Range(
					new Position(block.startLine, block.startCharacter),
					new Position(block.startLine, block.headerEndCharacter)
				);
				if (note) {
					lenses.push(new CodeLens(range, {
						title: `$(note) ${l10n.t('Learning note')}`,
						tooltip: note.why ?? note.userNote ?? l10n.t('Open CloudForge Learning Studio'),
						command: 'cloudforge.openLearningStudio',
						arguments: ['task']
					}));
				}
				if (linkedReqs.length > 0) {
					const done = linkedReqs.filter(r => r.status === 'addressed').length;
					lenses.push(new CodeLens(range, {
						title: `$(checklist) ${l10n.t('{0}/{1} lab requirements', done, linkedReqs.length)}`,
						tooltip: linkedReqs.map(r => r.text).join('\n'),
						command: 'cloudforge.openLearningStudio',
						arguments: ['task']
					}));
				}
			}
			return lenses;
		}
	});

	const hoverDisposable = languages.registerHoverProvider(TERRAFORM_NOTE_SELECTOR, {
		provideHover(document, position) {
			if (!isTfDocument(document)) {
				return undefined;
			}
			const record = host.getRecord();
			if (!record) {
				return undefined;
			}
			const lineText = document.lineAt(position.line).text;
			const ref = extractTerraformReferenceAtPosition(lineText, position.character);
			let targetAddress: string | undefined = ref?.address;
			let hoverRange: Range | undefined = ref
				? new Range(new Position(position.line, ref.startCharacter), new Position(position.line, ref.endCharacter))
				: undefined;

			if (!targetAddress || (!record.notes[targetAddress] && requirementsForAddress(record, targetAddress).length === 0)) {
				const blocks = getDocumentBlocks(document);
				const block = findTerraformBlockAtLine(blocks, position.line);
				if (block && block.startLine === position.line && (block.kind === 'resource' || block.kind === 'data' || block.kind === 'module')) {
					targetAddress = block.address;
					hoverRange = new Range(
						new Position(block.startLine, block.startCharacter),
						new Position(block.startLine, block.headerEndCharacter)
					);
				}
			}

			if (!targetAddress) {
				return undefined;
			}
			const note = record.notes[targetAddress];
			const linkedReqs = requirementsForAddress(record, targetAddress);
			if (!note && linkedReqs.length === 0) {
				return undefined;
			}

			const markdownText = formatLearningNoteHoverMarkdown(targetAddress, note, linkedReqs);
			if (!markdownText) {
				return undefined;
			}
			const md = new MarkdownString(markdownText, true);
			md.isTrusted = {
				enabledCommands: ['cloudforge.addResourceNote', 'cloudforge.openLearningStudio']
			};
			return new Hover(md, hoverRange);
		}
	});

	return {
		dispose(): void {
			parseCache.clear();
			recordListener.dispose();
			lensEmitter.dispose();
			codeLensDisposable.dispose();
			hoverDisposable.dispose();
		}
	};
}
