/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Shared sanitized protocol between the CloudForge extension host and the read-only Architecture
// Canvas Webview. Pure TypeScript with zero runtime `vscode` or DOM imports.
// Trust boundary: Webviews never receive or send filesystem paths or process commands.

import type { FormSchema } from './schemaForm';
import type { ValidationRun } from './validationRunner';

export type CanvasViewMode = 'visual' | 'technical';
export type CanvasTheme = 'workbench' | 'light' | 'dark';
export type CanvasGridMode = 'lines' | 'dots' | 'none';

export interface CanvasCatalogueSnapshot {
	readonly address: string;
	readonly version: string;
	readonly formatVersion: string;
	readonly sha256: string;
	readonly resourceCount: number;
	readonly dataSourceCount: number;
}

export interface DraftSaveFinding {
	readonly code: string;
	readonly file: string;
	readonly line?: number;
}

export interface DraftSavePreviewResult {
	readonly fileName: string;
	readonly created: boolean;
	readonly sourceRevision: string;
	readonly beforeSha256?: string;
	readonly afterSha256: string;
	readonly addedLines: number;
	readonly removedLines: number;
	readonly findings: readonly DraftSaveFinding[];
	readonly previewToken: string;
}

export interface DraftSaveApplyResult {
	readonly fileName: string;
	readonly created: boolean;
	readonly newSourceRevision: string;
	readonly bytesWritten: number;
}

export interface DraftSaveError {
	readonly code: string;
	readonly message: string;
}

export interface CanvasViewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

export interface CanvasNodeSummary {
	readonly id: string;
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
	readonly label: string;
	readonly hasSource: boolean;
}

export interface CanvasEdgeSummary {
	readonly fromId: string;
	readonly toId: string;
	readonly kind: string;
}

export interface CanvasDiagnosticSummary {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
}

export interface CanvasGraphSnapshot {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly architectureName: string;
	readonly sourceRevision: string;
	readonly status: 'complete' | 'partial';
	readonly nodes: readonly CanvasNodeSummary[];
	readonly edges: readonly CanvasEdgeSummary[];
	readonly diagnostics: readonly CanvasDiagnosticSummary[];
}

export interface CanvasViewState {
	readonly mode: CanvasViewMode;
	readonly theme: CanvasTheme;
	readonly grid: CanvasGridMode;
	readonly selectedId: string | null;
	readonly focusedWorkspaceOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly listOpen: boolean;
	readonly collapsedGroups: readonly string[];
	readonly viewports: Partial<Record<CanvasViewMode, CanvasViewport>>;
}

export type CanvasNoticeKind = 'stale' | 'unavailable' | 'info';

export interface CanvasNotice {
	readonly kind: CanvasNoticeKind;
	readonly message: string;
}

export type ExtensionToWebviewMessage =
	| {
		readonly type: 'graph';
		readonly graph: CanvasGraphSnapshot;
		readonly viewState: CanvasViewState;
		readonly notice: CanvasNotice | null;
	}
	| {
		readonly type: 'selectNode';
		readonly nodeId: string | null;
	}
	| {
		readonly type: 'notice';
		readonly notice: CanvasNotice | null;
	}
	| {
		readonly type: 'empty';
		readonly message: string;
	}
	| {
		readonly type: 'runValidation';
		readonly scope: 'architecture' | 'resource';
		readonly nodeId?: string;
		readonly localOnly?: boolean;
	}
	| {
		readonly type: 'cancelValidation';
	}
	| {
		readonly type: 'validationRunUpdate';
		readonly run: ValidationRun;
	}
	| {
		readonly type: 'draftSavePreview';
		readonly result:
		| { readonly ok: true; readonly preview: DraftSavePreviewResult }
		| { readonly ok: false; readonly error: DraftSaveError };
	}
	| {
		readonly type: 'draftSaveApplied';
		readonly result:
		| { readonly ok: true; readonly applied: DraftSaveApplyResult }
		| { readonly ok: false; readonly error: DraftSaveError };
	}
	| {
		readonly type: 'catalogueSnapshots';
		readonly snapshots: readonly CanvasCatalogueSnapshot[];
	}
	| {
		readonly type: 'liveSchema';
		readonly typeName: string;
		readonly schema: FormSchema | null;
	};

export type WebviewToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectNode'; readonly nodeId: string | null }
	| { readonly type: 'openSource'; readonly nodeId: string }
	| { readonly type: 'refresh' }
	| { readonly type: 'viewState'; readonly state: CanvasViewState }
	| { readonly type: 'requestValidation'; readonly scope: 'architecture' | 'resource'; readonly nodeId?: string }
	| { readonly type: 'cancelValidation' }
	| { readonly type: 'requestDraftSavePreview'; readonly fileName: string; readonly contents: string }
	| { readonly type: 'applyDraftSave'; readonly fileName: string; readonly contents: string; readonly previewToken: string }
	| { readonly type: 'requestSchema'; readonly kind: 'resource' | 'dataSource'; readonly typeName: string };

const MAX_COLLAPSED_GROUPS = 256;
const MAX_DRAFT_SAVE_CHARS = 512 * 1024;

export function isValidTfFileName(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length > 3
		&& value.length <= 255
		&& !value.startsWith('.')
		&& !/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value)
		&& value.toLowerCase().endsWith('.tf');
}

function isTypeName(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function defaultCanvasViewState(): CanvasViewState {
	return {
		mode: 'visual',
		theme: 'workbench',
		grid: 'lines',
		selectedId: null,
		focusedWorkspaceOpen: false,
		inspectorOpen: true,
		listOpen: false,
		collapsedGroups: [],
		viewports: {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeViewport(value: unknown): value is CanvasViewport {
	if (!isRecord(value)) {
		return false;
	}
	return typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= 1_000_000
		&& typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= 1_000_000
		&& typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom >= 0.05 && value.zoom <= 8;
}

export function sanitizeViewState(value: unknown): CanvasViewState {
	const fallback = defaultCanvasViewState();
	if (!isRecord(value)) {
		return fallback;
	}
	const mode: CanvasViewMode = value.mode === 'technical' ? 'technical' : 'visual';
	const theme: CanvasTheme = value.theme === 'light' || value.theme === 'dark' ? value.theme : 'workbench';
	const grid: CanvasGridMode = value.grid === 'dots' || value.grid === 'none' ? value.grid : 'lines';
	const selectedId = value.selectedId === null ? null : isOpaqueId(value.selectedId) ? value.selectedId : null;
	const focusedWorkspaceOpen = typeof value.focusedWorkspaceOpen === 'boolean' && selectedId !== null ? value.focusedWorkspaceOpen : false;
	const inspectorOpen = typeof value.inspectorOpen === 'boolean' ? value.inspectorOpen : fallback.inspectorOpen;
	const listOpen = typeof value.listOpen === 'boolean' ? value.listOpen : fallback.listOpen;

	const collapsedGroups: string[] = [];
	if (Array.isArray(value.collapsedGroups)) {
		const seen = new Set<string>();
		for (const item of value.collapsedGroups) {
			if (collapsedGroups.length >= MAX_COLLAPSED_GROUPS) {
				break;
			}
			if (isOpaqueId(item) && !seen.has(item)) {
				seen.add(item);
				collapsedGroups.push(item);
			}
		}
	}

	const viewports: Partial<Record<CanvasViewMode, CanvasViewport>> = {};
	if (isRecord(value.viewports)) {
		if (isSafeViewport(value.viewports.visual)) {
			viewports.visual = { x: value.viewports.visual.x, y: value.viewports.visual.y, zoom: value.viewports.visual.zoom };
		}
		if (isSafeViewport(value.viewports.technical)) {
			viewports.technical = { x: value.viewports.technical.x, y: value.viewports.technical.y, zoom: value.viewports.technical.zoom };
		}
	}

	return {
		mode,
		theme,
		grid,
		selectedId,
		focusedWorkspaceOpen,
		inspectorOpen,
		listOpen,
		collapsedGroups,
		viewports,
	};
}

/** Validates messages coming from the untrusted Webview before acting on them in the extension host. */
export function parseWebviewMessage(value: unknown): WebviewToExtensionMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') {
		return undefined;
	}
	switch (value.type) {
		case 'ready':
			return { type: 'ready' };
		case 'refresh':
			return { type: 'refresh' };
		case 'selectNode':
			if (value.nodeId === null) {
				return { type: 'selectNode', nodeId: null };
			}
			return isOpaqueId(value.nodeId) ? { type: 'selectNode', nodeId: value.nodeId } : undefined;
		case 'openSource':
			return isOpaqueId(value.nodeId) ? { type: 'openSource', nodeId: value.nodeId } : undefined;
		case 'viewState':
			return isRecord(value.state) ? { type: 'viewState', state: sanitizeViewState(value.state) } : undefined;
		case 'requestValidation': {
			if (value.scope !== 'architecture' && value.scope !== 'resource') {
				return undefined;
			}
			if (value.nodeId !== undefined && !isOpaqueId(value.nodeId)) {
				return undefined;
			}
			return {
				type: 'requestValidation',
				scope: value.scope,
				...(value.nodeId ? { nodeId: value.nodeId } : {}),
			};
		}
		case 'cancelValidation':
			return { type: 'cancelValidation' };
		case 'requestDraftSavePreview':
			if (!isValidTfFileName(value.fileName) || typeof value.contents !== 'string' || value.contents.length > MAX_DRAFT_SAVE_CHARS) {
				return undefined;
			}
			return { type: 'requestDraftSavePreview', fileName: value.fileName, contents: value.contents };
		case 'applyDraftSave':
			if (
				!isValidTfFileName(value.fileName)
				|| typeof value.contents !== 'string'
				|| value.contents.length > MAX_DRAFT_SAVE_CHARS
				|| !isOpaqueId(value.previewToken)
			) {
				return undefined;
			}
			return {
				type: 'applyDraftSave',
				fileName: value.fileName,
				contents: value.contents,
				previewToken: value.previewToken,
			};
		case 'requestSchema':
			if ((value.kind !== 'resource' && value.kind !== 'dataSource') || !isTypeName(value.typeName)) {
				return undefined;
			}
			return { type: 'requestSchema', kind: value.kind, typeName: value.typeName };
		default:
			return undefined;
	}
}
