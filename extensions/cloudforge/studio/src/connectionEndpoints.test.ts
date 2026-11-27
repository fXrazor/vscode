/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer, type Architecture, type BoardItem, type History } from './model.ts';
import { elementEndpoint as element, pointEndpoint as point, endpointElementId, endpointKey, needsConnectionOverlay, normaliseArchitectureConnections, normaliseEndpoint, projectPerimeterAnchor } from './connectionEndpoints.ts';
import { connectionPath } from './connectionGeometry.ts';
import { canConnectEndpoints, connectionAnchor } from './designConnections.ts';
import { selectionFragment } from './canvasOperations.ts';
import { presentationSvg } from './exportPresentation.ts';
import { terraformCode } from './terraformProjection.ts';
import { sampleArchitecture } from './fixture.ts';
import { projectGraphSnapshotToArchitecture } from './serviceAdapter.ts';
import type { HostGraphSnapshot } from './webviewBridge.ts';

const item = (id: string, x = 0): BoardItem => ({ id, kind: 'shape', text: id, width: 200, height: 100, positions: { visual: { x, y: 0 }, technical: { x, y: 0 } }, members: [] });
const board = (): Architecture => ({ name: 'Endpoints', resources: [], items: [item('a'), item('b', 400)], connections: [] });
const loose = () => historyReducer(createHistory(board()), { type: 'connectEndpoints', id: 'loose', source: element('a'), target: point({ x: 800, y: 300 }) });

test('legacy element strings normalize once at the history boundary without duplicating architecture state', () => {
	const input = { ...board(), connections: [{ id: 'old-link', source: 'a', target: 'b' }] };
	const h = createHistory(input);
	assert.deepEqual(h.present.connections[0].source, element('a'));
	assert.deepEqual(h.present.connections[0].target, element('b'));
	assert.equal(normaliseArchitectureConnections(h.present), h.present);
	assert.equal(input.connections[0].source, 'a', 'the legacy input is not mutated');
});

test('creating a loose link is one Undo/Redo step and never creates a resource or changes Terraform', () => {
	const before = createHistory(board());
	const h = historyReducer(before, { type: 'connectEndpoints', id: 'loose', source: element('a'), target: point({ x: 800, y: 300 }) });
	assert.equal(h.past.length, 1);
	assert.equal(h.present.resources.length, 0);
	assert.equal(terraformCode(h.present), terraformCode(before.present));
	const undone = historyReducer(h, { type: 'undo' });
	assert.deepEqual(undone.present, before.present);
	assert.deepEqual(historyReducer(undone, { type: 'redo' }).present, h.present);
});

test('invalid, dangling, duplicate and zero-length endpoints consume no history', () => {
	const h = loose();
	for (const target of [element('missing'), point({ x: Infinity, y: 0 }), element('a'), { kind: 'element', elementId: 'b', port: 'wrong' } as never]) {
		assert.equal(historyReducer(h, { type: 'connectEndpoints', id: 'new', source: element('a'), target }), h);
	}
	assert.equal(historyReducer(h, { type: 'connectEndpoints', id: 'duplicate', source: element('a'), target: point({ x: 800, y: 300 }) }), h);
	assert.equal(historyReducer(h, { type: 'connectEndpoints', id: 'zero', source: point({ x: 2, y: 3 }), target: point({ x: 2, y: 3 }) }), h);
});

test('endpoint movement keeps style and stable identity, commits once and rejects an unchanged release', () => {
	let h = historyReducer(loose(), { type: 'updateConnection', id: 'loose', patch: { label: 'traffic', width: 4, routing: 'curve' } });
	const before = h;
	h = historyReducer(h, { type: 'reconnectConnection', id: 'loose', side: 'target', endpoint: point({ x: 900, y: -200 }) });
	assert.equal(h.past.length, before.past.length + 1);
	assert.equal(h.present.connections[0].id, 'loose');
	assert.equal(h.present.connections[0].label, 'traffic');
	assert.equal(historyReducer(h, { type: 'reconnectConnection', id: 'loose', side: 'target', endpoint: point({ x: 900, y: -200 }) }), h);
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, before.present);
});

test('loose endpoints reconnect to a real element/physical port without bypassing validation', () => {
	const h = loose();
	const connected = historyReducer(h, { type: 'reconnectConnection', id: 'loose', side: 'target', endpoint: element('b', 'output') });
	assert.deepEqual(connected.present.connections[0].target, element('b', 'output'));
	assert.deepEqual(connectionAnchor(connected.present, connected.present.connections[0].target, 'target', 'visual'), { x: 600, y: 50 });
	assert.equal(historyReducer(connected, { type: 'reconnectConnection', id: 'loose', side: 'target', endpoint: element('a') }), connected);
	assert.deepEqual(historyReducer(connected, { type: 'undo' }).present, h.present);
});

test('a loose link can become a standalone line and reverse without losing either endpoint', () => {
	let h = historyReducer(loose(), { type: 'reconnectConnection', id: 'loose', side: 'source', endpoint: point({ x: -100, y: -200 }) });
	const before = h.present.connections[0];
	h = historyReducer(h, { type: 'reverseConnection', id: 'loose' });
	assert.deepEqual(h.present.connections[0].source, before.target);
	assert.deepEqual(h.present.connections[0].target, before.source);
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present.connections[0], before);
});

test('deleting an attached element removes its loose link atomically and Undo restores both', () => {
	const h = loose();
	const removed = historyReducer(h, { type: 'deleteItem', id: 'a' });
	assert.equal(removed.present.connections.length, 0);
	assert.equal(removed.present.items.length, 1);
	assert.deepEqual(historyReducer(removed, { type: 'undo' }).present, h.present);
});

test('standalone lines survive unrelated element deletion and have their own delete/Undo', () => {
	let h = historyReducer(loose(), { type: 'reconnectConnection', id: 'loose', side: 'source', endpoint: point({ x: -100, y: -200 }) });
	h = historyReducer(h, { type: 'deleteItem', id: 'a' });
	assert.equal(h.present.connections.length, 1);
	const before = h.present;
	h = historyReducer(h, { type: 'deleteConnection', id: 'loose' });
	assert.equal(h.present.connections.length, 0);
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, before);
});

test('copying a visual group remaps element endpoints and offsets loose points once', () => {
	let h = loose();
	h = historyReducer(h, { type: 'canvas', command: { kind: 'group', ids: ['a', 'b'], id: 'group' } });
	const fragment = selectionFragment(h.present, ['a']);
	const copied = historyReducer(h, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap: { a: 'a-copy', b: 'b-copy', group: 'group-copy', loose: 'link-copy' }, offset: 30 } });
	const link = copied.present.connections.find(link => link.id === 'link-copy')!;
	assert.equal(endpointElementId(link.source), 'a-copy');
	assert.deepEqual(link.target, point({ x: 830, y: 330 }));
	assert.deepEqual(h.present.connections[0].target, point({ x: 800, y: 300 }));
	assert.deepEqual(historyReducer(copied, { type: 'undo' }).present, h.present);
});

test('copying a line alone copies geometry without duplicating its attached infrastructure', () => {
	const h = loose(); const fragment = selectionFragment(h.present, [], ['loose']);
	assert.equal(fragment.items.length, 0);
	assert.equal(fragment.resources.length, 0);
	assert.deepEqual(fragment.connections[0].source, point({ x: 200, y: 50 }));
	const copied = historyReducer(h, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap: { loose: 'line-copy' }, offset: 30 } });
	assert.equal(copied.present.items.length, 2);
	assert.deepEqual(copied.present.connections[1].source, point({ x: 230, y: 80 }));
	assert.deepEqual(copied.present.connections[1].target, point({ x: 830, y: 330 }));
});

test('service refresh retains loose geometry/history and prunes only vanished element attachments', () => {
	const snapshot: HostGraphSnapshot = { workspaceId: 'ws', architectureId: 'arch', architectureName: 'Live', sourceRevision: 'a'.repeat(64), status: 'complete', nodes: [{ id: 'rg', kind: 'resource', resourceType: 'azurerm_resource_group', name: 'main', label: 'main', hasSource: true }], edges: [], diagnostics: [] };
	let h: History = createHistory(projectGraphSnapshotToArchitecture(snapshot).architecture);
	h = historyReducer(h, { type: 'connectEndpoints', id: 'attached', source: element('rg'), target: point({ x: 800, y: 300 }) });
	h = historyReducer(h, { type: 'connectEndpoints', id: 'standalone', source: point({ x: 10, y: 20 }), target: point({ x: 30, y: 40 }) });
	const refreshed = projectGraphSnapshotToArchitecture({ ...snapshot, sourceRevision: 'b'.repeat(64) }, { previousArchitecture: h.present }).architecture;
	h = historyReducer(h, { type: 'rebase', architecture: refreshed });
	assert.equal(h.present.connections.length, 2);
	assert.equal(h.past.length, 2);
	const removed = projectGraphSnapshotToArchitecture({ ...snapshot, nodes: [], sourceRevision: 'c'.repeat(64) }, { previousArchitecture: h.present }).architecture;
	h = historyReducer(h, { type: 'rebase', architecture: removed });
	assert.deepEqual(h.present.connections.map(link => link.id), ['standalone']);
	assert.ok(h.past.every(state => !state.connections.some(link => endpointElementId(link.source) === 'rg')));
});

test('rotated drawing ports and far loose endpoints share export geometry and page bounds', async () => {
	let h = loose();
	h = historyReducer(h, { type: 'canvas', command: { kind: 'rotate', ids: ['a'], angle: 90 } });
	assert.deepEqual(connectionAnchor(h.present, element('a'), 'source', 'visual'), { x: 100, y: 150 });
	h = historyReducer(h, { type: 'reconnectConnection', id: 'loose', side: 'target', endpoint: point({ x: -2000, y: -1000 }) });
	h = historyReducer(h, { type: 'updateConnection', id: 'loose', patch: { label: '<review>', routing: 'curve', width: 4 } });
	const svg = await presentationSvg(h.present);
	const bounds = svg.match(/viewBox="([\d.\- ]+)"/)![1].split(' ').map(Number);
	assert.ok(bounds[0] < -2000 && bounds[1] < -1000, 'export includes loose endpoints outside every node');
	assert.ok(svg.includes('&lt;review&gt;') && svg.includes('stroke-width="4"'));
});

test('moving a visual group changes attached ports while loose points remain world anchored', () => {
	let h = loose();
	h = historyReducer(h, { type: 'canvas', command: { kind: 'group', ids: ['a', 'b'], id: 'group' } });
	const before = h.present;
	h = historyReducer(h, { type: 'canvas', command: { kind: 'move', mode: 'technical', positions: { a: { x: 30, y: 40 }, b: { x: 430, y: 40 } } } });
	assert.deepEqual(connectionAnchor(h.present, h.present.connections[0].source, 'source', 'visual'), { x: 230, y: 90 });
	assert.deepEqual(h.present.connections[0].target, point({ x: 800, y: 300 }));
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, before);
});

test('endpoint commands cannot rewrite a service-derived edge or affect Terraform references', () => {
	let h = createHistory(sampleArchitecture()); const before = terraformCode(h.present);
	const source = h.present.resources.find(resource => resource.kind === 'cluster')!.id;
	h = historyReducer(h, { type: 'connectEndpoints', id: 'drawing', source: element(source), target: point({ x: 2000, y: 1000 }) });
	h = historyReducer(h, { type: 'reconnectConnection', id: 'drawing', side: 'target', endpoint: point({ x: -2000, y: 1000 }) });
	assert.equal(terraformCode(h.present), before);
	const guarded = createHistory({ ...board(), connections: [{ id: 'a->b', source: element('a'), target: element('b') }] });
	assert.equal(historyReducer(guarded, { type: 'reconnectConnection', id: 'a->b', side: 'target', endpoint: point({ x: 8, y: 9 }) }), guarded);
	assert.equal(canConnectEndpoints(h.present, element('missing'), point({ x: 8, y: 9 })), false);
});

test('draggable connection waypoints route elbow, curve, and straight paths, export cleanly, duplicate with offset, and undo in one step', async () => {
	const { connectionPath } = await import('./connectionGeometry.ts');
	let h = createHistory(board());
	const beforeHcl = terraformCode(h.present);
	h = historyReducer(h, { type: 'connectEndpoints', id: 'bent', source: element('a'), target: element('b') });

	// Bend the connection through (260, 140)
	h = historyReducer(h, { type: 'updateConnection', id: 'bent', patch: { waypoint: { x: 260, y: 140 } } });
	assert.equal(h.past.length, 2);
	assert.deepEqual(h.present.connections[0].waypoint, { x: 260, y: 140 });
	assert.equal(terraformCode(h.present), beforeHcl);

	// Invalid NaN waypoint or unchanged waypoint consumes zero history
	assert.equal(historyReducer(h, { type: 'updateConnection', id: 'bent', patch: { waypoint: { x: Number.NaN, y: 10 } } }), h);
	assert.equal(historyReducer(h, { type: 'updateConnection', id: 'bent', patch: { waypoint: { x: 260, y: 140 } } }), h);

	// Shared geometry handles elbow, curve (passes through waypoint at t=0.5), and straight
	const [elbowPath, ex, ey] = connectionPath(h.present.connections[0], 200, 50, 400, 50);
	assert.equal(ex, 260); assert.equal(ey, 140);
	assert.ok(elbowPath.includes(',140'), 'elbow routes along waypoint elevation y=140: ' + elbowPath);

	const [svgPathCheck] = connectionPath(h.present.connections[0], 200, 50, 400, 180);
	assert.ok(svgPathCheck.includes('260,'), 'vertical-step Z-elbow routes at waypoint x=260: ' + svgPathCheck);

	const [curvePath, cx, cy] = connectionPath({ ...h.present.connections[0], routing: 'curve' }, 200, 50, 400, 50);
	assert.equal(cx, 260); assert.equal(cy, 140);
	assert.equal(curvePath, 'M200,50 Q220,230 400,50', 'quadratic Bezier passes through (260,140) at t=0.5');

	const [straightPath] = connectionPath({ ...h.present.connections[0], routing: 'straight' }, 200, 50, 400, 50);
	assert.equal(straightPath, 'M200,50 L260,140 L400,50');

	// Duplicating offsets the waypoint cleanly
	const fragment = selectionFragment(h.present, ['a', 'b'], ['bent']);
	const dup = historyReducer(h, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap: { a: 'a2', b: 'b2', bent: 'bent2' }, offset: 40 } });
	assert.deepEqual(dup.present.connections.find(c => c.id === 'bent2')?.waypoint, { x: 300, y: 180 });

	// SVG export uses the same bent route
	const svg = await presentationSvg(h.present);
	assert.ok(svg.includes(',140'), 'SVG export includes bent route at y=140');

	// Resetting waypoint clears it in one step and Undo restores it
	const reset = historyReducer(h, { type: 'updateConnection', id: 'bent', patch: { waypoint: undefined } });
	assert.equal(reset.present.connections[0].waypoint, undefined);
	assert.deepEqual(historyReducer(reset, { type: 'undo' }).present.connections[0].waypoint, { x: 260, y: 140 });
});

test('elements have four connection points: left, right, top and bottom', () => {
	const architecture = sampleArchitecture();
	const resource = architecture.resources.find(item => item.id === 'vm')!;
	assert.deepEqual(normaliseEndpoint({ kind: 'element', elementId: 'vm', port: 'top' }), { kind: 'element', elementId: 'vm', port: 'top' });
	assert.equal(normaliseEndpoint({ kind: 'element', elementId: 'vm', port: 'middle' }), undefined);
	const top = connectionAnchor(architecture, element('vm', 'top'), 'source', 'visual')!;
	const bottom = connectionAnchor(architecture, element('vm', 'bottom'), 'target', 'visual')!;
	assert.equal(top.y, resource.positions.visual.y);
	assert.ok(bottom.y > top.y && bottom.x === top.x);
	const [path] = connectionPath({ id: 'x', source: element('vm', 'bottom'), target: element('nic', 'top') }, 0, 0, 100, 200);
	assert.match(path, /^M ?0[ ,]0/);
});

test('arbitrary perimeter attachments project cleanly, follow moves/rotations, allow multiple links per side, and export identically', async () => {
	const box = { x: 0, y: 0, width: 200, height: 100 };
	// Near midpoint snaps cleanly to classic cardinal port without anchor
	assert.deepEqual(projectPerimeterAnchor(box, { x: 198, y: 52 }), { port: 'output' });
	// Off-centre right edge stores normalised perimeter anchor
	assert.deepEqual(projectPerimeterAnchor(box, { x: 196, y: 20 }), { port: 'output', anchor: { x: 1, y: 0.2 } });
	// Bottom edge 75% across
	assert.deepEqual(projectPerimeterAnchor(box, { x: 150, y: 98 }), { port: 'bottom', anchor: { x: 0.75, y: 1 } });
	// Invalid out-of-range anchor is rejected cleanly
	assert.equal(normaliseEndpoint({ kind: 'element', elementId: 'a', port: 'output', anchor: { x: 1.5, y: 0.2 } }), undefined);
	assert.equal(normaliseEndpoint({ kind: 'element', elementId: 'a', port: 'output', anchor: { x: Number.NaN, y: 0.2 } }), undefined);

	// Two distinct connections on the same side of 'a' at different perimeter positions coexist cleanly
	const upper = element('a', 'output', { x: 1, y: 0.2 });
	const lower = element('a', 'output', { x: 1, y: 0.8 });
	assert.notEqual(endpointKey(upper, 'source'), endpointKey(lower, 'source'));
	let h = historyReducer(createHistory(board()), { type: 'connectEndpoints', id: 'c1', source: upper, target: element('b', 'input', { x: 0, y: 0.25 }) });
	h = historyReducer(h, { type: 'connectEndpoints', id: 'c2', source: lower, target: element('b', 'input', { x: 0, y: 0.75 }) });
	assert.equal(h.present.connections.length, 2);
	assert.ok(needsConnectionOverlay(h.present.connections[0]));
	assert.deepEqual(connectionAnchor(h.present, upper, 'source', 'visual'), { x: 200, y: 20 });
	assert.deepEqual(connectionAnchor(h.present, lower, 'source', 'visual'), { x: 200, y: 80 });

	// Rotated element transforms perimeter anchor around centre (90 deg clockwise: (200, 20) -> centre(100,50) + local(100,-30) -> (130, 150))
	const rotated = historyReducer(h, { type: 'canvas', command: { kind: 'rotate', ids: ['a'], angle: 90 } });
	assert.deepEqual(connectionAnchor(rotated.present, upper, 'source', 'visual'), { x: 130, y: 150 });

	// SVG export renders both distinct perimeter y-coordinates (20 and 80)
	const svg = await presentationSvg(h.present);
	assert.ok(svg.includes(',20') && svg.includes(',80'), 'SVG export preserves exact perimeter attachment coordinates');
});
