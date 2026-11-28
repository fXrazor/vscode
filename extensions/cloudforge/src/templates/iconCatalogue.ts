/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Resource icons and labels for template previews, from the same provider catalogue snapshots and
// icon files the Studio canvas uses (studio/assets/catalogue/*.json, staged into media/studio).
// The curated core AWS and Google Cloud entries carry the Azure resource-group placeholder; the
// overrides below match studio/src/coreIcons.ts plus the gaps found in the template previews.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogueLookup } from './preview.ts';

const PLACEHOLDER = 'azure-resource-groups.svg';
const aws = (file: string) => 'catalog-icons/aws/aws-' + file + '.svg';
const gcp = (file: string) => 'catalog-icons/gcp/gcp-' + file + '.svg';
const azure = (file: string) => 'catalog-icons/azure/azure-' + file + '.svg';

/** Keep in step with studio/src/coreIcons.ts; the extension cannot import Studio source. */
export const TEMPLATE_ICON_OVERRIDES: Readonly<Record<string, string>> = {
	aws_vpc: aws('virtual-private-cloud'), aws_subnet: aws('private-subnet'), aws_security_group: aws('vpc-traffic-mirroring'),
	aws_instance: aws('ec2'), aws_eks_cluster: aws('eks-cloud'), aws_eip: aws('vpc-elastic-network-adapter'), aws_iam_role: aws('identity-and-access-management'),
	aws_internet_gateway: aws('internet-gateway'), aws_nat_gateway: aws('nat-gateway'), aws_lambda_function: aws('lambda'), aws_db_instance: aws('rds'),
	aws_route_table: aws('route-table'), aws_route_table_association: aws('route-table'), aws_s3_bucket: aws('s3-on-outposts'),
	google_compute_network: gcp('cloud-network'), google_compute_subnetwork: gcp('network-tiers'), google_compute_firewall: gcp('cloud-firewall-rules'),
	google_compute_instance: gcp('compute-engine'), google_container_cluster: gcp('gke-on-prem'), google_sql_database_instance: gcp('cloud-sql'),
	google_storage_bucket: gcp('cloud-storage'), google_cloud_run_v2_service: gcp('cloud-run'), google_pubsub_topic: gcp('pubsub'), google_project: gcp('project'),
	google_compute_router: gcp('cloud-router'), google_compute_router_nat: gcp('cloud-router'),
	// The load balancer chain shares the Compute Engine icon in the snapshot; use the load balancing mark.
	google_compute_forwarding_rule: 'gcp-cloud-load-balancing.svg', google_compute_global_forwarding_rule: 'gcp-cloud-load-balancing.svg',
	google_compute_region_target_http_proxy: 'gcp-cloud-load-balancing.svg', google_compute_target_http_proxy: 'gcp-cloud-load-balancing.svg',
	google_compute_region_url_map: 'gcp-cloud-load-balancing.svg', google_compute_url_map: 'gcp-cloud-load-balancing.svg',
	google_compute_region_backend_service: 'gcp-cloud-load-balancing.svg', google_compute_backend_service: 'gcp-cloud-load-balancing.svg',
	google_compute_region_health_check: gcp('cloud-monitoring'), google_compute_health_check: gcp('cloud-monitoring'),
	azurerm_public_ip: azure('public-ip-addresses'), azurerm_subnet_network_security_group_association: azure('network-security-groups'),
};

export const PROVIDER_MARKS: Readonly<Record<string, string>> = {
	azure: 'provider-azure.svg',
	aws: 'provider-aws.svg',
	gcp: 'provider-gcp.svg',
};

interface Entry { readonly icon?: string; readonly label?: string }

function isSafeIcon(icon: unknown): icon is string {
	return typeof icon === 'string' && /^(?:catalog-icons\/(?:azure|aws|gcp)\/)?[A-Za-z0-9_-]+\.svg$/.test(icon);
}

/** Reads the type → icon and label map from one catalogue snapshot. Malformed entries are skipped. */
export function parseCatalogueIcons(value: unknown): Map<string, Entry> {
	const out = new Map<string, Entry>();
	const entries = typeof value === 'object' && value !== null ? (value as { entries?: unknown }).entries : undefined;
	if (!Array.isArray(entries)) {
		return out;
	}
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const { type, icon, label } = entry as { type?: unknown; icon?: unknown; label?: unknown };
		if (typeof type !== 'string' || type.length > 128) {
			continue;
		}
		const placeholder = typeof icon === 'string' && (icon === PLACEHOLDER || icon.endsWith('/' + PLACEHOLDER)) && type !== 'azurerm_resource_group';
		out.set(type, {
			...(isSafeIcon(icon) && !placeholder ? { icon } : {}),
			...(typeof label === 'string' && label.length <= 120 ? { label } : {}),
		});
	}
	return out;
}

/**
 * Loads the catalogue snapshots under `assetsDir` (media/studio/assets in a build, studio/assets
 * in a dev checkout). A missing or unreadable snapshot just means fewer icons.
 */
export async function loadIconCatalogue(assetsDir: string | undefined): Promise<CatalogueLookup> {
	const merged = new Map<string, Entry>();
	if (assetsDir) {
		for (const provider of ['azure', 'aws', 'gcp']) {
			try {
				const text = await readFile(join(assetsDir, 'catalogue', provider + '.json'), 'utf8');
				for (const [type, entry] of parseCatalogueIcons(JSON.parse(text))) {
					merged.set(type, entry);
				}
			} catch {
				// No snapshot for this provider: previews fall back to glyphs.
			}
		}
	}
	return type => {
		const entry = merged.get(type);
		const override = TEMPLATE_ICON_OVERRIDES[type];
		if (!entry && !override) {
			return undefined;
		}
		return { ...entry, ...(override ? { icon: override } : {}) };
	};
}
