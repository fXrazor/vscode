/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Group, LockKeyhole, Ungroup, X } from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import type { Dispatch, ReactNode } from 'react';
import type { Action, Architecture } from './model.ts';
import { canvasElements, resizeTargets } from './canvasOperations.ts';
import { ElementAppearance } from './ElementAppearance.tsx';
import { ContextPopover } from './ContextPopover.tsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pencil, SlidersHorizontal, PanelRight } from 'lucide-react';
import { resourceIconSize } from './resourceGeometry.ts';
import { isResourceContainer } from './resourceHierarchy.ts';
import type { DesignMode } from './model.ts';
import { selectionUnits } from './selectionGeometry.ts';

export type SelectionAction = 'copy' | 'paste' | 'duplicate' | 'delete' | 'lock' | 'unlock' | 'group' | 'ungroup' | 'front' | 'forward' | 'backward' | 'back' | 'fit' | 'edit' | 'selectAll' | 'clear' | `align-${string}` | `size-${string}`;
export function selectionActions(architecture: Architecture, ids: string[], hasClipboard: boolean) {
	const selected = canvasElements(architecture).filter(item => ids.includes(item.id)); const editable = selected.some(item => !item.canvasLocked);
	const grouped = architecture.groups?.some(group => group.members.some(id => ids.includes(id)));
	const canLayer = selected.some(item => !item.canvasLocked && !architecture.items.some(frame => frame.id === item.id && frame.kind === 'frame') && !architecture.resources.some(resource=>resource.id===item.id&&isResourceContainer(resource)));
	return [
		{ id: 'edit', label: 'Edit text / configure', enabled: selected.length === 1 && !selected[0].canvasLocked, shortcut: 'Enter' },
		{ id: 'copy', label: 'Copy selection', enabled: !!selected.length, shortcut: 'Ctrl+C' },
		{ id: 'paste', label: 'Paste canvas copy', enabled: hasClipboard, shortcut: 'Ctrl+V' },
		{ id: 'duplicate', label: 'Duplicate selection', enabled: !!selected.length, shortcut: 'Ctrl+D' },
		{ id: 'group', label: 'Group selection', enabled: selected.length > 1 && selected.every(item => !item.canvasLocked), shortcut: 'Ctrl+G' },
		{ id: 'ungroup', label: 'Ungroup selection', enabled: !!grouped && editable, shortcut: 'Ctrl+Shift+G' },
		{ id: selected.some(item => item.canvasLocked) ? 'unlock' : 'lock', label: selected.some(item => item.canvasLocked) ? 'Unlock selection' : 'Lock selection', enabled: !!selected.length, shortcut: 'Ctrl+L' },
		{ id: 'front', label: 'Bring to front', enabled: canLayer }, { id: 'forward', label: 'Bring forward', enabled: canLayer },
		{ id: 'backward', label: 'Send backward', enabled: canLayer }, { id: 'back', label: 'Send to back', enabled: canLayer },
		{ id: 'fit', label: 'Focus selection', enabled: !!selected.length, shortcut: 'F' },
		{ id: 'selectAll', label: 'Select all elements', enabled: true, shortcut: 'Ctrl+A' },
		{ id: 'delete', label: 'Delete selection', enabled: editable, shortcut: 'Delete' }
	] as { id: SelectionAction; label: string; enabled: boolean; shortcut?: string }[];
}

/** How many selected elements a multi-object resize changes: drawings, plus visual-view resource icons. */
export function resizable(architecture: Architecture, ids: string[], mode: DesignMode): number {
	const { items, icons } = resizeTargets(architecture, ids, mode);
	return items.length + icons.length;
}

export function CanvasActionMenu({ children, architecture, ids, hasClipboard, run, container, readOnly = false }: { children: ReactNode; architecture: Architecture; ids: string[]; hasClipboard: boolean; run: (action: SelectionAction) => void; container: HTMLElement | null; readOnly?: boolean }) {
	return <ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger><ContextMenu.Portal container={container}><ContextMenu.Content className="canvas-context-menu" aria-label="Canvas actions" collisionPadding={8} onCloseAutoFocus={event => { event.preventDefault(); container?.focus(); }}>
		{selectionActions(architecture, ids, hasClipboard).filter(action => !readOnly || ['edit', 'fit', 'selectAll'].includes(action.id)).map(action => <ContextMenu.Item key={action.id} disabled={!action.enabled} className="canvas-context-item" onSelect={() => run(action.id)}>{readOnly && action.id === 'edit' ? 'Inspect resource' : action.label}<span>{action.shortcut}</span></ContextMenu.Item>)}
	</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}

export function SelectionControls({ architecture, ids, dispatch, run, hasClipboard, mode, onInspect, container }: {
 architecture: Architecture; ids: string[]; dispatch: Dispatch<Action>; run: (action: SelectionAction) => void; hasClipboard: boolean;
 mode: DesignMode; onInspect: (id: string) => void; container: HTMLElement | null;
}) {
 const selected = canvasElements(architecture).filter(item => ids.includes(item.id));
 if (!selected.length) { return null; }
 const drawings = architecture.items.filter(item => ids.includes(item.id)); const first = drawings[0];
 const allDrawings = drawings.length === selected.length; const locked = selected.some(item => item.canvasLocked);
 const resource = selected.length === 1 ? architecture.resources.find(item => item.id === ids[0]) : undefined;
 const grouped = architecture.groups?.find(group => group.members.some(id => ids.includes(id)));
 const units = selectionUnits(architecture, ids).length;
 const label = grouped?.label ?? (selected.length > 1 ? selected.length + ' elements' : first ? first.kind === 'note' ? 'Sticky note' : first.kind === 'frame' ? 'Frame' : first.kind === 'shape' ? 'Shape' : first.kind === 'ink' ? 'Drawing' : 'Text' : resource?.label || resource?.name || 'Resource');
 return <section className="selection-controls nodrag nopan" aria-label="Selection controls" aria-keyshortcuts="Alt+F10"
  onKeyDown={event => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('[role="menu"]')) { event.preventDefault(); event.stopPropagation(); container?.focus(); } }}>
  <span className="selection-caption" title={label + ' · Alt+F10 to reach these controls from the canvas'}>{label}</span>
  <div className="selection-quick-actions" role="toolbar" aria-label="Selection actions">
   {!locked && selected.length === 1 && first?.kind !== 'ink' && <button onClick={() => run('edit')} title={resource ? 'Configure resource' : 'Edit text (Enter)'}><Pencil size={14}/>{resource ? 'Configure' : 'Edit text'}</button>}
   {!locked && allDrawings && <ContextPopover label="Appearance" icon={<SlidersHorizontal size={14}/>} container={container}><ElementAppearance item={first} ids={ids} dispatch={dispatch}/></ContextPopover>}
   {resource && <button aria-label="Open resource inspector" title="Quick edit in inspector" onClick={() => onInspect(resource.id)}><PanelRight size={15}/></button>}
   {resource && !isResourceContainer(resource) && mode === 'visual' && !locked && <select aria-label="Resource icon size" title="Icon size" value={resourceIconSize(resource)} onChange={event => dispatch({type:'resizeResource',id:resource.id,position:resource.positions.visual,iconSize:Number(event.target.value)})}>
    {![24,32,48,64,96,128,160].includes(resourceIconSize(resource)) && <option value={resourceIconSize(resource)}>{resourceIconSize(resource)} px</option>}{[24,32,48,64,96,128,160].map(size=><option key={size} value={size}>{size} px</option>)}
   </select>}
   {units > 1 && !locked && <select aria-label="Align or distribute selection" value="" onChange={event => run(('align-' + event.target.value) as SelectionAction)}><option value="">Align</option><option value="left">Left</option><option value="center">Horizontal centres</option><option value="right">Right</option><option value="top">Top</option><option value="middle">Vertical centres</option><option value="bottom">Bottom</option><option value="horizontal" disabled={units<3}>Equal horizontal gaps</option><option value="vertical" disabled={units<3}>Equal vertical gaps</option></select>}
   {selected.length > 1 && !locked && resizable(architecture, ids, mode) > 0 && <select aria-label="Resize selection" title="Resize selection" value="" onChange={event => run(('size-' + event.target.value) as SelectionAction)}><option value="">Size</option>{resizable(architecture, ids, mode) > 1 && <><option value="width">Match widths</option><option value="height">Match heights</option><option value="size">Match sizes</option></>}<option value="0.5">Scale 50%</option><option value="0.75">Scale 75%</option><option value="1.25">Scale 125%</option><option value="1.5">Scale 150%</option><option value="2">Scale 200%</option></select>}
   {selected.length > 1 && !locked && <button onClick={() => run(grouped?'ungroup':'group')}>{grouped?<Ungroup size={14}/>:<Group size={14}/>} {grouped?'Ungroup':'Group'}</button>}
   {locked && <button aria-label="Unlock selection" onClick={() => run('unlock')}><LockKeyhole size={14}/>Unlock</button>}
   <DropdownMenu.Root modal={false}><DropdownMenu.Trigger aria-label="More selection actions" title="More actions"><MoreHorizontal size={17}/></DropdownMenu.Trigger><DropdownMenu.Portal container={container}>
    <DropdownMenu.Content className="canvas-context-menu" aria-label="Selection menu" sideOffset={8} collisionPadding={12}>{selectionActions(architecture,ids,hasClipboard).map(action=><DropdownMenu.Item className="canvas-context-item" key={action.id} disabled={!action.enabled} onSelect={() => run(action.id)}>{action.label}<span>{action.shortcut}</span></DropdownMenu.Item>)}</DropdownMenu.Content>
   </DropdownMenu.Portal></DropdownMenu.Root>
   <button aria-label="Clear canvas selection" title="Clear selection (Escape)" onClick={() => run('clear')}><X size={14}/></button>
  </div>
 </section>;
}
