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
export type ArchitectureLayer = 'infrastructure' | 'platforms' | 'applications' | 'security' | 'operations';
export type CanvasFrameColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'slate';
export type CanvasAnnotationColor = 'amber' | 'blue' | 'emerald' | 'rose';
export type ExportFormat = 'svg' | 'png' | 'markdown' | 'bicep' | 'arm' | 'cloudformation' | 'k8s';

export const ARCHITECTURE_LAYERS: readonly ArchitectureLayer[] = [
	'infrastructure',
	'platforms',
	'applications',
	'security',
	'operations',
];

export interface CanvasPoint {
	readonly x: number;
	readonly y: number;
}

export interface CanvasFrame {
	readonly id: string;
	readonly title: string;
	readonly color: CanvasFrameColor;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface CanvasAnnotation {
	readonly id: string;
	readonly text: string;
	readonly color: CanvasAnnotationColor;
	readonly x: number;
	readonly y: number;
	readonly width: number;
}

export interface ArchitectureCheckpoint {
	readonly id: string;
	readonly name: string;
	readonly createdAtIso: string;
	readonly baseSourceRevision: string;
	readonly nodes: readonly CanvasNodeSummary[];
	readonly edges: readonly CanvasEdgeSummary[];
	readonly addedIds: readonly string[];
	readonly deletedIds: readonly string[];
	readonly modifiedDraftIds: readonly string[];
	readonly note?: string;
}

export interface SampleValidationContext {
	readonly label: string;
	readonly environment: 'dev' | 'staging' | 'prod';
	readonly region: string;
	readonly capturedAtIso: string;
	readonly sourceRevision: string;
	readonly schemaVersion: string;
}

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

export interface CanvasCloudRegion {
	readonly name: string;
	readonly displayName: string;
	readonly availabilityZones: readonly string[];
	readonly geography?: string;
}

export interface CanvasCloudRegionsPayload {
	readonly provider: 'azure' | 'aws' | 'google';
	readonly source: 'authenticatedScopeApi' | 'bundledPublicFallback';
	readonly refreshedAt: string;
	readonly stale: boolean;
	readonly isFallback: boolean;
	readonly regions: readonly CanvasCloudRegion[];
}

export interface CanvasProviderDependency {
	readonly display: string;
	readonly status: 'locked' | 'unlocked' | 'lockOutsideConstraints' | 'noMatchingRelease' | 'conflict';
	readonly lockedVersion?: string;
	readonly conflictCount: number;
	readonly requirementCount: number;
}

export interface CanvasDependencyReport {
	readonly sourceRevision: string;
	readonly engine: 'opentofu' | 'terraform';
	readonly engineInferred: boolean;
	readonly lockState: 'absent' | 'valid' | 'invalid' | 'unreadable';
	readonly providers: readonly CanvasProviderDependency[];
	readonly unusedLockEntries: readonly string[];
	readonly diagnosticCount: number;
}

export interface CanvasModuleVariable {
	readonly name: string;
	readonly typeExpr?: string;
	readonly description?: string;
	readonly required: boolean;
	readonly sensitive: boolean;
	readonly hasDefault: boolean;
}

export interface CanvasModuleOutput {
	readonly name: string;
	readonly description?: string;
	readonly sensitive: boolean;
}

export interface CanvasChildModuleRef {
	readonly name: string;
	readonly source: string;
	readonly isLocal: boolean;
}

export interface CanvasModuleInspection {
	readonly modulePath: readonly string[];
	readonly status: 'local' | 'external';
	readonly sourceKind: 'local' | 'registry' | 'git' | 'remote';
	readonly source: string;
	readonly moduleRevision?: string;
	readonly passedInputs: readonly string[];
	readonly variables: readonly CanvasModuleVariable[];
	readonly outputs: readonly CanvasModuleOutput[];
	readonly childModules: readonly CanvasChildModuleRef[];
	readonly graph: CanvasGraphSnapshot | null;
}

export interface CanvasSchemaImpactedItem {
	readonly resourceAddress: string;
	readonly kind: 'resource' | 'dataSource';
	readonly typeName: string;
	readonly path?: string;
	readonly breaking: boolean;
	readonly summary: string;
}

export interface CanvasSchemaDiffReport {
	readonly provider: string;
	readonly fromVersion: string;
	readonly toVersion: string;
	readonly addedTypeCount: number;
	readonly removedTypeCount: number;
	readonly pathChangeCount: number;
	readonly impactedArchitectureItems: readonly CanvasSchemaImpactedItem[];
	readonly hasBreakingChanges: boolean;
	readonly hasArchitectureBreakingChanges: boolean;
	readonly truncated: boolean;
}

export interface CanvasExportAuditReport {
	readonly sourceRevision: string;
	readonly engine: 'openTofu' | 'terraform';
	readonly engineInferred: boolean;
	readonly reproducible: boolean;
	readonly lockState: 'absent' | 'valid' | 'invalid' | 'unreadable';
	readonly lockEntryCount: number;
	readonly moduleCount: number;
	readonly unresolvedReasonKinds: readonly string[];
}

export interface CanvasDetectedEngine {
	readonly engine: 'openTofu' | 'terraform';
	readonly status: 'available' | 'missing' | 'failed';
	readonly version?: string;
	readonly platform?: string;
	readonly message?: string;
}

export interface CanvasEngineValidateDiagnostic {
	readonly severity: 'error' | 'warning';
	readonly summary: string;
	readonly detail?: string;
	readonly address?: string;
	readonly filename?: string;
	readonly line?: number;
	readonly column?: number;
}

export interface CanvasEngineValidateReport {
	readonly sourceRevision: string;
	readonly engine: 'openTofu' | 'terraform';
	readonly engineVersion: string;
	readonly engineInferred: boolean;
	readonly valid: boolean;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly durationMs: number;
	readonly diagnostics: readonly CanvasEngineValidateDiagnostic[];
	readonly truncated: boolean;
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
	readonly hiddenLayers: readonly ArchitectureLayer[];
	readonly snapToGrid: boolean;
	readonly frames: readonly CanvasFrame[];
	readonly annotations: readonly CanvasAnnotation[];
	readonly nodePositions: Partial<Record<CanvasViewMode, Readonly<Record<string, CanvasPoint>>>>;
	readonly checkpoints: readonly ArchitectureCheckpoint[];
	readonly sampleContext: SampleValidationContext | null;
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
	}
	| {
		readonly type: 'cloudRegions';
		readonly data: CanvasCloudRegionsPayload;
	}
	| {
		readonly type: 'dependencyReport';
		readonly report: CanvasDependencyReport | null;
	}
	| {
		readonly type: 'moduleInspection';
		readonly modulePath: readonly string[];
		readonly inspection: CanvasModuleInspection | null;
		readonly error?: string;
	}
	| {
		readonly type: 'exportAuditReport';
		readonly report: CanvasExportAuditReport | null;
	}
	| {
		readonly type: 'schemaDiffReport';
		readonly report: CanvasSchemaDiffReport | null;
		readonly error?: string;
	}
	| {
		readonly type: 'detectedEngines';
		readonly engines: readonly CanvasDetectedEngine[];
	}
	| {
		readonly type: 'engineValidateReport';
		readonly report: CanvasEngineValidateReport | null;
		readonly error?: string;
	}
	| {
		readonly type: 'openExport';
	}
	| {
		readonly type: 'openTemplates';
	}
	| {
		readonly type: 'exportResult';
		readonly ok: boolean;
		readonly message: string;
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
	| { readonly type: 'requestSchema'; readonly kind: 'resource' | 'dataSource'; readonly typeName: string }
	| { readonly type: 'requestModule'; readonly modulePath: readonly string[] }
	| {
		readonly type: 'requestSchemaDiff';
		readonly fromKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string };
		readonly toKey: { readonly address: string; readonly version: string; readonly formatVersion: string; readonly sha256: string };
	}
	| { readonly type: 'requestEngineValidate'; readonly engine?: 'openTofu' | 'terraform' }
	| { readonly type: 'exportArtifact'; readonly format: ExportFormat; readonly suggestedFileName: string; readonly content: string; readonly encoding: 'utf8' | 'base64' }
	| { readonly type: 'useTemplateAsArchitecture'; readonly templateId: string };

const MAX_COLLAPSED_GROUPS = 256;
const MAX_DRAFT_SAVE_CHARS = 512 * 1024;
const MAX_EXPORT_CHARS = 8 * 1024 * 1024;
const MAX_FRAMES = 48;
const MAX_ANNOTATIONS = 64;
const MAX_NODE_POSITIONS = 512;
const MAX_CHECKPOINTS = 12;
const MAX_CHECKPOINT_NODES = 256;
const MAX_CHECKPOINT_EDGES = 512;

export function isValidTfFileName(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length > 3
		&& value.length <= 255
		&& !value.startsWith('.')
		&& !/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value)
		&& value.toLowerCase().endsWith('.tf');
}

export function isValidExportFileName(value: unknown, format: ExportFormat): value is string {
	if (typeof value !== 'string' || value.length < 4 || value.length > 255 || value.startsWith('.')) {
		return false;
	}
	if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value)) {
		return false;
	}
	const lower = value.toLowerCase();
	switch (format) {
		case 'svg': return lower.endsWith('.svg');
		case 'png': return lower.endsWith('.png');
		case 'markdown': return lower.endsWith('.md');
		case 'bicep': return lower.endsWith('.bicep');
		case 'arm': return lower.endsWith('.json');
		case 'cloudformation':
		case 'k8s':
			return lower.endsWith('.yaml') || lower.endsWith('.yml');
	}
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
		inspectorOpen: false,
		listOpen: false,
		collapsedGroups: [],
		viewports: {},
		hiddenLayers: [],
		snapToGrid: true,
		frames: [],
		annotations: [],
		nodePositions: {},
		checkpoints: [],
		sampleContext: null,
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

function isSafePoint(value: unknown): value is CanvasPoint {
	if (!isRecord(value)) {
		return false;
	}
	return typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= 1_000_000
		&& typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= 1_000_000;
}

function isArchitectureLayer(value: unknown): value is ArchitectureLayer {
	return value === 'infrastructure' || value === 'platforms' || value === 'applications' || value === 'security' || value === 'operations';
}

function isFrameColor(value: unknown): value is CanvasFrameColor {
	return value === 'blue' || value === 'emerald' || value === 'amber' || value === 'violet' || value === 'slate';
}

function isAnnotationColor(value: unknown): value is CanvasAnnotationColor {
	return value === 'amber' || value === 'blue' || value === 'emerald' || value === 'rose';
}

function sanitizeShortText(value: unknown, maxLen: number): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maxLen);
	return cleaned;
}

function sanitizeNodePositionMap(value: unknown): Readonly<Record<string, CanvasPoint>> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const out: Record<string, CanvasPoint> = {};
	let count = 0;
	for (const [key, pt] of Object.entries(value)) {
		if (count >= MAX_NODE_POSITIONS) {
			break;
		}
		if (isOpaqueId(key) && isSafePoint(pt)) {
			out[key] = { x: pt.x, y: pt.y };
			count++;
		}
	}
	return count > 0 ? out : undefined;
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
	const snapToGrid = typeof value.snapToGrid === 'boolean' ? value.snapToGrid : fallback.snapToGrid;

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

	const hiddenLayers: ArchitectureLayer[] = [];
	if (Array.isArray(value.hiddenLayers)) {
		const seen = new Set<ArchitectureLayer>();
		for (const item of value.hiddenLayers) {
			if (isArchitectureLayer(item) && !seen.has(item)) {
				seen.add(item);
				hiddenLayers.push(item);
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

	const frames: CanvasFrame[] = [];
	if (Array.isArray(value.frames)) {
		const seen = new Set<string>();
		for (const raw of value.frames) {
			if (frames.length >= MAX_FRAMES) {
				break;
			}
			if (
				isRecord(raw)
				&& isOpaqueId(raw.id)
				&& !seen.has(raw.id)
				&& typeof raw.x === 'number' && Number.isFinite(raw.x) && Math.abs(raw.x) <= 1_000_000
				&& typeof raw.y === 'number' && Number.isFinite(raw.y) && Math.abs(raw.y) <= 1_000_000
				&& typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 160 && raw.width <= 12_000
				&& typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height >= 100 && raw.height <= 12_000
			) {
				const title = sanitizeShortText(raw.title, 120) ?? 'Section';
				seen.add(raw.id);
				frames.push({
					id: raw.id,
					title: title || 'Section',
					color: isFrameColor(raw.color) ? raw.color : 'blue',
					x: raw.x,
					y: raw.y,
					width: raw.width,
					height: raw.height,
				});
			}
		}
	}

	const annotations: CanvasAnnotation[] = [];
	if (Array.isArray(value.annotations)) {
		const seen = new Set<string>();
		for (const raw of value.annotations) {
			if (annotations.length >= MAX_ANNOTATIONS) {
				break;
			}
			if (
				isRecord(raw)
				&& isOpaqueId(raw.id)
				&& !seen.has(raw.id)
				&& typeof raw.x === 'number' && Number.isFinite(raw.x) && Math.abs(raw.x) <= 1_000_000
				&& typeof raw.y === 'number' && Number.isFinite(raw.y) && Math.abs(raw.y) <= 1_000_000
			) {
				const text = sanitizeShortText(raw.text, 600) ?? '';
				const width = typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 140 && raw.width <= 480 ? raw.width : 200;
				seen.add(raw.id);
				annotations.push({
					id: raw.id,
					text,
					color: isAnnotationColor(raw.color) ? raw.color : 'amber',
					x: raw.x,
					y: raw.y,
					width,
				});
			}
		}
	}

	const nodePositions: Partial<Record<CanvasViewMode, Readonly<Record<string, CanvasPoint>>>> = {};
	if (isRecord(value.nodePositions)) {
		const visualPos = sanitizeNodePositionMap(value.nodePositions.visual);
		if (visualPos) {
			nodePositions.visual = visualPos;
		}
		const techPos = sanitizeNodePositionMap(value.nodePositions.technical);
		if (techPos) {
			nodePositions.technical = techPos;
		}
	}

	const checkpoints: ArchitectureCheckpoint[] = [];
	if (Array.isArray(value.checkpoints)) {
		const seen = new Set<string>();
		for (const raw of value.checkpoints) {
			if (checkpoints.length >= MAX_CHECKPOINTS) {
				break;
			}
			if (
				!isRecord(raw)
				|| !isOpaqueId(raw.id)
				|| seen.has(raw.id)
				|| typeof raw.baseSourceRevision !== 'string'
				|| !/^[0-9a-f]{64}$/.test(raw.baseSourceRevision)
				|| !Array.isArray(raw.nodes)
				|| raw.nodes.length > MAX_CHECKPOINT_NODES
				|| !Array.isArray(raw.edges)
				|| raw.edges.length > MAX_CHECKPOINT_EDGES
			) {
				continue;
			}
			const nodes: CanvasNodeSummary[] = [];
			const nodeIdSet = new Set<string>();
			for (const n of raw.nodes) {
				if (
					isRecord(n)
					&& isOpaqueId(n.id)
					&& !nodeIdSet.has(n.id)
					&& typeof n.kind === 'string' && n.kind.length <= 64
					&& (n.resourceType === null || (typeof n.resourceType === 'string' && n.resourceType.length <= 128))
					&& typeof n.name === 'string' && n.name.length <= 128
					&& typeof n.label === 'string' && n.label.length <= 256
					&& typeof n.hasSource === 'boolean'
				) {
					nodeIdSet.add(n.id);
					nodes.push({
						id: n.id,
						kind: n.kind,
						resourceType: n.resourceType,
						name: n.name,
						label: n.label,
						hasSource: n.hasSource,
					});
				}
			}
			const edges: CanvasEdgeSummary[] = [];
			for (const e of raw.edges) {
				if (
					isRecord(e)
					&& isOpaqueId(e.fromId) && nodeIdSet.has(e.fromId)
					&& isOpaqueId(e.toId) && nodeIdSet.has(e.toId)
					&& typeof e.kind === 'string' && e.kind.length <= 64
				) {
					edges.push({ fromId: e.fromId, toId: e.toId, kind: e.kind });
				}
			}
			const sanitizeIdList = (arr: unknown): string[] => {
				if (!Array.isArray(arr)) {
					return [];
				}
				return arr.filter(isOpaqueId).slice(0, MAX_CHECKPOINT_NODES);
			};
			const cpName = sanitizeShortText(raw.name, 80) || 'Checkpoint';
			const createdAtIso = sanitizeShortText(raw.createdAtIso, 40) || new Date(0).toISOString();
			const note = sanitizeShortText(raw.note, 240);
			seen.add(raw.id);
			checkpoints.push({
				id: raw.id,
				name: cpName,
				createdAtIso,
				baseSourceRevision: raw.baseSourceRevision,
				nodes,
				edges,
				addedIds: sanitizeIdList(raw.addedIds),
				deletedIds: sanitizeIdList(raw.deletedIds),
				modifiedDraftIds: sanitizeIdList(raw.modifiedDraftIds),
				...(note ? { note } : {}),
			});
		}
	}

	let sampleContext: SampleValidationContext | null = null;
	if (isRecord(value.sampleContext)) {
		const sc = value.sampleContext;
		const env = sc.environment === 'dev' || sc.environment === 'staging' || sc.environment === 'prod' ? sc.environment : undefined;
		if (
			env
			&& typeof sc.sourceRevision === 'string' && /^[0-9a-f]{64}$/.test(sc.sourceRevision)
		) {
			const label = sanitizeShortText(sc.label, 80) || 'Sample Context';
			const region = sanitizeShortText(sc.region, 64) || 'uksouth';
			const capturedAtIso = sanitizeShortText(sc.capturedAtIso, 40) || new Date(0).toISOString();
			const schemaVersion = sanitizeShortText(sc.schemaVersion, 64) || 'azurerm 5.14.0';
			sampleContext = { label, environment: env, region, capturedAtIso, sourceRevision: sc.sourceRevision, schemaVersion };
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
		hiddenLayers,
		snapToGrid,
		frames,
		annotations,
		nodePositions,
		checkpoints,
		sampleContext,
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
		case 'requestModule': {
			if (!Array.isArray(value.modulePath) || value.modulePath.length === 0 || value.modulePath.length > 8) {
				return undefined;
			}
			const modulePath: string[] = [];
			for (const segment of value.modulePath) {
				if (typeof segment !== 'string' || segment.length === 0 || segment.length > 128 || !/^[A-Za-z0-9_-]+$/.test(segment)) {
					return undefined;
				}
				modulePath.push(segment);
			}
			return { type: 'requestModule', modulePath };
		}
		case 'requestSchemaDiff': {
			const parseKey = (raw: unknown) => {
				if (!isRecord(raw) || typeof raw.address !== 'string' || typeof raw.version !== 'string' || typeof raw.formatVersion !== 'string' || typeof raw.sha256 !== 'string') {
					return undefined;
				}
				const segOk = (s: string) => s.length > 0 && s.length <= 256 && s !== '.' && s !== '..' && /^[A-Za-z0-9._+-]+$/.test(s);
				const parts = raw.address.split('/');
				if (parts.length !== 3 || !parts.every(segOk) || !segOk(raw.version) || !segOk(raw.formatVersion) || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
					return undefined;
				}
				return { address: raw.address, version: raw.version, formatVersion: raw.formatVersion, sha256: raw.sha256 };
			};
			const fromKey = parseKey(value.fromKey);
			const toKey = parseKey(value.toKey);
			return fromKey && toKey ? { type: 'requestSchemaDiff', fromKey, toKey } : undefined;
		}
		case 'requestEngineValidate': {
			if (value.engine !== undefined && value.engine !== 'openTofu' && value.engine !== 'terraform') {
				return undefined;
			}
			return value.engine ? { type: 'requestEngineValidate', engine: value.engine } : { type: 'requestEngineValidate' };
		}
		case 'exportArtifact': {
			if (
				value.format !== 'svg'
				&& value.format !== 'png'
				&& value.format !== 'markdown'
				&& value.format !== 'bicep'
				&& value.format !== 'arm'
				&& value.format !== 'cloudformation'
				&& value.format !== 'k8s'
			) {
				return undefined;
			}
			if (!isValidExportFileName(value.suggestedFileName, value.format)) {
				return undefined;
			}
			if (value.encoding !== 'utf8' && value.encoding !== 'base64') {
				return undefined;
			}
			if (value.format === 'png' && value.encoding !== 'base64') {
				return undefined;
			}
			if (typeof value.content !== 'string' || value.content.length === 0 || value.content.length > MAX_EXPORT_CHARS) {
				return undefined;
			}
			return {
				type: 'exportArtifact',
				format: value.format,
				suggestedFileName: value.suggestedFileName,
				content: value.content,
				encoding: value.encoding,
			};
		}
		case 'useTemplateAsArchitecture':
			return isOpaqueId(value.templateId) ? { type: 'useTemplateAsArchitecture', templateId: value.templateId } : undefined;
		default:
			return undefined;
	}
}
