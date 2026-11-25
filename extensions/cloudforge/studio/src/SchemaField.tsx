import { useId } from 'react';
import type { AttrDef } from './cloudlab-core/catalog/index.ts';
import { fieldIssue } from './formDefinition.ts';
import { CircleHelp, CornerDownRight, Variable, X } from 'lucide-react';
import { variableBindingIssue, variablePreview, type VariableBinding } from './fieldBindings.ts';
import { isSensitiveProperty, type VariableDefinition } from './variables.ts';
import { VariablePicker } from './VariablePicker.tsx';
import { ContextPopover } from './ContextPopover.tsx';
import type { InheritedReference } from './resourceHierarchy.ts';
import { resourceDefinition } from './fixture.ts';

export type FieldInheritance = { reference?: InheritedReference; available?: InheritedReference; onInherit: (enabled:boolean)=>void; onReveal?: (id:string)=>void };
/** Literal, input and inherited modes share the same field in both resource editors. */
export function SchemaField({ name, value, definition, onChange, variables = [], binding, onBind, onManageVariables, inheritance, path }: {
	name:string; value:string; definition?:AttrDef; onChange:(value:string)=>void; variables?:VariableDefinition[]; binding?:VariableBinding;
	onBind?:(variableId?:string)=>void; onManageVariables?:()=>void; inheritance?:FieldInheritance; path?:string;
}) {
	const id = useId(); const reference = inheritance?.reference;
	const issue = reference ? undefined : binding ? variableBindingIssue(binding,variables,definition) : fieldIssue(value,definition);
	const variable = variables.find(item=>item.id===binding?.variableId);
	const fixed = () => { inheritance?.onInherit(false); onBind?.(undefined); };
	const props = {id,value,'aria-invalid':!!issue,'aria-required':!!definition?.required,'aria-describedby':id+'-help',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
	return <div className="schema-field" data-field-path={path??name}>
		<div className="schema-field-heading">
			<label id={id+'-label'} htmlFor={binding||reference?undefined:id}>{name.replaceAll('_',' ')}{definition?.required&&<span className="field-required" aria-hidden="true"> *</span>}</label>
			{definition?.description && <ContextPopover compact label={'Help for '+name.replaceAll('_',' ')} icon={<CircleHelp size={13}/>} description="Guidance from the bundled resource catalogue."><p className="field-help">{definition.description}</p><p className="field-help">{definition.required?'Required':'Optional'} · {definition.type}{definition.refTypes?.length?' · May reference '+definition.refTypes.join(', '):''}</p>{definition.cidr&&<p className="field-help">Use a CIDR range, such as 10.20.1.0/24. A subnet range must fit inside its parent network.</p>}</ContextPopover>}
			{onBind ? <div className="field-value-mode" role="group" aria-label={name+' value mode'}>
				<button aria-pressed={!binding&&!reference} onClick={fixed}>Value</button>
				<VariablePicker onManageVariables={onManageVariables} sensitiveField={isSensitiveProperty(name,definition?.sensitive)} name={name} variables={variables} selectedId={binding?.variableId} definition={definition} onSelect={onBind}/>
			</div>:<span className="schema-field-type">{definition?.type??'value'}</span>}
		</div>
		{reference ? <div className="inherited-field" id={id} role="group" aria-labelledby={id+'-label'}>
			<span className="inheritance-label"><CornerDownRight size={13}/>Inherited from container</span>
			<button className="inheritance-source" onClick={()=>inheritance?.onReveal?.(reference.source.id)} title={reference.expression}><img src={'./assets/'+resourceDefinition(reference.source).icon} alt=""/><strong>{reference.source.label||reference.source.name}</strong><span>{reference.attribute}</span></button>
			<code>{reference.expression}</code><button className="inheritance-override" onClick={fixed}>Use own value</button>
		</div> : binding ? <div className="field-variable-value" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={id+'-help'}><span className="variable-chip"><Variable size={14}/><span>{variable?.name??'Missing variable'}</span><button aria-label={'Use fixed value for '+name} onClick={()=>onBind?.(undefined)}><X size={12}/></button></span><small>{variable?variablePreview(variable,isSensitiveProperty(name,definition?.sensitive)):'Choose a valid input'}</small></div>
		: definition?.type==='bool'||definition?.options?.length ? <select {...props}><option value="">Not set</option>{(definition.options??['true','false']).map(option=><option key={option}>{option}</option>)}{value&&!(definition.options??['true','false']).includes(value)&&<option>{value}</option>}</select>
		: definition?.type==='list'||definition?.type==='map' ? <textarea {...props} rows={2} spellCheck={false}/>
		: <input {...props} type={isSensitiveProperty(name,definition?.sensitive)?'password':'text'} inputMode={definition?.type==='number'?'decimal':undefined} placeholder={definition?.placeholder}/>}
		{!reference&&inheritance?.available&&<button className="restore-inheritance" onClick={()=>inheritance.onInherit(true)}>Use inherited {inheritance.available.source.name}.{inheritance.available.attribute}</button>}
		<div id={id+'-help'} className={issue?'schema-field-error':'field-help'}>{issue??definition?.description}</div>
	</div>;
}
