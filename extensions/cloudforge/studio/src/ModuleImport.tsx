/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useRef, useState } from 'react';

export interface ModuleReference {
	name: string;
	source: string;
	version: string;
	sourceKind: 'Registry' | 'Git' | 'Local';
}

export function ModuleImport({ onClose, onImport }: { onClose: () => void; onImport: (reference: ModuleReference) => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const backdropPress = useRef(false);
	const [sourceKind, setSourceKind] = useState<ModuleReference['sourceKind']>('Registry');
	const [name, setName] = useState('');
	const [source, setSource] = useState('');
	const [version, setVersion] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		const element = dialog.current;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		backdropPress.current = false;
		if (element && !element.open) {
			element.showModal();
		}
		return () => {
			if (element?.open) {
				element.close();
			}
			if (previous?.isConnected) { previous.focus(); }
		};
	}, []);
	function outsideDialog(x: number, y: number) {
		const bounds = dialog.current?.getBoundingClientRect();
		return !!bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);
	}
	function importReference() {
		if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) || !source.trim()) {
			setError('Enter a module name starting with a letter or underscore and a source reference.');
			return;
		}
		onImport({ name, source: source.trim(), version, sourceKind });
	}
	return <dialog
		ref={dialog}
		className="module-import"
		onCancel={event => { event.preventDefault(); onClose(); }}
		onPointerDown={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY); }}
		onPointerUp={event => { const dismiss = backdropPress.current && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY); backdropPress.current = false; if (dismiss) { onClose(); } }}
		onPointerCancel={() => { backdropPress.current = false; }}
		aria-labelledby="module-title"
	>
		<header className="section-title"><h2 id="module-title">Import Terraform Module Reference</h2><button type="button" aria-label="Close module import" onClick={onClose}>✕</button></header>
		<form className="module-form" noValidate onSubmit={event => { event.preventDefault(); importReference(); }}>
			<label>Module name<input autoFocus value={name} onChange={event => { setName(event.target.value); setError(''); }} /></label>
			<div className="tab-bar" role="group" aria-label="Module source type">
				{(['Registry', 'Git', 'Local'] as const).map(kind => <button type="button" key={kind} aria-pressed={kind === sourceKind} onClick={() => setSourceKind(kind)}>{kind}</button>)}
			</div>
			<label>{sourceKind === 'Registry' ? 'Registry source address' : sourceKind === 'Git' ? 'Git source URL' : 'Local module reference'}
				<input value={source} onChange={event => { setSource(event.target.value); setError(''); }} placeholder={sourceKind === 'Registry' ? 'namespace/module/provider' : sourceKind === 'Git' ? 'git::https://…' : './modules/network'} />
			</label>
			{sourceKind === 'Registry' && <label>Version constraint<input value={version} onChange={event => setVersion(event.target.value)} placeholder="Optional" /></label>}
			<p className="muted">Adds a module reference to the architecture draft. Local child modules can be inspected from the resource inspector after saving.</p>
			{error && <p role="alert" className="finding">{error}</p>}
			<button type="submit" className="primary-button">Add Module Reference</button>
		</form>
	</dialog>;
}
