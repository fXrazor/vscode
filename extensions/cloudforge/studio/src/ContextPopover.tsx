/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/** A non-modal, portaled editor that stays clear of its trigger toolbar and viewport edges. */
export function ContextPopover({ label, children, icon, container = null, compact = false, description = 'Edit the selected canvas elements.' }: { label: string; children: ReactNode; icon?: ReactNode; container?: HTMLElement | null; compact?: boolean; description?: string }) {
	const trigger = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12, maxHeight: 420 });
	function change(next: boolean) {
		if (next && trigger.current) {
			const rect = trigger.current.getBoundingClientRect();
			const gap = 8; const margin = 12;
			const left = Math.max(margin, Math.min(rect.left, innerWidth - 332));
			const spaceBelow = innerHeight - rect.bottom - gap - margin;
			const spaceAbove = rect.top - gap - margin;
			const openBelow = spaceBelow >= 280 || spaceBelow >= spaceAbove;
			const maxHeight = Math.max(160, Math.min(440, Math.floor(openBelow ? spaceBelow : spaceAbove)));
			setPosition(openBelow
				? { left, top: Math.round(rect.bottom + gap), maxHeight }
				: { left, bottom: Math.round(innerHeight - rect.top + gap), maxHeight });
		}
		setOpen(next);
	}
	return <Dialog.Root modal={false} open={open} onOpenChange={change}><Dialog.Trigger type="button" className={compact?'field-help-trigger':undefined} aria-label={compact?label:undefined} ref={trigger}>{icon}{compact?<span className="sr-only">{label}</span>:label}</Dialog.Trigger><Dialog.Portal container={trigger.current?.closest<HTMLElement>('dialog')??container??trigger.current?.closest<HTMLElement>('.studio')}>
		<Dialog.Content className="context-popover" style={position} onKeyDown={event=>event.stopPropagation()}>
			<header><Dialog.Title>{label}</Dialog.Title><Dialog.Close type="button" aria-label={'Close '+label.toLowerCase()}><X size={15}/></Dialog.Close></header><Dialog.Description className="sr-only">{description}</Dialog.Description>{children}
		</Dialog.Content>
	</Dialog.Portal></Dialog.Root>;
}
