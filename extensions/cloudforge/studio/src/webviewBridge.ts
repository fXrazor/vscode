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

import type { ResourceDraft } from './resourceDraft.ts';
import type { HostFormSchema } from './liveSchema.ts';

export interface HostNodeSummary {
	readonly id: string;
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
	readonly label: string;
	readonly hasSource: boolean;
	readonly sourceFile?: string;
	readonly sourceLine?: number;
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

export interface HostViewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

export interface HostViewState {
	readonly mode: 'visual' | 'technical';
	readonly theme: 'workbench' | 'light' | 'dark';
	readonly grid: 'lines' | 'dots' | 'none';
	readonly selectedId: string | null;
	readonly focusedWorkspaceOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly listOpen: boolean;
	readonly collapsedGroups: readonly string[];
	readonly viewports: Partial<Record<'visual' | 'technical', HostViewport>>;
	readonly hiddenLayers: readonly string[];
	readonly snapToGrid: boolean;
	readonly frames: readonly unknown[];
	readonly annotations: readonly unknown[];
	readonly nodePositions: Partial<Record<'visual' | 'technical', Readonly<Record<string, HostPoint>>>>;
	readonly checkpoints: readonly unknown[];
	readonly sampleContext: unknown;
}

export interface HostCloudRegion {
	readonly name: string;
	readonly displayName: string;
	readonly availabilityZones: readonly string[];
	readonly geography?: string;
}

export interface HostCloudRegionsPayload {
	readonly provider: 'azure' | 'aws' | 'google';
	readonly source: 'authenticatedScopeApi' | 'bundledPublicFallback';
	readonly refreshedAt: string;
	readonly stale: boolean;
	readonly isFallback: boolean;
	readonly regions: readonly HostCloudRegion[];
}

export interface HostProviderDependency {
	readonly display: string;
	readonly status: 'locked' | 'unlocked' | 'lockOutsideConstraints' | 'noMatchingRelease' | 'conflict';
	readonly lockedVersion?: string;
	readonly conflictCount: number;
	readonly requirementCount: number;
}

export interface HostDependencyReport {
	readonly sourceRevision: string;
	readonly engine: 'opentofu' | 'terraform';
	readonly engineInferred: boolean;
	readonly lockState: 'absent' | 'valid' | 'invalid' | 'unreadable';
	readonly providers: readonly HostProviderDependency[];
	readonly unusedLockEntries: readonly string[];
	readonly diagnosticCount: number;
}

export interface HostExportAuditReport {
	readonly sourceRevision: string;
	readonly engine: 'openTofu' | 'terraform';
	readonly engineInferred: boolean;
	readonly reproducible: boolean;
	readonly lockState: 'absent' | 'valid' | 'invalid' | 'unreadable';
	readonly lockEntryCount: number;
	readonly moduleCount: number;
	readonly unresolvedReasonKinds: readonly string[];
}

export interface HostModuleVariable {
	readonly name: string;
	readonly typeExpr?: string;
	readonly description?: string;
	readonly required: boolean;
	readonly sensitive: boolean;
	readonly hasDefault: boolean;
}

export interface HostModuleOutput {
	readonly name: string;
	readonly description?: string;
	readonly sensitive: boolean;
}

export interface HostChildModuleRef {
	readonly name: string;
	readonly source: string;
	readonly isLocal: boolean;
}

export interface HostModuleInspection {
	readonly modulePath: readonly string[];
	readonly status: 'local' | 'external';
	readonly sourceKind: 'local' | 'registry' | 'git' | 'remote';
	readonly source: string;
	readonly moduleRevision?: string;
	readonly passedInputs: readonly string[];
	readonly variables: readonly HostModuleVariable[];
	readonly outputs: readonly HostModuleOutput[];
	readonly childModules: readonly HostChildModuleRef[];
	readonly graph: HostGraphSnapshot | null;
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
	/** Present for a focused save: only these blocks change, the rest of the file is kept as written. */
	readonly merge?: HostDraftSaveMerge;
}

export interface HostDraftSaveMerge {
	readonly updated: readonly string[];
	readonly added: readonly string[];
	readonly removed: readonly string[];
	readonly unchanged: number;
	readonly preserved: number;
	readonly skipped: readonly string[];
	readonly renamed?: readonly { readonly from: string; readonly to: string }[];
}

export interface HostDraftSaveApplied {
	readonly fileName: string;
	readonly created: boolean;
	readonly newSourceRevision: string;
	readonly bytesWritten: number;
}

export interface HostSaveAllPreviewFile {
	readonly fileName: string;
	readonly created: boolean;
	readonly changed: boolean;
	readonly addedLines: number;
	readonly removedLines: number;
	readonly findings: readonly HostDraftSaveFinding[];
	readonly merge?: HostDraftSaveMerge;
}

/** Every changed file merged by Rust under one preview token. */
export interface HostSaveAllPreview {
	readonly sourceRevision: string;
	readonly files: readonly HostSaveAllPreviewFile[];
	readonly previewToken: string;
}

export interface HostSaveAllApplied {
	readonly files: readonly { readonly fileName: string; readonly created: boolean; readonly bytesWritten: number }[];
	readonly newSourceRevision: string;
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
	| { readonly type: 'graph'; readonly graph: HostGraphSnapshot; readonly viewState?: Partial<HostViewState>; readonly notice?: HostNotice | null }
	| { readonly type: 'selectNode'; readonly nodeId: string | null }
	| { readonly type: 'notice'; readonly notice: HostNotice | null }
	| { readonly type: 'empty'; readonly message: string }
	| { readonly type: 'validationRunUpdate'; readonly run: HostValidationRun }
	| { readonly type: 'draftSavePreview'; readonly result: { readonly ok: true; readonly preview: HostDraftSavePreview } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'draftSaveApplied'; readonly result: { readonly ok: true; readonly applied: HostDraftSaveApplied } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'saveAllPreview'; readonly result: { readonly ok: true; readonly preview: HostSaveAllPreview } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'saveAllApplied'; readonly result: { readonly ok: true; readonly applied: HostSaveAllApplied } | { readonly ok: false; readonly error: HostDraftSaveError } }
	| { readonly type: 'catalogueSnapshots'; readonly snapshots: readonly HostCatalogueSnapshot[] }
	| { readonly type: 'liveSchema'; readonly typeName: string; readonly schema: HostFormSchema | null }
	| { readonly type: 'resourceValues'; readonly sourceRevision: string; readonly values: unknown }
	| { readonly type: 'resourceDraftRendered'; readonly resourceId: string; readonly preview: unknown }
	| { readonly type: 'catalogueTypes'; readonly types: { readonly provider: 'azure' | 'aws' | 'gcp'; readonly version: string; readonly resources: readonly string[] } }
	| { readonly type: 'cloudRegions'; readonly data: HostCloudRegionsPayload }
	| { readonly type: 'dependencyReport'; readonly report: HostDependencyReport | null }
	| { readonly type: 'exportAuditReport'; readonly report: HostExportAuditReport | null }
	| { readonly type: 'moduleInspection'; readonly modulePath: readonly string[]; readonly inspection: HostModuleInspection | null; readonly error?: string }
	| { readonly type: 'detectedEngines'; readonly engines: readonly HostDetectedEngine[] }
	| { readonly type: 'engineValidateReport'; readonly report: HostEngineValidateReport | null; readonly error?: string }
	| { readonly type: 'runValidation'; readonly scope: 'architecture' | 'resource'; readonly nodeId?: string; readonly localOnly?: boolean }
	| { readonly type: 'cancelValidation' }
	| { readonly type: 'openExport' }
	| { readonly type: 'openTemplates' }
	| { readonly type: 'exportResult'; readonly ok: boolean; readonly message: string }
	| { readonly type: 'focusModeChanged'; readonly active: boolean };

export type HostOutboundMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectNode'; readonly nodeId: string | null }
	| { readonly type: 'openSource'; readonly nodeId: string }
	| { readonly type: 'renderResourceDraft'; readonly resourceId: string; readonly draft: ResourceDraft }
	| { readonly type: 'openSourceLocation'; readonly sourceRevision: string; readonly fileName: string; readonly line?: number; readonly column?: number }
	| { readonly type: 'refresh' }
	| { readonly type: 'toggleFocusMode'; readonly active?: boolean }
	| { readonly type: 'viewState'; readonly state: HostViewState }
	| { readonly type: 'requestValidation'; readonly scope: 'architecture' | 'resource'; readonly nodeId?: string }
	| { readonly type: 'cancelValidation' }
	| { readonly type: 'requestDraftSavePreview'; readonly fileName: string; readonly contents: string; readonly removeAddresses?: readonly string[]; readonly renames?: readonly { readonly from: string; readonly to: string }[]; readonly baseContents?: string }
	| { readonly type: 'applyDraftSave'; readonly fileName: string; readonly contents: string; readonly previewToken: string }
	| { readonly type: 'requestSaveAllPreview'; readonly files: readonly { readonly fileName: string; readonly contents: string; readonly removeAddresses?: readonly string[]; readonly renames?: readonly { readonly from: string; readonly to: string }[]; readonly baseContents?: string }[] }
	| { readonly type: 'applySaveAll'; readonly previewToken: string }
	| { readonly type: 'requestSchema'; readonly kind: 'resource' | 'dataSource'; readonly typeName: string }
	| { readonly type: 'requestModule'; readonly modulePath: readonly string[] }
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
