/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState } from 'react';
import { Braces, ListChecks, Plus, X } from 'lucide-react';
import { parseVariableInput } from './variableInputs.ts';

/** Fields and JSON edit the same VariablePanel draft; only Save enters architecture history. */
export function VariableCollectionInput({ id, label, text, type, onChange, issue, helpId, onBlur }: {
	id: string; label: string; text: string; type: 'list(string)' | 'map(string)';
	onChange: (text: string) => void; issue?: string; helpId: string; onBlur: () => void;
}) {
	const [newKey, setNewKey] = useState('');
	const adder = useRef<HTMLButtonElement>(null);
	const keyInput = useRef<HTMLInputElement>(null);
	const list = type === 'list(string)';
	let parsed: string[] | Record<string, string> | null | undefined;
	let valid = !text.trim();
	if (text.trim()) {
		try { parsed = parseVariableInput(text, type) as typeof parsed; valid = true; } catch { valid = false; }
	}
	const [raw, setRaw] = useState(!valid);
	const write = (value: string[] | Record<string, string> | null) => onChange(JSON.stringify(value));
	const items = Array.isArray(parsed) ? parsed : [];
	const entries = parsed && !Array.isArray(parsed) ? parsed : {};
	const duplicate = Object.hasOwn(entries, newKey);
	const remove = (value: string[] | Record<string, string>) => { write(value); (list ? adder.current : keyInput.current)?.focus(); };
	return <fieldset id={id} className='variable-collection-input literal-control' aria-label={label} aria-invalid={!!issue} aria-describedby={helpId} tabIndex={-1} onBlur={onBlur}>
		<legend className='sr-only'>{label}</legend>
		<button type='button' className='literal-ghost' disabled={!valid} onClick={() => setRaw(value => !value)}>
			{raw || !valid ? <><ListChecks size={13} aria-hidden='true'/>Use entry fields</> : <><Braces size={13} aria-hidden='true'/>Edit JSON</>}
		</button>
		{raw || !valid ? <>
			<textarea aria-label={label + ' JSON'} aria-describedby={helpId} aria-invalid={!!issue} className='variable-json-input' value={text} rows={4} spellCheck={false} onChange={event => onChange(event.target.value)}/>
			{!valid && <p className='configurator-help'>Keep editing JSON until it matches this type to use entry fields. Your draft is preserved.</p>}
		</> : <>
			{parsed === undefined && <p className='configurator-help'>Add an entry or choose an empty collection to set a value.</p>}
			{parsed === null ? <p className='configurator-help'>Null · no value. Add an entry or choose an empty collection to replace it.</p> : <div className='literal-fields'>
				{list ? items.map((value, index) => <div className='literal-entry' key={index}>
					<label>{'Entry ' + (index + 1)}<input aria-label={label + ' entry ' + (index + 1)} value={value} onChange={event => write(items.map((item, position) => position === index ? event.target.value : item))}/></label>
					<button type='button' className='literal-remove' aria-label={'Remove ' + label + ' entry ' + (index + 1)} onClick={() => remove(items.filter((_, position) => position !== index))}><X size={14} aria-hidden='true'/></button>
				</div>) : Object.entries(entries).map(([key, value]) => <div className='literal-entry' key={key}>
					<label>{key || '(empty key)'}<input aria-label={label + ' key ' + JSON.stringify(key)} value={value} onChange={event => write({ ...entries, [key]: event.target.value })}/></label>
					<button type='button' className='literal-remove' aria-label={'Remove ' + label + ' key ' + JSON.stringify(key)} onClick={() => remove(Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key)))}><X size={14} aria-hidden='true'/></button>
				</div>)}
			</div>}
			{!list && <label className='literal-new-key-label'>New entry key<input ref={keyInput} aria-label={label + ' new key'} value={newKey} onChange={event => setNewKey(event.target.value)} aria-invalid={duplicate} aria-describedby={duplicate ? id + '-key-issue' : undefined}/></label>}
			{!list && duplicate && <p role='status' id={id + '-key-issue'} className='configurator-error'>This key already exists. Edit its value above or choose a different key.</p>}
			<button ref={adder} type='button' className='literal-add' aria-label={'Add entry to ' + label} disabled={!list && (!newKey || duplicate)} onClick={() => {
				if (list) { write([...items, '']); } else if (newKey && !duplicate) { write({ ...entries, [newKey]: '' }); setNewKey(''); }
			}}><Plus size={13} aria-hidden='true'/>{list ? 'Add entry' : 'Add key'}</button>
			<div className='literal-actions'><button type='button' className='literal-ghost' onClick={() => write(list ? [] : {})}>{list ? 'Use empty list' : 'Use empty map'}</button><button type='button' className='literal-ghost' onClick={() => write(null)}>Use null</button></div>
		</>}
	</fieldset>;
}
