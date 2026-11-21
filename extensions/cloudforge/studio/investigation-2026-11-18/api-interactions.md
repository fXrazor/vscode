# API interaction and integration report

## Live network observations

Capture scope: bounded Network events from the already open Brainboard/Miro tabs through their scoped CDP capabilities. Request metadata was reduced to method and URL without query; WebSocket payloads were reduced to direction and length. Headers, cookies, response bodies and frame contents were neither printed nor retained. These are manual observation notes, not a replayable packet/HAR artifact.

| Target / action | Confirmed metadata | Interpretation and limit |
| --- | --- | --- |
| Brainboard Shapes drawer | Fetch to PostHog `us.i.posthog.com/s/` and a Sentry envelope host | Telemetry requests during the window. No application API identified in this bounded action; a cached drawer or another transport is possible. |
| Miro connector edit/undo and adjacent observation | WebSocket sent/received events, sampled frame lengths 4–356 bytes | A bidirectional socket was active. Socket creation preceded enabling capture, so endpoint was not obtained. No operation/schema/content or causal mapping of each frame to an edit was established. |
| Miro organization background fetches | `GET miro.com/api/v1/organizations/<organizationId>/notifications/state`; `GET svc.eu01.miro.com/api/brand-center/v1/organizations/<organizationId>/themes` | Read requests observed. Path names suggest notifications/themes, but no response schema, persistence or error handling was inspected. |
| Storage inspection | `DOMStorage.enable` rejected as unsupported by the scoped capability | LocalStorage, sessionStorage and IndexedDB remain Unknown. No inference from an empty or missing result. |
| Reference backend / project settings | No supported save/plan/state/PR capture | Unknown. User screenshots establish controls, not wire contracts or side effects. |

Do not label Miro's traffic CRDT, OT, event sourcing, comment sync or resource mutation without decoded, scoped evidence. Do not infer collaboration from polling or analytics alone. Service workers, caches, IndexedDB databases and storage expiry were not inventoried.

## Source-declared CloudLab APIs

The [source archaeology API table](source-archaeology.md#source-declared-api-inventory) cites route owners and line numbers. These are **Confirmed source**, not exercised live contracts:

| Boundary | Source responsibilities | What adaptation should preserve |
| --- | --- | --- |
| `lib/local-service.ts` | Discovery, literal-loopback local URL restriction, cookie credentials, timeouts, session-expired signal | Scope/identity and explicit failures; do not transplant local discovery into a Webview path API. |
| `GET /api/store` | Account entry snapshot, backend/cache data token checks | Distinguish cached view from authoritative acknowledged state. |
| `PUT /api/store`, `POST /api/store/import` | Validated entry/deletion batch and transactional database acknowledgement | Save acknowledgement, validation, bounded batches and recovery; expected-document-revision conflict handling still needs proof. |
| `server/database.mjs` | SQLite projects/folders/designs/revisions/settings, WAL and transactions | Existing domain concepts and migration/recovery fixtures. No database read occurred in this investigation. |
| `server/supabase.mjs` | Server-only RPC/account payloads, sanitized errors | Server-held credentials and ownership boundaries. Deployment SQL/RLS was not audited. |
| `/api/agent/threads`, knowledge, proposals | AI task conversations/retrieval/proposed edits | Keep AI proposals distinct from persisted graph edits and board comments. |
| `/mcp` | Read/propose tools, catalogue and generated-file access | Extension seam for reviewed proposals, not a browser UI plugin or an unrestricted process API. |

CloudLab browser fallback uses namespaced localStorage and scoped editor sessionStorage. These facts come from [storage.ts:70](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/storage.ts:70>) and [editor-draft-store.ts:4](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/app/editor-draft-store.ts:4>); they are not storage observations of Brainboard/Miro or the running localhost app. Redis is optional source infrastructure, not proof it was active.

## Current CloudForge service authority

The canonical [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:1) is the source of truth. Stage 1 supports authorized read-only graph projection and source locations; Stage 2 adds project/repository operations. Historical handshake-only notes do not invalidate those later approved slices.

Production transport is supervised Electron-main ↔ Rust stdio JSON-RPC with bounded frames and context. It is not CloudLab's HTTP store API. Workspace grants and guarded file/process operations remain in Rust; native broker supplies paths. Webviews receive neither path-taking nor arbitrary process operations.

At [protocol line 29](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:29), graph results carry compact IDs, safe fields, typed edge kinds and validated relative source locations; raw resource literals/module URLs are excluded. At [line 48](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:48), schema import, filesystem writes, command execution and plans remain outside the contract. The richer configuration roadmap therefore needs explicit contract design. This report does not extend those methods.

Existing [extension.ts:450](C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/src/extension.ts:450) forwards a tree resource selection to trusted `_cloudforge.openSource` with workspace/architecture/source revision/node ID. A canvas should reuse that route after a fresh graph read. It should not accept a filename or line number from an untrusted drawing payload.

## Proposed future integration contracts

**Possible / proposed:** these are domain responsibilities for review, not endpoint names to implement against the current service.

| User action | Request intent | Required result / error model | Existing capability versus gap |
| --- | --- | --- | --- |
| Open architecture | Existing native picker/project selection + context | Sanitized snapshot, source revision, diagnostics | Existing protocol; reuse. Preview mounting still pending. |
| Reveal source | Context + current node ID/revision | Native file/range reveal or stale/context/dirty-buffer refusal | Existing trusted command. Exact preview bridge missing. |
| Read schema | Provider address, exact package/schema identity, allowed fields | Recursive descriptor, provenance/coverage, unsupported-schema error | Not in current protocol. No implicit provider installation. |
| Edit property/block/reference | Expected revision, operation ID, typed command | Updated revision, changed IDs, path diagnostics or conflict | New editing authority needed; no direct legacy `/api/store` copy. |
| Move/reparent | IDs, target scope and layout, expected revision | Placement/inheritance validation and atomic result | View-only movement can remain preview-local; semantic reparent requires domain ownership. |
| Resolve module | Authorized module reference, pinned identity | Inputs/outputs/provider requirements and diagnostics | New bounded resolution contract; raw remote URLs/credentials cannot bypass host authority. |
| View/generate code | Architecture/source revision and file identity | Files/source ranges with proven freshness; preserve dirty text | Read-only mapping first; generate/apply writes need reviewed scope and fidelity. |
| Set provider/runtime/files | Typed settings intent, scope and expected revision | Effective/inherited configuration + compatibility diagnostics | New persistent settings contract; distinct from palette filtering. |
| Set backend intent | Non-secret draft config + credential reference | Reviewable file/config diff | Separate from init/reconfigure/migration. Actual execution remains a separate operation. |
| Validate / estimate cost | Revision + provider/schema/region; approved execution mode if relevant | Result revision, provenance, unavailable/stale states | Preview has no real execution/pricing service. No fabricated successes. |
| Add/reply/resolve review | Scoped thread/anchor/message intent + expected revision | Authorized durable acknowledgement and conflict behavior | New annotation contract; existing AI task thread API insufficient. |
| Presence | Authorized room/session + bounded ephemeral cursor/selection | Expiry and reconnect semantics | Unknown/unimplemented; choose transport after evidence. |

## Investigation needed before production decisions

- Observe a disposable save/reload workflow and determine authoritative document revision versus cache token and recovery checkpoint.
- Capture bounded state changes with a supported browser/CDP endpoint; record request timing and sanitized schemas. Preserve socket endpoint and frame type only when actually observed.
- Exercise two-client stale edits and reconnect; establish last-write-wins/CAS/merge behavior rather than assuming it from database choice.
- Test reference chips, missing schema, computed/sensitive values and module resolution failures. A visible dropdown is not proof of provider compatibility checking.
- Do not replay authenticated mutations, post comments, run plans or migrate state merely to inventory an endpoint. Use an agreed disposable test workflow for those later proofs.
