/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createRoot } from 'react-dom/client';
import { Studio } from './App.tsx';
import { configureProviderCatalogue } from './providerCatalogue.ts';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './cloudlab-layout.css';
import './editor-refinement.css';
import './technical-graph.css';

const root = document.getElementById('root');
if (!root) { throw new Error('Studio preview root is missing.'); }
// ReactFlow owns its renderer-scoped presentation store. Architecture/history live in Studio.
configureProviderCatalogue();
createRoot(root).render(<Studio />);
