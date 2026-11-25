/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed bridge between CloudForge Studio and the VS Code Extension Host Webview protocol
 * (`extensions/cloudforge/src/canvas/protocol.ts`).
 *
 * When running inside a VS Code Webview, `acquireVsCodeApi` is available and Studio operates
 * in hosted mode against live sanitized Rust service data. When running standalone in a browser
 * preview (`pnpm dev`), `acquireVsCodeApi` is absent and Studio stays in in-memory sample mode.
 */

import type { HostFormSchema } from './liveSchema.ts';

export interface HostNodeSummary {
	readonly id: string;
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
	readonly label: string;
	readonly hasSource: boolean;
}

export interface HostEdgeSummary {
	readonly fromId: string;
	readonly toId: string;
	readonly kind: string;
}

export interface HostDiagnosticSummary {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
}

export interface HostGraphSnapshot {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly architectureName: string;
	readonly sourceRevision: string;
	readonly status: 'complete' | 'partial';
	readonly nodes: readonly HostNodeSummary[];
	readonly edges: readonly HostEdgeSummary[];
	readonly diagnostics: readonly HostDiagnosticSummary[];
}

export interface HostPoint {
	readonly x: number;
	readonly y: number;
}

export interface HostViewState {
	readonly mode?: 'visual' | 'technical';
	readonly theme?: 'workbench' | 'light' | 'dark';
	readonly selectedId?: string | null;
	readonly inspectorOpen?: boolean;
	readonly nodePositions?: Partial<Record<'visual' | 'technical', Readonly<Record<string, HostPoint>>>>;
}

export interface HostNotice {
	readonly kind: 'stale' | 'unavailable' | 'info';
	readonly message: string;
}

export interface HostValidationFinding {
	readonly id: string;
	readonly nodeId: string | null;
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'info';
	readonly message: string;
	readonly remediation: string;
}

export interface HostValidationNodeResult {
	readonly nodeId: string;
	readonly status: 'pending' | 'running' | 'success' | 'warning' | 'failed' | 'skipped';
	readonly reason?: string;
	readonly blockedBy: readonly string[];
	readonly findings: readonly HostValidationFinding[];
	readonly schemaCovered: boolean;
}

export interface HostValidationRun {
	readonly runId: string;
	readonly scope: 'architecture' | 'resource';
	readonly targetNodeId: string | null;
	readonly capturedRevision: string;
	readonly stale: boolean;
	readonly outcome: 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | 'interrupted';
	readonly coverage: 'complete' | 'partial';
	readonly coverageNotes: readonly string[];
	readonly nodeResults: Readonly<Record<string, HostValidationNodeResult>>;
}

export interface HostDraftSaveFinding {
	readonly code: string;
	readonly file: string;
	readonly line?: number;
}

export interface HostDraftSavePreview {
	readonly fileName: string;
	readonly created: boolean;
	readonly sourceRevision: string;
	readonly beforeSha256?: string;
	readonly afterSha256: string;
	readonly addedLines: number;
	readonly removedLines: number;
	readonly findings: readonly HostDraftSaveFinding[];
	readonly previewToken: string;
}

export interface HostDraftSaveApplied {
	readonly fileName: string;
	readonly created: boolean;
	readonly newSourceRevision: string;
	readonly bytesWritten: number;
}

export interface HostDraftSaveError {
	readonly code: string;
	readonly message: string;
}

export interface HostCatalogueSnapshot {
	readonly address: string;
	readonly version: string;
	readonly formatVersion: string;
	readonly sha256: string;
	readonly resourceCount: number;
	readonly dataSourceCount: number;
}

export interface HostDetectedEngine {
	readonly engine: 'openTofu' | 'terraform';
	readonly status: 'available' | 'missing' | 'failed';
	readonly version?: string;
	readonly platform?: string;
	readonly message?: string;
}

export interface HostEngineValidateDiagnostic {
	readonly severity: 'error' | 'warning';
	readonly summary: string;
	readonly detail?: string;
	readonly address?: string;
	readonly filename?: string;
	readonly line?: number;
	readonly column?: number;
}

export interface HostEngineValidateReport {
	readonly sourceRevision: string;
	readonly engine: 'openTofu' | 'terraform';
	readonly engineVersion: string;
	readonly engineInferred: boolean;
	readonly valid: boolean;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly durationMs: number;
	readonly diagnostics: readonly HostEngineValidateDiagnostic[];
	readonly truncated: boolean;
}

export type HostInboundMessage =
	| { readonly type: 'graph'; readonly graph: HostGraphSnapshot; readonly viewState?: HostViewState; readonly notice?: HostNotice | null }
	| { readonly type: 'selectNode'; readonly nodeId: string | null }
	| { readonly type: 'notice'; readonly notice: HostNotice | null }
	| { readonly type: 'empty'; readonly message: string }
	| { readonly type: 'validationRunUpdate'; readonly run: HostValidationRun }
	| { readonly type: 'draftSavePreview'; readonly result: { readonly ok: true; readonly preview: HostDraftSavePreview } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'draftSaveApplied'; readonly result: { readonly ok: true; readonly applied: HostDraftSaveApplied } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'catalogueSnapshots'; readonly snapshots: readonly HostCatalogueSnapshot[] }
	| { readonly type: 'liveSchema'; readonly typeName: string; readonly schema: HostFormSchema | null }
	| { readonly type: 'detectedEngines'; readonly engines: readonly HostDetectedEngine[] }
	| { readonly type: 'engineValidateReport'; readonly report: HostEngineValidateReport | null; readonly error?: string }
	| { readonly type: 'exportResult'; readonly ok: boolean; readonly message: string };

export type HostOutboundMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectNode'; readonly nodeId: string | null }
	| { readonly type: 'openSource'; readonly nodeId: string }
	| { readonly type: 'refresh' }
	| { readonly type: 'requestValidation'; readonly scope: 'architecture' | 'resource'; readonly nodeId?: string }
	| { readonly type: 'cancelValidation' }
	| { readonly type: 'requestDraftSavePreview'; readonly fileName: string; readonly contents: string }
	| { readonly type: 'applyDraftSave'; readonly fileName: string; readonly contents: string; readonly previewToken: string }
	| { readonly type: 'requestSchema'; readonly kind: 'resource' | 'dataSource'; readonly typeName: string }
	| { readonly type: 'requestEngineValidate'; readonly engine?: 'openTofu' | 'terraform' }
	| { readonly type: 'exportArtifact'; readonly format: 'svg' | 'png' | 'markdown'; readonly suggestedFileName: string; readonly content: string; readonly encoding: 'utf8' | 'base64' };

interface VsCodeWebviewApi {
	postMessage(message: unknown): void;
	getState?(): unknown;
	setState?(state: unknown): void;
}

declare global {
	interface Window {
		acquireVsCodeApi?: () => VsCodeWebviewApi;
	}
}

export interface StudioHostBridge {
	readonly isHosted: boolean;
	post(message: HostOutboundMessage): void;
	subscribe(listener: (message: HostInboundMessage) => void): () => void;
}

let cachedVsCodeApi: VsCodeWebviewApi | null | undefined;

function getVsCodeApi(): VsCodeWebviewApi | null {
	if (cachedVsCodeApi !== undefined) {
		return cachedVsCodeApi;
	}
	if (typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function') {
		try {
			cachedVsCodeApi = window.acquireVsCodeApi();
			return cachedVsCodeApi;
		} catch {
			cachedVsCodeApi = null;
			return null;
		}
	}
	cachedVsCodeApi = null;
	return null;
}

export function createHostBridge(): StudioHostBridge {
	const api = getVsCodeApi();
	return {
		isHosted: api !== null,
		post(message) {
			api?.postMessage(message);
		},
		subscribe(listener) {
			if (!api || typeof window === 'undefined') {
				return () => {};
			}
			const handle = (event: MessageEvent) => {
				const data = event.data;
				if (data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string') {
					listener(data as HostInboundMessage);
				}
			};
			window.addEventListener('message', handle);
			return () => window.removeEventListener('message', handle);
		},
	};
}
