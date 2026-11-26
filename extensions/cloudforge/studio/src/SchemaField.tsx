import { useId, useMemo } from 'react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { fieldIssue } from './formDefinition.ts';
import { CircleHelp, CornerDownRight, Link2, Variable, X } from 'lucide-react';
import { resourceRefBindingIssue, variableBindingIssue, variablePreview, type ResourceRefBinding, type ResourceRefCandidate, type ResourceRefEntry, type VariableBinding } from './fieldBindings.ts';
import { isSensitiveProperty, type VariableDefinition } from './variables.ts';
import { VariablePicker } from './VariablePicker.tsx';
import { ResourceReferencePicker } from './ResourceReferencePicker.tsx';
import { ContextPopover } from './ContextPopover.tsx';
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
export function SchemaField({ name, value, definition, onChange, variables = [], binding, onBind, onManageVariables, inheritance, resourceReference, path }: {
	name:string; value:string; definition?:AttrDef; onChange:(value:string)=>void; variables?:VariableDefinition[]; binding?:VariableBinding;
	onBind?:(variableId?:string)=>void; onManageVariables?:()=>void; inheritance?:FieldInheritance; resourceReference?:FieldResourceReference; path?:string;
}) {
	const id = useId(); const reference = inheritance?.reference;
	const refBinding = resourceReference?.binding?.refs.length ? resourceReference.binding : undefined;
	const canReference = !!resourceReference && !!definition?.refTypes?.length && !isSensitiveProperty(name, definition.sensitive);
	const issue = reference
		? undefined
		: refBinding
			? resourceRefBindingIssue(refBinding, resourceReference?.architecture, resourceReference!.resource!, definition)
			: binding
				? variableBindingIssue(binding,variables,definition)
				: fieldIssue(value,definition);
	const variable = variables.find(item=>item.id===binding?.variableId);
	const refResources = resourceReference?.architecture?.resources;
	const resourceById = useMemo(
		() => refBinding && refResources ? new Map(refResources.map(item => [item.id, item])) : undefined,
		[refBinding, refResources]
	);
	const fixed = () => { inheritance?.onInherit(false); onBind?.(undefined); resourceReference?.onSelect(undefined); };
	const props = {id,value,'aria-invalid':!!issue,'aria-required':!!definition?.required,'aria-describedby':id+'-help',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
	return <div className="schema-field" data-field-path={path??name}>
		<div className="schema-field-heading">
			<label id={id+'-label'} htmlFor={binding||reference||refBinding?undefined:id}>{name.replaceAll('_',' ')}{definition?.required&&<span className="field-required" aria-hidden="true"> *</span>}</label>
			{definition?.description && <ContextPopover compact label={'Help for '+name.replaceAll('_',' ')} icon={<CircleHelp size={13}/>} description="Guidance from the bundled resource catalogue."><p className="field-help">{definition.description}</p><p className="field-help">{definition.required?'Required':'Optional'} · {definition.type}{definition.refTypes?.length?' · May reference '+definition.refTypes.join(', '):''}</p>{definition.cidr&&<p className="field-help">Use a CIDR range, such as 10.20.1.0/24. A subnet range must fit inside its parent network.</p>}</ContextPopover>}
			{onBind ? <div className="field-value-mode" role="group" aria-label={name+' value mode'}>
				<button type="button" aria-pressed={!binding&&!reference&&!refBinding} onClick={fixed}>Value</button>
				{canReference && <ResourceReferencePicker name={name} definition={definition} candidates={resourceReference.candidates} selected={refBinding?.refs ?? []} onSelect={resourceReference.onSelect} />}
				<VariablePicker onManageVariables={onManageVariables} sensitiveField={isSensitiveProperty(name,definition?.sensitive)} name={name} variables={variables} selectedId={binding?.variableId} definition={definition} onSelect={onBind}/>
			</div>:<span className="schema-field-type">{definition?.type??'value'}</span>}
		</div>
		{reference ? <div className="inherited-field" id={id} role="group" aria-labelledby={id+'-label'}>
			<span className="inheritance-label"><CornerDownRight size={13}/>Inherited from container</span>
			<button type="button" className="inheritance-source" onClick={()=>inheritance?.onReveal?.(reference.source.id)} title={reference.expression}><img src={'./assets/'+resourceDefinition(reference.source).icon} alt=""/><strong>{reference.source.label||reference.source.name}</strong><span>{reference.attribute}</span></button>
			<code>{reference.expression}</code><button type="button" className="inheritance-override" onClick={fixed}>Use own value</button>
		</div> : refBinding ? <div className="resource-ref-field" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}>
			<span className="inheritance-label"><Link2 size={13}/>Typed resource reference</span>
			<div className="resource-ref-chips">{refBinding.refs.map(entry => {
				const target = resourceById?.get(entry.resourceId);
				const expr = target ? resourceAddress(target) + '.' + entry.attribute : 'Missing resource';
				return <div key={entry.resourceId + ':' + entry.attribute} className="resource-ref-chip">
					{target ? <button type="button" className="inheritance-source" onClick={() => resourceReference?.onReveal?.(target.id)} title={expr}><img src={'./assets/' + resourceDefinition(target).icon} alt="" /><strong>{target.label || target.name}</strong><span>.{entry.attribute}</span></button> : <span className="resource-ref-missing">Missing resource (.{entry.attribute})</span>}
					<button type="button" className="resource-ref-remove" aria-label={'Remove reference ' + expr} onClick={() => { const next = refBinding.refs.filter(item => !(item.resourceId === entry.resourceId && item.attribute === entry.attribute)); resourceReference?.onSelect(next.length ? next : undefined); }}><X size={12} /></button>
				</div>;
			})}</div>
			<code>{definition?.type === 'list' ? '[' + refBinding.refs.map(entry => { const target = resourceById?.get(entry.resourceId); return target ? resourceAddress(target) + '.' + entry.attribute : 'null'; }).join(', ') + ']' : (() => { const target = resourceById?.get(refBinding.refs[0].resourceId); return target ? resourceAddress(target) + '.' + refBinding.refs[0].attribute : 'null'; })()}</code>
			<button type="button" className="inheritance-override" onClick={fixed}>Use own value</button>
		</div> : binding ? <div className="field-variable-value" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}><span className="variable-chip"><Variable size={14}/><span>{variable?.name??'Missing variable'}</span><button type="button" aria-label={'Use fixed value for '+name} onClick={()=>onBind?.(undefined)}><X size={12}/></button></span><small>{variable?variablePreview(variable,isSensitiveProperty(name,definition?.sensitive)):'Choose a valid input'}</small></div>
		: definition?.type==='bool'||definition?.options?.length ? <select {...props}><option value="">Not set</option>{(definition.options??['true','false']).map(option=><option key={option}>{option}</option>)}{value&&!(definition.options??['true','false']).includes(value)&&<option>{value}</option>}</select>
		: definition?.type==='list'||definition?.type==='map' ? <textarea {...props} rows={2} spellCheck={false}/>
		: <input {...props} type={isSensitiveProperty(name,definition?.sensitive)?'password':'text'} inputMode={definition?.type==='number'?'decimal':undefined} placeholder={definition?.placeholder}/>}
		{!reference&&inheritance?.available&&<button type="button" className="restore-inheritance" onClick={()=>inheritance.onInherit(true)}>Use inherited {inheritance.available.source.name}.{inheritance.available.attribute}</button>}
		<div id={id+'-help'} className={issue?'schema-field-error':'field-help'}>{issue??definition?.description}</div>
	</div>;
}
