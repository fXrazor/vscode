/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Portable CloudForge project bundle (`*.cloudforge.zip`).
 *
 * One archive carries everything needed to move a design to another machine: the canvas model
 * (resources, positions, drawings, connectors, groups, layer order, variables), the Terraform the
 * canvas projects to, the diagram as SVG, and a manifest with per-file SHA-256 digests.
 *
 * The bundle is built in the webview from Studio's own model. Hosted exports hand the bytes to the
 * extension's existing user-chosen export path; imports only ever load the model into the canvas,
 * so workspace `.tf` writes still go through the Rust-guarded Save preview.
 */

import type { Architecture, BoardItem, DesignConnection, Resource } from './model.ts';
import { normaliseArchitectureConnections, type ArchitectureInput } from './connectionEndpoints.ts';
import { exportableArchitecture } from './variables.ts';
import { projectTerraform, projectResourceFiles } from './terraformProjection.ts';
import { generate } from './cloudlab-core/terraform.ts';
import { readZip, writeZip, ZipError, type ZipEntry } from './zipArchive.ts';
import type { VariableDefinition, VariableValue } from './variables.ts';

export const BUNDLE_FORMAT = 'cloudforge.project-bundle';
export const BUNDLE_FORMAT_VERSION = 1;
export const MANIFEST_PATH = 'cloudforge-project.json';
export const ARCHITECTURE_PATH = 'architecture.json';
export const BUNDLE_EXTENSION = '.cloudforge.zip';
/** Fits under the extension's 8 MiB export message once base64-encoded. */
export const MAX_BUNDLE_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export interface BundleSource {
	readonly mode: 'hosted' | 'sample';
	readonly sourceRevision?: string;
	readonly status?: 'complete' | 'partial';
	/** True when the canvas had edits not yet saved to the workspace when it was exported. */
	readonly unsavedChanges?: boolean;
}

export interface BundleManifestFile {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly role: 'architecture' | 'terraform' | 'diagram' | 'readme';
}

export interface BundleManifest {
	readonly format: typeof BUNDLE_FORMAT;
	readonly formatVersion: number;
	readonly name: string;
	readonly exportedAt: string;
	readonly generator: string;
	readonly source: BundleSource;
	readonly contents: {
		readonly resources: number;
		readonly drawings: number;
		readonly connections: number;
		readonly variables: number;
		readonly providers: readonly string[];
		readonly terraformFiles: readonly string[];
	};
	readonly files: readonly BundleManifestFile[];
	readonly notes: readonly string[];
}

export interface BuiltBundle {
	readonly fileName: string;
	readonly bytes: Uint8Array;
	readonly manifest: BundleManifest;
}

export interface ImportedBundle {
	readonly manifest: BundleManifest;
	readonly architecture: Architecture;
	readonly terraformFiles: readonly string[];
	readonly warnings: readonly string[];
}

export class BundleError extends Error { }

const encoder = new TextEncoder();

async function sha256(data: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** `Production network` → `production-network.cloudforge.zip`. */
export function bundleFileName(name: string): string {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
	return (slug || 'cloudforge-project') + BUNDLE_EXTENSION;
}

function hclLiteral(value: VariableValue): string {
	if (Array.isArray(value)) { return '[' + value.map(hclLiteral).join(', ') + ']'; }
	if (value !== null && typeof value === 'object') { return '{ ' + Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${hclLiteral(item)}`).join(', ') + ' }'; }
	return JSON.stringify(value).replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{');
}

function studioVariableBlock(variable: VariableDefinition): string {
	const lines = [`variable ${JSON.stringify(variable.name)} {`, `  type        = ${variable.type}`];
	if (variable.description) { lines.push(`  description = ${hclLiteral(variable.description)}`); }
	if (variable.sensitive) { lines.push('  sensitive   = true'); }
	else if (variable.defaultValue !== undefined) { lines.push(`  default     = ${hclLiteral(variable.defaultValue)}`); }
	lines.push('}');
	return lines.join('\n');
}

/**
 * The runnable Terraform folder the canvas projects to, with Studio-declared variables folded into
 * `variables.tf` and their non-sensitive values into `terraform.tfvars`.
 */
export function bundleTerraformFiles(architecture: Architecture): Record<string, string> {
	const files: Record<string, string> = { ...generate(projectTerraform(architecture).project).files };
	const declared = new Set<string>();
	for (const text of Object.values(files)) {
		for (const match of text.matchAll(/^\s*variable\s+"([^"]+)"/gm)) { declared.add(match[1]); }
	}
	const extra = (architecture.variables ?? []).filter(variable => !declared.has(variable.name));
	if (extra.length) {
		const blocks = extra.map(studioVariableBlock).join('\n\n');
		files['variables.tf'] = (files['variables.tf'] ? files['variables.tf'].trimEnd() + '\n\n' : '') + '# Variables declared in CloudForge Studio.\n' + blocks + '\n';
	}
	const assigned = new Set<string>();
	for (const match of (files['terraform.tfvars'] ?? '').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=/gm)) { assigned.add(match[1]); }
	const values = (architecture.variables ?? []).filter(variable => !variable.sensitive && variable.value !== undefined && !assigned.has(variable.name));
	if (values.length) {
		const lines = values.map(variable => `${variable.name} = ${hclLiteral(variable.value!)}`).join('\n');
		files['terraform.tfvars'] = (files['terraform.tfvars'] ? files['terraform.tfvars'].trimEnd() + '\n\n' : '') + '# Values set in CloudForge Studio. Sensitive values are never exported.\n' + lines + '\n';
	}
	for (const [name, text] of Object.entries(files)) {
		if (!text.trim()) { delete files[name]; }
	}
	return files;
}

function readme(manifest: Omit<BundleManifest, 'files'>): string {
	const source = manifest.source.mode === 'hosted'
		? `Exported from a CloudForge workspace${manifest.source.sourceRevision ? ` at source revision \`${manifest.source.sourceRevision.slice(0, 12)}\`` : ''}${manifest.source.unsavedChanges ? ', including canvas edits that were not yet saved to the workspace' : ''}.`
		: 'Exported from the CloudForge Studio sample preview.';
	return [
		`# ${manifest.name}`,
		'',
		`CloudForge project bundle, exported ${manifest.exportedAt}. ${source}`,
		'',
		'## Contents',
		'',
		`- \`${MANIFEST_PATH}\`: bundle manifest with a SHA-256 digest for every file.`,
		`- \`${ARCHITECTURE_PATH}\`: the canvas model (${manifest.contents.resources} resources, ${manifest.contents.drawings} drawings, ${manifest.contents.connections} connectors, ${manifest.contents.variables} variables, layout and groups).`,
		'- `terraform/`: the Terraform the canvas projects to (' + manifest.contents.terraformFiles.join(', ') + ').',
		'- `diagram/architecture.svg`: the architecture diagram.',
		'',
		'## Open it',
		'',
		'In CloudForge Studio, choose **Export › Import project bundle** and pick this `.zip`. The design loads onto the canvas; in a workspace, use **Save** to preview and write the Terraform files.',
		'',
		'Without CloudForge, `cd terraform && terraform init && terraform plan` (or `tofu`) works on the projected files.',
		'',
		'## Notes',
		'',
		...manifest.notes.map(note => '- ' + note),
		'',
	].join('\n');
}

export async function buildProjectBundle(input: {
	readonly architecture: Architecture;
	readonly source: BundleSource;
	readonly svg?: string;
	readonly exportedAt?: Date;
}): Promise<BuiltBundle> {
	const exportedAt = input.exportedAt ?? new Date();
	const safe = exportableArchitecture(input.architecture);
	const terraform = bundleTerraformFiles(safe);
	const terraformNames = Object.keys(terraform).sort();
	const notes = [
		'Sensitive setting values and sensitive variable values are omitted. Supply them through terraform.tfvars, environment variables or your secret store.',
		'Terraform is generated from the canvas model. Comments and HCL the canvas does not model are not carried over from workspace source files.',
		...(input.source.status === 'partial' ? ['The workspace graph was partial when exported; some source resources may be missing from the canvas.'] : []),
		...(input.source.unsavedChanges ? ['The canvas had unsaved edits; the bundle reflects the canvas, not the files on disk.'] : []),
	];
	const header = {
		format: BUNDLE_FORMAT,
		formatVersion: BUNDLE_FORMAT_VERSION,
		name: input.architecture.name || 'CloudForge project',
		exportedAt: exportedAt.toISOString(),
		generator: 'CloudForge Studio',
		source: input.source,
		contents: {
			resources: safe.resources.length,
			drawings: safe.items.length,
			connections: safe.connections.length,
			variables: safe.variables?.length ?? 0,
			providers: [...new Set(safe.resources.map(resource => resource.provider))].sort(),
			terraformFiles: terraformNames,
		},
		notes,
	} as const;

	const payload: { path: string; text: string; role: BundleManifestFile['role'] }[] = [
		{ path: ARCHITECTURE_PATH, text: JSON.stringify(safe, null, 2) + '\n', role: 'architecture' },
		...terraformNames.map(name => ({ path: 'terraform/' + name, text: terraform[name], role: 'terraform' as const })),
		...(input.svg ? [{ path: 'diagram/architecture.svg', text: input.svg, role: 'diagram' as const }] : []),
		{ path: 'README.md', text: readme(header), role: 'readme' },
	];
	const entries: ZipEntry[] = [];
	const files: BundleManifestFile[] = [];
	for (const item of payload) {
		const data = encoder.encode(item.text);
		entries.push({ path: item.path, data });
		files.push({ path: item.path, bytes: data.length, sha256: await sha256(data), role: item.role });
	}
	const manifest: BundleManifest = { ...header, files };
	entries.unshift({ path: MANIFEST_PATH, data: encoder.encode(JSON.stringify(manifest, null, 2) + '\n') });
	const bytes = await writeZip(entries, exportedAt);
	if (bytes.length > MAX_BUNDLE_BYTES) {
		throw new BundleError('This project is too large to bundle (over 6 MB). Remove large drawings or split the architecture.');
	}
	return { fileName: bundleFileName(header.name), bytes, manifest };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isPoint = (value: unknown) => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const hasPositions = (value: Record<string, unknown>) => isRecord(value.positions) && isPoint(value.positions.visual) && isPoint(value.positions.technical);

function checkResource(value: unknown): value is Resource {
	return isRecord(value) && typeof value.id === 'string' && !!value.id && typeof value.kind === 'string' && typeof value.provider === 'string'
		&& typeof value.name === 'string' && typeof value.region === 'string' && isRecord(value.settings) && Array.isArray(value.blocks) && hasPositions(value);
}

function checkItem(value: unknown): value is BoardItem {
	return isRecord(value) && typeof value.id === 'string' && !!value.id && typeof value.kind === 'string' && typeof value.text === 'string'
		&& Number.isFinite(value.width) && Number.isFinite(value.height) && Array.isArray(value.members) && hasPositions(value);
}

/** Structural check of a bundled canvas model; anything off-shape is reported, never repaired silently. */
export function parseBundledArchitecture(value: unknown): { architecture: Architecture; warnings: string[] } {
	if (!isRecord(value) || !Array.isArray(value.resources) || !Array.isArray(value.items) || !Array.isArray(value.connections)) {
		throw new BundleError('architecture.json is not a CloudForge architecture.');
	}
	const warnings: string[] = [];
	const resources = value.resources.filter(checkResource);
	const items = value.items.filter(checkItem);
	if (resources.length !== value.resources.length) { warnings.push(`${value.resources.length - resources.length} resource(s) were malformed and skipped.`); }
	if (items.length !== value.items.length) { warnings.push(`${value.items.length - items.length} drawing(s) were malformed and skipped.`); }
	const ids = [...resources.map(item => item.id), ...items.map(item => item.id)];
	if (new Set(ids).size !== ids.length) { throw new BundleError('architecture.json repeats element ids.'); }
	const variables = Array.isArray(value.variables)
		? value.variables.filter((variable): variable is VariableDefinition => isRecord(variable) && typeof variable.id === 'string' && typeof variable.name === 'string' && typeof variable.type === 'string')
		: undefined;
	const input: ArchitectureInput = {
		name: typeof value.name === 'string' && value.name.trim() ? value.name : 'Imported project',
		resources,
		items,
		connections: value.connections.filter(isRecord) as unknown as DesignConnection[],
		...(variables ? { variables } : {}),
		...(Array.isArray(value.groups) ? { groups: value.groups.filter((group): group is { id: string; label: string; members: string[] } => isRecord(group) && typeof group.id === 'string' && typeof group.label === 'string' && Array.isArray(group.members)) } : {}),
		...(Array.isArray(value.layerOrder) ? { layerOrder: value.layerOrder.filter((id): id is string => typeof id === 'string') } : {}),
	};
	const architecture = normaliseArchitectureConnections(input);
	if (architecture.connections.length !== value.connections.length) { warnings.push(`${value.connections.length - architecture.connections.length} connector(s) pointed at missing elements and were dropped.`); }
	return { architecture, warnings };
}

export async function readProjectBundle(bytes: Uint8Array): Promise<ImportedBundle> {
	if (bytes.length > MAX_IMPORT_BYTES) { throw new BundleError('This bundle is larger than 32 MB.'); }
	let entries: ZipEntry[];
	try {
		entries = await readZip(bytes, { maxEntries: 512, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
	} catch (error) {
		throw new BundleError(error instanceof ZipError ? error.message : 'Unable to read this ZIP file.');
	}
	const byPath = new Map(entries.map(entry => [entry.path, entry.data]));
	const decoder = new TextDecoder();
	const json = (path: string): unknown => {
		const data = byPath.get(path);
		if (!data) { throw new BundleError(`This is not a CloudForge project bundle (missing ${path}).`); }
		try { return JSON.parse(decoder.decode(data)); } catch { throw new BundleError(`${path} is not valid JSON.`); }
	};
	const manifest = json(MANIFEST_PATH);
	if (!isRecord(manifest) || manifest.format !== BUNDLE_FORMAT) { throw new BundleError('This is not a CloudForge project bundle.'); }
	if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BUNDLE_FORMAT_VERSION) {
		throw new BundleError('This bundle was made by a newer CloudForge. Update CloudForge to open it.');
	}
	const warnings: string[] = [];
	for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
		if (!isRecord(file) || typeof file.path !== 'string' || typeof file.sha256 !== 'string') { continue; }
		const data = byPath.get(file.path);
		if (!data) { warnings.push(`${file.path} is listed in the manifest but missing.`); continue; }
		if (await sha256(data) !== file.sha256) {
			if (file.path === ARCHITECTURE_PATH) { throw new BundleError('architecture.json does not match its manifest digest; the bundle was changed or damaged.'); }
			warnings.push(`${file.path} was changed after export.`);
		}
	}
	const { architecture, warnings: modelWarnings } = parseBundledArchitecture(json(ARCHITECTURE_PATH));
	return {
		manifest: manifest as unknown as BundleManifest,
		architecture,
		terraformFiles: entries.filter(entry => entry.path.startsWith('terraform/')).map(entry => entry.path.slice('terraform/'.length)),
		warnings: [...warnings, ...modelWarnings],
	};
}

/** Element ids already on the canvas that an imported bundle would collide with. */
export function bundleConflicts(current: Architecture, incoming: Architecture): string[] {
	const ids = new Set([...current.resources.map(item => item.id), ...current.items.map(item => item.id)]);
	return [...incoming.resources.map(item => item.id), ...incoming.items.map(item => item.id)].filter(id => ids.has(id));
}

/** Files the imported resources will be saved into, for the import summary. */
export function bundleTargetFiles(architecture: Architecture): string[] {
	return projectResourceFiles(architecture);
}

export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) { binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); }
	return btoa(binary);
}
