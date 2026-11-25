/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, Variable, LockKeyhole, X } from 'lucide-react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import type { VariableDefinition } from './variables.ts';
import { acceptsVariable, variablePreview } from './fieldBindings.ts';

export function VariablePicker({ name, variables, selectedId, definition, onSelect, sensitiveField = false, onManageVariables }: { name: string; variables: VariableDefinition[]; selectedId?: string; definition?: AttrDef; onSelect: (id: string) => void; sensitiveField?: boolean; onManageVariables?: () => void }) {
	const trigger = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null);
	const managing = useRef(false);
	const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
	const [placement, setPlacement] = useState({ left: 0, top: 0, maxHeight: 360 });
	const matches = open ? variables.filter(item => (item.name + ' ' + item.type).toLowerCase().includes(query.toLowerCase())) : [];
	function changeOpen(next: boolean) {
		if (next && trigger.current) {
			const rect = trigger.current.getBoundingClientRect(); const height = Math.min(360, innerHeight - 24);
			setPlacement({ left: Math.max(12, Math.min(rect.right - 320, innerWidth - 332)), top: rect.bottom + height + 8 <= innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8), maxHeight: height }); setQuery('');
		}
		setOpen(next);
	}
	return <Dialog.Root modal={false} open={open} onOpenChange={changeOpen}>
		<Dialog.Trigger ref={trigger} className="variable-trigger" aria-label={'Choose variable for ' + name} aria-pressed={!!selectedId}><Variable size={13}/>Variable</Dialog.Trigger>
		<Dialog.Portal container={trigger.current?.closest<HTMLElement>('dialog') ?? trigger.current?.closest<HTMLElement>('.studio')}>
			<Dialog.Content className="variable-picker" style={placement} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }} onCloseAutoFocus={event => {
				if (managing.current) { event.preventDefault(); managing.current = false; onManageVariables?.(); }
			}}>
				<div className="variable-picker-heading"><Dialog.Title>Bind {name}</Dialog.Title><Dialog.Close aria-label="Close variable picker"><X size={15}/></Dialog.Close></div>
				<Dialog.Description>Choose a Terraform input. Values remain linked to the declaration.</Dialog.Description>
				<label className="variable-picker-search"><Search size={14}/><input ref={search} aria-label="Search variables" placeholder="Find by name or type" value={query} onChange={event => setQuery(event.target.value)}/></label>
				<div className="variable-picker-list">{matches.map(variable => <button key={variable.id} disabled={!acceptsVariable(variable, definition)} aria-label={'Bind variable ' + variable.name} aria-pressed={selectedId === variable.id} onClick={() => { onSelect(variable.id); setOpen(false); }}>
					<span><Variable size={14}/><strong>{variable.name}</strong>{variable.sensitive && <LockKeyhole size={12}/>}<small>{variable.type}</small></span>
					<span>{acceptsVariable(variable, definition) ? variablePreview(variable, sensitiveField || definition?.sensitive) : 'Type does not match this field'}</span>
				</button>)}</div>
				{!matches.length && <p className="variable-picker-empty">{variables.length ? 'No matching variables.' : 'Create or import a variable in the Variables panel, then bind it here.'}</p>}
				{onManageVariables && <button onClick={()=>{managing.current=true;setOpen(false);}}>Open Variables panel</button>}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}
