/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	alignPositionedNodes,
	buildCanvasProjection,
	computeFrameForNodes,
	computeSnapGuides,
	layerForNode,
	snapCoordinate
} from '../src/canvas/layout.ts';
import {
	renderArchitectureMarkdownReport,
	renderArchitectureSvg
} from '../src/canvas/exportDiagram.ts';
import {
	isValidExportFileName,
	parseWebviewMessage,
	sanitizeViewState,
	type CanvasGraphSnapshot
} from '../src/canvas/protocol.ts';
import { runOfflineValidation } from '../src/canvas/validationRunner.ts';

function sampleMultiLayerGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-phase5',
		architectureName: 'Landing Zone',
		sourceRevision: 'c'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'vnet', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet', label: 'azurerm_virtual_network.vnet', hasSource: true },
			{ id: 'nsg', kind: 'resource', resourceType: 'azurerm_network_security_group', name: 'edge_nsg', label: 'azurerm_network_security_group.edge_nsg', hasSource: true },
			{ id: 'aks', kind: 'resource', resourceType: 'azurerm_kubernetes_cluster', name: 'core_aks', label: 'azurerm_kubernetes_cluster.core_aks', hasSource: true },
			{ id: 'app', kind: 'module', resourceType: null, name: 'portal', label: 'module.portal', hasSource: true },
			{ id: 'logs', kind: 'resource', resourceType: 'azurerm_monitor_diagnostic_setting', name: 'audit', label: 'azurerm_monitor_diagnostic_setting.audit', hasSource: true },
		],
		edges: [
			{ fromId: 'rg', toId: 'vnet', kind: 'reference' },
			{ fromId: 'rg', toId: 'nsg', kind: 'reference' },
			{ fromId: 'vnet', toId: 'aks', kind: 'reference' },
			{ fromId: 'aks', toId: 'app', kind: 'reference' },
			{ fromId: 'aks', toId: 'logs', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('layer classification and layer visibility filtering preserve total counts and manual positions', () => {
	const graph = sampleMultiLayerGraph();
	assert.equal(layerForNode(graph.nodes[0]), 'infrastructure');
	assert.equal(layerForNode(graph.nodes[2]), 'security');
	assert.equal(layerForNode(graph.nodes[3]), 'platforms');
	assert.equal(layerForNode(graph.nodes[4]), 'applications');
	assert.equal(layerForNode(graph.nodes[5]), 'operations');

	const hidden = buildCanvasProjection(graph, 'visual', '', new Set(), {
		hiddenLayers: new Set(['security', 'operations']),
		nodePositions: { vnet: { x: 480, y: 240 } },
	});
	assert.equal(hidden.totalNodes, 6);
	assert.equal(hidden.visibleNodes, 4);
	assert.equal(hidden.hiddenByLayerCount, 2);
	assert.equal(hidden.layerCounts.security, 1);
	assert.equal(hidden.layerCounts.operations, 1);

	const movedVnet = hidden.nodes.find(n => n.node.id === 'vnet')!;
	assert.equal(movedVnet.x, 480);
	assert.equal(movedVnet.y, 240);
});

test('alignment, snap-to-grid, snap guides, and frame wrapping compute deterministic geometry', () => {
	const graph = sampleMultiLayerGraph();
	const projection = buildCanvasProjection(graph, 'visual', '', new Set());
	const subset = projection.nodes.slice(0, 3);

	assert.equal(snapCoordinate(23, 16), 16);
	assert.equal(snapCoordinate(25, 16), 32);

	const alignedLeft = alignPositionedNodes(subset, 'left');
	const xs = new Set(Object.values(alignedLeft).map(p => p.x));
	assert.equal(xs.size, 1);

	const alignedTop = alignPositionedNodes(subset, 'top');
	const ys = new Set(Object.values(alignedTop).map(p => p.y));
	assert.equal(ys.size, 1);

	const distributed = alignPositionedNodes(subset, 'distributeH');
	assert.equal(Object.keys(distributed).length, 3);

	const frame = computeFrameForNodes(subset, 'Hub Core', 'frame-1', 'emerald');
	assert.equal(frame.title, 'Hub Core');
	assert.equal(frame.color, 'emerald');
	for (const n of subset) {
		assert.ok(frame.x < n.x && frame.y < n.y);
		assert.ok(frame.x + frame.width > n.x + n.width && frame.y + frame.height > n.y + n.height);
	}

	const target = subset[0];
	const guide = computeSnapGuides({ x: target.x + 3, y: target.y + 40, width: target.width, height: target.height }, [target], 6);
	assert.equal(guide.x, target.x);
	assert.equal(guide.guideX, target.x);
});

test('SVG and Markdown exports respect scope, theme, annotations, validation, and provenance', () => {
	const graph = sampleMultiLayerGraph();
	const projection = buildCanvasProjection(graph, 'technical', '', new Set());
	const run = runOfflineValidation(graph, { scope: 'architecture' });
	const frame = computeFrameForNodes(projection.nodes.slice(0, 2), 'Network Core', 'frame-net', 'blue');

	const fullSvg = renderArchitectureSvg(graph, projection, {
		scope: 'architecture',
		theme: 'light',
		mode: 'technical',
		includeValidation: true,
		includeAnnotations: true,
		includeProvenance: true,
		capturedAtIso: '2026-11-23T10:00:00.000Z',
		frames: [frame],
		annotations: [{ id: 'note-1', text: 'Verify hub CIDR before prod', color: 'amber', x: 700, y: 120, width: 200 }],
		hiddenLayers: ['operations'],
		validationRun: run,
	});
	assert.ok(fullSvg.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
	assert.equal(fullSvg.nodeCount, 6);
	assert.ok(fullSvg.svg.includes('Landing Zone'));
	assert.ok(fullSvg.svg.includes('rev cccccccc'));
	assert.ok(fullSvg.svg.includes('Hidden layers: Operations'));
	assert.ok(fullSvg.svg.includes('Verify hub CIDR'));
	assert.ok(fullSvg.svg.includes('Network Core'));

	const frameSvg = renderArchitectureSvg(graph, projection, {
		scope: 'frame',
		frameId: frame.id,
		theme: 'dark',
		mode: 'visual',
		includeValidation: false,
		includeAnnotations: false,
		includeProvenance: true,
		capturedAtIso: '2026-11-23T10:00:00.000Z',
		frames: [frame],
		annotations: [],
		hiddenLayers: [],
	});
	assert.ok(frameSvg.nodeCount >= 2 && frameSvg.nodeCount <= 6);
	assert.ok(frameSvg.svg.includes('Frame: Network Core'));

	const md = renderArchitectureMarkdownReport(graph, projection, {
		scope: 'selection',
		selectedIds: ['rg', 'vnet'],
		theme: 'dark',
		mode: 'visual',
		includeValidation: true,
		includeAnnotations: true,
		includeProvenance: true,
		capturedAtIso: '2026-11-23T10:00:00.000Z',
		frames: [],
		annotations: [],
		hiddenLayers: [],
		validationRun: run,
		dependencyReport: {
			sourceRevision: graph.sourceRevision,
			engine: 'terraform',
			engineInferred: true,
			lockState: 'valid',
			providers: [{ display: 'hashicorp/azurerm', status: 'locked', lockedVersion: '5.14.0', conflictCount: 0, requirementCount: 1 }],
			unusedLockEntries: [],
			diagnosticCount: 0,
		},
	});
	assert.ok(md.includes('# Landing Zone'));
	assert.ok(md.includes('hashicorp/azurerm'));
	assert.ok(md.includes('Selection (2)'));
	assert.ok(md.includes('`hub`'));
	assert.ok(md.includes('`vnet`'));
	assert.ok(!md.includes('`core_aks`'));
});

test('Phase 5 protocol sanitization and exportArtifact validation reject unsafe filenames and corrupt state', () => {
	assert.equal(isValidExportFileName('hub-1234.svg', 'svg'), true);
	assert.equal(isValidExportFileName('hub-1234.png', 'png'), true);
	assert.equal(isValidExportFileName('hub-1234.md', 'markdown'), true);
	assert.equal(isValidExportFileName('../escape.svg', 'svg'), false);
	assert.equal(isValidExportFileName('wrong.txt', 'svg'), false);

	assert.ok(parseWebviewMessage({
		type: 'exportArtifact',
		format: 'svg',
		suggestedFileName: 'arch.svg',
		content: '<svg></svg>',
		encoding: 'utf8',
	}));
	assert.equal(parseWebviewMessage({
		type: 'exportArtifact',
		format: 'png',
		suggestedFileName: 'arch.png',
		content: 'not-base64-encoding-declared-utf8',
		encoding: 'utf8',
	}), undefined);
	assert.equal(parseWebviewMessage({
		type: 'exportArtifact',
		format: 'markdown',
		suggestedFileName: 'C:\\evil.md',
		content: '# hi',
		encoding: 'utf8',
	}), undefined);

	assert.equal(isValidExportFileName('hub.cloudforge.zip', 'bundle'), true);
	assert.equal(isValidExportFileName('hub.tf', 'bundle'), false);
	assert.ok(parseWebviewMessage({
		type: 'exportArtifact',
		format: 'bundle',
		suggestedFileName: 'hub.cloudforge.zip',
		content: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
		encoding: 'base64',
	}));
	assert.equal(parseWebviewMessage({
		type: 'exportArtifact',
		format: 'bundle',
		suggestedFileName: 'hub.cloudforge.zip',
		content: 'PK',
		encoding: 'utf8',
	}), undefined);

	const sanitized = sanitizeViewState({
		hiddenLayers: ['security', 'bogus', 'security'],
		snapToGrid: false,
		frames: [
			{ id: 'f1', title: 'Core', color: 'emerald', x: 10, y: 20, width: 300, height: 200 },
			{ id: 'bad', title: 'Too small', color: 'blue', x: 0, y: 0, width: 50, height: 40 },
		],
		annotations: [
			{ id: 'a1', text: 'Hello\x00world', color: 'rose', x: 100, y: 100, width: 220 },
		],
		nodePositions: {
			visual: { n1: { x: 120, y: 80 }, bad: { x: Number.NaN, y: 0 } },
		},
	});
	assert.deepEqual(sanitized.hiddenLayers, ['security']);
	assert.equal(sanitized.snapToGrid, false);
	assert.equal(sanitized.frames.length, 1);
	assert.equal(sanitized.annotations[0].text, 'Helloworld');
	assert.deepEqual(sanitized.nodePositions.visual, { n1: { x: 120, y: 80 } });
});
