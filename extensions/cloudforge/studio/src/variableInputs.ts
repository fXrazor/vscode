/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { variableError, type VariableDefinition, type VariableValue } from './variables.ts';

export const variableInputTypes: Record<VariableDefinition['type'], { label:string; example:string; help:string }> = {
	string: { label:'Text', example:'uksouth', help:'Plain text. Leave it empty to use an empty string.' },
	number: { label:'Number', example:'2', help:'A number, such as 2 or 0.5. Do not add quotes.' },
	bool: { label:'True / false', example:'false', help:'Choose true or false. False is a value, not a missing input.' },
	'list(string)': { label:'List of text', example:'["web", "api"]', help:'A JSON array of quoted text values, such as ["web", "api"].' },
	'map(string)': { label:'Map of text', example:'{"team": "platform"}', help:'A JSON object with text keys and values, such as {"team": "platform"}.' },
	object: { label:'Object (nested values)', example:'{"address_space": ["10.0.0.0/16"], "dns": {"enabled": true}}', help:'A JSON object whose keys are Terraform names, such as {"cidr": "10.0.0.0/16", "dns": {"enabled": true}}. Fields can use one value from it, such as var.network.cidr.' },
	any: { label:'Any JSON value', example:'{"enabled": true}', help:'Valid JSON: text in quotes, a number, true/false, a list, an object or null.' }
};

/** Shared parsing for typed editor feedback and Save; never evaluates expressions. */
export function parseVariableInput(text:string,type:VariableDefinition['type']):VariableValue {
	let value:VariableValue;
	try { value=type==='string'?text:JSON.parse(text); }
	catch { throw new Error(variableInputTypes[type].help); }
	const issue=variableError({id:'input-preview',name:'input_preview',description:'',sensitive:false,type,defaultValue:value},[]);
	if(issue){throw new Error(variableInputTypes[type].help);}
	return value;
}

export function variableInputIssue(text:string,type:VariableDefinition['type']):string|undefined {
	try { parseVariableInput(text,type); return undefined; }
	catch(error){return error instanceof Error?error.message:'Check the value.';}
}
