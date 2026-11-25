/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';
import { ShieldCheck, TriangleAlert, X, Save } from 'lucide-react';
import type { HostDraftSaveError, HostDraftSavePreview } from './webviewBridge.ts';

export interface DraftSaveDialogProps {
	readonly open: boolean;
	readonly fileName: string;
	readonly contents: string;
	readonly busy: boolean;
	readonly preview: HostDraftSavePreview | null;
	readonly error: HostDraftSaveError | null;
	readonly onFileNameChange: (fileName: string) => void;
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
	contents,
	busy,
	preview,
	error,
	onFileNameChange,
	onRefreshPreview,
	onApply,
	onClose,
}: DraftSaveDialogProps) {
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const element = dialog.current;
		if (!open) {
			element?.close();
			return;
		}
		const previous = document.activeElement as HTMLElement | null;
		element?.showModal();
		return () => {
			element?.close();
			previous?.focus();
		};
	}, [open]);

	return (
		<dialog
			ref={dialog}
			className="draft-save-dialog"
			aria-labelledby="draft-save-title"
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<header className="draft-save-header">
				<div>
					<h2 id="draft-save-title">Guarded Terraform Save</h2>
					<p>Rust previews the exact file delta before any workspace write occurs.</p>
				</div>
				<button type="button" className="quiet-button" aria-label="Close save preview" onClick={onClose}>
					<X size={16} />
				</button>
			</header>
			<div className="draft-save-body">
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
						{preview.findings.length > 0 && (
							<ul className="draft-save-findings">
								{preview.findings.map((finding, index) => (
									<li key={`${finding.code}-${index}`}>
										<TriangleAlert size={13} />
										<span><code>{finding.code}</code> {finding.file}{finding.line ? `:${finding.line}` : ''}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				<details className="draft-save-hcl" open>
					<summary>Generated Terraform ({contents.split('\n').length} lines)</summary>
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
					<span>{busy ? 'Applying…' : 'Apply Save'}</span>
				</button>
			</footer>
		</dialog>
	);
}
