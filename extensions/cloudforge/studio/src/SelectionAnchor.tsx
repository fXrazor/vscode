/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';

/** React Flow follows the selected bounds; only collision correction reads the DOM. */
export function SelectionAnchor({ ids, canvas, children }: { ids: string[]; canvas: RefObject<HTMLElement | null>; children: ReactNode }) {
	const content = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const element = content.current; const parent = element?.parentElement; const surface = canvas.current;
		if (!element || !parent || !surface) { return; }
		let frame = 0;
		const measure = () => {
			const area = surface.getBoundingClientRect(); const box = parent.getBoundingClientRect();
			element.style.setProperty('--selection-max-width', Math.max(120, area.width - 76) + 'px');
			const x = Math.max(area.left + 64 - box.left, Math.min(0, area.right - 12 - box.right));
			let y = 0;
			if (box.top < area.top + 12) {
				const bottoms = ids.map(id => surface.querySelector<HTMLElement>('[data-id="' + CSS.escape(id) + '"].react-flow__node')?.getBoundingClientRect().bottom ?? area.top);
				const below = Math.max(...bottoms) + 14;
				y = (below + box.height < area.bottom - 12 ? below : area.top + 12) - box.top;
			} else if (box.bottom > area.bottom - 12) { y = area.bottom - 12 - box.bottom; }
			element.style.translate = x + 'px ' + y + 'px';
		};
		const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
		const resize = new ResizeObserver(schedule); resize.observe(parent); resize.observe(surface);
		const movement = new MutationObserver(schedule); movement.observe(parent, {attributes:true,attributeFilter:['style']});
		measure();
		return () => { cancelAnimationFrame(frame); resize.disconnect(); movement.disconnect(); };
	}, [ids, canvas]);
	return <NodeToolbar nodeId={ids} isVisible={!!ids.length} position={Position.Top} offset={14} className="selection-anchor"><div ref={content} className="selection-anchor-content">{children}</div></NodeToolbar>;
}
