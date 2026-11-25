/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Dispatch } from 'react';
import type { Action, Architecture, Resource, ResourceBlock } from './model.ts';
import { providerRegions, resourceTypes, resourceDefinition } from './fixture.ts';
import type { ResourceKind } from './model.ts';
import { additionalBlocks, editableFields, fieldIssue, type BlockDefinition } from './formDefinition.ts';
import { SchemaField } from './SchemaField.tsx';
import { bindingKey, canBindField, eligibleReferenceTargets, fieldDefinition, fieldTargetPath, regionAttribute, resourceRefBindingIssue, variableBindingIssue, type FieldTarget } from './fieldBindings.ts';
import { inheritedReference, inheritedReferences, isResourceContainer, resourcePlacement } from './resourceHierarchy.ts';
import type { LiveSchemaMap } from './liveSchema.ts';

function fieldState(resource:Resource,architecture:Architecture|undefined,target:FieldTarget,dispatch:Dispatch<Action>,onManageVariables?:()=>void,onRevealResource?:(id:string)=>void,liveSchemas?:LiveSchemaMap) {
	const path = fieldTargetPath(resource,target);
	const available = architecture&&inheritedReference(architecture,{...resource,inheritanceOverrides:[]},path);
	const definition = fieldDefinition(resource, target, liveSchemas);
	const key = bindingKey(target);
	const canBind = !!architecture && canBindField(resource, target);
	return {path:path.join('.'),...(canBind?{variables:architecture.variables??[],onManageVariables,binding:resource.fieldBindings?.[key],onBind:(variableId?:string)=>dispatch({type:'bindVariable',id:resource.id,target,variableId}),resourceReference:definition?.refTypes?.length?{binding:resource.resourceRefs?.[key],candidates:eligibleReferenceTargets(architecture,resource,definition,liveSchemas),architecture,resource,onSelect:(refs?:{resourceId:string;attribute:string}[])=>dispatch({type:'bindResourceRef',id:resource.id,target,refs}),onReveal:onRevealResource}:undefined}:{}),
		inheritance:available?{available,reference:architecture&&inheritedReference(architecture,resource,path),onInherit:(enabled:boolean)=>dispatch({type:'useInheritance',id:resource.id,target,enabled}),onReveal:onRevealResource}:undefined};
}

export function ResourceFields({ resource, dispatch, architecture, compactMetadata = false, onManageVariables, onRevealResource, liveSchemas }: { resource: Resource; dispatch: Dispatch<Action>; architecture?: Architecture; compactMetadata?: boolean; onManageVariables?: () => void; onRevealResource?:(id:string)=>void; liveSchemas?: LiveSchemaMap }) {
	const typeName = resourceDefinition(resource).type;
	const liveSchema = liveSchemas?.[typeName];
	const properties = editableFields(resource, liveSchemas);
	function binding(target: FieldTarget) {
		return fieldState(resource,architecture,target,dispatch,onManageVariables,onRevealResource,liveSchemas);
	}

 function field(name:string,value:string) {
  const definition=fieldDefinition(resource,{kind:'setting',name},liveSchemas);
  const update=(value:string)=>dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[name]:value}}});
  let display = value;
  if (!resource.catalogue && definition?.type === 'list') { try { JSON.parse(value); } catch { display = JSON.stringify([value]); } }
  if (!resource.catalogue && definition?.type === 'bool' && ['Enabled','Disabled'].includes(value)) { display = value === 'Enabled' ? 'true' : 'false'; }
  return <SchemaField key={name} name={name} value={display} definition={definition} onChange={update} {...binding({kind:'setting',name})} />;
 }

	const poolFields = resource.kind === 'cluster' ? ['Node count', 'VM size'] : [];
	const settings = Object.entries(resource.settings);
	const paths = new Set(settings.map(([name])=>fieldTargetPath(resource,{kind:'setting',name}).join('.')));
	for (const property of properties) { if (property.required && !['name','location','region'].includes(property.name) && !paths.has(property.name)) { settings.push([property.name,'']); paths.add(property.name); } }
	for (const reference of architecture?inheritedReferences(architecture,resource):[]) { if (reference.path.length===1&&!['name','location','region'].includes(reference.path[0])&&!paths.has(reference.path[0])) { settings.push([reference.path[0],'']); paths.add(reference.path[0]); } }
	return (
		<div className="resource-fields">
			<details className="form-section">
				<summary>Graphics</summary>
				<div className="form-section-body">
					<label>Icon<select value={resource.iconKind ?? resource.kind} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { iconKind: event.target.value as ResourceKind } })}>
						{Object.keys(resourceTypes).map(kind => <option key={kind} value={kind}>{resourceDefinition({ kind: kind as ResourceKind, provider: resource.provider }).label}</option>)}
					</select></label>
					<label>Resource label<input value={resource.label ?? ''} placeholder={resource.name} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { label: event.target.value } })} /></label>
					{!isResourceContainer(resource)&&<label>Icon size<input aria-label="Resource icon size" type="number" min={24} max={160} step={4} disabled={resource.canvasLocked} value={resource.iconSize ?? 48} onChange={event => { const iconSize = Number(event.target.value); if (iconSize >= 24 && iconSize <= 160) { dispatch({ type: 'resizeResource', id: resource.id, position: resource.positions.visual, iconSize }); } }}/></label>}
				</div>
			</details>
			<details className="form-section" open={!compactMetadata}>
				<summary>Metadata<span className="schema-type">{resourceDefinition(resource).type}</span></summary>
				<div className="form-section-body">
					<SchemaField name="Resource name" value={resource.name} definition={{name:'name',type:'string',description:'The resource name. A variable changes the Terraform value; the identifier stays stable.'}} onChange={value => dispatch({ type:'update', id:resource.id, patch:{name:value} })} {...binding({kind:'name'})}/>
					<label>Terraform identifier<input readOnly value={resource.terraformName ?? resource.name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]/, '_$&')} /></label>
					<label>File name<input readOnly value="main.tf" /></label>
					{architecture&&<label>Parent container<select aria-label="Parent infrastructure container" value={resource.parentId??''} onChange={event=>dispatch({type:'placeResource',id:resource.id,parentId:event.target.value||undefined,mode:'visual'})}><option value="">Canvas · no inheritance</option>{architecture.resources.filter(item=>item.id!==resource.id&&isResourceContainer(item)).map(parent=>{const placement=resourcePlacement(architecture,resource,parent.id);return <option key={parent.id} value={parent.id} disabled={!placement.ok||placement.parentId!==parent.id}>{parent.name} · {resourceDefinition(parent).label}{!placement.ok?' — incompatible':''}</option>;})}</select></label>}
				</div>
			</details>
			<details className="form-section" open>
				<summary>Main Parameters</summary>
				<div className="form-section-body">
					{regionAttribute(resource)&&<SchemaField name="Region" value={resource.region} definition={{name:'region',type:'string',description:'Cloud region for this resource.',options:providerRegions[resource.provider]}} onChange={value => dispatch({ type:'update', id:resource.id, patch:{region:value} })} {...binding({kind:'region'})}/>}
					{settings.filter(([name]) => !poolFields.includes(name)).map(([name, value]) => field(name, value))}
					{settings.some(([name]) => poolFields.includes(name)) && <details className="nested-block" open>
						<summary>Default Node Pool<span>{poolFields.length} fields</span></summary>
						<div className="nested-block-body">{settings.filter(([name]) => poolFields.includes(name)).map(([name, value]) => field(name, value))}</div>
					</details>}
				</div>
			</details>
			<NestedBlocks blocks={resource.blocks} definitions={additionalBlocks(resource, liveSchemas)} scope="resource" resource={resource} architecture={architecture} dispatch={dispatch} onManageVariables={onManageVariables} onRevealResource={onRevealResource} liveSchemas={liveSchemas}
				onChange={blocks => dispatch({ type: 'update', id: resource.id, patch: { blocks } })} />
			{(resource.catalogue || liveSchema) && <details className="form-section advanced-properties"><summary>Advanced properties<span className="schema-type">{liveSchema ? liveSchema.providerSource + ' ' + liveSchema.providerVersion : 'Optional additions'}</span></summary><div className="form-section-body"><p className="field-help">{liveSchema ? 'Add optional arguments from the version-matched Rust provider schema. Required arguments stay in Main Parameters.' : 'Add optional arguments from the bundled catalogue. Required arguments stay in Main Parameters.'}</p><label className="add-provider-property">Add property<select aria-label="Add provider property" value="" onChange={event=>{const field=properties.find(field=>field.name===event.target.value);if(field) {dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[field.name]:field.default===undefined?'':typeof field.default==='string'?field.default:JSON.stringify(field.default)}}});}}}><option value="">Choose an optional property…</option>{properties.filter(field=>!field.required&&!['name','location','region'].includes(field.name)&&!Object.hasOwn(resource.settings,field.name)).map(field=><option key={field.name} value={field.name}>{field.name} · {field.type}</option>)}</select></label></div></details>}
   <p className="form-coverage">{liveSchema ? 'Live Rust schema · ' + liveSchema.providerSource + ' ' + liveSchema.providerVersion + ' (' + liveSchema.attributes.length + ' attributes, ' + liveSchema.blocks.length + ' blocks).' : 'Local catalogue form · nested fields use bundled definitions where available. Live provider validation is not connected.'}</p>
		</div>
	);
}

function NestedBlocks({ blocks, definitions, scope, onChange, resource, architecture, dispatch, onManageVariables, onRevealResource, liveSchemas }: {
	blocks: ResourceBlock[];
	definitions: BlockDefinition[];
	scope: string;
	onChange: (blocks: ResourceBlock[]) => void;
	resource: Resource;
	architecture?: Architecture;
	dispatch: Dispatch<Action>;
	onManageVariables?: () => void;
	onRevealResource?: (id:string)=>void;
	liveSchemas?: LiveSchemaMap;
}) {
	const available = definitions.filter(definition => blocks.filter(block => block.type === definition.type).length < definition.max);
	return (
		<div className="nested-blocks">
			{blocks.map(block => {
			const definition = definitions.find(item => item.type === block.type);
				const label = definition?.label ?? block.type.replaceAll('_', ' ');
				const fields = [...new Set([...(definition?.attributes ?? []).map(field => field.name), ...Object.keys(block.values)])];
				const missing = fields.filter(name => { if(architecture&&inheritedReference(architecture,resource,fieldTargetPath(resource,{kind:'block',blockId:block.id,name}))){return false;} const key = bindingKey({kind:'block',blockId:block.id,name}); const attribute = definition?.attributes?.find(field => field.name === name); const refBind = resource.resourceRefs?.[key]; if (refBind?.refs.length) { return !!resourceRefBindingIssue(refBind, architecture, resource, attribute); } const binding = resource.fieldBindings?.[key]; return binding ? variableBindingIssue(binding,architecture?.variables??[],attribute) : fieldIssue(block.values[name] ?? '', attribute); }).length;
				function update(next: ResourceBlock) {
					onChange(blocks.map(item => item.id === block.id ? next : item));
				}
				return <details key={block.id} className="nested-block" data-block-type={block.type} open>
					<summary>{label}<span>{blocks.filter(item => item.type === block.type).length > 1 ? '#' + (blocks.filter(item => item.type === block.type).indexOf(block) + 1) + ' · ' : ''}{missing ? missing + ' to review' : fields.length + ' fields'}</span></summary>
					<div className="nested-block-body">
						{definition?.description && <p className="field-help">{definition.description}</p>}
						{!definition && <p className="field-help">Schema unavailable. Existing values are preserved; review against your provider version.</p>}
						{fields.map(name => <SchemaField key={name} name={name} value={block.values[name] ?? ''} definition={definition?.attributes?.find(field => field.name === name)} onChange={value => update({ ...block, values: { ...block.values, [name]: value } })} {...fieldState(resource,architecture,{kind:'block',blockId:block.id,name},dispatch,onManageVariables,onRevealResource,liveSchemas)}/>)}
						<NestedBlocks blocks={block.blocks} definitions={definition?.children ?? []} scope={label}
								resource={resource} architecture={architecture} dispatch={dispatch} onManageVariables={onManageVariables} onRevealResource={onRevealResource} liveSchemas={liveSchemas} onChange={children => update({ ...block, blocks: children })} />
						<button className="remove-block" onClick={() => onChange(blocks.filter(item => item.id !== block.id))}>Remove {label}</button>
					</div>
				</details>;
			})}
			{definitions.filter(definition => definition.required && !blocks.some(block => block.type === definition.type)).map(definition => <p className="required-block-notice" tabIndex={-1} data-block-type={definition.type} key={definition.type}>Required block: {definition.label}. Add it below to configure its fields.</p>)}
			{available.length > 0 && <details className="add-blocks">
				<summary>Add Blocks<span>＋</span></summary>
				<div className="add-block-options">{available.map(definition => (
					<button key={definition.type} aria-label={'Add ' + definition.label + ' to ' + scope} onClick={() => onChange([...blocks, {
						id: crypto.randomUUID(), type: definition.type, values: { ...definition.fields }, blocks: []
					}])}>＋ {definition.label}<small>{definition.required ? 'Required · ' : ''}{definition.max === 1 ? 'Single block' : 'Repeatable block'}</small></button>
				))}</div>
			</details>}
		</div>
	);
}
