/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const acronyms: Record<string, string> = {
	id: 'ID', ids: 'IDs', ip: 'IP', ips: 'IPs', ipv4: 'IPv4', ipv6: 'IPv6', dns: 'DNS', cidr: 'CIDR', vpc: 'VPC', vpn: 'VPN', nat: 'NAT', ssl: 'SSL', tls: 'TLS', http: 'HTTP', https: 'HTTPS',
	tcp: 'TCP', udp: 'UDP', url: 'URL', uri: 'URI', arn: 'ARN', kms: 'KMS', iam: 'IAM', sku: 'SKU', os: 'OS', vm: 'VM', vms: 'VMs', aks: 'AKS', eks: 'EKS', gke: 'GKE', api: 'API', ssh: 'SSH',
	tgw: 'TGW', ipam: 'IPAM', mtu: 'MTU', ttl: 'TTL', sql: 'SQL', gpu: 'GPU', cpu: 'CPU', az: 'AZ', fqdn: 'FQDN', acl: 'ACL', acls: 'ACLs', nsg: 'NSG', rbac: 'RBAC', ad: 'AD', ha: 'HA', sla: 'SLA',
};

/** Readable form label for a Terraform argument name ("enable_dns_hostnames" → "Enable DNS hostnames"). The raw name stays in tooltips and Terraform. */
export function fieldLabel(name: string): string {
	const words = name.split('_').filter(Boolean).map(word => acronyms[word.toLowerCase()] ?? word.toLowerCase());
	if (!words.length) { return name; }
	const first = words[0];
	words[0] = first === first.toLowerCase() ? first[0].toUpperCase() + first.slice(1) : first;
	return words.join(' ');
}
