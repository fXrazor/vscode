/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { documentedProfiles, resourceIntelligence } from './providerKnowledge.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
test('every catalogue entry has a registry record with explicit review status; unknown is never guessed', () => {
	const dataset = read('../assets/provider-intelligence.json');
	const records = new Map(dataset.records.map((record: { resourceType: string }) => [record.resourceType, record]));
	for (const provider of ['azure', 'aws', 'gcp']) {
		for (const entry of read('../assets/catalogue/' + provider + '.json').entries) { assert.ok(records.has(entry.type), entry.type); }
	}
	for (const record of dataset.records) {
		for (const key of ['parentTypes', 'childTypes', 'attachmentTypes', 'commonDependencies', 'commonRuntimeLinks', 'securityRelationships', 'monitoringRelationships', 'rules']) { assert.ok(Array.isArray(record[key]), record.resourceType + ':' + key); }
		if (record.reviewStatus === 'unreviewed') { assert.equal(record.layer, 'unknown'); assert.equal(record.blastRadiusCategory, 'unknown'); assert.deepEqual(record.rules, []); }
	}
	assert.equal(resourceIntelligence('aws_imaginary_subnet_database').layer, 'unknown');
	assert.equal(resourceIntelligence('google_google_project').reviewStatus, 'unreviewed');
});
test('reviewed field rules have pinned primary documents and Terraform root fields present in those documents', () => {
	const manifest = read('../research/provider-source-manifest.json');
	assert.equal(new Set(documentedProfiles.map(profile => profile.resourceType)).size, documentedProfiles.length);
	for (const profile of documentedProfiles) {
		const source = manifest.documents.find((source: { provider: string; resource: string }) => source.provider + ':' + source.resource === profile.sourceKey);
		assert.ok(source, profile.resourceType); assert.equal(source.status, 200); assert.match(source.revision, /^[a-f0-9]{40}$/); assert.match(source.sha256, /^[a-f0-9]{64}$/);
		if (profile.fieldSyntax === 'terraform') {
			for (const rule of profile.rules) { assert.ok(source.fields.some((field: { name: string }) => field.name === rule.field.split('.')[0]), profile.resourceType + ':' + rule.field); }
		}
	}
	assert.match(manifest.providers.find((provider: { provider: string }) => provider.provider === 'aws').versionApplicability, /Research revision only/);
});
test('registry distinguishes Azure NIC attachment, NSG association, value reuse and Kubernetes selector intent', () => {
	assert.ok(resourceIntelligence('azurerm_linux_virtual_machine').rules.some(rule => rule.field === 'network_interface_ids' && rule.category === 'attachment'));
	assert.ok(!resourceIntelligence('azurerm_network_security_group').rules.some(rule => rule.targets.includes('azurerm_subnet')));
	assert.equal(resourceIntelligence('azurerm_subnet_network_security_group_association').rules.filter(rule => rule.category === 'attachment').length, 2);
	assert.equal(resourceIntelligence('kubernetes_service_v1').fieldSyntax, 'kubernetes-manifest');
	assert.equal(resourceIntelligence('kubernetes_service_v1').rules.find(rule => rule.field === 'spec.selector')?.category, 'runtime');
	assert.ok(!resourceIntelligence('kubernetes_persistent_volume_v1').parentTypes.includes('kubernetes_namespace_v1'));
});
test('regional and global GCP HTTP load-balancing chains remain distinct', () => {
	for (const [source, target] of [['google_compute_forwarding_rule', 'google_compute_region_target_http_proxy'], ['google_compute_global_forwarding_rule', 'google_compute_target_http_proxy'], ['google_compute_region_target_http_proxy', 'google_compute_region_url_map'], ['google_compute_region_url_map', 'google_compute_region_backend_service']]) {
		assert.ok(resourceIntelligence(source).rules.some(rule => rule.targets.includes(target)), source);
	}
	assert.ok(!resourceIntelligence('google_compute_forwarding_rule').rules.some(rule => rule.targets.includes('google_compute_backend_service')));
});
