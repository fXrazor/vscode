/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleArchitecture } from './fixture.ts';
import { createHistory, historyReducer, type Architecture } from './model.ts';
import { selectionFragment } from './canvasOperations.ts';
import { visualAncestors } from './resourceHierarchy.ts';
import { technicalLayout } from './technicalLayout.ts';
import { terraformCode } from './terraformProjection.ts';

function clutter() {
	let history = createHistory(sampleArchitecture());
	const duplicate = (ids: string[], suffix: string) => {
		const fragment = selectionFragment(history.present, ids);
		const idMap = Object.fromEntries([...fragment.resources, ...fragment.connections].map(item => [item.id, item.id + suffix]));
		history = historyReducer(history, { type: 'canvas', command: { kind: 'duplicate', fragment, idMap, offset: 30 } });
	};
	duplicate(['subnet'], '-spoke');
	for (let index = 0; index < 7; index++) { duplicate(['vm'], '-' + index); }
	assert.equal(history.present.resources.length, 19);
	return history;
}
function boxes(architecture: Architecture, layout = technicalLayout(architecture)) {
	return architecture.resources.map(resource => ({ id: resource.id, x: resource.positions.technical.x + layout.offsets[resource.id].x, y: resource.positions.technical.y + layout.offsets[resource.id].y, ...layout.sizes[resource.id] }));
}
function checkPacking(architecture: Architecture, layout = technicalLayout(architecture)) {
	const rectangles = boxes(architecture, layout);
	for (const first of rectangles) {
		for (const second of rectangles.filter(second => second.id !== first.id)) {
			const resource = architecture.resources.find(resource => resource.id === first.id)!;
			const other = architecture.resources.find(resource => resource.id === second.id)!;
			if ([...visualAncestors(architecture, resource).map(parent => parent.id)].includes(second.id) || visualAncestors(architecture, other).some(parent => parent.id === first.id)) { continue; }
			assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y, first.id + ' overlaps ' + second.id);
		}
		const parent = layout.parents[first.id]; if (!parent) { continue; }
		const container = rectangles.find(box => box.id === parent)!;
		assert.ok(first.x >= container.x + 20 && first.y >= container.y + 80, first.id + ' respects container header/inset');
		assert.ok(first.x + first.width <= container.x + container.width - 20 && first.y + first.height <= container.y + container.height - 20, first.id + ' fits parent');
	}
}
test('19 duplicated, nested resources space without overlaps or changing architecture, Terraform or history', () => {
	const history = clutter(); const before = structuredClone(history); const code = terraformCode(history.present);
	const layout = technicalLayout(history.present);
	checkPacking(history.present, layout);
	assert.deepEqual(technicalLayout(history.present), layout, 'switching repeatedly gives a deterministic projection');
	assert.deepEqual(history, before); assert.equal(terraformCode(history.present), code);
	assert.deepEqual(Object.keys(layout.offsets).sort(), history.present.resources.map(resource => resource.id).sort());
});
test('measured large cards reflow nested containers, and unknown types still receive valid space', () => {
	const architecture = clutter().present;
	const measured = Object.fromEntries(architecture.resources.map(resource => [resource.id, { width: 380, height: resource.id.startsWith('vm') ? 460 : 340 }]));
	checkPacking(architecture, technicalLayout(architecture, measured));
	const unknown = { ...architecture, resources: architecture.resources.map(resource => resource.id === 'vm' ? { ...resource, kind: 'generic' as const, catalogue: { type: 'azurerm_unreviewed_workload', label: 'Unknown', service: 'Unknown', category: 'Other', icon: 'azure-compute.svg', fields: [] } } : resource) };
	checkPacking(unknown);
});
test('empty graphs and cyclic visual metadata cannot trap the layout', () => {
	assert.deepEqual(technicalLayout({ name: 'Empty', resources: [], items: [], connections: [] }), { offsets: {}, sizes: {}, parents: {} });
	const architecture = sampleArchitecture();
	architecture.resources.find(resource => resource.id === 'network')!.visualParentId = 'subnet';
	const layout = technicalLayout(architecture);
	assert.equal(Object.keys(layout.offsets).length, architecture.resources.length);
	for (const box of boxes(architecture, layout)) { assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite)); }
});
