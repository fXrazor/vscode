/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import type { Action, BoardItem } from './model.ts';
import { shapeTextColor } from './shapes.ts';
import { DRAWING_MIN_FONT, drawingTargetFontSize, drawingTextBox, fitDrawingFontSize, shapeTextInsets } from './drawingTextFit.ts';

export function drawingTextStyle(item: BoardItem, fittedFontSize?: number): CSSProperties {
	return { fontSize: fittedFontSize ?? drawingTargetFontSize(item), fontWeight: item.bold ? 700 : 400, fontStyle: item.italic ? 'italic' : 'normal', textDecoration: item.underline ? 'underline' : 'none', fontFamily: item.fontFamily === 'mono' ? "'JetBrains Mono', Consolas, monospace" : item.fontFamily === 'serif' ? 'Georgia, serif' : 'inherit', color: item.textColor ?? (item.kind === 'text' || item.kind === 'frame' ? 'var(--text)' : shapeTextColor(item.fill ?? (item.kind === 'note' ? '#fff0b5' : '#eef2ff'))), textAlign: item.textAlign ?? (item.kind === 'shape' ? 'center' : 'left') };
}

export function DrawingText({ item, dispatch, editToken = 0 }: { item: BoardItem; dispatch: Dispatch<Action>; editToken?: number }) {
	const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(''); const done = useRef(false);
	const editor = useRef<HTMLTextAreaElement>(null);
	const container = useRef<HTMLDivElement>(null);
	const measure = useRef<HTMLSpanElement>(null);
	const autoFits = item.kind === 'note' || item.kind === 'shape';
	const activeText = editing ? draft : item.text;
	const targetFont = drawingTargetFontSize({ ...item, text: activeText });
	const box = drawingTextBox(item);
	const estimatedFont = autoFits
		? fitDrawingFontSize(activeText, box.width, box.height, { maxFont: targetFont, fontFamily: item.fontFamily, bold: item.bold }).fontSize
		: targetFont;
	const [fittedFont, setFittedFont] = useState(estimatedFont);
	const [boxTick, setBoxTick] = useState(0);

	// Re-measure smoothly during live resize drags (e.g., React Flow NodeResizer mutating node size before state commit).
	useEffect(() => {
		const element = container.current;
		if (!autoFits || !element || typeof ResizeObserver === 'undefined') { return; }
		const observer = new ResizeObserver(() => setBoxTick(tick => tick + 1));
		observer.observe(element);
		return () => observer.disconnect();
	}, [autoFits]);

	// Exact real-font binary search inside the rendered container so text scales like Miro sticky notes and never overflows.
	useLayoutEffect(() => {
		if (!autoFits) { setFittedFont(targetFont); return; }
		const element = container.current;
		const probe = measure.current;
		if (!element || !probe) { setFittedFont(estimatedFont); return; }
		const availableW = element.clientWidth;
		const availableH = element.clientHeight;
		if (availableW < 8 || availableH < 8) { setFittedFont(estimatedFont); return; }

		const minFont = Math.min(DRAWING_MIN_FONT, targetFont);
		const maxFont = Math.max(minFont, targetFont);
		const prevSize = probe.style.fontSize;
		const prevWrap = probe.style.overflowWrap;
		const prevMaxHeight = probe.style.maxHeight;
		probe.style.overflowWrap = 'normal';
		probe.style.maxHeight = 'none';

		const fits = (size: number) => {
			probe.style.fontSize = size + 'px';
			return probe.scrollHeight <= availableH + 1 && probe.scrollWidth <= availableW + 1;
		};

		let best = minFont;
		if (fits(maxFont)) {
			best = maxFont;
		} else {
			let lo = minFont;
			let hi = maxFont;
			while (lo <= hi) {
				const mid = Math.floor((lo + hi) / 2);
				if (fits(mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
			}
		}
		probe.style.fontSize = prevSize;
		probe.style.overflowWrap = prevWrap;
		probe.style.maxHeight = prevMaxHeight;
		setFittedFont(best);
	}, [autoFits, activeText, targetFont, estimatedFont, item.fontFamily, item.bold, item.italic, item.width, item.height, editing, boxTick]);

	const start = () => { if (item.canvasLocked) { return; } done.current = false; setDraft(item.text); setEditing(true); };
	useEffect(() => { if (editToken) { start(); } }, [editToken]);
	const finish = (cancel = false, restoreFocus = false) => {
		if (done.current) { return; } done.current = true;
		const node = editor.current?.closest<HTMLElement>('.react-flow__node');
		if (!cancel && draft !== item.text) { dispatch({ type: 'updateItem', id: item.id, patch: { text: draft } }); }
		setEditing(false); if (restoreFocus) { requestAnimationFrame(() => node?.focus()); }
	};
	const vertical = item.verticalAlign ?? (item.kind === 'shape' ? 'middle' : 'top');
	const displayText = activeText || 'Double-click to add text';
	const shapeInsetStyle: CSSProperties | undefined = item.kind === 'shape'
		? (() => { const [t, r, b, l] = shapeTextInsets(item.shape); return { inset: `${t * 100}% ${r * 100}% ${b * 100}% ${l * 100}%` }; })()
		: undefined;
	return <div ref={container} className={'drawing-content' + (item.kind === 'frame' ? ' frame-label' : '')} style={{ ...drawingTextStyle(item, autoFits ? fittedFont : targetFont), ...shapeInsetStyle, ...(item.fill === 'transparent' && !item.textColor ? { color: 'var(--text)' } : {}), justifyContent: vertical === 'top' ? 'flex-start' : vertical === 'bottom' ? 'flex-end' : 'center' }} onDoubleClick={event => { event.stopPropagation(); start(); }}>
		{autoFits && <span ref={measure} className={'drawing-text-measure' + (editing ? ' is-editing' : '')} aria-hidden="true">{displayText}</span>}
		{editing ? <textarea ref={editor} className="drawing-inline-editor nodrag nopan" aria-label="Edit drawing text" autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finish(true, true); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(false, true); } }}/> : <span className={item.text ? undefined : 'drawing-placeholder'}>{displayText}</span>}
	</div>;
}
