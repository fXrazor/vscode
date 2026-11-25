/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CircleCheck, TriangleAlert, CircleAlert, ChevronRight, ShieldCheck, Terminal, FileCode2, Crosshair, RotateCw } from 'lucide-react';
import type { Architecture } from './model.ts';
import { isStaleDiagnostic, type Diagnostic } from './diagnostics.ts';
import type { HostDependencyReport, HostEngineValidateReport, HostExportAuditReport, HostValidationRun } from './webviewBridge.ts';

export interface IssuesHostContext {
	readonly isHosted: boolean;
	readonly hasWorkspace?: boolean;
	readonly sourceRevision?: string;
	readonly validationRun?: HostValidationRun | null;
	readonly engineReport?: HostEngineValidateReport | null;
	readonly dependencyReport?: HostDependencyReport | null;
	readonly exportAuditReport?: HostExportAuditReport | null;
	readonly availableEngine?: 'openTofu' | 'terraform';
	readonly validating?: boolean;
	readonly onRunValidation?: () => void;
	readonly onRunEngineValidate?: () => void;
	/** Opens a diagnostic's reported Terraform file and line in the editor. */
	readonly onOpenLocation?: (finding: Diagnostic) => void;
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
			{host.onRunValidation && <button type="button" className="quiet-button" disabled={host.validating || !host.hasWorkspace} title={host.hasWorkspace ? 'Run Rust service validation' : 'Open an architecture in CloudForge Project to validate'} onClick={host.onRunValidation}><ShieldCheck size={14} /><span>{host.validating ? 'Validating…' : 'Validate'}</span></button>}
			{host.availableEngine && host.onRunEngineValidate && <button type="button" className="quiet-button" disabled={host.validating || !host.hasWorkspace} title={host.hasWorkspace ? 'Run CLI validate -json' : 'Open an architecture in CloudForge Project to validate'} onClick={host.onRunEngineValidate}><Terminal size={14} /><span>{host.availableEngine === 'openTofu' ? 'OpenTofu' : 'Terraform'} validate</span></button>}
		</div>}
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
		{(['error','warning'] as const).map(severity=>{const items=findings.filter(item=>item.severity===severity);return items.length?<div key={severity}><h3>{severity==='error'?'Errors':'Warnings'} <span>{items.length}</span></h3>{items.map(item=><IssueEntry key={item.id} item={item} architecture={architecture} onReveal={onReveal} host={host}/>)}</div>:null;})}
	</section>;
}

/**
 * One diagnostic: the card reveals its (first) target; extra actions jump to each target of a
 * multi-resource finding, open the reported source line, or re-run the check when it is stale.
 */
function IssueEntry({item,architecture,onReveal,host}:{item:Diagnostic;architecture:Architecture;onReveal:(finding:Diagnostic)=>void;host?:IssuesHostContext}) {
	const name=(id:string)=>architecture.resources.find(resource=>resource.id===id)?.name;
	const stale=isStaleDiagnostic(item,architecture,host?.sourceRevision);
	const rerun=item.source==='cli'?host?.onRunEngineValidate:item.source==='validation'?host?.onRunValidation:undefined;
	const targets=item.targets&&item.targets.length>1?item.targets:[];
	const title=targets.length?targets.map(target=>name(target.resourceId)??'Missing resource').join(' and '):name(item.resourceId)??'Architecture';
	const location=item.location?item.location.fileName+(item.location.line?':'+item.location.line:''):undefined;
	return <div className={'issue-entry'+(stale?' stale':'')}>
		<button className={'issue-card '+item.severity} onClick={()=>onReveal(item)} aria-describedby={stale?item.id+'-stale':undefined}>{item.severity==='error'?<CircleAlert size={15}/>:<TriangleAlert size={15}/>}<span><strong>{title}{item.source && item.source !== 'local' && <em className={'issue-source-tag source-' + item.source}>{sourceBadgeLabel[item.source]}</em>}{stale&&<em className="issue-source-tag issue-stale-tag" id={item.id+'-stale'}>Stale</em>}</strong><span>{item.message}</span>{item.remediation && <small>{item.remediation}</small>}{item.path&&!targets.length&&<code>{item.path}</code>}</span><ChevronRight size={14}/></button>
		{(targets.length>0||(location&&host?.onOpenLocation&&!stale)||(stale&&rerun))&&<div className="issue-actions">
			{targets.map(target=><button type="button" className="quiet-button" key={target.resourceId} disabled={!name(target.resourceId)} onClick={()=>onReveal({...item,resourceId:target.resourceId,path:target.path,targets:undefined})}><Crosshair size={13}/><span>{name(target.resourceId)??'Missing resource'}{target.path?' · '+target.path:''}</span></button>)}
			{location&&host?.onOpenLocation&&!stale&&<button type="button" className="quiet-button" onClick={()=>host.onOpenLocation?.(item)}><FileCode2 size={13}/><span>Open {location}</span></button>}
			{stale&&rerun&&<button type="button" className="quiet-button" disabled={host?.validating} onClick={rerun}><RotateCw size={13}/><span>Run checks again</span></button>}
		</div>}
	</div>;
}

export function focusResourceField(root:ParentNode|null,path?:string) {
	if(!root||!path){return;}
	const element=root.querySelector<HTMLElement>('[data-field-path="'+CSS.escape(path)+'"]')??root.querySelector<HTMLElement>('[data-block-type="'+CSS.escape(path.split('.')[0])+'"]');
	if(!element){return;}
	for(let ancestor:HTMLElement|null=element;ancestor;ancestor=ancestor.parentElement){if(ancestor instanceof HTMLDetailsElement){ancestor.open=true;}}
	element.scrollIntoView({block:'center',behavior:'auto'});
	(element.querySelector<HTMLElement>('input,select,textarea,button')??element).focus({preventScroll:true});
}
