/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Resource } from './model.ts';
import type { HostFormSchema } from './liveSchema.ts';
import { resourceDefinition } from './fixture.ts';

export type FieldImpact = { kind: 'replacement' | 'restart'; source: string; docsUrl?: string };

/** Guidance is advisory. Only a plan against the actual state can confirm an operation. */
export function fieldImpact(resource: Resource, path: string[], schema?: HostFormSchema): FieldImpact | undefined {
	if (schema?.kind === 'dataSource') { return undefined; }
	const field = path.filter(part => !/^\d+$/.test(part)).join('.');
	const description = schema?.attributes.find(attribute => attribute.path === field || attribute.name === field)?.description
		?? resource.catalogue?.fields.find(attribute => attribute.name === field)?.description ?? '';
	const version = schema?.providerVersion ?? resource.catalogue?.providerVersion;
	const source = schema ? 'Workspace schema · ' + schema.providerVersion : version ? 'Catalogue guidance · ' + version : undefined;
	// Avoid unrelated words such as auto_replace_on_failure or replacement environment.
	if (source && /forces? (?:a )?new (?:resource|\w+(?: \w+){0,6})|changing[^.\n]{0,80}requires? replacement|changing[^.\n]{0,80}(?:recreat|replac)/i.test(description)) {
		return { kind: 'replacement', source, docsUrl: schema?.docsUrl?.startsWith('https://') ? schema.docsUrl : undefined };
	}
	const type = resourceDefinition(resource).type;
	// Explicit provider documentation, pinned to the bundled snapshot versions. Never carry these
	// rules into another live provider version without matching evidence.
	if (type === 'azurerm_resource_group' && (!version || version === '5.14.0') && ['name', 'location'].includes(field)) {
		return { kind: 'replacement', source: 'Provider docs · AzureRM 5.14.0', docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/5.14.0/docs/resources/resource_group' };
	}
	if (type === 'google_compute_instance' && (!version || version === '8.10.0')) {
		const docsUrl = 'https://registry.terraform.io/providers/hashicorp/google/8.10.0/docs/resources/compute_instance';
		if (['name', 'hostname', 'metadata_startup_script', 'resource_policies'].includes(field)) { return { kind: 'replacement', source: 'Provider docs · Google 8.10.0', docsUrl }; }
		if (['machine_type', 'min_cpu_platform', 'service_account'].includes(field)) { return { kind: 'restart', source: 'Provider docs · Google 8.10.0', docsUrl }; }
	}
	return undefined;
}
