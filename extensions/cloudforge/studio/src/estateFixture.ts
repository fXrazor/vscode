/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A large multi-cloud estate for the Technical Graph: several Azure resource groups with many
 * hub/spoke VNets and subnets, two AWS VPCs joined by a transit gateway, and two Google Cloud
 * projects with VPC networks and GKE. Every edge comes from a configured reference, so scopes,
 * clustering and separation can be checked at realistic scale. Preview with `?sample=estate`.
 */
import type { Architecture, Provider, Resource } from './model.ts';
import { bindingKey } from './fieldBindings.ts';
import { coreIcons } from './coreIcons.ts';

type Ref = [field: string, resourceId: string, attribute?: string];
const azureIcons: Record<string, [string, string, string]> = {
	azurerm_resource_group: ['Resource group', 'azure-resource-groups.svg', 'Management'],
	azurerm_virtual_network: ['Virtual network', 'azure-virtual-networks.svg', 'Network'],
	azurerm_subnet: ['Subnet', 'azure-subnet.svg', 'Network'],
	azurerm_virtual_network_peering: ['VNet peering', 'azure-virtual-networks.svg', 'Network'],
	azurerm_network_security_group: ['Network security group', 'azure-network-security-groups.svg', 'Security'],
	azurerm_subnet_network_security_group_association: ['Subnet NSG association', 'azure-network-security-groups.svg', 'Security'],
	azurerm_firewall: ['Azure Firewall', 'azure-firewall-manager.svg', 'Security'],
	azurerm_kubernetes_cluster: ['Kubernetes cluster', 'azure-kubernetes-services.svg', 'Containers'],
	azurerm_network_interface: ['Network interface', 'azure-network-interfaces.svg', 'Network'],
	azurerm_linux_virtual_machine: ['Linux virtual machine', 'azure-virtual-machine.svg', 'Compute'],
	azurerm_log_analytics_workspace: ['Log Analytics workspace', 'azure-log-analytics-workspaces.svg', 'Monitoring'],
	azurerm_key_vault: ['Key vault', 'azure-key-vaults.svg', 'Security'],
};
const otherIcons: Record<string, [string, string, string]> = {
	aws_vpc: ['VPC', '', 'Network'], aws_subnet: ['Subnet', '', 'Network'], aws_security_group: ['Security group', '', 'Security'], aws_internet_gateway: ['Internet gateway', '', 'Network'],
	aws_nat_gateway: ['NAT gateway', '', 'Network'], aws_route_table: ['Route table', '', 'Network'], aws_eks_cluster: ['EKS cluster', '', 'Compute'], aws_db_instance: ['RDS database', '', 'Database'],
	aws_ec2_transit_gateway: ['Transit gateway', 'catalog-icons/aws/aws-transit-gateway.svg', 'Network'], aws_ec2_transit_gateway_vpc_attachment: ['Transit gateway attachment', 'catalog-icons/aws/aws-transit-gateway-attachment.svg', 'Network'],
	aws_cloudwatch_log_group: ['CloudWatch log group', 'catalog-icons/aws/aws-cloudwatch.svg', 'Monitoring'],
	google_project: ['Project', '', 'Management'], google_compute_network: ['VPC network', '', 'Network'], google_compute_subnetwork: ['Subnetwork', '', 'Network'], google_compute_firewall: ['Firewall rule', '', 'Security'],
	google_compute_router: ['Cloud Router', 'catalog-icons/gcp/gcp-cloud-router.svg', 'Network'], google_compute_router_nat: ['Cloud NAT', 'catalog-icons/gcp/gcp-cloud-router.svg', 'Network'],
	google_container_cluster: ['GKE cluster', '', 'Compute'], google_sql_database_instance: ['Cloud SQL instance', '', 'Database'],
};

function res(provider: Provider, id: string, type: string, name: string, parentId: string | undefined, refs: Ref[] = [], index = 0): Resource {
	const [label, icon, category] = provider === 'azure' ? azureIcons[type] : otherIcons[type];
	const path = provider === 'azure' ? 'catalog-icons/azure/' + icon : icon || coreIcons[type];
	const resourceRefs: NonNullable<Resource['resourceRefs']> = {};
	for (const [field, target, attribute] of refs) { (resourceRefs[bindingKey({ kind: 'setting', name: field })] ??= { refs: [] }).refs.push({ resourceId: target, attribute: attribute ?? 'id' }); }
	const position = { x: 80 + (index % 10) * 220, y: 80 + Math.floor(index / 10) * 180 };
	const group = type === 'azurerm_resource_group' || type === 'google_project';
	return {
		id, kind: group ? 'group' : 'generic', provider, name, region: provider === 'azure' ? 'UK South' : provider === 'aws' ? 'eu-west-2' : 'europe-west2',
		catalogue: { type, label, service: label, category, icon: path, fields: [] },
		parentId, visualParentId: null, settings: Object.fromEntries(refs.map(([field]) => [field, ''])), blocks: [], resourceRefs,
		positions: { visual: position, technical: position },
	};
}

export function estateArchitecture(): Architecture {
	const out: Resource[] = []; const add = (provider: Provider, id: string, type: string, name: string, parent: string | undefined, refs: Ref[] = []) => { out.push(res(provider, id, type, name, parent, refs, out.length)); return id; };
	// Azure: a connectivity hub, shared services and three workload landing zones, each with several spokes.
	const hubRg = add('azure', 'rg-conn', 'azurerm_resource_group', 'rg-connectivity', undefined);
	const hub = add('azure', 'vnet-hub', 'azurerm_virtual_network', 'vnet-hub-uks', hubRg, [['resource_group_name', hubRg, 'name']]);
	const fwSubnet = add('azure', 'snet-hub-fw', 'azurerm_subnet', 'AzureFirewallSubnet', hub, [['virtual_network_name', hub, 'name']]);
	add('azure', 'afw', 'azurerm_firewall', 'afw-hub', hubRg, [['resource_group_name', hubRg, 'name'], ['subnet_id', fwSubnet]]);
	const sharedRg = add('azure', 'rg-shared', 'azurerm_resource_group', 'rg-shared-services', undefined);
	const log = add('azure', 'log', 'azurerm_log_analytics_workspace', 'log-estate', sharedRg, [['resource_group_name', sharedRg, 'name']]);
	add('azure', 'kv-shared', 'azurerm_key_vault', 'kv-shared', sharedRg, [['resource_group_name', sharedRg, 'name']]);
	for (const zone of ['prod', 'stage', 'dev']) {
		const rg = add('azure', 'rg-' + zone, 'azurerm_resource_group', 'rg-' + zone + '-workloads', undefined);
		for (const spoke of ['app', 'data', 'aks']) {
			const vnet = add('azure', `vnet-${zone}-${spoke}`, 'azurerm_virtual_network', `vnet-${zone}-${spoke}`, rg, [['resource_group_name', rg, 'name']]);
			add('azure', `peer-${zone}-${spoke}`, 'azurerm_virtual_network_peering', `hub-to-${zone}-${spoke}`, hubRg, [['virtual_network_name', hub, 'name'], ['remote_virtual_network_id', vnet]]);
			const nsg = add('azure', `nsg-${zone}-${spoke}`, 'azurerm_network_security_group', `nsg-${zone}-${spoke}`, rg, [['resource_group_name', rg, 'name']]);
			for (const tier of ['a', 'b']) {
				const subnet = add('azure', `snet-${zone}-${spoke}-${tier}`, 'azurerm_subnet', `snet-${zone}-${spoke}-${tier}`, vnet, [['virtual_network_name', vnet, 'name']]);
				add('azure', `nsga-${zone}-${spoke}-${tier}`, 'azurerm_subnet_network_security_group_association', `${zone}-${spoke}-${tier}-nsg`, rg, [['subnet_id', subnet], ['network_security_group_id', nsg]]);
				if (spoke === 'app') { const nic = add('azure', `nic-${zone}-${tier}`, 'azurerm_network_interface', `nic-${zone}-app-${tier}`, rg, [['resource_group_name', rg, 'name'], ['subnet_id', subnet]]); add('azure', `vm-${zone}-${tier}`, 'azurerm_linux_virtual_machine', `vm-${zone}-app-${tier}`, rg, [['resource_group_name', rg, 'name'], ['network_interface_ids', nic]]); }
				if (spoke === 'aks' && tier === 'a') { add('azure', `aks-${zone}`, 'azurerm_kubernetes_cluster', `aks-${zone}`, rg, [['resource_group_name', rg, 'name'], ['vnet_subnet_id', subnet], ['log_analytics_workspace_id', log]]); }
			}
		}
	}
	// AWS: two VPCs on a transit gateway.
	const tgw = add('aws', 'tgw', 'aws_ec2_transit_gateway', 'tgw-core', undefined);
	const cw = add('aws', 'cw', 'aws_cloudwatch_log_group', '/estate/flow-logs', undefined);
	for (const name of ['prod', 'shared']) {
		const vpc = add('aws', 'vpc-' + name, 'aws_vpc', 'vpc-' + name, undefined);
		add('aws', 'igw-' + name, 'aws_internet_gateway', 'igw-' + name, vpc, [['vpc_id', vpc]]);
		const sg = add('aws', 'sg-' + name, 'aws_security_group', 'sg-' + name + '-app', vpc, [['vpc_id', vpc]]);
		const rt = add('aws', 'rt-' + name, 'aws_route_table', 'rt-' + name + '-private', vpc, [['vpc_id', vpc]]);
		const subnets = ['a', 'b', 'c'].map(az => add('aws', `sn-${name}-${az}`, 'aws_subnet', `${name}-private-${az}`, vpc, [['vpc_id', vpc]]));
		add('aws', 'nat-' + name, 'aws_nat_gateway', 'nat-' + name, vpc, [['subnet_id', subnets[0]]]);
		add('aws', 'tgwa-' + name, 'aws_ec2_transit_gateway_vpc_attachment', 'tgw-' + name, vpc, [['transit_gateway_id', tgw], ['vpc_id', vpc], ['subnet_ids', subnets[1]]]);
		void rt;
		if (name === 'prod') {
			add('aws', 'eks-prod', 'aws_eks_cluster', 'eks-prod', vpc, [['subnet_ids', subnets[0]], ['security_group_ids', sg], ['enabled_cluster_log_types', cw]]);
			add('aws', 'rds-prod', 'aws_db_instance', 'rds-orders', vpc, [['db_subnet_group_name', subnets[2]], ['vpc_security_group_ids', sg]]);
		}
	}
	// Google Cloud: two projects, each with its own VPC network.
	for (const name of ['platform', 'analytics']) {
		const project = add('gcp', 'prj-' + name, 'google_project', 'prj-' + name, undefined);
		const net = add('gcp', 'net-' + name, 'google_compute_network', 'vpc-' + name, project, [['project', project, 'project_id']]);
		const subnets = ['euw2', 'euw1'].map(region => add('gcp', `sub-${name}-${region}`, 'google_compute_subnetwork', `${name}-${region}`, net, [['network', net], ['project', project, 'project_id']]));
		add('gcp', 'fw-' + name, 'google_compute_firewall', 'allow-internal-' + name, net, [['network', net]]);
		const router = add('gcp', 'rtr-' + name, 'google_compute_router', 'router-' + name, net, [['network', net]]);
		add('gcp', 'nat-' + name, 'google_compute_router_nat', 'nat-' + name, net, [['router', router, 'name']]);
		if (name === 'platform') { add('gcp', 'gke', 'google_container_cluster', 'gke-platform', project, [['network', net], ['subnetwork', subnets[0]], ['project', project, 'project_id']]); }
		else { add('gcp', 'sql', 'google_sql_database_instance', 'sql-analytics', project, [['project', project, 'project_id'], ['private_network', net]]); }
	}
	return { name: 'Multi-cloud estate', items: [], connections: [], resources: out, variables: [] };
}
