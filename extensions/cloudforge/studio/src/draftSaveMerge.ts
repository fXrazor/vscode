/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HostDraftSaveMerge } from './webviewBridge.ts';

/** Plain-language summary of a focused save: what changes, and what is kept as written. */
export function describeMerge(merge: HostDraftSaveMerge): string[] {
	const lines: string[] = [];
	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	if (merge.updated.length) {
		lines.push(`Updates ${merge.updated.slice(0, 3).join(', ')}${merge.updated.length > 3 ? ` and ${merge.updated.length - 3} more` : ''}`);
	}
	if (merge.added.length) {
		lines.push(`Adds ${merge.added.slice(0, 3).join(', ')}${merge.added.length > 3 ? ` and ${merge.added.length - 3} more` : ''}`);
	}
	if (merge.removed.length) {
		lines.push(`Removes ${merge.removed.join(', ')}`);
	}
	if (!merge.updated.length && !merge.added.length && !merge.removed.length) {
		lines.push('No changes to write');
	}
	const kept = merge.unchanged + merge.preserved;
	if (kept) {
		lines.push(`Keeps ${plural(kept, 'other block')} exactly as written`);
	}
	lines.push('Comments and fields the canvas does not show are kept');
	if (merge.skipped.length) {
		lines.push(`Left alone because the address appears twice: ${merge.skipped.join(', ')}`);
	}
	return lines;
}
