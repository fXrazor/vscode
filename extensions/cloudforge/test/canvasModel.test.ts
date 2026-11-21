/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptiveGridStep, buildCanvasProjection, fitRectToStage, inferProvider } from '../src/canvas/layout.ts';
import { defaultCanvasViewState, parseWebviewMessage, sanitizeViewState, type CanvasGraphSnapshot } from '../src/canvas/protocol.ts';

function sampleGraph(): CanvasGraphSnapshot {
	return {
		workspaceId: 'workspace-' + 'a'.repeat(32),
		architectureId: 'arch-1',
		architectureName: 'Hub Network',
		sourceRevision: 'b'.repeat(64),
		status: 'complete',
		nodes: [
			{ id: 'n1', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'hub', label: 'azurerm_resource_group.hub', hasSource: true },
			{ id: 'n2', kind: 'resource', resourceType: 'azurerm_virtual_network', name: 'vnet', label: 'azurerm_virtual_network.vnet', hasSource: true },
			{ id: 'n3', kind: 'resource', resourceType: 'azurerm_subnet', name: 'app', label: 'azurerm_subnet.app', hasSource: true },
			{ id: 'n4', kind: 'resource', resourceType: 'azurerm_storage_account', name: 'logs', label: 'azurerm_storage_account.logs', hasSource: true },
			{ id: 'n5', kind: 'module', resourceType: null, name: 'firewall', label: 'module.firewall', hasSource: true },
		],
		edges: [
			{ fromId: 'n1', toId: 'n2', kind: 'reference' },
			{ fromId: 'n2', toId: 'n3', kind: 'reference' },
			{ fromId: 'n1', toId: 'n4', kind: 'reference' },
			{ fromId: 'n3', toId: 'n5', kind: 'reference' },
		],
		diagnostics: [],
	};
}

test('layout orders dependencies left-to-right and supports visual and technical card geometry', () => {
	const graph = sampleGraph();
	const visual = buildCanvasProjection(graph, 'visual', '', new Set());
	const technical = buildCanvasProjection(graph, 'technical', '', new Set());

	assert.equal(visual.totalNodes, 5);
	assert.equal(visual.visibleNodes, 5);
	assert.equal(visual.hiddenByFilterOrCollapse, 0);
	assert.equal(visual.visibleEdges, 4);

	const vnetV = visual.nodes.find(n => n.node.id === 'n2')!;
	const subnetV = visual.nodes.find(n => n.node.id === 'n3')!;
	assert.ok(subnetV.x > vnetV.x, 'dependent subnet should be placed to the right of its vnet');
	assert.equal(vnetV.incomingCount, 1);
	assert.equal(vnetV.outgoingCount, 1);

	const vnetT = technical.nodes.find(n => n.node.id === 'n2')!;
	assert.ok(vnetT.width > vnetV.width, 'technical cards are wider than visual cards');
	assert.ok(vnetT.height > vnetV.height, 'technical cards are taller than visual cards');
});

test('layout handles dependency cycles without infinite loops', () => {
	const graph: CanvasGraphSnapshot = {
		...sampleGraph(),
		nodes: [
			{ id: 'a', kind: 'resource', resourceType: 'aws_security_group', name: 'a', label: 'aws_security_group.a', hasSource: true },
			{ id: 'b', kind: 'resource', resourceType: 'aws_security_group', name: 'b', label: 'aws_security_group.b', hasSource: true },
		],
		edges: [
			{ fromId: 'a', toId: 'b', kind: 'reference' },
			{ fromId: 'b', toId: 'a', kind: 'reference' },
		],
	};
	const projection = buildCanvasProjection(graph, 'visual', '', new Set());
	assert.equal(projection.visibleNodes, 2);
	assert.equal(projection.visibleEdges, 2);
});

test('collapsed groups hide member nodes, preserve counts, and route summary cross-group edges', () => {
	const graph = sampleGraph();
	const collapsed = new Set(['group:azure:network']);
	const projection = buildCanvasProjection(graph, 'visual', '', collapsed);
	const networkGroup = projection.groups.find(g => g.id === 'group:azure:network')!;
	assert.equal(networkGroup.collapsed, true);
	assert.equal(networkGroup.visibleCount, 2);
	assert.equal(projection.visibleNodes, 3);
	assert.equal(projection.hiddenByFilterOrCollapse, 2);
	assert.ok(projection.edges.some(edge => edge.collapsedSummary), 'cross-group edges collapse to group summaries');
});

test('scoped search filters visible resources while keeping whole-graph counts accurate', () => {
	const graph = sampleGraph();
	const projection = buildCanvasProjection(graph, 'visual', 'storage', new Set());
	assert.equal(projection.totalNodes, 5);
	assert.equal(projection.visibleNodes, 1);
	assert.equal(projection.hiddenByFilterOrCollapse, 4);
	assert.equal(projection.nodes[0].node.id, 'n4');
});

test('provider inference classifies Azure, AWS, GCP, Kubernetes, and modules', () => {
	assert.equal(inferProvider({ id: '1', kind: 'resource', resourceType: 'azurerm_subnet', name: 'a', label: 'a', hasSource: true }), 'azure');
	assert.equal(inferProvider({ id: '2', kind: 'resource', resourceType: 'aws_vpc', name: 'a', label: 'a', hasSource: true }), 'aws');
	assert.equal(inferProvider({ id: '3', kind: 'resource', resourceType: 'google_compute_network', name: 'a', label: 'a', hasSource: true }), 'gcp');
	assert.equal(inferProvider({ id: '4', kind: 'resource', resourceType: 'kubernetes_namespace', name: 'a', label: 'a', hasSource: true }), 'kubernetes');
	assert.equal(inferProvider({ id: '5', kind: 'module', resourceType: null, name: 'm', label: 'module.m', hasSource: true }), 'module');
});

test('viewport fit and adaptive grid spacing stay bounded', () => {
	const vp = fitRectToStage({ minX: 48, minY: 48, maxX: 648, maxY: 448 }, 1200, 800);
	assert.ok(vp.zoom >= 0.15 && vp.zoom <= 1.25);
	assert.ok(Number.isFinite(vp.x) && Number.isFinite(vp.y));
	assert.ok(adaptiveGridStep(0.25) > adaptiveGridStep(2));
});

test('webview message parser accepts narrow intents and rejects untrusted payloads', () => {
	assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
	assert.deepEqual(parseWebviewMessage({ type: 'refresh' }), { type: 'refresh' });
	assert.deepEqual(parseWebviewMessage({ type: 'selectNode', nodeId: 'node-1' }), { type: 'selectNode', nodeId: 'node-1' });
	assert.deepEqual(parseWebviewMessage({ type: 'selectNode', nodeId: null }), { type: 'selectNode', nodeId: null });
	assert.deepEqual(parseWebviewMessage({ type: 'openSource', nodeId: 'node-1' }), { type: 'openSource', nodeId: 'node-1' });

	assert.equal(parseWebviewMessage(null), undefined);
	assert.equal(parseWebviewMessage({ type: 'openFile', path: 'C:\\secret.tf' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'openSource', nodeId: '' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'openSource', nodeId: 'bad\ncontrol' }), undefined);
	assert.equal(parseWebviewMessage({ type: 'selectNode', nodeId: 123 }), undefined);
});

test('view state sanitizer preserves valid independent theme/mode/viewports and strips invalid fields', () => {
	const sanitized = sanitizeViewState({
		mode: 'technical',
		theme: 'dark',
		grid: 'dots',
		selectedId: 'node-7',
		focusedWorkspaceOpen: true,
		inspectorOpen: false,
		listOpen: true,
		collapsedGroups: ['group:azure:network', 'group:azure:network', 'bad\x00id'],
		viewports: {
			visual: { x: 10, y: 20, zoom: 1.1 },
			technical: { x: Number.NaN, y: 0, zoom: 99 },
		},
	});
	assert.equal(sanitized.mode, 'technical');
	assert.equal(sanitized.theme, 'dark');
	assert.equal(sanitized.grid, 'dots');
	assert.equal(sanitized.selectedId, 'node-7');
	assert.equal(sanitized.focusedWorkspaceOpen, true);
	assert.deepEqual(sanitized.collapsedGroups, ['group:azure:network']);
	assert.deepEqual(sanitized.viewports, { visual: { x: 10, y: 20, zoom: 1.1 } });

	// Focused workspace cannot stay open when selectedId is null.
	const noSel = sanitizeViewState({ selectedId: null, focusedWorkspaceOpen: true });
	assert.equal(noSel.focusedWorkspaceOpen, false);
	assert.deepEqual(sanitizeViewState('corrupt'), defaultCanvasViewState());
});
