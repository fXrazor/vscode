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
	type CanvasGraphSnapshot,
	type CanvasNotice,
	type CanvasViewState,
	type ExtensionToWebviewMessage
} from './protocol';

const VIEW_STATE_KEY = 'cloudforge.canvasViewStates';
const MAX_STORED_ARCHITECTURES = 32;

export interface CanvasPanelHost {
	onSelectNode(nodeId: string | null): void;
	onOpenSource(workspaceId: string, architectureId: string, sourceRevision: string, nodeId: string): Promise<string | undefined>;
	onRefresh(workspaceId: string, architectureId: string): Promise<void>;
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
