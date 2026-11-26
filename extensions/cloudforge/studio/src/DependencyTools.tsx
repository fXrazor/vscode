import type { Dispatch } from 'react';
import { ExternalLink, RotateCcw, X } from 'lucide-react';
import type { Action, Architecture, DependencyStyle } from './model.ts';
import { LineStyleControls } from './ConnectionTools.tsx';

/** The style a derived dependency line is drawn with: its own override over the '*' default. */
export function dependencyStyle(architecture: Architecture, id: string): DependencyStyle {
	return { ...architecture.dependencyStyles?.['*'], ...architecture.dependencyStyles?.[id] };
}


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
	return <section className="connection-tools line-bar dependency-tools nodrag nopan" role="toolbar" style={{ left: at.left, top: at.top }} aria-label="Edit dependency line"
		title={'Dependency ' + name(dependency.source) + ' → ' + name(dependency.target) + ' (' + dependency.fields.join(', ') + '). Drawn from a Terraform reference; its look never changes the code.'}
		onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
		<span className="line-bar-caption" title={dependency.fields.join(', ')}>{name(dependency.source)} → {name(dependency.target)}</span>
		<span className="line-bar-divider" aria-hidden="true"/>
		<LineStyleControls prefix="Dependency" value={style} fallbackColour="#8a8fa3" defaultPattern="dotted" onChange={patch => update(patch)}/>
		<span className="line-bar-divider" aria-hidden="true"/>
		<button type="button" className="line-bar-text" onClick={() => { update(style, '*'); if (own) { dispatch({ type: 'styleDependency', key: dependency.id, patch: null }); } }} data-tip="Use this look for every dependency line">Apply to all</button>
		{(own || all) && <button type="button" className="line-bar-icon" aria-label={own ? 'Reset line' : 'Reset all'} data-tip={own ? 'Reset this line to the shared look' : 'Reset all dependency lines'} onClick={() => { dispatch({ type: 'styleDependency', key: dependency.id, patch: null }); if (!own) { dispatch({ type: 'styleDependency', key: '*', patch: null }); } }}><RotateCcw size={14}/></button>}
		<button type="button" className="line-bar-icon" aria-label={'Open ' + name(dependency.target)} data-tip={'Open ' + name(dependency.target) + ' (Enter)'} onClick={() => onOpen(dependency.target)}><ExternalLink size={14}/></button>
		<button type="button" className="line-bar-icon" aria-label="Close dependency tools" data-tip="Close (Esc)" onClick={onClose}><X size={15}/></button>
	</section>;
}

