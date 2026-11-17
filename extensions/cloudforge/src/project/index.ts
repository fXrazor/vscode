/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, window, workspace, type ExtensionContext } from 'vscode';
import { ProjectController, type GraphHost } from './controller';
import { ensureGit } from './git';
import type { CloneProvider } from './model';
import { ProjectsViewProvider } from './projectsView';

const providers: ReadonlySet<string> = new Set<CloneProvider>(['github', 'gitlab', 'bitbucket', 'url']);

/** Registers the Stage 2 project commands, the Projects view, and window listeners. */
export function activateProjects(context: ExtensionContext, graph: GraphHost): ProjectController {
	const controller = new ProjectController(context, graph);
	const view = new ProjectsViewProvider(controller);
	context.subscriptions.push(controller, view, window.registerTreeDataProvider('cloudforge.projects', view));

	context.subscriptions.push(
		commands.registerCommand('cloudforge.cloneRepository', (provider?: unknown) =>
			controller.cloneRepository(typeof provider === 'string' && providers.has(provider) ? provider as CloneProvider : undefined)),
		commands.registerCommand('cloudforge.createProject', () => controller.createProject()),
		commands.registerCommand('cloudforge.refreshProject', () => controller.connect(true)),
		commands.registerCommand('cloudforge.forgetProjectAccess', () => controller.forgetAccess()),
		commands.registerCommand('cloudforge.installGit', () => ensureGit()),
		commands.registerCommand('cloudforge.openArchitecture', (architectureId?: unknown) =>
			typeof architectureId === 'string' ? controller.openArchitecture(architectureId) : undefined),
		commands.registerCommand('cloudforge.importRepository', async (index?: unknown) => {
			const folders = workspace.workspaceFolders ?? [];
			let target = typeof index === 'number' ? index : undefined;
			if (target === undefined) {
				const picked = await window.showWorkspaceFolderPick();
				target = picked?.index;
			}
			if (target !== undefined && target >= 0 && target < folders.length) {
				await controller.importFolder(target);
			}
		}),
		commands.registerCommand('cloudforge.removeRepository', (node?: { repository?: { repositoryId?: unknown } }) => {
			const id = node?.repository?.repositoryId;
			return typeof id === 'string' ? controller.removeRepository(id) : undefined;
		}),
		commands.registerCommand('cloudforge.cloneRepositoryAgain', (node?: { repository?: { remote?: unknown } }) => {
			const remote = node?.repository?.remote;
			return typeof remote === 'string' ? controller.cloneRepository('url', remote) : undefined;
		}),
	);

	// Folder changes (Add to Workspace, a clone, a removal) may add or drop repositories.
	let timer: ReturnType<typeof setTimeout> | undefined;
	context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => {
		clearTimeout(timer);
		timer = setTimeout(() => void controller.connect(), 500);
	}), { dispose: () => clearTimeout(timer) });

	void controller.connect();
	return controller;
}
