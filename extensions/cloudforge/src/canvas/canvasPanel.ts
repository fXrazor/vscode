/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { l10n, Uri, ViewColumn, window, type Disposable, type ExtensionContext, type Webview, type WebviewPanel } from 'vscode';
import {
	defaultCanvasViewState,
	parseWebviewMessage,
	sanitizeViewState,
	type CanvasCatalogueSnapshot,
	type CanvasGraphSnapshot,
	type CanvasNotice,
	type CanvasViewState,
	type DraftSaveApplyResult,
	type DraftSaveError,
	type DraftSavePreviewResult,
	type ExtensionToWebviewMessage
} from './protocol';
import type { FormSchema } from './schemaForm';
import type { ValidationRun } from './validationRunner';

const VIEW_STATE_KEY = 'cloudforge.canvasViewStates';
const MAX_STORED_ARCHITECTURES = 32;

export interface CanvasPanelHost {
	onSelectNode(nodeId: string | null): void;
	onOpenSource(workspaceId: string, architectureId: string, sourceRevision: string, nodeId: string): Promise<string | undefined>;
	onRefresh(workspaceId: string, architectureId: string): Promise<void>;
	onRequestValidation?(
		graph: CanvasGraphSnapshot,
		scope: 'architecture' | 'resource',
		nodeId: string | undefined,
		onUpdate: (run: ValidationRun) => void
	): Promise<{ readonly handled: boolean; readonly errorCode?: string }>;
	onCancelValidation?(): Promise<void>;
	onPreviewDraftSave?(
		workspaceId: string,
		architectureId: string,
		expectedSourceRevision: string,
		fileName: string,
		contents: string
	): Promise<{ readonly ok: true; readonly preview: DraftSavePreviewResult } | { readonly ok: false; readonly error: DraftSaveError }>;
	onApplyDraftSave?(
		workspaceId: string,
		architectureId: string,
		expectedSourceRevision: string,
		fileName: string,
		contents: string,
		previewToken: string
	): Promise<{ readonly ok: true; readonly applied: DraftSaveApplyResult } | { readonly ok: false; readonly error: DraftSaveError }>;
	onLoadCatalogueSnapshots?(): Promise<readonly CanvasCatalogueSnapshot[]>;
	onLoadResourceSchema?(kind: 'resource' | 'dataSource', typeName: string): Promise<FormSchema | null>;
}

/**
 * Manages the single read-only Architecture Canvas Webview panel per window.
 * Security boundary: receives only sanitized `ArchitectureGraph` snapshots and forwards only
 * validated opaque node IDs to `_cloudforge.openSource` and refresh callbacks.
 */
export class CloudForgeCanvasPanel implements Disposable {
	private panel: WebviewPanel | undefined;
	private ready = false;
	private graph: CanvasGraphSnapshot | undefined;
	private notice: CanvasNotice | null = null;
	private pendingValidation: { readonly scope: 'architecture' | 'resource'; readonly nodeId?: string } | undefined;
	private readonly disposables: Disposable[] = [];

	constructor(
		private readonly context: ExtensionContext,
		private readonly host: CanvasPanelHost
	) { }

	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	/** Opens or reveals the Architecture Canvas editor tab and shows the current graph. */
	show(graph: CanvasGraphSnapshot | undefined, preserveFocus: boolean): void {
		this.graph = graph;
		this.notice = null;
		const panel = this.ensurePanel(preserveFocus);
		panel.title = graph ? l10n.t('CloudForge: {0}', graph.architectureName) : l10n.t('CloudForge Canvas');
		if (this.ready) {
			this.postCurrentState();
		}
	}

	/** Updates the open canvas without forcing it open if the user closed the tab. */
	updateIfOpen(graph: CanvasGraphSnapshot | undefined): void {
		this.graph = graph;
		this.notice = null;
		if (!this.panel) {
			return;
		}
		this.panel.title = graph ? l10n.t('CloudForge: {0}', graph.architectureName) : l10n.t('CloudForge Canvas');
		if (this.ready) {
			this.postCurrentState();
		}
	}

	/** Mirrors a selection from the native `CloudForge Graph` tree into the canvas. */
	selectNode(nodeId: string | null): void {
		if (!this.panel || !this.ready) {
			return;
		}
		this.post({ type: 'selectNode', nodeId });
	}

	/** Displays a stale, unavailable, or coverage notice inside the open canvas. */
	setNotice(notice: CanvasNotice | null): void {
		this.notice = notice;
		if (!this.panel || !this.ready) {
			return;
		}
		this.post({ type: 'notice', notice });
	}

	/** Triggers a validation run inside the Architecture Canvas Webview. */
	triggerValidation(graph: CanvasGraphSnapshot | undefined, scope: 'architecture' | 'resource' = 'architecture', nodeId?: string): void {
		if (!this.panel) {
			this.show(graph, false);
		} else {
			this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, false);
		}
		if (this.ready) {
			this.post({ type: 'runValidation', scope, ...(nodeId ? { nodeId } : {}) });
		} else {
			this.pendingValidation = { scope, ...(nodeId ? { nodeId } : {}) };
		}
	}

	/** Cancels the active validation run in both the Rust service and the Architecture Canvas Webview. */
	cancelValidation(): void {
		this.pendingValidation = undefined;
		void this.host.onCancelValidation?.();
		if (!this.panel || !this.ready) {
			return;
		}
		this.post({ type: 'cancelValidation' });
	}

	private ensurePanel(preserveFocus: boolean): WebviewPanel {
		if (this.panel) {
			this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, preserveFocus);
			return this.panel;
		}
		const mediaRoot = Uri.joinPath(this.context.extensionUri, 'media');
		const panel = window.createWebviewPanel(
			'cloudforge.architectureCanvas',
			l10n.t('CloudForge Canvas'),
			{ viewColumn: ViewColumn.One, preserveFocus },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [mediaRoot],
			}
		);
		this.panel = panel;
		this.ready = false;
		panel.webview.html = this.buildHtml(panel.webview);

		const messageListener = panel.webview.onDidReceiveMessage(raw => {
			void this.handleMessage(raw);
		});
		const disposeListener = panel.onDidDispose(() => {
			messageListener.dispose();
			disposeListener.dispose();
			if (this.panel === panel) {
				this.panel = undefined;
				this.ready = false;
				this.pendingValidation = undefined;
				void this.host.onCancelValidation?.();
			}
		});
		return panel;
	}

	private async handleMessage(raw: unknown): Promise<void> {
		const message = parseWebviewMessage(raw);
		if (!message) {
			return;
		}
		switch (message.type) {
			case 'ready':
				this.ready = true;
				this.postCurrentState();
				if (this.host.onLoadCatalogueSnapshots) {
					void this.host.onLoadCatalogueSnapshots().then(snapshots => {
						if (this.ready && snapshots.length > 0) {
							this.post({ type: 'catalogueSnapshots', snapshots });
						}
					});
				}
				if (this.pendingValidation) {
					const pending = this.pendingValidation;
					this.pendingValidation = undefined;
					this.post({ type: 'runValidation', scope: pending.scope, ...(pending.nodeId ? { nodeId: pending.nodeId } : {}) });
				}
				return;
			case 'selectNode':
				this.host.onSelectNode(message.nodeId);
				return;
			case 'viewState':
				if (this.graph) {
					await this.saveViewState(this.graph.architectureId, message.state);
				}
				return;
			case 'refresh':
				if (this.graph) {
					await this.host.onRefresh(this.graph.workspaceId, this.graph.architectureId);
				}
				return;
			case 'requestValidation': {
				const graph = this.graph;
				if (!graph) {
					return;
				}
				if (!this.host.onRequestValidation) {
					this.post({ type: 'runValidation', scope: message.scope, ...(message.nodeId ? { nodeId: message.nodeId } : {}), localOnly: true });
					return;
				}
				const outcome = await this.host.onRequestValidation(graph, message.scope, message.nodeId, run => {
					if (this.panel && this.ready) {
						this.post({ type: 'validationRunUpdate', run });
					}
				});
				if (outcome.errorCode === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('The Terraform source changed on disk. Refresh the graph before running validation.'),
					});
				} else if (outcome.errorCode === 'WORKSPACE_UNAVAILABLE' || outcome.errorCode === 'SCOPE_DENIED') {
					this.setNotice({
						kind: 'unavailable',
						message: l10n.t('This architecture scope is no longer active. Reopen or refresh the project to validate it.'),
					});
				} else if (!outcome.handled) {
					this.post({ type: 'runValidation', scope: message.scope, ...(message.nodeId ? { nodeId: message.nodeId } : {}), localOnly: true });
				}
				return;
			}
			case 'cancelValidation':
				await this.host.onCancelValidation?.();
				return;
			case 'requestDraftSavePreview': {
				const graph = this.graph;
				if (!graph || !this.host.onPreviewDraftSave) {
					this.post({
						type: 'draftSavePreview',
						result: { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: l10n.t('Guarded draft save is not available in this window.') } },
					});
					return;
				}
				const result = await this.host.onPreviewDraftSave(
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision,
					message.fileName,
					message.contents
				);
				if (!result.ok && result.error.code === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('The Terraform source changed on disk. Refresh the graph before previewing or saving.'),
					});
				}
				this.post({ type: 'draftSavePreview', result });
				return;
			}
			case 'applyDraftSave': {
				const graph = this.graph;
				if (!graph || !this.host.onApplyDraftSave) {
					this.post({
						type: 'draftSaveApplied',
						result: { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: l10n.t('Guarded draft save is not available in this window.') } },
					});
					return;
				}
				const result = await this.host.onApplyDraftSave(
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision,
					message.fileName,
					message.contents,
					message.previewToken
				);
				if (!result.ok && result.error.code === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('The Terraform source changed on disk. Refresh the graph before applying changes.'),
					});
				}
				this.post({ type: 'draftSaveApplied', result });
				return;
			}
			case 'requestSchema': {
				if (!this.host.onLoadResourceSchema) {
					this.post({ type: 'liveSchema', typeName: message.typeName, schema: null });
					return;
				}
				const schema = await this.host.onLoadResourceSchema(message.kind, message.typeName);
				if (this.panel && this.ready) {
					this.post({ type: 'liveSchema', typeName: message.typeName, schema });
				}
				return;
			}
			case 'openSource': {
				const graph = this.graph;
				if (!graph) {
					return;
				}
				const errorCode = await this.host.onOpenSource(graph.workspaceId, graph.architectureId, graph.sourceRevision, message.nodeId);
				if (errorCode === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('The Terraform source changed or has unsaved edits. Save and refresh the graph before opening source.'),
					});
				} else if (errorCode === 'WORKSPACE_UNAVAILABLE' || errorCode === 'SCOPE_DENIED') {
					this.setNotice({
						kind: 'unavailable',
						message: l10n.t('This architecture scope is no longer active. Reopen or refresh the project to inspect it.'),
					});
				}
				return;
			}
		}
	}

	private postCurrentState(): void {
		if (!this.graph) {
			this.post({
				type: 'empty',
				message: l10n.t('Select an architecture in CloudForge Project or run CloudForge: Open Workspace to inspect its infrastructure graph.'),
			});
			return;
		}
		const saved = this.loadViewState(this.graph.architectureId);
		const validSelection = saved.selectedId && this.graph.nodes.some(node => node.id === saved.selectedId)
			? saved.selectedId
			: null;
		const viewState: CanvasViewState = {
			...saved,
			selectedId: validSelection,
			focusedWorkspaceOpen: validSelection !== null && saved.focusedWorkspaceOpen,
		};
		this.post({
			type: 'graph',
			graph: this.graph,
			viewState,
			notice: this.notice,
		});
	}

	private post(message: ExtensionToWebviewMessage): void {
		void this.panel?.webview.postMessage(message);
	}

	private loadViewState(architectureId: string): CanvasViewState {
		const map = this.context.workspaceState.get<Record<string, unknown>>(VIEW_STATE_KEY, {});
		return sanitizeViewState(map[architectureId]);
	}

	private async saveViewState(architectureId: string, state: CanvasViewState): Promise<void> {
		const current = { ...this.context.workspaceState.get<Record<string, CanvasViewState>>(VIEW_STATE_KEY, {}) };
		delete current[architectureId];
		current[architectureId] = state;
		const keys = Object.keys(current);
		while (keys.length > MAX_STORED_ARCHITECTURES) {
			const oldest = keys.shift();
			if (oldest) {
				delete current[oldest];
			}
		}
		await this.context.workspaceState.update(VIEW_STATE_KEY, current);
	}

	private buildHtml(webview: Webview): string {
		const nonce = randomBytes(16).toString('base64');
		const scriptUri = webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'media', 'canvas.js'));
		const styleUri = webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'media', 'canvas-style.css'));
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`img-src ${webview.cspSource} data:`,
		].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>CloudForge Architecture Canvas</title>
	<link rel="stylesheet" href="${styleUri}">
</head>
<body>
	<div id="app" class="cf-app" data-theme="workbench" data-mode="visual"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
		for (const item of this.disposables) {
			item.dispose();
		}
	}
}

export { defaultCanvasViewState };
