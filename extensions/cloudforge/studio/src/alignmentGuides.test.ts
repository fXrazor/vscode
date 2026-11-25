/*---------------------------------------------------------------------------------------------
 *  Equal-spacing guides snap a dragged element to existing gaps.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentGuides, spacingSnap } from './alignmentGuides.ts';

const box = (id: string, x: number, y: number, width = 100, height = 60) => ({ id, x, y, width, height });

test('a box dragged between two neighbours snaps to the centre with two equal gaps', () => {
	// Gap left 97, right 103: centre is 3 px away.
	const result = alignmentGuides([box('a', 0, 0), box('m', 197, 10), box('b', 400, 0)], ['m'], 1);
	assert.equal(result.dx, 3);
	const spacing = result.lines.filter(line => line.kind === 'spacing');
	assert.equal(spacing.length, 2);
	assert.deepEqual(spacing.map(line => line.x2 - line.x1), [100, 100]);
});

test('a box placed after a row repeats the existing gap', () => {
	// a→b gap is 50; m sits 52 after b, so it snaps 2 px left.
	const result = alignmentGuides([box('a', 0, 0), box('b', 150, 0), box('m', 302, 30, 100, 60)], ['m'], 1);
	assert.equal(result.dx, -2);
	assert.ok(result.lines.some(line => line.kind === 'spacing' && line.x1 === 250 && line.x2 === 300));
});

test('equal spacing works vertically and ignores elements outside the column', () => {
	const snap = spacingSnap({ start: 205, size: 60, cross: 0, crossSize: 100 }, [{ start: 0, size: 60, cross: 0, crossSize: 100 }, { start: 100, size: 60, cross: 0, crossSize: 100 }, { start: 400, size: 60, cross: 900, crossSize: 100 }], 6);
	assert.equal(snap?.delta, -5);
});

test('a closer edge alignment wins over equal spacing', () => {
	// m's left edge is 1 px from c's left edge (alignment) and 4 px from equal spacing.
	const result = alignmentGuides([box('a', 0, 0), box('b', 150, 0), box('c', 305, 300), box('m', 304, 0)], ['m'], 1);
	assert.equal(result.dx, 1);
	assert.ok(!result.lines.some(line => line.kind === 'spacing'));
});
