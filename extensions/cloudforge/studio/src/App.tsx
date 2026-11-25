/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { VariablePanel } from './VariablePanel.tsx';
import { exportableArchitecture } from './variables.ts';
import type { ShapeId } from './shapes.ts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import {
	createHistory, historyReducer, type Resource, type BoardItem, type DesignMode,
	type Position, type Provider, type ResourceKind, type CatalogueEntry
} from './model.ts';
import { providerRegions, resourceDefinition, sampleArchitecture } from './fixture.ts';
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
import { architectureDiagnostics, type Diagnostic } from './diagnostics.ts';
import { IssuesPanel, focusResourceField } from './IssuesPanel.tsx';
import { resourcePlacement } from './resourceHierarchy.ts';
import { workflowTemplate } from './workflowTemplate.ts';

export function Studio() {
	const [history, dispatch] = useReducer(historyReducer, undefined, () => createHistory(sampleArchitecture()));
	const [mode, setMode] = useState<DesignMode>('visual');
	const [theme, setTheme] = useState<'light' | 'dark'>('light');
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
	const setSelectedId = useCallback((id: string) => setSelectedIds(id ? [id] : []), []);
	const [search, setSearch] = useState('');
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [workspaceResourceId, setWorkspaceResourceId] = useState('');
	const [overview, setOverview] = useState(true);
	const [moduleImportOpen, setModuleImportOpen] = useState(false);
	const [libraryOpen, setLibraryOpen] = useState(true);
 const [shapesOpen, setShapesOpen] = useState(false);
 function openShapes() { setDetailTab('form'); setOverview(true); setLibraryOpen(true); setShapesOpen(true); }
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [libraryWidth, setLibraryWidth] = useState(346);
	const [inspectorWidth, setInspectorWidth] = useState(280);
 const [detailTab, setDetailTab] = useState<'form' | 'code' | 'issues'>('form');
 const [inspectorCategory, setInspectorCategory] = useState<'resources' | 'variables'>('resources');
 const [detailsWidth, setDetailsWidth] = useState(440);
	const [pendingField,setPendingField]=useState<Diagnostic>();
	const [message, setMessage] = useState('Sample architecture loaded');
	useEffect(()=>{if(!message){return;}const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
	const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, DesignEdgeType>>();
	const viewport = useRef<Partial<Record<DesignMode, Viewport>>>({});
	const variablesButton = useRef<HTMLButtonElement>(null);
	const architecture = history.present;
	const selected = architecture.resources.find(resource => resource.id === selectedId);
	const workspaceResource = architecture.resources.find(resource=>resource.id===workspaceResourceId);
	const openDetails = useCallback((id:string)=>{setSelectedId(id);setWorkspaceResourceId(id);setWorkspaceOpen(true);},[]);
	const selectedItem = architecture.items.find(item => item.id === selectedId);
 const resourceEditing = inspectorOpen && (inspectorCategory === 'variables' || detailTab === 'code' || (!overview && !!selected));
	const findings = useMemo(()=>architectureDiagnostics(architecture),[architecture]);
	const openResource = useCallback((id: string) => {
		setSelectedId(id);
		setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
	}, []);
	useEffect(()=>{if(pendingField&&selectedId===pendingField.resourceId&&detailTab==='form'){focusResourceField(document.querySelector('#resource-inspector'),pendingField.path);setPendingField(undefined);}},[pendingField,selectedId,detailTab]);
	function showIssues(){setInspectorOpen(true);setDetailTab('issues');}
	function revealIssue(finding:Diagnostic){openResource(finding.resourceId);setPendingField(finding);}

	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			if (event.defaultPrevented) { return; }
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
		// The renderer records its viewport on move end. A departing renderer's instance
		// may still be mounted here, so never copy it into the next renderer's slot.
		setMode(next);
		setMessage(next === 'visual' ? 'Visual Design · shared draft preserved' : 'Technical Design · shared draft preserved');
	}

	const resourceCount = architecture.resources.length;
	const addResource = useCallback((kind: ResourceKind, provider: Provider, position?: Position, parentId?:string) => {
		const id = crypto.randomUUID();
		const definition = resourceDefinition({ kind, provider });
		const placed = position ?? {
			x: 160 + (resourceCount % 3) * 250,
			y: 600 + Math.floor(Math.max(0, resourceCount - 6) / 3) * 180
		};
		const resource:Resource = {
			id, kind, provider, name: 'new-' + kind + '-' + (resourceCount + 1),
			region: providerRegions[provider][0], settings: { ...definition.defaults },
			blocks: [],
			positions: { visual: placed, technical: placed }
		};
		const placement=resourcePlacement(architecture,resource,parentId); if(!placement.ok){setMessage(placement.reason);return;} resource.parentId=placement.parentId;
		dispatch({type:'add',resource});
		setSelectedId(id);
		setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
		setMessage('Added ' + definition.label + ' to the shared draft');
	}, [resourceCount,architecture]);

 const addCatalogueResource = useCallback((entry: CatalogueEntry, provider: Provider, position?: Position, parentId?:string) => {
  const id = crypto.randomUUID();
  const bounds = document.querySelector('.canvas')?.getBoundingClientRect();
  const placed = position ?? (flow && bounds ? flow.screenToFlowPosition({ x: bounds.x+bounds.width/2, y:bounds.y+bounds.height/2 }) : { x:100,y:100 });
  const settings = Object.fromEntries(entry.fields.filter(field=>field.required && !['name','location','region'].includes(field.name)).map(field=>[field.name, field.default === undefined ? '' : String(field.default)]));
  const resource:Resource={ id, kind:'generic', catalogue:entry, provider, name:entry.type.replace(/^(azurerm|aws|google)_/,'')+'_'+id.slice(0,4), region:providerRegions[provider][0], settings, blocks:[], positions:{visual:placed,technical:placed} };
  const placement=resourcePlacement(architecture,resource,parentId);if(!placement.ok){setMessage(placement.reason);return;}resource.parentId=placement.parentId;dispatch({type:'add',resource});
  setSelectedId(id); setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
 },[flow,architecture]);

 function addTemplate(kind:'network'|'platform'|'workflow') {
  if(kind==='workflow'){
   const rect=document.querySelector('.canvas')?.getBoundingClientRect();
   const centre=flow&&rect?flow.screenToFlowPosition({x:rect.x+rect.width/2,y:rect.y+rect.height/2}):{x:200,y:200};
   const pattern=workflowTemplate({x:centre.x-500,y:centre.y-100},crypto.randomUUID());
   dispatch({type:'insert',architecture:pattern});setSelectedIds(pattern.items.map(item=>item.id));
   requestAnimationFrame(()=>requestAnimationFrame(()=>{void flow?.fitView({nodes:pattern.items.map(item=>({id:item.id})),padding:0.18,maxZoom:1});}));return;
  }
  const pattern=sampleArchitecture();
  const wanted=kind==='network' ? ['network','subnet'] : ['cluster','storage','monitor'];
  const ids=new Map([...pattern.resources,...pattern.items].map(item=>[item.id,crypto.randomUUID()]));
  const suffix=crypto.randomUUID().slice(0,4);
  const resources=pattern.resources.filter(resource=>wanted.includes(resource.id)).map(resource=>({...resource,id:ids.get(resource.id)!,parentId:resource.parentId&&wanted.includes(resource.parentId)?ids.get(resource.parentId):undefined,name:resource.name+'-'+suffix,positions:{visual:{x:resource.positions.visual.x,y:resource.positions.visual.y+1300},technical:{x:resource.positions.technical.x,y:resource.positions.technical.y+1300}}}));
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
     libraryOpen={libraryOpen} inspectorOpen={inspectorOpen} errors={findings.filter(item=>item.severity==='error').length} warnings={findings.filter(item=>item.severity==='warning').length} onIssues={showIssues}
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
						<DesignCanvas architecture={architecture} mode={mode} theme={theme} onThemeChange={setTheme} selectedId={selectedId} selectedIds={selectedIds} onSelectionChange={setSelectedIds} dispatch={dispatch}
							onSelect={id => { setSelectedId(id); if (id && inspectorCategory === 'resources' && !architecture.resources.some(resource => resource.id === id)) { setDetailTab('form'); } }} onOpen={openResource} onOpenDetails={openDetails} onInit={setFlow} viewports={viewport}
							onOpenShapes={openShapes} onAddItem={addItem} onAddResource={addResource}
       onAddCatalogue={(type, provider, position, parentId) => {
        void loadCatalogue(provider).then(snapshot => { const entry = snapshot.entries.find(entry => entry.type === type); if (entry) { addCatalogueResource(entry,provider,position,parentId); } }).catch(() => setMessage('Unable to load the provider catalogue.'));
       }} />
					</div>
				</div>
				<aside id="resource-inspector" className="inspector" aria-label="Resource inspector" hidden={!inspectorOpen}>
					<PaneResizeHandle side="inspector" width={resourceEditing ? detailsWidth : inspectorWidth} minimum={resourceEditing ? 360 : 280} onCommit={resourceEditing ? setDetailsWidth : setInspectorWidth} />
     <div className="inspector-switchbar" role="group" aria-label="Resource view">
      <button aria-label="Block view" title="Block view" aria-pressed={detailTab === 'form'} onClick={() => { setDetailTab('form'); if (!selected && inspectorCategory === 'resources') { setOverview(true); } }}><ListTree size={16}/></button>
      <button aria-label="Code view" title="Code view" aria-pressed={detailTab === 'code'} onClick={() => { setDetailTab('code'); if (inspectorCategory === 'resources') { setOverview(false); } }}><Code2 size={16}/></button>
      <button aria-label="Local configuration issues" title="Local catalogue checks" aria-pressed={detailTab === 'issues'} onClick={showIssues}><AlertCircle size={14}/>Issues{findings.length?' ('+findings.length+')':''}</button>
      <span className="spacer"/><button aria-label="Close resource inspector" onClick={() => setInspectorOpen(false)}><PanelRightClose size={15}/></button>
     </div>
     <div className="inspector-categories" role="group" aria-label="Architecture elements">
      <button aria-label="Resources" title="Resources" aria-pressed={inspectorCategory === 'resources'} onClick={() => { setInspectorCategory('resources'); setDetailTab('form'); setOverview(true); }}><Boxes size={16}/></button>
      <button ref={variablesButton} aria-label="Variables" title="Variables" aria-pressed={inspectorCategory === 'variables'} onClick={() => { setInspectorCategory('variables'); setDetailTab('form'); }}><Variable size={16}/></button>
     </div>
     {inspectorCategory === 'resources' && detailTab !== 'issues' && !overview && selected && <>
						<div className="inspector-title">
							<button className="inspector-back" aria-label="Back to architecture overview" onClick={() => { setOverview(true); setDetailTab('form'); }}><ArrowLeft /></button>
							<img src={'./assets/' + resourceDefinition(selected).icon} alt="" /><div><h2>{selected.label || selected.name}</h2><span>{resourceDefinition(selected).label}</span></div>
						</div>
						<div className="form-action-row"><span className="form-action-spacer" /><button aria-label="Open focused resource workspace" title="Open focused resource workspace" onClick={() => openDetails(selected.id)}><PanelsTopLeft /></button><button aria-label="Focus selected resource" title="Focus selected resource" onClick={() => { void flow?.fitView({ nodes: [{ id: selected.id }], padding: 0.5, maxZoom: 1.5 }); }}><Scan /></button></div>
     </>}
     <div className={'inspector-content'+(detailTab==='code'&&inspectorCategory==='resources'?' inspector-content-code':'')}>
     {detailTab === 'issues' ? <IssuesPanel architecture={architecture} findings={findings} onReveal={revealIssue}/> : inspectorCategory === 'variables' ? null : <>

					{detailTab === 'code' && !selected ? null : overview ? (
						<ArchitectureOverview architecture={architecture} onSelect={id => { setSelectedId(id); setOverview(false); setDetailTab('form'); }} />
      ) : selected ? (
						<>
       {detailTab === 'form' && <div>
							<ResourceFields resource={selected} dispatch={dispatch} architecture={architecture} onRevealResource={openResource} onManageVariables={()=>{setInspectorCategory('variables');setDetailTab('form');requestAnimationFrame(()=>variablesButton.current?.focus());}} />
							<div className="inspector-section"><h3>Connections</h3>
								<p>{architecture.connections.filter(connection => connection.target === selected.id).length} incoming · {architecture.connections.filter(connection => connection.source === selected.id).length} outgoing</p>
								<span className="muted">Design relationships</span>
							</div>
							<button className="delete-button" disabled={selected.canvasLocked} onClick={() => { dispatch({ type: 'delete', id: selected.id }); setSelectedId(''); setMessage('Resource removed. Undo restores its connections.'); }}>Delete Resource</button>
       </div>}
						</>
					) : selectedItem ? (
						<div className="board-item-inspector">
							<h2>{selectedItem.kind === 'frame' ? 'Frame' : 'Design Element'}</h2>
							<label>Text<textarea disabled={selectedItem.canvasLocked} value={selectedItem.text} onChange={event => dispatch({ type: 'updateItem', id: selectedItem.id, patch: { text: event.target.value } })} /></label>
							<p className="muted">Drag to move. Select the element to resize it on the canvas.</p>
							<button className="delete-button" disabled={selectedItem.canvasLocked} onClick={() => { dispatch({ type: 'deleteItem', id: selectedItem.id }); setSelectedId(''); }}>Delete Element</button>
						</div>
					) : <div className="empty-inspector"><h2>Select an element</h2><p>Choose a resource, note, text, shape or frame on the canvas.</p></div>}
     </>}
     <div className="variable-container" hidden={inspectorCategory !== 'variables' || detailTab === 'issues'}><VariablePanel architecture={architecture} dispatch={dispatch} code={detailTab === 'code'}/></div>
     <CodePanel resource={selected} architecture={architecture} dispatch={dispatch} hidden={!inspectorOpen || detailTab !== 'code' || inspectorCategory !== 'resources'} />
     </div>
				</aside>
			</div>
			{message&&<div className="studio-action-status" role="status">{message}</div>}<footer className="sr-only"><span>{history.past.length ? 'Modified draft' : 'Original sample'} · In-memory preview</span></footer>
			{workspaceResource && <ResourceWorkspace open={workspaceOpen} resource={workspaceResource} architecture={architecture} dispatch={dispatch} onNavigate={id=>{setWorkspaceResourceId(id);setSelectedId(id);}} onClose={() => setWorkspaceOpen(false)} />}
			{moduleImportOpen && <ModuleImport onClose={() => setModuleImportOpen(false)} onImport={importModule} />}
		</div>
	);
}
