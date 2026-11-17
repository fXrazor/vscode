/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Diagnostic, DiagnosticSeverity, languages, Range, Uri, type Disposable, type Memento } from 'vscode';
import { findingDescription, type Finding } from './model';

const FLAGGED_FILES_KEY = 'cloudforge.flaggedFiles';
const MAX_FLAGGED_FILES = 2000;

/**
 * Publishes secret findings to Problems (D9). A finding names a file and line only; values are
 * never received, shown, or logged. The flagged file list is kept for CloudForge's own AI features
 * to exclude; other agents in the window have their own file access.
 */
export class SecretFindings implements Disposable {
	private readonly diagnostics = languages.createDiagnosticCollection('cloudforge-secrets');

	constructor(private readonly state: Memento) { }

	show(repositoryFolder: Uri, findings: readonly Finding[]): void {
		const byFile = new Map<string, Diagnostic[]>();
		for (const finding of findings) {
			if (finding.code === 'PROVIDER_CACHE') {
				// A folder, not a file: reported in the import summary instead.
				continue;
			}
			const line = Math.max(0, (finding.line ?? 1) - 1);
			const message = findingDescription(finding.code);
			const diagnostic = new Diagnostic(new Range(line, 0, line, Number.MAX_SAFE_INTEGER), message, DiagnosticSeverity.Warning);
			diagnostic.source = 'CloudForge';
			diagnostic.code = finding.code;
			const uri = Uri.joinPath(repositoryFolder, ...finding.file.split('/')).toString();
			byFile.set(uri, [...(byFile.get(uri) ?? []), diagnostic]);
		}
		for (const [uri, diagnostics] of byFile) {
			this.diagnostics.set(Uri.parse(uri), diagnostics);
		}
		const flagged = new Set(this.state.get<string[]>(FLAGGED_FILES_KEY, []));
		for (const finding of findings) {
			flagged.add(Uri.joinPath(repositoryFolder, ...finding.file.split('/')).toString());
		}
		void this.state.update(FLAGGED_FILES_KEY, [...flagged].slice(-MAX_FLAGGED_FILES));
	}

	/** Files CloudForge's own AI features must not read. */
	flaggedFiles(): readonly string[] {
		return this.state.get<string[]>(FLAGGED_FILES_KEY, []);
	}

	dispose(): void {
		this.diagnostics.dispose();
	}
}
