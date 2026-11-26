/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The curated core AWS and Google Cloud types in the provider snapshots carry the Azure
 * resource-group placeholder icon. Give them their own service icons. Applied when a snapshot
 * loads and when an already-saved resource still holds the placeholder; never changes type or Terraform.
 */
const placeholder = 'azure-resource-groups.svg';
const aws = (file: string) => 'catalog-icons/aws/aws-' + file + '.svg';
const gcp = (file: string) => 'catalog-icons/gcp/gcp-' + file + '.svg';
export const coreIcons: Readonly<Record<string, string>> = {
	aws_vpc: aws('virtual-private-cloud'), aws_subnet: aws('private-subnet'), aws_security_group: aws('vpc-traffic-mirroring'),
	aws_instance: aws('ec2'), aws_eks_cluster: aws('eks-cloud'), aws_eip: aws('vpc-elastic-network-adapter'), aws_iam_role: aws('identity-and-access-management'),
	aws_internet_gateway: aws('internet-gateway'), aws_nat_gateway: aws('nat-gateway'), aws_lambda_function: aws('lambda'), aws_db_instance: aws('rds'),
	aws_route_table: aws('route-table'), aws_route_table_association: aws('route-table'), aws_s3_bucket: aws('s3-on-outposts'),
	google_compute_network: gcp('cloud-network'), google_compute_subnetwork: gcp('network-tiers'), google_compute_firewall: gcp('cloud-firewall-rules'),
	google_compute_instance: gcp('compute-engine'), google_container_cluster: gcp('gke-on-prem'), google_sql_database_instance: gcp('cloud-sql'),
	google_storage_bucket: gcp('cloud-storage'), google_cloud_run_v2_service: gcp('cloud-run'), google_pubsub_topic: gcp('pubsub'), google_project: gcp('project'),
	azurerm_public_ip: 'catalog-icons/azure/azure-public-ip-addresses.svg', azurerm_subnet_network_security_group_association: 'catalog-icons/azure/azure-network-security-groups.svg',
};
/** The icon to show for a type, replacing only the shared placeholder. */
export function coreIcon(type: string, icon: string): string {
	return (icon === placeholder || icon.endsWith('/' + placeholder)) && type !== 'azurerm_resource_group' && coreIcons[type] ? coreIcons[type] : icon;
}
