/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Resource } from './model.ts';

export const iconSizeLimits = { min: 24, max: 160, default: 48 };

/** The visual icon, its ports, resize outline and export share the same world-space square. */
export function resourceIconSize(resource: Resource): number {
	const size = resource.iconSize;
	return size !== undefined && Number.isFinite(size) ? Math.max(iconSizeLimits.min, Math.min(iconSizeLimits.max, size)) : iconSizeLimits.default;
}
