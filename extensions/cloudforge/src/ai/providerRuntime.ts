/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 12G: CloudForge AI Provider Manager & Native VS Code `LanguageModelChatProvider`.
// Wires local models (Ollama, LM Studio), simple OAuth (GitHub Models), encrypted API-key
// providers (OpenAI, Anthropic, Gemini, OpenRouter), and user-added custom models/endpoints
// seamlessly into VS Code's open-source Chat & Agent View model picker.

import {
	authentication,
	ConfigurationTarget,
	env,
	EventEmitter,
	l10n,
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	lm,
	Uri,
	window,
	workspace,
	type CancellationToken,
	type Disposable,
	type ExtensionContext,
	type LanguageModelChatInformation,
	type LanguageModelChatProvider,
	type LanguageModelChatRequestMessage,
	type LanguageModelResponsePart,
	type PrepareLanguageModelChatModelOptions,
	type Progress,
	type ProvideLanguageModelChatResponseOptions
} from 'vscode';
import {
	AI_PROVIDER_PRESETS,
	buildAnthropicChatPayload,
	buildOpenAiChatPayload,
	findPreset,
	isLoopbackEndpoint,
	parseAnthropicSseLine,
	parseOllamaTagsResponse,
	parseOpenAiModelsResponse,
	parseOpenAiSseLine,
	sanitizeCustomModels,
	sanitizeProvidersConfig,
	validateProviderEndpointUrl,
	type AiApiFormat,
	type AiAuthKind,
	type AiProviderConfig,
	type AiProviderView,
	type CustomModelEntry,
	type DiscoveredModel,
	type NormalizedChatMessage,
	type NormalizedToolDef
} from './model';

export const CLOUDFORGE_LM_VENDOR = 'cloudforge';
const SECRET_PREFIX = 'cloudforge.ai.apiKey.';

interface ResolvedModelTarget {
	readonly fullId: string;
	readonly modelId: string;
	readonly providerId: string;
	readonly displayName: string;
	readonly baseUrl: string;
	readonly apiFormat: AiApiFormat;
	readonly authKind: AiAuthKind;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly toolCalling: boolean;
}

function secretKeyFor(providerId: string): string {
	return `${SECRET_PREFIX}${providerId}`;
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
		if (!res.ok) {
			return undefined;
		}
		return await res.json();
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function normalizeMessages(messages: readonly LanguageModelChatRequestMessage[]): NormalizedChatMessage[] {
	const out: NormalizedChatMessage[] = [];
	for (const msg of messages) {
		const role = msg.role === LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
		const textChunks: string[] = [];
		const toolCalls: { id: string; name: string; argumentsJson: string }[] = [];
		for (const part of msg.content) {
			if (part instanceof LanguageModelTextPart) {
				textChunks.push(part.value);
			} else if (part instanceof LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					name: part.name,
					argumentsJson: JSON.stringify(part.input ?? {})
				});
			} else if (part instanceof LanguageModelToolResultPart) {
				const resultText = part.content
					.map(c => c instanceof LanguageModelTextPart ? c.value : JSON.stringify(c))
					.join('\n');
				out.push({ role: 'tool', toolCallId: part.callId, text: resultText });
			}
		}
		if (textChunks.length > 0 || toolCalls.length > 0) {
			out.push({
				role,
				text: textChunks.join('\n'),
				...(toolCalls.length > 0 ? { toolCalls } : {})
			});
		}
	}
	return out;
}

function normalizeTools(options: ProvideLanguageModelChatResponseOptions): NormalizedToolDef[] {
	if (!options.tools || options.tools.length === 0) {
		return [];
	}
	return options.tools.map(t => ({
		name: t.name,
		description: t.description,
		inputSchema: (t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }) as Record<string, unknown>
	}));
}

export class CloudForgeAiManager implements LanguageModelChatProvider, Disposable {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
	private readonly stateChangeEmitter = new EventEmitter<void>();
	readonly onDidChangeState = this.stateChangeEmitter.event;

	private readonly discoveredLocal = new Map<string, DiscoveredModel[]>();
	private readonly resolvedTargets = new Map<string, ResolvedModelTarget>();
	private readonly disposables: Disposable[] = [];
	readonly lmProviderEnabled: boolean;

	constructor(private readonly context: ExtensionContext) {
		const register = lm?.registerLanguageModelChatProvider;
		if (typeof register === 'function') {
			this.disposables.push(register(CLOUDFORGE_LM_VENDOR, this));
			this.lmProviderEnabled = true;
		} else {
			this.lmProviderEnabled = false;
		}
		this.disposables.push(
			workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('cloudforge.ai')) {
					this.notifyChanged();
				}
			})
		);
		// Non-blocking initial local model scan if enabled in settings.
		if (workspace.getConfiguration('cloudforge.ai').get<boolean>('autoDiscoverLocal', true)) {
			void this.scanLocalRuntimes();
		}
	}

	private notifyChanged(): void {
		this.changeEmitter.fire();
		this.stateChangeEmitter.fire();
	}

	private configuredProviders(): AiProviderConfig[] {
		const raw = workspace.getConfiguration('cloudforge.ai').get<unknown>('providers', []);
		return sanitizeProvidersConfig(raw);
	}

	getCustomModels(): CustomModelEntry[] {
		const raw = workspace.getConfiguration('cloudforge.ai').get<unknown>('customModels', []);
		return sanitizeCustomModels(raw);
	}

	private mergedProviders(): AiProviderConfig[] {
		const overrides = new Map(this.configuredProviders().map(p => [p.id, p]));
		const merged: AiProviderConfig[] = [];
		for (const preset of AI_PROVIDER_PRESETS) {
			const override = overrides.get(preset.id);
			overrides.delete(preset.id);
			merged.push(override ?? {
				id: preset.id,
				name: preset.name,
				baseUrl: preset.defaultBaseUrl,
				apiFormat: preset.apiFormat,
				authKind: preset.authKind,
				enabled: true
			});
		}
		for (const extra of overrides.values()) {
			merged.push(extra);
		}
		return merged;
	}

	async hasAuthForProvider(provider: AiProviderConfig): Promise<{ readonly connected: boolean; readonly detail: string }> {
		if (provider.authKind === 'none') {
			const discovered = this.discoveredLocal.get(provider.id) ?? [];
			const customCount = this.getCustomModels().filter(m => m.providerId === provider.id).length;
			const total = discovered.length + customCount;
			return {
				connected: total > 0,
				detail: total > 0 ? l10n.t('Local · {0} model(s) ready', total) : l10n.t('Local · click Scan to detect running models')
			};
		}
		if (provider.authKind === 'githubOAuth') {
			try {
				const session = await authentication.getSession('github', ['read:user'], { silent: true });
				return session
					? { connected: true, detail: l10n.t('Signed in as {0} (GitHub OAuth)', session.account.label) }
					: { connected: false, detail: l10n.t('Not signed in — click Sign in with GitHub') };
			} catch {
				return { connected: false, detail: l10n.t('GitHub auth unavailable') };
			}
		}
		const stored = await this.context.secrets.get(secretKeyFor(provider.id));
		return stored
			? { connected: true, detail: l10n.t('API key saved in OS credential store') }
			: { connected: false, detail: l10n.t('Not connected — click Connect') };
	}

	private async resolveBearerOrKey(providerId: string, authKind: AiAuthKind, interactive: boolean): Promise<string | undefined> {
		if (authKind === 'none') {
			return undefined;
		}
		if (authKind === 'githubOAuth') {
			try {
				const session = await authentication.getSession('github', ['read:user'], interactive ? { createIfNone: true } : { silent: true });
				return session?.accessToken;
			} catch {
				return undefined;
			}
		}
		return await this.context.secrets.get(secretKeyFor(providerId));
	}

	async getProviderViews(): Promise<AiProviderView[]> {
		const providers = this.mergedProviders();
		const customModels = this.getCustomModels();
		const views: AiProviderView[] = [];
		for (const p of providers) {
			const preset = findPreset(p.id);
			const auth = await this.hasAuthForProvider(p);
			const localCount = (this.discoveredLocal.get(p.id) ?? []).length;
			const customCount = customModels.filter(m => m.providerId === p.id).length;
			const presetCount = auth.connected && preset ? preset.defaultModels.length : 0;
			views.push({
				id: p.id,
				name: p.name,
				kind: preset ? preset.kind : (isLoopbackEndpoint(p.baseUrl) ? 'local' : 'custom'),
				baseUrl: p.baseUrl,
				apiFormat: p.apiFormat,
				authKind: p.authKind,
				enabled: p.enabled,
				connected: auth.connected,
				authDetail: auth.detail,
				...(preset?.keyPortalUrl ? { keyPortalUrl: preset.keyPortalUrl } : {}),
				modelCount: localCount + customCount + presetCount,
				description: preset?.description ?? p.baseUrl
			});
		}
		return views;
	}

	async scanLocalRuntimes(): Promise<{ readonly ollama: number; readonly lmstudio: number }> {
		const providers = new Map(this.mergedProviders().map(p => [p.id, p]));
		const ollamaUrl = providers.get('ollama')?.baseUrl ?? 'http://127.0.0.1:11434/v1';
		const ollamaRoot = ollamaUrl.replace(/\/v1\/?$/, '');
		const lmStudioUrl = providers.get('lmstudio')?.baseUrl ?? 'http://127.0.0.1:1234/v1';

		const [ollamaJson, lmStudioJson] = await Promise.all([
			isLoopbackEndpoint(ollamaRoot) ? fetchJsonWithTimeout(`${ollamaRoot}/api/tags`, {}, 2000) : Promise.resolve(undefined),
			isLoopbackEndpoint(lmStudioUrl) ? fetchJsonWithTimeout(`${lmStudioUrl}/models`, {}, 2000) : Promise.resolve(undefined)
		]);

		const ollamaModels = parseOllamaTagsResponse(ollamaJson);
		const lmStudioModels = parseOpenAiModelsResponse(lmStudioJson, 'lmstudio', 'LM Studio');
		this.discoveredLocal.set('ollama', ollamaModels);
		this.discoveredLocal.set('lmstudio', lmStudioModels);
		this.notifyChanged();
		return { ollama: ollamaModels.length, lmstudio: lmStudioModels.length };
	}

	async connectProvider(providerId: string): Promise<string | undefined> {
		const provider = this.mergedProviders().find(p => p.id === providerId);
		if (!provider) {
			return undefined;
		}
		if (provider.authKind === 'none') {
			const counts = await this.scanLocalRuntimes();
			return l10n.t('Scanned local runtimes: {0} Ollama model(s), {1} LM Studio model(s).', counts.ollama, counts.lmstudio);
		}
		if (provider.authKind === 'githubOAuth') {
			try {
				const session = await authentication.getSession('github', ['read:user'], { createIfNone: true });
				this.notifyChanged();
				return session
					? l10n.t('Connected GitHub Models as {0}. Models are now available in Chat & Agent View.', session.account.label)
					: l10n.t('GitHub sign-in was cancelled.');
			} catch {
				return l10n.t('Could not start GitHub sign-in in this window.');
			}
		}
		const preset = findPreset(provider.id);
		const openPortalLabel = preset?.keyPortalUrl ? l10n.t('Open API Keys Page') : undefined;
		if (openPortalLabel && preset?.keyPortalUrl) {
			const choice = await window.showQuickPick(
				[
					{ label: l10n.t('$(key) Enter {0} API key', provider.name), action: 'enter' as const },
					{ label: `$(link-external) ${openPortalLabel}`, description: preset.keyPortalUrl, action: 'portal' as const }
				],
				{ placeHolder: l10n.t('Connect {0} — key is stored encrypted in your OS credential store', provider.name) }
			);
			if (!choice) {
				return undefined;
			}
			if (choice.action === 'portal') {
				await env.openExternal(Uri.parse(preset.keyPortalUrl));
			}
		}
		const apiKey = await window.showInputBox({
			title: l10n.t('Connect {0}', provider.name),
			prompt: l10n.t('Paste your {0} API key (stored encrypted in OS SecretStorage, never in settings.json)', provider.name),
			password: true,
			ignoreFocusOut: true,
			validateInput: val => val.trim().length < 8 ? l10n.t('Enter a valid API key.') : undefined
		});
		if (!apiKey) {
			return undefined;
		}
		await this.context.secrets.store(secretKeyFor(provider.id), apiKey.trim());
		this.notifyChanged();
		return l10n.t('Connected {0}. Models are now available in VS Code Chat & Agent View.', provider.name);
	}

	async disconnectProvider(providerId: string): Promise<string> {
		await this.context.secrets.delete(secretKeyFor(providerId));
		this.notifyChanged();
		return l10n.t('Removed stored API key for {0}.', providerId);
	}

	async addCustomModel(entry: CustomModelEntry, optionalApiKey?: string): Promise<void> {
		const cfg = workspace.getConfiguration('cloudforge.ai');
		const existing = this.getCustomModels().filter(m => !(m.providerId === entry.providerId && m.id === entry.id));
		existing.push(entry);
		await cfg.update('customModels', existing, ConfigurationTarget.Global);
		if (optionalApiKey && optionalApiKey.trim().length > 0) {
			await this.context.secrets.store(secretKeyFor(entry.providerId), optionalApiKey.trim());
		}
		this.notifyChanged();
	}

	async removeCustomModel(providerId: string, modelId: string): Promise<void> {
		const cfg = workspace.getConfiguration('cloudforge.ai');
		const remaining = this.getCustomModels().filter(m => !(m.providerId === providerId && m.id === modelId));
		await cfg.update('customModels', remaining, ConfigurationTarget.Global);
		this.notifyChanged();
	}

	async promptAddCustomModel(): Promise<string | undefined> {
		const modelId = await window.showInputBox({
			title: l10n.t('Add Custom / Local AI Model — Model ID'),
			prompt: l10n.t('Exact model identifier sent to the API (e.g. qwen2.5-coder:14b, llama-3.3-70b, gpt-4.1)'),
			placeHolder: 'qwen2.5-coder:14b'
		});
		if (!modelId?.trim()) {
			return undefined;
		}
		const baseUrl = await window.showInputBox({
			title: l10n.t('Endpoint Base URL'),
			prompt: l10n.t('Local loopback http://127.0.0.1:<port>/v1 or remote https://... OpenAI-compatible / Anthropic endpoint'),
			value: 'http://127.0.0.1:11434/v1',
			validateInput: val => validateProviderEndpointUrl(val) ? undefined : l10n.t('Use https:// for remote endpoints or http://127.0.0.1 / localhost for local runtimes.')
		});
		if (!baseUrl) {
			return undefined;
		}
		const validatedUrl = validateProviderEndpointUrl(baseUrl);
		if (!validatedUrl) {
			return undefined;
		}
		const defaultAuth: AiAuthKind = isLoopbackEndpoint(validatedUrl) ? 'none' : 'apiKey';
		const authPick = await window.showQuickPick(
			[
				{ label: l10n.t('No authentication (local runtime)'), authKind: 'none' as const },
				{ label: l10n.t('API key (stored encrypted in OS SecretStorage)'), authKind: 'apiKey' as const }
			],
			{ placeHolder: defaultAuth === 'none' ? l10n.t('Loopback detected — No auth recommended') : l10n.t('Choose authentication mode') }
		);
		if (!authPick) {
			return undefined;
		}
		const providerId = `custom-${modelId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'model'}`;
		let apiKey: string | undefined;
		if (authPick.authKind === 'apiKey') {
			apiKey = await window.showInputBox({
				title: l10n.t('API Key for {0}', modelId.trim()),
				password: true,
				ignoreFocusOut: true
			});
			if (!apiKey?.trim()) {
				return undefined;
			}
		}
		await this.addCustomModel({
			id: modelId.trim(),
			name: modelId.trim(),
			providerId,
			baseUrl: validatedUrl,
			apiFormat: 'openai',
			authKind: authPick.authKind,
			maxInputTokens: 65536,
			maxOutputTokens: 8192,
			toolCalling: true
		}, apiKey);
		return l10n.t('Added custom model "{0}" ({1}). It is now selectable in VS Code Chat & Agent View.', modelId.trim(), validatedUrl);
	}

	async provideLanguageModelChatInformation(
		_options: PrepareLanguageModelChatModelOptions,
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		this.resolvedTargets.clear();
		const providers = this.mergedProviders();
		const providerMap = new Map(providers.map(p => [p.id, p]));
		const infos: LanguageModelChatInformation[] = [];

		const pushTarget = (target: ResolvedModelTarget, detail: string) => {
			if (this.resolvedTargets.has(target.fullId)) {
				return;
			}
			this.resolvedTargets.set(target.fullId, target);
			infos.push({
				id: target.fullId,
				name: target.displayName,
				family: target.modelId,
				version: '1.0',
				detail,
				tooltip: `${target.displayName} (${target.baseUrl})`,
				maxInputTokens: target.maxInputTokens,
				maxOutputTokens: target.maxOutputTokens,
				capabilities: { toolCalling: target.toolCalling }
			});
		};

		// 1. Discovered local models (Ollama, LM Studio).
		for (const [providerId, models] of this.discoveredLocal.entries()) {
			const provider = providerMap.get(providerId);
			if (!provider || !provider.enabled) {
				continue;
			}
			for (const m of models) {
				pushTarget({
					fullId: `${providerId}/${m.id}`,
					modelId: m.id,
					providerId,
					displayName: m.name,
					baseUrl: provider.baseUrl,
					apiFormat: provider.apiFormat,
					authKind: provider.authKind,
					maxInputTokens: m.maxInputTokens,
					maxOutputTokens: m.maxOutputTokens,
					toolCalling: m.toolCalling
				}, l10n.t('Local'));
			}
		}

		// 2. Preset models for connected cloud providers.
		for (const preset of AI_PROVIDER_PRESETS) {
			const provider = providerMap.get(preset.id);
			if (!provider || !provider.enabled || preset.defaultModels.length === 0) {
				continue;
			}
			const auth = await this.hasAuthForProvider(provider);
			if (!auth.connected) {
				continue;
			}
			for (const m of preset.defaultModels) {
				pushTarget({
					fullId: `${provider.id}/${m.id}`,
					modelId: m.id,
					providerId: provider.id,
					displayName: m.name,
					baseUrl: provider.baseUrl,
					apiFormat: provider.apiFormat,
					authKind: provider.authKind,
					maxInputTokens: m.maxInputTokens,
					maxOutputTokens: m.maxOutputTokens,
					toolCalling: m.toolCalling
				}, provider.name);
			}
		}

		// 3. User-added custom & local models from `cloudforge.ai.customModels`.
		for (const custom of this.getCustomModels()) {
			const provider = providerMap.get(custom.providerId);
			const baseUrl = custom.baseUrl ?? provider?.baseUrl;
			if (!baseUrl) {
				continue;
			}
			const apiFormat = custom.apiFormat ?? provider?.apiFormat ?? 'openai';
			const authKind = custom.authKind ?? provider?.authKind ?? (isLoopbackEndpoint(baseUrl) ? 'none' : 'apiKey');
			pushTarget({
				fullId: `${custom.providerId}/${custom.id}`,
				modelId: custom.id,
				providerId: custom.providerId,
				displayName: custom.name,
				baseUrl,
				apiFormat,
				authKind,
				maxInputTokens: custom.maxInputTokens,
				maxOutputTokens: custom.maxOutputTokens,
				toolCalling: custom.toolCalling
			}, isLoopbackEndpoint(baseUrl) ? l10n.t('Custom Local') : l10n.t('Custom'));
		}

		return infos;
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		const target = this.resolvedTargets.get(model.id);
		if (!target) {
			throw new Error(`CloudForge model "${model.id}" is no longer configured.`);
		}
		const secret = await this.resolveBearerOrKey(target.providerId, target.authKind, true);
		if (target.authKind !== 'none' && !secret) {
			throw new Error(`Authentication required for ${target.displayName}. Connect it in CloudForge Learning Studio → AI Models.`);
		}

		const normalizedMessages = normalizeMessages(messages);
		const normalizedTools = normalizeTools(options);
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());

		try {
			if (target.apiFormat === 'anthropic') {
				await this.streamAnthropic(target, secret ?? '', normalizedMessages, normalizedTools, progress, controller.signal);
			} else {
				await this.streamOpenAi(target, secret, normalizedMessages, normalizedTools, progress, controller.signal);
			}
		} finally {
			cancelSub.dispose();
		}
	}

	private async streamOpenAi(
		target: ResolvedModelTarget,
		bearer: string | undefined,
		messages: readonly NormalizedChatMessage[],
		tools: readonly NormalizedToolDef[],
		progress: Progress<LanguageModelResponsePart>,
		signal: AbortSignal
	): Promise<void> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (bearer) {
			headers.Authorization = `Bearer ${bearer}`;
		}
		const body = buildOpenAiChatPayload(target.modelId, messages, tools, target.maxOutputTokens);
		const response = await fetch(`${target.baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal
		});
		if (!response.ok || !response.body) {
			throw new Error(`Model endpoint returned HTTP ${response.status}.`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const parsed = parseOpenAiSseLine(line);
				if (!parsed) {
					continue;
				}
				if (parsed.text) {
					progress.report(new LanguageModelTextPart(parsed.text));
				}
				for (const tc of parsed.toolCallDeltas ?? []) {
					const acc = pendingToolCalls.get(tc.index) ?? { id: tc.id ?? `call-${tc.index}`, name: tc.name ?? '', args: '' };
					if (tc.id) {
						acc.id = tc.id;
					}
					if (tc.name) {
						acc.name = tc.name;
					}
					if (tc.argumentsChunk) {
						acc.args += tc.argumentsChunk;
					}
					pendingToolCalls.set(tc.index, acc);
				}
			}
		}

		for (const tc of pendingToolCalls.values()) {
			if (!tc.name) {
				continue;
			}
			let input: object = {};
			try {
				const parsed: unknown = JSON.parse(tc.args || '{}');
				if (parsed && typeof parsed === 'object') {
					input = parsed;
				}
			} catch {
				input = {};
			}
			progress.report(new LanguageModelToolCallPart(tc.id, tc.name, input));
		}
	}

	private async streamAnthropic(
		target: ResolvedModelTarget,
		apiKey: string,
		messages: readonly NormalizedChatMessage[],
		tools: readonly NormalizedToolDef[],
		progress: Progress<LanguageModelResponsePart>,
		signal: AbortSignal
	): Promise<void> {
		const body = buildAnthropicChatPayload(target.modelId, messages, tools, target.maxOutputTokens);
		const response = await fetch(`${target.baseUrl}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(body),
			signal
		});
		if (!response.ok || !response.body) {
			throw new Error(`Anthropic endpoint returned HTTP ${response.status}.`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const pendingTools = new Map<number, { id: string; name: string; args: string }>();

		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const evt = parseAnthropicSseLine(line);
				if (!evt) {
					continue;
				}
				if (evt.text) {
					progress.report(new LanguageModelTextPart(evt.text));
				}
				if (evt.toolStart) {
					pendingTools.set(evt.toolStart.index, { id: evt.toolStart.id, name: evt.toolStart.name, args: '' });
				}
				if (evt.toolInputDelta) {
					const acc = pendingTools.get(evt.toolInputDelta.index);
					if (acc) {
						acc.args += evt.toolInputDelta.partialJson;
					}
				}
			}
		}

		for (const tc of pendingTools.values()) {
			let input: object = {};
			try {
				const parsed: unknown = JSON.parse(tc.args || '{}');
				if (parsed && typeof parsed === 'object') {
					input = parsed;
				}
			} catch {
				input = {};
			}
			progress.report(new LanguageModelToolCallPart(tc.id, tc.name, input));
		}
	}

	async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatRequestMessage): Promise<number> {
		if (typeof text === 'string') {
			return Math.ceil(text.length / 4);
		}
		let chars = 0;
		for (const part of text.content) {
			if (part instanceof LanguageModelTextPart) {
				chars += part.value.length;
			}
		}
		return Math.ceil(chars / 4);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.changeEmitter.dispose();
		this.stateChangeEmitter.dispose();
	}
}
