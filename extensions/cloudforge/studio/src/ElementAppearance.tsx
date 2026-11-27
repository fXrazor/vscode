/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Dispatch } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';
import type { Action, BoardItem } from './model.ts';
import type { TextAppearance } from './canvasOperations.ts';
import { shapeDefinitions, type ShapeId } from './shapes.ts';
import { inkDefaults } from './ink.ts';

const fillSwatches = [
	{ hex: '#fff0b5', label: 'Butter yellow' },
	{ hex: '#d3f9d8', label: 'Mint green' },
	{ hex: '#d0ebff', label: 'Sky blue' },
	{ hex: '#e5dbff', label: 'Lavender' },
	{ hex: '#ffe3c4', label: 'Peach' },
	{ hex: '#ffd6e7', label: 'Coral pink' },
	{ hex: '#f3ead8', label: 'Warm sand' },
	{ hex: '#ffffff', label: 'White' },
] as const;

export function ElementAppearance({ item, ids, dispatch }: { item: BoardItem; ids: string[]; dispatch: Dispatch<Action> }) {
	const style = (patch: Partial<TextAppearance>) => dispatch({ type:'canvas',command:{kind:'style',ids,patch} });
	const single = ids.length === 1;
	const dimensions = single && (['width', 'height'] as const).map(dimension => {
		const minimum = item.kind === 'ink' ? 16 : dimension === 'width' ? 140 : 80;
		return <label key={dimension}>{dimension === 'width' ? 'Width' : 'Height'}<input aria-label={'Element ' + dimension} type="number" min={minimum} max={4000} value={Math.round(item[dimension])} onChange={event => {
			const value = Number(event.target.value);
			if (Number.isFinite(value) && value >= minimum && value <= 4000) { dispatch({ type: 'updateItem', id: item.id, patch: { [dimension]: value } }); }
		}}/></label>;
	});
	const rotation = item.kind !== 'frame' && <label>Rotation<input aria-label="Element rotation in degrees" type="number" min={-360} max={360} step={15} value={Math.round(item.rotation ?? 0)} onChange={event => {
		const value = Number(event.target.value);
		if (Number.isFinite(value)) { dispatch({ type: 'canvas', command: { kind: 'rotate', ids, angle: value } }); }
	}}/></label>;
	const resizeHelp = single && !!item.rotation && <p className="appearance-wide field-help">Use Width and Height to resize this rotated drawing, or set Rotation to 0° to use canvas handles.</p>;
	if (item.kind === 'ink') {
		return <div className="element-appearance-grid">
			<label>Pen colour<input aria-label="Pen colour" type="color" value={item.strokeColor ?? inkDefaults.strokeColor} onChange={event=>style({strokeColor:event.target.value})}/></label>
			<label>Pen weight<select aria-label="Pen weight" value={item.strokeWidth ?? inkDefaults.strokeWidth} onChange={event=>style({strokeWidth:Number(event.target.value)})}>{[1,2,3,4,6,8].map(width=><option key={width}>{width}</option>)}</select></label>
			<label>Line style<select aria-label="Pen line style" value={item.strokeStyle??'solid'} onChange={event=>style({strokeStyle:event.target.value as BoardItem['strokeStyle']})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
			{rotation}{dimensions}{resizeHelp}
		<label>Opacity<select aria-label="Element opacity" value={item.opacity??1} onChange={event=>style({opacity:Number(event.target.value)})}>{[1,.75,.5,.25].map(value=><option key={value} value={value}>{value*100}%</option>)}</select></label>
			{!single && <p className="appearance-wide field-help">Applies to all selected drawings. Controls show the first drawing’s values.</p>}
		</div>;
	}
	const convertible = item.kind === 'note' || item.kind === 'shape' || item.kind === 'text';
	const switchValue = item.kind === 'shape' ? 'shape:' + (item.shape ?? 'rectangle') : item.kind;
	const activeFill = (item.fill && item.fill !== 'transparent' ? item.fill : item.kind === 'note' ? '#fff0b5' : '#eef2ff').toLowerCase();
	return <div className="element-appearance-grid">
		{single && <label className="appearance-wide">Text<textarea aria-label="Element text" rows={2} value={item.text} onChange={event=>dispatch({type:'updateItem',id:item.id,patch:{text:event.target.value}})}/></label>}
		{convertible && <label className="appearance-wide">Switch type<select aria-label="Switch element type" value={switchValue} onChange={event => {
			const value = event.target.value;
			if (value.startsWith('shape:')) { dispatch({ type: 'canvas', command: { kind: 'convertItem', ids, targetKind: 'shape', shape: value.slice(6) as ShapeId } }); }
			else if (value === 'note' || value === 'text') { dispatch({ type: 'canvas', command: { kind: 'convertItem', ids, targetKind: value } }); }
		}}>
			<option value="note">Sticky note</option>
			<option value="text">Text box</option>
			{shapeDefinitions.map(shape => <option key={shape.id} value={'shape:' + shape.id}>Shape · {shape.label}</option>)}
		</select></label>}
		<div className="appearance-wide appearance-swatches" role="group" aria-label="Quick fill colours">
			{fillSwatches.map(swatch => <button key={swatch.hex} type="button" className="appearance-swatch" aria-label={'Fill ' + swatch.label} aria-pressed={activeFill === swatch.hex} title={swatch.label} style={{ background: swatch.hex }} onClick={() => style({ fill: swatch.hex })} />)}
		</div>
		<label>Font<select aria-label="Element font family" value={item.fontFamily??'sans'} onChange={event=>style({fontFamily:event.target.value as BoardItem['fontFamily']})}><option value="sans">Mona Sans</option><option value="serif">Georgia</option><option value="mono">Monospace</option></select></label>
		<label>Size<select aria-label="Element font size" value={item.fontSize === undefined ? (item.kind === 'note' ? 'auto' : item.kind === 'text' ? 20 : item.kind === 'frame' ? 12 : 16) : item.fontSize} onChange={event => style({ fontSize: event.target.value === 'auto' ? undefined : Number(event.target.value) })}>
			{item.kind === 'note' && <option value="auto">Auto</option>}
			{[10,12,14,16,18,20,24,32,40,64,96,128].map(size=><option key={size} value={size}>{size}</option>)}
		</select></label>
		<div className="appearance-wide appearance-toggle-row" role="group" aria-label="Text style"><button aria-label="Bold element text" aria-pressed={!!item.bold} onClick={()=>style({bold:!item.bold})}><Bold size={16}/></button><button aria-label="Italic element text" aria-pressed={!!item.italic} onClick={()=>style({italic:!item.italic})}><Italic size={16}/></button><button aria-label="Underline element text" aria-pressed={!!item.underline} onClick={()=>style({underline:!item.underline})}><Underline size={16}/></button></div>
		<label>Text colour<input aria-label="Element text colour" type="color" value={item.textColor??'#203049'} onChange={event=>style({textColor:event.target.value})}/></label>
		<label>Text alignment<select aria-label="Element text alignment" value={item.textAlign??(item.kind==='shape'?'center':'left')} onChange={event=>style({textAlign:event.target.value as BoardItem['textAlign']})}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
		<label>Vertical alignment<select aria-label="Element vertical alignment" value={item.verticalAlign??(item.kind==='shape'?'middle':'top')} onChange={event=>style({verticalAlign:event.target.value as BoardItem['verticalAlign']})}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
		<label>Opacity<select aria-label="Element opacity" value={item.opacity??1} onChange={event=>style({opacity:Number(event.target.value)})}>{[1,.75,.5,.25].map(value=><option key={value} value={value}>{value*100}%</option>)}</select></label>
		<label>Fill<input aria-label="Element fill colour" type="color" value={item.fill&&item.fill!=='transparent'?item.fill:item.kind==='note'?'#fff0b5':'#eef2ff'} onChange={event=>style({fill:event.target.value})}/></label>
		<button aria-label="Transparent element fill" aria-pressed={item.fill==='transparent'} onClick={()=>style({fill:item.fill==='transparent'?'#eef2ff':'transparent'})}>No fill</button>
		{item.kind!=='text' && <><label>Border colour<input aria-label="Shape border colour" type="color" value={item.strokeColor??'#7565bd'} onChange={event=>style({strokeColor:event.target.value})}/></label><label>Border weight<select aria-label="Shape border weight" value={item.strokeWidth??1.5} onChange={event=>style({strokeWidth:Number(event.target.value)})}>{[1,1.5,2,3,4,6].map(width=><option key={width}>{width}</option>)}</select></label><label>Border style<select aria-label="Shape border style" value={item.strokeStyle??'solid'} onChange={event=>style({strokeStyle:event.target.value as BoardItem['strokeStyle']})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label></>}
		{rotation}{dimensions}{resizeHelp}
		{!single && <p className="appearance-wide field-help">Applies to all selected drawings. Controls show the first drawing’s values.</p>}
	</div>;
}
