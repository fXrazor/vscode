/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { AttrDef } from './cloudlab-core/catalog/index.ts';

/** Provider names that differ from the argument stem (`public_ip_address_id` points at `azurerm_public_ip`). */
const aliases: Record<string, string> = {
	azurerm_public_ip_address: 'azurerm_public_ip',
	aws_vpc_security_group: 'aws_security_group',
};
/** Stems that name an identity or tenant value rather than a resource on the board. */
const ignored = new Set(['tenant', 'subscription', 'client', 'object', 'principal', 'application', 'user', 'account', 'owner', 'parent', 'resource']);

/**
 * Most provider arguments that hold another resource's ID are named after it (`subnet_id`, `network_interface_ids`,
 * `vpc_security_group_ids`). Only about fifty are curated, so the rest of the 1,000+ catalogue types infer the target
 * type from the name. The Reference control for an inferred type only appears once a matching resource is on the board.
 */
export function withInferredReferenceTypes(resourceType: string, definition: AttrDef | undefined): AttrDef | undefined {
	if (!definition || definition.refTypes?.length || definition.sensitive) { return definition; }
	const match = /^([a-z][a-z0-9_]*?)_(ids?)$/.exec(definition.name);
	if (!match || (match[2] === 'id' ? definition.type !== 'string' : definition.type !== 'list') || ignored.has(match[1])) { return definition; }
	const prefix = resourceType.slice(0, resourceType.indexOf('_'));
	if (!prefix) { return definition; }
	const type = prefix + '_' + match[1];
	return { ...definition, refTypes: [aliases[type] ?? type], refInferred: true };
}
