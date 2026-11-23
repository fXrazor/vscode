import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useViewport } from '@xyflow/react';
import type { BoardItem, DesignMode } from './model.ts';

/** Keep editing tools inside the canvas safe area as panels and zoom change. */
export function CanvasEditbar({ item, mode, children }: { item: BoardItem; mode: DesignMode; children: ReactNode }) {
	const element = useRef<HTMLDivElement>(null);
	const { x, y, zoom } = useViewport();
	useLayoutEffect(() => {
		const toolbar = element.current; const canvas = toolbar?.closest('.canvas');
		if (!toolbar || !canvas) { return; }
		const constrain = () => {
			const bounds = canvas.getBoundingClientRect();
			toolbar.style.maxWidth = Math.max(180, bounds.width - 24) + 'px';
			toolbar.style.transform = '';
			const rect = toolbar.getBoundingClientRect();
			const left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - rect.width - 8));
			const top = Math.max(bounds.top + 8, Math.min(rect.top, bounds.bottom - rect.height - 8));
			toolbar.style.transform = `translate(${left - rect.left}px, ${top - rect.top}px)`;
		};
		constrain(); const observer = new ResizeObserver(constrain); observer.observe(canvas); observer.observe(toolbar);
		return () => observer.disconnect();
	}, [item, mode, x, y, zoom]);
	return <div ref={element} className="selection-editbar nodrag nopan" role="toolbar" aria-label="Edit canvas element" style={{ flexWrap: 'wrap' }}>{children}</div>;
}
