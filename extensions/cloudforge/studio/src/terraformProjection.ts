import { isSensitiveProperty } from './variables.ts';
import type { Architecture, Resource, ResourceBlock } from './model.ts';
import { resourceDefinition, providerRegions } from './fixture.ts';
import { getDef, type AttrDef } from './cloudlab-core/catalog/index.ts';
import { emptyProject, isExpr, isRef, type ArchNode, type Project, type Value } from './cloudlab-core/model.ts';
import { generate, nodeBlock } from './cloudlab-core/terraform.ts';
import { blockToConfig, parseHcl } from './cloudlab-core/hcl.ts';

type Binding = { path: string[]; target: 'name' | 'region' | 'setting' | 'block'; key: string; blockId?: string; original: string };
type Projected = { project: Project; bindings: Map<string, Binding[]> };
const aliases: Record<string, string> = {
	'Address space': 'address_space', 'Address prefix': 'address_prefixes', SKU: 'sku.name', Capacity: 'sku.capacity',
	'Node count': 'default_node_pool.node_count', 'VM size': 'default_node_pool.vm_size', 'Private cluster': 'private_cluster_enabled',
	Tier: 'account_tier', Replication: 'account_replication_type', 'Retention days': 'retention_in_days', 'Service tier': 'sku_name', Size: 'size',
	'Network plugin': 'network_plugin', 'Service CIDR': 'service_cidr', 'Managed outbound IP count': 'managed_outbound_ip_count',
	'Subnet name': 'name', 'Versioning enabled': 'versioning_enabled', 'Pool name': 'name', 'IP address': 'ip_addresses'
};
const identifier = (name: string) => /^[A-Za-z_]/.test(name) ? name.replace(/[^A-Za-z0-9_-]/g, '_') : '_' + name.replace(/[^A-Za-z0-9_-]/g, '_');
const regionCode = (name: string) => name.toLowerCase().replace(/\s/g, '');
function set(config: Record<string, Value>, path: string[], value: Value) {
	let cursor: Record<string, Value> = config;
	for (const key of path.slice(0, -1)) { cursor = (cursor[key] ??= {}) as Record<string, Value>; }
	cursor[path.at(-1)!] = value;
}
function get(config: Value, path: string[]): Value | undefined {
	let cursor: Value | undefined = config;
	for (const key of path) { if (!cursor || typeof cursor !== 'object') { return undefined; } cursor = (cursor as Record<string, Value>)[key]; }
	return cursor;
}
function attribute(attrs: AttrDef[] | undefined, path: string[]): AttrDef | undefined {
	let found: AttrDef | undefined;
	for (const key of path) { if (/^\d+$/.test(key)) { continue; } found = attrs?.find(attr => attr.name === key); attrs = found?.children; }
	return found;
}
function valueFor(text: string, attr?: Pick<AttrDef, 'type'>): Value {
	if (/^var\.[A-Za-z_][A-Za-z0-9_-]*$/.test(text)) { return { $expr: text }; }
	if (attr?.type === 'number') { const number = Number(text); if (text.trim() && Number.isFinite(number)) { return number; } }
	if (attr?.type === 'bool') { if (['true', 'Enabled'].includes(text)) { return true; } if (['false', 'Disabled'].includes(text)) { return false; } }
	if (attr?.type === 'list' || attr?.type === 'map') { try { return JSON.parse(text) as Value; } catch { return attr.type === 'list' ? [text] : text; } }
	return text;
}

/** Compute the legacy generator's input; never keep a second editable Project store. */
export function projectTerraform(architecture: Architecture): Projected {
	const project = emptyProject(architecture.name); project.id = 'studio-projection';
	const bindings = new Map<string, Binding[]>();
	for (const resource of architecture.resources) {
		const metadata = resourceDefinition(resource); const def = getDef(metadata.type); const list: Binding[] = [];
		const node: ArchNode = { id: resource.id, kind: resource.kind === 'module' ? 'module' : 'resource', type: metadata.type,
			name: resource.terraformName ?? identifier(resource.name), label: resource.name, x: resource.positions.visual.x, y: resource.positions.visual.y,
			w: 112, h: 92, config: {}, optional: [], file: 'main.tf', extra: { depends_on: [], lifecycle: {} }, outputs: [], hiddenRefs: [] };
		if (resource.kind === 'module') { node.moduleId = 'custom'; node.module = { source: resource.settings.Source ?? '', version: resource.settings.Version === 'Unpinned' ? '' : resource.settings.Version ?? '', inputs: {} }; }
		else {
			if (!def || def.attributes.some(attr => attr.name === 'name')) { node.config.name = resource.name; list.push({ path: ['name'], target: 'name', key: 'name', original: resource.name }); }
			if (def?.attributes.some(attr => attr.name === 'location') || resource.catalogue?.fields.some(attr => attr.name === 'location')) { node.config.location = regionCode(resource.region); list.push({ path: ['location'], target: 'region', key: 'location', original: resource.region }); }
			for (const [key, text] of Object.entries(resource.settings)) {
				const path = (resource.catalogue ? key : aliases[key] ?? key.toLowerCase().replace(/\s+/g, '_')).split('.');
				const attr = attribute(def?.attributes, path) ?? resource.catalogue?.fields.find(field => field.name === key);
				set(node.config, path, isSensitiveProperty(key, attr?.sensitive) ? { $expr: 'var.' + node.name + '_' + path.join('_') } : valueFor(text, attr && { type: attr.type }));
				list.push({ path, target: 'setting', key, original: text });
			}
			const blocks = (items: ResourceBlock[], config: Record<string, Value>, prefix: string[]) => {
				for (const type of new Set(items.map(block => block.type))) {
					const entries = items.filter(block => block.type === type); const repeat = attribute(def?.attributes, [...prefix, type])?.repeat ?? entries.length > 1;
					const values = entries.map((block, index) => {
						const path = [...prefix, type, ...(repeat ? [String(index)] : [])]; const value: Record<string, Value> = {};
						for (const [key, text] of Object.entries(block.values)) { const field = aliases[key] ?? key.toLowerCase().replace(/\s+/g, '_'); value[field] = isSensitiveProperty(key, attribute(def?.attributes, [...path, field])?.sensitive) ? { $expr: 'var.' + node.name + '_' + [...path, field].join('_') } : valueFor(text, attribute(def?.attributes, [...path, field])); list.push({ path: [...path, field], target: 'block', blockId: block.id, key, original: text }); }
						blocks(block.blocks, value, path); return value;
					}); config[type] = repeat ? values : values[0];
				}
			}; blocks(resource.blocks, node.config, []); node.optional = Object.keys(node.config);
		}
		project.nodes.push(node); bindings.set(resource.id, list);
	}
	return { project, bindings };
}

export function terraformCode(architecture: Architecture, resourceId?: string): string {
	const { project } = projectTerraform(architecture);
	const node = project.nodes.find(node => node.id === resourceId);
	return node ? nodeBlock(project, node) : generate(project).files['main.tf'] ?? '# No resources in this architecture.\n';
}

function leafPaths(value: Value, path: string[] = []): string[][] {
	if (value !== null && typeof value === 'object' && !isExpr(value) && !isRef(value)) { return Object.entries(value).flatMap(([key, item]) => leafPaths(item as Value, [...path, key])); }
	return [path];
}

/** Reject edits we cannot represent rather than silently losing unsupported HCL. */
export function applyTerraformDraft(architecture: Architecture, code: string, resourceId?: string): Resource[] {
	const { project, bindings } = projectTerraform(architecture); const before = terraformCode(architecture, resourceId);
	const originalComments = new Set(before.split('\n').filter(line => line.trim().startsWith('#')).map(line => line.trim()));
	if (code.includes('/*') || code.split('\n').some(line => /^\s*(#|\/\/)/.test(line) && !originalComments.has(line.trim())) || /\S\s+(#|\/\/)/.test(code)) { throw new Error('Keep new comments in native source files. This preview cannot preserve custom source comments; your draft is retained.'); }
	const file = parseHcl(code); const expected = resourceId ? project.nodes.filter(node => node.id === resourceId) : project.nodes;
	if (new Set(expected.map(node => node.type + '.' + node.name)).size !== expected.length || new Set(file.blocks.map(block => block.type + '.' + block.labels.join('.'))).size !== file.blocks.length) { throw new Error('Resolve duplicate Terraform identifiers before applying code.'); }
	if (file.blocks.length !== expected.length || Object.keys(file.attrs).length) { throw new Error('Adding or removing resource blocks in code is not supported yet. Your draft is retained.'); }
	return expected.map(node => {
		if (node.kind === 'module') { throw new Error('Module code apply requires the typed module contract. Your draft is retained.'); }
		const block = file.blocks.find(block => block.type === 'resource' && block.labels[0] === node.type && block.labels[1] === node.name);
		if (!block) { throw new Error('Resource type and Terraform identifier must stay unchanged in this editor.'); }
		const repeats = new Set<string>(); const collect = (attrs: AttrDef[]) => attrs.forEach(attr => { if (attr.repeat) { repeats.add(attr.name); } collect(attr.children ?? []); }); collect(getDef(node.type)?.attributes ?? []);
		const config = blockToConfig(block, repeats); const fields = bindings.get(node.id)!;
		const covered = (path: string[]) => fields.some(field => field.path.every((key, index) => path[index] === key));
		if (leafPaths(config).some(path => !covered(path))) { throw new Error('This edit adds an unmodelled attribute or block. Use the block form; the code draft is retained.'); }
		const resource = architecture.resources.find(resource => resource.id === node.id)!;
		const next = { ...resource, terraformName: node.name, settings: { ...resource.settings }, blocks: structuredClone(resource.blocks) };
		const findBlock = (blocks: ResourceBlock[], id: string): ResourceBlock | undefined => { for (const block of blocks) { if (block.id === id) { return block; } const child = findBlock(block.blocks, id); if (child) { return child; } } return undefined; };
		for (const field of fields) {
			const value = get(config, field.path); const previous = get(node.config, field.path);
			if (JSON.stringify(value) === JSON.stringify(previous)) { continue; }
			if (value === undefined || value === null || isExpr(value) || isRef(value)) { throw new Error('Removing fields or changing expressions requires the typed configuration contract. Your draft is retained.'); }
			const text = typeof value === 'string' ? value : JSON.stringify(value);
			if (field.target === 'name') { if (typeof value !== 'string') { throw new Error('Resource name must be text.'); } next.name = value; }
			else if (field.target === 'region') { const region = providerRegions[resource.provider].find(region => regionCode(region) === value); if (!region) { throw new Error('Choose a supported region in the block form.'); } next.region = region; }
			else if (field.target === 'setting') { next.settings[field.key] = text; }
			else { findBlock(next.blocks, field.blockId!)!.values[field.key] = text; }
		}
		const projected = projectTerraform({ ...architecture, resources: architecture.resources.map(item => item.id === next.id ? next : item) }).project.nodes.find(item => item.id === next.id)!;
		const normalize = (value: Value): unknown => Array.isArray(value) ? value.map(normalize) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child as Value)])) : value;
		if (JSON.stringify(normalize(projected.config)) !== JSON.stringify(normalize(config))) { throw new Error('The edit changes a value type not represented by the current form. Your draft is retained.'); }
		return next;
	});
}
