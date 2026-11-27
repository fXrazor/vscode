/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure TypeScript adapters translating CloudForge Rust service Stage 3 (provider catalogue),
// Stage 4 (offline validation runner), and Stage 5 (guarded Terraform draft save) JSON-RPC
// responses into sanitized Architecture Canvas view models. Zero runtime `vscode` or DOM imports.

import type { LiteralMember, LiteralShape } from './literalSchema.ts';
import type {
	CanvasCatalogueSnapshot,
	CanvasChildModuleRef,
	CanvasCloudRegion,
	CanvasCloudRegionsPayload,
	CanvasCorruptedMirrorPackage,
	CanvasDependencyReport,
	CanvasDetectedEngine,
	CanvasDiagnosticSummary,
	CanvasCatalogueTypes,
	CanvasEdgeSummary,
	CanvasEngineInitOfflineReport,
	CanvasEnginePlanActionKind,
	CanvasEnginePlanOutputChange,
	CanvasEnginePlanReport,
	CanvasEnginePlanResourceChange,
	CanvasEnginePlanSummary,
	CanvasEngineValidateDiagnostic,
	CanvasEngineValidateReport,
	CanvasExportAuditReport,
	CanvasGraphSnapshot,
	CanvasMirrorPackageKey,
	CanvasMirrorPackageSummary,
	CanvasModuleInspection,
	CanvasModuleOutput,
	CanvasModuleVariable,
	CanvasNodeSummary,
	CanvasOfflineMirrorReadiness,
	CanvasProviderDependency,
	CanvasSchemaDiffReport,
	CanvasSchemaImpactedItem,
	DraftSaveApplyResult,
	DraftSaveError,
	DraftSaveFinding,
	DraftSaveMergeSummary,
	CanvasSchemaPreview,
	DraftSavePreviewResult,
	SaveAllApplyResult,
	SaveAllPreviewFile,
	SaveAllPreviewResult
} from './protocol';
import type {
	FieldAccess,
	FieldValueType,
	FormAttribute,
	FormBlockType,
	FormCoverage,
	FormSchema,
	SchemaKind,
	SchemaOutput
} from './schemaForm';
import type {
	RunnerFinding,
	RunnerNodeResult,
	RunnerNodeStatus,
	RunnerOutcome,
	RunnerStageId,
	RunnerStageStatus,
	RunnerStageSummary,
	RunnerTimelineEvent,
	ValidationRun
} from './validationRunner';

function collectPrerequisiteIds(graph: CanvasGraphSnapshot, targetNodeId: string): readonly string[] {
	const known = new Set(graph.nodes.map(n => n.id));
	if (!known.has(targetNodeId)) {
		return [];
	}
	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!known.has(edge.fromId) || !known.has(edge.toId) || edge.fromId === edge.toId) {
			continue;
		}
		let list = incoming.get(edge.toId);
		if (!list) {
			list = [];
			incoming.set(edge.toId, list);
		}
		list.push(edge.fromId);
	}
	const visited = new Set<string>([targetNodeId]);
	const stack = [targetNodeId];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const dep of incoming.get(cur) ?? []) {
			if (!visited.has(dep)) {
				visited.add(dep);
				stack.push(dep);
			}
		}
	}
	return graph.nodes.filter(n => visited.has(n.id)).map(n => n.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, limit = 1024): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isSafeString(value: unknown, limit = 2048): value is string {
	return typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// ============================================================================
// Stage 3: Read-only Provider Catalogue Adapters
// ============================================================================

export function parseCatalogueSnapshots(value: unknown): readonly CanvasCatalogueSnapshot[] {
	if (!isRecord(value) || !Array.isArray(value.snapshots)) {
		return [];
	}
	const out: CanvasCatalogueSnapshot[] = [];
	for (const entry of value.snapshots) {
		if (!isRecord(entry) || !isRecord(entry.key)) {
			continue;
		}
		const { address, version, formatVersion, sha256 } = entry.key;
		if (!isNonEmptyString(address, 256) || !isNonEmptyString(version, 128) || !isNonEmptyString(formatVersion, 64) || !isSha256(sha256)) {
			continue;
		}
		const counts = isRecord(entry.counts) ? entry.counts : {};
		const resourceCount = isNonNegativeInt(counts.resources) ? counts.resources : 0;
		const dataSourceCount = isNonNegativeInt(counts.dataSources) ? counts.dataSources : 0;
		out.push({
			address,
			version,
			formatVersion,
			sha256,
			resourceCount,
			dataSourceCount,
		});
	}
	return out;
}

/** Extracts the provider short name from a Terraform type like `azurerm_subnet` -> `azurerm`. */
export function inferProviderTypePrefix(typeName: string): string | undefined {
	const idx = typeName.indexOf('_');
	if (idx <= 0) {
		return undefined;
	}
	return typeName.slice(0, idx).toLowerCase();
}

function compareSemverDescending(a: string, b: string): number {
	const aParts = a.split(/[.-]/).map(p => (/^\d+$/.test(p) ? Number(p) : p));
	const bParts = b.split(/[.-]/).map(p => (/^\d+$/.test(p) ? Number(p) : p));
	const len = Math.max(aParts.length, bParts.length);
	for (let i = 0; i < len; i++) {
		const av = aParts[i] ?? 0;
		const bv = bParts[i] ?? 0;
		if (typeof av === 'number' && typeof bv === 'number') {
			if (av !== bv) {
				return bv - av;
			}
		} else {
			const cmp = String(bv).localeCompare(String(av));
			if (cmp !== 0) {
				return cmp;
			}
		}
	}
	return 0;
}

/** Picks the newest verified catalogue snapshot whose address ends with `/<providerPrefix>`. */
export function selectBestSnapshotForType(
	snapshots: readonly CanvasCatalogueSnapshot[],
	typeName: string
): CanvasCatalogueSnapshot | undefined {
	const prefix = inferProviderTypePrefix(typeName);
	if (!prefix) {
		return undefined;
	}
	const matches = snapshots.filter(snap => {
		const segments = snap.address.toLowerCase().split('/');
		return segments.length === 3 && segments[2] === prefix;
	});
	if (matches.length === 0) {
		return undefined;
	}
	return [...matches].sort((a, b) => compareSemverDescending(a.version, b.version))[0];
}

function mapRustAccess(value: unknown): FieldAccess {
	switch (value) {
		case 'required':
			return 'required';
		case 'computedOnly':
		case 'computed_only':
			return 'computedOnly';
		default:
			return 'optional';
	}
}

/** Decode only the service's actual type/nested metadata; absent details stay absent. */
export function readLiteralShape(type: unknown, nested?: unknown, depth = 0): LiteralShape | undefined {
	if (depth > 16) { return undefined; }
	if (isRecord(nested) && Array.isArray(nested.attributes) && ['single', 'group', 'list', 'set', 'map'].includes(String(nested.mode))) {
		const members: Record<string, LiteralMember> = Object.create(null);
		for (const item of nested.attributes) {
			if (!isRecord(item) || typeof item.name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(item.name)) { continue; }
			members[item.name] = { shape: readLiteralShape(item.typeExpr, item.nested, depth + 1), access: item.access === 'required' || item.access === 'computedOnly' ? item.access : 'optional', description: typeof item.description === 'string' ? item.description.slice(0, 2048) : undefined, sensitive: item.sensitive === true };
		}
		const object: LiteralShape = { kind: 'object', members };
		if (nested.mode === 'single' || nested.mode === 'group') { return object; }
		return { kind: nested.mode as 'list' | 'set' | 'map', element: object, ...(Number.isInteger(nested.minItems) && Number(nested.minItems) >= 0 ? { minItems: Number(nested.minItems) } : {}), ...(Number.isInteger(nested.maxItems) && Number(nested.maxItems) > 0 ? { maxItems: Number(nested.maxItems) } : {}) };
	}
	if (!isRecord(type)) { return undefined; }
	if (['string', 'number', 'bool', 'dynamic'].includes(String(type.kind))) { return { kind: type.kind as 'string' | 'number' | 'bool' | 'dynamic' }; }
	if (['list', 'set', 'map'].includes(String(type.kind))) { return { kind: type.kind as 'list' | 'set' | 'map', element: readLiteralShape(type.element, undefined, depth + 1) }; }
	if (type.kind === 'tuple' && Array.isArray(type.elements)) { return { kind: 'tuple', elements: type.elements.map(item => readLiteralShape(item, undefined, depth + 1) ?? { kind: 'dynamic' }) }; }
	if (type.kind === 'object' && isRecord(type.members)) {
		return { kind: 'object', members: Object.fromEntries(Object.entries(type.members).map(([name, member]) => [name, { shape: readLiteralShape(member, undefined, depth + 1) }])) };
	}
	return undefined;
}

function mapRustValueType(editor: unknown, typeExpr: unknown): FieldValueType {
	// Preserve structural types even when a coverage-gap editor has only a text fallback.
	if (isRecord(typeExpr)) {
		if (typeExpr.kind === 'tuple') { return 'listString'; }
		if (typeExpr.kind === 'dynamic') { return 'json'; }
	}
	if (typeof editor === 'string') {
		switch (editor) {
			case 'checkbox':
			case 'bool':
				return 'bool';
			case 'number':
				return 'number';
			case 'stringList':
			case 'list':
			case 'set':
				return 'listString';
			case 'stringMap':
			case 'map':
			case 'object':
				return 'mapString';
			case 'text':
			case 'textarea':
			case 'select':
			case 'secret':
				return 'string';
		}
	}
	if (isRecord(typeExpr) && typeof typeExpr.kind === 'string') {
		switch (typeExpr.kind) {
			case 'bool':
				return 'bool';
			case 'number':
				return 'number';
			case 'list':
			case 'set':
				return 'listString';
			case 'map':
			case 'object':
				return 'mapString';
		}
	}
	return 'string';
}

function mapRustAttributes(raw: unknown): FormAttribute[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const attrs: FormAttribute[] = [];
	for (const item of raw) {
		if (!isRecord(item) || !isNonEmptyString(item.name, 256) || !isNonEmptyString(item.path, 512)) {
			continue;
		}
		const access = mapRustAccess(item.access);
		const literalShape = readLiteralShape(item.typeExpr, item.nested);
		const valueType: FieldValueType = literalShape ? literalShape.kind === 'list' || literalShape.kind === 'set' || literalShape.kind === 'tuple' ? 'listString' : literalShape.kind === 'map' || literalShape.kind === 'object' ? 'mapString' : literalShape.kind === 'dynamic' ? 'json' : literalShape.kind : mapRustValueType(item.editor, item.typeExpr);
		const description = isSafeString(item.description, 2048) && item.description.trim().length > 0
			? item.description.trim()
			: `${item.name} (${valueType})`;
		attrs.push({
			name: item.name,
			path: item.path,
			access,
			valueType,
			...(literalShape ? { literalShape } : {}),
			description,
			...(item.sensitive === true ? { sensitive: true } : {}),
			...(item.deprecated === true ? { deprecated: true } : {}),
		});
	}
	return attrs;
}

function mapRustBlocks(raw: unknown, depth = 0): FormBlockType[] {
	if (!Array.isArray(raw) || depth > 32) {
		return [];
	}
	const blocks: FormBlockType[] = [];
	for (const item of raw) {
		if (!isRecord(item) || !isNonEmptyString(item.name, 256) || !isNonEmptyString(item.path, 512) || !isRecord(item.block)) {
			continue;
		}
		const attributes = mapRustAttributes(item.block.attributes);
		const description = isSafeString(item.description, 2048) && item.description.trim().length > 0
			? item.description.trim()
			: `Nested ${item.name} block.`;
		blocks.push({
			name: item.name,
			path: item.path,
			...(isNonNegativeInt(item.minItems) ? { minItems: item.minItems } : {}),
			...(isNonNegativeInt(item.maxItems) ? { maxItems: item.maxItems } : {}),
			description,
			attributes,
		});
		// The service sends a recursive tree; Studio reconstructs it from full paths.
		blocks.push(...mapRustBlocks(item.block.blocks, depth + 1));
	}
	return blocks;
}

function shortProviderSource(address: string): string {
	const segments = address.split('/');
	return segments.length === 3 ? `${segments[1]}/${segments[2]}` : address;
}

function providerDocsUrl(address: string, kind: SchemaKind, typeName: string, version: string): string {
	const source = shortProviderSource(address);
	const prefix = inferProviderTypePrefix(typeName);
	const slug = prefix && typeName.startsWith(`${prefix}_`) ? typeName.slice(prefix.length + 1) : typeName;
	const section = kind === 'dataSource' ? 'data-sources' : 'resources';
	return `https://registry.terraform.io/providers/${source}/${encodeURIComponent(version)}/docs/${section}/${slug}`;
}

/**
 * Adapts a Rust Stage 3 `getResourceFormSchema` result (`{ key, form }`) into the Canvas's
 * `FormSchema`, optionally merging curated offline defaults (like option dropdowns/examples).
 */
export function mapRustFormSchemaToCanvasFormSchema(
	value: unknown,
	bundledFallback?: FormSchema
): FormSchema | undefined {
	if (!isRecord(value) || !isRecord(value.key) || !isRecord(value.form) || !isRecord(value.form.block)) {
		return undefined;
	}
	const { address, version } = value.key;
	const { kind, typeName } = value.form;
	if (
		!isNonEmptyString(address, 256) ||
		!isNonEmptyString(version, 128) ||
		(kind !== 'resource' && kind !== 'dataSource') ||
		!isNonEmptyString(typeName, 256)
	) {
		return undefined;
	}

	const rawAttributes = mapRustAttributes(value.form.block.attributes);
	const bundledAttrMap = new Map((bundledFallback?.attributes ?? []).map(a => [a.name, a]));
	const attributes: FormAttribute[] = rawAttributes.map(attr => {
		const curated = bundledAttrMap.get(attr.name);
		return {
			...attr,
			...(curated?.options ? { options: curated.options } : {}),
			...(curated?.placeholder ? { placeholder: curated.placeholder } : {}),
		};
	});

	const blocks = mapRustBlocks(value.form.block.blocks);
	const outputs: SchemaOutput[] = attributes
		.filter(attr => attr.access === 'computedOnly' || attr.name === 'id' || attr.name === 'name')
		.slice(0, 12)
		.map(attr => ({
			name: attr.name,
			valueType: attr.valueType,
			description: attr.description,
			knownAtApply: attr.access === 'computedOnly',
		}));

	const description = isSafeString(value.form.description, 2048) && value.form.description.trim().length > 0
		? value.form.description.trim()
		: bundledFallback?.description ?? `Verified schema for ${typeName} from ${shortProviderSource(address)} ${version}.`;

	return {
		kind,
		typeName,
		providerSource: shortProviderSource(address),
		providerVersion: version,
		description,
		docsUrl: providerDocsUrl(address, kind, typeName, version),
		exampleHcl: '', // The service schema contains no verified documentation example.
		attributes,
		blocks,
		outputs: outputs.length > 0 ? outputs : (bundledFallback?.outputs ?? []),
	};
}

// ============================================================================
// Stage 4: Live Rust Validation Runner Adapter
// ============================================================================

export interface ServiceValidationStart {
	readonly runId: string;
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly state: string;
	readonly reused: boolean;
}

export function parseValidationStart(value: unknown): ServiceValidationStart | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.runId, 256) ||
		!isNonEmptyString(value.workspaceId, 256) ||
		!isNonEmptyString(value.architectureId, 256) ||
		!isSha256(value.sourceRevision) ||
		!isNonEmptyString(value.state, 64) ||
		typeof value.reused !== 'boolean'
	) {
		return undefined;
	}
	return {
		runId: value.runId,
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		sourceRevision: value.sourceRevision,
		state: value.state,
		reused: value.reused,
	};
}

export interface ServicePollEvent {
	readonly seq: number;
	readonly elapsedMs: number;
	readonly kind: string;
	readonly payload: Record<string, unknown>;
}

export interface ServiceNodeStatus {
	readonly nodeId: string;
	readonly state: RunnerNodeStatus;
	readonly blockedBy: readonly string[];
	readonly reasonCode?: string;
}

export interface ServiceValidationFinding {
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'info';
	readonly message: string;
	readonly nodeId: string | null;
}

export interface ServiceValidationPoll {
	readonly runId: string;
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly state: 'running' | 'completed' | 'completedWithWarnings' | 'failed' | 'cancelled';
	readonly stage: 'read_architecture' | 'map_dependencies' | 'static_checks';
	readonly coverage: 'complete' | 'partial';
	readonly coverageGaps: readonly string[];
	readonly elapsedMs: number;
	readonly nextCursor: number;
	readonly hasMore: boolean;
	readonly cursorGap: boolean;
	readonly events: readonly ServicePollEvent[];
	readonly snapshotNodes?: readonly ServiceNodeStatus[];
	readonly snapshotFindings?: readonly ServiceValidationFinding[];
}

function parseNodeCheckState(value: unknown): RunnerNodeStatus | undefined {
	switch (value) {
		case 'pending':
		case 'running':
		case 'success':
		case 'warning':
		case 'failed':
		case 'skipped':
			return value;
		default:
			return undefined;
	}
}

function parseSeverity(value: unknown): 'error' | 'warning' | 'info' {
	switch (String(value).toLowerCase()) {
		case 'error':
			return 'error';
		case 'warning':
			return 'warning';
		default:
			return 'info';
	}
}

export function parseValidationPoll(value: unknown): ServiceValidationPoll | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.runId, 256) ||
		!isNonEmptyString(value.workspaceId, 256) ||
		!isNonEmptyString(value.architectureId, 256) ||
		!isSha256(value.sourceRevision) ||
		!isNonNegativeInt(value.elapsedMs) ||
		!isNonNegativeInt(value.nextCursor) ||
		typeof value.hasMore !== 'boolean' ||
		typeof value.cursorGap !== 'boolean' ||
		!Array.isArray(value.events)
	) {
		return undefined;
	}
	const state = value.state;
	if (state !== 'running' && state !== 'completed' && state !== 'completedWithWarnings' && state !== 'failed' && state !== 'cancelled') {
		return undefined;
	}
	const stage = value.stage;
	if (stage !== 'read_architecture' && stage !== 'map_dependencies' && stage !== 'static_checks') {
		return undefined;
	}
	const coverage = value.coverage === 'complete' ? 'complete' : 'partial';
	const coverageGaps = Array.isArray(value.coverageGaps)
		? value.coverageGaps.filter((g): g is string => isNonEmptyString(g, 128))
		: [];

	const events: ServicePollEvent[] = [];
	for (const ev of value.events) {
		if (!isRecord(ev) || !isNonNegativeInt(ev.seq) || !isNonNegativeInt(ev.elapsedMs) || !isNonEmptyString(ev.kind, 64)) {
			continue;
		}
		events.push({
			seq: ev.seq,
			elapsedMs: ev.elapsedMs,
			kind: ev.kind,
			payload: isRecord(ev.payload) ? ev.payload : {},
		});
	}

	let snapshotNodes: ServiceNodeStatus[] | undefined;
	let snapshotFindings: ServiceValidationFinding[] | undefined;
	if (isRecord(value.snapshot)) {
		if (Array.isArray(value.snapshot.nodes)) {
			snapshotNodes = [];
			for (const item of value.snapshot.nodes) {
				if (!isRecord(item) || !isNonEmptyString(item.nodeId, 256)) {
					continue;
				}
				const nodeState = parseNodeCheckState(item.state);
				if (!nodeState) {
					continue;
				}
				const blockedBy = Array.isArray(item.blockedBy)
					? item.blockedBy.filter((id): id is string => isNonEmptyString(id, 256))
					: [];
				snapshotNodes.push({
					nodeId: item.nodeId,
					state: nodeState,
					blockedBy,
					...(isNonEmptyString(item.reasonCode, 128) ? { reasonCode: item.reasonCode } : {}),
				});
			}
		}
		if (Array.isArray(value.snapshot.findings)) {
			snapshotFindings = [];
			for (const f of value.snapshot.findings) {
				if (!isRecord(f) || !isNonEmptyString(f.code, 128) || !isNonEmptyString(f.message, 1024)) {
					continue;
				}
				snapshotFindings.push({
					code: f.code,
					severity: parseSeverity(f.severity),
					message: f.message,
					nodeId: isNonEmptyString(f.nodeId, 256) ? f.nodeId : null,
				});
			}
		}
	}

	return {
		runId: value.runId,
		workspaceId: value.workspaceId,
		architectureId: value.architectureId,
		sourceRevision: value.sourceRevision,
		state,
		stage,
		coverage,
		coverageGaps,
		elapsedMs: value.elapsedMs,
		nextCursor: value.nextCursor,
		hasMore: value.hasMore,
		cursorGap: value.cursorGap,
		events,
		snapshotNodes,
		snapshotFindings,
	};
}

function mapServiceOutcome(state: ServiceValidationPoll['state']): RunnerOutcome {
	switch (state) {
		case 'running':
			return 'running';
		case 'completed':
			return 'completed';
		case 'completedWithWarnings':
			return 'completed_with_warnings';
		case 'failed':
			return 'failed';
		case 'cancelled':
			return 'cancelled';
	}
}

function mapServiceStage(stage: unknown): RunnerStageId {
	switch (stage) {
		case 'read_architecture':
			return 'read';
		case 'map_dependencies':
			return 'dependencies';
		default:
			return 'checks';
	}
}

function findingRemediation(code: string): string {
	switch (code) {
		case 'DEPENDENCY_CYCLE':
			return 'Break the circular reference between these declarations in Terraform source.';
		case 'PREREQUISITE_CYCLE':
			return 'Resolve the upstream dependency cycle so dependent resources can be evaluated.';
		case 'PREREQUISITE_FAILED':
			return 'Fix the upstream resource error and rerun validation.';
		case 'UNRESOLVED_REFERENCE':
			return 'Verify the referenced declaration name or module output exists in this root.';
		case 'EXTERNAL_MODULE_UNVERIFIED':
			return 'External or unexpanded child modules are not statically evaluated in offline validation.';
		default:
			return 'Inspect the declaration in Terraform source and rerun validation.';
	}
}

function describeCoverageGap(code: string): string {
	switch (code) {
		case 'UNRESOLVED_REFERENCE':
			return 'One or more Terraform references could not be statically resolved.';
		case 'EXTERNAL_MODULE_UNVERIFIED':
			return 'External or unexpanded child modules were skipped by offline static analysis.';
		case 'PARTIAL_STATIC_GRAPH':
			return 'Static Terraform graph coverage is partial; check Diagnostics for details.';
		case 'FINDING_LIMIT':
			return 'Validation findings reached the 200-item protocol cap.';
		case 'CANCELLED':
			return 'Run was cancelled before all checks finished.';
		default:
			return `Partial coverage gap: ${code}.`;
	}
}

function reasonFromCode(code: string | undefined, blockedByNames: readonly string[]): string | undefined {
	if (!code) {
		return undefined;
	}
	switch (code) {
		case 'DEPENDENCY_CYCLE':
			return 'Dependency cycle prevents deterministic ordering.';
		case 'PREREQUISITE_CYCLE':
			return blockedByNames.length > 0
				? `Blocked by upstream cycle: ${blockedByNames.join(', ')}.`
				: 'Blocked by an upstream dependency cycle.';
		case 'PREREQUISITE_FAILED':
			return blockedByNames.length > 0
				? `Blocked by prerequisite failure: ${blockedByNames.join(', ')}.`
				: 'Blocked by a failed prerequisite resource.';
		case 'UNRESOLVED_REFERENCE':
			return 'Contains an unresolved static Terraform reference.';
		case 'EXTERNAL_MODULE_UNVERIFIED':
			return 'External child module is not expanded offline.';
		default:
			return code;
	}
}

export interface MapValidationRunContext {
	readonly graph: CanvasGraphSnapshot;
	readonly scope: 'architecture' | 'resource';
	readonly targetNodeId: string | null;
	readonly attempt: number;
	readonly previousRunId: string | null;
	readonly startedAtMs: number;
	readonly accumulatedEvents: readonly ServicePollEvent[];
}

/** Projects a live Rust Stage 4 `pollValidationRun` snapshot and accumulated events into `ValidationRun`. */
export function mapServiceValidationPollToRun(
	poll: ServiceValidationPoll,
	ctx: MapValidationRunContext
): ValidationRun {
	const nodeById = new Map(ctx.graph.nodes.map(n => [n.id, n]));
	const analyzedNodeIds = ctx.scope === 'resource' && ctx.targetNodeId
		? collectPrerequisiteIds(ctx.graph, ctx.targetNodeId)
		: ctx.graph.nodes.map(n => n.id);
	const scopeSet = new Set(analyzedNodeIds);

	const findingsByNode = new Map<string, RunnerFinding[]>();
	const cycleNodeSet = new Set<string>();
	let findingIdx = 1;
	for (const f of poll.snapshotFindings ?? []) {
		if (f.nodeId && !scopeSet.has(f.nodeId)) {
			continue;
		}
		if (f.code === 'DEPENDENCY_CYCLE' && f.nodeId) {
			cycleNodeSet.add(f.nodeId);
		}
		if (f.nodeId) {
			let list = findingsByNode.get(f.nodeId);
			if (!list) {
				list = [];
				findingsByNode.set(f.nodeId, list);
			}
			list.push({
				id: `svc-f-${findingIdx++}`,
				nodeId: f.nodeId,
				code: f.code,
				severity: f.severity,
				message: f.message,
				remediation: findingRemediation(f.code),
			});
		}
	}

	const nodeResults: Record<string, RunnerNodeResult> = {};
	for (const nodeSnap of poll.snapshotNodes ?? []) {
		if (!scopeSet.has(nodeSnap.nodeId)) {
			continue;
		}
		if (nodeSnap.reasonCode === 'DEPENDENCY_CYCLE') {
			cycleNodeSet.add(nodeSnap.nodeId);
		}
		const blockerNames = nodeSnap.blockedBy.map(id => nodeById.get(id)?.name ?? id);
		const findings = findingsByNode.get(nodeSnap.nodeId) ?? [];
		const reason = reasonFromCode(nodeSnap.reasonCode, blockerNames)
			?? findings.find(f => f.severity === 'error')?.message;
		nodeResults[nodeSnap.nodeId] = {
			nodeId: nodeSnap.nodeId,
			status: nodeSnap.state,
			...(reason ? { reason } : {}),
			blockedBy: nodeSnap.blockedBy,
			findings,
			schemaCovered: true,
		};
	}

	const stageStatus: Record<RunnerStageId, { status: RunnerStageStatus; durationMs: number; detail: string }> = {
		read: { status: 'pending', durationMs: 0, detail: `Revision ${poll.sourceRevision.slice(0, 8)}` },
		dependencies: { status: 'pending', durationMs: 0, detail: 'Awaiting dependency analysis' },
		checks: { status: 'pending', durationMs: 0, detail: `${analyzedNodeIds.length} resource(s) in scope` },
	};

	const timelineEvents: RunnerTimelineEvent[] = [];
	for (const ev of ctx.accumulatedEvents.slice(-400)) {
		const stageId = mapServiceStage(ev.payload.stage);
		if (ev.kind === 'stageStarted') {
			stageStatus[stageId] = { ...stageStatus[stageId], status: 'running' };
			timelineEvents.push({
				sequence: ev.seq,
				timestampMs: ctx.startedAtMs + ev.elapsedMs,
				stage: stageId,
				nodeId: null,
				status: 'running',
				message: `Started stage ${String(ev.payload.stage ?? stageId)}.`,
			});
		} else if (ev.kind === 'stageFinished') {
			const rawStatus = ev.payload.status;
			const st: RunnerStageStatus = rawStatus === 'failed'
				? 'failed'
				: rawStatus === 'warning'
					? 'warning'
					: rawStatus === 'skipped'
						? 'skipped'
						: 'completed';
			const dur = isNonNegativeInt(ev.payload.durationMs) ? ev.payload.durationMs : ev.elapsedMs;
			stageStatus[stageId] = {
				status: st,
				durationMs: dur,
				detail: stageId === 'dependencies'
					? (cycleNodeSet.size > 0 ? `${cycleNodeSet.size} cycle member(s)` : 'Acyclic')
					: stageStatus[stageId].detail,
			};
			timelineEvents.push({
				sequence: ev.seq,
				timestampMs: ctx.startedAtMs + ev.elapsedMs,
				stage: stageId,
				nodeId: null,
				status: st,
				message: `Finished stage ${String(ev.payload.stage ?? stageId)} (${st}).`,
			});
		} else if (ev.kind === 'nodeUpdated') {
			const nid = isNonEmptyString(ev.payload.nodeId, 256) ? ev.payload.nodeId : null;
			if (nid && !scopeSet.has(nid)) {
				continue;
			}
			const st = parseNodeCheckState(ev.payload.state) ?? 'running';
			const label = nid ? (nodeById.get(nid)?.name ?? nid) : 'resource';
			timelineEvents.push({
				sequence: ev.seq,
				timestampMs: ctx.startedAtMs + ev.elapsedMs,
				stage: 'checks',
				nodeId: nid,
				status: st,
				message: `${label}: ${st}${isNonEmptyString(ev.payload.reasonCode, 128) ? ` (${ev.payload.reasonCode})` : ''}.`,
			});
		} else if (ev.kind === 'findingAdded') {
			const nid = isNonEmptyString(ev.payload.nodeId, 256) ? ev.payload.nodeId : null;
			if (nid && !scopeSet.has(nid)) {
				continue;
			}
			const sev = parseSeverity(ev.payload.severity);
			const msg = isNonEmptyString(ev.payload.message, 512) ? ev.payload.message : String(ev.payload.code ?? 'Finding');
			timelineEvents.push({
				sequence: ev.seq,
				timestampMs: ctx.startedAtMs + ev.elapsedMs,
				stage: 'checks',
				nodeId: nid,
				status: sev === 'error' ? 'failed' : sev === 'warning' ? 'warning' : 'success',
				message: msg,
			});
		} else if (ev.kind === 'runFinished') {
			const st: RunnerStageStatus = poll.state === 'failed'
				? 'failed'
				: poll.state === 'cancelled'
					? 'skipped'
					: poll.state === 'completedWithWarnings'
						? 'warning'
						: 'completed';
			timelineEvents.push({
				sequence: ev.seq,
				timestampMs: ctx.startedAtMs + ev.elapsedMs,
				stage: 'checks',
				nodeId: null,
				status: st,
				message: `Rust validation finished: ${mapServiceOutcome(poll.state).replace(/_/g, ' ')} (${poll.coverage} coverage).`,
			});
		}
	}

	const outcome = mapServiceOutcome(poll.state);
	const isTerminal = outcome !== 'running';
	if (isTerminal) {
		if (stageStatus.read.status === 'pending' || stageStatus.read.status === 'running') {
			stageStatus.read = { ...stageStatus.read, status: outcome === 'cancelled' ? 'skipped' : 'completed' };
		}
		if (stageStatus.dependencies.status === 'pending' || stageStatus.dependencies.status === 'running') {
			stageStatus.dependencies = {
				...stageStatus.dependencies,
				status: outcome === 'cancelled' ? 'skipped' : cycleNodeSet.size > 0 ? 'failed' : 'completed',
				detail: cycleNodeSet.size > 0 ? `${cycleNodeSet.size} cycle member(s)` : 'Acyclic',
			};
		}
		if (stageStatus.checks.status === 'pending' || stageStatus.checks.status === 'running') {
			stageStatus.checks = {
				...stageStatus.checks,
				status: outcome === 'cancelled'
					? 'skipped'
					: outcome === 'failed'
						? 'failed'
						: outcome === 'completed_with_warnings'
							? 'warning'
							: 'completed',
			};
		}
	}

	const stages: RunnerStageSummary[] = [
		{ id: 'read', label: 'Read Architecture (Rust)', ...stageStatus.read },
		{ id: 'dependencies', label: 'Map Dependencies (Rust)', ...stageStatus.dependencies },
		{ id: 'checks', label: 'Static Checks (Rust)', ...stageStatus.checks },
	];

	return {
		runId: poll.runId,
		attempt: ctx.attempt,
		previousRunId: ctx.previousRunId,
		scope: ctx.scope,
		targetNodeId: ctx.targetNodeId,
		analyzedNodeIds,
		workspaceId: poll.workspaceId,
		architectureId: poll.architectureId,
		capturedRevision: poll.sourceRevision,
		stale: false,
		outcome,
		coverage: poll.coverage,
		coverageNotes: poll.coverageGaps.map(describeCoverageGap),
		startedAtMs: ctx.startedAtMs,
		finishedAtMs: isTerminal ? ctx.startedAtMs + poll.elapsedMs : null,
		stages,
		nodeResults,
		cycleNodeIds: [...cycleNodeSet],
		events: timelineEvents,
	};
}

// ============================================================================
// Stage 5: Guarded Terraform Draft Save Adapters
// ============================================================================

export function parseDraftSavePreview(value: unknown): DraftSavePreviewResult | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.fileName, 255) ||
		typeof value.created !== 'boolean' ||
		!isSha256(value.sourceRevision) ||
		!isSha256(value.afterSha256) ||
		!isNonNegativeInt(value.addedLines) ||
		!isNonNegativeInt(value.removedLines) ||
		!Array.isArray(value.findings) ||
		!isNonEmptyString(value.previewToken, 256)
	) {
		return undefined;
	}
	if (value.beforeSha256 !== undefined && !isSha256(value.beforeSha256)) {
		return undefined;
	}
	const findings: DraftSaveFinding[] = [];
	for (const f of value.findings) {
		if (!isRecord(f) || !isNonEmptyString(f.code, 128) || !isNonEmptyString(f.file, 255)) {
			continue;
		}
		findings.push({
			code: f.code,
			file: f.file,
			...(isNonNegativeInt(f.line) ? { line: f.line } : {}),
		});
	}
	return {
		fileName: value.fileName,
		created: value.created,
		sourceRevision: value.sourceRevision,
		...(typeof value.beforeSha256 === 'string' ? { beforeSha256: value.beforeSha256 } : {}),
		afterSha256: value.afterSha256,
		addedLines: value.addedLines,
		removedLines: value.removedLines,
		findings,
		previewToken: value.previewToken,
		...(value.focused === true ? optionalMerge(value.merge) : {}),
	};
}

function addressList(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.length > 2048) {
		return undefined;
	}
	return value.filter((item): item is string => isNonEmptyString(item, 512));
}

/** Validates the `merge` summary of a focused save preview; a malformed summary is dropped. */
function optionalMerge(value: unknown): { merge?: DraftSaveMergeSummary } {
	if (!isRecord(value) || !isNonNegativeInt(value.unchanged) || !isNonNegativeInt(value.preserved)) {
		return {};
	}
	const updated = addressList(value.updated);
	const added = addressList(value.added);
	const removed = addressList(value.removed);
	const skipped = addressList(value.skipped);
	if (!updated || !added || !removed || !skipped) {
		return {};
	}
	const renamed = Array.isArray(value.renamed)
		? value.renamed.slice(0, 256).filter((item): item is { from: string; to: string } => isRecord(item) && isNonEmptyString(item.from, 512) && isNonEmptyString(item.to, 512)).map(({ from, to }) => ({ from, to }))
		: [];
	return { merge: { updated, added, removed, unchanged: value.unchanged, preserved: value.preserved, skipped, renamed } };
}

export function parseDraftSaveApply(value: unknown): DraftSaveApplyResult | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.fileName, 255) ||
		typeof value.created !== 'boolean' ||
		!isSha256(value.newSourceRevision) ||
		!isNonNegativeInt(value.bytesWritten)
	) {
		return undefined;
	}
	return {
		fileName: value.fileName,
		created: value.created,
		newSourceRevision: value.newSourceRevision,
		bytesWritten: value.bytesWritten,
	};
}

function parseFindings(value: unknown[]): DraftSaveFinding[] {
	const findings: DraftSaveFinding[] = [];
	for (const f of value) {
		if (!isRecord(f) || !isNonEmptyString(f.code, 128) || !isNonEmptyString(f.file, 255)) {
			continue;
		}
		findings.push({ code: f.code, file: f.file, ...(isNonNegativeInt(f.line) ? { line: f.line } : {}) });
	}
	return findings;
}

/** `previewFocusedSaveBatch` result: every file merged, one token for all of them. */
export function parseSaveAllPreview(value: unknown): SaveAllPreviewResult | undefined {
	if (!isRecord(value) || !isSha256(value.sourceRevision) || !isNonEmptyString(value.previewToken, 256) || !Array.isArray(value.files) || value.files.length > 16) {
		return undefined;
	}
	const files: SaveAllPreviewFile[] = [];
	for (const file of value.files) {
		if (
			!isRecord(file) ||
			!isNonEmptyString(file.fileName, 255) ||
			typeof file.created !== 'boolean' ||
			typeof file.changed !== 'boolean' ||
			!isNonNegativeInt(file.addedLines) ||
			!isNonNegativeInt(file.removedLines) ||
			!Array.isArray(file.findings)
		) {
			return undefined;
		}
		files.push({
			fileName: file.fileName,
			created: file.created,
			changed: file.changed,
			addedLines: file.addedLines,
			removedLines: file.removedLines,
			findings: parseFindings(file.findings),
			...optionalMerge(file.merge),
		});
	}
	return { sourceRevision: value.sourceRevision, files, previewToken: value.previewToken };
}

export function parseSaveAllApply(value: unknown): SaveAllApplyResult | undefined {
	if (!isRecord(value) || !isSha256(value.newSourceRevision) || !Array.isArray(value.files) || value.files.length > 16) {
		return undefined;
	}
	const files: { fileName: string; created: boolean; bytesWritten: number }[] = [];
	for (const file of value.files) {
		if (!isRecord(file) || !isNonEmptyString(file.fileName, 255) || typeof file.created !== 'boolean' || !isNonNegativeInt(file.bytesWritten)) {
			return undefined;
		}
		files.push({ fileName: file.fileName, created: file.created, bytesWritten: file.bytesWritten });
	}
	return { files, newSourceRevision: value.newSourceRevision };
}

export function draftSaveErrorMessage(code: string): DraftSaveError {
	switch (code) {
		case 'SCOPE_DENIED':
			return {
				code,
				message: 'Imported repositories are read-only in CloudForge. Save changes in a local project architecture or edit the repository in source control.',
			};
		case 'STALE_SOURCE':
			return {
				code,
				message: 'The Terraform files changed on disk since this graph was loaded. Refresh the graph before previewing and saving.',
			};
		case 'UNSUPPORTED_FORMAT':
			return {
				code,
				message: 'The generated HCL did not pass Terraform syntax validation. Fix the highlighted resource fields and preview again.',
			};
		case 'INVALID_STATE':
			return {
				code,
				message: 'The save preview expired or no longer matches these changes. Run Preview Save again before applying.',
			};
		case 'LIMIT_EXCEEDED':
			return {
				code,
				message: 'The generated Terraform file exceeds the 512 KiB guarded save limit.',
			};
		case 'INVALID_PARAMS':
			return {
				code,
				message: 'Enter a single top-level .tf filename (letters, numbers, underscores, hyphens, or dots, not starting with a dot).',
			};
		default:
			return {
				code,
				message: 'The CloudForge service could not save this draft.',
			};
	}
}

// ============================================================================
// Stage 6: Offline Provider Dependencies & Cloud Region Metadata Adapters
// ============================================================================

export function parseCloudRegionsPayload(value: unknown): CanvasCloudRegionsPayload | undefined {
	if (
		!isRecord(value) ||
		(value.provider !== 'azure' && value.provider !== 'aws' && value.provider !== 'google') ||
		(value.source !== 'authenticatedScopeApi' && value.source !== 'bundledPublicFallback') ||
		!isNonEmptyString(value.refreshedAt, 64) ||
		typeof value.stale !== 'boolean' ||
		typeof value.isFallback !== 'boolean' ||
		!Array.isArray(value.regions)
	) {
		return undefined;
	}
	const regions: CanvasCloudRegion[] = [];
	for (const entry of value.regions) {
		if (!isRecord(entry) || !isNonEmptyString(entry.name, 128) || !isNonEmptyString(entry.displayName, 256)) {
			continue;
		}
		const availabilityZones = Array.isArray(entry.availabilityZones)
			? entry.availabilityZones.filter((z): z is string => isNonEmptyString(z, 64))
			: [];
		regions.push({
			name: entry.name,
			displayName: entry.displayName,
			availabilityZones,
			...(isNonEmptyString(entry.geography, 128) ? { geography: entry.geography } : {}),
		});
	}
	return {
		provider: value.provider,
		source: value.source,
		refreshedAt: value.refreshedAt,
		stale: value.stale,
		isFallback: value.isFallback,
		regions,
	};
}

export function parseDependencyReport(value: unknown): CanvasDependencyReport | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	// The service serializes EngineName as openTofu; keep the existing Studio spelling.
	const engine = value.engine === 'openTofu' ? 'opentofu' : value.engine;
	if (
		!isSha256(value.sourceRevision) ||
		(engine !== 'opentofu' && engine !== 'terraform') ||
		typeof value.engineInferred !== 'boolean' ||
		!isRecord(value.lockFile) ||
		!Array.isArray(value.providers)
	) {
		return undefined;
	}
	const lockState = value.lockFile.state;
	if (lockState !== 'absent' && lockState !== 'valid' && lockState !== 'invalid' && lockState !== 'unreadable') {
		return undefined;
	}
	const providers: CanvasProviderDependency[] = [];
	for (const item of value.providers) {
		if (!isRecord(item) || !isNonEmptyString(item.display, 256)) {
			continue;
		}
		const status = item.status;
		if (
			status !== 'locked' &&
			status !== 'unlocked' &&
			status !== 'lockOutsideConstraints' &&
			status !== 'noMatchingRelease' &&
			status !== 'conflict'
		) {
			continue;
		}
		const lockedVersion = isRecord(item.lock) && isNonEmptyString(item.lock.version, 128)
			? item.lock.version
			: undefined;
		const conflictCount = Array.isArray(item.conflicts) ? item.conflicts.length : 0;
		const requirementCount = Array.isArray(item.requirements) ? item.requirements.length : 0;
		providers.push({
			display: item.display,
			...(isNonEmptyString(item.address, 256) && /^[a-z0-9.-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(item.address) ? { address: item.address.toLowerCase() } : {}),
			status,
			...(lockedVersion ? { lockedVersion } : {}),
			conflictCount,
			requirementCount,
			...(isNonEmptyString(item.combined, 512) ? { constraint: item.combined } : {}),
		});
	}
	const unusedLockEntries = Array.isArray(value.unusedLockEntries)
		? value.unusedLockEntries.filter((e): e is string => isNonEmptyString(e, 256))
		: [];
	const diagnosticCount = Array.isArray(value.diagnostics) ? value.diagnostics.length : 0;
	return {
		sourceRevision: value.sourceRevision,
		engine,
		engineInferred: value.engineInferred,
		lockState,
		lockEntries: Array.isArray(value.lockFile.entries) ? value.lockFile.entries.filter((entry): entry is { address: string; version: string } => isRecord(entry) && isNonEmptyString(entry.address, 256) && /^[a-z0-9.-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(entry.address) && isNonEmptyString(entry.version, 128)).map(entry => ({ address: entry.address.toLowerCase(), version: entry.version })) : [],
		providers,
		unusedLockEntries,
		diagnosticCount,
	};
}

// ============================================================================
// Stage 7: Guarded Child Module Drill-Down & Typed I/O Adapter
// ============================================================================

function parseChildModuleGraph(raw: unknown, architectureName: string): CanvasGraphSnapshot | null {
	if (
		!isRecord(raw) ||
		!isNonEmptyString(raw.workspaceId, 256) ||
		!isNonEmptyString(raw.architectureId, 256) ||
		!isSha256(raw.sourceRevision) ||
		(raw.status !== 'complete' && raw.status !== 'partial') ||
		!Array.isArray(raw.nodes) ||
		!Array.isArray(raw.edges) ||
		!Array.isArray(raw.diagnostics)
	) {
		return null;
	}
	const nodes: CanvasNodeSummary[] = [];
	for (const item of raw.nodes) {
		if (!isRecord(item) || !isNonEmptyString(item.id, 256) || !isNonEmptyString(item.kind, 64) || !isNonEmptyString(item.name, 256) || !isNonEmptyString(item.label, 512)) {
			continue;
		}
		const resourceType = isNonEmptyString(item.resourceType, 256) ? item.resourceType : null;
		nodes.push({
			id: item.id,
			kind: item.kind,
			resourceType,
			name: item.name,
			label: item.label,
			// Child module sources live in a sub-root; keep openSource disabled to preserve root source-navigation invariants.
			hasSource: false,
		});
	}
	const edges: CanvasEdgeSummary[] = [];
	for (const edge of raw.edges) {
		if (!isRecord(edge) || !isNonEmptyString(edge.kind, 64)) {
			continue;
		}
		const rawFrom = isNonEmptyString(edge.from, 256) ? edge.from : isNonEmptyString(edge.fromId, 256) ? edge.fromId : undefined;
		const rawTo = isNonEmptyString(edge.to, 256) ? edge.to : isNonEmptyString(edge.toId, 256) ? edge.toId : undefined;
		if (!rawFrom || !rawTo) {
			continue;
		}
		const kindLower = edge.kind.toLowerCase();
		if (kindLower === 'reference' || kindLower === 'explicit') {
			edges.push({ fromId: rawTo, toId: rawFrom, kind: edge.kind });
		} else {
			edges.push({ fromId: rawFrom, toId: rawTo, kind: edge.kind });
		}
	}
	const diagnostics: CanvasDiagnosticSummary[] = [];
	for (const diag of raw.diagnostics) {
		if (!isRecord(diag) || !isNonEmptyString(diag.code, 128) || !isNonEmptyString(diag.severity, 32) || !isSafeString(diag.message, 1024)) {
			continue;
		}
		diagnostics.push({ code: diag.code, severity: diag.severity, message: diag.message });
	}
	return {
		workspaceId: raw.workspaceId,
		architectureId: raw.architectureId,
		architectureName,
		sourceRevision: raw.sourceRevision,
		status: raw.status,
		nodes,
		edges,
		diagnostics,
	};
}

export function parseModuleInspection(value: unknown, architectureName: string): CanvasModuleInspection | undefined {
	if (
		!isRecord(value) ||
		(value.status !== 'local' && value.status !== 'external') ||
		(value.sourceKind !== 'local' && value.sourceKind !== 'registry' && value.sourceKind !== 'git' && value.sourceKind !== 'remote') ||
		!isNonEmptyString(value.source, 256) ||
		!Array.isArray(value.modulePath) ||
		value.modulePath.length === 0 ||
		value.modulePath.length > 8
	) {
		return undefined;
	}
	const modulePath: string[] = [];
	for (const seg of value.modulePath) {
		if (!isNonEmptyString(seg, 128) || !/^[A-Za-z0-9_-]+$/.test(seg)) {
			return undefined;
		}
		modulePath.push(seg);
	}
	const passedInputs = Array.isArray(value.passedInputs)
		? value.passedInputs.filter((item): item is string => isNonEmptyString(item, 128))
		: [];
	const variables: CanvasModuleVariable[] = [];
	if (Array.isArray(value.variables)) {
		for (const item of value.variables) {
			if (!isRecord(item) || !isNonEmptyString(item.name, 128) || typeof item.required !== 'boolean' || typeof item.sensitive !== 'boolean' || typeof item.hasDefault !== 'boolean') {
				continue;
			}
			variables.push({
				name: item.name,
				...(isNonEmptyString(item.typeExpr, 256) ? { typeExpr: item.typeExpr } : {}),
				...(isNonEmptyString(item.description, 512) ? { description: item.description } : {}),
				required: item.required,
				sensitive: item.sensitive,
				hasDefault: item.hasDefault,
			});
		}
	}
	const outputs: CanvasModuleOutput[] = [];
	if (Array.isArray(value.outputs)) {
		for (const item of value.outputs) {
			if (!isRecord(item) || !isNonEmptyString(item.name, 128) || typeof item.sensitive !== 'boolean') {
				continue;
			}
			outputs.push({
				name: item.name,
				...(isNonEmptyString(item.description, 512) ? { description: item.description } : {}),
				sensitive: item.sensitive,
			});
		}
	}
	const childModules: CanvasChildModuleRef[] = [];
	if (Array.isArray(value.childModules)) {
		for (const item of value.childModules) {
			if (!isRecord(item) || !isNonEmptyString(item.name, 128) || !isNonEmptyString(item.source, 256) || typeof item.isLocal !== 'boolean') {
				continue;
			}
			childModules.push({
				name: item.name,
				source: item.source,
				isLocal: item.isLocal,
			});
		}
	}
	const moduleLabel = `${architectureName} / module.${modulePath.join('.')}`;
	const graph = value.status === 'local' ? parseChildModuleGraph(value.graph, moduleLabel) : null;
	const moduleRevision = isSha256(value.moduleRevision) ? value.moduleRevision : undefined;

	return {
		modulePath,
		status: value.status,
		sourceKind: value.sourceKind,
		source: value.source,
		...(moduleRevision ? { moduleRevision } : {}),
		passedInputs,
		variables,
		outputs,
		childModules,
		graph,
	};
}

// ============================================================================
// Stage 8: Schema Upgrade Impact Diff & Reproducible Export Readiness Adapters
// ============================================================================

export function parseSchemaDiffReport(value: unknown): CanvasSchemaDiffReport | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.provider, 256) ||
		!isNonEmptyString(value.fromVersion, 128) ||
		!isNonEmptyString(value.toVersion, 128) ||
		!Array.isArray(value.addedTypes) ||
		!Array.isArray(value.removedTypes) ||
		!Array.isArray(value.pathChanges) ||
		!Array.isArray(value.impactedArchitectureItems) ||
		typeof value.hasBreakingChanges !== 'boolean' ||
		typeof value.hasArchitectureBreakingChanges !== 'boolean' ||
		typeof value.truncated !== 'boolean'
	) {
		return undefined;
	}
	const impactedArchitectureItems: CanvasSchemaImpactedItem[] = [];
	for (const item of value.impactedArchitectureItems) {
		if (
			!isRecord(item) ||
			!isNonEmptyString(item.resourceAddress, 256) ||
			(item.kind !== 'resource' && item.kind !== 'dataSource') ||
			!isNonEmptyString(item.typeName, 256) ||
			typeof item.breaking !== 'boolean' ||
			!isNonEmptyString(item.summary, 512)
		) {
			continue;
		}
		impactedArchitectureItems.push({
			resourceAddress: item.resourceAddress,
			kind: item.kind,
			typeName: item.typeName,
			...(isNonEmptyString(item.path, 256) ? { path: item.path } : {}),
			breaking: item.breaking,
			summary: item.summary,
		});
	}
	return {
		provider: value.provider,
		fromVersion: value.fromVersion,
		toVersion: value.toVersion,
		addedTypeCount: value.addedTypes.length,
		removedTypeCount: value.removedTypes.length,
		pathChangeCount: value.pathChanges.length,
		impactedArchitectureItems,
		hasBreakingChanges: value.hasBreakingChanges,
		hasArchitectureBreakingChanges: value.hasArchitectureBreakingChanges,
		truncated: value.truncated,
	};
}

export function parseExportAuditReport(value: unknown): CanvasExportAuditReport | undefined {
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'openTofu' && value.engine !== 'terraform') ||
		typeof value.engineInferred !== 'boolean' ||
		typeof value.reproducible !== 'boolean' ||
		!isRecord(value.lockFile) ||
		!Array.isArray(value.moduleProvenance) ||
		!Array.isArray(value.unresolvedReasons)
	) {
		return undefined;
	}
	const lockState = value.lockFile.state;
	if (lockState !== 'absent' && lockState !== 'valid' && lockState !== 'invalid' && lockState !== 'unreadable') {
		return undefined;
	}
	const lockEntryCount = Array.isArray(value.lockFile.entries) ? value.lockFile.entries.length : 0;
	const unresolvedReasonKinds: string[] = [];
	for (const reason of value.unresolvedReasons) {
		if (isRecord(reason) && isNonEmptyString(reason.kind, 64)) {
			unresolvedReasonKinds.push(reason.kind);
		}
	}
	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineInferred: value.engineInferred,
		reproducible: value.reproducible,
		lockState,
		lockEntryCount,
		moduleCount: value.moduleProvenance.length,
		unresolvedReasonKinds,
	};
}

// ============================================================================
// Stage 9A: Local Engine Discovery & Managed `validate -json` Adapters
// ============================================================================

export function parseDetectedEngines(value: unknown): readonly CanvasDetectedEngine[] {
	if (!isRecord(value) || !Array.isArray(value.engines)) {
		return [];
	}
	const engines: CanvasDetectedEngine[] = [];
	for (const entry of value.engines) {
		if (
			!isRecord(entry) ||
			(entry.engine !== 'openTofu' && entry.engine !== 'terraform') ||
			(entry.status !== 'available' && entry.status !== 'missing' && entry.status !== 'failed')
		) {
			continue;
		}
		engines.push({
			engine: entry.engine,
			status: entry.status,
			...(isNonEmptyString(entry.version, 64) ? { version: entry.version } : {}),
			...(isNonEmptyString(entry.platform, 64) ? { platform: entry.platform } : {}),
			...(isNonEmptyString(entry.message, 256) ? { message: entry.message } : {}),
		});
	}
	return engines;
}

export function parseEngineValidateReport(value: unknown): CanvasEngineValidateReport | undefined {
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'openTofu' && value.engine !== 'terraform') ||
		!isNonEmptyString(value.engineVersion, 64) ||
		typeof value.engineInferred !== 'boolean' ||
		typeof value.valid !== 'boolean' ||
		typeof value.errorCount !== 'number' || !Number.isSafeInteger(value.errorCount) || value.errorCount < 0 ||
		typeof value.warningCount !== 'number' || !Number.isSafeInteger(value.warningCount) || value.warningCount < 0 ||
		typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
		!Array.isArray(value.diagnostics) ||
		typeof value.truncated !== 'boolean'
	) {
		return undefined;
	}
	const diagnostics: CanvasEngineValidateDiagnostic[] = [];
	for (const item of value.diagnostics) {
		if (
			!isRecord(item) ||
			(item.severity !== 'error' && item.severity !== 'warning') ||
			!isNonEmptyString(item.summary, 300)
		) {
			continue;
		}
		const line = typeof item.line === 'number' && Number.isSafeInteger(item.line) && item.line >= 1 ? item.line : undefined;
		const column = typeof item.column === 'number' && Number.isSafeInteger(item.column) && item.column >= 1 ? item.column : undefined;
		diagnostics.push({
			severity: item.severity,
			summary: item.summary,
			...(isNonEmptyString(item.detail, 600) ? { detail: item.detail } : {}),
			...(isNonEmptyString(item.address, 256) ? { address: item.address } : {}),
			...(isNonEmptyString(item.filename, 255) ? { filename: item.filename } : {}),
			...(line !== undefined ? { line } : {}),
			...(column !== undefined ? { column } : {}),
		});
	}
	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineVersion: value.engineVersion,
		engineInferred: value.engineInferred,
		valid: value.valid,
		errorCount: value.errorCount,
		warningCount: value.warningCount,
		durationMs: value.durationMs,
		diagnostics,
		truncated: value.truncated,
	};
}

const paletteProviders: Readonly<Record<string, CanvasCatalogueTypes['provider']>> = { azurerm: 'azure', aws: 'aws', google: 'gcp' };

/** The newest snapshot for each palette provider (azurerm, aws, google), keyed by Studio provider. */
export function newestPaletteSnapshots(snapshots: readonly CanvasCatalogueSnapshot[]): { readonly provider: CanvasCatalogueTypes['provider']; readonly snapshot: CanvasCatalogueSnapshot }[] {
	const best = new Map<CanvasCatalogueTypes['provider'], CanvasCatalogueSnapshot>();
	for (const snapshot of snapshots) {
		const segments = snapshot.address.toLowerCase().split('/');
		const provider = segments.length === 3 ? paletteProviders[segments[2]] : undefined;
		if (!provider) {
			continue;
		}
		const current = best.get(provider);
		if (!current || compareSemverDescending(snapshot.version, current.version) < 0) {
			best.set(provider, snapshot);
		}
	}
	return [...best].map(([provider, snapshot]) => ({ provider, snapshot }));
}

/** Validates a `listCatalogueTypes` result into palette types (resources only, bounded). */
export function parseCatalogueTypes(value: unknown, provider: CanvasCatalogueTypes['provider'], version: string): CanvasCatalogueTypes | undefined {
	if (typeof value !== 'object' || value === null || !Array.isArray((value as { resources?: unknown }).resources)) {
		return undefined;
	}
	const resources = ((value as { resources: unknown[] }).resources)
		.filter((type): type is string => typeof type === 'string' && /^[a-z0-9_]{1,128}$/.test(type))
		.slice(0, 5000);
	return { provider, version, resources };
}

/** Validates one type's `getCatalogueCoverage` result; at most 20 gaps are kept for display. */
export function parseFormCoverage(value: unknown): FormCoverage | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const raw = value as { complete?: unknown; paths?: unknown; readOnly?: unknown; gaps?: unknown };
	const count = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
	if (typeof raw.complete !== 'boolean' || !count(raw.paths) || !count(raw.readOnly) || !Array.isArray(raw.gaps)) {
		return undefined;
	}
	const gaps = raw.gaps
		.filter((gap): gap is { path: string; reason: string } => typeof gap === 'object' && gap !== null && typeof (gap as { path?: unknown }).path === 'string' && typeof (gap as { reason?: unknown }).reason === 'string')
		.slice(0, 20)
		.map(gap => ({ path: gap.path.slice(0, 256), reason: gap.reason.slice(0, 512) }));
	return { complete: raw.complete, paths: raw.paths as number, readOnly: raw.readOnly as number, gaps };
}

/** Validates a `renderResourceDraft` result; anything malformed returns undefined. */
export function parseSchemaPreview(value: unknown, resourceId: string, providerVersion: string): CanvasSchemaPreview | undefined {
	if (!isRecord(value) || typeof value.hcl !== 'string' || value.hcl.length > 256 * 1024 || !Array.isArray(value.diagnostics)) {
		return undefined;
	}
	const diagnostics: { path: string; message: string; severity: 'error' | 'warning' }[] = [];
	for (const item of value.diagnostics.slice(0, 200)) {
		if (isRecord(item) && typeof item.path === 'string' && item.path.length <= 512 && isNonEmptyString(item.message, 1024) && (item.severity === 'error' || item.severity === 'warning')) {
			diagnostics.push({ path: item.path, message: item.message, severity: item.severity });
		}
	}
	return {
		resourceId,
		hcl: value.hcl,
		diagnostics,
		hasErrors: value.hasErrors === true || diagnostics.some(item => item.severity === 'error'),
		providerVersion,
	};
}

// ============================================================================
// Stage 9B: Guarded Local Engine Plan Capture (`runEnginePlan`) Adapters
// ============================================================================

const PLAN_ACTIONS: ReadonlySet<string> = new Set(['no-op', 'create', 'read', 'update', 'delete']);
const PLAN_ACTION_KINDS: ReadonlySet<string> = new Set<CanvasEnginePlanActionKind>(['create', 'update', 'replace', 'delete', 'read', 'no-op']);
const MAX_PLAN_RESOURCE_CHANGES = 500;
const MAX_PLAN_OUTPUT_CHANGES = 200;
const MAX_PLAN_CHANGED_PATHS = 64;
const MAX_PLAN_DIAGNOSTICS = 100;

function parsePlanSummary(value: unknown): CanvasEnginePlanSummary | undefined {
	if (
		!isRecord(value) ||
		!isNonNegativeInt(value.create) ||
		!isNonNegativeInt(value.update) ||
		!isNonNegativeInt(value.replace) ||
		!isNonNegativeInt(value.delete) ||
		!isNonNegativeInt(value.read) ||
		!isNonNegativeInt(value.noOp) ||
		!isNonNegativeInt(value.total)
	) {
		return undefined;
	}
	return {
		create: value.create,
		update: value.update,
		replace: value.replace,
		delete: value.delete,
		read: value.read,
		noOp: value.noOp,
		total: value.total,
	};
}

function parsePlanActions(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return ['no-op'];
	}
	const out: string[] = [];
	for (const item of value.slice(0, 4)) {
		if (typeof item === 'string' && PLAN_ACTIONS.has(item)) {
			out.push(item);
		}
	}
	return out.length > 0 ? out : ['no-op'];
}

function parseValidateDiagnostics(raw: readonly unknown[], limit: number): CanvasEngineValidateDiagnostic[] {
	const diagnostics: CanvasEngineValidateDiagnostic[] = [];
	for (const item of raw.slice(0, limit)) {
		if (
			!isRecord(item) ||
			(item.severity !== 'error' && item.severity !== 'warning') ||
			!isNonEmptyString(item.summary, 300)
		) {
			continue;
		}
		const line = typeof item.line === 'number' && Number.isSafeInteger(item.line) && item.line >= 1 ? item.line : undefined;
		const column = typeof item.column === 'number' && Number.isSafeInteger(item.column) && item.column >= 1 ? item.column : undefined;
		diagnostics.push({
			severity: item.severity,
			summary: item.summary,
			...(isNonEmptyString(item.detail, 600) ? { detail: item.detail } : {}),
			...(isNonEmptyString(item.address, 256) ? { address: item.address } : {}),
			...(isNonEmptyString(item.filename, 255) ? { filename: item.filename } : {}),
			...(line !== undefined ? { line } : {}),
			...(column !== undefined ? { column } : {}),
		});
	}
	return diagnostics;
}

/**
 * Strictly parses a Rust Stage 9B `runEnginePlan` response, allowing only structural action
 * summaries, top-level changed attribute names, sensitivity booleans, and sanitized diagnostics.
 */
export function parseEnginePlanReport(value: unknown): CanvasEnginePlanReport | undefined {
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'openTofu' && value.engine !== 'terraform') ||
		!isNonEmptyString(value.engineVersion, 64) ||
		typeof value.engineInferred !== 'boolean' ||
		(value.status !== 'planned' && value.status !== 'failed') ||
		typeof value.errored !== 'boolean' ||
		!isNonNegativeInt(value.durationMs) ||
		!Array.isArray(value.resourceChanges) ||
		!Array.isArray(value.outputChanges) ||
		!Array.isArray(value.diagnostics) ||
		typeof value.truncated !== 'boolean'
	) {
		return undefined;
	}
	const summary = parsePlanSummary(value.summary);
	if (!summary) {
		return undefined;
	}

	const resourceChanges: CanvasEnginePlanResourceChange[] = [];
	for (const item of value.resourceChanges.slice(0, MAX_PLAN_RESOURCE_CHANGES)) {
		if (
			!isRecord(item) ||
			!isNonEmptyString(item.address, 256) ||
			(item.mode !== 'managed' && item.mode !== 'data') ||
			!isNonEmptyString(item.typeName, 128) ||
			!isNonEmptyString(item.name, 128) ||
			typeof item.actionKind !== 'string' || !PLAN_ACTION_KINDS.has(item.actionKind) ||
			typeof item.hasSensitiveAttributes !== 'boolean'
		) {
			continue;
		}
		const changedAttributePaths: string[] = [];
		if (Array.isArray(item.changedAttributePaths)) {
			for (const path of item.changedAttributePaths.slice(0, MAX_PLAN_CHANGED_PATHS)) {
				if (isNonEmptyString(path, 128)) {
					changedAttributePaths.push(path);
				}
			}
		}
		resourceChanges.push({
			address: item.address,
			...(isNonEmptyString(item.moduleAddress, 256) ? { moduleAddress: item.moduleAddress } : {}),
			mode: item.mode,
			typeName: item.typeName,
			name: item.name,
			...(isNonEmptyString(item.providerName, 256) ? { providerName: item.providerName } : {}),
			actions: parsePlanActions(item.actions),
			actionKind: item.actionKind as CanvasEnginePlanActionKind,
			hasSensitiveAttributes: item.hasSensitiveAttributes,
			changedAttributePaths,
		});
	}

	const outputChanges: CanvasEnginePlanOutputChange[] = [];
	for (const item of value.outputChanges.slice(0, MAX_PLAN_OUTPUT_CHANGES)) {
		if (
			!isRecord(item) ||
			!isNonEmptyString(item.name, 128) ||
			typeof item.sensitive !== 'boolean'
		) {
			continue;
		}
		outputChanges.push({
			name: item.name,
			actions: parsePlanActions(item.actions),
			sensitive: item.sensitive,
		});
	}

	const diagnostics = parseValidateDiagnostics(value.diagnostics, MAX_PLAN_DIAGNOSTICS);
	const formatVersion = isNonEmptyString(value.formatVersion, 32) ? value.formatVersion : undefined;

	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineVersion: value.engineVersion,
		engineInferred: value.engineInferred,
		status: value.status,
		...(formatVersion ? { formatVersion } : {}),
		errored: value.errored,
		durationMs: value.durationMs,
		summary,
		resourceChanges,
		outputChanges,
		diagnostics,
		truncated: value.truncated || value.resourceChanges.length > MAX_PLAN_RESOURCE_CHANGES || value.outputChanges.length > MAX_PLAN_OUTPUT_CHANGES,
	};
}

/** Formats a zero-secret structural plan report for the CloudForge Plan output channel. */
export function formatEnginePlanReportText(report: CanvasEnginePlanReport, architectureName: string): string {
	const engineLabel = report.engine === 'openTofu' ? 'OpenTofu' : 'Terraform';
	const lines: string[] = [
		`CloudForge Local Plan (${architectureName})`,
		`Engine: ${engineLabel} ${report.engineVersion}${report.engineInferred ? ' (inferred)' : ''} · rev ${report.sourceRevision.slice(0, 8)} · ${report.durationMs} ms`,
		`Status: ${report.status === 'planned' ? (report.errored ? 'planned (errored)' : 'planned') : 'failed'} (credential-free, -refresh=false -lock=false, zero workspace files written)`,
	];
	if (report.status === 'planned') {
		const s = report.summary;
		lines.push(`Summary: +${s.create} create · ~${s.update} update · +/-${s.replace} replace · -${s.delete} delete · ${s.read} read · ${s.noOp} no-op (${s.total} total)`);
		if (report.resourceChanges.length > 0) {
			lines.push('', 'Resource changes:');
			for (const rc of report.resourceChanges) {
				const attrs = rc.changedAttributePaths.length > 0 ? ` [${rc.changedAttributePaths.join(', ')}]` : '';
				const sens = rc.hasSensitiveAttributes ? ' (sensitive attributes redacted)' : '';
				lines.push(`  [${rc.actionKind}] ${rc.address}${attrs}${sens}`);
			}
		}
		if (report.outputChanges.length > 0) {
			lines.push('', 'Output changes:');
			for (const out of report.outputChanges) {
				const sens = out.sensitive ? ' (sensitive)' : '';
				lines.push(`  [${out.actions.join('/')}] output.${out.name}${sens}`);
			}
		}
	}
	if (report.diagnostics.length > 0) {
		lines.push('', 'Diagnostics:');
		for (const diag of report.diagnostics) {
			const loc = diag.filename ? ` (${diag.filename}${diag.line ? `:${diag.line}` : ''})` : '';
			lines.push(`  [${diag.severity}] ${diag.summary}${loc}${diag.detail ? ` — ${diag.detail}` : ''}`);
		}
	}
	if (report.truncated) {
		lines.push('', 'Note: Plan output exceeded service bounds and was truncated.');
	}
	return lines.join('\n') + '\n';
}

// ============================================================================
// Stage 10: Offline Provider Mirror, Offline Init, & Mirror Schema Extraction
// ============================================================================

function parseMirrorPackageKey(value: unknown): CanvasMirrorPackageKey | undefined {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.address, 256) ||
		!isNonEmptyString(value.version, 64) ||
		!isNonEmptyString(value.platform, 64)
	) {
		return undefined;
	}
	return {
		address: value.address,
		version: value.version,
		platform: value.platform,
	};
}

export function parseMirrorPackages(value: unknown): readonly CanvasMirrorPackageSummary[] {
	if (!isRecord(value) || !Array.isArray(value.packages)) {
		return [];
	}
	const out: CanvasMirrorPackageSummary[] = [];
	for (const item of value.packages.slice(0, 512)) {
		if (
			!isRecord(item) ||
			!isNonNegativeInt(item.sizeBytes) ||
			!isSha256(item.sha256) ||
			!isNonEmptyString(item.recordedAt, 64)
		) {
			continue;
		}
		const key = parseMirrorPackageKey(item.key);
		if (!key) {
			continue;
		}
		out.push({
			key,
			sizeBytes: item.sizeBytes,
			sha256: item.sha256,
			recordedAt: item.recordedAt,
			...(isNonEmptyString(item.publisher, 128) ? { publisher: item.publisher } : {}),
		});
	}
	return out;
}

export function parseOfflineMirrorReadiness(value: unknown): CanvasOfflineMirrorReadiness | undefined {
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'openTofu' && value.engine !== 'terraform') ||
		typeof value.engineInferred !== 'boolean' ||
		(value.lockState !== 'absent' && value.lockState !== 'valid' && value.lockState !== 'invalid' && value.lockState !== 'unreadable') ||
		typeof value.isReady !== 'boolean' ||
		!Array.isArray(value.ready) ||
		!Array.isArray(value.missing) ||
		!Array.isArray(value.corrupted)
	) {
		return undefined;
	}
	const ready = value.ready.slice(0, 128).map(parseMirrorPackageKey).filter((k): k is CanvasMirrorPackageKey => k !== undefined);
	const missing = value.missing.slice(0, 128).map(parseMirrorPackageKey).filter((k): k is CanvasMirrorPackageKey => k !== undefined);
	const corrupted: CanvasCorruptedMirrorPackage[] = [];
	for (const item of value.corrupted.slice(0, 128)) {
		if (!isRecord(item) || !isNonEmptyString(item.reason, 256)) {
			continue;
		}
		const key = parseMirrorPackageKey(item.key);
		if (key) {
			corrupted.push({ key, reason: item.reason });
		}
	}
	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineInferred: value.engineInferred,
		lockState: value.lockState,
		isReady: value.isReady,
		ready,
		missing,
		corrupted,
	};
}

export function parseEngineInitOfflineReport(value: unknown): CanvasEngineInitOfflineReport | undefined {
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'openTofu' && value.engine !== 'terraform') ||
		!isNonEmptyString(value.engineVersion, 64) ||
		typeof value.engineInferred !== 'boolean' ||
		(value.status !== 'initialized' && value.status !== 'failed') ||
		typeof value.exitCode !== 'number' || !Number.isSafeInteger(value.exitCode) ||
		!isNonNegativeInt(value.durationMs) ||
		!isNonEmptyString(value.summary, 512)
	) {
		return undefined;
	}
	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineVersion: value.engineVersion,
		engineInferred: value.engineInferred,
		status: value.status,
		exitCode: value.exitCode,
		durationMs: value.durationMs,
		summary: value.summary,
		...(value.lockFileCreated === true ? { lockFileCreated: true } : {}),
	};
}
