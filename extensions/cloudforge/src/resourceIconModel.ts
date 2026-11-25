/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for showing cloud service icons in CloudForge trees. No runtime `vscode` import,
// so `node --test` can load it directly.

/** The Studio catalogue files: `assets/catalogue/<provider>.json`. */
export type IconProvider = 'azure' | 'aws' | 'gcp';

const PREFIXES: readonly (readonly [string, IconProvider])[] = [['azurerm_', 'azure'], ['azapi_', 'azure'], ['aws_', 'aws'], ['google_', 'gcp']];
const SAFE_TYPE = /^[a-z0-9_]{1,128}$/;
// Icons are plain relative paths below the Studio assets folder, such as `catalog-icons/azure/azure-virtual-machine.svg`.
const SAFE_ICON = /^(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9._-]+\.svg$/;

/** Which provider catalogue lists a Terraform resource type, if any. */
export function iconProviderForType(type: string | null | undefined): IconProvider | undefined {
	if (!type || !SAFE_TYPE.test(type)) {
		return undefined;
	}
	return PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1];
}

/** Reads `{ entries: [{ type, icon }] }` from a Studio catalogue file, keeping only safe types and icon paths. */
export function parseCatalogueIcons(value: unknown): Map<string, string> {
	const icons = new Map<string, string>();
	const entries = typeof value === 'object' && value !== null ? (value as { entries?: unknown }).entries : undefined;
	if (!Array.isArray(entries)) {
		return icons;
	}
	for (const entry of entries.slice(0, 20000)) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const { type, icon } = entry as { type?: unknown; icon?: unknown };
		if (typeof type === 'string' && SAFE_TYPE.test(type) && typeof icon === 'string' && SAFE_ICON.test(icon) && !icon.split('/').includes('..') && !icons.has(type)) {
			icons.set(type, icon);
		}
	}
	return icons;
}
