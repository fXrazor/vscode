/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 12F: Native VS Code side-by-side Proposal Diff Viewer.
// Serves read-only virtual documents under the `cloudforge-proposal:` scheme so learners can
// inspect exact line-by-line additions and edits of any pending AI or blueprint proposal
// before running CloudForge's guarded Stage 10D batch save.

import {
	commands,
	EventEmitter,
	l10n,
	Uri,
	workspace,
	type Disposable,
	type TextDocumentContentProvider
} from 'vscode';
import type { ProposalDraft } from './model';

export const CLOUDFORGE_PROPOSAL_SCHEME = 'cloudforge-proposal';

function isSafeTfFileName(name: string): boolean {
	return name.length > 3
		&& name.length <= 128
		&& !name.startsWith('.')
		&& !name.includes('/')
		&& !name.includes('\\')
		&& !name.includes('..')
		&& name.toLowerCase().endsWith('.tf');
}

export class ProposalDiffProvider implements TextDocumentContentProvider, Disposable {
	private readonly changeEmitter = new EventEmitter<Uri>();
	readonly onDidChange = this.changeEmitter.event;
	private readonly documents = new Map<string, string>();
	private readonly registration: Disposable;

	constructor() {
		this.registration = workspace.registerTextDocumentContentProvider(CLOUDFORGE_PROPOSAL_SCHEME, this);
	}

	provideTextDocumentContent(uri: Uri): string {
		if (uri.query === 'side=empty') {
			return '';
		}
		return this.documents.get(uri.toString()) ?? '';
	}

	async openFileDiff(proposal: ProposalDraft, fileName: string): Promise<boolean> {
		if (!isSafeTfFileName(fileName)) {
			return false;
		}
		const file = proposal.files.find(item => item.fileName === fileName);
		if (!file) {
			return false;
		}

		const safeProposalId = encodeURIComponent(proposal.proposalId);
		const safeFileName = encodeURIComponent(file.fileName);
		const proposedUri = Uri.parse(`${CLOUDFORGE_PROPOSAL_SCHEME}:/${safeProposalId}/${safeFileName}?side=proposed`);
		this.documents.set(proposedUri.toString(), file.contents);
		this.changeEmitter.fire(proposedUri);

		const existingUri = await this.findExistingFileUri(file.fileName);
		const leftUri = existingUri ?? Uri.parse(`${CLOUDFORGE_PROPOSAL_SCHEME}:/${safeProposalId}/${safeFileName}?side=empty`);
		const title = existingUri
			? l10n.t('{0} (Current ↔ Proposed: {1})', file.fileName, proposal.title)
			: l10n.t('{0} (New File — Proposed: {1})', file.fileName, proposal.title);

		await commands.executeCommand('vscode.diff', leftUri, proposedUri, title, { preview: true });
		return true;
	}

	private async findExistingFileUri(fileName: string): Promise<Uri | undefined> {
		const folders = workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return undefined;
		}
		const direct = Uri.joinPath(folders[0].uri, fileName);
		try {
			await workspace.fs.stat(direct);
			return direct;
		} catch {
			// Fall back to a bounded workspace search for nested architecture roots.
		}
		const matches = await workspace.findFiles(`**/${fileName}`, '**/.terraform/**', 5);
		return matches[0];
	}

	dispose(): void {
		this.documents.clear();
		this.registration.dispose();
		this.changeEmitter.dispose();
	}
}
