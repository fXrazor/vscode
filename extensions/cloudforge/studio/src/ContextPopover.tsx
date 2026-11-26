/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/** A non-modal, portaled editor that cannot be clipped by the graph viewport. */
export function ContextPopover({ label, children, icon, container = null, compact = false, description = 'Edit the selected canvas elements.' }: { label: string; children: ReactNode; icon?: ReactNode; container?: HTMLElement | null; compact?: boolean; description?: string }) {
	const trigger = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false);
	const [position, setPosition] = useState({left:12,top:12,maxHeight:420});
	function change(next: boolean) {
		if (next && trigger.current) { const rect = trigger.current.getBoundingClientRect(); const maxHeight = Math.min(420,innerHeight-32); setPosition({left:Math.max(12,Math.min(rect.left,innerWidth-332)),top:rect.bottom+maxHeight+8<=innerHeight?rect.bottom+8:Math.max(12,rect.top-maxHeight-8),maxHeight}); }
		setOpen(next);
	}
	return <Dialog.Root modal={false} open={open} onOpenChange={change}><Dialog.Trigger type="button" className={compact?'field-help-trigger':undefined} aria-label={compact?label:undefined} ref={trigger}>{icon}{compact?<span className="sr-only">{label}</span>:label}</Dialog.Trigger><Dialog.Portal container={trigger.current?.closest<HTMLElement>('dialog')??container??trigger.current?.closest<HTMLElement>('.studio')}>
		<Dialog.Content className="context-popover" style={position} onKeyDown={event=>event.stopPropagation()}>
			<header><Dialog.Title>{label}</Dialog.Title><Dialog.Close type="button" aria-label={'Close '+label.toLowerCase()}><X size={15}/></Dialog.Close></header><Dialog.Description className="sr-only">{description}</Dialog.Description>{children}
		</Dialog.Content>
	</Dialog.Portal></Dialog.Root>;
}
