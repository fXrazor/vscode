/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Templates view in its own activity bar container: Featured, My Library, Downloaded and
// Sources, modelled on the Providers view. It is optional: everything here is also on the
// Template Library page and in the Command Palette.

import { EventEmitter, l10n, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, type Event, type TreeDataProvider } from 'vscode';
import type { TemplateSourceInfo, TemplateSummary } from './model';
import { sectionTemplates, templateDescription, type TemplateSection } from './sections';
import type { TemplateStore } from './store';

type Section = TemplateSection | 'sources';

export type TemplatesNode =
	| { readonly kind: 'section'; readonly section: Section }
	| { readonly kind: 'template'; readonly template: TemplateSummary }
	| { readonly kind: 'source'; readonly source: TemplateSourceInfo }
	| { readonly kind: 'message'; readonly text: string };

export class TemplatesViewProvider implements TreeDataProvider<TemplatesNode> {
	private readonly changeEmitter = new EventEmitter<TemplatesNode | undefined>();
	readonly onDidChangeTreeData: Event<TemplatesNode | undefined> = this.changeEmitter.event;

	constructor(private readonly store: TemplateStore) {
		store.onDidChange(() => this.changeEmitter.fire(undefined));
	}

	async getChildren(node?: TemplatesNode): Promise<TemplatesNode[]> {
		if (!node) {
			await this.store.load();
			if (!this.store.current) {
				return [{ kind: 'message', text: this.store.error ?? l10n.t('The template library is not available.') }];
			}
			return (['featured', 'mine', 'downloaded', 'sources'] as const).map(section => ({ kind: 'section', section }));
		}
		if (node.kind !== 'section') {
			return [];
		}
		const page = this.store.current;
		if (!page) {
			return [];
		}
		if (node.section === 'sources') {
			const sources: TemplatesNode[] = page.sources.map(source => ({ kind: 'source', source }));
			if (!page.sources.some(source => source.id !== 'builtin' && source.trust !== 'local')) {
				sources.push({ kind: 'message', text: l10n.t('CloudForge official catalogue: not set up yet') });
			}
			return sources;
		}
		const items = sectionTemplates(page.templates, node.section);
		if (!items.length) {
			return [{ kind: 'message', text: node.section === 'mine' ? l10n.t('Import a template file to add one') : l10n.t('Nothing downloaded yet') }];
		}
		return items.map(template => ({ kind: 'template', template }));
	}

	getTreeItem(node: TemplatesNode): TreeItem {
		switch (node.kind) {
			case 'section': {
				const label = { featured: l10n.t('Featured'), mine: l10n.t('My Library'), downloaded: l10n.t('Downloaded'), sources: l10n.t('Sources') }[node.section];
				const item = new TreeItem(label, node.section === 'downloaded' ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.Expanded);
				const page = this.store.current;
				if (page) {
					const count = node.section === 'sources' ? page.sources.length : sectionTemplates(page.templates, node.section).length;
					item.description = String(count);
				}
				item.contextValue = 'cloudforge.templates.section';
				return item;
			}
			case 'template': {
				const t = node.template;
				const item = new TreeItem(t.name, TreeItemCollapsibleState.None);
				item.description = templateDescription(t);
				item.iconPath = new ThemeIcon(t.source === 'local' ? 'library' : 'layout');
				item.tooltip = new MarkdownString(`**${escapeMarkdown(t.name)}** · v${t.version}\n\n${escapeMarkdown(t.summary)}\n\n${t.resourceCount} resources · ${t.difficulty}`);
				item.contextValue = t.source === 'local' ? 'cloudforge.template.local' : 'cloudforge.template';
				item.command = { command: 'cloudforge.templates.openTemplate', title: l10n.t('Open Template'), arguments: [t.id, t.version] };
				item.accessibilityInformation = { label: `${t.name}, ${t.trust}, ${t.difficulty}, ${t.resourceCount} resources` };
				return item;
			}
			case 'source': {
				const s = node.source;
				const item = new TreeItem(s.id === 'builtin' ? l10n.t('Built in') : s.name, TreeItemCollapsibleState.None);
				item.description = l10n.t('{0} templates', s.templateCount);
				item.iconPath = new ThemeIcon('database');
				item.tooltip = s.offline ? l10n.t('Available offline') : l10n.t('Needs a connection to refresh');
				item.contextValue = 'cloudforge.templates.source';
				return item;
			}
			case 'message': {
				const item = new TreeItem(node.text, TreeItemCollapsibleState.None);
				item.iconPath = new ThemeIcon('info');
				return item;
			}
		}
	}
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, ch => '\\' + ch);
}
