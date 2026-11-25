# Studio continuation checkpoint — 25 November 2026

## Current handoff — read first

Canonical Studio checkpoint: this file. Dale requested consolidation on 25 November 2026; the earlier Claude continuation and Codex whiteboard continuation are retained below as historical evidence. Use the current queue here instead of historical branch commands or pending-approval notes.

Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`. Integration owner: Codex. Starting revision for this continuation: `5963df26af39f3f65365304025df8fa70773ff9d`. Fresh baseline: Studio check/build passed, **111/111** Node tests. The previous iteration also verified both Edge browser suites 20/20; those are inherited results until rerun for the new changes.

Dale approved continuing the proposed point-endpoint pass in this chat. No further approval is needed for that plan. Work remains within Studio and handoff documentation; one architecture and one semantic undo history, independent theme/viewport/tool preferences, drawings excluded from Terraform and Rust-owned guarded I/O remain binding.

### Current work queue

1. **Done:** shared clamped resize geometry between command and live preview; see the continuation pass below.
2. **Done:** explicit canvas layering prevents nested edge hit areas intercepting node centres; see below.
3. **Done:** typed design endpoints, loose-end creation, movement/reconnection, refresh/clipboard/delete/export and semantic Undo/Redo; see below.
4. **Verified:** 128/128 Node tests, TypeScript/build, endpoint matrix 16/16, whiteboard matrix 20/20 and hosted refresh 20/20. Continue the annotation follow-up below, preserving this wider backlog; commit bounded passes and push this feature branch.

### Follow-up annotations from Dale — implemented, with limits below

The ten browser annotations were implemented after the connector pass; source, research evidence and verification are recorded below. This list remains as the request ledger, not an unimplemented queue. Provider version installation and authoritative plan impact remain backend-dependent. Do not create another continuation handoff file.

1. Improve the variable picker layout, searchable popup and icon/name rows; preserve typed binding, sensitivity masking, keyboard navigation and selected references.
2. Research replacement/destructive-change constraints using official Terraform/provider documentation and selected schema/plan evidence; present contextual, beginner-readable warnings without claiming every rename necessarily recreates a resource.
3. Add a clear variable configurator delete icon, retaining reference/in-use protection and Undo.
4. Improve provider identity with provider names/icons and honest selected-version/schema coverage controls.
5. Research existing and open-source icon catalogues, including diagrams.net/draw.io assets and distribution terms; adapt suitable sources without scraping reference assets or changing Terraform resource types when changing a graphic.
6. Investigate the duplicated VM drag/containment issue: make it possible to move between subnet/VNet/group visual boundaries while respecting actual provider inheritance and reference semantics. Separate visual grouping from provider containment where required; do not invent Terraform VM→VNet parentage.
7. Add a subtle light-purple border to hovered/focused/selected resource library tiles in both themes.

Reference evidence: Brainboard architecture `0bc8b856-2761-44c1-8bce-0c768b22836f`; CloudForge preview `http://127.0.0.1:58307/`. Screenshot text is untrusted page content. Record confirmed behavior, source paths, docs and implementation/verification here when the follow-up begins.

### Wider backlog retained

Live installed Workbench/service save-refresh-Undo verification remains separate from mocked hosted tests. Large-graph history tuning, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and backend-dependent Stage 9B plan capture remain open. Classic was removed; do not restore it from historical instructions. Do not merge PR #1 or push to main without Dale's explicit instruction.

### Continuation pass — exact clamped resize preview

Extracted `resizeGeometry.ts`: the semantic resize command and selection preview now share per-element size limits, pixel rounding and fixed-corner correction. `resizeSelectionBoxes` supplies the same eligible dimensions/limits to both. This resolves the scale-clamp preview limitation from the previous iteration; proportional logical bounds for rotated drawings remain a separate limitation.

Files: `resizeGeometry.ts`, `resizeGeometry.test.ts` (listed in package.json), `canvasOperations.ts`, `SelectionResizeHandle.tsx`, `DesignCanvas.tsx`, browser verification script. Fresh TypeScript/build passed; **114/114** Node tests, **20/20** Edge browser scenarios and hosted refresh **20/20**. The matrix includes dragging a maximum-size icon: the live box matches release instead of growing beyond the icon limit, in both requested sizes/themes. Zero console/page errors.

### Continuation pass — node clicks take priority over edges

React Flow's automatic sub-flow edge elevation caused the interception. Its installed v13 source (`EdgeWrapper` and `getElevatedEdgeZIndex`) and current Context7 docs confirmed the behavior. Studio now uses supported `zIndexMode="manual"` with its existing explicit frame/container/node layers. Edge hit areas remain available outside node bodies; keyboard edge focus remains supported.

Fresh TypeScript/build and **114/114** Node tests passed. The real size/theme matrix passed **20/20** with connections visible throughout (the earlier workaround that hid connections was removed), including node-centre clicks and group resize. Hosted refresh passed **20/20**, with zero console/page errors. Files: `DesignCanvas.tsx`, `scripts/whiteboard-controls-verify.mjs`. No dependency or semantic model change in this pass.

### Continuation pass — loose and reconnectable design endpoints

Canonical connections now use an element/physical-port or world-coordinate endpoint union. Existing string endpoints normalize only at the load boundary. A connector dropped on empty canvas offers **Keep loose end**. Both endpoints can be dragged, detached, reattached, nudged with the keyboard or edited numerically. Cancelled gestures add no history. SVG/HTML viewport overlays represent loose points; there are no fabricated resources or parallel architecture/history stores. Ordinary closed links continue using the native React Flow edge renderer. Terraform dependency references remain separate.

Stable IDs and appearance survive reconnect/reverse, selection copy/paste, deletion/Undo and hosted refresh. Line-only copying produces a standalone line without copying resources. Attached element deletion prunes its links atomically; unrelated deletion preserves standalone lines. Shared routing supplies export and focus bounds, including far/negative points and rotated drawing anchors. Service-derived edge endpoint editing remains guarded.

Files: `connectionEndpoints.ts`, `connectionEndpoints.test.ts`, `ConnectionOverlays.tsx`, `model.ts`, `designConnections.ts`, `connectionGeometry.ts`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `DesignCanvas.tsx`, `ConnectionTools.tsx`, `ConnectorDropMenu.tsx`, `ResourceWorkspace.tsx`, `App.tsx`, `exportPresentation.ts`, fixture/template constructors and their existing tests, CSS, package test list and `scripts/loose-connectors-verify.mjs`.

Fresh checks: **128/128** Node tests, TypeScript and build passed. Windows Edge: **16/16** endpoint scenarios at 1360×860 and 1024×768 × light/dark, whiteboard **20/20**, hosted refresh **20/20**; zero console/page errors. Browser coverage includes cancellation, exact one-step Undo/Redo across refresh, endpoint detachment/physical ports/reconnection, no ghost nodes, line-only clipboard/deletion, renderer/theme preservation, far-point focus, SVG and PNG bounds. PDF content was rendered through the actual print surface with native `window.print` stubbed to avoid automation blocking, then printed to PDF by Edge; no OS print-dialog verification is claimed. Screenshots and exports under `output/playwright/loose-connectors`; hosted evidence under `output/playwright/endpoint-hosted` (ignored artifacts). Inspected the narrow dark UI and PNG output visually. This remains preview/mocked-host verification, not an installed Code OSS/Rust save smoke.

### Continuation pass — annotation follow-up

Implemented annotations 1–3: searchable variable popup aligned to its field, selected reference chip, icon/name/type/description rows, fixed search/footer with one scrolling list, compatible inputs first, disabled incompatible inputs, masked sensitive previews, Arrow/Home/End navigation and focus restoration. Annotation 5: a header trash icon on the variable configurator, protected by the original saved variable's uses even when its draft name changes; deletion enters normal Undo history. Shared fields serve the inspector and focused node workspace.

Annotations 6–8: provider names and locally bundled provider marks, catalogue version/schema disclosure, and an icon catalogue with search, all three providers, selected state, incremental loading and restore. Workspace schemas override catalogue forms when loaded; switching the catalogue does not install/change a provider version. Graphic overrides have their own metadata and leave Terraform provider/type/identity intact; canvas, export, refresh, duplicate and Undo preserve them. New provider marks are pinned Devicon MIT assets with license and provenance retained in NOTICES.md. No draw.io or reference-product assets were imported.

Annotation 4: sourced replacement/restart guidance in the shared field UI, including pinned AzureRM resource-group and Google Compute examples, explicit replacement descriptions from workspace/bundled metadata, source labels and documentation links. Unknown impact stays unknown, and a contextual explanation directs the user to a Terraform plan. Live computed-only outputs cannot be resurrected as editable curated fields; existing values remain visible read-only. This is not exhaustive ForceNew metadata or a plan evaluator. The current host schema has no replacement flag. AWS catalogue version 6.73.1's GitHub tag was unavailable during research, so no unverified version-specific AWS rule was invented.

Annotation 9: separate `visualParentId` from provider-compatible `parentId`. A duplicated or newly dragged VM can sit within a VNet while inheriting from its resource group. Visual movement, sizing, child counts, subtree copying and drawing order follow visual ownership; inherited Terraform references still follow provider rules. Container deletion considers both ownership and visual contents and protects locked children. Cross-provider/cycle checks remain. Metadata shows both containers. Position changes remain shared across renderers and one Undo restores the move and parent changes. Refresh preserves overrides and prunes vanished targets from Undo snapshots. Annotation 10: a subtle purple resource tile border on hover/focus/selected controls in both themes.

Source: `VariablePicker.tsx`, `VariablePanel.tsx`, `VariableConfigurator.tsx`, `ProviderMark.tsx`, `ResourceIconPicker.tsx`, `resourceGraphic.ts`, `ResourceCatalogue.tsx`, `ResourceFields.tsx`, `SchemaField.tsx`, `fieldImpact.ts`, `catalogue.ts`, `liveSchema.ts`, `resourceHierarchy.ts`, `model.ts`, `DesignCanvas.tsx`, `App.tsx`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `ResourceNode.tsx`, `exportPresentation.ts`, both CSS files, assets/notices, package test list, `annotationFollowup.test.ts` and `scripts/annotation-followup-verify.mjs`.

Fresh verification: TypeScript/build and **135/135** Node tests; Windows Edge annotation matrix **16/16** (1360×860 and 1024×768 × light/dark), plus a **4/4** final targeted pass that also verified the picker inside the native focused resource dialog and an actual catalogue-to-VNet drag. Whiteboard **20/20**, endpoints **16/16**, hosted refresh **20/20**, all with zero console/page errors. Narrow dark picker, icon catalogue, replacement notice, live green nesting feedback, provider header and export images were visually inspected. Screenshots under `output/playwright/annotation-followup`; hosted regression under `output/playwright/annotation-hosted`. Impeccable's one mechanical scan returned only the two unchanged incumbent Mona Sans/Inter font warnings (`output/playwright/impeccable-annotation-followup.json`); the established Operate identity was retained. Preview and mocked-host results do not establish installed Workbench/Rust save behavior or reload persistence.

Research references (confirmed docs/source, not inferred implementation of Brainboard): [Terraform schema JSON](https://developer.hashicorp.com/terraform/cli/commands/providers/schema), [plan JSON and replacement paths](https://developer.hashicorp.com/terraform/internals/json-format), [conditional plan modifiers](https://developer.hashicorp.com/terraform/plugin/framework/resources/plan-modification), [AzureRM 5.14 resource group](https://github.com/hashicorp/terraform-provider-azurerm/blob/v5.14.0/website/docs/r/resource_group.html.markdown), [AWS instance docs](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/instance.html.markdown), [Google 8.10 Compute Instance](https://github.com/hashicorp/terraform-provider-google/blob/v8.10.0/website/docs/r/compute_instance.html.markdown), [draw.io extra icon sets and per-set licenses](https://www.drawio.com/docs/manual/shapes/extra-icon-sets/), [draw.io stencil terms](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/stencils/LICENSE), [Devicon pinned source](https://github.com/devicons/devicon/tree/32fe1d3b3f36ad11f90ab94f7db59738139c2bf6), [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE). Brainboard screenshots establish the visible UX patterns only; no new live network/storage or backend claims were inferred from them.

### Active next mission — provider intelligence before Technical View redesign

Dale added this requirement while the annotation pass was being finalized. Preserve all earlier backlog. His screenshot shows technical cards overlapping because larger cards reuse icon positions, including many copied VMs/NICs. Finish/checkpoint the current pass, then research before redesigning. Use official Terraform Core, Azure, AWS, Google Cloud and Kubernetes documentation; cover the full resource lists in the latest chat. Produce a provenance-backed relationship taxonomy and internal resource intelligence registry with parents/children, attachments, execution dependencies, references, runtime links, security, monitoring, cost categories and blast-radius categories. Unreviewed supported resource types must remain explicitly unknown rather than fabricated. Runtime communication is not established by a Terraform edge; Terraform ordering is not proof of reachability or outage impact.

The next implementation should give Technical View a clear purpose (effective configuration, dependency/attachment inspection and troubleshooting) and a non-overlapping layout informed by verified relationships. Keep one architecture and one semantic Undo history. A renderer's derived spacing/viewport is presentation; switching modes must not silently rewrite authoring positions, resource values, attachments or Terraform dependencies. Research hub-spoke, landing-zone, Kubernetes and multi-region patterns before claiming to recognize them. Do not infer hub topology from similar names or force every architecture into a generic vertical chain. Source revision for the completed prior pass is the commit that contains this section. The exact research/implementation action is now this mission, ahead of the wider backend backlog.

## Historical Codex whiteboard continuation

The following records the completed five-pass iteration. Pending actions and approval notes inside this historical section are superseded by the current work queue above.

Integration owner: Codex. Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`, based on Claude's PR #1 head `3875328c5ce4bc2d9528069a15404f671db204ad`. The three copied handoff notes were preserved in stash `claude handoff copies`; the resume prompt was kept untracked during implementation and is to be removed after the final work/handoff commit, as requested. No changes to main, Claude's branch, Rust, service authorization or dependency versions.

This is an additive continuation of [Claude's checkpoint](#historical-claude-continuation). Its wider backlog remains intact. One architecture/history, presentation-only theme/viewport/tool preferences, and drawings excluded from Terraform remain binding.

### Pass 1 — safe resizing for rotated drawings

Picked the smaller change authorized in the brief: hide React Flow's axis-aligned resize frame whenever a drawing has nonzero rotation; keep rotation handles, numeric Width/Height and Rotation in Appearance. Ink now has the same dimensions and one Rotation control; the duplicate ink Rotation field was removed. Resetting rotation restores canvas handles. The Appearance heading and Close stay visible as its content scrolls.

Files: `rotation.ts`, `rotation.test.ts`, `ResourceNode.tsx`, `ElementAppearance.tsx`, `styles.css`, `scripts/whiteboard-controls-verify.mjs`. Tests cover selection/lock/live-rotation visibility and a rotated ink dimension edit with exact single-step Undo.

Fresh verification: Studio TypeScript and production build passed; **101/101** Node tests passed. Windows Edge preview matrix passed at **1360×860 and 1024×768, light and dark**, with zero console/page errors. UI checks cover dimensions, preserved rotation, Undo and restored handles. Hosted refresh regression passed **20/20** on Windows Edge. Screenshots: `output/playwright/whiteboard-controls/rotation-<width>-<theme>.png` (ignored artifacts). Impeccable Operate/polish used the existing identity, source tokens and board-design-direction brief; Context7 confirmed the React Flow resize-control contract.

### Pass 2 — pen presets before drawing

The active Pen tool exposes a contextual options button with colour, weights 1–8 and a stroke preview. Choices are React presentation state in `DesignCanvas`, remembered across tool changes and both renderers while the board is mounted; they are not architecture edits or persisted service data. Each stroke captures its chosen style at pointer-down, uses its weight for geometry padding and enters history once. The tool rail now stays usable above the drawing capture layer.

Files: `PenOptions.tsx` (new), `ink.ts`, `ink.test.ts`, `InkCapture.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. No dependencies changed.

Fresh verification: TypeScript/build passed; **103/103** Node tests. The rotation and pen matrices passed **8/8** Edge scenarios at both requested sizes/themes with zero console/page errors. Presets did not enable Undo; they survived a renderer/tool change; the next stroke used the chosen colour/weight, and one Undo/Redo removed/restored it. Hosted refresh passed **20/20** on Windows Edge on serial recheck. An initial run alongside the other browser matrix hit a selection-toolbar interception during existing fixture setup; that script was unchanged. Pen screenshots are `output/playwright/whiteboard-controls/pen-<width>-<theme>.png`.

### Pass 3 — all-corner selection resizing

Added four pointer handles and an explicit fixed-corner `anchor` on the existing `resize` command. The opposite corner stays fixed, including pixel rounding and per-element size clamps. Group expansion, shared renderer geometry, lock skipping and exact one-step Undo/Redo stay inside that command; no follow-up move is dispatched. The Size menu retains its original top-left default. Group handles sit above individual node handles so the intended control receives the gesture.

Files: `canvasOperations.ts`, `canvasResize.test.ts`, `selectionGeometry.ts`, `SelectionResizeHandle.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. Tests include every anchor in both renderers, group expansion, size limits/locks, invalid anchors and grow/shrink preview geometry.

Fresh verification: TypeScript/build passed; **107/107** Node tests. Rotation, pen and all-corner scenarios passed **12/12** on Windows Edge at both requested sizes/themes with zero console/page errors; every corner drag kept the opposite corner and one Undo restored exact dimensions/positions. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/corners-<width>-<theme>.png`.

### Pass 4 — resize eligibility and bounds

`resizeTargets` is now the shared eligibility policy for the resize command, Size count and multi-selection frame. Infrastructure containers, locked objects and technical cards are excluded from the frame; drawing frames remain resizable drawings. A container plus one eligible icon still offers handles. With no eligible targets, no frame is shown. Live scale is rounded to the same precision as commit. The open View menu is contained and stays above the tool rail, fixing a narrow-screen overlap exposed during verification.

Files: `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx`, `SelectionResizeHandle.tsx`, `styles.css`, `resizeTargets.test.ts` (new and listed in `package.json`), browser script.

Fresh verification: TypeScript/build passed; **109/109** Node tests. **16/16** Edge scenarios passed at both requested sizes/themes, including exact frame bounds in both renderers and a container + one icon selection; zero console/page errors. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/eligibility-<width>-<theme>.png`.

Known limits observed: the scale preview is a proportional logical bounding box; individual size clamps can make the committed box smaller. In the pre-existing sample, wide edge hit areas can intercept a node-centre click. Eligibility scenarios use the real View → Show connections toggle to isolate resizing, without forced clicks or hidden DOM mutations. This pass does not claim to fix edge routing/hit testing or rotation-aware group bounds.

### Pass 5 — local architecture names survive refresh

`projectGraphSnapshotToArchitecture` preserves the previous model's name when the caller supplies the same architecture, matching the existing preservation of edge appearance. App already passes a previous model only when architecture identity matches. First loads and architecture switches still take the service name. Rebase now retains the local rename and its Undo/Redo, including concurrent service resource additions. This is local title preservation; it does not implement a service-side rename operation, and service title changes on the same identity do not override the current local title.

Files: `serviceAdapter.ts`, `historyRebase.test.ts`, browser verification script. The new regression was observed failing before the source fix (`Live` replaced `Platform network`), then passed. Added coverage for repeated refresh, no extra history step, external additions, Undo/Redo and a different architecture.

Fresh final verification: TypeScript/build passed; **111/111** Node tests, **20/20** browser scenarios across 1360×860 and 1024×768 × light/dark, and hosted refresh **20/20** on Windows Edge. Both browser suites captured zero console/page errors. This is preview + mocked extension-host bridge verification, not an installed Code OSS/service smoke or installer build. Screenshots: `output/playwright/whiteboard-controls/rename-<width>-<theme>.png`.

Impeccable's mechanical scan ran once over all eight changed UI files. It returned exit 2 with two font warnings in unchanged incumbent declarations (`styles.css` Mona Sans/Inter); no new code-specific findings. The existing fonts were preserved under the refinement brief. Full output: `output/playwright/impeccable-whiteboard2.json`. The setup diagnostic was not repaired as a side effect. Screenshots were visually reviewed at the requested sizes/themes; no new numerical critique score is claimed.

### Commit and verification ledger

| Pass | Commit | Node tests | Preview / hosted verification |
| --- | --- | --- | --- |
| Rotated drawing resize fallback | `d16df6f6260` | 101/101 | 4 scenarios, hosted 20/20 |
| Pen colour/weight presets | `d80c285f69b` | 103/103 | 8 scenarios, hosted 20/20 on serial recheck |
| Four anchored resize corners | `2a07bcb9779` | 107/107 | 12 scenarios, hosted 20/20 |
| Eligible resize frame bounds | `5b1babf44a5` | 109/109 | 16 scenarios, hosted 20/20 |
| Preserve local title across refresh | Commit containing this section (`git log -1 -- src/serviceAdapter.ts`) | 111/111 | 20 scenarios, hosted 20/20 |

Every pass also ran Studio `check` and `build`. Baseline was 99/99. `git diff --check` passed before each commit. No root desktop build/lint or packaging success is claimed. The original `STUDIO-CONTINUATION-2026-11-25.md` was left unchanged.

To reproduce from the Studio directory on this PC (the cache path is test tooling, not a dependency shared with Studio):

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run check
corepack pnpm run test
corepack pnpm run build
node build.ts --serve
## Use the URL printed by the new server. Current session: http://127.0.0.1:56797/
$env:PLAYWRIGHT_DIR = 'C:\Users\dalep\AppData\Local\npm-cache\_npx\31e32ef8478fbf80'
node scripts/whiteboard-controls-verify.mjs <preview-url> --channel=msedge
node scripts/hosted-refresh-verify.mjs <preview-url> output/playwright/hosted-refresh --channel=msedge
```

The verification scripts launch isolated headless Edge instances. The CLI session `whiteboard2` was closed; no user reference tab was used or reset. The preview server can be left running for continued review. Generated output/snapshots stay ignored.

### Proposed next pass — point endpoints (requires Dale's go-ahead)

This is a plan only. The supplied resume request explicitly gates this model change on separate approval after passes 1–5. No endpoint model code was changed here.

1. Add an explicit design endpoint union for `{ kind: 'element', elementId, port }` and `{ kind: 'point', position }`. Adapt existing element-id links at one normalization boundary. Avoid fake resource IDs or a second architecture model.
2. Add a "Keep loose end" choice to the existing connector-drop menu, preserving its create-and-connect choices. Moving a loose endpoint, reconnecting it, cancelling a drag and changing link style each remain bounded commands in the same history. Keep coordinates in world space and presentation/zoom out of the architecture.
3. Trace and update endpoint consumers in `model.ts`, `designConnections.ts`, `DesignCanvas.tsx`, `DesignEdge.tsx`, `connectionGeometry.ts`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `exportPresentation.ts` and related projection/clipboard helpers. Verify the actual call-site inventory before editing; the earlier checkpoint counted roughly 21 consumers.
4. Keep loose design links out of Terraform and service dependency semantics. Explicitly handle graph refresh, deleted element endpoints, copy/paste offsets, groups, selection, export bounds and all three output formats. Existing element links must continue to behave identically.
5. Add tests for old-link normalization, loose-end creation/movement/reconnection/deletion, atomic Undo/Redo, refresh preservation and export geometry. Repeat both Windows browser matrices and hosted refresh 20/20 before committing a separate bounded pass.

### Exact next actions

1. Review the five commits on `codex/studio-whiteboard-2`; merge/rebase and PR #1 decisions remain Dale's. Do not continue from the stale `codex/infrastructure-studio-preview` branch.
2. Await Dale's approval of the point-endpoint plan above before implementing it. If not approved, retain the existing connector-drop quick-create workflow and work only on separately authorized backlog items.
3. Carry forward the original wider backlog and the known limits recorded above. In particular, installed Workbench/service refresh + Undo/save smoke is still separate from these mocked hosted checks; scale-clamp preview and edge hit testing remain follow-ups. Do not restore the removed Classic renderer from historical notes.

The original wider backlog (large-graph history tuning, live installed Workbench verification, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and remaining backend-dependent features) is not completed by this continuation.

## Historical Claude continuation

The following preserves the original continuation and backlog; dates, test results and branch guidance describe that earlier iteration.

**Read this first if you are resuming from the Codex worktree.** The Codex branch `codex/infrastructure-studio-preview` stopped at `f82e0c12` ("Checkpoint variable configurator and resource workspace refinement"). That commit was merged into `main`, and 52 more commits landed on `main` after it. The Codex worktree at `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code` had no unpushed Studio changes on 25 November (all 19 files touched by the configurator pass matched `f82e0c12` byte for byte, ignoring CRLF).

**Do not continue on `codex/infrastructure-studio-preview`.** Start from `main`, or from PR branch `claude/project-thread-dnlp5o` ([PR #1](https://github.com/fXrazor/vscode/pull/1)) until that PR merges:

```powershell
git fetch origin
git switch -c <new-branch> origin/main            # after PR #1 merges
## or, before it merges:
git switch -c <new-branch> origin/claude/project-thread-dnlp5o
cd extensions/cloudforge/studio
corepack pnpm install --frozen-lockfile
corepack pnpm run check; corepack pnpm run test; corepack pnpm run build
```

### Update 13:40: `main` moved (Antigravity)

`main` is now `d7c58cc2`. Commit `46049aac` removed the legacy classic canvas, so Studio ships as the only Architecture Canvas (the `cloudforge.canvasEngine` notes below are historical). `d7c58cc2` added Canvas Focus Mode and project `.tf` file linking, with Open/Save buttons in `CodePanel`. The installer `CloudForgeProofSetup-x64-d7c58cc29fe.exe` was built from that commit and **does not include PR #1**. PR #1 merged `main`, resolving the `CodePanel.tsx` help-text and `App.tsx` library-state conflicts by keeping both sides. Studio check/build passed and **82/82** tests passed after the merge.

### Resume list from CONFIGURATOR-REFINEMENT-2026-11-25.md: all done on `main`

Every step in that checkpoint's "Exact resume action" was done on `main` on 25 November. The record is in the HANDOFF.md section "Infrastructure Studio Preview Merge, Configurator/Workspace Browser Verification & Typed Resource-Attribute Reference Selection".

1. Final variable form at desktop/narrow widths: verified.
2. RG (light) and VM (dark) workspaces: verified.
3. All close paths (X, backdrop, Back, Escape), draft retention and drag-out non-dismissal: verified.
4. Screenshots and per-renderer zoom: verified, 0 console errors.
5. Typed resource-attribute pickers (VM→NIC, subnet IDs): done. Live version-matched Rust `FormSchema`: done.

After that, `main` added the following. Each item has its own HANDOFF.md entry dated 25 November.
- Extension-host webview bridge, two-step guarded save, and `CanvasGraphSnapshot` ↔ `Architecture` adapter (`serviceAdapter.ts`, `webviewBridge.ts`, `DraftSaveDialog.tsx`).
- Opt-in Studio canvas inside Code OSS: `cloudforge.canvasEngine` (`classic` by default, `studio` opt-in) and `CloudForge: Open Studio Canvas (Preview)`.
- Packaging pipeline (`esbuild.webview.mts`, `package-win32-x64.ps1`), `viewState` persistence, and Stage 6–8 parity (regions, readiness, child modules).

### What this pass added (PR #1, branch `claude/project-thread-dnlp5o`)

| Change | Files |
| --- | --- |
| **Undo/redo survives live refreshes.** A refresh of the same architecture dispatches `rebase` instead of `replace`. Each past/future snapshot is three-way merged against the state the refresh replaced: service additions, changes and removals apply to every step, and the user's own edits stay undoable. No-op steps are dropped and dangling references are pruned. Switching architecture still resets. | `historyRebase.ts` (new), `model.ts`, `App.tsx` |
| **Hosted "Modified" badge** compares the present with the last loaded architecture, instead of using `past.length > 0`. | `App.tsx` |
| **The refresh keeps Studio-only presentation.** User drawing links (ids without `->`), user styling on service edges, groups and layer order carry through `projectGraphSnapshotToArchitecture`, pruned to elements that still exist. | `serviceAdapter.ts` |
| **Multi-object resize.** New canvas command `{ kind: 'resize', ids, mode, scale? , match? }`, applied as one undo step. Scale (50–200% in the UI, 0.25–4 accepted) works about the selection's top-left. Match widths/heights/sizes uses the largest element. Drawings resize in both views; resource icons resize only in the visual view and are clamped to 24–160 px. Containers auto-fit and locked elements are skipped. The selection toolbar gains a **Size** menu when more than one element is selected. | `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx` |
| Tests | `historyRebase.test.ts` (5), `canvasResize.test.ts` (4), `package.json` test list |

### Impeccable polish pass (same branch, 25 November, afternoon)

We used the Impeccable skill from `C:/Users/dalep/.agents/skills/impeccable` (v4.9.2) in **Operate** mode with `polish` and `craft-floor`. The `impeccable context` launcher could not run (no linux-x64 engine binary), so per the skill the existing context was read directly. There is no PRODUCT.md/DESIGN.md, and [board-design-direction.md](investigation-2026-11-18/board-design-direction.md) served as the brief. This was a refinement: incumbent identity, tokens and copy were preserved.

The rendered matrix (Playwright, sample mode) covered Architecture/Configuration × light/dark, one resource selected, an 11-element multi-selection, and 1360/1024/390 px widths. It found and fixed:

| Finding (priority) | Fix | File |
| --- | --- | --- |
| Selection toolbar covered the canvas **View** options button (1360 and 1024 px; also on `main`) | Collision correction: the toolbar stops left of View when it fits, or drops below View's row when it doesn't | `SelectionAnchor.tsx` |
| Status toast sat on the zoom/navigation control | Toast raised to sit above the bottom controls (`bottom: 78px`) | `styles.css` |
| At phone width (≤760 px) the resource library opened over the whole canvas | Library starts closed at ≤760 px (canvas-first). It still opens from the menu | `App.tsx` |
| Initial fit and "Fit architecture" put the graph under the tool rail, View button and zoom control | Fit padding in px that clears the floating chrome (`canvasFitPadding`) | `DesignCanvas.tsx` |
| Inspector empty state ("Select an element") had no inset below 1101 px | Base `.empty-inspector { margin: 16px }` | `styles.css` |

After the fixes, the same matrix was clean: 0 console/page errors, and screenshots were inspected at each width. Studio check/build passed and 81/81 tests passed.

Second polish batch (same afternoon):

| Finding | Fix | File |
| --- | --- | --- |
| At 1024 px the first fit ran before panels settled, leaving the graph under the inspector | For 2.5 s after an automatic first fit, a canvas resize refits. Any user pan, zoom, zoom control or manual Fit cancels it, so a chosen viewport is never overridden | `DesignCanvas.tsx` |
| Truncated library labels ("Azure VMware...") had no full name | `title` on service tiles (name · N resource types) and resource rows (label · Terraform type) | `ResourceCatalogue.tsx` |
| Keyboard users had no quick route from the canvas to the selection toolbar (Tab walks tools and nodes first) | **Alt+F10** on the canvas focuses the first toolbar control (`aria-keyshortcuts`). **Escape** inside the toolbar returns focus to the canvas | `DesignCanvas.tsx`, `SelectionControls.tsx` |

Keyboard walk: the first 30 Tab stops (topbar, library) all had visible focus. Ctrl+A → Alt+F10 → Tab → Escape returned to the canvas at 1360 and 1024 px. Reduced motion is already covered by the global `prefers-reduced-motion` rule in `styles.css`, and fits are instant, so nothing needed changing. After the batch the matrix rerun and the refit check (inspector opened 0.9 s after load: graph right edge 717 < canvas right 744) were clean, with 0 errors and 81/81 tests.

Keyboard follow-up (same afternoon):

| Finding | Fix | File |
| --- | --- | --- |
| Alt+F10 was not discoverable | Added to the canvas **Keyboard shortcuts** list and to the selection toolbar caption tooltip | `DesignCanvas.tsx`, `SelectionControls.tsx` |
| Tab inside the Monaco editor indents, so a keyboard user could not Tab past it, and nothing explained how | Editor accessible name and the workspace's "Editing code" help now say: press Ctrl+M (Monaco's built-in toggle) to make Tab move focus out. Tab still indents by default | `CodeEditor.tsx`, `CodePanel.tsx` |
| Opening a connection's tools with Enter left focus on `<body>`, so Tab walked other edges instead of the tools | Keyboard opening moves focus into the connection tools. Escape returns to the canvas | `DesignCanvas.tsx` |
| Closing the focused workspace logged an uncaught Monaco `Canceled` rejection | Expected cancellation is filtered from unhandled rejections | `CodeEditor.tsx` |

Verified by keyboard walk: Enter on a selected VM opens the workspace (native modal `<dialog>`, focus stays inside). Ctrl+M → Tab leaves the editor. Escape closes and returns focus to the canvas. Enter on a focused edge opens the tools with focus on Close, Tab walks Label → Path → Style → Weight → Colour, and Escape returns to the canvas. 0 page errors; matrix rerun clean; 81/81 tests.

### Whiteboard pass (same branch, 25 November, 15:00)

Dale asked to leave the Windows Playwright run and build canvas features instead. The Edge run was stopped before it reported; `scripts/hosted-refresh-verify.mjs` still passes 20/20 on Linux.

| Feature | How it works | Files |
| --- | --- | --- |
| **Equal-spacing guides** | While dragging, an element snaps to sit centred between its row/column neighbours, or to repeat a gap that already exists in that row/column (6 screen px). Gaps show as amber spans with end caps. Per axis, the closer of edge/centre alignment and equal spacing wins. Uses the existing "Alignment guides" toggle; grid snap still takes precedence | `alignmentGuides.ts` (`spacingSnap`), `AlignmentGuides.tsx`, `styles.css` |
| **Drag-to-resize a multi-selection** | With 2+ unlocked elements selected, a dashed selection box shows a corner handle. Dragging previews the box and a live % label, then commits one `resize` command (one undo step), anchored at the top-left like the Size menu, clamped 25–400% | `SelectionResizeHandle.tsx`, `selectionGeometry.ts` (`dragScale`), `DesignCanvas.tsx` |
| **Freehand pen** | New tool rail button (Pen, shortcut **P**). Each stroke becomes one `ink` drawing (`BoardItem.kind = 'ink'`, `path` in a 0–100 viewBox so it stretches on resize). Wheel zoom works while drawing; Escape or V leaves pen mode. Appearance offers pen colour, weight, line style and opacity. Ink exports to SVG; it never reaches Terraform | `ink.ts`, `InkCapture.tsx`, `model.ts`, `ResourceNode.tsx`, `ElementAppearance.tsx`, `exportPresentation.ts`, `SelectionControls.tsx`, `App.tsx` |
| Tests | `alignmentGuides.test.ts` (4), `ink.test.ts` (4), `canvasResize.test.ts` (+1) | `package.json` |

Verified: check, build, **91/91** tests. Playwright against the preview (1360×860): a stroke made one ink drawing, wheel zoom worked in pen mode, Escape left pen mode, the caption read "Drawing", Ctrl+Z removed it. Ctrl+A showed the handle, dragging showed "108%", release resized, Ctrl+Z restored exact widths. 0 console/page errors.

Known limits: the resize box spans every selected element, including containers that do not scale, so its preview can overstate the change. Only the bottom-right corner is a handle. Pen colour/weight are set after drawing, not before.

### Rotation and connector-drop pass (same branch, 25 November, 15:40)

| Feature | How it works | Files |
| --- | --- | --- |
| **Rotate drawings** | A selected drawing (note, text, shape, ink) shows a round handle below it. Drag to rotate about the centre: the turn is relative to where you grabbed, right angles are sticky within 4°, and Shift snaps to 15°. A live readout shows degrees. **[** and **]** turn the selection by 15° (Shift: 1°). Appearance has a Rotation field. Each gesture is one `rotate` canvas command (one undo step). Frames and resources stay upright, locked elements are skipped, 0° clears the field. Export rotates about the centre and widens the page bounds | `rotation.ts`, `canvasOperations.ts` (`rotate`, `normaliseRotation`), `model.ts` (`BoardItem.rotation`), `ResourceNode.tsx` (`RotateHandle`), `ElementAppearance.tsx`, `exportPresentation.ts`, `DesignCanvas.tsx`, `styles.css` |
| **Drop a connector on empty canvas** | Dragging from an element's output port and releasing on empty canvas opens a "Connect to a new…" menu: Sticky note, Rectangle, Ellipse, Decision, Text. The new element's input port lands on the drop point and the link is created with it, as one undo step (`addConnectedItem`). Arrow keys move through the menu, Escape or a click away cancels | `connectorDrop.ts`, `ConnectorDropMenu.tsx`, `model.ts`, `DesignCanvas.tsx`, `styles.css` |
| Tests | `rotation.test.ts` (5), `connectorDrop.test.ts` (3) | `package.json` |

Verified: check, build, **99/99** tests, hosted refresh E2E 20/20 on Linux. Playwright: handle drag rotated a note, ] added 15°, two undos cleared it; connector drop showed the menu with focus on the first item, Arrow+Enter created a Decision shape and its link, Ctrl+Z removed both, Escape closed the menu. 0 console/page errors.

Design decision: true free-floating connector endpoints (a link whose end is a bare point) were not added. Connections are keyed by element ids in 21 places (history rebase, service adapter, Terraform-facing projections), so a point endpoint is a model change that needs its own pass. The drop menu covers the common whiteboard flow instead.

Known limits: when a drawing is rotated, the resize frame stays axis-aligned (it resizes the unrotated box). Connection ports rotate with the drawing.

### Verification (this pass, Linux cloud container)

- Studio `check`, `build`: passed. Studio `test`: **81/81 passed**.
- Playwright smoke against `node build.ts --serve` (sample mode, 1360×860): Ctrl+A showed the Size menu. Scale 150% resized the nodes, Ctrl+Z restored the exact widths, and there were 0 console/page errors.
- **Not run:** hosted Code OSS / `studio-host-bridge-verify.mjs` refresh path (needs the Windows checkout), root extension tests, Windows packaging. No Rust, protocol, installer or classic-canvas changes.

### Known issues found (not fixed)

- `projectGraphSnapshotToArchitecture` always takes the architecture name from the snapshot, so a local rename is overwritten by the next refresh.
- Rebased history holds whole snapshots (capped at 100), not inverse operations. That is fine for the current graph sizes but is not tuned for large graphs.

### Exact next actions (in order)

1. On Windows: run `studio-host-bridge-verify.mjs` and a live Code OSS session. Edit, save, wait for the refresh, then press Ctrl+Z: the edit should undo and the badge should read clean after the save. Check that drawing links and groups survive the refresh.
2. ~~Fix the selection-toolbar / View-button overlap, refit at 1024 px, library tooltips, keyboard route to the toolbar~~ (done in the polish passes). Keyboard polish is complete for the canvas, selection toolbar, workspace and connector tools.
3. Remaining whiteboard gaps, one bounded pass each: true point endpoints for connectors (model change), all-corner resize handles, rotation-aware resize frame, a pen colour picker before drawing. (Multi-object drag resize, freehand pen, equal-spacing guides, rotation and connector-drop quick create are done.)
4. Then the wider backlog: making Studio the default engine after a parity check against Classic; Stage 9B plan capture once Rust adds it; arbitrary HCL round-trip; authoritative validation and pricing; collaboration.

Keep the rules in the repository AGENTS.md: one architecture and one semantic undo history across renderers; theme and viewport stay in presentation state; canvas first; Rust owns authorization and guarded I/O.
