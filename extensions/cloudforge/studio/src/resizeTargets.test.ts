/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeTargets } from './canvasOperations.ts';
import { sampleArchitecture } from './fixture.ts';
import { isResourceContainer } from './resourceHierarchy.ts';
import { createHistory, historyReducer } from './model.ts';

test('resize targets exclude infrastructure containers, locked elements and technical cards', () => {
	const architecture = sampleArchitecture();
	const icon = architecture.resources.find(resource => !isResourceContainer(resource))!;
	const drawing = architecture.items[0];
	icon.canvasLocked = true;
	drawing.canvasLocked = true;
	const ids = [...architecture.resources, ...architecture.items].map(item => item.id);
	const visual = resizeTargets(architecture, ids, 'visual');
	assert.deepEqual(visual.icons.map(resource => resource.id), architecture.resources.filter(resource => resource.id !== icon.id && !isResourceContainer(resource)).map(resource => resource.id));
	assert.deepEqual(visual.items.map(item => item.id), architecture.items.filter(item => item.id !== drawing.id).map(item => item.id));
	const technical = resizeTargets(architecture, ids, 'technical');
	assert.deepEqual(technical.icons, []);
	assert.deepEqual(technical.items, visual.items);
	assert.deepEqual(resizeTargets(architecture, architecture.resources.filter(isResourceContainer).map(resource => resource.id), 'visual'), { items: [], icons: [] });
});

test('group-expanded resize targets match the command even when only one eligible member remains', () => {
	const architecture = sampleArchitecture();
	const icon = architecture.resources.find(resource => !isResourceContainer(resource))!;
	const container = architecture.resources.find(isResourceContainer)!;
	architecture.groups = [{ id: 'group', label: 'Mixed group', members: [container.id, icon.id] }];
	const targets = resizeTargets(architecture, [container.id, 'missing'], 'visual');
	assert.deepEqual(targets.items, []);
	assert.deepEqual(targets.icons.map(resource => resource.id), [icon.id]);
	const h = historyReducer(createHistory(architecture), { type: 'canvas', command: { kind: 'resize', ids: [container.id], mode: 'visual', scale: 2 } });
	assert.equal(h.past.length, 1);
	assert.equal(h.present.resources.find(resource => resource.id === icon.id)!.iconSize, 96);
	assert.deepEqual(h.present.resources.find(resource => resource.id === icon.id)!.positions.visual, icon.positions.visual, 'excluded container does not move the resize origin');
	assert.deepEqual(historyReducer(h, { type: 'undo' }).present, architecture);
	assert.equal(historyReducer(createHistory(architecture), { type: 'canvas', command: { kind: 'resize', ids: [container.id], mode: 'technical', scale: 2 } }).past.length, 0);
});
