import { useMemo, useState, type Dispatch } from 'react';
import { type Action, type Resource, type Architecture } from './model.ts';
import { applyTerraformDraft, terraformCode } from './terraformProjection.ts';
import { CodeEditor, EditorAppearance } from './CodeEditor.tsx';
import { defaultEditor, type EditorPreferences } from './editor-appearance.ts';
import { Code2 } from 'lucide-react';

type Draft = { base:string; text:string; error:string };

export function CodePanel({ resource, architecture, dispatch, hidden, compact=false }: {
 resource?:Resource; architecture:Architecture; dispatch:Dispatch<Action>; hidden:boolean; compact?:boolean;
}) {
 const source=useMemo(() => terraformCode(architecture,resource?.id),[architecture,resource?.id]);
 const draftId=resource ? 'resource:' + resource.id : 'architecture';
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [settings,setSettings]=useState<{editor?:Partial<EditorPreferences>}>({editor:defaultEditor});
 const record=drafts[draftId];
 const text=record?.text ?? source;
 const stale=!!record && record.base !== source;
 const dirty=!!record && text !== record.base;
 function reload() { setDrafts(values=>{const next={...values};delete next[draftId];return next;}); }
 function apply() {
  if(stale) { setDrafts(values=>({...values,[draftId]:{base:record!.base,text,error:'The form changed. Reload before applying code edits.'}})); return; }
  try {
   if (!dirty) { return; }
   const resources=applyTerraformDraft(architecture,text,resource?.id);
   dispatch({type:'applyResourceCode',resources});
   reload();
  } catch(error) {setDrafts(values=>({...values,[draftId]:{base:record?.base??source,text,error:error instanceof Error?error.message:'Correct the Terraform syntax.'}}));}
 }
 return <section className={'code-panel'+(compact?' code-panel-focused':'')} hidden={hidden} aria-label="Resource code editor">
  <div className="resource-code-actions">
   {dirty&&<><span className="shell-count">edited</span><button onClick={reload}>Discard</button><button disabled={stale} onClick={apply}>Apply</button></>}
  </div>
  <div className="code-content">
   {compact?<div className="workspace-pane-heading"><Code2 size={17}/><div><h3>Terraform</h3><p>main.tf · Code for this resource</p></div></div>:<p className="resource-code-caption">main.tf · {resource ? 'Selected resource' : 'Whole architecture'}</p>}
   {compact?<details className="focused-code-help"><summary>Editing code</summary><p>Edit existing field values, then choose Apply. Use Parameters to add blocks or change references. Unapplied code stays in this editor when you close it. Tab indents inside the editor; press Ctrl+M first to make Tab move focus out. Terraform/provider validation is not connected.</p></details>:<p className="code-projection-note">Draft Terraform projection. Provider validation is not connected. Apply supports existing fields; unsupported edits remain in the draft.</p>}
   <details className="resource-editor-appearance"><summary>Editor appearance</summary><EditorAppearance settings={settings} setSettings={setSettings}/></details>
   {!hidden && <CodeEditor value={text} label={resource ? 'Resource Terraform code' : 'Architecture Terraform code'} language="hcl" settings={settings} onApply={apply} onDiscard={reload} onChange={value=>setDrafts(values=>({...values,[draftId]:{base:record?.base??source,text:value,error:''}}))}/>}
   {stale&&<p className="code-message" role="status">The form changed. <button onClick={reload}>Reload draft</button> before applying code edits.</p>}
   {record?.error&&<p className="code-message" role="alert">{record.error}</p>}
  </div>
 </section>;
}
