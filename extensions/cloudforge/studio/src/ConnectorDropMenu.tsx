/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useRef } from 'react';
import { Circle, Diamond, MoveRight, Square, StickyNote, Type } from 'lucide-react';
import { dropChoices, type DropChoice } from './connectorDrop.ts';

const icons = { note: StickyNote, rectangle: Square, ellipse: Circle, diamond: Diamond, text: Type } as const;

/** Quick-create menu at the end of a connector dropped on empty canvas. Escape or a click away cancels. */
export function ConnectorDropMenu({ at, onPick, onClose, onKeepLooseEnd }: { at: { left: number; top: number }; onPick: (choice: DropChoice) => void; onClose: () => void; onKeepLooseEnd: () => void }) {
	const menu = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
	useEffect(() => {
		menu.current?.querySelector('button')?.focus();
		const away = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) { close.current(); } };
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	}, []);
	return <div ref={menu} className="connector-drop-menu nodrag nopan" role="menu" aria-label="Add a connected element" style={{ left: at.left, top: at.top }}
		onKeyDown={event => {
			const buttons = [...menu.current!.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
			else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
		}}>
		<span className="connector-drop-title">Connect to a new…</span>
		{dropChoices.map(choice => { const Icon = icons[(choice.shape ?? choice.kind) as keyof typeof icons]; return <button key={choice.label} role="menuitem" onClick={() => onPick(choice)}><Icon size={15}/>{choice.label}</button>; })}
		<button className="connector-drop-loose" role="menuitem" onClick={onKeepLooseEnd}><MoveRight size={15}/>Keep loose end</button>
	</div>;
}
