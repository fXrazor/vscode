/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { endpointElementId, type DesignEndpoint } from './connectionEndpoints.ts';
import { useEffect, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Code2, PanelRight, Variable, X, SlidersHorizontal, CircleCheck, TriangleAlert, Unplug, Layers, ChevronRight, CircleHelp, FileCode2 } from 'lucide-react';
import type { Action, Architecture, Resource } from './model.ts';
import { providerNames, resourceDefinition } from './fixture.ts';
import { ResourceFields, type ResourceModuleInspectionProps } from './ResourceFields.tsx';
import { CodePanel } from './CodePanel.tsx';
import { VariablePanel } from './VariablePanel.tsx';
import { architectureDiagnostics, type Diagnostic } from './diagnostics.ts';
import { explicitResourceReferences, inheritedReferences } from './resourceHierarchy.ts';
import { focusResourceField } from './IssuesPanel.tsx';
import { PaneResizeHandle } from './PaneResizeHandle.tsx';
import type { LiveSchemaMap } from './liveSchema.ts';
import type { HostCloudRegionsPayload } from './webviewBridge.ts';

/** One resource, one form and one architecture; code and context are computed projections. */
export function ResourceWorkspace({ resource, architecture, dispatch, open, onClose, onNavigate, liveSchemas, cloudRegions, moduleInspection, hostDiagnostics, hasSource, onOpenSource, onSaveFile }: {
	resource: Resource; architecture: Architecture; dispatch: Dispatch<Action>; open: boolean;
	onClose: () => void; onNavigate: (id: string) => void;
	liveSchemas?: LiveSchemaMap; cloudRegions?: Readonly<Partial<Record<'azure' | 'aws' | 'google', HostCloudRegionsPayload>>>; moduleInspection?: ResourceModuleInspectionProps; hostDiagnostics?: readonly Diagnostic[]; hasSource?: boolean; onOpenSource?: () => void; onSaveFile?: (fileName: string) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const backdropPress = useRef(false);
	const variablesTab = useRef<HTMLButtonElement>(null);
	const [contextTab, setContextTab] = useState('links');
	const [mobileTab, setMobileTab] = useState('parameters');
	const [codeOpen, setCodeOpen] = useState(true);
	const [contextOpen, setContextOpen] = useState(true);
	const [codeWidth, setCodeWidth] = useState(420);
	useEffect(() => {
		const element = dialog.current;
		if (!open) { element?.close(); return; }
		const previous = document.activeElement as HTMLElement | null;
		backdropPress.current = false;
		element?.showModal();
		return () => { element?.close(); previous?.focus(); };
	}, [open]);
	const metadata = resourceDefinition(resource);
	const incoming = architecture.connections.filter(link => endpointElementId(link.target) === resource.id);
	const outgoing = architecture.connections.filter(link => endpointElementId(link.source) === resource.id);
	const issues = [
		...(hostDiagnostics ?? []).filter(item => item.resourceId === resource.id),
		...architectureDiagnostics(architecture, liveSchemas).filter(item => item.resourceId === resource.id),
	];
	const inherited = inheritedReferences(architecture, resource);
	const inheritedSources = [...new Set(inherited.map(reference => reference.source.id))].map(id => ({ id, references: inherited.filter(reference => reference.source.id === id) }));
	const explicitRefs = explicitResourceReferences(architecture, resource);
	const explicitSources = [...new Set(explicitRefs.map(reference => reference.source.id))].map(id => ({ id, references: explicitRefs.filter(reference => reference.source.id === id) }));
	const children = architecture.resources.filter(item => item.parentId === resource.id);
	const boundIds = new Set(Object.values(resource.fieldBindings ?? {}).map(binding => binding.variableId));
	function linkedElement(endpoint: DesignEndpoint | string) {
		const id = endpointElementId(endpoint);
		if (!id) { return <span className="field-help">Loose canvas endpoint</span>; }
		const linked = architecture.resources.find(item => item.id === id);
		const drawing = architecture.items.find(item => item.id === id);
		return linked ? <button className="workspace-link" onClick={() => onNavigate(id)}><img src={'./assets/' + resourceDefinition(linked).icon} alt="" /><span><strong>{linked.label || linked.name}</strong><small>{resourceDefinition(linked).label}</small></span><ChevronRight size={14} /></button> : <div className="workspace-link"><span>{drawing?.text || 'Drawing'}<small>Visual annotation</small></span></div>;
	}
	function outsideDialog(x: number, y: number) {
		const bounds = dialog.current?.getBoundingClientRect();
		return !!bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);
	}
	function showContext(tab: string) { setContextOpen(true); setContextTab(tab); setMobileTab('context'); }
	return <dialog ref={dialog} className={'resource-workspace mobile-tab-' + mobileTab + (!codeOpen ? ' workspace-code-closed' : '') + (!contextOpen ? ' workspace-context-closed' : '')}
		style={{ '--workspace-code-width': codeWidth + 'px' } as CSSProperties}
		onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="resource-workspace-title" aria-describedby="resource-workspace-description"
		onPointerDown={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY); }}
		onPointerUp={event => { const dismiss = backdropPress.current && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY); backdropPress.current = false; if (dismiss) { onClose(); } }}
		onPointerCancel={() => { backdropPress.current = false; }}>
		<header className="workspace-header">
			<button type="button" className="quiet-button workspace-back" onClick={onClose}><ArrowLeft size={16} /><span>Back to canvas</span></button>
			<div className="workspace-identity"><img src={'./assets/' + metadata.icon} alt="" /><div><h2 id="resource-workspace-title">{resource.label || resource.name}</h2><span>{providerNames[resource.provider]} · {metadata.label}</span></div></div>
			<button className={'workspace-check-summary' + (issues.length ? ' has-findings' : '')} onClick={() => showContext('checks')} aria-label="Review local resource checks">{issues.length ? <TriangleAlert size={14} /> : <CircleCheck size={14} />}<span>{issues.length ? issues.length + ' to review' : 'Local checks clear'}</span></button>
			<div className="workspace-layout-actions">
				{hasSource && onOpenSource && <button type="button" title="Open Terraform source in editor" aria-label="Open Terraform source" onClick={onOpenSource}><FileCode2 size={16} /></button>}
				<button type="button" title={codeOpen ? 'Hide Terraform pane' : 'Show Terraform pane'} aria-label="Toggle Terraform pane" aria-pressed={codeOpen} onClick={() => setCodeOpen(value => !value)}><Code2 size={16} /></button>
				<button type="button" title={contextOpen ? 'Hide resource context' : 'Show resource context'} aria-label="Toggle node context" aria-pressed={contextOpen} onClick={() => setContextOpen(value => !value)}><PanelRight size={16} /></button>
			</div>
			<button type="button" className="workspace-close" aria-label="Close resource details" title="Close resource details (Escape)" onClick={onClose}><X size={18} /></button>
		</header>
		<p className="sr-only" id="resource-workspace-description">Edit this resource's Terraform and parameters. Close with Escape, the close button, or the background. Closing preserves edits and unapplied code.</p>
		<div className="workspace-mobile-tabs" role="group" aria-label="Node details view">{['code', 'parameters', 'context'].map(tab => <button key={tab} aria-pressed={mobileTab === tab} onClick={() => { setMobileTab(tab); if (tab === 'code') { setCodeOpen(true); } if (tab === 'context') { setContextOpen(true); } }}>{tab === 'code' ? 'Terraform' : tab === 'parameters' ? 'Parameters' : 'Context'}</button>)}</div>
		<div className="workspace-columns">
			<section className="workspace-code" aria-label="Node Terraform pane"><CodePanel resource={resource} architecture={architecture} dispatch={dispatch} compact hidden={!open || !codeOpen} hasSource={hasSource} onOpenSource={onOpenSource} onSaveFile={onSaveFile} /><PaneResizeHandle side="workspace-code" width={codeWidth} minimum={280} onCommit={setCodeWidth} /></section>
			<section className="workspace-parameters" aria-label="Node parameters">
				<div className="workspace-pane-heading"><SlidersHorizontal size={17} /><div><h3>Parameters</h3><p>Changes update this resource and its Terraform draft.</p></div></div>
				<ResourceFields resource={resource} architecture={architecture} dispatch={dispatch} liveSchemas={liveSchemas} cloudRegions={cloudRegions} moduleInspection={moduleInspection} hasSource={hasSource} onOpenSource={onOpenSource} onRevealResource={onNavigate} onManageVariables={() => { showContext('variables'); requestAnimationFrame(() => variablesTab.current?.focus()); }} />
			</section>
			<aside className="workspace-context" aria-label="Node context"><Tabs.Root className="workspace-context-root" value={contextTab} onValueChange={setContextTab}>
				<Tabs.List className="workspace-context-tabs" aria-label="Node context tabs"><Tabs.Trigger value="links">Connections</Tabs.Trigger><Tabs.Trigger value="variables" ref={variablesTab}>Variables</Tabs.Trigger><Tabs.Trigger value="checks">Checks{issues.length ? <span className="workspace-tab-count">{issues.length}</span> : null}</Tabs.Trigger></Tabs.List>
				<Tabs.Content value="links">
					{children.length > 0 && <section className="workspace-context-section"><h3><Layers size={14} />Contained resources <span>{children.length}</span></h3><p className="field-help">Open a resource to see its parameters and inherited values.</p>{children.map(child => <div key={child.id}>{linkedElement(child.id)}</div>)}</section>}
					{inheritedSources.length > 0 && <section className="workspace-context-section"><h3>Inherited from containers</h3>{inheritedSources.map(source => <div key={source.id} className="workspace-inherited-link">{linkedElement(source.id)}{source.references.map(reference => <code key={reference.path.join('.')}>{reference.path.join('.')} ← {reference.attribute}</code>)}</div>)}</section>}
					{explicitSources.length > 0 && <section className="workspace-context-section"><h3>Referenced resources</h3>{explicitSources.map(source => <div key={source.id} className="workspace-inherited-link">{linkedElement(source.id)}{source.references.map(reference => <code key={reference.path.join('.') + ':' + reference.attribute}>{reference.path.join('.')} ← {reference.attribute}</code>)}</div>)}</section>}
					{incoming.length + outgoing.length > 0 && <section className="workspace-context-section"><h3>Design links <span>{incoming.length + outgoing.length}</span></h3>{incoming.map(link => <div key={link.id} className="workspace-direction"><small>Incoming</small>{linkedElement(link.source)}</div>)}{outgoing.map(link => <div key={link.id} className="workspace-direction"><small>Outgoing</small>{linkedElement(link.target)}</div>)}<p className="field-help">Design links describe the diagram. Inherited and resource references create Terraform dependencies.</p></section>}
					{!!boundIds.size && <section className="workspace-context-section"><h3>Bound inputs</h3>{architecture.variables?.filter(variable => boundIds.has(variable.id)).map(variable => <button className="bound-input" key={variable.id} onClick={() => showContext('variables')}><Variable size={14} /><span>{variable.name}</span><small>{variable.type}</small><ChevronRight size={13} /></button>)}</section>}
					{!children.length && !inheritedSources.length && !explicitSources.length && !incoming.length && !outgoing.length && !boundIds.size && <div className="workspace-context-empty"><Unplug size={23} /><h3>No connections yet</h3><p>This resource is on its own. Add a compatible parent in Metadata to inherit values, reference another resource, or bind a variable beside a parameter.</p></div>}
					<details className="workspace-context-guide"><summary><CircleHelp size={14} />Understand connections</summary><p>A container can supply values such as location to its children. A variable supplies a reusable input. Design links help explain your diagram.</p></details>
				</Tabs.Content>
				<Tabs.Content value="variables" forceMount hidden={contextTab !== 'variables'}><VariablePanel architecture={architecture} dispatch={dispatch} code={false} /></Tabs.Content>
				<Tabs.Content value="checks">
					<h3>Local configuration checks</h3>
					{issues.length ? <ul className="workspace-issues">{issues.map(issue => <li key={issue.id}><button className="workspace-issue-link" onClick={() => { setMobileTab('parameters'); requestAnimationFrame(() => focusResourceField(dialog.current?.querySelector('.workspace-parameters') ?? null, issue.path)); }}><TriangleAlert size={14} /><span>{issue.message}</span><ChevronRight size={13} /></button></li>)}</ul> : <p className="local-check-clear"><CircleCheck size={17} />No issues found by local checks.</p>}
					<p className="context-boundary">These checks use the resource catalogue. Terraform and cloud provider validation have not run.</p>
					<details className="workspace-context-guide"><summary>Cost estimate</summary><p>Not estimated. A pricing service is not connected.</p></details>
				</Tabs.Content>
			</Tabs.Root></aside>
		</div>
	</dialog>;
}
