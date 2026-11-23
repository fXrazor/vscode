import { useState } from 'react';
import type { Architecture, DesignMode } from './model.ts';
import { exportPresentation } from './exportPresentation.ts';
import { Download, PanelLeft, PanelRight, Pencil, Waypoints, Moon, Sun, Undo2, Redo2 } from 'lucide-react';

export function VisualTopbar({ mode, onMode, architecture, name, onRename, onTechnical, onExport, onToggleLibrary, onToggleInspector, revisions, onUndo, onRedo, canRedo, theme, onTheme }: {
 mode: DesignMode; onMode: (mode: DesignMode) => void; architecture: Architecture; name: string;
 onRename: (name: string) => void; onTechnical: () => void; onExport: () => void;
 onToggleLibrary: () => void; onToggleInspector: () => void; revisions: number;
 onUndo: () => void; onRedo: () => void; canRedo: boolean;
 theme: 'light' | 'dark'; onTheme: () => void;
}) {
 const [environment, setEnvironment] = useState('Development');
 return <header className="cloudlab-topbar">
  <div className="workspace-brand"><img src="./assets/cloudforge.png" alt="" /><strong>CloudForge</strong><small>Studio</small></div>
  <span className="shell-breadcrumb">Platform <span>›</span></span>
  <select aria-label="Environment label" value={environment} onChange={event => setEnvironment(event.target.value)}><option>Development</option><option>Test</option><option>Production</option></select>
  <span className="shell-breadcrumb">›</span><input aria-label="Architecture name" value={name} onChange={event => onRename(event.target.value)} />
  <span className="shell-count">{architecture.resources.length} in design</span>
  <span className="shell-preview">Sample draft</span>
  <div className="shell-actions">
   <button aria-label="Undo" disabled={!revisions} onClick={onUndo}><Undo2 /></button>
   <button aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 /></button>
   <button aria-label="Toggle resource library" onClick={onToggleLibrary}><PanelLeft /></button>
   <button aria-label="Toggle resource inspector" onClick={onToggleInspector}><PanelRight /></button>
   <div className="shell-modes" role="group" aria-label="Infrastructure design mode">
    <button aria-label="Architecture" title="Architecture Design View" aria-pressed={mode === 'visual'} onClick={() => onMode('visual')}><Pencil /></button>
    <button aria-label="Configuration" title="Infrastructure Configuration View" aria-pressed={mode === 'technical'} onClick={onTechnical}><Waypoints /></button>
   </div>
   <button aria-label="Toggle light or dark theme" onClick={onTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
   <details className="shell-export"><summary aria-label="Export architecture"><Download /><span>Export</span></summary><div>
    <button onClick={onExport}>Graph JSON</button>
    <button onClick={() => { void exportPresentation(architecture, 'svg'); }}>SVG image</button>
    <button onClick={() => { void exportPresentation(architecture, 'png'); }}>PNG image</button>
    <button onClick={() => { void exportPresentation(architecture, 'pdf'); }}>Print / Save PDF</button>
   </div></details>
  </div>
 </header>;
}
