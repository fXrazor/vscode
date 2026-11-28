/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Template Library: strict parsers for the Rust service's template methods (listTemplates,
// getTemplateDetails, checkTemplateCompatibility, listTemplateSources, importTemplatePackageFile,
// removeCachedTemplate) and a small client over `_cloudforge.callService`. Anything that does
// not match the documented shape is dropped rather than trusted. Zero vscode imports; tested
// directly in Node.

export type TemplateTrust = 'official' | 'verified' | 'community' | 'local';
export type TemplateSource = 'builtin' | 'local' | 'remote';
export type TemplateDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type TemplateLifecycle = 'stable' | 'experimental' | 'deprecated';

export interface TemplateSummary {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly summary: string;
	readonly templateType: string;
	readonly providers: readonly string[];
	readonly categories: readonly string[];
	readonly difficulty: TemplateDifficulty;
	readonly certifications: readonly string[];
	readonly tags: readonly string[];
	readonly lifecycle: TemplateLifecycle;
	readonly publisher: string;
	readonly license: string;
	readonly resourceCount: number;
	/** Provider source address to the constraint the template declares. */
	readonly compatibility: Readonly<Record<string, string>>;
	readonly source: TemplateSource;
	readonly trust: TemplateTrust;
	readonly hasLayout: boolean;
	readonly hasParameters: boolean;
	readonly highRiskFindings: number;
}

export type TemplateFacetName = 'providers' | 'categories' | 'certifications' | 'templateTypes' | 'difficulties' | 'sources';

export interface TemplateSourceInfo {
	readonly id: string;
	readonly name: string;
	readonly trust: TemplateTrust;
	readonly templateCount: number;
	readonly offline: boolean;
	readonly removable: boolean;
}

export interface TemplateListPage {
	readonly templates: readonly TemplateSummary[];
	readonly total: number;
	readonly offset: number;
	readonly facets: Readonly<Partial<Record<TemplateFacetName, Readonly<Record<string, number>>>>>;
	readonly sources: readonly TemplateSourceInfo[];
}

export interface TemplateFile {
	readonly fileName: string;
	readonly contents: string;
}

export interface TemplateProblem {
	readonly code: string;
	readonly severity: 'error' | 'warning';
	readonly field?: string;
	readonly message: string;
}

export interface TemplateFinding {
	readonly code: string;
	readonly risk: 'high' | 'notice';
	readonly file: string;
	readonly line?: number;
	readonly message: string;
}

export interface TemplateDetails {
	readonly summary: TemplateSummary;
	readonly archiveSha256: string;
	readonly readme?: string;
	readonly terraformFiles: readonly TemplateFile[];
	readonly addresses: readonly string[];
	readonly variables: readonly string[];
	/** Studio layout keyed by Terraform address, passed through as JSON for the canvas. */
	readonly layout?: unknown;
	readonly parameters?: unknown;
	readonly problems: readonly TemplateProblem[];
	readonly findings: readonly TemplateFinding[];
	readonly usable: boolean;
}

export type ProviderFitStatus = 'compatible' | 'compatibleUntested' | 'conflictWithLock' | 'conflictWithConstraint' | 'notInProject';

export interface ProviderFit {
	readonly provider: string;
	readonly status: ProviderFitStatus;
	readonly templateConstraint?: string;
	readonly projectConstraint?: string;
	readonly locked?: string;
}

export interface TemplateCompatibility {
	readonly templateId: string;
	readonly version: string;
	readonly sourceRevision?: string;
	readonly compatible: boolean;
	readonly providers: readonly ProviderFit[];
	readonly unknownResourceTypes: readonly string[];
	readonly highRiskFindings: number;
}

export type TemplateImportResult =
	| { readonly imported: true; readonly outcome: 'added' | 'unchanged' | 'replaced'; readonly templateId: string; readonly version: string; readonly summary: TemplateSummary; readonly findings: readonly TemplateFinding[] }
	| { readonly imported: false; readonly reason: 'PACKAGE_HAS_ERRORS' | 'HIGH_RISK_NOT_ACCEPTED'; readonly templateId: string; readonly version: string; readonly problems: readonly TemplateProblem[]; readonly findings: readonly TemplateFinding[] };

const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FACETS: readonly TemplateFacetName[] = ['providers', 'categories', 'certifications', 'templateTypes', 'difficulties', 'sources'];
const MAX_FILES = 16;
const MAX_FILE_CHARS = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, limit = 2048): value is string {
	return typeof value === 'string' && value.length <= limit;
}

function count(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function strings(value: unknown, limit = 64, each = 128): readonly string[] | undefined {
	if (!Array.isArray(value) || value.length > limit || !value.every(item => str(item, each))) {
		return undefined;
	}
	return value as string[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function isTemplateId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 128 && TEMPLATE_ID.test(value);
}

export function isTemplateVersion(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 64 && SEMVER.test(value);
}

function constraintMap(value: unknown): Record<string, string> | undefined {
	if (value === undefined || value === null) {
		return {};
	}
	if (!isRecord(value)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [address, constraint] of Object.entries(value)) {
		if (!str(address, 256) || !str(constraint, 256)) {
			return undefined;
		}
		out[address] = constraint;
	}
	return out;
}

export function parseTemplateSummary(value: unknown): TemplateSummary | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const providers = strings(value.providers);
	const categories = strings(value.categories);
	const certifications = strings(value.certifications ?? []);
	const tags = strings(value.tags ?? []);
	const compatibility = constraintMap(value.compatibility);
	if (
		!isTemplateId(value.id) || !str(value.name, 200) || !isTemplateVersion(value.version) || !str(value.summary, 1000) ||
		!str(value.templateType, 64) || !providers || !categories || !certifications || !tags || !compatibility ||
		!oneOf(value.difficulty, ['beginner', 'intermediate', 'advanced'] as const) ||
		!oneOf(value.lifecycle, ['stable', 'experimental', 'deprecated'] as const) ||
		!oneOf(value.source, ['builtin', 'local', 'remote'] as const) ||
		!oneOf(value.trust, ['official', 'verified', 'community', 'local'] as const) ||
		!str(value.publisher, 200) || !str(value.license, 64) || !count(value.resourceCount) ||
		typeof value.hasLayout !== 'boolean' || typeof value.hasParameters !== 'boolean' || !count(value.highRiskFindings)
	) {
		return undefined;
	}
	return {
		id: value.id, name: value.name, version: value.version, summary: value.summary, templateType: value.templateType,
		providers, categories, difficulty: value.difficulty, certifications, tags, lifecycle: value.lifecycle,
		publisher: value.publisher, license: value.license, resourceCount: value.resourceCount, compatibility,
		source: value.source, trust: value.trust, hasLayout: value.hasLayout, hasParameters: value.hasParameters,
		highRiskFindings: value.highRiskFindings
	};
}

function parseSources(value: unknown): TemplateSourceInfo[] | undefined {
	if (!Array.isArray(value) || value.length > 32) {
		return undefined;
	}
	const out: TemplateSourceInfo[] = [];
	for (const item of value) {
		if (!isRecord(item) || !str(item.id, 64) || !str(item.name, 200) || !oneOf(item.trust, ['official', 'verified', 'community', 'local'] as const) || !count(item.templateCount) || typeof item.offline !== 'boolean') {
			return undefined;
		}
		out.push({ id: item.id, name: item.name, trust: item.trust, templateCount: item.templateCount, offline: item.offline, removable: item.removable === true });
	}
	return out;
}

/** Parses `listTemplates`. Individual malformed templates are skipped; a malformed page is refused. */
export function parseTemplateList(value: unknown): TemplateListPage | undefined {
	if (!isRecord(value) || !Array.isArray(value.templates) || value.templates.length > 200 || !count(value.total) || !count(value.offset) || !isRecord(value.facets)) {
		return undefined;
	}
	const sources = parseSources(value.sources);
	if (!sources) {
		return undefined;
	}
	const facets: Partial<Record<TemplateFacetName, Record<string, number>>> = {};
	for (const name of FACETS) {
		const raw = value.facets[name];
		if (raw === undefined) {
			continue;
		}
		if (!isRecord(raw)) {
			return undefined;
		}
		const counts: Record<string, number> = {};
		for (const [key, n] of Object.entries(raw)) {
			if (str(key, 128) && count(n)) {
				counts[key] = n;
			}
		}
		facets[name] = counts;
	}
	const templates = value.templates.map(parseTemplateSummary).filter((t): t is TemplateSummary => t !== undefined);
	return { templates, total: value.total, offset: value.offset, facets, sources };
}

function parseProblems(value: unknown): TemplateProblem[] | undefined {
	if (!Array.isArray(value) || value.length > 500) {
		return undefined;
	}
	const out: TemplateProblem[] = [];
	for (const p of value) {
		if (!isRecord(p) || !str(p.code, 64) || !oneOf(p.severity, ['error', 'warning'] as const) || !str(p.message, 2000)) {
			return undefined;
		}
		out.push({ code: p.code, severity: p.severity, message: p.message, ...(str(p.field, 256) ? { field: p.field } : {}) });
	}
	return out;
}

function parseFindings(value: unknown): TemplateFinding[] | undefined {
	if (!Array.isArray(value) || value.length > 500) {
		return undefined;
	}
	const out: TemplateFinding[] = [];
	for (const f of value) {
		if (!isRecord(f) || !str(f.code, 64) || !oneOf(f.risk, ['high', 'notice'] as const) || !str(f.file, 256) || !str(f.message, 2000)) {
			return undefined;
		}
		out.push({ code: f.code, risk: f.risk, file: f.file, message: f.message, ...(count(f.line) ? { line: f.line } : {}) });
	}
	return out;
}

export function parseTemplateDetails(value: unknown): TemplateDetails | undefined {
	if (!isRecord(value) || !SHA256.test(String(value.archiveSha256)) || !Array.isArray(value.terraformFiles) || value.terraformFiles.length > MAX_FILES || typeof value.usable !== 'boolean') {
		return undefined;
	}
	const summary = parseTemplateSummary(value.summary);
	const addresses = strings(value.addresses, 2000, 512);
	const variables = strings(value.variables, 500, 128);
	const problems = parseProblems(value.problems);
	const findings = parseFindings(value.findings);
	if (!summary || !addresses || !variables || !problems || !findings) {
		return undefined;
	}
	const terraformFiles: TemplateFile[] = [];
	for (const f of value.terraformFiles) {
		if (!isRecord(f) || !str(f.fileName, 128) || !/^[A-Za-z0-9_.-]+\.tf(\.json)?$/.test(f.fileName) || !str(f.contents, MAX_FILE_CHARS)) {
			return undefined;
		}
		terraformFiles.push({ fileName: f.fileName, contents: f.contents });
	}
	return {
		summary,
		archiveSha256: value.archiveSha256 as string,
		...(str(value.readme, 200_000) ? { readme: value.readme } : {}),
		terraformFiles,
		addresses,
		variables,
		...(value.layout === undefined || value.layout === null ? {} : { layout: value.layout }),
		...(value.parameters === undefined || value.parameters === null ? {} : { parameters: value.parameters }),
		problems,
		findings,
		usable: value.usable
	};
}

export function parseTemplateCompatibility(value: unknown): TemplateCompatibility | undefined {
	if (!isRecord(value) || !isTemplateId(value.templateId) || !isTemplateVersion(value.version) || typeof value.compatible !== 'boolean' || !Array.isArray(value.providers) || value.providers.length > 64 || !count(value.highRiskFindings)) {
		return undefined;
	}
	const unknownResourceTypes = strings(value.unknownResourceTypes ?? [], 500, 256);
	if (!unknownResourceTypes) {
		return undefined;
	}
	const providers: ProviderFit[] = [];
	for (const p of value.providers) {
		if (!isRecord(p) || !str(p.provider, 256) || !oneOf(p.status, ['compatible', 'compatibleUntested', 'conflictWithLock', 'conflictWithConstraint', 'notInProject'] as const)) {
			return undefined;
		}
		providers.push({
			provider: p.provider,
			status: p.status,
			...(str(p.templateConstraint, 256) ? { templateConstraint: p.templateConstraint } : {}),
			...(str(p.projectConstraint, 256) ? { projectConstraint: p.projectConstraint } : {}),
			...(str(p.locked, 64) ? { locked: p.locked } : {})
		});
	}
	// The service only says "incompatible" for the two conflict statuses; never trust a
	// `compatible: true` that contradicts the rows.
	const conflict = providers.some(p => p.status === 'conflictWithLock' || p.status === 'conflictWithConstraint');
	return {
		templateId: value.templateId,
		version: value.version,
		...(typeof value.sourceRevision === 'string' && SHA256.test(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}),
		compatible: value.compatible && !conflict,
		providers,
		unknownResourceTypes,
		highRiskFindings: value.highRiskFindings
	};
}

export function parseTemplateSources(value: unknown): readonly TemplateSourceInfo[] | undefined {
	return isRecord(value) ? parseSources(value.sources) : undefined;
}

export function parseTemplateImport(value: unknown): TemplateImportResult | undefined {
	if (!isRecord(value) || !isTemplateId(value.templateId) || !isTemplateVersion(value.version)) {
		return undefined;
	}
	const findings = parseFindings(value.findings ?? []);
	if (!findings) {
		return undefined;
	}
	if (value.imported === true) {
		const summary = parseTemplateSummary(value.summary);
		if (!summary || !oneOf(value.outcome, ['added', 'unchanged', 'replaced'] as const)) {
			return undefined;
		}
		return { imported: true, outcome: value.outcome, templateId: value.templateId, version: value.version, summary, findings };
	}
	const problems = parseProblems(value.problems ?? []);
	if (value.imported !== false || !problems || !oneOf(value.reason, ['PACKAGE_HAS_ERRORS', 'HIGH_RISK_NOT_ACCEPTED'] as const)) {
		return undefined;
	}
	return { imported: false, reason: value.reason, templateId: value.templateId, version: value.version, problems, findings };
}

/** Plain-language text for a template fault code, for notifications and the library page. */
export function templateErrorMessage(code: string): string {
	switch (code) {
		case 'TEMPLATE_NOT_FOUND': return 'That template is no longer available.';
		case 'TEMPLATE_EXISTS': return 'A different template with this name and version is already in your library.';
		case 'TEMPLATE_PACKAGE_INVALID': return 'This file is not a valid CloudForge template package.';
		case 'TEMPLATE_STORE_UNAVAILABLE': return 'CloudForge could not open your local template library.';
		case 'TEMPLATE_UNSAFE': return 'This template has safety problems and cannot be used.';
		case 'TEMPLATE_CONFLICT': return 'This template clashes with files or resources already in the architecture.';
		case 'CANCELLED': return 'Cancelled.';
		case 'SCOPE_DENIED': return 'CloudForge can only use files on this computer, or built-in templates cannot be removed.';
		case 'INVALID_PARAMS': return 'CloudForge could not read that request.';
		default: return 'The CloudForge service could not complete the template request.';
	}
}

/** One-line description of a provider fit row, for the details page and the create wizard. */
export function describeProviderFit(fit: ProviderFit): string {
	const name = fit.provider.split('/').slice(-1)[0] ?? fit.provider;
	switch (fit.status) {
		case 'compatible': return `${name}: fits this project.`;
		case 'compatibleUntested': return `${name}: allowed by the constraints, but the template was not tested with this version.`;
		case 'conflictWithLock': return `${name}: the template needs ${fit.templateConstraint ?? 'another version'}, but this project is locked to ${fit.locked ?? 'a different version'}.`;
		case 'conflictWithConstraint': return `${name}: the template needs ${fit.templateConstraint ?? 'another version'}, which this project's constraint ${fit.projectConstraint ?? ''} does not allow.`.replace('  ', ' ');
		case 'notInProject': return `${name}: not used by this project yet; it will be added.`;
	}
}

export type ServiceCall = <T>(method: string, params: Record<string, unknown>) => Promise<{ ok: true; value: T } | { ok: false; error: { code: string } }>;

export type TemplateResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

function fail<T>(code: string): TemplateResult<T> {
	return { ok: false, code, message: templateErrorMessage(code) };
}

async function run<T>(call: ServiceCall, method: string, params: Record<string, unknown>, parse: (value: unknown) => T | undefined): Promise<TemplateResult<T>> {
	const result = await call<unknown>(method, params);
	if (!result.ok) {
		return fail(result.error.code);
	}
	const parsed = parse(result.value);
	return parsed === undefined ? fail('SERVICE_ERROR') : { ok: true, value: parsed };
}

export interface TemplateQuery {
	readonly query?: string;
	readonly providers?: readonly string[];
	readonly categories?: readonly string[];
	readonly templateTypes?: readonly string[];
	readonly difficulties?: readonly string[];
	readonly certifications?: readonly string[];
	readonly sources?: readonly string[];
	readonly sort?: 'recommended' | 'name' | 'difficulty' | 'resources';
	readonly offset?: number;
	readonly limit?: number;
}

/** Typed access to the template methods. Every response is parsed before it is returned. */
export function createTemplateClient(call: ServiceCall) {
	return {
		list(query: TemplateQuery = {}): Promise<TemplateResult<TemplateListPage>> {
			const params: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined && !(Array.isArray(value) && value.length === 0) && value !== '') {
					params[key] = value;
				}
			}
			return run(call, 'listTemplates', params, parseTemplateList);
		},
		details(templateId: string, version?: string): Promise<TemplateResult<TemplateDetails>> {
			if (!isTemplateId(templateId) || (version !== undefined && !isTemplateVersion(version))) {
				return Promise.resolve(fail('INVALID_PARAMS'));
			}
			return run(call, 'getTemplateDetails', { templateId, ...(version ? { version } : {}) }, parseTemplateDetails);
		},
		compatibility(scope: { workspaceId: string; architectureId: string; expectedSourceRevision?: string }, templateId: string, version?: string): Promise<TemplateResult<TemplateCompatibility>> {
			if (!isTemplateId(templateId) || (version !== undefined && !isTemplateVersion(version))) {
				return Promise.resolve(fail('INVALID_PARAMS'));
			}
			return run(call, 'checkTemplateCompatibility', { ...scope, templateId, ...(version ? { version } : {}) }, parseTemplateCompatibility);
		},
		sources(): Promise<TemplateResult<readonly TemplateSourceInfo[]>> {
			return run(call, 'listTemplateSources', {}, parseTemplateSources);
		},
		/** Opens the native picker in Electron main; the path never passes through the extension. */
		importFile(options: { replace?: boolean; acceptHighRisk?: boolean } = {}): Promise<TemplateResult<TemplateImportResult>> {
			return run(call, 'importTemplatePackageFile', {
				...(options.replace ? { replace: true } : {}),
				...(options.acceptHighRisk ? { acceptHighRisk: true } : {})
			}, parseTemplateImport);
		},
		remove(templateId: string, version: string): Promise<TemplateResult<{ removed: true }>> {
			if (!isTemplateId(templateId) || !isTemplateVersion(version)) {
				return Promise.resolve(fail('INVALID_PARAMS'));
			}
			return run(call, 'removeCachedTemplate', { templateId, version }, v => (isRecord(v) && v.removed === true ? { removed: true as const } : undefined));
		}
	};
}

export type TemplateClient = ReturnType<typeof createTemplateClient>;
