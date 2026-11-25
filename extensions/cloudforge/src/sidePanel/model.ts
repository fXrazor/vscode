/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Side panel view models: the Rust `summarizeState` and `listCloudConnections` results, checked
// and reduced to what the CloudForge side panel shows. No `vscode` imports, so it is unit tested.

export type CloudProvider = 'azure' | 'aws' | 'google';
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['azure', 'aws', 'google'];

export interface StateResource {
	readonly address: string;
	readonly mode: 'managed' | 'data';
	readonly type: string;
	readonly provider: string;
	readonly instances: number;
}

export interface StateSummary {
	readonly sourceRevision: string;
	readonly backend: { readonly type: string; readonly declared: boolean; readonly file?: string; readonly settings: readonly string[]; readonly conflict: boolean };
	readonly initializedBackend?: { readonly type?: string; readonly matchesConfiguration: boolean };
	readonly workspaces: readonly string[];
	readonly localState:
	| { readonly present: false }
	| { readonly present: true; readonly readable: false }
	| {
		readonly present: true;
		readonly readable: true;
		readonly terraformVersion?: string;
		readonly serial?: number;
		readonly resources: readonly StateResource[];
		readonly outputs: readonly { readonly name: string; readonly sensitive: boolean }[];
		readonly truncated: boolean;
	};
}

export interface CloudConnection {
	readonly provider: CloudProvider;
	readonly signIn: string;
	readonly cliFound: boolean;
	readonly linked: boolean;
	readonly keyStored: boolean;
	/** As the service shows it: GUIDs masked, names and labels as entered. */
	readonly binding?: Readonly<Record<string, string>>;
}

export type SignInStatus = 'ok' | 'mismatch' | 'notSignedIn' | 'noAccess' | 'expired' | 'noProfile' | 'failed' | 'cliMissing' | 'timedOut';
const SIGN_IN_STATUSES: readonly SignInStatus[] = ['ok', 'mismatch', 'notSignedIn', 'noAccess', 'expired', 'noProfile', 'failed', 'cliMissing', 'timedOut'];

/** The Rust `checkCloudSignIn` result: which account the provider CLI is signed in to, masked. */
export interface SignInCheck {
	readonly provider: CloudProvider;
	readonly status: SignInStatus;
	readonly detail: string;
	readonly signedInAs?: string;
	readonly accountType?: string;
	readonly targetName?: string;
	/** Seconds since the Unix epoch. */
	readonly checkedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 512): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function names(value: unknown, limit: number): string[] {
	return Array.isArray(value) ? value.map(item => text(item)).filter((item): item is string => !!item).slice(0, limit) : [];
}

function count(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function parseStateSummary(value: unknown): StateSummary | undefined {
	if (!isRecord(value) || !text(value.sourceRevision, 64) || !isRecord(value.backend) || !text(value.backend.type, 64) || !isRecord(value.localState)) {
		return undefined;
	}
	const backend = value.backend;
	const local = value.localState;
	let localState: StateSummary['localState'];
	if (local.present !== true) {
		localState = { present: false };
	} else if (local.readable !== true) {
		localState = { present: true, readable: false };
	} else {
		const resources: StateResource[] = [];
		for (const item of Array.isArray(local.resources) ? local.resources.slice(0, 2048) : []) {
			if (isRecord(item) && text(item.address) && (item.mode === 'managed' || item.mode === 'data') && text(item.type, 128)) {
				resources.push({ address: item.address as string, mode: item.mode, type: item.type as string, provider: text(item.provider, 128) ?? '', instances: count(item.instances) ?? 0 });
			}
		}
		const outputs = (Array.isArray(local.outputs) ? local.outputs.slice(0, 512) : [])
			.filter(isRecord)
			.filter(item => !!text(item.name))
			.map(item => ({ name: item.name as string, sensitive: item.sensitive === true }));
		localState = {
			present: true,
			readable: true,
			...(text(local.terraformVersion, 32) ? { terraformVersion: local.terraformVersion as string } : {}),
			...(count(local.serial) !== undefined ? { serial: count(local.serial) } : {}),
			resources,
			outputs,
			truncated: local.truncated === true,
		};
	}
	const initialized = isRecord(value.initializedBackend)
		? { ...(text(value.initializedBackend.type, 64) ? { type: value.initializedBackend.type as string } : {}), matchesConfiguration: value.initializedBackend.matchesConfiguration === true }
		: undefined;
	return {
		sourceRevision: value.sourceRevision as string,
		backend: {
			type: backend.type as string,
			declared: backend.declared === true,
			...(text(backend.file, 255) ? { file: backend.file as string } : {}),
			settings: names(backend.settings, 64),
			conflict: backend.conflict === true,
		},
		...(initialized ? { initializedBackend: initialized } : {}),
		workspaces: names(value.workspaces, 256),
		localState,
	};
}

export function parseCloudConnections(value: unknown): CloudConnection[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.connections)) {
		return undefined;
	}
	const rows: CloudConnection[] = [];
	for (const item of value.connections) {
		if (!isRecord(item) || !CLOUD_PROVIDERS.includes(item.provider as CloudProvider)) {
			continue;
		}
		const binding: Record<string, string> = {};
		if (isRecord(item.binding)) {
			for (const [key, entry] of Object.entries(item.binding).slice(0, 16)) {
				const shown = text(entry, 256);
				if (shown && /^[A-Za-z]{1,32}$/.test(key)) {
					binding[key] = shown;
				}
			}
		}
		rows.push({
			provider: item.provider as CloudProvider,
			signIn: text(item.signIn, 64) ?? '',
			cliFound: item.cliFound === true,
			linked: item.linked === true,
			keyStored: item.keyStored === true,
			...(item.linked === true ? { binding } : {}),
		});
	}
	return rows;
}

export function parseSignInCheck(value: unknown): SignInCheck | undefined {
	if (!isRecord(value) || !CLOUD_PROVIDERS.includes(value.provider as CloudProvider) || !SIGN_IN_STATUSES.includes(value.status as SignInStatus)) {
		return undefined;
	}
	const signedInAs = text(value.signedInAs, 128);
	const accountType = text(value.accountType, 32);
	const targetName = text(value.targetName, 128);
	return {
		provider: value.provider as CloudProvider,
		status: value.status as SignInStatus,
		detail: text(value.detail, 512) ?? '',
		...(signedInAs ? { signedInAs } : {}),
		...(accountType ? { accountType } : {}),
		...(targetName ? { targetName } : {}),
		...(count(value.checkedAt) !== undefined ? { checkedAt: count(value.checkedAt) } : {}),
	};
}

/** One account the signed-in CLI can use, from Rust `listCloudAccounts` (the link picker). */
export type CloudAccount =
	| { readonly provider: 'azure'; readonly subscriptionId: string; readonly tenantId: string; readonly name: string; readonly cloud: string; readonly isDefault: boolean }
	| { readonly provider: 'aws'; readonly profile: string }
	| { readonly provider: 'google'; readonly projectId: string; readonly name: string };

export interface CloudAccountList {
	readonly provider: CloudProvider;
	readonly status: 'ok' | 'notSignedIn' | 'failed' | 'cliMissing' | 'timedOut';
	readonly detail: string;
	readonly accounts: readonly CloudAccount[];
	readonly truncated: boolean;
}

const ACCOUNT_LIST_STATUSES = ['ok', 'notSignedIn', 'failed', 'cliMissing', 'timedOut'];
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AZURE_CLOUDS = ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud'];
const PROFILE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const GOOGLE_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function displayName(value: unknown, fallback: string): string {
	const name = text(value, 128);
	return name && !/[\u0000-\u001f\u007f]/.test(name) ? name : fallback;
}

/** Validates a `listCloudAccounts` result; entries that would not make a valid binding are dropped. */
export function parseCloudAccountList(value: unknown): CloudAccountList | undefined {
	if (!isRecord(value) || !CLOUD_PROVIDERS.includes(value.provider as CloudProvider) || !ACCOUNT_LIST_STATUSES.includes(value.status as string)) {
		return undefined;
	}
	const provider = value.provider as CloudProvider;
	const accounts: CloudAccount[] = [];
	for (const item of Array.isArray(value.accounts) ? value.accounts.slice(0, 200) : []) {
		if (!isRecord(item)) {
			continue;
		}
		if (provider === 'azure') {
			const subscriptionId = typeof item.subscriptionId === 'string' ? item.subscriptionId.toLowerCase() : '';
			const tenantId = typeof item.tenantId === 'string' ? item.tenantId.toLowerCase() : '';
			if (GUID_PATTERN.test(subscriptionId) && GUID_PATTERN.test(tenantId) && AZURE_CLOUDS.includes(item.cloud as string)) {
				accounts.push({ provider, subscriptionId, tenantId, name: displayName(item.name, subscriptionId), cloud: item.cloud as string, isDefault: item.isDefault === true });
			}
		} else if (provider === 'aws') {
			if (typeof item.profile === 'string' && PROFILE_PATTERN.test(item.profile)) {
				accounts.push({ provider, profile: item.profile });
			}
		} else if (typeof item.projectId === 'string' && GOOGLE_PROJECT_PATTERN.test(item.projectId)) {
			accounts.push({ provider, projectId: item.projectId, name: displayName(item.name, item.projectId) });
		}
	}
	return {
		provider,
		status: value.status as CloudAccountList['status'],
		detail: text(value.detail, 512) ?? '',
		accounts,
		truncated: value.truncated === true,
	};
}

/** Pick-list rows for the accounts, the CLI default (or the current link) first. */
export function cloudAccountPickItems(list: CloudAccountList, current: Readonly<Record<string, string>> = {}): { readonly label: string; readonly description: string; readonly account: CloudAccount }[] {
	const tail = (id: string) => '…' + id.slice(-4);
	const rows = list.accounts.map(account => {
		switch (account.provider) {
			case 'azure': {
				const linked = current.subscriptionId === account.subscriptionId;
				const notes = [`subscription ${tail(account.subscriptionId)}`, `tenant ${tail(account.tenantId)}`];
				if (account.cloud !== 'AzureCloud') {
					notes.push(account.cloud);
				}
				if (linked) {
					notes.push('linked now');
				} else if (account.isDefault) {
					notes.push('CLI default');
				}
				return { label: account.name, description: notes.join(' · '), account, rank: linked ? 0 : account.isDefault ? 1 : 2 };
			}
			case 'aws': {
				const linked = current.profile === account.profile;
				return { label: account.profile, description: linked ? 'linked now' : account.profile === 'default' ? 'default profile' : '', account, rank: linked ? 0 : account.profile === 'default' ? 1 : 2 };
			}
			default: {
				const linked = current.projectId === account.projectId;
				return { label: account.name, description: account.projectId + (linked ? ' · linked now' : ''), account, rank: linked ? 0 : 2 };
			}
		}
	});
	return rows
		.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
		.map(({ label, description, account }) => ({ label, description, account }));
}

/** Short words for a sign-in status, for tree rows and the status tab. */
export function signInLabel(status: SignInStatus): string {
	switch (status) {
		case 'ok': return 'Signed in';
		case 'mismatch': return 'Signed in elsewhere';
		case 'notSignedIn': return 'Not signed in';
		case 'noAccess': return 'No access';
		case 'expired': return 'Sign-in expired';
		case 'noProfile': return 'Profile missing';
		case 'cliMissing': return 'CLI not found';
		case 'timedOut': return 'No answer';
		default: return 'Check failed';
	}
}

/** One line for a finished check: the status, who is signed in, and the target name when known. */
export function describeSignInCheck(check: SignInCheck): string {
	const who = check.signedInAs ? ` as ${check.signedInAs}` : '';
	const target = check.targetName ? ` · ${check.targetName}` : '';
	return `${signInLabel(check.status)}${who}${target}`;
}

export function providerLabel(provider: CloudProvider): string {
	return provider === 'azure' ? 'Azure' : provider === 'aws' ? 'AWS' : 'Google Cloud';
}

/** One line that says which target a linked connection points at. */
export function describeConnection(connection: CloudConnection): string {
	if (!connection.linked || !connection.binding) {
		return connection.cliFound ? 'Not linked' : `Not linked · ${connection.signIn} not found`;
	}
	const b = connection.binding;
	const label = b.label ? `${b.label} · ` : '';
	const key = connection.keyStored ? ' · key stored' : '';
	switch (connection.provider) {
		case 'azure':
			return `${label}subscription ${b.subscriptionId ?? '?'}${b.cloud && b.cloud !== 'AzureCloud' ? ` (${b.cloud})` : ''}${key}`;
		case 'aws':
			return `${label}profile ${b.profile ?? '?'}${b.region ? ` · ${b.region}` : ''}${key}`;
		default:
			return `${label}project ${b.projectId ?? '?'}${b.region ? ` · ${b.region}` : ''}`;
	}
}

/** Short state line for the status view and status tab. */
export function describeState(state: StateSummary): string {
	const backend = state.backend.declared ? `${state.backend.type} backend` : 'local state (no backend block)';
	const init = state.initializedBackend && !state.initializedBackend.matchesConfiguration ? ' · run init: backend changed' : '';
	if (!state.localState.present) {
		return `${backend}${init}`;
	}
	if (!state.localState.readable) {
		return `${backend} · terraform.tfstate unreadable${init}`;
	}
	const serial = state.localState.serial !== undefined ? ` · serial ${state.localState.serial}` : '';
	return `${backend} · ${state.localState.resources.length} resources in state${serial}${init}`;
}

/** Which providers an architecture uses, from its graph's resource types. */
export function providersInUse(resourceTypes: readonly (string | null | undefined)[]): CloudProvider[] {
	const used = new Set<CloudProvider>();
	for (const type of resourceTypes) {
		if (!type) {
			continue;
		}
		if (type.startsWith('azurerm_') || type.startsWith('azapi_') || type.startsWith('azuread_')) {
			used.add('azure');
		} else if (type.startsWith('aws_')) {
			used.add('aws');
		} else if (type.startsWith('google_')) {
			used.add('google');
		}
	}
	return CLOUD_PROVIDERS.filter(provider => used.has(provider));
}

/** In-state resources the configuration no longer declares, and declared ones not yet in state. */
export function stateDrift(state: StateSummary, declared: readonly string[]): { readonly onlyInState: string[]; readonly notInState: string[] } {
	if (!state.localState.present || !state.localState.readable) {
		return { onlyInState: [], notInState: [] };
	}
	const inState = new Set(state.localState.resources.filter(resource => !resource.address.startsWith('module.')).map(resource => resource.address));
	const config = new Set(declared);
	return {
		onlyInState: [...inState].filter(address => !config.has(address)).sort(),
		notInState: [...config].filter(address => !inState.has(address)).sort(),
	};
}

// The Project Status tab: one page for the active project and architecture (graph, checks,
// Terraform state, cloud connections) with buttons that post back to the extension. Values come
// only from redacted service summaries.

export interface StatusPageInput {
	readonly projectName?: string;
	readonly architectureName?: string;
	readonly sourceRevision?: string;
	readonly resourceCount: number;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly declaredAddresses: readonly string[];
	readonly providersInUse: readonly CloudProvider[];
	readonly state?: StateSummary;
	readonly stateError?: string;
	readonly connections?: readonly CloudConnection[];
	/** The last sign-in check for each provider in this session, if any. */
	readonly signInChecks?: Partial<Readonly<Record<CloudProvider, SignInCheck>>>;
}

/** Messages the page may post; the extension accepts nothing else. */
export type StatusPageMessage =
	| { readonly type: 'openCanvas' }
	| { readonly type: 'validate' }
	| { readonly type: 'refresh' }
	| { readonly type: 'linkConnection'; readonly provider: CloudProvider }
	| { readonly type: 'storeKey'; readonly provider: CloudProvider }
	| { readonly type: 'checkSignIn'; readonly provider: CloudProvider };

export function parseStatusPageMessage(value: unknown): StatusPageMessage | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const message = value as { type?: unknown; provider?: unknown };
	switch (message.type) {
		case 'openCanvas':
		case 'validate':
		case 'refresh':
			return { type: message.type };
		case 'linkConnection':
		case 'storeKey':
		case 'checkSignIn':
			return message.provider === 'azure' || message.provider === 'aws' || message.provider === 'google'
				? { type: message.type, provider: message.provider }
				: undefined;
		default:
			return undefined;
	}
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!);
}

function card(title: string, body: string, actions = ''): string {
	return `<section class="card"><header><h2>${escapeHtml(title)}</h2>${actions}</header>${body}</section>`;
}

function list(items: readonly string[], empty: string, limit = 40): string {
	if (!items.length) {
		return `<p class="muted">${escapeHtml(empty)}</p>`;
	}
	const shown = items.slice(0, limit).map(item => `<li><code>${escapeHtml(item)}</code></li>`).join('');
	const more = items.length > limit ? `<li class="muted">and ${items.length - limit} more</li>` : '';
	return `<ul>${shown}${more}</ul>`;
}

export function buildStatusHtml(input: StatusPageInput, nonce: string, cspSource: string): string {
	const architecture = input.architectureName
		? card('Architecture', `
			<dl>
				<dt>Name</dt><dd>${escapeHtml(input.architectureName)}</dd>
				<dt>Revision</dt><dd><code>${escapeHtml((input.sourceRevision ?? '').slice(0, 12))}</code></dd>
				<dt>Resources</dt><dd>${input.resourceCount}</dd>
				<dt>Checks</dt><dd>${input.errorCount} errors · ${input.warningCount} warnings</dd>
			</dl>`, '<div class="actions"><button data-message="openCanvas">Open canvas</button><button data-message="validate">Run checks</button></div>')
		: card('Architecture', '<p class="muted">Open an architecture to see its status.</p>');

	let state = '';
	if (input.stateError) {
		state = card('Terraform state', `<p class="muted">${escapeHtml(input.stateError)}</p>`);
	} else if (input.state) {
		const s = input.state;
		const drift = stateDrift(s, input.declaredAddresses);
		const local = s.localState.present && s.localState.readable ? s.localState : undefined;
		state = card('Terraform state', `
			<p>${escapeHtml(describeState(s))}</p>
			<dl>
				<dt>Backend</dt><dd>${escapeHtml(s.backend.type)}${s.backend.file ? ` <span class="muted">in ${escapeHtml(s.backend.file)}</span>` : ''}${s.backend.conflict ? ' <strong>(more than one backend block)</strong>' : ''}</dd>
				<dt>Backend settings</dt><dd>${s.backend.settings.length ? s.backend.settings.map(name => `<code>${escapeHtml(name)}</code>`).join(' ') : '<span class="muted">none</span>'} <span class="muted">(names only)</span></dd>
				<dt>Workspaces</dt><dd>${s.workspaces.length ? s.workspaces.map(name => escapeHtml(name)).join(', ') : 'default'}</dd>
				${local?.terraformVersion ? `<dt>Written by</dt><dd>Terraform ${escapeHtml(local.terraformVersion)}</dd>` : ''}
			</dl>
			${local ? `<h3>In state, not in configuration</h3>${list(drift.onlyInState, 'None.')}<h3>In configuration, not yet in state</h3>${list(drift.notInState, 'None.')}<h3>Outputs</h3>${list(local.outputs.map(output => output.name + (output.sensitive ? ' (sensitive)' : '')), 'No outputs.')}` : '<p class="muted">Remote or missing state is not read. CloudForge shows only what is on disk in this architecture.</p>'}`);
	}

	let connections = '';
	if (input.connections) {
		const rows = input.connections.map(connection => {
			const used = input.providersInUse.includes(connection.provider);
			const warn = used && !connection.linked ? ' <strong>Used by this architecture but not linked.</strong>' : '';
			const key = connection.provider !== 'google' && connection.linked
				? `<button data-message="storeKey" data-provider="${connection.provider}">${connection.keyStored ? 'Replace key' : 'Store key'}</button>`
				: '';
			const check = connection.linked ? input.signInChecks?.[connection.provider] : undefined;
			const checked = check
				? `<div class="check ${check.status === 'ok' ? 'good' : 'bad'}">${escapeHtml(describeSignInCheck(check))}${check.status === 'ok' ? '' : `<div class="muted">${escapeHtml(check.detail)}</div>`}</div>`
				: '';
			const checkButton = connection.linked ? `<button data-message="checkSignIn" data-provider="${connection.provider}">Check sign-in</button>` : '';
			return `<li class="connection"><div><strong>${escapeHtml(providerLabel(connection.provider))}</strong> <span class="muted">${escapeHtml(describeConnection(connection))}</span>${warn}${checked}</div>
				<div class="actions"><button data-message="linkConnection" data-provider="${connection.provider}">${connection.linked ? 'Change' : 'Link'}</button>${key}${checkButton}</div></li>`;
		}).join('');
		connections = card('Cloud connections', `<ul class="connections">${rows}</ul><p class="muted">Sign-in stays with the Azure, AWS and Google CLIs. Keys you store go to Windows Credential Manager and are never shown again.</p>`);
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Project Status</title>
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 24px 32px; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 0; } h3 { font-size: 12px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; max-width: 1200px; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px 16px; background: var(--vscode-sideBar-background); }
.card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; font-size: 13px; } dt { color: var(--vscode-descriptionForeground); } dd { margin: 0; }
ul { margin: 0; padding-left: 18px; font-size: 13px; } .connections { list-style: none; padding: 0; } .connection { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--vscode-panel-border); } .connection:first-child { border-top: 0; }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; } code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; align-content: flex-start; }
.check { margin-top: 4px; font-size: 12px; } .check.good { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); } .check.bad { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
button { font: inherit; font-size: 12px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); } button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
</style>
</head>
<body>
<div class="top"><div><h1>${escapeHtml(input.projectName ?? input.architectureName ?? 'CloudForge')}</h1><div class="muted">Project status</div></div><button data-message="refresh">Refresh</button></div>
<div class="grid">${architecture}${state}${connections}</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', event => {
	const button = event.target instanceof Element ? event.target.closest('button[data-message]') : null;
	if (!button) { return; }
	const message = { type: button.getAttribute('data-message') };
	const provider = button.getAttribute('data-provider');
	if (provider) { message.provider = provider; }
	vscode.postMessage(message);
});
</script>
</body>
</html>`;
}

/**
 * Providers a plan should run signed in for: those the graph's resources use that also have a
 * linked connection in this project. Order follows CLOUD_PROVIDERS so the request is stable.
 */
export function planCloudProviders(resourceTypes: readonly (string | null | undefined)[], connections: readonly CloudConnection[]): CloudProvider[] {
	const used = new Set<CloudProvider>();
	for (const type of resourceTypes) {
		if (!type) {
			continue;
		}
		if (type.startsWith('azurerm_') || type.startsWith('azapi_')) {
			used.add('azure');
		} else if (type.startsWith('aws_')) {
			used.add('aws');
		} else if (type.startsWith('google_')) {
			used.add('google');
		}
	}
	return CLOUD_PROVIDERS.filter(provider => used.has(provider) && connections.some(connection => connection.provider === provider && connection.linked));
}
