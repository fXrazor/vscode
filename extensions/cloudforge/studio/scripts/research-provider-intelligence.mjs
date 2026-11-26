/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// The checked-in manifest is also the capture input. Reproduction uses exact source revisions,
// never a moving branch. No provider install, state read, cloud login or Terraform execution.
const manifest = JSON.parse(await readFile('research/provider-source-manifest.json', 'utf8'));
await mkdir('output/provider-research', { recursive: true });
const jobs = [...manifest.documents];
const verify = process.argv.includes('--verify-local');
const failures = [];
async function worker() {
	while (jobs.length) {
		const record = jobs.shift();
		try {
			if (!/^https:\/\/github\.com\/(hashicorp\/terraform-provider-(azurerm|aws|google)|kubernetes\/website)\/blob\/[a-f0-9]{40}\//.test(record.url)) { throw new Error('Unpinned source URL'); }
			let content;
			if (verify) { content = await readFile(record.localArtifact, 'utf8'); }
			else {
				const response = await fetch(record.url.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/'), { headers: { 'User-Agent': 'CloudForge-Studio-provider-research' } });
				if (!response.ok) { throw new Error('HTTP ' + response.status); }
				content = await response.text();
				await writeFile(record.localArtifact, content);
			}
			const hash = createHash('sha256').update(content).digest('hex');
			if (hash !== record.sha256) { throw new Error('Pinned source hash mismatch'); }
		} catch (error) { failures.push({ provider: record.provider, resource: record.resource, error: error.message }); }
	}
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(JSON.stringify({ mode: verify ? 'verify-local' : 'reproduce-pinned-capture', documents: manifest.documents.length, failures }));
if (failures.length) { process.exitCode = 1; }
