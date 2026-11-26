/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure bidirectional adapter between the CloudForge Rust service's sanitized graph/validation
 * snapshots (`CanvasGraphSnapshot`, `ValidationRun`, `CanvasEngineValidateReport`) and
 * CloudForge Studio's single `Architecture` model.
 *
 * Guarantees:
 * - Preserves opaque Rust node IDs 1:1 so selection, Open Source, and validation findings match.
 * - Suggests visual grouping from graph edges without claiming provider ownership.
 * - Preserves field bindings created in Studio; summary graph edges do not identify field paths.
 * - Preserves user-positioned node coordinates across live `sourceRevision` refreshes.
 * - Never copies architecture data into a second store or fabricates unverified validation claims.
 */

import { getDef } from './cloudlab-core/catalog/index.ts';
import type { Architecture, DesignConnection, Position, Provider, Resource, ResourceBlock, ResourceKind } from './model.ts';
import { elementEndpoint, endpointExists, endpointKey } from './connectionEndpoints.ts';
import type { Diagnostic } from './diagnostics.ts';
import { providerRegions, resourceDefinition, resourceTypes } from './fixture.ts';
import { fitResourceContainers, isResourceContainer, resourceAddress, resourcePlacement, visualParentId, visualResourcePlacement } from './resourceHierarchy.ts';
import { projectResourceFiles, resourceSourceFile, terraformCode } from './terraformProjection.ts';
import type {
	HostCloudRegionsPayload,
	HostEngineValidateReport,
	HostGraphSnapshot,
	HostNodeSummary,
	HostPoint,
	HostValidationRun,
	HostViewport,
	HostGraphViewState,
	HostViewState,
} from './webviewBridge.ts';

export interface ProjectGraphOptions {
	/** Only supply the previous model for a refresh of the same architecture (enforced by App). */
	readonly previousArchitecture?: Architecture;
	readonly viewState?: Partial<HostViewState>;
}

export interface ProjectedGraphResult {
	readonly architecture: Architecture;
	readonly hasSourceById: Readonly<Record<string, boolean>>;
	readonly sourceRevision: string;
	readonly status: 'complete' | 'partial';
}

const KNOWN_TYPE_TO_KIND: Readonly<Record<string, ResourceKind>> = {
	azurerm_resource_group: 'group',
	azurerm_virtual_network: 'network',
	azurerm_subnet: 'subnet',
	azurerm_application_gateway: 'gateway',
	azurerm_kubernetes_cluster: 'cluster',
	azurerm_storage_account: 'storage',
	azurerm_log_analytics_workspace: 'monitor',
	azurerm_linux_virtual_machine: 'compute',
	azurerm_windows_virtual_machine: 'compute',
	azurerm_mssql_database: 'database',
	aws_resourcegroups_group: 'group',
	aws_vpc: 'network',
	aws_subnet: 'subnet',
	aws_lb: 'gateway',
	aws_eks_cluster: 'cluster',
	aws_s3_bucket: 'storage',
	aws_cloudwatch_log_group: 'monitor',
	aws_instance: 'compute',
	aws_db_instance: 'database',
	google_project: 'group',
	google_compute_network: 'network',
	google_compute_subnetwork: 'subnet',
	google_compute_global_forwarding_rule: 'gateway',
	google_container_cluster: 'cluster',
	google_storage_bucket: 'storage',
	google_logging_project_sink: 'monitor',
	google_compute_instance: 'compute',
	google_sql_database_instance: 'database',
};

export function inferProvider(resourceType: string | null): Provider {
	if (!resourceType) {
		return 'azure';
	}
	if (resourceType.startsWith('aws_')) {
		return 'aws';
	}
	if (resourceType.startsWith('google_')) {
		return 'gcp';
	}
	return 'azure';
}

function defaultIconFor(provider: Provider, resourceType: string | null): string {
	const def = resourceType ? getDef(resourceType) : undefined;
	if (def?.icon) {
		const fileName = def.icon.replace(/^\/?icons\//, '');
		if (fileName.startsWith('catalog-icons/')) {
			return fileName;
		}
		if (fileName.includes('/')) {
			return 'catalog-icons/' + fileName;
		}
		return fileName;
	}
	if (provider === 'aws') {
		return 'aws-vpc.svg';
	}
	if (provider === 'gcp') {
		return 'gcp-project.svg';
	}
	return 'azure-resource-groups.svg';
}

function friendlyLabelForType(resourceType: string): string {
	const def = getDef(resourceType);
	if (def?.displayName) {
		return def.displayName;
	}
	return resourceType
		.replace(/^(azurerm|aws|google|kubernetes)_/, '')
		.split('_')
		.filter(Boolean)
		.map(part => part[0].toUpperCase() + part.slice(1))
		.join(' ');
}

function createResourceFromNode(node: HostNodeSummary, fallbackPosition: Position, preserved?: Resource): Resource {
	const provider = inferProvider(node.resourceType);
	const isModule = node.kind === 'module';
	const mappedKind: ResourceKind = isModule
		? 'module'
		: (node.resourceType && KNOWN_TYPE_TO_KIND[node.resourceType]) || 'generic';
	const def = node.resourceType ? getDef(node.resourceType) : undefined;
	const catalogue = !isModule && mappedKind === 'generic' && node.resourceType
		? {
			type: node.resourceType,
			label: friendlyLabelForType(node.resourceType),
			service: def?.service ?? friendlyLabelForType(node.resourceType),
			category: def?.category ?? 'Other',
			icon: defaultIconFor(provider, node.resourceType),
			fields: (def?.attributes ?? [])
				.filter(attr => attr.type !== 'block' && ['string', 'number', 'bool'].includes(attr.type))
				.map(attr => ({
					name: attr.name,
					type: attr.type as 'string' | 'number' | 'bool',
					required: attr.required,
					description: attr.description,
					...(attr.default !== undefined && (typeof attr.default === 'string' || typeof attr.default === 'number' || typeof attr.default === 'boolean') ? { default: attr.default } : {}),
					...(attr.options ? { options: [...attr.options] } : {}),
					...(attr.sensitive ? { sensitive: true } : {}),
				})),
		}
		: undefined;

	const defaultSettings = isModule
		? { Source: node.label || node.name, 'Source type': 'local', Version: 'Workspace' }
		: mappedKind !== 'generic'
			? { ...resourceTypes[mappedKind].defaults }
			: {};

	const positions = preserved
		? { visual: { ...preserved.positions.visual }, technical: { ...preserved.positions.technical } }
		: { visual: { ...fallbackPosition }, technical: { ...fallbackPosition } };

	return {
		id: node.id,
		kind: mappedKind,
		...(catalogue ? { catalogue } : {}),
		provider,
		name: node.name,
		terraformName: node.name,
		...(node.sourceFile ? { sourceFile: node.sourceFile } : preserved?.sourceFile ? { sourceFile: preserved.sourceFile } : {}),
		...(node.sourceLine !== undefined ? { sourceLine: node.sourceLine } : preserved?.sourceLine !== undefined ? { sourceLine: preserved.sourceLine } : {}),
		...(node.label && node.label !== node.name ? { label: node.label } : {}),
		region: preserved?.region ?? (mappedKind === 'generic' ? '' : providerRegions[provider][0]),
		settings: preserved ? { ...defaultSettings, ...preserved.settings } : defaultSettings,
		blocks: preserved ? structuredClone(preserved.blocks) : [],
		...(preserved?.terraformExtras ? { terraformExtras: structuredClone(preserved.terraformExtras) } : {}),
		...(preserved?.fieldBindings ? { fieldBindings: structuredClone(preserved.fieldBindings) } : {}),
		...(preserved?.resourceRefs ? { resourceRefs: structuredClone(preserved.resourceRefs) } : {}),
		...(preserved?.inheritanceOverrides ? { inheritanceOverrides: [...preserved.inheritanceOverrides] } : {}),
		...(preserved?.containerSize ? { containerSize: { ...preserved.containerSize } } : {}),
		...(preserved?.iconSize ? { iconSize: preserved.iconSize } : {}),
		...(preserved?.iconKind ? { iconKind: preserved.iconKind } : {}),
		...(preserved?.iconOverride ? { iconOverride: { ...preserved.iconOverride } } : {}),
		...(preserved?.visualParentId !== undefined ? { visualParentId: preserved.visualParentId } : {}),
		...(preserved?.canvasLocked ? { canvasLocked: true } : {}),
		positions,
	};
}

function containerSpecificity(resource: Resource): number {
	const type = resourceDefinition(resource).type;
	// Deeper/more specific containers win over broader containers (e.g., Subnet > VNet > Resource Group).
	if (['azurerm_subnet', 'aws_subnet', 'google_compute_subnetwork'].includes(type)) {
		return 3;
	}
	if (['azurerm_virtual_network', 'aws_vpc', 'google_compute_network'].includes(type)) {
		return 2;
	}
	if (['azurerm_resource_group', 'aws_resourcegroups_group', 'google_project'].includes(type)) {
		return 1;
	}
	return isResourceContainer(resource) ? 1 : 0;
}

function canDirectlyContain(parent: Resource, child: Resource): boolean {
	if (parent.id === child.id || parent.provider !== child.provider || !isResourceContainer(parent)) {
		return false;
	}
	const parentType = resourceDefinition(parent).type;
	const childDef = getDef(resourceDefinition(child).type);
	if (child.kind === 'module') {
		return parentType === 'azurerm_resource_group' || parentType === 'aws_resourcegroups_group' || parentType === 'google_project';
	}
	if (!childDef) {
		return parentType === 'azurerm_resource_group';
	}
	return childDef.parents.includes(parentType);
}

function layoutNewResources(resources: Resource[], preservedIds: ReadonlySet<string>): void {
	const childrenByParent = new Map<string | undefined, Resource[]>();
	for (const resource of resources) {
		const list = childrenByParent.get(visualParentId(resource)) ?? [];
		list.push(resource);
		childrenByParent.set(visualParentId(resource), list);
	}

	const LEAF_W = 256;
	const LEAF_H = 324;
	const PAD_X = 36;
	const PAD_TOP = 80;
	const PAD_BOTTOM = 36;
	const GAP_X = 32;
	const GAP_Y = 32;

	type Box = { width: number; height: number };

	const shiftSubtree = (rootId: string, dx: number, dy: number) => {
		for (const child of childrenByParent.get(rootId) ?? []) {
			if (!preservedIds.has(child.id)) {
				child.positions = {
					visual: { x: child.positions.visual.x + dx, y: child.positions.visual.y + dy },
					technical: { x: child.positions.technical.x + dx, y: child.positions.technical.y + dy },
				};
			}
			shiftSubtree(child.id, dx, dy);
		}
	};

	// Bottom-up deterministic layout so containers measure their actual nested subtrees
	// before sibling placement, preventing sibling cards from overlapping expanded containers.
	const layoutSubtree = (resource: Resource): Box => {
		const container = isResourceContainer(resource);
		if (!container) {
			return { width: LEAF_W, height: LEAF_H };
		}
		const children = (childrenByParent.get(resource.id) ?? []).slice().sort((a, b) => {
			const containerDelta = Number(isResourceContainer(b)) - Number(isResourceContainer(a));
			return containerDelta !== 0 ? containerDelta : a.name.localeCompare(b.name);
		});
		if (!children.length) {
			const w = resource.containerSize?.width ?? 360;
			const h = resource.containerSize?.height ?? 240;
			if (!preservedIds.has(resource.id) && !resource.containerSize) {
				resource.containerSize = { width: w, height: h };
			}
			return { width: w, height: h };
		}

		// Measure every child subtree first (each child starts at local origin 0,0).
		const measured = children.map(child => ({ child, box: layoutSubtree(child) }));
		const maxRowWidth = Math.max(920, ...measured.map(m => m.box.width));
		let cursorX = PAD_X;
		let cursorY = PAD_TOP;
		let rowHeight = 0;
		let contentRight = PAD_X;
		let contentBottom = PAD_TOP;

		for (const { child, box } of measured) {
			if (cursorX > PAD_X && cursorX + box.width > maxRowWidth) {
				cursorX = PAD_X;
				cursorY += rowHeight + GAP_Y;
				rowHeight = 0;
			}
			if (!preservedIds.has(child.id)) {
				const dx = cursorX - child.positions.visual.x;
				const dy = cursorY - child.positions.visual.y;
				child.positions = {
					visual: { x: cursorX, y: cursorY },
					technical: { x: cursorX, y: cursorY },
				};
				shiftSubtree(child.id, dx, dy);
			}
			contentRight = Math.max(contentRight, cursorX + box.width);
			contentBottom = Math.max(contentBottom, cursorY + box.height);
			cursorX += box.width + GAP_X;
			rowHeight = Math.max(rowHeight, box.height);
		}

		const width = Math.max(360, contentRight + PAD_X);
		const height = Math.max(240, contentBottom + PAD_BOTTOM);
		if (!preservedIds.has(resource.id)) {
			resource.positions = { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } };
			resource.containerSize = { width, height };
		}
		return { width, height };
	};

	const roots = (childrenByParent.get(undefined) ?? []).slice().sort((a, b) => {
		const containerDelta = Number(isResourceContainer(b)) - Number(isResourceContainer(a));
		return containerDelta !== 0 ? containerDelta : a.name.localeCompare(b.name);
	});
	const measuredRoots = roots.map(root => ({ root, box: layoutSubtree(root) }));
	let rootX = 60;
	let rootY = 60;
	let rowH = 0;
	const maxCanvasRow = 1400;

	for (const { root, box } of measuredRoots) {
		if (rootX > 60 && rootX + box.width > maxCanvasRow) {
			rootX = 60;
			rootY += rowH + 56;
			rowH = 0;
		}
		if (!preservedIds.has(root.id)) {
			const dx = rootX - root.positions.visual.x;
			const dy = rootY - root.positions.visual.y;
			root.positions = { visual: { x: rootX, y: rootY }, technical: { x: rootX, y: rootY } };
			shiftSubtree(root.id, dx, dy);
		}
		rootX += box.width + 56;
		rowH = Math.max(rowH, box.height);
	}
}

/** Connections projected from service graph edges use `source->target`; user drawing links never do. */
function isServiceEdgeId(id: string): boolean {
	return id.includes('->');
}

/**
 * Project a live sanitized `CanvasGraphSnapshot` from the Rust service into CloudForge Studio's
 * single `Architecture` model, inferring containment and typed resource references automatically.
 */
export function projectGraphSnapshotToArchitecture(
	snapshot: HostGraphSnapshot,
	options: ProjectGraphOptions = {}
): ProjectedGraphResult {
	const previousById = new Map((options.previousArchitecture?.resources ?? []).map(resource => [resource.id, resource]));
	const previousConnectionsById = new Map((options.previousArchitecture?.connections ?? []).map(connection => [connection.id, connection]));
	const viewPositions = options.viewState?.nodePositions?.visual ?? options.viewState?.nodePositions?.technical ?? {};
	const hasSourceById: Record<string, boolean> = {};
	const preservedIds = new Set<string>();

	const resources: Resource[] = snapshot.nodes.map((node, index) => {
		hasSourceById[node.id] = node.hasSource;
		const previous = previousById.get(node.id);
		const savedPos = viewPositions[node.id];
		if (previous || savedPos) {
			preservedIds.add(node.id);
		}
		const fallback: Position = savedPos
			? { x: savedPos.x, y: savedPos.y }
			: { x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 190 };
		const resource = createResourceFromNode(node, fallback, previous);
		if (!previous && savedPos) {
			resource.positions = { visual: { ...savedPos }, technical: { ...savedPos } };
		}
		return resource;
	});

	const byId = new Map(resources.map(resource => [resource.id, resource]));

	// Collect candidate container parents from graph edges (both directions checked against schema rules).
	const candidateParents = new Map<string, Resource[]>();
	const addCandidate = (childId: string, parent: Resource) => {
		const list = candidateParents.get(childId) ?? [];
		if (!list.some(item => item.id === parent.id)) {
			list.push(parent);
			candidateParents.set(childId, list);
		}
	};

	for (const edge of snapshot.edges) {
		if (edge.kind !== 'reference') { continue; }
		const a = byId.get(edge.fromId);
		const b = byId.get(edge.toId);
		if (!a || !b || a.id === b.id) {
			continue;
		}
		if (canDirectlyContain(b, a)) {
			addCandidate(a.id, b);
		}
		if (canDirectlyContain(a, b)) {
			addCandidate(b.id, a);
		}
	}

	// Assign the most specific compatible container first (e.g. Subnet > VNet > Resource Group),
	// verifying cycle safety via `resourcePlacement`.
	const baseArch: Architecture = {
		// Like edge appearance, a locally edited title survives service refreshes. A different
		// architecture is projected without previousArchitecture and takes its service title.
		name: options.previousArchitecture?.name ?? (snapshot.architectureName || 'CloudForge Architecture'),
		variables: options.previousArchitecture?.variables ? structuredClone(options.previousArchitecture.variables) : [],
		resources,
		items: options.previousArchitecture?.items ? structuredClone(options.previousArchitecture.items) : [],
		connections: [],
	};

	// Sort parents shallowest-first so container chains establish cleanly.
	const orderedResources = [...resources].sort((a, b) => containerSpecificity(a) - containerSpecificity(b));
	for (const resource of orderedResources) {
		const previousParent = previousById.get(resource.id)?.parentId;
		if (previousParent && byId.has(previousParent) && resourcePlacement(baseArch, resource, previousParent).ok) {
			resource.parentId = previousParent;
			continue;
		}
		// A summary edge carries no source field. It may suggest diagram nesting, but cannot
		// establish inherited Terraform fields or ownership (e.g. a location-only RG reference).
		if (resource.visualParentId !== undefined) { continue; }
		const candidates = (candidateParents.get(resource.id) ?? []).slice().sort((a, b) => containerSpecificity(b) - containerSpecificity(a));
		for (const candidate of candidates) {
			if (visualResourcePlacement(baseArch, resource, candidate.id).ok) {
				resource.visualParentId = candidate.id;
				break;
			}
		}
	}

	// Preserve typed local field bindings and retain source-summary edges with their original kind.
	for (const resource of resources) {
		if (resource.visualParentId && (!byId.has(resource.visualParentId) || !visualResourcePlacement(baseArch, resource, resource.visualParentId).ok)) { delete resource.visualParentId; }
	}
	const connections: DesignConnection[] = [];
	const seenConnections = new Set<string>();
	for (const edge of snapshot.edges) {
		const from = byId.get(edge.fromId);
		const to = byId.get(edge.toId);
		if (!from || !to || from.id === to.id) {
			continue;
		}
		// Keep opaque reference/depends_on edges intact. Without a source field path, a
		// compatible resource pair is insufficient evidence for a typed attachment binding.
		const edgeId = `${from.id}->${to.id}`;
		if (!seenConnections.has(edgeId)) {
			seenConnections.add(edgeId);
			// Keep the user's styling (label, stroke, routing, arrows) on a service edge seen before.
			const styled = previousConnectionsById.get(edgeId);
			connections.push({
				...(edge.kind && edge.kind !== 'reference' ? { label: edge.kind } : {}),
				...(styled ? structuredClone(styled) : {}),
				id: edgeId,
				origin: { kind: 'service', edgeKind: edge.kind },
				source: elementEndpoint(from.id),
				target: elementEndpoint(to.id),
			});
		}
	}

	// Studio-only presentation state is not in the service graph: carry the user's drawing links,
	// groups and layer order through the refresh, pruned to elements that still exist.
	const elementIds = new Set([...resources.map(resource => resource.id), ...baseArch.items.map(item => item.id)]);
	const serviceEndpoints = new Set(connections.map(connection => endpointKey(connection.source, 'source') + '\u0000' + endpointKey(connection.target, 'target')));
	for (const previous of options.previousArchitecture?.connections ?? []) {
		if (isServiceEdgeId(previous.id) || !endpointExists(previous.source, elementIds) || !endpointExists(previous.target, elementIds)) {
			continue;
		}
		if (serviceEndpoints.has(endpointKey(previous.source, 'source') + '\u0000' + endpointKey(previous.target, 'target')) || connections.some(connection => connection.id === previous.id)) {
			continue;
		}
		connections.push(structuredClone(previous));
	}
	const groups = (options.previousArchitecture?.groups ?? [])
		.map(group => ({ ...group, members: group.members.filter(id => elementIds.has(id)) }))
		.filter(group => group.members.length > 1);
	const layerOrder = options.previousArchitecture?.layerOrder?.filter(id => elementIds.has(id));

	layoutNewResources(resources, preservedIds);

	const architecture = fitResourceContainers({
		...baseArch,
		connections,
		...(groups.length ? { groups } : {}),
		...(layerOrder ? { layerOrder } : {}),
		...(options.previousArchitecture?.dependencyStyles ? { dependencyStyles: structuredClone(options.previousArchitecture.dependencyStyles) } : {}),
	});

	return {
		architecture,
		hasSourceById,
		sourceRevision: snapshot.sourceRevision,
		status: snapshot.status,
	};
}

export interface HostDiagnostic extends Diagnostic {
	readonly source: 'local' | 'graph' | 'validation' | 'cli';
	readonly code?: string;
	readonly remediation?: string;
}

function resolveResourceIdByAddress(architecture: Architecture, address: string | undefined): string {
	if (!address) {
		return architecture.resources[0]?.id ?? '';
	}
	const trimmed = address.trim();
	const exact = architecture.resources.find(resource =>
		resource.id === trimmed
		|| resourceAddress(resource) === trimmed
		|| resource.name === trimmed
		|| (resource.kind === 'module' && `module.${resource.name}` === trimmed)
	);
	return exact?.id ?? architecture.resources[0]?.id ?? '';
}

/**
 * Unify Rust graph diagnostics, Stage 3/5 ValidationRun findings, and Stage 9A CLI `validate -json`
 * diagnostics into Studio's Diagnostic model without losing source provenance.
 */
export function projectHostDiagnostics(
	architecture: Architecture,
	snapshot?: HostGraphSnapshot | null,
	validationRun?: HostValidationRun | null,
	engineValidateReport?: HostEngineValidateReport | null
): HostDiagnostic[] {
	const out: HostDiagnostic[] = [];
	const fallbackResourceId = architecture.resources[0]?.id ?? '';

	if (snapshot) {
		snapshot.diagnostics.forEach((diag, index) => {
			out.push({
				id: `graph:${index}:${diag.code}`,
				resourceId: fallbackResourceId,
				severity: diag.severity === 'error' ? 'error' : 'warning',
				code: diag.code,
				message: diag.message,
				source: 'graph',
				sourceRevision: snapshot.sourceRevision,
			});
		});
	}

	if (validationRun) {
		for (const nodeResult of Object.values(validationRun.nodeResults)) {
			for (const finding of nodeResult.findings) {
				out.push({
					id: `validation:${finding.id}`,
					resourceId: finding.nodeId ?? nodeResult.nodeId ?? fallbackResourceId,
					severity: finding.severity === 'error' ? 'error' : 'warning',
					code: finding.code,
					message: finding.message,
					remediation: finding.remediation,
					source: 'validation',
					sourceRevision: validationRun.capturedRevision,
				});
			}
		}
	}

	if (engineValidateReport) {
		engineValidateReport.diagnostics.forEach((diag, index) => {
			const location = diag.filename ? `${diag.filename}${diag.line ? ':' + diag.line : ''}` : undefined;
			out.push({
				id: `cli:${engineValidateReport.engine}:${index}:${diag.summary}`,
				resourceId: resolveResourceIdByAddress(architecture, diag.address),
				severity: diag.severity === 'error' ? 'error' : 'warning',
				path: diag.address || location,
				message: diag.detail ? `${diag.summary} — ${diag.detail}` : diag.summary,
				source: 'cli',
				sourceRevision: engineValidateReport.sourceRevision,
				...(diag.filename ? { location: { fileName: diag.filename, ...(diag.line ? { line: diag.line } : {}), ...(diag.column ? { column: diag.column } : {}) } } : {}),
			});
		});
	}

	return out;
}

export function sanitizeDraftTfFileName(architectureName: string): string {
	const slug = architectureName
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return `${slug || 'cloudforge-studio'}.tf`;
}

/** Resolve the default `.tf` project file corresponding to the active selection or architecture. */
export function defaultTargetTfFile(architecture: Architecture, selectedResourceId?: string): string {
	if (selectedResourceId) {
		const selected = architecture.resources.find(item => item.id === selectedResourceId);
		if (selected?.sourceFile) {
			return resourceSourceFile(selected);
		}
	}
	const explicitFiles = architecture.resources
		.map(resource => resource.sourceFile)
		.filter((file): file is string => !!file && !file.startsWith('.') && /^[A-Za-z0-9._-]+\.tf$/i.test(file));
	if (explicitFiles.includes('main.tf')) {
		return 'main.tf';
	}
	if (explicitFiles.length > 0) {
		return explicitFiles[0];
	}
	return sanitizeDraftTfFileName(architecture.name);
}

/** Generate a guarded `.tf` draft payload scoped to the corresponding project `.tf` file. */
/** Terraform identifier the projection writes for a canvas name (mirrors terraformProjection). */
function terraformIdentifier(resource: Pick<Resource, 'name' | 'terraformName'>): string {
	if (resource.terraformName) {
		return resource.terraformName;
	}
	const cleaned = resource.name.replace(/[^A-Za-z0-9_-]/g, '_');
	return /^[A-Za-z_]/.test(resource.name) ? cleaned : '_' + cleaned;
}

export interface SourceChanges {
	/** Blocks in the file on disk that were deleted on the canvas. */
	readonly removeAddresses: readonly string[];
	/** Blocks renamed on the canvas; the service renames them in place and writes `moved`. */
	readonly renames: readonly { readonly from: string; readonly to: string }[];
}

/**
 * What the canvas changed in `fileName` compared with the host graph: deleted blocks and renamed
 * blocks. A focused save applies these; everything else the canvas does not generate is kept.
 */
export function sourceChanges(architecture: Architecture, snapshot: HostGraphSnapshot | null | undefined, fileName: string): SourceChanges {
	const removeAddresses: string[] = [];
	const renames: { from: string; to: string }[] = [];
	if (!snapshot) {
		return { removeAddresses, renames };
	}
	const current = new Map(architecture.resources.map(resource => [resource.id, resource]));
	const address = (kind: string, type: string | null, name: string) =>
		kind === 'resource' && type ? `${type}.${name}` : kind === 'data' && type ? `data.${type}.${name}` : kind === 'module' ? `module.${name}` : undefined;
	for (const node of snapshot.nodes) {
		if (!node.hasSource || node.sourceFile !== fileName) {
			continue;
		}
		const from = address(node.kind, node.resourceType, node.name);
		if (!from) {
			continue;
		}
		const resource = current.get(node.id);
		if (!resource) {
			removeAddresses.push(from);
			continue;
		}
		const name = terraformIdentifier(resource);
		if (node.kind !== 'data' && name !== node.name) {
			renames.push({ from, to: address(node.kind, node.resourceType, name)! });
		}
	}
	return { removeAddresses: removeAddresses.slice(0, 256), renames: renames.slice(0, 256) };
}

function baselineContents(baseline: Architecture, fileName: string): string {
	return projectResourceFiles(baseline).includes(fileName) ? terraformCode(baseline, undefined, fileName) : terraformCode(baseline);
}

export function buildDraftSavePayload(
	architecture: Architecture,
	fileName?: string,
	selectedResourceId?: string,
	snapshot?: HostGraphSnapshot | null,
	baseline?: Architecture | null
): { readonly fileName: string; readonly contents: string; readonly baseContents?: string } & SourceChanges {
	const safeName = fileName && /^[A-Za-z0-9._-]+\.tf$/i.test(fileName) && !fileName.startsWith('.')
		? fileName
		: defaultTargetTfFile(architecture, selectedResourceId);
	const files = projectResourceFiles(architecture);
	const contents = files.includes(safeName)
		? terraformCode(architecture, undefined, safeName)
		: terraformCode(architecture);
	return {
		fileName: safeName,
		contents,
		...sourceChanges(architecture, snapshot, safeName),
		// What the canvas generated for this file when it loaded it: the service then applies only
		// what changed since, so canvas defaults never overwrite values in the file.
		...(baseline && baseline !== architecture ? { baseContents: baselineContents(baseline, safeName) } : {}),
	};
}

/**
 * What a refresh of the same architecture is projected from: the last state the files said
 * (`baseline`), not the canvas with its unsaved edits, so the new baseline stays a faithful copy
 * of the files and the next three-way save still sees those edits. Resources and connections
 * that exist only on the canvas (added and not yet reloaded) come from `present`, so a resource
 * the user just saved keeps its canvas configuration when it first appears in the graph.
 */
export function refreshPrevious(baseline: Architecture | null | undefined, present: Architecture): Architecture {
	if (!baseline || baseline === present) {
		return present;
	}
	const resourceIds = new Set(baseline.resources.map(resource => resource.id));
	const connectionIds = new Set(baseline.connections.map(connection => connection.id));
	return {
		...baseline,
		resources: [...baseline.resources, ...present.resources.filter(resource => !resourceIds.has(resource.id))],
		connections: [...baseline.connections, ...present.connections.filter(connection => !connectionIds.has(connection.id))],
	};
}

/**
 * After a save, the saved files say what the canvas said: resources of those files take the
 * saved canvas version (and ones deleted on the canvas leave), so the next baseline treats them
 * as saved even where `readResourceValues` cannot hydrate a value (expressions, bindings).
 */
export function adoptSavedFiles(baseline: Architecture, saved: Architecture, files: ReadonlySet<string>): Architecture {
	const savedById = new Map(saved.resources.map(resource => [resource.id, resource]));
	const inSavedFile = (resource: Architecture['resources'][number]) => files.has(resourceSourceFile(resource));
	const resources = baseline.resources
		.filter(resource => !inSavedFile(resource) || savedById.has(resource.id))
		.map(resource => {
			const mine = savedById.get(resource.id);
			return mine && (inSavedFile(resource) || inSavedFile(mine)) ? mine : resource;
		});
	const known = new Set(resources.map(resource => resource.id));
	for (const resource of saved.resources) {
		if (!known.has(resource.id) && inSavedFile(resource)) {
			resources.push(resource);
		}
	}
	return { ...baseline, resources };
}

export type DraftSavePayload = ReturnType<typeof buildDraftSavePayload>;

/**
 * Every project file the canvas changed since it loaded, ready for one `previewFocusedSaveBatch`.
 * A file is included when its generated text differs from what the canvas generated at load, or
 * when blocks in it were deleted or renamed. A file that only exists in the baseline (its last
 * resource moved or was deleted) is sent with empty contents so the three-way merge removes the
 * blocks the canvas no longer generates. Without a baseline nothing can be compared and the
 * result is empty; the single-file save handles that case.
 */
export function changedFilePayloads(
	architecture: Architecture,
	snapshot?: HostGraphSnapshot | null,
	baseline?: Architecture | null
): DraftSavePayload[] {
	if (!baseline || baseline === architecture) {
		return [];
	}
	const current = projectResourceFiles(architecture);
	const before = projectResourceFiles(baseline);
	const names = [...new Set([...current, ...before])].filter(name => /^[A-Za-z0-9._-]+\.tf$/i.test(name) && !name.startsWith('.'));
	const payloads: DraftSavePayload[] = [];
	for (const fileName of names) {
		const contents = current.includes(fileName) ? terraformCode(architecture, undefined, fileName) : '';
		const baseContents = before.includes(fileName) ? terraformCode(baseline, undefined, fileName) : '';
		const changes = sourceChanges(architecture, snapshot, fileName);
		if (contents === baseContents && !changes.removeAddresses.length && !changes.renames.length) {
			continue;
		}
		payloads.push({ fileName, contents, ...changes, baseContents });
	}
	return payloads.slice(0, 16);
}

/**
 * Serialize Studio's presentation state (mode, theme, selection, inspector, viewports, and
 * node positions) into the canonical `CanvasViewState` contract persisted by `CloudForgeCanvasPanel`.
 */
export function buildHostViewState(params: {
	readonly architecture: Architecture;
	readonly mode: 'visual' | 'technical';
	readonly theme: 'light' | 'dark';
	readonly selectedId: string;
	readonly focusedWorkspaceOpen: boolean;
	readonly inspectorOpen: boolean;
	readonly libraryOpen: boolean;
	readonly viewports?: Partial<Record<'visual' | 'technical', HostViewport>>;
	/** Graph presentation, persisted under its own key so pins never become design positions. */
	readonly graph?: HostGraphViewState;
}): HostViewState {
	const visualPositions: Record<string, HostPoint> = {};
	const technicalPositions: Record<string, HostPoint> = {};
	for (const resource of params.architecture.resources.slice(0, 512)) {
		if (Number.isFinite(resource.positions.visual.x) && Number.isFinite(resource.positions.visual.y)) {
			visualPositions[resource.id] = {
				x: Math.round(resource.positions.visual.x),
				y: Math.round(resource.positions.visual.y),
			};
		}
		if (Number.isFinite(resource.positions.technical.x) && Number.isFinite(resource.positions.technical.y)) {
			technicalPositions[resource.id] = {
				x: Math.round(resource.positions.technical.x),
				y: Math.round(resource.positions.technical.y),
			};
		}
	}

	const viewports: Partial<Record<'visual' | 'technical', HostViewport>> = {};
	for (const key of ['visual', 'technical'] as const) {
		const vp = params.viewports?.[key];
		if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.zoom) && vp.zoom >= 0.05 && vp.zoom <= 8) {
			viewports[key] = { x: vp.x, y: vp.y, zoom: vp.zoom };
		}
	}

	return {
		mode: params.mode,
		theme: params.theme,
		grid: 'lines',
		selectedId: params.selectedId || null,
		focusedWorkspaceOpen: !!params.selectedId && params.focusedWorkspaceOpen,
		inspectorOpen: params.inspectorOpen,
		listOpen: params.libraryOpen,
		collapsedGroups: [],
		viewports,
		hiddenLayers: [],
		snapToGrid: true,
		frames: [],
		annotations: [],
		nodePositions: {
			...(Object.keys(visualPositions).length ? { visual: visualPositions } : {}),
			...(Object.keys(technicalPositions).length ? { technical: technicalPositions } : {}),
		},
		checkpoints: [],
		sampleContext: null,
		...(params.graph ? { graph: params.graph } : {}),
	};
}

/** Merge Rust Stage 6 `cloudRegions` payloads into Studio's per-provider region options. */
export function resolveProviderRegions(
	provider: Provider,
	hostRegions?: Readonly<Partial<Record<'azure' | 'aws' | 'google', HostCloudRegionsPayload>>>
): string[] {
	const hostKey = provider === 'gcp' ? 'google' : provider;
	const payload = hostRegions?.[hostKey];
	if (!payload || payload.regions.length === 0) {
		return [...providerRegions[provider]];
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const region of payload.regions) {
		const label = provider === 'azure' ? (region.displayName || region.name) : region.name;
		if (label && !seen.has(label)) {
			seen.add(label);
			out.push(label);
		}
	}
	for (const fallback of providerRegions[provider]) {
		if (!seen.has(fallback)) {
			seen.add(fallback);
			out.push(fallback);
		}
	}
	return out;
}
