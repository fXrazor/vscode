/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Providers view: pure presentation model. Joins the architecture's dependency report, the local
// offline mirror inventory and the imported catalogue snapshots into Extensions-style rows.
// Zero vscode imports; safe to test directly in Node.

import type { CanvasCatalogueSnapshot, CanvasDependencyReport } from '../canvas/protocol';
import type { MirrorPackageSummary } from '../providerMirror/model';

/** The platform local schema extraction and offline init run on. */
export const LOCAL_PLATFORM = 'windows_amd64';

export type ProjectProviderStatus =
	/** Locked version has an extracted schema: Studio forms match the project. */
	| 'ready'
	/** Locked version is in the mirror but its schema has not been extracted yet. */
	| 'schemaNotExtracted'
	/** Locked version is not in the mirror. */
	| 'notDownloaded'
	/** No lock entry: the version Terraform would pick is not pinned yet. */
	| 'unlocked'
	/** The lock file and the constraints disagree, or no release matches. */
	| 'conflict';

export interface ProjectProviderRow {
	readonly address?: string;
	readonly display: string;
	readonly version?: string;
	readonly status: ProjectProviderStatus;
	/** Newest extracted schema for this provider when it differs from the locked version. */
	readonly otherSchemaVersion?: string;
	readonly platforms: readonly string[];
}

export interface InstalledVersionRow {
	readonly address: string;
	readonly version: string;
	readonly platforms: readonly string[];
	readonly sizeBytes: number;
	readonly hasSchema: boolean;
	readonly usedByProject: boolean;
	/** Imported straight from a schema snapshot file, with no mirrored package. */
	readonly schemaOnly: boolean;
}

export interface InstalledProviderRow {
	readonly address: string;
	readonly display: string;
	readonly versions: readonly InstalledVersionRow[];
}

export interface ProvidersModel {
	readonly hasArchitecture: boolean;
	readonly lockState?: CanvasDependencyReport['lockState'];
	readonly project: readonly ProjectProviderRow[];
	readonly installed: readonly InstalledProviderRow[];
	readonly attentionCount: number;
}

/** `hostname/namespace/type` with registry-safe segments. */
export function isProviderAddress(value: string): boolean {
	const parts = value.split('/');
	return parts.length === 3 && /^[a-z0-9.-]+$/i.test(parts[0]) && parts[0].includes('.') && parts.slice(1).every(part => /^[a-z0-9_-]+$/i.test(part));
}

/** `registry.terraform.io/hashicorp/azurerm` → `hashicorp/azurerm`. */
export function shortProviderName(address: string): string {
	const parts = address.split('/');
	return parts.length === 3 ? parts[1] + '/' + parts[2] : address;
}

/** Numeric-aware descending semver-ish sort; prerelease tails sort after their release. */
export function compareVersionsDesc(a: string, b: string): number {
	const parse = (value: string) => {
		const [core, pre] = value.split('-', 2);
		return { nums: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre };
	};
	const left = parse(a); const right = parse(b);
	for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i++) {
		const diff = (right.nums[i] ?? 0) - (left.nums[i] ?? 0);
		if (diff) { return diff; }
	}
	if (left.pre && !right.pre) { return 1; }
	if (!left.pre && right.pre) { return -1; }
	return (right.pre ?? '').localeCompare(left.pre ?? '');
}

const key = (address: string, version: string) => address.toLowerCase() + '@' + version;

export function buildProvidersModel(input: {
	readonly report?: CanvasDependencyReport;
	readonly packages: readonly MirrorPackageSummary[];
	readonly snapshots: readonly CanvasCatalogueSnapshot[];
}): ProvidersModel {
	const schemas = new Set(input.snapshots.map(snapshot => key(snapshot.address, snapshot.version)));
	const mirrored = new Map<string, MirrorPackageSummary[]>();
	for (const pkg of input.packages) {
		const id = key(pkg.key.address, pkg.key.version);
		mirrored.set(id, [...(mirrored.get(id) ?? []), pkg]);
	}
	const lockVersions = new Map((input.report?.lockEntries ?? []).map(entry => [entry.address.toLowerCase(), entry.version]));
	const used = new Set<string>();

	const project: ProjectProviderRow[] = (input.report?.providers ?? []).map(provider => {
		const address = provider.address?.toLowerCase();
		const version = provider.lockedVersion ?? (address ? lockVersions.get(address) : undefined);
		if (address && version) { used.add(key(address, version)); }
		const packages = address && version ? mirrored.get(key(address, version)) ?? [] : [];
		const otherSchemaVersion = address
			? input.snapshots.filter(snapshot => snapshot.address.toLowerCase() === address && snapshot.version !== version).map(snapshot => snapshot.version).sort(compareVersionsDesc)[0]
			: undefined;
		let status: ProjectProviderStatus;
		if (provider.status === 'conflict' || provider.status === 'lockOutsideConstraints' || provider.status === 'noMatchingRelease') {
			status = 'conflict';
		} else if (!version) {
			status = 'unlocked';
		} else if (address && schemas.has(key(address, version))) {
			status = 'ready';
		} else if (packages.some(pkg => pkg.key.platform === LOCAL_PLATFORM)) {
			status = 'schemaNotExtracted';
		} else {
			status = 'notDownloaded';
		}
		return {
			...(address ? { address } : {}),
			display: provider.display,
			...(version ? { version } : {}),
			status,
			...(otherSchemaVersion ? { otherSchemaVersion } : {}),
			platforms: packages.map(pkg => pkg.key.platform).sort(),
		};
	}).sort((a, b) => a.display.localeCompare(b.display));

	const byAddress = new Map<string, Map<string, InstalledVersionRow>>();
	const versionRow = (address: string, version: string): InstalledVersionRow => {
		const versions = byAddress.get(address) ?? new Map<string, InstalledVersionRow>();
		byAddress.set(address, versions);
		return versions.get(version) ?? { address, version, platforms: [], sizeBytes: 0, hasSchema: schemas.has(key(address, version)), usedByProject: used.has(key(address, version)), schemaOnly: true };
	};
	for (const pkg of input.packages) {
		const address = pkg.key.address.toLowerCase();
		const row = versionRow(address, pkg.key.version);
		byAddress.get(address)!.set(pkg.key.version, { ...row, platforms: [...row.platforms, pkg.key.platform].sort(), sizeBytes: row.sizeBytes + pkg.sizeBytes, schemaOnly: false });
	}
	for (const snapshot of input.snapshots) {
		const address = snapshot.address.toLowerCase();
		const row = versionRow(address, snapshot.version);
		byAddress.get(address)!.set(snapshot.version, { ...row, hasSchema: true });
	}
	const installed: InstalledProviderRow[] = [...byAddress.entries()]
		.map(([address, versions]) => ({ address, display: shortProviderName(address), versions: [...versions.values()].sort((a, b) => compareVersionsDesc(a.version, b.version)) }))
		.sort((a, b) => a.display.localeCompare(b.display));

	return {
		hasArchitecture: !!input.report,
		...(input.report ? { lockState: input.report.lockState } : {}),
		project,
		installed,
		attentionCount: project.filter(row => row.status !== 'ready').length,
	};
}

export function projectStatusLabel(row: ProjectProviderRow): string {
	switch (row.status) {
		case 'ready': return 'Schema ready';
		case 'schemaNotExtracted': return 'Downloaded · schema not extracted';
		case 'notDownloaded': return 'Not downloaded';
		case 'unlocked': return 'Version not locked';
		case 'conflict': return 'Version conflict';
	}
}

/** The single next step a row offers, so the view reads as a to-do list. */
export function projectNextAction(row: ProjectProviderRow): 'extractSchema' | 'download' | 'lock' | 'review' | undefined {
	switch (row.status) {
		case 'ready': return undefined;
		case 'schemaNotExtracted': return 'extractSchema';
		case 'notDownloaded': return 'download';
		case 'unlocked': return 'lock';
		case 'conflict': return 'review';
	}
}

export interface BrowseProvider {
	readonly address: string;
	readonly label: string;
	readonly description: string;
}

export interface BrowseGroup {
	readonly id: string;
	readonly label: string;
	readonly providers: readonly BrowseProvider[];
}

/** Common providers for the Browse section; any other address can be added by hand. */
export const BROWSE_GROUPS: readonly BrowseGroup[] = [
	{ id: 'cloud', label: 'Cloud platforms', providers: [
		{ address: 'registry.terraform.io/hashicorp/azurerm', label: 'Azure Resource Manager', description: 'hashicorp/azurerm' },
		{ address: 'registry.terraform.io/azure/azapi', label: 'Azure API', description: 'azure/azapi' },
		{ address: 'registry.terraform.io/hashicorp/azuread', label: 'Microsoft Entra ID', description: 'hashicorp/azuread' },
		{ address: 'registry.terraform.io/hashicorp/aws', label: 'Amazon Web Services', description: 'hashicorp/aws' },
		{ address: 'registry.terraform.io/hashicorp/google', label: 'Google Cloud', description: 'hashicorp/google' },
		{ address: 'registry.terraform.io/hashicorp/google-beta', label: 'Google Cloud (beta)', description: 'hashicorp/google-beta' },
	] },
	{ id: 'containers', label: 'Containers', providers: [
		{ address: 'registry.terraform.io/hashicorp/kubernetes', label: 'Kubernetes', description: 'hashicorp/kubernetes' },
		{ address: 'registry.terraform.io/hashicorp/helm', label: 'Helm', description: 'hashicorp/helm' },
	] },
	{ id: 'utility', label: 'Utility', providers: [
		{ address: 'registry.terraform.io/hashicorp/random', label: 'Random', description: 'hashicorp/random' },
		{ address: 'registry.terraform.io/hashicorp/null', label: 'Null', description: 'hashicorp/null' },
		{ address: 'registry.terraform.io/hashicorp/local', label: 'Local', description: 'hashicorp/local' },
		{ address: 'registry.terraform.io/hashicorp/tls', label: 'TLS', description: 'hashicorp/tls' },
		{ address: 'registry.terraform.io/hashicorp/time', label: 'Time', description: 'hashicorp/time' },
		{ address: 'registry.terraform.io/hashicorp/http', label: 'HTTP', description: 'hashicorp/http' },
		{ address: 'registry.terraform.io/hashicorp/archive', label: 'Archive', description: 'hashicorp/archive' },
	] },
	{ id: 'services', label: 'Services', providers: [
		{ address: 'registry.terraform.io/integrations/github', label: 'GitHub', description: 'integrations/github' },
		{ address: 'registry.terraform.io/cloudflare/cloudflare', label: 'Cloudflare', description: 'cloudflare/cloudflare' },
		{ address: 'registry.terraform.io/datadog/datadog', label: 'Datadog', description: 'datadog/datadog' },
	] },
];

/** Strict parse of a `listProviderVersions` result. */
export function parseProviderVersions(value: unknown): { readonly versions: readonly string[]; readonly stale: boolean; readonly refreshedAt?: string } | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.versions) || typeof record.stale !== 'boolean') {
		return undefined;
	}
	const versions = record.versions.filter((item): item is string => typeof item === 'string' && /^[A-Za-z0-9._+-]{1,64}$/.test(item)).slice(0, 200);
	return { versions, stale: record.stale, ...(typeof record.refreshedAt === 'string' ? { refreshedAt: record.refreshedAt.slice(0, 40) } : {}) };
}
