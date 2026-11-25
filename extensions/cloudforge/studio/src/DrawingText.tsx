/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import type { Action, BoardItem } from './model.ts';
import { shapeTextColor } from './shapes.ts';

export function drawingTextStyle(item: BoardItem): CSSProperties {
	return { fontSize: item.fontSize ?? (item.kind === 'text' ? 20 : item.kind === 'frame' ? 12 : 16), fontWeight: item.bold ? 700 : 400, fontStyle: item.italic ? 'italic' : 'normal', textDecoration: item.underline ? 'underline' : 'none', fontFamily: item.fontFamily === 'mono' ? "'JetBrains Mono', Consolas, monospace" : item.fontFamily === 'serif' ? 'Georgia, serif' : 'inherit', color: item.textColor ?? (item.kind === 'text' || item.kind === 'frame' ? 'var(--text)' : shapeTextColor(item.fill ?? (item.kind === 'note' ? '#fff0b5' : '#eef2ff'))), textAlign: item.textAlign ?? (item.kind === 'shape' ? 'center' : 'left') };
}

export function DrawingText({ item, dispatch, editToken = 0 }: { item: BoardItem; dispatch: Dispatch<Action>; editToken?: number }) {
	const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(''); const done = useRef(false);
	const editor = useRef<HTMLTextAreaElement>(null);
	const start = () => { if (item.canvasLocked) { return; } done.current = false; setDraft(item.text); setEditing(true); };
	useEffect(() => { if (editToken) { start(); } }, [editToken]);
	const finish = (cancel = false, restoreFocus = false) => {
		if (done.current) { return; } done.current = true;
		const node = editor.current?.closest<HTMLElement>('.react-flow__node');
		if (!cancel && draft !== item.text) { dispatch({ type: 'updateItem', id: item.id, patch: { text: draft } }); }
		setEditing(false); if (restoreFocus) { requestAnimationFrame(() => node?.focus()); }
	};
	const vertical = item.verticalAlign ?? (item.kind === 'shape' ? 'middle' : 'top');
	return <div className={'drawing-content' + (item.kind === 'frame' ? ' frame-label' : '')} style={{ ...drawingTextStyle(item), ...(item.fill === 'transparent' && !item.textColor ? { color: 'var(--text)' } : {}), justifyContent: vertical === 'top' ? 'flex-start' : vertical === 'bottom' ? 'flex-end' : 'center' }} onDoubleClick={event => { event.stopPropagation(); start(); }}>
		{editing ? <textarea ref={editor} className="drawing-inline-editor nodrag nopan" aria-label="Edit drawing text" autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finish(true, true); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(false, true); } }}/> : <span>{item.text || 'Double-click to add text'}</span>}
	</div>;
}
