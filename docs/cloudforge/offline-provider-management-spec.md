# Offline provider-package management

Status: proposed design, 26 November 2026. Dale selected this handoff and **native QuickPick management with guided steps**. That selects the workstream and navigation pattern; the detailed requirements below remain reviewable design. Integration owner: Codex. [Evidence, ownership and build handoff](offline-provider-management-handoff.md).

## Product intent

Help an infrastructure author prepare, inspect and maintain a local provider mirror without leaving the Workbench or disturbing the architecture canvas. Connect the existing import, verification, cleanup, schema extraction and offline initialization commands into one guided journey. Explain what is known about a package and what needs attention before offering an operation.

The main user is preparing a Windows architecture for disconnected work. A second user maintains Linux packages for a later CI environment. Linux packages can be stored and inspected; their presence must not imply that they can be executed locally on Windows.

## Existing behavior and problem

Stage 10, 10B and 10C already implement the service and six native commands. This is a usability and truthful-state follow-on, not a new mirror service. Today users must discover separate Command Palette commands and repeat package selection. Integrity results collapse to a notification, and cleanup loses information the service already provides.

Source review found concrete gaps: an object with missing integrity counters can produce a successful zero-issue notification; selecting a cleanup candidate immediately sends an eviction request; active leases are absent from the cleanup picker; a stale inventory is not distinguished from a verified empty mirror. The current single-package removal command already asks for confirmation, so cleanup should follow the same convention.

## Scope and success

- One discoverable **CloudForge: Manage Offline Provider Packages…** command opens a native manager. Existing command IDs continue to work. No new permanent sidebar, canvas toolbar, status item or webview is needed.
- A user can find the exact provider address, version and platform, inspect its evidence, and complete an explicit operation without re-entering a known package identity.
- Every success message derives from a validated result. Invalid or incomplete reports show an unavailable result and a retry action, never a healthy empty state.
- Opening, searching, selecting, returning and closing the manager do not change Terraform, architecture layout, Modified state or semantic Undo history. Only an explicitly chosen existing service operation may change its documented service-owned files.
- A successful release includes keyboard and installed-desktop verification against an exact desktop/service pair. Existing historical test counts do not satisfy this criterion.

## Interaction direction

Use the Workbench's real QuickPick, InputBox, native file dialog, progress notification and modal warning components. The experience should feel focused and temporary: a clear title, searchable rows, meaningful descriptions, Back on subordinate steps, Escape to exit, and focus returned to the previous editor. Reuse native themes, typography, focus indicators and high-contrast behavior.

Rows use provider addresses rather than decorative cards. Address, version and platform form the package identity. Show human-readable sizes alongside exact bytes on details/review steps. Use text to distinguish **Stored**, **Verified in this check**, **Missing archive**, **Corrupted**, **In use**, **Pinned by active architecture** and **Not checked**. A recorded SHA-256 or publisher label alone is not a publisher signature or fresh verification result.

Create QuickPick instances only for a live flow; dispose their listeners and inputs when it closes. Use the standard Back button, explicit step labels for bounded input journeys, and a busy state while fetching. Closing UI does not cancel a service operation that has already been dispatched; existing import, init and schema operations expose no cancellation contract. Do not advertise a Cancel Operation action.

## Journey and storyboard specification

This table specifies the required frames and transitions for a later component-backed canvas. It is a design specification, not a rendered or clickable canvas.

| Frame | Native surface and content | Action and next state | Alternate states |
| --- | --- | --- | --- |
| 1. Enter manager | QuickPick titled **Offline Provider Packages**. Show active architecture name or **No architecture selected**, followed by **Browse Packages**, **Import Provider Archive…**, **Verify Mirror Integrity**, **Review Cleanup…** and, when scoped, **Check Architecture Readiness**. | Choose one action. Returning from an operation reloads its affected data. | Loading shows busy state. Service unavailable offers Retry and Close; it does not display zero packages. No architecture still permits global package management. |
| 2. Browse | Searchable package rows: address; version and platform; recorded size and digest prefix. Preserve full digest in package details. | Selecting a row opens details, with Back preserving the search query and selection. | A validated empty result offers Import Archive and Back. Invalid records/report are reported as incomplete/unavailable; do not silently turn all rejected rows into an empty mirror. Oversized results are visibly incomplete and offer narrower retry only if supported; do not invent pagination. |
| 3. Package details | Identity, recorded digest, recorded timestamp, optional recorded publisher and most recent check result from this manager session. Actions: **Extract Schema…** for Windows packages, **Review Removal…**, Back. | Extract enters engine-backed review. Removal enters explicit confirmation. | Linux packages explain that local schema extraction requires windows_amd64. Changed/missing package refreshes the list. Unknown protection state requires a fresh cleanup check before removal. |
| 4. Import identity | Guided InputBox steps for address and version, then platform QuickPick. Prefill from an explicitly selected missing-readiness row; manual import uses existing supported defaults. | Next to trusted expected digest. Back preserves previously entered values. | Invalid address/version stays on its step. Escape or native-dialog cancellation produces no import. Do not claim that every allowed identifier string is a real registry release. |
| 5. Import evidence and review | Expected SHA-256 input, followed by review of address, version, platform and expected digest. Copy says **Expected archive digest** and explains that the user supplies a trusted value. | **Choose Archive and Import…** invokes the existing Electron-owned local ZIP picker and service import. | No automatic download, network lookup, signature badge or digest computed from the chosen file as its own expected value. The existing broker cannot return a selected path for a separate post-selection review; review identity/digest before the native picker. |
| 6. Import progress/result | Native progress notification, then a result step with exact identity and **Browse Packages**, **Check Readiness**, Back. Distinguish a newly stored archive from an already present result when the validated reply exposes it. | Refresh inventory and any current readiness result. No auto-init or schema execution. | Digest mismatch/unsafe ZIP/reparse or network path/limit/conflict errors use typed service failures and a corrective next action. Retrying requires a fresh explicit choice. No local file paths in error copy. |
| 7. Integrity results | Show verified, missing and corrupted counts plus total bytes, then searchable issue rows with validated key, status and bounded safe reason. Healthy result explicitly says **Verified in this check**. | Open affected package details; Refresh reruns verification. | Invalid counters, entries or inconsistent totals are an invalid/incomplete report, not zero. A timestamped prior result becomes **Not checked since change** after import/removal. No automatic deletion or repair. |
| 8. Cleanup planning | InputBox for a non-negative safe integer quota in MiB; show current architecture scope. Explain that only the active architecture's lockfile is considered, not every project/window. | **Review Cleanup Plan** calls the existing read-only planner. | Reject empty, whitespace-only, fractional, negative, exponential, non-finite and overflowing byte conversions. Zero is valid. Global planning says **Architecture pins not checked**. |
| 9. Cleanup review | Summary: used bytes, target quota, overage and projected usage after evictable candidates. Separate **Eligible for Review**, **In Use**, and **Pinned by Active Architecture** rows. Each row preserves full key/platform. | Eligible row opens removal review. Protected rows explain why and offer Back/Refresh only. | If over quota but all packages are protected, say **Quota cannot be reached with the current protections**. Zero candidates does not imply within quota. Preserve a partial plan as incomplete and block removal if protection evidence is missing. |
| 10. Removal review/result | Existing modal warning pattern. Name one exact package and platform; explain local archive removal and possible impact on later offline work. **Remove Package** is the only commit action. | Recheck the current plan/scope, ask confirmation, send one eviction request, then refresh inventory, integrity status and cleanup plan. | Escape/Back/negative confirmation sends zero eviction requests. Package disappearance, a new lease, stale source or scope change stops removal and refreshes. No batch deletion or automatic retries. |
| 11. Readiness | Name architecture, source revision, engine and requested platform set. Show lock state and ready/missing/corrupted package rows. | Missing row starts prefilled import. **Initialize Architecture Offline…** enters explicit operation review; Back returns to manager. | Absent/invalid/unreadable lockfile stays explicit. Service-reported readiness for zero dependencies must not be rewritten into an invented missing-package failure. Default Windows+Linux readiness and Windows-only local init are separate facts. |
| 12. Init and schema review | Before existing engine-backed commands, state selected package/architecture and operation. Schema extraction executes a Windows provider through a detected engine; offline init may write generated engine state in a writable architecture. | Explicit **Extract Schema** or **Initialize Offline**, followed by existing progress/report. | Missing engine, linked/imported root, unavailable schema, active scope change and service failure preserve their typed distinctions. No cloud sign-in, plan/apply, backend initialization or dependency upgrade. |

## Detailed requirements

### State and data truth

1. Keep a single service-backed inventory and separate transient presentation state. Do not place mirror packages, progress or search filters in the Architecture model/history.
2. Capture the workspace/architecture/source revision at entry to a scoped step. When that context changes while awaiting a result or review, invalidate the step and require a fresh result before any scoped operation.
3. Use strict, bounded adapters for import, eviction, integrity and cleanup results, in addition to the existing package/readiness adapters. Preserve invalid versus empty states. Validate finite safe integer sizes/counts, package identities, hashes, statuses, arrays and expected optional fields; ignore undeclared payload fields without displaying them. Decide bounds with the current service contract; if valid responses exceed UI limits, disclose incompleteness rather than falsely asserting completeness.
4. Integrity results are session observations. Invalidate them after mirror mutations. Listing metadata is not re-hashing; readiness is not schema extraction; successful schema extraction is not a successful engine init.
5. A successful eviction message uses validated `bytesReclaimed`, never a fallback to old inventory size. An invalid response after dispatch is **Removal result unavailable; refresh to confirm**, not a safe automatic retry.

### Protection and destructive actions

1. All manager removal paths use the same review and explicit confirmation, including direct legacy commands. A package selected for inspection is never removed by that selection alone.
2. Rust enforces active leases at eviction time. The planner identifies active-architecture lockfile pins; `evictMirrorPackage` itself takes only a package key and cannot enforce those pins or all-project protection. The manager excludes protected/pinned rows from eligible actions and refreshes after service rejection. It must not claim atomic pin protection or that no other architecture needs the archive.
3. Replanning before removal reduces stale decisions but does not create a transaction between planning and eviction. Cross-process atomic lockfile pin enforcement, global project usage discovery, force-removal of pinned packages and batch cleanup require separately agreed Rust contract work.
4. Quota planning is advisory. A plan does not delete files. Display projected bytes and any shortfall accurately; offer review of one candidate at a time.

### Runtime boundary

Reuse existing protocol-1 methods only. Electron main keeps owning native archive selection and paths; Rust keeps owning checksum/ZIP verification, archive storage, locking/leases, catalogue writes, workspace authorization and engine execution. The extension receives and submits bounded identities, digests and scoped handles. No `workspace.fs`, Node filesystem/process implementation, generic shell, new JSON-RPC method or service-protocol copy is required for this design.

Keep existing timeouts: import and integrity 65 seconds in the broker, offline init 125 seconds, schema extraction 245 seconds. UI progress must remain truthful for these budgets and must not retry an operation merely because its presentation closed.

### Accessibility and focus

Everything is keyboard reachable using standard Workbench input controls. Labels express status without relying on colour or icons. Search matches address, version and platform; Back preserves the query where sensible. Announce step and operation names, display actionable validation beside the current input, and restore editor focus after closing. A notification never becomes the only place to inspect corruption or cleanup protections.

## Acceptance scenarios

| Scenario | Required observation |
| --- | --- |
| Empty mirror, service healthy | Valid empty state offers import; no folders or architecture writes from opening manager. |
| Missing/malformed service report | Visible unavailable/incomplete state; no healthy-zero notification and no enabled removal. |
| Exact missing Linux package selected | Import retains address/version/linux_amd64 identity; no local Windows execution action for that archive. |
| Incorrect digest or unsafe archive | Existing Rust rejection; no success result; native path never enters extension arguments. |
| Picker cancelled at any import step | No import until the final native selection; cancellation is quiet and preserves prior mirror contents. |
| Package corrupt or archive missing | Issue row names exact identity/status, exposes safe reason and reviewable recovery; no silent repair. |
| Cleanup row selected | Details/review opens; zero eviction requests until **Remove Package** confirmation. |
| Lease acquired after review | Rust rejects removal; refresh explains In Use; zero automatic retry. |
| Active architecture pin | Row is inspection-only in manager; copy explains the scope and does not promise cross-project protection. |
| Over quota, every candidate protected | Remaining overage remains visible; no false within-quota result. |
| Quota near safe-integer boundary | Reject any MiB-to-byte conversion that is not a non-negative safe integer. |
| Source or architecture changes mid-step | Old readiness/cleanup selection is invalidated; no operation with mixed scope IDs/revisions. |
| Imported repository offline init | Existing SCOPE_DENIED remains explicit; no extension-side fallback writes. |
| Reopen manager after mutation | Inventory/readiness refreshed; old integrity observation no longer shown as current. |
| Close during progress | UI closes cleanly; existing request completion cannot reopen a disposed picker or mutate unrelated editor state. |
| Design board open in another editor | No renderer/theme/viewport/layout/Modified/Undo changes from mirror navigation. |

## Exclusions and unresolved decisions

No archive download/registry browser, provider signature validation, credential setup, new engine trust policy, shared-remote cache, automatic updates, all-project pin index, batch eviction, persistent quota setting or Studio integration is included. A trusted digest matching archive bytes does not independently authenticate a publisher.

The remaining product review is approval of these detailed journeys and the one-package removal limit. The requested Tempo PRD/canvas links cannot be produced in this session because its board, Docs, canvas and link_items tools are unavailable; plugin discovery found no Tempo connection. This document and its state table must not be described as a completed Tempo spec/canvas run. Native component storyboards still need to be built and visually reviewed in a capable session before the requested design deliverable is complete.

## Documentation reference

Current [QuickInput/QuickPick API](https://code.visualstudio.com/api/references/vscode-api#QuickInput), fetched with Context7 on 26 November 2026, supports busy/disabled states, step metadata, standard Back buttons and explicit disposal. The fork's pinned declarations and production native command patterns remain the implementation reference; see the evidence handoff for exact paths and revisions.
