/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Template Library editor tab: browse, details, and create an architecture from a template.
// The page only asks; this host checks every request, reads templates from the Rust service via
// the store, and writes nothing itself. Creating goes through the project controller's existing
// `createArchitecture` path, which never overwrites a folder.

import { randomBytes } from 'node:crypto';
import { commands, Disposable, env, l10n, Uri, ViewColumn, window, workspace, type Event, type ExtensionContext, type WebviewPanel } from 'vscode';
import { buildLibraryHtml } from './libraryHtml';
import { parseLibraryMessage, templateKey, type LibraryMessage } from './libraryProtocol';
import { describeProviderFit, type TemplateClient, type TemplateFinding, type TemplateSummary } from './model';
import { renderTfvars, validateParameters } from './parameters';
import type { TemplateStore, TemplateView } from './store';

export interface LibraryProjectInfo {
	readonly workspaceId: string;
	readonly name: string;
	readonly architectures: readonly { readonly architectureId: string; readonly displayName: string }[];
	readonly activeArchitectureId?: string;
}

export interface TemplateLibraryHost {
	readonly client: TemplateClient;
	readonly store: TemplateStore;
	project(): LibraryProjectInfo | undefined;
	readonly onDidChangeProject: Event<void>;
	/** Creates architectures/<name>/ with these files and opens it. Returns false if it did not. */
	createArchitecture(name: string, files: readonly { readonly fileName: string; readonly contents: string }[]): Promise<boolean>;
	isValidArchitectureName(name: string): boolean;
	/** Studio assets folder (icons, provider marks, fonts), when the build has one. */
	readonly assetsRoot: Uri | undefined;
}

export interface LibraryFocus {
	readonly templateId: string;
	readonly version?: string;
	readonly mode: 'details' | 'create';
}

const PREVIEW_CONCURRENCY = 4;
const MAX_PREVIEWS = 120;

export class TemplateLibraryPanel implements Disposable {
	private panel: WebviewPanel | undefined;
	private ready = false;
	private pendingFocus: LibraryFocus | undefined;
	private previewRun = 0;
	private readonly subscriptions: Disposable[] = [];

	constructor(private readonly context: ExtensionContext, private readonly host: TemplateLibraryHost) {
		this.subscriptions.push(host.onDidChangeProject(() => this.postProject()));
		this.subscriptions.push(host.store.onDidChange(() => {
			if (this.ready) {
				this.postList();
			}
		}));
	}

	show(focus?: LibraryFocus): void {
		if (this.panel) {
			this.panel.reveal();
			if (focus) {
				this.focus(focus);
			}
			return;
		}
		const resources = Uri.joinPath(this.context.extensionUri, 'resources', 'templates');
		const roots = [resources, ...(this.host.assetsRoot ? [this.host.assetsRoot] : [])];
		const panel = window.createWebviewPanel('cloudforge.templateLibrary', l10n.t('Template Library'), ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: false,
			localResourceRoots: roots,
		});
		this.panel = panel;
		this.ready = false;
		this.pendingFocus = focus;
		const webview = panel.webview;
		webview.html = buildLibraryHtml({
			nonce: randomBytes(16).toString('base64'),
			cspSource: webview.cspSource,
			scriptUri: webview.asWebviewUri(Uri.joinPath(resources, 'library.js')).toString(),
			styleUri: webview.asWebviewUri(Uri.joinPath(resources, 'library.css')).toString(),
			...(this.host.assetsRoot ? { fontUri: webview.asWebviewUri(Uri.joinPath(this.host.assetsRoot, 'mona-sans-variable.woff2')).toString() } : {}),
		});
		panel.onDidDispose(() => {
			this.panel = undefined;
			this.ready = false;
			this.previewRun++;
		}, undefined, this.subscriptions);
		webview.onDidReceiveMessage(value => {
			void this.handle(parseLibraryMessage(value)).catch(() => {
				void this.post({ type: 'toast', kind: 'err', message: l10n.t('Something went wrong in the Template Library. Try Refresh.') });
			});
		}, undefined, this.subscriptions);
	}

	focus(focus: LibraryFocus): void {
		if (!this.ready) {
			this.pendingFocus = focus;
			return;
		}
		void this.post({ type: 'focus', ...focus });
	}

	private async post(message: Record<string, unknown>): Promise<void> {
		await this.panel?.webview.postMessage(message);
	}

	private projectMessage(): Record<string, unknown> | undefined {
		const project = this.host.project();
		if (!project) {
			return undefined;
		}
		const active = project.architectures.find(item => item.architectureId === project.activeArchitectureId);
		return {
			name: project.name,
			architectures: project.architectures.map(item => item.displayName),
			...(active ? { activeName: active.displayName } : {}),
		};
	}

	private postProject(): void {
		if (this.ready) {
			void this.post({ type: 'project', project: this.projectMessage() });
		}
	}

	private postList(): void {
		const page = this.host.store.current;
		void this.post(page ? { type: 'list', page } : { type: 'list', error: this.host.store.error ?? l10n.t('The CloudForge service did not answer.') });
		if (page) {
			void this.postPreviews(page.templates);
		}
	}

	/** Reads each template once (a few at a time) and sends its card preview as it arrives. */
	private async postPreviews(templates: readonly TemplateSummary[]): Promise<void> {
		const run = ++this.previewRun;
		const queue = templates.slice(0, MAX_PREVIEWS);
		const worker = async () => {
			for (let next = queue.shift(); next; next = queue.shift()) {
				if (run !== this.previewRun || !this.panel) {
					return;
				}
				const result = await this.host.store.view(next.id, next.version);
				await this.post({ type: 'preview', key: templateKey(next.id, next.version), diagram: result.ok ? result.value.diagram : null });
			}
		};
		await Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, worker));
	}

	private async handle(message: LibraryMessage | undefined): Promise<void> {
		if (!message) {
			return;
		}
		switch (message.type) {
			case 'ready': {
				this.ready = true;
				const assets = this.host.assetsRoot && this.panel ? this.panel.webview.asWebviewUri(this.host.assetsRoot).toString() : '';
				await this.post({ type: 'init', assets, project: this.projectMessage(), ...(this.pendingFocus ? { focus: this.pendingFocus } : {}) });
				this.pendingFocus = undefined;
				if (this.host.store.current) {
					this.postList();
				} else {
					await this.host.store.load();
				}
				return;
			}
			case 'refresh':
				await this.host.store.load(true);
				return;
			case 'details': {
				const key = templateKey(message.templateId, message.version);
				const result = await this.host.store.view(message.templateId, message.version);
				await this.post(result.ok
					? { type: 'details', key, details: pageDetails(result.value), diagram: result.value.diagram, fields: result.value.fields }
					: { type: 'details', key, error: result.message });
				return;
			}
			case 'compatibility':
				await this.checkCompatibility(message.templateId, message.version);
				return;
			case 'validate': {
				const key = templateKey(message.templateId, message.version);
				const view = await this.host.store.view(message.templateId, message.version);
				await this.post({ type: 'validation', key, errors: view.ok ? validateParameters(view.value.fields, message.values) : {} });
				return;
			}
			case 'create':
				await this.create(message.templateId, message.version, message.name, message.values);
				return;
			case 'importFile':
				await commands.executeCommand('cloudforge.templates.importFile');
				return;
			case 'remove':
				await commands.executeCommand('cloudforge.templates.remove', message.templateId, message.version);
				return;
			case 'openFile': {
				const view = await this.host.store.view(message.templateId, message.version);
				const file = view.ok ? view.value.details.terraformFiles.find(item => item.fileName === message.fileName) : undefined;
				if (file) {
					const doc = await workspace.openTextDocument({ content: file.contents, language: 'terraform' });
					await window.showTextDocument(doc, { preview: true, viewColumn: ViewColumn.Beside });
				}
				return;
			}
			case 'copy':
				await env.clipboard.writeText(message.text);
				await this.post({ type: 'toast', kind: 'ok', message: l10n.t('Copied {0}.', message.text) });
				return;
			case 'addToArchitecture':
				void window.showInformationMessage(
					l10n.t('Adding a template to an open architecture comes in the next build. For now, create it as a new architecture; it gets its own folder and lock file.'),
				);
				return;
			case 'createFromArchitecture':
				return;
		}
	}

	private async checkCompatibility(templateId: string, version: string): Promise<void> {
		const key = templateKey(templateId, version);
		const project = this.host.project();
		if (!project?.activeArchitectureId) {
			await this.post({ type: 'compatibility', key, error: l10n.t('Open an architecture to check this template against it.') });
			return;
		}
		const result = await this.host.client.compatibility({ workspaceId: project.workspaceId, architectureId: project.activeArchitectureId }, templateId, version);
		await this.post(result.ok
			? { type: 'compatibility', key, result: result.value, lines: result.value.providers.map(describeProviderFit) }
			: { type: 'compatibility', key, error: result.message });
	}

	private async create(templateId: string, version: string, rawName: string, values: Readonly<Record<string, string>>): Promise<void> {
		const key = templateKey(templateId, version);
		const fail = (text: string, errors?: Record<string, string>) => this.post({ type: 'createFailed', key, message: text, ...(errors ? { errors } : {}) });
		const project = this.host.project();
		const name = rawName.trim();
		if (!project) {
			await fail(l10n.t('Open a CloudForge project first. The new architecture is created inside it.'));
			return;
		}
		if (!this.host.isValidArchitectureName(name)) {
			await fail(l10n.t('Use a valid folder name for the architecture.'));
			return;
		}
		if (project.architectures.some(item => item.displayName.toLowerCase() === name.toLowerCase())) {
			await fail(l10n.t('An architecture called {0} already exists. Choose another name; CloudForge never overwrites one.', name));
			return;
		}
		const view = await this.host.store.view(templateId, version);
		if (!view.ok) {
			await fail(view.message);
			return;
		}
		const { details, fields } = view.value;
		if (!details.usable) {
			await fail(l10n.t('This template has safety problems and cannot be used.'));
			return;
		}
		const errors = validateParameters(fields, values);
		if (Object.keys(errors).length) {
			await fail(l10n.t('Some parameters need attention.'), errors);
			return;
		}
		const files = details.terraformFiles.map(file => ({ fileName: file.fileName, contents: file.contents }));
		const tfvars = renderTfvars(details.summary, fields, values);
		if (tfvars && !files.some(file => file.fileName.toLowerCase() === 'terraform.tfvars')) {
			files.push({ fileName: 'terraform.tfvars', contents: tfvars });
		}
		const created = await this.host.createArchitecture(name, files);
		if (!created) {
			await fail(l10n.t('CloudForge could not create {0}. Nothing was written.', name));
			return;
		}
		await this.post({ type: 'created', key, message: l10n.t('Created {0} from {1}. {2} files written; nothing was run.', name, details.summary.name, files.length) });
	}

	dispose(): void {
		this.panel?.dispose();
		Disposable.from(...this.subscriptions).dispose();
	}
}

/** Only what the page shows; the page never needs the archive bytes or raw layout. */
function pageDetails(view: TemplateView): Record<string, unknown> {
	const { details } = view;
	return {
		archiveSha256: details.archiveSha256,
		...(details.readme ? { readme: details.readme } : {}),
		terraformFiles: details.terraformFiles,
		problems: details.problems,
		findings: details.findings satisfies readonly TemplateFinding[],
		usable: details.usable,
	};
}
