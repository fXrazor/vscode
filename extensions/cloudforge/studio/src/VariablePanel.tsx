import { VariableImport } from './VariableImport.tsx';
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { Plus, Search, LockKeyhole, Download, Copy, Variable } from 'lucide-react';
import type { Action, Architecture } from './model.ts';
import { isSensitiveProperty, variableDeclarations, variableError, variableUses, type VariableDefinition, type VariableValue } from './variables.ts';
import { VariableConfigurator } from './VariableConfigurator.tsx';
import { parseVariableInput } from './variableInputs.ts';

const displayValue = (value: VariableValue | undefined) => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

export function VariablePanel({ architecture, dispatch, code }: { architecture: Architecture; dispatch: Dispatch<Action>; code: boolean }) {
	const variables = architecture.variables ?? [];
	const uses = useMemo(() => variableUses(architecture), [architecture]);
	const [importing, setImporting] = useState(false);
 const [sort, setSort] = useState('name-asc');
 const [filter, setFilter] = useState('all');
 const [copied, setCopied] = useState('');
 const [query, setQuery] = useState('');
	const [editing, setEditing] = useState<VariableDefinition>();
	const list = useRef<HTMLElement>(null);
	const returnFocus = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!copied) { return; }
		const timer = setTimeout(() => setCopied(''), 3000);
		return () => clearTimeout(timer);
	}, [copied]);
	useEffect(() => {
		if (!editing && returnFocus.current) {
			const target = list.current?.querySelector<HTMLButtonElement>('[data-variable-id="'+CSS.escape(returnFocus.current)+'"]') ?? list.current?.querySelector<HTMLButtonElement>('[aria-label="Create variable"]');
			target?.focus(); returnFocus.current = undefined;
		}
	}, [editing]);
	const [defaultSet, setDefaultSet] = useState(false);
	const [valueSet, setValueSet] = useState(false);
	const [defaultText, setDefaultText] = useState('');
	const [valueText, setValueText] = useState('');
	const [error, setError] = useState('');
	const filtered = useMemo(() => {
		const needle = query.toLowerCase();
		return variables
			.filter(variable => (variable.name + ' ' + variable.description).toLowerCase().includes(needle) && (filter === 'all' || filter === 'sensitive' && variable.sensitive || filter === 'required' && variable.defaultValue === undefined || filter === 'referenced' && uses.has(variable.name)))
			.sort((a, b) => {
				const order = sort.startsWith('name') ? a.name.localeCompare(b.name) : (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
				return (sort.endsWith('desc') ? -order : order) || a.name.localeCompare(b.name);
			});
	}, [variables, query, filter, sort, uses]);
	const missing = useMemo(() => {
		const declaredNames = new Set(variables.map(variable => variable.name));
		return [...uses.keys()].filter(name => !declaredNames.has(name));
	}, [variables, uses]);
	function edit(variable: VariableDefinition) {
		returnFocus.current = variable.id;
		setEditing(variable); setError(''); setDefaultSet(variable.defaultValue !== undefined); setValueSet(variable.value !== undefined);
		setDefaultText(displayValue(variable.defaultValue)); setValueText(displayValue(variable.value));
	}
	function save() {
		if (!editing) { return; }
		try {
			const parse = (text: string): VariableValue => parseVariableInput(text,editing.type);
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
	if (editing) { return <VariableConfigurator variable={editing} variables={variables} isNew={!variables.some(variable=>variable.id===editing.id)} useCount={uses.get(editing.name)?.size??0}
		defaultSet={defaultSet} valueSet={valueSet} defaultText={defaultText} valueText={valueText} error={error}
		onChange={value=>{setEditing(value);setError('');}} onDefaultSet={value=>{setDefaultSet(value);setError('');}} onValueSet={value=>{setValueSet(value);setError('');}}
		onDefaultText={value=>{setDefaultText(value);setError('');}} onValueText={value=>{setValueText(value);setError('');}} onSave={save} onCancel={()=>setEditing(undefined)}/>; }
	return <section ref={list} className="variables-panel">
		<header><h2>Variables <span className="faint">{variables.length}</span></h2><span className="spacer"/><button aria-label="Import variables" title="Import .tf or .tfvars variables" onClick={() => setImporting(true)}><Download size={16}/></button><button aria-label="Create variable" title="Create variable" onClick={() => edit({ id: crypto.randomUUID(), name: '', type: 'string', description: '', sensitive: false })}><Plus size={16} /></button></header>
		{variables.length>0&&<label className="lab-search"><Search size={14} /><input aria-label="Search variables" placeholder="Search variables" value={query} onChange={event => setQuery(event.target.value)} /></label>}
  {variables.length>0&&<div className="variable-list-options"><select aria-label="Sort variables" value={sort} onChange={event => setSort(event.target.value)}><option value="name-asc">Name asc</option><option value="name-desc">Name desc</option><option value="updated-asc">Last updated asc</option><option value="updated-desc">Last updated desc</option></select><select aria-label="Filter variables" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All variables</option><option value="sensitive">Sensitive</option><option value="required">Required inputs</option><option value="referenced">Referenced</option></select></div>}
  {copied && <p role="status" className="field-help">{copied}</p>}
		{missing.length > 0 && <div className="variable-discovery"><p>{missing.length} referenced {missing.length === 1 ? 'input has' : 'inputs have'} no declaration. Review {missing.length === 1 ? 'its type' : 'their types'} after adding.</p><button type="button" onClick={() => dispatch({ type: 'addVariables', variables: missing.map(name => ({ id: crypto.randomUUID(), name, type: 'any', description: 'Discovered from a draft var reference; review the type.', sensitive: isSensitiveProperty(name) })) })}>Add referenced variables</button></div>}
		{filtered.map(variable => {
			const useCount = uses.get(variable.name)?.size ?? 0;
			return <article className="variable-card" key={variable.id}>
				<button type="button" className="variable-open" data-variable-id={variable.id} aria-label={'Edit variable ' + variable.name} onClick={() => edit(variable)}><strong>{variable.name}</strong><span className="variable-scope">Architecture</span><span>{variable.sensitive ? <><LockKeyhole size={12} /> Sensitive value</> : (variable.value === undefined && variable.defaultValue === undefined ? 'Required input' : displayValue(variable.value === undefined ? variable.defaultValue : variable.value) || '""')}</span></button>
				<footer><button type="button" aria-label={'Copy reference to ' + variable.name} onClick={() => { void navigator.clipboard.writeText('var.' + variable.name).then(() => setCopied('Copied var.' + variable.name), () => setCopied('Clipboard unavailable. Reference: var.' + variable.name)); }}><Copy size={12}/></button><span>{variable.type} · {useCount} {useCount === 1 ? 'resource use' : 'resource uses'}</span><button type="button" disabled={useCount > 0} title={useCount > 0 ? 'Remove resource references first' : 'Delete variable'} onClick={() => dispatch({ type: 'deleteVariable', id: variable.id })}>Delete</button></footer>
			</article>;
		})}
		{!variables.length && <div className="variable-empty"><Variable size={24}/><h3>Define once, reuse in your resources</h3><p>An input keeps shared settings, such as a region, consistent across the architecture.</p><div className="variable-empty-example"><span>Example input</span><code>deployment_region</code><span>Example value</span><code>uksouth</code></div><p>Choose <strong>Variable</strong> beside a resource field to connect an input.</p><button onClick={()=>edit({id:crypto.randomUUID(),name:'',type:'string',description:'',sensitive:false})}><Plus size={15}/>Create your first variable</button></div>}
		{variables.length > 0 && !filtered.length && <p role="status">No matching variables.</p>}
	</section>;
}
