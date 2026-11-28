/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { getDef, registerFormAttributes, setCatalogReader } from './cloudlab-core/catalog/index.ts';
import { liveSchemaDefinitionTree, type HostFormSchema } from './liveSchema.ts';

export function registerLiveFormSchema(schema: HostFormSchema): void {
	if (schema.kind !== 'resource') { return; }
	const provider = schema.typeName.startsWith('azurerm_') ? 'azurerm' : schema.typeName.startsWith('aws_') ? 'aws' : schema.typeName.startsWith('google_') ? 'google' : undefined;
	if (provider) { registerFormAttributes(schema.typeName, provider, liveSchemaDefinitionTree(schema, getDef(schema.typeName)?.attributes)); }
}

export interface ProviderFormEvidence {
	readonly schemaCapture?: { readonly provider: string; readonly version: string; readonly schemaSha256: string; readonly signedByHashiCorp: boolean };
	readonly url?: string;
	readonly matchesDeclaredVersionTag: boolean;
	readonly unmappedArgumentNames: readonly string[];
	readonly argumentSectionRecognized: boolean;
	readonly exampleHcl?: string;
}

/** Documentation evidence is explicitly separate from a live executable provider schema. */
export function providerFormEvidence(typeName: string): ProviderFormEvidence | undefined {
	return (getDef(typeName) as (ReturnType<typeof getDef> & { formEvidence?: ProviderFormEvidence }))?.formEvidence;
}

/** Use the existing lazy recursive catalogue in both a preview and the packaged Webview. */
export function configureProviderCatalogue(): void {
	setCatalogReader(async relativePath => {
		if (!/^(azurerm|aws|google)\/(index|resources)\.json$/.test(relativePath)) {
			throw new Error('Unsupported bundled provider catalogue path.');
		}
		const response = await fetch('./assets/provider-forms/' + relativePath);
		if (!response.ok) { throw new Error('Bundled provider form could not be loaded (' + response.status + ').'); }
		return response.json();
	});
}
