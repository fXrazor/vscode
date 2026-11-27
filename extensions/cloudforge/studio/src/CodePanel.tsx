import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch } from 'react';
import { type Action, type Resource, type Architecture } from './model.ts';
import { applyTerraformDraft, resourceSourceFile, terraformCode } from './terraformProjection.ts';
import { CodeEditor, EditorAppearance, type RevealCode } from './CodeEditor.tsx';
import { defaultEditor, type EditorPreferences } from './editor-appearance.ts';
import { Code2, FileCode2, Save } from 'lucide-react';
import type { HostFormSchema } from './liveSchema.ts';
import { buildResourceDraft, type ResourceDraft, type SchemaPreview } from './resourceDraft.ts';
import { hasTerraformExtras } from './additionalTerraform.ts';
import { catalogRevision, subscribeCatalog } from './cloudlab-core/catalog/index.ts';

type Draft = { base:string; text:string; error:string };

export function CodePanel({ resource, architecture, dispatch, hidden, compact=false, hasSource, onOpenSource, onSaveFile, liveSchema, schemaPreview, onRequestSchemaPreview, reveal }: {
 resource?:Resource; architecture:Architecture; dispatch:Dispatch<Action>; hidden:boolean; compact?:boolean;
 hasSource?: boolean; onOpenSource?: () => void; onSaveFile?: (fileName: string) => void;
 /** Live provider schema of the selected resource; enables the Rust schema check. */
 liveSchema?: HostFormSchema; schemaPreview?: SchemaPreview | null; onRequestSchemaPreview?: (resourceId: string, draft: ResourceDraft) => void;
 reveal?: RevealCode;
}) {
 const fileLabel = resource ? resourceSourceFile(resource) + (resource.sourceLine ? ':' + resource.sourceLine : '') : 'main.tf';
 const targetFileName = resource ? resourceSourceFile(resource) : 'main.tf';
 const catalogueRevision=useSyncExternalStore(subscribeCatalog,catalogRevision);
 const source=useMemo(() => terraformCode(architecture,resource?.id),[architecture,resource?.id,catalogueRevision]);
 const draftId=resource ? 'resource:' + resource.id : 'architecture';
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [review,setReview]=useState<{ draftId: string; base: string; text: string; resources: Resource[]; architecture: Architecture }>();
 const [settings,setSettings]=useState<{editor?:Partial<EditorPreferences>}>({editor:defaultEditor});
 const additional = hasTerraformExtras(resource?.terraformExtras);
 const draft=useMemo(() => resource && liveSchema && onRequestSchemaPreview && !additional ? buildResourceDraft(architecture,resource.id,liveSchema) : undefined,[architecture,resource,liveSchema,onRequestSchemaPreview,additional]);
 const lastRequest=useRef('');
 useEffect(() => {
  if (hidden || !draft || !resource || !onRequestSchemaPreview) { return; }
  const key=resource.id+'|'+JSON.stringify([draft,liveSchema?.selection]);
  if (key===lastRequest.current) { return; }
  // Debounced so typing in the form does not send one render per keystroke.
  const timer=setTimeout(() => { lastRequest.current=key; onRequestSchemaPreview(resource.id,draft); },400);
  return () => clearTimeout(timer);
 },[hidden,draft,resource,onRequestSchemaPreview,liveSchema?.selection]);
 const record=drafts[draftId];
 const text=record?.text ?? source;
 const stale=!!record && record.base !== source;
 const dirty=!!record && text !== record.base;
 function reload() { setReview(undefined); setDrafts(values=>{const next={...values};delete next[draftId];return next;}); }
 function apply() {
  if(stale) { setDrafts(values=>({...values,[draftId]:{base:record!.base,text,error:'The form changed. Reload before applying code edits.'}})); return; }
  try {
   if (!dirty) { return; }
   const resources=applyTerraformDraft(architecture,text,resource?.id,resource?{allowAdditional:true,schema:liveSchema}:undefined);
   if (resources.some(resource=>hasTerraformExtras(resource.terraformExtras)) || additional) { setReview({draftId,base:source,text,resources,architecture}); return; }
   dispatch({type:'applyResourceCode',resources});
   reload();
  } catch(error) {setDrafts(values=>({...values,[draftId]:{base:record?.base??source,text,error:error instanceof Error?error.message:'Correct the Terraform syntax.'}}));}
 }
 const actions = <div className="resource-code-actions">
   {dirty&&<><span className="shell-count">edited</span><button onClick={reload}>Discard</button><button disabled={stale} onClick={apply}>Apply</button></>}
   {hasSource && onOpenSource && <button type="button" className="quiet-button" title={'Open ' + fileLabel + ' in editor'} onClick={onOpenSource}><FileCode2 size={13} /><span>Open {targetFileName}</span></button>}
   {onSaveFile && <button type="button" className="quiet-button" disabled={dirty} title={dirty?'Apply the code draft before saving':'Save changes to ' + targetFileName + ' in project'} onClick={() => onSaveFile(targetFileName)}><Save size={13} /><span>Save {targetFileName}</span></button>}
  </div>;
 return <section className={'code-panel'+(compact?' code-panel-focused':'')} hidden={hidden} aria-label="Resource code editor">
  {!compact && actions}
  <div className="code-content">
   {compact?<div className="workspace-pane-heading"><Code2 size={17}/><div><h3>Terraform</h3><p>{fileLabel} · Linked project source</p></div></div>:<p className="resource-code-caption">{fileLabel} · {resource ? 'Selected resource' : 'Whole architecture'}</p>}
   {compact && actions}
   {compact?<details className="focused-code-help"><summary>Editing code</summary><p>Edit existing field values, then choose Apply to update the canvas draft and Save to write back to {targetFileName} in your project. Unapplied code stays in this editor when you close it. Tab indents inside the editor; press Ctrl+M first to make Tab move focus out.</p></details>:<p className="code-projection-note">Draft Terraform linked to {targetFileName}. Apply updates the canvas draft; Save writes back through Rust guarded save.</p>}
   <details className="resource-editor-appearance"><summary>Editor appearance</summary><EditorAppearance settings={settings} setSettings={setSettings}/></details>
   {review?.draftId === draftId && <section className="terraform-review" aria-label="Review resource Terraform changes"><h3>Review Terraform changes</h3><p>This updates the same resource draft. Saving still uses the existing guarded file review.</p><details><summary>Before</summary><pre>{review.base}</pre></details><details open><summary>After</summary><pre>{review.text}</pre></details><p className="field-help">Additional Terraform has not been validated by the provider. No engine or cloud operation has run.</p><div><button type="button" onClick={()=>setReview(undefined)}>Back to editing</button><button type="button" disabled={review.base!==source||review.text!==text||review.architecture!==architecture} onClick={()=>{dispatch({type:'applyResourceCode',resources:review.resources});reload();}}>Apply reviewed changes</button></div></section>}
   {!hidden && review?.draftId !== draftId && <CodeEditor value={text} label={resource ? 'Resource Terraform code' : 'Architecture Terraform code'} language="hcl" settings={settings} reveal={reveal} onApply={apply} onDiscard={reload} onChange={value=>setDrafts(values=>({...values,[draftId]:{base:record?.base??source,text:value,error:''}}))}/>}
   {additional && <p className="schema-check">Additional Terraform is preserved in this resource. Full provider validation is unavailable for this configuration; review it before the guarded save.</p>}
   {draft && <SchemaCheck preview={schemaPreview} />}
   {stale&&<p className="code-message" role="status">The form changed. <button onClick={reload}>Reload draft</button> before applying code edits.</p>}
   {record?.error&&<p className="code-message" role="alert">{record.error}</p>}
  </div>
 </section>;
}

/** Result of rendering the resource against its pinned provider schema in the Rust service. */
function SchemaCheck({ preview }: { readonly preview: SchemaPreview | null | undefined }) {
 if (preview === undefined) { return <p className="schema-check" role="status">Checking against the provider schema…</p>; }
 if (preview === null) { return <p className="schema-check">Provider schema check is not available for this resource.</p>; }
 const errors=preview.diagnostics.filter(item=>item.severity==='error');
 const warnings=preview.diagnostics.filter(item=>item.severity==='warning');
 const version=preview.providerVersion ? ' ' + preview.providerVersion : '';
 const headline=errors.length ? `${errors.length} schema ${errors.length===1?'error':'errors'}` : warnings.length ? `${warnings.length} schema ${warnings.length===1?'warning':'warnings'}` : 'Matches the provider schema';
 return <div className={'schema-check'+(errors.length?' has-errors':warnings.length?' has-warnings':' is-clean')} role="status">
  <strong>{headline}</strong><span> · checked against provider{version}</span>
  {preview.diagnostics.length>0 && <ul>{preview.diagnostics.slice(0,20).map((item,index)=><li key={index} className={item.severity}><code>{item.path||'resource'}</code> {item.message}</li>)}</ul>}
  <details><summary>Terraform rendered from the provider schema</summary><pre><code>{preview.hcl}</code></pre></details>
 </div>;
}
