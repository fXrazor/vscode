/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef } from 'react';

export function PaneResizeHandle({ side, width, minimum, onCommit }: {
	side: 'library' | 'inspector' | 'workspace-code';
	width: number;
	minimum: number;
	onCommit: (width: number) => void;
}) {
	const drag = useRef<{ start: number; width: number; next: number } | undefined>(undefined);
	const sign = side === 'inspector' ? -1 : 1;
	const cssProperty = side === 'library' ? '--library-width' : side === 'workspace-code' ? '--workspace-code-width' : '--inspector-width';
	function clamp(value: number) {
		return Math.max(minimum, Math.min(innerWidth * 0.6, value));
	}
	return <div className={'pane-resize-handle resize-' + side} role="separator" aria-orientation="vertical"
		aria-label={side === 'library' ? 'Resize resource library' : side === 'workspace-code' ? 'Resize Terraform pane' : 'Resize resource inspector'}
		aria-valuenow={Math.round(width)} aria-valuemin={minimum} aria-valuemax={Math.round(Math.max(minimum, innerWidth * 0.6))}
		tabIndex={0}
		onKeyDown={event => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return; }
			event.preventDefault();
			onCommit(clamp(width + (event.key === 'ArrowRight' ? 16 : -16) * sign));
		}}
		onPointerDown={event => {
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			drag.current = { start: event.clientX, width, next: width };
		}}
		onPointerMove={event => {
			const current = drag.current;
			if (!current) { return; }
			current.next = clamp(current.width + (event.clientX - current.start) * sign);
			const studio = event.currentTarget.closest<HTMLElement>(side === 'workspace-code' ? '.resource-workspace' : '.studio');
			studio?.style.setProperty(cssProperty, current.next + 'px');
		}}
		onPointerUp={event => {
			const current = drag.current;
			if (!current) { return; }
			drag.current = undefined;
			onCommit(current.next);
			event.currentTarget.releasePointerCapture(event.pointerId);
		}}
		onPointerCancel={() => {
			if (drag.current) { onCommit(drag.current.next); drag.current = undefined; }
		}}
	/>;
}
