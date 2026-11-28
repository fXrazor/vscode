/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AI_PROVIDER_PRESETS,
	buildAnthropicChatPayload,
	buildOpenAiChatPayload,
	isLoopbackEndpoint,
	parseAnthropicSseLine,
	parseOllamaTagsResponse,
	parseOpenAiModelsResponse,
	parseOpenAiSseLine,
	sanitizeCustomModels,
	sanitizeProvidersConfig,
	validateProviderEndpointUrl
} from '../src/ai/model.ts';

test('validates AI provider endpoints: allows loopback HTTP and remote HTTPS, blocks remote HTTP and embedded credentials', () => {
	assert.equal(validateProviderEndpointUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
	assert.equal(validateProviderEndpointUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
	assert.equal(validateProviderEndpointUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
	assert.equal(validateProviderEndpointUrl('http://api.openai.com/v1'), undefined);
	assert.equal(validateProviderEndpointUrl('https://user:pass@api.openai.com/v1'), undefined);
	assert.equal(validateProviderEndpointUrl('file:///C:/Windows/win.ini'), undefined);
	assert.equal(isLoopbackEndpoint('http://127.0.0.1:11434/v1'), true);
	assert.equal(isLoopbackEndpoint('https://api.openai.com/v1'), false);
});

test('sanitizes provider configs and custom models while rejecting unsafe endpoints', () => {
	assert.ok(AI_PROVIDER_PRESETS.some(p => p.id === 'ollama' && p.authKind === 'none'));
	assert.ok(AI_PROVIDER_PRESETS.some(p => p.id === 'lmstudio' && p.authKind === 'none'));
	assert.ok(AI_PROVIDER_PRESETS.some(p => p.id === 'github-models' && p.authKind === 'githubOAuth'));

	const providers = sanitizeProvidersConfig([
		{ id: 'vllm-local', name: 'Local vLLM', baseUrl: 'http://127.0.0.1:8000/v1', apiFormat: 'openai', authKind: 'none' },
		{ id: 'bad-http', name: 'Bad Remote', baseUrl: 'http://evil.example.com/v1', apiFormat: 'openai', authKind: 'apiKey' }
	]);
	assert.equal(providers.length, 1);
	assert.equal(providers[0].id, 'vllm-local');

	const models = sanitizeCustomModels([
		{ id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', providerId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', maxInputTokens: 65536, maxOutputTokens: 8192, toolCalling: true },
		{ id: 'bad-remote', providerId: 'custom', baseUrl: 'http://remote-plain.example.com/v1' }
	]);
	assert.equal(models.length, 1);
	assert.equal(models[0].id, 'qwen2.5-coder:14b');
});

test('parses local Ollama tags and OpenAI /v1/models discovery payloads', () => {
	const ollama = parseOllamaTagsResponse({
		models: [{ name: 'qwen2.5-coder:14b' }, { name: 'llama3.2:latest' }, { name: '' }]
	});
	assert.equal(ollama.length, 2);
	assert.equal(ollama[0].providerId, 'ollama');

	const lmStudio = parseOpenAiModelsResponse({
		data: [{ id: 'deepseek-r1-distill-qwen-14b' }]
	}, 'lmstudio', 'LM Studio');
	assert.equal(lmStudio.length, 1);
	assert.equal(lmStudio[0].name, 'deepseek-r1-distill-qwen-14b (LM Studio)');
});

test('builds OpenAI and Anthropic chat payloads with tool calling and parses SSE deltas', () => {
	const msgs = [{ role: 'user' as const, text: 'Build an Azure hub-spoke topology.' }];
	const tools = [{ name: 'cloudforge_scaffold_topology', description: 'Scaffold blueprint', inputSchema: { type: 'object' } }];

	const oai = buildOpenAiChatPayload('gpt-4.1', msgs, tools, 4096);
	assert.equal(oai.model, 'gpt-4.1');
	assert.equal(oai.stream, true);
	assert.equal((oai.tools as unknown[]).length, 1);

	const anth = buildAnthropicChatPayload('claude-sonnet-4-20250514', msgs, tools, 4096);
	assert.equal(anth.model, 'claude-sonnet-4-20250514');
	assert.equal((anth.tools as unknown[]).length, 1);

	assert.deepEqual(
		parseOpenAiSseLine('data: {"choices":[{"delta":{"content":"Hello"}}]}'),
		{ text: 'Hello' }
	);
	assert.deepEqual(parseOpenAiSseLine('data: [DONE]'), { done: true });

	const toolDelta = parseOpenAiSseLine('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"cloudforge_scaffold_topology","arguments":"{\\"blueprintId\\":\\"azure-hub-spoke\\"}"}}]}}]}');
	assert.equal(toolDelta?.toolCallDeltas?.[0].name, 'cloudforge_scaffold_topology');

	assert.deepEqual(
		parseAnthropicSseLine('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}'),
		{ text: 'Hi' }
	);
	assert.deepEqual(
		parseAnthropicSseLine('data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"cloudforge_get_guide"}}'),
		{ toolStart: { index: 1, id: 'tu_1', name: 'cloudforge_get_guide' } }
	);
});
