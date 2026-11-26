/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure data models, URL/security validators, preset registry, model discovery parsers,
// and OpenAI/Anthropic chat + SSE stream formatters for CloudForge AI Providers.
// Zero `vscode` imports so every function is unit-tested directly with `node --test`.

export type AiAuthKind = 'none' | 'apiKey' | 'githubOAuth';
export type AiApiFormat = 'openai' | 'anthropic';

export interface AiProviderPreset {
	readonly id: string;
	readonly name: string;
	readonly kind: 'local' | 'cloud';
	readonly apiFormat: AiApiFormat;
	readonly authKind: AiAuthKind;
	readonly defaultBaseUrl: string;
	readonly defaultModels: readonly { readonly id: string; readonly name: string; readonly maxInputTokens: number; readonly maxOutputTokens: number; readonly toolCalling: boolean }[];
	readonly keyPortalUrl?: string;
	readonly description: string;
}

export interface AiProviderConfig {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly apiFormat: AiApiFormat;
	readonly authKind: AiAuthKind;
	readonly enabled: boolean;
}

export interface CustomModelEntry {
	readonly id: string;
	readonly name: string;
	readonly providerId: string;
	readonly baseUrl?: string;
	readonly apiFormat?: AiApiFormat;
	readonly authKind?: AiAuthKind;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly toolCalling: boolean;
}

export interface DiscoveredModel {
	readonly id: string;
	readonly name: string;
	readonly providerId: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly toolCalling: boolean;
}

export interface AiProviderView {
	readonly id: string;
	readonly name: string;
	readonly kind: 'local' | 'cloud' | 'custom';
	readonly baseUrl: string;
	readonly apiFormat: AiApiFormat;
	readonly authKind: AiAuthKind;
	readonly enabled: boolean;
	readonly connected: boolean;
	readonly authDetail: string;
	readonly keyPortalUrl?: string;
	readonly modelCount: number;
	readonly description: string;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
	{
		id: 'ollama',
		name: 'Ollama (Local)',
		kind: 'local',
		apiFormat: 'openai',
		authKind: 'none',
		defaultBaseUrl: 'http://127.0.0.1:11434/v1',
		defaultModels: [],
		description: 'Auto-discovers models running locally in Ollama with zero API key setup.'
	},
	{
		id: 'lmstudio',
		name: 'LM Studio (Local)',
		kind: 'local',
		apiFormat: 'openai',
		authKind: 'none',
		defaultBaseUrl: 'http://127.0.0.1:1234/v1',
		defaultModels: [],
		description: 'Connects to LM Studio local server on 127.0.0.1:1234 with zero auth.'
	},
	{
		id: 'github-models',
		name: 'GitHub Models',
		kind: 'cloud',
		apiFormat: 'openai',
		authKind: 'githubOAuth',
		defaultBaseUrl: 'https://models.inference.ai.azure.com',
		defaultModels: [
			{ id: 'gpt-4o', name: 'GPT-4o (GitHub Models)', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true },
			{ id: 'gpt-4o-mini', name: 'GPT-4o mini (GitHub Models)', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true }
		],
		description: 'One-click sign-in using your GitHub account (no manual API key needed).'
	},
	{
		id: 'openai',
		name: 'OpenAI',
		kind: 'cloud',
		apiFormat: 'openai',
		authKind: 'apiKey',
		defaultBaseUrl: 'https://api.openai.com/v1',
		defaultModels: [
			{ id: 'gpt-4.1', name: 'GPT-4.1', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true },
			{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true },
			{ id: 'o4-mini', name: 'o4-mini', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true }
		],
		keyPortalUrl: 'https://platform.openai.com/api-keys',
		description: 'Direct OpenAI API with encrypted OS credential storage.'
	},
	{
		id: 'anthropic',
		name: 'Anthropic (Claude)',
		kind: 'cloud',
		apiFormat: 'anthropic',
		authKind: 'apiKey',
		defaultBaseUrl: 'https://api.anthropic.com/v1',
		defaultModels: [
			{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', maxInputTokens: 200000, maxOutputTokens: 16384, toolCalling: true },
			{ id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', maxInputTokens: 200000, maxOutputTokens: 8192, toolCalling: true }
		],
		keyPortalUrl: 'https://console.anthropic.com/settings/keys',
		description: 'Native Anthropic Messages API with tool calling and encrypted key storage.'
	},
	{
		id: 'gemini',
		name: 'Google Gemini',
		kind: 'cloud',
		apiFormat: 'openai',
		authKind: 'apiKey',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		defaultModels: [
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', maxInputTokens: 1000000, maxOutputTokens: 65536, toolCalling: true },
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', maxInputTokens: 1000000, maxOutputTokens: 65536, toolCalling: true }
		],
		keyPortalUrl: 'https://aistudio.google.com/apikey',
		description: 'Google AI Studio Gemini models via OpenAI-compatible endpoint.'
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		kind: 'cloud',
		apiFormat: 'openai',
		authKind: 'apiKey',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		defaultModels: [
			{ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (OpenRouter)', maxInputTokens: 200000, maxOutputTokens: 16384, toolCalling: true },
			{ id: 'openai/gpt-4.1', name: 'GPT-4.1 (OpenRouter)', maxInputTokens: 128000, maxOutputTokens: 16384, toolCalling: true }
		],
		keyPortalUrl: 'https://openrouter.ai/keys',
		description: 'Single API key routing to hundreds of frontier and open-weights models.'
	}
];

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a provider base URL:
 * - Allows `https://` for any non-credentialed remote or local host.
 * - Allows `http://` ONLY for loopback addresses (`127.0.0.1`, `localhost`, `[::1]`) so local
 *   model runtimes (Ollama, LM Studio, vLLM, llama.cpp) work seamlessly without weakening
 *   transport security for remote API keys.
 * - Strips trailing slashes for deterministic path joining.
 */
export function validateProviderEndpointUrl(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.length > 512 || /[\s\u0000-\u001f\u007f]/.test(trimmed)) {
		return undefined;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return undefined;
	}
	if (parsed.username !== '' || parsed.password !== '') {
		return undefined;
	}
	if (parsed.protocol === 'https:') {
		return trimmed.replace(/\/+$/, '');
	}
	if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
		return trimmed.replace(/\/+$/, '');
	}
	return undefined;
}

export function isLoopbackEndpoint(raw: string): boolean {
	try {
		const parsed = new URL(raw);
		return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
	} catch {
		return false;
	}
}

export function findPreset(id: string): AiProviderPreset | undefined {
	return AI_PROVIDER_PRESETS.find(p => p.id === id);
}

export function sanitizeProvidersConfig(raw: unknown): AiProviderConfig[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const out: AiProviderConfig[] = [];
	for (const item of raw.slice(0, 32)) {
		if (!isRecord(item)) {
			continue;
		}
		const id = typeof item.id === 'string' ? item.id.trim().toLowerCase() : '';
		const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
		const baseUrl = typeof item.baseUrl === 'string' ? validateProviderEndpointUrl(item.baseUrl) : undefined;
		const apiFormat: AiApiFormat = item.apiFormat === 'anthropic' ? 'anthropic' : 'openai';
		const authKind: AiAuthKind = item.authKind === 'none' || item.authKind === 'githubOAuth' || item.authKind === 'apiKey'
			? item.authKind
			: (baseUrl && isLoopbackEndpoint(baseUrl) ? 'none' : 'apiKey');
		if (!PROVIDER_ID_PATTERN.test(id) || !name || !baseUrl || seen.has(id)) {
			continue;
		}
		seen.add(id);
		out.push({
			id,
			name,
			baseUrl,
			apiFormat,
			authKind,
			enabled: item.enabled !== false
		});
	}
	return out;
}

export function sanitizeCustomModels(raw: unknown): CustomModelEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const out: CustomModelEntry[] = [];
	for (const item of raw.slice(0, 64)) {
		if (!isRecord(item)) {
			continue;
		}
		const id = typeof item.id === 'string' ? item.id.trim() : '';
		const name = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim().slice(0, 100) : id;
		const providerId = typeof item.providerId === 'string' && PROVIDER_ID_PATTERN.test(item.providerId.trim().toLowerCase())
			? item.providerId.trim().toLowerCase()
			: 'custom';
		const baseUrl = typeof item.baseUrl === 'string' && item.baseUrl.trim().length > 0
			? validateProviderEndpointUrl(item.baseUrl)
			: undefined;
		if (typeof item.baseUrl === 'string' && item.baseUrl.trim().length > 0 && !baseUrl) {
			continue;
		}
		const apiFormat: AiApiFormat | undefined = item.apiFormat === 'anthropic' ? 'anthropic' : item.apiFormat === 'openai' ? 'openai' : undefined;
		const authKind: AiAuthKind | undefined = item.authKind === 'none' || item.authKind === 'apiKey' || item.authKind === 'githubOAuth'
			? item.authKind
			: undefined;
		const maxInputTokens = typeof item.maxInputTokens === 'number' && Number.isFinite(item.maxInputTokens) && item.maxInputTokens >= 1024 && item.maxInputTokens <= 2_000_000
			? Math.floor(item.maxInputTokens)
			: 65536;
		const maxOutputTokens = typeof item.maxOutputTokens === 'number' && Number.isFinite(item.maxOutputTokens) && item.maxOutputTokens >= 256 && item.maxOutputTokens <= 200_000
			? Math.floor(item.maxOutputTokens)
			: 8192;
		const key = `${providerId}:${id}`;
		if (!MODEL_ID_PATTERN.test(id) || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			id,
			name,
			providerId,
			...(baseUrl ? { baseUrl } : {}),
			...(apiFormat ? { apiFormat } : {}),
			...(authKind ? { authKind } : {}),
			maxInputTokens,
			maxOutputTokens,
			toolCalling: item.toolCalling !== false
		});
	}
	return out;
}

export function parseOllamaTagsResponse(payload: unknown): DiscoveredModel[] {
	if (!isRecord(payload) || !Array.isArray(payload.models)) {
		return [];
	}
	const out: DiscoveredModel[] = [];
	for (const entry of payload.models.slice(0, 64)) {
		if (!isRecord(entry) || typeof entry.name !== 'string') {
			continue;
		}
		const id = entry.name.trim();
		if (!MODEL_ID_PATTERN.test(id)) {
			continue;
		}
		out.push({
			id,
			name: `${id} (Ollama)`,
			providerId: 'ollama',
			maxInputTokens: 65536,
			maxOutputTokens: 8192,
			toolCalling: true
		});
	}
	return out;
}

export function parseOpenAiModelsResponse(payload: unknown, providerId: string, suffix?: string): DiscoveredModel[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		return [];
	}
	const out: DiscoveredModel[] = [];
	for (const entry of payload.data.slice(0, 64)) {
		if (!isRecord(entry) || typeof entry.id !== 'string') {
			continue;
		}
		const id = entry.id.trim();
		if (!MODEL_ID_PATTERN.test(id)) {
			continue;
		}
		out.push({
			id,
			name: suffix ? `${id} (${suffix})` : id,
			providerId,
			maxInputTokens: 65536,
			maxOutputTokens: 8192,
			toolCalling: true
		});
	}
	return out;
}

export interface NormalizedChatMessage {
	readonly role: 'user' | 'assistant' | 'tool';
	readonly text: string;
	readonly toolCallId?: string;
	readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly argumentsJson: string }[];
}

export interface NormalizedToolDef {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
}

export function buildOpenAiChatPayload(
	modelId: string,
	messages: readonly NormalizedChatMessage[],
	tools: readonly NormalizedToolDef[],
	maxOutputTokens: number
): Record<string, unknown> {
	const mapped = messages.map(msg => {
		if (msg.role === 'tool' && msg.toolCallId) {
			return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.text };
		}
		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			return {
				role: 'assistant',
				content: msg.text || null,
				tool_calls: msg.toolCalls.map(tc => ({
					id: tc.id,
					type: 'function',
					function: { name: tc.name, arguments: tc.argumentsJson }
				}))
			};
		}
		return { role: msg.role, content: msg.text };
	});
	const body: Record<string, unknown> = {
		model: modelId,
		messages: mapped,
		stream: true,
		max_tokens: maxOutputTokens
	};
	if (tools.length > 0) {
		body.tools = tools.map(t => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema
			}
		}));
	}
	return body;
}

export function buildAnthropicChatPayload(
	modelId: string,
	messages: readonly NormalizedChatMessage[],
	tools: readonly NormalizedToolDef[],
	maxOutputTokens: number
): Record<string, unknown> {
	const mapped: Record<string, unknown>[] = [];
	for (const msg of messages) {
		if (msg.role === 'tool' && msg.toolCallId) {
			mapped.push({
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.text }]
			});
		} else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			const blocks: Record<string, unknown>[] = [];
			if (msg.text) {
				blocks.push({ type: 'text', text: msg.text });
			}
			for (const tc of msg.toolCalls) {
				let parsedInput: unknown = {};
				try {
					parsedInput = JSON.parse(tc.argumentsJson);
				} catch {
					parsedInput = {};
				}
				blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parsedInput });
			}
			mapped.push({ role: 'assistant', content: blocks });
		} else {
			mapped.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.text });
		}
	}
	const body: Record<string, unknown> = {
		model: modelId,
		messages: mapped,
		stream: true,
		max_tokens: maxOutputTokens
	};
	if (tools.length > 0) {
		body.tools = tools.map(t => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema
		}));
	}
	return body;
}

export interface OpenAiStreamDelta {
	readonly text?: string;
	readonly toolCallDeltas?: readonly { readonly index: number; readonly id?: string; readonly name?: string; readonly argumentsChunk?: string }[];
	readonly done?: boolean;
}

export function parseOpenAiSseLine(line: string): OpenAiStreamDelta | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) {
		return undefined;
	}
	const data = trimmed.slice(5).trim();
	if (data === '[DONE]') {
		return { done: true };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
		return undefined;
	}
	const first = parsed.choices[0];
	if (!isRecord(first) || !isRecord(first.delta)) {
		return undefined;
	}
	const delta = first.delta;
	const text = typeof delta.content === 'string' && delta.content.length > 0 ? delta.content : undefined;
	const toolCallDeltas: { index: number; id?: string; name?: string; argumentsChunk?: string }[] = [];
	if (Array.isArray(delta.tool_calls)) {
		for (const rawTc of delta.tool_calls) {
			if (!isRecord(rawTc)) {
				continue;
			}
			const index = typeof rawTc.index === 'number' && Number.isInteger(rawTc.index) ? rawTc.index : 0;
			const fn = isRecord(rawTc.function) ? rawTc.function : undefined;
			toolCallDeltas.push({
				index,
				...(typeof rawTc.id === 'string' ? { id: rawTc.id } : {}),
				...(fn && typeof fn.name === 'string' ? { name: fn.name } : {}),
				...(fn && typeof fn.arguments === 'string' ? { argumentsChunk: fn.arguments } : {})
			});
		}
	}
	if (!text && toolCallDeltas.length === 0) {
		return undefined;
	}
	return {
		...(text ? { text } : {}),
		...(toolCallDeltas.length > 0 ? { toolCallDeltas } : {})
	};
}

export interface AnthropicStreamEvent {
	readonly text?: string;
	readonly toolStart?: { readonly index: number; readonly id: string; readonly name: string };
	readonly toolInputDelta?: { readonly index: number; readonly partialJson: string };
	readonly done?: boolean;
}

export function parseAnthropicSseLine(line: string): AnthropicStreamEvent | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed.slice(5).trim());
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || typeof parsed.type !== 'string') {
		return undefined;
	}
	if (parsed.type === 'message_stop') {
		return { done: true };
	}
	if (parsed.type === 'content_block_start' && isRecord(parsed.content_block) && parsed.content_block.type === 'tool_use') {
		const index = typeof parsed.index === 'number' ? parsed.index : 0;
		const id = typeof parsed.content_block.id === 'string' ? parsed.content_block.id : `tool-${index}`;
		const name = typeof parsed.content_block.name === 'string' ? parsed.content_block.name : '';
		return name ? { toolStart: { index, id, name } } : undefined;
	}
	if (parsed.type === 'content_block_delta' && isRecord(parsed.delta)) {
		if (parsed.delta.type === 'text_delta' && typeof parsed.delta.text === 'string') {
			return { text: parsed.delta.text };
		}
		if (parsed.delta.type === 'input_json_delta' && typeof parsed.delta.partial_json === 'string') {
			const index = typeof parsed.index === 'number' ? parsed.index : 0;
			return { toolInputDelta: { index, partialJson: parsed.delta.partial_json } };
		}
	}
	return undefined;
}
