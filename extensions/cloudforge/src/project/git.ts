/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, env, extensions, l10n, ProgressLocation, Uri, window, workspace } from 'vscode';
import { normalizeFsPathForMatch, parseGitInstall, sanitizeRemoteUrl } from './model';
import { callProjectService, showProjectError } from './service';

const GIT_DOWNLOAD_PAGE = 'https://git-scm.com/download/win';

/** The part of the built-in Git extension's exports CloudForge reads. */
interface GitExtensionExports {
	readonly enabled: boolean;
	getAPI(version: 1): {
		readonly repositories: readonly {
			readonly rootUri: Uri;
			readonly state: { readonly remotes: readonly { readonly name: string; readonly fetchUrl?: string }[] };
		}[];
	};
}

async function gitExtension(): Promise<GitExtensionExports | undefined> {
	const extension = extensions.getExtension<GitExtensionExports>('vscode.git');
	if (!extension) {
		return undefined;
	}
	try {
		return extension.isActive ? extension.exports : await extension.activate();
	} catch {
		return undefined;
	}
}

/**
 * True when Git cannot be found: the Git extension is enabled in settings but did not start a
 * model, which is how it reports a missing installation (it also sets the `git.missing` context).
 */
export async function isGitMissing(): Promise<boolean> {
	const git = await gitExtension();
	return !!git && !git.enabled && workspace.getConfiguration('git').get<boolean>('enabled') !== false;
}

/** The credential-free `origin` (or first) fetch URL of the Git repository at a folder, when Git knows it. */
export async function repositoryRemote(folder: Uri): Promise<string | undefined> {
	const git = await gitExtension();
	if (!git?.enabled) {
		return undefined;
	}
	const isWindows = process.platform === 'win32';
	const targetPath = normalizeFsPathForMatch(folder.fsPath, isWindows);
	const repository = git.getAPI(1).repositories.find(candidate =>
		candidate.rootUri.toString() === folder.toString() ||
		normalizeFsPathForMatch(candidate.rootUri.fsPath, isWindows) === targetPath
	);
	const remotes = repository?.state.remotes ?? [];
	const raw = (remotes.find(remote => remote.name === 'origin') ?? remotes[0])?.fetchUrl;
	return raw ? sanitizeRemoteUrl(raw) : undefined;
}

/**
 * Offers to install Git when it is missing. Returns true when Git is available now (no reload
 * needed). Never installs without the user's explicit choice.
 */
export async function ensureGit(): Promise<boolean> {
	if (!(await isGitMissing())) {
		return true;
	}
	const install = l10n.t('Install Git');
	const download = l10n.t('Open Download Page');
	const choice = await window.showWarningMessage(
		l10n.t('Git is not installed, so CloudForge cannot clone repositories.'),
		{
			modal: true,
			detail: l10n.t('CloudForge can install Git for Windows (package Git.Git) from the winget community repository. Installing accepts the Git for Windows license and the winget source agreement. winget checks the installer hash, and Windows may ask for permission.'),
		},
		install,
		download
	);
	if (choice === download) {
		await env.openExternal(Uri.parse(GIT_DOWNLOAD_PAGE));
		return false;
	}
	if (choice !== install) {
		return false;
	}
	const result = await window.withProgress(
		{ location: ProgressLocation.Notification, title: l10n.t('Installing Git for Windows…') },
		() => callProjectService('installGit', {})
	);
	if (!result.ok) {
		showProjectError(result.code);
		return false;
	}
	const outcome = parseGitInstall(result.value);
	switch (outcome?.status) {
		case 'installed': {
			const reload = l10n.t('Reload Window');
			const message = outcome.gitVersion
				? l10n.t('{0} is installed. Reload the window so Source Control can use it.', outcome.gitVersion)
				: l10n.t('Git is installed. Reload the window so Source Control can use it.');
			if (await window.showInformationMessage(message, reload) === reload) {
				await commands.executeCommand('workbench.action.reloadWindow');
			}
			return false;
		}
		case 'cancelled':
			void window.showInformationMessage(l10n.t('Git was not installed.'));
			return false;
		default: {
			const open = l10n.t('Open Download Page');
			const message = outcome?.status === 'wingetMissing'
				? l10n.t('winget is not available on this computer. Download Git for Windows from its official page.')
				: l10n.t('Git could not be installed automatically. Download Git for Windows from its official page.');
			if (await window.showWarningMessage(message, open) === open) {
				await env.openExternal(Uri.parse(GIT_DOWNLOAD_PAGE));
			}
			return false;
		}
	}
}
