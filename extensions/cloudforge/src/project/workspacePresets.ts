/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure built-in workspace layout presets (Spike D: zero core patches, standard Workbench commands).
// No runtime `vscode` import so `node --test` can verify layout descriptors directly.

export type WorkspacePresetId = 'canvas-focus' | 'architecture-code' | 'project-overview';

export interface EditorLayoutSpec {
	readonly orientation: 0 | 1;
	readonly groups: readonly { readonly size?: number }[];
}

export interface WorkspacePresetDefinition {
	readonly id: WorkspacePresetId;
	readonly label: string;
	readonly description: string;
	readonly detail: string;
	readonly icon: string;
	readonly focusMode: boolean;
	readonly editorLayout?: EditorLayoutSpec;
	readonly showPrimarySidebar: boolean;
	readonly hideSecondarySidebar: boolean;
	readonly hideBottomPanel: boolean;
}

export const WORKSPACE_PRESETS: readonly WorkspacePresetDefinition[] = [
	{
		id: 'canvas-focus',
		label: 'Canvas Focus (Full Screen)',
		description: 'Edge-to-edge canvas workspace',
		detail: 'Hides sidebars, chat, bottom panel, tabs, and status bar so only the Architecture Canvas fills the window.',
		icon: '$(screen-full)',
		focusMode: true,
		showPrimarySidebar: false,
		hideSecondarySidebar: true,
		hideBottomPanel: true,
	},
	{
		id: 'architecture-code',
		label: 'Architecture + Code (Split View)',
		description: '60% Canvas · 40% Terraform source',
		detail: 'Places the Architecture Canvas beside your active .tf file with Project Explorer open and chat/terminal hidden.',
		icon: '$(split-horizontal)',
		focusMode: false,
		editorLayout: {
			orientation: 0,
			groups: [{ size: 0.6 }, { size: 0.4 }],
		},
		showPrimarySidebar: true,
		hideSecondarySidebar: true,
		hideBottomPanel: true,
	},
	{
		id: 'project-overview',
		label: 'Project Overview (Default Workbench)',
		description: 'Project tree, Graph tree, and Canvas',
		detail: 'Restores the standard single-group editor layout and reveals CloudForge Project and CloudForge Graph.',
		icon: '$(layout)',
		focusMode: false,
		editorLayout: {
			orientation: 0,
			groups: [{}],
		},
		showPrimarySidebar: true,
		hideSecondarySidebar: false,
		hideBottomPanel: false,
	},
];

export function isWorkspacePresetId(value: unknown): value is WorkspacePresetId {
	return value === 'canvas-focus' || value === 'architecture-code' || value === 'project-overview';
}

export function findWorkspacePreset(id: WorkspacePresetId): WorkspacePresetDefinition {
	return WORKSPACE_PRESETS.find(preset => preset.id === id)!;
}
