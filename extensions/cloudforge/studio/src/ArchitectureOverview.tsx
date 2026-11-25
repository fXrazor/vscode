import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Architecture } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { fieldExpression, fieldDefinition } from './fieldBindings.ts';
import { isSensitiveProperty } from './variables.ts';

/** CloudLab Forge overview markup adapted to the shared Studio architecture model. */
export function ArchitectureOverview({ architecture, onSelect }: { architecture: Architecture; onSelect: (id: string) => void }) {
 const [query, setQuery] = useState('');
 const needle = query.trim().toLowerCase();
 const resources = architecture.resources.filter(resource => (resource.name + ' ' + resourceDefinition(resource).label).toLowerCase().includes(needle));
 return <div className="architecture-overview">
  <div className="overview-heading"><div><h2>Architecture</h2><span className="muted">Select a resource to configure it</span></div><span className="shell-count">{architecture.resources.length}</span></div>
  <label className="overview-search"><input aria-label="Find a resource in this architecture" placeholder="Find in architecture…" value={query} onChange={event => setQuery(event.target.value)} /></label>
  {!resources.length && <p className="overview-empty">No matching resources.</p>}
  {resources.map(resource => {
   const definition = resourceDefinition(resource);
   const parent = architecture.resources.find(item=>item.id===resource.parentId)?.name??architecture.items.find(item => item.members.includes(resource.id))?.text;
   const rows = [['Name', fieldExpression(resource,{kind:'name'},architecture.variables,architecture)??resource.name], ['Region', fieldExpression(resource,{kind:'region'},architecture.variables,architecture)??resource.region], ...Object.entries(resource.settings).map(([name,value])=>[name,fieldExpression(resource,{kind:'setting',name},architecture.variables,architecture)??value])].slice(0,6);
   return <article className="resource-summary" key={resource.id}>
    <button className="summary-heading" aria-label={'Configure ' + resource.name} onClick={() => onSelect(resource.id)}>
     <img src={'./assets/' + definition.icon} alt="" /><span className="grow"><strong>{resource.name || 'Unnamed resource'}</strong><span className="summary-type">{definition.label}</span></span><ChevronRight size={13} />
    </button>
    <dl>{rows.map(([name,value]) => <div className="summary-row" key={name}><dt>{name}</dt><dd className={value.startsWith('var.')?'summary-variable':undefined}>{isSensitiveProperty(name,fieldDefinition(resource,{kind:'setting',name})?.sensitive) ? 'Sensitive value' : value}</dd></div>)}</dl>
    {parent && <div className="summary-parent"><span>Inside</span><span>{parent}</span></div>}
   </article>;
  })}
 </div>;
}
