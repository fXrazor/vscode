import type { Dispatch, ReactNode } from 'react';
import { ArrowRightLeft, MoveLeft, MoveRight, MoreHorizontal, Trash2, Type, X } from 'lucide-react';
import type { Action, DesignConnection } from './model.ts';

/** Miro-style single edit bar for a line: type, colour, style, weight, arrows, label, then less common options behind menus. */
export function ConnectionTools({ connection, dispatch, onClose, children }: { connection: DesignConnection; dispatch: Dispatch<Action>; onClose: () => void; children?: ReactNode }) {
	const update = (patch: Partial<DesignConnection>) => dispatch({ type: 'updateConnection', id: connection.id, patch });
	const service = !!connection.origin;
	return <section className="connection-tools line-bar nodrag nopan" role="toolbar" aria-label="Edit design connection" title={service ? 'Source graph connection · ' + connection.origin!.edgeKind + ' · appearance only' : 'Design connection · visual link, no Terraform dependency'}
		onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
		<LineStyleControls prefix="Connection" value={connection} onChange={update}/>
		<span className="line-bar-divider" aria-hidden="true"/>
		<button type="button" className="line-bar-icon" aria-label="Start arrow" aria-pressed={connection.startArrow ?? false} data-tip="Start arrow" onClick={() => update({ startArrow: !(connection.startArrow ?? false) })}><MoveLeft size={16}/></button>
		<button type="button" className="line-bar-icon" aria-label="End arrow" aria-pressed={connection.endArrow ?? true} data-tip="End arrow" onClick={() => update({ endArrow: !(connection.endArrow ?? true) })}><MoveRight size={16}/></button>
		<span className="line-bar-divider" aria-hidden="true"/>
		<label className="line-bar-label"><Type size={14} aria-hidden="true"/><input aria-label="Connection label" maxLength={200} value={connection.label ?? ''} placeholder="Add label" onChange={event => update({ label: event.target.value })}/></label>
		<details className="line-bar-menu connection-label-options"><summary aria-label="Label formatting" data-tip="Label formatting">Aa</summary><div className="line-bar-panel">
			<label>Size<select aria-label="Connection label size" value={connection.labelFontSize ?? 11} onChange={event => update({ labelFontSize: Number(event.target.value) })}>{[10, 11, 12, 14, 16, 20, 24, 32].map(size => <option key={size}>{size}</option>)}</select></label>
			<label>Position<select aria-label="Connection label position" value={connection.labelPosition ?? 'center'} onChange={event => update({ labelPosition: event.target.value as DesignConnection['labelPosition'] })}><option value="above">Above line</option><option value="center">On line</option><option value="below">Below line</option></select></label>
			<label>Text colour<input aria-label="Connection label colour" type="color" value={connection.labelColor ?? '#7565bd'} onChange={event => update({ labelColor: event.target.value })}/></label>
		</div></details>
		<span className="line-bar-divider" aria-hidden="true"/>
		{!service && <button type="button" className="line-bar-icon" aria-label="Reverse connection direction" data-tip="Reverse direction" onClick={() => dispatch({ type: 'reverseConnection', id: connection.id })}><ArrowRightLeft size={15}/></button>}
		{children && <details className="line-bar-menu connection-endpoint-fields"><summary aria-label="Endpoints" data-tip="Endpoints and ports"><MoreHorizontal size={16}/></summary><div className="line-bar-panel">{children}</div></details>}
		{!service && <button type="button" className="line-bar-icon line-bar-danger" aria-label="Delete design connection" data-tip="Delete (Del)" onClick={() => { dispatch({ type: 'deleteConnection', id: connection.id }); onClose(); }}><Trash2 size={15}/></button>}
		<button type="button" className="line-bar-icon" aria-label="Close connection tools" data-tip="Close (Esc)" onClick={onClose}><X size={15}/></button>
	</section>;
}

const paths: { value: NonNullable<DesignConnection['routing']>; label: string; d: string }[] = [
	{ value: 'straight', label: 'Straight', d: 'M3 15L17 5' },
	{ value: 'elbow', label: 'Elbow', d: 'M3 15H10V5H17' },
	{ value: 'curve', label: 'Curve', d: 'M3 15C10 15 10 5 17 5' },
];

const swatches = ['#7565bd', '#1f6feb', '#0f9d8a', '#2e7d32', '#e3a008', '#e8590c', '#d6336c', '#6b7285', '#1d2233'];

/** Path, colour, stroke style and weight: shared by design connections and dependency lines. */
export function LineStyleControls({ prefix, value, fallbackColour = '#7565bd', defaultPattern = 'solid', onChange }: {
	prefix: 'Connection' | 'Dependency'; value: Pick<DesignConnection, 'routing' | 'stroke' | 'pattern' | 'width'>; fallbackColour?: string; defaultPattern?: NonNullable<DesignConnection['pattern']>;
	onChange: (patch: Pick<DesignConnection, 'routing' | 'stroke' | 'pattern' | 'width'>) => void;
}) {
	const colour = value.stroke ?? fallbackColour;
	return <>
		<PathPicker label={prefix + ' path'} value={value.routing ?? 'elbow'} onChange={routing => onChange({ routing })}/>
		<span className="line-bar-divider" aria-hidden="true"/>
		<details className="line-bar-menu"><summary aria-label="Line colour" data-tip="Colour"><span className="line-bar-swatch" style={{ background: colour }}/></summary><div className="line-bar-panel line-bar-swatches">
			{swatches.map(swatch => <button key={swatch} type="button" aria-label={'Colour ' + swatch} aria-pressed={colour.toLowerCase() === swatch} style={{ background: swatch }} onClick={() => onChange({ stroke: swatch })}/>)}
			<label className="line-bar-custom" title="Custom colour"><input aria-label={prefix + ' colour'} type="color" value={colour} onChange={event => onChange({ stroke: event.target.value })}/></label>
		</div></details>
		<select className="line-bar-select" aria-label={prefix + ' stroke style'} title="Line style" value={value.pattern ?? defaultPattern} onChange={event => onChange({ pattern: event.target.value as DesignConnection['pattern'] })}><option value="solid">━ Solid</option><option value="dashed">╍ Dashed</option><option value="dotted">┄ Dotted</option></select>
		<select className="line-bar-select" aria-label={prefix + ' weight'} title="Thickness" value={value.width ?? 1.5} onChange={event => onChange({ width: Number(event.target.value) })}>{[1, 1.5, 2, 3, 4, 6, 8].map(width => <option key={width} value={width}>{width} px</option>)}</select>
	</>;
}

/** Line type as three drawn choices (Miro's Type control), not a text dropdown. */
export function PathPicker({ label, value, onChange }: { label: string; value: NonNullable<DesignConnection['routing']>; onChange: (routing: NonNullable<DesignConnection['routing']>) => void }) {
	return <div className="path-picker" role="radiogroup" aria-label={label}>
		{paths.map(path => <button key={path.value} type="button" role="radio" aria-checked={value === path.value} aria-label={path.label} title={path.label} onClick={() => onChange(path.value)}>
			<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d={path.d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
		</button>)}
	</div>;
}
