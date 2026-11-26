import { Link2, Plus, Type, Variable, X } from 'lucide-react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { acceptsVariable, type ListEntry, type ResourceRefCandidate } from './fieldBindings.ts';
import { objectVariablePaths, type VariableDefinition } from './variables.ts';
import { fieldLabel } from './fieldLabel.ts';

/** Variables (and object variable leaves) that fit one entry of the list. */
function entryVariables(variables: VariableDefinition[], element: Pick<AttrDef, 'type'>) {
	return variables.flatMap(variable => variable.type === 'object'
		? objectVariablePaths(variable).filter(leaf => acceptsVariable(variable, element, leaf.path)).map(leaf => ({ variable, path: leaf.path as string[] | undefined, label: [variable.name, ...leaf.path].join('.') }))
		: acceptsVariable(variable, element) ? [{ variable, path: undefined as string[] | undefined, label: variable.name }] : []);
}
const optionKey = (variableId: string, path?: string[]) => JSON.stringify([variableId, ...(path ?? [])]);

/**
 * One list field edited entry by entry. Each entry is a typed value, a variable or a resource reference,
 * so a VM can list several NICs and a subnet can mix a fixed range with a variable one.
 */
export function ListEntries({ id, labelId, name, entries, element, variables, candidates, onChange, onUnset }: {
	id: string; labelId: string; name: string; entries: ListEntry[]; element: Pick<AttrDef, 'type'>;
	variables: VariableDefinition[]; candidates: ResourceRefCandidate[]; onChange: (entries: ListEntry[]) => void; onUnset?: () => void;
}) {
	const label = fieldLabel(name);
	const options = entryVariables(variables, element);
	const set = (index: number, entry: ListEntry) => onChange(entries.map((item, position) => position === index ? entry : item));
	const firstVariable = (): ListEntry | undefined => options[0] && { kind: 'variable', variableId: options[0].variable.id, ...(options[0].path ? { path: options[0].path } : {}) };
	const unused = candidates.find(candidate => !entries.some(entry => entry.kind === 'ref' && entry.resourceId === candidate.resource.id && entry.attribute === candidate.attribute)) ?? candidates[0];
	const firstRef = (): ListEntry | undefined => unused && { kind: 'ref', resourceId: unused.resource.id, attribute: unused.attribute };
	const switchKind = (index: number, kind: ListEntry['kind']) => { const next = kind === 'value' ? { kind: 'value' as const, value: '' } : kind === 'variable' ? firstVariable() : firstRef(); if (next) { set(index, next); } };
	return <div id={id} role="group" aria-labelledby={labelId} className="list-entries literal-control">
		{entries.length === 0 && <p className="list-entries-empty">No entries yet.</p>}
		{entries.map((entry, index) => <div key={index} className={'list-entry is-' + entry.kind}>
			<select className="list-entry-kind" aria-label={label + ' entry ' + (index + 1) + ' type'} title="Entry type" value={entry.kind} onChange={event => switchKind(index, event.target.value as ListEntry['kind'])}>
				<option value="value">Value</option>
				<option value="variable" disabled={!options.length}>Variable</option>
				<option value="ref" disabled={!candidates.length}>Reference</option>
			</select>
			<span className="list-entry-icon" aria-hidden="true">{entry.kind === 'value' ? <Type size={13}/> : entry.kind === 'variable' ? <Variable size={13}/> : <Link2 size={13}/>}</span>
			{entry.kind === 'value' ? <input aria-label={label + ' entry ' + (index + 1)} inputMode={element.type === 'number' ? 'decimal' : undefined} value={entry.value} placeholder={'Entry ' + (index + 1)} onChange={event => set(index, { kind: 'value', value: event.target.value })}/>
				: entry.kind === 'variable' ? <select aria-label={label + ' entry ' + (index + 1) + ' variable'} value={optionKey(entry.variableId, entry.path)} onChange={event => { const choice = options.find(option => optionKey(option.variable.id, option.path) === event.target.value); if (choice) { set(index, { kind: 'variable', variableId: choice.variable.id, ...(choice.path ? { path: choice.path } : {}) }); } }}>
					{!options.some(option => optionKey(option.variable.id, option.path) === optionKey(entry.variableId, entry.path)) && <option value={optionKey(entry.variableId, entry.path)}>Missing variable</option>}
					{options.map(option => <option key={optionKey(option.variable.id, option.path)} value={optionKey(option.variable.id, option.path)}>var.{option.label}</option>)}
				</select>
				: <select aria-label={label + ' entry ' + (index + 1) + ' reference'} value={entry.resourceId + ':' + entry.attribute} onChange={event => { const choice = candidates.find(candidate => candidate.resource.id + ':' + candidate.attribute === event.target.value); if (choice) { set(index, { kind: 'ref', resourceId: choice.resource.id, attribute: choice.attribute }); } }}>
					{!candidates.some(candidate => candidate.resource.id === entry.resourceId && candidate.attribute === entry.attribute) && <option value={entry.resourceId + ':' + entry.attribute}>Missing resource</option>}
					{candidates.map(candidate => <option key={candidate.resource.id + ':' + candidate.attribute} value={candidate.resource.id + ':' + candidate.attribute}>{(candidate.resource.label || candidate.resource.name) + ' · ' + candidate.expression}</option>)}
				</select>}
			<button type="button" className="literal-remove" aria-label={'Remove entry ' + (index + 1)} title={'Remove entry ' + (index + 1)} onClick={() => onChange(entries.filter((_, position) => position !== index))}><X size={14} aria-hidden="true"/></button>
		</div>)}
		<div className="list-entries-add">
			<button type="button" className="literal-add" aria-label={'Add entry to ' + label} onClick={() => onChange([...entries, { kind: 'value', value: '' }])}><Plus size={13} aria-hidden="true"/>Value</button>
			<button type="button" className="literal-add" aria-label={'Add variable entry to ' + label} disabled={!options.length} title={options.length ? undefined : 'No compatible variables yet. Create one in Variables.'} onClick={() => { const next = firstVariable(); if (next) { onChange([...entries, next]); } }}><Plus size={13} aria-hidden="true"/>Variable</button>
			{candidates.length > 0 && <button type="button" className="literal-add" aria-label={'Add reference entry to ' + label} onClick={() => { const next = firstRef(); if (next) { onChange([...entries, next]); } }}><Plus size={13} aria-hidden="true"/>Reference</button>}
		</div>
		{onUnset && entries.length > 0 && <div className="literal-actions"><button type="button" className="literal-unset" aria-label={'Unset ' + label} onClick={onUnset}>Unset</button></div>}
	</div>;
}
