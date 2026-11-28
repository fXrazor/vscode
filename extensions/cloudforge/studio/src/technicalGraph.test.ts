/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubSpokeArchitecture } from './graphFixtures.ts';
import { sampleArchitecture } from './fixture.ts';
import { createHistory, historyReducer, type Action, type Architecture } from './model.ts';
import { applyWaves, extractSourceEdgeEvidence, graphOverlays, lensEdges, matchesQuery, neighbourhood, orderingCycles, portId, projectTechnicalGraph, traceNode } from './technicalGraph.ts';
import { inputSize, layerOrder, layoutTechnicalGraph, placeInputs, treeLinkPath } from './technicalGraphLayout.ts';
import { defaultGraphPresentation, graphEditAllowed, graphPresentationReducer, parseGraphPresentation, serialiseGraphPresentation } from './graphPresentation.ts';
import { buildHostViewState } from './serviceAdapter.ts';
import { bundledGraphSvg, networkGraphSvg, technicalGraphSvg } from './technicalGraphExport.ts';
import { basisPath, bundleLayout, straighten } from './technicalGraphBundle.ts';
import { createForceSimulation, forceSettings, hullPath, nodeRadii, parseNetworkOptions, settleForce } from './technicalGraphForce.ts';

const layout = (architecture = hubSpokeArchitecture(), options: Partial<Parameters<typeof layoutTechnicalGraph>[1]> = {}) => {
	const snapshot = projectTechnicalGraph(architecture);
	return { snapshot, result: layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges: lensEdges(snapshot, 'all', false), ...options }) };
};

test('the graph snapshot is detached and frozen; projecting and laying out never changes the project', () => {
	const architecture = hubSpokeArchitecture(); const before = JSON.stringify(architecture);
	const { snapshot, result } = layout(architecture, { layout: 'scopes', pins: { aks: { x: 9000, y: 9000 } } });
	layoutTechnicalGraph(snapshot, { layout: 'tree', expanded: new Set(['aks']), compact: true, pins: {}, edges: snapshot.edges });
	assert.equal(JSON.stringify(architecture), before);
	assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.nodes[0]) && Object.isFrozen(snapshot.nodes[0].ports) && Object.isFrozen(snapshot.edges[0].evidence));
	assert.throws(() => { (snapshot.nodes[0] as { label: string }).label = 'x'; });
	// Layout output is fresh presentation data, not a reference to Resource.positions.
	const aks = architecture.resources.find(resource => resource.id === 'aks')!;
	assert.notEqual(result.positions.aks, aks.positions.technical);
	assert.deepEqual(result.positions.aks, { x: 9000, y: 9000 });
	assert.deepEqual(aks.positions, hubSpokeArchitecture().resources.find(resource => resource.id === 'aks')!.positions);
});

test('every edge carries instance evidence and rows explain the field and the peer', () => {
	const { snapshot } = layout();
	assert.ok(snapshot.edges.length > 20);
	assert.ok(snapshot.edges.every(edge => edge.evidence.length > 0 && edge.evidence.every(item => item.field && item.meaning)));
	const aks = snapshot.nodes.find(node => node.id === 'aks')!;
	const fields = aks.ports.map(port => port.field).sort();
	assert.deepEqual(fields, ['default_node_pool.vnet_subnet_id', 'identity.identity_ids', 'oms_agent.log_analytics_workspace_id']);
	assert.equal(aks.ports.find(port => port.peer === 'log')?.category, 'observability');
	assert.equal(aks.ports.find(port => port.peer === 'snet-aks')?.category, 'attachment');
	// The resource group appears as a scope chip, not as a row or a default line.
	assert.equal(aks.scope, 'rg-app'); assert.ok(!aks.ports.some(port => port.peer === 'rg-app'));
	assert.ok(lensEdges(snapshot, 'all', false).every(edge => !edge.membership));
	assert.ok(lensEdges(snapshot, 'all', true).some(edge => edge.membership && edge.source === 'rg-app'));
});

test('port ids are stable across resource reordering and refresh', () => {
	const architecture = hubSpokeArchitecture();
	const a = projectTechnicalGraph(architecture).nodes.find(node => node.id === 'vm-app')!.ports.map(port => port.id);
	const b = projectTechnicalGraph({ ...architecture, resources: [...architecture.resources].reverse() }).nodes.find(node => node.id === 'vm-app')!.ports.map(port => port.id);
	assert.deepEqual(a, b);
	assert.ok(a.includes(portId('vm-app', 'network_interface_ids', 'nic-app')));
});

test('lenses separate topology, observability and ordering meanings', () => {
	const { snapshot } = layout();
	assert.ok(lensEdges(snapshot, 'topology', false).every(edge => edge.category === 'ownership' || edge.category === 'attachment'));
	const telemetry = lensEdges(snapshot, 'observability', false);
	assert.ok(telemetry.length >= 3 && telemetry.every(edge => edge.category === 'observability'));
	assert.ok(telemetry.some(edge => edge.source === 'log' && edge.target === 'aks'));
});

test('layered layout reads network → security → compute → monitoring and centres a configured hub', () => {
	const { snapshot, result } = layout();
	const y = (id: string) => result.positions[id].y; const x = (id: string) => result.positions[id].x;
	assert.ok(y('vnet-hub') < y('nsg-aks') && y('nsg-aks') < y('aks') && y('aks') < y('log'));
	assert.deepEqual(snapshot.hubSpokes.map(star => star.hub), ['vnet-hub']);
	assert.ok(Math.min(x('vnet-aks'), x('vnet-data')) < x('vnet-hub') && x('vnet-hub') < Math.max(x('vnet-aks'), x('vnet-data')));
	assert.deepEqual(result.lanes.map(lane => lane.id.replace('lane:', '')), layerOrder.filter(layer => snapshot.nodes.some(node => node.layer === layer)));
	// No two cards overlap.
	const boxes = Object.entries(result.positions).map(([id, p]) => ({ id, ...p, ...result.sizes[id] }));
	for (const a of boxes) { for (const b of boxes) { if (a.id < b.id) { assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, a.id + ' overlaps ' + b.id); } } }
});

test('scope and tree layouts follow configured ownership, never names or proximity', () => {
	const scopes = layout(hubSpokeArchitecture(), { layout: 'scopes' }).result;
	assert.deepEqual(scopes.columns.map(column => column.label).sort(), ['rg-connectivity', 'rg-platform']);
	const tree = layout(hubSpokeArchitecture(), { layout: 'tree' }).result;
	assert.ok(tree.positions['rg-hub'].x < tree.positions['vnet-hub'].x && tree.positions['vnet-hub'].x < tree.positions['snet-fw'].x);
});

test('trace finds prerequisites and dependents; cycles are reported', () => {
	const { snapshot } = layout();
	const trace = traceNode(lensEdges(snapshot, 'dependencies', false), 'aks');
	assert.ok(trace.upstream.has('snet-aks') && trace.upstream.has('vnet-aks') && trace.upstream.has('id-aks'));
	assert.ok(traceNode(lensEdges(snapshot, 'all', false), 'id-aks').downstream.has('ra-kv'));
	assert.deepEqual(orderingCycles(['a', 'b', 'c'], [{ source: 'a', target: 'b', ordering: true }, { source: 'b', target: 'a', ordering: true }, { source: 'b', target: 'c', ordering: true }]), [['a', 'b']]);
	assert.deepEqual(snapshot.cycles, []);
});

test('graph presentation and pins stay outside the architecture history', () => {
	let history = createHistory(sampleArchitecture());
	let presentation = graphPresentationReducer(defaultGraphPresentation, { type: 'pin', id: 'cluster', position: { x: 1, y: 2 } });
	presentation = graphPresentationReducer(presentation, { type: 'toggleExpanded', id: 'cluster' });
	presentation = graphPresentationReducer(presentation, { type: 'set', patch: { lens: 'topology', layout: 'tree', route: 'orthogonal' } });
	assert.deepEqual(presentation.pins, { cluster: { x: 1, y: 2 } });
	assert.equal(history.past.length, 0);
	assert.deepEqual(graphPresentationReducer(presentation, { type: 'clearPins' }).pins, {});
	// Configuration edits from the graph are allowed; placement and structure edits are refused.
	const allowed: Action[] = [{ type: 'update', id: 'cluster', patch: { label: 'AKS' } }, { type: 'update', id: 'cluster', patch: { settings: { a: 'b' } } }, { type: 'bindResourceRef', id: 'cluster', target: { kind: 'setting', name: 'x' } }];
	const refused: Action[] = [{ type: 'move', id: 'cluster', mode: 'technical', position: { x: 0, y: 0 } }, { type: 'move', id: 'cluster', mode: 'visual', position: { x: 0, y: 0 } }, { type: 'placeResource', id: 'cluster', mode: 'visual' }, { type: 'resizeContainer', id: 'network', position: { x: 0, y: 0 }, width: 1, height: 1 }, { type: 'delete', id: 'cluster' }, { type: 'connect', source: 'a', target: 'b' }, { type: 'undo' }, { type: 'redo' }, { type: 'update', id: 'cluster', patch: { label: 'x', iconKind: 'storage' } }];
	assert.ok(allowed.every(graphEditAllowed)); assert.ok(refused.every(action => !graphEditAllowed(action)));
	history = historyReducer(history, allowed[0]);
	assert.equal(history.present.resources.find(resource => resource.id === 'cluster')!.label, 'AKS');
	assert.deepEqual(history.present.resources.find(resource => resource.id === 'cluster')!.positions, sampleArchitecture().resources.find(resource => resource.id === 'cluster')!.positions);
});

test('the graph renderer has no project dispatch and App gives it only the guarded edit channel', () => {
	const renderer = readFileSync(new URL('./TechnicalGraph.tsx', import.meta.url), 'utf8');
	assert.ok(!/type: '(move|placeResource|resizeContainer|resizeResource|delete|add|insert|connect|undo|redo|moveItem)'/.test(renderer));
	assert.ok(!/dispatch\s*[:=(]/.test(renderer.replace(/dispatchGraphEdit/g, '')));
	const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
	const usage = app.slice(app.indexOf('<TechnicalGraph'), app.indexOf('/>', app.indexOf('<TechnicalGraph')));
	assert.ok(usage.includes('onEdit={graphEdit}') && !/dispatch=\{/.test(usage));
	assert.match(app, /const graphEdit = useCallback\(\(action: Action\) => \{ if \(graphEditAllowed\(action\)\)/);
});

test('apply waves follow ordering edges, overlays join plan by address, and focus/search narrow the view', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	const waves = applyWaves(snapshot);
	assert.equal(waves['rg-app'], 0);
	assert.ok(waves['vnet-aks']! < waves['snet-aks']! && waves['snet-aks']! < waves.aks!);
	assert.ok(waves['ra-kv']! > waves['id-aks']!);
	const aksAddress = snapshot.nodes.find(node => node.id === 'aks')!.address;
	const { byNode, unmatchedPlan } = graphOverlays(snapshot, [{ resourceId: 'aks', severity: 'error', message: 'Subnet too small' }, { resourceId: 'missing', severity: 'warning', message: 'x' }], [
		{ address: aksAddress, actionKind: 'update', changedAttributePaths: ['default_node_pool.node_count'], hasSensitiveAttributes: false },
		{ address: snapshot.nodes.find(node => node.id === 'nic-app')!.address + '[0]', actionKind: 'create', changedAttributePaths: [], hasSensitiveAttributes: false },
		{ address: snapshot.nodes.find(node => node.id === 'nic-app')!.address + '[1]', actionKind: 'replace', changedAttributePaths: ['ip_configuration'], hasSensitiveAttributes: true },
		{ address: 'module.net.azurerm_subnet.x', actionKind: 'create', changedAttributePaths: [], hasSensitiveAttributes: false },
		{ address: 'data.azurerm_client_config.current', mode: 'data', actionKind: 'read', changedAttributePaths: [], hasSensitiveAttributes: false },
	]);
	assert.equal(byNode.aks.errors, 1); assert.equal(byNode.aks.plan?.action, 'update'); assert.equal(byNode.missing, undefined);
	assert.deepEqual({ action: byNode['nic-app'].plan?.action, instances: byNode['nic-app'].plan?.instances, sensitive: byNode['nic-app'].plan?.sensitive }, { action: 'replace', instances: 2, sensitive: true });
	assert.equal(unmatchedPlan, 1);
	const near = neighbourhood(lensEdges(snapshot, 'all', false), 'aks', 1);
	assert.ok(near.has('snet-aks') && near.has('log') && !near.has('vnet-hub'));
	const focused = layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges: lensEdges(snapshot, 'all', false), visible: near });
	assert.deepEqual(Object.keys(focused.positions).sort(), [...near].sort());
	assert.ok(matchesQuery(snapshot.nodes.find(node => node.id === 'aks')!, 'KUBERNETES_cluster'));
	assert.ok(!matchesQuery(snapshot.nodes.find(node => node.id === 'kv')!, 'aks'));
});

test('spacing: auto opens gaps crossed by many lines, percentages scale, cards never overlap', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture()); const edges = lensEdges(snapshot, 'all', false);
	const run = (spacing: 'auto' | number) => layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges, spacing });
	const extent = (r: ReturnType<typeof run>) => ({ w: Math.max(...Object.entries(r.positions).map(([id, p]) => p.x + r.sizes[id].width)), h: Math.max(...Object.entries(r.positions).map(([id, p]) => p.y + r.sizes[id].height)) });
	const base = extent(run(100)); const auto = extent(run('auto')); const wide = extent(run(150));
	assert.ok(auto.h > base.h && auto.w === base.w);
	assert.ok(wide.h > base.h * 1.3 && wide.w > base.w * 1.3);
	for (const r of [run('auto'), run(150), run(70)]) {
		const boxes = Object.entries(r.positions).map(([id, p]) => ({ id, ...p, ...r.sizes[id] }));
		for (const a of boxes) { for (const b of boxes) { if (a.id < b.id) { assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, a.id + ' overlaps ' + b.id); } } }
		for (const lane of r.lanes) { for (const id of lane.members ?? []) { assert.ok(r.positions[id].y >= lane.y && r.positions[id].y + r.sizes[id].height <= lane.y + lane.height, id + ' outside ' + lane.id); } }
	}
});

test('graph presentation persists under its own key and never as design positions', () => {
	const architecture = hubSpokeArchitecture();
	let state = graphPresentationReducer(defaultGraphPresentation, { type: 'set', patch: { lens: 'runtime', layout: 'tree', spacing: 150, height: 200, focus: { id: 'aks', depth: 2 } } });
	state = graphPresentationReducer(state, { type: 'pin', id: 'aks', position: { x: 9999.4, y: -40.6 } });
	const stored = serialiseGraphPresentation(state);
	assert.equal(Object.hasOwn(stored, 'focus'), false); assert.deepEqual(stored.pins, { aks: { x: 9999, y: -41 } });
	const view = buildHostViewState({ architecture, mode: 'technical', theme: 'light', selectedId: '', focusedWorkspaceOpen: false, inspectorOpen: false, libraryOpen: false, graph: stored });
	const aks = architecture.resources.find(resource => resource.id === 'aks')!;
	assert.deepEqual(view.nodePositions.visual?.aks, { x: Math.round(aks.positions.visual.x), y: Math.round(aks.positions.visual.y) });
	assert.deepEqual(view.graph?.pins, { aks: { x: 9999, y: -41 } });
	const restored = graphPresentationReducer(defaultGraphPresentation, { type: 'restore', state: parseGraphPresentation(JSON.parse(JSON.stringify(view.graph)))! });
	assert.equal(restored.lens, 'runtime'); assert.equal(restored.layout, 'tree'); assert.equal(restored.spacing, 150); assert.equal(restored.focus, undefined);
	assert.deepEqual(parseGraphPresentation({ lens: 'bogus', spacing: 10, pins: { a: { x: 'no' } } }), { pins: {} });
});

test('planned replace or destroy marks configured dependents as affected', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	const node = snapshot.nodes.find(item => item.id === 'snet-aks')!;
	const dependents = traceNode(snapshot.edges.filter(edge => edge.ordering && !edge.membership), 'snet-aks').downstream;
	const { byNode } = graphOverlays(snapshot, [], [{ address: node.address, actionKind: 'replace', changedAttributePaths: ['name'], hasSensitiveAttributes: false }]);
	assert.equal(byNode['snet-aks'].affectedBy, undefined);
	for (const id of dependents) { assert.deepEqual(byNode[id].affectedBy, ['snet-aks']); }
	const upstream = traceNode(snapshot.edges.filter(edge => edge.ordering && !edge.membership), 'snet-aks').upstream;
	for (const id of upstream) { assert.equal(byNode[id]?.affectedBy, undefined); }
	assert.equal(dependents.size, 3); assert.ok(upstream.size > 0);
});

test('var., local. and data. inputs become ghost cards outside the resource graph', () => {
	const architecture = hubSpokeArchitecture(); const snapshot = projectTechnicalGraph(architecture);
	assert.deepEqual(snapshot.inputs.map(input => input.address), ['data.azurerm_client_config.current', 'local.platform_scope', 'var.admin_ssh_public_key', 'var.kubernetes_version']);
	const ssh = snapshot.inputs.find(input => input.address === 'var.admin_ssh_public_key')!;
	assert.equal(ssh.sensitive, true); assert.equal(ssh.declared, true); assert.deepEqual(ssh.consumers, [{ resourceId: 'vm-app', field: 'admin_ssh_key' }]);
	assert.deepEqual(snapshot.inputs.find(input => input.kind === 'data')!.consumers, [{ resourceId: 'kv', field: 'tenant_id' }]);
	assert.equal(snapshot.nodes.length, architecture.resources.length, 'ghosts are not resource nodes');
	assert.ok(snapshot.edges.every(edge => !edge.source.startsWith('input:')), 'ghosts never enter ordering, waves or impact');
	const layout = layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges: snapshot.edges });
	const placed = placeInputs(snapshot.inputs, layout);
	const boxes = [...Object.values(placed.positions).map(p => ({ ...p, ...inputSize })), ...Object.entries(layout.positions).map(([id, p]) => ({ ...p, ...layout.sizes[id] }))];
	for (const [i, a] of boxes.entries()) { for (const b of boxes.slice(i + 1)) { assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y); } }
	assert.equal(Object.keys(placed.positions).length, 4); assert.ok(placed.lane);
});

test('exposure lens shows configured public entry, public access and what sits behind an entry', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	const exposure = (id: string) => snapshot.nodes.find(node => node.id === id)!.exposure;
	assert.equal(exposure('pip-fw')?.kind, 'entry'); assert.equal(exposure('st')?.kind, 'public-access'); assert.equal(exposure('afw')?.kind, 'behind-entry');
	assert.equal(exposure('aks'), undefined);
	const edges = lensEdges(snapshot, 'security', false);
	assert.ok(edges.some(edge => edge.source === 'pip-fw' && edge.target === 'afw'));
	assert.ok(edges.length < lensEdges(snapshot, 'dependencies', false).length);
	assert.ok(edges.every(edge => !edge.membership));
});

test('graph image export draws every laid-out card, edge and input without touching the project', () => {
	const architecture = hubSpokeArchitecture(); const before = JSON.stringify(architecture);
	const snapshot = projectTechnicalGraph(architecture); const edges = lensEdges(snapshot, 'all', false);
	const layout = layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges });
	const svg = technicalGraphSvg({ snapshot, layout, edges, inputs: placeInputs(snapshot.inputs, layout), theme: 'dark', title: 'Hub <&> spoke', badges: { aks: '± replace' } });
	assert.equal((svg.match(/<g data-id=/g) ?? []).length, snapshot.nodes.length);
	assert.equal((svg.match(/marker-end=/g) ?? []).length, edges.length);
	assert.ok(svg.includes('var.kubernetes_version') && svg.includes('± replace') && svg.includes('Hub &lt;&amp;&gt; spoke'));
	assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
	assert.equal(JSON.stringify(architecture), before);
});

test('planned changes inside a module fold onto the module call card', () => {
	const architecture = hubSpokeArchitecture();
	const base = architecture.resources.find(resource => resource.id === 'log')!;
	architecture.resources.push({ ...base, id: 'mod-net', name: 'network', kind: 'module', catalogue: undefined, parentId: undefined, resourceRefs: {}, settings: { source: './modules/network' } });
	const snapshot = projectTechnicalGraph(architecture);
	const module = snapshot.nodes.find(node => node.id === 'mod-net')!;
	assert.equal(module.address, 'module.network'); assert.deepEqual(module.module, { source: './modules/network' });
	const change = (address: string, actionKind: 'create' | 'replace' | 'noOp', moduleAddress?: string) => ({ address, moduleAddress, actionKind, changedAttributePaths: [], hasSensitiveAttributes: false });
	const { byNode, unmatchedPlan } = graphOverlays(snapshot, [], [change('module.network.azurerm_subnet.a', 'create', 'module.network'), change('module.network.azurerm_subnet.b[0]', 'replace', 'module.network'), change('module.network.azurerm_subnet.c', 'noOp', 'module.network'), change('module.other.azurerm_subnet.d', 'create', 'module.other')]);
	assert.deepEqual(byNode['mod-net'].inside, { create: 1, update: 0, replace: 1, delete: 0 });
	assert.equal(unmatchedPlan, 1);
});

test('bundled view places every resource on the circle grouped by layer and bundles each edge', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture()); const edges = lensEdges(snapshot, 'all', false);
	const bundle = bundleLayout(snapshot, edges);
	assert.equal(bundle.leaves.length, snapshot.nodes.length);
	for (const leaf of bundle.leaves) { assert.ok(Math.abs(Math.hypot(leaf.x, leaf.y) - bundle.radius) < 0.01); }
	const angles = bundle.leaves.map(leaf => leaf.angle); assert.deepEqual([...angles].sort((a, b) => a - b), angles); assert.equal(new Set(angles).size, angles.length);
	assert.deepEqual(bundle.groups.map(group => group.layer), layerOrder.filter(layer => snapshot.nodes.some(node => node.layer === layer)));
	for (const group of bundle.groups) { assert.ok(bundle.leaves.filter(leaf => leaf.layer === group.layer).every(leaf => leaf.angle >= group.start && leaf.angle <= group.end)); }
	assert.equal(bundle.paths.length, edges.filter(edge => edge.source !== edge.target).length);
	assert.ok(bundle.paths.every(path => path.d.startsWith('M ') && !path.d.includes('NaN')));
	assert.deepEqual(straighten([[0, 0], [10, 10], [20, 0]], 0), [[0, 0], [10, 0], [20, 0]]);
	assert.match(basisPath([[0, 0], [10, 10], [20, 0]]), /^M 0 0 C .* L 20 0$/);
	const focused = bundleLayout(snapshot, edges, { visible: new Set(['aks', 'snet-aks']) });
	assert.equal(focused.leaves.length, 2);
});

test('ownership-tree links stay in the column gap and never pass through another card', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	const layout = layoutTechnicalGraph(snapshot, { layout: 'tree', expanded: new Set(), compact: false, pins: {}, edges: snapshot.edges });
	const box = (id: string) => ({ ...layout.positions[id], ...layout.sizes[id] });
	let checked = 0;
	for (const node of snapshot.nodes) {
		const parent = [...node.scopePath].reverse().find(id => id !== node.id && layout.positions[id]); if (!parent) { continue; }
		const d = treeLinkPath(layout, parent, node.id);
		const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
		const points = []; for (let i = 0; i < numbers.length; i += 2) { points.push({ x: numbers[i], y: numbers[i + 1] }); }
		for (let i = 1; i < points.length; i++) {
			for (let t = 0.1; t < 1; t += 0.1) {
				const x = points[i - 1].x + (points[i].x - points[i - 1].x) * t; const y = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
				for (const other of snapshot.nodes) { if (other.id === parent || other.id === node.id) { continue; } const b = box(other.id); assert.ok(!(x > b.x + 1 && x < b.x + b.width - 1 && y > b.y + 1 && y < b.y + b.height - 1), `${parent}→${node.id} crosses ${other.id}`); }
			}
		}
		checked++;
	}
	assert.ok(checked > 20);
});

test('tidy tree centres parents on their children and folds collapsed branches', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture());
	const tree = layoutTechnicalGraph(snapshot, { layout: 'tree', expanded: new Set(), compact: false, pins: {}, edges: snapshot.edges });
	const centre = (id: string) => tree.positions[id].y + tree.sizes[id].height / 2;
	const subnets = ['snet-aks', 'snet-app'].filter(id => snapshot.nodes.find(node => node.id === id)!.scopePath.includes('vnet-aks'));
	assert.ok(subnets.length >= 1 && Math.abs(centre('vnet-aks') - (Math.min(...subnets.map(centre)) + Math.max(...subnets.map(centre))) / 2) < 40);
	const folded = layoutTechnicalGraph(snapshot, { layout: 'tree', expanded: new Set(), compact: false, pins: {}, edges: snapshot.edges, collapsed: new Set(['rg-app']) });
	assert.ok(folded.positions['rg-app'] && !folded.positions['vnet-aks'] && !folded.positions.aks);
	assert.ok(folded.positions['vnet-hub']);
	// rg-platform's many leaf children wrap into a block of columns no taller than six cards.
	const block = tree.treeBlocks?.['rg-app'] ?? [];
	assert.ok(block.length > 6); assert.ok(new Set(block.map(id => tree.positions[id].x)).size >= 2);
	assert.ok(new Set(block.map(id => tree.positions[id].y)).size <= 6);
});

test('network view settles deterministically with no overlapping icons and short links', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture()); const edges = lensEdges(snapshot, 'all', false);
	const a = settleForce(createForceSimulation(snapshot.nodes, edges)); const b = settleForce(createForceSimulation(snapshot.nodes, edges));
	assert.deepEqual(a.nodes.map(node => [node.x, node.y]), b.nodes.map(node => [node.x, node.y]));
	assert.equal(a.nodes.length, snapshot.nodes.length); assert.ok(a.alpha < 0.01);
	for (const [i, p] of a.nodes.entries()) { assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); for (const q of a.nodes.slice(i + 1)) { assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > forceSettings.radius * 1.6, p.id + ' overlaps ' + q.id); } }
	const at = new Map(a.nodes.map(node => [node.id, node])); const dist = (x: string, y: string) => Math.hypot(at.get(x)!.x - at.get(y)!.x, at.get(x)!.y - at.get(y)!.y);
	const linked = a.links.map(link => dist(link.source, link.target)); const all = a.nodes.flatMap((p, i) => a.nodes.slice(i + 1).map(q => dist(p.id, q.id)));
	assert.ok(linked.reduce((x, y) => x + y, 0) / linked.length < all.reduce((x, y) => x + y, 0) / all.length);
});

test('network nodes grow with their connections, by a percentage, and keep clear of each other', () => {
	const snapshot = projectTechnicalGraph(hubSpokeArchitecture()); const edges = lensEdges(snapshot, 'all', true);
	const degree = (id: string) => edges.filter(edge => edge.source === id || edge.target === id).length;
	const busiest = [...snapshot.nodes].sort((a, b) => degree(b.id) - degree(a.id))[0];
	const radii = nodeRadii(snapshot.nodes, edges, 100);
	assert.equal(radii[busiest.id], forceSettings.radius * 2, 'the busiest node is 100% bigger');
	// The resource group with the most members is the biggest: lines into it count, never shrink it.
	assert.equal(snapshot.nodes.find(node => node.id === busiest.id)?.label, 'rg-platform');
	const dependents = nodeRadii(snapshot.nodes, edges.filter(edge => !edge.membership), 100, 'dependents');
	const vnet = snapshot.nodes.find(node => node.label === 'vnet-hub')!; const peering = snapshot.nodes.find(node => node.label === 'hub-to-aks')!;
	assert.ok(dependents[vnet.id] > dependents[peering.id], 'a VNet that peerings reference outgrows the peering');
	const leaf = snapshot.nodes.find(node => degree(node.id) === 0);
	if (leaf) { assert.equal(radii[leaf.id], forceSettings.radius); }
	for (const node of snapshot.nodes) { assert.ok(radii[node.id] <= radii[busiest.id]); assert.ok(radii[node.id] >= forceSettings.radius); }
	assert.ok(Object.values(nodeRadii(snapshot.nodes, edges, 0)).every(r => r === forceSettings.radius), 'off means equal sizes');
	const sim = settleForce(createForceSimulation(snapshot.nodes, edges, { radii, network: { clusters: 'scope' } }));
	for (const [i, p] of sim.nodes.entries()) { for (const q of sim.nodes.slice(i + 1)) { assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > (p.r + q.r) * 0.8, p.id + ' overlaps ' + q.id); } }
	// Longer links spread the graph out; options never touch the architecture.
	const spread = (link: number) => { const s = settleForce(createForceSimulation(snapshot.nodes, edges, { network: { linkLength: link } })); const at = new Map(s.nodes.map(node => [node.id, node])); return s.links.reduce((sum, l) => sum + Math.hypot(at.get(l.source)!.x - at.get(l.target)!.x, at.get(l.source)!.y - at.get(l.target)!.y), 0) / s.links.length; };
	assert.ok(spread(200) > spread(60));
	const wide = (value: number) => { const s = settleForce(createForceSimulation(snapshot.nodes, edges, { network: { spread: value } })); const xs = s.nodes.map(node => node.x); const ys = s.nodes.map(node => node.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
	assert.ok(wide(300) > wide(150) * 1.8 && wide(150) > wide(60) * 1.8, 'the spread dial spreads the whole graph');
});

test('network options persist sanitised, and cluster hulls enclose their members', () => {
	assert.deepEqual(parseNetworkOptions({ sizeBy: 999, linkLength: 5, spacing: 'x', clusters: 'bogus', labels: 'all', links: 'straight' }), { sizeBy: 300, sizeCount: 'all', spread: 150, linkLength: 40, spacing: 100, clusters: 'scope', labels: 'all', links: 'straight' });
	assert.equal(parseNetworkOptions(null), undefined);
	const state = graphPresentationReducer(defaultGraphPresentation, { type: 'set', patch: { layout: 'force', network: { ...defaultGraphPresentation.network, sizeBy: 150, clusters: 'layer' } } });
	const restored = parseGraphPresentation(JSON.parse(JSON.stringify(serialiseGraphPresentation(state))));
	assert.deepEqual(restored?.network, state.network);
	const host = readFileSync(new URL('../../src/canvas/protocol.ts', import.meta.url), 'utf8');
	assert.match(host, /sanitizeNetworkOptions\(value\.network\)/);
	const d = hullPath([{ x: 0, y: 0, r: 20 }, { x: 200, y: 0, r: 20 }, { x: 100, y: 150, r: 30 }]);
	assert.match(d, /^M .* Z$/); const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
	assert.ok(Math.min(...xs) < -20 && Math.max(...xs) > 220);
	assert.equal(hullPath([]), '');
});

test('large networks use the approximate solver and still settle apart', () => {
	const layers = ['network', 'compute', 'data', 'security'] as const;
	const nodes = Array.from({ length: 900 }, (_, i) => ({ id: 'n' + i, layer: layers[i % 4], scope: 'rg' + (i % 9), scopePath: ['rg' + (i % 9)] }));
	const edges = Array.from({ length: 1200 }, (_, i) => ({ source: 'n' + ((i * 7) % 900), target: 'n' + ((i * 13 + 5) % 900), membership: false }));
	const started = performance.now(); const sim = settleForce(createForceSimulation(nodes, edges, { radii: nodeRadii(nodes, edges, 150) }), 120);
	assert.ok(performance.now() - started < 5000);
	assert.ok(sim.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
	let close = 0; for (const [i, p] of sim.nodes.entries()) { for (const q of sim.nodes.slice(i + 1)) { if (Math.hypot(p.x - q.x, p.y - q.y) < (p.r + q.r) * 0.6) { close++; } } }
	assert.ok(close < sim.nodes.length * 0.02, close + ' overlapping pairs');
});

test('multi-cloud estate: every top-level scope gets its own cluster, kept apart in Network, with real AWS and Google icons', async () => {
	const { estateArchitecture } = await import('./estateFixture.ts'); const { coreIcon } = await import('./coreIcons.ts');
	const snapshot = projectTechnicalGraph(estateArchitecture()); const edges = lensEdges(snapshot, 'all', true);
	const tops = new Set(snapshot.nodes.map(node => node.scopePath[0] ?? node.id));
	for (const id of ['rg-conn', 'rg-prod', 'vpc-prod', 'vpc-shared', 'prj-platform', 'prj-analytics']) { assert.ok(tops.has(id), id); }
	assert.ok(snapshot.nodes.find(node => node.id === 'gke')!.scopePath.includes('prj-platform'), 'a Google Cloud project is a scope');
	assert.ok(snapshot.nodes.filter(node => node.provider !== 'azure').every(node => !node.icon.includes('azure-resource-groups')), 'AWS and Google resources never show the Azure placeholder');
	assert.equal(coreIcon('aws_vpc', 'azure-resource-groups.svg'), 'catalog-icons/aws/aws-virtual-private-cloud.svg');
	assert.equal(coreIcon('azurerm_resource_group', 'azure-resource-groups.svg'), 'azure-resource-groups.svg');
	const sim = settleForce(createForceSimulation(snapshot.nodes, edges, { radii: nodeRadii(snapshot.nodes, edges, 150) }));
	const groups = new Map<string, typeof sim.nodes>(); for (const node of sim.nodes) { groups.set(node.group, [...(groups.get(node.group) ?? []), node]); }
	const discs = [...groups.values()].map(members => { const x = members.reduce((s, n) => s + n.x, 0) / members.length; const y = members.reduce((s, n) => s + n.y, 0) / members.length; return { x, y, r: Math.max(...members.map(n => Math.hypot(n.x - x, n.y - y) + n.r)) }; });
	for (const [i, a] of discs.entries()) { for (const b of discs.slice(i + 1)) { assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, 'scope clusters overlap'); } }
	const scopes = layoutTechnicalGraph(snapshot, { layout: 'scopes', expanded: new Set(), compact: false, pins: {}, edges });
	const prod = scopes.columns.find(column => column.id === 'column:rg-prod')!; assert.ok(new Set((prod.members ?? []).map(id => scopes.positions[id].x)).size >= 4, 'a large resource group wraps into a block, not a thin column');
});

test('service-graph edges gain exact field provenance and card ports from readResourceValues without false prefix matches or mutations', () => {
	const architecture: Architecture = {
		name: 'Service Provenance',
		resources: [
			{ id: 'snet-app', kind: 'subnet' as const, provider: 'azure' as const, name: 'app', terraformName: 'app', region: 'uksouth', settings: {}, blocks: [], positions: { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } } },
			{ id: 'snet-app-two', kind: 'subnet' as const, provider: 'azure' as const, name: 'app_two', terraformName: 'app_two', region: 'uksouth', settings: {}, blocks: [], positions: { visual: { x: 0, y: 80 }, technical: { x: 0, y: 80 } } },
			{ id: 'nic', kind: 'generic' as const, provider: 'azure' as const, name: 'web_nic', terraformName: 'web_nic', region: 'uksouth', catalogue: { type: 'azurerm_network_interface', label: 'Network Interface', service: 'Network', category: 'Networking', icon: '', fields: [] }, settings: {}, blocks: [], positions: { visual: { x: 200, y: 0 }, technical: { x: 200, y: 0 } } },
			{ id: 'mod-net', kind: 'module' as const, provider: 'azure' as const, name: 'network', region: 'uksouth', settings: { Source: './modules/net' }, blocks: [], positions: { visual: { x: 400, y: 0 }, technical: { x: 400, y: 0 } } },
		],
		items: [],
		connections: [
			{ id: 'snet-app->nic', source: { kind: 'element' as const, elementId: 'snet-app' }, target: { kind: 'element' as const, elementId: 'nic' }, label: 'reference', origin: { kind: 'service' as const, edgeKind: 'reference' } },
			{ id: 'snet-app-two->nic', source: { kind: 'element' as const, elementId: 'snet-app-two' }, target: { kind: 'element' as const, elementId: 'nic' }, label: 'reference', origin: { kind: 'service' as const, edgeKind: 'reference' } },
		],
	};
	const before = JSON.stringify(architecture);
	const fileValues = [
		{
			address: 'azurerm_network_interface.web_nic',
			file: 'network.tf',
			attributes: {},
			blocks: [
				{ name: 'ip_configuration', attributes: { subnet_id: { kind: 'expression' as const, text: 'azurerm_subnet.app.id' } }, blocks: [] },
			],
		},
	];
	// Prefix boundary guard: azurerm_subnet.app must NOT match azurerm_subnet.app_two
	assert.deepEqual(extractSourceEdgeEvidence(fileValues[0], 'azurerm_subnet.app'), [{ field: 'ip_configuration.subnet_id', expression: 'azurerm_subnet.app.id' }]);
	assert.deepEqual(extractSourceEdgeEvidence(fileValues[0], 'azurerm_subnet.app_two'), []);

	const withoutValues = projectTechnicalGraph(architecture);
	const withValues = projectTechnicalGraph(architecture, fileValues);
	assert.equal(JSON.stringify(architecture), before, 'architecture stays untouched');
	assert.notEqual(withValues.revision, withoutValues.revision, 'enriched provenance updates snapshot revision');

	const enrichedEdge = withValues.edges.find(edge => edge.source === 'snet-app' && edge.target === 'nic')!;
	assert.equal(enrichedEdge.confidence, 'source-graph');
	assert.equal(enrichedEdge.evidence[0].field, 'ip_configuration.subnet_id');
	assert.equal(enrichedEdge.evidence[0].expression, 'azurerm_subnet.app.id');
	const nicNode = withValues.nodes.find(node => node.id === 'nic')!;
	assert.ok(nicNode.ports.some(port => port.field === 'ip_configuration.subnet_id' && port.peer === 'snet-app'), 'card port shows real source field');

	const untouchedEdge = withValues.edges.find(edge => edge.source === 'snet-app-two' && edge.target === 'nic')!;
	assert.equal(untouchedEdge.evidence[0].expression, undefined, 'unreferenced peer stays generic');

	const modNode = withValues.nodes.find(node => node.id === 'mod-net')!;
	assert.deepEqual(modNode.module, { source: './modules/net' }, 'reads capitalised module Source setting');
});

test('network node sizing: the most connected node is biggest, every extra connection adds size, and tiny graphs stay compact', () => {
	const small = nodeRadii(
		[{ id: 'vm' }, { id: 'vnet1' }, { id: 'vnet2' }, { id: 'rg' }],
		[{ source: 'rg', target: 'vnet1', membership: true }, { source: 'rg', target: 'vnet2', membership: true }],
		150
	);
	assert.equal(small.vm, forceSettings.radius, 'a node with no lines keeps the base size');
	assert.ok(small.vm < small.vnet1 && small.vnet1 < small.rg, 'size follows connections');
	assert.ok(small.rg > forceSettings.radius * 1.6 && small.rg < forceSettings.radius * 2.5, 'a two-link node in a tiny graph grows without ballooning: ' + small.rg);

	const cluster = nodeRadii(
		[{ id: 'rg' }, { id: 'snet' }, { id: 'vnet' }, { id: 'nic' }, { id: 'vm' }, { id: 'aks' }, { id: 'log' }, { id: 'orphan' }],
		[
			{ source: 'rg', target: 'snet', membership: true }, { source: 'rg', target: 'vnet', membership: true },
			{ source: 'rg', target: 'nic', membership: true }, { source: 'rg', target: 'vm', membership: true },
			{ source: 'rg', target: 'aks', membership: true }, { source: 'rg', target: 'log', membership: true },
			{ source: 'vnet', target: 'snet', membership: false }, { source: 'snet', target: 'nic', membership: false },
		],
		150
	);
	assert.ok(cluster.orphan < cluster.aks && cluster.aks < cluster.vnet && cluster.vnet < cluster.snet && cluster.snet < cluster.rg, 'strict progression by connections');
	assert.equal(cluster.rg, forceSettings.radius * 2.5, 'busiest hub reaches full configured growth');
});

test('technicalGraphSvg preserves colour and softly dims outside cards and edges when a scope spotlight is active', () => {
	const architecture = hubSpokeArchitecture();
	const before = JSON.stringify(architecture);
	const snapshot = projectTechnicalGraph(architecture);
	const edges = lensEdges(snapshot, 'all', false);
	const layout = layoutTechnicalGraph(snapshot, { layout: 'layers', expanded: new Set(), compact: false, pins: {}, edges });
	const spotlight = new Set(snapshot.nodes.filter(node => node.id === 'rg-app' || node.scopePath.includes('rg-app')).map(node => node.id));
	assert.ok(spotlight.has('rg-app') && spotlight.has('aks') && !spotlight.has('vnet-hub'));

	const svg = technicalGraphSvg({ snapshot, layout, edges, theme: 'light', title: 'Spotlight check', spotlight });
	assert.equal(JSON.stringify(architecture), before, 'SVG export never mutates architecture');
	assert.ok(!svg.includes('grayscale'), 'spotlight export stays colour-preserving without grayscale filter');
	assert.match(svg, /<g data-id="aks" transform="[^"]+">/, 'spotlighted card keeps full opacity');
	assert.match(svg, /<g data-id="vnet-hub" transform="[^"]+" opacity="0\.22">/, 'outside card softens to 0.22 opacity');
	assert.match(svg, /<path d="[^"]+" fill="none" stroke="[^"]+" stroke-width="1\.6"[^<>]* opacity="0\.12" marker-end="/, 'outside edge softens to 0.12 opacity');
});

test('networkGraphSvg exports live force-directed nodes, gradual sizing, sleek rings, hulls, and colour-preserving spotlight', () => {
	const architecture = hubSpokeArchitecture();
	const before = JSON.stringify(architecture);
	const snapshot = projectTechnicalGraph(architecture);
	const edges = lensEdges(snapshot, 'all', false);
	const membership = snapshot.edges.filter(edge => edge.membership);
	const allSizing = lensEdges(snapshot, 'all', true);
	const radii = nodeRadii(snapshot.nodes, allSizing, 150, 'all');
	const sim = settleForce(createForceSimulation(snapshot.nodes, [...edges, ...membership], { radii, network: defaultGraphPresentation.network }));
	const spotlight = new Set(snapshot.nodes.filter(node => node.id === 'rg-app' || node.scopePath.includes('rg-app')).map(node => node.id));

	const svg = networkGraphSvg({
		snapshot,
		simNodes: sim.nodes,
		edges,
		membership,
		network: defaultGraphPresentation.network,
		theme: 'dark',
		title: 'Network check',
		spotlight,
	});
	assert.equal(JSON.stringify(architecture), before, 'network SVG export never mutates architecture');
	assert.ok(!svg.includes('grayscale'), 'network spotlight export stays colour-preserving');
	assert.match(svg, /<g data-id="aks" data-r="[0-9.]+" transform="translate\([^)]+\)">/, 'spotlighted network node keeps full opacity');
	assert.match(svg, /<g data-id="vnet-hub" data-r="[0-9.]+" transform="translate\([^)]+\)" opacity="0\.22">/, 'outside network node softens to 0.22');
	assert.ok(svg.includes('RG-PLATFORM'), 'exports scope cluster hulls with real scope labels');
	assert.ok(svg.includes('stroke-width="2.6"') || svg.includes('stroke-width="1.6"'), 'preserves bounded sleek ring strokes');
});

test('bundledGraphSvg exports radial hierarchical edge-bundling layout with colour-preserving spotlight', () => {
	const architecture = hubSpokeArchitecture();
	const before = JSON.stringify(architecture);
	const snapshot = projectTechnicalGraph(architecture);
	const edges = lensEdges(snapshot, 'all', false);
	const spotlight = new Set(snapshot.nodes.filter(node => node.id === 'rg-app' || node.scopePath.includes('rg-app')).map(node => node.id));

	const svg = bundledGraphSvg({ snapshot, edges, theme: 'light', title: 'Bundled check', spotlight });
	assert.equal(JSON.stringify(architecture), before, 'bundled SVG export never mutates architecture');
	assert.ok(!svg.includes('grayscale'), 'bundled spotlight export stays colour-preserving');
	assert.match(svg, /<g data-id="aks" transform="rotate\([^)]+\) translate\([^)]+\)[^"]*">/, 'spotlighted leaf stays full opacity');
	assert.match(svg, /<g data-id="vnet-hub" transform="rotate\([^)]+\) translate\([^)]+\)[^"]*" opacity="0\.22">/, 'outside leaf softens to 0.22');
	assert.ok(svg.includes('opacity="0.08"'), 'outside bundled curves soften to 0.08');
});

test('a scope column is wide enough for its title, so titles never run into the next column', () => {
	const architecture = hubSpokeArchitecture();
	const long = 'azurerm_resource_group.a_very_long_resource_group_name_for_testing';
	const renamed = { ...architecture, resources: architecture.resources.map(resource => resource.id === 'rg-hub' ? { ...resource, label: long } : resource) };
	const scopes = layout(renamed, { layout: 'scopes' }).result;
	const column = scopes.columns.find(item => item.label === long)!;
	assert.ok(column, 'the long title is a column');
	assert.ok(column.width >= long.length * 7.2 + 32 - 8 - 1, 'column ' + column.width + ' fits the title');
	const sorted = [...scopes.columns].sort((a, b) => a.x - b.x);
	for (let i = 1; i < sorted.length; i++) { assert.ok(sorted[i - 1].x + sorted[i - 1].width <= sorted[i].x, 'columns do not overlap'); }
});

test('resources read from files, with containment but no configured parent, still form a tree', () => {
	const architecture = hubSpokeArchitecture();
	// Files give containment from references (the canvas nesting), not a configured parent.
	const fromFiles = { ...architecture, resources: architecture.resources.map(resource => resource.parentId ? { ...resource, parentId: undefined, visualParentId: resource.parentId } : resource) };
	const configured = layout(architecture, { layout: 'tree' }).result;
	const read = layout(fromFiles, { layout: 'tree' }).result;
	assert.ok(read.positions['rg-hub'].x < read.positions['vnet-hub'].x && read.positions['vnet-hub'].x < read.positions['snet-fw'].x, 'rg → vnet → subnet branches out');
	assert.deepEqual(read.positions, configured.positions);
	const scopes = layout(fromFiles, { layout: 'scopes' }).result;
	assert.deepEqual(scopes.columns.map(column => column.label).sort(), ['rg-connectivity', 'rg-platform']);
});
