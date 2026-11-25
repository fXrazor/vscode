/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CircleCheck, TriangleAlert, CircleAlert, ChevronRight, ShieldCheck, Terminal, FileDiff } from 'lucide-react';
import type { Architecture } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { HostDependencyReport, HostEnginePlanReport, HostEngineValidateReport, HostExportAuditReport, HostValidationRun } from './webviewBridge.ts';

export interface IssuesHostContext {
	readonly isHosted: boolean;
	readonly hasWorkspace?: boolean;
	readonly sourceRevision?: string;
	readonly validationRun?: HostValidationRun | null;
	readonly engineReport?: HostEngineValidateReport | null;
	readonly enginePlanReport?: HostEnginePlanReport | null;
	readonly dependencyReport?: HostDependencyReport | null;
	readonly exportAuditReport?: HostExportAuditReport | null;
	readonly availableEngine?: 'openTofu' | 'terraform';
	readonly validating?: boolean;
	readonly planning?: boolean;
	readonly onRunValidation?: () => void;
	readonly onRunEngineValidate?: () => void;
	readonly onRunEnginePlan?: () => void;
}

const sourceBadgeLabel: Record<NonNullable<Diagnostic['source']>, string> = {
	cli: 'CLI validate',
	validation: 'Rust service',
	graph: 'Graph',
	local: 'Local',
};

/** The inspector owns the sole vertical scroll area; every issue opens its source field. */
export function IssuesPanel({architecture,findings,onReveal,host}:{architecture:Architecture;findings:Diagnostic[];onReveal:(finding:Diagnostic)=>void;host?:IssuesHostContext}) {
	const summary = host?.engineReport
		? (host.engineReport.engine === 'openTofu' ? 'OpenTofu ' : 'Terraform ') + host.engineReport.engineVersion + ' validate -json ' + (host.engineReport.valid ? 'passed' : 'reported findings') + ' (' + host.engineReport.durationMs + ' ms).'
		: host?.validationRun
			? 'Rust service validation ' + host.validationRun.outcome.replaceAll('_', ' ') + ' (' + host.validationRun.coverage + ' coverage).'
			: 'Checks use bundled resource metadata. Terraform and cloud provider validation have not run.';
	return <section className="issues-panel"><h2>{host?.isHosted ? 'Checks & validation' : 'Local checks'}</h2><p className="field-help">{summary}</p>
		{host?.isHosted && <div className="issues-host-actions">
			{host.onRunValidation && <button type="button" className="quiet-button" disabled={host.validating || host.planning || !host.hasWorkspace} title={host.hasWorkspace ? 'Run Rust service validation' : 'Open an architecture in CloudForge Project to validate'} onClick={host.onRunValidation}><ShieldCheck size={14} /><span>{host.validating ? 'Validating…' : 'Validate'}</span></button>}
			{host.availableEngine && host.onRunEngineValidate && <button type="button" className="quiet-button" disabled={host.validating || host.planning || !host.hasWorkspace} title={host.hasWorkspace ? 'Run CLI validate -json' : 'Open an architecture in CloudForge Project to validate'} onClick={host.onRunEngineValidate}><Terminal size={14} /><span>{host.availableEngine === 'openTofu' ? 'OpenTofu' : 'Terraform'} validate</span></button>}
			{host.availableEngine && host.onRunEnginePlan && <button type="button" className="quiet-button" disabled={host.validating || host.planning || !host.hasWorkspace} title={host.hasWorkspace ? 'Run strictly local, credential-free CLI plan (-refresh=false)' : 'Open an architecture in CloudForge Project to plan'} onClick={host.onRunEnginePlan}><FileDiff size={14} /><span>{host.planning ? 'Planning…' : (host.availableEngine === 'openTofu' ? 'OpenTofu' : 'Terraform') + ' plan'}</span></button>}
		</div>}
		{host?.isHosted && host.enginePlanReport && (
			<details className="workspace-readiness-card" open>
				<summary>
					{(host.enginePlanReport.engine === 'openTofu' ? 'OpenTofu ' : 'Terraform ') + host.enginePlanReport.engineVersion + ' plan'}
					<span>{host.enginePlanReport.status === 'planned' ? '+' + host.enginePlanReport.summary.create + ' ~' + host.enginePlanReport.summary.update + ' ±' + host.enginePlanReport.summary.replace + ' -' + host.enginePlanReport.summary.delete : 'Failed'}</span>
				</summary>
				<div className="workspace-readiness-body">
					<p className="field-help">
						{host.enginePlanReport.status === 'planned'
							? `Local credential-free plan (-refresh=false) finished in ${host.enginePlanReport.durationMs} ms (${host.enginePlanReport.summary.total} resource changes, ${host.enginePlanReport.outputChanges.length} output changes; literal values stripped).`
							: `Local CLI plan exited with diagnostics in ${host.enginePlanReport.durationMs} ms.`}
					</p>
					{host.enginePlanReport.resourceChanges.length > 0 && (
						<ul className="readiness-list">
							{host.enginePlanReport.resourceChanges.map(rc => (
								<li key={rc.address}>
									<code>{rc.address}</code>
									<span>{rc.actionKind}{rc.hasSensitiveAttributes ? ' · sensitive' : ''}{rc.changedAttributePaths.length > 0 ? ' · ' + rc.changedAttributePaths.slice(0, 4).join(', ') : ''}</span>
								</li>
							))}
						</ul>
					)}
					{host.enginePlanReport.outputChanges.length > 0 && (
						<ul className="readiness-list">
							{host.enginePlanReport.outputChanges.map(oc => (
								<li key={oc.name}>
									<code>output.{oc.name}</code>
									<span>{oc.actions.join('/')}{oc.sensitive ? ' · sensitive' : ''}</span>
								</li>
							))}
						</ul>
					)}
					{host.enginePlanReport.diagnostics.length > 0 && (
						<ul className="readiness-list">
							{host.enginePlanReport.diagnostics.map((diag, idx) => (
								<li key={idx}>
									<code>{diag.filename ? diag.filename + (diag.line ? ':' + diag.line : '') : diag.severity}</code>
									<span>{diag.summary}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</details>
		)}
		{host?.isHosted && (host.dependencyReport || host.exportAuditReport) && (
			<details className="workspace-readiness-card">
				<summary>Workspace readiness<span>{host.exportAuditReport ? (host.exportAuditReport.reproducible ? 'Reproducible' : 'Action needed') : host.dependencyReport?.lockState}</span></summary>
				<div className="workspace-readiness-body">
					{host.dependencyReport && (
						<div className="readiness-group">
							<p className="field-help">Engine: <code>{host.dependencyReport.engine}</code> · Lockfile: <code>{host.dependencyReport.lockState}</code></p>
							{host.dependencyReport.providers.length > 0 && (
								<ul className="readiness-list">
									{host.dependencyReport.providers.map(provider => (
										<li key={provider.display}>
											<code>{provider.display}</code>
											<span>{provider.lockedVersion ? 'v' + provider.lockedVersion : provider.status}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					)}
					{host.exportAuditReport && (
						<div className="readiness-group">
							<p className="field-help">Export audit: <strong>{host.exportAuditReport.reproducible ? 'Reproducible' : 'Not yet reproducible'}</strong> · {host.exportAuditReport.lockEntryCount} lock entries · {host.exportAuditReport.moduleCount} modules</p>
							{host.exportAuditReport.unresolvedReasonKinds.length > 0 && (
								<p className="field-help">Unresolved: {host.exportAuditReport.unresolvedReasonKinds.join(', ')}</p>
							)}
						</div>
					)}
				</div>
			</details>
		)}
		{!findings.length&&<p className="issues-clear"><CircleCheck size={16}/>{host?.engineReport?.valid ? 'CLI validation and local checks passed.' : 'No issues found by current checks.'}</p>}
		{(['error','warning'] as const).map(severity=>{const items=findings.filter(item=>item.severity===severity);return items.length?<div key={severity}><h3>{severity==='error'?'Errors':'Warnings'} <span>{items.length}</span></h3>{items.map(item=><button className={'issue-card '+severity} key={item.id} onClick={()=>onReveal(item)}>{severity==='error'?<CircleAlert size={15}/>:<TriangleAlert size={15}/>}<span><strong>{architecture.resources.find(resource=>resource.id===item.resourceId)?.name??'Architecture'}{item.source && item.source !== 'local' && <em className={'issue-source-tag source-' + item.source}>{sourceBadgeLabel[item.source]}</em>}</strong><span>{item.message}</span>{item.remediation && <small>{item.remediation}</small>}{item.path&&<code>{item.path}</code>}</span><ChevronRight size={14}/></button>)}</div>:null;})}
	</section>;
}

export function focusResourceField(root:ParentNode|null,path?:string) {
	if(!root||!path){return;}
	const element=root.querySelector<HTMLElement>('[data-field-path="'+CSS.escape(path)+'"]')??root.querySelector<HTMLElement>('[data-block-type="'+CSS.escape(path.split('.')[0])+'"]');
	if(!element){return;}
	for(let ancestor:HTMLElement|null=element;ancestor;ancestor=ancestor.parentElement){if(ancestor instanceof HTMLDetailsElement){ancestor.open=true;}}
	element.scrollIntoView({block:'center',behavior:'auto'});
	(element.querySelector<HTMLElement>('input,select,textarea,button')??element).focus({preventScroll:true});
}
