/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Representative Technical Graph fixture: Azure hub/spoke with AKS, a VM workload, Key Vault,
 * storage and monitoring. Every relationship comes from a configured field binding or inherited
 * parent field, so the graph exercises evidence-backed edges, rows, hub/spoke recognition and
 * membership. Preview with `?sample=hub-spoke`.
 */
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { bindingKey } from './fieldBindings.ts';

type Ref = [field: string, resourceId: string, attribute?: string];
type BlockRef = [block: string, field: string, resourceId: string, attribute?: string];
const icons: Record<string, [label: string, icon: string, category: string]> = {
	azurerm_resource_group: ['Resource group', 'azure-resource-groups.svg', 'Management'],
	azurerm_virtual_network: ['Virtual network', 'azure-virtual-networks.svg', 'Network'],
	azurerm_subnet: ['Subnet', 'azure-subnet.svg', 'Network'],
	azurerm_virtual_network_peering: ['VNet peering', 'azure-virtual-networks.svg', 'Network'],
	azurerm_public_ip: ['Public IP address', 'azure-public-ip-addresses.svg', 'Network'],
	azurerm_firewall: ['Azure Firewall', 'azure-firewall-manager.svg', 'Security'],
	azurerm_network_security_group: ['Network security group', 'azure-network-security-groups.svg', 'Security'],
	azurerm_subnet_network_security_group_association: ['Subnet NSG association', 'azure-network-security-groups.svg', 'Security'],
	azurerm_route_table: ['Route table', 'azure-route-tables.svg', 'Network'],
	azurerm_subnet_route_table_association: ['Subnet route association', 'azure-route-tables.svg', 'Network'],
	azurerm_user_assigned_identity: ['Managed identity', 'azure-external-identities.svg', 'Identity'],
	azurerm_role_assignment: ['Role assignment', 'azure-ad-roles-and-administrators.svg', 'Identity'],
	azurerm_kubernetes_cluster: ['Kubernetes cluster', 'azure-kubernetes-services.svg', 'Containers'],
	azurerm_key_vault: ['Key vault', 'azure-key-vaults.svg', 'Security'],
	azurerm_storage_account: ['Storage account', 'azure-storage-accounts.svg', 'Storage'],
	azurerm_network_interface: ['Network interface', 'azure-network-interfaces.svg', 'Network'],
	azurerm_linux_virtual_machine: ['Linux virtual machine', 'azure-virtual-machine.svg', 'Compute'],
	azurerm_log_analytics_workspace: ['Log Analytics workspace', 'azure-log-analytics-workspaces.svg', 'Monitoring'],
	azurerm_monitor_diagnostic_setting: ['Diagnostic setting', 'azure-diagnostics-settings.svg', 'Monitoring'],
};

let column = 0;
function r(id: string, type: string, name: string, parentId: string | undefined, refs: Ref[] = [], blockRefs: BlockRef[] = []): Resource {
	const [label, icon, category] = icons[type];
	const blocks: ResourceBlock[] = [...new Set(blockRefs.map(([block]) => block))].map(block => ({ id: id + ':' + block, type: block, values: {}, blocks: [] }));
	const resourceRefs: NonNullable<Resource['resourceRefs']> = {};
	for (const [field, target, attribute] of refs) { (resourceRefs[bindingKey({ kind: 'setting', name: field })] ??= { refs: [] }).refs.push({ resourceId: target, attribute: attribute ?? 'id' }); }
	for (const [block, field, target, attribute] of blockRefs) { (resourceRefs[bindingKey({ kind: 'block', blockId: id + ':' + block, name: field })] ??= { refs: [] }).refs.push({ resourceId: target, attribute: attribute ?? 'id' }); }
	const index = column++; const position = { x: 80 + (index % 6) * 240, y: 80 + Math.floor(index / 6) * 200 };
	return {
		id, kind: type === 'azurerm_resource_group' ? 'group' : 'generic', provider: 'azure', name, region: type.includes('association') || type.includes('role_assignment') || type.includes('diagnostic') || type.includes('peering') ? '' : 'UK South',
		catalogue: { type, label, service: label, category, icon: 'catalog-icons/azure/' + icon, fields: [] },
		parentId, visualParentId: null, settings: Object.fromEntries(refs.map(([field]) => [field, ''])), blocks, resourceRefs,
		positions: { visual: position, technical: position },
	};
}

export function hubSpokeArchitecture(): Architecture {
	column = 0;
	const resources: Resource[] = [
		r('rg-hub', 'azurerm_resource_group', 'rg-connectivity', undefined),
		r('rg-app', 'azurerm_resource_group', 'rg-platform', undefined),
		r('vnet-hub', 'azurerm_virtual_network', 'vnet-hub', 'rg-hub', [['resource_group_name', 'rg-hub', 'name']]),
		r('vnet-aks', 'azurerm_virtual_network', 'vnet-spoke-aks', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('vnet-data', 'azurerm_virtual_network', 'vnet-spoke-data', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('peer-aks', 'azurerm_virtual_network_peering', 'hub-to-aks', 'rg-hub', [['virtual_network_name', 'vnet-hub', 'name'], ['remote_virtual_network_id', 'vnet-aks']]),
		r('peer-data', 'azurerm_virtual_network_peering', 'hub-to-data', 'rg-hub', [['virtual_network_name', 'vnet-hub', 'name'], ['remote_virtual_network_id', 'vnet-data']]),
		r('snet-fw', 'azurerm_subnet', 'AzureFirewallSubnet', 'vnet-hub', [['virtual_network_name', 'vnet-hub', 'name']]),
		r('snet-aks', 'azurerm_subnet', 'snet-aks-nodes', 'vnet-aks', [['virtual_network_name', 'vnet-aks', 'name']]),
		r('snet-app', 'azurerm_subnet', 'snet-app', 'vnet-aks', [['virtual_network_name', 'vnet-aks', 'name']]),
		r('snet-data', 'azurerm_subnet', 'snet-private-endpoints', 'vnet-data', [['virtual_network_name', 'vnet-data', 'name']]),
		r('pip-fw', 'azurerm_public_ip', 'pip-firewall', 'rg-hub', [['resource_group_name', 'rg-hub', 'name']]),
		r('afw', 'azurerm_firewall', 'afw-hub', 'rg-hub', [['resource_group_name', 'rg-hub', 'name']], [['ip_configuration', 'subnet_id', 'snet-fw'], ['ip_configuration', 'public_ip_address_id', 'pip-fw']]),
		r('nsg-aks', 'azurerm_network_security_group', 'nsg-aks-nodes', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('nsga-aks', 'azurerm_subnet_network_security_group_association', 'aks-nodes-nsg', 'rg-app', [['subnet_id', 'snet-aks'], ['network_security_group_id', 'nsg-aks']]),
		r('rt-spoke', 'azurerm_route_table', 'rt-spoke-egress', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('rta-aks', 'azurerm_subnet_route_table_association', 'aks-nodes-routes', 'rg-app', [['subnet_id', 'snet-aks'], ['route_table_id', 'rt-spoke']]),
		r('id-aks', 'azurerm_user_assigned_identity', 'id-aks-control-plane', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('aks', 'azurerm_kubernetes_cluster', 'aks-platform', 'rg-app', [['resource_group_name', 'rg-app', 'name']], [['default_node_pool', 'vnet_subnet_id', 'snet-aks'], ['identity', 'identity_ids', 'id-aks'], ['oms_agent', 'log_analytics_workspace_id', 'log']]),
		r('kv', 'azurerm_key_vault', 'kv-platform', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('ra-kv', 'azurerm_role_assignment', 'aks-secrets-user', 'rg-app', [['principal_id', 'id-aks', 'principal_id'], ['scope', 'kv']]),
		r('st', 'azurerm_storage_account', 'stplatformdata', 'rg-app', [['resource_group_name', 'rg-app', 'name']]),
		r('nic-app', 'azurerm_network_interface', 'nic-app-01', 'rg-app', [['resource_group_name', 'rg-app', 'name']], [['ip_configuration', 'subnet_id', 'snet-app']]),
		r('vm-app', 'azurerm_linux_virtual_machine', 'vm-app-01', 'rg-app', [['resource_group_name', 'rg-app', 'name'], ['network_interface_ids', 'nic-app']]),
		r('log', 'azurerm_log_analytics_workspace', 'log-platform', 'rg-hub', [['resource_group_name', 'rg-hub', 'name']]),
		r('diag-kv', 'azurerm_monitor_diagnostic_setting', 'kv-to-log', 'rg-app', [['target_resource_id', 'kv'], ['log_analytics_workspace_id', 'log']]),
		r('diag-st', 'azurerm_monitor_diagnostic_setting', 'st-to-log', 'rg-app', [['target_resource_id', 'st'], ['log_analytics_workspace_id', 'log']]),
	];
	return { name: 'Hub and spoke platform', items: [], connections: [], resources };
}
