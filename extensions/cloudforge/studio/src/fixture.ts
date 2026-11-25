/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { elementEndpoint } from './connectionEndpoints.ts';
import type { Architecture, Resource, ResourceKind, Provider } from './model.ts';
import { catalogueIconFor } from './catalogue.ts';

export const resourceTypes: Record<ResourceKind, {
	label: string;
	type: string;
	icon: string;
	description: string;
	defaults: Record<string, string>;
}> = {
 generic: { label: "Provider resource", type: "resource", icon: "azure-resource-groups.svg", description: "A resource from the CloudLab provider catalogue.", defaults: {} },
	network: { label: 'Virtual network', type: 'azurerm_virtual_network', icon: 'azure-virtual-networks.svg', description: 'Connect resources within a private network.', defaults: { 'Address space': '10.20.0.0/16' } },
	subnet: { label: 'Subnet', type: 'azurerm_subnet', icon: 'azure-subnet.svg', description: 'Divide a virtual network into address ranges.', defaults: { 'Address prefix': '10.20.1.0/24' } },
	gateway: { label: 'Application gateway', type: 'azurerm_application_gateway', icon: 'azure-application-gateways.svg', description: 'Route incoming web traffic to applications.', defaults: { 'SKU': 'WAF_v2', 'Capacity': '2' } },
	cluster: { label: 'Kubernetes cluster', type: 'azurerm_kubernetes_cluster', icon: 'azure-kubernetes-services.svg', description: 'Run containerised applications on AKS.', defaults: { 'Node count': '3', 'VM size': 'Standard_D4s_v5', 'Private cluster': 'Enabled' } },
	storage: { label: 'Storage account', type: 'azurerm_storage_account', icon: 'azure-storage-accounts.svg', description: 'Store application data and objects.', defaults: { 'Tier': 'Standard', 'Replication': 'ZRS' } },
	monitor: { label: 'Log analytics', type: 'azurerm_log_analytics_workspace', icon: 'azure-log-analytics-workspaces.svg', description: 'Collect and investigate platform logs.', defaults: { 'Retention days': '30' } },
	group: { label: 'Resource group', type: 'azurerm_resource_group', icon: 'azure-resource-groups.svg', description: 'Organise related Azure resources.', defaults: {} },
	compute: { label: 'Virtual machine', type: 'azurerm_linux_virtual_machine', icon: 'azure-virtual-machine.svg', description: 'Run a virtual machine in the architecture.', defaults: { 'Size': 'Standard_D2s_v5' } },
	database: { label: 'SQL database', type: 'azurerm_mssql_database', icon: 'azure-sql-database.svg', description: 'Store relational application data.', defaults: { 'Service tier': 'Basic' } },
	module: { label: 'Terraform module', type: 'module', icon: 'azure-resource-groups.svg', description: 'A source reference to a reusable Terraform module.', defaults: {} }
};

export const providerNames: Record<Provider, string> = { azure: 'Microsoft Azure', aws: 'Amazon Web Services', gcp: 'Google Cloud' };
export const providerRegions: Record<Provider, string[]> = {
	azure: ['UK South', 'UK West', 'West Europe', 'North Europe'],
	aws: ['eu-west-2', 'eu-west-1', 'eu-central-1', 'us-east-1'],
	gcp: ['europe-west2', 'europe-west1', 'us-central1', 'us-east1']
};

const alternateResources: Record<Exclude<Provider, 'azure'>, Record<ResourceKind, [string, string, string]>> = {
	aws: {
 generic: ['Provider resource', 'resource', 'aws-vpc.svg'],		module: ['Terraform module', 'module', 'aws-cloudformation.svg'],
		network: ['VPC', 'aws_vpc', 'aws-vpc.svg'],
		subnet: ['Subnet', 'aws_subnet', 'aws-private-subnet.svg'],
		gateway: ['Load balancer', 'aws_lb', 'aws-elastic-load-balancing.svg'],
		cluster: ['EKS cluster', 'aws_eks_cluster', 'aws-elastic-kubernetes-service.svg'],
		storage: ['S3 bucket', 'aws_s3_bucket', 'aws-simple-storage-service.svg'],
		monitor: ['CloudWatch log group', 'aws_cloudwatch_log_group', 'aws-cloudwatch.svg'],
		group: ['Resource group', 'aws_resourcegroups_group', 'aws-vpc.svg'],
		compute: ['EC2 instance', 'aws_instance', 'aws-ec2.svg'],
		database: ['RDS instance', 'aws_db_instance', 'aws-rds.svg']
	},
	gcp: {
 generic: ['Provider resource', 'resource', 'gcp-project.svg'],		module: ['Terraform module', 'module', 'gcp-project.svg'],
		network: ['VPC network', 'google_compute_network', 'gcp-virtual-private-cloud.svg'],
		subnet: ['Subnetwork', 'google_compute_subnetwork', 'gcp-virtual-private-cloud.svg'],
		gateway: ['Load balancer', 'google_compute_global_forwarding_rule', 'gcp-cloud-load-balancing.svg'],
		cluster: ['GKE cluster', 'google_container_cluster', 'gcp-google-kubernetes-engine.svg'],
		storage: ['Storage bucket', 'google_storage_bucket', 'gcp-cloud-storage.svg'],
		monitor: ['Logging sink', 'google_logging_project_sink', 'gcp-cloud-monitoring.svg'],
		group: ['Project', 'google_project', 'gcp-project.svg'],
		compute: ['Compute instance', 'google_compute_instance', 'gcp-compute-engine.svg'],
		database: ['Cloud SQL instance', 'google_sql_database_instance', 'gcp-cloud-sql.svg']
	}
};

export function resourceDefinition(resource: Pick<Resource, 'kind' | 'provider'> & Partial<Pick<Resource, 'catalogue'>>) {
	const base = resourceTypes[resource.kind];
 if (resource.catalogue) {
		// A projected type with no known icon yet shows the palette icon once its catalogue has loaded.
		const icon = resource.catalogue.iconMatch === 'fallback' ? catalogueIconFor(resource.catalogue.type) ?? resource.catalogue.icon : resource.catalogue.icon;
		return { ...base, ...resource.catalogue, icon, description: resource.catalogue.label, defaults: {} };
	}
	if (resource.provider === 'azure') { return base; }
	const [label, type, icon] = alternateResources[resource.provider][resource.kind];
	return { ...base, label, type, icon, description: label + ' in ' + providerNames[resource.provider] + '.', defaults: {} };
}

export const resourceCategories: { label: string; kinds: ResourceKind[] }[] = [
	{ label: 'Containers', kinds: ['group'] },
	{ label: 'Compute', kinds: ['compute', 'cluster'] },
	{ label: 'Network', kinds: ['network', 'subnet', 'gateway'] },
	{ label: 'Storage', kinds: ['storage'] },
	{ label: 'Databases', kinds: ['database'] },
	{ label: 'Monitoring', kinds: ['monitor'] }
];

function resource(id: string, kind: ResourceKind, name: string, x: number, y: number): Resource {
	return {
		id, kind, provider: 'azure', name, region: 'UK South',
		settings: { ...resourceTypes[kind].defaults },
		blocks: [],
		positions: { visual: { x, y }, technical: { x, y } }
	};
}

/** The empty canvas shown inside CloudForge until an architecture opens (never the sample below). */
export function blankArchitecture(): Architecture {
	return { name: 'Untitled architecture', variables: [], resources: [], items: [], connections: [] };
}

export function sampleArchitecture(): Architecture {
	return {
		name: 'Production network',
		items: [
			{ id: 'frame-network', kind: 'frame', text: 'Networking', positions: { visual: { x: 70, y: 145 }, technical: { x: 70, y: 145 } }, width: 700, height: 660, members: [] },
			{ id: 'frame-platform', kind: 'frame', text: 'Application platform', positions: { visual: { x: 815, y: 145 }, technical: { x: 815, y: 145 } }, width: 300, height: 900, members: [] }
		],
		resources: [
			{...resource('network', 'network', 'vnet-production', 100, 180),parentId:'resource-group',containerSize:{width:640,height:570}},
			{...resource('subnet', 'subnet', 'snet-applications', 135, 275),parentId:'network',containerSize:{width:570,height:430}},
			{...resource('gateway', 'gateway', 'agw-public', 160, 820),parentId:'resource-group'},
			{...resource('cluster', 'cluster', 'aks-production', 845, 180),parentId:'resource-group'},
			{...resource('storage', 'storage', 'stplatformdata', 845, 510),parentId:'resource-group'},
			{...resource('monitor', 'monitor', 'log-production', 845, 820),parentId:'resource-group'},
			{...resource('resource-group','group','rg-production',20,30),containerSize:{width:1130,height:1140}},
			{...resource('vm','compute','vm-application',425,355),parentId:'subnet',settings:{Size:'Standard_D2s_v5',admin_username:'labadmin',network_interface_ids:'[]'}},
			{...resource('nic','generic','nic-application',167,355),parentId:'subnet',catalogue:{type:'azurerm_network_interface',label:'Network interface',service:'Network Interface',category:'Network',icon:'catalog-icons/azure/azure-network-interfaces.svg',fields:[]},blocks:[{id:'sample-ip',type:'ip_configuration',values:{name:'internal',private_ip_address_allocation:'Dynamic'},blocks:[]}]}
		],
		connections: [
			{ id: 'network-subnet', source: elementEndpoint('network'), target: elementEndpoint('subnet') },
			{ id: 'subnet-gateway', source: elementEndpoint('subnet'), target: elementEndpoint('gateway') },
			{ id: 'subnet-cluster', source: elementEndpoint('subnet'), target: elementEndpoint('cluster') },
			{ id: 'cluster-storage', source: elementEndpoint('cluster'), target: elementEndpoint('storage') },
			{ id: 'cluster-monitor', source: elementEndpoint('cluster'), target: elementEndpoint('monitor') }
		]
	};
}
