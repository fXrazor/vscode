/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource } from './model.ts';
import { checkDraft } from './model.ts';
import { resourceDefinition } from './fixture.ts';
import { editableFields, fieldIssue, resourceFormIssues } from './formDefinition.ts';
import { bindingKey, fieldTargetPath, hasRefBinding } from './fieldBindings.ts';
import { getDef } from './cloudlab-core/catalog/index.ts';
import { inheritedReference, resourceAncestors, resourcePlacement } from './resourceHierarchy.ts';
import type { LiveSchemaMap } from './liveSchema.ts';

/** One place a diagnostic points at: a resource and, when known, the inspector field path. */
export type DiagnosticTarget = {resourceId:string;path?:string};
/** A Terraform source position reported by the engine, relative to the architecture root. */
export type DiagnosticLocation = {fileName:string;line?:number;column?:number};
export type Diagnostic = {id:string;resourceId:string;severity:'error'|'warning';path?:string;message:string;source?:'local'|'graph'|'validation'|'cli';code?:string;remediation?:string;
	/** Every resource involved, when there is more than one (for example two overlapping networks). */
	targets?:readonly DiagnosticTarget[];
	/** The Terraform source revision the check ran against; host checks only. */
	sourceRevision?:string;
	location?:DiagnosticLocation};

/** A host diagnostic is stale when it ran on an earlier source revision or its resource no longer exists. */
export function isStaleDiagnostic(finding:Diagnostic, architecture:Architecture, currentRevision?:string):boolean {
	if(finding.sourceRevision&&currentRevision&&finding.sourceRevision!==currentRevision){return true;}
	const ids=(finding.targets?.length?finding.targets.map(target=>target.resourceId):[finding.resourceId]).filter(Boolean);
	return finding.source!==undefined&&finding.source!=='local'&&ids.length>0&&!finding.location&&ids.some(id=>!architecture.resources.some(resource=>resource.id===id));
}
function ipv4Range(text:string) {
	const match=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
	if(!match){return undefined;} const bytes=match.slice(1,5).map(Number); const prefix=Number(match[5]);
	if(bytes.some(value=>value>255)||prefix>32){return undefined;}
	const value=bytes.reduce((sum,byte)=>sum*256+byte,0); const size=2**(32-prefix); const start=Math.floor(value/size)*size;
	return {start,end:start+size-1};
}
function ranges(resource:Resource) {
	const entries=Object.entries(resource.settings).filter(([name])=>['address_space','address_prefixes','cidr_block','ip_cidr_range'].includes(fieldTargetPath(resource,{kind:'setting',name}).join('.')));
	return entries.flatMap(([name,value])=>{let values:unknown=value;try{values=JSON.parse(value);}catch{/* Legacy CIDR text. */}return (Array.isArray(values)?values:[values]).filter((item):item is string=>typeof item==='string').map(value=>({name,value,range:ipv4Range(value)}));});
}

/** Deterministic local feedback; this never represents a Terraform/provider validation run. */
export function architectureDiagnostics(architecture:Architecture, liveSchemas?: LiveSchemaMap):Diagnostic[] {
	const out:Diagnostic[]=[]; const add=(resourceId:string,severity:Diagnostic['severity'],message:string,path?:string)=>out.push({id:[resourceId,path??'',severity,message].join(':'),resourceId,severity,message,path,source:'local'});
	for(const finding of checkDraft(architecture)){add(finding.resourceId,'error',finding.message,'name');}
	for(const resource of architecture.resources){
		const typeName = resourceDefinition(resource).type;
		for(const message of resourceFormIssues(resource,architecture.variables,architecture,liveSchemas)){const at=message.indexOf(':');add(resource.id,'error',message,at>=0?message.slice(0,at).replace(/\[\d+\]/g,''):undefined);}
		for(const field of editableFields(resource,liveSchemas)){
			if(field.name==='name'){continue;}
			const setting=Object.keys(resource.settings).find(name=>fieldTargetPath(resource,{kind:'setting',name}).join('.')===field.name);
			const target=field.name==='location'||field.name==='region'?{kind:'region' as const}:{kind:'setting' as const,name:setting??field.name};
			if(inheritedReference(architecture,resource,[field.name])||resource.fieldBindings?.[bindingKey(target)]||hasRefBinding(resource.resourceRefs?.[bindingKey(target)])){continue;}
			let value=target.kind==='region'?resource.region:resource.settings[setting??field.name]??'';
			if(!resource.catalogue&&field.type==='list'&&value&&!value.startsWith('[')){value=JSON.stringify([value]);}
			if(field.type==='bool'&&['Enabled','Disabled'].includes(value)){value=value==='Enabled'?'true':'false';}
			const issue=fieldIssue(value,field); if(issue){add(resource.id,'error',field.name+': '+issue,field.name);}
		}
		if(resource.parentId&&!resourcePlacement(architecture,resource,resource.parentId).ok){add(resource.id,'error','The parent container is incompatible. Choose a compatible parent or move to the canvas.','parent');}
		if(resourceAncestors(architecture,resource).some(parent=>parent.parentId===resource.id)){add(resource.id,'error','The container hierarchy contains a cycle.','parent');}
		if(!getDef(typeName)&&!liveSchemas?.[typeName]&&resource.kind!=='module'){add(resource.id,'warning','Only primitive catalogue fields are checked; a complete nested schema is unavailable.');}
		for(const item of ranges(resource)){
			if(resource.fieldBindings?.[bindingKey({kind:'setting',name:item.name})]||item.value.startsWith('var.')){continue;}
			if(item.value.includes(':')){add(resource.id,'warning','IPv6 range checks are not available locally.',fieldTargetPath(resource,{kind:'setting',name:item.name}).join('.'));}
			else if(item.value&&!item.range){add(resource.id,'error','Enter a valid IPv4 CIDR range.',fieldTargetPath(resource,{kind:'setting',name:item.name}).join('.'));}
		}
		if(resource.kind==='subnet'||['azurerm_subnet','aws_subnet','google_compute_subnetwork'].includes(resourceDefinition(resource).type)){
			const parent=resourceAncestors(architecture,resource).find(item=>['azurerm_virtual_network','aws_vpc','google_compute_network'].includes(resourceDefinition(item).type));
			const outer=parent?ranges(parent).flatMap(item=>item.range?[item.range]:[]):[];
			for(const item of ranges(resource)){if(item.range&&outer.length&&!outer.some(range=>range.start<=item.range!.start&&range.end>=item.range!.end)){add(resource.id,'error','Subnet address range must fit inside its parent network.',fieldTargetPath(resource,{kind:'setting',name:item.name}).join('.'));}}
		}
	}
	const networks=architecture.resources.filter(resource=>['azurerm_virtual_network','aws_vpc'].includes(resourceDefinition(resource).type));
	for(let index=0;index<networks.length;index++){for(const other of networks.slice(index+1)){const resource=networks[index];if(resource.provider!==other.provider){continue;}if(ranges(resource).some(a=>a.range&&ranges(other).some(b=>b.range&&a.range!.start<=b.range.end&&b.range.start<=a.range!.end))){const rangePath=(network:Resource)=>{const first=ranges(network)[0];return first?fieldTargetPath(network,{kind:'setting',name:first.name}).join('.'):'address_space';};const path=rangePath(resource);out.push({id:[resource.id,other.id,'overlap'].join(':'),resourceId:resource.id,severity:'warning',message:'Address ranges overlap with '+other.name+'. Review before connecting these networks.',path,source:'local',targets:[{resourceId:resource.id,path},{resourceId:other.id,path:rangePath(other)}]});}}}
	return [...new Map(out.map(item=>[[item.resourceId,item.severity,item.path,item.message.replace(/^.*?: /,'')].join('|'),item])).values()];
}
