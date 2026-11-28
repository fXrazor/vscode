/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// One cache of the template library for the Templates view and the Template Library page, so both
// show the same list and a template is read from the service once. The Rust service stays the
// authority: every response goes through the strict parsers in model.ts.

import { EventEmitter, type Event } from 'vscode';
import { parameterFields, type ParameterField } from './parameters';
import { buildTemplateDiagram, templateVariables, type CatalogueLookup, type DiagramProvider, type TemplateDiagram } from './preview';
import type { TemplateClient, TemplateDetails, TemplateListPage, TemplateResult, TemplateSummary } from './model';

export interface TemplateView {
	readonly details: TemplateDetails;
	readonly diagram: TemplateDiagram;
	readonly fields: readonly ParameterField[];
}

const LIST_LIMIT = 200;

export class TemplateStore {
	private page: TemplateListPage | undefined;
	private pageError: string | undefined;
	private loading: Promise<void> | undefined;
	private readonly views = new Map<string, Promise<TemplateResult<TemplateView>>>();
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChange: Event<void> = this.changeEmitter.event;

	constructor(private readonly client: TemplateClient, private readonly catalogue: () => Promise<CatalogueLookup>) { }

	get current(): TemplateListPage | undefined {
		return this.page;
	}

	get error(): string | undefined {
		return this.pageError;
	}

	/** Loads the list once; `force` reads it again (Refresh, after an import or removal). */
	async load(force = false): Promise<void> {
		if (this.loading) {
			return this.loading;
		}
		if (this.page && !force) {
			return;
		}
		this.loading = (async () => {
			const result = await this.client.list({ limit: LIST_LIMIT });
			if (result.ok) {
				this.page = result.value;
				this.pageError = undefined;
			} else {
				this.pageError = result.message;
			}
			if (force) {
				this.views.clear();
			}
		})();
		try {
			await this.loading;
		} finally {
			this.loading = undefined;
		}
		this.changeEmitter.fire();
	}

	find(templateId: string, version?: string): TemplateSummary | undefined {
		return this.page?.templates.find(t => t.id === templateId && (!version || t.version === version));
	}

	/** Details plus the derived preview and wizard fields, cached per id and version. */
	view(templateId: string, version: string): Promise<TemplateResult<TemplateView>> {
		const key = templateId + '@' + version;
		let pending = this.views.get(key);
		if (!pending) {
			pending = (async (): Promise<TemplateResult<TemplateView>> => {
				const result = await this.client.details(templateId, version);
				if (!result.ok) {
					return result;
				}
				const details = result.value;
				const lookup = await this.catalogue();
				const provider = (details.summary.providers[0] ?? 'other') as DiagramProvider;
				const diagram = buildTemplateDiagram(details.terraformFiles, lookup, details.layout, provider);
				const fields = parameterFields(details.parameters, templateVariables(details.terraformFiles));
				return { ok: true, value: { details, diagram, fields } };
			})();
			this.views.set(key, pending);
			// A failed read is not cached, so Refresh or reopening tries again.
			void pending.then(result => {
				if (!result.ok) {
					this.views.delete(key);
				}
			});
		}
		return pending;
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}
