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
 * - Infers valid infrastructure containment (`parentId`) from graph edges + `cloudlab-core` rules.
 * - Derives explicit typed `resourceRefs` from non-containment reference edges when supported.
 * - Preserves user-positioned node coordinates across live `sourceRevision` refreshes.
 * - Never copies architecture data into a second store or fabricates unverified validation claims.
 */

import { getDef } from './cloudlab-core/catalog/index.ts';
import type { Architecture, DesignConnection, Position, Provider, Resource, ResourceBlock, ResourceKind } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import { providerRegions, resourceDefinition, resourceTypes } from './fixture.ts';
import { bindingKey, type ResourceRefBinding } from './fieldBindings.ts';
import { fitResourceContainers, isResourceContainer, resourceAddress, resourcePlacement } from './resourceHierarchy.ts';
import { terraformCode } from './terraformProjection.ts';
import type {
	HostCloudRegionsPayload,
	HostEngineValidateReport,
	HostGraphSnapshot,
	HostNodeSummary,
	HostPoint,
	HostValidationRun,
	HostViewport,
	HostViewState,
} from './webviewBridge.ts';

export interface ProjectGraphOptions {
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
		...(node.label && node.label !== node.name ? { label: node.label } : {}),
		region: preserved?.region ?? providerRegions[provider][0],
		settings: preserved ? { ...defaultSettings, ...preserved.settings } : defaultSettings,
		blocks: preserved ? structuredClone(preserved.blocks) : [],
		...(preserved?.fieldBindings ? { fieldBindings: structuredClone(preserved.fieldBindings) } : {}),
		...(preserved?.resourceRefs ? { resourceRefs: structuredClone(preserved.resourceRefs) } : {}),
		...(preserved?.inheritanceOverrides ? { inheritanceOverrides: [...preserved.inheritanceOverrides] } : {}),
		...(preserved?.containerSize ? { containerSize: { ...preserved.containerSize } } : {}),
		...(preserved?.iconSize ? { iconSize: preserved.iconSize } : {}),
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

function tryWireExplicitReference(consumer: Resource, provider: Resource): boolean {
	if (consumer.id === provider.id || consumer.provider !== provider.provider || consumer.kind === 'module' || provider.kind === 'module') {
		return false;
	}
	const consumerType = resourceDefinition(consumer).type;
	const providerType = resourceDefinition(provider).type;
	const consumerDef = getDef(consumerType);
	if (!consumerDef) {
		return false;
	}
	const providerDef = getDef(providerType);
	const exported = providerDef?.exported ?? ['id'];

	// 1. Check top-level attributes with matching refTypes (e.g., VM.network_interface_ids -> azurerm_network_interface.id).
	for (const attr of consumerDef.attributes) {
		if (attr.type === 'block' || !attr.refTypes?.includes(providerType)) {
			continue;
		}
		const targetAttr = attr.refAttr ?? 'id';
		if (!exported.includes(targetAttr)) {
			continue;
		}
		const key = bindingKey({ kind: 'setting', name: attr.name });
		const existing = consumer.resourceRefs?.[key]?.refs ?? [];
		if (existing.some(entry => entry.resourceId === provider.id && entry.attribute === targetAttr)) {
			return true;
		}
		const nextRefs = attr.type === 'list'
			? [...existing, { resourceId: provider.id, attribute: targetAttr }]
			: [{ resourceId: provider.id, attribute: targetAttr }];
		consumer.resourceRefs = { ...(consumer.resourceRefs ?? {}), [key]: { refs: nextRefs } as ResourceRefBinding };
		consumer.settings[attr.name] ??= attr.type === 'list' ? '[]' : '';
		return true;
	}

	// 2. Check one-level nested block attributes (e.g., NIC.ip_configuration.subnet_id -> azurerm_subnet.id).
	for (const blockAttr of consumerDef.attributes) {
		if (blockAttr.type !== 'block' || !blockAttr.children?.length) {
			continue;
		}
		const matchingChild = blockAttr.children.find(child => child.type !== 'block' && child.refTypes?.includes(providerType));
		if (!matchingChild) {
			continue;
		}
		const targetAttr = matchingChild.refAttr ?? 'id';
		if (!exported.includes(targetAttr)) {
			continue;
		}
		// Skip if this exact block field is already inherited from an ancestor container.
		if (consumerDef.inherit.some(rule => rule.attr === `${blockAttr.name}.${matchingChild.name}` && rule.fromType === providerType)) {
			// If provider is NOT already an ancestor, still bind explicitly.
			if (consumer.parentId === provider.id) {
				return false;
			}
		}
		let block: ResourceBlock | undefined = consumer.blocks.find(item => item.type === blockAttr.name);
		if (!block) {
			const defaults: Record<string, string> = {};
			for (const child of blockAttr.children) {
				if (child.type !== 'block' && child.default !== undefined) {
					defaults[child.name] = typeof child.default === 'string' ? child.default : JSON.stringify(child.default);
				}
			}
			block = { id: `${consumer.id}:${blockAttr.name}:0`, type: blockAttr.name, values: defaults, blocks: [] };
			consumer.blocks.push(block);
		}
		const key = bindingKey({ kind: 'block', blockId: block.id, name: matchingChild.name });
		const existing = consumer.resourceRefs?.[key]?.refs ?? [];
		if (existing.some(entry => entry.resourceId === provider.id && entry.attribute === targetAttr)) {
			return true;
		}
		const nextRefs = matchingChild.type === 'list'
			? [...existing, { resourceId: provider.id, attribute: targetAttr }]
			: [{ resourceId: provider.id, attribute: targetAttr }];
		consumer.resourceRefs = { ...(consumer.resourceRefs ?? {}), [key]: { refs: nextRefs } as ResourceRefBinding };
		block.values[matchingChild.name] ??= '';
		return true;
	}

	return false;
}

function layoutNewResources(resources: Resource[], preservedIds: ReadonlySet<string>): void {
	const childrenByParent = new Map<string | undefined, Resource[]>();
	for (const resource of resources) {
		const list = childrenByParent.get(resource.parentId) ?? [];
		list.push(resource);
		childrenByParent.set(resource.parentId, list);
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

/**
 * Project a live sanitized `CanvasGraphSnapshot` from the Rust service into CloudForge Studio's
 * single `Architecture` model, inferring containment and typed resource references automatically.
 */
export function projectGraphSnapshotToArchitecture(
	snapshot: HostGraphSnapshot,
	options: ProjectGraphOptions = {}
): ProjectedGraphResult {
	const previousById = new Map((options.previousArchitecture?.resources ?? []).map(resource => [resource.id, resource]));
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
		name: snapshot.architectureName || 'CloudForge Architecture',
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
		const candidates = (candidateParents.get(resource.id) ?? []).slice().sort((a, b) => containerSpecificity(b) - containerSpecificity(a));
		for (const candidate of candidates) {
			const placement = resourcePlacement(baseArch, resource, candidate.id);
			if (placement.ok && placement.parentId === candidate.id) {
				resource.parentId = candidate.id;
				break;
			}
		}
	}

	// Derive explicit typed `resourceRefs` for non-containment edges, and preserve remaining edges as design connections.
	const connections: DesignConnection[] = [];
	const seenConnections = new Set<string>();
	for (const edge of snapshot.edges) {
		const from = byId.get(edge.fromId);
		const to = byId.get(edge.toId);
		if (!from || !to || from.id === to.id) {
			continue;
		}
		// Skip edges that are already represented as direct containment (child -> parent or parent -> child).
		if (from.parentId === to.id || to.parentId === from.id) {
			continue;
		}
		// Try wiring an explicit typed resource reference (e.g., VM -> NIC).
		const wiredFromTo = tryWireExplicitReference(from, to);
		const wiredToFrom = !wiredFromTo && tryWireExplicitReference(to, from);
		if (wiredFromTo || wiredToFrom) {
			continue;
		}
		const edgeId = `${from.id}->${to.id}`;
		if (!seenConnections.has(edgeId)) {
			seenConnections.add(edgeId);
			connections.push({
				id: edgeId,
				source: from.id,
				target: to.id,
				...(edge.kind && edge.kind !== 'reference' ? { label: edge.kind } : {}),
			});
		}
	}

	layoutNewResources(resources, preservedIds);

	const architecture = fitResourceContainers({
		...baseArch,
		connections,
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

/** Generate a guarded `.tf` draft payload from Studio's single `Architecture` model. */
export function buildDraftSavePayload(architecture: Architecture, fileName?: string): { readonly fileName: string; readonly contents: string } {
	const safeName = fileName && /^[A-Za-z0-9._-]+\.tf$/i.test(fileName) && !fileName.startsWith('.')
		? fileName
		: sanitizeDraftTfFileName(architecture.name);
	return {
		fileName: safeName,
		contents: terraformCode(architecture),
	};
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
