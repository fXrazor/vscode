/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, window, workspace, type ExtensionContext } from 'vscode';
import { ProjectController, type GraphHost } from './controller';
import { ensureGit } from './git';
import type { CloneProvider } from './model';
import { ProjectGalleryPanel } from './galleryPanel';
import { ProjectsViewProvider } from './projectsView';

const providers: ReadonlySet<string> = new Set<CloneProvider>(['github', 'gitlab', 'bitbucket', 'url']);

interface ArchitectureNodeArg {
	readonly architecture?: { readonly architectureId?: unknown };
}

interface RepositoryNodeArg {
	readonly repository?: { readonly repositoryId?: unknown; readonly remote?: unknown; readonly workspaceFolderIndex?: unknown };
}

interface FolderNodeArg {
	readonly index?: unknown;
}

function extractArchitectureId(arg: unknown): string | undefined {
	if (typeof arg === 'string') {
		return arg;
	}
	const nested = (arg as ArchitectureNodeArg | undefined)?.architecture?.architectureId;
	return typeof nested === 'string' ? nested : undefined;
}

/** Registers the Stage 2 project commands, the Projects view, and window/filesystem listeners. */
export function activateProjects(context: ExtensionContext, graph: GraphHost): ProjectController {
	const controller = new ProjectController(context, graph);
	const view = new ProjectsViewProvider(controller);
	const gallery = new ProjectGalleryPanel(controller);
	context.subscriptions.push(controller, view, gallery, window.registerTreeDataProvider('cloudforge.projects', view), window.registerTreeDataProvider('cloudforge.panel.projects', view));

	context.subscriptions.push(
		commands.registerCommand('cloudforge.cloneRepository', (provider?: unknown) =>
			controller.cloneRepository(typeof provider === 'string' && providers.has(provider) ? provider as CloneProvider : undefined)),
		commands.registerCommand('cloudforge.createProject', () => controller.createProject()),
		commands.registerCommand('cloudforge.openProjectInNewWindow', () => controller.openProjectInNewWindow()),
		commands.registerCommand('cloudforge.createArchitecture', () => controller.createArchitecture()),
		commands.registerCommand('cloudforge.openProjectGallery', () => gallery.show()),
		commands.registerCommand('cloudforge.switchArchitecture', () => controller.switchArchitecture()),
		commands.registerCommand('cloudforge.refreshProject', () => controller.connect(true)),
		commands.registerCommand('cloudforge.forgetProjectAccess', () => controller.forgetAccess()),
		commands.registerCommand('cloudforge.resetIgnoredImports', () => controller.resetIgnoredImports()),
		commands.registerCommand('cloudforge.installGit', () => ensureGit()),
		commands.registerCommand('cloudforge.openArchitecture', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.openArchitecture(id) : undefined;
		}),
		commands.registerCommand('cloudforge.openArchitectureCanvas', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.openArchitectureCanvas(id, false) : undefined;
		}),
		commands.registerCommand('cloudforge.openArchitectureFocus', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.openArchitectureCanvas(id, true) : undefined;
		}),
		commands.registerCommand('cloudforge.validateProjectArchitecture', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.validateProjectArchitecture(id) : undefined;
		}),
		commands.registerCommand('cloudforge.planProjectArchitecture', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.planProjectArchitecture(id) : undefined;
		}),
		commands.registerCommand('cloudforge.revealArchitectureFolder', (arg?: unknown) => {
			const id = extractArchitectureId(arg);
			return id ? controller.revealArchitectureFolder(id) : undefined;
		}),
		commands.registerCommand('cloudforge.revealRepositoryFolder', (node?: RepositoryNodeArg) => {
			const id = node?.repository?.repositoryId;
			return typeof id === 'string' ? controller.revealRepositoryFolder(id) : undefined;
		}),
		commands.registerCommand('cloudforge.reattachRepository', (node?: RepositoryNodeArg) => {
			const id = node?.repository?.repositoryId;
			return typeof id === 'string' ? controller.reattachRepository(id) : undefined;
		}),
		commands.registerCommand('cloudforge.importRepository', async (arg?: unknown) => {
			const folders = workspace.workspaceFolders ?? [];
			let target = typeof arg === 'number'
				? arg
				: typeof (arg as FolderNodeArg | undefined)?.index === 'number'
					? (arg as FolderNodeArg).index as number
					: typeof (arg as RepositoryNodeArg | undefined)?.repository?.workspaceFolderIndex === 'number'
						? (arg as RepositoryNodeArg).repository!.workspaceFolderIndex as number
						: undefined;
			if (target === undefined) {
				const picked = await window.showWorkspaceFolderPick();
				target = picked?.index;
			}
			if (target !== undefined && target >= 0 && target < folders.length) {
				await controller.importFolder(target);
			}
		}),
		commands.registerCommand('cloudforge.removeRepository', (node?: RepositoryNodeArg) => {
			const id = node?.repository?.repositoryId;
			return typeof id === 'string' ? controller.removeRepository(id) : undefined;
		}),
		commands.registerCommand('cloudforge.cloneRepositoryAgain', (node?: RepositoryNodeArg) => {
			const remote = node?.repository?.remote;
			return typeof remote === 'string' ? controller.cloneRepository('url', remote) : undefined;
		}),
	);

	// Folder changes and project/architecture marker updates keep CloudForge Project in sync automatically.
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	const scheduleReconnect = () => {
		clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(() => void controller.connect(), 500);
	};
	const projectMarkerWatcher = workspace.createFileSystemWatcher('**/cloudforge.project.json');
	const archMarkerWatcher = workspace.createFileSystemWatcher('**/architectures/*/cloudforge.architecture.json');
	context.subscriptions.push(
		workspace.onDidChangeWorkspaceFolders(scheduleReconnect),
		projectMarkerWatcher,
		projectMarkerWatcher.onDidCreate(scheduleReconnect),
		projectMarkerWatcher.onDidChange(scheduleReconnect),
		projectMarkerWatcher.onDidDelete(scheduleReconnect),
		archMarkerWatcher,
		archMarkerWatcher.onDidCreate(scheduleReconnect),
		archMarkerWatcher.onDidChange(scheduleReconnect),
		archMarkerWatcher.onDidDelete(scheduleReconnect),
		{ dispose: () => clearTimeout(reconnectTimer) },
	);

	void controller.connect();
	return controller;
}
