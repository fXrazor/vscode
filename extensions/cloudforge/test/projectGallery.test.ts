/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGalleryCards, parseArchitectureSummaries, providerLabel, relativeTime } from '../src/project/gallery.ts';
import { buildGalleryHtml } from '../src/project/galleryHtml.ts';
import type { ProjectResult } from '../src/project/model.ts';

const workspaceId = 'workspace-0123456789abcdef0123456789abcdef';
const sha = 'a'.repeat(64);
const project: ProjectResult = {
	workspaceId,
	displayName: 'Contoso',
	hasWorkspaceFile: true,
	repositories: [{ repositoryId: `${workspaceId}-repository-1`, displayName: 'infra', location: 'project', status: 'available', workspaceFolderIndex: 1 }],
	architectures: [
		{ architectureId: `${workspaceId}-architecture-1`, displayName: 'Empty', source: 'local' },
		{ architectureId: `${workspaceId}-architecture-2`, displayName: 'Web', source: 'local' },
		{ architectureId: `${workspaceId}-architecture-3`, displayName: 'Hub', source: 'repository', repositoryId: `${workspaceId}-repository-1` },
	],
	unimportedFolders: [],
	importedArchitectureIds: [],
} as unknown as ProjectResult;

const summaryResult = {
	workspaceId,
	architectures: [
		{ architectureId: `${workspaceId}-architecture-1`, status: 'empty' },
		{ architectureId: `${workspaceId}-architecture-2`, status: 'available', sourceRevision: sha, fileCount: 2, resourceCount: 3, dataSourceCount: 1, moduleCount: 1, providers: ['aws', 'azurerm', 'BAD PREFIX'], lastModified: '2026-11-25T15:29:30.123Z' },
		{ architectureId: `${workspaceId}-architecture-9`, status: 'bogus' },
	],
};

test('parses summaries for the active grant and drops malformed entries and fields', () => {
	const parsed = parseArchitectureSummaries(summaryResult, workspaceId)!;
	assert.equal(parsed.size, 2);
	assert.deepEqual(parsed.get(`${workspaceId}-architecture-2`)?.providers, ['aws', 'azurerm']);
	assert.equal(parsed.get(`${workspaceId}-architecture-2`)?.lastModified, '2026-11-25T15:29:30.123Z');
	assert.equal(parseArchitectureSummaries(summaryResult, 'workspace-other'), undefined);
	assert.equal(parseArchitectureSummaries({ ...summaryResult, architectures: 'x' }, workspaceId), undefined);
	const bad = parseArchitectureSummaries({ workspaceId, architectures: [{ architectureId: 'a', status: 'available', resourceCount: -1, lastModified: 'yesterday', sourceRevision: 'zz' }] }, workspaceId)!;
	assert.deepEqual([bad.get('a')?.resourceCount, bad.get('a')?.lastModified, bad.get('a')?.sourceRevision], [undefined, undefined, undefined]);
});

test('builds one card per architecture, loading before summaries and unavailable when missing', () => {
	assert.deepEqual(buildGalleryCards(project, undefined).map(card => card.status), ['loading', 'loading', 'loading']);
	const cards = buildGalleryCards(project, parseArchitectureSummaries(summaryResult, workspaceId));
	assert.deepEqual(cards.map(card => card.status), ['empty', 'available', 'unavailable']);
	assert.equal(cards[1].resourceCount, 3);
	assert.equal(cards[2].repositoryName, 'infra');
});

test('labels providers and relative edit times', () => {
	assert.equal(providerLabel('azurerm'), 'Azure');
	assert.equal(providerLabel('cloudflare'), 'cloudflare');
	const now = Date.parse('2026-11-25T15:30:00.000Z');
	assert.equal(relativeTime('2026-11-25T15:29:50.000Z', now), 'just now');
	assert.equal(relativeTime('2026-11-25T15:25:00.000Z', now), '5 min ago');
	assert.equal(relativeTime('2026-11-25T14:30:00.000Z', now), '1 hour ago');
	assert.equal(relativeTime('2026-11-22T15:30:00.000Z', now), '3 days ago');
	assert.equal(relativeTime(undefined, now), undefined);
});

test('gallery HTML is nonce-locked and renders names as text only', () => {
	const html = buildGalleryHtml({ nonce: 'n0nce', cspSource: 'vscode-resource:' });
	assert.match(html, /default-src 'none'/);
	assert.match(html, /script-src 'nonce-n0nce'/);
	assert.doesNotMatch(html, /innerHTML/);
	assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});
