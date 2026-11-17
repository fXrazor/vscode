import { useState, type Dispatch, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Code2, ListChecks, GitBranch, X } from 'lucide-react';
import { checkDraft, type Action, type Resource, type Architecture } from './model.ts';
import { providerRegions } from './fixture.ts';
import { CodeEditor, EditorAppearance } from './CodeEditor.tsx';
import { defaultEditor, type EditorPreferences } from './editor-appearance.ts';

type Dock = 'bottom' | 'left' | 'right' | 'closed';
type Draft = { base:string; text:string; error:string };

export function CodePanel({ resource, architecture, dispatch, dock, onDock, onFocus, resizeHandle }: {
 resizeHandle?:ReactNode; resource:Resource; architecture:Architecture; dispatch:Dispatch<Action>; dock:Dock; onDock:(dock:Dock)=>void; onFocus:(id:string)=>void;
}) {
 const source=JSON.stringify({name:resource.name,region:resource.region,settings:resource.settings},null,2);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [tab,setTab]=useState('code');
 const [file,setFile]=useState('resource');
 const [settings,setSettings]=useState<{editor?:Partial<EditorPreferences>}>({editor:defaultEditor});
 const record=drafts[resource.id];
 const text=record?.text ?? source;
 const stale=!!record && record.base !== source;
 const dirty=!!record && text !== record.base;
 const findings=checkDraft(architecture);
 function reload() { setDrafts(values=>{const next={...values};delete next[resource.id];return next;}); }
 function apply() {
  if(stale) { setDrafts(values=>({...values,[resource.id]:{base:record!.base,text,error:'The form changed. Reload before applying code edits.'}})); return; }
  try {
   const value=JSON.parse(text);
   if(!value || typeof value.name !== 'string' || !providerRegions[resource.provider].includes(value.region) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings) || !Object.values(value.settings).every(item=>typeof item === 'string')) { throw new Error('Provide a name, supported region and settings with text values.'); }
   dispatch({type:'update',id:resource.id,patch:{name:value.name,region:value.region,settings:value.settings}});
   reload();
  } catch(error) {setDrafts(values=>({...values,[resource.id]:{base:record?.base??source,text,error:error instanceof Error?error.message:'Correct the JSON syntax.'}}));}
 }
 return <Tabs.Root asChild value={tab} onValueChange={setTab}><section className="code-panel" hidden={dock==='closed'} aria-label="Repositionable draft code editor">
  {resizeHandle}
  <Tabs.List className="lab-tabs code-tabs" aria-label="Code panel views">
   <Tabs.Trigger value="code"><Code2 size={14}/>Draft JSON</Tabs.Trigger>
   <Tabs.Trigger value="checks"><ListChecks size={14}/>Checks{findings.length>0&&<span className="shell-count">{findings.length}</span>}</Tabs.Trigger>
   <Tabs.Trigger value="deps"><GitBranch size={14}/>Dependencies</Tabs.Trigger>
   <span className="spacer"/>
   {dirty&&<><span className="shell-count">edited</span><button onClick={reload}>Discard</button><button disabled={stale} onClick={apply}>Apply</button></>}
   <select aria-label="Code panel position" value={dock==='closed'?'bottom':dock} onChange={event=>onDock(event.target.value as Dock)}><option value="bottom">Bottom</option><option value="right">Right side</option><option value="left">Left side</option></select>
   <button aria-label="Close code panel" onClick={()=>onDock('closed')}><X size={14}/></button>
  </Tabs.List>
  <Tabs.Content value="code" className="code-content">
   <div className="files" role="group" aria-label="Draft files"><button className={'file-tab'+(file==='resource'?' on':'')} onClick={()=>setFile('resource')}>{resource.name||'resource'}.draft.json</button><button className={'file-tab'+(file==='architecture'?' on':'')} onClick={()=>setFile('architecture')}>architecture.json</button></div>
   <EditorAppearance settings={settings} setSettings={setSettings}/>
   <CodeEditor value={file==='resource'?text:JSON.stringify(architecture,null,2)} label={file==='resource'?'Resource draft JSON':'Architecture JSON'} language="json" settings={settings} readOnly={file==='architecture'} onApply={file==='resource'?apply:undefined} onDiscard={reload} onChange={value=>setDrafts(values=>({...values,[resource.id]:{base:record?.base??source,text:value,error:''}}))}/>
   {stale&&<p className="code-message" role="status">The form changed. <button onClick={reload}>Reload draft</button> before applying code edits.</p>}
   {record?.error&&<p className="code-message" role="alert">{record.error}</p>}
  </Tabs.Content>
  <Tabs.Content value="checks" className="code-report">
   <p className="faint">Local draft-name checks. Provider validation is not connected.</p>
   {findings.length?findings.map(finding=><button key={finding.resourceId} className="finding" onClick={()=>onFocus(finding.resourceId)}>{finding.message}</button>):<p>No draft-name findings.</p>}
  </Tabs.Content>
  <Tabs.Content value="deps" className="code-report">
   <table><thead><tr><th>Resource</th><th>Connects to</th><th>Relationship</th></tr></thead><tbody>{architecture.connections.map(edge=><tr key={edge.id}><td><button onClick={()=>onFocus(edge.source)}>{architecture.resources.find(item=>item.id===edge.source)?.name}</button></td><td><button onClick={()=>onFocus(edge.target)}>{architecture.resources.find(item=>item.id===edge.target)?.name}</button></td><td>Design link</td></tr>)}</tbody></table>
   {!architecture.connections.length&&<p>No design links.</p>}
  </Tabs.Content>
 </section></Tabs.Root>;
}
