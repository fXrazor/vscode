/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useEffect, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Code2, PanelRight, Variable } from 'lucide-react';
import type { Action, Architecture, Resource } from './model.ts';
import { providerNames, resourceDefinition } from './fixture.ts';
import { ResourceFields } from './ResourceFields.tsx';
import { CodePanel } from './CodePanel.tsx';
import { VariablePanel } from './VariablePanel.tsx';
import { architectureDiagnostics } from './diagnostics.ts';
import { inheritedReferences } from './resourceHierarchy.ts';
import { focusResourceField } from './IssuesPanel.tsx';
import { PaneResizeHandle } from './PaneResizeHandle.tsx';

/** One resource, one form and one architecture; code and context are computed projections. */
export function ResourceWorkspace({ resource, architecture, dispatch, open, onClose, onNavigate }: {
	resource: Resource; architecture: Architecture; dispatch: Dispatch<Action>; open: boolean;
	onClose: () => void; onNavigate: (id: string) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const variablesTab = useRef<HTMLButtonElement>(null);
	const [contextTab, setContextTab] = useState('links'); const [mobileTab, setMobileTab] = useState('parameters');
	const [codeOpen, setCodeOpen] = useState(true); const [contextOpen, setContextOpen] = useState(true); const [codeWidth, setCodeWidth] = useState(420);
	useEffect(() => {
		const element = dialog.current;
		if (!open) { element?.close(); return; }
		const previous = document.activeElement as HTMLElement | null;
		element?.showModal();
		return () => { element?.close(); previous?.focus(); };
	}, [open]);
	const metadata = resourceDefinition(resource);
	const incoming = architecture.connections.filter(link => link.target === resource.id);
	const outgoing = architecture.connections.filter(link => link.source === resource.id);
	const issues = architectureDiagnostics(architecture).filter(item=>item.resourceId===resource.id);
	const inherited = inheritedReferences(architecture,resource);
	const boundIds = new Set(Object.values(resource.fieldBindings??{}).map(binding=>binding.variableId));
	function linkedElement(id: string) {
		const linked = architecture.resources.find(item=>item.id===id); const drawing = architecture.items.find(item=>item.id===id);
		return linked ? <button className="workspace-link" onClick={()=>onNavigate(id)}><img src={'./assets/'+resourceDefinition(linked).icon} alt=""/><span><strong>{linked.label||linked.name}</strong><small>{resourceDefinition(linked).label}</small></span></button> : <div className="workspace-link"><span>{drawing?.text||'Drawing'}<small>Visual annotation</small></span></div>;
	}
	return <dialog ref={dialog} className={'resource-workspace mobile-tab-'+mobileTab+(!codeOpen?' workspace-code-closed':'')+(!contextOpen?' workspace-context-closed':'')} style={{'--workspace-code-width':codeWidth+'px'} as CSSProperties} onCancel={onClose} aria-labelledby="resource-workspace-title">
		<header className="workspace-header"><button className="quiet-button" onClick={onClose}><ArrowLeft size={16}/>Back to canvas</button><div><h2 id="resource-workspace-title">{resource.label||resource.name}</h2><span>{providerNames[resource.provider]} · {metadata.label}</span></div><div className="workspace-layout-actions"><button aria-label="Toggle Terraform pane" aria-pressed={codeOpen} onClick={()=>setCodeOpen(value=>!value)}><Code2 size={16}/></button><button aria-label="Toggle node context" aria-pressed={contextOpen} onClick={()=>setContextOpen(value=>!value)}><PanelRight size={16}/></button></div></header>
		<div className="workspace-mobile-tabs" role="group" aria-label="Node details view">{['code','parameters','context'].map(tab=><button key={tab} aria-pressed={mobileTab===tab} onClick={()=>{setMobileTab(tab);if(tab==='code'){setCodeOpen(true);}if(tab==='context'){setContextOpen(true);}}}>{tab==='code'?'Terraform':tab==='parameters'?'Parameters':'Context'}</button>)}</div>
		<div className="workspace-columns">
			<section className="workspace-code" aria-label="Node Terraform pane"><CodePanel resource={resource} architecture={architecture} dispatch={dispatch} hidden={!open||!codeOpen}/><PaneResizeHandle side="workspace-code" width={codeWidth} minimum={280} onCommit={setCodeWidth}/></section>
			<section className="workspace-parameters" aria-label="Node parameters"><div className="workspace-resource-title"><img src={'./assets/'+metadata.icon} alt=""/><div><h3>Parameters</h3><span className="mono">{metadata.type}</span></div></div><ResourceFields resource={resource} architecture={architecture} dispatch={dispatch} compactMetadata onRevealResource={onNavigate} onManageVariables={()=>{setContextOpen(true);setContextTab('variables');setMobileTab('context');requestAnimationFrame(()=>variablesTab.current?.focus());}}/></section>
			<aside className="workspace-context" aria-label="Node context"><Tabs.Root value={contextTab} onValueChange={setContextTab}>
				<Tabs.List className="workspace-context-tabs" aria-label="Node context tabs"><Tabs.Trigger value="links">Links</Tabs.Trigger><Tabs.Trigger value="variables" ref={variablesTab}>Variables</Tabs.Trigger><Tabs.Trigger value="checks">Checks{issues.length?' ('+issues.length+')':''}</Tabs.Trigger></Tabs.List>
				<Tabs.Content value="links"><h3>Inherited dependencies <span>{inherited.length}</span></h3>{inherited.length?inherited.map(reference=><div key={reference.path.join('.')} className="workspace-inherited-link">{linkedElement(reference.source.id)}<code>{reference.path.join('.')} ← {reference.attribute}</code></div>):<p className="field-help">No container inheritance. Choose a compatible parent in Metadata.</p>}<h3>Incoming design links <span>{incoming.length}</span></h3>{incoming.length?incoming.map(link=><div key={link.id}>{linkedElement(link.source)}</div>):<p className="field-help">No incoming design links.</p>}<h3>Outgoing design links <span>{outgoing.length}</span></h3>{outgoing.length?outgoing.map(link=><div key={link.id}>{linkedElement(link.target)}</div>):<p className="field-help">No outgoing design links.</p>}<h3>Bound inputs</h3>{boundIds.size?architecture.variables?.filter(variable=>boundIds.has(variable.id)).map(variable=><p className="bound-input" key={variable.id}><Variable size={14}/><span>{variable.name}</span><small>{variable.type}</small></p>):<p className="field-help">Use Variable beside a field to bind a Terraform input.</p>}<p className="context-boundary">Inherited dependencies generate Terraform references. Design links describe the diagram. Bound inputs generate variable expressions.</p></Tabs.Content>
				<Tabs.Content value="variables" forceMount hidden={contextTab!=='variables'}><VariablePanel architecture={architecture} dispatch={dispatch} code={false}/></Tabs.Content>
				<Tabs.Content value="checks"><h3>Local configuration checks</h3>{issues.length?<ul className="workspace-issues">{issues.map(issue=><li key={issue.id}><button className="workspace-issue-link" onClick={()=>{setMobileTab('parameters');requestAnimationFrame(()=>focusResourceField(dialog.current?.querySelector('.workspace-parameters')??null,issue.path));}}>{issue.message}</button></li>)}</ul>:<p className="local-check-clear">No issues found by local checks.</p>}<p className="context-boundary">Checks use the bundled catalogue and variable declarations. Terraform/provider validation is not connected.</p><h3>Estimated cost</h3><p className="field-help">Not estimated. No pricing service is connected.</p></Tabs.Content>
			</Tabs.Root></aside>
		</div>
	</dialog>;
}
