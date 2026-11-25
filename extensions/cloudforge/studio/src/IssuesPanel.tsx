/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CircleCheck, TriangleAlert, CircleAlert, ChevronRight, ShieldCheck, Terminal } from 'lucide-react';
import type { Architecture } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { HostEngineValidateReport, HostValidationRun } from './webviewBridge.ts';

export interface IssuesHostContext {
	readonly isHosted: boolean;
	readonly sourceRevision?: string;
	readonly validationRun?: HostValidationRun | null;
	readonly engineReport?: HostEngineValidateReport | null;
	readonly availableEngine?: 'openTofu' | 'terraform';
	readonly validating?: boolean;
	readonly onRunValidation?: () => void;
	readonly onRunEngineValidate?: () => void;
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
			{host.onRunValidation && <button type="button" className="quiet-button" disabled={host.validating} onClick={host.onRunValidation}><ShieldCheck size={14} /><span>{host.validating ? 'Validating…' : 'Validate'}</span></button>}
			{host.availableEngine && host.onRunEngineValidate && <button type="button" className="quiet-button" disabled={host.validating} onClick={host.onRunEngineValidate}><Terminal size={14} /><span>{host.availableEngine === 'openTofu' ? 'OpenTofu' : 'Terraform'} validate</span></button>}
		</div>}
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
