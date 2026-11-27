/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { l10n, Uri, ViewColumn, window, workspace, type Disposable, type ExtensionContext, type Webview, type WebviewPanel } from 'vscode';
import { buildStudioUnavailableHtml, buildStudioWebviewHtml } from './canvasEngine';
import {
	defaultCanvasViewState,
	parseWebviewMessage,
	sanitizeViewState,
	type CanvasCatalogueSnapshot,
	type CanvasCatalogueTypes,
	type CanvasSchemaPreview,
	type CanvasCloudRegionsPayload,
	type CanvasDependencyReport,
	type CanvasDetectedEngine,
	type CanvasEngineInitOfflineReport,
	type CanvasEnginePlanReport,
	type CanvasEngineValidateReport,
	type CanvasExportAuditReport,
	type CanvasGraphSnapshot,
	type CanvasModuleInspection,
	type CanvasNotice,
	type CanvasOfflineMirrorReadiness,
	type CanvasSchemaDiffReport,
	type CanvasViewState,
	type DraftSaveApplyResult,
	type DraftSaveError,
	type DraftSavePreviewResult,
	type SaveAllApplyResult,
	type SaveAllFile,
	type SaveAllPreviewResult,
	type ExportFormat,
	type ExtensionToWebviewMessage
} from './protocol';
import type { FormSchema } from './schemaForm';
import type { ValidationRun } from './validationRunner';

const VIEW_STATE_KEY = 'cloudforge.canvasViewStates';
const MAX_STORED_ARCHITECTURES = 32;

export interface CanvasPanelHost {
	onSelectNode(nodeId: string | null): void;
	onOpenSource(workspaceId: string, architectureId: string, sourceRevision: string, nodeId: string): Promise<string | undefined>;
	/** Opens a diagnostic's file and line; `sourceRevision` is the revision the check ran against. */
	onOpenSourceLocation?(workspaceId: string, architectureId: string, sourceRevision: string, fileName: string, line?: number, column?: number): Promise<string | undefined>;
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
		contents: string,
		removeAddresses?: readonly string[],
		renames?: readonly { readonly from: string; readonly to: string }[],
		baseContents?: string
	): Promise<{ readonly ok: true; readonly preview: DraftSavePreviewResult } | { readonly ok: false; readonly error: DraftSaveError }>;
	onApplyDraftSave?(
		workspaceId: string,
		architectureId: string,
		expectedSourceRevision: string,
		fileName: string,
		contents: string,
		previewToken: string
	): Promise<{ readonly ok: true; readonly applied: DraftSaveApplyResult; readonly refreshedGraph?: CanvasGraphSnapshot; readonly notice?: CanvasNotice } | { readonly ok: false; readonly error: DraftSaveError }>;
	/** Merges several canvas files into the files on disk under one token (`previewFocusedSaveBatch`). */
	onPreviewSaveAll?(
		workspaceId: string,
		architectureId: string,
		expectedSourceRevision: string,
		files: readonly SaveAllFile[]
	): Promise<{ readonly ok: true; readonly preview: SaveAllPreviewResult } | { readonly ok: false; readonly error: DraftSaveError }>;
	onApplySaveAll?(
		workspaceId: string,
		architectureId: string,
		expectedSourceRevision: string,
		previewToken: string
	): Promise<{ readonly ok: true; readonly applied: SaveAllApplyResult; readonly refreshedGraph?: CanvasGraphSnapshot; readonly notice?: CanvasNotice } | { readonly ok: false; readonly error: DraftSaveError }>;
	onLoadCatalogueSnapshots?(): Promise<readonly CanvasCatalogueSnapshot[]>;
	/** Resource types of the newest imported snapshot per palette provider. */
	onLoadCatalogueTypes?(): Promise<readonly CanvasCatalogueTypes[]>;
	onLoadResourceSchema?(kind: 'resource' | 'dataSource', typeName: string): Promise<FormSchema | null>;
	/** Attribute values written in the architecture's files (Rust `readResourceValues`). */
	onReadResourceValues?(workspaceId: string, architectureId: string, sourceRevision: string): Promise<unknown>;
	/** Renders and checks one canvas resource against its pinned provider schema in Rust. */
	onRenderResourceDraft?(resourceId: string, draft: Readonly<Record<string, unknown>>): Promise<CanvasSchemaPreview | null>;
	onLoadCloudRegions?(provider: 'azure' | 'aws' | 'google'): Promise<CanvasCloudRegionsPayload | undefined>;
	onInspectDependencies?(workspaceId: string, architectureId: string, sourceRevision: string): Promise<CanvasDependencyReport | undefined>;
	onReadModule?(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		modulePath: readonly string[]
	): Promise<{ readonly ok: true; readonly inspection: CanvasModuleInspection } | { readonly ok: false; readonly message: string }>;
	onAuditExportReadiness?(workspaceId: string, architectureId: string, sourceRevision: string): Promise<CanvasExportAuditReport | undefined>;
	onDiffCatalogueSnapshots?(
		fromKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string },
		toKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string },
		workspaceId: string,
		architectureId: string,
		sourceRevision: string
	): Promise<{ readonly ok: true; readonly report: CanvasSchemaDiffReport } | { readonly ok: false; readonly message: string }>;
	onDetectEngines?(): Promise<readonly CanvasDetectedEngine[]>;
	onRunEngineValidate?(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	): Promise<{ readonly ok: true; readonly report: CanvasEngineValidateReport } | { readonly ok: false; readonly message: string }>;
	onRunEnginePlan?(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	): Promise<{ readonly ok: true; readonly report: CanvasEnginePlanReport } | { readonly ok: false; readonly message: string }>;
	onCheckOfflineMirrorReadiness?(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string
	): Promise<CanvasOfflineMirrorReadiness | undefined>;
	onRunEngineInitOffline?(
		workspaceId: string,
		architectureId: string,
		sourceRevision: string,
		engine?: 'openTofu' | 'terraform'
	): Promise<{ readonly ok: true; readonly report: CanvasEngineInitOfflineReport } | { readonly ok: false; readonly message: string }>;
	onExportArtifact?(
		format: ExportFormat,
		suggestedFileName: string,
		content: string,
		encoding: 'utf8' | 'base64'
	): Promise<{ readonly ok: boolean; readonly message: string }>;
	onUseTemplateAsArchitecture?(templateId: string): Promise<void>;
	onToggleFocusMode?(active?: boolean): Promise<boolean>;
	isFocusModeActive?(): boolean;
}

/**
 * Manages the single read-only Architecture Canvas Webview panel per window.
 * Security boundary: receives only sanitized `ArchitectureGraph` snapshots and forwards only
 * validated opaque node IDs to `_cloudforge.openSource` and refresh callbacks.
 */
export class CloudForgeCanvasPanel implements Disposable {
	private panel: WebviewPanel | undefined;
	private ready = false;
	private readonly pendingBundleLayouts = new Map<string, unknown>();
	private showSequence = 0;
	private graph: CanvasGraphSnapshot | undefined;
	private readonly schemaRequests = new Map<string, number>();
	private readonly draftRequests = new Map<string, number>();
	private notice: CanvasNotice | null = null;
	private pendingValidation: { readonly scope: 'architecture' | 'resource'; readonly nodeId?: string } | undefined;
	private pendingSelectNodeId: string | undefined;
	private pendingOpenExport = false;
	private pendingOpenTemplates = false;
	private readonly disposables: Disposable[] = [];

	constructor(
		private readonly context: ExtensionContext,
		private readonly host: CanvasPanelHost
	) { }

	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	private async hasStudioAssets(): Promise<boolean> {
		const studioRoot = Uri.joinPath(this.context.extensionUri, 'media', 'studio');
		try {
			await Promise.all([
				workspace.fs.stat(Uri.joinPath(studioRoot, 'studio.js')),
				workspace.fs.stat(Uri.joinPath(studioRoot, 'studio.css')),
			]);
			return true;
		} catch {
			return false;
		}
	}

	private panelTitle(graph: CanvasGraphSnapshot | undefined): string {
		return graph ? l10n.t('CloudForge: {0}', graph.architectureName) : l10n.t('CloudForge Canvas');
	}

	/** Opens or reveals the Architecture Canvas editor tab and shows the current graph. */
	show(graph: CanvasGraphSnapshot | undefined, preserveFocus: boolean): void {
		this.graph = graph;
		this.notice = null;
		const sequence = ++this.showSequence;
		void this.hasStudioAssets().then(available => {
			if (sequence !== this.showSequence) {
				return;
			}
			const panel = this.ensurePanel(preserveFocus, available);
			panel.title = this.panelTitle(this.graph);
			if (this.ready) {
				this.postCurrentState();
			}
		});
	}

	/** Updates the open canvas without forcing it open if the user closed the tab. */
	/** Re-sends imported-schema palette types, for example after a provider schema import. */
	refreshCatalogueTypes(): void {
		if (!this.panel || !this.ready || !this.host.onLoadCatalogueTypes) {
			return;
		}
		void this.host.onLoadCatalogueTypes().then(list => {
			for (const types of list) {
				if (this.ready) {
					this.post({ type: 'catalogueTypes', types });
				}
			}
		}).catch(() => { });
	}

	updateIfOpen(graph: CanvasGraphSnapshot | undefined): void {
		this.graph = graph;
		this.notice = null;
		if (!this.panel) {
			return;
		}
		this.panel.title = this.panelTitle(graph);
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

	/** Opens or reveals the Architecture Canvas and selects a specific resource node. */
	revealNode(graph: CanvasGraphSnapshot | undefined, nodeId: string): void {
		if (!this.panel) {
			this.pendingSelectNodeId = nodeId;
			this.show(graph, false);
			return;
		}
		if (graph) {
			this.graph = graph;
			this.panel.title = this.panelTitle(graph);
		}
		this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, false);
		if (this.ready) {
			this.post({ type: 'selectNode', nodeId });
		} else {
			this.pendingSelectNodeId = nodeId;
		}
	}

	/** Displays a stale, unavailable, or coverage notice inside the open canvas. */
	setNotice(notice: CanvasNotice | null): void {
		this.notice = notice;
		if (!this.panel || !this.ready) {
			return;
		}
		this.post({ type: 'notice', notice });
	}

	/** Synchronizes Canvas Focus Mode state into the open canvas topbar. */
	setFocusMode(active: boolean): void {
		if (!this.panel || !this.ready) {
			return;
		}
		this.post({ type: 'focusModeChanged', active });
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

	/** Opens the Architecture Canvas Export modal. */
	openExport(graph: CanvasGraphSnapshot | undefined): void {
		if (!this.panel) {
			this.show(graph, false);
		} else {
			this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, false);
		}
		if (this.ready) {
			this.post({ type: 'openExport' });
		} else {
			this.pendingOpenExport = true;
		}
	}

	/**
	 * Queues a bundle's canvas model for one architecture. It is sent with that architecture's next
	 * graph (or straight away when it is already showing), then dropped.
	 */
	seedBundleLayout(architectureId: string, architecture: unknown): void {
		this.pendingBundleLayouts.set(architectureId, architecture);
		if (this.ready && this.graph?.architectureId === architectureId) {
			this.flushBundleLayout(architectureId);
		}
	}

	private flushBundleLayout(architectureId: string): void {
		const layout = this.pendingBundleLayouts.get(architectureId);
		if (layout !== undefined) {
			this.pendingBundleLayouts.delete(architectureId);
			this.post({ type: 'applyBundleLayout', architecture: layout });
		}
	}

	/** Opens the Offline Multi-Cloud Template Library Gallery inside the Architecture Canvas. */
	openTemplates(graph: CanvasGraphSnapshot | undefined): void {
		if (!this.panel) {
			this.show(graph, false);
		} else {
			this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, false);
		}
		if (this.ready) {
			this.post({ type: 'openTemplates' });
		} else {
			this.pendingOpenTemplates = true;
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

	private ensurePanel(preserveFocus: boolean, studioAvailable: boolean): WebviewPanel {
		if (this.panel) {
			this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One, preserveFocus);
			return this.panel;
		}
		const mediaRoot = Uri.joinPath(this.context.extensionUri, 'media');
		const panel = window.createWebviewPanel(
			'cloudforge.architectureCanvas',
			this.panelTitle(this.graph),
			{ viewColumn: ViewColumn.One, preserveFocus },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [mediaRoot],
			}
		);
		this.panel = panel;
		this.ready = false;
		panel.webview.html = this.buildHtml(panel.webview, studioAvailable);

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
				this.pendingSelectNodeId = undefined;
				this.pendingOpenExport = false;
				this.pendingOpenTemplates = false;
				void this.host.onCancelValidation?.();
				if (this.host.isFocusModeActive?.()) {
					void this.host.onToggleFocusMode?.(false);
				}
			}
		});
		return panel;
	}

	private isSameGraph(graph: CanvasGraphSnapshot): boolean {
		return this.panel !== undefined
			&& this.ready
			&& this.graph?.workspaceId === graph.workspaceId
			&& this.graph?.architectureId === graph.architectureId
			&& this.graph?.sourceRevision === graph.sourceRevision;
	}

	private isSameArchitecture(graph: CanvasGraphSnapshot): boolean {
		return this.panel !== undefined
			&& this.ready
			&& this.graph?.workspaceId === graph.workspaceId
			&& this.graph?.architectureId === graph.architectureId;
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
				this.post({ type: 'focusModeChanged', active: !!this.host.isFocusModeActive?.() });
				if (this.pendingSelectNodeId) {
					const selectId = this.pendingSelectNodeId;
					this.pendingSelectNodeId = undefined;
					this.post({ type: 'selectNode', nodeId: selectId });
				}
				if (this.host.onLoadCatalogueSnapshots) {
					void this.host.onLoadCatalogueSnapshots().then(snapshots => {
						if (this.ready && snapshots.length > 0) {
							this.post({ type: 'catalogueSnapshots', snapshots });
						}
					}).catch(() => { });
				}
				if (this.host.onLoadCatalogueTypes) {
					void this.host.onLoadCatalogueTypes().then(list => {
						for (const types of list) {
							if (this.ready && types.resources.length > 0) {
								this.post({ type: 'catalogueTypes', types });
							}
						}
					}).catch(() => { });
				}
				if (this.host.onLoadCloudRegions) {
					for (const provider of ['azure', 'aws', 'google'] as const) {
						void this.host.onLoadCloudRegions(provider).then(data => {
							if (this.ready && data && data.regions.length > 0) {
								this.post({ type: 'cloudRegions', data });
							}
						}).catch(() => { });
					}
				}
				if (this.host.onDetectEngines) {
					void this.host.onDetectEngines().then(engines => {
						if (this.ready) {
							this.post({ type: 'detectedEngines', engines });
						}
					}).catch(() => { });
				}
				if (this.pendingValidation) {
					const pending = this.pendingValidation;
					this.pendingValidation = undefined;
					this.post({ type: 'runValidation', scope: pending.scope, ...(pending.nodeId ? { nodeId: pending.nodeId } : {}) });
				}
				if (this.pendingOpenExport) {
					this.pendingOpenExport = false;
					this.post({ type: 'openExport' });
				}
				if (this.pendingOpenTemplates) {
					this.pendingOpenTemplates = false;
					this.post({ type: 'openTemplates' });
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
			case 'toggleFocusMode': {
				if (this.host.onToggleFocusMode) {
					const active = await this.host.onToggleFocusMode(message.active);
					if (this.panel && this.ready) {
						this.post({ type: 'focusModeChanged', active });
					}
				}
				return;
			}
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
					if (this.isSameGraph(graph)) {
						this.post({ type: 'validationRunUpdate', run });
					}
				});
				if (!this.isSameGraph(graph)) {
					return;
				}
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
					message.contents,
					message.removeAddresses,
					message.renames,
					message.baseContents
				);
				if (!this.isSameGraph(graph)) {
					return;
				}
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
				if (!this.isSameArchitecture(graph)) {
					return;
				}
				if (!result.ok) {
					if (result.error.code === 'STALE_SOURCE') {
						this.setNotice({
							kind: 'stale',
							message: l10n.t('The Terraform source changed on disk. Refresh the graph before applying changes.'),
						});
					}
					this.post({ type: 'draftSaveApplied', result });
					return;
				}
				// Post draftSaveApplied before pushing the refreshed graph so Studio closes the
				// save dialog and records the saved files before projecting the new sourceRevision.
				this.post({ type: 'draftSaveApplied', result: { ok: true, applied: result.applied } });
				if (result.refreshedGraph) {
					this.updateIfOpen(result.refreshedGraph);
					if (result.notice) {
						this.setNotice(result.notice);
					}
				} else {
					await this.host.onRefresh(graph.workspaceId, graph.architectureId);
				}
				return;
			}
			case 'requestSaveAllPreview': {
				const graph = this.graph;
				if (!graph || !this.host.onPreviewSaveAll) {
					this.post({
						type: 'saveAllPreview',
						result: { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: l10n.t('Saving several files at once is not available in this window.') } },
					});
					return;
				}
				const result = await this.host.onPreviewSaveAll(graph.workspaceId, graph.architectureId, graph.sourceRevision, message.files);
				if (!this.isSameGraph(graph)) {
					return;
				}
				if (!result.ok && result.error.code === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('The Terraform source changed on disk. Refresh the graph before previewing or saving.'),
					});
				}
				this.post({ type: 'saveAllPreview', result });
				return;
			}
			case 'applySaveAll': {
				const graph = this.graph;
				if (!graph || !this.host.onApplySaveAll) {
					this.post({
						type: 'saveAllApplied',
						result: { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: l10n.t('Saving several files at once is not available in this window.') } },
					});
					return;
				}
				const result = await this.host.onApplySaveAll(graph.workspaceId, graph.architectureId, graph.sourceRevision, message.previewToken);
				if (!this.isSameArchitecture(graph)) {
					return;
				}
				if (!result.ok) {
					if (result.error.code === 'STALE_SOURCE') {
						this.setNotice({
							kind: 'stale',
							message: l10n.t('The Terraform source changed on disk. Refresh the graph before applying changes.'),
						});
					}
					this.post({ type: 'saveAllApplied', result });
					return;
				}
				// Post saveAllApplied before pushing the refreshed graph so Studio closes the
				// save dialog and records the saved files before projecting the new sourceRevision.
				this.post({ type: 'saveAllApplied', result: { ok: true, applied: result.applied } });
				if (result.refreshedGraph) {
					this.updateIfOpen(result.refreshedGraph);
					if (result.notice) {
						this.setNotice(result.notice);
					}
				} else {
					await this.host.onRefresh(graph.workspaceId, graph.architectureId);
				}
				return;
			}
			case 'requestSchema': {
				const graph = this.graph;
				const key = message.kind + ':' + message.typeName;
				const request = (this.schemaRequests.get(key) ?? 0) + 1;
				this.schemaRequests.set(key, request);
				if (!this.host.onLoadResourceSchema) {
					this.post({ type: 'liveSchema', typeName: message.typeName, schema: null });
					return;
				}
				const schema = await this.host.onLoadResourceSchema(message.kind, message.typeName);
				if (this.panel && this.ready && this.graph === graph && this.schemaRequests.get(key) === request) {
					this.post({ type: 'liveSchema', typeName: message.typeName, schema });
				}
				return;
			}
			case 'requestModule': {
				const graph = this.graph;
				if (!graph || !this.host.onReadModule) {
					this.post({
						type: 'moduleInspection',
						modulePath: message.modulePath,
						inspection: null,
						error: l10n.t('Module inspection is not available in this window.'),
					});
					return;
				}
				const outcome = await this.host.onReadModule(graph.workspaceId, graph.architectureId, graph.sourceRevision, message.modulePath);
				if (this.isSameGraph(graph)) {
					if (outcome.ok) {
						this.post({ type: 'moduleInspection', modulePath: message.modulePath, inspection: outcome.inspection });
					} else {
						this.post({ type: 'moduleInspection', modulePath: message.modulePath, inspection: null, error: outcome.message });
					}
				}
				return;
			}
			case 'requestSchemaDiff': {
				const graph = this.graph;
				if (!graph || !this.host.onDiffCatalogueSnapshots) {
					this.post({ type: 'schemaDiffReport', report: null, error: l10n.t('Provider schema diffing is not available in this window.') });
					return;
				}
				const outcome = await this.host.onDiffCatalogueSnapshots(
					message.fromKey,
					message.toKey,
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision
				);
				if (this.isSameGraph(graph)) {
					if (outcome.ok) {
						this.post({ type: 'schemaDiffReport', report: outcome.report });
					} else {
						this.post({ type: 'schemaDiffReport', report: null, error: outcome.message });
					}
				}
				return;
			}
			case 'requestEngineValidate': {
				const graph = this.graph;
				if (!graph || !this.host.onRunEngineValidate) {
					this.post({ type: 'engineValidateReport', report: null, error: l10n.t('Local CLI engine validation is not available in this window.') });
					return;
				}
				const outcome = await this.host.onRunEngineValidate(
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision,
					message.engine
				);
				if (this.isSameGraph(graph)) {
					if (outcome.ok) {
						this.post({ type: 'engineValidateReport', report: outcome.report });
					} else {
						this.post({ type: 'engineValidateReport', report: null, error: outcome.message });
					}
				}
				return;
			}
			case 'requestEnginePlan': {
				const graph = this.graph;
				if (!graph || !this.host.onRunEnginePlan) {
					this.post({ type: 'enginePlanReport', report: null, error: l10n.t('Local CLI plan capture is not available in this window.') });
					return;
				}
				const outcome = await this.host.onRunEnginePlan(
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision,
					message.engine
				);
				if (this.isSameGraph(graph)) {
					if (outcome.ok) {
						this.post({ type: 'enginePlanReport', report: outcome.report });
					} else {
						this.post({ type: 'enginePlanReport', report: null, error: outcome.message });
					}
				}
				return;
			}
			case 'requestEngineInitOffline': {
				const graph = this.graph;
				if (!graph || !this.host.onRunEngineInitOffline) {
					this.post({ type: 'engineInitOfflineReport', report: null, error: l10n.t('Offline mirror initialization is not available in this window.') });
					return;
				}
				const outcome = await this.host.onRunEngineInitOffline(
					graph.workspaceId,
					graph.architectureId,
					graph.sourceRevision,
					message.engine
				);
				if (this.isSameGraph(graph)) {
					if (outcome.ok) {
						this.post({ type: 'engineInitOfflineReport', report: outcome.report });
					} else {
						this.post({ type: 'engineInitOfflineReport', report: null, error: outcome.message });
					}
				}
				return;
			}
			case 'exportArtifact': {
				if (!this.host.onExportArtifact) {
					this.post({ type: 'exportResult', ok: false, message: l10n.t('Export is not available in this window.') });
					return;
				}
				const result = await this.host.onExportArtifact(
					message.format,
					message.suggestedFileName,
					message.content,
					message.encoding
				);
				if (this.panel && this.ready) {
					this.post({ type: 'exportResult', ok: result.ok, message: result.message });
				}
				return;
			}
			case 'useTemplateAsArchitecture': {
				await this.host.onUseTemplateAsArchitecture?.(message.templateId);
				return;
			}
			case 'renderResourceDraft': {
				const graph = this.graph;
				const request = (this.draftRequests.get(message.resourceId) ?? 0) + 1;
				this.draftRequests.set(message.resourceId, request);
				const preview = this.host.onRenderResourceDraft ? await this.host.onRenderResourceDraft(message.resourceId, message.draft) : null;
				if (this.panel && this.ready && this.graph === graph && this.draftRequests.get(message.resourceId) === request) {
					this.post({ type: 'resourceDraftRendered', resourceId: message.resourceId, preview });
				}
				return;
			}
			case 'openSourceLocation': {
				const graph = this.graph;
				if (!graph || !this.host.onOpenSourceLocation) {
					return;
				}
				if (this.host.isFocusModeActive?.() && this.host.onToggleFocusMode) {
					const active = await this.host.onToggleFocusMode(false);
					if (this.panel && this.ready) {
						this.post({ type: 'focusModeChanged', active });
					}
				}
				const errorCode = await this.host.onOpenSourceLocation(graph.workspaceId, graph.architectureId, message.sourceRevision, message.fileName, message.line, message.column);
				if (errorCode === 'STALE_SOURCE') {
					this.setNotice({
						kind: 'stale',
						message: l10n.t('This check ran on an earlier version of the Terraform source. Run checks again before opening its location.'),
					});
				} else if (errorCode === 'WORKSPACE_UNAVAILABLE' || errorCode === 'SCOPE_DENIED') {
					this.setNotice({
						kind: 'unavailable',
						message: l10n.t('This architecture scope is no longer active. Reopen or refresh the project to inspect it.'),
					});
				}
				return;
			}
			case 'openSource': {
				const graph = this.graph;
				if (!graph) {
					return;
				}
				if (this.host.isFocusModeActive?.() && this.host.onToggleFocusMode) {
					const active = await this.host.onToggleFocusMode(false);
					if (this.panel && this.ready) {
						this.post({ type: 'focusModeChanged', active });
					}
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
		this.flushBundleLayout(this.graph.architectureId);
		if (this.host.onReadResourceValues) {
			const snapshot = this.graph;
			void this.host.onReadResourceValues(snapshot.workspaceId, snapshot.architectureId, snapshot.sourceRevision).then(values => {
				if (values !== undefined && this.isSameGraph(snapshot)) {
					this.post({ type: 'resourceValues', sourceRevision: snapshot.sourceRevision, values });
				}
			}).catch(() => { });
		}
		if (this.host.onInspectDependencies) {
			const snapshot = this.graph;
			void this.host.onInspectDependencies(snapshot.workspaceId, snapshot.architectureId, snapshot.sourceRevision).then(report => {
				if (this.isSameGraph(snapshot)) {
					this.post({ type: 'dependencyReport', report: report ?? null });
				}
			}).catch(() => { });
		}
		if (this.host.onAuditExportReadiness) {
			const snapshot = this.graph;
			void this.host.onAuditExportReadiness(snapshot.workspaceId, snapshot.architectureId, snapshot.sourceRevision).then(report => {
				if (this.isSameGraph(snapshot)) {
					this.post({ type: 'exportAuditReport', report: report ?? null });
				}
			}).catch(() => { });
		}
		if (this.host.onCheckOfflineMirrorReadiness) {
			const snapshot = this.graph;
			void this.host.onCheckOfflineMirrorReadiness(snapshot.workspaceId, snapshot.architectureId, snapshot.sourceRevision).then(report => {
				if (this.isSameGraph(snapshot)) {
					this.post({ type: 'offlineMirrorReadiness', report: report ?? null });
				}
			}).catch(() => { });
		}
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

	private buildHtml(webview: Webview, studioAvailable: boolean): string {
		if (!studioAvailable) {
			return buildStudioUnavailableHtml(l10n.t('CloudForge Studio assets are not built in this checkout. Run node extensions/cloudforge/esbuild.webview.mts and reload the window.'));
		}
		const nonce = randomBytes(16).toString('base64');
		const studioRoot = Uri.joinPath(this.context.extensionUri, 'media', 'studio');
		return buildStudioWebviewHtml({
			nonce,
			cspSource: webview.cspSource,
			studioBaseUri: webview.asWebviewUri(studioRoot).toString(),
			scriptUri: webview.asWebviewUri(Uri.joinPath(studioRoot, 'studio.js')).toString(),
			styleUri: webview.asWebviewUri(Uri.joinPath(studioRoot, 'studio.css')).toString(),
		});
	}

	dispose(): void {
		this.showSequence++;
		this.panel?.dispose();
		this.panel = undefined;
		this.ready = false;
		for (const item of this.disposables) {
			item.dispose();
		}
	}
}

export { defaultCanvasViewState };
