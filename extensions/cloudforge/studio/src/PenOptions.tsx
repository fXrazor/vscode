/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ChevronRight } from 'lucide-react';
import { ContextPopover } from './ContextPopover.tsx';
import { normaliseInkStyle, type InkStyle } from './ink.ts';

/** Contextual pen presets affect the next stroke, never existing architecture/history. */
export function PenOptions({ ink, onChange, container }: { ink: InkStyle; onChange: (ink: InkStyle) => void; container: HTMLElement | null }) {
	return <div className="pen-options">
		<ContextPopover label="Pen options" icon={<ChevronRight size={16}/>} compact container={container} description="Choose the colour and weight of new freehand drawings.">
			<div className="element-appearance-grid">
				<label>Colour<input aria-label="New stroke colour" type="color" value={ink.strokeColor} onChange={event => onChange(normaliseInkStyle({ ...ink, strokeColor: event.target.value }))}/></label>
				<label>Weight<select aria-label="New stroke weight" value={ink.strokeWidth} onChange={event => onChange(normaliseInkStyle({ ...ink, strokeWidth: Number(event.target.value) }))}>{[1, 2, 3, 4, 5, 6, 7, 8].map(weight => <option key={weight} value={weight}>{weight} px</option>)}</select></label>
				<svg className="appearance-wide pen-preview" viewBox="0 0 260 36" aria-label={'Stroke preview, ' + ink.strokeWidth + ' pixels'} role="img"><path d="M12 24 Q55 0 95 18 T175 18 T248 12" fill="none" stroke={ink.strokeColor} strokeWidth={ink.strokeWidth} strokeLinecap="round"/></svg>
				<p className="appearance-wide field-help">Applies to new strokes. Existing drawings keep their colour and weight.</p>
			</div>
		</ContextPopover>
	</div>;
}
