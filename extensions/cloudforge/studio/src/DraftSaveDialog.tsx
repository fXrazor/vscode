/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';
import { ShieldCheck, TriangleAlert, X, Save } from 'lucide-react';
import type { HostDraftSaveError, HostDraftSaveMerge, HostDraftSavePreview } from './webviewBridge.ts';
import { describeMerge, describeSaveFinding } from './draftSaveMerge.ts';

export interface DraftSaveDialogProps {
	readonly open: boolean;
	readonly fileName: string;
	readonly projectFiles?: readonly string[];
	readonly contents: string;
	readonly busy: boolean;
	readonly preview: HostDraftSavePreview | null;
	readonly error: HostDraftSaveError | null;
	readonly onFileNameChange: (fileName: string) => void;
	readonly onSelectProjectFile?: (fileName: string) => void;
	readonly onRefreshPreview: () => void;
	readonly onApply: () => void;
	readonly onClose: () => void;
}

/**
 * Two-step Rust guarded save confirmation modal (`requestDraftSavePreview` -> `applyDraftSave`).
 * Never writes directly; requires an active `previewToken` from the Rust service.
 */
export function DraftSaveDialog({
	open,
	fileName,
	projectFiles,
	contents,
	busy,
	preview,
	error,
	onFileNameChange,
	onSelectProjectFile,
	onRefreshPreview,
	onApply,
	onClose,
}: DraftSaveDialogProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const backdropPress = useRef(false);

	useEffect(() => {
		const element = dialog.current;
		if (!open) {
			element?.close();
			return;
		}
		const previous = document.activeElement as HTMLElement | null;
		backdropPress.current = false;
		element?.showModal();
		return () => {
			element?.close();
			previous?.focus();
		};
	}, [open]);

	function outsideDialog(x: number, y: number) {
		const bounds = dialog.current?.getBoundingClientRect();
		return !!bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);
	}

	return (
		<dialog
			ref={dialog}
			className="draft-save-dialog"
			aria-labelledby="draft-save-title"
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
			onPointerDown={event => {
				backdropPress.current = event.button === 0 && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY);
			}}
			onPointerUp={event => {
				const dismiss = backdropPress.current && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY);
				backdropPress.current = false;
				if (dismiss) {
					onClose();
				}
			}}
			onPointerCancel={() => {
				backdropPress.current = false;
			}}
		>
			<header className="draft-save-header">
				<div>
					<h2 id="draft-save-title">Save Terraform file</h2>
					<p>CloudForge previews the exact file changes before writing to your workspace.</p>
				</div>
				<button type="button" className="quiet-button" aria-label="Close save preview" onClick={onClose}>
					<X size={16} />
				</button>
			</header>
			<div className="draft-save-body">
				{projectFiles && projectFiles.length > 0 && (
					<div className="draft-save-project-files" role="group" aria-label="Corresponding project Terraform files">
						<span>Project Terraform files</span>
						<div>
							{projectFiles.map(file => (
								<button
									key={file}
									type="button"
									className={'quiet-button' + (file === fileName ? ' is-selected' : '')}
									disabled={busy}
									onClick={() => onSelectProjectFile ? onSelectProjectFile(file) : onFileNameChange(file)}
								>
									{file}
								</button>
							))}
						</div>
					</div>
				)}
				<label className="draft-save-filename">
					<span>Target Terraform file</span>
					<div className="draft-save-filename-row">
						<input
							aria-label="Target Terraform file name"
							value={fileName}
							disabled={busy}
							onChange={event => onFileNameChange(event.target.value)}
						/>
						<button type="button" className="quiet-button" disabled={busy} onClick={onRefreshPreview}>
							Preview diff
						</button>
					</div>
				</label>

				{error && (
					<div className="draft-save-alert is-error" role="alert">
						<TriangleAlert size={15} />
						<div>
							<strong>{error.code}</strong>
							<span>{error.message}</span>
						</div>
					</div>
				)}

				{preview && (
					<div className="draft-save-preview-summary">
						<div className="draft-save-metrics">
							<span><ShieldCheck size={14} /> {preview.created ? 'New file' : 'Update existing file'}</span>
							<span>+{preview.addedLines} / -{preview.removedLines} lines</span>
							<code>rev {preview.sourceRevision.slice(0, 8)}</code>
						</div>
						{preview.merge && <MergeSummary merge={preview.merge} />}
						{preview.findings.length > 0 && (
							<ul className="draft-save-findings">
								{preview.findings.map((finding, index) => (
									<li key={`${finding.code}-${index}`}>
										<TriangleAlert size={13} />
										<span><strong>{describeSaveFinding(finding.code)}</strong> · <code>{finding.file}{finding.line ? `:${finding.line}` : ''}</code></span>
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				<details className="draft-save-hcl" open={!preview?.merge}>
					<summary>{preview?.merge ? 'Canvas Terraform (merged into the file, not written as is)' : 'Generated Terraform'} ({contents.split('\n').length} lines)</summary>
					<pre><code>{contents}</code></pre>
				</details>
			</div>
			<footer className="draft-save-footer">
				<button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
				<button
					type="button"
					className="primary-button"
					disabled={busy || !preview || preview.fileName !== fileName}
					onClick={onApply}
				>
					<Save size={14} />
					<span>{busy ? 'Saving…' : 'Save file'}</span>
				</button>
			</footer>
		</dialog>
	);
}

function MergeSummary({ merge }: { readonly merge: HostDraftSaveMerge }) {
	return (
		<ul className="draft-save-merge" aria-label="What this save changes">
			{describeMerge(merge).map(line => <li key={line}>{line}</li>)}
		</ul>
	);
}
