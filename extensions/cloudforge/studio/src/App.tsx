/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import {
	checkDraft, createHistory, historyReducer, type BoardItem, type DesignMode,
	type Position, type Provider, type ResourceKind, type CatalogueEntry
} from './model.ts';
import { providerNames, providerRegions, resourceDefinition, sampleArchitecture } from './fixture.ts';
import type { CanvasNode } from './ResourceNode.tsx';
import { ResourceFields } from './ResourceFields.tsx';
import { ResourceWorkspace } from './ResourceWorkspace.tsx';
import { ResourceCatalogue } from './ResourceCatalogue.tsx';
import { DesignCanvas } from './DesignCanvas.tsx';
import { CodePanel } from './CodePanel.tsx';
import { ModuleImport, type ModuleReference } from './ModuleImport.tsx';
import { loadCatalogue } from './catalogue.ts';
import { ArchitectureOverview } from './ArchitectureOverview.tsx';
import { VisualTopbar } from './VisualTopbar.tsx';
import { ArrowLeft, Scan, PanelsTopLeft, PanelRightClose, Code2 } from 'lucide-react';
import { DockResizeHandle } from './DockResizeHandle.tsx';
import { PaneResizeHandle } from './PaneResizeHandle.tsx';
import { createPanelLayout, dockCodePanel, setSidePanelOpen, toggleSidePanel, type CodeDock } from './panelLayout.ts';

export function Studio() {
	const [history, dispatch] = useReducer(historyReducer, undefined, () => createHistory(sampleArchitecture()));
	const [mode, setMode] = useState<DesignMode>('visual');
	const [theme, setTheme] = useState<'light' | 'dark'>('light');
	const [selectedId, setSelectedId] = useState('cluster');
	const [codeResourceId, setCodeResourceId] = useState('cluster');
	const [search, setSearch] = useState('');
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [overview, setOverview] = useState(true);
	const [moduleImportOpen, setModuleImportOpen] = useState(false);
	const [panels, setPanels] = useState(() => createPanelLayout());
	const [libraryWidth, setLibraryWidth] = useState(346);
	const [inspectorWidth, setInspectorWidth] = useState(280);
	const [codeHeight, setCodeHeight] = useState(() => Math.round(innerHeight * 0.32));
	const [pendingFitIds, setPendingFitIds] = useState<readonly string[] | undefined>(undefined);
	const [checkRequested, setCheckRequested] = useState(false);
	const [message, setMessage] = useState('Sample architecture loaded');
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode>>();
	const viewport = useRef<Partial<Record<DesignMode, Viewport>>>({});
	const { libraryOpen, inspectorOpen, codeDock } = panels;
	const architecture = history.present;
	const selected = architecture.resources.find(resource => resource.id === selectedId);
	const selectedItem = architecture.items.find(item => item.id === selectedId);
	const codeResource = selected ?? architecture.resources.find(resource => resource.id === codeResourceId) ?? architecture.resources[0];
	useEffect(() => { if (selected) { setCodeResourceId(selected.id); } }, [selected?.id]);
	const findings = checkRequested ? checkDraft(architecture) : undefined;
	const openResource = useCallback((id: string) => {
		setSelectedId(id);
		setWorkspaceOpen(true);
	}, []);

	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			const target = event.target;
			if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) { return; }
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
			}
		}
		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	}, []);

	const dockCode = useCallback((next: CodeDock) => {
		setPanels(current => dockCodePanel(current, next));
	}, []);

	const setLibraryOpen = useCallback((open: boolean) => {
		setPanels(current => setSidePanelOpen(current, 'library', open));
	}, []);

	const setInspectorOpen = useCallback((open: boolean) => {
		setPanels(current => setSidePanelOpen(current, 'inspector', open));
	}, []);

	const clearPendingFit = useCallback(() => { setPendingFitIds(undefined); }, []);

	function switchMode(next: DesignMode) {
		if (flow) { viewport.current[mode] = flow.getViewport(); }
		setMode(next);
		setMessage(next === 'visual' ? 'Visual Design · shared draft preserved' : 'Technical Design · shared draft preserved');
	}

	const resourceCount = architecture.resources.length;
	const addResource = useCallback((kind: ResourceKind, provider: Provider, position?: Position) => {
		const id = crypto.randomUUID();
		const definition = resourceDefinition({ kind, provider });
		const placed = position ?? {
			x: 160 + (resourceCount % 3) * 250,
			y: 600 + Math.floor(Math.max(0, resourceCount - 6) / 3) * 180
		};
		dispatch({ type: 'add', resource: {
			id, kind, provider, name: 'new-' + kind + '-' + (resourceCount + 1),
			region: providerRegions[provider][0], settings: { ...definition.defaults },
			blocks: [],
			positions: { visual: placed, technical: placed }
		} });
		setSelectedId(id);
		setOverview(false);
		setMessage('Added ' + definition.label + ' to the shared draft');
	}, [resourceCount]);

 const addCatalogueResource = useCallback((entry: CatalogueEntry, provider: Provider, position?: Position) => {
  const id = crypto.randomUUID();
  const bounds = document.querySelector('.canvas')?.getBoundingClientRect();
  const placed = position ?? (flow && bounds ? flow.screenToFlowPosition({ x: bounds.x+bounds.width/2, y:bounds.y+bounds.height/2 }) : { x:100,y:100 });
  const settings = Object.fromEntries(entry.fields.filter(field=>field.required && !['name','location','region'].includes(field.name)).map(field=>[field.name, field.default === undefined ? '' : String(field.default)]));
  dispatch({ type:'add', resource:{ id, kind:'generic', catalogue:entry, provider, name:entry.type.replace(/^(azurerm|aws|google)_/,'')+'_'+id.slice(0,4), region:providerRegions[provider][0], settings, blocks:[], positions:{visual:placed,technical:placed} } });
  setSelectedId(id); setOverview(false); setInspectorOpen(true);
 },[flow]);

	function addTemplate(kind: 'network' | 'platform') {
		const pattern = sampleArchitecture();
		const wanted = kind === 'network' ? ['network', 'subnet'] : ['cluster', 'storage', 'monitor'];
		const ids = new Map([...pattern.resources, ...pattern.items].map(item => [item.id, crypto.randomUUID()]));
		const suffix = crypto.randomUUID().slice(0, 4);
		const resources = pattern.resources.filter(resource => wanted.includes(resource.id)).map(resource => ({ ...resource, id: ids.get(resource.id)!, name: resource.name + '-' + suffix, positions: { visual: { x: resource.positions.visual.x, y: resource.positions.visual.y + 600 }, technical: { x: resource.positions.technical.x, y: resource.positions.technical.y + 600 } } }));
		dispatch({ type: 'insert', architecture: { name: pattern.name, resources, items: [], connections: pattern.connections.filter(edge => wanted.includes(edge.source) && wanted.includes(edge.target)).map(edge => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })) } });
		setSelectedId(resources[0].id); setOverview(true); setInspectorOpen(true);
		setPendingFitIds(resources.map(resource => resource.id));
	}

	const addItem = useCallback((kind: BoardItem['kind'], position: Position, caption?:string) => {
		const id = crypto.randomUUID();
		const text = { frame: 'New section', note: 'Add an architecture note', text: 'Architecture annotation', shape: 'Label' }[kind];
		dispatch({ type: 'addItem', item: {
			id, kind, text:caption??text, positions: { visual: position, technical: position },
			width: kind === 'frame' ? 600 : 220, height: kind === 'frame' ? 380 : 140, members: []
		} });
		setSelectedId(id);
		setOverview(false);
	}, []);

	function importModule(reference: ModuleReference) {
		const id = crypto.randomUUID();
		const position = { x: 800, y: 650 };
		dispatch({ type: 'add', resource: {
			id, kind: 'module', provider: 'azure', name: reference.name, region: 'UK South',
			settings: { Source: reference.source, 'Source type': reference.sourceKind, Version: reference.version || 'Unpinned' },
			blocks: [], positions: { visual: position, technical: position }
		} });
		setSelectedId(id);
		setModuleImportOpen(false);
		setMessage('Module reference added. Source inspection requires service integration.');
	}

	function checkNames() {
		setCheckRequested(true);
		const count = checkDraft(architecture).length;
		setMessage(count ? count + ' draft name issue' + (count === 1 ? '' : 's') + ' found' : 'Local draft name checks passed');
	}

	function exportSample() {
		const blob = new Blob([JSON.stringify(architecture, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'cloudforge-sample.architecture.json';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		setMessage('Exported sample architecture JSON');
	}

	return (
		<div className={'studio ' + mode + ' theme-' + theme + (!libraryOpen ? ' library-closed' : '') + (!inspectorOpen ? ' inspector-closed' : '')}
			style={{ '--library-width': libraryWidth + 'px', '--inspector-width': inspectorWidth + 'px', '--code-height':codeHeight+'px' } as CSSProperties}>
			<VisualTopbar architecture={architecture} mode={mode} onMode={switchMode} name={architecture.name} revisions={history.past.length}
				onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })} canRedo={!!history.future.length}
				onCode={() => dockCode(codeDock === 'closed' ? 'bottom' : 'closed')}
				libraryOpen={libraryOpen} inspectorOpen={inspectorOpen} codeOpen={codeDock !== 'closed'}
				theme={theme} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
				onRename={name => dispatch({ type: 'renameArchitecture', name })}
				onTechnical={() => switchMode('technical')} onExport={exportSample}
				onToggleLibrary={() => setPanels(current => toggleSidePanel(current, 'library'))}
				onToggleInspector={() => setPanels(current => toggleSidePanel(current, 'inspector'))} />
			<div className="studio-body">
				<ResourceCatalogue architecture={architecture} onAdd={addResource} onAddCatalogue={addCatalogueResource} onTemplate={addTemplate} search={search} onSearch={setSearch} onImportModule={() => setModuleImportOpen(true)}
					visible={libraryOpen} onClose={() => setLibraryOpen(false)}
					onDesignAdd={(kind, caption) => {
						const position = flow?.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 });
						if (position) { addItem(kind, position, caption); }
					}} resizeHandle={<PaneResizeHandle side="library" width={libraryWidth} minimum={346} onCommit={setLibraryWidth} />} />
				<div className={'design-area dock-' + codeDock}>
					<div className="canvas-shell">
						<DesignCanvas architecture={architecture} mode={mode} theme={theme} onThemeChange={setTheme} selectedId={selectedId} dispatch={dispatch}
							onSelect={setSelectedId} onOpen={openResource} onInit={setFlow} viewports={viewport}
							pendingFitIds={pendingFitIds} onFitComplete={clearPendingFit}
							onAddItem={addItem} onAddResource={addResource}
							onAddCatalogue={(type, provider, position) => {
								void loadCatalogue(provider).then(snapshot => { const entry = snapshot.entries.find(entry => entry.type === type); if (entry) { addCatalogueResource(entry, provider, position); } }).catch(() => setMessage('Unable to load the provider catalogue.'));
							}} />
					</div>
					{codeResource && <CodePanel resource={codeResource} resizeHandle={codeDock==='bottom'?<DockResizeHandle height={codeHeight} onCommit={setCodeHeight}/>:undefined} architecture={architecture} onFocus={id=>{setSelectedId(id);setOverview(false);setInspectorOpen(true);}} dispatch={dispatch} dock={codeDock} onDock={dockCode} />}
				</div>
				<aside className="inspector" aria-label="Resource inspector" hidden={!inspectorOpen}>
					<PaneResizeHandle side="inspector" width={inspectorWidth} minimum={280} onCommit={setInspectorWidth} />
					<div className="inspector-utility-row">
						<button aria-label="Close resource inspector" title="Close resource inspector" onClick={() => setInspectorOpen(false)}><PanelRightClose /></button>
						<span>Sample Architecture</span>
					</div>
					<div className="inspector-tabs">
						<button aria-pressed={!overview} onClick={() => setOverview(false)}>Form</button>
						<button aria-pressed={overview} onClick={() => setOverview(true)}>Overview <span>{resourceCount}</span></button>
					</div>
					{overview ? (
						<ArchitectureOverview architecture={architecture} onSelect={id => { setSelectedId(id); setOverview(false); }} />
      ) : selected ? (
						<>
							<div className="inspector-title">
								<button className="inspector-back" aria-label="Back to architecture overview" onClick={() => setOverview(true)}><ArrowLeft /></button>
								<img src={'./assets/' + resourceDefinition(selected).icon} alt="" /><div><h2>{selected.label || selected.name}</h2><span>{resourceDefinition(selected).label}</span></div>
							</div>
							<div className="form-action-row">
								<span className="active-form-tab">Form</span><button onClick={() => dockCode('right')}><Code2 />Code</button>
								<span className="form-action-spacer" />
								<button aria-label="Open focused resource workspace" title="Open focused resource workspace" onClick={() => setWorkspaceOpen(true)}><PanelsTopLeft /></button>
								<button aria-label="Focus selected resource" title="Focus selected resource" onClick={() => { void flow?.fitView({ nodes: [{ id: selected.id }], padding: 0.5, maxZoom: 1.5 }); }}><Scan /></button>
							</div>
							<ResourceFields resource={selected} dispatch={dispatch} />
							<button className="primary-button" onClick={() => setWorkspaceOpen(true)}>Open Resource Workspace</button>
							<div className="inspector-section"><h3>Connections</h3>
								<p>{architecture.connections.filter(connection => connection.target === selected.id).length} incoming · {architecture.connections.filter(connection => connection.source === selected.id).length} outgoing</p>
								<span className="muted">Design relationships</span>
							</div>
							{checkRequested && <div className="inspector-section"><h3>Local Name Check</h3>{findings?.length === 0 ? <p className="success-text">All draft names passed.</p> : findings?.map(finding => <button className="finding finding-button" key={finding.resourceId} onClick={() => setSelectedId(finding.resourceId)}>{finding.message}</button>)}<p className="muted">Provider and cloud checks require service integration.</p></div>}
							<button className="delete-button" onClick={() => { dispatch({ type: 'delete', id: selected.id }); setSelectedId(''); setMessage('Resource removed. Undo restores its connections.'); }}>Delete Resource</button>
						</>
					) : selectedItem ? (
						<div className="board-item-inspector">
							<h2>{selectedItem.kind === 'frame' ? 'Frame' : 'Design Element'}</h2>
							<label>Text<textarea value={selectedItem.text} onChange={event => dispatch({ type: 'updateItem', id: selectedItem.id, patch: { text: event.target.value } })} /></label>
							<p className="muted">Drag to move. Select the element to resize it on the canvas.</p>
							<button className="delete-button" onClick={() => { dispatch({ type: 'deleteItem', id: selectedItem.id }); setSelectedId(''); }}>Delete Element</button>
						</div>
					) : <div className="empty-inspector"><h2>Select an element</h2><p>Choose a resource, note, text, shape or frame on the canvas.</p></div>}
				</aside>
			</div>
			<footer className="sr-only"><span role="status">{message}</span><span>{history.past.length ? 'Modified draft' : 'Original sample'} · In-memory preview</span></footer>
			{workspaceOpen && selected && <ResourceWorkspace resource={selected} architecture={architecture} dispatch={dispatch} findings={findings} onCheck={checkNames} onClose={() => setWorkspaceOpen(false)} />}
			{moduleImportOpen && <ModuleImport onClose={() => setModuleImportOpen(false)} onImport={importModule} />}
		</div>
	);
}
