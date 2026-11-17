/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, l10n, ThemeIcon, TreeItem, TreeItemCollapsibleState, workspace, type Event, type TreeDataProvider } from 'vscode';
import type { ProjectController } from './controller';
import type { ProjectArchitecture, ProjectRepository } from './model';

type ProjectNode =
	| { readonly type: 'repository'; readonly repository: ProjectRepository }
	| { readonly type: 'local' }
	| { readonly type: 'architecture'; readonly architecture: ProjectArchitecture; readonly readable: boolean }
	| { readonly type: 'folders' }
	| { readonly type: 'folder'; readonly index: number };

/** D6: the project's repositories, architectures, and folders not yet imported. */
export class ProjectsViewProvider implements TreeDataProvider<ProjectNode> {
	private readonly changeEmitter = new EventEmitter<ProjectNode | undefined>();
	readonly onDidChangeTreeData: Event<ProjectNode | undefined> = this.changeEmitter.event;

	constructor(private readonly controller: ProjectController) {
		controller.onDidChange(() => this.changeEmitter.fire(undefined));
	}

	getChildren(element?: ProjectNode): ProjectNode[] {
		const project = this.controller.current;
		if (!project) {
			return [];
		}
		if (!element) {
			const nodes: ProjectNode[] = project.repositories.map(repository => ({ type: 'repository', repository }));
			if (project.architectures.some(architecture => architecture.source === 'local')) {
				nodes.push({ type: 'local' });
			}
			if (project.unimportedFolders.length > 0) {
				nodes.push({ type: 'folders' });
			}
			return nodes;
		}
		switch (element.type) {
			case 'repository':
				return project.architectures
					.filter(architecture => architecture.repositoryId === element.repository.repositoryId)
					.map(architecture => ({ type: 'architecture', architecture, readable: element.repository.status === 'available' }));
			case 'local':
				return project.architectures
					.filter(architecture => architecture.source === 'local')
					.map(architecture => ({ type: 'architecture', architecture, readable: true }));
			case 'folders':
				return project.unimportedFolders.map(index => ({ type: 'folder', index }));
			default:
				return [];
		}
	}

	getTreeItem(element: ProjectNode): TreeItem {
		switch (element.type) {
			case 'repository': {
				const { repository } = element;
				const item = new TreeItem(repository.displayName, TreeItemCollapsibleState.Expanded);
				item.iconPath = new ThemeIcon(repository.status === 'available' ? 'repo' : 'warning');
				item.description = statusText(repository);
				item.tooltip = repository.remote ? `${repository.displayName}\n${repository.remote}` : repository.displayName;
				item.contextValue = `cloudforge.repository.${repository.status}${repository.remote ? '.remote' : ''}`;
				return item;
			}
			case 'local': {
				const item = new TreeItem(l10n.t('Project architectures'), TreeItemCollapsibleState.Expanded);
				item.iconPath = new ThemeIcon('folder');
				return item;
			}
			case 'architecture': {
				const item = new TreeItem(element.architecture.displayName, TreeItemCollapsibleState.None);
				item.iconPath = new ThemeIcon('type-hierarchy');
				item.contextValue = 'cloudforge.architecture';
				if (element.readable) {
					item.command = { command: 'cloudforge.openArchitecture', title: l10n.t('Show Architecture'), arguments: [element.architecture.architectureId] };
				} else {
					item.description = l10n.t('unavailable');
				}
				return item;
			}
			case 'folders': {
				const item = new TreeItem(l10n.t('Other folders in this window'), TreeItemCollapsibleState.Collapsed);
				item.iconPath = new ThemeIcon('folder-library');
				return item;
			}
			case 'folder': {
				const folder = workspace.workspaceFolders?.[element.index];
				const item = new TreeItem(folder?.name ?? l10n.t('Folder {0}', element.index + 1), TreeItemCollapsibleState.None);
				item.iconPath = new ThemeIcon('folder');
				item.description = l10n.t('not imported');
				item.contextValue = 'cloudforge.unimportedFolder';
				item.command = { command: 'cloudforge.importRepository', title: l10n.t('Import Terraform…'), arguments: [element.index] };
				return item;
			}
		}
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

function statusText(repository: ProjectRepository): string {
	switch (repository.status) {
		case 'available': return repository.location === 'external' ? l10n.t('outside the project folder') : '';
		case 'notInWorkspace': return l10n.t('not in this window');
		case 'missing': return l10n.t('missing on disk');
		case 'changed': return l10n.t('folder replaced; import again');
	}
}
