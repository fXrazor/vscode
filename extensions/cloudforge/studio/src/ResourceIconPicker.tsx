/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { Search } from 'lucide-react';
import { ContextPopover } from './ContextPopover.tsx';
import type { Action, CatalogueEntry, Provider, Resource } from './model.ts';
import { loadCatalogue } from './catalogue.ts';
import { providerNames } from './fixture.ts';
import { resourceGraphic } from './resourceGraphic.ts';
import { ProviderMark } from './ProviderMark.tsx';

export function ResourceIconPicker({ resource, dispatch }: { resource: Resource; dispatch: Dispatch<Action> }) {
	return <div className="resource-icon-control"><ContextPopover label="Replace icon" icon={<img className="graphic-picker-trigger" src={'./assets/' + resourceGraphic(resource).icon} alt=""/>} description="Choose a graphic from the bundled provider catalogue."><IconCatalogue resource={resource} dispatch={dispatch}/></ContextPopover></div>;
}

function IconCatalogue({ resource, dispatch }: { resource: Resource; dispatch: Dispatch<Action> }) {
	const [provider, setProvider] = useState(resource.iconOverride?.provider ?? resource.provider);
	const [entries, setEntries] = useState<CatalogueEntry[]>();
	const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [limit, setLimit] = useState(72);
	useEffect(() => {
		let active = true; setEntries(undefined); setError('');
		loadCatalogue(provider).then(snapshot => { if (active) { setEntries(snapshot.entries); } }, error => { if (active) { setError(String(error.message)); } });
		return () => { active = false; };
	}, [provider]);
	const icons = useMemo(() => {
		const matches = (entries ?? []).filter(entry => (entry.label + ' ' + entry.service + ' ' + entry.type).toLowerCase().includes(query.trim().toLowerCase()));
		return [...new Map(matches.map(entry => [entry.icon, entry])).values()];
	}, [entries, query]);
	return <div className="graphic-catalogue">
		<label className="lab-search"><Search size={14}/><input autoFocus aria-label="Search icons" placeholder="Search service or icon" value={query} onChange={event => { setQuery(event.target.value); setLimit(72); }}/></label>
		<label className="graphic-provider"><ProviderMark provider={provider}/><select aria-label="Icon provider" value={provider} onChange={event => { setProvider(event.target.value as Provider); setLimit(72); }}>{Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
		<div className="graphic-icon-grid" aria-label="Provider icons">{icons.slice(0, limit).map(entry => <button key={entry.icon} aria-label={'Use ' + entry.label + ' icon'} title={entry.label} aria-pressed={resourceGraphic(resource).icon === entry.icon} onClick={() => dispatch({ type: 'update', id: resource.id, patch: { iconOverride: { icon: entry.icon, label: entry.label, provider } } })}><img src={'./assets/' + entry.icon} alt="" loading="lazy"/></button>)}</div>
		{error ? <p role="alert">{error}</p> : !entries ? <p role="status">Loading icons…</p> : !icons.length ? <p role="status">No matching icons. Try another provider or search.</p> : <p className="field-help">{icons.length} bundled icons · Graphic only</p>}
		{icons.length > limit && <button onClick={() => setLimit(value => value + 72)}>Show more icons</button>}
		<button disabled={!resource.iconOverride && !resource.iconKind} onClick={() => dispatch({ type: 'update', id: resource.id, patch: { iconOverride: undefined, iconKind: undefined } })}>Restore resource icon</button>
	</div>;
}
