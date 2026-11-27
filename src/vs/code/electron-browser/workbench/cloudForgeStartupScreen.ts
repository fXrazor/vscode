/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

// CloudForge startup screen (see CloudForge `branding-assets.md`). It covers a measured delay
// before the workbench is usable: it only fades in when loading takes longer than `delayMs`, and the
// parts splash contribution removes it as soon as the workbench lays out. It never waits for
// extensions, the CloudForge service or provider schemas; those load behind a usable window.

export const CLOUDFORGE_STARTUP_SCREEN_ID = 'cloudforge-startup-screen';
/** Event the workbench dispatches on the screen element when it is usable. */
export const CLOUDFORGE_STARTUP_DISMISS_EVENT = 'cloudforge-dismiss';

export type CloudForgeStartupTheme = 'light' | 'dark' | 'hc-dark' | 'hc-light';

export interface ICloudForgeStartupScreenOptions {
	readonly theme: CloudForgeStartupTheme;
	/** Show nothing on a fast launch; tune with cold and warm launch measurements. */
	readonly delayMs: number;
	/** After this long, offer to dismiss the screen so a failed load never hides the window. */
	readonly slowAfterMs: number;
}

/** Picks the screen theme from the stored parts splash theme, else the OS colour scheme. */
export function cloudForgeStartupTheme(baseTheme: string | undefined, colorScheme: { readonly dark: boolean; readonly highContrast: boolean }): CloudForgeStartupTheme {
	switch (baseTheme) {
		case 'vs': return 'light';
		case 'vs-dark': return 'dark';
		case 'hc-black': return 'hc-dark';
		case 'hc-light': return 'hc-light';
	}
	if (colorScheme.highContrast) {
		return colorScheme.dark ? 'hc-dark' : 'hc-light';
	}
	return colorScheme.dark ? 'dark' : 'light';
}

const STYLE = `
#${CLOUDFORGE_STARTUP_SCREEN_ID} {
	position: fixed; inset: 0; z-index: 2600; overflow: hidden;
	display: flex; align-items: flex-end; justify-content: flex-start;
	opacity: 0; pointer-events: none;
	font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
	animation: cloudforge-startup-in 140ms ease-out var(--cf-delay) forwards;
	transition: opacity 140ms ease-in;
	background: #f3f0fa; color: #1d1a26;
}
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-dark { background: radial-gradient(120% 90% at 85% 20%, #2a2340 0%, #16131f 55%, #110f18 100%); color: #ece9f5; }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-dark { background: #000; color: #fff; }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-light { background: #fff; color: #000; }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-leaving { opacity: 0 !important; animation: none; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 70% 50%; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-panel {
	position: relative; margin: 0 0 clamp(16px, 5vh, 40px) clamp(16px, 4vw, 40px);
	display: grid; grid-template-columns: 40px 1fr; column-gap: 12px; row-gap: 10px; align-items: center;
	width: min(340px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px 14px;
	border-radius: 12px; background: rgba(255, 255, 255, 0.9); border: 1px solid rgba(76, 58, 140, 0.14);
	box-shadow: 0 12px 32px rgba(40, 24, 90, 0.16);
}
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-dark .cf-panel { background: rgba(28, 25, 38, 0.92); border-color: rgba(190, 175, 255, 0.16); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-dark .cf-panel, #${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-light .cf-panel { background: Canvas; color: CanvasText; border: 2px solid CanvasText; box-shadow: none; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-mark { width: 40px; height: 40px; border-radius: 9px; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-name { font-size: 16px; font-weight: 600; letter-spacing: 0.01em; line-height: 1.2; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-status { font-size: 12px; line-height: 1.35; opacity: 0.78; margin-top: 2px; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-track { grid-column: 1 / -1; height: 2px; border-radius: 2px; overflow: hidden; background: rgba(124, 92, 255, 0.16); }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-bar { width: 36%; height: 100%; border-radius: 2px; background: #7c5cff; animation: cloudforge-startup-bar 1.3s ease-in-out infinite; }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-dark .cf-bar, #${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-hc-light .cf-bar { background: Highlight; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-continue {
	grid-column: 1 / -1; justify-self: start; display: none; pointer-events: auto; cursor: pointer;
	font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px;
	border: 1px solid currentColor; background: transparent; color: inherit;
}
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-slow { pointer-events: auto; }
#${CLOUDFORGE_STARTUP_SCREEN_ID}.cf-slow .cf-continue { display: inline-block; }
#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-continue:focus-visible { outline: 2px solid #7c5cff; outline-offset: 2px; }
@keyframes cloudforge-startup-in { to { opacity: 1; } }
@keyframes cloudforge-startup-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(280%); } }
@media (prefers-reduced-motion: reduce) {
	#${CLOUDFORGE_STARTUP_SCREEN_ID} { animation-duration: 1ms; transition: none; }
	#${CLOUDFORGE_STARTUP_SCREEN_ID} .cf-bar { animation: none; width: 100%; opacity: 0.6; }
}
`;

/** Adds the (initially invisible) startup screen. Returns a status setter for the load stages. */
export function showCloudForgeStartupScreen(options: ICloudForgeStartupScreenOptions): (status: string) => void {
	const existing = document.getElementById(CLOUDFORGE_STARTUP_SCREEN_ID);
	existing?.remove();

	const style = document.createElement('style');
	style.id = `${CLOUDFORGE_STARTUP_SCREEN_ID}-style`;
	style.textContent = STYLE;
	document.head.appendChild(style);

	const screen = document.createElement('div');
	screen.id = CLOUDFORGE_STARTUP_SCREEN_ID;
	screen.className = `cf-${options.theme}`;
	screen.style.setProperty('--cf-delay', `${Math.max(0, options.delayMs)}ms`);

	// The artwork is for the light theme only; dark and high contrast use the built-in surface.
	if (options.theme === 'light') {
		const art = document.createElement('img');
		art.className = 'cf-art';
		art.alt = '';
		art.setAttribute('aria-hidden', 'true');
		art.decoding = 'async';
		art.onerror = () => art.remove();
		art.src = new URL('./media/cloudforge-splash-light.webp', import.meta.url).toString();
		screen.appendChild(art);
	}

	const panel = document.createElement('div');
	panel.className = 'cf-panel';

	const mark = document.createElement('img');
	mark.className = 'cf-mark';
	mark.alt = '';
	mark.setAttribute('aria-hidden', 'true');
	mark.onerror = () => { mark.style.visibility = 'hidden'; };
	mark.src = new URL('./media/cloudforge-mark.png', import.meta.url).toString();
	panel.appendChild(mark);

	const text = document.createElement('div');
	const name = document.createElement('div');
	name.className = 'cf-name';
	name.textContent = 'CloudForge';
	const status = document.createElement('div');
	status.className = 'cf-status';
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.textContent = 'Starting…';
	text.append(name, status);
	panel.appendChild(text);

	const track = document.createElement('div');
	track.className = 'cf-track';
	const bar = document.createElement('div');
	bar.className = 'cf-bar';
	track.appendChild(bar);
	panel.appendChild(track);

	const proceed = document.createElement('button');
	proceed.type = 'button';
	proceed.className = 'cf-continue';
	proceed.textContent = 'Continue to the window';
	proceed.onclick = () => removeCloudForgeStartupScreen();
	panel.appendChild(proceed);

	screen.appendChild(panel);
	document.body.appendChild(screen);

	const slowTimer = setTimeout(() => {
		if (screen.isConnected) {
			screen.classList.add('cf-slow');
			status.textContent = 'This is taking longer than usual.';
		}
	}, options.slowAfterMs);
	screen.addEventListener('cloudforge-removed', () => clearTimeout(slowTimer), { once: true });
	// The workbench (parts splash contribution) dispatches this once the main container lays out.
	screen.addEventListener(CLOUDFORGE_STARTUP_DISMISS_EVENT, () => removeCloudForgeStartupScreen(), { once: true });

	return (next: string) => {
		if (screen.isConnected && !screen.classList.contains('cf-slow')) {
			status.textContent = next;
		}
	};
}

/** Removes the startup screen, fading it out if it had become visible. */
export function removeCloudForgeStartupScreen(): void {
	const screen = document.getElementById(CLOUDFORGE_STARTUP_SCREEN_ID);
	const style = document.getElementById(`${CLOUDFORGE_STARTUP_SCREEN_ID}-style`);
	if (!screen) {
		style?.remove();
		return;
	}
	screen.dispatchEvent(new Event('cloudforge-removed'));
	const visible = Number(getComputedStyle(screen).opacity) > 0.01;
	const finish = () => { screen.remove(); style?.remove(); };
	if (!visible) {
		finish();
		return;
	}
	screen.classList.add('cf-leaving');
	setTimeout(finish, 160);
}
