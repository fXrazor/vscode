/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useViewport } from '@xyflow/react';
import type { GuideLine } from './alignmentGuides.ts';

/** SVG overlays share the viewport transform, with constant screen-pixel strokes. */
export function AlignmentGuides({ lines }: { lines: GuideLine[] }) {
	const viewport = useViewport();
	return <svg className="alignment-guides" aria-hidden="true"><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>{lines.map((line, index) => <line key={index} {...line} vectorEffect="non-scaling-stroke"/>)}</g></svg>;
}
