import type { Dispatch } from 'react';
import { ExternalLink, RotateCcw, X } from 'lucide-react';
import type { Action, Architecture, DependencyStyle, DesignConnection } from './model.ts';

/** The style a derived dependency line is drawn with: its own override over the '*' default. */
export function dependencyStyle(architecture: Architecture, id: string): DependencyStyle {
	return { ...architecture.dependencyStyles?.['*'], ...architecture.dependencyStyles?.[id] };
}

const paths: { value: NonNullable<DesignConnection['routing']>; label: string; d: string }[] = [
	{ value: 'straight', label: 'Straight', d: 'M3 15L17 5' },
	{ value: 'elbow', label: 'Elbow', d: 'M3 15H10V5H17' },
	{ value: 'curve', label: 'Curve', d: 'M3 15C10 15 10 5 17 5' },
];

/** Appearance-only tools for an inherited dependency line. The reference itself lives in Terraform. */
export function DependencyTools({ architecture, dependency, at, dispatch, onOpen, onClose }: {
	architecture: Architecture; dependency: { id: string; source: string; target: string; fields: string[] }; at: { left: number; top: number };
	dispatch: Dispatch<Action>; onOpen: (id: string) => void; onClose: () => void;
}) {
	const style = dependencyStyle(architecture, dependency.id);
	const own = !!architecture.dependencyStyles?.[dependency.id];
	const all = !!architecture.dependencyStyles?.['*'];
	const update = (patch: DependencyStyle, key = dependency.id) => dispatch({ type: 'styleDependency', key, patch });
	const name = (id: string) => architecture.resources.find(resource => resource.id === id)?.name ?? id;
	return <section className="connection-tools dependency-tools nodrag nopan" style={{ left: at.left, top: at.top }} aria-label="Edit dependency line" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
		<header><strong>Dependency line</strong><span>{name(dependency.source)} → {name(dependency.target)} · {dependency.fields.join(', ')} · appearance only</span><button aria-label="Close dependency tools" onClick={onClose}><X size={14}/></button></header>
		<div className="connection-tool-fields">
			<PathPicker label="Dependency path" value={style.routing ?? 'elbow'} onChange={routing => update({ routing })}/>
			<label>Style<select aria-label="Dependency stroke style" value={style.pattern ?? 'dotted'} onChange={event => update({ pattern: event.target.value as DesignConnection['pattern'] })}><option>solid</option><option>dashed</option><option>dotted</option></select></label>
			<label>Weight<select aria-label="Dependency weight" value={style.width ?? 1.5} onChange={event => update({ width: Number(event.target.value) })}>{[1, 1.5, 2, 3, 4, 6, 8].map(width => <option key={width}>{width}</option>)}</select></label>
			<label>Colour<input aria-label="Dependency colour" type="color" value={style.stroke ?? '#8a8fa3'} onChange={event => update({ stroke: event.target.value })}/></label>
		</div>
		<footer className="dependency-tools-actions">
			<button onClick={() => { update(style, '*'); if (own) { dispatch({ type: 'styleDependency', key: dependency.id, patch: null }); } }} title="Use this look for every dependency line">Apply to all lines</button>
			{(own || all) && <button onClick={() => { dispatch({ type: 'styleDependency', key: dependency.id, patch: null }); if (!own) { dispatch({ type: 'styleDependency', key: '*', patch: null }); } }} title={own ? 'Reset this line to the shared look' : 'Reset all dependency lines to the default look'}><RotateCcw size={13}/>{own ? 'Reset line' : 'Reset all'}</button>}
			<button onClick={() => onOpen(dependency.target)} title="Open the resource that holds the reference (Enter)"><ExternalLink size={13}/>Open {name(dependency.target)}</button>
		</footer>
		<p className="field-help">Drawn from a Terraform reference. Changing its look never changes the code.</p>
	</section>;
}

/** Line type as three drawn choices (Miro's Type control), not a text dropdown. */
export function PathPicker({ label, value, onChange }: { label: string; value: NonNullable<DesignConnection['routing']>; onChange: (routing: NonNullable<DesignConnection['routing']>) => void }) {
	return <div className="path-picker" role="radiogroup" aria-label={label}>
		{paths.map(path => <button key={path.value} type="button" role="radio" aria-checked={value === path.value} aria-label={path.label} title={path.label} onClick={() => onChange(path.value)}>
			<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d={path.d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
		</button>)}
	</div>;
}
