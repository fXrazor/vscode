/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure TypeScript adapters translating CloudForge Rust service Stage 3 (provider catalogue),
// Stage 4 (offline validation runner), and Stage 5 (guarded Terraform draft save) JSON-RPC
// responses into sanitized Architecture Canvas view models. Zero runtime `vscode` or DOM imports.

import type {
	CanvasCatalogueSnapshot,
	CanvasChildModuleRef,
	CanvasCloudRegion,
	CanvasCloudRegionsPayload,
	CanvasDependencyReport,
	CanvasDetectedEngine,
	CanvasDiagnosticSummary,
	CanvasCatalogueTypes,
	CanvasEdgeSummary,
	CanvasEngineValidateDiagnostic,
	CanvasEngineValidateReport,
	CanvasExportAuditReport,
	CanvasGraphSnapshot,
	CanvasModuleInspection,
	CanvasModuleOutput,
	CanvasModuleVariable,
	CanvasNodeSummary,
	CanvasProviderDependency,
	CanvasSchemaDiffReport,
	CanvasSchemaImpactedItem,
	DraftSaveApplyResult,
	DraftSaveError,
	DraftSaveFinding,
	DraftSavePreviewResult
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

function mapRustValueType(editor: unknown, typeExpr: unknown): FieldValueType {
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
		const valueType = mapRustValueType(item.editor, item.typeExpr);
		const description = isSafeString(item.description, 2048) && item.description.trim().length > 0
			? item.description.trim()
			: `${item.name} (${valueType})`;
		attrs.push({
			name: item.name,
			path: item.path,
			access,
			valueType,
			description,
			...(item.sensitive === true ? { sensitive: true } : {}),
			...(item.deprecated === true ? { deprecated: true } : {}),
		});
	}
	return attrs;
}

function mapRustBlocks(raw: unknown): FormBlockType[] {
	if (!Array.isArray(raw)) {
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
	}
	return blocks;
}

function shortProviderSource(address: string): string {
	const segments = address.split('/');
	return segments.length === 3 ? `${segments[1]}/${segments[2]}` : address;
}

function providerDocsUrl(address: string, kind: SchemaKind, typeName: string): string {
	const source = shortProviderSource(address);
	const prefix = inferProviderTypePrefix(typeName);
	const slug = prefix && typeName.startsWith(`${prefix}_`) ? typeName.slice(prefix.length + 1) : typeName;
	const section = kind === 'dataSource' ? 'data-sources' : 'resources';
	return `https://registry.terraform.io/providers/${source}/latest/docs/${section}/${slug}`;
}

function buildMinimalExampleHcl(kind: SchemaKind, typeName: string, attributes: readonly FormAttribute[]): string {
	const keyword = kind === 'dataSource' ? 'data' : 'resource';
	const req = attributes.filter(a => a.access === 'required').slice(0, 4);
	const lines = [`${keyword} "${typeName}" "example" {`];
	for (const attr of req) {
		const sample = attr.valueType === 'bool'
			? 'true'
			: attr.valueType === 'number'
				? '1'
				: attr.valueType === 'listString'
					? '["example"]'
					: attr.valueType === 'mapString'
						? '{}'
						: '"example"';
		lines.push(`  ${attr.name} = ${sample}`);
	}
	lines.push('}');
	return lines.join('\n');
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
		docsUrl: bundledFallback?.docsUrl ?? providerDocsUrl(address, kind, typeName),
		exampleHcl: bundledFallback?.exampleHcl ?? buildMinimalExampleHcl(kind, typeName, attributes),
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
	};
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
	if (
		!isRecord(value) ||
		!isSha256(value.sourceRevision) ||
		(value.engine !== 'opentofu' && value.engine !== 'terraform') ||
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
			status,
			...(lockedVersion ? { lockedVersion } : {}),
			conflictCount,
			requirementCount,
		});
	}
	const unusedLockEntries = Array.isArray(value.unusedLockEntries)
		? value.unusedLockEntries.filter((e): e is string => isNonEmptyString(e, 256))
		: [];
	const diagnosticCount = Array.isArray(value.diagnostics) ? value.diagnostics.length : 0;
	return {
		sourceRevision: value.sourceRevision,
		engine: value.engine,
		engineInferred: value.engineInferred,
		lockState,
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
