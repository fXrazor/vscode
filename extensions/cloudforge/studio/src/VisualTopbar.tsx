import { useState } from 'react';
import type { Architecture, DesignMode } from './model.ts';
import { exportPresentation } from './exportPresentation.ts';
import { Download, PanelLeft, PanelRight, Pencil, Waypoints, Moon, Sun, Undo2, Redo2, Menu, RefreshCw, ShieldCheck, Save } from 'lucide-react';
import type { HostNotice } from './webviewBridge.ts';

export interface TopbarHostProps {
	readonly isHosted: boolean;
	readonly sourceRevision?: string;
	readonly status?: 'complete' | 'partial';
	readonly notice?: HostNotice | null;
	readonly isDirty: boolean;
	readonly validating: boolean;
	readonly saving: boolean;
	readonly onRefresh: () => void;
	readonly onValidate: () => void;
	readonly onSaveDraft: () => void;
	readonly onExportArtifact?: (format: 'svg' | 'png') => void;
}

export function VisualTopbar({ mode, onMode, architecture, name, onRename, onTechnical, onExport, onToggleLibrary, onToggleInspector, revisions, onUndo, onRedo, canRedo, theme, onTheme, libraryOpen, inspectorOpen, errors, warnings, onIssues, host }: {
 mode: DesignMode; onMode: (mode: DesignMode) => void; architecture: Architecture; name: string;
 onRename: (name: string) => void; onTechnical: () => void; onExport: () => void;
 onToggleLibrary: () => void; onToggleInspector: () => void; revisions: number;
 onUndo: () => void; onRedo: () => void; canRedo: boolean;
 theme: 'light' | 'dark'; onTheme: () => void;
 libraryOpen:boolean; inspectorOpen:boolean; errors:number; warnings:number; onIssues:()=>void;
 host?: TopbarHostProps;
}) {
 const [environment, setEnvironment] = useState('Development');
 const revisionLabel = host?.isHosted
  ? (host.sourceRevision ? 'rev ' + host.sourceRevision.slice(0, 8) : 'Sample preview') + (host.sourceRevision && host.isDirty ? ' · Modified' : host.status === 'partial' ? ' · Partial' : '')
  : 'Sample draft';
 return <header className="cloudlab-topbar">
  <div className="workspace-brand"><img src="./assets/cloudforge.png" alt="" /><strong>CloudForge</strong><small>Studio</small></div>
  <span className="shell-breadcrumb">Platform <span>›</span></span>
  <select aria-label="Environment label" value={environment} onChange={event => setEnvironment(event.target.value)}><option>Development</option><option>Test</option><option>Production</option></select>
  <span className="shell-breadcrumb">›</span><input aria-label="Architecture name" value={name} onChange={event => onRename(event.target.value)} />
  <span className="shell-count">{architecture.resources.length} in design</span>
  <span className={'shell-preview' + (host?.isHosted ? ' is-hosted' : '') + (host?.isDirty ? ' is-dirty' : '')} title={host?.notice?.message ?? (host?.sourceRevision ? 'Source revision ' + host.sourceRevision : undefined)}>{revisionLabel}</span>
  <div className="shell-diagnostics" aria-label={host?.isHosted ? 'Checks and validation' : 'Local checks'}><button className={errors?'has-errors':'checks-clear'} onClick={onIssues} title={host?.isHosted ? 'Review validation and local checks' : 'Review local checks; Terraform validation has not run'}>{errors?errors+(errors===1?' error':' errors'):(host?.isHosted ? 'No errors' : 'No local errors')}</button>{!!warnings&&<button className="has-warnings" onClick={onIssues}>{warnings} {warnings===1?'warning':'warnings'}</button>}</div>
  <div className="shell-actions">
   {host?.isHosted && <button aria-label="Refresh from workspace" title="Refresh from workspace" onClick={host.onRefresh}><RefreshCw size={15} /></button>}
   {host?.isHosted && <button aria-label="Validate architecture" title="Validate architecture with CloudForge service" disabled={host.validating} onClick={host.onValidate}><ShieldCheck size={15} /></button>}
   {host?.isHosted && host.isDirty && <button className="shell-save-button" aria-label="Preview and save Terraform draft" title="Preview and save Terraform draft" disabled={host.saving} onClick={host.onSaveDraft}><Save size={14} /><span>{host.saving ? 'Previewing…' : 'Save'}</span></button>}
   <button aria-label="Undo" disabled={!revisions} onClick={onUndo}><Undo2 /></button>
   <button aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 /></button>
   <button aria-label="Toggle resource library" title={libraryOpen?'Hide resource library':'Show resource library'} aria-controls="resource-library" aria-expanded={libraryOpen} aria-pressed={libraryOpen} onClick={onToggleLibrary}><PanelLeft /></button>
   <button aria-label="Toggle resource inspector" title={inspectorOpen?'Hide resource inspector':'Show resource inspector'} aria-controls="resource-inspector" aria-expanded={inspectorOpen} aria-pressed={inspectorOpen} onClick={onToggleInspector}><PanelRight /></button>
   <div className="shell-modes" role="group" aria-label="Infrastructure design mode">
    <button aria-label="Architecture" title="Architecture Design View" aria-pressed={mode === 'visual'} onClick={() => onMode('visual')}><Pencil /></button>
    <button aria-label="Configuration" title="Infrastructure Configuration View" aria-pressed={mode === 'technical'} onClick={onTechnical}><Waypoints /></button>
   </div>
   <button aria-label="Toggle light or dark theme" onClick={onTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
   <details className="shell-export"><summary aria-label="Export architecture"><Download /><span>Export</span></summary><div>
    <button onClick={onExport}>Graph JSON</button>
    <button onClick={() => { if (host?.onExportArtifact) { host.onExportArtifact('svg'); } else { void exportPresentation(architecture, 'svg'); } }}>SVG image</button>
    <button onClick={() => { if (host?.onExportArtifact) { host.onExportArtifact('png'); } else { void exportPresentation(architecture, 'png'); } }}>PNG image</button>
    <button onClick={() => { void exportPresentation(architecture, 'pdf'); }}>Print / Save PDF</button>
   </div></details>
  </div>
  <details className="shell-compact-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label="Workspace actions"><Menu size={18}/></summary><div onClick={event => { const menu = event.currentTarget.parentElement as HTMLDetailsElement; menu.open = false; menu.querySelector('summary')?.focus(); }}>
   {host?.isHosted && <button onClick={host.onRefresh}>Refresh from workspace</button>}
   {host?.isHosted && <button disabled={host.validating} onClick={host.onValidate}>Validate architecture</button>}
   {host?.isHosted && host.isDirty && <button disabled={host.saving} onClick={host.onSaveDraft}>Preview and save Terraform draft</button>}
   <button disabled={!revisions} onClick={onUndo}>Undo</button><button disabled={!canRedo} onClick={onRedo}>Redo</button>
   <button aria-expanded={libraryOpen} onClick={onToggleLibrary}>{libraryOpen?'Hide':'Show'} resource library</button><button aria-expanded={inspectorOpen} onClick={onToggleInspector}>{inspectorOpen?'Hide':'Show'} resource inspector</button><button onClick={onIssues}>Local checks · {errors} errors · {warnings} warnings</button>
   <button onClick={() => onMode('visual')}>Architecture view</button><button onClick={onTechnical}>Configuration view</button>
   <button onClick={onTheme}>Switch to {theme === 'dark' ? 'light' : 'dark'} theme</button>
   <button onClick={onExport}>Export graph JSON</button><button onClick={() => { if (host?.onExportArtifact) { host.onExportArtifact('svg'); } else { void exportPresentation(architecture, 'svg'); } }}>Export SVG</button>
   <button onClick={() => { if (host?.onExportArtifact) { host.onExportArtifact('png'); } else { void exportPresentation(architecture, 'png'); } }}>Export PNG</button><button onClick={() => { void exportPresentation(architecture, 'pdf'); }}>Print / Save PDF</button>
  </div></details>
 </header>;
}
