/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { literalIssue } from '../src/canvas/literalSchema.ts';
import { readLiteralShape } from '../src/canvas/serviceAdapters.ts';

const nested = () => readLiteralShape(undefined, { mode: 'list', minItems: 1, maxItems: 2, attributes: [
	{ name: 'name', access: 'required', typeExpr: { kind: 'string' } },
	{ name: 'weight', access: 'optional', typeExpr: { kind: 'number' } },
	{ name: 'id', access: 'computedOnly', typeExpr: { kind: 'string' } },
	{ name: 'password', access: 'optional', sensitive: true, typeExpr: { kind: 'string' } },
	{ name: 'settings', access: 'optional', nested: { mode: 'single', attributes: [{ name: 'enabled', access: 'required', typeExpr: { kind: 'bool' } }] } },
] });

test('nested member access, literal types and collection bounds survive the service adapter', () => {
	const shape = nested();
	assert.equal(literalIssue([{ name: 'one', weight: 1.5, settings: { enabled: true } }], shape), undefined);
	assert.match(literalIssue([], shape)!, /at least 1/);
	assert.match(literalIssue([{ name: 'one' }, { name: 'two' }, { name: 'three' }], shape)!, /at most 2/);
	assert.match(literalIssue([{ weight: 2 }], shape)!, /name: Required/);
	assert.match(literalIssue([{ name: 'one', id: 'output' }], shape)!, /read-only/);
	assert.match(literalIssue([{ name: 'one', weight: '2' }], shape)!, /weight: Expected number/);
	assert.match(literalIssue([{ name: 'one', settings: {} }], shape)!, /settings.enabled: Required/);
	assert.match(literalIssue([{ name: 'one', password: 'example' }], shape)!, /sensitive variable/);
	assert.match(literalIssue([{ name: 'one', guessed: true }], shape)!, /Unknown object member/);
});

test('sets, tuples and typed maps use their actual literal element types', () => {
	const set = readLiteralShape({ kind: 'set', element: { kind: 'object', members: { name: { kind: 'string' }, enabled: { kind: 'bool' } } } });
	assert.match(literalIssue([{ name: 'one', enabled: true }, { enabled: true, name: 'one' }], set)!, /unique/);
	const tuple = readLiteralShape({ kind: 'tuple', elements: [{ kind: 'number' }, { kind: 'bool' }] });
	assert.equal(literalIssue([2, true], tuple), undefined);
	assert.match(literalIssue([2, 'true'], tuple)!, /Expected bool/);
	assert.match(literalIssue([2], tuple)!, /2 tuple entries/);
	assert.match(literalIssue({ key: '2' }, readLiteralShape({ kind: 'map', element: { kind: 'number' } }))!, /key: Expected number/);
	assert.equal(readLiteralShape({ kind: 'unknown' }), undefined);
});
