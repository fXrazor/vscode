/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';

/**
 * Some cloud resources can only be attached to one consumer at a time: a NIC belongs to one VM, a public IP to one
 * frontend, a disk to one attachment. A rule names the target type and the fields that attach it; a target that
 * another resource already references through one of those fields is "in use" and cannot be picked again.
 * Other references (an NSG association pointing at the same NIC, many VMs in one subnet) are not affected.
 */
type ExclusiveRule = { target: string; fields: RegExp };

const rules: readonly ExclusiveRule[] = [
	{ target: 'azurerm_network_interface', fields: /^(network_interface_ids|primary_network_interface_id)$/ },
	{ target: 'azurerm_public_ip', fields: /^public_ip_address_id$/ },
	{ target: 'azurerm_managed_disk', fields: /^managed_disk_id$/ },
	{ target: 'aws_network_interface', fields: /^network_interface_id$/ },
	{ target: 'aws_eip', fields: /^allocation_id$/ },
	{ target: 'aws_ebs_volume', fields: /^volume_id$/ },
	{ target: 'google_compute_address', fields: /^nat_ip$/ },
	{ target: 'google_compute_disk', fields: /^source$/ },
];

function ruleFor(targetType: string, field: string): ExclusiveRule | undefined {
	return rules.find(rule => rule.target === targetType && rule.fields.test(field));
}

function keyField(key: string): string | undefined {
	try {
		const parts = JSON.parse(key) as unknown;
		return Array.isArray(parts) && typeof parts[parts.length - 1] === 'string' ? parts[parts.length - 1] as string : undefined;
	} catch {
		return undefined;
	}
}

/** Whether referencing `targetType` from `field` attaches the target exclusively. */
export function isExclusiveReference(targetType: string, field: string): boolean {
	return !!ruleFor(targetType, field);
}

/**
 * The other resource that already holds `target` through an exclusive attachment, when `field` is one of those
 * attachments. The resource being edited never counts against itself.
 */
export function exclusiveReferenceHolder(architecture: Architecture, resource: Resource, field: string, target: Resource): Resource | undefined {
	const rule = ruleFor(resourceDefinition(target).type, field);
	if (!rule) { return undefined; }
	return architecture.resources.find(other => other.id !== resource.id && other.id !== target.id && Object.entries(other.resourceRefs ?? {}).some(([key, binding]) => {
		const name = keyField(key);
		return !!name && rule.fields.test(name) && binding.refs.some(entry => entry.resourceId === target.id);
	}));
}
