import type { Dispatch } from 'react';
import { ArrowRightLeft, Trash2, X } from 'lucide-react';
import type { Action, DesignConnection } from './model.ts';

export function ConnectionTools({ connection, dispatch, onClose }: { connection: DesignConnection; dispatch: Dispatch<Action>; onClose: () => void }) {
	const update = (patch: Partial<DesignConnection>) => dispatch({ type: 'updateConnection', id: connection.id, patch });
	return <section className="connection-tools nodrag nopan" aria-label="Edit design connection" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
		<header><strong>Design connection</strong><span>Visual link · no Terraform dependency</span><button aria-label="Close connection tools" onClick={onClose}><X size={14}/></button></header>
		<div className="connection-tool-fields">
			<label>Label<input aria-label="Connection label" maxLength={200} value={connection.label ?? ''} placeholder="Describe this connection" onChange={event => update({ label: event.target.value })}/></label>
			<label>Path<select aria-label="Connection path" value={connection.routing ?? 'elbow'} onChange={event => update({ routing: event.target.value as DesignConnection['routing'] })}><option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curve">Curve</option></select></label>
			<label>Style<select aria-label="Connection stroke style" value={connection.pattern ?? 'solid'} onChange={event => update({ pattern: event.target.value as DesignConnection['pattern'] })}><option>solid</option><option>dashed</option><option>dotted</option></select></label>
			<label>Weight<select aria-label="Connection weight" value={connection.width ?? 1.5} onChange={event => update({ width: Number(event.target.value) })}>{[1,1.5,2,3,4,6,8].map(width => <option key={width}>{width}</option>)}</select></label>
			<label>Colour<input aria-label="Connection colour" type="color" value={connection.stroke ?? '#7565bd'} onChange={event => update({ stroke: event.target.value })}/></label>
			<label className="connection-checkbox"><input type="checkbox" checked={connection.startArrow ?? false} onChange={event => update({ startArrow: event.target.checked })}/>Start arrow</label>
			<label className="connection-checkbox"><input type="checkbox" checked={connection.endArrow ?? true} onChange={event => update({ endArrow: event.target.checked })}/>End arrow</label>
			<details className="connection-label-options"><summary>Label formatting</summary><div>
				<label>Size<select aria-label="Connection label size" value={connection.labelFontSize ?? 11} onChange={event => update({ labelFontSize: Number(event.target.value) })}>{[10,11,12,14,16,20,24,32].map(size => <option key={size}>{size}</option>)}</select></label>
				<label>Position<select aria-label="Connection label position" value={connection.labelPosition ?? 'center'} onChange={event => update({ labelPosition: event.target.value as DesignConnection['labelPosition'] })}><option value="above">Above line</option><option value="center">On line</option><option value="below">Below line</option></select></label>
				<label>Text colour<input aria-label="Connection label colour" type="color" value={connection.labelColor ?? '#7565bd'} onChange={event => update({ labelColor: event.target.value })}/></label>
			</div></details>
			<button aria-label="Reverse connection direction" title="Reverse connection direction" onClick={() => dispatch({ type: 'reverseConnection', id: connection.id })}><ArrowRightLeft size={15}/></button>
			<button aria-label="Delete design connection" onClick={() => { dispatch({ type: 'deleteConnection', id: connection.id }); onClose(); }}><Trash2 size={15}/></button>
		</div>
	</section>;
}
