/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { readFile, writeFile } from 'node:fs/promises';
import { documentedProfiles, resourceIntelligence } from '../src/providerKnowledge.ts';

const sources = JSON.parse(await readFile('research/provider-source-manifest.json', 'utf8'));
const byType = new Map();
for (const provider of ['azure', 'aws', 'gcp']) {
	const catalogue = JSON.parse(await readFile('assets/catalogue/' + provider + '.json', 'utf8'));
	for (const entry of catalogue.entries) {
		const knowledge = resourceIntelligence(entry.type);
		byType.set(entry.type, { ...knowledge, platform: provider, catalogueVersion: catalogue.version, catalogueSource: catalogue.source, catalogueLabel: entry.label });
	}
}
for (const profile of documentedProfiles) { if (!byType.has(profile.resourceType)) { byType.set(profile.resourceType, { ...profile, catalogueVersion: null, catalogueSource: null }); } }
const records = [...byType.values()].sort((a,b) => a.resourceType.localeCompare(b.resourceType));
const dataset = { formatVersion: 1, authoredOn: '2026-11-25', relationshipDirection: 'Subject consumes or is associated with object; ownership field rules identify the owner target. Execution order is an additional facet only for actual expression/dependency evidence.',
	limits: ['Documentation rules are possible relationships, not instance links.', 'Unreviewed catalogue types have unknown semantics.', 'Runtime reachability, cloud health, actual price and operational blast radius are not inferred.', 'Kubernetes manifest paths need a versioned provider adapter.', 'Research source versions do not override workspace lock selections.'],
	sourceManifest: '../../research/provider-source-manifest.json', providers: sources.providers, records };
await writeFile('assets/provider-intelligence.json', JSON.stringify(dataset) + '\n');
const report = await readFile('research/provider-intelligence.md', 'utf8');
const inventory = ['| Resource type | Layer | Source |', '| --- | --- | --- |', ...documentedProfiles.map(profile => {
	const source = sources.documents.find(source => source.provider + ':' + source.resource === profile.sourceKey);
	if (!source || source.status !== 200) { throw new Error('Missing source for ' + profile.resourceType); }
	return '| `' + profile.resourceType + '` | ' + profile.layer + ' | [Pinned documentation](' + source.url + ') |';
})].join('\n');
await writeFile('research/provider-intelligence.md', report.replace(/<!-- inventory:start -->[\s\S]*?<!-- inventory:end -->/, '<!-- inventory:start -->\n' + inventory + '\n<!-- inventory:end -->'));
console.log(JSON.stringify({ records: records.length, documented: records.filter(record => record.reviewStatus === 'documented').length, unreviewed: records.filter(record => record.reviewStatus === 'unreviewed').length, providerDocuments: sources.documents.length }));
