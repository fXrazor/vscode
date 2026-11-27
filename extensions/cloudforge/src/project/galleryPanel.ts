/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { commands, Disposable, l10n, ViewColumn, window, type WebviewPanel } from 'vscode';
import type { ProjectController } from './controller';
import { buildGalleryCards, parseArchitectureSummaries, providerLabel, relativeTime, type ArchitectureSummary } from './gallery';
import { buildGalleryHtml } from './galleryHtml';
import type { ProjectResult } from './model';
import { callProjectService } from './service';

type GalleryMessage =
	| { readonly type: 'ready' | 'newArchitecture' | 'openTemplates' | 'refresh' }
	| { readonly type: 'open'; readonly architectureId: string };

function parseMessage(value: unknown): GalleryMessage | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const message = value as { type?: unknown; architectureId?: unknown };
	switch (message.type) {
		case 'ready': case 'newArchitecture': case 'openTemplates': case 'refresh':
			return { type: message.type };
		case 'open':
			return typeof message.architectureId === 'string' ? { type: 'open', architectureId: message.architectureId } : undefined;
		default:
			return undefined;
	}
}

/**
 * The Projects / <project> architecture gallery: one card per architecture, with counts and providers
 * from the Rust service's read-only `summarizeArchitectures`. The extension reads no files itself.
 */
export class ProjectGalleryPanel implements Disposable {
	private panel: WebviewPanel | undefined;
	private summaries: Map<string, ArchitectureSummary> | undefined;
	private summaryFor: string | undefined;
	private loading = false;
	private reloadPending = false;
	private readonly subscriptions: Disposable[] = [];

	constructor(private readonly controller: ProjectController) {
		this.subscriptions.push(controller.onDidChange(() => {
			if (this.panel) {
				// Architectures may have been added or removed: summarize again.
				this.summaries = undefined;
				void this.load();
			}
		}));
	}

	show(): void {
		if (!this.controller.current) {
			void window.showInformationMessage(l10n.t('Open a CloudForge project to browse its architectures.'));
			return;
		}
		if (this.panel) {
			this.panel.reveal();
			this.post();
			return;
		}
		const panel = window.createWebviewPanel('cloudforge.projectGallery', l10n.t('Architectures'), ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: false,
			localResourceRoots: [],
		});
		this.panel = panel;
		panel.webview.html = buildGalleryHtml({ nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource });
		const messageSub = panel.webview.onDidReceiveMessage(value => this.handle(parseMessage(value)));
		const disposeSub = panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
			}
			messageSub.dispose();
			disposeSub.dispose();
		});
	}

	private async handle(message: GalleryMessage | undefined): Promise<void> {
		switch (message?.type) {
			case 'ready':
				this.post();
				await this.load();
				break;
			case 'refresh':
				this.summaries = undefined;
				await this.controller.refresh();
				await this.load();
				break;
			case 'open':
				if (this.controller.current?.architectures.some(item => item.architectureId === message.architectureId)) {
					await this.controller.openArchitecture(message.architectureId);
				}
				break;
			case 'newArchitecture':
				await this.controller.addArchitecture();
				break;
			case 'openTemplates':
				await commands.executeCommand('cloudforge.openTemplateLibrary');
				break;
		}
	}

	private async load(): Promise<void> {
		if (!this.controller.current) {
			return;
		}
		if (this.loading) {
			this.reloadPending = true;
			return;
		}
		this.loading = true;
		try {
			do {
				this.reloadPending = false;
				const project: ProjectResult | undefined = this.controller.current;
				if (!project) {
					break;
				}
				const result = await callProjectService('summarizeArchitectures', { workspaceId: project.workspaceId });
				if (this.controller.current?.workspaceId !== project.workspaceId) {
					continue;
				}
				// A failed summary still shows the cards, marked unavailable, rather than an error dialog.
				this.summaries = (result.ok ? parseArchitectureSummaries(result.value, project.workspaceId) : undefined) ?? new Map();
				this.summaryFor = project.workspaceId;
			} while (this.reloadPending);
		} finally {
			this.loading = false;
		}
		this.post();
	}

	private post(): void {
		const project = this.controller.current;
		if (!this.panel || !project) {
			return;
		}
		const summaries = this.summaryFor === project.workspaceId ? this.summaries : undefined;
		const now = Date.now();
		const cards = buildGalleryCards(project, summaries).map(card => ({
			...card,
			providerLabels: card.providers.map(providerLabel),
			edited: relativeTime(card.lastModified, now),
		}));
		this.panel.title = l10n.t('Architectures · {0}', project.displayName);
		void this.panel.webview.postMessage({
			type: 'state',
			projectName: project.displayName,
			activeId: this.controller.activeArchitectureId,
			cards,
		});
	}

	dispose(): void {
		this.panel?.dispose();
		Disposable.from(...this.subscriptions).dispose();
	}
}
