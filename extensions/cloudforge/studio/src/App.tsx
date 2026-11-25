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
import { ArrowLeft, Scan, PanelsTopLeft, PanelRightClose, Code2, ListTree, Boxes, Variable, AlertCircle, FileCode2 } from 'lucide-react';
import { PaneResizeHandle } from './PaneResizeHandle.tsx';
import { architectureDiagnostics, type Diagnostic } from './diagnostics.ts';
import { IssuesPanel, focusResourceField } from './IssuesPanel.tsx';
import { resourcePlacement } from './resourceHierarchy.ts';
import { workflowTemplate } from './workflowTemplate.ts';
import { createHostBridge, type HostCloudRegionsPayload, type HostDependencyReport, type HostDetectedEngine, type HostDraftSaveError, type HostDraftSavePreview, type HostEngineValidateReport, type HostExportAuditReport, type HostGraphSnapshot, type HostModuleInspection, type HostNotice, type HostValidationRun } from './webviewBridge.ts';
import type { LiveSchemaMap } from './liveSchema.ts';
import { buildDraftSavePayload, buildHostViewState, defaultTargetTfFile, projectGraphSnapshotToArchitecture, projectHostDiagnostics, sanitizeDraftTfFileName } from './serviceAdapter.ts';
import { projectResourceFiles } from './terraformProjection.ts';
import { DraftSaveDialog } from './DraftSaveDialog.tsx';
import { presentationSvg } from './exportPresentation.ts';

function detectInitialTheme(isHosted: boolean): 'light' | 'dark' {
	if (!isHosted || typeof document === 'undefined') {
		return 'light';
	}
	return document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')
		? 'dark'
		: 'light';
}

export function Studio() {
	const hostBridge = useMemo(() => createHostBridge(), []);
	const [history, dispatch] = useReducer(historyReducer, undefined, () => createHistory(sampleArchitecture()));
	const [mode, setMode] = useState<DesignMode>('visual');
	const [theme, setTheme] = useState<'light' | 'dark'>(() => detectInitialTheme(hostBridge.isHosted));
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
	const setSelectedId = useCallback((id: string) => setSelectedIds(id ? [id] : []), []);
	const [search, setSearch] = useState('');
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [workspaceResourceId, setWorkspaceResourceId] = useState('');
	const [overview, setOverview] = useState(true);
	const [moduleImportOpen, setModuleImportOpen] = useState(false);
	const [libraryOpen, setLibraryOpen] = useState(true);
	const [libraryTab, setLibraryTab] = useState<'resources' | 'templates'>('resources');
 const [shapesOpen, setShapesOpen] = useState(false);
 function openShapes() { setDetailTab('form'); setOverview(true); setLibraryOpen(true); setShapesOpen(true); }
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [libraryWidth, setLibraryWidth] = useState(346);
	const [inspectorWidth, setInspectorWidth] = useState(280);
 const [detailTab, setDetailTab] = useState<'form' | 'code' | 'issues'>('form');
 const [inspectorCategory, setInspectorCategory] = useState<'resources' | 'variables'>('resources');
 const [detailsWidth, setDetailsWidth] = useState(440);
	const [pendingField,setPendingField]=useState<Diagnostic>();
	const [message, setMessage] = useState(hostBridge.isHosted ? 'Connecting to CloudForge workspace…' : 'Sample architecture loaded');
	const [hostSnapshot, setHostSnapshot] = useState<HostGraphSnapshot | null>(null);
	const [hasSourceById, setHasSourceById] = useState<Readonly<Record<string, boolean>>>({});
	const [hostNotice, setHostNotice] = useState<HostNotice | null>(null);
	const [liveSchemas, setLiveSchemas] = useState<LiveSchemaMap>({});
	const requestedSchemasRef = useRef<Set<string>>(new Set());
	const [hostCloudRegions, setHostCloudRegions] = useState<Partial<Record<'azure' | 'aws' | 'google', HostCloudRegionsPayload>>>({});
	const [dependencyReport, setDependencyReport] = useState<HostDependencyReport | null>(null);
	const [exportAuditReport, setExportAuditReport] = useState<HostExportAuditReport | null>(null);
	const [moduleInspections, setModuleInspections] = useState<Record<string, { loading: boolean; inspection: HostModuleInspection | null; error?: string }>>({});
	const [validationRun, setValidationRun] = useState<HostValidationRun | null>(null);
	const [detectedEngines, setDetectedEngines] = useState<readonly HostDetectedEngine[]>([]);
	const [engineReport, setEngineReport] = useState<HostEngineValidateReport | null>(null);
	const [validating, setValidating] = useState(false);
	const [saveDialogOpen, setSaveDialogOpen] = useState(false);
	const [saveFileName, setSaveFileName] = useState('cloudforge-studio.tf');
	const [saveContents, setSaveContents] = useState('');
	const [savePreview, setSavePreview] = useState<HostDraftSavePreview | null>(null);
	const [saveError, setSaveError] = useState<HostDraftSaveError | null>(null);
	const [saving, setSaving] = useState(false);
	const [focusMode, setFocusMode] = useState(false);
	const architectureRef = useRef(history.present);
	architectureRef.current = history.present;
	const hostArchitectureIdRef = useRef<string | null>(null);
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
	const hostFindings = useMemo(
		() => hostBridge.isHosted ? projectHostDiagnostics(architecture, hostSnapshot, validationRun, engineReport) : [],
		[hostBridge.isHosted, architecture, hostSnapshot, validationRun, engineReport]
	);
	const findings = useMemo(
		() => [...hostFindings, ...architectureDiagnostics(architecture, liveSchemas)],
		[hostFindings, architecture, liveSchemas]
	);
	const availableEngine = useMemo(
		() => detectedEngines.find(item => item.status === 'available')?.engine,
		[detectedEngines]
	);

	useEffect(() => {
		if (!hostBridge.isHosted) {
			return;
		}
		const unsubscribe = hostBridge.subscribe(incoming => {
			switch (incoming.type) {
				case 'graph': {
					const sameArch = hostArchitectureIdRef.current === incoming.graph.architectureId;
					hostArchitectureIdRef.current = incoming.graph.architectureId;
					const projected = projectGraphSnapshotToArchitecture(incoming.graph, {
						previousArchitecture: sameArch ? architectureRef.current : undefined,
						viewState: incoming.viewState,
					});
					setHostSnapshot(incoming.graph);
					setHasSourceById(projected.hasSourceById);
					setHostNotice(incoming.notice ?? null);
					setSaveFileName(defaultTargetTfFile(projected.architecture, incoming.viewState?.selectedId ?? undefined));
					if (incoming.viewState?.mode) {
						setMode(incoming.viewState.mode);
					}
					if (incoming.viewState?.theme === 'light' || incoming.viewState?.theme === 'dark') {
						setTheme(incoming.viewState.theme);
					} else if (incoming.viewState?.theme === 'workbench') {
						setTheme(detectInitialTheme(true));
					}
					if (typeof incoming.viewState?.inspectorOpen === 'boolean') {
						setInspectorOpen(incoming.viewState.inspectorOpen);
					}
					if (incoming.viewState?.viewports) {
						viewport.current = { ...viewport.current, ...incoming.viewState.viewports };
					}
					dispatch({ type: 'replace', architecture: projected.architecture });
					if (incoming.viewState?.selectedId && projected.architecture.resources.some(r => r.id === incoming.viewState?.selectedId)) {
						setSelectedId(incoming.viewState.selectedId);
					}
					setMessage('Loaded ' + incoming.graph.architectureName + ' · rev ' + incoming.graph.sourceRevision.slice(0, 8));
					break;
				}
				case 'selectNode':
					setSelectedId(incoming.nodeId ?? '');
					if (incoming.nodeId) {
						setOverview(false);
						setInspectorOpen(true);
						setInspectorCategory('resources');
						setDetailTab('form');
					}
					break;
				case 'notice':
					setHostNotice(incoming.notice);
					if (incoming.notice?.message) {
						setMessage(incoming.notice.message);
					}
					break;
				case 'empty':
					setMessage(incoming.message);
					break;
				case 'liveSchema':
					if (incoming.schema) {
						setLiveSchemas(prev => ({ ...prev, [incoming.typeName]: incoming.schema! }));
					}
					break;
				case 'cloudRegions':
					setHostCloudRegions(prev => ({ ...prev, [incoming.data.provider]: incoming.data }));
					break;
				case 'dependencyReport':
					setDependencyReport(incoming.report);
					break;
				case 'exportAuditReport':
					setExportAuditReport(incoming.report);
					break;
				case 'moduleInspection': {
					const modKey = incoming.modulePath.join('.');
					setModuleInspections(prev => ({
						...prev,
						[modKey]: { loading: false, inspection: incoming.inspection, error: incoming.error },
					}));
					break;
				}
				case 'validationRunUpdate':
					setValidationRun(incoming.run);
					setValidating(incoming.run.outcome === 'running');
					if (incoming.run.outcome !== 'running') {
						setMessage('Validation ' + incoming.run.outcome.replaceAll('_', ' ') + ' (' + incoming.run.coverage + ' coverage)');
					}
					break;
				case 'detectedEngines':
					setDetectedEngines(incoming.engines);
					break;
				case 'engineValidateReport':
					setValidating(false);
					if (incoming.report) {
						setEngineReport(incoming.report);
						setMessage((incoming.report.engine === 'openTofu' ? 'OpenTofu' : 'Terraform') + ' validate: ' + (incoming.report.valid ? 'valid' : incoming.report.errorCount + ' error(s)'));
					} else if (incoming.error) {
						setMessage(incoming.error);
					}
					break;
				case 'draftSavePreview':
					setSaving(false);
					if (incoming.result.ok) {
						setSavePreview(incoming.result.preview);
						setSaveError(null);
					} else {
						setSavePreview(null);
						setSaveError(incoming.result.error);
					}
					break;
				case 'draftSaveApplied':
					setSaving(false);
					if (incoming.result.ok) {
						setSaveDialogOpen(false);
						setSavePreview(null);
						setSaveError(null);
						setMessage('Saved ' + incoming.result.applied.fileName + ' · rev ' + incoming.result.applied.newSourceRevision.slice(0, 8));
						hostBridge.post({ type: 'refresh' });
					} else {
						setSaveError(incoming.result.error);
					}
					break;
				case 'runValidation':
					setInspectorOpen(true);
					setDetailTab('issues');
					if (!incoming.localOnly && hostArchitectureIdRef.current) {
						setValidating(true);
						hostBridge.post({ type: 'requestValidation', scope: incoming.scope, ...(incoming.nodeId ? { nodeId: incoming.nodeId } : {}) });
					}
					break;
				case 'cancelValidation':
					setValidating(false);
					setMessage('Validation cancelled');
					break;
				case 'openExport': {
					const exportMenu = document.querySelector<HTMLDetailsElement>('.shell-export');
					if (exportMenu) {
						exportMenu.open = true;
						exportMenu.querySelector('summary')?.focus();
					}
					break;
				}
				case 'openTemplates':
					setShapesOpen(false);
					setLibraryOpen(true);
					setLibraryTab('templates');
					break;
				case 'exportResult':
					setMessage(incoming.message);
					break;
				case 'focusModeChanged':
					setFocusMode(incoming.active);
					break;
			}
		});
		hostBridge.post({ type: 'ready' });
		return unsubscribe;
	}, [hostBridge, setSelectedId]);

	// Request live version-matched Rust FormSchema when a resource is selected in hosted mode.
	useEffect(() => {
		if (!hostBridge.isHosted || !selected || selected.kind === 'module') {
			return;
		}
		const typeName = resourceDefinition(selected).type;
		if (!typeName || typeName === 'resource' || liveSchemas[typeName] || requestedSchemasRef.current.has(typeName)) {
			return;
		}
		requestedSchemasRef.current.add(typeName);
		hostBridge.post({ type: 'requestSchema', kind: 'resource', typeName });
	}, [hostBridge, selected, liveSchemas]);

	// Mirror selection back to the extension host's native CloudForge Graph tree.
	useEffect(() => {
		if (!hostBridge.isHosted) {
			return;
		}
		hostBridge.post({ type: 'selectNode', nodeId: selectedId || null });
	}, [hostBridge, selectedId]);

	// Persist Studio presentation state (mode, theme, selection, panels, viewports, node positions)
	// back to the extension host's workspaceState when connected to a real workspace architecture.
	useEffect(() => {
		if (!hostBridge.isHosted || !hostSnapshot) {
			return;
		}
		const timer = setTimeout(() => {
			hostBridge.post({
				type: 'viewState',
				state: buildHostViewState({
					architecture,
					mode,
					theme,
					selectedId,
					focusedWorkspaceOpen: workspaceOpen,
					inspectorOpen,
					libraryOpen,
					viewports: viewport.current,
				}),
			});
		}, 350);
		return () => clearTimeout(timer);
	}, [hostBridge, hostSnapshot, architecture, mode, theme, selectedId, workspaceOpen, inspectorOpen, libraryOpen]);

	const inspectModuleResource = useCallback((moduleName: string) => {
		if (!hostBridge.isHosted || !hostSnapshot || !moduleName) {
			return;
		}
		setModuleInspections(prev => ({
			...prev,
			[moduleName]: { loading: true, inspection: prev[moduleName]?.inspection ?? null },
		}));
		hostBridge.post({ type: 'requestModule', modulePath: [moduleName] });
	}, [hostBridge, hostSnapshot]);

	const openResource = useCallback((id: string) => {
		setSelectedId(id);
		setOverview(false); setInspectorOpen(true); setInspectorCategory('resources'); setDetailTab('form');
	}, [setSelectedId]);
	useEffect(()=>{if(pendingField&&selectedId===pendingField.resourceId&&detailTab==='form'){focusResourceField(document.querySelector('#resource-inspector'),pendingField.path);setPendingField(undefined);}},[pendingField,selectedId,detailTab]);
	function showIssues(){setInspectorOpen(true);setDetailTab('issues');}
	function revealIssue(finding:Diagnostic){openResource(finding.resourceId);setPendingField(finding);}

	const runHostValidation = useCallback(() => {
		if (!hostBridge.isHosted) {
			return;
		}
		setValidating(true);
		hostBridge.post({ type: 'requestValidation', scope: 'architecture' });
	}, [hostBridge]);

	const runHostEngineValidate = useCallback(() => {
		if (!hostBridge.isHosted) {
			return;
		}
		setValidating(true);
		hostBridge.post(availableEngine ? { type: 'requestEngineValidate', engine: availableEngine } : { type: 'requestEngineValidate' });
	}, [hostBridge, availableEngine]);

	const openDraftSave = useCallback((requestedFileName?: string) => {
		if (!hostBridge.isHosted) {
			return;
		}
		const targetFile = requestedFileName ?? defaultTargetTfFile(architecture, selectedId || undefined);
		const payload = buildDraftSavePayload(architecture, targetFile, selectedId || undefined);
		setSaveFileName(payload.fileName);
		setSaveContents(payload.contents);
		setSavePreview(null);
		setSaveError(null);
		setSaveDialogOpen(true);
		setSaving(true);
		hostBridge.post({ type: 'requestDraftSavePreview', fileName: payload.fileName, contents: payload.contents });
	}, [hostBridge, architecture, selectedId]);

	const selectDraftSaveProjectFile = useCallback((nextFileName: string) => {
		if (!hostBridge.isHosted) {
			return;
		}
		const payload = buildDraftSavePayload(architecture, nextFileName, selectedId || undefined);
		setSaveFileName(payload.fileName);
		setSaveContents(payload.contents);
		setSavePreview(null);
		setSaveError(null);
		setSaving(true);
		hostBridge.post({ type: 'requestDraftSavePreview', fileName: payload.fileName, contents: payload.contents });
	}, [hostBridge, architecture, selectedId]);

	const refreshDraftSavePreview = useCallback(() => {
		if (!hostBridge.isHosted) {
			return;
		}
		const payload = buildDraftSavePayload(architecture, saveFileName, selectedId || undefined);
		setSaveContents(payload.contents);
		setSavePreview(null);
		setSaveError(null);
		setSaving(true);
		hostBridge.post({ type: 'requestDraftSavePreview', fileName: payload.fileName, contents: payload.contents });
	}, [hostBridge, architecture, saveFileName, selectedId]);

	const applyHostDraftSave = useCallback(() => {
		if (!hostBridge.isHosted || !savePreview) {
			return;
		}
		setSaving(true);
		hostBridge.post({
			type: 'applyDraftSave',
			fileName: savePreview.fileName,
			contents: saveContents,
			previewToken: savePreview.previewToken,
		});
	}, [hostBridge, savePreview, saveContents]);

	const exportHostArtifact = useCallback((format: 'svg' | 'png') => {
		if (!hostBridge.isHosted) {
			return;
		}
		void (async () => {
			try {
				const svg = await presentationSvg(architecture);
				if (format === 'svg') {
					hostBridge.post({
						type: 'exportArtifact',
						format: 'svg',
						suggestedFileName: sanitizeDraftTfFileName(architecture.name).replace(/\.tf$/, '.svg'),
						content: svg,
						encoding: 'utf8',
					});
					return;
				}
				const blob = new Blob([svg], { type: 'image/svg+xml' });
				const url = URL.createObjectURL(blob);
				try {
					const image = new Image();
					image.src = url;
					await image.decode();
					const canvas = document.createElement('canvas');
					const scale = Math.min(2, 8192 / Math.max(image.width, image.height));
					canvas.width = Math.ceil(image.width * scale);
					canvas.height = Math.ceil(image.height * scale);
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						throw new Error('PNG canvas unavailable');
					}
					ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
					const dataUrl = canvas.toDataURL('image/png');
					const base64 = dataUrl.split(',')[1] ?? '';
					hostBridge.post({
						type: 'exportArtifact',
						format: 'png',
						suggestedFileName: sanitizeDraftTfFileName(architecture.name).replace(/\.tf$/, '.png'),
						content: base64,
						encoding: 'base64',
					});
				} finally {
					URL.revokeObjectURL(url);
				}
			} catch (err) {
				setMessage(err instanceof Error ? err.message : 'Export failed');
			}
		})();
	}, [hostBridge, architecture]);

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
			...(hostSnapshot ? { sourceFile: defaultTargetTfFile(architecture, selectedId || undefined) } : {}),
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
  const resource:Resource={ id, kind:'generic', catalogue:entry, provider, name:entry.type.replace(/^(azurerm|aws|google)_/,'')+'_'+id.slice(0,4), ...(hostSnapshot ? { sourceFile: defaultTargetTfFile(architecture, selectedId || undefined) } : {}), region:providerRegions[provider][0], settings, blocks:[], positions:{visual:placed,technical:placed} };
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
				onToggleLibrary={() => setLibraryOpen(value => !value)} onToggleInspector={() => setInspectorOpen(value => !value)}
				host={hostBridge.isHosted ? {
					isHosted: true,
					sourceRevision: hostSnapshot?.sourceRevision,
					status: hostSnapshot?.status,
					notice: hostNotice,
					isDirty: history.past.length > 0,
					validating,
					saving,
					focusMode,
					onRefresh: () => hostBridge.post({ type: 'refresh' }),
					onValidate: runHostValidation,
					onSaveDraft: () => openDraftSave(),
					onToggleFocusMode: () => hostBridge.post({ type: 'toggleFocusMode' }),
					onExportArtifact: exportHostArtifact,
				} : undefined} />
			<div className="studio-body">
				<ResourceCatalogue architecture={architecture} onAdd={addResource} onAddCatalogue={addCatalogueResource} onTemplate={addTemplate} search={search} onSearch={setSearch} onImportModule={() => setModuleImportOpen(true)}
					shapesOpen={shapesOpen} onShapesOpen={openShapes} onShapesBack={() => setShapesOpen(false)}
					tab={libraryTab} onTabChange={setLibraryTab}
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
						<div className="form-action-row"><span className="form-action-spacer" />{hostBridge.isHosted && hasSourceById[selected.id] && <button aria-label="Open Terraform source" title="Open Terraform source in editor" onClick={() => hostBridge.post({ type: 'openSource', nodeId: selected.id })}><FileCode2 /></button>}<button aria-label="Open focused resource workspace" title="Open focused resource workspace" onClick={() => openDetails(selected.id)}><PanelsTopLeft /></button><button aria-label="Focus selected resource" title="Focus selected resource" onClick={() => { void flow?.fitView({ nodes: [{ id: selected.id }], padding: 0.5, maxZoom: 1.5 }); }}><Scan /></button></div>
     </>}
     <div className={'inspector-content'+(detailTab==='code'&&inspectorCategory==='resources'?' inspector-content-code':'')}>
     {detailTab === 'issues' ? <IssuesPanel architecture={architecture} findings={findings} onReveal={revealIssue} host={hostBridge.isHosted ? { isHosted: true, hasWorkspace: !!hostSnapshot, sourceRevision: hostSnapshot?.sourceRevision, validationRun, engineReport, dependencyReport, exportAuditReport, availableEngine, validating, onRunValidation: runHostValidation, onRunEngineValidate: runHostEngineValidate } : undefined}/> : inspectorCategory === 'variables' ? null : <>

					{detailTab === 'code' && !selected ? null : overview ? (
						<ArchitectureOverview architecture={architecture} onSelect={id => { setSelectedId(id); setOverview(false); setDetailTab('form'); }} />
      ) : selected ? (
						<>
       {detailTab === 'form' && <div>
							<ResourceFields resource={selected} dispatch={dispatch} architecture={architecture} liveSchemas={liveSchemas} cloudRegions={hostCloudRegions} moduleInspection={hostBridge.isHosted && hostSnapshot && selected.kind === 'module' ? { loading: !!moduleInspections[selected.name]?.loading, inspection: moduleInspections[selected.name]?.inspection ?? null, error: moduleInspections[selected.name]?.error, onInspect: () => inspectModuleResource(selected.name) } : undefined} hasSource={hostBridge.isHosted && !!hasSourceById[selected.id]} onOpenSource={hostBridge.isHosted ? () => hostBridge.post({ type: 'openSource', nodeId: selected.id }) : undefined} onRevealResource={openResource} onManageVariables={()=>{setInspectorCategory('variables');setDetailTab('form');requestAnimationFrame(()=>variablesButton.current?.focus());}} />
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
     <CodePanel resource={selected} architecture={architecture} dispatch={dispatch} hidden={!inspectorOpen || detailTab !== 'code' || inspectorCategory !== 'resources'} hasSource={hostBridge.isHosted && !!selected && !!hasSourceById[selected.id]} onOpenSource={hostBridge.isHosted && selected ? () => hostBridge.post({ type: 'openSource', nodeId: selected.id }) : undefined} onSaveFile={hostBridge.isHosted && hostSnapshot ? file => openDraftSave(file) : undefined} />
     </div>
				</aside>
			</div>
			{message&&<div className="studio-action-status" role="status">{message}</div>}<footer className="sr-only"><span>{hostBridge.isHosted ? (hostSnapshot ? 'Connected · rev ' + hostSnapshot.sourceRevision.slice(0, 8) : 'Connecting') : (history.past.length ? 'Modified draft' : 'Original sample') + ' · In-memory preview'}</span></footer>
			{workspaceResource && <ResourceWorkspace open={workspaceOpen} resource={workspaceResource} architecture={architecture} dispatch={dispatch} liveSchemas={liveSchemas} cloudRegions={hostCloudRegions} moduleInspection={hostBridge.isHosted && hostSnapshot && workspaceResource.kind === 'module' ? { loading: !!moduleInspections[workspaceResource.name]?.loading, inspection: moduleInspections[workspaceResource.name]?.inspection ?? null, error: moduleInspections[workspaceResource.name]?.error, onInspect: () => inspectModuleResource(workspaceResource.name) } : undefined} hostDiagnostics={hostFindings} hasSource={hostBridge.isHosted && !!hasSourceById[workspaceResource.id]} onOpenSource={hostBridge.isHosted ? () => hostBridge.post({ type: 'openSource', nodeId: workspaceResource.id }) : undefined} onSaveFile={hostBridge.isHosted && hostSnapshot ? file => openDraftSave(file) : undefined} onNavigate={id=>{setWorkspaceResourceId(id);setSelectedId(id);}} onClose={() => setWorkspaceOpen(false)} />}
			{hostBridge.isHosted && <DraftSaveDialog open={saveDialogOpen} fileName={saveFileName} projectFiles={hostSnapshot ? projectResourceFiles(architecture) : undefined} contents={saveContents} busy={saving} preview={savePreview} error={saveError} onFileNameChange={setSaveFileName} onSelectProjectFile={selectDraftSaveProjectFile} onRefreshPreview={refreshDraftSavePreview} onApply={applyHostDraftSave} onClose={() => setSaveDialogOpen(false)} />}
			{moduleImportOpen && <ModuleImport onClose={() => setModuleImportOpen(false)} onImport={importModule} />}
		</div>
	);
}
