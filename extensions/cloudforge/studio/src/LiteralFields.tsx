/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useId, useState } from 'react';
import type { LiteralMember, LiteralShape } from '../../src/canvas/literalSchema.ts';
import { CircleHelp } from 'lucide-react';
import { ContextPopover } from './ContextPopover.tsx';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const empty = (shape?: LiteralShape): unknown => shape?.kind === 'object' || shape?.kind === 'map' ? {} : shape?.kind === 'tuple' ? shape.elements?.map(empty) ?? [] : shape?.kind === 'list' || shape?.kind === 'set' ? [] : null;

/** Edits one canonical JSON literal through fields; UI mode/key drafts are presentation state only. */
export function LiteralFields({ value, shape, name, id, labelId, onChange, onUnset }: { value: string; shape: LiteralShape; name: string; id: string; labelId: string; onChange: (value: string) => void; onUnset?: () => void }) {
	const prefix = useId();
	const [raw, setRaw] = useState(false);
	const [newKeys, setNewKeys] = useState<Record<string, string>>({});
	let parsed: unknown;
	let valid = true;
	try { parsed = value.trim() ? JSON.parse(value) : undefined; } catch { valid = false; }
	const write = (next: unknown) => next === undefined && onUnset ? onUnset() : onChange(next === undefined ? '' : JSON.stringify(next));
	const render = (current: unknown, type: LiteralShape | undefined, change: (next: unknown) => void, title: string, path: string, member?: LiteralMember, depth = 0): React.ReactNode => {
		const controlId = prefix + encodeURIComponent(path);
		const label = <div className="field-label-help"><label htmlFor={controlId}>{title.replaceAll('_', ' ')}{member?.access === 'required' && <span className="field-required" aria-hidden="true"> *</span>}</label>{member?.description && <ContextPopover compact label={'Help for ' + path} icon={<CircleHelp size={13} />} description="Imported provider schema guidance."><p className="field-help">{member.description}</p></ContextPopover>}</div>;
		if (member?.access === 'computedOnly') { return <div key={path} className="literal-member">{label}<output id={controlId}>{current === undefined ? 'Known after apply' : JSON.stringify(current)}</output><small className="field-help">Provider output · read-only</small></div>; }
		if (type?.kind === 'object') {
			const fields = object(current) ? current : undefined;
			return <details key={path} className="literal-group" open={depth === 0 || undefined}><summary>{title.replaceAll('_', ' ')} <span className="schema-field-type">object</span></summary>{!fields ? <button type="button" onClick={() => change({})}>Configure {title.replaceAll('_', ' ')}</button> : <div className="literal-fields">{Object.entries(type.members ?? {}).map(([key, definition]) => render(fields[key], definition.shape, next => { const updated = { ...fields }; if (next === undefined) { delete updated[key]; } else { updated[key] = next; } change(updated); }, key, path + '.' + key, definition, depth + 1))}{Object.keys(fields).some(key => !Object.hasOwn(type.members ?? {}, key)) && <p className="schema-field-error">This object contains members outside the imported schema. Use Edit JSON to review them.</p>}<button type="button" onClick={() => change(undefined)}>Unset {title.replaceAll('_', ' ')}</button></div>}</details>;
		}
		if (type && ['list', 'set', 'tuple'].includes(type.kind)) {
			const values = Array.isArray(current) ? current : [];
			return <details key={path} className="literal-group" open={depth === 0 || undefined}><summary>{title.replaceAll('_', ' ')} <span className="schema-field-type">{type.kind} · {values.length}</span></summary><div className="literal-fields">{values.map((item, index) => <div key={index} className="literal-entry">{render(item, type.kind === 'tuple' ? type.elements?.[index] : type.element, next => change(values.map((old, position) => position === index ? next ?? null : old)), 'Entry ' + (index + 1), path + '[' + index + ']', undefined, depth + 1)}{type.kind !== 'tuple' && <button type="button" onClick={() => change(values.filter((_, position) => position !== index))}>Remove entry {index + 1}</button>}</div>)}{type.kind === 'tuple' ? <button type="button" onClick={() => change(empty(type))}>Configure tuple ({type.elements?.length ?? 0} entries)</button> : <button type="button" disabled={type.maxItems !== undefined && values.length >= type.maxItems} onClick={() => change([...values, empty(type.element)])}>Add entry to {title.replaceAll('_', ' ')}</button>}{type.minItems !== undefined && <small className="field-help">Minimum entries: {type.minItems}</small>}{type.maxItems !== undefined && <small className="field-help">Maximum entries: {type.maxItems}</small>}<button type="button" onClick={() => change(undefined)}>Unset {title.replaceAll('_', ' ')}</button></div></details>;
		}
		if (type?.kind === 'map') {
			const fields = object(current) ? current : {};
			const key = newKeys[path] ?? '';
			return <details key={path} className="literal-group" open={depth === 0 || undefined}><summary>{title.replaceAll('_', ' ')} <span className="schema-field-type">map · {Object.keys(fields).length}</span></summary><div className="literal-fields">{Object.entries(fields).map(([key, item]) => <div className="literal-entry" key={key}>{render(item, type.element, next => change({ ...fields, [key]: next ?? null }), key, path + '[' + JSON.stringify(key) + ']', undefined, depth + 1)}<button type="button" onClick={() => { const updated = { ...fields }; delete updated[key]; change(updated); }}>Remove {key}</button></div>)}<label htmlFor={controlId}>New entry key</label><input id={controlId} value={key} onChange={event => setNewKeys(previous => ({ ...previous, [path]: event.target.value }))} /><button type="button" disabled={!key || Object.hasOwn(fields, key)} onClick={() => { change({ ...fields, [key]: empty(type.element) }); setNewKeys(previous => ({ ...previous, [path]: '' })); }}>Add map entry</button><button type="button" onClick={() => change(undefined)}>Unset {title.replaceAll('_', ' ')}</button></div></details>;
		}
		return <div key={path} className="literal-member">{label}{type?.kind === 'bool' ? <select id={controlId} value={typeof current === 'boolean' ? String(current) : ''} onChange={event => change(event.target.value ? event.target.value === 'true' : undefined)}><option value="">Not set</option><option value="true">true</option><option value="false">false</option></select> : type?.kind === 'string' || type?.kind === 'number' ? <input id={controlId} type={member?.sensitive ? 'password' : 'text'} inputMode={type.kind === 'number' ? 'decimal' : undefined} value={typeof current === 'string' || typeof current === 'number' ? String(current) : ''} onChange={event => { const text = event.target.value; if (type.kind === 'number') { if (!text) { change(undefined); } else { change(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : text); } } else { change(text); } }} /> : <div><output id={controlId}>{current === undefined ? 'Not set' : JSON.stringify(current)}</output><button type="button" onClick={() => setRaw(true)}>Edit {title.replaceAll('_', ' ')} as JSON</button></div>}{member?.sensitive && <small className="field-help">Use a sensitive variable for this collection instead of a literal secret.</small>}{current !== undefined && <button type="button" onClick={() => change(undefined)}>Unset {title.replaceAll('_', ' ')}</button>}</div>;
	};
	return <div id={id} role="group" aria-labelledby={labelId} className="literal-control"><button type="button" onClick={() => setRaw(previous => !previous)}>{raw || !valid ? 'Use fields' : 'Edit JSON'}</button>{raw || !valid ? <textarea aria-label={name + ' JSON'} value={value} rows={4} spellCheck={false} onChange={event => onChange(event.target.value)} /> : render(parsed, shape, write, name, name)}</div>;
}
