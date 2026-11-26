/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Developer research only. Never points Terraform at an architecture or deployment workspace.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const engine = args[args.indexOf('--engine') + 1];
const providers = args.flatMap((value, index) => value === '--provider' ? [args[index + 1]] : []);
if (!engine || !path.isAbsolute(engine) || !providers.length || providers.some(value => !/^(aws|google|azurerm)@\d+\.\d+\.\d+$/.test(value))) { throw new Error('Usage: node scripts/capture-provider-schemas.mjs --engine <absolute terraform executable> --provider aws@6.73.0 [--provider google@8.10.0]'); }
const root = path.resolve(import.meta.dirname, '../output/provider-schema-capture');
fs.mkdirSync(root, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const cliConfig = path.join(root, 'terraform.rc');
fs.writeFileSync(cliConfig, 'disable_checkpoint = true\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['systemroot', 'windir', 'path', 'pathext', 'temp', 'tmp', 'comspec'].includes(name.toLowerCase())));
Object.assign(env, { TF_CLI_CONFIG_FILE: cliConfig, TF_IN_AUTOMATION: '1', TF_INPUT: '0', CHECKPOINT_DISABLE: '1', AWS_EC2_METADATA_DISABLED: 'true' });
const version = spawnSync(engine, ['version', '-json'], { env, encoding: 'utf8', windowsHide: true });
if (version.status !== 0) { throw new Error('Cannot inspect Terraform version'); }
const engineVersion = JSON.parse(version.stdout).terraform_version;
for (const selected of providers) {
	const [provider, release] = selected.split('@');
	const directory = path.resolve(root, provider + '-' + release);
	if (!directory.startsWith(root + path.sep)) { throw new Error('Capture outside owned output'); }
	fs.mkdirSync(directory, { recursive: true });
	const registryUrl = `https://registry.terraform.io/v1/providers/hashicorp/${provider}/${release}`;
	const response = await fetch(registryUrl, { signal: AbortSignal.timeout(20000) });
	if (!response.ok) { throw new Error('Registry returned ' + response.status + ' for ' + selected); }
	const registry = await response.json();
	if (registry.version !== release) { throw new Error('Unexpected registry release'); }
	fs.writeFileSync(path.join(directory, 'main.tf'), `terraform {\n  required_providers {\n    ${provider} = {\n      source = "hashicorp/${provider}"\n      version = "${release}"\n    }\n  }\n}\n`);
	console.log('Initialising isolated schema capture: ' + selected);
	const init = spawnSync(engine, ['init', '-backend=false', '-input=false', '-no-color'], { cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
	fs.writeFileSync(path.join(directory, 'init.log'), (init.stdout ?? '') + (init.stderr ?? ''));
	if (init.status !== 0 || !(init.stdout ?? '').includes('(signed by HashiCorp)')) { throw new Error('Signed provider initialization failed; inspect isolated init.log'); }
	const schemaPath = path.join(directory, 'schema.json');
	const stdout = fs.openSync(schemaPath, 'w');
	const stderr = fs.openSync(path.join(directory, 'schema.log'), 'w');
	const rendered = spawnSync(engine, ['providers', 'schema', '-json'], { cwd: directory, env, windowsHide: true, timeout: 120000, stdio: ['ignore', stdout, stderr] });
	fs.closeSync(stdout); fs.closeSync(stderr);
	if (rendered.status !== 0) { throw new Error('Schema capture failed; inspect isolated schema.log'); }
	const bytes = fs.readFileSync(schemaPath);
	const document = JSON.parse(bytes);
	const address = 'registry.terraform.io/hashicorp/' + provider;
	const schema = document.provider_schemas?.[address];
	if (document.format_version !== '1.0' || !schema || fs.existsSync(path.join(directory, 'terraform.tfstate'))) { throw new Error('Unexpected schema format, provider or state'); }
	const manifest = { engine: { name: 'terraform', version: engineVersion, sha256: digest(fs.readFileSync(engine)) }, provider: address, version: release, registryUrl, registrySource: registry.source, recordedAt: new Date().toISOString(), schemaSha256: digest(bytes), lockSha256: digest(fs.readFileSync(path.join(directory, '.terraform.lock.hcl'))), initLogSha256: digest(fs.readFileSync(path.join(directory, 'init.log'))), signedByHashiCorp: true, resources: Object.keys(schema.resource_schemas ?? {}).length, dataSources: Object.keys(schema.data_source_schemas ?? {}).length, commands: ['version -json', 'init -backend=false -input=false -no-color', 'providers schema -json'] };
	fs.writeFileSync(path.join(directory, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n');
	console.log(JSON.stringify(manifest));
}
