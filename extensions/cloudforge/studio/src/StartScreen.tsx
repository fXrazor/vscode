/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { FolderOpen, FolderPlus, LayoutGrid, Plus, Workflow } from 'lucide-react';
import type { HostStartAction, HostStartContext } from './webviewBridge.ts';

/**
 * Shown over the canvas inside CloudForge when no architecture is open, so a fresh window starts
 * from a project and a blank architecture instead of the built-in sample.
 */
export function StartScreen({ context, onAction }: { context: HostStartContext; onAction: (action: HostStartAction, architectureId?: string) => void }) {
	const architectures = Array.isArray(context.architectures) ? context.architectures.slice(0, 8) : [];
	if (!context.projectOpen) {
		return <section className="start-screen" aria-labelledby="start-screen-title">
			<div className="start-card">
				<h2 id="start-screen-title">Start designing your infrastructure</h2>
				<p>CloudForge keeps each design in a project folder, next to the Terraform files it writes.</p>
				<div className="start-actions">
					<button className="primary-button" onClick={() => onAction('createProject')}><FolderPlus size={16} />New project</button>
					<button onClick={() => onAction('openProject')}><FolderOpen size={16} />Open project folder</button>
				</div>
				<p className="start-hint">A new project opens straight onto a blank canvas.</p>
			</div>
		</section>;
	}
	return <section className="start-screen" aria-labelledby="start-screen-title">
		<div className="start-card">
			<h2 id="start-screen-title">{context.projectName ? context.projectName : 'Your project'}</h2>
			<p>{architectures.length ? 'Open an architecture, or start a new blank one.' : 'This project has no architectures yet. Start with a blank canvas.'}</p>
			<div className="start-actions">
				<button className="primary-button" onClick={() => onAction('createArchitecture')}><Plus size={16} />New blank architecture</button>
			</div>
			{architectures.length > 0 && <ul className="start-architectures" aria-label="Architectures in this project">
				{architectures.map(item => <li key={item.architectureId}>
					<button onClick={() => onAction('openArchitecture', item.architectureId)}><Workflow size={15} /><span>{item.name}</span></button>
				</li>)}
			</ul>}
			{context.moreArchitectures > 0 && <button className="start-more" onClick={() => onAction('switchArchitecture')}><LayoutGrid size={15} />All architectures ({architectures.length + context.moreArchitectures})</button>}
			<p className="start-hint">Once it opens, drag resources from the library on the left, or pick a template there. Saving writes the .tf files.</p>
		</div>
	</section>;
}
