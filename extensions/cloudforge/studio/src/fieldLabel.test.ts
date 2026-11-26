/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldLabel } from './fieldLabel.ts';

test('field labels read as sentences and keep acronyms', () => {
	assert.equal(fieldLabel('enable_dns_hostnames'), 'Enable DNS hostnames');
	assert.equal(fieldLabel('assign_generated_ipv6_cidr_block'), 'Assign generated IPv6 CIDR block');
	assert.equal(fieldLabel('ipv4_ipam_pool_id'), 'IPv4 IPAM pool ID');
	assert.equal(fieldLabel('name'), 'Name');
	assert.equal(fieldLabel('_'), '_');
});
