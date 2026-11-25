/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Projects / architecture gallery model (Rust design.md "Projects and Template Library").
// Pure TypeScript: no `vscode` or DOM imports, so it runs under node:test.

import type { ProjectArchitecture, ProjectResult } from './model';

export type ArchitectureSummaryStatus = 'available' | 'empty' | 'unavailable' | 'skipped';

/** One entry of the service's `summarizeArchitectures` result. */
export interface ArchitectureSummary {
	readonly architectureId: string;
	readonly status: ArchitectureSummaryStatus;
	readonly sourceRevision?: string;
	readonly fileCount?: number;
	readonly resourceCount?: number;
	readonly dataSourceCount?: number;
	readonly moduleCount?: number;
	readonly providers?: readonly string[];
	/** RFC 3339 UTC. */
	readonly lastModified?: string;
}

export interface GalleryCard {
	readonly architectureId: string;
	readonly displayName: string;
	readonly source: 'local' | 'repository';
	readonly repositoryName?: string;
	readonly status: ArchitectureSummaryStatus | 'loading';
	readonly resourceCount?: number;
	readonly dataSourceCount?: number;
	readonly moduleCount?: number;
	readonly fileCount?: number;
	readonly providers: readonly string[];
	readonly lastModified?: string;
}

const statuses: ReadonlySet<string> = new Set<ArchitectureSummaryStatus>(['available', 'empty', 'unavailable', 'skipped']);
const MAX_ITEMS = 256;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
}

/** Validates a `summarizeArchitectures` result for the given grant; anything malformed is dropped. */
export function parseArchitectureSummaries(value: unknown, workspaceId: string): Map<string, ArchitectureSummary> | undefined {
	if (!isRecord(value) || value.workspaceId !== workspaceId || !Array.isArray(value.architectures) || value.architectures.length > MAX_ITEMS) {
		return undefined;
	}
	const result = new Map<string, ArchitectureSummary>();
	for (const item of value.architectures) {
		if (!isRecord(item) || typeof item.architectureId !== 'string' || typeof item.status !== 'string' || !statuses.has(item.status)) {
			continue;
		}
		const providers = Array.isArray(item.providers)
			? item.providers.filter((provider): provider is string => typeof provider === 'string' && /^[a-z0-9]{1,32}$/.test(provider)).slice(0, 16)
			: undefined;
		result.set(item.architectureId, {
			architectureId: item.architectureId,
			status: item.status as ArchitectureSummaryStatus,
			sourceRevision: typeof item.sourceRevision === 'string' && /^[0-9a-f]{64}$/.test(item.sourceRevision) ? item.sourceRevision : undefined,
			fileCount: count(item.fileCount),
			resourceCount: count(item.resourceCount),
			dataSourceCount: count(item.dataSourceCount),
			moduleCount: count(item.moduleCount),
			providers,
			lastModified: typeof item.lastModified === 'string' && timestamp.test(item.lastModified) ? item.lastModified : undefined,
		});
	}
	return result;
}

/** Joins the project's architectures with their summaries (or `loading` before they arrive). */
export function buildGalleryCards(project: ProjectResult, summaries: ReadonlyMap<string, ArchitectureSummary> | undefined): GalleryCard[] {
	return project.architectures.map((architecture: ProjectArchitecture) => {
		const summary = summaries?.get(architecture.architectureId);
		const repositoryName = architecture.repositoryId
			? project.repositories.find(repository => repository.repositoryId === architecture.repositoryId)?.displayName
			: undefined;
		return {
			architectureId: architecture.architectureId,
			displayName: architecture.displayName,
			source: architecture.source,
			repositoryName,
			status: summary ? summary.status : summaries ? 'unavailable' : 'loading',
			resourceCount: summary?.resourceCount,
			dataSourceCount: summary?.dataSourceCount,
			moduleCount: summary?.moduleCount,
			fileCount: summary?.fileCount,
			providers: summary?.providers ?? [],
			lastModified: summary?.lastModified,
		};
	});
}

/** Short relative label for a card's last-edited time, such as "5 min ago" or "3 days ago". */
export function relativeTime(iso: string | undefined, now: number): string | undefined {
	if (!iso) {
		return undefined;
	}
	const then = Date.parse(iso);
	if (Number.isNaN(then)) {
		return undefined;
	}
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) {
		return 'just now';
	}
	const units: [number, string][] = [[60, 'min'], [3600, 'hour'], [86_400, 'day'], [2_592_000, 'month'], [31_536_000, 'year']];
	let label = '';
	for (const [size, name] of units) {
		if (seconds >= size) {
			const value = Math.floor(seconds / size);
			label = `${value} ${name}${value === 1 || name === 'min' ? '' : 's'} ago`;
		}
	}
	return label;
}

const providerLabels: Readonly<Record<string, string>> = {
	azurerm: 'Azure', azapi: 'Azure (AzAPI)', azuread: 'Entra ID', aws: 'AWS', google: 'Google Cloud',
	kubernetes: 'Kubernetes', helm: 'Helm', random: 'Random', null: 'Null', local: 'Local', tls: 'TLS',
};

export function providerLabel(prefix: string): string {
	return providerLabels[prefix] ?? prefix;
}
