/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';
import { FileCode2, Save, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { HostDraftSaveError, HostSaveAllPreview } from './webviewBridge.ts';
import { describeMerge } from './draftSaveMerge.ts';

export interface SaveAllDialogProps {
	readonly open: boolean;
	/** The files the canvas changed, in the order they were sent. */
	readonly fileNames: readonly string[];
	readonly busy: boolean;
	readonly preview: HostSaveAllPreview | null;
	readonly error: HostDraftSaveError | null;
	readonly onRefreshPreview: () => void;
	/** Opens the single-file save for one file, for a closer look or a different target. */
	readonly onReviewFile: (fileName: string) => void;
	readonly onApply: () => void;
	readonly onClose: () => void;
}

/**
 * Saves every Terraform file the canvas changed in one step. Rust merges each file into the file
 * on disk (focused, three-way) and holds the results under one preview token; Apply writes them
 * all, or none if the source changed meanwhile.
 */
export function SaveAllDialog({ open, fileNames, busy, preview, error, onRefreshPreview, onReviewFile, onApply, onClose }: SaveAllDialogProps) {
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

	const changed = preview?.files.filter(file => file.changed) ?? [];
	const findings = preview?.files.reduce((count, file) => count + file.findings.length, 0) ?? 0;

	return (
		<dialog
			ref={dialog}
			className="draft-save-dialog save-all-dialog"
			aria-labelledby="save-all-title"
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<header className="draft-save-header">
				<div>
					<h2 id="save-all-title">Save canvas changes</h2>
					<p>{fileNames.length} Terraform files changed on the canvas. Each is merged into the file on disk; comments and fields the canvas does not show are kept.</p>
				</div>
				<button type="button" className="quiet-button" aria-label="Close save preview" onClick={onClose}>
					<X size={16} />
				</button>
			</header>
			<div className="draft-save-body">
				{error && (
					<div className="draft-save-alert is-error" role="alert">
						<TriangleAlert size={15} />
						<div>
							<strong>{error.code}</strong>
							<span>{error.message}</span>
						</div>
					</div>
				)}
				{!preview && !error && <p className="save-all-pending">{busy ? 'Merging the changed files…' : 'No preview yet.'}</p>}
				{preview && (
					<>
						<div className="draft-save-metrics">
							<span><ShieldCheck size={14} /> {changed.length} of {preview.files.length} files change</span>
							{findings > 0 && <span><TriangleAlert size={14} /> {findings} finding(s)</span>}
							<code>rev {preview.sourceRevision.slice(0, 8)}</code>
						</div>
						<ul className="save-all-files" aria-label="Files this save writes">
							{preview.files.map(file => (
								<li key={file.fileName} className={file.changed ? '' : 'is-unchanged'}>
									<div className="save-all-file-head">
										<FileCode2 size={14} />
										<strong>{file.fileName}</strong>
										<span>{!file.changed ? 'no change' : file.created ? 'new file' : `+${file.addedLines} / -${file.removedLines} lines`}</span>
										<button type="button" className="quiet-button" disabled={busy} onClick={() => onReviewFile(file.fileName)}>Review</button>
									</div>
									{file.merge && file.changed && (
										<ul className="draft-save-merge">
											{describeMerge(file.merge).map(line => <li key={line}>{line}</li>)}
										</ul>
									)}
									{file.findings.length > 0 && (
										<ul className="draft-save-findings">
											{file.findings.map((finding, index) => (
												<li key={`${finding.code}-${index}`}>
													<TriangleAlert size={13} />
													<span><code>{finding.code}</code> {finding.file}{finding.line ? `:${finding.line}` : ''}</span>
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ul>
					</>
				)}
			</div>
			<footer className="draft-save-footer">
				<button type="button" className="quiet-button" disabled={busy} onClick={onRefreshPreview}>Preview again</button>
				<button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
				<button type="button" className="primary-button" disabled={busy || !preview || changed.length === 0} onClick={onApply}>
					<Save size={14} />
					<span>{busy ? 'Saving…' : `Save ${changed.length} file${changed.length === 1 ? '' : 's'}`}</span>
				</button>
			</footer>
		</dialog>
	);
}
