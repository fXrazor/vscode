import { useState, type Dispatch } from 'react';
import { X } from 'lucide-react';
import type { Action, Architecture } from './model.ts';
import { canConnect, connectableElements } from './designConnections.ts';

export function ConnectionCreate({ architecture, selectedId, dispatch, onClose }: { architecture: Architecture; selectedId: string; dispatch: Dispatch<Action>; onClose: () => void }) {
	const elements = connectableElements(architecture);
	const [source, setSource] = useState(elements.some(element => element.id === selectedId) ? selectedId : elements[0]?.id ?? '');
	const [target, setTarget] = useState('');
	const valid = canConnect(architecture, source, target);
	return <form className="connection-tools connection-create nodrag nopan" aria-label="Create design connection" onSubmit={event => { event.preventDefault(); if (valid) { dispatch({ type: 'connect', source, target }); onClose(); } }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
		<header><strong>Connect elements</strong><button type="button" aria-label="Close connection creation" onClick={onClose}><X size={14}/></button></header>
		<div className="connection-tool-fields">
			<label>From<select autoFocus aria-label="Connection source" value={source} onChange={event => { setSource(event.target.value); setTarget(''); }}>{elements.map(element => <option key={element.id} value={element.id}>{element.label} ({element.kind})</option>)}</select></label>
			<label>To<select aria-label="Connection target" value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose an element…</option>{elements.filter(element => element.id !== source).map(element => <option key={element.id} value={element.id} disabled={!canConnect(architecture, source, element.id)}>{element.label} ({element.kind})</option>)}</select></label>
			<button type="submit" disabled={!valid}>Add connection</button>
		</div>
		<p className="field-help">Visual link only. Choose a source and destination; existing links are unavailable.</p>
	</form>;
}
