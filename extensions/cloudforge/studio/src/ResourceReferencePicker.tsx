/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Link2, Search, X } from 'lucide-react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import type { ResourceRefCandidate, ResourceRefEntry } from './fieldBindings.ts';
import { resourceDefinition } from './fixture.ts';

export function ResourceReferencePicker({ name, definition, candidates, selected, onSelect }: {
	name: string;
	definition?: AttrDef;
	candidates: ResourceRefCandidate[];
	selected: readonly ResourceRefEntry[];
	onSelect: (refs?: ResourceRefEntry[]) => void;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [placement, setPlacement] = useState({ left: 0, top: 0, maxHeight: 360 });
	const isList = definition?.type === 'list';
	const selectedKeys = useMemo(
		() => new Set(selected.map(entry => `${entry.resourceId}:${entry.attribute}`)),
		[selected]
	);
	const matches = useMemo(() => {
		if (!open) { return []; }
		const needle = query.toLowerCase();
		return candidates.filter(candidate => {
			const meta = resourceDefinition(candidate.resource);
			return (candidate.resource.name + ' ' + (candidate.resource.label ?? '') + ' ' + meta.type + ' ' + candidate.expression).toLowerCase().includes(needle);
		});
	}, [open, candidates, query]);

	function changeOpen(next: boolean) {
		if (next && trigger.current) {
			const rect = trigger.current.getBoundingClientRect();
			const height = Math.min(360, innerHeight - 24);
			setPlacement({
				left: Math.max(12, Math.min(rect.right - 340, innerWidth - 352)),
				top: rect.bottom + height + 8 <= innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8),
				maxHeight: height,
			});
			setQuery('');
		}
		setOpen(next);
	}

	function toggle(candidate: ResourceRefCandidate) {
		const isSelected = selectedKeys.has(`${candidate.resource.id}:${candidate.attribute}`);
		if (isList) {
			const next = isSelected
				? selected.filter(entry => !(entry.resourceId === candidate.resource.id && entry.attribute === candidate.attribute))
				: [...selected, { resourceId: candidate.resource.id, attribute: candidate.attribute }];
			onSelect(next.length ? next : undefined);
		} else {
			onSelect(isSelected ? undefined : [{ resourceId: candidate.resource.id, attribute: candidate.attribute }]);
			setOpen(false);
		}
	}

	return <Dialog.Root modal={false} open={open} onOpenChange={changeOpen}>
		<Dialog.Trigger type="button" ref={trigger} className="variable-trigger resource-ref-trigger" aria-label={'Choose resource reference for ' + name} aria-pressed={selected.length > 0}><Link2 size={13} />Reference</Dialog.Trigger>
		<Dialog.Portal container={trigger.current?.closest<HTMLElement>('dialog') ?? trigger.current?.closest<HTMLElement>('.studio')}>
			<Dialog.Content className="variable-picker resource-ref-picker" style={placement} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }}>
				<div className="variable-picker-heading"><Dialog.Title>Reference for {name.replaceAll('_', ' ')}</Dialog.Title><Dialog.Close type="button" aria-label="Close resource reference picker"><X size={15} /></Dialog.Close></div>
				<Dialog.Description>{isList ? 'Select one or more compatible resources to project typed Terraform references.' : 'Choose a compatible resource attribute to create a typed Terraform reference.'}</Dialog.Description>
				<label className="variable-picker-search"><Search size={14} /><input ref={search} aria-label="Search compatible resources" placeholder="Filter by name or Terraform type" value={query} onChange={event => setQuery(event.target.value)} /></label>
				<div className="variable-picker-list">{matches.map(candidate => {
					const meta = resourceDefinition(candidate.resource);
					const key = `${candidate.resource.id}:${candidate.attribute}`;
					const active = selectedKeys.has(key);
					const held = !active && candidate.inUseBy;
					const heldBy = held ? (held.label || held.name) : '';
					return <button type="button" key={key} className={'resource-ref-picker-item' + (held ? ' is-in-use' : '')} aria-label={'Reference ' + candidate.expression + (held ? ', already attached to ' + heldBy : '')} aria-pressed={active} disabled={!!held} title={held ? 'Already attached to ' + heldBy + '. Remove it there first.' : undefined} onClick={() => toggle(candidate)}>
						<span><img src={'./assets/' + meta.icon} alt="" /><strong>{candidate.resource.label || candidate.resource.name}</strong>{held ? <small className="resource-ref-in-use">In use by {heldBy}</small> : <small>.{candidate.attribute}</small>}{active && <Check size={13} className="resource-ref-check" />}</span>
						<span><code>{candidate.expression}</code></span>
					</button>;
				})}</div>
				{!matches.length && <p className="variable-picker-empty">{candidates.length ? 'No matching compatible resources.' : 'Add a compatible resource (' + (definition?.refTypes?.join(', ') ?? '') + ') to reference it here.'}</p>}
				{isList && selected.length > 0 && <button type="button" onClick={() => setOpen(false)}>Done ({selected.length} selected)</button>}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}
