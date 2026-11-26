/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProviderDocumentation } from './provider-documentation-parser.ts';
import { providerSchemaAttributes, providerFieldPaths } from './provider-schema-definition.ts';
import { parseHcl } from '../src/cloudlab-core/hcl.ts';

const studio = fileURLToPath(new URL('../', import.meta.url));
const sourceFlag = process.argv.indexOf('--source');
if (sourceFlag < 0 || !process.argv[sourceFlag + 1]) { throw new Error('Usage: node scripts/import-provider-forms.mjs --source <CloudLab checkout> [--schema-captures <capture directory>]'); }
const source = path.resolve(process.argv[sourceFlag + 1]);
const capturesFlag = process.argv.indexOf('--schema-captures');
const captures = path.resolve(capturesFlag < 0 ? path.join(studio, 'output/provider-schema-capture') : process.argv[capturesFlag + 1]);
const schemaVersions = { azurerm: '5.14.0', aws: '6.73.0', google: '8.10.0' };
const genericIcons = { azurerm: 'catalog-icons/azure/azure-key-vaults.svg', aws: 'catalog-icons/aws/aws-management-console.svg', google: 'catalog-icons/gcp/gcp-cloud-generic.svg' };
const catalog = path.join(source, 'apps/web/public/catalog');
const output = path.join(studio, 'assets/provider-forms');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const git = (directory, args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const curatedBytes = await readFile(path.join(catalog, 'curated.json'));
const curated = JSON.parse(curatedBytes).resources;
const report = { formatVersion: 2, sourceRevision: git(source, ['rev-parse', 'HEAD']), curatedSha256: sha256(curatedBytes), parserSha256: sha256(await readFile(new URL('./provider-documentation-parser.ts', import.meta.url))), schemaNormalizerSha256: sha256(await readFile(new URL('./provider-schema-definition.ts', import.meta.url))), evidence: 'exact captured signed provider schemas; documentation is supplementary and version applicability remains explicit', providers: {} };
const paletteProvenance = {};
const title = type => type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
function attributePaths(attributes, prefix = '') { return attributes.filter(attribute => !attribute.readOnly).flatMap(attribute => [prefix + attribute.name, ...attributePaths(attribute.children ?? [], prefix + attribute.name + '.')]); }

for (const [provider, original] of [['azure', 'azurerm'], ['aws', 'aws'], ['gcp', 'google']]) {
 const definitions = new Map(curated.filter(definition => definition.provider === original).map(definition => [definition.type, definition]));
 const inputHashes = {};
 for (const file of (await readdir(path.join(catalog, original))).filter(file => file.endsWith('.json')).sort()) {
  const bytes = await readFile(path.join(catalog, original, file)); inputHashes[file] = sha256(bytes);
  if (file !== 'index.json') { for (const definition of JSON.parse(bytes).resources ?? []) { definitions.set(definition.type, definition); } }
 }
 const oldPalette = await readJson(path.join(studio, 'assets/catalogue', provider + '.json'));
 const previousEntries = new Map(oldPalette.entries.map(entry => [entry.type, entry]));
 const captureDirectory = path.join(captures, original + '-' + schemaVersions[original]);
 const capture = await readJson(path.join(captureDirectory, 'capture.json'));
 const schemaBytes = await readFile(path.join(captureDirectory, 'schema.json'));
 if (capture.schemaSha256 !== sha256(schemaBytes) || capture.lockSha256 !== sha256(await readFile(path.join(captureDirectory, '.terraform.lock.hcl'))) || capture.initLogSha256 !== sha256(await readFile(path.join(captureDirectory, 'init.log'))) || capture.version !== schemaVersions[original] || capture.provider !== 'registry.terraform.io/hashicorp/' + original || capture.signedByHashiCorp !== true) { throw new Error('Provider capture provenance mismatch: ' + original); }
 const executableSchemas = JSON.parse(schemaBytes).provider_schemas[capture.provider].resource_schemas;
 const index = await readJson(path.join(catalog, original, 'index.json'));
 const repository = path.join(source, 'terraform-provider-' + original);
 const documentationRevision = git(repository, ['rev-parse', 'HEAD']);
 if (git(repository, ['status', '--porcelain', '--', 'website/docs/r'])) { throw new Error('Documentation checkout is dirty: ' + original); }
 const tag = 'v' + index.version;
 const tagAvailable = git(repository, ['tag', '--list', tag]) === tag;
 const tagDocs = new Map();
 if (tagAvailable) { for (const line of git(repository, ['ls-tree', '-r', tag, '--', 'website/docs/r']).split('\n')) { const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line); if (match) { tagDocs.set(match[2], match[1]); } } }
 const pages = new Map();
 async function documentation(docPath) {
  if (!/^website\/docs\/r\/[a-z0-9_]+\.html\.markdown$/.test(docPath)) { return undefined; }
  if (pages.has(docPath)) { return pages.get(docPath); }
  let bytes;
  try { bytes = await readFile(path.join(repository, docPath)); } catch (error) { if (error.code === 'ENOENT') { pages.set(docPath, undefined); return undefined; } throw error; }
  const text = bytes.toString('utf8');
  const argumentsText = text.split(/^##\s+Arguments? Reference\s*$/im)[1]?.split(/^##\s+(?:Attributes? Reference|Timeouts?|Import)\b/im)[0] ?? '';
  const names = [...new Set([...argumentsText.matchAll(/^\s*[-*]\s+`([a-z0-9_]+)`/gm)].map(match => match[1]))];
  const canonical = Buffer.from(text.replace(/\r\n/g, '\n'));
  const blob = createHash('sha1').update('blob ' + canonical.length + '\0').update(canonical).digest('hex');
  const exampleSection = text.split(/^##\s+Example Usage[^\n]*$/im)[1]?.split(/^##\s+/m)[0] ?? '';
  const examples = [];
  for (const match of exampleSection.matchAll(/^```(?:hcl|terraform)\s*\r?\n([\s\S]*?)^```/gm)) {
   // Scrub provider-doc placeholder tokens that resemble live API token formats (e.g. Dynatrace dt0s01.*).
   const code = match[1].trim().replace(/\bdt0[a-z0-9]{3}\.[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{64}\b/g, 'dt-example-token-placeholder');
   if (code.length > 12000) { continue; }
   try { examples.push({ code, types: parseHcl(code).blocks.filter(block => block.type === 'resource').map(block => block.labels[0]) }); } catch { /* Keep the source link; never invent or repair a snippet. */ }
  }
  const value = { attributes: parseProviderDocumentation(text), examples, names, evidence: { path: docPath, sha256: sha256(bytes), url: `https://github.com/hashicorp/terraform-provider-${original}/blob/${documentationRevision}/${docPath}`, matchesDeclaredVersionTag: tagAvailable ? tagDocs.get(docPath) === blob : null, argumentSectionRecognized: argumentsText.length > 0 } };
  pages.set(docPath, value); return value;
 }
 const resources = [], evidence = [], paletteEntries = [];
 for (const type of Object.keys(executableSchemas).sort()) {
  const aggregate = type.replace(/_iam_.+$/, '_iam');
  const template = definitions.get(type) ?? definitions.get(aggregate);
  const previous = previousEntries.get(type) ?? previousEntries.get(aggregate);
  const label = previous?.label ?? title(type.slice(original.length + 1));
  const docPath = template?.docPath || 'website/docs/r/' + type.slice(original.length + 1) + '.html.markdown';
  const page = await documentation(docPath);
  const reviewed = curated.find(definition => definition.type === type);
  const attributes = providerSchemaAttributes(executableSchemas[type].block, page?.attributes ?? template?.attributes, reviewed?.attributes);
  const paths = providerFieldPaths(attributes);
  const reconciliation = (page?.names ?? []).map(name => { const matches = paths.filter(field => field.path.split('.').at(-1) === name); return { name, pathCount: matches.length, paths: matches.slice(0, 8), allPathsSha256: sha256(JSON.stringify(matches)), classification: !matches.length ? 'absentFromCapturedSchema' : matches.some(field => !field.readOnly) ? 'editable' : 'computedOnly' }; });
  const exampleHcl = page?.examples.find(example => example.types.includes(type))?.code;
  const schemaCapture = { provider: capture.provider, version: capture.version, schemaSha256: capture.schemaSha256, engine: capture.engine, signedByHashiCorp: true };
  const definition = { type, provider: original, displayName: label, service: previous?.service ?? template?.service ?? 'Other', category: previous?.category ?? template?.category ?? 'Other', icon: previous?.icon ?? genericIcons[original], iconMatch: previous?.iconMatch ?? 'generic', parents: original === 'azurerm' ? ['azurerm_resource_group'] : [], inherit: [], exported: Object.entries(executableSchemas[type].block.attributes ?? {}).filter(([, attribute]) => !attribute.sensitive && !attribute.write_only).map(([name]) => name), dataArgs: [], learn: template?.learn ?? '', generated: true, docPath: page ? docPath : '', schemaVersion: capture.version, attributes, formEvidence: { schemaCapture, url: page?.evidence.url ?? `https://registry.terraform.io/providers/hashicorp/${original}/${capture.version}/docs/resources/${type.slice(original.length + 1)}`, matchesDeclaredVersionTag: page?.evidence.matchesDeclaredVersionTag === true && capture.version === index.version, unmappedArgumentNames: reconciliation.filter(item => item.classification === 'absentFromCapturedSchema').map(item => item.name), argumentSectionRecognized: page?.evidence.argumentSectionRecognized ?? false, ...(exampleHcl ? { exampleHcl, exampleSha256: sha256(exampleHcl) } : {}) } };
  // Only explicit reviewed topology survives; executable schemas do not imply relationships.
  if (reviewed) { Object.assign(definition, { parents: reviewed.parents, inherit: reviewed.inherit, container: reviewed.container }); }
  resources.push(definition);
  const formPaths = attributePaths(attributes);
  evidence.push({ type, editablePaths: formPaths.length, blocks: formPaths.filter(field => { let fields = attributes, attribute; for (const part of field.split('.')) { attribute = fields.find(item => item.name === part); fields = attribute?.children ?? []; } return attribute?.type === 'block'; }).length, document: page ? { ...page.evidence, documentedArgumentNames: page.names.length, jsonControlledArgumentNames: [], unmappedArgumentNames: definition.formEvidence.unmappedArgumentNames, schemaReconciliation: reconciliation } : null });
  paletteEntries.push({ type, label, service: definition.service, category: definition.category, icon: definition.icon, iconMatch: definition.iconMatch, curated: !!template && !template.generated, fields: attributes.filter(attribute => !attribute.readOnly && ['string','number','bool'].includes(attribute.type)).map(({ name, type, required, description, sensitive }) => ({ name, type, required, description, sensitive })) });
 }
 // Audit every original document, including aggregate/beta/orphan pages excluded from this GA snapshot.
 const documentationAudit = [];
 for (const definition of definitions.values()) {
  const docPath = definition.docPath || 'website/docs/r/' + definition.type.slice(original.length + 1) + '.html.markdown';
  const page = await documentation(docPath); if (!page) { continue; }
  const actualTypes = resources.filter(resource => resource.docPath === docPath).map(resource => resource.type);
  documentationAudit.push({ originalType: definition.type, actualTypes, ...page.evidence, disposition: executableSchemas[definition.type] ? 'schemaResource' : actualTypes.length ? 'sharedResourceDocumentation' : 'notInCapturedProviderVersion' });
 }
 const directory = path.join(output, original); await mkdir(directory, { recursive: true });
 const resourcesBytes = JSON.stringify({ provider: original, version: capture.version, resources }) + '\n';
 const indexBytes = JSON.stringify({ version: capture.version, entries: resources.map(definition => [definition.type, definition.displayName, definition.category, definition.service, definition.icon, definition.iconMatch, 'resources']) }) + '\n';
 const paletteBytes = JSON.stringify({ provider, source: 'hashicorp/' + original, version: capture.version, entries: paletteEntries }) + '\n';
 await writeFile(path.join(directory, 'resources.json'), resourcesBytes); await writeFile(path.join(directory, 'index.json'), indexBytes);
 await writeFile(path.join(studio, 'assets/catalogue', provider + '.json'), paletteBytes);
 paletteProvenance[provider] = { version: capture.version, entries: resources.length, indexSha256: sha256(paletteBytes), schemaSha256: capture.schemaSha256, documentationDeclaredVersion: index.version };
 report.providers[provider] = { declaredVersion: index.version, documentationRevision, declaredVersionTagAvailable: tagAvailable, schemaCapture: capture, resourcesWithCapturedSchema: resources.length, resources: resources.length, editablePaths: evidence.reduce((total,item) => total + item.editablePaths,0), blocks: evidence.reduce((total,item) => total + item.blocks,0), inputHashes, resourcesSha256: sha256(resourcesBytes), indexSha256: sha256(indexBytes), paletteSha256: sha256(paletteBytes), documentationAudit, evidence };
 console.log(JSON.stringify({ provider, version: capture.version, resources: resources.length, editablePaths: report.providers[provider].editablePaths, blocks: report.providers[provider].blocks, documentedResources: evidence.filter(item => item.document).length, sourcePagesAudited: documentationAudit.length, excludedDocumentationTypes: documentationAudit.filter(item => !item.actualTypes.length).length }));
}
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(report, null, '\t') + '\n');
await writeFile(path.join(studio, 'assets/catalogue/provenance.json'), JSON.stringify(paletteProvenance,null,2) + '\n');
