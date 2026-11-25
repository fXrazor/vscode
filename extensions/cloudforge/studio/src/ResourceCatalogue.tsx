import { ShapeLibrary } from './ShapeLibrary.tsx';
import type { ShapeId } from './shapes.ts';
import { memo, useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { Architecture, Provider, ResourceKind, BoardItem, CatalogueEntry } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { loadCatalogue, groupServices, technologySections, type CatalogueSnapshot } from './catalogue.ts';
import { Box, Cpu, Network, Database, HardDrive, Activity, PanelLeftClose, Square, Type, Shapes, Package, ChevronDown, ChevronLeft, Search, History, Star, Shield, Zap, Wrench, Brain, BarChart3, Layers, StickyNote, KeyRound, MapPin } from 'lucide-react';

const icons: Record<string, typeof Box> = { Compute: Cpu, Network, Storage:HardDrive, Database, Monitoring:Activity, 'Security & Identity':Shield, Integration:Zap, Management:Wrench, 'AI & ML':Brain, Analytics:BarChart3, Other:Box };

export const ResourceCatalogue = memo(function ResourceCatalogue({ architecture, onAdd, search, onSearch, onImportModule, visible, onClose, onDesignAdd, resizeHandle, onAddCatalogue, onTemplate, shapesOpen, onShapesOpen, onShapesBack, tab: controlledTab, onTabChange }: {
 shapesOpen: boolean; onShapesOpen: () => void; onShapesBack: () => void;
 architecture: Architecture; onAdd: (kind: ResourceKind, provider: Provider) => void;
 search: string; onSearch: (value: string) => void; onImportModule: () => void; visible: boolean; onClose: () => void;
 onDesignAdd: (kind: BoardItem['kind'],caption?:string, shape?:ShapeId) => void; resizeHandle: ReactNode;
 onAddCatalogue: (entry: CatalogueEntry, provider: Provider) => void;
 onTemplate: (kind: 'network' | 'platform' | 'workflow') => void;
 tab?: 'resources' | 'templates'; onTabChange?: (tab: 'resources' | 'templates') => void;
}) {
 const shapesButton = useRef<HTMLButtonElement>(null);
 const [provider, setProvider] = useState<Provider>('azure');
 const [localTab, setLocalTab] = useState<'resources' | 'templates'>('resources');
 const tab = controlledTab ?? localTab;
 const setTab = (next: string) => {
  const value = next === 'templates' ? 'templates' : 'resources';
  setLocalTab(value);
  onTabChange?.(value);
 };
 const [snapshot,setSnapshot] = useState<CatalogueSnapshot>();
 const [failure,setFailure] = useState('');
 const [serviceKey,setServiceKey] = useState('');
 const [favourites,setFavourites] = useState<string[]>([]);
 const [recent,setRecent] = useState<string[]>([]);
 const [limit,setLimit] = useState(80);
 useEffect(() => {
  let active = true; setFailure(''); setSnapshot(undefined); setServiceKey(''); setLimit(80);
  loadCatalogue(provider).then(value => { if (active) { setSnapshot(value); } }, error => { if (active) { setFailure(error.message); } });
  return () => { active = false; };
 },[provider]);
 const entries = snapshot?.entries ?? [];
 const services = useMemo(()=>groupServices(entries),[entries]);
 const needle = search.trim().toLowerCase();
 const results = entries.filter(entry => (entry.type+' '+entry.label+' '+entry.service).toLowerCase().includes(needle));
 const current = services.find(service => service.key === serviceKey);
 const prefix = provider+':';
 function add(entry: CatalogueEntry) { setRecent(values => [prefix+entry.type,...values.filter(value => value !== prefix+entry.type)].slice(0,12)); onAddCatalogue(entry,provider); }
 function favourite(entry: CatalogueEntry) { const key=prefix+entry.type; setFavourites(values => values.includes(key) ? values.filter(value => value !== key) : [...values,key]); }
 function section(id:string,title:ReactNode,children:ReactNode,count?:number) {
  return <details className="lab-category" data-section={id} key={id} open><summary>{title}<span className="spacer" />{count !== undefined && <span className="faint">{count}</span>}<ChevronDown size={12}/></summary>{children}</details>;
 }
 function tile(entry:CatalogueEntry) {
  return <div className="resource-tile" key={entry.type}>
   <button className="tile-pick" aria-label={'Add '+entry.label} title={entry.label+' · '+entry.type} draggable
    onDragStart={event => event.dataTransfer.setData('application/x-cloudforge-catalogue',JSON.stringify({provider,type:entry.type}))} onClick={()=>add(entry)}>
    <img src={'./assets/'+entry.icon} alt="" draggable={false}/><span className="t-name">{entry.label}</span>
   </button>
   <button className={'fav'+(favourites.includes(prefix+entry.type)?' on':'')} aria-label={'Favourite '+entry.label} aria-pressed={favourites.includes(prefix+entry.type)} onClick={()=>favourite(entry)}><Star size={13}/></button>
  </div>;
 }
 function row(entry:CatalogueEntry) {
  return <div className="res-row" key={entry.type}><button className="res-pick" aria-label={'Add '+entry.label} title={entry.label+' · '+entry.type} draggable
   onDragStart={event=>event.dataTransfer.setData('application/x-cloudforge-catalogue',JSON.stringify({provider,type:entry.type}))} onClick={()=>add(entry)}>
   <img src={'./assets/'+entry.icon} alt="" draggable={false}/><span className="res-text"><span className="res-name">{entry.label}</span><span className="res-type">{entry.type}</span></span>
  </button></div>;
 }
 const moduleCount = architecture.resources.filter(resource => resource.kind === 'module').length;
 if (shapesOpen) { return <aside id="resource-library" className="resource-sidebar" hidden={!visible}>{resizeHandle}<ShapeLibrary onWorkflow={()=>onTemplate('workflow')} onBack={() => { onShapesBack(); requestAnimationFrame(() => shapesButton.current?.focus()); }} onAdd={(shape,label) => onDesignAdd('shape',label,shape)} /></aside>; }
 return <Tabs.Root asChild value={tab} onValueChange={setTab}><aside id="resource-library" className="resource-sidebar" hidden={!visible}>
  {resizeHandle}
  <Tabs.List className="lab-tabs library-title" aria-label="Resource sidebar"><Tabs.Trigger value="resources">Resources</Tabs.Trigger><Tabs.Trigger value="templates">Templates</Tabs.Trigger><span className="spacer"/><span className="lib-count">{entries.length.toLocaleString()} types</span><button aria-label="Close resource library" onClick={onClose}><PanelLeftClose size={15}/></button></Tabs.List>
  <div className="cat-head">
   <div className="lib-provider"><select aria-label="Cloud provider" value={provider} onChange={event=>{setProvider(event.target.value as Provider);onSearch('');}}><option value="azure">Azure</option><option value="aws">AWS</option><option value="gcp">Google Cloud</option></select><span className="lib-version" title="Imported provider catalogue version">{snapshot?.version ?? '…'}</span></div>
   <label className="lab-search"><Search size={14}/><input aria-label="Search resource library" placeholder="Search TF resources" value={search} onChange={event=>{onSearch(event.target.value);setServiceKey('');setLimit(80);}}/></label>
   <span className="lib-docs faint">{snapshot ? snapshot.source+' · catalogue snapshot v'+snapshot.version : 'Loading provider catalogue…'}</span>
  </div>
  <div className="catalogue-scroll lab-catalogue">
   {failure && <p role="alert" className="lib-note">{failure}</p>}
   {tab === 'templates' ? <><p className="lib-note faint">Add a sample pattern to the shared graph. Undo removes the pattern.</p>{(['network','platform'] as const).map(kind=><button key={kind} className="res-pick" onClick={()=>onTemplate(kind)}><Layers size={24}/><span className="res-text"><span className="res-name">{kind === 'network' ? 'Private network' : 'Application platform'}</span><span className="res-type">Azure sample · {kind === 'network' ? 'network and subnet' : 'cluster, storage and monitoring'}</span></span></button>)}</> :
    current ? <><div className="drill-head"><button aria-label="Back to all services" onClick={()=>setServiceKey('')}><ChevronLeft size={16}/></button><img src={'./assets/'+current.icon} alt=""/><strong>{current.label}</strong><span className="spacer"/><span className="faint">{current.entries.length}</span></div><div className="res-list">{current.entries.map(row)}</div></> :
    needle ? <>{section('results',<><Search size={14}/>Results</>,<div className="res-list">{results.slice(0,limit).map(row)}</div>,results.length)}{results.length > limit && <button className="show-more" onClick={()=>setLimit(limit+80)}>Show more resources</button>}{snapshot && !results.length && <p className="lib-note faint">No matching resource. Try a Terraform type such as key_vault.</p>}</> :
    <>
     {favourites.some(value=>value.startsWith(prefix)) && section('fav',<><Star size={14}/>Favourites</>,<div className="resource-grid">{entries.filter(entry=>favourites.includes(prefix+entry.type)).map(tile)}</div>)}
     {recent.some(value=>value.startsWith(prefix)) && section('recent',<><History size={14}/>Recently used</>,<div className="resource-grid">{recent.filter(value=>value.startsWith(prefix)).map(value=>entries.find(entry=>value === prefix+entry.type)).filter((entry):entry is CatalogueEntry=>!!entry).map(tile)}</div>)}
     {section('modules',<><Package size={14}/>Modules</>,<div className="lib-modules"><span className="faint">{moduleCount ? moduleCount+' module references in this architecture' : 'Registry, Git or local module references'}</span><button onClick={onImportModule}><Package size={12}/>Import</button></div>)}
     {section('design',<><Shapes size={14}/>Design</>,<div className="resource-grid">{([{kind:'frame',name:'Group box',Icon:Square},{kind:'text',name:'Text',Icon:Type},{kind:'shape',name:'Shapes',Icon:Shapes},{kind:'note',name:'Sticky note',Icon:StickyNote}] as const).map(({kind,name,Icon})=><div className="resource-tile" key={kind}><button className="tile-pick" ref={kind === 'shape' ? shapesButton : undefined} onClick={()=>kind === 'shape' ? onShapesOpen() : onDesignAdd(kind)}><Icon size={26}/><span className="t-name">{name}</span></button></div>)}</div>)}
     {section('containers',<><Square size={14}/>Containers</>,<div className="res-list">
      <button className="res-pick" onClick={()=>onDesignAdd('frame','Subscription')} title="Visual subscription grouping"><KeyRound size={24}/><span className="res-text"><span className="res-name">Subscription</span><span className="res-type">Visual grouping · provider wiring pending</span></span></button>
      <button className="res-pick" onClick={()=>onDesignAdd('frame','Region')}><MapPin size={24}/><span className="res-text"><span className="res-name">Region</span><span className="res-type">Group regions and resources visually</span></span></button>
      <button className="res-pick" onClick={()=>onDesignAdd('frame','Availability Zone')}><Square size={24}/><span className="res-text"><span className="res-name">Availability Zone</span><span className="res-type">Visual availability-zone boundary</span></span></button>
      <button className="res-pick" onClick={()=>onAdd('group',provider)}><img src={'./assets/'+resourceDefinition({kind:'group',provider}).icon} alt=""/><span className="res-text"><span className="res-name">{provider === 'gcp' ? 'Project' : 'Resource group'}</span><span className="res-type">{resourceDefinition({kind:'group',provider}).type}</span></span></button>
      <button className="res-pick" onClick={()=>onDesignAdd('frame')}><Square size={24}/><span className="res-text"><span className="res-name">Group</span><span className="res-type">Drawing frame, no settings</span></span></button>
     </div>)}
     {technologySections.map(name => { const list=services.filter(service=>service.section===name); if(!list.length) {return null;} const Icon=icons[name];return section(name,<><Icon size={14}/>{name}</>,<div className="resource-grid">{list.map(service=><div className="resource-tile" key={service.key}><button className="tile-pick" aria-label={'Open '+service.label+' ('+service.entries.length+')'} title={service.label+' · '+service.entries.length+(service.entries.length===1?' resource type':' resource types')} onClick={()=>setServiceKey(service.key)}><img src={'./assets/'+service.icon} alt="" draggable={false}/><span className="t-name">{service.label}</span></button></div>)}</div>,list.length);})}
    </>}
  </div><p className="library-hint">Drag to place · click to add · ☆ to favourite</p>
 </aside></Tabs.Root>;
});
