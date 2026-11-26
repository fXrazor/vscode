/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { CanvasCatalogueSnapshot, CanvasDependencyReport } from './protocol.ts';

/** Exact lock evidence only. A similarly named provider, registry or newer release is not a substitute. */
export function selectLockedSnapshot(snapshots: readonly CanvasCatalogueSnapshot[], typeName: string, report: CanvasDependencyReport | undefined, sourceRevision: string): CanvasCatalogueSnapshot | undefined {
	if (!report || report.sourceRevision !== sourceRevision || report.lockState !== 'valid') { return undefined; }
	const prefix = typeName.split('_')[0];
	const providers = report.providers.filter(provider => provider.address?.split('/')[2] === prefix);
	if (providers.length !== 1 || providers[0].status !== 'locked' || providers[0].conflictCount !== 0) { return undefined; }
	const dependency = providers[0];
	const entries = report.lockEntries?.filter(entry => entry.address === dependency.address) ?? [];
	if (entries.length !== 1 || entries[0].version !== dependency.lockedVersion) { return undefined; }
	const matches = snapshots.filter(snapshot => snapshot.address === dependency.address && snapshot.version === entries[0].version);
	// Multiple distinct digests for one release require an explicit provenance choice.
	return matches.length === 1 ? matches[0] : undefined;
}
