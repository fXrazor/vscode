/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { VariablePanel } from './VariablePanel.tsx';
import { exportableArchitecture } from './variables.ts';
import type { ShapeId } from './shapes.ts';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import {
	checkDraft, createHistory, historyReducer, type BoardItem, type DesignMode,
	type Position, type Provider, type ResourceKind, type CatalogueEntry
} from './model.ts';
import { providerNames, providerRegions, resourceDefinition, sampleArchitecture } from './fixture.ts';
import type { CanvasNode } from './ResourceNode.tsx';
import type { DesignEdgeType } from './DesignEdge.tsx';
import { ResourceFields } from './ResourceFields.tsx';
import { ResourceWorkspace } from './ResourceWorkspace.tsx';
import { ResourceCatalogue } from './ResourceCatalogue.tsx';
import { DesignCanvas } from './DesignCanvas.tsx';
import { CodePanel } from './CodePanel.tsx';
import { ModuleImport, type ModuleReference } from './ModuleImport.tsx';
import { loadCatalogue } from './catalogue.ts';
import { ArchitectureOverview } from './ArchitectureOverview.tsx';
import { VisualTopbar } from './VisualTopbar.tsx';
import { ArrowLeft, Scan, PanelsTopLeft, PanelRightClose, Code2, ListTree, Boxes, Variable, AlertCircle } from 'lucide-react';
import { PaneResizeHandle } from './PaneResizeHandle.tsx';

export function Studio() {
	const [history, dispatch] = useReducer(historyReducer, undefined, () => createHistory(sampleArchitecture()));
	const [mode, setMode] = useState<DesignMode>('visual');
	const [theme, setTheme] = useState<'light' | 'dark'>('light');
	const [selectedId, setSelectedId] = useState('');
	const [search, setSearch] = useState('');
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [overview, setOverview] = useState(true);
	const [moduleImportOpen, setModuleImportOpen] = useState(false);
	const [libraryOpen, setLibraryOpen] = useState(true);
 const [shapesOpen, setShapesOpen] = useState(false);
 function openShapes() { setDetailTab('form'); setOverview(true); setLibraryOpen(true); setShapesOpen(true); }
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const [libraryWidth, setLibraryWidth] = useState(346);
	const [inspectorWidth, setInspectorWidth] = useState(280);
 const [detailTab, setDetailTab] = useState<'form' | 'code' | 'issues'>('form');
 const [inspectorCategory, setInspectorCategory] = useState<'resources' | 'variables'>('resources');
 const [detailsWidth, setDetailsWidth] = useState(440);
	const [checkRequested, setCheckRequested] = useState(false);
	const [message, setMessage] = useState('Sample architecture loaded');
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, DesignEdgeType>>();
	const viewport = useRef<Partial<Record<DesignMode, Viewport>>>({});
	const architecture = history.present;
	const selected = architecture.resources.find(resource => resource.id === selectedId);
	const selectedItem = architecture.items.find(item => item.id === selectedId);
 const resourceEditing = inspectorOpen && (inspectorCategory === 'variables' || detailTab === 'code' || (!overview && !!selected));
	const findings = checkRequested ? checkDraft(architecture) : undefined;
	const openResource = useCallback((id: string) => {
		setSelectedId(id);
		setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
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
		setOverview(false); setInspectorCategory('resources'); setDetailTab('form');
		setMessage('Added ' + definition.label + ' to the shared draft');
	}, [resourceCount]);

 const addCatalogueResource = useCallback((entry: CatalogueEntry, provider: Provider, position?: Position) => {
  const id = crypto.randomUUID();
  const bounds = document.querySelector('.canvas')?.getBoundingClientRect();
  const placed = position ?? (flow && bounds ? flow.screenToFlowPosition({ x: bounds.x+bounds.width/2, y:bounds.y+bounds.height/2 }) : { x:100,y:100 });
  const settings = Object.fromEntries(entry.fields.filter(field=>field.required && !['name','location','region'].includes(field.name)).map(field=>[field.name, field.default === undefined ? '' : String(field.default)]));
  dispatch({ type:'add', resource:{ id, kind:'generic', catalogue:entry, provider, name:entry.type.replace(/^(azurerm|aws|google)_/,'')+'_'+id.slice(0,4), region:providerRegions[provider][0], settings, blocks:[], positions:{visual:placed,technical:placed} } });
  setSelectedId(id); setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
 },[flow]);

 function addTemplate(kind:'network'|'platform') {
  const pattern=sampleArchitecture();
  const wanted=kind==='network' ? ['network','subnet'] : ['cluster','storage','monitor'];
  const ids=new Map([...pattern.resources,...pattern.items].map(item=>[item.id,crypto.randomUUID()]));
  const suffix=crypto.randomUUID().slice(0,4);
  const resources=pattern.resources.filter(resource=>wanted.includes(resource.id)).map(resource=>({...resource,id:ids.get(resource.id)!,name:resource.name+'-'+suffix,positions:{visual:{x:resource.positions.visual.x,y:resource.positions.visual.y+600},technical:{x:resource.positions.technical.x,y:resource.positions.technical.y+600}}}));
  dispatch({type:'insert',architecture:{name:pattern.name,resources,items:[],connections:pattern.connections.filter(edge=>wanted.includes(edge.source)&&wanted.includes(edge.target)).map(edge=>({...edge,id:crypto.randomUUID(),source:ids.get(edge.source)!,target:ids.get(edge.target)!}))}});
  setSelectedId(resources[0].id); setOverview(true); setInspectorOpen(true);
  void flow?.fitView({nodes:resources.map(resource=>({id:resource.id})),padding:0.2});
 }

	const addItem = useCallback((kind: BoardItem['kind'], position: Position, caption?:string, shape?: ShapeId) => {
		const id = crypto.randomUUID();
		const text = { frame: 'New section', note: 'Add an architecture note', text: 'Architecture annotation', shape: 'Label' }[kind];
		dispatch({ type: 'addItem', item: {
			id, kind, shape, text:caption??text, positions: { visual: position, technical: position },
			width: kind === 'frame' ? 600 : 220, height: kind === 'frame' ? 380 : 140, members: []
		} });
		setSelectedId(id);
		setOverview(false); setInspectorCategory('resources'); setDetailTab('form');
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
		const blob = new Blob([JSON.stringify(exportableArchitecture(architecture), null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'cloudforge-sample.architecture.json';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		setMessage('Exported sample architecture JSON');
	}

	return (
		<div className={'studio ' + mode + ' theme-' + theme + (!libraryOpen ? ' library-closed' : '') + (!inspectorOpen ? ' inspector-closed' : '') + (resourceEditing ? ' resource-editing' : '') + (resourceEditing && detailTab === 'code' ? ' details-code' : '')}
			style={{ '--library-width': libraryWidth + 'px', '--inspector-width': (resourceEditing ? detailsWidth : inspectorWidth) + 'px', '--details-width':detailsWidth+'px' } as CSSProperties}>
			<VisualTopbar architecture={architecture} mode={mode} onMode={switchMode} name={architecture.name} revisions={history.past.length}
     onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })} canRedo={!!history.future.length}
     theme={theme} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
				onRename={name => dispatch({ type: 'renameArchitecture', name })}
				onTechnical={() => switchMode('technical')} onExport={exportSample}
				onToggleLibrary={() => setLibraryOpen(value => !value)} onToggleInspector={() => setInspectorOpen(value => !value)} />
			<div className="studio-body">
				<ResourceCatalogue architecture={architecture} onAdd={addResource} onAddCatalogue={addCatalogueResource} onTemplate={addTemplate} search={search} onSearch={setSearch} onImportModule={() => setModuleImportOpen(true)}
					shapesOpen={shapesOpen} onShapesOpen={openShapes} onShapesBack={() => setShapesOpen(false)}
     visible={libraryOpen} onClose={() => setLibraryOpen(false)}
					onDesignAdd={(kind,caption,shape) => {
						const position = flow?.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 });
						if (position) { addItem(kind, position, caption, shape); }
					}} resizeHandle={<PaneResizeHandle side="library" width={libraryWidth} minimum={346} onCommit={setLibraryWidth} />} />
				<div className="design-area">
					<div className="canvas-shell">
						<DesignCanvas architecture={architecture} mode={mode} theme={theme} onThemeChange={setTheme} selectedId={selectedId} dispatch={dispatch}
							onSelect={id => { setSelectedId(id); if (id && inspectorCategory === 'resources' && !architecture.resources.some(resource => resource.id === id)) { setDetailTab('form'); } }} onOpen={openResource} onInit={setFlow} viewports={viewport}
							onOpenShapes={openShapes} onAddItem={addItem} onAddResource={addResource}
       onAddCatalogue={(type, provider, position) => {
        void loadCatalogue(provider).then(snapshot => { const entry = snapshot.entries.find(entry => entry.type === type); if (entry) { addCatalogueResource(entry,provider,position); } }).catch(() => setMessage('Unable to load the provider catalogue.'));
       }} />
					</div>
				</div>
				<aside className="inspector" aria-label="Resource inspector" hidden={!inspectorOpen}>
					<PaneResizeHandle side="inspector" width={resourceEditing ? detailsWidth : inspectorWidth} minimum={resourceEditing ? 360 : 280} onCommit={resourceEditing ? setDetailsWidth : setInspectorWidth} />
     <div className="inspector-switchbar" role="group" aria-label="Resource view">
      <button aria-label="Block view" title="Block view" aria-pressed={detailTab === 'form'} onClick={() => { setDetailTab('form'); if (!selected && inspectorCategory === 'resources') { setOverview(true); } }}><ListTree size={16}/></button>
      <button aria-label="Code view" title="Code view" aria-pressed={detailTab === 'code'} onClick={() => { setDetailTab('code'); if (inspectorCategory === 'resources') { setOverview(false); } }}><Code2 size={16}/></button>
      <button aria-label="Local name issues" title="Local name checks only" aria-pressed={detailTab === 'issues'} onClick={() => { setCheckRequested(true); setDetailTab('issues'); }}><AlertCircle size={14}/>Issues</button>
      <span className="spacer"/><button aria-label="Close resource inspector" onClick={() => setInspectorOpen(false)}><PanelRightClose size={15}/></button>
     </div>
     <div className="inspector-categories" role="group" aria-label="Architecture elements">
      <button aria-label="Resources" title="Resources" aria-pressed={inspectorCategory === 'resources'} onClick={() => { setInspectorCategory('resources'); setDetailTab('form'); setOverview(true); }}><Boxes size={16}/></button>
      <button aria-label="Variables" title="Variables" aria-pressed={inspectorCategory === 'variables'} onClick={() => { setInspectorCategory('variables'); setDetailTab('form'); }}><Variable size={16}/></button>
     </div>
     {detailTab === 'issues' ? <section className="variables-panel"><h2>Local name issues</h2><p className="muted">Provider validation is not connected.</p>{!findings?.length ? <p>No draft-name findings.</p> : findings.map(finding => <button key={finding.resourceId} onClick={() => { setSelectedId(finding.resourceId); setOverview(false); setInspectorCategory('resources'); setDetailTab('form'); }}>{finding.message}</button>)}</section> : inspectorCategory === 'variables' ? null : <>

					{detailTab === 'code' && !selected ? null : overview ? (
						<ArchitectureOverview architecture={architecture} onSelect={id => { setSelectedId(id); setOverview(false); setDetailTab('form'); }} />
      ) : selected ? (
						<>
							<div className="inspector-title">
								<button className="inspector-back" aria-label="Back to architecture overview" onClick={() => { setOverview(true); setDetailTab('form'); }}><ArrowLeft /></button>
								<img src={'./assets/' + resourceDefinition(selected).icon} alt="" /><div><h2>{selected.label || selected.name}</h2><span>{resourceDefinition(selected).label}</span></div>
							</div>
							<div className="form-action-row">

								<span className="form-action-spacer" />
								<button aria-label="Open focused resource workspace" title="Open focused resource workspace" onClick={() => setWorkspaceOpen(true)}><PanelsTopLeft /></button>
								<button aria-label="Focus selected resource" title="Focus selected resource" onClick={() => { void flow?.fitView({ nodes: [{ id: selected.id }], padding: 0.5, maxZoom: 1.5 }); }}><Scan /></button>
							</div>
       {detailTab === 'form' && <div>
							<ResourceFields resource={selected} dispatch={dispatch} />
							<div className="inspector-section"><h3>Connections</h3>
								<p>{architecture.connections.filter(connection => connection.target === selected.id).length} incoming · {architecture.connections.filter(connection => connection.source === selected.id).length} outgoing</p>
								<span className="muted">Design relationships</span>
							</div>
							{checkRequested && <div className="inspector-section"><h3>Local Name Check</h3>{findings?.length === 0 ? <p className="success-text">All draft names passed.</p> : findings?.map(finding => <button className="finding finding-button" key={finding.resourceId} onClick={() => setSelectedId(finding.resourceId)}>{finding.message}</button>)}<p className="muted">Provider and cloud checks require service integration.</p></div>}
							<button className="delete-button" onClick={() => { dispatch({ type: 'delete', id: selected.id }); setSelectedId(''); setMessage('Resource removed. Undo restores its connections.'); }}>Delete Resource</button>
       </div>}
						</>
					) : selectedItem ? (
						<div className="board-item-inspector">
							<h2>{selectedItem.kind === 'frame' ? 'Frame' : 'Design Element'}</h2>
							<label>Text<textarea value={selectedItem.text} onChange={event => dispatch({ type: 'updateItem', id: selectedItem.id, patch: { text: event.target.value } })} /></label>
							<p className="muted">Drag to move. Select the element to resize it on the canvas.</p>
							<button className="delete-button" onClick={() => { dispatch({ type: 'deleteItem', id: selectedItem.id }); setSelectedId(''); }}>Delete Element</button>
						</div>
					) : <div className="empty-inspector"><h2>Select an element</h2><p>Choose a resource, note, text, shape or frame on the canvas.</p></div>}
     </>}
     <div className="variable-container" hidden={inspectorCategory !== 'variables' || detailTab === 'issues'}><VariablePanel architecture={architecture} dispatch={dispatch} code={detailTab === 'code'}/></div>
     <CodePanel resource={selected} architecture={architecture} dispatch={dispatch} hidden={!inspectorOpen || detailTab !== 'code' || inspectorCategory !== 'resources'} />

				</aside>
			</div>
			<footer className="sr-only"><span role="status">{message}</span><span>{history.past.length ? 'Modified draft' : 'Original sample'} · In-memory preview</span></footer>
			{workspaceOpen && selected && <ResourceWorkspace resource={selected} architecture={architecture} dispatch={dispatch} findings={findings} onCheck={checkNames} onClose={() => setWorkspaceOpen(false)} />}
			{moduleImportOpen && <ModuleImport onClose={() => setModuleImportOpen(false)} onImport={importModule} />}
		</div>
	);
}
