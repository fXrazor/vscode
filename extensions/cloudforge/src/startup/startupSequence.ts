/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The CloudForge startup sequence: an ordered list of warm-up steps that run behind a usable
// window (service, project, schemas, providers). This module only tracks state and timings so it
// can be tested without VS Code; `startupStatus.ts` shows it in the status bar and a log.

export type StartupStepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface StartupStep {
	readonly id: string;
	readonly label: string;
	readonly state: StartupStepState;
	/** A short outcome, such as "3 provider schemas" or why the step was skipped. */
	readonly detail?: string;
	readonly durationMs?: number;
}

export interface StartupSummary {
	readonly total: number;
	/** Steps that are no longer pending or running. */
	readonly completed: number;
	readonly running?: StartupStep;
	readonly failed: readonly StartupStep[];
	readonly finished: boolean;
	readonly totalMs?: number;
}

export class StartupSequence {
	private readonly items: { id: string; label: string; state: StartupStepState; detail?: string; startedAt?: number; durationMs?: number }[];
	private readonly listeners = new Set<() => void>();
	private readonly startedAt: number;
	private readonly now: () => number;
	private finishedAt?: number;

	constructor(steps: readonly { readonly id: string; readonly label: string }[], now: () => number = () => Date.now()) {
		this.now = now;
		this.items = steps.map(step => ({ id: step.id, label: step.label, state: 'pending' }));
		this.startedAt = now();
	}

	get steps(): readonly StartupStep[] {
		return this.items.map(item => ({
			id: item.id,
			label: item.label,
			state: item.state,
			...(item.detail ? { detail: item.detail } : {}),
			...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
		}));
	}

	get summary(): StartupSummary {
		const steps = this.steps;
		const completed = steps.filter(step => step.state === 'done' || step.state === 'skipped' || step.state === 'failed').length;
		const finished = completed === steps.length;
		return {
			total: steps.length,
			completed,
			...(steps.find(step => step.state === 'running') ? { running: steps.find(step => step.state === 'running') } : {}),
			failed: steps.filter(step => step.state === 'failed'),
			finished,
			...(finished && this.finishedAt !== undefined ? { totalMs: this.finishedAt - this.startedAt } : {}),
		};
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	/**
	 * Runs one step. The task's result becomes the step's detail; returning `{ skipped }` marks it
	 * skipped. A thrown error marks it failed and never stops the steps after it.
	 */
	async run(id: string, task: () => Promise<string | { readonly skipped: string } | undefined>): Promise<StartupStepState> {
		const item = this.items.find(step => step.id === id);
		if (!item || item.state !== 'pending') {
			return item?.state ?? 'failed';
		}
		item.state = 'running';
		item.startedAt = this.now();
		this.emit();
		try {
			const outcome = await task();
			if (outcome && typeof outcome === 'object') {
				item.state = 'skipped';
				item.detail = outcome.skipped;
			} else {
				item.state = 'done';
				item.detail = outcome || undefined;
			}
		} catch (error) {
			item.state = 'failed';
			item.detail = error instanceof Error && error.message ? error.message : 'Unexpected error';
		}
		item.durationMs = Math.max(0, this.now() - item.startedAt);
		this.markFinished();
		this.emit();
		return item.state;
	}

	/** Skips a step that will not run, such as warm-up turned off in settings. */
	skip(id: string, reason: string): void {
		const item = this.items.find(step => step.id === id);
		if (!item || item.state !== 'pending') {
			return;
		}
		item.state = 'skipped';
		item.detail = reason;
		this.markFinished();
		this.emit();
	}

	/** Plain-text log lines: one per step with its state, timing and outcome. */
	logLines(): string[] {
		const symbol: Record<StartupStepState, string> = { pending: '·', running: '…', done: '✓', skipped: '–', failed: '✗' };
		const lines = this.steps.map(step => `${symbol[step.state]} ${step.label}${step.durationMs !== undefined ? ` (${formatDuration(step.durationMs)})` : ''}${step.detail ? `: ${step.detail}` : ''}`);
		const summary = this.summary;
		if (summary.finished && summary.totalMs !== undefined) {
			lines.push(summary.failed.length
				? `Finished in ${formatDuration(summary.totalMs)} with ${summary.failed.length} problem${summary.failed.length === 1 ? '' : 's'}.`
				: `Ready in ${formatDuration(summary.totalMs)}.`);
		}
		return lines;
	}

	private markFinished(): void {
		if (this.finishedAt === undefined && this.items.every(item => item.state !== 'pending' && item.state !== 'running')) {
			this.finishedAt = this.now();
		}
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

export function formatDuration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
