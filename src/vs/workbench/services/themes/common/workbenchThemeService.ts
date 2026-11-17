/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { IColorTheme, IThemeService, IFileIconTheme, IProductIconTheme } from '../../../../platform/theme/common/themeService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { isBoolean, isString } from '../../../../base/common/types.js';
import { IconContribution, IconDefinition } from '../../../../platform/theme/common/iconRegistry.js';
import { ColorScheme, ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export const IWorkbenchThemeService = refineServiceDecorator<IThemeService, IWorkbenchThemeService>(IThemeService);

export const THEME_SCOPE_OPEN_PAREN = '[';
export const THEME_SCOPE_CLOSE_PAREN = ']';
export const THEME_SCOPE_WILDCARD = '*';

export const themeScopeRegex = /\[(.+?)\]/g;

export enum ThemeSettings {
	COLOR_THEME = 'workbench.colorTheme',
	FILE_ICON_THEME = 'workbench.iconTheme',
	PRODUCT_ICON_THEME = 'workbench.productIconTheme',
	COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations',
	TOKEN_COLOR_CUSTOMIZATIONS = 'editor.tokenColorCustomizations',
	SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS = 'editor.semanticTokenColorCustomizations',

	PREFERRED_DARK_THEME = 'workbench.preferredDarkColorTheme',
	PREFERRED_LIGHT_THEME = 'workbench.preferredLightColorTheme',
	PREFERRED_HC_DARK_THEME = 'workbench.preferredHighContrastColorTheme', /* id kept for compatibility reasons */
	PREFERRED_HC_LIGHT_THEME = 'workbench.preferredHighContrastLightColorTheme',
	DETECT_COLOR_SCHEME = 'window.autoDetectColorScheme',
	DETECT_HC = 'window.autoDetectHighContrast',

	SYSTEM_COLOR_THEME = 'window.systemColorTheme'
}

export namespace ThemeSettingDefaults {
	// CloudForge ships the bundled Tokyo Night themes (extensions/theme-tokyo-night) as its defaults.
	export const COLOR_THEME_DARK = 'Tokyo Night';
	export const COLOR_THEME_LIGHT = 'Tokyo Night Light';
	export const COLOR_THEME_HC_DARK = 'Default High Contrast';
	export const COLOR_THEME_HC_LIGHT = 'Default High Contrast Light';

	export const FILE_ICON_THEME = 'vs-seti';
	export const PRODUCT_ICON_THEME = 'Default';
}

/**
 * Migrates legacy theme settings IDs to their current equivalents.
 * Theme IDs were simplified: "Default" prefix was removed from built-in themes,
 * and "Experimental" prefix was replaced when VS Code themes became GA.
 */
export function migrateThemeSettingsId(settingsId: string): string {
	switch (settingsId) {
		case 'Default Dark Modern': return 'Dark Modern';
		case 'Default Light Modern': return 'Light Modern';
		case 'Default Dark+': return 'Dark+';
		case 'Default Light+': return 'Light+';
		case 'Experimental Dark':
		case 'VS Code Dark':
			return ThemeSettingDefaults.COLOR_THEME_DARK;
		case 'Experimental Light':
		case 'VS Code Light':
			return ThemeSettingDefaults.COLOR_THEME_LIGHT;
	}
	return settingsId;
}

export const COLOR_THEME_DARK_INITIAL_COLORS = {
	'activityBar.background': '#16161e',
	'activityBar.border': '#16161e',
	'activityBar.foreground': '#787c99',
	'activityBar.inactiveForeground': '#3b3e52',
	'activityBarBadge.background': '#3d59a1',
	'activityBarBadge.foreground': '#fff',
	'badge.background': '#7e83b230',
	'badge.foreground': '#acb0d0',
	'button.background': '#3d59a1dd',
	'button.foreground': '#ffffff',
	'button.hoverBackground': '#3d59a1AA',
	'button.secondaryBackground': '#3b3e52',
	'chat.slashCommandBackground': '#14141b',
	'chat.slashCommandForeground': '#7aa2f7',
	'debugToolBar.background': '#101014',
	'descriptionForeground': '#515670',
	'dropdown.background': '#14141b',
	'dropdown.foreground': '#787c99',
	'dropdown.listBackground': '#14141b',
	'editor.background': '#1a1b26',
	'editor.findMatchBackground': '#3d59a166',
	'editor.foreground': '#a9b1d6',
	'editor.inactiveSelectionBackground': '#515c7e25',
	'editor.selectionHighlightBackground': '#515c7e44',
	'editorGroup.border': '#101014',
	'editorGroupHeader.tabsBackground': '#16161e',
	'editorGroupHeader.tabsBorder': '#101014',
	'editorGutter.addedBackground': '#164846',
	'editorGutter.deletedBackground': '#823c41',
	'editorGutter.modifiedBackground': '#394b70',
	'editorIndentGuide.activeBackground1': '#363b54',
	'editorIndentGuide.background1': '#232433',
	'editorLineNumber.activeForeground': '#787c99',
	'editorLineNumber.foreground': '#363b54',
	'editorOverviewRuler.border': '#101014',
	'editorWidget.background': '#16161e',
	'errorForeground': '#515670',
	'focusBorder': '#545c7e33',
	'foreground': '#787c99',
	'icon.foreground': '#787c99',
	'input.background': '#14141b',
	'input.border': '#0f0f14',
	'input.foreground': '#a9b1d6',
	'input.placeholderForeground': '#787c998A',
	'inputOption.activeBackground': '#3d59a144',
	'list.dropBackground': '#1e202e',
	'menu.background': '#16161e',
	'menu.border': '#101014',
	'menu.foreground': '#787c99',
	'menu.selectionBackground': '#1e202e',
	'menu.separatorBackground': '#101014',
	'notificationCenterHeader.background': '#101014',
	'notifications.background': '#101014',
	'panel.background': '#16161e',
	'panel.border': '#101014',
	'panelInput.border': '#16161e',
	'panelTitle.activeBorder': '#16161e',
	'panelTitle.activeForeground': '#787c99',
	'panelTitle.inactiveForeground': '#42465d',
	'peekViewEditor.background': '#16161e',
	'peekViewEditor.matchHighlightBackground': '#3d59a166',
	'peekViewResult.background': '#101014',
	'peekViewResult.matchHighlightBackground': '#3d59a166',
	'pickerGroup.border': '#101014',
	'progressBar.background': '#3d59a1',
	'settings.headerForeground': '#6183bb',
	'sideBar.background': '#16161e',
	'sideBar.border': '#101014',
	'sideBar.foreground': '#787c99',
	'sideBarSectionHeader.background': '#16161e',
	'sideBarSectionHeader.border': '#101014',
	'sideBarSectionHeader.foreground': '#a9b1d6',
	'sideBarTitle.foreground': '#787c99',
	'statusBar.background': '#16161e',
	'statusBar.border': '#101014',
	'statusBar.debuggingBackground': '#16161e',
	'statusBar.debuggingForeground': '#787c99',
	'statusBar.foreground': '#787c99',
	'statusBar.noFolderBackground': '#16161e',
	'statusBarItem.prominentBackground': '#101014',
	'tab.activeBackground': '#16161e',
	'tab.activeBorder': '#3d59a1',
	'tab.activeForeground': '#a9b1d6',
	'tab.border': '#101014',
	'tab.inactiveBackground': '#16161e',
	'tab.inactiveForeground': '#787c99',
	'tab.lastPinnedBorder': '#222333',
	'tab.unfocusedActiveBorder': '#1f202e',
	'terminal.foreground': '#787c99',
	'textBlockQuote.background': '#16161e',
	'textCodeBlock.background': '#16161e',
	'textLink.activeForeground': '#7dcfff',
	'textLink.foreground': '#6183bb',
	'textPreformat.foreground': '#9699a8',
	'textSeparator.foreground': '#363b54',
	'titleBar.activeBackground': '#16161e',
	'titleBar.activeForeground': '#787c99',
	'titleBar.border': '#101014',
	'titleBar.inactiveBackground': '#16161e',
	'titleBar.inactiveForeground': '#787c99',
};

export const COLOR_THEME_LIGHT_INITIAL_COLORS = {
	'activityBar.activeBorder': '#2959aa',
	'activityBar.background': '#d6d8df',
	'activityBar.border': '#d6d8df',
	'activityBar.foreground': '#363c4d',
	'activityBar.inactiveForeground': '#7d7f8f',
	'activityBarBadge.background': '#2959aa',
	'activityBarBadge.foreground': '#fff',
	'badge.background': '#979db833',
	'badge.foreground': '#363c4d',
	'button.background': '#2959aadd',
	'button.foreground': '#ffffff',
	'button.hoverBackground': '#2959aaAA',
	'button.secondaryBackground': '#707280',
	'chat.slashCommandBackground': '#e6e7ed',
	'chat.slashCommandForeground': '#2959aa',
	'descriptionForeground': '#707280',
	'dropdown.background': '#e6e7ed',
	'dropdown.border': '#c1c2c7',
	'dropdown.foreground': '#363c4d',
	'dropdown.listBackground': '#e6e7ed',
	'editor.background': '#e6e7ed',
	'editor.foreground': '#343b59',
	'editor.inactiveSelectionBackground': '#acb0bf33',
	'editor.selectionHighlightBackground': '#9aa5ce55',
	'editorGroup.border': '#c1c2c7',
	'editorGroupHeader.tabsBackground': '#d6d8df',
	'editorGroupHeader.tabsBorder': '#c1c2c7',
	'editorGutter.addedBackground': '#71b6bd',
	'editorGutter.deletedBackground': '#a8626a',
	'editorGutter.modifiedBackground': '#637dbf',
	'editorIndentGuide.activeBackground1': '#bdc1cf',
	'editorIndentGuide.background1': '#d0d4e3',
	'editorLineNumber.activeForeground': '#363c4d',
	'editorLineNumber.foreground': '#9da0ab',
	'editorOverviewRuler.border': '#c1c2c7',
	'editorSuggestWidget.background': '#dcdee3',
	'editorWidget.background': '#d6d8df',
	'errorForeground': '#5a607d',
	'focusBorder': '#70728033',
	'foreground': '#363c4d',
	'icon.foreground': '#707280',
	'input.background': '#e6e7ed',
	'input.border': '#c1c2c7',
	'input.foreground': '#363c4d',
	'input.placeholderForeground': '#4a5272',
	'inputOption.activeBackground': '#2959aa44',
	'list.activeSelectionBackground': '#e6e7ed',
	'list.activeSelectionForeground': '#363c4d',
	'list.hoverBackground': '#e1e2e8',
	'menu.border': '#c1c2c7',
	'menu.selectionBackground': '#7a85a8',
	'menu.selectionForeground': '#343b58',
	'notebook.cellBorderColor': '#c1c2c7',
	'notificationCenterHeader.background': '#dcdee3',
	'notifications.background': '#dcdee3',
	'panel.background': '#d6d8df',
	'panel.border': '#c1c2c7',
	'panelInput.border': '#e6e7ed',
	'panelTitle.activeBorder': '#2959aa',
	'panelTitle.activeForeground': '#363c4d',
	'panelTitle.inactiveForeground': '#707280',
	'peekViewEditor.matchHighlightBackground': '#2959aa22',
	'peekViewResult.background': '#d7d9de',
	'peekViewResult.matchHighlightBackground': '#2959aa22',
	'pickerGroup.border': '#c1c2c7',
	'pickerGroup.foreground': '#363c4d',
	'progressBar.background': '#2959aa',
	'settings.headerForeground': '#2959aa',
	'sideBar.background': '#d6d8df',
	'sideBar.border': '#c1c2c7',
	'sideBar.foreground': '#363c4d',
	'sideBarSectionHeader.background': '#d6d8df',
	'sideBarSectionHeader.border': '#c1c2c7',
	'sideBarSectionHeader.foreground': '#363c4d',
	'sideBarTitle.foreground': '#363c4d',
	'statusBar.background': '#d6d8df',
	'statusBar.border': '#c1c2c7',
	'statusBar.debuggingBackground': '#e6e7ed',
	'statusBar.debuggingForeground': '#363c4d',
	'statusBar.foreground': '#363c4d',
	'statusBar.noFolderBackground': '#e6e7ed',
	'statusBarItem.hoverBackground': '#e6e7ed',
	'statusBarItem.prominentBackground': '#c1c2c7',
	'tab.activeBackground': '#dadce3',
	'tab.activeBorder': '#2959aa',
	'tab.activeForeground': '#363c4d',
	'tab.border': '#c1c2c7',
	'tab.hoverBackground': '#dadce3',
	'tab.inactiveBackground': '#d6d8df',
	'tab.inactiveForeground': '#363c4d',
	'tab.lastPinnedBorder': '#dadbe0',
	'tab.selectedBackground': '#d6d8df',
	'tab.unfocusedActiveBorder': '#9da0ab',
	'terminal.foreground': '#343B58',
	'terminalCursor.foreground': '#707280',
	'textBlockQuote.background': '#d6d8df',
	'textCodeBlock.background': '#e6e7ed',
	'textLink.activeForeground': '#363c4d',
	'textLink.foreground': '#2959aa',
	'textPreformat.foreground': '#33635c',
	'textSeparator.foreground': '#707280',
	'titleBar.activeBackground': '#d6d8df',
	'titleBar.activeForeground': '#363c4d',
	'titleBar.border': '#c1c2c7',
	'titleBar.inactiveBackground': '#d6d8df',
	'titleBar.inactiveForeground': '#363c4d',
};

export interface IWorkbenchTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionData?: ExtensionData;
	readonly description?: string;
	readonly settingsId: string | null;
}

export interface IWorkbenchColorTheme extends IWorkbenchTheme, IColorTheme {
	readonly settingsId: string;
	readonly tokenColors: ITextMateThemingRule[];
}

export interface IColorMap {
	[id: string]: Color;
}

export interface IWorkbenchFileIconTheme extends IWorkbenchTheme, IFileIconTheme {
}

export interface IWorkbenchProductIconTheme extends IWorkbenchTheme, IProductIconTheme {
	readonly settingsId: string;

	getIcon(icon: IconContribution): IconDefinition | undefined;
}

export type ThemeSettingTarget = ConfigurationTarget | undefined | 'auto' | 'preview';


export interface IWorkbenchThemeService extends IThemeService {
	readonly _serviceBrand: undefined;
	setColorTheme(themeId: string | undefined | IWorkbenchColorTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchColorTheme | null>;
	getColorTheme(): IWorkbenchColorTheme;
	/** Returns the selected theme and user customizations without window-local overlays. */
	getBaseColorTheme(): IWorkbenchColorTheme;
	getColorThemes(): Promise<IWorkbenchColorTheme[]>;
	getMarketplaceColorThemes(publisher: string, name: string, version: string): Promise<IWorkbenchColorTheme[]>;
	readonly onDidColorThemeChange: Event<IWorkbenchColorTheme>;

	/** Applies window-local colors computed from the base theme, without persisting them or changing the selected theme. */
	registerColorThemeOverlay(getColors: (theme: IWorkbenchColorTheme) => IColorMap): IDisposable;

	getPreferredColorScheme(): ColorScheme | undefined;

	setFileIconTheme(iconThemeId: string | undefined | IWorkbenchFileIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchFileIconTheme>;
	getFileIconTheme(): IWorkbenchFileIconTheme;
	getFileIconThemes(): Promise<IWorkbenchFileIconTheme[]>;
	getMarketplaceFileIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchFileIconTheme[]>;
	readonly onDidFileIconThemeChange: Event<IWorkbenchFileIconTheme>;

	setProductIconTheme(iconThemeId: string | undefined | IWorkbenchProductIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchProductIconTheme>;
	getProductIconTheme(): IWorkbenchProductIconTheme;
	getProductIconThemes(): Promise<IWorkbenchProductIconTheme[]>;
	getMarketplaceProductIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchProductIconTheme[]>;
	readonly onDidProductIconThemeChange: Event<IWorkbenchProductIconTheme>;
}

export interface IThemeScopedColorCustomizations {
	[colorId: string]: string;
}

export interface IColorCustomizations {
	[colorIdOrThemeScope: string]: IThemeScopedColorCustomizations | string;
}

export interface IThemeScopedTokenColorCustomizations {
	[groupId: string]: ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface ITokenColorCustomizations {
	[groupIdOrThemeScope: string]: IThemeScopedTokenColorCustomizations | ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface IThemeScopedSemanticTokenColorCustomizations {
	[styleRule: string]: ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface ISemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedSemanticTokenColorCustomizations | ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface IThemeScopedExperimentalSemanticTokenColorCustomizations {
	[themeScope: string]: ISemanticTokenRules | undefined;
}

export interface IExperimentalSemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedExperimentalSemanticTokenColorCustomizations | ISemanticTokenRules | undefined;
}

export type IThemeScopedCustomizations =
	IThemeScopedColorCustomizations
	| IThemeScopedTokenColorCustomizations
	| IThemeScopedExperimentalSemanticTokenColorCustomizations
	| IThemeScopedSemanticTokenColorCustomizations;

export type IThemeScopableCustomizations =
	IColorCustomizations
	| ITokenColorCustomizations
	| IExperimentalSemanticTokenColorCustomizations
	| ISemanticTokenColorCustomizations;

export interface ISemanticTokenRules {
	[selector: string]: string | ISemanticTokenColorizationSetting | undefined;
}

export interface ITextMateThemingRule {
	name?: string;
	scope?: string | string[];
	settings: ITokenColorizationSetting;
}

export interface ITokenColorizationSetting {
	foreground?: string;
	background?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
}

export interface ISemanticTokenColorizationSetting {
	foreground?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	bold?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	italic?: boolean;
}

export interface ExtensionData {
	extensionId: string;
	extensionPublisher: string;
	extensionName: string;
	extensionIsBuiltin: boolean;
}

export namespace ExtensionData {
	export function toJSONObject(d: ExtensionData | undefined): any {
		return d && { _extensionId: d.extensionId, _extensionIsBuiltin: d.extensionIsBuiltin, _extensionName: d.extensionName, _extensionPublisher: d.extensionPublisher };
	}
	export function fromJSONObject(o: any): ExtensionData | undefined {
		if (o && isString(o._extensionId) && isBoolean(o._extensionIsBuiltin) && isString(o._extensionName) && isString(o._extensionPublisher)) {
			return { extensionId: o._extensionId, extensionIsBuiltin: o._extensionIsBuiltin, extensionName: o._extensionName, extensionPublisher: o._extensionPublisher };
		}
		return undefined;
	}
	export function fromName(publisher: string, name: string, isBuiltin = false): ExtensionData {
		return { extensionPublisher: publisher, extensionId: `${publisher}.${name}`, extensionName: name, extensionIsBuiltin: isBuiltin };
	}
}

export interface IThemeExtensionPoint {
	id: string;
	label?: string;
	description?: string;
	path: string;
	uiTheme?: ThemeTypeSelector;
	_watch: boolean; // unsupported options to watch location
}
