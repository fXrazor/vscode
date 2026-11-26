/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 12B: CloudForge Learning Studio, Baked-in Skills (12), Starter Blueprints (5),
// Pending Proposal Review (with guarded Stage 10D batch save handoff), and Scoped MCP Agents.

import { randomBytes } from 'node:crypto';
import {
	commands,
	env,
	EventEmitter,
	l10n,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	ViewColumn,
	window,
	type Disposable,
	type Event,
	type ExtensionContext,
	type TreeDataProvider,
	type WebviewPanel
} from 'vscode';
import { registerCloudForgeMcpProvider } from './mcpProvider';
import { registerCloudForgeChatParticipant } from './chatParticipant';
import {
	buildExternalMcpConfigSnippet,
	buildLearningStudioHtml,
	categoryLabel,
	parseIssuedMcpGrant,
	parseLearningRecord,
	parseLearningStudioMessage,
	parseMcpGrantsList,
	parseSkillsList,
	parseTopologyBlueprint,
	parseTopologyBlueprintList,
	type LearningMode,
	type LearningRecord,
	type LearningStudioTab,
	type McpGrantSummary,
	type PinnedSkill,
	type ProposalDraft,
	type SkillCategory,
	type TopologyBlueprintSummary
} from './model';

type ServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } };

export interface LearningGraph {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
}

export interface LearningHost {
	callService<T>(method: string, params: Record<string, unknown>): Promise<ServiceResult<T>>;
	getGraph(): LearningGraph | undefined;
	readonly onDidChangeGraph: Event<unknown>;
	architectureName(): string | undefined;
	reloadActiveArchitecture(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class LearningStore implements Disposable {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;
	skills: readonly PinnedSkill[] = [];
	safetyNotice: string | undefined;
	blueprints: readonly TopologyBlueprintSummary[] = [];
	record: LearningRecord | undefined;
	grants: readonly McpGrantSummary[] = [];
	/** Maps masked `grantIdPreview` -> full `grantId` for grants issued during this window session so users can revoke them with one click. */
	private readonly issuedGrantsByPreview = new Map<string, string>();
	private loading: Promise<void> | undefined;
	private pendingReload = false;

	constructor(private readonly host: LearningHost) { }

	rememberIssuedGrant(preview: string, grantId: string): void {
		this.issuedGrantsByPreview.set(preview, grantId);
	}

	resolveGrantId(preview: string): string | undefined {
		return this.issuedGrantsByPreview.get(preview);
	}

	forgetGrant(preview: string): void {
		this.issuedGrantsByPreview.delete(preview);
	}

	refresh(): Promise<void> {
		if (this.loading) {
			this.pendingReload = true;
			return this.loading;
		}
		this.loading = this.load().finally(() => {
			this.loading = undefined;
			if (this.pendingReload) {
				this.pendingReload = false;
				void this.refresh();
			}
		});
		return this.loading;
	}

	private async load(): Promise<void> {
		const graph = this.host.getGraph();
		const [skillsRes, blueprintsRes, recordRes, grantsRes] = await Promise.all([
			this.skills.length > 0
				? Promise.resolve(undefined)
				: this.host.callService<unknown>('listBuiltinSkills', {}),
			this.blueprints.length > 0
				? Promise.resolve(undefined)
				: this.host.callService<unknown>('getTopologyBlueprint', {}),
			graph
				? this.host.callService<unknown>('getLearningRecord', {
					workspaceId: graph.workspaceId,
					architectureId: graph.architectureId
				})
				: Promise.resolve(undefined),
			graph
				? this.host.callService<unknown>('listMcpGrants', {
					workspaceId: graph.workspaceId,
					architectureId: graph.architectureId
				})
				: this.host.callService<unknown>('listMcpGrants', {})
		]);

		if (skillsRes?.ok) {
			const parsed = parseSkillsList(skillsRes.value);
			if (parsed) {
				this.skills = parsed.skills;
				this.safetyNotice = parsed.safetyNotice;
			}
		}
		if (blueprintsRes?.ok) {
			const parsed = parseTopologyBlueprintList(blueprintsRes.value);
			if (parsed) {
				this.blueprints = parsed;
			}
		}
		if (!graph) {
			this.record = undefined;
		} else if (recordRes?.ok) {
			this.record = parseLearningRecord(recordRes.value);
		}
		if (grantsRes?.ok) {
			this.grants = parseMcpGrantsList(grantsRes.value) ?? [];
		}
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

type LearnTreeNode =
	| { readonly kind: 'section'; readonly section: 'task' | 'proposals' | 'skills' | 'blueprints' | 'agents' }
	| { readonly kind: 'requirement'; readonly id: string; readonly text: string; readonly addressed: boolean }
	| { readonly kind: 'proposal'; readonly proposal: ProposalDraft }
	| { readonly kind: 'skill'; readonly skill: PinnedSkill }
	| { readonly kind: 'blueprint'; readonly blueprint: TopologyBlueprintSummary }
	| { readonly kind: 'agentInfo'; readonly label: string; readonly description: string; readonly command?: string; readonly tab?: LearningStudioTab };

class CloudForgeLearnTreeProvider implements TreeDataProvider<LearnTreeNode>, Disposable {
	private readonly changeEmitter = new EventEmitter<LearnTreeNode | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly storeListener: Disposable;

	constructor(
		private readonly store: LearningStore,
		private readonly vscodeAgentEnabled: boolean
	) {
		this.storeListener = store.onDidChange(() => this.changeEmitter.fire(undefined));
	}

	getTreeItem(element: LearnTreeNode): TreeItem {
		switch (element.kind) {
			case 'section': {
				const pending = (this.store.record?.proposals ?? []).filter(p => p.status === 'pending').length;
				const activeGrants = this.store.grants.filter(g => g.active && !g.revoked).length;
				const reqs = this.store.record?.task?.requirements ?? [];
				const meta: Record<typeof element.section, { label: string; count: number; icon: string; expanded: boolean }> = {
					task: { label: this.store.record?.task?.title ?? l10n.t('Learning Task & Notes'), count: reqs.length, icon: 'checklist', expanded: reqs.length > 0 },
					proposals: { label: l10n.t('Pending Proposals'), count: pending, icon: 'git-pull-request', expanded: pending > 0 },
					skills: { label: l10n.t('Baked-in Skills'), count: this.store.skills.length, icon: 'book', expanded: false },
					blueprints: { label: l10n.t('Starter Blueprints'), count: this.store.blueprints.length, icon: 'layers', expanded: false },
					agents: { label: l10n.t('AI Agents & MCP'), count: activeGrants, icon: 'plug', expanded: false }
				};
				const cfg = meta[element.section];
				const item = new TreeItem(
					`${cfg.label} (${cfg.count})`,
					cfg.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed
				);
				item.iconPath = new ThemeIcon(cfg.icon);
				return item;
			}
			case 'requirement': {
				const item = new TreeItem(element.text, TreeItemCollapsibleState.None);
				item.description = element.addressed ? l10n.t('addressed') : l10n.t('open');
				item.iconPath = new ThemeIcon(element.addressed ? 'pass-filled' : 'circle-outline');
				item.command = { command: 'cloudforge.openLearningStudio', title: l10n.t('Open Learning Task'), arguments: ['task'] };
				return item;
			}
			case 'proposal': {
				const item = new TreeItem(element.proposal.title, TreeItemCollapsibleState.None);
				item.description = `${element.proposal.status} · ${element.proposal.files.length} file(s)`;
				item.tooltip = `${element.proposal.origin}: ${element.proposal.summary}`;
				item.iconPath = new ThemeIcon(element.proposal.status === 'pending' ? 'diff' : 'check');
				item.command = { command: 'cloudforge.openLearningStudio', title: l10n.t('Review Proposal'), arguments: ['proposals'] };
				return item;
			}
			case 'skill': {
				const item = new TreeItem(element.skill.id, TreeItemCollapsibleState.None);
				item.description = categoryLabel(element.skill.category);
				item.tooltip = element.skill.purpose;
				item.iconPath = new ThemeIcon('sparkle');
				item.command = { command: 'cloudforge.openLearningStudio', title: l10n.t('Inspect Skill'), arguments: ['skills', element.skill.category] };
				return item;
			}
			case 'blueprint': {
				const item = new TreeItem(element.blueprint.title, TreeItemCollapsibleState.None);
				item.description = `${element.blueprint.cloud} · ${element.blueprint.fileNames.length} files`;
				item.tooltip = element.blueprint.summary;
				item.iconPath = new ThemeIcon('symbol-structure');
				item.command = { command: 'cloudforge.openLearningStudio', title: l10n.t('Inspect Blueprint'), arguments: ['blueprints'] };
				return item;
			}
			case 'agentInfo': {
				const item = new TreeItem(element.label, TreeItemCollapsibleState.None);
				item.description = element.description;
				item.iconPath = new ThemeIcon('radio-tower');
				if (element.command) {
					item.command = {
						command: element.command,
						title: element.label,
						...(element.tab ? { arguments: [element.tab] } : {})
					};
				}
				return item;
			}
		}
	}

	getChildren(element?: LearnTreeNode): LearnTreeNode[] {
		if (!element) {
			return [
				{ kind: 'section', section: 'task' },
				{ kind: 'section', section: 'proposals' },
				{ kind: 'section', section: 'skills' },
				{ kind: 'section', section: 'blueprints' },
				{ kind: 'section', section: 'agents' }
			];
		}
		if (element.kind !== 'section') {
			return [];
		}
		switch (element.section) {
			case 'task': {
				const reqs = this.store.record?.task?.requirements ?? [];
				if (reqs.length === 0) {
					return [{
						kind: 'agentInfo',
						label: l10n.t('Create Learning Task & Notes…'),
						description: l10n.t('checklist & rationale'),
						command: 'cloudforge.openLearningStudio',
						tab: 'task'
					}];
				}
				return reqs.map(r => ({ kind: 'requirement', id: r.id, text: r.text, addressed: r.status === 'addressed' }));
			}
			case 'proposals':
				return (this.store.record?.proposals ?? []).map(proposal => ({ kind: 'proposal', proposal }));
			case 'skills':
				return this.store.skills.map(skill => ({ kind: 'skill', skill }));
			case 'blueprints':
				return this.store.blueprints.map(blueprint => ({ kind: 'blueprint', blueprint }));
			case 'agents': {
				const rows: LearnTreeNode[] = [
					{
						kind: 'agentInfo',
						label: l10n.t('VS Code Agent View'),
						description: this.vscodeAgentEnabled ? l10n.t('auto-discovered (cloudforge.mcp)') : l10n.t('unavailable'),
						command: 'cloudforge.openLearningStudio',
						tab: 'agents'
					},
					{
						kind: 'agentInfo',
						label: l10n.t('Copy Codex CLI / Claude Code Config…'),
						description: l10n.t('scoped MCP grant'),
						command: 'cloudforge.copyMcpConfig'
					}
				];
				for (const g of this.store.grants.filter(item => item.active && !item.revoked)) {
					rows.push({
						kind: 'agentInfo',
						label: `${g.clientLabel} (${g.grantIdPreview})`,
						description: g.displayName,
						command: 'cloudforge.openLearningStudio',
						tab: 'agents'
					});
				}
				return rows;
			}
		}
	}

	dispose(): void {
		this.storeListener.dispose();
		this.changeEmitter.dispose();
	}
}

export function activateLearning(context: ExtensionContext, host: LearningHost): void {
	const store = new LearningStore(host);
	const mcp = registerCloudForgeMcpProvider({
		callService: (method, params) => host.callService(method, params),
		getActiveScope: () => {
			const graph = host.getGraph();
			const name = host.architectureName();
			if (!graph || !name) {
				return undefined;
			}
			return {
				workspaceId: graph.workspaceId,
				architectureId: graph.architectureId,
				architectureName: name,
				sourceRevision: graph.sourceRevision
			};
		},
		onDidChangeScope: host.onDidChangeGraph,
		onDidChangeGrants: () => { void store.refresh(); }
	});

	const treeProvider = new CloudForgeLearnTreeProvider(store, mcp.enabled);
	const treeView = window.createTreeView('cloudforge.learn', { treeDataProvider: treeProvider });

	let panel: WebviewPanel | undefined;
	let activeTab: LearningStudioTab = 'proposals';
	let skillCategoryFilter: SkillCategory | 'all' = 'all';
	let statusMessage: string | undefined;

	function renderPanel(): void {
		if (!panel) {
			return;
		}
		const graph = host.getGraph();
		const nonce = randomBytes(16).toString('hex');
		panel.webview.html = buildLearningStudioHtml({
			architectureName: host.architectureName(),
			sourceRevision: graph?.sourceRevision,
			activeTab,
			skillCategoryFilter,
			record: store.record,
			skills: store.skills,
			safetyNotice: store.safetyNotice,
			blueprints: store.blueprints,
			grants: store.grants,
			vscodeAgentEnabled: mcp.enabled,
			statusMessage
		}, nonce);
	}

	async function copyExternalMcpConfig(preferredClient?: 'codex' | 'claude-code'): Promise<void> {
		const graph = host.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open a CloudForge architecture before issuing a scoped MCP grant.'));
			return;
		}
		let client = preferredClient;
		if (!client) {
			const picked = await window.showQuickPick(
				[
					{ label: 'Codex CLI (TOML)', description: '~/.codex/config.toml', client: 'codex' as const },
					{ label: 'Claude Code (JSON)', description: '.mcp.json / Claude MCP settings', client: 'claude-code' as const }
				],
				{ placeHolder: l10n.t('Choose an AI coding client for the scoped CloudForge MCP grant') }
			);
			if (!picked) {
				return;
			}
			client = picked.client;
		}
		const issued = await host.callService<unknown>('issueMcpGrant', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			clientLabel: client,
			ttlMinutes: 60
		});
		if (!issued.ok) {
			void window.showErrorMessage(l10n.t('Could not issue a scoped MCP grant ({0}).', issued.error.code));
			return;
		}
		const grant = parseIssuedMcpGrant(issued.value);
		if (!grant) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid MCP grant.'));
			return;
		}
		store.rememberIssuedGrant(grant.grantIdPreview, grant.grantId);
		const snippet = buildExternalMcpConfigSnippet(client, grant);
		await env.clipboard.writeText(snippet);
		statusMessage = l10n.t('Copied {0} MCP configuration ({1}, 60 min TTL) to clipboard.', client === 'codex' ? 'Codex CLI' : 'Claude Code', grant.grantIdPreview);
		await store.refresh();
		renderPanel();
		void window.showInformationMessage(statusMessage);
	}

	async function applyProposalGuarded(proposalId: string): Promise<void> {
		const graph = host.getGraph();
		const proposal = store.record?.proposals.find(p => p.proposalId === proposalId);
		if (!graph || !proposal) {
			return;
		}
		const preview = await host.callService<unknown>('previewFocusedSaveBatch', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			expectedSourceRevision: graph.sourceRevision,
			files: proposal.files.map(file => ({
				fileName: file.fileName,
				contents: file.contents
			}))
		});
		if (!preview.ok || !isRecord(preview.value) || typeof preview.value.previewToken !== 'string') {
			const code = preview.ok ? 'SERVICE_ERROR' : preview.error.code;
			void window.showErrorMessage(l10n.t('Proposal save preview failed ({0}). Refresh the architecture and try again.', code));
			return;
		}
		const fileList = proposal.files.map(f => f.fileName).join(', ');
		const warning = proposal.findings.length > 0
			? l10n.t(' Warning: {0} sensitive literal finding(s) were flagged in this proposal.', proposal.findings.length)
			: '';
		const confirmAction = l10n.t('Apply Proposal Changes');
		const choice = await window.showWarningMessage(
			l10n.t('Apply "{0}" to {1} ({2})?{3}', proposal.title, host.architectureName() ?? 'architecture', fileList, warning),
			{ modal: true },
			confirmAction
		);
		if (choice !== confirmAction) {
			return;
		}
		// Mark accepted while the live source revision still matches baseSourceRevision
		// (before applyFocusedSaveBatch advances the revision on disk).
		const accepted = await host.callService<unknown>('reviewProposal', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			proposalId: proposal.proposalId,
			action: 'markAccepted'
		});
		if (!accepted.ok) {
			const msg = accepted.error.code === 'STALE_SOURCE'
				? l10n.t('The Terraform source changed while reviewing this proposal. Refresh the architecture before applying.')
				: l10n.t('Could not accept proposal ({0}).', accepted.error.code);
			void window.showErrorMessage(msg);
			await store.refresh();
			renderPanel();
			return;
		}
		const applied = await host.callService<unknown>('applyFocusedSaveBatch', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			expectedSourceRevision: graph.sourceRevision,
			previewToken: preview.value.previewToken
		});
		if (!applied.ok) {
			void window.showErrorMessage(l10n.t('Applying proposal changes failed ({0}).', applied.error.code));
			await store.refresh();
			renderPanel();
			return;
		}
		statusMessage = l10n.t('Applied "{0}" ({1} file(s)).', proposal.title, proposal.files.length);
		await host.reloadActiveArchitecture();
		await store.refresh();
		renderPanel();
	}

	async function rejectProposal(proposalId: string): Promise<void> {
		const graph = host.getGraph();
		if (!graph) {
			return;
		}
		const reviewed = await host.callService<unknown>('reviewProposal', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			proposalId,
			action: 'reject'
		});
		if (!reviewed.ok) {
			void window.showErrorMessage(l10n.t('Could not reject proposal ({0}).', reviewed.error.code));
			return;
		}
		statusMessage = l10n.t('Proposal rejected.');
		await store.refresh();
		renderPanel();
	}

	async function proposeBlueprint(blueprintId: string, prefix?: string, region?: string, cidrBaseOctet?: number): Promise<void> {
		const graph = host.getGraph();
		if (!graph) {
			void window.showInformationMessage(l10n.t('Open a CloudForge architecture before proposing a blueprint.'));
			return;
		}
		const bpRes = await host.callService<unknown>('getTopologyBlueprint', {
			blueprintId,
			...(prefix ? { prefix } : {}),
			...(region ? { region } : {}),
			...(cidrBaseOctet !== undefined ? { cidrBaseOctet } : {})
		});
		if (!bpRes.ok) {
			void window.showErrorMessage(l10n.t('Could not load blueprint ({0}).', bpRes.error.code));
			return;
		}
		const blueprint = parseTopologyBlueprint(bpRes.value);
		if (!blueprint) {
			void window.showErrorMessage(l10n.t('The CloudForge service returned an invalid topology blueprint.'));
			return;
		}
		const submitted = await host.callService<unknown>('submitProposal', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			origin: 'blueprint',
			title: blueprint.title,
			summary: blueprint.summary,
			baseSourceRevision: graph.sourceRevision,
			skillIds: [...blueprint.skillIds],
			files: blueprint.files.map(file => ({
				fileName: file.fileName,
				contents: file.contents,
				rationale: file.rationale
			}))
		});
		if (!submitted.ok) {
			const msg = submitted.error.code === 'SCOPE_DENIED'
				? l10n.t('Imported repositories are read-only and cannot accept proposals.')
				: l10n.t('Could not submit blueprint proposal ({0}).', submitted.error.code);
			void window.showErrorMessage(msg);
			return;
		}
		activeTab = 'proposals';
		statusMessage = l10n.t('Created reviewable proposal for "{0}" ({1} files). Review and apply when ready.', blueprint.title, blueprint.files.length);
		await store.refresh();
		renderPanel();
	}

	async function saveTaskFromStudio(title: string, mode: LearningMode, objective: string, newRequirement?: string): Promise<void> {
		const graph = host.getGraph();
		if (!graph) {
			return;
		}
		const existing = store.record?.task;
		const requirements = [...(existing?.requirements ?? [])];
		if (newRequirement) {
			requirements.push({
				id: `req-${requirements.length + 1}`,
				text: newRequirement,
				status: 'open',
				linkedAddresses: []
			});
		}
		const saved = await host.callService<unknown>('saveLearningRecord', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			task: {
				title,
				mode,
				objective,
				requirements,
				assumptions: [...(existing?.assumptions ?? [])],
				skillIds: [...(existing?.skillIds ?? [])]
			}
		});
		if (!saved.ok) {
			void window.showErrorMessage(l10n.t('Could not save learning task ({0}).', saved.error.code));
			return;
		}
		statusMessage = l10n.t('Saved learning task "{0}".', title);
		await store.refresh();
		renderPanel();
	}

	async function toggleRequirementStatus(requirementId: string): Promise<void> {
		const graph = host.getGraph();
		const task = store.record?.task;
		if (!graph || !task) {
			return;
		}
		const requirements = task.requirements.map(req => req.id === requirementId
			? { ...req, status: req.status === 'addressed' ? 'open' : 'addressed' }
			: req
		);
		const saved = await host.callService<unknown>('saveLearningRecord', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			task: {
				title: task.title,
				mode: task.mode,
				objective: task.objective,
				requirements,
				assumptions: [...task.assumptions],
				skillIds: [...task.skillIds]
			}
		});
		if (!saved.ok) {
			void window.showErrorMessage(l10n.t('Could not update requirement ({0}).', saved.error.code));
			return;
		}
		await store.refresh();
		renderPanel();
	}

	async function saveResourceNoteFromStudio(address: string, why?: string, userNote?: string, docLabel?: string, docUrl?: string): Promise<void> {
		const graph = host.getGraph();
		if (!graph) {
			return;
		}
		const currentNotes = store.record?.notes ?? {};
		const existing = currentNotes[address];
		const docs = [...(existing?.docs ?? [])];
		if (docLabel && docUrl) {
			docs.push({ label: docLabel, url: docUrl });
		}
		const nextNotes: Record<string, unknown> = {
			...currentNotes,
			[address]: {
				...(why ? { why } : existing?.why ? { why: existing.why } : {}),
				...(userNote ? { userNote } : existing?.userNote ? { userNote: existing.userNote } : {}),
				docs
			}
		};
		const saved = await host.callService<unknown>('saveLearningRecord', {
			workspaceId: graph.workspaceId,
			architectureId: graph.architectureId,
			notes: nextNotes
		});
		if (!saved.ok) {
			const msg = saved.error.code === 'INVALID_PARAMS'
				? l10n.t('Could not save resource note. Check that documentation links use an allowlisted HTTPS domain (registry.terraform.io, learn.microsoft.com, docs.aws.amazon.com, cloud.google.com, developer.hashicorp.com, opentofu.org).')
				: l10n.t('Could not save resource note ({0}).', saved.error.code);
			void window.showErrorMessage(msg);
			return;
		}
		statusMessage = l10n.t('Saved note on {0}.', address);
		await store.refresh();
		renderPanel();
	}

	async function revokeGrantByPreview(grantIdPreview: string): Promise<void> {
		const fullId = store.resolveGrantId(grantIdPreview);
		const grantId = fullId ?? await window.showInputBox({
			title: l10n.t('Revoke MCP Grant'),
			prompt: l10n.t('Paste the full MCP grant ID ({0}) to revoke it immediately.', grantIdPreview),
			placeHolder: 'cfmcp-...'
		});
		if (!grantId) {
			return;
		}
		const revoked = await host.callService<unknown>('revokeMcpGrant', { grantId: grantId.trim() });
		if (!revoked.ok) {
			void window.showErrorMessage(l10n.t('Could not revoke MCP grant ({0}).', revoked.error.code));
			return;
		}
		store.forgetGrant(grantIdPreview);
		statusMessage = l10n.t('Revoked MCP grant {0}. Connected agents will fail closed.', grantIdPreview);
		await store.refresh();
		renderPanel();
	}

	function openLearningStudio(tab?: LearningStudioTab, category?: SkillCategory | 'all'): void {
		if (tab) {
			activeTab = tab;
		}
		if (category) {
			skillCategoryFilter = category;
		}
		if (panel) {
			panel.reveal(ViewColumn.Beside);
			void store.refresh().then(() => renderPanel());
			return;
		}
		panel = window.createWebviewPanel(
			'cloudforge.learningStudio',
			l10n.t('CloudForge Learning Studio'),
			ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: false }
		);
		panel.onDidDispose(() => { panel = undefined; });
		panel.webview.onDidReceiveMessage(raw => {
			const msg = parseLearningStudioMessage(raw);
			if (!msg) {
				return;
			}
			switch (msg.type) {
				case 'switchTab':
					activeTab = msg.tab;
					statusMessage = undefined;
					renderPanel();
					break;
				case 'filterSkills':
					skillCategoryFilter = msg.category;
					renderPanel();
					break;
				case 'applyProposal':
					void applyProposalGuarded(msg.proposalId);
					break;
				case 'rejectProposal':
					void rejectProposal(msg.proposalId);
					break;
				case 'proposeBlueprint':
					void proposeBlueprint(msg.blueprintId, msg.prefix, msg.region, msg.cidrBaseOctet);
					break;
				case 'saveTask':
					void saveTaskFromStudio(msg.title, msg.mode, msg.objective, msg.newRequirement);
					break;
				case 'toggleRequirement':
					void toggleRequirementStatus(msg.requirementId);
					break;
				case 'saveNote':
					void saveResourceNoteFromStudio(msg.address, msg.why, msg.userNote, msg.docLabel, msg.docUrl);
					break;
				case 'copyMcpConfig':
					void copyExternalMcpConfig(msg.client);
					break;
				case 'revokeGrant':
					void revokeGrantByPreview(msg.grantIdPreview);
					break;
				case 'refresh':
					statusMessage = undefined;
					void store.refresh().then(() => renderPanel());
					break;
			}
		});
		renderPanel();
		void store.refresh().then(() => renderPanel());
	}

	const chatDisposable = registerCloudForgeChatParticipant({
		callService: (method, params) => host.callService(method, params),
		getActiveGraph: () => host.getGraph(),
		architectureName: () => host.architectureName(),
		vscodeAgentEnabled: () => mcp.enabled,
		refreshLearning: () => store.refresh()
	});

	context.subscriptions.push(
		store,
		mcp.disposable,
		chatDisposable,
		treeProvider,
		treeView,
		host.onDidChangeGraph(() => {
			void store.refresh().then(() => renderPanel());
		}),
		store.onDidChange(() => renderPanel()),
		commands.registerCommand('cloudforge.openLearningStudio', (tab?: LearningStudioTab, category?: SkillCategory | 'all') => {
			openLearningStudio(tab, category);
		}),
		commands.registerCommand('cloudforge.refreshLearning', async () => {
			await store.refresh();
			renderPanel();
		}),
		commands.registerCommand('cloudforge.copyMcpConfig', async () => {
			await copyExternalMcpConfig();
		}),
		commands.registerCommand('cloudforge.revokeMcpGrants', async () => {
			await store.refresh();
			const active = store.grants.filter(g => g.active && !g.revoked);
			if (active.length === 0) {
				void window.showInformationMessage(l10n.t('There are no active CloudForge MCP grants to revoke.'));
				return;
			}
			const picked = await window.showQuickPick(
				active.map(g => ({ label: g.grantIdPreview, description: `${g.clientLabel} · ${g.displayName}`, grant: g })),
				{ placeHolder: l10n.t('Select an active MCP grant to revoke immediately') }
			);
			if (picked) {
				await revokeGrantByPreview(picked.grant.grantIdPreview);
			}
		})
	);

	// Load baked-in skills & blueprints once on activation so the sidebar is populated immediately.
	void store.refresh();
}
