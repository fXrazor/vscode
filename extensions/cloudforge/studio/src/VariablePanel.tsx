import { VariableImport } from './VariableImport.tsx';
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useState, type Dispatch } from 'react';
import { ArrowLeft, Plus, Search, LockKeyhole, Download, Copy } from 'lucide-react';
import type { Action, Architecture } from './model.ts';
import { isSensitiveProperty, variableDeclarations, variableError, variableTypes, variableUses, type VariableDefinition, type VariableValue } from './variables.ts';

const displayValue = (value: VariableValue | undefined) => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

export function VariablePanel({ architecture, dispatch, code }: { architecture: Architecture; dispatch: Dispatch<Action>; code: boolean }) {
	const variables = architecture.variables ?? [];
	const uses = variableUses(architecture);
	const [importing, setImporting] = useState(false);
 const [sort, setSort] = useState('name-asc');
 const [filter, setFilter] = useState('all');
 const [copied, setCopied] = useState('');
 const [query, setQuery] = useState('');
	const [editing, setEditing] = useState<VariableDefinition>();
	const [defaultSet, setDefaultSet] = useState(false);
	const [valueSet, setValueSet] = useState(false);
	const [defaultText, setDefaultText] = useState('');
	const [valueText, setValueText] = useState('');
	const [error, setError] = useState('');
	const filtered = variables.filter(variable => (variable.name + ' ' + variable.description).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'sensitive' && variable.sensitive || filter === 'required' && variable.defaultValue === undefined || filter === 'referenced' && uses.has(variable.name))).sort((a,b) => { const order = sort.startsWith('name') ? a.name.localeCompare(b.name) : (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''); return (sort.endsWith('desc') ? -order : order) || a.name.localeCompare(b.name); });
	const missing = [...uses.keys()].filter(name => !variables.some(variable => variable.name === name));
	function edit(variable: VariableDefinition) {
		setEditing(variable); setError(''); setDefaultSet(variable.defaultValue !== undefined); setValueSet(variable.value !== undefined);
		setDefaultText(displayValue(variable.defaultValue)); setValueText(displayValue(variable.value));
	}
	function save() {
		if (!editing) { return; }
		try {
			const parse = (text: string): VariableValue => editing.type === 'string' ? text : JSON.parse(text);
			const variable = { ...editing, updatedAt: new Date().toISOString(), name: editing.name.trim(), defaultValue: defaultSet ? parse(defaultText) : undefined, value: valueSet ? parse(valueText) : undefined };
			const problem = variableError(variable, variables);
			if (problem) { throw new Error(problem); }
			const previous = variables.find(item => item.id === variable.id);
			if (previous && previous.name !== variable.name && uses.has(previous.name)) { throw new Error('Update the resource references before renaming this variable.'); }
			dispatch({ type: 'saveVariable', variable }); setEditing(undefined);
		} catch (error) { setError(error instanceof SyntaxError ? 'Enter valid JSON for number, bool, list, map or any values.' : error instanceof Error ? error.message : 'Check the variable values.'); }
	}
	if (code) { return <section className="variables-panel"><h2>variables.tf</h2><p className="muted">Declaration preview. Sensitive defaults and assigned values are omitted. This does not write workspace files.</p><pre className="variable-code">{variableDeclarations(variables) || '# No variables declared.'}</pre></section>; }
	if (importing) { return <VariableImport variables={variables} dispatch={dispatch} onClose={() => setImporting(false)} />; }
	if (editing) { return <form className="variables-panel variable-form" onSubmit={event => { event.preventDefault(); save(); }}>
		<header><button type="button" aria-label="Back to variables" onClick={() => setEditing(undefined)}><ArrowLeft size={16} /></button><h2>{variables.some(variable => variable.id === editing.id) ? 'Edit variable' : 'Create variable'}</h2></header>
		<label>Name<input autoFocus required aria-label="Variable name" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
		<label>Scope<input value="Architecture" readOnly /></label>
		<label>Description<textarea aria-label="Variable description" value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
		<label>Type<select aria-label="Variable type" value={editing.type} onChange={event => setEditing({ ...editing, type: event.target.value as VariableDefinition['type'] })}>{variableTypes.map(type => <option key={type}>{type}</option>)}</select></label>
		<label className="variable-checkbox"><input type="checkbox" checked={editing.sensitive} onChange={event => setEditing({ ...editing, sensitive: event.target.checked })} />Sensitive</label>
		<p className="field-help">Sensitive values are masked and omitted from graph exports and declaration previews. This in-memory draft is not a secret store.</p>
		<label className="variable-checkbox"><input type="checkbox" checked={defaultSet} onChange={event => setDefaultSet(event.target.checked)} />Set default value</label>
		{defaultSet && <label>Default value<input type={editing.sensitive ? 'password' : 'text'} aria-label="Variable default value" value={defaultText} onChange={event => setDefaultText(event.target.value)} /></label>}
		<label className="variable-checkbox"><input type="checkbox" checked={valueSet} onChange={event => setValueSet(event.target.checked)} />Set architecture value</label>
		{valueSet && <label>Value<input type={editing.sensitive ? 'password' : 'text'} aria-label="Variable value" value={valueText} onChange={event => setValueText(event.target.value)} /></label>}
		<p className="field-help">Strings use plain text; other types use JSON. No default means the input is required. Assigned values are separate from declaration defaults.</p>
		{error && <p role="alert" className="variable-error">{error}</p>}
		<button className="primary-button" type="submit">Save variable</button>
	</form>; }
	return <section className="variables-panel">
		<header><h2>Variables <span className="faint">{variables.length}</span></h2><span className="spacer"/><button aria-label="Import variables" onClick={() => setImporting(true)}><Download size={16}/></button><button aria-label="Create variable" onClick={() => edit({ id: crypto.randomUUID(), name: '', type: 'string', description: '', sensitive: false })}><Plus size={16} /></button></header>
		<label className="lab-search"><Search size={14} /><input aria-label="Search variables" placeholder="Search variables" value={query} onChange={event => setQuery(event.target.value)} /></label>
  <div className="variable-list-options"><select aria-label="Sort variables" value={sort} onChange={event => setSort(event.target.value)}><option value="name-asc">Name asc</option><option value="name-desc">Name desc</option><option value="updated-asc">Last updated asc</option><option value="updated-desc">Last updated desc</option></select><select aria-label="Filter variables" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All variables</option><option value="sensitive">Sensitive</option><option value="required">Required inputs</option><option value="referenced">Referenced</option></select></div>
  {copied && <p role="status" className="field-help">{copied}</p>}
		{missing.length > 0 && <div className="variable-discovery"><p>{missing.length} referenced inputs have no declaration. Review their types after adding.</p><button onClick={() => dispatch({ type: 'addVariables', variables: missing.map(name => ({ id: crypto.randomUUID(), name, type: 'any', description: 'Discovered from a draft var reference; review the type.', sensitive: isSensitiveProperty(name) })) })}>Add referenced variables</button></div>}
		{filtered.map(variable => <article className="variable-card" key={variable.id}>
			<button className="variable-open" aria-label={'Edit variable ' + variable.name} onClick={() => edit(variable)}><strong>{variable.name}</strong><span className="variable-scope">Architecture</span><span>{variable.sensitive ? <><LockKeyhole size={12} /> Sensitive value</> : (variable.value === undefined && variable.defaultValue === undefined ? 'Required input' : displayValue(variable.value === undefined ? variable.defaultValue : variable.value) || '""')}</span></button>
			<footer><button aria-label={'Copy reference to ' + variable.name} onClick={() => { void navigator.clipboard.writeText('var.' + variable.name).then(() => setCopied('Copied var.' + variable.name), () => setCopied('Clipboard unavailable. Reference: var.' + variable.name)); }}><Copy size={12}/></button><span>{variable.type} · {uses.get(variable.name)?.size ?? 0} resource uses</span><button disabled={uses.has(variable.name)} title={uses.has(variable.name) ? 'Remove resource references first' : 'Delete variable'} onClick={() => dispatch({ type: 'deleteVariable', id: variable.id })}>Delete</button></footer>
		</article>)}
		{!variables.length && <p className="muted">Declare an input, or add variables discovered from var.name references in resource drafts.</p>}
		{variables.length > 0 && !filtered.length && <p role="status">No matching variables.</p>}
	</section>;
}
