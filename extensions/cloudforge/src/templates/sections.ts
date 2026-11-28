/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Which templates the Templates view and the library page show in each section. Zero vscode imports.

import type { TemplateSummary } from './model.ts';

export type TemplateSection = 'featured' | 'mine' | 'downloaded';

const PROVIDER_NAMES: Readonly<Record<string, string>> = { azure: 'Azure', aws: 'AWS', gcp: 'Google Cloud', kubernetes: 'Kubernetes' };
const FEATURED = 6;

/** The templates in one section, in the service's recommended order. */
export function sectionTemplates(templates: readonly TemplateSummary[], section: TemplateSection): TemplateSummary[] {
	switch (section) {
		case 'featured': return templates.filter(t => t.source === 'builtin' && t.trust === 'official' && t.lifecycle !== 'deprecated').slice(0, FEATURED);
		case 'mine': return templates.filter(t => t.source === 'local');
		case 'downloaded': return templates.filter(t => t.source === 'remote');
	}
}

export function templateDescription(template: TemplateSummary): string {
	const providers = template.providers.map(p => PROVIDER_NAMES[p] ?? p).join(' + ');
	return `${providers} · ${template.resourceCount}`;
}
