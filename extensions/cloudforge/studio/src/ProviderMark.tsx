/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Provider } from './model.ts';

export function ProviderMark({ provider }: { provider: Provider }) {
	return <img className="provider-mark" src={'./assets/provider-' + provider + '.svg'} alt="" draggable={false}/>;
}
