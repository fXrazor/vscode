/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Resource } from './model.ts';
import { resourceDefinition } from './fixture.ts';

/** Graphics are presentation metadata; provider/type and Terraform identity stay untouched. */
export function resourceGraphic(resource: Resource) {
	if (resource.iconOverride && /^(?:catalog-icons\/(?:azure|aws|gcp)\/)?[a-zA-Z0-9_-]+\.svg$/.test(resource.iconOverride.icon)) { return resource.iconOverride; }
	return resource.iconKind ? resourceDefinition({ kind: resource.iconKind, provider: resource.provider }) : resourceDefinition(resource);
}
