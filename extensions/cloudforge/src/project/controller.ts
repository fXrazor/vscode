/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	commands,
	EventEmitter,
	FileType,
	l10n,
	RelativePattern,
	Uri,
	window,
	workspace,
	type Disposable,
	type Event,
	type ExtensionContext,
	type WorkspaceFolder
} from 'vscode';
import { validateImportSelections, type ImportSelection, type ImportSelectionError } from '../importSelections';
import { findProjectRootTerraformFiles, findTerraformImportCandidates } from '../terraformDetection';
import { ensureGit, repositoryRemote } from './git';
import {
	cloneUrlPrefix,
	isPathComponent,
	parseCreatedProject,
	parseInspection,
	parseProjectResult,
	selectDefaultArchitecture,
	suggestArchitectureName,
	validateCloneUrl,
	type CloneProvider,
	type ProjectResult
} from './model';
import { SecretFindings } from './secretFindings';
import { callProjectService, projectErrorMessage, showProjectError } from './service';

const PROJECT_MARKER = 'cloudforge.project.json';
const ARCHITECTURES_FOLDER = 'architectures';
const ARCHITECTURE_MARKER = 'cloudforge.architecture.json';
const REPOSITORIES_FOLDER = 'repos';
const IGNORED_FOLDERS_KEY = 'cloudforge.ignoredImportFolders';
const IGNORED_ROOT_TERRAFORM_KEY = 'cloudforge.ignoredRootTerraform';
const LAST_ARCHITECTURE_NAME_KEY = 'cloudforge.lastArchitectureName';
const PENDING_CLONE_KEY = 'cloudforge.pendingClone';
const PENDING_CLONE_LIFETIME_MS = 15 * 60 * 1000;

/** Shows an architecture's graph in the Stage 1 graph view and read-only canvas. */
export interface GraphHost {
	show(workspaceId: string, architectureId: string, architectureName?: string): Promise<void>;
}

interface PendingClone {
	readonly provider: CloneProvider;
	readonly createdAt: number;
}

/**
 * The window's CloudForge project (D2), plus the import (D4), clone (D5), and create flows. One
 * instance per window; the service holds the actual grant and the bridge tracks its IDs.
 */
export class ProjectController implements Disposable {
	private project: ProjectResult | undefined;
	private connecting: Promise<void> | undefined;
	/** Set when the user declined consent; cleared only by an explicit refresh. */
	private consentDeclined = false;
	/** Tracks whether this window already auto-opened an architecture on connect. */
	private hasAutoOpenedArchitecture = false;
	private readonly offered = new Set<string>();
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChange: Event<void> = this.changeEmitter.event;
	readonly secrets: SecretFindings;

	constructor(private readonly context: ExtensionContext, private readonly graph: GraphHost) {
		this.secrets = new SecretFindings(context.workspaceState);
	}

	get current(): ProjectResult | undefined {
		return this.project;
	}

	/** The folder that holds the project marker: the workspace file's folder, or the single folder. */
	projectFolder(): Uri | undefined {
		const file = workspace.workspaceFile;
		if (file?.scheme === 'file') {
			return Uri.joinPath(file, '..');
		}
		const folders = workspace.workspaceFolders ?? [];
		return folders.length === 1 && folders[0].uri.scheme === 'file' ? folders[0].uri : undefined;
	}

	/** Connects to the window's project, asking for consent once when needed. */
	connect(explicit = false): Promise<void> {
		if (explicit) {
			this.consentDeclined = false;
		}
		return this.connecting ??= this.doConnect().finally(() => { this.connecting = undefined; });
	}

	private async doConnect(): Promise<void> {
		const folder = this.projectFolder();
		if (!folder || !(await exists(Uri.joinPath(folder, PROJECT_MARKER)))) {
			this.setProject(undefined);
			return;
		}
		if (!workspace.workspaceFile && await this.offerOpenAsProject(folder)) {
			return;
		}
		let result = await callProjectService('openProject', {});
		if (!result.ok && result.code === 'CONSENT_REQUIRED') {
			if (this.consentDeclined) {
				this.setProject(undefined);
				return;
			}
			const allow = l10n.t('Allow');
			const choice = await window.showInformationMessage(
				l10n.t('Allow CloudForge to read this project and its imported repos?'),
				{ detail: l10n.t('CloudForge reads project files and Terraform to show your architectures. It never changes files inside your repositories. You can withdraw access with CloudForge: Forget Project Access.') },
				allow
			);
			if (choice !== allow) {
				this.consentDeclined = true;
				this.setProject(undefined);
				return;
			}
			result = await callProjectService('grantProject', {});
		}
		if (!result.ok) {
			this.setProject(undefined);
			// Stay quiet when the window is not a project, or when the broker does not offer the
			// Stage 2 methods yet (it answers INVALID_PARAMS for methods it does not know).
			if (result.code !== 'UNSUPPORTED_FORMAT' && result.code !== 'INVALID_STATE' && result.code !== 'INVALID_PARAMS') {
				showProjectError(result.code);
			}
			return;
		}
		const project = this.accept(result.value);
		if (!project) {
			return;
		}
		if (!this.hasAutoOpenedArchitecture) {
			const lastName = this.context.workspaceState.get<string>(LAST_ARCHITECTURE_NAME_KEY);
			const initial = selectDefaultArchitecture(project, lastName);
			if (initial) {
				this.hasAutoOpenedArchitecture = true;
				await this.openArchitecture(initial.architectureId);
			}
		}
		if (!project.hasWorkspaceFile) {
			void this.offerWorkspaceFile(project, folder);
		}
		await this.resumePendingClone();
		await this.offerImports();
		if (project.architectures.length === 0) {
			await this.offerAdoptRootTerraform(folder, project);
		}
	}

	/** Reloads the project without prompting (after a change on disk or in the window). */
	async refresh(): Promise<void> {
		const result = await callProjectService('openProject', {});
		if (result.ok) {
			this.accept(result.value);
		} else {
			this.setProject(undefined);
		}
	}

	async forgetAccess(): Promise<void> {
		const result = await callProjectService('forgetProjectAccess', {});
		if (!result.ok) {
			showProjectError(result.code);
			return;
		}
		this.setProject(undefined);
		void window.showInformationMessage(l10n.t('CloudForge will ask again before reading this project.'));
	}

	async openArchitecture(architectureId: string): Promise<void> {
		const architecture = this.project?.architectures.find(item => item.architectureId === architectureId);
		if (this.project && architecture) {
			this.hasAutoOpenedArchitecture = true;
			void this.context.workspaceState.update(LAST_ARCHITECTURE_NAME_KEY, architecture.displayName);
			await this.graph.show(this.project.workspaceId, architecture.architectureId, architecture.displayName);
		}
	}

	async removeRepository(repositoryId: string): Promise<void> {
		const project = this.project;
		const repository = project?.repositories.find(item => item.repositoryId === repositoryId);
		if (!project || !repository) {
			return;
		}
		const remove = l10n.t('Remove from Project');
		const choice = await window.showWarningMessage(
			l10n.t('Remove {0} and its architectures from this project?', repository.displayName),
			{ modal: true, detail: l10n.t('The repository folder and its files stay on disk.') },
			remove
		);
		if (choice !== remove) {
			return;
		}
		const result = await callProjectService('removeRepository', { workspaceId: project.workspaceId, repositoryId });
		this.handleProjectChange(result);
	}

	/** D4: inspect a window folder, choose roots and names, and import them. */
	async importFolder(workspaceFolderIndex: number): Promise<void> {
		const project = this.project;
		const folder = workspace.workspaceFolders?.[workspaceFolderIndex];
		if (!project || !folder) {
			void window.showInformationMessage(l10n.t('Open a CloudForge project in this window before importing.'));
			return;
		}
		const inspected = await callProjectService('inspectRepository', { workspaceId: project.workspaceId, workspaceFolderIndex });
		if (!inspected.ok) {
			showProjectError(inspected.code);
			return;
		}
		const inspection = parseInspection(inspected.value);
		if (!inspection) {
			showProjectError('SERVICE_ERROR');
			return;
		}
		this.secrets.show(folder.uri, inspection.findings);
		if (inspection.findings.length > 0) {
			const proceed = l10n.t('Continue');
			const choice = await window.showWarningMessage(
				l10n.t('{0} may contain secrets in {1} place(s). See Problems for the files.', inspection.displayName, inspection.findings.length),
				{ modal: true, detail: l10n.t('CloudForge never shows the values and keeps these files out of its own AI features. Other agents in this window can still read workspace files, so remove secrets from the repository or add these files to .gitignore.') },
				proceed
			);
			if (choice !== proceed) {
				return;
			}
		}
		const choices = inspection.terraformRoots.filter(root => !root.imported);
		if (choices.length === 0) {
			void window.showInformationMessage(l10n.t('Every Terraform root in {0} is already imported.', inspection.displayName));
			return;
		}
		const picked = await window.showQuickPick(
			choices.map(root => ({ label: root.rootPath.length ? root.rootPath.join('/') : inspection.displayName, description: root.displayName, picked: choices.length === 1, root })),
			{ canPickMany: true, title: l10n.t('Import Terraform from {0}', inspection.displayName), placeHolder: l10n.t('Choose the Terraform roots to show as architectures') }
		);
		if (!picked || picked.length === 0) {
			return;
		}
		const existingNames = project.architectures.map(architecture => architecture.displayName);
		const taken = new Set(existingNames.map(name => name.toLowerCase()));
		const selections: ImportSelection[] = [];
		for (const item of picked) {
			const name = await window.showInputBox({
				title: l10n.t('Architecture name'),
				prompt: l10n.t('Name the architecture for {0}', item.label),
				value: suggestArchitectureName(item.root, inspection.displayName, taken),
				// The same rules the service applies to linked architecture names.
				validateInput: value => selectionMessage(validateImportSelections(
					choices,
					[...selections, { candidateId: item.root.candidateId, displayName: value.trim() }],
					existingNames
				))
			});
			if (name === undefined) {
				return;
			}
			taken.add(name.trim().toLowerCase());
			selections.push({ candidateId: item.root.candidateId, displayName: name.trim() });
		}
		const invalid = selectionMessage(validateImportSelections(inspection.terraformRoots, selections, existingNames));
		if (invalid) {
			void window.showErrorMessage(invalid);
			return;
		}
		const remote = await repositoryRemote(folder.uri);
		const imported = await callProjectService('importRepository', {
			workspaceId: project.workspaceId,
			inspectionId: inspection.inspectionId,
			selections,
			...(remote && validateCloneUrl(remote) === undefined ? { remote } : {})
		});
		const updated = this.handleProjectChange(imported);
		const first = updated?.importedArchitectureIds[0];
		if (updated && first) {
			const architecture = updated.architectures.find(item => item.architectureId === first);
			this.hasAutoOpenedArchitecture = true;
			if (architecture) {
				void this.context.workspaceState.update(LAST_ARCHITECTURE_NAME_KEY, architecture.displayName);
			}
			await this.graph.show(updated.workspaceId, first, architecture?.displayName);
		}
	}

	/** D5: clone a repository into this project's `repos` folder, then offer to import it. */
	async cloneRepository(provider?: CloneProvider, knownUrl?: string): Promise<void> {
		const chosen = knownUrl ? 'url' : provider ?? await pickProvider();
		if (!chosen || !(await ensureGit())) {
			return;
		}
		const folder = this.project ? this.projectFolder() : undefined;
		if (!folder) {
			await this.cloneWithoutProject(chosen);
			return;
		}
		let url = knownUrl && validateCloneUrl(knownUrl) === undefined ? knownUrl : undefined;
		if (!url && chosen !== 'github') {
			url = await window.showInputBox({
				title: l10n.t('Clone a repository'),
				prompt: l10n.t('Repository URL'),
				value: cloneUrlPrefix(chosen),
				valueSelection: [cloneUrlPrefix(chosen).length, cloneUrlPrefix(chosen).length],
				validateInput: value => validateCloneUrl(value) === undefined ? undefined : l10n.t('Enter an https://, ssh://, or user@host:path repository URL.')
			});
			if (url === undefined) {
				return;
			}
			url = url.trim();
		}
		const parent = Uri.joinPath(folder, REPOSITORIES_FOLDER);
		await workspace.fs.createDirectory(parent);
		// With no URL, git.clone shows its own picker, including GitHub repositories.
		const clonedPath = await commands.executeCommand<string | undefined>('git.clone', url, parent.fsPath, { postCloneAction: 'none', returnRepositoryPath: true });
		if (!clonedPath) {
			return;
		}
		const cloned = Uri.file(clonedPath);
		const folders = workspace.workspaceFolders ?? [];
		let index = folders.findIndex(item => item.uri.toString() === cloned.toString());
		if (index < 0) {
			index = folders.length;
			const added = new Promise<void>(resolve => {
				const listener = workspace.onDidChangeWorkspaceFolders(() => { listener.dispose(); resolve(); });
			});
			if (!workspace.updateWorkspaceFolders(index, 0, { uri: cloned })) {
				void window.showErrorMessage(l10n.t('The repository was cloned but could not be added to this window.'));
				return;
			}
			await added;
		}
		await this.refresh();
		await this.offerImport(index, true);
	}

	/** Creates a project in a folder the user picks (the broker opens the picker) and opens it. */
	async createProject(): Promise<boolean> {
		const name = await window.showInputBox({
			title: l10n.t('Create a CloudForge project'),
			prompt: l10n.t('Project name. You will choose the folder to create it in next.'),
			validateInput: value => isPathComponent(value.trim()) ? undefined : l10n.t('Use a valid Windows folder name.')
		});
		if (name === undefined) {
			return false;
		}
		const result = await callProjectService('createProject', { name: name.trim() });
		if (!result.ok) {
			showProjectError(result.code);
			return false;
		}
		const created = parseCreatedProject(result.value);
		if (!created) {
			showProjectError('SERVICE_ERROR');
			return false;
		}
		await commands.executeCommand('vscode.openFolder', Uri.parse(created.workspaceFile));
		return true;
	}

	/** Creates a writable local architecture inside `architectures/<name>/`, optionally moving root `.tf` files into it. */
	async createArchitecture(adoptRootFiles?: boolean): Promise<void> {
		const project = this.project;
		const folder = project ? this.projectFolder() : undefined;
		if (!project || !folder) {
			void window.showInformationMessage(l10n.t('Open a CloudForge project before creating an architecture.'));
			return;
		}
		const rootFiles = await this.readProjectRootTerraformFiles(folder);
		let shouldAdopt = adoptRootFiles;
		if (shouldAdopt === undefined && rootFiles.length > 0) {
			const moveChoice = l10n.t('Move {0} Terraform file(s) from project root', rootFiles.length);
			const blankChoice = l10n.t('Create empty starter architecture');
			const picked = await window.showQuickPick(
				[
					{ label: moveChoice, adopt: true, description: rootFiles.slice(0, 4).join(', ') + (rootFiles.length > 4 ? '…' : '') },
					{ label: blankChoice, adopt: false, description: l10n.t('Creates a new starter main.tf') },
				],
				{ title: l10n.t('New local CloudForge architecture'), placeHolder: l10n.t('Choose how to initialize this architecture') }
			);
			if (!picked) {
				return;
			}
			shouldAdopt = picked.adopt;
		}

		const existingNames = new Set(project.architectures.map(a => a.displayName.toLowerCase()));
		const defaultName = existingNames.has(project.displayName.toLowerCase()) ? 'main' : project.displayName;
		const rawName = await window.showInputBox({
			title: l10n.t('New CloudForge architecture'),
			prompt: l10n.t('Architecture name (created under architectures/<name>/)'),
			value: isPathComponent(defaultName) ? defaultName : 'main',
			validateInput: value => {
				const trimmed = value.trim();
				if (!isPathComponent(trimmed)) {
					return l10n.t('Use a valid Windows folder name.');
				}
				if (existingNames.has(trimmed.toLowerCase())) {
					return l10n.t('An architecture with that name already exists.');
				}
				return undefined;
			}
		});
		if (rawName === undefined) {
			return;
		}
		const name = rawName.trim();
		const archDir = Uri.joinPath(folder, ARCHITECTURES_FOLDER, name);
		if (await exists(archDir)) {
			void window.showErrorMessage(l10n.t('A folder named architectures/{0} already exists.', name));
			return;
		}

		await workspace.fs.createDirectory(archDir);
		const markerBytes = new TextEncoder().encode(JSON.stringify({ formatVersion: 1, name }, null, 2) + '\n');
		await workspace.fs.writeFile(Uri.joinPath(archDir, ARCHITECTURE_MARKER), markerBytes);

		if (shouldAdopt && rootFiles.length > 0) {
			for (const fileName of rootFiles) {
				await workspace.fs.rename(Uri.joinPath(folder, fileName), Uri.joinPath(archDir, fileName), { overwrite: false });
			}
		} else {
			const starter = new TextEncoder().encode(`# CloudForge architecture: ${name}\n`);
			await workspace.fs.writeFile(Uri.joinPath(archDir, 'main.tf'), starter);
		}

		await this.refresh();
		const created = this.project?.architectures.find(a => a.displayName.toLowerCase() === name.toLowerCase());
		if (created) {
			await this.openArchitecture(created.architectureId);
		}
	}

	/** Creates a new local architecture under architectures/<name>/ initialized from a curated offline template. */
	async createArchitectureFromTemplate(defaultName: string, starterMainTf: string): Promise<void> {
		const project = this.project;
		const folder = project ? this.projectFolder() : undefined;
		if (!project || !folder) {
			void window.showInformationMessage(l10n.t('Open a CloudForge project before creating an architecture from a template.'));
			return;
		}
		const existingNames = new Set(project.architectures.map(a => a.displayName.toLowerCase()));
		const safeBase = isPathComponent(defaultName) ? defaultName : 'template';
		let suggested = safeBase;
		let suffix = 2;
		while (existingNames.has(suggested.toLowerCase())) {
			suggested = `${safeBase}-${suffix++}`;
		}
		const rawName = await window.showInputBox({
			title: l10n.t('New Architecture from Template'),
			prompt: l10n.t('Architecture name (created under architectures/<name>/)'),
			value: suggested,
			validateInput: value => {
				const trimmed = value.trim();
				if (!isPathComponent(trimmed)) {
					return l10n.t('Use a valid Windows folder name.');
				}
				if (existingNames.has(trimmed.toLowerCase())) {
					return l10n.t('An architecture with that name already exists.');
				}
				return undefined;
			}
		});
		if (rawName === undefined) {
			return;
		}
		const name = rawName.trim();
		const archDir = Uri.joinPath(folder, ARCHITECTURES_FOLDER, name);
		if (await exists(archDir)) {
			void window.showErrorMessage(l10n.t('A folder named architectures/{0} already exists.', name));
			return;
		}

		await workspace.fs.createDirectory(archDir);
		const markerBytes = new TextEncoder().encode(JSON.stringify({ formatVersion: 1, name }, null, 2) + '\n');
		await workspace.fs.writeFile(Uri.joinPath(archDir, ARCHITECTURE_MARKER), markerBytes);
		await workspace.fs.writeFile(Uri.joinPath(archDir, 'main.tf'), new TextEncoder().encode(starterMainTf));

		await this.refresh();
		const created = this.project?.architectures.find(a => a.displayName.toLowerCase() === name.toLowerCase());
		if (created) {
			await this.openArchitecture(created.architectureId);
		}
	}

	private async readProjectRootTerraformFiles(folder: Uri): Promise<string[]> {
		try {
			const entries = await workspace.fs.readDirectory(folder);
			return findProjectRootTerraformFiles(entries, FileType.File);
		} catch {
			return [];
		}
	}

	private async offerAdoptRootTerraform(folder: Uri, project: ProjectResult): Promise<void> {
		const key = `root:${folder.toString()}`;
		if (this.offered.has(key) || this.context.workspaceState.get<boolean>(IGNORED_ROOT_TERRAFORM_KEY, false)) {
			return;
		}
		const rootFiles = await this.readProjectRootTerraformFiles(folder);
		if (rootFiles.length === 0) {
			return;
		}
		this.offered.add(key);
		const createLabel = l10n.t('Create Architecture…');
		const ignore = l10n.t("Don't Ask Again");
		const choice = await window.showInformationMessage(
			l10n.t('Terraform files found in the root of {0}. Move them into a CloudForge architecture?', project.displayName),
			{ detail: l10n.t('CloudForge loads project architectures from architectures/<name>/ or imported repos. Moving these {0} top-level Terraform file(s) into architectures/ lets you view, validate, and edit them in the Architecture Canvas.', rootFiles.length) },
			createLabel,
			l10n.t('Not Now'),
			ignore
		);
		if (choice === createLabel) {
			await this.createArchitecture(true);
		} else if (choice === ignore) {
			await this.context.workspaceState.update(IGNORED_ROOT_TERRAFORM_KEY, true);
		}
	}

	/** Offers imports for window folders that hold Terraform and are not part of the project. */
	async offerImports(): Promise<void> {
		for (const index of this.project?.unimportedFolders ?? []) {
			await this.offerImport(index, false);
		}
	}

	private async offerImport(index: number, afterClone: boolean): Promise<void> {
		const folder = workspace.workspaceFolders?.[index];
		if (!folder || (!afterClone && this.offered.has(folder.uri.toString()))) {
			return;
		}
		// Mark before any await so the debounced reconnect after a clone does not offer it twice.
		this.offered.add(folder.uri.toString());
		const [candidate] = await findTerraformImportCandidates([folder], this.importExclusions(), findFilesInFolder);
		if (!candidate) {
			return;
		}
		const importLabel = l10n.t('Import…');
		const ignore = l10n.t("Don't Ask for This Repo");
		const choice = await window.showInformationMessage(
			l10n.t('Terraform found in {0}. Import it into CloudForge?', folder.name),
			{ detail: l10n.t("CloudForge can read this repo and show its Terraform as architectures. It won't change any files.") },
			importLabel,
			l10n.t('Not Now'),
			ignore
		);
		if (choice === importLabel) {
			await this.importFolder(index);
		} else if (choice === ignore) {
			const ignored = new Set(this.context.workspaceState.get<string[]>(IGNORED_FOLDERS_KEY, []));
			ignored.add(folder.uri.toString());
			await this.context.workspaceState.update(IGNORED_FOLDERS_KEY, [...ignored]);
		}
	}

	/** Folders never offered for import: ignored ones, the project folder, and registered repos. */
	private importExclusions(): Set<string> {
		const excluded = new Set(this.context.workspaceState.get<string[]>(IGNORED_FOLDERS_KEY, []));
		const project = this.projectFolder();
		if (project) {
			excluded.add(project.toString());
		}
		const folders = workspace.workspaceFolders ?? [];
		for (const repository of this.project?.repositories ?? []) {
			const folder = repository.workspaceFolderIndex === undefined ? undefined : folders[repository.workspaceFolderIndex];
			if (folder) {
				excluded.add(folder.uri.toString());
			}
		}
		return excluded;
	}

	/** A project folder opened as a plain folder: offer its workspace file instead. */
	private async offerOpenAsProject(folder: Uri): Promise<boolean> {
		let files: [string, FileType][];
		try {
			files = await workspace.fs.readDirectory(folder);
		} catch {
			return false;
		}
		const workspaceFiles = files.filter(([name, type]) => type === FileType.File && name.toLowerCase().endsWith('.code-workspace'));
		if (workspaceFiles.length !== 1) {
			return false;
		}
		const open = l10n.t('Open as CloudForge Project');
		const choice = await window.showInformationMessage(
			l10n.t('This folder is a CloudForge project. Open its workspace to see all of its repositories?'),
			open
		);
		if (choice !== open) {
			return false;
		}
		await commands.executeCommand('vscode.openFolder', Uri.joinPath(folder, workspaceFiles[0][0]));
		return true;
	}

	private async offerWorkspaceFile(project: ProjectResult, folder: Uri): Promise<void> {
		const setUp = l10n.t('Set Up for Repos');
		const choice = await window.showInformationMessage(
			l10n.t('Set up {0} so you can add Git repositories to it?', project.displayName),
			{ detail: l10n.t('CloudForge creates a workspace file in the project folder and changes nothing else.') },
			setUp
		);
		if (choice !== setUp) {
			return;
		}
		const result = await callProjectService('createWorkspaceFile', { workspaceId: project.workspaceId });
		if (!result.ok) {
			showProjectError(result.code);
			return;
		}
		const name = (result.value as { workspaceFileName?: unknown } | undefined)?.workspaceFileName;
		if (isPathComponent(name) && name.toLowerCase().endsWith('.code-workspace')) {
			await commands.executeCommand('vscode.openFolder', Uri.joinPath(folder, name));
		}
	}

	/** Without a project, a clone needs one first: create or open it, then continue there. */
	private async cloneWithoutProject(provider: CloneProvider): Promise<void> {
		const create = l10n.t('Create Project…');
		const open = l10n.t('Open Project…');
		const choice = await window.showInformationMessage(
			l10n.t('Clone into a CloudForge project'),
			{ modal: true, detail: l10n.t('Repositories are cloned into a project so CloudForge can show their Terraform. Create a project or open an existing one; the clone continues there.') },
			create,
			open
		);
		if (choice === undefined) {
			return;
		}
		const pending: PendingClone = { provider, createdAt: Date.now() };
		await this.context.globalState.update(PENDING_CLONE_KEY, pending);
		const switched = choice === create
			? await this.createProject()
			: await commands.executeCommand('workbench.action.openWorkspace').then(() => true, () => false);
		if (!switched) {
			await this.context.globalState.update(PENDING_CLONE_KEY, undefined);
		}
	}

	private async resumePendingClone(): Promise<void> {
		const pending = this.context.globalState.get<PendingClone>(PENDING_CLONE_KEY);
		if (!pending) {
			return;
		}
		await this.context.globalState.update(PENDING_CLONE_KEY, undefined);
		if (Date.now() - pending.createdAt < PENDING_CLONE_LIFETIME_MS) {
			void this.cloneRepository(pending.provider);
		}
	}

	private handleProjectChange(result: Awaited<ReturnType<typeof callProjectService>>): ProjectResult | undefined {
		if (!result.ok) {
			if (result.code === 'STALE_SOURCE') {
				void this.refresh();
			}
			void window.showErrorMessage(projectErrorMessage(result.code));
			return undefined;
		}
		return this.accept(result.value);
	}

	private accept(value: unknown): ProjectResult | undefined {
		const project = parseProjectResult(value);
		if (!project) {
			this.setProject(undefined);
			showProjectError('SERVICE_ERROR');
			return undefined;
		}
		this.setProject(project);
		return project;
	}

	private setProject(project: ProjectResult | undefined): void {
		this.project = project;
		void commands.executeCommand('setContext', 'cloudforge.projectOpen', !!project);
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.changeEmitter.dispose();
		this.secrets.dispose();
	}
}

async function exists(uri: Uri): Promise<boolean> {
	try {
		await workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/** Detection by file name only: no file contents are read before the user agrees to import. */
function findFilesInFolder(folder: WorkspaceFolder, include: string, exclude: string, maxResults: number): Thenable<Uri[]> {
	return workspace.findFiles(new RelativePattern(folder, include), exclude, maxResults);
}

function selectionMessage(error: ImportSelectionError | undefined): string | undefined {
	switch (error) {
		case undefined:
			return undefined;
		case 'invalidName':
			return l10n.t('Use a valid Windows folder name.');
		case 'duplicateName':
			return l10n.t('An architecture with that name already exists.');
		case 'noSelection':
			return l10n.t('Choose at least one Terraform root to import.');
		case 'duplicateCandidate':
			return l10n.t('That Terraform root is already selected.');
		case 'candidateUnavailable':
			return l10n.t('That Terraform root is no longer available. Try the import again.');
	}
}

async function pickProvider(): Promise<CloneProvider | undefined> {
	const items: { label: string; provider: CloneProvider }[] = [
		{ label: '$(github) GitHub', provider: 'github' },
		{ label: '$(repo) GitLab', provider: 'gitlab' },
		{ label: '$(repo) Bitbucket', provider: 'bitbucket' },
		{ label: '$(link) ' + l10n.t('Any Git URL'), provider: 'url' }
	];
	const picked = await window.showQuickPick(items, { title: l10n.t('Clone into a CloudForge project'), placeHolder: l10n.t('Where is the repository?') });
	return picked?.provider;
}
