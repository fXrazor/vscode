/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { terraformCode } from './terraformProjection.ts';
import { projectTechnicalGraph } from './technicalGraphContract.ts';
import {
	buildAttachmentScaleArchitecture,
	compareTechnicalRouteStyles,
	computeGraphPortAnchors,
	computeNodeAttachmentLayout,
	computeTechnicalEdgeRoute,
	countRouteCrossings,
	resolveSemanticZoomBand
} from './technicalGraphRouting.ts';

test('Phase 2 semantic zoom collapses attachment rows to summary pills at overview zoom and bounds row growth at scale (1/2/6/50/200)', () => {
	assert.equal(resolveSemanticZoomBand(0.4), 'overview');
	assert.equal(resolveSemanticZoomBand(0.75), 'standard');
	assert.equal(resolveSemanticZoomBand(1.1), 'detailed');

	for (const count of [1, 2, 6, 50, 200]) {
		const { architecture } = buildAttachmentScaleArchitecture(count);
		const beforeJson = JSON.stringify(architecture);
		const beforeHcl = terraformCode(architecture);

		const projection = projectTechnicalGraph({ architecture, maxAttachmentPortsPerNode: 20 });
		const vm = projection.nodes.find(n => n.id === 'vm_hub')!;

		// Overview zoom collapses rows to pills and keeps node compact
		const overview = computeNodeAttachmentLayout(vm, { zoom: 0.4, density: 'standard' });
		assert.equal(overview.zoomBand, 'overview');
		assert.equal(overview.visibleRows.length, 0);
		assert.ok(overview.summaryPills.length >= 1);
		assert.ok(overview.height <= 110, `overview height stayed compact for ${count} attachments`);

		// Standard zoom bounds visible rows to 6 and reports exact overflow count
		const standard = computeNodeAttachmentLayout(vm, { zoom: 1.0, density: 'standard' });
		assert.ok(standard.visibleRows.length <= 6);
		const totalPortsOnVm = count + 1; // count NICs + 1 RG ownership
		assert.equal(standard.visibleRows.length + standard.overflowCount, totalPortsOnVm);

		// Expanded state reveals up to 12 rows (never unbounded height even at 200 attachments)
		const expanded = computeNodeAttachmentLayout(vm, { zoom: 1.0, density: 'standard', expanded: true });
		assert.ok(expanded.visibleRows.length <= 12);
		assert.equal(expanded.visibleRows.length + expanded.overflowCount, totalPortsOnVm);
		assert.ok(expanded.height <= 420, `expanded height remained bounded at ${count} attachments`);

		// Canonical Architecture and Terraform are completely untouched
		assert.equal(JSON.stringify(architecture), beforeJson);
		assert.equal(terraformCode(architecture), beforeHcl);
	}
});

test('Phase 2 port anchors keep stable port IDs across ordering changes and fall back cleanly when collapsed', () => {
	const { architecture, positions } = buildAttachmentScaleArchitecture(8);
	const projection = projectTechnicalGraph({ architecture, maxAttachmentPortsPerNode: 12 });

	const standardAnchors = computeGraphPortAnchors(projection, positions, { zoom: 1.0, density: 'standard' });
	const vmLayout = standardAnchors.layouts.vm_hub;
	assert.equal(vmLayout.visibleRows.length, 6);
	assert.equal(vmLayout.overflowCount, 3);

	// A visible port resolves to its exact row anchor (not fallback)
	const visiblePort = vmLayout.visibleRows[0];
	const resolvedVisible = standardAnchors.resolveAnchor('vm_hub', visiblePort.portId, visiblePort.direction);
	assert.equal(resolvedVisible.aggregatedIntoFallback, false);
	assert.equal(resolvedVisible.x, positions.vm_hub.x + visiblePort.anchorOffset.x);
	assert.equal(resolvedVisible.y, positions.vm_hub.y + visiblePort.anchorOffset.y);

	// An overflow port resolves cleanly to the node fallback anchor
	const overflowPort = vmLayout.overflowPorts[0];
	const resolvedOverflow = standardAnchors.resolveAnchor('vm_hub', overflowPort.portId, overflowPort.direction);
	assert.equal(resolvedOverflow.aggregatedIntoFallback, true);
	assert.equal(resolvedOverflow.y, positions.vm_hub.y + vmLayout.fallbackIncomingAnchor.y);
});

test('Phase 2 compares curved, orthogonal, and straight routes with deterministic paths and accurate crossing detection', () => {
	// Explicit X-crossing geometry: (0,0)->(200,200) crosses (0,200)->(200,0)
	const r1 = computeTechnicalEdgeRoute(
		'e1',
		{ nodeId: 'a', portId: 'p1', x: 0, y: 0, side: 'right', aggregatedIntoFallback: false },
		{ nodeId: 'b', portId: 'p2', x: 200, y: 200, side: 'left', aggregatedIntoFallback: false },
		'straight'
	);
	const r2 = computeTechnicalEdgeRoute(
		'e2',
		{ nodeId: 'c', portId: 'p3', x: 0, y: 200, side: 'right', aggregatedIntoFallback: false },
		{ nodeId: 'd', portId: 'p4', x: 200, y: 0, side: 'left', aggregatedIntoFallback: false },
		'straight'
	);
	assert.equal(countRouteCrossings([r1, r2]), 1);

	// Orthogonal route handles backward target (target.x < source.x) with rounded corners
	const backtrack = computeTechnicalEdgeRoute(
		'back',
		{ nodeId: 'b', portId: 'out', x: 300, y: 100, side: 'right', aggregatedIntoFallback: false },
		{ nodeId: 'a', portId: 'in', x: 100, y: 100, side: 'left', aggregatedIntoFallback: false },
		'orthogonal'
	);
	assert.match(backtrack.svgPath, /^M 300 100 .* Q .* L 100 100$/);
	assert.ok(backtrack.bends >= 4);

	// Full comparison report over identical 6-attachment fixture
	const { architecture, positions } = buildAttachmentScaleArchitecture(6);
	const projection = projectTechnicalGraph({ architecture });
	const report = compareTechnicalRouteStyles(projection, positions, { zoom: 1.0, density: 'standard' });

	assert.equal(report.edgeCount, projection.edges.length);
	assert.equal(report.styles.straight.totalBends, 0);
	assert.ok(report.styles.curved.routes.every(r => r.svgPath.includes(' C ')));
	assert.ok(report.styles.orthogonal.routes.every(r => r.svgPath.startsWith('M ')));
	assert.ok(report.styles.straight.totalLength <= report.styles.orthogonal.totalLength);
	assert.equal(Object.isFrozen(report), true);
});
