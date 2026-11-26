/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Technical Graph Rebuild — Phase 2: Zoom-dependent node density, bounded attachment-row
// port geometry, curved/orthogonal/straight edge routing, crossing comparison metrics,
// and representative scale fixture helpers (1/2/6/50/200 attachments).
//
// Strictly presentation-only; NEVER writes Architecture, Resource.positions, or History.

import { bindingKey } from './fieldBindings.ts';
import type { Architecture, Position, Resource } from './model.ts';
import type {
	GraphDensityMode,
	GraphRouteStyle,
	TechnicalGraphAttachmentPort,
	TechnicalGraphEdgeCategory,
	TechnicalGraphNode,
	TechnicalGraphProjection
} from './technicalGraphContract.ts';

export type SemanticZoomBand = 'overview' | 'standard' | 'detailed';

export interface NodeAttachmentRowLayout {
	readonly portId: string;
	readonly direction: 'incoming' | 'outgoing';
	readonly field: string;
	readonly category: TechnicalGraphEdgeCategory;
	readonly peerNodeId: string;
	readonly peerLabel: string;
	readonly anchorOffset: Position;
}

export interface NodeCategoryPill {
	readonly category: TechnicalGraphEdgeCategory;
	readonly direction: 'incoming' | 'outgoing';
	readonly count: number;
	readonly label: string;
	readonly memberPortIds: readonly string[];
}

export interface TechnicalNodeDetailLayout {
	readonly nodeId: string;
	readonly zoomBand: SemanticZoomBand;
	readonly width: number;
	readonly height: number;
	readonly expanded: boolean;
	readonly visibleRows: readonly NodeAttachmentRowLayout[];
	readonly summaryPills: readonly NodeCategoryPill[];
	readonly overflowCount: number;
	readonly overflowPorts: readonly TechnicalGraphAttachmentPort[];
	readonly fallbackIncomingAnchor: Position;
	readonly fallbackOutgoingAnchor: Position;
}

export interface PortWorldAnchor {
	readonly nodeId: string;
	readonly portId: string;
	readonly x: number;
	readonly y: number;
	readonly side: 'left' | 'right';
	readonly aggregatedIntoFallback: boolean;
}

export interface RoutedTechnicalEdge {
	readonly edgeId: string;
	readonly style: GraphRouteStyle;
	readonly source: PortWorldAnchor;
	readonly target: PortWorldAnchor;
	readonly svgPath: string;
	readonly samplePoints: readonly Position[];
	readonly labelPosition: Position;
	readonly length: number;
	readonly bends: number;
	readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface RouteStyleComparisonEntry {
	readonly style: GraphRouteStyle;
	readonly edgeCount: number;
	readonly crossings: number;
	readonly totalLength: number;
	readonly averageLength: number;
	readonly totalBends: number;
	readonly routes: readonly RoutedTechnicalEdge[];
}

export interface RouteStyleComparisonReport {
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly zoom: number;
	readonly density: GraphDensityMode;
	readonly styles: Readonly<Record<GraphRouteStyle, RouteStyleComparisonEntry>>;
}

const NODE_WIDTH_BY_DENSITY: Readonly<Record<GraphDensityMode, number>> = {
	compact: 220,
	standard: 264,
	detailed: 304,
};

const MAX_ROWS_BY_DENSITY: Readonly<Record<GraphDensityMode, number>> = {
	compact: 4,
	standard: 6,
	detailed: 8,
};

const EXPANDED_MAX_ROWS = 12;
const HEADER_HEIGHT_OVERVIEW = 58;
const HEADER_HEIGHT_STANDARD = 68;
const ROW_HEIGHT = 24;
const FOOTER_OVERFLOW_HEIGHT = 26;
const PILL_AREA_HEIGHT = 28;
const BOTTOM_PADDING = 10;

function freezeDeep<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	Object.freeze(value);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		freezeDeep((value as Record<string, unknown>)[key]);
	}
	return value;
}

export function resolveSemanticZoomBand(zoom: number): SemanticZoomBand {
	if (!Number.isFinite(zoom) || zoom < 0.55) {
		return 'overview';
	}
	if (zoom < 0.95) {
		return 'standard';
	}
	return 'detailed';
}

/**
 * Computes bounded attachment-row layout, collapsed overview pills, and exact port anchor
 * offsets for a single `TechnicalGraphNode`. Node growth belongs purely to presentation
 * geometry and never alters canonical `Architecture` sizes.
 */
export function computeNodeAttachmentLayout(
	node: TechnicalGraphNode,
	options: {
		readonly zoom?: number;
		readonly density?: GraphDensityMode;
		readonly expanded?: boolean;
		readonly selected?: boolean;
		readonly maxRowsOverride?: number;
	} = {}
): TechnicalNodeDetailLayout {
	const density = options.density ?? 'standard';
	const zoomBand = resolveSemanticZoomBand(options.zoom ?? 1);
	const expanded = Boolean(options.expanded);
	const selected = Boolean(options.selected);
	const width = NODE_WIDTH_BY_DENSITY[density];

	// Group ports by (direction, category) for overview pills & compact badges.
	const pillGroups = new Map<string, { direction: 'incoming' | 'outgoing'; category: TechnicalGraphEdgeCategory; portIds: string[] }>();
	for (const port of node.attachmentPorts) {
		const key = `${port.direction}:${port.category}`;
		const group = pillGroups.get(key) ?? { direction: port.direction, category: port.category, portIds: [] };
		group.portIds.push(port.portId);
		pillGroups.set(key, group);
	}
	const summaryPills: NodeCategoryPill[] = [...pillGroups.values()]
		.sort((a, b) => a.direction.localeCompare(b.direction) || a.category.localeCompare(b.category))
		.map(group => ({
			category: group.category,
			direction: group.direction,
			count: group.portIds.length,
			label: `+${group.portIds.length} ${group.category}${group.portIds.length === 1 ? '' : 's'}`,
			memberPortIds: group.portIds,
		}));

	// At overview zoom (unless explicitly selected or expanded), collapse rows into summary pills.
	const collapseToPills = zoomBand === 'overview' && !expanded && !selected;
	if (collapseToPills) {
		const totalHidden = node.attachmentPorts.length + node.attachmentOverflowCount;
		const height = HEADER_HEIGHT_OVERVIEW + (summaryPills.length > 0 || node.attachmentOverflowCount > 0 ? PILL_AREA_HEIGHT : 0) + BOTTOM_PADDING;
		const midY = Math.round(height / 2);
		return freezeDeep({
			nodeId: node.id,
			zoomBand,
			width,
			height,
			expanded: false,
			visibleRows: [],
			summaryPills,
			overflowCount: totalHidden,
			overflowPorts: [...node.attachmentPorts],
			fallbackIncomingAnchor: { x: 0, y: midY },
			fallbackOutgoingAnchor: { x: width, y: midY },
		});
	}

	const baseLimit = options.maxRowsOverride !== undefined
		? Math.max(1, options.maxRowsOverride)
		: expanded
			? EXPANDED_MAX_ROWS
			: MAX_ROWS_BY_DENSITY[density];
	const visiblePorts = node.attachmentPorts.slice(0, baseLimit);
	const hiddenVisiblePorts = node.attachmentPorts.slice(baseLimit);
	const overflowCount = hiddenVisiblePorts.length + node.attachmentOverflowCount;

	const visibleRows: NodeAttachmentRowLayout[] = visiblePorts.map((port, index) => {
		const rowCenterY = HEADER_HEIGHT_STANDARD + index * ROW_HEIGHT + Math.round(ROW_HEIGHT / 2);
		return {
			portId: port.portId,
			direction: port.direction,
			field: port.field,
			category: port.category,
			peerNodeId: port.peerNodeId,
			peerLabel: port.peerLabel,
			anchorOffset: {
				x: port.direction === 'incoming' ? 0 : width,
				y: rowCenterY,
			},
		};
	});

	const rowsHeight = visibleRows.length * ROW_HEIGHT;
	const footerHeight = overflowCount > 0 ? FOOTER_OVERFLOW_HEIGHT : 0;
	const height = HEADER_HEIGHT_STANDARD + rowsHeight + footerHeight + BOTTOM_PADDING;
	const fallbackY = overflowCount > 0
		? HEADER_HEIGHT_STANDARD + rowsHeight + Math.round(FOOTER_OVERFLOW_HEIGHT / 2)
		: Math.round(HEADER_HEIGHT_STANDARD / 2);

	return freezeDeep({
		nodeId: node.id,
		zoomBand,
		width,
		height,
		expanded,
		visibleRows,
		summaryPills,
		overflowCount,
		overflowPorts: hiddenVisiblePorts,
		fallbackIncomingAnchor: { x: 0, y: fallbackY },
		fallbackOutgoingAnchor: { x: width, y: fallbackY },
	});
}

/**
 * Resolves deterministic world-space anchor coordinates for every node layout and port ID.
 * If a port is collapsed into overview pills or overflow, it cleanly attaches to the node's
 * fallback side anchor (`aggregatedIntoFallback: true`).
 */
export function computeGraphPortAnchors(
	projection: TechnicalGraphProjection,
	nodePositions: Readonly<Record<string, Position>>,
	options: {
		readonly zoom?: number;
		readonly density?: GraphDensityMode;
		readonly expandedNodeIds?: ReadonlySet<string>;
		readonly selectedNodeId?: string | null;
	} = {}
): {
	readonly layouts: Readonly<Record<string, TechnicalNodeDetailLayout>>;
	readonly resolveAnchor: (nodeId: string, portId: string, direction: 'incoming' | 'outgoing') => PortWorldAnchor;
} {
	const layouts: Record<string, TechnicalNodeDetailLayout> = {};
	const portIndex = new Map<string, NodeAttachmentRowLayout>();

	for (const node of projection.nodes) {
		const layout = computeNodeAttachmentLayout(node, {
			zoom: options.zoom,
			density: options.density,
			expanded: options.expandedNodeIds?.has(node.id) ?? false,
			selected: options.selectedNodeId === node.id,
		});
		layouts[node.id] = layout;
		for (const row of layout.visibleRows) {
			portIndex.set(row.portId, row);
		}
	}

	const resolveAnchor = (nodeId: string, portId: string, direction: 'incoming' | 'outgoing'): PortWorldAnchor => {
		const origin = nodePositions[nodeId] ?? { x: 0, y: 0 };
		const layout = layouts[nodeId];
		const row = portIndex.get(portId);
		if (row) {
			return {
				nodeId,
				portId,
				x: origin.x + row.anchorOffset.x,
				y: origin.y + row.anchorOffset.y,
				side: direction === 'incoming' ? 'left' : 'right',
				aggregatedIntoFallback: false,
			};
		}
		const fallback = direction === 'incoming'
			? (layout?.fallbackIncomingAnchor ?? { x: 0, y: 34 })
			: (layout?.fallbackOutgoingAnchor ?? { x: 264, y: 34 });
		return {
			nodeId,
			portId,
			x: origin.x + fallback.x,
			y: origin.y + fallback.y,
			side: direction === 'incoming' ? 'left' : 'right',
			aggregatedIntoFallback: true,
		};
	};

	return { layouts: Object.freeze(layouts), resolveAnchor };
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function segmentLength(a: Position, b: Position): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(points: readonly Position[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		total += segmentLength(points[i - 1], points[i]);
	}
	return round1(total);
}

function computeBounds(points: readonly Position[]): RoutedTechnicalEdge['bounds'] {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const pt of points) {
		if (pt.x < minX) { minX = pt.x; }
		if (pt.y < minY) { minY = pt.y; }
		if (pt.x > maxX) { maxX = pt.x; }
		if (pt.y > maxY) { maxY = pt.y; }
	}
	return { minX: round1(minX), minY: round1(minY), maxX: round1(maxX), maxY: round1(maxY) };
}

function sampleCubicBezier(p0: Position, p1: Position, p2: Position, p3: Position, steps: number): Position[] {
	const pts: Position[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const mt = 1 - t;
		const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
		const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
		pts.push({ x: round1(x), y: round1(y) });
	}
	return pts;
}

function buildRoundedOrthogonalPath(waypoints: readonly Position[], radius: number): string {
	if (waypoints.length < 2) {
		return '';
	}
	const commands: string[] = [`M ${round1(waypoints[0].x)} ${round1(waypoints[0].y)}`];
	for (let i = 1; i < waypoints.length - 1; i++) {
		const prev = waypoints[i - 1];
		const curr = waypoints[i];
		const next = waypoints[i + 1];
		const len1 = segmentLength(prev, curr);
		const len2 = segmentLength(curr, next);
		const r = Math.min(radius, len1 / 2, len2 / 2);
		if (r < 0.5) {
			commands.push(`L ${round1(curr.x)} ${round1(curr.y)}`);
			continue;
		}
		const ax = curr.x - ((curr.x - prev.x) / len1) * r;
		const ay = curr.y - ((curr.y - prev.y) / len1) * r;
		const bx = curr.x + ((next.x - curr.x) / len2) * r;
		const by = curr.y + ((next.y - curr.y) / len2) * r;
		commands.push(`L ${round1(ax)} ${round1(ay)}`);
		commands.push(`Q ${round1(curr.x)} ${round1(curr.y)} ${round1(bx)} ${round1(by)}`);
	}
	const last = waypoints[waypoints.length - 1];
	commands.push(`L ${round1(last.x)} ${round1(last.y)}`);
	return commands.join(' ');
}

/**
 * Computes a deterministic SVG path, sampled polyline, midpoint label anchor, arc length,
 * and bend count for an edge under `curved`, `orthogonal`, or `straight` routing.
 */
export function computeTechnicalEdgeRoute(
	edgeId: string,
	source: PortWorldAnchor,
	target: PortWorldAnchor,
	style: GraphRouteStyle,
	options: { readonly cornerRadius?: number; readonly stubOffset?: number } = {}
): RoutedTechnicalEdge {
	const cornerRadius = Math.max(0, options.cornerRadius ?? 10);
	const stub = Math.max(12, options.stubOffset ?? 28);
	const p0: Position = { x: round1(source.x), y: round1(source.y) };
	const p3: Position = { x: round1(target.x), y: round1(target.y) };

	if (style === 'straight') {
		const samplePoints = [p0, p3];
		return freezeDeep({
			edgeId,
			style,
			source,
			target,
			svgPath: `M ${p0.x} ${p0.y} L ${p3.x} ${p3.y}`,
			samplePoints,
			labelPosition: { x: round1((p0.x + p3.x) / 2), y: round1((p0.y + p3.y) / 2) },
			length: polylineLength(samplePoints),
			bends: 0,
			bounds: computeBounds(samplePoints),
		});
	}

	if (style === 'curved') {
		const dx = p3.x - p0.x;
		const dy = p3.y - p0.y;
		const tangent = dx >= 20
			? Math.max(40, Math.min(200, Math.abs(dx) * 0.45))
			: Math.max(70, Math.min(220, Math.abs(dx) * 0.35 + Math.abs(dy) * 0.25 + 60));
		const c1: Position = { x: round1(p0.x + tangent), y: p0.y };
		const c2: Position = { x: round1(p3.x - tangent), y: p3.y };
		const samplePoints = sampleCubicBezier(p0, c1, c2, p3, 12);
		const mid = samplePoints[Math.floor(samplePoints.length / 2)];
		return freezeDeep({
			edgeId,
			style,
			source,
			target,
			svgPath: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
			samplePoints,
			labelPosition: mid,
			length: polylineLength(samplePoints),
			bends: 1,
			bounds: computeBounds(samplePoints),
		});
	}

	// Orthogonal rounded-corner Manhattan route with backtrack handling when target is left of source.
	const waypoints: Position[] = [p0];
	if (p3.x >= p0.x + stub * 2) {
		const midX = round1((p0.x + p3.x) / 2);
		if (Math.abs(p0.y - p3.y) < 0.5) {
			waypoints.push(p3);
		} else {
			waypoints.push({ x: midX, y: p0.y }, { x: midX, y: p3.y }, p3);
		}
	} else {
		const outX = round1(p0.x + stub);
		const inX = round1(p3.x - stub);
		const detouredY = Math.abs(p3.y - p0.y) < 36
			? round1(p0.y - 56)
			: round1((p0.y + p3.y) / 2);
		waypoints.push(
			{ x: outX, y: p0.y },
			{ x: outX, y: detouredY },
			{ x: inX, y: detouredY },
			{ x: inX, y: p3.y },
			p3
		);
	}

	const midIdx = Math.floor((waypoints.length - 1) / 2);
	const labelPosition = {
		x: round1((waypoints[midIdx].x + waypoints[midIdx + 1].x) / 2),
		y: round1((waypoints[midIdx].y + waypoints[midIdx + 1].y) / 2),
	};
	return freezeDeep({
		edgeId,
		style,
		source,
		target,
		svgPath: buildRoundedOrthogonalPath(waypoints, cornerRadius),
		samplePoints: waypoints,
		labelPosition,
		length: polylineLength(waypoints),
		bends: Math.max(0, waypoints.length - 2),
		bounds: computeBounds(waypoints),
	});
}

function orientation(a: Position, b: Position, c: Position): number {
	return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsProperlyIntersect(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
	const eps = 1e-4;
	const shareEndpoint =
		(Math.abs(a1.x - b1.x) < eps && Math.abs(a1.y - b1.y) < eps)
		|| (Math.abs(a1.x - b2.x) < eps && Math.abs(a1.y - b2.y) < eps)
		|| (Math.abs(a2.x - b1.x) < eps && Math.abs(a2.y - b1.y) < eps)
		|| (Math.abs(a2.x - b2.x) < eps && Math.abs(a2.y - b2.y) < eps);
	if (shareEndpoint) {
		return false;
	}
	const o1 = orientation(a1, a2, b1);
	const o2 = orientation(a1, a2, b2);
	const o3 = orientation(b1, b2, a1);
	const o4 = orientation(b1, b2, a2);
	return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))
		&& ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
}

function boundsOverlap(a: RoutedTechnicalEdge['bounds'], b: RoutedTechnicalEdge['bounds']): boolean {
	return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Counts pairwise non-endpoint edge crossings across routed polylines (for quantitative
 * Phase 2/3 comparison of curved vs orthogonal vs straight routing on identical fixtures).
 */
export function countRouteCrossings(routes: readonly RoutedTechnicalEdge[]): number {
	let crossings = 0;
	for (let i = 0; i < routes.length; i++) {
		const rA = routes[i];
		for (let j = i + 1; j < routes.length; j++) {
			const rB = routes[j];
			if (!boundsOverlap(rA.bounds, rB.bounds)) {
				continue;
			}
			let hit = false;
			for (let si = 1; si < rA.samplePoints.length && !hit; si++) {
				for (let sj = 1; sj < rB.samplePoints.length; sj++) {
					if (segmentsProperlyIntersect(
						rA.samplePoints[si - 1],
						rA.samplePoints[si],
						rB.samplePoints[sj - 1],
						rB.samplePoints[sj]
					)) {
						crossings++;
						hit = true;
						break;
					}
				}
			}
		}
	}
	return crossings;
}

/**
 * Evaluates all three route styles (`curved`, `orthogonal`, `straight`) over the exact same
 * `TechnicalGraphProjection` and node positions, returning quantitative metrics for Phase 2/3.
 */
export function compareTechnicalRouteStyles(
	projection: TechnicalGraphProjection,
	nodePositions: Readonly<Record<string, Position>>,
	options: {
		readonly zoom?: number;
		readonly density?: GraphDensityMode;
		readonly expandedNodeIds?: ReadonlySet<string>;
		readonly selectedNodeId?: string | null;
	} = {}
): RouteStyleComparisonReport {
	const zoom = options.zoom ?? 1;
	const density = options.density ?? 'standard';
	const { resolveAnchor } = computeGraphPortAnchors(projection, nodePositions, options);

	const buildEntry = (style: GraphRouteStyle): RouteStyleComparisonEntry => {
		const routes = projection.edges.map(edge => {
			const source = resolveAnchor(edge.sourceId, edge.sourcePortId, 'outgoing');
			const target = resolveAnchor(edge.targetId, edge.targetPortId, 'incoming');
			return computeTechnicalEdgeRoute(edge.id, source, target, style);
		});
		const totalLength = round1(routes.reduce((sum, route) => sum + route.length, 0));
		const totalBends = routes.reduce((sum, route) => sum + route.bends, 0);
		return {
			style,
			edgeCount: routes.length,
			crossings: countRouteCrossings(routes),
			totalLength,
			averageLength: routes.length > 0 ? round1(totalLength / routes.length) : 0,
			totalBends,
			routes,
		};
	};

	const styles: Readonly<Record<GraphRouteStyle, RouteStyleComparisonEntry>> = {
		curved: buildEntry('curved'),
		orthogonal: buildEntry('orthogonal'),
		straight: buildEntry('straight'),
	};

	return freezeDeep({
		nodeCount: projection.nodes.length,
		edgeCount: projection.edges.length,
		zoom,
		density,
		styles,
	});
}

/**
 * Builds a deterministic, realistic Azure VM + N NIC attachments fixture for testing
 * 1 / 2 / 6 / 50 / 200 attachments, bounded rows, overflow aggregation, and route crossings.
 */
export function buildAttachmentScaleArchitecture(attachmentCount: number): {
	readonly architecture: Architecture;
	readonly positions: Readonly<Record<string, Position>>;
} {
	const count = Math.max(1, Math.min(250, Math.floor(attachmentCount)));
	const resources: Resource[] = [];
	const positions: Record<string, Position> = {};

	const makeBase = (id: string, type: string, x: number, y: number): Resource => {
		positions[id] = { x, y };
		return {
			id,
			name: id,
			terraformName: id,
			provider: 'azure',
			kind: 'generic',
			region: 'eastus',
			positions: { visual: { x, y }, technical: { x, y } },
			catalogue: { type, label: id, service: id, category: 'Networking', icon: 'azure-network.svg', fields: [] },
			settings: {},
			blocks: [],
			resourceRefs: {},
		};
	};

	const rg = makeBase('rg_main', 'azurerm_resource_group', 40, 40);
	const vnet = makeBase('vnet_core', 'azurerm_virtual_network', 40, 220);
	const snet = makeBase('snet_app', 'azurerm_subnet', 360, 220);
	resources.push(rg, vnet, snet);

	const nicRefs: { resourceId: string; attribute: string }[] = [];
	for (let i = 0; i < count; i++) {
		const id = `nic_${String(i + 1).padStart(3, '0')}`;
		const col = Math.floor(i / 10);
		const row = i % 10;
		const nic = makeBase(id, 'azurerm_network_interface', 700 + col * 320, 40 + row * 120);
		nic.settings = { resource_group_name: '' };
		nic.resourceRefs = {
			[bindingKey({ kind: 'setting', name: 'resource_group_name' })]: { refs: [{ resourceId: 'rg_main', attribute: 'name' }] },
		};
		resources.push(nic);
		nicRefs.push({ resourceId: id, attribute: 'id' });
	}

	const vm = makeBase('vm_hub', 'azurerm_linux_virtual_machine', 700 + Math.ceil(count / 10) * 320 + 120, 220);
	vm.settings = { network_interface_ids: '', resource_group_name: '' };
	vm.resourceRefs = {
		[bindingKey({ kind: 'setting', name: 'resource_group_name' })]: { refs: [{ resourceId: 'rg_main', attribute: 'name' }] },
		[bindingKey({ kind: 'setting', name: 'network_interface_ids' })]: { refs: nicRefs },
	};
	resources.push(vm);

	return {
		architecture: { name: `Scale_${count}`, items: [], connections: [], resources },
		positions: Object.freeze(positions),
	};
}
