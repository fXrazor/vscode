/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 12C: `@cloudforge` VS Code open-source Chat Participant.
// Integrates directly with VS Code's built-in Chat / Agent View via slash commands
// (`/topology`, `/skills`, `/explain`, `/proposals`), backed exclusively by the Rust
// service and guarded proposal queue (zero direct workspace file mutations).

import {
	chat,
	l10n,
	type CancellationToken,
	type ChatContext,
	type ChatRequest,
	type ChatResponseStream,
	type ChatResult,
	type Disposable
} from 'vscode';
import {
	categoryLabel,
	parseChatTopologyArgs,
	parseLearningRecord,
	parseSkillsList,
	parseTopologyBlueprint,
	parseTopologyBlueprintList,
	type LearningRecord,
	type TopologyBlueprintSummary
} from './model';

export const CLOUDFORGE_CHAT_PARTICIPANT_ID = 'cloudforge.assistant';

type ServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } };

export interface ChatParticipantHost {
	callService<T>(method: string, params: Record<string, unknown>): Promise<ServiceResult<T>>;
	getActiveGraph(): { readonly workspaceId: string; readonly architectureId: string; readonly sourceRevision: string } | undefined;
	architectureName(): string | undefined;
	vscodeAgentEnabled(): boolean;
	refreshLearning(): Promise<void>;
}

function matchBlueprintId(query: string | undefined, blueprints: readonly TopologyBlueprintSummary[]): TopologyBlueprintSummary | undefined {
	if (!query) {
		return undefined;
	}
	const lower = query.toLowerCase();
	const exact = blueprints.find(bp => bp.id === lower);
	if (exact) {
		return exact;
	}
	return blueprints.find(bp =>
		bp.id.includes(lower)
		|| bp.technicalGraphPattern.includes(lower)
		|| bp.title.toLowerCase().includes(lower)
	);
}

export function registerCloudForgeChatParticipant(host: ChatParticipantHost): Disposable {
	const createParticipant = chat?.createChatParticipant;
	if (typeof createParticipant !== 'function') {
		return { dispose() { } };
	}

	const handler = async (
		request: ChatRequest,
		_context: ChatContext,
		stream: ChatResponseStream,
		token: CancellationToken
	): Promise<ChatResult> => {
		const command = request.command ?? '';
		const prompt = request.prompt.trim();
		const graph = host.getActiveGraph();
		const archName = host.architectureName();

		if (command === 'skills') {
			const res = prompt
				? await host.callService<unknown>('selectTerraformSkills', { taskKind: 'topology', prompt })
				: await host.callService<unknown>('listBuiltinSkills', {});
			if (token.isCancellationRequested) {
				return {};
			}
			const parsed = res.ok ? parseSkillsList(res.value) : undefined;
			if (!parsed || parsed.skills.length === 0) {
				stream.markdown(l10n.t('CloudForge could not load baked-in skills right now.'));
				return {};
			}
			stream.markdown(prompt
				? `### Selected CloudForge Skills for \`${prompt}\`\n\n`
				: `### Baked-in CloudForge & Terraform Skills (${parsed.skills.length})\n\n`
			);
			for (const skill of parsed.skills) {
				stream.markdown(`- **\`${skill.id}\`** (${categoryLabel(skill.category)}) — ${skill.purpose}\n`);
				if (skill.guidance.length > 0) {
					stream.markdown(`  - ${skill.guidance[0]}\n`);
				}
			}
			stream.markdown(`\n_${parsed.safetyNotice}_\n`);
			stream.button({
				command: 'cloudforge.openLearningStudio',
				title: l10n.t('Open Skills in Learning Studio'),
				arguments: ['skills']
			});
			return { metadata: { command: 'skills', count: parsed.skills.length } };
		}

		if (command === 'topology') {
			const listRes = await host.callService<unknown>('getTopologyBlueprint', {});
			if (token.isCancellationRequested) {
				return {};
			}
			const blueprints = listRes.ok ? parseTopologyBlueprintList(listRes.value) ?? [] : [];
			const parsedArgs = parseChatTopologyArgs(prompt);
			const matched = matchBlueprintId(parsedArgs.blueprintQuery, blueprints);

			if (!matched) {
				stream.markdown(`### CloudForge Starter Topology Blueprints (${blueprints.length})\n\n`);
				for (const bp of blueprints) {
					stream.markdown(`- **\`${bp.id}\`** (${bp.cloud} · pattern \`${bp.technicalGraphPattern}\`) — ${bp.summary}\n`);
				}
				stream.markdown('\nScaffold any blueprint into a reviewable proposal in one step, e.g. `@cloudforge /topology azure-hub-spoke prefix=prod-uk region=westeurope cidr=20`.\n');
				stream.button({
					command: 'cloudforge.openLearningStudio',
					title: l10n.t('Open Blueprints in Learning Studio'),
					arguments: ['blueprints']
				});
				return { metadata: { command: 'topology', mode: 'list' } };
			}

			if (!graph) {
				stream.markdown(l10n.t('Open a CloudForge architecture first so `{0}` can be submitted as a reviewable proposal.', matched.id));
				return {};
			}

			const bpRes = await host.callService<unknown>('getTopologyBlueprint', {
				blueprintId: matched.id,
				...(parsedArgs.prefix ? { prefix: parsedArgs.prefix } : {}),
				...(parsedArgs.region ? { region: parsedArgs.region } : {}),
				...(parsedArgs.cidrBaseOctet !== undefined ? { cidrBaseOctet: parsedArgs.cidrBaseOctet } : {})
			});
			const blueprint = bpRes.ok ? parseTopologyBlueprint(bpRes.value) : undefined;
			if (!blueprint) {
				stream.markdown(l10n.t('Could not customize blueprint `{0}`. Check prefix (lowercase alphanumeric/hyphens), region, or CIDR base octet (0-250).', matched.id));
				return {};
			}

			const submitted = await host.callService<unknown>('submitProposal', {
				workspaceId: graph.workspaceId,
				architectureId: graph.architectureId,
				origin: 'chat:cloudforge',
				title: blueprint.title,
				summary: blueprint.summary,
				baseSourceRevision: graph.sourceRevision,
				skillIds: [...blueprint.skillIds],
				files: blueprint.files.map(f => ({ fileName: f.fileName, contents: f.contents, rationale: f.rationale }))
			});
			if (!submitted.ok) {
				const reason = submitted.error.code === 'SCOPE_DENIED'
					? l10n.t('Imported repositories are read-only and cannot accept proposals.')
					: l10n.t('Submitting the proposal failed ({0}).', submitted.error.code);
				stream.markdown(reason);
				return {};
			}
			await host.refreshLearning();
			stream.markdown(
				`Prepared **${blueprint.title}** (\`${blueprint.id}\`, Technical Graph pattern \`${blueprint.technicalGraphPattern}\`) as a **pending proposal** on **${archName ?? 'active architecture'}**.\n\n` +
				`- Files staged for review: ${blueprint.files.map(f => `\`${f.fileName}\``).join(', ')}\n` +
				`- No workspace files were modified on disk yet. Review and apply safely in Learning Studio.\n`
			);
			stream.button({
				command: 'cloudforge.openLearningStudio',
				title: l10n.t('Review & Apply Proposal'),
				arguments: ['proposals']
			});
			return { metadata: { command: 'topology', blueprintId: blueprint.id } };
		}

		if (command === 'proposals' || command === 'explain') {
			if (!graph) {
				stream.markdown(l10n.t('Open a CloudForge architecture to inspect proposals and resource notes.'));
				return {};
			}
			const recRes = await host.callService<unknown>('getLearningRecord', {
				workspaceId: graph.workspaceId,
				architectureId: graph.architectureId
			});
			const record: LearningRecord | undefined = recRes.ok ? parseLearningRecord(recRes.value) : undefined;
			if (!record) {
				stream.markdown(l10n.t('Could not load the learning record for this architecture.'));
				return {};
			}
			if (command === 'proposals') {
				if (record.proposals.length === 0) {
					stream.markdown(l10n.t('No proposals are recorded for **{0}** yet. Try `@cloudforge /topology azure-hub-spoke` or connect an agent via the `cloudforge.mcp` server.', archName ?? 'this architecture'));
				} else {
					stream.markdown(`### Proposals for ${archName ?? 'Architecture'} (${record.proposals.length})\n\n`);
					for (const p of record.proposals) {
						stream.markdown(`- **${p.title}** — \`${p.status}\` · origin \`${p.origin}\` · ${p.files.length} file(s)\n`);
					}
				}
				stream.button({
					command: 'cloudforge.openLearningStudio',
					title: l10n.t('Open Proposals in Learning Studio'),
					arguments: ['proposals']
				});
				return { metadata: { command: 'proposals', count: record.proposals.length } };
			}

			// `/explain`
			const filter = prompt.toLowerCase();
			const entries = Object.entries(record.notes).filter(([addr]) => !filter || addr.toLowerCase().includes(filter));
			if (entries.length === 0) {
				stream.markdown(filter
					? l10n.t('No saved architecture notes match `{0}`. You can record resource rationale in Learning Studio → Task & Notes, or ask an Agent View model using the `cloudforge_explain_resource` MCP tool.', prompt)
					: l10n.t('No resource notes are recorded on **{0}** yet. Add notes in Learning Studio → Task & Notes.', archName ?? 'this architecture'));
			} else {
				stream.markdown(`### Architecture Notes (${entries.length})\n\n`);
				for (const [address, note] of entries) {
					stream.markdown(`- **\`${address}\`**\n`);
					if (note.why) {
						stream.markdown(`  - Why: ${note.why}\n`);
					}
					if (note.userNote) {
						stream.markdown(`  - Note: ${note.userNote}\n`);
					}
					for (const doc of note.docs) {
						stream.markdown(`  - Docs: [${doc.label}](${doc.url})\n`);
					}
				}
			}
			stream.button({
				command: 'cloudforge.openLearningStudio',
				title: l10n.t('Edit Notes in Learning Studio'),
				arguments: ['task']
			});
			return { metadata: { command: 'explain', count: entries.length } };
		}

		// Default overview response
		const mcpLine = host.vscodeAgentEnabled()
			? 'VS Code Agent View MCP provider **`cloudforge.mcp`** is active (8 scoped tools + live self-updating docs at `cloudforge://docs/catalogue`).'
			: 'Scoped MCP grants can be copied for Codex CLI or Claude Code from Learning Studio.';
		stream.markdown(
			`### CloudForge Assistant\n\n` +
			(archName ? `Active architecture: **${archName}** (\`rev ${graph?.sourceRevision.slice(0, 8) ?? ''}\`)\n\n` : 'No architecture is currently open.\n\n') +
			`${mcpLine}\n\n` +
			`Available commands:\n` +
			`- \`@cloudforge /topology [blueprintId] [prefix=...] [region=...] [cidr=...]\` — scaffold a multi-cloud blueprint as a reviewable proposal\n` +
			`- \`@cloudforge /skills [topic]\` — inspect baked-in CloudForge diagram, topology & Terraform skills\n` +
			`- \`@cloudforge /explain [resource]\` — read architecture rationale notes\n` +
			`- \`@cloudforge /proposals\` — review pending agent & blueprint proposals\n`
		);
		stream.button({
			command: 'cloudforge.openLearningStudio',
			title: l10n.t('Open Learning Studio'),
			arguments: ['task']
		});
		return { metadata: { command: 'overview' } };
	};

	const participant = createParticipant(CLOUDFORGE_CHAT_PARTICIPANT_ID, handler);
	return participant;
}
