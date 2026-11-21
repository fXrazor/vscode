# CloudLab Forge source archaeology — 2026-11-18

## Scope and confidence

Read-only examination of Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web. No database, account record, environment-secret file or service API was read; no source/runtime state changed. Confirmed below means confirmed in this source snapshot, not proof of the deployed browser build or backend.

Every source citation below is relative to the exact source root stated above and names a one-based line. Runtime observations must be correlated independently.

## Source-to-feature map

| Owner | Confirmed source behaviour | Source citation |
| --- | --- | --- |
| Canonical document | Project owns tool/toolVersion/providerVersions, environment, provider regions, ArchNode[], visual edges and revision. Value recursively supports scalars, arrays/maps, Ref and Expr. | lib/model.ts:14, lib/model.ts:88 |
| Designer state | React present state, past/future refs, selection, viewport, panels; DesignerApi passes commit/preview/begin/select to children. | components/forge/Designer.tsx:49, :65 |
| Gesture history | commit appends at most 100 snapshots, clears redo, increments revision. begin captures the starting document; preview updates the document without recording every pointer frame. | components/forge/Designer.tsx:92 |
| Autosave | Actual edits synchronously checkpoint recovery, acknowledged saves debounce 400ms; generated Terraform snapshot runs separately after 4s when databaseConnected. beforeunload warns on pending/error state. | components/forge/Designer.tsx:129 |
| Saved versions | Explicit labelled Project snapshots are separate from undo and editor drafts, capped at 30. | lib/storage.ts:13, :243 |
| Renderer | Custom React DOM renderer: translated/scaled HTML world, recursively rendered HTML nodes and an SVG lines layer. The inspected Canvas implementation is not React Flow/Konva/Fabric/Excalidraw. | components/forge/Canvas.tsx:506, :541 |
| Pointer/viewport state | Drag ref discriminates move/pan/marquee/connect/resize. Viewport is x/y/z; pointer capture and world conversion implement gestures. | components/forge/Canvas.tsx:30, :177, :223 |
| Selection | Shift toggles IDs; marquee selects wholly enclosed items and avoids simultaneous ancestor/child selection. Selection includes nodes, line and attribute. | components/forge/Designer.tsx:43; components/forge/Canvas.tsx:190, :262 |
| Shortcuts | Undo/redo, copy/paste/duplicate, save version, select all, delete, Escape and zoom ignore active editable inputs. | components/forge/Designer.tsx:217 |
| Resize/cancel | Node resize handles call resizeNode; pointer previews from starting Project, keyboard commits steps. Pointer cancellation restores the start document. | components/forge/Canvas.tsx:401, :515 |
| Placement | canPlace rejects self/descendant cycles and cross-provider/invalid known-resource nesting; permits visual groups/modules and may select an ancestor/swap containers. It explicitly permits placement when a definition is missing (line 404), so it is not complete validation for unknown schemas. | lib/model.ts:381 |
| Reparenting | reparent preserves absolute position as parent-relative coordinates, reapplies inheritance, then fits containers. | lib/model.ts:490 |
| Red/green drop affordances | Move computes target and calls canPlace; render receives drop-ok/drop-bad. This is domain-driven validation, not decoration. | components/forge/Canvas.tsx:252, :449 |
| Inherited properties | applyInheritance selects matching provider ancestors, writes typed refs with inherited=true, and removes orphaned inherited refs. | lib/model.ts:430 |
| Edges | lines derives typed-reference relationships, explicit depends_on and visual-only Project.edges. Hidden refs can remain in Terraform while their drawn lines disappear. | lib/model.ts:543, :611 |
| Config model | ArchNode stores config, optional fields, file, alias, lifecycle/count/for_each/depends_on, outputs, module inputs and hidden refs. | lib/model.ts:39 |
| Terraform round trip | generate reads Project; importTerraform reconstructs editable Project without executing Terraform. Provider constraints read Project.providerVersions. | lib/terraform.ts:199, :206, :486 |
| File set | versions/providers/main or node-selected files, variables, tfvars, environment tfvars, locals, backend, outputs, ignore/readme and architecture/dependencies JSON. | lib/terraform.ts:226, :266, :288, :307, :314, :326, :355, :359 |
| Editor drafts | EditorDraftStore caches scoped file strings and sessionStorage under forge.code-drafts.v1; useCodeDrafts applies account scope. They are separate from generated files and committed Project. | app/editor-draft-store.ts:4; app/use-code-drafts.ts:22 |
| Service persistence | initializeStorage discovers hosted/explicitly configured local service; imports browser keys once, otherwise GETs store. Writes serialize entry/deletion batches; browser-only fallback is localStorage. | lib/storage.ts:70, :107 |
| Account browser boundary | Account prefix scopes browser recovery/data/drafts. Cookie credentials accompany service requests; 401 emits forge:session-expired. | app/account-storage.ts:3; lib/local-service.ts:39 |
| Backend | startService chooses SQLite or Supabase; normal SQLite accounts get separate files; legacy store path exists. Optional Redis cache keys include account/database version. Writes acknowledge committed database snapshot, not cache success. | server/server.mjs:33, :110 |
| SQLite | Schema 2 has projects/folders, designs/architectures, design revisions and generic settings store; WAL, foreign keys, transactions and validateBatch. | server/database.mjs:17 |
| Supabase | Server-only service-role RPC to forge_backend with explicit owner payloads/account operations and error sanitization. SQL-side deployment enforcement was not audited. | server/supabase.mjs:14 |
| Extensions/integrations | Agent Studio threads/messages, knowledge and proposals through service APIs. MCP offers read/propose-scoped tools, catalogue lookup, generated files and proposed ops queued for owner review. Not evidence of arbitrary UI plugins. | server/api.mjs:54; server/mcp.mjs:30 |

## Annotation/collaboration boundaries

The source NodeKind union is resource/data/icon/module/shape/text. ArchNode has label, colour, bounds and parent. The inspected canonical model has no explicit sticky-note, anchored comment, threaded board discussion, annotation-author/resolution, cursor/presence or comment ACL entity.

Canvas supplies DOM node elements, resize handles, marquee/connection overlays and SVG hit paths. Shapes/text save in Project and its recovery snapshots. These are visual annotations, not a confirmed multi-user annotation system.

A bounded search of apps/web/app, components, lib and server (excluding JSON/CSS assets) for annotation/comment/sticky/collab/presence/WebSocket/BroadcastChannel/indexedDB found no live board-comment/canvas-collaboration transport implementation. Source comments, editor theme tokens, HCL comments and MCP tool annotations do not count as canvas annotations. This is a scoped negative search, not proof of absence from other packages, deployment services or branches.

Agent Studio /api/agent/threads is an AI task discussion model, not an observed node/edge-anchored comment system. Do not reuse it as board comments without anchor, ACL, author, revision, resolution and synchronization contracts.

- Confirmed source: shapes/text persist as part of Project.
- Strongly likely: a new visual annotation layer can reuse the world/parent coordinates and transactional gesture machinery.
- Possible recommendation: model Annotation separately with id, anchor node/edge/world point, body, authorId, threadId, revision and resolvedAt. Keep ephemeral cursors/presence outside architecture undo.
- Unknown: deployed IndexedDB, realtime/websocket connections, collaborative persistence, conflict policy, comment permissions and true multi-user synchronization.

## Source-declared API inventory

| Route | Contract intention | Owner |
| --- | --- | --- |
| GET /api/health | Identity/release/schema/backend/cache status; more details gated by user | server/server.mjs:92 |
| GET /api/auth/session; POST login/register/logout | Cookie session lifecycle | server/server.mjs:93 |
| GET /api/store | Account entry snapshot; Redis-assisted read with data-token recheck | server/server.mjs:114 |
| PUT /api/store; POST /api/store/import | Validated entries/deleted batch, transactional write, acknowledged snapshot | server/server.mjs:121 |
| /api/account/* | Profile/session/access-token management; no operations exercised | server/api.mjs:22 |
| /api/agent/threads and /:id/messages, /message, /delete | AI task threads/message append/update; Supabase-dependent capability | server/api.mjs:54 |
| /api/knowledge, /search, /vision | Documents, retrieval and model status; distinct from annotations | server/api.mjs:88 |
| /api/proposals; /api/designs | Reviewable architecture changes and design/project inventory | server/api.mjs:123 |
| /api/ai/status; POST /api/ai/chat | Ollama or local Codex/Claude subprocess integrations | server/server.mjs:131; server/integrations.mjs:10 |
| /mcp | Read/propose-scoped integrations, generated Terraform/catalogue lookup, reviewable proposals | server/server.mjs:84; server/mcp.mjs:30 |

serviceRequest uses cookie credentials, bounded timeout and JSON errors. Local service configuration only permits literal-loopback HTTP addresses; discoverService does not automatically contact arbitrary nearby services (lib/local-service.ts:10, :55).

No websocket frames, response bodies or live browser storage values were captured by this assignment. Source handlers and negative searches do not establish absence of external WebSockets. Parent investigator should keep runtime API/storage claims Unknown until observed.

## Backend investments to preserve

1. Preserve typed Value/Ref/Expr, Terraform writer/importer, file allocation, parent rules and inherited references through an explicit adapter.
2. Preserve account namespacing, acknowledged saves, recovery copies and independent unapplied editor drafts; a visual reducer alone does not replace these.
3. Keep SQLite/Supabase/Redis/MCP/AI layers distinct. In the new Code OSS product, workspace/file/process authority stays with the canonical Rust protocol.
4. Do not maintain independently editable CloudLab Project and preview Architecture copies. Route UI commands to one canonical domain model and derive render projections.
5. Establish serving bundle/source identity and live backend mode before calling any backend the deployed source of truth.

## Architectural caveats for adaptation

- canPlace returns permissive success when either resource definition is unavailable (lib/model.ts:404). A new canonical placement service must define its Unknown outcome explicitly; source guards are not proof that every absent schema is allowed by Terraform/cloud APIs.
- The inspected browser write payload is entries/deleted, not an expected-document-revision compare-and-swap (lib/storage.ts:107; server/server.mjs:121). The cache revision token prevents stale cache reads, but does not by itself establish concurrent-editor conflict handling. Treat multi-user conflict resolution as Unknown, not as implemented because Supabase/Redis are present.
- During a move, begin captures history once and preview applies pointer changes; finishMove revalidates/reparents/fits through preview rather than another commit (components/forge/Canvas.tsx:286). Preserve that gesture grouping when adapting to React Flow.
- Canvas.connect creates a typed config reference immediately for a unique valid option, offers a chooser for multiple ref paths, or creates a drawing-only edge if no reference option exists (components/forge/Canvas.tsx:312). This event flow is important to preserve; visual connector creation is not always a Terraform dependency.

## Unknowns

Exact serving commit/bundle match, live backend mode, network/storage mechanisms, event listeners and user sessions were not observed. Full auth/RLS/SQL enforcement, infrastructure/provider execution and code outside these selected paths were not audited. No commercial Miro/Brainboard source was available. Runtime synchronization mechanisms remain Unknown.

Source files were read only. No tests, app/provider/CLI processes, cloud operations or database inspections were performed.

## Source identities

- lib/model.ts SHA-256: b80b711e038831a5163619cf95b82a4865adc9c06285e6fb79ec96af0ff83667
- components/forge/Designer.tsx SHA-256: cc7bc5e380a92d1199963b276dbcd012a3b7244d64cbc4339a305cf4a185fd6c
- components/forge/Canvas.tsx SHA-256: b775a516e3afc48cce2f979eb6175b1dd8c76386400de0930f3d67ee51db3c5a
- lib/storage.ts SHA-256: 019e3c127bf4d7bb5f588eb6653b8acac21fc2d62e76dd888661d015e4036a7f
- server/server.mjs SHA-256: 242dc89326c3b0f0406d788103ad4a8a98b8c1032aeddd1c5233c54cc93a889a
