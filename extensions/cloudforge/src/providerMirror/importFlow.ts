/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { MirrorPackageKey } from './model';

export type MirrorImportField = 'address' | 'version' | 'expectedSha256';
type Platform = 'windows_amd64' | 'linux_amd64';
export interface ReviewedMirrorImport extends MirrorPackageKey { readonly expectedSha256: string }
export type MirrorImportInput = { readonly action: 'next' | 'back'; readonly value: string } | undefined;
export interface MirrorImportPrompts {
	input(field: MirrorImportField, value: string): Promise<MirrorImportInput>;
	platform(value: Platform): Promise<Platform | 'back' | undefined>;
	review(value: ReviewedMirrorImport): Promise<'import' | 'back' | undefined>;
}

/** Local syntax guidance only; the broker and service retain authority over imports. */
export function isMirrorImportFieldValid(field: MirrorImportField, value: string): boolean {
	const text = value.trim();
	return field === 'address' ? /^[a-z0-9.-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(text)
		: field === 'version' ? /^[A-Za-z0-9._+-]+$/.test(text) : /^[0-9a-fA-F]{64}$/.test(text);
}

/** Short-lived navigation draft. No service calls or architecture edits occur before review. */
export async function collectReviewedMirrorImport(prompts: MirrorImportPrompts, prefill?: Partial<MirrorPackageKey>): Promise<ReviewedMirrorImport | undefined> {
	const draft = { address: prefill?.address ?? 'registry.terraform.io/hashicorp/azurerm', version: prefill?.version ?? '5.14.0', expectedSha256: '' };
	let platform: Platform = prefill?.platform === 'linux_amd64' ? 'linux_amd64' : 'windows_amd64';
	let step = 0;
	while (true) {
		if (step === 2) {
			const selected = await prompts.platform(platform);
			if (selected === undefined) { return undefined; }
			if (selected === 'back') { step--; } else { platform = selected; step++; }
		} else if (step === 4) {
			const reviewed = { address: draft.address.trim(), version: draft.version.trim(), platform, expectedSha256: draft.expectedSha256.trim().toLowerCase() };
			const selected = await prompts.review(reviewed);
			if (selected === 'import') { return reviewed; }
			if (selected === undefined) { return undefined; }
			step--;
		} else {
			const field: MirrorImportField = step === 0 ? 'address' : step === 1 ? 'version' : 'expectedSha256';
			const result = await prompts.input(field, draft[field]);
			if (result === undefined) { return undefined; }
			draft[field] = result.value;
			if (result.action === 'back') { step = Math.max(0, step - 1); }
			else if (isMirrorImportFieldValid(field, result.value)) { step++; }
		}
	}
}
