/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Dispatch } from 'react';
import type { Action, Architecture, Resource, ResourceBlock } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { ResourceIconPicker } from './ResourceIconPicker.tsx';
import { additionalBlocks, editableFields, fieldIssue, type BlockDefinition } from './formDefinition.ts';
import { SchemaField } from './SchemaField.tsx';
import { bindingKey, canBindField, eligibleReferenceTargets, fieldDefinition, fieldTargetPath, regionAttribute, resourceRefBindingIssue, variableBindingIssue, type FieldTarget } from './fieldBindings.ts';
import { inheritedReference, inheritedReferences, isResourceContainer, resourcePlacement, visualParentId, visualResourcePlacement } from './resourceHierarchy.ts';
import { formCoverageGaps, type HostFormSchema, type LiveSchemaMap } from './liveSchema.ts';
import type { HostCloudRegionsPayload, HostModuleInspection } from './webviewBridge.ts';
import { resolveProviderRegions } from './serviceAdapter.ts';
import { fieldImpact } from './fieldImpact.ts';
import { getDef, indexedVersion } from './cloudlab-core/catalog/index.ts';
import { providerFormEvidence } from './providerCatalogue.ts';
import { fieldLabel } from './fieldLabel.ts';
import { additionalTerraformItems, dynamicBlockConfigured, extraFieldValue, terraformValueText } from './additionalTerraform.ts';

// Visibility only: leave optional capacity unset until the user supplies a value.
const primaryParameters: Readonly<Record<string, readonly string[]>> = {
	azurerm_linux_virtual_machine_scale_set: ['instances'],
	azurerm_windows_virtual_machine_scale_set: ['instances'],
};

export interface ResourceModuleInspectionProps {
	readonly loading: boolean;
	readonly inspection: HostModuleInspection | null;
	readonly error?: string;
	readonly onInspect: () => void;
}

function isComputedField(schema: HostFormSchema | undefined, path: string, resource: Resource): boolean {
	if (!schema) {
		let fields = getDef(resourceDefinition(resource).type)?.attributes, attribute;
		for (const segment of path.split('.').filter(part => !/^\d+$/.test(part))) { attribute = fields?.find(field => field.name === segment); fields = attribute?.children; }
		return attribute?.readOnly === true;
	}
	return [...schema?.attributes ?? [], ...schema?.blocks.flatMap(block => block.attributes) ?? []].some(attribute => attribute.path === path && attribute.access === 'computedOnly');
}

function ProviderOutput({ name, value }: { name: string; value: string }) {
	return <div className="schema-field"><label>{name.replaceAll('_', ' ')}<input aria-label={name + ' provider output'} readOnly value={value}/></label><p className="field-help">Provider output · read only</p></div>;
}

function fieldState(resource:Resource,architecture:Architecture|undefined,target:FieldTarget,dispatch:Dispatch<Action>,onManageVariables?:()=>void,onRevealResource?:(id:string)=>void,liveSchemas?:LiveSchemaMap,onConfigureTerraform?:(query?:string)=>void) {
	const path = fieldTargetPath(resource,target);
	const available = architecture&&inheritedReference(architecture,{...resource,inheritanceOverrides:[]},path);
	const definition = fieldDefinition(resource, target, liveSchemas);
	const key = bindingKey(target);
	const canBind = !!architecture && canBindField(resource, target);
	const extra = extraFieldValue(resource,target);
	return {path:path.join('.'),impact:fieldImpact(resource,path,liveSchemas?.[resourceDefinition(resource).type]),...(canBind?{variables:architecture.variables??[],onManageVariables,binding:resource.fieldBindings?.[key],onBind:(variableId?:string)=>dispatch({type:'bindVariable',id:resource.id,target,variableId}),resourceReference:definition?.refTypes?.length?{binding:resource.resourceRefs?.[key],candidates:eligibleReferenceTargets(architecture,resource,definition,liveSchemas),architecture,resource,onSelect:(refs?:{resourceId:string;attribute:string}[])=>dispatch({type:'bindResourceRef',id:resource.id,target,refs}),onReveal:onRevealResource}:undefined}:{}),
		...(extra!==undefined?{terraform:{expression:terraformValueText(extra),onConfigure:onConfigureTerraform?()=>onConfigureTerraform(path.at(-1)):undefined}}:{}),
		inheritance:available?{available,reference:architecture&&inheritedReference(architecture,resource,path),onInherit:(enabled:boolean)=>dispatch({type:'useInheritance',id:resource.id,target,enabled}),onReveal:onRevealResource}:undefined};
}

export function ResourceFields({ resource, dispatch, architecture, compactMetadata = false, onManageVariables, onRevealResource, liveSchemas, cloudRegions, moduleInspection, hasSource, onOpenSource, onConfigureTerraform }: { resource: Resource; dispatch: Dispatch<Action>; architecture?: Architecture; compactMetadata?: boolean; onManageVariables?: () => void; onRevealResource?:(id:string)=>void; liveSchemas?: LiveSchemaMap; cloudRegions?: Readonly<Partial<Record<'azure' | 'aws' | 'google', HostCloudRegionsPayload>>>; moduleInspection?: ResourceModuleInspectionProps; hasSource?: boolean; onOpenSource?: () => void; onConfigureTerraform?: (query?:string)=>void }) {
	const typeName = resourceDefinition(resource).type;
	const liveSchema = liveSchemas?.[typeName];
	const properties = editableFields(resource, liveSchemas);
	const documented = getDef(typeName);
	const formEvidence = providerFormEvidence(typeName);
	const additional = additionalTerraformItems(resource);
	const coverageGaps = liveSchema ? formCoverageGaps(liveSchema) : [];
	const regionOptions = resolveProviderRegions(resource.provider, cloudRegions);
	function binding(target: FieldTarget) {
		return fieldState(resource,architecture,target,dispatch,onManageVariables,onRevealResource,liveSchemas,onConfigureTerraform);
	}

 function field(name:string,value:string) {
  const definition=fieldDefinition(resource,{kind:'setting',name},liveSchemas);
  const path = fieldTargetPath(resource,{kind:'setting',name}).join('.');
  if (isComputedField(liveSchema, path, resource)) { return <ProviderOutput key={name} name={name} value={value}/>; }
  const unset=()=>{const settings={...resource.settings};delete settings[name];dispatch({type:'update',id:resource.id,patch:{settings}});};
  const update=(value:string)=>{if(!value.trim()&&definition?.type!=='string'){unset();return;}dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[name]:value}}});};
  let display = value;
  if (!resource.catalogue && definition?.type === 'list') { try { JSON.parse(value); } catch { display = JSON.stringify([value]); } }
  if (!resource.catalogue && definition?.type === 'bool' && ['Enabled','Disabled'].includes(value)) { display = value === 'Enabled' ? 'true' : 'false'; }
  return <SchemaField key={name} name={name} value={display} definition={definition} onChange={update} onUnset={unset} {...binding({kind:'setting',name})} />;
 }

	const poolFields = resource.kind === 'cluster' ? ['Node count', 'VM size'] : [];
	const settings = Object.entries(resource.settings);
	const paths = new Set(settings.map(([name])=>fieldTargetPath(resource,{kind:'setting',name}).join('.')));
	for (const property of properties) { if ((property.required || primaryParameters[typeName]?.includes(property.name)) && !['name','location','region'].includes(property.name) && !paths.has(property.name)) { settings.push([property.name,'']); paths.add(property.name); } }
	for (const reference of architecture?inheritedReferences(architecture,resource):[]) { if (reference.path.length===1&&!['name','location','region'].includes(reference.path[0])&&!paths.has(reference.path[0])) { settings.push([reference.path[0],'']); paths.add(reference.path[0]); } }
	return (
		<div className="resource-fields">
			<details className="form-section">
				<summary>Graphics</summary>
				<div className="form-section-body">
					<ResourceIconPicker resource={resource} dispatch={dispatch}/>
					<label>Resource label<input value={resource.label ?? ''} placeholder={resource.name} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { label: event.target.value } })} /></label>
					{!isResourceContainer(resource)&&<label>Icon size<input aria-label="Resource icon size" type="number" min={24} max={160} step={4} disabled={resource.canvasLocked} value={resource.iconSize ?? 48} onChange={event => { const iconSize = Number(event.target.value); if (iconSize >= 24 && iconSize <= 160) { dispatch({ type: 'resizeResource', id: resource.id, position: resource.positions.visual, iconSize }); } }}/></label>}
				</div>
			</details>
			<details className="form-section" open={!compactMetadata}>
				<summary>Metadata<span className="schema-type">{resourceDefinition(resource).type}</span></summary>
				<div className="form-section-body">
					<SchemaField name="Resource name" value={resource.name} definition={{name:'name',type:'string',description:'The resource name. A variable changes the Terraform value; the identifier stays stable.'}} onChange={value => dispatch({ type:'update', id:resource.id, patch:{name:value} })} {...binding({kind:'name'})}/>
					<label>Terraform identifier<input readOnly value={resource.terraformName ?? resource.name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]/, '_$&')} /></label>
					<label>Project Terraform file
						<div className="source-file-row">
							<input readOnly value={(resource.sourceFile ?? 'main.tf') + (resource.sourceLine ? ':' + resource.sourceLine : '')} />
							{hasSource && onOpenSource && <button type="button" className="quiet-button source-file-open" title={'Open ' + (resource.sourceFile ?? 'main.tf') + ' in Code OSS editor'} onClick={onOpenSource}>Open</button>}
						</div>
					</label>
					{architecture&&<><label>Inheritance container<select aria-label="Parent infrastructure container" value={resource.parentId??''} onChange={event=>dispatch({type:'placeResource',id:resource.id,parentId:event.target.value||undefined,mode:'visual'})}><option value="">Canvas · no inheritance</option>{architecture.resources.filter(item=>item.id!==resource.id&&isResourceContainer(item)).map(parent=>{const placement=resourcePlacement(architecture,resource,parent.id);return <option key={parent.id} value={parent.id} disabled={!placement.ok||placement.parentId!==parent.id}>{parent.name} · {resourceDefinition(parent).label}{!placement.ok?' — incompatible':''}</option>;})}</select></label>
					<label>Visual container<select aria-label="Visual resource container" value={visualParentId(resource)??''} onChange={event=>dispatch({type:'placeResource',id:resource.id,visualParentId:event.target.value||null,mode:'visual'})}><option value="">Canvas</option>{architecture.resources.filter(item=>item.id!==resource.id&&isResourceContainer(item)).map(parent=><option key={parent.id} value={parent.id} disabled={!visualResourcePlacement(architecture,resource,parent.id).ok}>{parent.name} · {resourceDefinition(parent).label}</option>)}</select></label><p className="field-help">Visual grouping can differ from inheritance. Resource references determine network attachments.</p></>}
					<details className="field-change-guide"><summary>Before changing existing infrastructure</summary><p>Provider rules and the current state determine whether a change updates, restarts or replaces a resource. Review a Terraform plan before applying. The diagram does not evaluate replacement impact.</p><a href="https://developer.hashicorp.com/terraform/cli/commands/plan" target="_blank" rel="noreferrer">Understand Terraform plans</a></details>
				</div>
			</details>
			<details className="form-section" open>
				<summary>Main Parameters</summary>
				<div className="form-section-body">
					{regionAttribute(resource)&&<SchemaField name="Region" value={resource.region} definition={{name:'region',type:'string',description:'Cloud region for this resource.',options:regionOptions}} onChange={value => dispatch({ type:'update', id:resource.id, patch:{region:value} })} {...binding({kind:'region'})}/>}
					{!properties.length && !Object.keys(resource.settings).length && resource.kind !== 'module' && <p className="field-help" role="status">Documented fields are not available yet. Existing source is preserved; use Terraform while the catalogue loads or import the matching provider schema.</p>}
					{settings.filter(([name]) => !poolFields.includes(name)).map(([name, value]) => field(name, value))}
					{settings.some(([name]) => poolFields.includes(name)) && <details className="nested-block" open>
						<summary>Default Node Pool<span>{poolFields.length} fields</span></summary>
						<div className="nested-block-body">{settings.filter(([name]) => poolFields.includes(name)).map(([name, value]) => field(name, value))}</div>
					</details>}
				</div>
			</details>
			{resource.kind === 'module' && moduleInspection && (
				<details className="form-section module-inspection-section" open>
					<summary>Child module interface<span className="schema-type">{moduleInspection.inspection ? moduleInspection.inspection.status : 'Rust Stage 7'}</span></summary>
					<div className="form-section-body">
						<div className="module-inspect-actions">
							<button type="button" className="quiet-button" disabled={moduleInspection.loading} onClick={moduleInspection.onInspect}>
								{moduleInspection.loading ? 'Inspecting module…' : moduleInspection.inspection ? 'Refresh module inspection' : 'Inspect child module'}
							</button>
						</div>
						{moduleInspection.error && <p className="field-help module-inspect-error">{moduleInspection.error}</p>}
						{moduleInspection.inspection && (
							<div className="module-inspect-details">
								<p className="field-help"><code>{moduleInspection.inspection.sourceKind}</code> · <code>{moduleInspection.inspection.source}</code></p>
								{moduleInspection.inspection.variables.length > 0 && (
									<div className="module-inspect-group">
										<strong>Inputs ({moduleInspection.inspection.variables.length})</strong>
										<ul>
											{moduleInspection.inspection.variables.map(item => (
												<li key={item.name}>
													<code>{item.name}</code>
													{item.typeExpr && <small>{item.typeExpr}</small>}
													{item.required && <em>required</em>}
													{item.sensitive && <em>sensitive</em>}
												</li>
											))}
										</ul>
									</div>
								)}
								{moduleInspection.inspection.outputs.length > 0 && (
									<div className="module-inspect-group">
										<strong>Outputs ({moduleInspection.inspection.outputs.length})</strong>
										<ul>
											{moduleInspection.inspection.outputs.map(item => (
												<li key={item.name}>
													<code>{item.name}</code>
													{item.sensitive && <em>sensitive</em>}
												</li>
											))}
										</ul>
									</div>
								)}
								{moduleInspection.inspection.childModules.length > 0 && (
									<div className="module-inspect-group">
										<strong>Nested child modules ({moduleInspection.inspection.childModules.length})</strong>
										<ul>
											{moduleInspection.inspection.childModules.map(child => (
												<li key={child.name}><code>{child.name}</code><small>{child.source}</small></li>
											))}
										</ul>
									</div>
								)}
							</div>
						)}
					</div>
				</details>
			)}
			<NestedBlocks blocks={resource.blocks} definitions={additionalBlocks(resource, liveSchemas)} scope="resource" resource={resource} architecture={architecture} dispatch={dispatch} onManageVariables={onManageVariables} onRevealResource={onRevealResource} liveSchemas={liveSchemas} onConfigureTerraform={onConfigureTerraform}
				onChange={blocks => dispatch({ type: 'update', id: resource.id, patch: { blocks } })} />
			{(resource.catalogue || liveSchema) && <details className="form-section advanced-properties"><summary>Advanced properties<span className="schema-type">{liveSchema ? liveSchema.providerSource + ' ' + liveSchema.providerVersion : 'Optional additions'}</span></summary><div className="form-section-body"><p className="field-help">{liveSchema ? 'Add optional arguments from the imported Rust provider schema. Check its version against your architecture lock file. Required arguments stay in Main Parameters.' : 'Add optional arguments from the bundled catalogue. Required arguments stay in Main Parameters.'}</p><label className="add-provider-property">Add property<select aria-label="Add provider property" value="" onChange={event=>{const field=properties.find(field=>field.name===event.target.value);if(field) {dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[field.name]:field.default===undefined?'':typeof field.default==='string'?field.default:JSON.stringify(field.default)}}});}}}><option value="">Choose an optional property…</option>{properties.filter(field=>!field.required&&!['name','location','region'].includes(field.name)&&!paths.has(field.name)).map(field=><option key={field.name} value={field.name} title={field.description}>{fieldLabel(field.name)} ({field.name})</option>)}</select></label></div></details>}
   <p className="form-coverage">{liveSchema ? (liveSchema.selection?.lockedVersionVerified ? "Architecture lock matched · " : "Imported schema · ") + liveSchema.providerSource + " " + liveSchema.providerVersion : formEvidence?.schemaCapture ? "Captured provider schema · " + formEvidence.schemaCapture.provider + " " + formEvidence.schemaCapture.version + ". Compare this version with your architecture lock. Local shape checks do not replace provider validation." : "Schema details unavailable for this resource."}</p>
   {onConfigureTerraform && <details className="form-section additional-configuration" open={additional.length>0}><summary>Additional configuration{additional.length>0&&<span className="schema-type">Configured in Terraform</span>}</summary><div className="form-section-body"><p className="field-help">Use Form for ordinary values, lists, maps and nested blocks. Terraform expressions and dynamic blocks use the same resource-scoped code editor and Undo history.</p>{additional.map(item=><div className="additional-config-item" key={item.path}><strong>{item.path}</strong><p className="field-help">{item.description}</p><button type="button" onClick={()=>onConfigureTerraform(item.query)}>Configure in Terraform</button></div>)}{additional.length===0&&<button type="button" onClick={()=>onConfigureTerraform()}>Configure in Terraform</button>}<p className="field-help">Additional code is preserved after Apply. Provider validation is shown only when available; Save still opens the guarded file review.</p>{formEvidence?.url&&<a href={liveSchema?.docsUrl || formEvidence.url} target="_blank" rel="noreferrer">Provider documentation for this resource</a>}{formEvidence?.exampleHcl&&<details className="provider-example"><summary>Provider documentation example</summary><p className="field-help">Captured from the recorded provider documentation and parsed locally. This example has not been executed or adapted to your resource; its compatibility with the selected schema has not been established.</p><pre>{formEvidence.exampleHcl}</pre></details>}</div></details>}
   {!liveSchema && formEvidence && <details className="form-coverage form-coverage-gaps"><summary>{formEvidence.unmappedArgumentNames.length || !formEvidence.argumentSectionRecognized ? 'Documentation differences from captured schema' : 'Documentation source and version'}</summary><p>{formEvidence.matchesDeclaredVersionTag ? 'Documentation matches the declared catalogue version.' : 'Documentation version applicability is unverified. Import the matching provider schema before relying on these fields.'}</p>{formEvidence.url && <a href={formEvidence.url} target="_blank" rel="noreferrer">Open recorded provider documentation</a>}{formEvidence.unmappedArgumentNames.length > 0 && <ul>{formEvidence.unmappedArgumentNames.map(name => <li key={name}><code>{name}</code> · absent from this captured provider schema</li>)}</ul>}</details>}
   {liveSchema?.coverage && (coverageGaps.length === 0
    ? <p className="form-coverage">No reported editable paths need a code-only editor · {liveSchema.coverage.paths} schema paths{liveSchema.coverage.readOnly ? ', ' + liveSchema.coverage.readOnly + ' read-only outputs' : ''}.</p>
    : <details className="form-coverage form-coverage-gaps"><summary>Schema details unavailable for {coverageGaps.length} {coverageGaps.length === 1 ? 'path' : 'paths'}</summary><p>Import the matching provider schema to establish the field types and nesting. These paths are not verified as code-only configuration.</p><ul>{coverageGaps.map(gap => <li key={gap.path}><code>{gap.path}</code> {gap.reason}</li>)}</ul></details>)}
		</div>
	);
}

function NestedBlocks({ blocks, definitions, scope, onChange, resource, architecture, dispatch, onManageVariables, onRevealResource, liveSchemas, onConfigureTerraform, parentBlockId }: {
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
	parentBlockId?: string;
	onConfigureTerraform?: (query?:string)=>void;
}) {
	const available = definitions.filter(definition => blocks.filter(block => block.type === definition.type).length < definition.max);
	return (
		<div className="nested-blocks">
			{blocks.map(block => {
			const definition = definitions.find(item => item.type === block.type);
				const label = definition?.label ?? block.type.replaceAll('_', ' ');
				const fields = [...new Set([...(definition?.attributes ?? []).map(field => field.name), ...Object.keys(block.values)])];
				const missing = fields.filter(name => { if(extraFieldValue(resource,{kind:'block',blockId:block.id,name})!==undefined){return false;} if(architecture&&inheritedReference(architecture,resource,fieldTargetPath(resource,{kind:'block',blockId:block.id,name}))){return false;} const key = bindingKey({kind:'block',blockId:block.id,name}); const attribute = definition?.attributes?.find(field => field.name === name); const refBind = resource.resourceRefs?.[key]; if (refBind?.refs.length) { return !!resourceRefBindingIssue(refBind, architecture, resource, attribute); } const binding = resource.fieldBindings?.[key]; return binding ? variableBindingIssue(binding,architecture?.variables??[],attribute) : fieldIssue(block.values[name] ?? '', attribute); }).length;
				function update(next: ResourceBlock) {
					onChange(blocks.map(item => item.id === block.id ? next : item));
				}
				return <details key={block.id} className="nested-block" data-block-type={block.type} open>
					<summary>{label}<span>{blocks.filter(item => item.type === block.type).length > 1 ? '#' + (blocks.filter(item => item.type === block.type).indexOf(block) + 1) + ' · ' : ''}{missing ? missing + ' to review' : fields.length + ' fields'}</span></summary>
					<div className="nested-block-body">
						{definition?.description && <p className="field-help">{definition.description}</p>}
						{!definition && <p className="field-help">Schema unavailable. Existing values are preserved; review against your provider version.</p>}
						{fields.map(name => isComputedField(liveSchemas?.[resourceDefinition(resource).type], fieldTargetPath(resource, { kind: 'block', blockId: block.id, name }).join('.'), resource)
							? <ProviderOutput key={name} name={name} value={block.values[name] ?? ''}/>
							: <SchemaField key={name} name={name} value={block.values[name] ?? ''} definition={definition?.attributes?.find(field => field.name === name)} onChange={value => update({ ...block, values: { ...block.values, [name]: value } })} onUnset={()=>{const values={...block.values};delete values[name];update({...block,values});}} {...fieldState(resource,architecture,{kind:'block',blockId:block.id,name},dispatch,onManageVariables,onRevealResource,liveSchemas,onConfigureTerraform)}/>)}
						<NestedBlocks blocks={block.blocks} definitions={definition?.children ?? []} scope={label} parentBlockId={block.id}
								resource={resource} architecture={architecture} dispatch={dispatch} onManageVariables={onManageVariables} onRevealResource={onRevealResource} liveSchemas={liveSchemas} onConfigureTerraform={onConfigureTerraform} onChange={children => update({ ...block, blocks: children })} />
						<button className="remove-block" onClick={() => onChange(blocks.filter(item => item.id !== block.id))}>Remove {label}</button>
					</div>
				</details>;
			})}
			{definitions.filter(definition => definition.required && !blocks.some(block => block.type === definition.type) && !dynamicBlockConfigured(resource,definition.type,parentBlockId)).map(definition => <p className="required-block-notice" tabIndex={-1} data-block-type={definition.type} key={definition.type}>Required block: {definition.label}. Add it below to configure its fields.</p>)}
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
