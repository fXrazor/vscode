/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Dispatch } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { Action, BoardItem } from './model.ts';

/** Selection-only appearance controls; no separate copy of the selected item. */
export function ShapeAppearance({ item, dispatch }: { item: BoardItem; dispatch: Dispatch<Action> }) {
	const update = (patch: Partial<Pick<BoardItem, 'strokeColor' | 'strokeWidth' | 'strokeStyle'>>) => dispatch({ type: 'updateItem', id: item.id, patch });
	return <details className="shape-appearance" onKeyDown={event => {
		if (event.key === 'Escape') {
			event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
			event.currentTarget.querySelector('summary')?.focus();
		}
	}}>
		<summary aria-label="Shape border appearance"><SlidersHorizontal size={15} /></summary>
		<div className="shape-appearance-content">
			<strong>Border</strong>
			<label>Colour<input type="color" aria-label="Shape border colour" value={item.strokeColor ?? '#7565bd'} onChange={event => update({ strokeColor: event.target.value })} /></label>
			<label>Weight<select aria-label="Shape border weight" value={item.strokeWidth ?? 1.5} onChange={event => update({ strokeWidth: Number(event.target.value) })}>{[1, 1.5, 2, 3, 4, 6].map(width => <option key={width} value={width}>{width} px</option>)}</select></label>
			<label>Style<select aria-label="Shape border style" value={item.strokeStyle ?? 'solid'} onChange={event => update({ strokeStyle: event.target.value as BoardItem['strokeStyle'] })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
		</div>
	</details>;
}
