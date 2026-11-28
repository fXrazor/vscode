/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Template previews: turns a template's Terraform into a small diagram model (nodes, containment
// and reference edges) that the Template Library page draws the way the Studio canvas does:
// provider boundary, resource groups and networks as nested containers, resources as icon nodes,
// references as arrows. Containment comes from the package's layout.json `visualParent` when it
// has one, otherwise from references to container resources (a subnet references its network, a
// VM references its subnet). Nothing is evaluated. Zero vscode imports; tested directly in Node.

import { parseLiteral, readAttributes, scanTerraformBlocks, type TerraformBlock } from './hclScan.ts';

export type DiagramProvider = 'azure' | 'aws' | 'gcp' | 'kubernetes' | 'other';

export interface DiagramNode {
	/** Terraform address: `type.name`, `data.type.name` or `module.name`. */
	readonly id: string;
	readonly type: string;
	readonly name: string;
	/** Short kind label, for example "VNet" or "NAT gateway". */
	readonly label: string;
	/** Address space or CIDR for networks, when the Terraform states it. */
	readonly detail?: string;
	/** Icon path relative to the Studio assets folder, for example `catalog-icons/azure/x.svg`. */
	readonly icon?: string;
	readonly provider: DiagramProvider;
	readonly container: boolean;
	readonly parent?: string;
	readonly role: 'resource' | 'data' | 'module';
	readonly file: string;
	readonly line: number;
}

export interface TemplateDiagram {
	readonly nodes: readonly DiagramNode[];
	/** Reference arrows from the referencing node to the referenced one, de-duplicated. */
	readonly edges: readonly (readonly [string, string])[];
	/** Providers in the order they first appear. */
	readonly providers: readonly DiagramProvider[];
}

export interface TemplateVariable {
	readonly name: string;
	readonly type?: string;
	readonly description?: string;
	/** Raw HCL of the default, when there is one. */
	readonly defaultRaw?: string;
	readonly sensitive: boolean;
	readonly file: string;
}

/** How deep a container type nests. A container only goes inside a shallower one. */
const CONTAINER_DEPTH: Readonly<Record<string, number>> = {
	azurerm_resource_group: 1,
	azurerm_virtual_network: 2,
	azurerm_subnet: 3,
	aws_vpc: 2,
	aws_subnet: 3,
	google_compute_network: 2,
	google_compute_subnetwork: 3,
	kubernetes_namespace: 1,
	kubernetes_namespace_v1: 1,
};

/** Short labels, as the canvas and mock-up show them. Others fall back to the catalogue label. */
const SHORT_LABEL: Readonly<Record<string, string>> = {
	resource_group: 'Resource group', virtual_network: 'VNet', subnet: 'Subnet', virtual_network_peering: 'VNet peering',
	network_security_group: 'NSG', subnet_network_security_group_association: 'NSG link', route_table: 'Route table',
	subnet_route_table_association: 'Route table link', public_ip: 'Public IP', kubernetes_cluster: 'AKS cluster',
	network_interface: 'Network interface', linux_virtual_machine: 'Linux VM', windows_virtual_machine: 'Windows VM',
	bastion_host: 'Bastion', firewall: 'Firewall', private_dns_zone: 'Private DNS zone',
	private_dns_zone_virtual_network_link: 'DNS VNet link', log_analytics_workspace: 'Log Analytics', key_vault: 'Key Vault',
	storage_account: 'Storage account', vpc: 'VPC', internet_gateway: 'Internet gateway', eip: 'Elastic IP',
	nat_gateway: 'NAT gateway', route: 'Route', route_table_association: 'Route assoc.', security_group: 'Security group',
	iam_role: 'IAM role', iam_role_policy_attachment: 'Policy attachment', eks_cluster: 'EKS cluster', eks_node_group: 'Node group',
	ec2_transit_gateway: 'Transit gateway', ec2_transit_gateway_vpc_attachment: 'TGW attachment', cloudwatch_log_group: 'Log group',
	flow_log: 'Flow log', instance: 'EC2 instance', s3_bucket: 'S3 bucket', s3_bucket_versioning: 'Versioning',
	s3_bucket_object_lock_configuration: 'Object lock', db_instance: 'RDS instance', lb: 'Load balancer',
	compute_network: 'VPC network', compute_subnetwork: 'Subnetwork', compute_firewall: 'Firewall rule',
	compute_region_health_check: 'Health check', compute_health_check: 'Health check', compute_region_backend_service: 'Backend service',
	compute_backend_service: 'Backend service', compute_region_url_map: 'URL map', compute_url_map: 'URL map',
	compute_region_target_http_proxy: 'HTTP proxy', compute_target_http_proxy: 'HTTP proxy', compute_forwarding_rule: 'Forwarding rule',
	compute_global_forwarding_rule: 'Forwarding rule', compute_instance: 'VM instance', compute_router: 'Cloud Router',
	compute_router_nat: 'Cloud NAT', container_cluster: 'GKE cluster', namespace: 'Namespace', namespace_v1: 'Namespace',
	config_map: 'Config map', config_map_v1: 'Config map', network_policy: 'Network policy', network_policy_v1: 'Network policy',
	deployment: 'Deployment', deployment_v1: 'Deployment', service: 'Service', service_v1: 'Service',
};

const CIDR_ATTRIBUTES = ['address_space', 'address_prefixes', 'address_prefix', 'cidr_block', 'ip_cidr_range'];
const CIDR = /\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/;
const MAX_NODES = 400;

export function providerOfType(type: string): DiagramProvider {
	if (type.startsWith('azurerm_') || type.startsWith('azapi_')) {
		return 'azure';
	}
	if (type.startsWith('aws_')) {
		return 'aws';
	}
	if (type.startsWith('google_')) {
		return 'gcp';
	}
	if (type.startsWith('kubernetes_') || type.startsWith('helm_')) {
		return 'kubernetes';
	}
	return 'other';
}

function bareType(type: string): string {
	return type.replace(/^(azurerm|azapi|aws|google|kubernetes|helm)_/, '');
}

export function shortLabel(type: string, catalogueLabel?: string): string {
	const short = SHORT_LABEL[bareType(type)];
	if (short) {
		return short;
	}
	if (catalogueLabel) {
		return catalogueLabel;
	}
	const words = bareType(type).replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isContainerType(type: string): boolean {
	return CONTAINER_DEPTH[type] !== undefined;
}

function addressOf(block: TerraformBlock): string | undefined {
	if (block.kind === 'resource' && block.labels.length >= 2) {
		return block.labels[0] + '.' + block.labels[1];
	}
	if (block.kind === 'data' && block.labels.length >= 2) {
		return 'data.' + block.labels[0] + '.' + block.labels[1];
	}
	if (block.kind === 'module' && block.labels.length >= 1) {
		return 'module.' + block.labels[0];
	}
	return undefined;
}

/** Addresses referenced in a body, in first-use order, limited to `known`. */
export function referencedAddresses(body: string, known: ReadonlySet<string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const pattern = /(?<![\w.-])(data\.)?([a-z][a-z0-9]*_[a-z0-9_]+|module)\.([A-Za-z_][A-Za-z0-9_-]*)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(body))) {
		const address = (match[1] ?? '') + match[2] + '.' + match[3];
		if (known.has(address) && !seen.has(address)) {
			seen.add(address);
			out.push(address);
		}
	}
	return out;
}

/** Variables declared by the template's files, in file order. */
export function templateVariables(files: readonly { readonly fileName: string; readonly contents: string }[]): TemplateVariable[] {
	const out: TemplateVariable[] = [];
	for (const file of files) {
		for (const block of scanTerraformBlocks(file.contents, file.fileName)) {
			if (block.kind !== 'variable' || block.labels.length !== 1) {
				continue;
			}
			const attributes = readAttributes(block.body);
			const description = parseLiteral(attributes.get('description'));
			out.push({
				name: block.labels[0],
				...(attributes.has('type') ? { type: attributes.get('type')!.replace(/\s+/g, ' ') } : {}),
				...(typeof description === 'string' ? { description } : {}),
				...(attributes.has('default') ? { defaultRaw: attributes.get('default') } : {}),
				sensitive: attributes.get('sensitive') === 'true',
				file: file.fileName,
			});
		}
	}
	return out;
}

function cidrOf(attributes: ReadonlyMap<string, string>, variables: ReadonlyMap<string, TemplateVariable>): string | undefined {
	for (const name of CIDR_ATTRIBUTES) {
		const raw = attributes.get(name);
		if (!raw) {
			continue;
		}
		const literal = CIDR.exec(raw);
		if (literal) {
			return literal[0];
		}
		// Only a bare `var.x` (or `[var.x]`) takes the variable's default; cidrsubnet() and friends do not.
		const variable = /^\[?\s*var\.([A-Za-z_][A-Za-z0-9_-]*)\s*\]?$/.exec(raw);
		const fallback = variable ? variables.get(variable[1])?.defaultRaw : undefined;
		const fromDefault = fallback ? CIDR.exec(fallback) : null;
		if (fromDefault) {
			return fromDefault[0];
		}
	}
	return undefined;
}

export interface CatalogueLookup {
	(type: string): { readonly icon?: string; readonly label?: string } | undefined;
}

/** Visual parents from a package layout.json (`resources[address].visualParent`), when present. */
function layoutParents(layout: unknown): Map<string, string> {
	const out = new Map<string, string>();
	if (typeof layout !== 'object' || layout === null) {
		return out;
	}
	const resources = (layout as { resources?: unknown }).resources;
	if (typeof resources !== 'object' || resources === null) {
		return out;
	}
	for (const [address, entry] of Object.entries(resources as Record<string, unknown>)) {
		const parent = typeof entry === 'object' && entry !== null ? (entry as { visualParent?: unknown }).visualParent : undefined;
		if (typeof parent === 'string') {
			out.set(address, parent);
		}
	}
	return out;
}

/** Builds the preview diagram for a template's Terraform files. */
export function buildTemplateDiagram(
	files: readonly { readonly fileName: string; readonly contents: string }[],
	catalogue: CatalogueLookup = () => undefined,
	layout?: unknown,
	fallbackProvider: DiagramProvider = 'other',
): TemplateDiagram {
	const blocks: { block: TerraformBlock; address: string }[] = [];
	const variables = new Map(templateVariables(files).map(v => [v.name, v]));
	for (const file of files) {
		for (const block of scanTerraformBlocks(file.contents, file.fileName)) {
			const address = addressOf(block);
			if (address && blocks.length < MAX_NODES && !blocks.some(b => b.address === address)) {
				blocks.push({ block, address });
			}
		}
	}
	const known = new Set(blocks.map(b => b.address));
	const refs = new Map(blocks.map(({ block, address }) => [address, referencedAddresses(block.body, known).filter(a => a !== address)]));
	const typeOf = new Map(blocks.map(({ block, address }) => [address, block.kind === 'module' ? 'module' : block.labels[0]]));
	const depthOf = (address: string) => CONTAINER_DEPTH[typeOf.get(address) ?? ''];
	const providerOf = (address: string): DiagramProvider => {
		const type = typeOf.get(address) ?? '';
		return type === 'module' ? fallbackProvider : providerOfType(type);
	};

	const fromLayout = layoutParents(layout);
	const parents = new Map<string, string | undefined>();
	const visiting = new Set<string>();
	const ancestors = (address: string): string[] => {
		const chain: string[] = [];
		let current = parentOf(address);
		while (current && !chain.includes(current) && chain.length < 16) {
			chain.push(current);
			current = parentOf(current);
		}
		return chain;
	};
	function parentOf(address: string): string | undefined {
		if (parents.has(address)) {
			return parents.get(address);
		}
		if (visiting.has(address)) {
			return undefined;
		}
		visiting.add(address);
		let parent: string | undefined;
		const own = depthOf(address);
		const declared = fromLayout.get(address);
		if (declared && known.has(declared) && depthOf(declared) !== undefined && declared !== address) {
			parent = declared;
		} else {
			const direct = (refs.get(address) ?? []).filter(target => {
				const depth = depthOf(target);
				return depth !== undefined && (own === undefined || depth < own) && providerOf(target) === providerOf(address);
			});
			if (direct.length > 0) {
				const deepest = Math.max(...direct.map(target => depthOf(target)!));
				const candidates = direct.filter(target => depthOf(target) === deepest);
				parent = candidates.length === 1 ? candidates[0] : commonAncestor(candidates);
			} else if (own === undefined) {
				// No container referenced: sit beside the first resource it uses.
				for (const target of refs.get(address) ?? []) {
					if (providerOf(target) !== providerOf(address)) {
						continue;
					}
					parent = depthOf(target) !== undefined ? target : parentOf(target);
					if (parent) {
						break;
					}
				}
			}
		}
		visiting.delete(address);
		parents.set(address, parent);
		return parent;
	}
	function commonAncestor(candidates: readonly string[]): string | undefined {
		const chains = candidates.map(candidate => [candidate, ...ancestors(candidate)]);
		return chains[0].slice(1).find(item => chains.every(chain => chain.includes(item)));
	}

	const nodes: DiagramNode[] = blocks.map(({ block, address }) => {
		const type = typeOf.get(address)!;
		const entry = type === 'module' ? undefined : catalogue(type);
		const attributes = readAttributes(block.body);
		const detail = isContainerType(type) ? cidrOf(attributes, variables) : undefined;
		const parent = parentOf(address);
		return {
			id: address,
			type,
			name: block.kind === 'module' ? block.labels[0] : block.labels[1],
			label: type === 'module' ? 'Module' : shortLabel(type, entry?.label),
			...(detail ? { detail } : {}),
			...(entry?.icon ? { icon: entry.icon } : {}),
			provider: providerOf(address),
			container: isContainerType(type),
			...(parent ? { parent } : {}),
			role: block.kind === 'data' ? 'data' : block.kind === 'module' ? 'module' : 'resource',
			file: block.file,
			line: block.line,
		};
	});

	const edges: [string, string][] = [];
	const pairs = new Set<string>();
	for (const node of nodes) {
		const mine = ancestors(node.id);
		for (const target of refs.get(node.id) ?? []) {
			if (mine.includes(target) || ancestors(target).includes(node.id)) {
				continue;
			}
			const key = [node.id, target].sort().join('|');
			if (!pairs.has(key)) {
				pairs.add(key);
				edges.push([node.id, target]);
			}
		}
	}
	const providers: DiagramProvider[] = [];
	for (const node of nodes) {
		if (!providers.includes(node.provider)) {
			providers.push(node.provider);
		}
	}
	return { nodes, edges, providers };
}
