/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Phase 2: Schema-backed configuration forms, typed reference picker, offline curated Azure
// networking guidance, and draft HCL preview.
// Aligned 1:1 with Z:\CloudForge\src-tauri\src\catalogue\{form,draft,coverage}.rs.
// Pure TypeScript with zero runtime `vscode` or DOM imports. Drafts stay strictly in memory
// until Phase 4's guarded Rust save capability is approved and connected.

import type { CanvasGraphSnapshot, CanvasNodeSummary } from './protocol';

export type SchemaKind = 'resource' | 'dataSource';
export type FieldAccess = 'required' | 'optional' | 'computedOnly';
export type FieldValueType = 'string' | 'number' | 'bool' | 'listString' | 'mapString';

export interface FormAttribute {
	readonly name: string;
	readonly path: string;
	readonly access: FieldAccess;
	readonly valueType: FieldValueType;
	readonly description: string;
	readonly sensitive?: boolean;
	readonly deprecated?: boolean;
	readonly options?: readonly string[];
	readonly placeholder?: string;
}

export interface FormBlockType {
	readonly name: string;
	readonly path: string;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly description: string;
	readonly attributes: readonly FormAttribute[];
}

export interface SchemaOutput {
	readonly name: string;
	readonly valueType: FieldValueType;
	readonly description: string;
	readonly knownAtApply: boolean;
}

export interface FormSchema {
	readonly kind: SchemaKind;
	readonly typeName: string;
	readonly providerSource: string;
	readonly providerVersion: string;
	readonly description: string;
	readonly docsUrl: string;
	readonly exampleHcl: string;
	readonly attributes: readonly FormAttribute[];
	readonly blocks: readonly FormBlockType[];
	readonly outputs: readonly SchemaOutput[];
}

export type DraftValue =
	| { readonly kind: 'literal'; readonly value: string | number | boolean | readonly string[] | Readonly<Record<string, string>> }
	| { readonly kind: 'expression'; readonly text: string };

export interface DraftBlock {
	readonly id: string;
	readonly name: string;
	readonly attributes: Readonly<Record<string, DraftValue>>;
}

export interface ResourceDraft {
	readonly draftId: string;
	readonly baseSourceRevision: string;
	readonly kind: SchemaKind;
	readonly typeName: string;
	readonly label: string;
	readonly attributes: Readonly<Record<string, DraftValue>>;
	readonly blocks: readonly DraftBlock[];
}

export interface DraftDiagnostic {
	readonly path: string;
	readonly message: string;
	readonly severity: 'error' | 'warning';
}

export interface RenderedDraft {
	readonly hcl: string;
	readonly diagnostics: readonly DraftDiagnostic[];
	readonly hasErrors: boolean;
}

export interface ReferenceCandidate {
	readonly expression: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly attribute: string;
	readonly valueType: FieldValueType;
	readonly knownAtApply: boolean;
	readonly description: string;
}

export const BUNDLED_CATALOGUE_PROVIDER = 'hashicorp/azurerm';
export const BUNDLED_CATALOGUE_VERSION = '5.14.0';

const AZURE_LOCATIONS = ['uksouth', 'ukwest', 'westeurope', 'northeurope', 'eastus', 'eastus2', 'westus2'] as const;

/**
 * Curated offline Azure networking schemas for Phase 2.
 * Mirrors the AzureRM 5.14.0 catalogue inventory recorded in Z:\CloudForge\HANDOFF.md.
 */
const BUNDLED_SCHEMAS: Readonly<Record<string, FormSchema>> = {
	azurerm_resource_group: {
		kind: 'resource',
		typeName: 'azurerm_resource_group',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages an Azure Resource Group that holds related resources for an architecture.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/resource_group',
		exampleHcl: 'resource "azurerm_resource_group" "hub" {\n  name     = "rg-hub-prod"\n  location = "uksouth"\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Unique name of the Resource Group.', placeholder: 'rg-hub-prod' },
			{ name: 'location', path: 'location', access: 'required', valueType: 'string', description: 'Azure Region where the Resource Group should exist.', options: AZURE_LOCATIONS },
			{ name: 'managed_by', path: 'managed_by', access: 'optional', valueType: 'string', description: 'ID of the resource or application that manages this Resource Group.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Key/value pairs of tags to assign to the Resource Group.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Resource Group ID assigned by Azure.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Azure Resource Group ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Resource Group name.', knownAtApply: false },
			{ name: 'location', valueType: 'string', description: 'Azure Region.', knownAtApply: false },
		],
	},
	azurerm_virtual_network: {
		kind: 'resource',
		typeName: 'azurerm_virtual_network',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages an Azure Virtual Network including address space and DNS configuration.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/virtual_network',
		exampleHcl: 'resource "azurerm_virtual_network" "hub" {\n  name                = "vnet-hub"\n  location            = azurerm_resource_group.hub.location\n  resource_group_name = azurerm_resource_group.hub.name\n  address_space       = ["10.0.0.0/16"]\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the Virtual Network.', placeholder: 'vnet-hub' },
			{ name: 'resource_group_name', path: 'resource_group_name', access: 'required', valueType: 'string', description: 'Name of the Resource Group in which to create the Virtual Network.' },
			{ name: 'location', path: 'location', access: 'required', valueType: 'string', description: 'Azure Region for the Virtual Network.', options: AZURE_LOCATIONS },
			{ name: 'address_space', path: 'address_space', access: 'required', valueType: 'listString', description: 'CIDR address spaces used by the Virtual Network.', placeholder: '10.0.0.0/16' },
			{ name: 'dns_servers', path: 'dns_servers', access: 'optional', valueType: 'listString', description: 'List of custom DNS server IP addresses.' },
			{ name: 'bgp_community', path: 'bgp_community', access: 'optional', valueType: 'string', description: 'BGP community attribute in format <as-number>:<community-value>.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Virtual Network ID assigned by Azure.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Azure Virtual Network ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Virtual Network name.', knownAtApply: false },
			{ name: 'address_space', valueType: 'listString', description: 'Configured CIDR prefixes.', knownAtApply: false },
		],
	},
	azurerm_subnet: {
		kind: 'resource',
		typeName: 'azurerm_subnet',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages a subnet inside an Azure Virtual Network.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/subnet',
		exampleHcl: 'resource "azurerm_subnet" "apps" {\n  name                 = "snet-apps"\n  resource_group_name  = azurerm_resource_group.hub.name\n  virtual_network_name = azurerm_virtual_network.hub.name\n  address_prefixes     = ["10.0.1.0/24"]\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the subnet.', placeholder: 'snet-apps' },
			{ name: 'resource_group_name', path: 'resource_group_name', access: 'required', valueType: 'string', description: 'Name of the Resource Group.' },
			{ name: 'virtual_network_name', path: 'virtual_network_name', access: 'required', valueType: 'string', description: 'Name of the parent Virtual Network.' },
			{ name: 'address_prefixes', path: 'address_prefixes', access: 'required', valueType: 'listString', description: 'CIDR address prefixes for the subnet.', placeholder: '10.0.1.0/24' },
			{ name: 'private_endpoint_network_policies', path: 'private_endpoint_network_policies', access: 'optional', valueType: 'string', description: 'Network policy mode for private endpoints.', options: ['Disabled', 'Enabled', 'NetworkSecurityGroupEnabled', 'RouteTableEnabled'] },
			{ name: 'service_endpoints', path: 'service_endpoints', access: 'optional', valueType: 'listString', description: 'Service endpoints enabled on the subnet.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Subnet ID assigned by Azure.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Azure Subnet ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Subnet name.', knownAtApply: false },
		],
	},
	azurerm_network_security_group: {
		kind: 'resource',
		typeName: 'azurerm_network_security_group',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages a Network Security Group containing inbound and outbound traffic rules.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/network_security_group',
		exampleHcl: 'resource "azurerm_network_security_group" "web" {\n  name                = "nsg-web"\n  location            = azurerm_resource_group.hub.location\n  resource_group_name = azurerm_resource_group.hub.name\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the Network Security Group.', placeholder: 'nsg-web' },
			{ name: 'location', path: 'location', access: 'required', valueType: 'string', description: 'Azure Region.', options: AZURE_LOCATIONS },
			{ name: 'resource_group_name', path: 'resource_group_name', access: 'required', valueType: 'string', description: 'Name of the Resource Group.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'NSG ID assigned by Azure.' },
		],
		blocks: [
			{
				name: 'security_rule',
				path: 'security_rule',
				description: 'Inline security rule defining allowed or denied network traffic.',
				attributes: [
					{ name: 'name', path: 'security_rule.name', access: 'required', valueType: 'string', description: 'Unique name of the rule.' },
					{ name: 'priority', path: 'security_rule.priority', access: 'required', valueType: 'number', description: 'Priority between 100 and 4096.' },
					{ name: 'direction', path: 'security_rule.direction', access: 'required', valueType: 'string', description: 'Traffic direction.', options: ['Inbound', 'Outbound'] },
					{ name: 'access', path: 'security_rule.access', access: 'required', valueType: 'string', description: 'Allow or Deny matching traffic.', options: ['Allow', 'Deny'] },
					{ name: 'protocol', path: 'security_rule.protocol', access: 'required', valueType: 'string', description: 'Network protocol.', options: ['Tcp', 'Udp', 'Icmp', '*'] },
					{ name: 'source_port_range', path: 'security_rule.source_port_range', access: 'optional', valueType: 'string', description: 'Source port or range (e.g., *).', placeholder: '*' },
					{ name: 'destination_port_range', path: 'security_rule.destination_port_range', access: 'optional', valueType: 'string', description: 'Destination port or range (e.g., 443).', placeholder: '443' },
					{ name: 'source_address_prefix', path: 'security_rule.source_address_prefix', access: 'optional', valueType: 'string', description: 'Source CIDR or service tag.', placeholder: 'VirtualNetwork' },
					{ name: 'destination_address_prefix', path: 'security_rule.destination_address_prefix', access: 'optional', valueType: 'string', description: 'Destination CIDR or service tag.', placeholder: '*' },
				],
			},
		],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Network Security Group ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Network Security Group name.', knownAtApply: false },
		],
	},
	azurerm_public_ip: {
		kind: 'resource',
		typeName: 'azurerm_public_ip',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages an Azure Public IP Address.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/public_ip',
		exampleHcl: 'resource "azurerm_public_ip" "gw" {\n  name                = "pip-gw"\n  location            = azurerm_resource_group.hub.location\n  resource_group_name = azurerm_resource_group.hub.name\n  allocation_method   = "Static"\n  sku                 = "Standard"\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the Public IP.', placeholder: 'pip-gw' },
			{ name: 'resource_group_name', path: 'resource_group_name', access: 'required', valueType: 'string', description: 'Name of the Resource Group.' },
			{ name: 'location', path: 'location', access: 'required', valueType: 'string', description: 'Azure Region.', options: AZURE_LOCATIONS },
			{ name: 'allocation_method', path: 'allocation_method', access: 'required', valueType: 'string', description: 'IP allocation method.', options: ['Static', 'Dynamic'] },
			{ name: 'sku', path: 'sku', access: 'optional', valueType: 'string', description: 'Public IP SKU.', options: ['Standard', 'Basic'] },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'ip_address', path: 'ip_address', access: 'computedOnly', valueType: 'string', description: 'Allocated public IP address (known after apply).' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Public IP resource ID.', knownAtApply: true },
			{ name: 'ip_address', valueType: 'string', description: 'Allocated IPv4 address.', knownAtApply: true },
		],
	},
	azurerm_route_table: {
		kind: 'resource',
		typeName: 'azurerm_route_table',
		providerSource: BUNDLED_CATALOGUE_PROVIDER,
		providerVersion: BUNDLED_CATALOGUE_VERSION,
		description: 'Manages an Azure Route Table for custom subnet traffic routing.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/route_table',
		exampleHcl: 'resource "azurerm_route_table" "egress" {\n  name                = "rt-egress"\n  location            = azurerm_resource_group.hub.location\n  resource_group_name = azurerm_resource_group.hub.name\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the Route Table.', placeholder: 'rt-egress' },
			{ name: 'location', path: 'location', access: 'required', valueType: 'string', description: 'Azure Region.', options: AZURE_LOCATIONS },
			{ name: 'resource_group_name', path: 'resource_group_name', access: 'required', valueType: 'string', description: 'Name of the Resource Group.' },
			{ name: 'bgp_route_propagation_enabled', path: 'bgp_route_propagation_enabled', access: 'optional', valueType: 'bool', description: 'Whether BGP route propagation is enabled.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
		],
		blocks: [
			{
				name: 'route',
				path: 'route',
				description: 'Custom route entry forwarding an address prefix to a next hop.',
				attributes: [
					{ name: 'name', path: 'route.name', access: 'required', valueType: 'string', description: 'Name of the route.' },
					{ name: 'address_prefix', path: 'route.address_prefix', access: 'required', valueType: 'string', description: 'Destination CIDR prefix.', placeholder: '0.0.0.0/0' },
					{ name: 'next_hop_type', path: 'route.next_hop_type', access: 'required', valueType: 'string', description: 'Type of next hop.', options: ['VirtualAppliance', 'VnetLocal', 'Internet', 'VirtualNetworkGateway', 'None'] },
					{ name: 'next_hop_in_ip_address', path: 'route.next_hop_in_ip_address', access: 'optional', valueType: 'string', description: 'Next hop IP when next_hop_type is VirtualAppliance.' },
				],
			},
		],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Route Table resource ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Route Table name.', knownAtApply: false },
		],
	},
	aws_vpc: {
		kind: 'resource',
		typeName: 'aws_vpc',
		providerSource: 'hashicorp/aws',
		providerVersion: '6.0.0',
		description: 'Manages an Amazon Virtual Private Cloud (VPC) with CIDR block and DNS settings.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc',
		exampleHcl: 'resource "aws_vpc" "main" {\n  cidr_block           = "10.20.0.0/16"\n  enable_dns_hostnames = true\n}',
		attributes: [
			{ name: 'cidr_block', path: 'cidr_block', access: 'required', valueType: 'string', description: 'IPv4 CIDR block for the VPC.', placeholder: '10.20.0.0/16' },
			{ name: 'enable_dns_support', path: 'enable_dns_support', access: 'optional', valueType: 'bool', description: 'Enable DNS resolution inside the VPC.' },
			{ name: 'enable_dns_hostnames', path: 'enable_dns_hostnames', access: 'optional', valueType: 'bool', description: 'Enable DNS hostnames in the VPC.' },
			{ name: 'instance_tenancy', path: 'instance_tenancy', access: 'optional', valueType: 'string', description: 'Tenancy option for instances launched into the VPC.', options: ['default', 'dedicated'] },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'VPC ID assigned by AWS.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'AWS VPC ID.', knownAtApply: true },
			{ name: 'arn', valueType: 'string', description: 'AWS VPC ARN.', knownAtApply: true },
			{ name: 'cidr_block', valueType: 'string', description: 'Configured IPv4 CIDR block.', knownAtApply: false },
		],
	},
	aws_subnet: {
		kind: 'resource',
		typeName: 'aws_subnet',
		providerSource: 'hashicorp/aws',
		providerVersion: '6.0.0',
		description: 'Manages an Amazon VPC subnet inside an Availability Zone.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet',
		exampleHcl: 'resource "aws_subnet" "public" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.20.1.0/24"\n}',
		attributes: [
			{ name: 'vpc_id', path: 'vpc_id', access: 'required', valueType: 'string', description: 'Parent VPC ID.' },
			{ name: 'cidr_block', path: 'cidr_block', access: 'required', valueType: 'string', description: 'IPv4 CIDR block for the subnet.', placeholder: '10.20.1.0/24' },
			{ name: 'availability_zone', path: 'availability_zone', access: 'optional', valueType: 'string', description: 'Target Availability Zone.', placeholder: 'eu-west-2a' },
			{ name: 'map_public_ip_on_launch', path: 'map_public_ip_on_launch', access: 'optional', valueType: 'bool', description: 'Assign public IPv4 addresses to instances launched in this subnet.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Subnet ID assigned by AWS.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'AWS Subnet ID.', knownAtApply: true },
			{ name: 'arn', valueType: 'string', description: 'AWS Subnet ARN.', knownAtApply: true },
		],
	},
	aws_internet_gateway: {
		kind: 'resource',
		typeName: 'aws_internet_gateway',
		providerSource: 'hashicorp/aws',
		providerVersion: '6.0.0',
		description: 'Manages an Amazon VPC Internet Gateway for public egress and ingress.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/internet_gateway',
		exampleHcl: 'resource "aws_internet_gateway" "edge" {\n  vpc_id = aws_vpc.main.id\n}',
		attributes: [
			{ name: 'vpc_id', path: 'vpc_id', access: 'optional', valueType: 'string', description: 'VPC ID to attach this gateway to.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Internet Gateway ID.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Internet Gateway ID.', knownAtApply: true },
			{ name: 'arn', valueType: 'string', description: 'Internet Gateway ARN.', knownAtApply: true },
		],
	},
	aws_security_group: {
		kind: 'resource',
		typeName: 'aws_security_group',
		providerSource: 'hashicorp/aws',
		providerVersion: '6.0.0',
		description: 'Manages an Amazon EC2 / VPC Security Group firewall.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group',
		exampleHcl: 'resource "aws_security_group" "web" {\n  name        = "sg-web"\n  description = "Allow HTTPS traffic"\n  vpc_id      = aws_vpc.main.id\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the security group.', placeholder: 'sg-web' },
			{ name: 'description', path: 'description', access: 'optional', valueType: 'string', description: 'Security group description.', placeholder: 'Managed by CloudForge' },
			{ name: 'vpc_id', path: 'vpc_id', access: 'optional', valueType: 'string', description: 'Parent VPC ID.' },
			{ name: 'tags', path: 'tags', access: 'optional', valueType: 'mapString', description: 'Resource tags.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Security Group ID.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Security Group ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Security Group name.', knownAtApply: false },
		],
	},
	google_compute_network: {
		kind: 'resource',
		typeName: 'google_compute_network',
		providerSource: 'hashicorp/google',
		providerVersion: '6.0.0',
		description: 'Manages a Google Cloud VPC Compute Network.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network',
		exampleHcl: 'resource "google_compute_network" "core" {\n  name                    = "vpc-core"\n  auto_create_subnetworks = false\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Name of the VPC network.', placeholder: 'vpc-core' },
			{ name: 'auto_create_subnetworks', path: 'auto_create_subnetworks', access: 'optional', valueType: 'bool', description: 'Create one subnetwork per region automatically.' },
			{ name: 'routing_mode', path: 'routing_mode', access: 'optional', valueType: 'string', description: 'Network-wide routing mode.', options: ['REGIONAL', 'GLOBAL'] },
			{ name: 'description', path: 'description', access: 'optional', valueType: 'string', description: 'Optional description.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Compute Network resource ID.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Compute Network ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Compute Network name.', knownAtApply: false },
			{ name: 'self_link', valueType: 'string', description: 'URI of the created network.', knownAtApply: true },
		],
	},
	google_compute_subnetwork: {
		kind: 'resource',
		typeName: 'google_compute_subnetwork',
		providerSource: 'hashicorp/google',
		providerVersion: '6.0.0',
		description: 'Manages a regional Google Cloud VPC Subnetwork.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_subnetwork',
		exampleHcl: 'resource "google_compute_subnetwork" "apps" {\n  name          = "snet-apps"\n  ip_cidr_range = "10.30.1.0/24"\n  region        = "europe-west2"\n  network       = google_compute_network.core.id\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Subnetwork name.', placeholder: 'snet-apps' },
			{ name: 'ip_cidr_range', path: 'ip_cidr_range', access: 'required', valueType: 'string', description: 'Range of internal IPv4 addresses.', placeholder: '10.30.1.0/24' },
			{ name: 'network', path: 'network', access: 'required', valueType: 'string', description: 'Parent VPC network ID or self_link.' },
			{ name: 'region', path: 'region', access: 'optional', valueType: 'string', description: 'GCP region for the subnetwork.', placeholder: 'europe-west2' },
			{ name: 'private_ip_google_access', path: 'private_ip_google_access', access: 'optional', valueType: 'bool', description: 'Allow private VMs to access Google APIs.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Subnetwork ID.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Subnetwork ID.', knownAtApply: true },
			{ name: 'self_link', valueType: 'string', description: 'Subnetwork self link.', knownAtApply: true },
		],
	},
	google_compute_firewall: {
		kind: 'resource',
		typeName: 'google_compute_firewall',
		providerSource: 'hashicorp/google',
		providerVersion: '6.0.0',
		description: 'Manages a Google Cloud VPC Firewall rule.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_firewall',
		exampleHcl: 'resource "google_compute_firewall" "allow_https" {\n  name    = "fw-allow-https"\n  network = google_compute_network.core.name\n}',
		attributes: [
			{ name: 'name', path: 'name', access: 'required', valueType: 'string', description: 'Firewall rule name.', placeholder: 'fw-allow-https' },
			{ name: 'network', path: 'network', access: 'required', valueType: 'string', description: 'Target VPC network name or self_link.' },
			{ name: 'direction', path: 'direction', access: 'optional', valueType: 'string', description: 'Direction of traffic.', options: ['INGRESS', 'EGRESS'] },
			{ name: 'priority', path: 'priority', access: 'optional', valueType: 'number', description: 'Priority from 0 to 65535 (lower wins).' },
			{ name: 'source_ranges', path: 'source_ranges', access: 'optional', valueType: 'listString', description: 'Source CIDR blocks.', placeholder: '10.30.0.0/16' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Firewall ID.' },
		],
		blocks: [],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Firewall resource ID.', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Firewall name.', knownAtApply: false },
		],
	},
	kubernetes_namespace: {
		kind: 'resource',
		typeName: 'kubernetes_namespace',
		providerSource: 'hashicorp/kubernetes',
		providerVersion: '2.35.0',
		description: 'Manages a Kubernetes Namespace isolating workload objects.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/namespace',
		exampleHcl: 'resource "kubernetes_namespace" "app" {\n  metadata {\n    name = "workloads"\n  }\n}',
		attributes: [
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'Kubernetes Namespace ID.' },
		],
		blocks: [
			{
				name: 'metadata',
				path: 'metadata',
				minItems: 1,
				maxItems: 1,
				description: 'Standard Kubernetes object metadata.',
				attributes: [
					{ name: 'name', path: 'metadata.name', access: 'required', valueType: 'string', description: 'Unique namespace name.', placeholder: 'workloads' },
					{ name: 'labels', path: 'metadata.labels', access: 'optional', valueType: 'mapString', description: 'Namespace labels.' },
				],
			},
		],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'Namespace ID.', knownAtApply: true },
		],
	},
	kubernetes_config_map: {
		kind: 'resource',
		typeName: 'kubernetes_config_map',
		providerSource: 'hashicorp/kubernetes',
		providerVersion: '2.35.0',
		description: 'Manages a Kubernetes ConfigMap storing non-confidential key-value configuration.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/config_map',
		exampleHcl: 'resource "kubernetes_config_map" "app_config" {\n  metadata {\n    name      = "app-settings"\n    namespace = "workloads"\n  }\n}',
		attributes: [
			{ name: 'data', path: 'data', access: 'optional', valueType: 'mapString', description: 'Key/value configuration entries.' },
			{ name: 'immutable', path: 'immutable', access: 'optional', valueType: 'bool', description: 'Prevent changes to data once created.' },
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'ConfigMap ID.' },
		],
		blocks: [
			{
				name: 'metadata',
				path: 'metadata',
				minItems: 1,
				maxItems: 1,
				description: 'Standard Kubernetes object metadata.',
				attributes: [
					{ name: 'name', path: 'metadata.name', access: 'required', valueType: 'string', description: 'ConfigMap name.', placeholder: 'app-settings' },
					{ name: 'namespace', path: 'metadata.namespace', access: 'optional', valueType: 'string', description: 'Target namespace.', placeholder: 'workloads' },
				],
			},
		],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'ConfigMap ID.', knownAtApply: true },
		],
	},
	kubernetes_network_policy: {
		kind: 'resource',
		typeName: 'kubernetes_network_policy',
		providerSource: 'hashicorp/kubernetes',
		providerVersion: '2.35.0',
		description: 'Manages a Kubernetes NetworkPolicy governing pod ingress and egress traffic.',
		docsUrl: 'https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/network_policy',
		exampleHcl: 'resource "kubernetes_network_policy" "default_deny" {\n  metadata {\n    name      = "default-deny-ingress"\n    namespace = "workloads"\n  }\n}',
		attributes: [
			{ name: 'id', path: 'id', access: 'computedOnly', valueType: 'string', description: 'NetworkPolicy ID.' },
		],
		blocks: [
			{
				name: 'metadata',
				path: 'metadata',
				minItems: 1,
				maxItems: 1,
				description: 'Standard Kubernetes object metadata.',
				attributes: [
					{ name: 'name', path: 'metadata.name', access: 'required', valueType: 'string', description: 'NetworkPolicy name.', placeholder: 'default-deny-ingress' },
					{ name: 'namespace', path: 'metadata.namespace', access: 'optional', valueType: 'string', description: 'Target namespace.', placeholder: 'workloads' },
				],
			},
		],
		outputs: [
			{ name: 'id', valueType: 'string', description: 'NetworkPolicy ID.', knownAtApply: true },
		],
	},
};

export function listBundledSchemaTypes(): readonly string[] {
	return Object.keys(BUNDLED_SCHEMAS);
}

export function lookupBundledSchema(node: Pick<CanvasNodeSummary, 'kind' | 'resourceType'>): FormSchema | undefined {
	if (!node.resourceType) {
		return undefined;
	}
	if (node.kind.toLowerCase() !== 'resource') {
		return undefined;
	}
	return BUNDLED_SCHEMAS[node.resourceType];
}

export function createInitialDraft(node: CanvasNodeSummary, schema: FormSchema, baseSourceRevision: string): ResourceDraft {
	const attributes: Record<string, DraftValue> = {};
	for (const attr of schema.attributes) {
		if (attr.access === 'required' && attr.name === 'name') {
			attributes.name = { kind: 'literal', value: node.name };
		}
	}
	return {
		draftId: `draft:${node.id}:${baseSourceRevision.slice(0, 8)}`,
		baseSourceRevision,
		kind: schema.kind,
		typeName: schema.typeName,
		label: node.name,
		attributes,
		blocks: [],
	};
}

/** Builds typed Terraform reference candidates from other nodes in the same architecture. */
export function buildReferenceCandidates(graph: CanvasGraphSnapshot, excludeNodeId: string): readonly ReferenceCandidate[] {
	const candidates: ReferenceCandidate[] = [];
	for (const node of graph.nodes) {
		if (node.id === excludeNodeId || !node.resourceType || node.kind.toLowerCase() !== 'resource') {
			continue;
		}
		const schema = BUNDLED_SCHEMAS[node.resourceType];
		const outputs: readonly SchemaOutput[] = schema?.outputs ?? [
			{ name: 'id', valueType: 'string', description: 'Resource ID (known after apply).', knownAtApply: true },
			{ name: 'name', valueType: 'string', description: 'Resource name.', knownAtApply: false },
		];
		for (const out of outputs) {
			candidates.push({
				expression: `${node.resourceType}.${node.name}.${out.name}`,
				nodeId: node.id,
				nodeName: node.name,
				attribute: out.name,
				valueType: out.valueType,
				knownAtApply: out.knownAtApply,
				description: out.description,
			});
		}
	}
	return candidates;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function escapeHclString(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

function formatHclValue(
	path: string,
	attr: FormAttribute,
	value: DraftValue,
	diagnostics: DraftDiagnostic[],
	indent: string
): string | undefined {
	if (value.kind === 'expression') {
		const trimmed = value.text.trim();
		if (!trimmed) {
			diagnostics.push({ path, severity: 'error', message: 'Enter an HCL expression or switch back to Value mode.' });
			return undefined;
		}
		return trimmed;
	}

	const literal = value.value;
	switch (attr.valueType) {
		case 'string': {
			if (typeof literal !== 'string') {
				diagnostics.push({ path, severity: 'error', message: 'Expected a text value.' });
				return undefined;
			}
			if (attr.access === 'required' && literal.trim().length === 0) {
				diagnostics.push({ path, severity: 'error', message: 'This value is required.' });
				return undefined;
			}
			if (attr.options && literal.length > 0 && !attr.options.includes(literal)) {
				diagnostics.push({ path, severity: 'warning', message: `Value "${literal}" is outside the common options (${attr.options.join(', ')}).` });
			}
			return `"${escapeHclString(literal)}"`;
		}
		case 'number': {
			const num = typeof literal === 'number' ? literal : Number(literal);
			if (!Number.isFinite(num)) {
				diagnostics.push({ path, severity: 'error', message: 'Expected a valid number.' });
				return undefined;
			}
			return String(num);
		}
		case 'bool': {
			if (typeof literal !== 'boolean') {
				diagnostics.push({ path, severity: 'error', message: 'Expected true or false.' });
				return undefined;
			}
			return literal ? 'true' : 'false';
		}
		case 'listString': {
			if (!Array.isArray(literal) || !literal.every(item => typeof item === 'string')) {
				diagnostics.push({ path, severity: 'error', message: 'Expected a list of strings.' });
				return undefined;
			}
			if (attr.access === 'required' && literal.length === 0) {
				diagnostics.push({ path, severity: 'error', message: 'Provide at least one entry.' });
				return undefined;
			}
			return `[${literal.map(item => `"${escapeHclString(item)}"`).join(', ')}]`;
		}
		case 'mapString': {
			if (!literal || typeof literal !== 'object' || Array.isArray(literal)) {
				diagnostics.push({ path, severity: 'error', message: 'Expected key/value pairs.' });
				return undefined;
			}
			const entries = Object.entries(literal as Record<string, string>);
			if (entries.length === 0) {
				return '{}';
			}
			const lines = entries.map(([k, v]) => `${indent}  "${escapeHclString(k)}" = "${escapeHclString(String(v))}"`);
			return `{\n${lines.join('\n')}\n${indent}}`;
		}
	}
}

function renderAssignments(
	schemaAttrs: readonly FormAttribute[],
	draftAttrs: Readonly<Record<string, DraftValue>>,
	prefix: string,
	indent: string,
	diagnostics: DraftDiagnostic[]
): string[] {
	const rendered: { name: string; value: string }[] = [];
	const known = new Set<string>();

	for (const attr of schemaAttrs) {
		known.add(attr.name);
		const path = prefix ? `${prefix}.${attr.name}` : attr.name;
		const val = draftAttrs[attr.name];
		if (val === undefined) {
			if (attr.access === 'required') {
				diagnostics.push({ path, severity: 'error', message: 'This value is required.' });
			}
			continue;
		}
		if (attr.access === 'computedOnly') {
			diagnostics.push({ path, severity: 'error', message: 'This value is computed by the provider and cannot be set.' });
			continue;
		}
		const formatted = formatHclValue(path, attr, val, diagnostics, indent);
		if (formatted !== undefined) {
			rendered.push({ name: attr.name, value: formatted });
		}
	}

	for (const extra of Object.keys(draftAttrs)) {
		if (!known.has(extra)) {
			diagnostics.push({
				path: prefix ? `${prefix}.${extra}` : extra,
				severity: 'warning',
				message: `Attribute "${extra}" is not in the bundled ${BUNDLED_CATALOGUE_VERSION} schema; preserved in native HCL.`,
			});
		}
	}

	const maxLen = rendered.reduce((acc, item) => Math.max(acc, item.name.length), 0);
	return rendered.map(item => `${indent}${item.name.padEnd(maxLen)} = ${item.value}`);
}

/** Validates a draft against its FormSchema and produces an aligned, clearly labelled HCL preview. */
export function renderDraftPreview(schema: FormSchema, draft: ResourceDraft): RenderedDraft {
	const diagnostics: DraftDiagnostic[] = [];
	if (draft.kind !== schema.kind || draft.typeName !== schema.typeName) {
		diagnostics.push({ path: '', severity: 'error', message: `Draft type "${draft.typeName}" does not match schema "${schema.typeName}".` });
	}
	if (!IDENTIFIER_PATTERN.test(draft.label)) {
		diagnostics.push({ path: 'label', severity: 'error', message: 'Use letters, digits, underscores, and dashes, starting with a letter or underscore.' });
	}

	const keyword = schema.kind === 'dataSource' ? 'data' : 'resource';
	const lines: string[] = [
		`# Unsaved draft preview (base revision ${draft.baseSourceRevision.slice(0, 8)}, ${schema.providerSource} ${schema.providerVersion})`,
		`${keyword} "${schema.typeName}" "${escapeHclString(draft.label)}" {`,
	];

	const topAssignments = renderAssignments(schema.attributes, draft.attributes, '', '  ', diagnostics);
	lines.push(...topAssignments);

	for (const blockSchema of schema.blocks) {
		const instances = draft.blocks.filter(b => b.name === blockSchema.name);
		if (blockSchema.minItems !== undefined && instances.length < blockSchema.minItems) {
			diagnostics.push({ path: blockSchema.path, severity: 'error', message: `Add at least ${blockSchema.minItems} ${blockSchema.name} block(s).` });
		}
		if (blockSchema.maxItems !== undefined && instances.length > blockSchema.maxItems) {
			diagnostics.push({ path: blockSchema.path, severity: 'error', message: `At most ${blockSchema.maxItems} ${blockSchema.name} block(s) allowed.` });
		}
		instances.forEach((instance, index) => {
			if (lines.length > 2) {
				lines.push('');
			}
			lines.push(`  ${blockSchema.name} {`);
			const blockLines = renderAssignments(blockSchema.attributes, instance.attributes, `${blockSchema.path}[${index}]`, '    ', diagnostics);
			lines.push(...blockLines);
			lines.push('  }');
		});
	}

	lines.push('}');
	return {
		hcl: lines.join('\n') + '\n',
		diagnostics,
		hasErrors: diagnostics.some(d => d.severity === 'error'),
	};
}
