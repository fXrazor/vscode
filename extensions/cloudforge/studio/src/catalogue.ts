import type { CatalogueEntry, Provider } from './model.ts';

export interface CatalogueSnapshot { provider: Provider; version: string; source: string; entries: CatalogueEntry[]; }
const snapshots = new Map<Provider, Promise<CatalogueSnapshot>>();

/** Provider snapshots load independently, without bundling thousands of definitions into startup JS. */
export function loadCatalogue(provider: Provider): Promise<CatalogueSnapshot> {
 let snapshot = snapshots.get(provider);
 if (!snapshot) {
  snapshot = fetch('./assets/catalogue/' + provider + '.json').then(async response => {
   if (!response.ok) { throw new Error('The provider catalogue could not be loaded.'); }
   return response.json() as Promise<CatalogueSnapshot>;
  }).catch(error => { snapshots.delete(provider); throw error; });
  snapshots.set(provider, snapshot);
 }
 return snapshot;
}

export const technologySections = ['Compute', 'Network', 'Storage', 'Database', 'Security & Identity', 'Integration', 'Monitoring', 'AI & ML', 'Analytics', 'Management', 'Other'];
export function sectionFor(category: string) {
 return ({Networking:'Network', Containers:'Compute', Security:'Security & Identity', Identity:'Security & Identity', Messaging:'Integration'} as Record<string,string>)[category] ?? (technologySections.includes(category) ? category : 'Other');
}
export function groupServices(entries: CatalogueEntry[]) {
 const groups = new Map<string,{key:string;label:string;section:string;icon:string;entries:CatalogueEntry[]}>();
 for (const entry of entries) {
  const label = entry.service.replace(/\s*\(.*?\)\s*/g,' ').trim() || entry.service;
  const key = label.toLowerCase();
  let service = groups.get(key);
  if (!service) { service = { key,label,section:sectionFor(entry.category),icon:entry.icon,entries:[] }; groups.set(key, service); }
  service.entries.push(entry);
 }
 for (const group of groups.values()) {
  group.entries.sort((a,b)=>Number(!!b.curated)-Number(!!a.curated)||a.label.localeCompare(b.label));
  const best=group.entries.find(entry=>entry.curated)??group.entries.filter(entry=>entry.iconMatch==='type').sort((a,b)=>a.type.length-b.type.length)[0]??group.entries.find(entry=>entry.iconMatch!=='generic')??group.entries[0];
  group.icon=best.icon;
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
