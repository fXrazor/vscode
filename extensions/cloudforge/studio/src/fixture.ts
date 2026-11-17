/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Architecture, Resource, ResourceKind, Provider } from './model.ts';

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
 if (resource.catalogue) { return { ...base, ...resource.catalogue, description: resource.catalogue.label, defaults: {} }; }
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
		positions: { visual: { x, y }, technical: { x: x * 1.7, y: y * 1.3 } }
	};
}

export function sampleArchitecture(): Architecture {
	return {
		name: 'Production network',
		items: [
			{ id: 'frame-network', kind: 'frame', text: 'Networking', positions: { visual: { x: 20, y: 65 }, technical: { x: 0, y: 100 } }, width: 525, height: 390, members: ['network', 'subnet'] },
			{ id: 'frame-platform', kind: 'frame', text: 'Application platform', positions: { visual: { x: 560, y: -30 }, technical: { x: 940, y: -20 } }, width: 525, height: 550, members: ['gateway', 'cluster', 'storage', 'monitor'] }
		],
		resources: [
			resource('network', 'network', 'vnet-production', 80, 170),
			resource('subnet', 'subnet', 'snet-applications', 330, 170),
			resource('gateway', 'gateway', 'agw-public', 580, 30),
			resource('cluster', 'cluster', 'aks-production', 580, 300),
			resource('storage', 'storage', 'stplatformdata', 850, 30),
			resource('monitor', 'monitor', 'log-production', 850, 300)
		],
		connections: [
			{ id: 'network-subnet', source: 'network', target: 'subnet' },
			{ id: 'subnet-gateway', source: 'subnet', target: 'gateway' },
			{ id: 'subnet-cluster', source: 'subnet', target: 'cluster' },
			{ id: 'cluster-storage', source: 'cluster', target: 'storage' },
			{ id: 'cluster-monitor', source: 'cluster', target: 'monitor' }
		]
	};
}
