/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Action, Architecture, Finding, Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { ResourceFields } from './ResourceFields.tsx';

export function ResourceWorkspace({ resource, architecture, findings, dispatch, onClose, onCheck }: {
	resource: Resource;
	architecture: Architecture;
	findings: Finding[] | undefined;
	dispatch: Dispatch<Action>;
	onClose: () => void;
	onCheck: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [resultTab, setResultTab] = useState<'findings' | 'draft'>('findings');
	useEffect(() => { dialog.current?.showModal(); }, []);
	const metadata = resourceDefinition(resource);
	const upstream = architecture.connections
		.filter(connection => connection.target === resource.id)
		.map(connection => architecture.resources.find(item => item.id === connection.source))
		.filter(item => item !== undefined);
	const resourceFindings = findings?.filter(finding => finding.resourceId === resource.id);
	return (
		<dialog ref={dialog} className="resource-workspace" onCancel={onClose} aria-labelledby="resource-workspace-title">
			<header className="workspace-header">
				<button onClick={onClose} className="quiet-button">← Back to Canvas</button>
				<span>Resource workspace</span>
				<span className="sample-label">Sample architecture</span>
			</header>
			<div className="workspace-columns">
				<aside className="workspace-inputs">
					<h2>Inputs</h2>
					<p className="muted">Connected resources</p>
					{upstream.length === 0 && <p>This resource has no incoming design links.</p>}
					{upstream.map(input => (
						<div className="input-resource" key={input.id}>
							<img src={'./assets/' + resourceDefinition(input).icon} alt="" />
							<div><strong>{input.name}</strong><small>{resourceDefinition(input).label}</small></div>
						</div>
					))}
					<div className="context-note"><h3>About this resource</h3><p>{metadata.description}</p><p>Connections in this preview describe design relationships.</p></div>
				</aside>
				<section className="workspace-parameters">
					<div className="workspace-resource-title">
						<img src={'./assets/' + metadata.icon} alt="" />
						<div><h2 id="resource-workspace-title">{metadata.label}</h2><span className="mono">{metadata.type}</span></div>
					</div>
					<div className="section-title"><h3>Parameters</h3><span>Shared draft</span></div>
					<ResourceFields resource={resource} dispatch={dispatch} />
					<p className="field-help">Changes appear in both design modes. This draft stays in the current browser tab.</p>
					<button className="primary-button" onClick={onCheck}>Check Draft Names</button>
				</section>
				<aside className="workspace-results">
					<h2>Results</h2>
					<div className="tab-bar" role="tablist" aria-label="Resource results">
						<button role="tab" aria-selected={resultTab === 'findings'} onClick={() => setResultTab('findings')}>Findings</button>
						<button role="tab" aria-selected={resultTab === 'draft'} onClick={() => setResultTab('draft')}>Draft Data</button>
					</div>
					{resultTab === 'draft' ? (
						<pre className="draft-data">{JSON.stringify({ name: resource.name, region: resource.region, settings: resource.settings }, null, 2)}</pre>
					) : (
						<div className="finding-content">
							{resourceFindings === undefined && <><h3>Ready for a local check</h3><p>Check resource names for missing or duplicate entries.</p></>}
							{resourceFindings?.length === 0 && <><h3 className="success-text">Name check passed</h3><p>This resource has a non-empty, unique draft name.</p></>}
							{resourceFindings?.map(finding => <p className="finding" key={finding.message}>{finding.message}</p>)}
							<p className="muted">Provider validation, deployment outputs and cloud operations require service integration.</p>
						</div>
					)}
				</aside>
			</div>
		</dialog>
	);
}
