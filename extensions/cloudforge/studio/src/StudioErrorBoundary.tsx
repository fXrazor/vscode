/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface StudioErrorBoundaryProps {
	readonly children: ReactNode;
	readonly onRecover?: () => void;
}

interface StudioErrorBoundaryState {
	readonly error: Error | null;
	readonly resetKey: number;
}

/**
 * Top-level safety net for CloudForge Studio so an unexpected render error displays a themed
 * recovery screen instead of unmounting the webview into a blank viewport.
 */
export class StudioErrorBoundary extends Component<StudioErrorBoundaryProps, StudioErrorBoundaryState> {
	override state: StudioErrorBoundaryState = { error: null, resetKey: 0 };

	static getDerivedStateFromError(error: Error): Partial<StudioErrorBoundaryState> {
		return { error };
	}

	override componentDidCatch(_error: Error, _info: ErrorInfo): void {
		// Error details remain local to the recovery view; never leak secrets to external telemetry.
	}

	private readonly handleRecover = () => {
		this.setState(previous => ({ error: null, resetKey: previous.resetKey + 1 }));
		this.props.onRecover?.();
	};

	override render(): ReactNode {
		if (!this.state.error) {
			return <div key={this.state.resetKey} className="studio-root-shell">{this.props.children}</div>;
		}
		const isDark = typeof document !== 'undefined' && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
		const message = this.state.error.message || 'An unexpected rendering error occurred.';
		return (
			<main className={'studio-error-boundary' + (isDark ? ' is-dark' : '')} role="alert" aria-live="assertive">
				<div className="studio-error-card">
					<h1>CloudForge Canvas hit a rendering error</h1>
					<p>Your Terraform files on disk were not modified by this error. Reload the canvas view to continue editing.</p>
					<pre className="studio-error-detail">{message}</pre>
					<div className="studio-error-actions">
						<button type="button" className="primary-button" onClick={this.handleRecover}>Reload canvas</button>
					</div>
				</div>
			</main>
		);
	}
}
