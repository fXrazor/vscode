/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Dispatch } from 'react';
import type { Action, Resource, ResourceBlock } from './model.ts';
import { providerRegions, resourceTypes, resourceDefinition } from './fixture.ts';
import type { ResourceKind } from './model.ts';
import { additionalBlocks, type BlockDefinition } from './formDefinition.ts';

export function ResourceFields({ resource, dispatch }: { resource: Resource; dispatch: Dispatch<Action> }) {

 function field(name:string,value:string) {
  const definition=resource.catalogue?.fields.find(field=>field.name===name);
  const update=(value:string)=>dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[name]:value}}});
  return <label key={name} className="provider-field" title={definition?.description}>
   <span>{name}{definition?.required&&<span className="field-required"> *</span>}</span>
   {definition?.type==='bool'?<select value={value} onChange={event=>update(event.target.value)}><option value="">Not set</option><option value="true">true</option><option value="false">false</option></select>:
    definition?.options?.length?<select value={value} onChange={event=>update(event.target.value)}><option value="">Not set</option>{definition.options.map(option=><option key={option}>{option}</option>)}</select>:
    <input type={definition?.sensitive?'password':definition?.type==='number'?'number':'text'} value={value} onChange={event=>update(event.target.value)} />}
  </label>;
 }

	const poolFields = resource.kind === 'cluster' ? ['Node count', 'VM size'] : [];
	const settings = Object.entries(resource.settings);
	return (
		<div className="resource-fields">
			<details className="form-section">
				<summary>Graphics</summary>
				<div className="form-section-body">
					<label>Icon<select value={resource.iconKind ?? resource.kind} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { iconKind: event.target.value as ResourceKind } })}>
						{Object.keys(resourceTypes).map(kind => <option key={kind} value={kind}>{resourceDefinition({ kind: kind as ResourceKind, provider: resource.provider }).label}</option>)}
					</select></label>
					<label>Resource label<input value={resource.label ?? ''} placeholder={resource.name} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { label: event.target.value } })} /></label>
				</div>
			</details>
			<details className="form-section" open>
				<summary>Metadata<span className="schema-type">{resourceDefinition(resource).type}</span></summary>
				<div className="form-section-body">
					<label>Resource name<input value={resource.name} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { name: event.target.value } })} /></label>
					<label>Terraform identifier<input readOnly value={resource.terraformName ?? resource.name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]/, '_$&')} /></label>
					<label>File name<input readOnly value="main.tf" /></label>
				</div>
			</details>
			<details className="form-section" open>
				<summary>Main Parameters</summary>
				<div className="form-section-body">
					<label>Region<select value={resource.region} onChange={event => dispatch({ type: 'update', id: resource.id, patch: { region: event.target.value } })}>
						{providerRegions[resource.provider].map(region => <option key={region}>{region}</option>)}
					</select></label>
					{settings.filter(([name]) => !poolFields.includes(name)).map(([name, value]) => field(name, value))}
					{settings.some(([name]) => poolFields.includes(name)) && <details className="nested-block" open>
						<summary>Default Node Pool<span>{poolFields.length} fields</span></summary>
						<div className="nested-block-body">{settings.filter(([name]) => poolFields.includes(name)).map(([name, value]) => field(name, value))}</div>
					</details>}
				</div>
			</details>
			<NestedBlocks blocks={resource.blocks} definitions={additionalBlocks(resource)} scope="resource"
				onChange={blocks => dispatch({ type: 'update', id: resource.id, patch: { blocks } })} />
			{resource.catalogue && <label className="add-provider-property">Add property<select aria-label="Add provider property" value="" onChange={event=>{const field=resource.catalogue!.fields.find(field=>field.name===event.target.value);if(field) {dispatch({type:'update',id:resource.id,patch:{settings:{...resource.settings,[field.name]:field.default===undefined?'':String(field.default)}}});}}}><option value="">Choose an optional property…</option>{resource.catalogue.fields.filter(field=>!['name','location','region'].includes(field.name)&&!Object.hasOwn(resource.settings,field.name)).map(field=><option key={field.name} value={field.name}>{field.name}</option>)}</select></label>}
   <p className="form-coverage">{resource.catalogue?'Imported primitive properties · nested provider blocks and validation await integration':'Sample form definition'}</p>
		</div>
	);
}

function NestedBlocks({ blocks, definitions, scope, onChange }: {
	blocks: ResourceBlock[];
	definitions: BlockDefinition[];
	scope: string;
	onChange: (blocks: ResourceBlock[]) => void;
}) {
	const available = definitions.filter(definition => blocks.filter(block => block.type === definition.type).length < definition.max);
	return (
		<div className="nested-blocks">
			{blocks.map((block, index) => {
				const definition = definitions.find(item => item.type === block.type);
				if (!definition) { return null; }
				function update(next: ResourceBlock) {
					onChange(blocks.map(item => item.id === block.id ? next : item));
				}
				return <details key={block.id} className="nested-block" open>
					<summary>{definition.label}<span>{index + 1}</span></summary>
					<div className="nested-block-body">
						{Object.entries(block.values).map(([name, value]) => <label key={name}>{name}
							<input value={value} onChange={event => update({ ...block, values: { ...block.values, [name]: event.target.value } })} />
						</label>)}
						<NestedBlocks blocks={block.blocks} definitions={definition.children} scope={definition.label}
							onChange={children => update({ ...block, blocks: children })} />
						<button className="remove-block" onClick={() => onChange(blocks.filter(item => item.id !== block.id))}>Remove {definition.label}</button>
					</div>
				</details>;
			})}
			{available.length > 0 && <details className="add-blocks">
				<summary>Add Blocks<span>＋</span></summary>
				<div className="add-block-options">{available.map(definition => (
					<button key={definition.type} aria-label={'Add ' + definition.label + ' to ' + scope} onClick={() => onChange([...blocks, {
						id: crypto.randomUUID(), type: definition.type, values: { ...definition.fields }, blocks: []
					}])}>＋ {definition.label}<small>{definition.max === 1 ? 'Single block' : 'Repeatable block'}</small></button>
				))}</div>
			</details>}
		</div>
	);
}
