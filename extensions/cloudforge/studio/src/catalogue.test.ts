import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { groupServices, registerServiceTypes, serviceOnlyEntries, subscribeServiceTypes } from './catalogue.ts';
import type { CatalogueEntry } from './model.ts';
import type { Provider, Resource } from './model.ts';
import { editableFields, additionalBlocks } from './formDefinition.ts';

test('every bundled cloud resource retains its editable primitive fields in the shared form', () => {
 for (const provider of ['azure', 'aws', 'gcp'] as Provider[]) {
  const snapshot = JSON.parse(readFileSync(new URL('../assets/catalogue/' + provider + '.json', import.meta.url), 'utf8')) as { entries: CatalogueEntry[] };
  for (const entry of snapshot.entries) {
   const resource: Resource = { id: 'probe', kind: 'generic', catalogue: entry, provider, name: 'probe', region: '', settings: {}, blocks: [], positions: { visual: { x: 0, y: 0 }, technical: { x: 0, y: 0 } } };
   const fields = editableFields(resource);
   assert.equal(new Set(fields.map(field => field.name)).size, fields.length, entry.type);
   for (const imported of entry.fields) { assert.ok(fields.some(field => field.name === imported.name), entry.type + '.' + imported.name); }
   const blocks = additionalBlocks(resource);
   assert.equal(new Set(blocks.map(block => block.type)).size, blocks.length, entry.type);
  }
 }
});

test('provider catalogue snapshots contain unique types and only bundled icon paths', () => {
 for (const provider of ['azure','aws','gcp']) {
  const snapshot=JSON.parse(readFileSync(new URL('../assets/catalogue/'+provider+'.json',import.meta.url),'utf8')) as {entries:CatalogueEntry[]};
  assert.ok(snapshot.entries.length>1000);
  assert.equal(new Set(snapshot.entries.map(entry=>entry.type)).size,snapshot.entries.length);
  for(const entry of snapshot.entries) {
   assert.ok(!entry.icon.includes('..')&&!entry.icon.startsWith('/'));
   assert.ok(existsSync(fileURLToPath(new URL('../assets/'+entry.icon,import.meta.url))),entry.icon);
   assert.equal(new Set(entry.fields.map(field=>field.name)).size,entry.fields.length,entry.type);
  }
 }
});

test('service grouping merges parenthetical names and favours the curated representative icon', () => {
 const entry=(type:string,service:string,icon:string,curated=false):CatalogueEntry=>({type,service,icon,curated,label:type,category:'Networking',fields:[]});
 const groups=groupServices([entry('long_attachment','VPC (Virtual Private Cloud)','attachment.svg'),entry('vpc','VPC','vpc.svg',true)]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].section,'Network');
 assert.equal(groups[0].icon,'vpc.svg');
 assert.deepEqual(groups[0].entries.map(entry=>entry.type),['vpc','long_attachment']);
});

test('imported schema types the bundled catalogue lacks join the palette with a generic icon', () => {
	const bundled = [{ type: 'azurerm_resource_group', label: 'Resource Group', service: 'Resource Groups', category: 'Management', icon: 'x.svg', fields: [] }];
	assert.deepEqual(serviceOnlyEntries('azure', bundled), []);
	let notified = 0;
	const stop = subscribeServiceTypes(() => { notified++; });
	registerServiceTypes({ provider: 'azure', version: '5.15.0', resources: ['azurerm_resource_group', 'azurerm_new_thing', 'aws_wrong_provider', 'BAD'] });
	stop();
	assert.equal(notified, 1);
	const extra = serviceOnlyEntries('azure', bundled);
	assert.deepEqual(extra.map(entry => [entry.type, entry.label, entry.service]), [['azurerm_new_thing', 'New Thing', 'Imported schema 5.15.0']]);
	assert.equal(extra[0].iconMatch, 'generic');
});
