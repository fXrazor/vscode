/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Template Library wiring: the shared store, the Templates view, the library page and commands.

import { existsSync } from 'node:fs';
import { commands, l10n, Uri, window, type Event, type ExtensionContext } from 'vscode';
import { loadIconCatalogue } from './iconCatalogue';
import { TemplateLibraryPanel, type LibraryProjectInfo } from './libraryPanel';
import { createTemplateClient, isTemplateId, isTemplateVersion, type ServiceCall, type TemplateClient, type TemplateFinding } from './model';
import type { CatalogueLookup } from './preview';
import { TemplateStore } from './store';
import { TemplatesViewProvider, type TemplatesNode } from './templatesView';

export interface TemplatesHost {
	readonly callService: ServiceCall;
	project(): LibraryProjectInfo | undefined;
	readonly onDidChangeProject: Event<void>;
	createArchitecture(name: string, files: readonly { readonly fileName: string; readonly contents: string }[]): Promise<boolean>;
	isValidArchitectureName(name: string): boolean;
}

/** Studio's staged assets in a build, or its source assets in a development checkout. */
function studioAssets(extensionUri: Uri): Uri | undefined {
	for (const parts of [['media', 'studio', 'assets'], ['studio', 'assets']]) {
		const uri = Uri.joinPath(extensionUri, ...parts);
		if (uri.scheme === 'file' && existsSync(Uri.joinPath(uri, 'catalogue').fsPath)) {
			return uri;
		}
	}
	return undefined;
}

/** id and version from a command argument: a Templates view node, or the two strings. */
function templateArgs(first: unknown, second: unknown): { templateId: string; version?: string } | undefined {
	if (typeof first === 'object' && first !== null && (first as TemplatesNode).kind === 'template') {
		const template = (first as Extract<TemplatesNode, { kind: 'template' }>).template;
		return { templateId: template.id, version: template.version };
	}
	if (isTemplateId(first)) {
		return { templateId: first, ...(isTemplateVersion(second) ? { version: second } : {}) };
	}
	return undefined;
}

function findingsText(findings: readonly TemplateFinding[]): string {
	return findings.filter(f => f.risk === 'high').slice(0, 8).map(f => `• ${f.file}${f.line ? ':' + f.line : ''}: ${f.message}`).join('\n');
}

async function importTemplate(client: TemplateClient, store: TemplateStore, panel: TemplateLibraryPanel, options: { replace?: boolean; acceptHighRisk?: boolean } = {}): Promise<void> {
	const result = await client.importFile(options);
	if (!result.ok) {
		if (result.code === 'CANCELLED') {
			return;
		}
		if (result.code === 'TEMPLATE_EXISTS' && !options.replace) {
			const replace = l10n.t('Choose File and Replace');
			const choice = await window.showWarningMessage(result.message, {
				modal: true,
				detail: l10n.t('A different package with the same id and version is already in My Library. Choose the file again to replace it. Architectures created from the old one are not changed.'),
			}, replace);
			if (choice === replace) {
				await importTemplate(client, store, panel, { ...options, replace: true });
			}
			return;
		}
		void window.showErrorMessage(result.message);
		return;
	}
	const outcome = result.value;
	if (!outcome.imported) {
		if (outcome.reason === 'HIGH_RISK_NOT_ACCEPTED') {
			const accept = l10n.t('Choose File and Accept');
			const choice = await window.showWarningMessage(l10n.t('{0} {1} has high-risk content.', outcome.templateId, outcome.version), {
				modal: true,
				detail: findingsText(outcome.findings) + '\n\n' + l10n.t('CloudForge never runs a template, but Terraform would run this content when you plan or apply. Choose the file again to import it labelled "High risk accepted".'),
			}, accept);
			if (choice === accept) {
				await importTemplate(client, store, panel, { ...options, acceptHighRisk: true });
			}
			return;
		}
		const problems = outcome.problems.filter(p => p.severity === 'error').slice(0, 6).map(p => '• ' + p.message).join('\n');
		void window.showErrorMessage(l10n.t('{0} {1} is not a valid template package.', outcome.templateId, outcome.version), { modal: true, detail: problems });
		return;
	}
	await store.load(true);
	const open = l10n.t('Open');
	const text = outcome.outcome === 'unchanged'
		? l10n.t('{0} {1} is already in My Library.', outcome.summary.name, outcome.version)
		: outcome.outcome === 'replaced'
			? l10n.t('Replaced {0} {1} in My Library.', outcome.summary.name, outcome.version)
			: l10n.t('Imported {0} {1} into My Library.', outcome.summary.name, outcome.version);
	const choice = await window.showInformationMessage(text, open);
	if (choice === open) {
		panel.show({ templateId: outcome.templateId, version: outcome.version, mode: 'details' });
	}
}

export function activateTemplates(context: ExtensionContext, host: TemplatesHost): TemplateLibraryPanel {
	const client = createTemplateClient(host.callService);
	const assetsRoot = studioAssets(context.extensionUri);
	let catalogue: Promise<CatalogueLookup> | undefined;
	const store = new TemplateStore(client, () => (catalogue ??= loadIconCatalogue(assetsRoot?.fsPath)));
	const panel = new TemplateLibraryPanel(context, {
		client,
		store,
		project: () => host.project(),
		onDidChangeProject: host.onDidChangeProject,
		createArchitecture: (name, files) => host.createArchitecture(name, files),
		isValidArchitectureName: name => host.isValidArchitectureName(name),
		assetsRoot,
	});
	const view = new TemplatesViewProvider(store);
	context.subscriptions.push(store, panel, window.createTreeView('cloudforge.templates', { treeDataProvider: view, showCollapseAll: true }));

	context.subscriptions.push(
		commands.registerCommand('cloudforge.openTemplateLibrary', () => panel.show()),
		commands.registerCommand('cloudforge.templates.refresh', () => store.load(true)),
		commands.registerCommand('cloudforge.templates.importFile', () => importTemplate(client, store, panel)),
		commands.registerCommand('cloudforge.templates.openTemplate', (first: unknown, second: unknown) => {
			const args = templateArgs(first, second);
			panel.show(args ? { ...args, mode: 'details' } : undefined);
		}),
		commands.registerCommand('cloudforge.templates.createArchitecture', (first: unknown, second: unknown) => {
			const args = templateArgs(first, second);
			panel.show(args ? { ...args, mode: 'create' } : undefined);
		}),
		commands.registerCommand('cloudforge.templates.remove', async (first: unknown, second: unknown) => {
			const args = templateArgs(first, second);
			const template = args && store.find(args.templateId, args.version);
			if (!template) {
				return;
			}
			if (template.source !== 'local') {
				void window.showInformationMessage(l10n.t('Built-in templates cannot be removed.'));
				return;
			}
			const remove = l10n.t('Remove');
			const choice = await window.showWarningMessage(l10n.t('Remove {0} {1} from My Library?', template.name, template.version), {
				modal: true,
				detail: l10n.t('Only the stored package is removed. Architectures created from it are not changed.'),
			}, remove);
			if (choice !== remove) {
				return;
			}
			const result = await client.remove(template.id, template.version);
			if (!result.ok) {
				void window.showErrorMessage(result.message);
				return;
			}
			await store.load(true);
			void window.showInformationMessage(l10n.t('Removed {0} {1} from My Library.', template.name, template.version));
		}),
	);
	return panel;
}

