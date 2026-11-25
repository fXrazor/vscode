/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, Uri, workspace, type Disposable, type Event } from 'vscode';
import { iconProviderForType, parseCatalogueIcons, type IconProvider } from './resourceIconModel';

/**
 * The cloud service icon of each Terraform resource type, the same one the canvas palette shows.
 * Reads the Studio catalogue shipped with the extension (`media/studio/assets`, or `studio/assets`
 * in a development checkout) one provider at a time, the first time a type of that provider is
 * asked for, and fires `onDidChange` once it has loaded so trees can redraw.
 */
export class ResourceIconIndex implements Disposable {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChange: Event<void> = this.changeEmitter.event;
	private readonly icons = new Map<IconProvider, Map<string, string>>();
	private readonly loading = new Set<IconProvider>();
	private assetsRoot: Promise<Uri | undefined> | undefined;

	constructor(private readonly extensionUri: Uri) { }

	/** The icon for a resource type, or undefined while its catalogue loads or when it has none. */
	iconFor(resourceType: string | null | undefined): Uri | undefined {
		const provider = iconProviderForType(resourceType);
		if (!provider || !resourceType) {
			return undefined;
		}
		const icons = this.icons.get(provider);
		if (!icons) {
			this.load(provider);
			return undefined;
		}
		const icon = icons.get(resourceType);
		return icon && this.resolvedRoot ? Uri.joinPath(this.resolvedRoot, ...icon.split('/')) : undefined;
	}

	private resolvedRoot: Uri | undefined;

	private findAssetsRoot(): Promise<Uri | undefined> {
		return this.assetsRoot ??= (async () => {
			for (const candidate of [Uri.joinPath(this.extensionUri, 'media', 'studio', 'assets'), Uri.joinPath(this.extensionUri, 'studio', 'assets')]) {
				try {
					await workspace.fs.stat(Uri.joinPath(candidate, 'catalogue'));
					return candidate;
				} catch {
					// Try the next location.
				}
			}
			return undefined;
		})();
	}

	private load(provider: IconProvider): void {
		if (this.loading.has(provider)) {
			return;
		}
		this.loading.add(provider);
		void (async () => {
			const root = await this.findAssetsRoot();
			let icons = new Map<string, string>();
			if (root) {
				try {
					const bytes = await workspace.fs.readFile(Uri.joinPath(root, 'catalogue', `${provider}.json`));
					icons = parseCatalogueIcons(JSON.parse(new TextDecoder().decode(bytes)));
				} catch {
					// No icons for this provider; trees keep their generic icon.
				}
			}
			this.resolvedRoot = root;
			this.icons.set(provider, icons);
			if (icons.size > 0) {
				this.changeEmitter.fire();
			}
		})();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}
