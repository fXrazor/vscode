/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, Disposable, l10n, MarkdownString, StatusBarAlignment, ThemeColor, window, type OutputChannel } from 'vscode';
import { formatDuration, type StartupSequence, type StartupStepState } from './startupSequence';

const ICON: Record<StartupStepState, string> = {
	pending: '$(circle-large-outline)',
	running: '$(loading~spin)',
	done: '$(check)',
	skipped: '$(dash)',
	failed: '$(warning)',
};

/**
 * Shows the startup sequence in the status bar while it runs: the current step and a count, with
 * every step and its timing in the tooltip. On success it says "CloudForge ready" briefly and hides;
 * on a problem it stays until clicked. Clicking opens the CloudForge Startup log.
 */
export function showStartupStatus(sequence: StartupSequence, output: OutputChannel): Disposable {
	const item = window.createStatusBarItem('cloudforge.startup', StatusBarAlignment.Left, 99);
	item.name = l10n.t('CloudForge Startup');
	item.command = 'cloudforge.showStartupLog';
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let logged = false;
	const opened = Date.now();

	const render = () => {
		const summary = sequence.summary;
		const tooltip = new MarkdownString(undefined, true);
		tooltip.appendMarkdown(`**${l10n.t('CloudForge startup')}**\n\n`);
		for (const step of sequence.steps) {
			const timing = step.durationMs !== undefined ? ` · ${formatDuration(step.durationMs)}` : '';
			tooltip.appendMarkdown(`${ICON[step.state]} ${escape(step.label)}${timing}${step.detail ? ` · ${escape(step.detail)}` : ''}\n\n`);
		}
		tooltip.appendMarkdown(`_${l10n.t('Click to open the startup log.')}_`);
		item.tooltip = tooltip;
		item.backgroundColor = undefined;
		if (!summary.finished) {
			const current = summary.running?.label ?? l10n.t('Starting');
			item.text = `$(loading~spin) ${l10n.t('CloudForge: {0} ({1}/{2})', current, Math.min(summary.completed + 1, summary.total), summary.total)}`;
			item.accessibilityInformation = { label: l10n.t('CloudForge is starting: {0}', current), role: 'status' };
			item.show();
			return;
		}
		if (!logged) {
			logged = true;
			output.appendLine(l10n.t('CloudForge startup, {0}', new Date(opened).toLocaleString()));
			for (const line of sequence.logLines()) {
				output.appendLine('  ' + line);
			}
		}
		if (summary.failed.length) {
			item.text = `$(warning) ${l10n.t('CloudForge: startup problem')}`;
			item.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
			item.accessibilityInformation = { label: l10n.t('CloudForge startup finished with a problem. Open the log.'), role: 'button' };
			item.show();
			return;
		}
		item.text = `$(check) ${l10n.t('CloudForge ready')}`;
		item.accessibilityInformation = { label: l10n.t('CloudForge is ready'), role: 'status' };
		item.show();
		hideTimer ??= setTimeout(() => item.hide(), 5000);
	};

	const subscription = sequence.onDidChange(render);
	const command = commands.registerCommand('cloudforge.showStartupLog', () => {
		output.show(true);
		if (sequence.summary.finished && sequence.summary.failed.length) {
			item.hide();
		}
	});
	render();
	return Disposable.from(item, command, { dispose: () => { subscription.dispose(); if (hideTimer) { clearTimeout(hideTimer); } } });
}

function escape(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, character => '\\' + character);
}
