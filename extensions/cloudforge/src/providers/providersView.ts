/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Providers view: an Extensions-style side bar for Terraform/OpenTofu providers. "In this project"
// lists what the open architecture needs and the next step for each; "Downloaded" lists the local
// offline mirror and imported schemas. Every action delegates to existing service-backed commands,
// so downloads, extraction and removal stay behind the Rust service boundary.

import { EventEmitter, l10n, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, type Event, type TreeDataProvider } from 'vscode';
import { formatMirrorBytes } from '../providerMirror/model';
import { LOCAL_PLATFORM, projectNextAction, projectStatusLabel, shortProviderName, type InstalledProviderRow, type InstalledVersionRow, type ProjectProviderRow, type ProvidersModel } from './model';

export type ProvidersNode =
	| { readonly type: 'section'; readonly section: 'project' | 'installed' }
	| { readonly type: 'project'; readonly row: ProjectProviderRow }
	| { readonly type: 'provider'; readonly row: InstalledProviderRow }
	| { readonly type: 'version'; readonly row: InstalledVersionRow }
	| { readonly type: 'message'; readonly text: string; readonly icon?: string; readonly command?: { readonly id: string; readonly title: string } };

export class ProvidersViewProvider implements TreeDataProvider<ProvidersNode> {
	private readonly changeEmitter = new EventEmitter<ProvidersNode | undefined>();
	readonly onDidChangeTreeData: Event<ProvidersNode | undefined> = this.changeEmitter.event;
	private readonly modelEmitter = new EventEmitter<ProvidersModel | undefined>();
	readonly onDidChangeModel: Event<ProvidersModel | undefined> = this.modelEmitter.event;
	private model: ProvidersModel | undefined;
	private loading: Promise<void> | undefined;
	private failed = false;

	constructor(private readonly load: () => Promise<ProvidersModel | undefined>) { }

	get current(): ProvidersModel | undefined {
		return this.model;
	}

	refresh(): Promise<void> {
		this.loading ??= this.load()
			.then(model => { this.model = model; this.failed = !model; })
			.catch(() => { this.failed = true; })
			.finally(() => {
				this.loading = undefined;
				this.changeEmitter.fire(undefined);
				this.modelEmitter.fire(this.model);
			});
		return this.loading;
	}

	async getChildren(element?: ProvidersNode): Promise<ProvidersNode[]> {
		if (!this.model && !this.failed) {
			await this.refresh();
		}
		const model = this.model;
		if (!element) {
			if (!model) {
				return [{ type: 'message', text: l10n.t('The CloudForge service is not available. Open a CloudForge project to manage providers.'), icon: 'warning' }];
			}
			return [{ type: 'section', section: 'project' }, { type: 'section', section: 'installed' }];
		}
		if (!model) {
			return [];
		}
		switch (element.type) {
			case 'section':
				if (element.section === 'project') {
					if (!model.hasArchitecture) {
						return [{ type: 'message', text: l10n.t('Open an architecture to see the providers it needs.'), icon: 'info' }];
					}
					if (!model.project.length) {
						return [{ type: 'message', text: l10n.t('This architecture declares no providers.'), icon: 'info' }];
					}
					return model.project.map(row => ({ type: 'project', row }));
				}
				if (!model.installed.length) {
					return [{ type: 'message', text: l10n.t('Nothing downloaded yet. Download a provider version to work offline.'), icon: 'cloud-download', command: { id: 'cloudforge.providers.download', title: l10n.t('Download Provider…') } }];
				}
				return model.installed.map(row => ({ type: 'provider', row }));
			case 'provider':
				return element.row.versions.map(row => ({ type: 'version', row }));
			default:
				return [];
		}
	}

	getTreeItem(element: ProvidersNode): TreeItem {
		switch (element.type) {
			case 'section': {
				const model = this.model;
				const project = element.section === 'project';
				const item = new TreeItem(project ? l10n.t('In This Project') : l10n.t('Downloaded'), TreeItemCollapsibleState.Expanded);
				item.id = 'section:' + element.section;
				item.contextValue = project ? 'providersSectionProject' : 'providersSectionInstalled';
				if (project && model?.hasArchitecture) {
					item.description = model.attentionCount
						? l10n.t('{0} need attention', model.attentionCount)
						: model.project.length ? l10n.t('all ready') : '';
				} else if (!project && model) {
					const versions = model.installed.reduce((sum, row) => sum + row.versions.length, 0);
					item.description = versions ? l10n.t('{0} versions', versions) : '';
				}
				return item;
			}
			case 'project': {
				const row = element.row;
				const item = new TreeItem(row.display, TreeItemCollapsibleState.None);
				item.id = 'project:' + (row.address ?? row.display);
				item.description = (row.version ? row.version + ' · ' : '') + projectStatusLabel(row);
				item.iconPath = projectIcon(row);
				const next = projectNextAction(row);
				item.contextValue = 'providerProject' + (next ? '.' + next : '') + (row.address ? '.registry' : '');
				item.tooltip = projectTooltip(row);
				if (next === 'extractSchema' || next === 'download') {
					item.command = { command: next === 'extractSchema' ? 'cloudforge.providers.extractSchema' : 'cloudforge.providers.download', title: '', arguments: [element] };
				}
				return item;
			}
			case 'provider': {
				const row = element.row;
				const item = new TreeItem(row.display, TreeItemCollapsibleState.Collapsed);
				item.id = 'provider:' + row.address;
				item.description = row.address.split('/')[0];
				item.iconPath = new ThemeIcon('package');
				item.contextValue = 'providerInstalled.registry';
				return item;
			}
			case 'version': {
				const row = element.row;
				const item = new TreeItem(row.version, TreeItemCollapsibleState.None);
				item.id = 'version:' + row.address + '@' + row.version;
				const parts = [
					row.schemaOnly ? l10n.t('schema only') : row.platforms.join(', '),
					row.hasSchema ? l10n.t('schema ready') : l10n.t('no schema'),
					...(row.sizeBytes ? [formatMirrorBytes(row.sizeBytes)] : []),
					...(row.usedByProject ? [l10n.t('used by this project')] : []),
				];
				item.description = parts.join(' · ');
				item.iconPath = new ThemeIcon(row.hasSchema ? 'pass-filled' : 'circle-large-outline', row.hasSchema ? new ThemeColor('testing.iconPassed') : undefined);
				const extractable = !row.hasSchema && row.platforms.includes(LOCAL_PLATFORM);
				item.contextValue = 'providerVersion' + (row.schemaOnly ? '' : '.removable') + (extractable ? '.extractSchema' : '') + '.registry';
				return item;
			}
			case 'message': {
				const item = new TreeItem(element.text, TreeItemCollapsibleState.None);
				item.iconPath = element.icon ? new ThemeIcon(element.icon) : undefined;
				item.contextValue = 'providersMessage';
				if (element.command) {
					item.command = { command: element.command.id, title: element.command.title };
				}
				return item;
			}
		}
	}
}

function projectIcon(row: ProjectProviderRow): ThemeIcon {
	switch (row.status) {
		case 'ready': return new ThemeIcon('pass-filled', new ThemeColor('testing.iconPassed'));
		case 'schemaNotExtracted': return new ThemeIcon('symbol-structure', new ThemeColor('editorWarning.foreground'));
		case 'notDownloaded': return new ThemeIcon('cloud-download', new ThemeColor('editorWarning.foreground'));
		case 'unlocked': return new ThemeIcon('unlock', new ThemeColor('editorWarning.foreground'));
		case 'conflict': return new ThemeIcon('error', new ThemeColor('editorError.foreground'));
	}
}

function projectTooltip(row: ProjectProviderRow): MarkdownString {
	const lines = [`**${row.display}**${row.version ? ' ' + row.version : ''}`, '', projectStatusLabel(row)];
	switch (row.status) {
		case 'ready':
			lines.push('', l10n.t('Studio forms and the resource library use this exact provider version.'));
			break;
		case 'schemaNotExtracted':
			lines.push('', l10n.t('The package is downloaded. Extract its schema so Studio shows the fields for this version.'));
			break;
		case 'notDownloaded':
			lines.push('', l10n.t('Download this version to get its schema and to run init and plan offline.'));
			break;
		case 'unlocked':
			lines.push('', l10n.t('No .terraform.lock.hcl entry. Run init once to lock a version, or set an exact version in required_providers.'));
			break;
		case 'conflict':
			lines.push('', l10n.t('The lock file and the version constraints disagree. Review the provider dependency report.'));
			break;
	}
	if (row.otherSchemaVersion) {
		lines.push('', l10n.t('Another schema is downloaded for {0}: {1}.', shortProviderName(row.address ?? row.display), row.otherSchemaVersion));
	}
	return new MarkdownString(lines.join('\n'));
}

/** Public registry page for a provider (and version), for "Show in Registry". */
export function registryPageUrl(address: string, version?: string): string | undefined {
	const [host, namespace, type] = address.split('/');
	if (!namespace || !type || !/^[a-z0-9_-]+$/i.test(namespace) || !/^[a-z0-9_-]+$/i.test(type)) {
		return undefined;
	}
	const safeVersion = version && /^[A-Za-z0-9._+-]+$/.test(version) ? version : undefined;
	if (host === 'registry.terraform.io') {
		return `https://registry.terraform.io/providers/${namespace}/${type}/${safeVersion ?? 'latest'}`;
	}
	if (host === 'registry.opentofu.org') {
		return `https://search.opentofu.org/provider/${namespace}/${type}${safeVersion ? '/v' + safeVersion : ''}`;
	}
	return undefined;
}
