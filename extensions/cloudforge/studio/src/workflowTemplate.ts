/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, BoardItem, Position } from './model.ts';
import type { ShapeId } from './shapes.ts';

/** A diagramming starter, not executable infrastructure or a deployment action. */
export function workflowTemplate(origin:Position,prefix:string):Architecture {
	const item=(key:string,text:string,shape:ShapeId,x:number,y:number):BoardItem=>({id:prefix+'-'+key,kind:'shape',shape,text,width:180,height:100,fontSize:14,fill:'#eef2ff',positions:{visual:{x:origin.x+x,y:origin.y+y},technical:{x:origin.x+x,y:origin.y+y}},members:[]});
	const items=[item('start','Change request','terminator',0,130),item('plan','Review Terraform plan','document',250,130),item('decision','Approved?','decision',500,130),item('revise','Revise configuration','process',500,-60),item('apply','Apply changes','process',750,130),item('end','Verify infrastructure','terminator',1000,130)];
	return {name:'Deployment review workflow',resources:[],items,connections:[['start','plan',''],['plan','decision',''],['decision','revise','No'],['revise','plan','Review again'],['decision','apply','Yes'],['apply','end','']].map(([source,target,label],index)=>({id:prefix+'-link-'+index,source:prefix+'-'+source,target:prefix+'-'+target,label,routing:'elbow'}))};
}
