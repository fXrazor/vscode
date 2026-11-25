/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Offline Multi-Cloud Template Library (from Z:\CloudForge\design.md#projects-and-template-library).
// Pure TypeScript with zero DOM, network, or `vscode` runtime dependencies.

export type TemplateProvider = 'azure' | 'aws' | 'gcp' | 'kubernetes';

export interface TemplateThumbNode {
	readonly label: string;
	readonly col: number;
	readonly row: number;
}

export interface ArchitectureTemplate {
	readonly id: string;
	readonly name: string;
	readonly provider: TemplateProvider;
	readonly version: string;
	readonly author: string;
	readonly category: string;
	readonly summary: string;
	readonly tags: readonly string[];
	readonly resourceCount: number;
	readonly defaultArchName: string;
	readonly canvasPatternId?: string;
	readonly thumbnailNodes: readonly TemplateThumbNode[];
	readonly starterMainTf: string;
}

function tfLines(lines: readonly string[]): string {
	return lines.join('\n') + '\n';
}

export const TEMPLATE_LIBRARY: readonly ArchitectureTemplate[] = [
	{
		id: 'tpl-azure-hub-network',
		name: 'Azure Hub Network',
		provider: 'azure',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Networking',
		summary: 'Central Azure hub landing zone with Resource Group, Hub VNet (10.0.0.0/16), App Subnet, NSG, and Standard Static Public IP.',
		tags: ['hub', 'vnet', 'networking', 'landing-zone'],
		resourceCount: 5,
		defaultArchName: 'AzureHubNetwork',
		canvasPatternId: 'azure-hub-network',
		thumbnailNodes: [
			{ label: 'RG', col: 0, row: 0 },
			{ label: 'VNet', col: 1, row: 0 },
			{ label: 'Subnet', col: 2, row: 0 },
			{ label: 'NSG', col: 1, row: 1 },
			{ label: 'PIP', col: 2, row: 1 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: Azure Hub Network (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    azurerm = {',
			'      source  = "hashicorp/azurerm"',
			'      version = "~> 5.14"',
			'    }',
			'  }',
			'}',
			'',
			'resource "azurerm_resource_group" "rg_hub" {',
			'  name     = "rg-hub-core"',
			'  location = "uksouth"',
			'}',
			'',
			'resource "azurerm_virtual_network" "vnet_hub" {',
			'  name                = "vnet-hub"',
			'  location            = azurerm_resource_group.rg_hub.location',
			'  resource_group_name = azurerm_resource_group.rg_hub.name',
			'  address_space       = ["10.0.0.0/16"]',
			'}',
			'',
			'resource "azurerm_subnet" "snet_apps" {',
			'  name                 = "snet-apps"',
			'  resource_group_name  = azurerm_resource_group.rg_hub.name',
			'  virtual_network_name = azurerm_virtual_network.vnet_hub.name',
			'  address_prefixes     = ["10.0.1.0/24"]',
			'}',
			'',
			'resource "azurerm_network_security_group" "nsg_hub" {',
			'  name                = "nsg-hub"',
			'  location            = azurerm_resource_group.rg_hub.location',
			'  resource_group_name = azurerm_resource_group.rg_hub.name',
			'}',
			'',
			'resource "azurerm_public_ip" "pip_hub_ingress" {',
			'  name                = "pip-hub-ingress"',
			'  location            = azurerm_resource_group.rg_hub.location',
			'  resource_group_name = azurerm_resource_group.rg_hub.name',
			'  allocation_method   = "Static"',
			'  sku                 = "Standard"',
			'}',
		]),
	},
	{
		id: 'tpl-azure-secure-spoke',
		name: 'Azure Secure Workload Spoke',
		provider: 'azure',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Networking',
		summary: 'Isolated workload spoke with Resource Group, Spoke VNet (10.1.0.0/16), Workload Subnet, Route Table, and Network Security Group.',
		tags: ['spoke', 'vnet', 'route-table', 'zero-trust'],
		resourceCount: 5,
		defaultArchName: 'AzureSecureSpoke',
		canvasPatternId: 'azure-secure-spoke',
		thumbnailNodes: [
			{ label: 'RG', col: 0, row: 0 },
			{ label: 'Spoke', col: 1, row: 0 },
			{ label: 'Subnet', col: 2, row: 0 },
			{ label: 'RT', col: 1, row: 1 },
			{ label: 'NSG', col: 2, row: 1 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: Azure Secure Workload Spoke (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    azurerm = {',
			'      source  = "hashicorp/azurerm"',
			'      version = "~> 5.14"',
			'    }',
			'  }',
			'}',
			'',
			'resource "azurerm_resource_group" "rg_spoke" {',
			'  name     = "rg-spoke-workload"',
			'  location = "uksouth"',
			'}',
			'',
			'resource "azurerm_virtual_network" "vnet_spoke" {',
			'  name                = "vnet-spoke"',
			'  location            = azurerm_resource_group.rg_spoke.location',
			'  resource_group_name = azurerm_resource_group.rg_spoke.name',
			'  address_space       = ["10.1.0.0/16"]',
			'}',
			'',
			'resource "azurerm_subnet" "snet_workload" {',
			'  name                 = "snet-workload"',
			'  resource_group_name  = azurerm_resource_group.rg_spoke.name',
			'  virtual_network_name = azurerm_virtual_network.vnet_spoke.name',
			'  address_prefixes     = ["10.1.1.0/24"]',
			'}',
			'',
			'resource "azurerm_route_table" "rt_spoke" {',
			'  name                = "rt-spoke"',
			'  location            = azurerm_resource_group.rg_spoke.location',
			'  resource_group_name = azurerm_resource_group.rg_spoke.name',
			'}',
			'',
			'resource "azurerm_network_security_group" "nsg_spoke" {',
			'  name                = "nsg-spoke"',
			'  location            = azurerm_resource_group.rg_spoke.location',
			'  resource_group_name = azurerm_resource_group.rg_spoke.name',
			'}',
		]),
	},
	{
		id: 'tpl-azure-edge-perimeter',
		name: 'Azure Edge Perimeter',
		provider: 'azure',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Security',
		summary: 'Hardened ingress perimeter combining a Resource Group, Standard Static Public IP, Perimeter NSG, and Edge Route Table.',
		tags: ['edge', 'perimeter', 'nsg', 'security'],
		resourceCount: 4,
		defaultArchName: 'AzureEdgePerimeter',
		canvasPatternId: 'azure-edge-perimeter',
		thumbnailNodes: [
			{ label: 'RG', col: 0, row: 0 },
			{ label: 'PIP', col: 1, row: 0 },
			{ label: 'NSG', col: 1, row: 1 },
			{ label: 'RT', col: 2, row: 0 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: Azure Edge Perimeter (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    azurerm = {',
			'      source  = "hashicorp/azurerm"',
			'      version = "~> 5.14"',
			'    }',
			'  }',
			'}',
			'',
			'resource "azurerm_resource_group" "rg_edge" {',
			'  name     = "rg-edge-perimeter"',
			'  location = "uksouth"',
			'}',
			'',
			'resource "azurerm_public_ip" "pip_edge" {',
			'  name                = "pip-edge"',
			'  location            = azurerm_resource_group.rg_edge.location',
			'  resource_group_name = azurerm_resource_group.rg_edge.name',
			'  allocation_method   = "Static"',
			'  sku                 = "Standard"',
			'}',
			'',
			'resource "azurerm_network_security_group" "nsg_edge" {',
			'  name                = "nsg-edge"',
			'  location            = azurerm_resource_group.rg_edge.location',
			'  resource_group_name = azurerm_resource_group.rg_edge.name',
			'}',
			'',
			'resource "azurerm_route_table" "rt_edge" {',
			'  name                = "rt-edge"',
			'  location            = azurerm_resource_group.rg_edge.location',
			'  resource_group_name = azurerm_resource_group.rg_edge.name',
			'}',
		]),
	},
	{
		id: 'tpl-aws-two-tier-vpc',
		name: 'AWS Two-Tier VPC Foundation',
		provider: 'aws',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Networking',
		summary: 'Multi-tier AWS VPC (10.20.0.0/16) with Internet Gateway, public ingress subnet, and private workload subnet.',
		tags: ['aws', 'vpc', 'subnet', 'igw'],
		resourceCount: 4,
		defaultArchName: 'AwsTwoTierVpc',
		thumbnailNodes: [
			{ label: 'VPC', col: 0, row: 0 },
			{ label: 'IGW', col: 1, row: 0 },
			{ label: 'Public', col: 1, row: 1 },
			{ label: 'Private', col: 2, row: 1 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: AWS Two-Tier VPC Foundation (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    aws = {',
			'      source  = "hashicorp/aws"',
			'      version = "~> 6.0"',
			'    }',
			'  }',
			'}',
			'',
			'resource "aws_vpc" "main" {',
			'  cidr_block           = "10.20.0.0/16"',
			'  enable_dns_hostnames = true',
			'}',
			'',
			'resource "aws_internet_gateway" "edge" {',
			'  vpc_id = aws_vpc.main.id',
			'}',
			'',
			'resource "aws_subnet" "public" {',
			'  vpc_id     = aws_vpc.main.id',
			'  cidr_block = "10.20.1.0/24"',
			'}',
			'',
			'resource "aws_subnet" "private" {',
			'  vpc_id     = aws_vpc.main.id',
			'  cidr_block = "10.20.2.0/24"',
			'}',
		]),
	},
	{
		id: 'tpl-gcp-custom-vpc',
		name: 'Google Cloud Custom VPC & Firewall',
		provider: 'gcp',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Networking',
		summary: 'Custom-mode GCP Compute Network with a regional workload subnetwork and HTTPS ingress firewall policy.',
		tags: ['gcp', 'vpc', 'firewall', 'networking'],
		resourceCount: 3,
		defaultArchName: 'GcpCustomVpc',
		thumbnailNodes: [
			{ label: 'VPC', col: 0, row: 0 },
			{ label: 'Subnet', col: 1, row: 0 },
			{ label: 'FW', col: 1, row: 1 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: Google Cloud Custom VPC & Firewall (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    google = {',
			'      source  = "hashicorp/google"',
			'      version = "~> 6.0"',
			'    }',
			'  }',
			'}',
			'',
			'resource "google_compute_network" "core" {',
			'  name                    = "vpc-core"',
			'  auto_create_subnetworks = false',
			'}',
			'',
			'resource "google_compute_subnetwork" "apps" {',
			'  name          = "snet-apps"',
			'  ip_cidr_range = "10.30.1.0/24"',
			'  region        = "europe-west2"',
			'  network       = google_compute_network.core.id',
			'}',
			'',
			'resource "google_compute_firewall" "allow_https" {',
			'  name    = "fw-allow-https"',
			'  network = google_compute_network.core.name',
			'}',
		]),
	},
	{
		id: 'tpl-k8s-app-namespace',
		name: 'Kubernetes App Namespace & Policy',
		provider: 'kubernetes',
		version: '1.0.0',
		author: 'CloudForge',
		category: 'Applications',
		summary: 'Isolated Kubernetes application namespace paired with a baseline ConfigMap and default-deny NetworkPolicy.',
		tags: ['kubernetes', 'namespace', 'network-policy'],
		resourceCount: 3,
		defaultArchName: 'K8sAppNamespace',
		thumbnailNodes: [
			{ label: 'NS', col: 0, row: 0 },
			{ label: 'Config', col: 1, row: 0 },
			{ label: 'NetPol', col: 1, row: 1 },
		],
		starterMainTf: tfLines([
			'# CloudForge Template: Kubernetes App Namespace & Policy (v1.0.0)',
			'terraform {',
			'  required_providers {',
			'    kubernetes = {',
			'      source  = "hashicorp/kubernetes"',
			'      version = "~> 2.35"',
			'    }',
			'  }',
			'}',
			'',
			'resource "kubernetes_namespace" "app" {',
			'  metadata {',
			'    name = "workloads"',
			'  }',
			'}',
			'',
			'resource "kubernetes_config_map" "app_config" {',
			'  metadata {',
			'    name      = "app-settings"',
			'    namespace = kubernetes_namespace.app.metadata[0].name',
			'  }',
			'}',
			'',
			'resource "kubernetes_network_policy" "default_deny" {',
			'  metadata {',
			'    name      = "default-deny-ingress"',
			'    namespace = kubernetes_namespace.app.metadata[0].name',
			'  }',
			'}',
		]),
	},
];

export function findTemplateById(templateId: string): ArchitectureTemplate | undefined {
	return TEMPLATE_LIBRARY.find(t => t.id === templateId);
}

export function filterTemplates(
	templates: readonly ArchitectureTemplate[],
	query: string,
	provider: TemplateProvider | 'all',
	sortBy: 'name' | 'resources'
): readonly ArchitectureTemplate[] {
	const needle = query.trim().toLowerCase();
	const filtered = templates.filter(tpl => {
		if (provider !== 'all' && tpl.provider !== provider) {
			return false;
		}
		if (!needle) {
			return true;
		}
		return tpl.name.toLowerCase().includes(needle)
			|| tpl.summary.toLowerCase().includes(needle)
			|| tpl.category.toLowerCase().includes(needle)
			|| tpl.provider.includes(needle)
			|| tpl.tags.some(tag => tag.toLowerCase().includes(needle));
	});
	return [...filtered].sort((a, b) => sortBy === 'resources'
		? b.resourceCount - a.resourceCount || a.name.localeCompare(b.name)
		: a.name.localeCompare(b.name));
}
