/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure view models, parsers, MCP config formatters, and CSP-hardened HTML rendering for
// Stage 12B (Learning Studio, Baked-in Skills, Topology Blueprints, Proposals, and Scoped MCP).
// No `vscode` imports so every parser and renderer is unit tested directly.

export type SkillCategory = 'cloudforge-diagram' | 'cloudforge-topology' | 'cloudforge-workflow' | 'terraform';

export interface PinnedSkill {
	readonly id: string;
	readonly category: SkillCategory;
	readonly repository: string;
	readonly commit: string;
	readonly version?: string;
	readonly license: string;
	readonly purpose: string;
	readonly guidance: readonly string[];
	readonly dataOnly: boolean;
}

export interface SkillsListResponse {
	readonly count: number;
	readonly categories: readonly SkillCategory[];
	readonly skills: readonly PinnedSkill[];
	readonly safetyNotice: string;
}

export interface TopologyBlueprintSummary {
	readonly id: string;
	readonly title: string;
	readonly cloud: string;
	readonly technicalGraphPattern: string;
	readonly summary: string;
	readonly skillIds: readonly string[];
	readonly fileNames: readonly string[];
}

export interface BlueprintFile {
	readonly fileName: string;
	readonly rationale: string;
	readonly contents: string;
}

export interface TopologyBlueprint {
	readonly id: string;
	readonly title: string;
	readonly cloud: string;
	readonly technicalGraphPattern: string;
	readonly summary: string;
	readonly skillIds: readonly string[];
	readonly files: readonly BlueprintFile[];
}

export type LearningMode = 'hint' | 'guided' | 'workedExample';

export interface LearningRequirement {
	readonly id: string;
	readonly text: string;
	readonly status: string;
	readonly linkedAddresses: readonly string[];
}

export interface LearningTask {
	readonly title: string;
	readonly mode: LearningMode;
	readonly objective: string;
	readonly requirements: readonly LearningRequirement[];
	readonly assumptions: readonly string[];
	readonly skillIds: readonly string[];
	readonly updatedAt?: string;
}

export interface ResourceDocLink {
	readonly label: string;
	readonly url: string;
}

export interface ResourceNote {
	readonly why?: string;
	readonly userNote?: string;
	readonly docs: readonly ResourceDocLink[];
}

export interface ProposalFile {
	readonly fileName: string;
	readonly contents: string;
	readonly rationale?: string;
}

export interface ProposalFinding {
	readonly code: string;
	readonly file: string;
	readonly line?: number;
}

export type ProposalStatus = 'pending' | 'stale' | 'accepted' | 'rejected';

export interface ProposalDraft {
	readonly proposalId: string;
	readonly origin: string;
	readonly title: string;
	readonly summary: string;
	readonly baseSourceRevision: string;
	readonly skillIds: readonly string[];
	readonly requirementIds: readonly string[];
	readonly files: readonly ProposalFile[];
	readonly findings: readonly ProposalFinding[];
	readonly status: ProposalStatus;
	readonly createdAt: string;
	readonly reviewedAt?: string;
}

export interface LearningRecord {
	readonly workspaceId: string;
	readonly architectureId: string;
	readonly sourceRevision: string;
	readonly task?: LearningTask;
	readonly notes: Readonly<Record<string, ResourceNote>>;
	readonly proposals: readonly ProposalDraft[];
	readonly availableSkills: readonly PinnedSkill[];
}

export interface McpGrantSummary {
	readonly grantIdPreview: string;
	readonly displayName: string;
	readonly clientLabel: string;
	readonly readOnly: boolean;
	readonly createdAt: string;
	readonly expiresAtEpoch: number;
	readonly active: boolean;
	readonly revoked: boolean;
}

export interface IssuedMcpGrant extends McpGrantSummary {
	readonly grantId: string;
	readonly mcpArgs: readonly string[];
	readonly mcpCommand: string;
}

export type LearningStudioTab = 'task' | 'proposals' | 'skills' | 'blueprints' | 'agents';

export interface LearningStudioViewState {
	readonly architectureName?: string;
	readonly sourceRevision?: string;
	readonly activeTab: LearningStudioTab;
	readonly skillCategoryFilter: SkillCategory | 'all';
	readonly record?: LearningRecord;
	readonly skills: readonly PinnedSkill[];
	readonly safetyNotice?: string;
	readonly blueprints: readonly TopologyBlueprintSummary[];
	readonly grants: readonly McpGrantSummary[];
	readonly vscodeAgentEnabled: boolean;
	readonly statusMessage?: string;
}

export interface ChatTopologyArgs {
	readonly blueprintQuery?: string;
	readonly prefix?: string;
	readonly region?: string;
	readonly cidrBaseOctet?: number;
}

export type LearningStudioMessage =
	| { readonly type: 'switchTab'; readonly tab: LearningStudioTab }
	| { readonly type: 'filterSkills'; readonly category: SkillCategory | 'all' }
	| { readonly type: 'applyProposal'; readonly proposalId: string }
	| { readonly type: 'rejectProposal'; readonly proposalId: string }
	| { readonly type: 'diffProposalFile'; readonly proposalId: string; readonly fileName: string }
	| { readonly type: 'proposeBlueprint'; readonly blueprintId: string; readonly prefix?: string; readonly region?: string; readonly cidrBaseOctet?: number }
	| { readonly type: 'saveTask'; readonly title: string; readonly mode: LearningMode; readonly objective: string; readonly newRequirement?: string }
	| { readonly type: 'toggleRequirement'; readonly requirementId: string }
	| { readonly type: 'saveNote'; readonly address: string; readonly why?: string; readonly userNote?: string; readonly docLabel?: string; readonly docUrl?: string }
	| { readonly type: 'exportStudyGuide' }
	| { readonly type: 'copyMcpConfig'; readonly client: 'codex' | 'claude-code' }
	| { readonly type: 'revokeGrant'; readonly grantIdPreview: string }
	| { readonly type: 'refresh' };

const SKILL_CATEGORIES: ReadonlySet<string> = new Set<SkillCategory>([
	'cloudforge-diagram',
	'cloudforge-topology',
	'cloudforge-workflow',
	'terraform'
]);

const LEARNING_MODES: ReadonlySet<string> = new Set<LearningMode>(['hint', 'guided', 'workedExample']);
const PROPOSAL_STATUSES: ReadonlySet<string> = new Set<ProposalStatus>(['pending', 'stale', 'accepted', 'rejected']);
const STUDIO_TABS: ReadonlySet<string> = new Set<LearningStudioTab>(['task', 'proposals', 'skills', 'blueprints', 'agents']);

export function parseChatTopologyArgs(prompt: string): ChatTopologyArgs {
	const tokens = prompt.trim().split(/\s+/).filter(Boolean);
	let blueprintQuery: string | undefined;
	let prefix: string | undefined;
	let region: string | undefined;
	let cidrBaseOctet: number | undefined;
	for (const token of tokens) {
		const eq = token.indexOf('=');
		if (eq > 0) {
			const key = token.slice(0, eq).toLowerCase();
			const val = token.slice(eq + 1).trim();
			if ((key === 'prefix' || key === 'name') && /^[a-z][a-z0-9-]{1,23}$/.test(val) && !val.endsWith('-')) {
				prefix = val;
			} else if ((key === 'region' || key === 'location') && /^[a-z0-9-]{2,32}$/.test(val)) {
				region = val;
			} else if ((key === 'cidr' || key === 'octet' || key === 'cidrbaseoctet') && /^\d{1,3}$/.test(val)) {
				const parsed = Number(val);
				if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 250) {
					cidrBaseOctet = parsed;
				}
			}
		} else if (!blueprintQuery) {
			blueprintQuery = token;
		}
	}
	return {
		...(blueprintQuery ? { blueprintQuery } : {}),
		...(prefix ? { prefix } : {}),
		...(region ? { region } : {}),
		...(cidrBaseOctet !== undefined ? { cidrBaseOctet } : {})
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 2048): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function optStr(value: unknown, max = 4096): string | undefined {
	return typeof value === 'string' && value.length <= max ? value : undefined;
}

function strList(value: unknown, maxItems = 64, maxLen = 512): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: string[] = [];
	for (const item of value.slice(0, maxItems)) {
		const s = str(item, maxLen);
		if (s) {
			out.push(s);
		}
	}
	return out;
}

export function parsePinnedSkill(value: unknown): PinnedSkill | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = str(value.id, 128);
	const category = typeof value.category === 'string' && SKILL_CATEGORIES.has(value.category) ? value.category as SkillCategory : undefined;
	const repository = str(value.repository, 256);
	const commit = str(value.commit, 128);
	const license = str(value.license, 64);
	const purpose = str(value.purpose, 1024);
	if (!id || !category || !repository || !commit || !license || !purpose) {
		return undefined;
	}
	const version = str(value.version, 64);
	const guidance = strList(value.guidance, 32, 1024);
	return {
		id,
		category,
		repository,
		commit,
		...(version ? { version } : {}),
		license,
		purpose,
		guidance,
		dataOnly: value.dataOnly !== false
	};
}

export function parseSkillsList(value: unknown): SkillsListResponse | undefined {
	if (!isRecord(value) || !Array.isArray(value.skills)) {
		return undefined;
	}
	const skills: PinnedSkill[] = [];
	for (const raw of value.skills.slice(0, 64)) {
		const parsed = parsePinnedSkill(raw);
		if (parsed) {
			skills.push(parsed);
		}
	}
	const categories: SkillCategory[] = Array.isArray(value.categories)
		? value.categories.filter((c): c is SkillCategory => typeof c === 'string' && SKILL_CATEGORIES.has(c))
		: ['cloudforge-diagram', 'cloudforge-topology', 'cloudforge-workflow', 'terraform'];
	const safetyNotice = str(value.safetyNotice, 512) ?? 'Pinned and built-in skill instructions are data-only guidance.';
	return {
		count: skills.length,
		categories,
		skills,
		safetyNotice
	};
}

export function parseTopologyBlueprintList(value: unknown): TopologyBlueprintSummary[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.blueprints)) {
		return undefined;
	}
	const out: TopologyBlueprintSummary[] = [];
	for (const item of value.blueprints.slice(0, 32)) {
		if (!isRecord(item)) {
			continue;
		}
		const id = str(item.id, 64);
		const title = str(item.title, 200);
		const cloud = str(item.cloud, 64);
		const technicalGraphPattern = str(item.technicalGraphPattern, 128);
		const summary = str(item.summary, 1024);
		if (!id || !title || !cloud || !technicalGraphPattern || !summary) {
			continue;
		}
		out.push({
			id,
			title,
			cloud,
			technicalGraphPattern,
			summary,
			skillIds: strList(item.skillIds, 16, 128),
			fileNames: strList(item.fileNames, 16, 128)
		});
	}
	return out;
}

export function parseTopologyBlueprint(value: unknown): TopologyBlueprint | undefined {
	if (!isRecord(value) || !Array.isArray(value.files)) {
		return undefined;
	}
	const id = str(value.id, 64);
	const title = str(value.title, 200);
	const cloud = str(value.cloud, 64);
	const technicalGraphPattern = str(value.technicalGraphPattern, 128);
	const summary = str(value.summary, 1024);
	if (!id || !title || !cloud || !technicalGraphPattern || !summary) {
		return undefined;
	}
	const files: BlueprintFile[] = [];
	for (const item of value.files.slice(0, 16)) {
		if (!isRecord(item)) {
			continue;
		}
		const fileName = str(item.fileName, 128);
		const rationale = optStr(item.rationale, 512) ?? '';
		const contents = typeof item.contents === 'string' && item.contents.length <= 512 * 1024 ? item.contents : undefined;
		if (fileName && contents !== undefined) {
			files.push({ fileName, rationale, contents });
		}
	}
	if (files.length === 0) {
		return undefined;
	}
	return {
		id,
		title,
		cloud,
		technicalGraphPattern,
		summary,
		skillIds: strList(value.skillIds, 16, 128),
		files
	};
}

export function parseProposalDraft(value: unknown): ProposalDraft | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const proposalId = str(value.proposalId, 128);
	const origin = str(value.origin, 64);
	const title = str(value.title, 200);
	const summary = optStr(value.summary, 2000) ?? '';
	const baseSourceRevision = str(value.baseSourceRevision, 128);
	const status = typeof value.status === 'string' && PROPOSAL_STATUSES.has(value.status) ? value.status as ProposalStatus : undefined;
	const createdAt = str(value.createdAt, 64) ?? '';
	if (!proposalId || !origin || !title || !baseSourceRevision || !status || !Array.isArray(value.files)) {
		return undefined;
	}
	const files: ProposalFile[] = [];
	for (const item of value.files.slice(0, 16)) {
		if (!isRecord(item)) {
			continue;
		}
		const fileName = str(item.fileName, 128);
		const contents = typeof item.contents === 'string' && item.contents.length <= 512 * 1024 ? item.contents : undefined;
		const rationale = str(item.rationale, 512);
		if (fileName && contents !== undefined) {
			files.push({ fileName, contents, ...(rationale ? { rationale } : {}) });
		}
	}
	const findings: ProposalFinding[] = [];
	if (Array.isArray(value.findings)) {
		for (const item of value.findings.slice(0, 64)) {
			if (!isRecord(item)) {
				continue;
			}
			const code = str(item.code, 64);
			const file = str(item.file, 128);
			const line = typeof item.line === 'number' && Number.isInteger(item.line) && item.line > 0 ? item.line : undefined;
			if (code && file) {
				findings.push({ code, file, ...(line !== undefined ? { line } : {}) });
			}
		}
	}
	const reviewedAt = str(value.reviewedAt, 64);
	return {
		proposalId,
		origin,
		title,
		summary,
		baseSourceRevision,
		skillIds: strList(value.skillIds, 16, 128),
		requirementIds: strList(value.requirementIds, 64, 128),
		files,
		findings,
		status,
		createdAt,
		...(reviewedAt ? { reviewedAt } : {})
	};
}

export function parseLearningRecord(value: unknown): LearningRecord | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const workspaceId = str(value.workspaceId, 256);
	const architectureId = str(value.architectureId, 256);
	const sourceRevision = str(value.sourceRevision, 128);
	if (!workspaceId || !architectureId || !sourceRevision) {
		return undefined;
	}
	let task: LearningTask | undefined;
	if (isRecord(value.task)) {
		const title = str(value.task.title, 200);
		const mode = typeof value.task.mode === 'string' && LEARNING_MODES.has(value.task.mode) ? value.task.mode as LearningMode : undefined;
		const objective = optStr(value.task.objective, 4000) ?? '';
		if (title && mode) {
			const requirements: LearningRequirement[] = [];
			if (Array.isArray(value.task.requirements)) {
				for (const req of value.task.requirements.slice(0, 64)) {
					if (!isRecord(req)) {
						continue;
					}
					const id = str(req.id, 64);
					const text = str(req.text, 512);
					const status = str(req.status, 32) ?? 'open';
					if (id && text) {
						requirements.push({ id, text, status, linkedAddresses: strList(req.linkedAddresses, 32, 256) });
					}
				}
			}
			const updatedAt = str(value.task.updatedAt, 64);
			task = {
				title,
				mode,
				objective,
				requirements,
				assumptions: strList(value.task.assumptions, 32, 512),
				skillIds: strList(value.task.skillIds, 16, 128),
				...(updatedAt ? { updatedAt } : {})
			};
		}
	}
	const notes: Record<string, ResourceNote> = {};
	if (isRecord(value.notes)) {
		for (const [address, rawNote] of Object.entries(value.notes).slice(0, 256)) {
			if (!isRecord(rawNote)) {
				continue;
			}
			const why = str(rawNote.why, 2000);
			const userNote = str(rawNote.userNote, 2000);
			const docs: ResourceDocLink[] = [];
			if (Array.isArray(rawNote.docs)) {
				for (const doc of rawNote.docs.slice(0, 8)) {
					if (!isRecord(doc)) {
						continue;
					}
					const label = str(doc.label, 128);
					const url = str(doc.url, 512);
					if (label && url && url.startsWith('https://')) {
						docs.push({ label, url });
					}
				}
			}
			notes[address] = {
				...(why ? { why } : {}),
				...(userNote ? { userNote } : {}),
				docs
			};
		}
	}
	const proposals: ProposalDraft[] = [];
	if (Array.isArray(value.proposals)) {
		for (const item of value.proposals.slice(0, 64)) {
			const parsed = parseProposalDraft(item);
			if (parsed) {
				proposals.push(parsed);
			}
		}
	}
	const availableSkills: PinnedSkill[] = [];
	if (Array.isArray(value.availableSkills)) {
		for (const item of value.availableSkills.slice(0, 64)) {
			const parsed = parsePinnedSkill(item);
			if (parsed) {
				availableSkills.push(parsed);
			}
		}
	}
	return {
		workspaceId,
		architectureId,
		sourceRevision,
		...(task ? { task } : {}),
		notes,
		proposals,
		availableSkills
	};
}

export function parseMcpGrantsList(value: unknown): McpGrantSummary[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.grants)) {
		return undefined;
	}
	const out: McpGrantSummary[] = [];
	for (const item of value.grants.slice(0, 64)) {
		if (!isRecord(item)) {
			continue;
		}
		const grantIdPreview = str(item.grantIdPreview, 64) ?? str(item.grantId, 64);
		const displayName = str(item.displayName, 256);
		const clientLabel = str(item.clientLabel, 64) ?? 'external-client';
		const createdAt = str(item.createdAt, 64) ?? '';
		const expiresAtEpoch = typeof item.expiresAtEpoch === 'number' && Number.isFinite(item.expiresAtEpoch) ? item.expiresAtEpoch : 0;
		if (!grantIdPreview || !displayName) {
			continue;
		}
		out.push({
			grantIdPreview,
			displayName,
			clientLabel,
			readOnly: Boolean(item.readOnly),
			createdAt,
			expiresAtEpoch,
			active: Boolean(item.active),
			revoked: Boolean(item.revoked)
		});
	}
	return out;
}

export function parseIssuedMcpGrant(value: unknown): IssuedMcpGrant | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const grantId = str(value.grantId, 128);
	const grantIdPreview = str(value.grantIdPreview, 64) ?? grantId;
	const displayName = str(value.displayName, 256);
	const clientLabel = str(value.clientLabel, 64) ?? 'external-client';
	const createdAt = str(value.createdAt, 64) ?? '';
	const expiresAtEpoch = typeof value.expiresAtEpoch === 'number' && Number.isFinite(value.expiresAtEpoch) ? value.expiresAtEpoch : 0;
	const mcpCommand = str(value.mcpCommand, 4096);
	const mcpArgs = strList(value.mcpArgs, 16, 256);
	if (!grantId || !grantIdPreview || !displayName || !mcpCommand || mcpArgs.length === 0) {
		return undefined;
	}
	return {
		grantId,
		grantIdPreview,
		displayName,
		clientLabel,
		readOnly: Boolean(value.readOnly),
		createdAt,
		expiresAtEpoch,
		active: Boolean(value.active),
		revoked: Boolean(value.revoked),
		mcpArgs,
		mcpCommand
	};
}

export function buildExternalMcpConfigSnippet(client: 'codex' | 'claude-code', grant: IssuedMcpGrant): string {
	if (client === 'codex') {
		const escapedCmd = grant.mcpCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		const escapedArgs = grant.mcpArgs.map(arg => `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
		return [
			`# CloudForge scoped MCP grant (${grant.displayName}, revocable in CloudForge)`,
			'[mcp_servers.cloudforge]',
			`command = "${escapedCmd}"`,
			`args = [${escapedArgs}]`,
		].join('\n');
	}
	return JSON.stringify({
		mcpServers: {
			cloudforge: {
				command: grant.mcpCommand,
				args: [...grant.mcpArgs]
			}
		}
	}, null, 2);
}

export function categoryLabel(category: SkillCategory): string {
	switch (category) {
		case 'cloudforge-diagram': return 'Diagrams & Learning';
		case 'cloudforge-topology': return 'Multi-Cloud Topologies';
		case 'cloudforge-workflow': return 'AI Agent Workflow';
		case 'terraform': return 'Terraform Standards';
	}
}

export function parseLearningStudioMessage(raw: unknown): LearningStudioMessage | undefined {
	if (!isRecord(raw) || typeof raw.type !== 'string') {
		return undefined;
	}
	switch (raw.type) {
		case 'switchTab':
			return typeof raw.tab === 'string' && STUDIO_TABS.has(raw.tab)
				? { type: 'switchTab', tab: raw.tab as LearningStudioTab }
				: undefined;
		case 'filterSkills':
			return raw.category === 'all' || (typeof raw.category === 'string' && SKILL_CATEGORIES.has(raw.category))
				? { type: 'filterSkills', category: raw.category as SkillCategory | 'all' }
				: undefined;
		case 'applyProposal':
		case 'rejectProposal': {
			const proposalId = str(raw.proposalId, 128);
			return proposalId ? { type: raw.type, proposalId } : undefined;
		}
		case 'diffProposalFile': {
			const proposalId = str(raw.proposalId, 128);
			const fileName = str(raw.fileName, 128);
			if (!proposalId || !fileName || fileName.startsWith('.') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..') || !fileName.toLowerCase().endsWith('.tf') || fileName.length <= 3) {
				return undefined;
			}
			return { type: 'diffProposalFile', proposalId, fileName };
		}
		case 'proposeBlueprint': {
			const blueprintId = str(raw.blueprintId, 64);
			if (!blueprintId || !/^[a-z0-9-]+$/.test(blueprintId)) {
				return undefined;
			}
			const rawPrefix = typeof raw.prefix === 'string' ? raw.prefix.trim() : '';
			const prefix = rawPrefix.length > 0 && /^[a-z][a-z0-9-]{1,23}$/.test(rawPrefix) && !rawPrefix.endsWith('-') ? rawPrefix : undefined;
			const rawRegion = typeof raw.region === 'string' ? raw.region.trim() : '';
			const region = rawRegion.length > 0 && /^[a-z0-9-]{2,32}$/.test(rawRegion) ? rawRegion : undefined;
			const rawOctet = typeof raw.cidrBaseOctet === 'number'
				? raw.cidrBaseOctet
				: typeof raw.cidrBaseOctet === 'string' && /^\d{1,3}$/.test(raw.cidrBaseOctet.trim())
					? Number(raw.cidrBaseOctet.trim())
					: undefined;
			const cidrBaseOctet = rawOctet !== undefined && Number.isInteger(rawOctet) && rawOctet >= 0 && rawOctet <= 250 ? rawOctet : undefined;
			return {
				type: 'proposeBlueprint',
				blueprintId,
				...(prefix ? { prefix } : {}),
				...(region ? { region } : {}),
				...(cidrBaseOctet !== undefined ? { cidrBaseOctet } : {})
			};
		}
		case 'saveTask': {
			const title = str(typeof raw.title === 'string' ? raw.title.trim() : '', 200);
			const mode = typeof raw.mode === 'string' && LEARNING_MODES.has(raw.mode) ? raw.mode as LearningMode : undefined;
			const objective = optStr(typeof raw.objective === 'string' ? raw.objective.trim() : '', 4000) ?? '';
			const newRequirement = str(typeof raw.newRequirement === 'string' ? raw.newRequirement.trim() : '', 512);
			return title && mode
				? { type: 'saveTask', title, mode, objective, ...(newRequirement ? { newRequirement } : {}) }
				: undefined;
		}
		case 'toggleRequirement': {
			const requirementId = str(raw.requirementId, 64);
			return requirementId ? { type: 'toggleRequirement', requirementId } : undefined;
		}
		case 'saveNote': {
			const address = str(typeof raw.address === 'string' ? raw.address.trim() : '', 256);
			if (!address || !/^[A-Za-z0-9._\-\[\]"]+$/.test(address)) {
				return undefined;
			}
			const why = str(typeof raw.why === 'string' ? raw.why.trim() : '', 2000);
			const userNote = str(typeof raw.userNote === 'string' ? raw.userNote.trim() : '', 2000);
			const docLabel = str(typeof raw.docLabel === 'string' ? raw.docLabel.trim() : '', 128);
			const docUrl = str(typeof raw.docUrl === 'string' ? raw.docUrl.trim() : '', 512);
			return {
				type: 'saveNote',
				address,
				...(why ? { why } : {}),
				...(userNote ? { userNote } : {}),
				...(docLabel && docUrl && docUrl.startsWith('https://') ? { docLabel, docUrl } : {})
			};
		}
		case 'copyMcpConfig':
			return raw.client === 'codex' || raw.client === 'claude-code'
				? { type: 'copyMcpConfig', client: raw.client }
				: undefined;
		case 'revokeGrant': {
			const grantIdPreview = str(raw.grantIdPreview, 128);
			return grantIdPreview ? { type: 'revokeGrant', grantIdPreview } : undefined;
		}
		case 'exportStudyGuide':
			return { type: 'exportStudyGuide' };
		case 'refresh':
			return { type: 'refresh' };
		default:
			return undefined;
	}
}

const ALLOWED_DOC_HOSTS: ReadonlySet<string> = new Set([
	'registry.terraform.io',
	'learn.microsoft.com',
	'docs.aws.amazon.com',
	'cloud.google.com',
	'developer.hashicorp.com',
	'opentofu.org'
]);

function escapeMarkdownText(value: string): string {
	return value.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, ch => `\\${ch}`);
}

export function isAllowlistedDocUrl(raw: string): boolean {
	if (!raw.startsWith('https://') || raw.length > 512 || /[\s()<>]/.test(raw)) {
		return false;
	}
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.port === '' && ALLOWED_DOC_HOSTS.has(parsed.hostname.toLowerCase());
	} catch {
		return false;
	}
}

export function formatLearningNoteHoverMarkdown(
	address: string,
	note: ResourceNote | undefined,
	linkedRequirements: readonly LearningRequirement[]
): string | undefined {
	if (!note && linkedRequirements.length === 0) {
		return undefined;
	}
	const lines: string[] = [`$(note) **CloudForge Learning Note** — \`${address.replace(/`/g, '')}\``];
	if (note?.why) {
		lines.push(`\n**Why:** ${escapeMarkdownText(note.why)}`);
	}
	if (note?.userNote) {
		lines.push(`\n**Note:** ${escapeMarkdownText(note.userNote)}`);
	}
	if (linkedRequirements.length > 0) {
		lines.push('\n**Lab requirements:**');
		for (const req of linkedRequirements) {
			const mark = req.status === 'addressed' ? '✓' : '○';
			lines.push(`- ${mark} ${escapeMarkdownText(req.text)}`);
		}
	}
	const safeDocs = (note?.docs ?? []).filter(doc => isAllowlistedDocUrl(doc.url));
	if (safeDocs.length > 0) {
		lines.push('\n**Docs:** ' + safeDocs.map(doc => `[${escapeMarkdownText(doc.label)}](${doc.url})`).join(' · '));
	}
	const editArgs = encodeURIComponent(JSON.stringify([address]));
	lines.push(`\n[Edit note](command:cloudforge.addResourceNote?${editArgs}) · [Open Learning Studio](command:cloudforge.openLearningStudio?%5B%22task%22%5D)`);
	return lines.join('\n');
}

export interface StudyGuideGraphNode {
	readonly kind: string;
	readonly resourceType: string | null;
	readonly name: string;
	readonly label: string;
}

export interface StudyGuideInput {
	readonly architectureName: string;
	readonly sourceRevision: string;
	readonly nodes: readonly StudyGuideGraphNode[];
	readonly edgeCount: number;
	readonly record?: LearningRecord;
	readonly skills: readonly PinnedSkill[];
}

export function buildArchitectureStudyGuideMarkdown(input: StudyGuideInput): string {
	const lines: string[] = [
		`# ${input.architectureName} — Architecture Study Guide`,
		'',
		`- **Source revision:** \`${input.sourceRevision.slice(0, 12)}\``,
		`- **Topology:** ${input.nodes.length} node(s), ${input.edgeCount} dependency edge(s)`,
		''
	];

	const task = input.record?.task;
	if (task) {
		const done = task.requirements.filter(r => r.status === 'addressed').length;
		lines.push(`## Learning Task: ${task.title}`);
		lines.push('');
		lines.push(`- **Guidance mode:** \`${task.mode}\``);
		if (task.objective) {
			lines.push(`- **Objective:** ${task.objective}`);
		}
		if (task.assumptions.length > 0) {
			lines.push(`- **Assumptions:** ${task.assumptions.join('; ')}`);
		}
		lines.push('');
		if (task.requirements.length > 0) {
			lines.push(`### Requirements Checklist (${done}/${task.requirements.length} addressed)`);
			lines.push('');
			for (const req of task.requirements) {
				const box = req.status === 'addressed' ? '[x]' : '[ ]';
				const linked = req.linkedAddresses.length > 0 ? ` — ${req.linkedAddresses.map(a => `\`${a}\``).join(', ')}` : '';
				lines.push(`- ${box} ${req.text}${linked}`);
			}
			lines.push('');
		}
	}

	const notesEntries = Object.entries(input.record?.notes ?? {});
	if (notesEntries.length > 0) {
		lines.push(`## Resource Design Rationale (${notesEntries.length})`);
		lines.push('');
		for (const [address, note] of notesEntries) {
			lines.push(`### \`${address}\``);
			if (note.why) {
				lines.push(`- **Why:** ${note.why}`);
			}
			if (note.userNote) {
				lines.push(`- **Study note:** ${note.userNote}`);
			}
			const safeDocs = note.docs.filter(d => isAllowlistedDocUrl(d.url));
			if (safeDocs.length > 0) {
				lines.push(`- **Official docs:** ${safeDocs.map(d => `[${d.label}](${d.url})`).join(' · ')}`);
			}
			lines.push('');
		}
	}

	if (input.nodes.length > 0) {
		lines.push(`## Architecture Components (${input.nodes.length})`);
		lines.push('');
		lines.push('| Kind | Type | Label |');
		lines.push('| --- | --- | --- |');
		for (const node of input.nodes.slice(0, 100)) {
			lines.push(`| ${node.kind} | \`${node.resourceType ?? '-'}\` | ${node.label} |`);
		}
		lines.push('');
	}

	const proposals = input.record?.proposals ?? [];
	if (proposals.length > 0) {
		lines.push(`## Proposal Journal (${proposals.length})`);
		lines.push('');
		for (const p of proposals) {
			lines.push(`- **${p.title}** (\`${p.status}\`, origin \`${p.origin}\`) — ${p.files.map(f => `\`${f.fileName}\``).join(', ')}`);
		}
		lines.push('');
	}

	const linkedSkillIds = new Set(task?.skillIds ?? []);
	const relevantSkills = linkedSkillIds.size > 0
		? input.skills.filter(s => linkedSkillIds.has(s.id))
		: input.skills.slice(0, 4);
	if (relevantSkills.length > 0) {
		lines.push('## Referenced CloudForge Skills');
		lines.push('');
		for (const skill of relevantSkills) {
			lines.push(`- **\`${skill.id}\`** (${categoryLabel(skill.category)}) — ${skill.purpose}`);
		}
		lines.push('');
	}

	lines.push('---');
	lines.push('_Generated locally by CloudForge (zero secret values or local OS paths included)._');
	lines.push('');
	return lines.join('\n');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function cloudColor(cloud: string): string {
	switch (cloud.toLowerCase()) {
		case 'azure': return '#0078D4';
		case 'aws': return '#D97706';
		case 'gcp': return '#2563EB';
		default: return '#4F46E5';
	}
}

function statusBadge(status: ProposalStatus): string {
	const colors: Record<ProposalStatus, string> = {
		pending: '#D97706',
		accepted: '#16A34A',
		stale: '#DC2626',
		rejected: '#6B7280'
	};
	const labels: Record<ProposalStatus, string> = {
		pending: 'Pending review',
		accepted: 'Applied',
		stale: 'Source changed',
		rejected: 'Rejected'
	};
	return `<span class="badge" style="--badge-color:${colors[status]}">${labels[status]}</span>`;
}

export function buildLearningStudioHtml(state: LearningStudioViewState, nonce: string): string {
	const proposals = state.record?.proposals ?? [];
	const pendingCount = proposals.filter(p => p.status === 'pending').length;
	const filteredSkills = state.skillCategoryFilter === 'all'
		? state.skills
		: state.skills.filter(s => s.category === state.skillCategoryFilter);

	const navItem = (tab: LearningStudioTab, label: string, count?: number): string => {
		const active = state.activeTab === tab ? ' aria-current="page" class="nav-btn active"' : ' class="nav-btn"';
		const pill = count !== undefined ? `<span class="nav-count">${count}</span>` : '';
		return `<button type="button" data-action="switchTab" data-tab="${tab}"${active}><span>${escapeHtml(label)}</span>${pill}</button>`;
	};

	let bodyHtml = '';
	if (state.activeTab === 'task') {
		if (!state.architectureName) {
			bodyHtml = `
				<section class="empty-block">
					<h2>No architecture selected</h2>
					<p>Open a CloudForge project or Terraform folder to record a learning task, track requirement checklists, and attach resource rationale notes.</p>
				</section>`;
		} else {
			const task = state.record?.task;
			const modeOpt = (m: LearningMode, label: string) => `<option value="${m}"${(task?.mode ?? 'guided') === m ? ' selected' : ''}>${label}</option>`;
			const checklistHtml = (task?.requirements ?? []).length === 0
				? '<p class="muted">No requirements yet. Add one below to track progress against your Terraform resources.</p>'
				: `<ul class="checklist">${(task?.requirements ?? []).map(req => {
					const done = req.status === 'addressed';
					return `<li class="${done ? 'done' : ''}">
						<button type="button" class="check-btn" data-action="toggleRequirement" data-id="${escapeHtml(req.id)}" aria-pressed="${done}">${done ? '✓' : '○'}</button>
						<span>${escapeHtml(req.text)}${req.linkedAddresses.length ? ` <span class="muted">${req.linkedAddresses.map(a => `<code>${escapeHtml(a)}</code>`).join(', ')}</span>` : ''}</span>
					</li>`;
				}).join('')}</ul>`;
			const notesEntries = Object.entries(state.record?.notes ?? {});
			const notesListHtml = notesEntries.length === 0
				? '<p class="muted">No resource rationale notes saved for this architecture yet.</p>'
				: notesEntries.map(([addr, note]) => `
					<div class="note-card">
						<h4><code>${escapeHtml(addr)}</code></h4>
						${note.why ? `<p class="prose"><strong>Why:</strong> ${escapeHtml(note.why)}</p>` : ''}
						${note.userNote ? `<p class="prose"><strong>Note:</strong> ${escapeHtml(note.userNote)}</p>` : ''}
						${note.docs.length ? `<div class="meta">Docs: ${note.docs.map(d => `<code>${escapeHtml(d.label)}</code> (${escapeHtml(d.url)})`).join(' · ')}</div>` : ''}
					</div>`).join('');
			bodyHtml = `
				<section class="entry">
					<h3>Learning task &amp; checklist</h3>
					<p class="notice">Stored locally in CloudForge service data (never modifies your Git repository or Terraform files).</p>
					<form id="task-form" class="form-grid">
						<label>Task title<input name="title" type="text" maxlength="200" value="${escapeHtml(task?.title ?? '')}" placeholder="e.g. Build Azure Hub-and-Spoke lab" required></label>
						<label>Guidance mode<select name="mode">${modeOpt('hint', 'Hint only')}${modeOpt('guided', 'Guided checklist')}${modeOpt('workedExample', 'Worked example')}</select></label>
						<label class="full">Objective<textarea name="objective" rows="2" maxlength="4000" placeholder="What should this architecture achieve?">${escapeHtml(task?.objective ?? '')}</textarea></label>
						<label class="full">Add requirement (optional)<input name="newRequirement" type="text" maxlength="512" placeholder="e.g. Provision disjoint hub and spoke VNets with NSGs"></label>
						<div class="row-actions full">
							<button type="submit" class="primary-btn">Save learning task</button>
							<button type="button" class="ghost-btn" data-action="exportStudyGuide">Export study guide (Markdown)</button>
						</div>
					</form>
					${checklistHtml}
				</section>
				<section class="entry">
					<h3>Resource rationale notes (${notesEntries.length})</h3>
					${notesListHtml}
					<form id="note-form" class="form-grid">
						<label>Resource address<input name="address" type="text" maxlength="256" placeholder="e.g. azurerm_virtual_network.hub" required></label>
						<label>Design rationale (why)<input name="why" type="text" maxlength="2000" placeholder="Why does this resource exist?"></label>
						<label class="full">Learner note<input name="userNote" type="text" maxlength="2000" placeholder="Personal study note or reminder"></label>
						<label>Official doc label (optional)<input name="docLabel" type="text" maxlength="128" placeholder="e.g. Azure VNet Docs"></label>
						<label>Official HTTPS doc URL (optional)<input name="docUrl" type="url" maxlength="512" placeholder="https://learn.microsoft.com/..."></label>
						<div class="row-actions full"><button type="submit" class="ghost-btn">Save resource note</button></div>
					</form>
				</section>`;
		}
	} else if (state.activeTab === 'proposals') {
		if (!state.architectureName) {
			bodyHtml = `
				<section class="empty-block">
					<h2>No architecture selected</h2>
					<p>Open a CloudForge project or Terraform folder to review AI proposals, track learning tasks, and inspect architecture notes.</p>
				</section>`;
		} else if (proposals.length === 0) {
			bodyHtml = `
				<section class="empty-block">
					<h2>No proposals waiting for review</h2>
					<p>Changes submitted by VS Code Agent View, Codex CLI, Claude Code, or Starter Blueprints appear here before any Terraform file is written.</p>
					<button type="button" class="primary-btn" data-action="switchTab" data-tab="blueprints">Browse starter blueprints</button>
				</section>`;
		} else {
			bodyHtml = proposals.map(proposal => {
				const findingsHtml = proposal.findings.length > 0
					? `<div class="warning-strip">Sensitive literal check flagged ${proposal.findings.length} line(s): ${proposal.findings.map(f => `<code>${escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</code>`).join(', ')}</div>`
					: '';
				const filesHtml = proposal.files.map(file => `
					<details class="file-preview">
						<summary class="file-summary">
							<span><code>${escapeHtml(file.fileName)}</code>${file.rationale ? ` <span class="muted">${escapeHtml(file.rationale)}</span>` : ''}</span>
							<button type="button" class="mini-btn" data-action="diffProposalFile" data-id="${escapeHtml(proposal.proposalId)}" data-file="${escapeHtml(file.fileName)}">Open diff</button>
						</summary>
						<pre><code>${escapeHtml(file.contents)}</code></pre>
					</details>`).join('');
				const actionsHtml = proposal.status === 'pending'
					? `<div class="row-actions">
						<button type="button" class="primary-btn" data-action="applyProposal" data-id="${escapeHtml(proposal.proposalId)}">Preview &amp; apply changes</button>
						<button type="button" class="ghost-btn" data-action="rejectProposal" data-id="${escapeHtml(proposal.proposalId)}">Reject proposal</button>
					</div>`
					: '';
				return `
					<article class="entry">
						<div class="entry-head">
							<div>
								<h3>${escapeHtml(proposal.title)}</h3>
								<div class="meta">Origin: <code>${escapeHtml(proposal.origin)}</code> · ${proposal.files.length} file(s) · rev <code>${escapeHtml(proposal.baseSourceRevision.slice(0, 8))}</code></div>
							</div>
							${statusBadge(proposal.status)}
						</div>
						${proposal.summary ? `<p class="prose">${escapeHtml(proposal.summary)}</p>` : ''}
						${findingsHtml}
						${filesHtml}
						${actionsHtml}
					</article>`;
			}).join('');
		}
	} else if (state.activeTab === 'skills') {
		const filters: { id: SkillCategory | 'all'; label: string }[] = [
			{ id: 'all', label: `All (${state.skills.length})` },
			{ id: 'cloudforge-diagram', label: 'Diagrams & Learning' },
			{ id: 'cloudforge-topology', label: 'Topologies' },
			{ id: 'cloudforge-workflow', label: 'Agent Workflow' },
			{ id: 'terraform', label: 'Terraform' }
		];
		const filterBar = `<div class="filter-bar">${filters.map(f => {
			const cls = state.skillCategoryFilter === f.id ? 'chip active' : 'chip';
			return `<button type="button" class="${cls}" data-action="filterSkills" data-category="${f.id}">${escapeHtml(f.label)}</button>`;
		}).join('')}</div>`;
		const notice = state.safetyNotice ? `<p class="notice">${escapeHtml(state.safetyNotice)}</p>` : '';
		const list = filteredSkills.map(skill => `
			<article class="entry">
				<div class="entry-head">
					<div>
						<h3><code>${escapeHtml(skill.id)}</code></h3>
						<div class="meta">${escapeHtml(categoryLabel(skill.category))} · ${escapeHtml(skill.repository)} (${escapeHtml(skill.version ?? skill.commit.slice(0, 10))}) · ${escapeHtml(skill.license)}</div>
					</div>
					<span class="badge" style="--badge-color:#16A34A">Data-only</span>
				</div>
				<p class="prose">${escapeHtml(skill.purpose)}</p>
				<ul class="guidance-list">${skill.guidance.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>
			</article>`).join('');
		bodyHtml = `${notice}${filterBar}${list}`;
	} else if (state.activeTab === 'blueprints') {
		const intro = `
			<p class="notice">Verified multi-cloud topologies aligned with CloudForge Visual containers and Technical Graph patterns. Optional customizations below apply disjoint CIDRs (<code>10.&lt;octet&gt;.0.0/16</code> &amp; <code>10.&lt;octet+1&gt;.0.0/16</code>) and stage a reviewable proposal without writing to disk.</p>
			<div class="custom-bar">
				<label>Prefix<input id="bp-prefix" type="text" maxlength="24" placeholder="cf-lab"></label>
				<label>Region<input id="bp-region" type="text" maxlength="32" placeholder="uksouth / eu-west-2"></label>
				<label>CIDR 2nd octet (0-250)<input id="bp-octet" type="number" min="0" max="250" placeholder="0"></label>
			</div>`;
		const cards = state.blueprints.map(bp => `
			<article class="entry">
				<div class="entry-head">
					<div>
						<h3>${escapeHtml(bp.title)}</h3>
						<div class="meta">Pattern: <code>${escapeHtml(bp.technicalGraphPattern)}</code> · Files: ${bp.fileNames.map(f => `<code>${escapeHtml(f)}</code>`).join(', ')}</div>
					</div>
					<span class="badge" style="--badge-color:${cloudColor(bp.cloud)}">${escapeHtml(bp.cloud)}</span>
				</div>
				<p class="prose">${escapeHtml(bp.summary)}</p>
				<div class="row-actions">
					<button type="button" class="primary-btn" data-action="proposeBlueprint" data-id="${escapeHtml(bp.id)}"${state.architectureName ? '' : ' disabled'}>Propose blueprint into architecture</button>
				</div>
			</article>`).join('');
		bodyHtml = `${intro}${cards}`;
	} else {
		const agentStatus = state.vscodeAgentEnabled
			? `<div class="entry"><div class="entry-head"><div><h3>VS Code Agent View (MCP auto-discovery)</h3><div class="meta">Provider ID: <code>cloudforge.mcp</code> · Self-updating docs via <code>cloudforge://docs/catalogue</code>, <code>/topologies</code>, <code>/skills</code></div></div><span class="badge" style="--badge-color:#16A34A">Registered</span></div><p class="prose">Open-source VS Code Agent View discovers CloudForge's scoped MCP server automatically whenever an architecture is active and mints a revocable grant only when an agent connects.</p></div>`
			: `<div class="entry"><h3>VS Code Agent View</h3><p class="prose">MCP provider registration is unavailable in this host build. External CLI agents can still connect with a scoped grant below.</p></div>`;
		const cliActions = `
			<div class="entry">
				<h3>External CLI agents</h3>
				<p class="prose">Issue a time-limited, architecture-scoped grant and copy ready-to-paste MCP configuration for local Codex CLI or Claude Code.</p>
				<div class="row-actions">
					<button type="button" class="primary-btn" data-action="copyMcpConfig" data-client="codex"${state.architectureName ? '' : ' disabled'}>Copy Codex CLI config</button>
					<button type="button" class="ghost-btn" data-action="copyMcpConfig" data-client="claude-code"${state.architectureName ? '' : ' disabled'}>Copy Claude Code config</button>
				</div>
			</div>`;
		const activeGrants = state.grants.filter(g => g.active && !g.revoked);
		const grantsHtml = activeGrants.length === 0
			? `<div class="entry"><h3>Active MCP grants</h3><p class="prose">No active MCP grants are issued for this architecture.</p></div>`
			: `<div class="entry"><h3>Active MCP grants (${activeGrants.length})</h3>${activeGrants.map(g => `
				<div class="grant-row">
					<div>
						<code>${escapeHtml(g.grantIdPreview)}</code> · ${escapeHtml(g.clientLabel)} (${escapeHtml(g.displayName)})
						${g.readOnly ? '<span class="muted">read-only</span>' : ''}
					</div>
					<button type="button" class="ghost-btn" data-action="revokeGrant" data-id="${escapeHtml(g.grantIdPreview)}">Revoke access</button>
				</div>`).join('')}</div>`;
		bodyHtml = `${agentStatus}${cliActions}${grantsHtml}`;
	}

	const headerSub = state.architectureName
		? `${escapeHtml(state.architectureName)}${state.sourceRevision ? ` · rev <code>${escapeHtml(state.sourceRevision.slice(0, 8))}</code>` : ''}`
		: 'No architecture open';
	const toastHtml = state.statusMessage ? `<div class="status-banner" role="status">${escapeHtml(state.statusMessage)}</div>` : '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CloudForge Learning Studio</title>
<style nonce="${nonce}">
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	body {
		margin: 0;
		font-family: var(--vscode-font-family, system-ui, sans-serif);
		font-size: 13px;
		line-height: 1.55;
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
	}
	.shell {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		min-height: 100vh;
	}
	.rail {
		border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.22));
		background: var(--vscode-sideBar-background);
		padding: 18px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rail-title {
		font-size: 15px;
		font-weight: 600;
		padding: 0 10px 4px;
		margin: 0;
	}
	.rail-sub {
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
		padding: 0 10px 14px;
		border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.18));
		margin-bottom: 10px;
	}
	.nav-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--vscode-foreground);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.nav-btn:hover { background: var(--vscode-list-hoverBackground); }
	.nav-btn.active {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
		font-weight: 600;
	}
	.nav-count {
		font-size: 11px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
	}
	.rail-footer { margin-top: auto; padding-top: 12px; }
	.main {
		padding: 24px 32px;
		max-width: 820px;
	}
	.status-banner {
		margin-bottom: 16px;
		padding: 10px 12px;
		border-left: 3px solid var(--vscode-focusBorder, #0078D4);
		background: var(--vscode-textBlockQuote-background);
		border-radius: 4px;
	}
	.notice {
		color: var(--vscode-descriptionForeground);
		margin: 0 0 16px;
		max-width: 72ch;
	}
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 18px;
	}
	.chip {
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3));
		background: transparent;
		color: var(--vscode-foreground);
		font: inherit;
		cursor: pointer;
	}
	.chip.active {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	.entry {
		padding: 16px 0;
		border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
	}
	.entry:first-child { padding-top: 0; }
	.entry-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.entry h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
	.meta { font-size: 12px; color: var(--vscode-descriptionForeground); }
	.prose { margin: 10px 0; max-width: 72ch; }
	.guidance-list { margin: 8px 0 0; padding-left: 18px; max-width: 72ch; }
	.guidance-list li { margin-bottom: 6px; }
	.badge {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--badge-color);
		color: var(--badge-color);
	}
	.warning-strip {
		margin: 10px 0;
		padding: 8px 10px;
		border-left: 3px solid #DC2626;
		background: rgba(220, 38, 38, 0.08);
	}
	.file-preview {
		margin: 8px 0;
		border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
		border-radius: 6px;
		padding: 6px 10px;
	}
	.file-preview summary { cursor: pointer; }
	.file-summary { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
	.mini-btn {
		padding: 2px 8px;
		font-size: 11px;
		border-radius: 4px;
		border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
		background: transparent;
		color: var(--vscode-foreground);
		cursor: pointer;
	}
	.mini-btn:hover { background: var(--vscode-list-hoverBackground); }
	.file-preview pre {
		margin: 8px 0 2px;
		padding: 10px;
		overflow-x: auto;
		background: var(--vscode-textCodeBlock-background);
		border-radius: 4px;
	}
	code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
	.muted { color: var(--vscode-descriptionForeground); margin-left: 6px; }
	.row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.primary-btn, .ghost-btn {
		padding: 6px 12px;
		border-radius: 4px;
		font: inherit;
		cursor: pointer;
	}
	.primary-btn {
		border: 0;
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.primary-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
	.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.ghost-btn {
		border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
		background: transparent;
		color: var(--vscode-foreground);
	}
	.ghost-btn:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
	.grant-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15));
	}
	.empty-block { padding: 12px 0; max-width: 60ch; }
	.empty-block h2 { margin: 0 0 8px; font-size: 16px; }
	.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin: 12px 0; }
	.form-grid label, .custom-bar label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
	.form-grid .full { grid-column: 1 / -1; }
	.custom-bar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; padding: 12px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); border-radius: 6px; }
	input, select, textarea {
		font: inherit;
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
		border-radius: 4px;
		padding: 6px 8px;
	}
	.checklist { list-style: none; padding: 0; margin: 12px 0 0; }
	.checklist li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; }
	.checklist li.done span { text-decoration: line-through; opacity: 0.75; }
	.check-btn { border: 0; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 14px; padding: 0 4px; }
	.note-card { padding: 8px 0; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
	.note-card h4 { margin: 0 0 4px; font-size: 13px; }
	@media (max-width: 640px) {
		.shell { grid-template-columns: 1fr; }
		.form-grid, .custom-bar { grid-template-columns: 1fr; }
		.rail { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.22)); }
	}
</style>
</head>
<body>
<div class="shell">
	<nav class="rail" aria-label="Learning Studio sections">
		<h1 class="rail-title">Learning Studio</h1>
		<div class="rail-sub">${headerSub}</div>
		${navItem('task', 'Task & Notes', state.record?.task?.requirements.length ?? 0)}
		${navItem('proposals', 'Proposals', pendingCount)}
		${navItem('skills', 'Baked-in Skills', state.skills.length)}
		${navItem('blueprints', 'Starter Blueprints', state.blueprints.length)}
		${navItem('agents', 'AI Agents & MCP', state.grants.filter(g => g.active && !g.revoked).length)}
		<div class="rail-footer">
			<button type="button" class="ghost-btn" data-action="refresh">Refresh</button>
		</div>
	</nav>
	<main class="main">
		${toastHtml}
		${bodyHtml}
	</main>
</div>
<script nonce="${nonce}">
(function () {
	const vscode = acquireVsCodeApi();
	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
		if (!target || target.hasAttribute('disabled')) {
			return;
		}
		const action = target.getAttribute('data-action');
		if (action === 'switchTab') {
			vscode.postMessage({ type: 'switchTab', tab: target.getAttribute('data-tab') });
		} else if (action === 'filterSkills') {
			vscode.postMessage({ type: 'filterSkills', category: target.getAttribute('data-category') });
		} else if (action === 'applyProposal' || action === 'rejectProposal') {
			vscode.postMessage({ type: action, proposalId: target.getAttribute('data-id') });
		} else if (action === 'diffProposalFile') {
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({ type: 'diffProposalFile', proposalId: target.getAttribute('data-id'), fileName: target.getAttribute('data-file') });
		} else if (action === 'toggleRequirement') {
			vscode.postMessage({ type: 'toggleRequirement', requirementId: target.getAttribute('data-id') });
		} else if (action === 'proposeBlueprint') {
			const prefixEl = document.getElementById('bp-prefix');
			const regionEl = document.getElementById('bp-region');
			const octetEl = document.getElementById('bp-octet');
			vscode.postMessage({
				type: 'proposeBlueprint',
				blueprintId: target.getAttribute('data-id'),
				prefix: prefixEl instanceof HTMLInputElement ? prefixEl.value : '',
				region: regionEl instanceof HTMLInputElement ? regionEl.value : '',
				cidrBaseOctet: octetEl instanceof HTMLInputElement ? octetEl.value : ''
			});
		} else if (action === 'copyMcpConfig') {
			vscode.postMessage({ type: 'copyMcpConfig', client: target.getAttribute('data-client') });
		} else if (action === 'revokeGrant') {
			vscode.postMessage({ type: 'revokeGrant', grantIdPreview: target.getAttribute('data-id') });
		} else if (action === 'exportStudyGuide') {
			vscode.postMessage({ type: 'exportStudyGuide' });
		} else if (action === 'refresh') {
			vscode.postMessage({ type: 'refresh' });
		}
	});
	document.addEventListener('submit', function (event) {
		const form = event.target;
		if (!(form instanceof HTMLFormElement)) {
			return;
		}
		event.preventDefault();
		const data = new FormData(form);
		if (form.id === 'task-form') {
			vscode.postMessage({
				type: 'saveTask',
				title: String(data.get('title') || ''),
				mode: String(data.get('mode') || 'guided'),
				objective: String(data.get('objective') || ''),
				newRequirement: String(data.get('newRequirement') || '')
			});
		} else if (form.id === 'note-form') {
			vscode.postMessage({
				type: 'saveNote',
				address: String(data.get('address') || ''),
				why: String(data.get('why') || ''),
				userNote: String(data.get('userNote') || ''),
				docLabel: String(data.get('docLabel') || ''),
				docUrl: String(data.get('docUrl') || '')
			});
		}
	});
})();
</script>
</body>
</html>`;
}
