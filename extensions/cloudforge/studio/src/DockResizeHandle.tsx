import { useRef } from 'react';

/** Source-style top splitter with transient CSS updates during pointer movement. */
export function DockResizeHandle({ height, onCommit }: { height:number; onCommit:(height:number)=>void }) {
 const drag=useRef<{start:number;height:number;next:number}|undefined>(undefined);
 const clamp=(value:number)=>Math.max(180,Math.min(innerHeight*0.7,value));
 return <div className="dock-resize-handle" role="separator" aria-label="Resize code panel" aria-orientation="horizontal"
  aria-valuenow={height} aria-valuemin={180} aria-valuemax={Math.round(innerHeight*0.7)} tabIndex={0}
  onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();onCommit(clamp(height+(event.key==='ArrowUp'?16:-16)));}}}
  onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={start:event.clientY,height,next:height};}}
  onPointerMove={event=>{if(drag.current){drag.current.next=clamp(drag.current.height+drag.current.start-event.clientY);event.currentTarget.closest<HTMLElement>('.studio')?.style.setProperty('--code-height',drag.current.next+'px');}}}
  onPointerUp={event=>{if(drag.current){onCommit(drag.current.next);drag.current=undefined;event.currentTarget.releasePointerCapture(event.pointerId);}}}
  onPointerCancel={()=>{if(drag.current){onCommit(drag.current.next);drag.current=undefined;}}}/>;
}
