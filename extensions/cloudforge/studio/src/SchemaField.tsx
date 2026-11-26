import { useId } from 'react';
import { LiteralFields } from './LiteralFields.tsx';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { fieldIssue } from './formDefinition.ts';
import { CircleHelp, CornerDownRight, Link2, TriangleAlert, Variable, X } from 'lucide-react';
import type { FieldImpact } from './fieldImpact.ts';
import { resourceRefBindingIssue, variableBindingIssue, variablePreview, type ResourceRefBinding, type ResourceRefCandidate, type ResourceRefEntry, type VariableBinding } from './fieldBindings.ts';
import { isSensitiveProperty, type VariableDefinition } from './variables.ts';
import { VariablePicker } from './VariablePicker.tsx';
import { ResourceReferencePicker } from './ResourceReferencePicker.tsx';
import { ContextPopover } from './ContextPopover.tsx';
import { fieldLabel } from './fieldLabel.ts';
import { resourceAddress, type InheritedReference } from './resourceHierarchy.ts';
import { resourceDefinition } from './fixture.ts';
import type { Architecture, Resource } from './model.ts';

export type FieldInheritance = { reference?: InheritedReference; available?: InheritedReference; onInherit: (enabled:boolean)=>void; onReveal?: (id:string)=>void };
export type FieldResourceReference = {
	binding?: ResourceRefBinding;
	candidates: ResourceRefCandidate[];
	architecture?: Architecture;
	resource?: Resource;
	onSelect: (refs?: ResourceRefEntry[]) => void;
	onReveal?: (id: string) => void;
};
/** Literal, input, typed resource reference and inherited modes share the same field in both resource editors. */
export function SchemaField({ name, value, definition, onChange, onUnset, variables = [], binding, onBind, onManageVariables, inheritance, resourceReference, path, impact, terraform }: {
	name:string; value:string; definition?:AttrDef; onChange:(value:string)=>void; variables?:VariableDefinition[]; binding?:VariableBinding;
	onBind?:(variableId?:string,path?:string[])=>void; onManageVariables?:()=>void; inheritance?:FieldInheritance; resourceReference?:FieldResourceReference; path?:string; impact?:FieldImpact;
	terraform?: { expression: string; onConfigure?: () => void };
	onUnset?: () => void;
}) {
	const id = useId(); const reference = inheritance?.reference;
	const refBinding = resourceReference?.binding?.refs.length ? resourceReference.binding : undefined;
	const canReference = !!resourceReference && !!definition?.refTypes?.length && !isSensitiveProperty(name, definition.sensitive);
	const issue = terraform ? undefined : reference
		? undefined
		: refBinding
			? resourceRefBindingIssue(refBinding, resourceReference?.architecture, resourceReference!.resource!, definition)
			: binding
				? variableBindingIssue(binding,variables,definition)
				: fieldIssue(value,definition);
	const variable = variables.find(item=>item.id===binding?.variableId);
	const isToggle = definition?.type==='bool' && !definition.options?.length && (!value || value==='true' || value==='false');
	const fixed = () => { inheritance?.onInherit(false); onBind?.(undefined); resourceReference?.onSelect(undefined); };
	const props = {id,value,'aria-invalid':!!issue,'aria-required':!!definition?.required,'aria-describedby':id+'-help',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
	return <div className="schema-field" data-field-path={path??name}>
		<div className="schema-field-heading">
			<div className="field-label-help">
			<label id={id+'-label'} htmlFor={binding||reference||refBinding||isToggle?undefined:id} title={name}>{fieldLabel(name)}{definition?.required&&<span className="field-required" aria-hidden="true"> *</span>}</label>
			{definition?.description && <ContextPopover compact label={'Help for '+fieldLabel(name)} icon={<CircleHelp size={13}/>} description="Field type and guidance from the current resource definition."><p className="field-help">{definition.description}</p><p className="field-help"><code>{name}</code> · {definition.required?'Required':'Optional'} · {definition.type}{definition.refTypes?.length?' · May reference '+definition.refTypes.join(', '):''}</p>{definition.cidr&&<p className="field-help">Use a CIDR range, such as 10.20.1.0/24. A subnet range must fit inside its parent network.</p>}</ContextPopover>}
			</div>
			{onBind && !terraform ? <div className="field-value-mode" role="group" aria-label={name+' value mode'}>
				<button aria-pressed={!binding&&!reference&&!refBinding} onClick={fixed}>Value</button>
				{canReference && <ResourceReferencePicker name={name} definition={definition} candidates={resourceReference.candidates} selected={refBinding?.refs ?? []} onSelect={resourceReference.onSelect} />}
				<VariablePicker onManageVariables={onManageVariables} sensitiveField={isSensitiveProperty(name,definition?.sensitive)} name={name} variables={variables} selectedId={binding?.variableId} selectedPath={binding?.path} definition={definition} onSelect={onBind}/>
			</div>:<span className="schema-field-type">{definition?.type??'value'}</span>}
		</div>
		{terraform ? <div className="terraform-configured" id={id} role="group" aria-labelledby={id+'-label'}><strong>Configured in Terraform</strong><code>{terraform.expression}</code>{terraform.onConfigure && <button type="button" onClick={terraform.onConfigure}>Configure in Terraform</button>}</div> : reference ? <div className="inherited-field" id={id} role="group" aria-labelledby={id+'-label'}>
			<span className="inheritance-label"><CornerDownRight size={13}/>Inherited from container</span>
			<button className="inheritance-source" onClick={()=>inheritance?.onReveal?.(reference.source.id)} title={reference.expression}><img src={'./assets/'+resourceDefinition(reference.source).icon} alt=""/><strong>{reference.source.label||reference.source.name}</strong><span>{reference.attribute}</span></button>
			<code>{reference.expression}</code><button className="inheritance-override" onClick={fixed}>Use own value</button>
		</div> : refBinding ? <div className="resource-ref-field" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}>
			<span className="inheritance-label"><Link2 size={13}/>Typed resource reference</span>
			<div className="resource-ref-chips">{refBinding.refs.map(entry => {
				const target = resourceReference?.architecture?.resources.find(item => item.id === entry.resourceId);
				const expr = target ? resourceAddress(target) + '.' + entry.attribute : 'Missing resource';
				return <div key={entry.resourceId + ':' + entry.attribute} className="resource-ref-chip">
					{target ? <button className="inheritance-source" onClick={() => resourceReference?.onReveal?.(target.id)} title={expr}><img src={'./assets/' + resourceDefinition(target).icon} alt="" /><strong>{target.label || target.name}</strong><span>.{entry.attribute}</span></button> : <span className="resource-ref-missing">Missing resource (.{entry.attribute})</span>}
					<button className="resource-ref-remove" aria-label={'Remove reference ' + expr} onClick={() => { const next = refBinding.refs.filter(item => !(item.resourceId === entry.resourceId && item.attribute === entry.attribute)); resourceReference?.onSelect(next.length ? next : undefined); }}><X size={12} /></button>
				</div>;
			})}</div>
			<code>{definition?.type === 'list' ? '[' + refBinding.refs.map(entry => { const target = resourceReference?.architecture?.resources.find(item => item.id === entry.resourceId); return target ? resourceAddress(target) + '.' + entry.attribute : 'null'; }).join(', ') + ']' : (() => { const target = resourceReference?.architecture?.resources.find(item => item.id === refBinding.refs[0].resourceId); return target ? resourceAddress(target) + '.' + refBinding.refs[0].attribute : 'null'; })()}</code>
			<button className="inheritance-override" onClick={fixed}>Use own value</button>
		</div> : binding ? <div className="field-variable-value" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}><span className="variable-chip"><Variable size={14}/><span>{variable?(binding?.path?.length?[variable.name,...binding.path].join(' › '):variable.name):'Missing variable'}</span><button aria-label={'Use fixed value for '+name} onClick={()=>onBind?.(undefined)}><X size={12}/></button></span><small>{variable?variablePreview(variable,isSensitiveProperty(name,definition?.sensitive),binding?.path):'Choose a valid input'}</small></div>
		: isToggle ? <div className="bool-toggle" id={id} role="radiogroup" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}>{([['','Not set'],['true','On'],['false','Off']] as const).map(([option,text])=><button key={text} type="button" role="radio" aria-checked={value===option} title={option?name+' = '+option:'Leave '+name+' unset (provider default)'} onClick={()=>onChange(option)}>{text}</button>)}</div>
		: definition?.type==='bool'||definition?.options?.length ? <select {...props}><option value="">Not set</option>{(definition.options??['true','false']).map(option=><option key={option}>{option}</option>)}{value&&!(definition.options??['true','false']).includes(value)&&<option>{value}</option>}</select>
		: definition?.literalShape && ['object','list','set','map','tuple'].includes(definition.literalShape.kind) ? <LiteralFields value={value} shape={definition.literalShape} name={name} id={id} labelId={id+'-label'} onChange={onChange} onUnset={onUnset}/>
		: definition?.type==='list'||definition?.type==='map'||definition?.type==='json' ? <textarea {...props} rows={2} spellCheck={false}/>
		: <input {...props} type={isSensitiveProperty(name,definition?.sensitive)?'password':'text'} inputMode={definition?.type==='number'?'decimal':undefined} placeholder={definition?.placeholder}/>}
		{!reference&&inheritance?.available&&<button className="restore-inheritance" onClick={()=>inheritance.onInherit(true)}>Use inherited {inheritance.available.source.name}.{inheritance.available.attribute}</button>}
		<div id={id+'-help'} className={issue?'schema-field-error':'field-help'}>{issue??definition?.description}</div>
		{impact && <div className="field-impact" role="note"><TriangleAlert size={15}/><div><strong>{impact.kind === 'replacement' ? 'May replace an existing resource' : 'May stop the instance to update'}</strong><p>{impact.kind === 'replacement' ? 'Changing this argument can require a new resource. Review the plan for affected dependencies.' : 'Review allow_stopping_for_update and the instance status before changing this argument.'}</p>{impact.docsUrl ? <a href={impact.docsUrl} target="_blank" rel="noreferrer">{impact.source}</a> : <small>{impact.source}</small>}</div></div>}
	</div>;
}
