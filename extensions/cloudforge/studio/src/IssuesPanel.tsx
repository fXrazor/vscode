/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CircleCheck, TriangleAlert, CircleAlert, ChevronRight } from 'lucide-react';
import type { Architecture } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';

/** The inspector owns the sole vertical scroll area; every issue opens its source field. */
export function IssuesPanel({architecture,findings,onReveal}:{architecture:Architecture;findings:Diagnostic[];onReveal:(finding:Diagnostic)=>void}) {
	return <section className="issues-panel"><h2>Local checks</h2><p className="field-help">Checks use bundled resource metadata. Terraform and cloud provider validation have not run.</p>
		{!findings.length&&<p className="issues-clear"><CircleCheck size={16}/>No issues found by local checks.</p>}
		{(['error','warning'] as const).map(severity=>{const items=findings.filter(item=>item.severity===severity);return items.length?<div key={severity}><h3>{severity==='error'?'Errors':'Warnings'} <span>{items.length}</span></h3>{items.map(item=><button className={'issue-card '+severity} key={item.id} onClick={()=>onReveal(item)}>{severity==='error'?<CircleAlert size={15}/>:<TriangleAlert size={15}/>}<span><strong>{architecture.resources.find(resource=>resource.id===item.resourceId)?.name??'Resource'}</strong><span>{item.message}</span>{item.path&&<code>{item.path}</code>}</span><ChevronRight size={14}/></button>)}</div>:null;})}
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
