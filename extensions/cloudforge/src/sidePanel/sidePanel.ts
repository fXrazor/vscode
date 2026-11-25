/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The CloudForge side panel (activity bar): Project Status, Terraform State and Cloud
// Connections views, plus the Project Status tab. Everything shown comes from redacted Rust
// summaries (`summarizeState`, `listCloudConnections`); keys typed here go straight to the
// service, which writes them to Windows Credential Manager and never returns them.

import { randomBytes } from 'node:crypto';
import {
	commands, EventEmitter, l10n, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, ViewColumn, window,
	type Disposable, type Event, type ExtensionContext, type TreeDataProvider, type WebviewPanel,
} from 'vscode';
import {
	buildStatusHtml, CLOUD_PROVIDERS, describeConnection, describeState, parseCloudConnections, parseStateSummary, parseStatusPageMessage, providerLabel, providersInUse, stateDrift,
	type CloudConnection, type CloudProvider, type StateSummary,
} from './model';

type ServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } };

export interface SidePanelGraphNode {
	readonly id: string;
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
}

export interface SidePanelGraph {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly nodes: readonly SidePanelGraphNode[];
	readonly diagnostics: readonly { readonly severity: string }[];
}

export interface SidePanelHost {
	callService<T>(method: string, params: Record<string, unknown>): Promise<ServiceResult<T>>;
	getGraph(): SidePanelGraph | undefined;
	readonly onDidChangeGraph: Event<unknown>;
	architectureName(): string | undefined;
	projectName(): string | undefined;
	/** Workspace of the open project when no architecture graph is loaded yet. */
	projectWorkspaceId(): string | undefined;
	readonly onDidChangeProject: Event<void>;
	openNodeSource(graph: SidePanelGraph, nodeId: string): Promise<unknown>;
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function nodeAddress(node: SidePanelGraphNode): string | undefined {
	if (!node.resourceType) {
		return node.kind === 'module' ? `module.${node.name}` : undefined;
	}
	return node.kind === 'data' ? `data.${node.resourceType}.${node.name}` : `${node.resourceType}.${node.name}`;
}

function countSeverity(graph: SidePanelGraph | undefined, severity: 'error' | 'warning'): number {
	return graph?.diagnostics.filter(item => item.severity.toLowerCase().startsWith(severity === 'error' ? 'error' : 'warn')).length ?? 0;
}

/** The loaded summaries for the active workspace and architecture. */
class SidePanelData implements Disposable {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;
	state: StateSummary | undefined;
	stateError: string | undefined;
	connections: CloudConnection[] | undefined;
	private loading: Promise<void> | undefined;
	private again = false;

	constructor(private readonly host: SidePanelHost) { }

	workspaceId(): string | undefined {
		return this.host.getGraph()?.workspaceId ?? this.host.projectWorkspaceId();
	}

	refresh(): Promise<void> {
		if (this.loading) {
			this.again = true;
			return this.loading;
		}
		this.loading = this.load().finally(() => {
			this.loading = undefined;
			if (this.again) {
				this.again = false;
				void this.refresh();
			}
		});
		return this.loading;
	}

	setConnections(value: unknown): void {
		this.connections = parseCloudConnections(value) ?? this.connections;
		this.changeEmitter.fire();
	}

	private async load(): Promise<void> {
		const graph = this.host.getGraph();
		const workspaceId = this.workspaceId();
		this.state = undefined;
		this.stateError = undefined;
		if (graph) {
			const result = await this.host.callService<unknown>('summarizeState', {
				workspaceId: graph.workspaceId, architectureId: graph.architectureId, expectedSourceRevision: graph.sourceRevision,
			});
			if (result.ok) {
				this.state = parseStateSummary(result.value);
				this.stateError = this.state ? undefined : l10n.t('The state summary was not readable.');
			} else {
				this.stateError = result.error.code === 'STALE_SOURCE'
					? l10n.t('The files changed. Refresh to read the state again.')
					: l10n.t('The state summary is not available ({0}).', result.error.code);
			}
		}
		if (workspaceId) {
			const result = await this.host.callService<unknown>('listCloudConnections', { workspaceId });
			this.connections = result.ok ? parseCloudConnections(result.value) : undefined;
		} else {
			this.connections = undefined;
		}
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

interface PanelNode {
	readonly id: string;
	readonly item: TreeItem;
	readonly children?: () => PanelNode[];
}

function leaf(id: string, label: string, options: { description?: string; icon?: string; color?: string; tooltip?: string; command?: TreeItem['command']; contextValue?: string } = {}): PanelNode {
	const item = new TreeItem(label, TreeItemCollapsibleState.None);
	item.id = id;
	item.description = options.description;
	item.tooltip = options.tooltip ?? (options.description ? `${label} · ${options.description}` : label);
	if (options.icon) {
		item.iconPath = new ThemeIcon(options.icon, options.color ? new ThemeColor(options.color) : undefined);
	}
	item.command = options.command;
	item.contextValue = options.contextValue;
	return { id, item };
}

function group(id: string, label: string, children: () => PanelNode[], options: { description?: string; icon?: string; expanded?: boolean } = {}): PanelNode {
	const item = new TreeItem(label, options.expanded === false ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.Expanded);
	item.id = id;
	item.description = options.description;
	if (options.icon) {
		item.iconPath = new ThemeIcon(options.icon);
	}
	return { id, item, children };
}

class PanelTree implements TreeDataProvider<PanelNode>, Disposable {
	private readonly changeEmitter = new EventEmitter<PanelNode | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly subscription: Disposable;

	constructor(data: SidePanelData, private readonly roots: () => PanelNode[]) {
		this.subscription = data.onDidChange(() => this.changeEmitter.fire(undefined));
	}

	getTreeItem(node: PanelNode): TreeItem {
		return node.item;
	}

	getChildren(node?: PanelNode): PanelNode[] {
		return node ? node.children?.() ?? [] : this.roots();
	}

	dispose(): void {
		this.subscription.dispose();
		this.changeEmitter.dispose();
	}
}

const connectionIcon = (provider: CloudProvider) => provider === 'azure' ? 'azure' : 'cloud';

export function activateSidePanel(context: ExtensionContext, host: SidePanelHost): void {
	const data = new SidePanelData(host);
	let statusPanel: WebviewPanel | undefined;

	const statusRoots = (): PanelNode[] => {
		const graph = host.getGraph();
		const nodes: PanelNode[] = [
			leaf('status.open', l10n.t('Open Project Status'), { icon: 'dashboard', command: { command: 'cloudforge.openProjectStatus', title: l10n.t('Open Project Status') } }),
		];
		const project = host.projectName();
		if (project) {
			nodes.push(leaf('status.project', l10n.t('Project'), { description: project, icon: 'folder-library' }));
		}
		if (!graph) {
			nodes.push(leaf('status.none', l10n.t('No architecture open'), { icon: 'circle-slash', command: { command: 'cloudforge.openWorkspace', title: l10n.t('Open Workspace') } }));
			return nodes;
		}
		const errors = countSeverity(graph, 'error');
		const warnings = countSeverity(graph, 'warning');
		nodes.push(
			leaf('status.architecture', l10n.t('Architecture'), { description: `${host.architectureName() ?? ''} · rev ${graph.sourceRevision.slice(0, 8)}`, icon: 'type-hierarchy', command: { command: 'cloudforge.openCanvas', title: l10n.t('Open Canvas') } }),
			leaf('status.resources', l10n.t('Resources'), { description: String(graph.nodes.length), icon: 'symbol-class' }),
			leaf('status.checks', l10n.t('Checks'), {
				description: l10n.t('{0} errors · {1} warnings', errors, warnings),
				icon: errors ? 'error' : warnings ? 'warning' : 'pass',
				color: errors ? 'problemsErrorIcon.foreground' : warnings ? 'problemsWarningIcon.foreground' : 'testing.iconPassed',
				command: { command: 'workbench.actions.view.problems', title: l10n.t('Show Problems') },
			}),
		);
		if (data.state) {
			nodes.push(leaf('status.state', l10n.t('State'), { description: describeState(data.state), icon: 'database', command: { command: 'cloudforge.state.focus', title: l10n.t('Show Terraform State') } }));
		} else if (data.stateError) {
			nodes.push(leaf('status.state', l10n.t('State'), { description: data.stateError, icon: 'database' }));
		}
		const used = providersInUse(graph.nodes.map(node => node.resourceType));
		for (const connection of data.connections ?? []) {
			if (!used.includes(connection.provider)) {
				continue;
			}
			nodes.push(leaf(`status.connection.${connection.provider}`, providerLabel(connection.provider), {
				description: describeConnection(connection),
				icon: connection.linked ? 'plug' : 'debug-disconnect',
				color: connection.linked ? undefined : 'problemsWarningIcon.foreground',
				command: { command: connection.linked ? 'cloudforge.connections.focus' : 'cloudforge.linkCloudConnection', title: l10n.t('Link'), arguments: connection.linked ? [] : [connection.provider] },
			}));
		}
		return nodes;
	};

	const stateRoots = (): PanelNode[] => {
		const graph = host.getGraph();
		const state = data.state;
		if (!graph) {
			return [leaf('state.none', l10n.t('Open an architecture to read its state'), { icon: 'info' })];
		}
		if (!state) {
			return [leaf('state.error', data.stateError ?? l10n.t('Reading state…'), { icon: data.stateError ? 'warning' : 'loading~spin' })];
		}
		const byAddress = new Map(graph.nodes.map(node => [nodeAddress(node), node]));
		const roots: PanelNode[] = [
			leaf('state.backend', l10n.t('Backend'), {
				description: `${state.backend.type}${state.backend.declared ? '' : l10n.t(' (default)')}${state.backend.conflict ? l10n.t(' · more than one block') : ''}`,
				icon: 'server-environment',
				tooltip: state.backend.settings.length ? l10n.t('Settings (names only): {0}', state.backend.settings.join(', ')) : undefined,
			}),
		];
		if (state.initializedBackend && !state.initializedBackend.matchesConfiguration) {
			roots.push(leaf('state.init', l10n.t('Initialized backend differs'), { description: state.initializedBackend.type ?? 'local', icon: 'warning', color: 'problemsWarningIcon.foreground', tooltip: l10n.t('The backend changed since terraform init. Run init before plan.') }));
		}
		if (state.workspaces.length) {
			roots.push(group('state.workspaces', l10n.t('Workspaces'), () => state.workspaces.map(name => leaf(`state.workspace.${name}`, name, { icon: 'layers' })), { description: String(state.workspaces.length), expanded: false }));
		}
		const local = state.localState;
		if (!local.present) {
			roots.push(leaf('state.local', l10n.t('No local state file'), { icon: 'info', tooltip: l10n.t('Remote state is not read. CloudForge shows only state stored in this architecture folder.') }));
			return roots;
		}
		if (!local.readable) {
			roots.push(leaf('state.local', l10n.t('terraform.tfstate could not be read'), { icon: 'warning' }));
			return roots;
		}
		const drift = stateDrift(state, graph.nodes.map(nodeAddress).filter((address): address is string => !!address));
		roots.push(
			leaf('state.serial', l10n.t('Local state'), { description: `serial ${local.serial ?? '?'}${local.terraformVersion ? ` · Terraform ${local.terraformVersion}` : ''}`, icon: 'database' }),
			group('state.resources', l10n.t('Resources in state'), () => local.resources.map(resource => {
				const node = byAddress.get(resource.address);
				return leaf(`state.resource.${resource.address}`, resource.address, {
					description: resource.instances === 1 ? resource.provider : `${resource.instances} instances · ${resource.provider}`,
					icon: resource.mode === 'data' ? 'symbol-interface' : 'symbol-class',
					command: node ? { command: 'cloudforge.revealStateResource', title: l10n.t('Open Source'), arguments: [node.id] } : undefined,
				});
			}), { description: String(local.resources.length) + (local.truncated ? '+' : '') }),
		);
		if (local.outputs.length) {
			roots.push(group('state.outputs', l10n.t('Outputs'), () => local.outputs.map(output => leaf(`state.output.${output.name}`, output.name, { icon: output.sensitive ? 'lock' : 'symbol-constant', description: output.sensitive ? l10n.t('sensitive') : undefined })), { description: String(local.outputs.length), expanded: false }));
		}
		if (drift.onlyInState.length || drift.notInState.length) {
			roots.push(group('state.drift', l10n.t('Differences from configuration'), () => [
				...drift.onlyInState.map(address => leaf(`state.drift.only.${address}`, address, { description: l10n.t('in state, removed from files'), icon: 'diff-removed' })),
				...drift.notInState.map(address => leaf(`state.drift.new.${address}`, address, { description: l10n.t('in files, not yet applied'), icon: 'diff-added' })),
			], { description: String(drift.onlyInState.length + drift.notInState.length) }));
		}
		return roots;
	};

	const connectionRoots = (): PanelNode[] => {
		if (!data.workspaceId()) {
			return [leaf('connections.none', l10n.t('Open a project to link cloud accounts'), { icon: 'info' })];
		}
		if (!data.connections) {
			return [leaf('connections.loading', l10n.t('Loading…'), { icon: 'loading~spin' })];
		}
		const used = providersInUse(host.getGraph()?.nodes.map(node => node.resourceType) ?? []);
		return data.connections.map(connection => leaf(`connections.${connection.provider}`, providerLabel(connection.provider), {
			description: describeConnection(connection),
			icon: connectionIcon(connection.provider),
			color: !connection.linked && used.includes(connection.provider) ? 'problemsWarningIcon.foreground' : undefined,
			tooltip: [
				l10n.t('Sign-in: {0}{1}', connection.signIn, connection.cliFound ? '' : l10n.t(' (not found on PATH)')),
				connection.linked ? describeConnection(connection) : l10n.t('Not linked to this project'),
				connection.keyStored ? l10n.t('A key is stored in Windows Credential Manager.') : '',
			].filter(Boolean).join('\n'),
			contextValue: `cloudforge.connection.${connection.provider}.${connection.linked ? 'linked' : 'unlinked'}${connection.keyStored ? '.key' : ''}`,
			command: connection.linked ? undefined : { command: 'cloudforge.linkCloudConnection', title: l10n.t('Link'), arguments: [connection.provider] },
		}));
	};

	const statusTree = new PanelTree(data, statusRoots);
	const stateTree = new PanelTree(data, stateRoots);
	const connectionTree = new PanelTree(data, connectionRoots);

	const renderStatusPanel = () => {
		if (!statusPanel) {
			return;
		}
		const graph = host.getGraph();
		statusPanel.webview.html = buildStatusHtml({
			projectName: host.projectName(),
			architectureName: graph ? host.architectureName() : undefined,
			sourceRevision: graph?.sourceRevision,
			resourceCount: graph?.nodes.length ?? 0,
			errorCount: countSeverity(graph, 'error'),
			warningCount: countSeverity(graph, 'warning'),
			declaredAddresses: graph?.nodes.map(nodeAddress).filter((address): address is string => !!address) ?? [],
			providersInUse: providersInUse(graph?.nodes.map(node => node.resourceType) ?? []),
			state: data.state,
			stateError: data.stateError,
			connections: data.connections,
		}, randomBytes(16).toString('base64'), statusPanel.webview.cspSource);
	};

	const pickProvider = async (value: unknown): Promise<CloudProvider | undefined> => {
		const fromNode = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : value;
		const direct = typeof fromNode === 'string' ? CLOUD_PROVIDERS.find(provider => fromNode === provider || fromNode === `connections.${provider}`) : undefined;
		if (direct) {
			return direct;
		}
		const picked = await window.showQuickPick(CLOUD_PROVIDERS.map(provider => ({ label: providerLabel(provider), provider })), { title: l10n.t('Cloud provider') });
		return picked?.provider;
	};

	const ask = (title: string, prompt: string, options: { value?: string; password?: boolean; optional?: boolean; validate?: (value: string) => boolean; invalid?: string } = {}) =>
		window.showInputBox({
			title, prompt, value: options.value, password: options.password, ignoreFocusOut: true,
			validateInput: value => {
				const trimmed = value.trim();
				if (!trimmed) {
					return options.optional ? undefined : l10n.t('Required.');
				}
				return options.validate && !options.validate(trimmed) ? options.invalid ?? l10n.t('Not valid.') : undefined;
			},
		}).then(value => value?.trim());

	const linkConnection = async (value?: unknown) => {
		const workspaceId = data.workspaceId();
		if (!workspaceId) {
			void window.showInformationMessage(l10n.t('Open a CloudForge project before linking a cloud account.'));
			return;
		}
		const provider = await pickProvider(value);
		if (!provider) {
			return;
		}
		const existing = data.connections?.find(connection => connection.provider === provider)?.binding ?? {};
		const title = l10n.t('Link {0} to this project', providerLabel(provider));
		let binding: Record<string, string> | undefined;
		if (provider === 'azure') {
			const cloud = await window.showQuickPick(['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud'], { title, placeHolder: l10n.t('Azure cloud (sign in first with az login)') });
			const tenantId = cloud && await ask(title, l10n.t('Tenant ID (from az account show)'), { validate: id => GUID.test(id), invalid: l10n.t('Enter a GUID.') });
			const subscriptionId = tenantId && await ask(title, l10n.t('Subscription ID'), { validate: id => GUID.test(id), invalid: l10n.t('Enter a GUID.') });
			if (!cloud || !tenantId || !subscriptionId) {
				return;
			}
			const clientId = await ask(title, l10n.t('Service principal client ID (optional; leave empty to use your Azure CLI sign-in)'), { optional: true, validate: id => GUID.test(id), invalid: l10n.t('Enter a GUID.') });
			if (clientId === undefined) {
				return;
			}
			const label = await ask(title, l10n.t('Label (optional, for example Production)'), { value: existing.label, optional: true });
			binding = { cloud, tenantId, subscriptionId, ...(clientId ? { clientId } : {}), ...(label ? { label } : {}) };
		} else if (provider === 'aws') {
			const profile = await ask(title, l10n.t('AWS CLI profile (from aws configure or aws configure sso)'), { value: existing.profile ?? 'default', validate: name => /^[A-Za-z0-9_.-]{1,64}$/.test(name) });
			const region = profile && await ask(title, l10n.t('Default region (optional, for example eu-west-2)'), { value: existing.region, optional: true, validate: name => /^[a-z0-9-]{2,32}$/.test(name) });
			if (!profile || region === undefined) {
				return;
			}
			const label = await ask(title, l10n.t('Label (optional)'), { value: existing.label, optional: true });
			binding = { profile, ...(region ? { region } : {}), ...(label ? { label } : {}) };
		} else {
			const projectId = await ask(title, l10n.t('Google Cloud project ID (sign in first with gcloud auth application-default login)'), { value: existing.projectId, validate: id => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id), invalid: l10n.t('Use the project ID, not its name.') });
			const configuration = projectId && await ask(title, l10n.t('gcloud configuration (optional)'), { value: existing.configuration, optional: true, validate: name => /^[A-Za-z0-9_-]{1,64}$/.test(name) });
			const region = configuration !== undefined && projectId ? await ask(title, l10n.t('Default region (optional, for example europe-west2)'), { value: existing.region, optional: true, validate: name => /^[a-z0-9-]{2,32}$/.test(name) }) : undefined;
			if (!projectId || configuration === undefined || region === undefined) {
				return;
			}
			const label = await ask(title, l10n.t('Label (optional)'), { value: existing.label, optional: true });
			binding = { projectId, ...(configuration ? { configuration } : {}), ...(region ? { region } : {}), ...(label ? { label } : {}) };
		}
		const result = await host.callService<unknown>('setCloudConnection', { workspaceId, provider, binding });
		if (!result.ok) {
			void window.showErrorMessage(l10n.t('CloudForge could not link {0} ({1}).', providerLabel(provider), result.error.code));
			return;
		}
		data.setConnections(result.value);
		void window.showInformationMessage(l10n.t('{0} is linked to this project. Sign-in stays with {1}.', providerLabel(provider), data.connections?.find(item => item.provider === provider)?.signIn ?? providerLabel(provider)));
	};

	const storeKey = async (value?: unknown) => {
		const workspaceId = data.workspaceId();
		const provider = workspaceId ? await pickProvider(value) : undefined;
		if (!workspaceId || !provider) {
			return;
		}
		if (provider === 'google') {
			void window.showInformationMessage(l10n.t('Google Cloud uses gcloud sign-in (gcloud auth application-default login). CloudForge does not store Google keys yet.'));
			return;
		}
		const title = l10n.t('Store a {0} key in Windows Credential Manager', providerLabel(provider));
		let key: Record<string, string> | undefined;
		if (provider === 'azure') {
			const clientSecret = await ask(title, l10n.t('Service principal client secret. It is stored once and never shown again.'), { password: true, validate: secret => secret.length >= 8 && secret.length <= 256 });
			key = clientSecret ? { clientSecret } : undefined;
		} else {
			const accessKeyId = await ask(title, l10n.t('AWS access key ID'), { validate: id => /^(AKIA|ASIA)[A-Z0-9]{12,124}$/.test(id) });
			const secretAccessKey = accessKeyId && await ask(title, l10n.t('AWS secret access key. It is stored once and never shown again.'), { password: true, validate: secret => secret.length >= 16 && secret.length <= 128 });
			key = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
		}
		if (!key) {
			return;
		}
		const result = await host.callService<unknown>('storeCloudKey', { workspaceId, provider, key });
		key = undefined;
		if (!result.ok) {
			void window.showErrorMessage(result.error.code === 'INVALID_STATE'
				? l10n.t('Link {0} to this project before storing a key.', providerLabel(provider))
				: l10n.t('The key was not stored ({0}).', result.error.code));
			return;
		}
		data.setConnections(result.value);
		void window.showInformationMessage(l10n.t('The {0} key is stored in Windows Credential Manager for this project.', providerLabel(provider)));
	};

	const removeConnection = async (value?: unknown, keyOnly = false) => {
		const workspaceId = data.workspaceId();
		const provider = workspaceId ? await pickProvider(value) : undefined;
		if (!workspaceId || !provider) {
			return;
		}
		const confirm = keyOnly ? l10n.t('Delete Key') : l10n.t('Unlink');
		const choice = await window.showWarningMessage(
			keyOnly
				? l10n.t('Delete the stored {0} key for this project from Windows Credential Manager?', providerLabel(provider))
				: l10n.t('Unlink {0} from this project? Any stored key is deleted too. Your CLI sign-in is not affected.', providerLabel(provider)),
			{ modal: true }, confirm);
		if (choice !== confirm) {
			return;
		}
		const result = await host.callService<unknown>('removeCloudConnection', { workspaceId, provider, ...(keyOnly ? { keyOnly: true } : {}) });
		if (!result.ok) {
			void window.showErrorMessage(l10n.t('CloudForge could not update the connection ({0}).', result.error.code));
			return;
		}
		data.setConnections(result.value);
	};

	const openStatus = () => {
		if (statusPanel) {
			statusPanel.reveal();
			renderStatusPanel();
			return;
		}
		statusPanel = window.createWebviewPanel('cloudforge.projectStatus', l10n.t('Project Status'), ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [] });
		statusPanel.iconPath = new ThemeIcon('dashboard');
		statusPanel.onDidDispose(() => { statusPanel = undefined; });
		statusPanel.webview.onDidReceiveMessage(raw => {
			const message = parseStatusPageMessage(raw);
			switch (message?.type) {
				case 'openCanvas': void commands.executeCommand('cloudforge.openCanvas'); break;
				case 'validate': void commands.executeCommand('cloudforge.validateArchitecture'); break;
				case 'refresh': void data.refresh(); break;
				case 'linkConnection': void linkConnection(message.provider); break;
				case 'storeKey': void storeKey(message.provider); break;
			}
		});
		renderStatusPanel();
		void data.refresh();
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	const scheduleRefresh = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void data.refresh(), 150);
	};

	context.subscriptions.push(
		data, statusTree, stateTree, connectionTree,
		window.registerTreeDataProvider('cloudforge.status', statusTree),
		window.registerTreeDataProvider('cloudforge.state', stateTree),
		window.registerTreeDataProvider('cloudforge.connections', connectionTree),
		data.onDidChange(renderStatusPanel),
		host.onDidChangeGraph(scheduleRefresh),
		host.onDidChangeProject(scheduleRefresh),
		{ dispose: () => clearTimeout(timer) },
		{ dispose: () => statusPanel?.dispose() },
		commands.registerCommand('cloudforge.openProjectStatus', openStatus),
		commands.registerCommand('cloudforge.refreshSidePanel', () => data.refresh()),
		commands.registerCommand('cloudforge.linkCloudConnection', linkConnection),
		commands.registerCommand('cloudforge.storeCloudKey', storeKey),
		commands.registerCommand('cloudforge.deleteCloudKey', (value?: unknown) => removeConnection(value, true)),
		commands.registerCommand('cloudforge.removeCloudConnection', (value?: unknown) => removeConnection(value)),
		commands.registerCommand('cloudforge.revealStateResource', (nodeId?: unknown) => {
			const graph = host.getGraph();
			return graph && typeof nodeId === 'string' && graph.nodes.some(node => node.id === nodeId) ? host.openNodeSource(graph, nodeId) : undefined;
		}),
	);
	scheduleRefresh();
}
