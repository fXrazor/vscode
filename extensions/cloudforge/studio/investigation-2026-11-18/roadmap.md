# Implementation roadmap and continuation

Priorities follow data correctness and workflow impact. This is a recommendation, not an extension of the currently approved service protocol. Future work belongs to the Code OSS desktop repository and Rust service repository through their named integration owner; the legacy Tauri React shell is not the shipped desktop.

## Delivery slices

| Slice | Priority / dependencies | Concrete change and owners | Acceptance before calling it complete |
| --- | --- | --- | --- |
| R0 Evidence and baseline | High; first | Desktop owner reconnects reference tabs and preview; records serving revision where possible, finishes bounded missing interactions. No commercial backend guessed. | Panel widths/reflow/scroll container, settings route and safe Add blocks/reference navigation recorded; snapshot/current-source distinction explicit. |
| R1 Domain and selection contract | Critical; before semantic feature growth | Integration owner reviews canonical resource/value/block/reference/module/settings and source-map needs. Desktop adds one adapter and SelectionModel; Rust owner reviews richer authority separately. | No duplicate Architecture/Project store; mode/theme/panel switching preserves graph and drafts; opaque IDs/revisions remain validated; existing read-only sanitization stays intact. |
| R2 Contextual board authoring | High; can begin UI-only after R1's identity/layout decisions | Desktop: LibraryPanel navigation, ShapeRegistry, capability-based selection toolbar, complete selection/moveMany/resize/cancel, drawing-connector style model. Apply Impeccable brief. | Add/search/close restores focus; keyboard resize; shape/text style and line labels/routing/markers undo atomically; drawing lines do not alter Terraform refs; multi-select ancestor handling tested. Rendered visual review in both themes/modes. |
| R3 Typed schema forms | Critical; R1 + reviewed schema/edit authority | Rust/domain owner supplies exact recursive descriptors; desktop Field/BlockList shared by sidebar/focused workspace, typed ref/expression picker and path diagnostics. | Distinguish omitted/null/false/zero/unknown/computed/sensitive; nested cardinality/list/set/map semantics; schema identity mismatch and stale edits visible. Changes reflect both renderers and one undo history. |
| R4 Hierarchy and modules | Critical; R1/R3 | Domain: parent/module scope, canPlace/inheritance/reparent rules; desktop red/green/unknown feedback and reasons. Resolve modules only under reviewed scope. | Cycles/cross-provider/unknown schema handled; world geometry preserved; references repaired atomically; actual module scope not inferred from visual frame. Import errors do not leave partial graph. |
| R5 Native source workflow | Critical; read-only bridge can precede R3/R4 | Desktop mounts supported webview and reuses fresh `_cloudforge.openSource`; Rust maintains source projection. Later reviewed parse/apply writes preserve unknown HCL. | Resource→source range with fresh revision; source→selection without loops; stale/dirty/context mismatch handled. Native editor docking remains independent; no raw Webview file/process API. Lossless/explicitly unsupported parser fixtures before write claims. |
| R6 Scoped architecture settings | Critical; R1 + reviewed persistence | Runtime/provider requirements, catalogue/schema/lock identities, file manifest and effective environment overrides. Backend intent and Git destination are separate workflows. | Reload preserves authored choices; generated versions/files correspond; filter-only provider changes do not alter requirements. No init/state migration on dropdown change. Credential values excluded from ordinary graph/UI logs. |
| R7 Durable review / collaboration | Medium; stable IDs and service design | Annotation anchor/thread model, orphaning, permissions, revision conflicts; presence separate. Research first, transport selection second. | Two-client edit/reply/resolve/reconnect fixtures; no dropped/duplicate messages; source-ID reconciliation; comments excluded from Terraform. No CRDT/OT claim without implemented behavior. |
| R8 Export, scale and product integration | High for release; all relevant scene types | Scene export fidelity, lazy registries, narrow subscriptions and profiling; desktop/service pinned packaging under existing product process. | SVG/PNG/PDF include new shapes/labels/clipping/fonts; interaction profiles on agreed real-sized graphs; keyboard/a11y states; installed product smoke, matching protocol/service revision and provenance. |

Do not estimate completion dates from the visible screenshots. R2 is a useful visual increment, but it cannot be described as full infrastructure editing until R3–R6 are connected. Existing Rust parsing/workspace authority and native editor investments should be reused throughout.

## Component-to-file starting map

All preview paths below are beneath `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio`.

| Work item | Existing seam | Source reference / fixture |
| --- | --- | --- |
| Typed model/commands and multi-selection | `src/model.ts`, `src/App.tsx`, `src/DesignCanvas.tsx` | CloudLab `lib/model.ts`, `Designer.tsx` gesture transactions; [source map](source-archaeology.md) |
| Quick panels and shape registry | `src/ResourceCatalogue.tsx`, `src/ResourceNode.tsx` | MI-04–07 drawer/context behavior; [design brief](board-design-direction.md) |
| Drawing connectors | `src/model.ts`, `src/DesignCanvas.tsx` custom edge seam | MI-01–02 + CloudLab `Canvas.connect` and `lines` separation |
| Shared recursive forms | `src/ResourceFields.tsx`, `src/ResourceWorkspace.tsx`, catalogue importer | CloudLab `Fields.tsx`, catalogue types and exact schema identity |
| Hierarchy policy | Frame membership projection → explicit adapter | CloudLab `canPlace`, `applyInheritance`, `reparent`; unknown-schema behavior |
| Real code navigation | `src/CodePanel.tsx` becomes optional preview aid; extension bridge | `extensions/cloudforge/src/extension.ts:450`, canonical protocol source ranges |
| Layout refinement | `src/App.tsx`, `src/PaneResizeHandle.tsx`, `src/cloudlab-layout.css` | Measured source proportions; user wide/narrow reference screenshots |
| Review annotations | New scoped adapter/layer, no existing thread entity | [Annotation report](annotations.md); do not repurpose AI chat blindly |

## Remaining investigation

**First session after reconnect:** use the same existing reference tabs. Observe, do not change production infrastructure or share/post data.

1. Brainboard left/right resize at fixed viewport: default/min/max, handle/hit area, tile count, header/body scrolling, collapse/reopen/focus. Restore widths.
2. Architecture settings: General/State management, environment inheritance, provider/runtime versions, file inclusion and backend/PR disabled states. Do not save, initialize or migrate.
3. Existing resource card→form→back; Add blocks options/dismiss; reference chip navigation; code file switch and selected SVG edge attributes. Record source-range behavior without exporting raw sample credentials.
4. Miro close/back panel behavior, ordinary versus embedded diagram selection, keyboard/context menus and internal history. Use a disposable fixture before further editing; the previous resize was only approximately restored.
5. Restart preview and verify the prior checkpoint's outstanding form click, pane keyboard resize, draft retention, mode/theme and code-context scenarios. Then compare CloudLab localhost separately; establish bundle/source identity before calling source behavior deployed behavior.
6. Supported sanitized network capture for a disposable save/reload and two-client review scenario; storage/cache inventory only through supported tooling. Keep unresolved questions explicit if unavailable.

## Verification plan by risk

- Documentation now: check local links/line bounds, source hashes, all ten deliverables and 27 annotations, whitespace and changed-file scope. No Code OSS build is required for documentation.
- UI increment: rendered scenario matrix from design brief; keyboard/focus tests; domain tests for meaningful transformations, not mirror tests for CSS.
- Domain editing: hierarchy/ref integrity, typed-value serialization, stale revisions, undo grouping, unsupported HCL preservation, module scope and sensitive/computed behavior.
- Integration: canonical protocol fixtures, authorization/source freshness and native dirty-buffer behavior; cross-repository revisions and handoff updated.
- Release: actual installed product checks and export/performance/accessibility evidence. Prior preview builds do not establish installed behavior.

## Handoff status

Investigation documents only; no product, reference, Rust or protocol source changed. Source at start: `b8c281808ac28f17942b498c7d513cd94df1ed49`, branch `codex/infrastructure-studio-preview`. Existing implementation remains saved at `e780e4d3b7a`.

The browser connection failed during continued exploration. Settings/network/storage/collaboration unknowns are enumerated rather than silently filled from assumptions. No external message, comment, deployment, plan, state migration, paid action or main push occurred.

Exact next action: finish R0's panel-resize/settings observations after browser reconnect, then review R1's typed graph/schema/source contract before implementing R2–R6. The latest request adds Impeccable to board design; its Operate brief is captured in [board-design-direction](board-design-direction.md).
