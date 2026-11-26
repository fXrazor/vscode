/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, StartupSequence } from '../src/startup/startupSequence.ts';

function clock() {
	let now = 1000;
	return { now: () => now, advance: (ms: number) => { now += ms; } };
}

test('steps run in order with timings, skips and failures', async () => {
	const time = clock();
	const sequence = new StartupSequence([{ id: 'project', label: 'Open project' }, { id: 'schemas', label: 'Load schemas' }, { id: 'providers', label: 'Check providers' }], time.now);
	const seen: string[] = [];
	sequence.onDidChange(() => seen.push(sequence.summary.running?.id ?? '-'));
	assert.equal(await sequence.run('project', async () => { time.advance(420); return 'prod open'; }), 'done');
	assert.equal(await sequence.run('schemas', async () => { time.advance(30); return { skipped: 'none downloaded yet' }; }), 'skipped');
	assert.equal(sequence.summary.finished, false);
	assert.equal(await sequence.run('providers', async () => { time.advance(1580); throw new Error('report unavailable'); }), 'failed');
	assert.deepEqual(seen, ['project', '-', 'schemas', '-', 'providers', '-']);
	const summary = sequence.summary;
	assert.equal(summary.finished, true);
	assert.equal(summary.completed, 3);
	assert.equal(summary.totalMs, 2030);
	assert.deepEqual(summary.failed.map(step => step.id), ['providers']);
	assert.deepEqual(sequence.logLines(), [
		'✓ Open project (420 ms): prod open',
		'– Load schemas (30 ms): none downloaded yet',
		'✗ Check providers (1.6 s): report unavailable',
		'Finished in 2.0 s with 1 problem.',
	]);
});

test('a step runs once, and skip only affects pending steps', async () => {
	const sequence = new StartupSequence([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	let calls = 0;
	await sequence.run('a', async () => { calls++; return undefined; });
	await sequence.run('a', async () => { calls++; return undefined; });
	assert.equal(calls, 1);
	sequence.skip('a', 'ignored');
	sequence.skip('b', 'turned off in settings');
	assert.deepEqual(sequence.steps.map(step => [step.id, step.state, step.detail]), [['a', 'done', undefined], ['b', 'skipped', 'turned off in settings']]);
	assert.match(sequence.logLines().at(-1)!, /^Ready in/);
	assert.equal(await sequence.run('missing', async () => 'x'), 'failed');
});

test('durations read naturally', () => {
	assert.equal(formatDuration(12.4), '12 ms');
	assert.equal(formatDuration(1234), '1.2 s');
	assert.equal(formatDuration(12_345), '12 s');
});
