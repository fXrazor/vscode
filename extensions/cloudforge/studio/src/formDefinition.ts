/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Resource } from './model.ts';

export interface BlockDefinition {
	type: string;
	label: string;
	max: number;
	fields: Record<string, string>;
	children: BlockDefinition[];
}

/** Small explicit preview definitions. Production forms consume Rust FormSchema. */
export function additionalBlocks(resource: Resource): BlockDefinition[] {
	if (resource.provider !== 'azure') { return []; }
	switch (resource.kind) {
		case 'cluster':
			return [{
				type: 'network_profile', label: 'Network Profile', max: 1,
				fields: { 'Network plugin': 'azure', 'Service CIDR': '10.30.0.0/16' },
				children: [{
					type: 'load_balancer_profile', label: 'Load Balancer Profile', max: 1,
					fields: { 'Managed outbound IP count': '1' }, children: []
				}]
			}];
		case 'network':
			return [{ type: 'subnet', label: 'Subnet', max: 8, fields: { 'Subnet name': 'snet-new', 'Address prefix': '10.20.2.0/24' }, children: [] }];
		case 'storage':
			return [{ type: 'blob_properties', label: 'Blob Properties', max: 1, fields: { 'Versioning enabled': 'true' }, children: [] }];
		case 'gateway':
			return [{ type: 'backend_address_pool', label: 'Backend Address Pool', max: 8, fields: { 'Pool name': 'backend', 'IP address': '10.20.1.4' }, children: [] }];
		default:
			return [];
	}
}
