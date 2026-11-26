/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectReviewedMirrorImport, isMirrorImportFieldValid, type MirrorImportInput, type MirrorImportPrompts, type ReviewedMirrorImport } from '../src/providerMirror/importFlow.ts';

const address = 'registry.terraform.io/hashicorp/azurerm';
const digest = 'a'.repeat(64);
interface Step {
	readonly step: string;
	readonly initial?: string | ReviewedMirrorImport;
	readonly result: MirrorImportInput | string;
}
function scripted(steps: readonly Step[]) {
	let index = 0;
	const next = (step: string, initial: string | ReviewedMirrorImport) => {
		const expected = steps[index++];
		assert.ok(expected, 'unexpected prompt ' + step);
		assert.equal(step, expected.step);
		if (expected.initial !== undefined) { assert.deepEqual(initial, expected.initial); }
		return expected.result;
	};
	const prompts: MirrorImportPrompts = {
		input: async (field, initial) => {
			const result = next(field, initial);
			assert.ok(result === undefined || typeof result === 'object');
			return result;
		},
		platform: async initial => {
			const result = next('platform', initial);
			assert.ok(result === undefined || result === 'back' || result === 'windows_amd64' || result === 'linux_amd64');
			return result;
		},
		review: async initial => {
			const result = next('review', initial);
			assert.ok(result === undefined || result === 'back' || result === 'import');
			return result;
		},
	};
	return { prompts, complete: () => assert.equal(index, steps.length, 'every expected step was visited') };
}
const accepted = (value: string): MirrorImportInput => ({ action: 'next', value });
const back = (value: string): MirrorImportInput => ({ action: 'back', value });
const forward: Step[] = [
	{ step: 'address', initial: address, result: accepted(address) },
	{ step: 'version', initial: '5.14.0', result: accepted('5.14.0') },
	{ step: 'platform', initial: 'windows_amd64', result: 'windows_amd64' },
	{ step: 'expectedSha256', initial: '', result: accepted(digest) },
	{ step: 'review', initial: { address, version: '5.14.0', platform: 'windows_amd64', expectedSha256: digest }, result: 'import' },
];

test('provider import returns only the exact explicitly reviewed identity and normalized digest', async () => {
	const expected = { address: 'registry.terraform.io/hashicorp/aws', version: '6.73.0', platform: 'linux_amd64', expectedSha256: digest };
	const script = scripted([
		{ step: 'address', initial: expected.address, result: accepted(' ' + expected.address + ' ') },
		{ step: 'version', initial: expected.version, result: accepted(' ' + expected.version + ' ') },
		{ step: 'platform', initial: 'linux_amd64', result: 'linux_amd64' },
		{ step: 'expectedSha256', initial: '', result: accepted(' ' + digest.toUpperCase() + ' ') },
		{ step: 'review', initial: expected, result: 'import' },
	]);
	assert.deepEqual(await collectReviewedMirrorImport(script.prompts, expected), expected);
	script.complete();
});

test('provider import retains edits before Back through identity, platform, digest and review', async () => {
	const changedAddress = 'registry.terraform.io/hashicorp/google';
	const changedDigest = 'b'.repeat(64);
	const expected = { address: changedAddress, version: '8.10.0', platform: 'linux_amd64', expectedSha256: changedDigest };
	const script = scripted([
		forward[0], forward[1],
		{ step: 'platform', initial: 'windows_amd64', result: 'linux_amd64' },
		{ step: 'expectedSha256', initial: '', result: back('unfinished digest') },
		{ step: 'platform', initial: 'linux_amd64', result: 'back' },
		{ step: 'version', initial: '5.14.0', result: back('8.10.0') },
		{ step: 'address', initial: address, result: accepted(changedAddress) },
		{ step: 'version', initial: '8.10.0', result: accepted('8.10.0') },
		{ step: 'platform', initial: 'linux_amd64', result: 'linux_amd64' },
		{ step: 'expectedSha256', initial: 'unfinished digest', result: accepted(digest) },
		{ step: 'review', result: 'back' },
		{ step: 'expectedSha256', initial: digest, result: accepted(changedDigest) },
		{ step: 'review', initial: expected, result: 'import' },
	]);
	assert.deepEqual(await collectReviewedMirrorImport(script.prompts), expected);
	script.complete();
});

test('Escape at each native import step returns no reviewed import', async () => {
	for (let index = 0; index < forward.length; index++) {
		const script = scripted([...forward.slice(0, index), { ...forward[index], result: undefined }]);
		assert.equal(await collectReviewedMirrorImport(script.prompts), undefined, forward[index].step);
		script.complete();
	}
});

test('invalid accepted values cannot advance the import or reach review', async () => {
	const script = scripted([
		{ step: 'address', result: accepted('hashicorp/aws') },
		{ step: 'address', initial: 'hashicorp/aws', result: accepted(address) },
		{ step: 'version', result: accepted('../5.14.0') },
		{ step: 'version', initial: '../5.14.0', result: accepted('5.14.0') },
		forward[2],
		{ step: 'expectedSha256', result: accepted('not a digest') },
		{ step: 'expectedSha256', initial: 'not a digest', result: undefined },
	]);
	assert.equal(await collectReviewedMirrorImport(script.prompts), undefined);
	script.complete();
});

test('native import validation preserves existing identifier syntax and rejects invalid digests', () => {
	for (const [field, valid, invalid] of [
		['address', [address, ' mirror.example/org/provider '], ['', ' ', 'hashicorp/azurerm', 'https://registry.terraform.io/hashicorp/azurerm']],
		['version', ['5.14.0', '1.0.0-beta+build'], ['', ' ', '../version', '5 14']],
		['expectedSha256', [digest, ' ' + digest.toUpperCase() + ' '], ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]],
	] as const) {
		for (const value of valid) { assert.equal(isMirrorImportFieldValid(field, value), true); }
		for (const value of invalid) { assert.equal(isMirrorImportFieldValid(field, value), false); }
	}
});

test('direct import keeps a blank suggested version and the selected readiness platform', async () => {
	const expected = { address, version: '5.14.0', platform: 'linux_amd64', expectedSha256: digest };
	const script = scripted([
		forward[0],
		{ step: 'version', initial: '', result: { action: 'next', value: '5.14.0' } },
		{ step: 'platform', initial: 'linux_amd64', result: 'linux_amd64' },
		forward[3],
		{ step: 'review', initial: expected, result: 'import' },
	]);
	assert.deepEqual(await collectReviewedMirrorImport(script.prompts, { address, version: '', platform: 'linux_amd64' }), expected);
	script.complete();
});
