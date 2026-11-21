import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { groupServices } from './catalogue.ts';
import type { CatalogueEntry } from './model.ts';

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
