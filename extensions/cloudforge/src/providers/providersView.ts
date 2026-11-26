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
import { BROWSE_GROUPS, LOCAL_PLATFORM, projectNextAction, projectStatusLabel, shortProviderName, type BrowseProvider, type InstalledProviderRow, type InstalledVersionRow, type ProjectProviderRow, type ProvidersModel } from './model';

export type ProvidersNode =
	| { readonly type: 'section'; readonly section: 'project' | 'installed' | 'browse' }
	| { readonly type: 'browseGroup'; readonly id: string; readonly label: string; readonly providers: readonly BrowseProvider[] }
	| { readonly type: 'browseProvider'; readonly provider: BrowseProvider }
	| { readonly type: 'browseVersion'; readonly address: string; readonly version: string; readonly latest: boolean }
	| { readonly type: 'project'; readonly row: ProjectProviderRow }
	| { readonly type: 'provider'; readonly row: InstalledProviderRow }
	| { readonly type: 'version'; readonly row: InstalledVersionRow }
	| { readonly type: 'message'; readonly text: string; readonly icon?: string; readonly command?: { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] } };

export class ProvidersViewProvider implements TreeDataProvider<ProvidersNode> {
	private readonly changeEmitter = new EventEmitter<ProvidersNode | undefined>();
	readonly onDidChangeTreeData: Event<ProvidersNode | undefined> = this.changeEmitter.event;
	private readonly modelEmitter = new EventEmitter<ProvidersModel | undefined>();
	readonly onDidChangeModel: Event<ProvidersModel | undefined> = this.modelEmitter.event;
	private model: ProvidersModel | undefined;
	private loading: Promise<void> | undefined;
	private failed = false;

	private readonly versions = new Map<string, { readonly versions: readonly string[]; readonly stale: boolean } | null>();
	private readonly extraBrowse: BrowseProvider[] = [];

	constructor(
		private readonly load: () => Promise<ProvidersModel | undefined>,
		private readonly loadVersions: (address: string, refresh: boolean) => Promise<{ readonly versions: readonly string[]; readonly stale: boolean } | undefined>,
	) { }

	/** Adds a provider typed by the user to Browse for this session. */
	addBrowseProvider(address: string): void {
		const lower = address.toLowerCase();
		if (!BROWSE_GROUPS.some(group => group.providers.some(item => item.address === lower)) && !this.extraBrowse.some(item => item.address === lower)) {
			this.extraBrowse.push({ address: lower, label: shortProviderName(lower), description: lower.split('/')[0] });
		}
		this.changeEmitter.fire(undefined);
	}

	/** Forgets cached version lists so the next expand asks the registry again. */
	refreshVersions(address?: string): void {
		if (address) { this.versions.delete(address.toLowerCase()); } else { this.versions.clear(); }
		this.changeEmitter.fire(undefined);
	}

	async versionsFor(address: string, refresh = false): Promise<{ readonly versions: readonly string[]; readonly stale: boolean } | undefined> {
		const key = address.toLowerCase();
		if (!refresh && this.versions.has(key)) {
			return this.versions.get(key) ?? undefined;
		}
		const loaded = await this.loadVersions(key, refresh).catch(() => undefined);
		this.versions.set(key, loaded ?? null);
		return loaded;
	}

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
			return [{ type: 'section', section: 'project' }, { type: 'section', section: 'installed' }, { type: 'section', section: 'browse' }];
		}
		if (!model) {
			return [];
		}
		switch (element.type) {
			case 'section':
				if (element.section === 'browse') {
					const groups: ProvidersNode[] = BROWSE_GROUPS.map(group => ({ type: 'browseGroup', id: group.id, label: group.label, providers: group.providers }));
					if (this.extraBrowse.length) {
						groups.push({ type: 'browseGroup', id: 'added', label: l10n.t('Added'), providers: [...this.extraBrowse] });
					}
					groups.push({ type: 'message', text: l10n.t('Another provider…'), icon: 'add', command: { id: 'cloudforge.providers.browseOther', title: l10n.t('Another provider…') } });
					return groups;
				}
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
			case 'browseGroup':
				return element.providers.map(provider => ({ type: 'browseProvider', provider }));
			case 'browseProvider': {
				const loaded = await this.versionsFor(element.provider.address);
				if (!loaded || !loaded.versions.length) {
					return [{ type: 'message', text: l10n.t('Could not reach the registry. Check the connection, then refresh.'), icon: 'warning' }];
				}
				const nodes: ProvidersNode[] = loaded.versions.slice(0, 30).map((version, index) => ({ type: 'browseVersion', address: element.provider.address, version, latest: index === 0 }));
				if (loaded.stale) {
					nodes.unshift({ type: 'message', text: l10n.t('Offline: showing the last list fetched'), icon: 'cloud-offline' });
				}
				if (loaded.versions.length > 30) {
					nodes.push({ type: 'message', text: l10n.t('Older versions… ({0} more)', loaded.versions.length - 30), icon: 'history', command: { id: 'cloudforge.providers.download', title: '', arguments: [{ type: 'browseProvider', provider: element.provider }] } });
				}
				return nodes;
			}
			default:
				return [];
		}
	}

	getTreeItem(element: ProvidersNode): TreeItem {
		switch (element.type) {
			case 'section': {
				const model = this.model;
				const project = element.section === 'project';
				if (element.section === 'browse') {
					const browse = new TreeItem(l10n.t('Browse Registry'), TreeItemCollapsibleState.Collapsed);
					browse.id = 'section:browse';
					browse.contextValue = 'providersSectionBrowse';
					browse.description = l10n.t('pick any version');
					return browse;
				}
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
				item.description = (row.version ? row.version + ' · ' : row.constraint ? row.constraint + ' · ' : '') + projectStatusLabel(row);
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
			case 'browseGroup': {
				const item = new TreeItem(element.label, TreeItemCollapsibleState.Collapsed);
				item.id = 'browse-group:' + element.id;
				item.description = String(element.providers.length);
				item.contextValue = 'providersBrowseGroup';
				return item;
			}
			case 'browseProvider': {
				const provider = element.provider;
				const item = new TreeItem(provider.label, TreeItemCollapsibleState.Collapsed);
				item.id = 'browse:' + provider.address;
				const installed = this.model?.installed.find(row => row.address === provider.address);
				const used = this.model?.project.find(row => row.address === provider.address);
				item.description = provider.description + (installed ? ' · ' + l10n.t('{0} downloaded', installed.versions.length) : '') + (used?.version ? ' · ' + l10n.t('project uses {0}', used.version) : '');
				item.iconPath = new ThemeIcon(installed ? 'package' : 'cloud');
				item.contextValue = 'providerBrowse.registry';
				item.tooltip = provider.address;
				return item;
			}
			case 'browseVersion': {
				const installed = this.model?.installed.find(row => row.address === element.address)?.versions.find(row => row.version === element.version);
				const used = this.model?.project.some(row => row.address === element.address && row.version === element.version);
				const item = new TreeItem(element.version, TreeItemCollapsibleState.None);
				item.id = 'browse-version:' + element.address + '@' + element.version;
				item.description = [
					...(element.latest ? [l10n.t('latest')] : []),
					...(used ? [l10n.t('used by this project')] : []),
					...(installed ? [installed.hasSchema ? l10n.t('downloaded · schema ready') : l10n.t('downloaded')] : []),
				].join(' · ');
				item.iconPath = new ThemeIcon(installed?.hasSchema ? 'pass-filled' : installed ? 'package' : 'circle-large-outline', installed?.hasSchema ? new ThemeColor('testing.iconPassed') : undefined);
				item.contextValue = 'providerBrowseVersion' + (installed ? '.installed' : '.download') + '.registry';
				return item;
			}
			case 'message': {
				const item = new TreeItem(element.text, TreeItemCollapsibleState.None);
				item.iconPath = element.icon ? new ThemeIcon(element.icon) : undefined;
				item.contextValue = 'providersMessage';
				if (element.command) {
					item.command = { command: element.command.id, title: element.command.title, ...(element.command.arguments ? { arguments: [...element.command.arguments] } : {}) };
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
			lines.push('', row.constraint
				? l10n.t('No .terraform.lock.hcl entry yet. Get Ready downloads the newest version that fits {0} and creates the lock file offline.', row.constraint)
				: l10n.t('No .terraform.lock.hcl entry and no version constraint. Get Ready downloads the latest version and creates the lock file offline.'));
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
