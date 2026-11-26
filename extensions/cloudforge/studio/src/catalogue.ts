import type { CatalogueEntry, Provider } from './model.ts';

export interface CatalogueSnapshot { provider: Provider; version: string; source: string; entries: CatalogueEntry[]; }
const snapshots = new Map<Provider, Promise<CatalogueSnapshot>>();

/** Palette icon of every resource type in the provider catalogues loaded so far. */
const iconByType = new Map<string, string>();
const iconListeners = new Set<() => void>();
let iconVersion = 0;

/** Records the palette icons of a loaded catalogue so canvas nodes projected from Terraform show the same icon. */
export function recordCatalogueIcons(entries: readonly Pick<CatalogueEntry, 'type' | 'icon'>[]) {
 let changed = false;
 for (const entry of entries) {
  if (typeof entry.type === 'string' && typeof entry.icon === 'string' && entry.icon && iconByType.get(entry.type) !== entry.icon) { iconByType.set(entry.type, entry.icon); changed = true; }
 }
 if (changed) { iconVersion++; for (const listener of iconListeners) { listener(); } }
}
/** The palette icon for a resource type, once its provider catalogue has loaded. */
export function catalogueIconFor(type: string): string | undefined { return iconByType.get(type); }
export function subscribeCatalogueIcons(listener: () => void) { iconListeners.add(listener); return () => { iconListeners.delete(listener); }; }
export function catalogueIconsVersion() { return iconVersion; }

/** Provider snapshots load independently, without bundling thousands of definitions into startup JS. */
export function loadCatalogue(provider: Provider): Promise<CatalogueSnapshot> {
 let snapshot = snapshots.get(provider);
 if (!snapshot) {
  snapshot = fetch('./assets/catalogue/' + provider + '.json').then(async response => {
   if (!response.ok) { throw new Error('The provider catalogue could not be loaded.'); }
    const value = await response.json() as CatalogueSnapshot;
    const loaded = { ...value, entries: value.entries.map(entry => ({ ...entry, providerVersion: value.version, providerSource: value.source })) };
    recordCatalogueIcons(loaded.entries);
    return loaded;
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

/** Resource types listed by an imported provider schema snapshot (`listCatalogueTypes` via the host). */
export interface ServiceCatalogueTypes { provider: Provider; version: string; resources: readonly string[]; }

const genericIcons: Record<Provider, string> = {
 azure: 'catalog-icons/azure/azure-key-vaults.svg',
 aws: 'catalog-icons/aws/aws-management-console.svg',
 gcp: 'catalog-icons/gcp/gcp-cloud-generic.svg',
};
const typePrefixes: Record<string, string> = { azure: 'azurerm_', aws: 'aws_', gcp: 'google_' };
const serviceTypes = new Map<Provider, ServiceCatalogueTypes>();
const listeners = new Set<() => void>();
let serviceTypesVersion = 0;

function labelFor(type: string, prefix: string) {
 return type.slice(type.startsWith(prefix) ? prefix.length : 0).split('_').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ') || type;
}

/** Records the newest imported snapshot's types for a provider; the palette re-renders through `subscribeServiceTypes`. */
export function registerServiceTypes(value: ServiceCatalogueTypes) {
 const prefix = typePrefixes[value.provider];
 if (!prefix) { return; }
 serviceTypes.set(value.provider, { ...value, resources: value.resources.filter(type => /^[a-z0-9_]{1,128}$/.test(type) && type.startsWith(prefix)).slice(0, 5000) });
 serviceTypesVersion++;
 for (const listener of listeners) { listener(); }
}
export function subscribeServiceTypes(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function serviceTypesSnapshot() { return serviceTypesVersion; }

/**
 * Entries for resource types the imported snapshot has but the bundled catalogue lacks (for example
 * after importing a newer provider release). They use a generic icon; the inspector loads their live
 * form from the same snapshot, so no field list is bundled here.
 */
export function serviceOnlyEntries(provider: Provider, bundled: readonly CatalogueEntry[]): CatalogueEntry[] {
 const listed = serviceTypes.get(provider);
 if (!listed) { return []; }
 const known = new Set(bundled.map(entry => entry.type));
 const prefix = typePrefixes[provider];
 return listed.resources.filter(type => !known.has(type)).map(type => ({
  type, label: labelFor(type, prefix), service: 'Imported schema ' + listed.version, category: 'Other',
  icon: genericIcons[provider], fields: [], curated: false, iconMatch: 'generic',
 }));
}
