/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Deterministic layered layout, grouping, filtering, and viewport math for the read-only
// CloudForge Architecture Canvas. Shared by both the Webview renderer and unit tests.

import type {
	CanvasEdgeSummary,
	CanvasGraphSnapshot,
	CanvasNodeSummary,
	CanvasViewMode,
	CanvasViewport
} from './protocol';

export interface CanvasGroupLayout {
	readonly id: string;
	readonly label: string;
	readonly provider: string;
	readonly collapsed: boolean;
	readonly totalCount: number;
	readonly visibleCount: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface PositionedNode {
	readonly node: CanvasNodeSummary;
	readonly groupId: string;
	readonly provider: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly incomingCount: number;
	readonly outgoingCount: number;
}

export interface RoutedEdge {
	readonly id: string;
	readonly fromId: string;
	readonly toId: string;
	readonly kind: string;
	readonly fromX: number;
	readonly fromY: number;
	readonly toX: number;
	readonly toY: number;
	readonly orientation: 'horizontal' | 'vertical';
	readonly collapsedSummary: boolean;
}

export interface CanvasProjection {
	readonly groups: readonly CanvasGroupLayout[];
	readonly nodes: readonly PositionedNode[];
	readonly edges: readonly RoutedEdge[];
	readonly totalNodes: number;
	readonly visibleNodes: number;
	readonly hiddenByFilterOrCollapse: number;
	readonly totalEdges: number;
	readonly visibleEdges: number;
	readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface NodeMetrics {
	readonly width: number;
	readonly height: number;
	readonly gapX: number;
	readonly gapY: number;
}

export function metricsForMode(mode: CanvasViewMode): NodeMetrics {
	return mode === 'technical'
		? { width: 264, height: 118, gapX: 68, gapY: 40 }
		: { width: 212, height: 88, gapX: 56, gapY: 36 };
}

export function inferProvider(node: CanvasNodeSummary): string {
	const type = (node.resourceType ?? '').toLowerCase();
	if (type.startsWith('azurerm_') || type.startsWith('azapi_') || type.startsWith('azuread_')) {
		return 'azure';
	}
	if (type.startsWith('aws_')) {
		return 'aws';
	}
	if (type.startsWith('google_')) {
		return 'gcp';
	}
	if (type.startsWith('kubernetes_') || type.startsWith('helm_')) {
		return 'kubernetes';
	}
	if (node.kind.toLowerCase() === 'module') {
		return 'module';
	}
	return 'terraform';
}

export function groupKeyForNode(node: CanvasNodeSummary): { readonly id: string; readonly label: string; readonly provider: string } {
	const provider = inferProvider(node);
	if (node.kind.toLowerCase() === 'module') {
		return { id: 'group:modules', label: 'Modules', provider: 'module' };
	}
	if (node.kind.toLowerCase() === 'data') {
		return { id: `group:${provider}:data`, label: `${providerDisplayName(provider)} Data Sources`, provider };
	}
	const type = (node.resourceType ?? '').toLowerCase();
	if (/(network|vnet|subnet|route|firewall|gateway|vpc|security_group|lb|load_balancer|dns|nat|peering)/.test(type)) {
		return { id: `group:${provider}:network`, label: `${providerDisplayName(provider)} Networking`, provider };
	}
	if (/(storage|bucket|s3|blob|disk|file|efs|fsx|share)/.test(type)) {
		return { id: `group:${provider}:storage`, label: `${providerDisplayName(provider)} Storage`, provider };
	}
	if (/(sql|database|db|postgres|mysql|cosmos|dynamo|rds|redis|spanner|bigquery)/.test(type)) {
		return { id: `group:${provider}:data-store`, label: `${providerDisplayName(provider)} Databases`, provider };
	}
	if (/(kubernetes|aks|eks|gke|cluster|vm|virtual_machine|instance|compute|app_service|function|lambda|container|ecs|run)/.test(type)) {
		return { id: `group:${provider}:compute`, label: `${providerDisplayName(provider)} Compute`, provider };
	}
	if (/(key_vault|kms|iam|role|policy|secret|identity|managed_identity|rbac|cert)/.test(type)) {
		return { id: `group:${provider}:security`, label: `${providerDisplayName(provider)} Identity & Security`, provider };
	}
	if (/(monitor|log|insight|metric|alarm|alert|cloudwatch|diagnostic)/.test(type)) {
		return { id: `group:${provider}:observability`, label: `${providerDisplayName(provider)} Observability`, provider };
	}
	return { id: `group:${provider}:core`, label: `${providerDisplayName(provider)} Resources`, provider };
}

export function providerDisplayName(provider: string): string {
	switch (provider) {
		case 'azure': return 'Azure';
		case 'aws': return 'AWS';
		case 'gcp': return 'Google Cloud';
		case 'kubernetes': return 'Kubernetes';
		case 'module': return 'Modules';
		default: return 'Terraform';
	}
}

/**
 * Normalizes Rust `readArchitecture` edges (`from` = referencing dependent -> `to` = referenced
 * prerequisite) into left-to-right provision/dataflow edges (`fromId` = prerequisite -> `toId` = dependent)
 * expected by canvas layout, upstream/downstream inspector lists, and prerequisite validation scopes.
 */
export function orientServiceEdgesForCanvas(edges: readonly CanvasEdgeSummary[]): readonly CanvasEdgeSummary[] {
	return edges.map(edge => {
		const kind = edge.kind.toLowerCase();
		if (kind === 'reference' || kind === 'explicit') {
			return { fromId: edge.toId, toId: edge.fromId, kind: edge.kind };
		}
		return edge;
	});
}

export function matchesSearch(node: CanvasNodeSummary, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return true;
	}
	return node.label.toLowerCase().includes(needle)
		|| node.name.toLowerCase().includes(needle)
		|| node.kind.toLowerCase().includes(needle)
		|| (node.resourceType ?? '').toLowerCase().includes(needle)
		|| inferProvider(node).includes(needle);
}

/**
 * Computes topological layer depth for nodes so dependencies flow left-to-right (short-edge layout).
 * Handles dependency cycles safely without looping.
 */
function computeLayers(nodes: readonly CanvasNodeSummary[], edges: readonly CanvasEdgeSummary[]): Map<string, number> {
	const ids = new Set(nodes.map(n => n.id));
	const outgoing = new Map<string, string[]>();
	const inDegree = new Map<string, number>();
	for (const node of nodes) {
		outgoing.set(node.id, []);
		inDegree.set(node.id, 0);
	}
	for (const edge of edges) {
		if (edge.fromId === edge.toId || !ids.has(edge.fromId) || !ids.has(edge.toId)) {
			continue;
		}
		outgoing.get(edge.fromId)!.push(edge.toId);
		inDegree.set(edge.toId, (inDegree.get(edge.toId) ?? 0) + 1);
	}

	const layer = new Map<string, number>();
	const queue: string[] = [];
	for (const node of nodes) {
		if ((inDegree.get(node.id) ?? 0) === 0) {
			layer.set(node.id, 0);
			queue.push(node.id);
		}
	}

	let head = 0;
	while (head < queue.length) {
		const current = queue[head++];
		const currentLayer = layer.get(current) ?? 0;
		for (const next of outgoing.get(current) ?? []) {
			const candidate = currentLayer + 1;
			if (candidate > (layer.get(next) ?? 0)) {
				layer.set(next, candidate);
			}
			const remaining = (inDegree.get(next) ?? 1) - 1;
			inDegree.set(next, remaining);
			if (remaining === 0) {
				queue.push(next);
			}
		}
	}

	// Nodes participating in a cycle keep deterministic fallback layers.
	for (const node of nodes) {
		if (!layer.has(node.id)) {
			layer.set(node.id, 0);
		}
	}
	return layer;
}

interface AnchorBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function computeEdgeAnchors(from: AnchorBox, to: AnchorBox): {
	readonly fromX: number;
	readonly fromY: number;
	readonly toX: number;
	readonly toY: number;
	readonly orientation: 'horizontal' | 'vertical';
} {
	if (to.x >= from.x + from.width + 12) {
		return {
			fromX: from.x + from.width,
			fromY: from.y + from.height / 2,
			toX: to.x,
			toY: to.y + to.height / 2,
			orientation: 'horizontal',
		};
	}
	if (from.x >= to.x + to.width + 12) {
		return {
			fromX: from.x,
			fromY: from.y + from.height / 2,
			toX: to.x + to.width,
			toY: to.y + to.height / 2,
			orientation: 'horizontal',
		};
	}
	if (to.y >= from.y + from.height) {
		return {
			fromX: from.x + from.width / 2,
			fromY: from.y + from.height,
			toX: to.x + to.width / 2,
			toY: to.y,
			orientation: 'vertical',
		};
	}
	return {
		fromX: from.x + from.width / 2,
		fromY: from.y,
		toX: to.x + to.width / 2,
		toY: to.y + to.height,
		orientation: 'vertical',
	};
}

/** Projects one canonical graph snapshot into positioned groups, nodes, and edges for the active mode. */
export function buildCanvasProjection(
	graph: CanvasGraphSnapshot,
	mode: CanvasViewMode,
	searchQuery: string,
	collapsedGroupIds: ReadonlySet<string>
): CanvasProjection {
	const metrics = metricsForMode(mode);
	const incomingCounts = new Map<string, number>();
	const outgoingCounts = new Map<string, number>();
	for (const edge of graph.edges) {
		outgoingCounts.set(edge.fromId, (outgoingCounts.get(edge.fromId) ?? 0) + 1);
		incomingCounts.set(edge.toId, (incomingCounts.get(edge.toId) ?? 0) + 1);
	}

	const matchedNodes = graph.nodes.filter(node => matchesSearch(node, searchQuery));
	const groupBuckets = new Map<string, { label: string; provider: string; totalCount: number; matched: CanvasNodeSummary[] }>();
	for (const node of graph.nodes) {
		const info = groupKeyForNode(node);
		let bucket = groupBuckets.get(info.id);
		if (!bucket) {
			bucket = { label: info.label, provider: info.provider, totalCount: 0, matched: [] };
			groupBuckets.set(info.id, bucket);
		}
		bucket.totalCount++;
	}
	for (const node of matchedNodes) {
		const info = groupKeyForNode(node);
		groupBuckets.get(info.id)!.matched.push(node);
	}

	const layers = computeLayers(matchedNodes, graph.edges);
	const orderedGroups = [...groupBuckets.entries()]
		.filter(([, bucket]) => bucket.matched.length > 0)
		.sort((a, b) => {
			const minLayerA = a[1].matched.reduce((min, n) => Math.min(min, layers.get(n.id) ?? 0), Number.POSITIVE_INFINITY);
			const minLayerB = b[1].matched.reduce((min, n) => Math.min(min, layers.get(n.id) ?? 0), Number.POSITIVE_INFINITY);
			return minLayerA - minLayerB || a[1].label.localeCompare(b[1].label);
		});

	const groups: CanvasGroupLayout[] = [];
	const positionedNodes: PositionedNode[] = [];
	const nodeById = new Map<string, PositionedNode>();
	const groupById = new Map<string, CanvasGroupLayout>();
	const nodeToGroup = new Map<string, string>();

	const GROUP_PAD_X = 24;
	const GROUP_HEADER_H = 40;
	const GROUP_PAD_BOTTOM = 24;
	const GROUP_GAP_Y = 36;
	const COLLAPSED_W = 280;
	const COLLAPSED_H = 56;
	let cursorY = 48;

	for (const [groupId, bucket] of orderedGroups) {
		const collapsed = collapsedGroupIds.has(groupId);
		for (const node of bucket.matched) {
			nodeToGroup.set(node.id, groupId);
		}
		if (collapsed) {
			const group: CanvasGroupLayout = {
				id: groupId,
				label: bucket.label,
				provider: bucket.provider,
				collapsed: true,
				totalCount: bucket.totalCount,
				visibleCount: bucket.matched.length,
				x: 48,
				y: cursorY,
				width: COLLAPSED_W,
				height: COLLAPSED_H,
			};
			groups.push(group);
			groupById.set(groupId, group);
			cursorY += COLLAPSED_H + GROUP_GAP_Y;
			continue;
		}

		// Arrange nodes in columns by topological layer within the group, capped cleanly per column.
		const byLayer = new Map<number, CanvasNodeSummary[]>();
		for (const node of bucket.matched) {
			const col = layers.get(node.id) ?? 0;
			let list = byLayer.get(col);
			if (!list) {
				list = [];
				byLayer.set(col, list);
			}
			list.push(node);
		}
		const sortedCols = [...byLayer.keys()].sort((a, b) => a - b);
		let maxRows = 0;
		for (const col of sortedCols) {
			const list = byLayer.get(col)!;
			list.sort((a, b) => a.label.localeCompare(b.label));
			if (list.length > maxRows) {
				maxRows = list.length;
			}
		}

		const colCount = Math.max(1, sortedCols.length);
		const contentW = colCount * metrics.width + Math.max(0, colCount - 1) * metrics.gapX;
		const contentH = maxRows * metrics.height + Math.max(0, maxRows - 1) * metrics.gapY;
		const groupW = Math.max(COLLAPSED_W, contentW + GROUP_PAD_X * 2);
		const groupH = GROUP_HEADER_H + contentH + GROUP_PAD_BOTTOM;

		const group: CanvasGroupLayout = {
			id: groupId,
			label: bucket.label,
			provider: bucket.provider,
			collapsed: false,
			totalCount: bucket.totalCount,
			visibleCount: bucket.matched.length,
			x: 48,
			y: cursorY,
			width: groupW,
			height: groupH,
		};
		groups.push(group);
		groupById.set(groupId, group);

		sortedCols.forEach((col, colIndex) => {
			const list = byLayer.get(col)!;
			list.forEach((node, rowIndex) => {
				const positioned: PositionedNode = {
					node,
					groupId,
					provider: bucket.provider,
					x: group.x + GROUP_PAD_X + colIndex * (metrics.width + metrics.gapX),
					y: group.y + GROUP_HEADER_H + rowIndex * (metrics.height + metrics.gapY),
					width: metrics.width,
					height: metrics.height,
					incomingCount: incomingCounts.get(node.id) ?? 0,
					outgoingCount: outgoingCounts.get(node.id) ?? 0,
				};
				positionedNodes.push(positioned);
				nodeById.set(node.id, positioned);
			});
		});

		cursorY += groupH + GROUP_GAP_Y;
	}

	const edges: RoutedEdge[] = [];
	const seenCollapsedEdges = new Set<string>();
	for (const edge of graph.edges) {
		const fromNode = nodeById.get(edge.fromId);
		const toNode = nodeById.get(edge.toId);
		if (fromNode && toNode) {
			const anchors = computeEdgeAnchors(fromNode, toNode);
			edges.push({
				id: `${edge.fromId}->${edge.toId}:${edge.kind}`,
				fromId: edge.fromId,
				toId: edge.toId,
				kind: edge.kind,
				...anchors,
				collapsedSummary: false,
			});
			continue;
		}
		// Route summary edge to/from collapsed group box when endpoints are matched.
		const fromGroupId = nodeToGroup.get(edge.fromId);
		const toGroupId = nodeToGroup.get(edge.toId);
		if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) {
			continue;
		}
		const fromAnchor = fromNode ?? groupById.get(fromGroupId);
		const toAnchor = toNode ?? groupById.get(toGroupId);
		if (!fromAnchor || !toAnchor) {
			continue;
		}
		const key = `${fromNode ? edge.fromId : fromGroupId}->${toNode ? edge.toId : toGroupId}`;
		if (seenCollapsedEdges.has(key)) {
			continue;
		}
		seenCollapsedEdges.add(key);
		const anchors = computeEdgeAnchors(fromAnchor, toAnchor);
		edges.push({
			id: `summary:${key}`,
			fromId: fromNode ? edge.fromId : fromGroupId,
			toId: toNode ? edge.toId : toGroupId,
			kind: edge.kind,
			...anchors,
			collapsedSummary: true,
		});
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const group of groups) {
		if (group.x < minX) { minX = group.x; }
		if (group.y < minY) { minY = group.y; }
		if (group.x + group.width > maxX) { maxX = group.x + group.width; }
		if (group.y + group.height > maxY) { maxY = group.y + group.height; }
	}
	if (!Number.isFinite(minX)) {
		minX = 0;
		minY = 0;
		maxX = 400;
		maxY = 240;
	}

	return {
		groups,
		nodes: positionedNodes,
		edges,
		totalNodes: graph.nodes.length,
		visibleNodes: positionedNodes.length,
		hiddenByFilterOrCollapse: Math.max(0, graph.nodes.length - positionedNodes.length),
		totalEdges: graph.edges.length,
		visibleEdges: edges.length,
		bounds: { minX, minY, maxX, maxY },
	};
}

/** Computes a centered viewport that fits the target rectangle within the canvas stage. */
export function fitRectToStage(
	rect: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
	stageWidth: number,
	stageHeight: number,
	padding = 48,
	maxZoom = 1.25
): CanvasViewport {
	const safeW = Math.max(100, stageWidth);
	const safeH = Math.max(100, stageHeight);
	const contentW = Math.max(1, rect.maxX - rect.minX);
	const contentH = Math.max(1, rect.maxY - rect.minY);
	const availW = Math.max(40, safeW - padding * 2);
	const availH = Math.max(40, safeH - padding * 2);
	const zoom = Math.max(0.15, Math.min(maxZoom, availW / contentW, availH / contentH));
	const x = (safeW - contentW * zoom) / 2 - rect.minX * zoom;
	const y = (safeH - contentH * zoom) / 2 - rect.minY * zoom;
	return { x, y, zoom };
}

/** World-aligned power-of-two grid spacing that stays subtle across zoom levels. */
export function adaptiveGridStep(zoom: number): number {
	const clamped = Math.max(0.05, Math.min(8, zoom));
	return 80 / (2 ** Math.floor(Math.log2(clamped * 1.4)));
}
