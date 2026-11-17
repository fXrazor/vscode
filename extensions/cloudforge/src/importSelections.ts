/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface ImportCandidate {
	readonly candidateId: string;
	readonly imported: boolean;
}

export interface ImportSelection {
	readonly candidateId: string;
	readonly displayName: string;
}

type ImportSelectionError = 'noSelection' | 'candidateUnavailable' | 'duplicateCandidate' | 'invalidName' | 'duplicateName';

// The service applies the Windows component rules to each linked architecture name.
function isArchitectureName(name: string): boolean {
	const stem = name.split('.', 1)[0];
	return name.length > 0 && name.length <= 255 && name.trim() === name && !name.endsWith('.')
		&& !name.toLowerCase().startsWith('.cloudforge-staging-') && !/[<>:"/\\|?*\p{Cc}]/u.test(name)
		&& !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/i.test(stem);
}

export function validateImportSelections(
	candidates: readonly ImportCandidate[],
	selections: readonly ImportSelection[],
	existingNames: readonly string[],
): ImportSelectionError | undefined {
	if (selections.length === 0) {
		return 'noSelection';
	}
	const availableIds = new Set(candidates.filter(candidate => !candidate.imported).map(candidate => candidate.candidateId));
	const usedNames = new Set(existingNames.map(name => name.toLowerCase()));
	const selectedIds = new Set<string>();
	for (const { candidateId, displayName } of selections) {
		if (!availableIds.has(candidateId)) {
			return 'candidateUnavailable';
		}
		if (selectedIds.has(candidateId)) {
			return 'duplicateCandidate';
		}
		if (!isArchitectureName(displayName)) {
			return 'invalidName';
		}
		const name = displayName.toLowerCase();
		if (usedNames.has(name)) {
			return 'duplicateName';
		}
		selectedIds.add(candidateId);
		usedNames.add(name);
	}
	return undefined;
}
