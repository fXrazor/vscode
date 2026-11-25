/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectResize, resizeAnchors, resizeAnchorPoint, type ResizeBox } from './resizeGeometry.ts';
import { resizeSelectionBoxes } from './canvasOperations.ts';
import { createHistory, historyReducer } from './model.ts';
import { sampleArchitecture } from './fixture.ts';
import { isResourceContainer } from './resourceHierarchy.ts';

const boxes: ResizeBox[] = [
	{ id: 'drawing', x: 100, y: 100, width: 100, height: 50, min: 24, max: 4000 },
	{ id: 'icon', x: 300, y: 200, width: 120, height: 120, min: 24, max: 160 }
];

test('resize projection reflects maximum/minimum sizes instead of overstating proportional bounds', () => {
	const grown = projectResize(boxes, 2)!;
	assert.deepEqual(grown.bounds, { x: 100, y: 100, width: 560, height: 360 });
	assert.equal(grown.boxes[1].width, 160);
	assert.notEqual(grown.bounds.width, 320 * 2, 'an icon at its size limit does not keep scaling');
	const shrunk = projectResize([boxes[0]], 0.25)!;
	assert.deepEqual(shrunk.bounds, { x: 100, y: 100, width: 25, height: 24 });
	assert.deepEqual(projectResize(boxes, 2, 'bottom-right')!.bounds, { x: -140, y: -40, width: 560, height: 360 });
});

test('projected boxes match committed dimensions and fixed corners in either renderer with one Undo', () => {
	const architecture = sampleArchitecture();
	const icon = architecture.resources.find(resource => !isResourceContainer(resource))!;
	icon.parentId = undefined; icon.iconSize = 120; icon.positions = { visual: { x: 300, y: 200 }, technical: { x: 300, y: 200 } };
	architecture.resources = [icon];
	architecture.items = [{ id: 'drawing', kind: 'shape', text: '', positions: { visual: { x: 100, y: 100 }, technical: { x: 100, y: 100 } }, width: 100, height: 50, members: [] }];
	architecture.connections = [];
	const ids = ['drawing', icon.id];
	for (const mode of ['visual', 'technical'] as const) {
		for (const anchor of resizeAnchors) {
			for (const scale of [0.25, 1.33, 4]) {
				const before = resizeSelectionBoxes(architecture, ids, mode);
				const projection = projectResize(before, scale, anchor)!;
				const h = historyReducer(createHistory(architecture), { type: 'canvas', command: { kind: 'resize', ids, mode, scale, anchor } });
				assert.deepEqual(resizeSelectionBoxes(h.present, ids, mode), projection.boxes);
				const initial = projectResize(before, 1)!.bounds;
				assert.deepEqual(resizeAnchorPoint(projection.bounds, anchor), resizeAnchorPoint(initial, anchor));
				assert.equal(h.past.length, 1);
				assert.deepEqual(historyReducer(h, { type: 'undo' }).present, architecture);
			}
		}
	}
});

test('empty/invalid resize geometry is rejected and identity previews preserve tiny ink geometry', () => {
	assert.equal(projectResize([], 2), undefined);
	assert.equal(projectResize(boxes, NaN), undefined);
	assert.equal(projectResize([{ ...boxes[0], width: Infinity }], 2), undefined);
	const tiny = [{ ...boxes[0], width: 16, height: 16 }];
	assert.deepEqual(projectResize(tiny, 1)!.boxes, tiny);
});
