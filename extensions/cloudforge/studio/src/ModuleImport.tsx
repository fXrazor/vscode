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
	const [sourceKind, setSourceKind] = useState<ModuleReference['sourceKind']>('Registry');
	const [name, setName] = useState('');
	const [source, setSource] = useState('');
	const [version, setVersion] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		dialog.current?.showModal();
		return () => {
			if (previous?.isConnected) { previous.focus(); }
		};
	}, []);
	function importReference() {
		if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) || !source.trim()) {
			setError('Enter a module name starting with a letter or underscore and a source reference.');
			return;
		}
		onImport({ name, source: source.trim(), version, sourceKind });
	}
	return <dialog ref={dialog} className="module-import" onCancel={onClose} aria-labelledby="module-title">
		<header className="section-title"><h2 id="module-title">Import Terraform Module Reference</h2><button aria-label="Close module import" onClick={onClose}>✕</button></header>
		<div className="module-form">
			<label>Module name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
			<div className="tab-bar" role="group" aria-label="Module source type">
				{(['Registry', 'Git', 'Local'] as const).map(kind => <button key={kind} aria-pressed={kind === sourceKind} onClick={() => setSourceKind(kind)}>{kind}</button>)}
			</div>
			<label>{sourceKind === 'Registry' ? 'Registry source address' : sourceKind === 'Git' ? 'Git source URL' : 'Local module reference'}
				<input value={source} onChange={event => setSource(event.target.value)} placeholder={sourceKind === 'Registry' ? 'namespace/module/provider' : sourceKind === 'Git' ? 'git::https://…' : './modules/network'} />
			</label>
			{sourceKind === 'Registry' && <label>Version constraint<input value={version} onChange={event => setVersion(event.target.value)} placeholder="Optional" /></label>}
			<p className="muted">This preview adds a module reference to the shared draft. Fetching source files and inspecting module inputs require service integration.</p>
			{error && <p role="alert" className="finding">{error}</p>}
			<button className="primary-button" onClick={importReference}>Add Module Reference</button>
		</div>
	</dialog>;
}
