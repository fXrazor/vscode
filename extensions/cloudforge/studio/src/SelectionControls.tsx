/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ArrowDownToLine, ArrowUpToLine, BoxSelect, BringToFront, ChevronRight, ClipboardPaste, Copy, CopyPlus, Focus, Frame, Group, Layers, LayoutGrid, Lock, LockKeyhole, LockOpen, Maximize2, Paintbrush, SendToBack, Sparkles, Trash2, Ungroup, X, type LucideIcon } from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Fragment, type Dispatch, type ReactNode } from 'react';
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

export type SelectionAction = 'copy' | 'paste' | 'duplicate' | 'copyStyle' | 'pasteStyle' | 'selectSimilar' | 'frameSelection' | 'fitFrame' | 'delete' | 'lock' | 'unlock' | 'group' | 'ungroup' | 'front' | 'forward' | 'backward' | 'back' | 'fit' | 'edit' | 'selectAll' | 'clear' | `align-${string}` | `size-${string}`;
type MenuSection = 'edit' | 'clipboard' | 'structure' | 'arrange' | 'view' | 'danger';
export type SelectionMenuAction = { id: SelectionAction; label: string; enabled: boolean; shortcut?: string; section: MenuSection; icon: LucideIcon };
export function selectionActions(architecture: Architecture, ids: string[], hasClipboard: boolean, hasStyleClipboard = false): SelectionMenuAction[] {
	const selected = canvasElements(architecture).filter(item => ids.includes(item.id)); const editable = selected.some(item => !item.canvasLocked);
	const drawings = architecture.items.filter(item => ids.includes(item.id));
	const editableDrawings = drawings.some(item => !item.canvasLocked);
	const grouped = architecture.groups?.some(group => group.members.some(id => ids.includes(id)));
	const canWrapFrame = selected.some(item => !item.canvasLocked && !architecture.items.some(frame => frame.id === item.id && frame.kind === 'frame'));
	const singleFrame = selected.length === 1 && architecture.items.some(item => item.id === ids[0] && item.kind === 'frame' && !item.canvasLocked);
	const canLayer = selected.some(item => !item.canvasLocked && !architecture.items.some(frame => frame.id === item.id && frame.kind === 'frame') && !architecture.resources.some(resource=>resource.id===item.id&&isResourceContainer(resource)));
	const locked = selected.some(item => item.canvasLocked);
	const units = selectionUnits(architecture, ids).length;
	return [
		{ id: 'edit', label: 'Edit text / configure', enabled: selected.length === 1 && !selected[0].canvasLocked, shortcut: 'Enter', section: 'edit', icon: Pencil },
		{ id: 'copy', label: 'Copy', enabled: !!selected.length, shortcut: 'Ctrl+C', section: 'clipboard', icon: Copy },
		{ id: 'paste', label: 'Paste', enabled: hasClipboard, shortcut: 'Ctrl+V', section: 'clipboard', icon: ClipboardPaste },
		{ id: 'duplicate', label: 'Duplicate', enabled: !!selected.length, shortcut: 'Ctrl+D', section: 'clipboard', icon: CopyPlus },
		{ id: 'copyStyle', label: 'Copy style', enabled: selected.length === 1 && drawings.length === 1, shortcut: 'Ctrl+Alt+C', section: 'clipboard', icon: Paintbrush },
		{ id: 'pasteStyle', label: 'Paste style', enabled: hasStyleClipboard && editableDrawings, shortcut: 'Ctrl+Alt+V', section: 'clipboard', icon: Paintbrush },
		{ id: 'group', label: 'Group', enabled: selected.length > 1 && selected.every(item => !item.canvasLocked), shortcut: 'Ctrl+G', section: 'structure', icon: Group },
		{ id: 'ungroup', label: 'Ungroup', enabled: !!grouped && editable, shortcut: 'Ctrl+Shift+G', section: 'structure', icon: Ungroup },
		{ id: 'frameSelection', label: 'Wrap in frame', enabled: canWrapFrame, shortcut: 'Ctrl+Alt+F', section: 'structure', icon: Frame },
		...(singleFrame ? [{ id: 'fitFrame' as const, label: 'Fit frame to contents', enabled: true, section: 'structure' as const, icon: Maximize2 }] : []),
		{ id: locked ? 'unlock' : 'lock', label: locked ? 'Unlock' : 'Lock', enabled: !!selected.length, shortcut: 'Ctrl+L', section: 'structure', icon: locked ? LockOpen : Lock },
		{ id: 'align-tidy', label: 'Tidy up spacing', enabled: units > 1 && editable, section: 'arrange', icon: LayoutGrid },
		{ id: 'front', label: 'Bring to front', enabled: canLayer, section: 'arrange', icon: BringToFront }, { id: 'forward', label: 'Bring forward', enabled: canLayer, section: 'arrange', icon: ArrowUpToLine },
		{ id: 'backward', label: 'Send backward', enabled: canLayer, section: 'arrange', icon: ArrowDownToLine }, { id: 'back', label: 'Send to back', enabled: canLayer, section: 'arrange', icon: SendToBack },
		{ id: 'fit', label: 'Zoom to selection', enabled: !!selected.length, shortcut: 'F', section: 'view', icon: Focus },
		{ id: 'selectSimilar', label: 'Select similar', enabled: !!selected.length, section: 'view', icon: Sparkles },
		{ id: 'selectAll', label: 'Select all', enabled: true, shortcut: 'Ctrl+A', section: 'view', icon: BoxSelect },
		{ id: 'delete', label: 'Delete', enabled: editable, shortcut: 'Del', section: 'danger', icon: Trash2 }
	];
}

type MenuParts = Pick<typeof ContextMenu, 'Item' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent' | 'Portal' | 'Label'>;
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
function Shortcut({ keys }: { keys?: string }) {
	if (!keys) { return null; }
	return <span className="menu-shortcut" aria-hidden="true">{keys.split('+').map(key => <kbd key={key}>{key === 'Ctrl' && isMac ? '⌘' : key === 'Shift' && isMac ? '⇧' : key}</kbd>)}</span>;
}

/** One menu body for right-click and the More button: grouped sections, icons, key hints, Arrange as a submenu. */
function SelectionMenuBody({ parts: M, actions, run, container, labelFor }: { parts: MenuParts; actions: SelectionMenuAction[]; run: (action: SelectionAction) => void; container: HTMLElement | null; labelFor?: (action: SelectionMenuAction) => string }) {
	const sections = [...new Set(actions.map(action => action.section))];
	const item = (action: SelectionMenuAction) => { const Icon = action.icon; return <M.Item key={action.id} disabled={!action.enabled} className="canvas-context-item" data-danger={action.section === 'danger' || undefined} onSelect={() => run(action.id)}>
		<Icon size={15} aria-hidden="true"/><span className="menu-label">{labelFor?.(action) ?? action.label}</span><Shortcut keys={action.shortcut}/>
	</M.Item>; };
	return <>{sections.map((section, index) => {
		const rows = actions.filter(action => action.section === section);
		const body = section === 'arrange' ? <M.Sub key={section}><M.SubTrigger className="canvas-context-item" disabled={rows.every(action => !action.enabled)}><Layers size={15} aria-hidden="true"/><span className="menu-label">Arrange</span><ChevronRight size={14} className="menu-chevron" aria-hidden="true"/></M.SubTrigger>
			<M.Portal container={container}><M.SubContent className="canvas-context-menu" sideOffset={6} alignOffset={-5} collisionPadding={8}>{rows.map(item)}</M.SubContent></M.Portal></M.Sub> : rows.map(item);
		return <Fragment key={section}>{index > 0 && <M.Separator className="canvas-context-separator"/>}{body}</Fragment>;
	})}</>;
}

export function CanvasActionMenu({ children, architecture, ids, hasClipboard, hasStyleClipboard = false, run, container, readOnly = false }: { children: ReactNode; architecture: Architecture; ids: string[]; hasClipboard: boolean; hasStyleClipboard?: boolean; run: (action: SelectionAction) => void; container: HTMLElement | null; readOnly?: boolean }) {
	const actions = selectionActions(architecture, ids, hasClipboard, hasStyleClipboard).filter(action => !readOnly || ['edit', 'fit', 'selectAll'].includes(action.id));
	const count = canvasElements(architecture).filter(item => ids.includes(item.id)).length;
	return <ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger><ContextMenu.Portal container={container}><ContextMenu.Content className="canvas-context-menu" aria-label="Canvas actions" collisionPadding={8} onCloseAutoFocus={event => { event.preventDefault(); container?.focus(); }}>
		{count > 0 && <ContextMenu.Label className="canvas-context-heading">{count === 1 ? '1 element selected' : count + ' elements selected'}</ContextMenu.Label>}
		<SelectionMenuBody parts={ContextMenu} actions={actions} run={run} container={container} labelFor={action => readOnly && action.id === 'edit' ? 'Inspect resource' : action.label}/>
	</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}

/** How many selected elements a multi-object resize changes: drawings, plus visual-view resource icons. */
export function resizable(architecture: Architecture, ids: string[], mode: DesignMode): number {
	const { items, icons } = resizeTargets(architecture, ids, mode);
	return items.length + icons.length;
}

export function SelectionControls({ architecture, ids, dispatch, run, hasClipboard, hasStyleClipboard = false, mode, onInspect, container }: {
 architecture: Architecture; ids: string[]; dispatch: Dispatch<Action>; run: (action: SelectionAction) => void; hasClipboard: boolean; hasStyleClipboard?: boolean;
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
   {units > 1 && !locked && <select aria-label="Align or distribute selection" value="" onChange={event => run(('align-' + event.target.value) as SelectionAction)}><option value="">Align</option><option value="left">Left</option><option value="center">Horizontal centres</option><option value="right">Right</option><option value="top">Top</option><option value="middle">Vertical centres</option><option value="bottom">Bottom</option><option value="horizontal" disabled={units<3}>Equal horizontal gaps</option><option value="vertical" disabled={units<3}>Equal vertical gaps</option><option value="tidy">Tidy up (row / grid)</option><option value="flip-h">Flip horizontally</option><option value="flip-v">Flip vertically</option></select>}
   {selected.length > 1 && !locked && resizable(architecture, ids, mode) > 0 && <select aria-label="Resize selection" title="Resize selection" value="" onChange={event => run(('size-' + event.target.value) as SelectionAction)}><option value="">Size</option>{resizable(architecture, ids, mode) > 1 && <><option value="width">Match widths</option><option value="height">Match heights</option><option value="size">Match sizes</option></>}<option value="0.5">Scale 50%</option><option value="0.75">Scale 75%</option><option value="1.25">Scale 125%</option><option value="1.5">Scale 150%</option><option value="2">Scale 200%</option></select>}
   {selected.length > 1 && !locked && <button onClick={() => run(grouped?'ungroup':'group')}>{grouped?<Ungroup size={14}/>:<Group size={14}/>} {grouped?'Ungroup':'Group'}</button>}
   {locked && <button aria-label="Unlock selection" onClick={() => run('unlock')}><LockKeyhole size={14}/>Unlock</button>}
   <DropdownMenu.Root modal={false}><DropdownMenu.Trigger aria-label="More selection actions" title="More actions"><MoreHorizontal size={17}/></DropdownMenu.Trigger><DropdownMenu.Portal container={container}>
    <DropdownMenu.Content className="canvas-context-menu" aria-label="Selection menu" sideOffset={8} collisionPadding={12}><SelectionMenuBody parts={DropdownMenu as unknown as MenuParts} actions={selectionActions(architecture,ids,hasClipboard,hasStyleClipboard)} run={run} container={container}/></DropdownMenu.Content>
   </DropdownMenu.Portal></DropdownMenu.Root>
   <button aria-label="Clear canvas selection" title="Clear selection (Escape)" onClick={() => run('clear')}><X size={14}/></button>
  </div>
 </section>;
}
