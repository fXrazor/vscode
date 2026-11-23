/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { shapeDefinitions, type ShapeId } from './shapes.ts';

export function ShapeLibrary({ onBack, onAdd }: { onBack: () => void; onAdd: (shape: ShapeId, label: string) => void }) {
	const [query, setQuery] = useState('');
	const search = useRef<HTMLInputElement>(null);
	const matches = shapeDefinitions.filter(shape => shape.label.toLowerCase().includes(query.trim().toLowerCase()));
	return <section className="shape-library" aria-label="Diagramming shapes" onKeyDown={event => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack(); }
	}}>
		<header className="shape-library-heading"><button aria-label="Back to resources" onClick={onBack}><ArrowLeft size={16} /></button><h2>Diagramming shapes</h2></header>
		<label className="lab-search"><Search size={14} /><input ref={search} autoFocus aria-label="Search shapes" placeholder="Search shapes" value={query} onChange={event => setQuery(event.target.value)} /></label>
		<div className="shape-library-body"><h3>Basic shapes</h3><div className="shape-grid">{matches.map(shape => <button key={shape.id} aria-label={'Add ' + shape.label.toLowerCase()} draggable onDragStart={event => event.dataTransfer.setData('application/x-cloudforge-shape', shape.id)} onClick={() => onAdd(shape.id, shape.label)}>
			<svg viewBox="0 0 100 100" aria-hidden="true"><path d={shape.path} /></svg><span>{shape.label}</span>
		</button>)}</div>{!matches.length && <p role="status">No shapes match “{query}”. <button onClick={() => { setQuery(''); search.current?.focus(); }}>Clear search</button></p>}</div>
		<p className="shape-library-hint">Drag to place · click to add</p>
	</section>;
}
