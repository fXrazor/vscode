/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useViewport } from '@xyflow/react';
import type { GuideLine } from './alignmentGuides.ts';

/** SVG overlays share the viewport transform, with constant screen-pixel strokes. */
export function AlignmentGuides({ lines }: { lines: GuideLine[] }) {
	const viewport = useViewport();
	return <svg className="alignment-guides" aria-hidden="true"><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>{lines.map((line, index) => line.kind === 'spacing' ? <SpacingMarker key={index} line={line} zoom={viewport.zoom}/> : <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} vectorEffect="non-scaling-stroke"/>)}</g></svg>;
}

/** Equal gaps: a solid span with end caps, kept at a constant 8 screen-pixel cap height. */
function SpacingMarker({ line, zoom }: { line: GuideLine; zoom: number }) {
	const cap = 4 / Math.max(0.1, zoom); const horizontal = line.y1 === line.y2;
	const caps = horizontal
		? [[line.x1, line.y1 - cap, line.x1, line.y1 + cap], [line.x2, line.y2 - cap, line.x2, line.y2 + cap]]
		: [[line.x1 - cap, line.y1, line.x1 + cap, line.y1], [line.x2 - cap, line.y2, line.x2 + cap, line.y2]];
	return <g className="spacing-guide"><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} vectorEffect="non-scaling-stroke"/>{caps.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/>)}</g>;
}
