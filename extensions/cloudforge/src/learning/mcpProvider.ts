/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// VS Code open-source Agent View MCP Server Definition Provider (`cloudforge.mcp`).
// Publishes the active architecture as a scoped, revocable stdio MCP server lazily —
// minting a grant only when VS Code Agent View connects, and revoking it automatically
// when the active architecture changes or the window closes.

import {
	EventEmitter,
	lm,
	McpStdioServerDefinition,
	type CancellationToken,
	type Disposable,
	type Event,
	type McpServerDefinitionProvider
} from 'vscode';
import { parseIssuedMcpGrant } from './model';

export const CLOUDFORGE_MCP_PROVIDER_ID = 'cloudforge.mcp';

type ServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } };

export interface McpActiveScope {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly architectureName: string;
	readonly sourceRevision: string;
}

export interface McpProviderHost {
	callService<T>(method: string, params: Record<string, unknown>): Promise<ServiceResult<T>>;
	getActiveScope(): McpActiveScope | undefined;
	readonly onDidChangeScope: Event<unknown>;
	onDidChangeGrants?(): void;
}

export class CloudForgeMcpProvider implements McpServerDefinitionProvider<McpStdioServerDefinition>, Disposable {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChangeMcpServerDefinitions = this.changeEmitter.event;
	private readonly scopeListener: Disposable;
	private lastScopeKey: string | undefined;
	private activeAutoGrant: { readonly grantId: string; readonly architectureId: string } | undefined;

	constructor(private readonly host: McpProviderHost) {
		this.lastScopeKey = this.scopeKey(host.getActiveScope());
		this.scopeListener = host.onDidChangeScope(() => {
			const next = host.getActiveScope();
			const nextKey = this.scopeKey(next);
			if (nextKey === this.lastScopeKey) {
				return;
			}
			this.lastScopeKey = nextKey;
			if (this.activeAutoGrant && this.activeAutoGrant.architectureId !== next?.architectureId) {
				void this.revokeActiveAutoGrant();
			}
			this.changeEmitter.fire();
		});
	}

	private scopeKey(scope: McpActiveScope | undefined): string | undefined {
		return scope ? `${scope.workspaceId}:${scope.architectureId}` : undefined;
	}

	provideMcpServerDefinitions(_token: CancellationToken): McpStdioServerDefinition[] {
		const scope = this.host.getActiveScope();
		if (!scope) {
			return [];
		}
		// Zero side effects here: grant issuance happens lazily in resolveMcpServerDefinition
		// only when VS Code Agent View actually connects to the CloudForge MCP server.
		return [
			new McpStdioServerDefinition(
				`CloudForge (${scope.architectureName})`,
				'cloudforge-service',
				['--mcp'],
				{},
				`${scope.architectureId}:${scope.sourceRevision.slice(0, 8)}`
			)
		];
	}

	async resolveMcpServerDefinition(server: McpStdioServerDefinition, token: CancellationToken): Promise<McpStdioServerDefinition | undefined> {
		const scope = this.host.getActiveScope();
		if (!scope || token.isCancellationRequested) {
			return undefined;
		}
		// Always revoke any previous auto-issued grant before issuing a fresh one so reconnects never leak grants.
		if (this.activeAutoGrant) {
			await this.revokeActiveAutoGrant();
		}
		const issued = await this.host.callService<unknown>('issueMcpGrant', {
			workspaceId: scope.workspaceId,
			architectureId: scope.architectureId,
			clientLabel: 'vscode-agent',
			ttlMinutes: 120
		});
		if (!issued.ok) {
			return undefined;
		}
		const grant = parseIssuedMcpGrant(issued.value);
		if (!grant) {
			return undefined;
		}
		const currentScope = this.host.getActiveScope();
		if (token.isCancellationRequested || !currentScope || currentScope.workspaceId !== scope.workspaceId || currentScope.architectureId !== scope.architectureId) {
			// Scope changed or request cancelled while issuing — immediately revoke the orphaned grant.
			void this.host.callService('revokeMcpGrant', { grantId: grant.grantId }).catch(() => undefined);
			return undefined;
		}
		this.activeAutoGrant = { grantId: grant.grantId, architectureId: scope.architectureId };
		this.host.onDidChangeGrants?.();
		server.command = grant.mcpCommand;
		server.args = [...grant.mcpArgs];
		server.env = {};
		return server;
	}

	private async revokeActiveAutoGrant(): Promise<void> {
		const previous = this.activeAutoGrant;
		this.activeAutoGrant = undefined;
		if (!previous) {
			return;
		}
		try {
			await this.host.callService('revokeMcpGrant', { grantId: previous.grantId });
			this.host.onDidChangeGrants?.();
		} catch {
			// Best-effort cleanup; grants also expire automatically.
		}
	}

	dispose(): void {
		this.scopeListener.dispose();
		this.changeEmitter.dispose();
		void this.revokeActiveAutoGrant();
	}
}

export function registerCloudForgeMcpProvider(host: McpProviderHost): { readonly enabled: boolean; readonly disposable: Disposable } {
	const register = lm?.registerMcpServerDefinitionProvider;
	if (typeof register !== 'function') {
		return { enabled: false, disposable: { dispose() { } } };
	}
	const provider = new CloudForgeMcpProvider(host);
	const registration = register(CLOUDFORGE_MCP_PROVIDER_ID, provider);
	return {
		enabled: true,
		disposable: {
			dispose(): void {
				registration.dispose();
				provider.dispose();
			}
		}
	};
}
