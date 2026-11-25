/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Layers, LockKeyhole, Trash2 } from 'lucide-react';
import { variableError, variableTypes, type VariableDefinition } from './variables.ts';
import { variableInputIssue, variableInputTypes } from './variableInputs.ts';

function ValueControl({id,label,text,type,sensitive,onChange,issue,helpId,onBlur}:{
	id:string;label:string;text:string;type:VariableDefinition['type'];sensitive:boolean;onChange:(value:string)=>void;issue?:string;helpId:string;onBlur:()=>void;
}) {
	const common={id,'aria-label':label,'aria-invalid':!!issue,'aria-describedby':helpId,value:text,onBlur,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
	if(sensitive){return <input {...common} type="password" autoComplete="off" spellCheck={false}/>;}
	if(type==='bool'){return <select {...common}><option value="">Choose a value…</option><option value="true">True</option><option value="false">False</option><option value="null">Null · no value</option>{!['','true','false','null'].includes(text)&&<option value={text}>Review this value</option>}</select>;}
	if(type==='list(string)'||type==='map(string)'||type==='any'){return <textarea {...common} className="variable-json-input" rows={3} placeholder={variableInputTypes[type].example} spellCheck={false}/>;}
	return <input {...common} type="text" inputMode={type==='number'?'decimal':undefined} placeholder={variableInputTypes[type].example} spellCheck={false}/>;
}

/** Presentation only. VariablePanel retains the draft across code/context view changes. */
export function VariableConfigurator({variable,variables,isNew,useCount,onChange,defaultSet,valueSet,defaultText,valueText,onDefaultSet,onValueSet,onDefaultText,onValueText,error,onSave,onCancel,onDelete}:{
	variable:VariableDefinition;variables:VariableDefinition[];isNew:boolean;useCount:number;onChange:(variable:VariableDefinition)=>void;
	defaultSet:boolean;valueSet:boolean;defaultText:string;valueText:string;onDefaultSet:(value:boolean)=>void;onValueSet:(value:boolean)=>void;onDefaultText:(value:string)=>void;onValueText:(value:string)=>void;
	error:string;onSave:()=>void;onCancel:()=>void;onDelete:()=>void;
}) {
	const id=useId();const form=useRef<HTMLFormElement>(null);const [touched,setTouched]=useState<Record<string,boolean>>({});
	const nameIssue=variableError({...variable,name:variable.name.trim(),defaultValue:undefined,value:undefined},variables);
	const defaultIssue=defaultSet?variableInputIssue(defaultText,variable.type):undefined;
	const valueIssue=valueSet?variableInputIssue(valueText,variable.type):undefined;
	const showIssue=(field:string,issue?:string)=>error||touched[field]?issue:undefined;
	const reference=variable.name.trim()?'var.'+variable.name.trim():'var.input_name';
	const activeText=valueSet?valueText:defaultSet?defaultText:undefined;
	const activeIssue=valueSet?valueIssue:defaultIssue;
	useEffect(()=>{if(error){form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();}},[error]);
	function valueSection(kind:'default'|'value') {
		const fallback=kind==='default';const enabled=fallback?defaultSet:valueSet;const text=fallback?defaultText:valueText;
		const issue=showIssue(kind,fallback?defaultIssue:valueIssue);const label=fallback?'Default value':'Value for this architecture';
		return <section className="variable-value-section" aria-labelledby={id+'-'+kind+'-heading'}>
			<div className="variable-value-heading"><h3 id={id+'-'+kind+'-heading'}>{label}</h3><label className="variable-enable"><input type="checkbox" checked={enabled} onChange={event=>(fallback?onDefaultSet:onValueSet)(event.target.checked)} aria-label={fallback?'Set default value':'Set architecture value'}/>{fallback?'Use a default':'Override default'}</label></div>
			<p className="configurator-help">{fallback?'Fallback used when no value is assigned.':'An assigned value takes precedence over the default.'}</p>
			{enabled?<><label className="sr-only" htmlFor={id+'-'+kind}>{label}</label><ValueControl id={id+'-'+kind} label={fallback?'Variable default value':'Variable value'} text={text} type={variable.type} sensitive={variable.sensitive} onChange={fallback?onDefaultText:onValueText} issue={issue} helpId={id+'-type-help '+id+'-'+kind+'-help'} onBlur={()=>setTouched(value=>({...value,[kind]:true}))}/><p className={issue?'configurator-error':'sr-only'} id={id+'-'+kind+'-help'}>{issue??''}</p></>:<p className="variable-unset">{fallback?'No default set.':'No architecture override.'}</p>}
		</section>;
	}
	return <form ref={form} className="variables-panel variable-configurator" noValidate onSubmit={event=>{event.preventDefault();onSave();}}>
		<header className="configurator-heading"><button type="button" className="configurator-back" aria-label="Back to variables" title="Back to variables" onClick={onCancel}><ArrowLeft size={17}/></button><div><h2>{isNew?'Create variable':'Edit variable'}</h2><p>{isNew?'Define an input you can reuse in resource fields.':useCount?`Used by ${useCount} ${useCount===1?'resource':'resources'}.`:'Available to resource fields in this architecture.'}</p></div>{!isNew && <button type="button" className="configurator-delete" aria-label="Delete variable" disabled={useCount > 0} title={useCount ? 'Remove resource references before deleting this input' : 'Delete variable · Undo restores it'} onClick={onDelete}><Trash2 size={16}/></button>}</header>
		<div className="configurator-body">
			<div className="configurator-field"><label htmlFor={id+'-name'}>Name <span className="field-required">*</span></label><input id={id+'-name'} autoFocus required aria-label="Variable name" autoComplete="off" placeholder="deployment_region" value={variable.name} aria-invalid={!!showIssue('name',nameIssue)} aria-describedby={id+'-name-help'} onBlur={()=>setTouched(value=>({...value,name:true}))} onChange={event=>onChange({...variable,name:event.target.value})}/><p id={id+'-name-help'} className={showIssue('name',nameIssue)?'configurator-error':'configurator-help'}>{showIssue('name',nameIssue)??'Use letters, numbers, underscores or hyphens. Start with a letter or underscore.'}</p></div>
			<div className="configurator-field"><span className="configurator-label">Scope</span><div className="variable-scope-summary"><Layers size={15}/><strong>Architecture</strong><span>Current scope</span></div><p className="configurator-help">Resources in this architecture can use this input.</p></div>
			<div className="configurator-field"><label htmlFor={id+'-description'}>Description <span className="optional-label">Optional</span></label><textarea id={id+'-description'} aria-label="Variable description" placeholder="Explain what this input controls, for example the Azure region for application resources." rows={3} value={variable.description} onChange={event=>onChange({...variable,description:event.target.value})}/></div>
			<div className="configurator-field"><label htmlFor={id+'-type'}>Type</label><select id={id+'-type'} aria-label="Variable type" aria-describedby={id+'-type-help'} value={variable.type} onChange={event=>onChange({...variable,type:event.target.value as VariableDefinition['type']})}>{variableTypes.map(type=><option key={type} value={type}>{variableInputTypes[type].label} · {type}</option>)}</select><p id={id+'-type-help'} className="configurator-help">{variableInputTypes[variable.type].help}</p></div>
			{valueSection('default')}{valueSection('value')}
			<section className="variable-privacy"><label htmlFor={id+'-sensitive'}><LockKeyhole size={16}/><span><strong>Sensitive input</strong><small>Hide values in previews and exports.</small></span><input id={id+'-sensitive'} type="checkbox" checked={variable.sensitive} onChange={event=>onChange({...variable,sensitive:event.target.checked})}/></label><p className="configurator-help">Values stay in this in-memory draft. This is not a secret store.</p></section>
			<details className="variable-usage-guide"><summary><CircleHelp size={15}/>How to use this input</summary><p>In a resource field, choose <strong>Variable</strong> and select this input. The generated Terraform uses <code>{reference}</code>.</p><div><span>Input</span><code>{variable.name.trim()||'input_name'}</code><ArrowRight size={13}/><span>Resource field</span></div></details>
		</div>
		<footer className="configurator-footer"><div className="variable-effective" aria-label="Effective variable value"><ArrowRight size={16}/><div><strong>{activeText===undefined?'Required input':valueSet?'Using architecture value':'Using default value'}</strong><span>{activeText===undefined?'Provide a value when running Terraform.':variable.sensitive?<><LockKeyhole size={12}/>Sensitive value hidden</>:activeIssue?'Complete the value to see a preview.':<code>{activeText===''?'"" · empty text':activeText}</code>}</span></div></div>{error&&<p role="alert" className="configurator-error">{error}</p>}<div><button type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit"><Check size={15}/>Save variable</button></div></footer>
	</form>;
}
