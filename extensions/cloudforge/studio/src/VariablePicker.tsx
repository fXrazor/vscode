/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Search, Variable, LockKeyhole, X } from 'lucide-react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { objectVariablePaths, type VariableDefinition } from './variables.ts';
import { acceptsVariable, variablePreview } from './fieldBindings.ts';

export function VariablePicker({ name, variables, selectedId, selectedPath, definition, onSelect, sensitiveField = false, onManageVariables }: { name: string; variables: VariableDefinition[]; selectedId?: string; selectedPath?: string[]; definition?: AttrDef; onSelect: (id: string, path?: string[]) => void; sensitiveField?: boolean; onManageVariables?: () => void }) {
	const trigger = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null);
	const managing = useRef(false);
	const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
	const [placement, setPlacement] = useState({ left: 0, top: 0, width: 360, maxHeight: 400 });
	const fits = (item: VariableDefinition) => acceptsVariable(item, definition) || objectVariablePaths(item).some(entry => acceptsVariable(item, definition, entry.path));
	const matches = open ? variables.filter(item => (item.name + ' ' + item.type + ' ' + item.description + ' ' + objectVariablePaths(item).map(entry => entry.path.join('.')).join(' ')).toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => Number(fits(b)) - Number(fits(a)) || a.name.localeCompare(b.name)) : [];
	const selected = variables.find(item => item.id === selectedId);
	function changeOpen(next: boolean) {
		if (next && trigger.current) {
			const rect = trigger.current.getBoundingClientRect(); const height = Math.min(400, innerHeight - 24);
			const width = Math.min(Math.max(320, trigger.current.closest('.schema-field')?.clientWidth ?? 360), 420, innerWidth - 24);
			setPlacement({ left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)), top: rect.bottom + height + 8 <= innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8), width, maxHeight: height }); setQuery('');
		}
		setOpen(next);
	}
	return <Dialog.Root modal={false} open={open} onOpenChange={changeOpen}>
		<Dialog.Trigger ref={trigger} className="variable-trigger" aria-label={'Choose variable for ' + name} aria-pressed={!!selectedId}><Variable size={13}/>Variable</Dialog.Trigger>
		<Dialog.Portal container={trigger.current?.closest<HTMLElement>('dialog') ?? trigger.current?.closest<HTMLElement>('.studio')}>
			<Dialog.Content className="variable-picker" style={placement} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }} onCloseAutoFocus={event => {
				if (managing.current) { event.preventDefault(); managing.current = false; onManageVariables?.(); }
			}}>
				<div className="variable-picker-heading"><Dialog.Title>Choose variable</Dialog.Title><Dialog.Close aria-label="Close variable picker"><X size={15}/></Dialog.Close></div>
				<Dialog.Description>Bind an input to <strong>{name.replaceAll('_', ' ')}</strong>.</Dialog.Description>
				<label className="variable-picker-search"><Search size={15}/><input ref={search} aria-label="Search variables" placeholder="Search name, type or description" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = event.currentTarget.closest('.variable-picker')?.querySelectorAll<HTMLButtonElement>('.variable-picker-list > button:not(:disabled)'); buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus(); }
				}}/></label>
				{selected && <div className="variable-picker-current"><span>Selected</span><span className="variable-chip"><Variable size={13}/>{[selected.name, ...(selectedPath ?? [])].join(' › ')}<Check size={13}/></span></div>}
				<div className="variable-picker-list" aria-label="Available variables" onKeyDown={event => {
					if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }
					event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
					const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
					if (next < 0) { search.current?.focus(); } else { buttons[Math.min(next, buttons.length - 1)]?.focus(); }
				}}>{matches.flatMap(variable => [<button key={variable.id} disabled={!acceptsVariable(variable, definition)} aria-label={'Bind variable ' + variable.name} aria-pressed={selectedId === variable.id && !selectedPath?.length} onClick={() => { onSelect(variable.id); setOpen(false); }}>
					<span><Variable size={15}/><strong>{variable.name}</strong>{variable.sensitive && <LockKeyhole size={12} aria-label="Sensitive"/>}<small>{variable.type}</small>{selectedId === variable.id && !selectedPath?.length && <Check size={14}/>}</span>
					<span>{acceptsVariable(variable, definition) ? variablePreview(variable, sensitiveField || definition?.sensitive) : variable.type === 'object' ? 'Pick one value inside it below' : 'Type does not match this field'}</span>
					{variable.description && <span className="variable-picker-description">{variable.description}</span>}
				</button>, ...objectVariablePaths(variable).map(entry => { const pathText = entry.path.join('.'); const chosen = selectedId === variable.id && (selectedPath ?? []).join('.') === pathText; const ok = acceptsVariable(variable, definition, entry.path); if (!ok && entry.value !== null && typeof entry.value === 'object' && !Array.isArray(entry.value)) { return <div key={variable.id + ':' + pathText} className="variable-picker-group" style={{ paddingLeft: 12 + entry.path.length * 14 }}>{entry.path.at(-1)}</div>; } return <button key={variable.id + ':' + pathText} className="variable-picker-path" style={{ paddingLeft: 12 + entry.path.length * 14 }} disabled={!ok} aria-label={'Bind variable ' + variable.name + '.' + pathText} aria-pressed={chosen} title={'var.' + variable.name + '.' + pathText} onClick={() => { onSelect(variable.id, entry.path); setOpen(false); }}>
					<span><strong>{entry.path.at(-1)}</strong><small>var.{variable.name}.{pathText}</small>{chosen && <Check size={14}/>}</span>
					<span>{ok ? variablePreview(variable, sensitiveField || definition?.sensitive, entry.path) : 'Type does not match this field'}</span>
				</button>; })])}</div>
				{!matches.length && <p className="variable-picker-empty">{variables.length ? 'No matching variables.' : 'Create or import a variable in the Variables panel, then bind it here.'}</p>}
				<footer><span>{matches.length} {matches.length === 1 ? 'input' : 'inputs'}</span>{onManageVariables && <button onClick={()=>{managing.current=true;setOpen(false);}}>Manage variables</button>}</footer>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}
