# CloudForge Code OSS handoff

## Rust spec gap work — branch `claude/project-thread-ksv8z9` — 25 November 2026

Claude is working through the gaps between the Rust repo's `design.md` and what is built, in both repos on branch `claude/project-thread-ksv8z9` (not merged). The gap list, recommended order and verification table are in the Rust repo's [HANDOFF.md, "Spec gap review and Stage 10A"](https://github.com/fXrazor/CloudForge/blob/claude/project-thread-ksv8z9/HANDOFF.md).

First slice here: **New Architecture** and **Use Template** now ask the Rust service (`createArchitecture`) to write `architectures/<name>/`, instead of the extension writing it with `workspace.fs`. Touched: `src/vs/code/electron-main/cloudForgeService{,Channel}.ts` (+ test), `src/vs/workbench/electron-browser/cloudForgeService.contribution.ts`, `extensions/cloudforge/src/project/{controller,service}.ts`. Moving project-root `.tf` files into a new architecture is still extension-side. Not yet run: `cloudForgeServiceChannel.test.ts`, extension `tsc`/tests (run in `Z:\CloudForge-Code`). This branch avoids `studio/src` whiteboard files that Codex is changing on `codex/studio-whiteboard-2`.

Second slice: **Projects gallery** (`CloudForge: Browse Project Architectures`, also a button in the Projects view title). `extensions/cloudforge/src/project/{gallery,galleryHtml,galleryPanel}.ts` show one card per architecture with search, sort (name, last edited, most resources), New Architecture, Templates and Refresh. Card counts, providers and last-edited come from the Rust `summarizeArchitectures` method (broker-allowlisted, `workspaceId` only); the extension reads no files. Previews are a block sketch drawn from counts until saved canvas thumbnails exist. Tests: `node --experimental-strip-types --test test/projectGallery.test.ts` 4/4 pass in the container; a headless Chromium render of the Webview document confirmed search, open and text-only names. Still needs a Windows run with the rest of the branch.

Third slice: **clickable diagnostics** (Rust design.md "Clickable warnings and errors"). `studio/src/diagnostics.ts` adds `targets`, `sourceRevision` and `location` to `Diagnostic` plus `isStaleDiagnostic`; overlapping networks now point at both networks and their address-range fields. `projectHostDiagnostics` stamps each host finding with the revision it ran against and gives CLI findings their `filename`/`line`. `IssuesPanel` renders each finding as an `IssueEntry`: the card fits all targets on the canvas and opens the first field (`App.tsx` `revealIssue`), with extra buttons to jump to each target, **Open main.tf:12** for CLI findings, and a **Stale** tag with **Run checks again** when the source revision moved on or the target was deleted. Source lines open through a new webview message `openSourceLocation` → `canvasPanel` → `_cloudforge.openSourceLocation` (workbench), which re-reads the architecture at the finding's revision (so stale findings get `STALE_SOURCE`, shown as a notice) and only accepts a single `.tf`/`.tf.json` name inside the verified root; `_cloudforge.openSource` now shares `resolveArchitectureSource`. Studio `pnpm check` + 99/99 tests, extension `tsc -p` + 67/67 tests pass in the container. Not run: the workbench contribution (needs the full Code OSS build) and a live click-through.

Fourth slice: **imported-schema palette and form coverage**. On canvas ready (and after **Import Provider Schema**) the extension lists the newest imported snapshot per provider with `listCatalogueTypes` and posts `catalogueTypes`; Studio `catalogue.ts` (`registerServiceTypes`, `serviceOnlyEntries`) adds types the bundled catalogue lacks to the palette with a generic icon, labelled "Imported schema <version>" (`ResourceCatalogue.tsx` via `useSyncExternalStore`). `loadResourceSchema` also calls the Rust `getCatalogueCoverage` (Stage 10C, broker-allowlisted) and attaches `coverage` to the live form; `ResourceFields.tsx` shows "Full visual coverage · N schema paths" or a disclosure listing the paths that need HCL. Studio check + 100/100, extension tsc + 68/68 pass in the container.

Fifth slice: **focused, source-preserving canvas saves** (Dale chose "Focused patches in Rust"). The Studio save dialog still sends the canvas-generated file, but `extension.ts` `onPreviewDraftSave` now calls the Rust `previewFocusedSave` first. The service folds the draft into the file on disk (only changed values and blocks are rewritten; comments, fields the canvas does not show, `dynamic`/`lifecycle` blocks, BOM and CRLF are kept) and returns a `merge` summary; apply sends only the token (`applyFocusedSave`), so the merged text never crosses the bridge. If the file on disk does not parse (or an older broker/service rejects the method) it falls back to `previewDraftSave`. `DraftSaveDialog.tsx` shows the summary via `studio/src/draftSaveMerge.ts` (`describeMerge`). Broker allowlist + test, workbench scoping, `serviceAdapters.ts` `parseDraftSavePreview` (`merge`) updated. Studio tsc + 101/101, extension tsc + 68/68 pass in the container. Design: Rust `docs/superpowers/specs/2026-11-25-service-focused-save-design.md`.

Sixth slice: **canvas deletions and the Rust provider-schema check**. Saves now send `removeAddresses` (`serviceAdapter.ts` `removedSourceAddresses`): blocks in the target file that the host graph has but the canvas deleted, plus the old address of resources renamed on the canvas (that old block's comments are lost; a `moved` block is not written yet). The Code tab (`CodePanel.tsx`, not the focused workspace copy) now builds a Rust `ResourceDraft` (`studio/src/resourceDraft.ts` `buildResourceDraft`: literals stay literals, references and `var.` bindings become expressions) once the live schema is loaded, posts `renderResourceDraft` (debounced 400 ms) → `canvasPanel` → `extension.ts` `onRenderResourceDraft` (newest matching snapshot) → Rust `renderResourceDraft`, and shows "N schema errors · checked against provider X" with the paths, plus the Rust-rendered HCL in a disclosure. Studio tsc + 103/103, extension tsc + 70/70 pass in the container. Not run: broker tests, live click-through.

## Studio continuation — read first — 25 November 2026

**15:00 update:** branch `claude/project-thread-dnlp5o` (PR #1) now also has equal-spacing guides, a drag handle to resize a multi-selection, and a freehand pen (`ink` drawings). **15:40:** rotation for drawings and a quick-create menu when a connector is dropped on empty canvas (99/99 tests). Details and file list: "Whiteboard pass" and "Rotation and connector-drop pass" in [STUDIO-CONTINUATION-2026-11-25.md](extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md). 91/91 tests.

Resuming Codex: **do not continue on `codex/infrastructure-studio-preview`**. Its last commit, `f82e0c12`, is merged into `main`, and `main` has 52 later Studio/desktop commits. On 25 November the Codex worktree `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code` had no unpushed Studio changes. Every step in the "Exact resume action" list of [CONFIGURATOR-REFINEMENT-2026-11-25.md](extensions/cloudforge/studio/CONFIGURATOR-REFINEMENT-2026-11-25.md) was completed on `main`.

Latest work is on branch `claude/project-thread-dnlp5o` ([PR #1](https://github.com/fXrazor/vscode/pull/1)), based on `main` `156a0fdc`. It adds undo/redo that survives live refreshes, keeps drawing links, groups and layer order through a refresh, and adds menu-driven multi-object resize (scale/match sizes). It also includes two Impeccable (Operate/polish) batches. The first fixed the toolbar/View overlap, the toast covering zoom, the phone-width library covering the canvas, the fit landing under the chrome, and the inspector inset. The second added a refit when panels settle, tooltips on library labels, and Alt+F10/Escape between the canvas and the selection toolbar. A keyboard follow-up made Alt+F10 visible in help, explained Ctrl+M for leaving the code editor, moved focus into the connection tools when they're opened by keyboard, and stopped a Monaco console error on close. Studio check/build passed and 81/81 tests passed. The hosted Code OSS refresh path is not yet verified on Windows. Scope: `extensions/cloudforge/studio` and this file only.

Since then, `main` moved to `d7c58cc2`: the classic canvas was removed, Studio is now the only Architecture Canvas, and Canvas Focus Mode plus multi-file `.tf` linking were added (Antigravity; installer `CloudForgeProofSetup-x64-d7c58cc29fe.exe`). That installer does **not** include PR #1. PR #1 has `main` merged in (one CodePanel/App conflict resolved, keeping both sides), and Studio check/build passed with 82/82 tests. Next: after Antigravity's packaged smoke finishes, test PR #1 on Windows (hosted refresh → undo, Modified badge, drawing links/groups through refresh).

Full status, branch commands, verification, known issues and the exact ordered next actions: [STUDIO-CONTINUATION-2026-11-25.md](extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md).

## Configurator refinement — paused for handoff 25 November 2026

User requested an immediate checkpoint and push. Same worktree and branch `codex/infrastructure-studio-preview`, starting at `e90aec47a5f50ca7dbca01799979012cfbf4068c`; integration owner Codex. Refined the variable configurator's spacing, typed controls, examples, default/override explanation, sensitivity and effective-value preview; improved resource workspace hierarchy and context; added the requested top-right X and guarded backdrop dismissal while retaining Back/Escape and mounted drafts. Scope stays within `extensions/cloudforge/studio` plus this handoff.

Fresh TypeScript, 60/60 tests and preview production build passed. An isolated REA Chrome scenario exercised the first variable-form version, captured zero console errors and confirmed owned-process cleanup. Final footer/scroll corrections and the resource-workspace close/draft-retention paths still require browser verification. The user's embedded browser connection remained closed; their open draft/reference pages were not reset. No service, protocol, dependencies, main merge or product packaging changes.

Resume from [CONFIGURATOR-REFINEMENT-2026-11-25.md](extensions/cloudforge/studio/CONFIGURATOR-REFINEMENT-2026-11-25.md), beginning with the explicitly listed final UI/close-path checks. A dated addendum is appended to [the existing checkpoint](extensions/cloudforge/studio/NESTING-AND-FEEDBACK-PASS.md); its original content and remaining-work list are preserved in full. All prior open items remain open.

## Canvas nesting and shared rendering — 25 November 2026

Resumed the saved controls/node-details batch and implemented the user's new annotations in the existing isolated worktree `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`, branch `codex/infrastructure-studio-preview`, starting revision `ccf110495e1209a3a3715a7ed038f5534507d887`. Integration owner: Codex. The checkpoint commit containing this entry is identified by `git log -1 -- HANDOFF.md`. Implementation ownership is `extensions/cloudforge/studio/src`, its README/checkpoints and artifact ignore rule; the remaining root change is this handoff.

Added schema-backed resource containment with inherited typed Terraform references, valid/invalid placement feedback, native container handles and subtree operations; synchronized positions between renderers; separated dotted inherited dependencies from design links; active panel indicators; actionable local findings/help; and editable flowchart stencils/starters. Completed the earlier object-anchored controls, native icon resize, shared variable binding, focused HCL/parameters/context workspace and alignment guide batch. Forms stay right; code is contextual with no bottom dock. Details, evidence classifications, feature/file map, verification and limitations: [NESTING-AND-FEEDBACK-PASS.md](extensions/cloudforge/studio/NESTING-AND-FEEDBACK-PASS.md).

Fresh verification: TypeScript, 58/58 tests, preview production build and eight unchanged copied-core SHA-256 hashes passed. Browser verified shared movement/Undo, green/red placement/rejection without history, 48→96px icon resize/Undo, right-inspector single scrolling area, scoped Monaco Apply/Undo with inheritance, theme preservation, atomic flowchart insertion/Undo, responsive canvas at actual CSS 320/390/768/1025px with panels collapsed, and SVG/PNG export (PNG visually inspected). Console check captured zero page errors. Root lint remains unavailable due its previously missing `minimatch`; no root lint/desktop build success is claimed. No Rust, protocol, installer, reference-checkout or dependency changes; no main merge. The preview server is `http://127.0.0.1:58307/` while its process remains running. Reload resets the in-memory sample.

Exact next action: the browser connection closed after the recorded checks. Recheck the last inline-container/help styling changes and explicit per-renderer zoom restoration when control returns; the final TypeScript/tests/build passed. Then implement typed sibling resource-attribute pickers in the shared field component, beginning with VM→NIC IDs, followed by complete version-matched schemas through the approved service boundary. These and persistence, authoritative validation/pricing, arbitrary HCL round-trip, collaboration and packaged Workbench integration remain open. The paused entries below are historical; their pending verification/commit instructions are superseded by this checkpoint.

## Node details and canvas controls — paused again 24 November 2026

User explicitly requested another pause. All changes are saved locally and remain **uncommitted/unpushed** on `codex/infrastructure-studio-preview`, starting at `ccf110495e1`, in `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Current checkpoint: [NODE-DETAILS-CHECKPOINT.md](extensions/cloudforge/studio/NODE-DETAILS-CHECKPOINT.md). This includes the earlier element-controls batch plus native icon resize, object-anchored controls, scoped Terraform/shared form/context composition, typed variable bindings, fixed inspector chrome with one scrolling content area, alignment guides and independent renderer viewport stores. Fresh TypeScript passed after the final viewport fix; 48 tests passed before the final presentation-only changes. Final build, final browser sweep, whitespace review and commit/push remain pending. Root lint cannot start without its missing dependency; the copied generator also has a pre-existing strict unused-parameter finding. The preview server remains at `http://127.0.0.1:52646/`; the user's preview tab was preserved and the disposable QA tab closed. No main merge, Rust/protocol change or installed-product packaging occurred. Resume from the new checkpoint; do not restart the research or discard the saved diff.

## Element controls — paused 24 November 2026

User requested a pause until usage returns. Uncommitted work is saved in the existing `codex/infrastructure-studio-preview` worktree, starting at `ccf110495e1`. The broad controls pass adds common contextual actions, multi-selection, visual groups, alignment/distribution, layers, locks, drawing typography/direct editing, internal copy/paste, export parity and connector label/direction controls. Fresh preview TypeScript, 39 tests and build passed; root lint could not start because `minimatch` is absent. Browser coverage, source correlations, saved screenshots, known limitations and exact resume actions are recorded in [ELEMENT-CONTROLS-CHECKPOINT.md](extensions/cloudforge/studio/ELEMENT-CONTROLS-CHECKPOINT.md). No commit/push/main merge, Rust/protocol change or desktop packaging occurred during this pass. Resume with diff review and remaining verification, then commit/push the feature branch.

## Connected drawing and design review — 24 November 2026

Continued in the same worktree/branch `codex/infrastructure-studio-preview`, base `2c1f658f0b0`. Added shape/note/text connections, stable-ID bounds-based export, atomic attached-link deletion/Undo, keyboard connection creation and compact phone-width workspace actions. Reference UI and AFFiNE source findings, design direction, resolved review issues and limitations are in [CANVAS-DESIGN-REFINEMENT.md](extensions/cloudforge/studio/CANVAS-DESIGN-REFINEMENT.md). One canonical graph/history; source checkouts, Rust, protocol and installed desktop are unchanged. Fresh verification: TypeScript, 31 tests, preview build, browser drawing links/movement/deletion/Undo/focus, both themes, no page overflow at 320/390/768/1024px with panels collapsed. Full provider constraints, typed inheritance/references and grouped manipulation remain open. Next: selection/group manipulation and precision attachment geometry without conflating visual frames with provider containment.

## Canvas connector follow-up — 24 November 2026

Codex continued in the same isolated worktree/branch `codex/infrastructure-studio-preview`, base `b84a8191783`. Inspected live Brainboard node/grid view menus and AFFiNE connector model/toolbar source; adapted selection-only connection tools, shared geometry/export, labels, stroke, arrowheads and local visibility controls. Same Architecture/history across renderers. No Rust, protocol, source-checkout or installed Workbench changes. Fresh preview TypeScript, 29 tests, production build, browser editing/Undo/mode/visibility checks and SVG download inspection passed. See [CANVAS-CONNECTIONS-PASS.md](extensions/cloudforge/studio/CANVAS-CONNECTIONS-PASS.md) for the evidence ledger, paths, screenshots and remaining gaps. Exact next action: stable-ID shape connections and grouped manipulation; provider constraint/reference work remains open.

## Resource form follow-up — 23 November 2026

On `codex/infrastructure-studio-preview`, starting at `4c813511c4f`, extended the shared right-hand form with schema-derived nested blocks, required prompts, typed fields, optional advanced properties and canvas warnings derived from the same resource. All 4,078 bundled resource entries pass descriptor coverage. This implements catalogue-backed constraints, not complete version-matched provider validation. See [RESOURCE-CONSTRAINTS-PASS.md](extensions/cloudforge/studio/RESOURCE-CONSTRAINTS-PASS.md) for source correlations, runtime limitations, checks, screenshots and exact remaining work. Source/Rust/protocol files remain unchanged. Next work is full schema coverage plus typed inheritance/reference semantics; nested block UI is no longer merely sample-only.

## Studio refinement checkpoint — 23 November 2026

Integration owner: Codex in `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`, branch `codex/infrastructure-studio-preview`, starting revision `1767da9b53485aea155b60add064d1591569055b`. This entry accompanies the checkpoint commit; resolve its exact revision with `git log -1 -- HANDOFF.md`. All implementation remains under `extensions/cloudforge/studio`; no Rust, canonical protocol, installer or installed Workbench changes were made.

Restored the user's latest layout: resource library left, canvas centre, forms/code/variables right. Removed the global bottom code dock. Added scoped main.tf/resource Terraform projection and bounded atomic Apply; reviewed .tf/.tfvars variable import, forms, sorting, filters and reference copy; six editable vector shapes with border controls, atomic top-left resize, shared export geometry and canvas-contained contextual tools. Light/dark remains independent of renderer. The source generator receives a computed adapter, never a second editable architecture.

Source evidence and ownership are in [AFFINE-ADAPTATION.md](extensions/cloudforge/studio/AFFINE-ADAPTATION.md), [SOURCE-PROVENANCE.md](extensions/cloudforge/studio/SOURCE-PROVENANCE.md) and the eight-file [core hash manifest](extensions/cloudforge/studio/CLOUDLAB-CORE-PROVENANCE.json). The supplied AFFiNE checkout was read only; the supplied CloudLab generator/parser/catalogue files were copied unchanged. Desktop and Rust toolchains remain independent.

Fresh verification: preview TypeScript, 22 tests and production build passed. Browser checks confirmed selected-resource HCL edit/apply/Undo, whole-architecture scope, restoration of overview on Block view, literal variable import preserving false, descending sort, copy-reference feedback, right inspector placement, removal of bottom dock and shape toolbar containment. Final verification used isolated Playwright after the embedded browser transport disconnected. [Verification record](extensions/cloudforge/studio/VERIFICATION-2026-11-23.json). Local screenshots: `output/playwright/terraform-main-right-final.png`, `output/playwright/resource-form-dark-final.png`, `output/playwright/variables-right-light.png` (ignored local artifacts, not repository assets).

Exact next action: follow the user's newest VM-form annotations by inspecting CloudLab's Fields/model/reference resolution, then adapt typed inherited resource group/location values with provenance, schema-constrained reference pickers, required/nested block editing and semantic dependency updates on the canvas. Reuse one form in both renderers and the focused resource workspace, on the right. The current string settings and design links do not implement those semantics. Preserve existing backend investments; do not invent service protocol writes. Broader annotation/collaboration, advanced shape connectors, full source round-trip, environment/project variable scopes and installed desktop integration remain open. The earlier bottom-docking instructions are superseded.

The Windows x64 Code OSS baseline passed dependency installation, packaging, a fresh-profile launch, and local open, edit, and save. The cold launch and file save also passed with inbound and outbound firewall rules for all nine packaged executables. The saved file was verified on disk, the process exited with code 0, and all 18 temporary rules were removed. [Baseline evidence](Z:/CloudForge/HANDOFF.md#code-oss-foundation-setup)

| Item | Verified value |
| --- | --- |
| Product repository | [fXrazor/vscode](https://github.com/fXrazor/vscode), checked out at `Z:\CloudForge-Code` |
| Clean source revision tested | `a3cabfed1ada486415b1d3b4fff66bb2d47771ac`, also the merge base with Microsoft `main` |
| Upstream reference at baseline | `62c6591a3a5c5cf409cb9cac554f1f1e4879af15`, 16 commits ahead |
| Rust repository | [fXrazor/CloudForge](https://github.com/fXrazor/CloudForge), adjacent at `Z:\CloudForge`. Inventory at `2a0959410ba5b5eaf73ef53e8cecaab689029693`; preserve the existing uncommitted work |
| Windows toolchain | Node `24.22.1`, pnpm `12.16.0`, Python `3.15.2`, VS 2026 C++ Build Tools with x64 Spectre libraries, Windows SDK `10.0.26100.0`, and Inno Setup `6.4.1` |
| Build command | `corepack pnpm run gulp vscode-win32-x64-min` with the Windows SDK x64 tools on `PATH`. Exit code 0 in 8m 52.3s |
| Portable payload | `Z:\VSCode-win32-x64`, 2,707 files totaling 1,440,484,904 bytes |
| Baseline executable | `Code - OSS.exe`, SHA-256 `c70cb8ccd1876809841c4d136f01910a67e232b89b556ad9d2fd8b8fe835662b` |

The upstream baseline executable is the portable Code OSS build. The [foundation plan](Z:/CloudForge/docs/superpowers/plans/2026-11-16-code-oss-desktop.md) describes the branded desktop, Rust service, and one Windows installer. The [approved design](Z:/CloudForge/docs/superpowers/specs/2026-11-16-code-oss-cloudforge-ide-design.md) defines the product scope.

## Repository routing

The user-facing deliverable is **one installable CloudForge app**: this Code OSS desktop packaged with the Rust service built from `Z:\CloudForge`. These are source boundaries, not two installed apps. Put shipped desktop UI, extension, product configuration, and installer work in this repository; put Rust service and core behavior in `Z:\CloudForge`. The React/Vite UI in the Tauri fallback does not get compiled into Code OSS. Preserve its existing changes, and explicitly implement in this repository any behavior that should appear in the shipped desktop. Follow the [foundation plan](Z:/CloudForge/docs/superpowers/plans/2026-11-16-code-oss-desktop.md): the handshake-only proof passed, and the separately approved workspace/graph slice is the only next implementation scope. Broader product work remains gated.

## Approved handshake-only proof

The user approved a proof limited to a built-in command, service handshake, package provenance, and process lifecycle. Keep the implementation in separate worktrees and stay within that boundary:

1. Build a Tauri-independent `cloudforge-service.exe` from a recorded clean Rust revision. Implement only bounded framing and `initialize` for protocol/service identity from the [draft protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md).
2. Add the minimum product identity and built-in command needed to demonstrate activation and sidecar handshake/lifecycle in Code OSS. The broker choice, executable path, and manifest/signing order must follow the resolved decisions in the [readiness review](Z:/CloudForge/HANDOFF.md#protocol-and-proof-readiness-review-2026-11-17), not assumptions in this outline.
3. Package and verify service provenance, manifest/hash, notices, startup/handshake, mismatch handling, and cleanup on normal quit and forced desktop termination. Do not add `openWorkspace`, `readArchitecture`, Terraform parsing, graph UI, or other workspace behavior in this proof.

The full product identity, selected broker, and packaging approach are not blanket-approved by this proof; apply only decisions recorded for this bounded scope. The first proof and protocol remain proposals for approval where they extend beyond the handshake-only scope.

### Readiness review (2026-11-17)

A read-only review checked this proof against the fork at `a3cabfed1ada486415b1d3b4fff66bb2d47771ac` and CloudForge `2a0959410ba5b5eaf73ef53e8cecaab689029693`. The full findings, owner decisions, and acceptance checklist are in the [Rust handoff](Z:/CloudForge/HANDOFF.md#protocol-and-proof-readiness-review-2026-11-17). Points specific to this repository:

- Step 2 names Electron main as the supervisor but adds a built-in extension, which runs in the extension host. Supervision from Electron main needs a core patch: a main-process service and an IPC channel. The owner chooses the broker.
- Code OSS has no Job Object, and its `taskkill` tree kill (`src/vs/base/node/processes.ts`) needs a living parent. During shutdown, `extensionHostStarter.ts` gives the extension host up to 6 s and deliberately does not kill it. Prove cleanup after a forced exit through stdin EOF and a service-side parent watchdog. Spawn the service with a scrubbed environment and drain stderr continuously.
- Step 3 stages the manifest before signing. Authenticode signing changes the executable bytes, so compute the manifest SHA-256 after signing.
- `resources/app/cloudforge-service/` is outside the `InstallDelete` entries in `build/win32/code.iss`, so stale files can survive updates. A folder inside the built-in extension is cleaned on full updates.
- `product.json` still uses Code OSS AppIds, mutex, data folders, built-in Copilot with auto-updates, `voiceWsUrl`, and the `vscode-cdn.net` Webview template. At minimum, give the proof distinct AppIds, mutex, and data folders.
- `builtInExtensions` accepts a local `vsix` with `sha256` (`build/lib/builtInExtensions.ts`), which suits the one-VSIX bundling check.

The user approved the bounded installer proof and later approved the separate workspace/graph slice. The integration owner owns the shared protocol, packaged service pin, licensing and provenance checks for bundled artifacts, and installed-product smoke. See the [Rust handoff](Z:/CloudForge/HANDOFF.md#read-only-inventories-completed-2026-11-17) and [approved slice design](Z:/CloudForge/docs/superpowers/specs/2026-11-17-workspace-graph-slice-design.md) for scope and safeguards.

## Verified Windows installer proof

The [Windows x64 per-user installer](Z:/CFProof/Code/.build/win32-x64/user-setup/CloudForgeProofSetup-x64.exe) built and passed its installed smoke on 17 November 2026. This is an unsigned proof build.

| Artifact or source | Verified identity |
| --- | --- |
| Installer | 321,101,265 bytes, SHA-256 `f9c8ca71ec3c7e6f5edaa39ab38c10a84be3a1cf651b7161bbd7d3bf94fb7e35` |
| Desktop | `codex/cloudforge-desktop-proof` at `0e5307e3c63e384c139cfd9bd264de3b0da94e8a`, built from the clean linked checkout at `Z:\CFProof\Code` |
| Rust sidecar | `codex/cloudforge-sidecar-proof` at `9ff372edad50b636678ac90f3f8ea363c9c71d2a`, protocol 1, Windows x64, SHA-256 `086f96faaa9d39debb71137c0b6911ce46429aeda4721569e4fae7cd64f2f793` |
| VSIX sample | JavaScript Debugger `1.140.1`, SHA-256 `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897`, extracted with MIT license and third-party notices |

The installed executable and service manifest matched the build. On a cold launch with 24 firewall rules covering the 12 installed executables, the desktop negotiated protocol 1, the built-in **CloudForge: Show Proof Status** command activated, and a local edit saved correctly. The main log reported both a rejected service commit and a rejected protocol version in separate runs. The sidecar exited after normal desktop quit and after forced desktop termination. The Rust process also exited when a separate test launcher was killed while writing a partial frame. The test installation and firewall rules were removed. [Installed workbench screenshot](Z:/CFProof/Code/.build/cloudforge/installed-workbench.png)

Electron main owns one sidecar per running proof app and verifies the service digest on every startup. The built-in command verifies extension activation independently. The proof has no workspace grant or graph calls. The [service draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md) records the follow-on window and workspace boundary. The unchanged Tauri fallback passed its frontend build, 68 Rust tests, formatting, and Clippy.

## Service artifact staging slice

Worktree `E:\Orca\CloudForge-Code\dagon`, branch `fxrazor/chore-review-handoffs`, source base `a3cabfed1ada486415b1d3b4fff66bb2d47771ac`. See the [source map](docs/cloudforge/repository-map.md) and [staging guide](docs/cloudforge/service-artifact.md). The installer proof above is inherited verification from its separate branch; this merge does not bring that branch's implementation onto `main`.

Selected in response to the user's instruction to continue working from the handoff. No canonical runtime protocol or service revision was chosen.

- Added [build/cloudforge/serviceArtifact.ts](build/cloudforge/serviceArtifact.ts): a Node-only CLI/function that checks a trusted expected digest and packaged desktop commit, streams the supplied service into a fresh `cloudforge-service` directory, rechecks copied bytes, and writes build metadata last. It records supplied service/desktop revisions, opaque protocol identifier, declared Windows x64 target, hash, and size.
- Added [targeted tests](build/lib/test/cloudforgeServiceArtifact.test.ts) and [usage/integration guidance](docs/cloudforge/service-artifact.md). Review identified a cleanup ownership bug; a failing regression reproduced it before the fix. Exclusive file handles now track which outputs this run created, preserving a manifest claimed by another writer.
- The CLI does not execute/download the artifact, modify product metadata, or overwrite existing service output. It has no automatic Gulp/installer hook. Hash verification proves byte identity; provenance, PE architecture, signing, protocol compatibility, installed behavior, and lifecycle need their separate checks.
- The initial targeted lint attempt found missing tooling dependencies. `corepack pnpm install --frozen-lockfile --ignore-scripts` then installed this worktree's locked dependencies. Native/postinstall setup was deliberately not run for this build-tool task; this is not a prepared editor build. No package manifest or lockfile changed.
- Validation: 34 Node tests passed with no skips; targeted strict TypeScript checking and targeted oxlint passed. No new desktop build, real Rust service, installer, or runtime connection was tested.

## Proof and stager integration slice

Branch `fxrazor/service-staging-integration` in worktree `Z:\CloudForge-Code\.claude\worktrees\service-staging`. It merges `main` (`080f2b03bd8`, the stager) into `codex/cloudforge-desktop-proof` (`0e5307e3c63`, the verified proof) with no conflicts. The proof's runtime code is unchanged. No other active worktree touches `build/cloudforge/` or `build/win32/code.iss`. The `feature/workspace-graph-desktop` worktree reads the same `cloudforge-service/manifest.json` and does not change its schema.

- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) now writes the runtime `manifest.json` that `cloudForgeService.ts` verifies: `serviceCommit`, integer `protocolVersion`, `architecture: "x64"`, and `sha256`, with no BOM and under the 4 KiB read limit. The old `service-manifest.json` build-metadata schema is gone. `--protocol` takes a positive decimal integer.
- [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1) stages through the stager instead of an inline copy and manifest write. It replaces a reused payload's previous service only when that directory holds exactly the two staged files and neither is a link; otherwise it stops unchanged.
- [code.iss](build/win32/code.iss) deletes `resources/app/cloudforge-service` on normal install or upgrade for the `cloudforge-proof` product, so stale service files cannot survive an upgrade.
- The proof is unsigned, so staged bytes are final. A signed release must sign the service before staging, or restage after signing, as recorded in the [staging guide](docs/cloudforge/service-artifact.md#signing-and-integration).

| Check | Result |
| --- | --- |
| `node --test build/lib/test/cloudforgeServiceArtifact.test.ts` | 36 passed, 0 skipped. Covers the exact runtime manifest shape and size, and integer protocol validation for the API and CLI. |
| Strict `tsc` (TypeScript 6 from the main checkout) using `build/tsconfig.json` with Node types on the two build files | Passed. |
| `node build/oxlint.ts` on the two build files | Passed. Temporary junctions to the main checkout's `node_modules` were used because this worktree has no installed dependencies, and were removed afterwards. |
| PowerShell parse of `package-win32-x64.ps1`; scratch run of its staging block | No parse errors. A fresh payload and a reused payload produced the expected executable and manifest; unexpected content stopped staging with the directory untouched. |

### Installed package check (2026-11-17)

Built from the clean detached checkout `Z:\CFStage\Code` at `6f62ece11e4ca9623c4139b76b4a85fba4692086`. `corepack pnpm install --frozen-lockfile` passed in 3m 26s. `build/cloudforge/package-win32-x64.ps1` used the Rust service from `codex/cloudforge-sidecar-proof` at `9ff372edad50b636678ac90f3f8ea363c9c71d2a` (SHA-256 `086f96faaa9d39debb71137c0b6911ce46429aeda4721569e4fae7cd64f2f793`) and the pinned JavaScript Debugger VSIX (`7accf785…6abc1897`). The script passed in 12m 47s.

| Item | Result |
| --- | --- |
| Installer | `Z:\CFStage\Code\.build\win32-x64\user-setup\CloudForgeProofSetup-x64.exe`, unsigned, 321,074,228 bytes, SHA-256 `9a7c33a9cd0d0af097c3bf12275eff780106cc5325245d4253f4e01b5a3331e2` |
| Staged manifest | Written by the stager: service commit `9ff372e…`, protocol `1`, `x64`, and the service SHA-256 above |
| Install | The user installed it per-user at the default `%LOCALAPPDATA%\Programs\CloudForge Proof`. The installed product commit and service manifest matched the build. |
| Upgrade over install | A stale file was planted in `resources\app\cloudforge-service`, then the same installer was rerun silently (`/MERGETASKS=!runcode`, exit 0). Afterwards the folder held only `cloudforge-service.exe` and `manifest.json`, and both matched. |
| Launch and handshake | Launched with a fresh user-data folder and a local fixture folder. The main log recorded `Initialized protocol 1, service 9ff372edad50b636678ac90f3f8ea363c9c71d2a`, with one sidecar running. |
| Normal quit | After closing the main window, the desktop and the sidecar exited. |
| Forced termination | After the desktop main process was killed, the sidecar exited within 20 s. No installed processes remained. |

Not rerun in this check: the firewall-blocked offline launch, the commit and protocol mismatch cases, the partial-frame EOF test, and uninstall. The user's install was left in place, and the temporary user-data and fixture folders were removed. The original [installer proof](#verified-windows-installer-proof) covers those checks for the earlier packaging path.

## Sidecar handshake unit tests (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\stingaree`, branch `fxrazor/chore-test-verify-handoff`, based on `main` at `6f389944d1a`. This change adds tests only and stays within the handshake-only proof scope. The runtime supervisor [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts) had no unit tests and is unchanged.

- Added [cloudForgeService.test.ts](src/vs/code/test/electron-main/cloudForgeService.test.ts), with 23 cases in the Electron unit runner:
  - **Initialize reply parser:** replies delivered in one chunk, one byte at a time, and with the delimiter split across chunks. Error codes `-32001`, `-32002`, and other codes. Protocol or commit identity mismatches, including a string `"1"` and an uppercase commit. Malformed JSON-RPC envelopes, non-object and invalid UTF-8 bodies, invalid `Content-Length` values and extra headers, a 4 KiB header without a delimiter, trailing output, and early EOF.
  - **Package verification through `start()`:** a missing manifest, or a manifest path that is a directory. Manifests over 4 KiB, exactly 4 KiB, and not a JSON object. Invalid architecture, commit, and digest fields, and a different protocol. A missing executable and a digest mismatch. Stopping during verification, which must neither spawn nor log, and stopping before start.
  - The fixture executable holds inert text, and every case fails before spawning. The tests assert that no child process exists.
- Coordination: the `dab-ee` session (`fxrazor/collaborative-build-test-handoff`, `b2639f50659`) owns `build/cloudforge/**`, the stager test, and `docs/cloudforge/service-artifact.md`. This branch touched none of them.

| Check | Result |
| --- | --- |
| `node build/next/index.ts transpile`, then `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeService.test.ts`. Electron was downloaded into this worktree's `.build/electron` | 24 passing: 23 new cases and the runner's clean-state check. 0 failing |
| Mutants applied to the transpiled module, then the module was restored byte for byte: header-size bound off by one, trailing-output check removed, `-32002` mapping changed | Each mutant caused exactly 1 failing test |
| `tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` (worktree TypeScript `7.1.0-dev.20261105.1`) | Exit 0, with the new file included |
| `node --experimental-strip-types build/hygiene.ts <test file>` (oxlint and formatting) | Passed |

Observations:

- When the executable is not a valid PE image, Windows `spawn` throws synchronously. The supervisor therefore logs `SERVICE_START_FAILED`, not `SERVICE_SPAWN_FAILED`. A Node probe confirmed that start and stop return within about 180 ms, so shutdown does not hang. This is diagnostic wording only and was not changed.
- Two mutants were not completed: an inverted digest check, and ignoring a stop requested during verification. Both make the code reach `spawn` with the fixture. The first one hung the Electron runner for more than 10 minutes and was stopped. Afterwards no stray processes remained, and the module was restored.
- The Codex worktree `feature/workspace-graph-desktop` has uncommitted changes to `cloudForgeService.ts`. Rerun this test there after it rebases onto `main`.
- Not covered by these tests: a successful spawn and handshake against a real service, and lifecycle on quit or forced termination. The [installed package check](#installed-package-check-2026-11-17) covers those.

## Staged service verification gate (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\dab`, branch `fxrazor/collaborative-build-test-handoff`, based on `main` at `6f389944d1a74eecd0d0298d4a87f2e1d232bbfc`. Integration owner for this slice: this session (`dab`). It addresses next action 2: a digest recorded before signing must not reach an installer. The service protocol, runtime code, and Rust repository are unchanged.

File ownership was agreed with the concurrent `stingaree` session (branch `fxrazor/chore-test-verify-handoff`). That session owns only the new `src/vs/code/test/electron-main/cloudForgeService.test.ts`, and this slice owns only the files below. Neither changes the other's files. The `feature/workspace-graph-desktop` Codex worktree still holds uncommitted changes to `src/vs/code/electron-main/cloudForgeService.ts`. These were not touched, but they may conflict with the stingaree test when it rebases.

- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) adds `verifyStagedService` and a read-only `--verify` CLI mode. It rechecks an existing `cloudforge-service` folder. The folder must be a regular directory holding exactly the executable and `manifest.json`, with no links. The manifest must be BOM-free UTF-8 of at most 4 KiB with exactly the four runtime fields in lowercase canonical form. The executable must be nonempty and match the manifest digest. `--protocol` is required. `--sha256`, `--service-commit`, and `--desktop-commit` optionally pin the other build inputs. Stage mode, its flags, and its messages are unchanged.
- [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1) runs `--verify` with every value pinned immediately before the Inno tasks. Any later signing pass must therefore run before this gate, or the build fails.
- The [staging guide](docs/cloudforge/service-artifact.md#verifying-a-staged-or-installed-service) and the [installer README](build/cloudforge/README.md) document the mode and the gate.

| Check (newly run in this worktree) | Result |
| --- | --- |
| `node --test build/lib/test/cloudforgeServiceArtifact.test.ts` | 64 passed, 0 skipped. This is the original 36 plus 28 verification tests. File symbolic links were permitted on this machine, so the linked-manifest and linked-executable cases ran. |
| Mutation check: remove the digest check, the required protocol comparison, the executable or manifest link check, or the manifest protocol range, drop the CLI `--sha256` or `--desktop-commit` wiring, or raise the size limit by 1 byte | Each mutation failed at least one test. The source was restored afterwards. |
| Independent review by a code-review subagent | One confirmed gap: bare `--verify` accepted any protocol while the desktop accepts only 1. It is fixed by requiring `--protocol`, with tests. The listed test gaps are also closed. |
| Strict `tsc6` (TypeScript 6.0.2 from this worktree) on the two TypeScript files; `node build/oxlint.ts` on the same files | Both passed. The full `build/tsconfig.json` check reports 19 errors, all in `build/lib/policies` files and their tests. None are in CloudForge files. |
| PowerShell parse of the packaging script; scratch run of its staging and gate commands on an inert fixture | No parse errors. The gate passed after a fresh stage and failed with exit code 1 after the staged executable was rewritten. |
| `--verify` on the real built payloads `Z:\CFStage\VSCode-win32-x64` (product `696a213e335…`) and `Z:\CFProof\VSCode-win32-x64` (product `0e5307e3c63…`), pinned to service `9ff372e…`, SHA-256 `086f96fa…`, and protocol 1 | Both passed. The run was read-only. `--protocol 2` on CFStage failed as expected. |

Not run: a full desktop build, the installer, or installed smoke. The earlier per-user install at `%LOCALAPPDATA%\Programs\CloudForge Proof` is no longer present, so the installed-folder check used the built payloads instead. The gate proves byte identity only. It does not authenticate the manifest, inspect PE architecture, or check Authenticode signatures.

Next action: when a signing step is added, run it before the pre-Inno gate, and restage after signing as the staging guide describes. On the next installed smoke, also run `--verify` against the installed `resources\app` folder.

## Windows x64 service executable validation (2026-11-17)

- Branch `codex/verify-sidecar-architecture` in `Z:\CFArch`, based on desktop `main` at `f1a8b400e6a`.
- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) checks the AMD64 PE32+ executable headers on the supplied binary and staged copy. The pre-Inno and installed `--verify` command applies the same check. A matching SHA-256 alone can no longer admit an x86, ARM64, DLL, or malformed PE artifact.
- [cloudforgeServiceArtifact.test.ts](build/lib/test/cloudforgeServiceArtifact.test.ts) passed 73 tests. The nine new cases failed against the baseline because staging accepted their matching digests. Targeted strict TypeScript checking passed. The read-only CLI accepted the binaries in `Z:\CFProof` and `Z:\CFStage` with all expected inputs pinned. A scratch staging run with the `CFProof` binary also passed the gate. A fresh installer and installed smoke remain pending.
- The [staging guide](docs/cloudforge/service-artifact.md) describes the header checks. Before a signed release, stage the final signed bytes and run the pre-Inno verification gate on those bytes.

## Stage 2 D1: Electron-main broker (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\stingaree`, branch `feature/project-repos-desktop`, based on `main` at `7d54bb08544`. This is task D1 of the [Stage 2 plan](Z:/CloudForge/docs/superpowers/plans/2026-11-17-project-repos-import.md#desktop-featureproject-repos-desktop). It is built against the Phase 0 contract on CloudForge `main` at `ae5785d`. No Rust code or protocol file changed.

- [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts) accepts the nine Stage 2 methods. `validateCloudForgeServiceParams` checks only the parameters the extension may send:
  - `createProject`: `{ name }`.
  - `openProject`, `grantProject`, `forgetProjectAccess`, `installGit`: `{}`.
  - `inspectRepository`: `{ workspaceId, workspaceFolderIndex }`.
  - `createWorkspaceFile`, `importRepository`, `removeRepository`: ID-only parameters.

  Any `parentPath`, `projectPath`, `workspaceFolders`, or `folderPath` from the extension is rejected.
- `resolveCloudForgeRequest` adds the parameters the broker owns. It uses the calling window only:
  - `projectPath` is the folder containing the window's saved `.code-workspace`, or its single opened folder.
  - `workspaceFolders` comes from `resolveLocalWorkspace`, in window order.
  - `folderPath` is chosen by index into that list.
  - `parentPath` comes from a native single-folder picker that Electron main opens.

  The broker sends nothing to the service when:
  - the workspace is untitled, remote, or contains a non-local or UNC folder;
  - the window is empty;
  - the index is out of range;
  - the picker is cancelled.
- Contract choices for D2 to use:
  - A cancelled picker returns `CANCELLED`.
  - A window without a usable project scope returns `INVALID_STATE`.
  - A successful `createProject` result gains `workspaceFile`, a `file:` URI for the extension to open. The broker joins it only from validated single-component names, and the extension never receives the parent path any other way.
- [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts):
  - The new errors map to fixed codes: `-32009` to `CONSENT_REQUIRED`, `-32010` to `ALREADY_EXISTS`, and `-32602` with kind `INVALID_PARAMS` to `INVALID_PARAMS`.
  - `call` takes a per-request timeout. `installGit` waits 11 minutes, against the service's 10-minute limit; other requests keep 30 s.
- [app.ts](src/vs/code/electron-main/app.ts) passes the workspaces and dialog main services to the broker. Its window, workspace, dialog, and service dependencies are narrow interfaces, so the tests use typed fakes and nothing is spawned.

| Check | Result |
| --- | --- |
| `pnpm run build-fast --client-only`, then `scripts\test.bat --run …/cloudForgeServiceChannel.test.ts --run …/cloudForgeService.test.ts` | 39 passing, 0 failing. Broker tests: <ul><li>a folder outside the window's list is refused;</li><li>each of two windows gets only its own paths and service;</li><li>a cancelled picker sends nothing;</li><li>unknown windows, empty, untitled, and remote workspaces are refused;</li><li>UNC and multiple picks are refused;</li><li>unsafe names in the service's reply are refused;</li><li>`installGit` gets its longer timeout;</li><li>error messages are fixed.</li></ul> |
| Five mutants on the compiled broker: extra keys accepted, remote check removed, cancel ignored, index ignored, folder-name check removed | Each mutant caused 1 or 2 failing tests. The module was restored. |
| Every Stage 2 fixture request, with broker-owned keys removed, run through `validateCloudForgeServiceParams` | 49 of 50 accepted. The rejected one, `importRepository` with empty `selections`, gets the `INVALID_PARAMS` the fixture expects from the service. The broker supplies the same parameter names as the fixtures. |
| `tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` | Exit 0. |
| `build/hygiene.ts` and `pnpm run oxlint` on the 5 changed files | Passed. |

Not done in D1:
- The renderer command `_cloudforge.callService` forwards the Stage 2 methods since the [extension slice](#stage-2-extension-slice-2026-11-17) merged. The broker's `createProject` result, `CANCELLED`, and `workspaceFolderIndex` match what that slice sends and parses (`parseCreatedProject` requires the `file:///` URI the broker returns).
- Not run in D1: the Rust service, a debug build, and the installed product.

## Stage 2 extension slice (2026-11-17)

Branch `fxrazor/project-repos-extension` in worktree `Z:\CloudForge-Code\.claude\worktrees\project-repos-extension`, based on `main` at `7d54bb08544`. It implements desktop tasks D2, D4, D5, D6, D7, and D9 from the [Stage 2 plan](Z:/CloudForge/docs/superpowers/plans/2026-11-17-project-repos-import.md#desktop-featureproject-repos-desktop) against the [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md#stage-2-projects-with-repositories) on CloudForge `main` at `ca09ef6` (Rust R1–R10 merged).

**Ownership split (assigned by the user):**

| Owner | Tasks | Files |
| --- | --- | --- |
| This branch | D2, D4, D5, D6, D7, D9 | `extensions/cloudforge/src/project/*`, `extensions/cloudforge/test/projectModel.test.ts`, the extension's manifest, strings, and `tsconfig.json`, wiring in `extension.ts`, and `src/vs/workbench/electron-browser/cloudForgeService.contribution.ts` |
| `stingaree` session, branch `feature/project-repos-desktop` | D1 (broker) | `src/vs/code/electron-main/cloudForgeService*.ts`, `app.ts`, and their tests |
| Codex, branch `codex/stage2-terraform-detection` in `Z:\CFWelcome` | D3, D8 | `extensions/cloudforge/src/terraformDetection.ts`, its test, `.vscodeignore`, `gettingStartedContent.ts` |

A cross-session message about the split was held by the `stingaree` session and expired undelivered, so this table is the record.

**What it does:**

- **Project lifecycle (D2):**
  - In a window whose workspace file, or single folder, holds `cloudforge.project.json`, the extension calls `openProject`. On `CONSENT_REQUIRED` it asks once, "Allow CloudForge to read this project and its imported repos?", then calls `grantProject`. A decline is remembered until **CloudForge: Refresh Project**.
  - **Forget Project Access**, **Open as CloudForge Project** (a project folder opened plainly), and **Set Up for Repos** (`createWorkspaceFile`, then open the workspace) are included.
  - Folder changes reconnect after a 0.5-second debounce.
- **Import (D4):**
  1. `inspectRepository` runs with a workspace folder index only.
  2. Secret findings are listed, with a warning that other agents can still read the files.
  3. You choose roots in a multi-select and name each architecture (unique, valid Windows name).
  4. `importRepository` runs with the folder's Git remote, and the first imported graph opens.
  - A stale project reloads the project.
- **Clone (D5):**
  - `cloudforge.cloneRepository` is the same command Codex's Welcome entry calls. It takes a provider argument (`github`, `gitlab`, `bitbucket`, `url`).
  - Repositories clone into `<project>\repos` with `git.clone(url, parent, { postCloneAction: 'none', returnRepositoryPath: true })`. GitHub uses the Git extension's own picker. The new folder is added to the window, and then the import offer appears.
  - Without a project, it offers **Create Project…** or **Open Project…** and continues the clone in the new window within 15 minutes. **Clone Again** re-clones a missing repository from its recorded remote.
- **Projects view (D6):** `cloudforge.projects` in Explorer shows:
  - repositories with their status and a remove action;
  - linked and local architectures, which open in the Stage 1 graph view;
  - window folders not yet imported, with an import action.

  Its empty state has GitHub, GitLab, Bitbucket, Any Git URL, and Create Project links.
- **Git (D7):** a missing Git is detected when the Git extension is enabled in settings but has no model. A modal states that installing accepts the Git for Windows license and the winget source agreement, then calls `installGit`. It reports installed (with a reload), cancelled, or falls back to the official download page.
- **Secrets (D9):** findings go to Problems under the source `CloudForge`, as warnings with the finding code, the file and line, and no values. Flagged files are kept in workspace state for CloudForge's own future AI features.
- **Bridge:** `_cloudforge.callService` forwards the nine Stage 2 methods without adding any path, and tracks the project grant: workspace ID, all architecture IDs, and each repository's folder index. `_cloudforge.openSource` resolves a linked architecture's source from its repository's workspace folder using `sourceBase`.

| Check | Result |
| --- | --- |
| `node --test extensions/cloudforge/test/projectModel.test.ts` | 8 passed. Every project, inspection, and Git result in the 18 CloudForge fixtures parses. Unsafe data is refused: credential remotes, finding values, foreign links, and bad indexes. |
| Extension type check (`tsc6 -p extensions/cloudforge`) and core type check (TypeScript 7 `tsc --project src/tsconfig.json --noEmit --skipLibCheck`) | Both passed. The TypeScript 6 core check ran out of memory at 8 GB, so TypeScript 7 was used, as in the Stage 1 tests. |
| `build/oxlint.ts` and `build/hygiene.ts` on all changed files | Passed. `code-no-accessor-after-await` caught services taken after an `await` in the bridge; this was fixed before commit. Hygiene refuses new `.mjs` files, so the test is TypeScript. Codex's tests were renamed to `.ts` on integration. |
| esbuild bundle of the extension | 58 KB, including all seven project modules. |

**Not done or not verified:**

- No desktop build or interactive run. The [Stage 2 desktop integration](#stage-2-desktop-integration-2026-11-17) replaced `hasTerraform` with Codex's detection and added the `test/` exclusion to `.vscodeignore`.

## Next actions

The user clarified that infrastructure design has two modes, **Visual Design** with the original Brainboard-style diagram and Miro-inspired features, and **Technical Design** with n8n/Blender-inspired engineering nodes. The Infrastructure Studio plan now records both presentations over shared resources, with validation, execution and deployment as associated workflows.

The [Infrastructure Studio implementation plan](docs/cloudforge/infrastructure-studio-implementation-plan.md) assesses the supplied master specification and screenshots with n8n as the primary interaction reference. Documentation work used desktop `main` at `70c72e1b523c3948e3f092ec174e09ab4cda2432` in `Z:/CloudForge-Code` and read Rust source at `ca09ef6a1a3e76f96230b69da929ebdc503fbdc6`. This work owns only the new plan and this handoff entry. Research covers official application documentation, current library guidance through Context7, current source boundaries and the frontend design review. Local source links and documentation whitespace were checked. Feasibility, ordering and initial Azure authoring scope remain proposals. The next assignment is Phase 0 integration and contract decisions, followed by Phase 1 read-only canvas and focused resource inspection. Runtime and installed-product evidence remains as recorded for the existing slices.

The [Runner View design](docs/cloudforge/runner-view-design.md) is a documentation proposal based on desktop `main` at `c9f463818ef` in `Z:\CloudForge-Code`. This work adds the design and this handoff entry. The first slice would validate a saved Terraform revision offline and present the execution in the Workbench. The local links resolved and the documentation whitespace checks passed. Review the scope and name an integration owner before defining the service capability or starting implementation.

1. **Stage 2 desktop.** D1–D9 and the empty-project fix (`10d5bb7a547`) are on `main` (`507c1e8eec3`). Rebuilt as [CloudForgeProofSetup-x64-507c1e8eec3.exe](Z:/CFStage/CloudForgeProofSetup-x64-507c1e8eec3.exe), installed, verified with `serviceArtifact.ts --verify`, and passed 26/26 checks in `stage2-smoke.mjs` plus 18/18 checks in `stage2-extra-smoke.mjs` (Welcome clone entry, all four provider entries, real local HTTP clone into `repos\`, `notInWorkspace`/`changed`/`missing` reconciliation, `Clone Again`, `Remove from Project`, and no orphan sidecar). See [Stage 2 rebuilt installer and studio merge (2026-11-21)](#stage-2-rebuilt-installer-installed-verification-and-studio-preview-merge-2026-11-21).
   - **Remaining:**
     - Check live remote clones against public GitHub/GitLab/Bitbucket hosts and the `installGit` winget offer on a machine without Git (this workstation has Git installed).
     - Merge `fxrazor/continue-project-handoff-review` (`e89b441716b` plus this handoff commit) into `main` once ready (the main checkout `Z:\CloudForge-Code` currently has uncommitted `HANDOFF.md` and `docs/cloudforge/infrastructure-studio-implementation-plan.md`).
   - **Contract:** the [protocol's Stage 2 section](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md#stage-2-projects-with-repositories) and [fixtures](Z:/CloudForge/docs/protocol/fixtures/stage2/README.md). Broker-supplied paths (`projectPath`, `workspaceFolders`, `folderPath`, `parentPath`) come from Electron main, never from the extension.
   - **Already done on CloudForge `main`:** Phase 0 and the Rust tasks (`ae5785d`, `ca09ef6`).
2. **Infrastructure Studio preview.** `codex/infrastructure-studio-preview` (`1767da9b534`) is merged into `fxrazor/continue-project-handoff-review` with standalone `check`, 10/10 tests, and `build` passing, excluded from extension packaging via `.vscodeignore`. Next: review the R1 domain/schema/source contract and approve Phase 1/webview integration before mounting in Code OSS.
3. Before a signed release, sign the service before staging. The pre-Inno `--verify` gate checks the final signed executable against the manifest digest. See the [staging guide](docs/cloudforge/service-artifact.md#signing-and-integration).

## Stage 1 merged revisions (2026-11-17)

- Desktop `main` at `b36a727d3c6529283ac82116f45d32659088b2c6` includes the Stage 1 workspace command and resource tree (`b9c551d7411`), the x64 executable validation (`60f9d09293b`), and the Tokyo Night themes and walkthrough (`696a213e335`). The theme assets retain the upstream Enkia MIT notices. The walkthrough's **Open Workspace** action uses the merged command.
- Rust `main` at `898b067fe7f4de56dcbb9bf26c905ce29a2d5b41` includes the guarded read-only service and [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md). The service stages as protocol 1 with SHA-256 `6155b5c08e5d1526f2df35701b4224af585598c95f934881aaf27e2ee0619a08`.
- Validation passed in `Z:\CFArch` and the `workspace-graph-service` worktree. Desktop client build and typecheck, extension typecheck, targeted oxlint, 26 desktop tests, 73 stager tests, 14 locked offline Rust tests, Rust formatting, and Clippy with warnings denied all passed. An RPC smoke test staged the release executable and passed the desktop handshake, graph read, cross-process grant refusal, and stale revision checks against it.
- The [Windows x64 installer](Z:/CFMerge/CloudForgeProofSetup-x64.exe) is 321,395,983 bytes with SHA-256 `b107bf51b0bddaff9b978ceabdd89b1bd571cb0d06731f2f2e93c037fe43e6ff`. The upstream native dependency metadata step stalled after the desktop payload was assembled. The supported `-UseBuiltDesktop` mode packaged that payload and verified the pinned Rust service before Inno compilation.
- Packaged-desktop smoke with a fresh profile passed for a direct Terraform root, picker cancellation, explicit nested root choice, project architecture isolation, navigation to source, byte preservation, stale source rejection, handshake, and normal sidecar exit. The user reported an earlier installation and removal, and accepted the installed smoke gate on that basis. The latest installer was verified at build time and the workbench checks ran against its packaged payload.

### Tokyo Night preview evidence

The preview installer from `Z:\CFStage\Code` at `696a213e335` was 321,099,975 bytes with SHA-256 `c89a5b30ee02acbb32b96f9ed2803b3d68a8c8ef988bce255d86db0dcb601b34`. Its portable payload in `Z:\CFStage\VSCode-win32-x64` showed the following with a fresh profile on 17 November 2026.

- Startup used Tokyo Night (editor background `#1a1b26`), and Tokyo Night Light applied `#e6e7ed`.
- The theme picker labels them Default Dark and Default Light.
- The Welcome page is otherwise unchanged and lists “Get started with CloudForge” under Walkthroughs with its four steps.
- The chat and agent panel are unchanged.

Screenshots are in the preview session scratchpad (`look-welcome.png`, `look-walkthrough.png`, `look-light.png`). The user's own installed profile had already selected Tokyo Night Light.

## Stage 2 desktop integration (2026-11-17)

Branch `fxrazor/stage2-integration` in `Z:\CloudForge-Code\.claude\worktrees\stage2-integration`, based on `main` at `70c72e1b523`, which has the D1 broker and the extension slice. It merges Codex's `codex/stage2-desktop-integration` at `faa65e8f83f` without conflicts. Codex's branch was built in `Z:\CFWelcome` and adds:

- the Welcome entry **Clone into a CloudForge project…**, which calls `cloudforge.cloneRepository`;
- `findTerraformImportCandidates`, which detects Terraform by file name;
- `validateImportSelections`;
- the `test/**` exclusion in `.vscodeignore`.

Codex reported its Welcome syntax check, five logic tests, and strict TypeScript check as passing. The branch uses the Stage 2 contract from CloudForge `ae5785d`.

Integration changes:

- **Import offer:** uses `findTerraformImportCandidates` and excludes ignored folders, the project folder, and registered repos. `hasTerraform` is removed.
- **Architecture names:** the name prompt and a final check before `importRepository` use `validateImportSelections`. It applies the service's Windows naming rules, including reserved device names, and refuses case-insensitive name collisions.
- **Tests:** Codex's two tests are now `.test.ts`, because hygiene refuses new `.mjs` files.
- **Reserved-name pattern:** uses `\u00B9\u00B2\u00B3` escapes instead of literal superscript digits, which hygiene also refuses.

| Check | Result |
| --- | --- |
| `node --test extensions/cloudforge/test/*.test.ts` | 13 passed: 8 project model, 3 import selection, 2 Terraform detection. |
| Extension type check (`tsc6`) and core type check (TypeScript 7) | Both passed. The two new tests also type-check against the extension sources. |
| `build/oxlint.ts` and `build/hygiene.ts` on all 8 changed files | Passed after the escape fix. |
| esbuild bundle of the extension | 61,759 bytes, including the detection and selection modules. |

This branch was merged into `main` as `1e7eb4b9355`. The [Stage 2 packaged smoke](#stage-2-packaged-smoke-2026-11-17) covers the desktop run.

## Stage 2 packaged smoke (2026-11-17)

### Build

| Item | Value |
| --- | --- |
| Desktop | `main` at `c543c788eb3`, built in the clean detached checkout `Z:\CFStage\Code`. `corepack pnpm install --frozen-lockfile`, then `build/cloudforge/package-win32-x64.ps1`, which passed in 28 minutes. |
| Rust service | CloudForge `main` at `ca09ef6a1a3e76f96230b69da929ebdc503fbdc6`. Built with `cargo build --release --locked --target x86_64-pc-windows-msvc`, `+crt-static`, and `CLOUDFORGE_SERVICE_COMMIT` set. Protocol 1, 1,869,824 bytes, SHA-256 `efbe7287ae244bfabb60e27bb2e2009ed963b0e4a5112e1bc89d3c3e780a36e6`. The `service/` sources were clean; that checkout's other uncommitted files are legacy frontend and docs. |
| Installer | [CloudForgeProofSetup-x64-c543c788eb3.exe](Z:/CFStage/CloudForgeProofSetup-x64-c543c788eb3.exe), 321,543,315 bytes, SHA-256 `1f8713a4e52558cb20348d986e4864e82cfede27c2a051e0dca816718106c8ea`. JavaScript Debugger VSIX `7accf785…6abc1897`. |

### Broker fix found while preparing the smoke (`c543c788eb3`)

The broker started the service with only `SystemRoot` and `WINDIR`. The Stage 2 service finds its consent store, winget, and Git through `LOCALAPPDATA` and `ProgramFiles`. Remembered consent and the Git install would therefore have failed in the packaged app.

The broker now passes `cloudForgeServiceEnvironment`: the same 22 non-secret Windows variables the service forwards to winget (`ENVIRONMENT` in the service's `git.rs`). `PATH`, tokens, and everything else stay out. A new main-process test pins this. `scripts\test.bat --run …/cloudForgeServiceChannel.test.ts --run …/cloudForgeService.test.ts` gave 40 passing, 0 failing. Lint, hygiene, and the TypeScript 7 core type check passed.

### Smoke results

The portable payload `Z:\CFStage\VSCode-win32-x64` ran with fresh `--user-data-dir`, `--extensions-dir`, and `--shared-data-dir` folders, driven over the Chrome DevTools Protocol.

- **Folder dialog:** the broker's native folder dialog was answered with window messages to its own controls.
- **Consent store:** the per-user consent store did not exist before the run. It was removed afterwards.
- **Fixtures:**
  - a Terraform repo with three roots, a `.tfvars` file, a state file, and a sentinel secret literal;
  - an `origin` with credentials in the URL;
  - a Python repo.

25 of 26 checks passed. Scripts, the JSON report, and screenshots are in `Z:\CFStage\smoke`.

| Area | Result |
| --- | --- |
| Welcome (D8) | **Clone into a CloudForge project…** is listed under Start after the stock entries. |
| Create project | **CloudForge: Create Project…** took a name and showed the native folder dialog. It wrote the marker, `repos\`, and `SmokeProject.code-workspace`, and the window reopened on the workspace. `createProject` records consent, so the window did not ask. |
| Remembered consent | Reopening asked nothing. **Forget Project Access** removed the record; the next open asked, and **Allow** recorded it again. |
| 1 and 5: offer only with Terraform | `infra` was offered for import. `pyapp` (Python) was not. |
| 4: two of three roots | Three roots were offered and two chosen. `COM1` and a name differing only in case were refused. Exactly two linked architectures were recorded, and each opened its own graph (two resources each). |
| 6: marker and repo files | An unknown marker field survived the import write. Every repo file outside `.git` hashed the same before and after. |
| 7: clean remote | `https://smoke-user:smoke-token-123@example.com/org/infra.git` was recorded as `https://example.com/org/infra.git`. |
| 9: secrets | The warning said "3 place(s)" with no values. Problems listed `TFVARS_FILE`, `STATE_FILE`, and `SENSITIVE_LITERAL` with file and line only. No sentinel value appeared in the window text or the app logs. |
| **Failed: empty project** | A new project with no repos showed an empty Project view. The clone links appeared only when no project was open. |

**Empty-project fix (`10d5bb7a547`):** the view now shows the provider links and a line about importing an existing repo while an empty project is open. To verify it, the payload's two extension manifest files were patched for one run and then restored byte for byte. The same commit stops shipping `tsconfig.typecheck.tsbuildinfo`, which was in the payload. **Neither change is in the installer above.**

**Not covered:**

- **Criteria 2 and 10:** a provider clone and the Git install need the network or a machine without Git. The Welcome entry was seen but not clicked.
- **Criterion 3:** no service request before **Import…** was not observable from the smoke. It rests on the D3 tests and code review.
- **Criteria 8 and 11:** reconciliation (a removed, deleted, or replaced repo) and the Tauri fallback were not run. The Rust tests cover them.
- **Installer:** not installed. The smoke ran against its payload, as for Stage 1.
- **Agent host notice:** "Channel name 'agentHostManagement' timed out after 1000ms" appeared on reopen. It comes from the agent host, not CloudForge.
- **Graph:** the Graph view is still Stage 1's resource tree. The diagram canvas is later work.

## Infrastructure Studio dual-renderer preview, 2026-11-17

- Repository owner: this Code OSS checkout; integration owner: current CloudForge desktop task. Rust checkout untouched.
- Branch `codex/infrastructure-studio-preview`, isolated worktree `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`, base revision `1e7eb4b935528bc1193a0da6738c21da5f3e085a`. Changes are uncommitted.
- Files owned: `extensions/cloudforge/studio/**`, preview exclusion in `extensions/cloudforge/.vscodeignore`, and the canvas-first UI rule in root `AGENTS.md`.
- Architecture Design and Infrastructure Configuration are projections of the same reducer model. Names, configuration, dependencies, blocks and undo remain shared. Layout/viewports remain per-mode presentation metadata. Configuration cards support inline name/settings editing, incoming dependency disclosures, local name checks and explicit unavailable cost.
- Workspace chrome reduced to contextual disclosures and opt-in resizable side panes/code dock. SVG/PNG presentation export implemented; PDF uses browser Print / Save PDF.
- Newly verified: standalone TypeScript check, seven model tests, standalone build; browser mode switch, inline rename and cross-view Undo; successful SVG/PNG downloads with PNG visual inspection; no captured browser console errors.
- Not verified or complete: browser PDF save, full keyboard/accessibility sweep, all docking/resize combinations, provider schema breadth, production shadcn/Radix migration, service integration, real validation/pricing or desktop packaging. This preview is excluded from shipped extension files. No production infrastructure actions exist here.
- Exact next integration action: mount the preview in a supported Code OSS webview, adapt its single model to the canonical sanitized graph protocol and reuse native editor tabs for real Terraform. Preserve Rust authorization and existing service changes. Preview UI review can continue independently before integration.
- See `extensions/cloudforge/studio/README.md` for run instructions and boundaries.

### Independent canvas themes and adaptive background, 2026-11-17

Continued on codex/infrastructure-studio-preview at base 1e7eb4b935528bc1193a0da6738c21da5f3e085a in the same isolated worktree. Changed preview App, DesignCanvas and CSS plus README and root design guidance. Light/dark theme is separate React presentation state; both renderers use the selected theme. View disclosure contains the theme selector. Palette overrides no longer derive from the technical renderer. Default grid is faint neutral lines with world-aligned power-of-two subdivision; the live zoom subscription is isolated in CanvasBackground rather than the graph/editor component.

Compared Miro's live grid at approximately 72%, 75% and 400%; observed subtle lines with subdivision at high zoom. This describes visible behaviour, not its internal implementation. Returned the reference to its 70% overview preset. In CloudForge, verified Configuration Light/Dark and Architecture Dark, renderer switching preserves theme, and graph Undo remains disabled after presentation-only changes. Measured background SVG cell widths of 64px at 10% and 100px at 2000%; no captured browser console errors. Standalone TypeScript check and build passed. Existing reducer tests were unchanged. Browser evidence saved under the current visualization directory as architecture-dark-grid.jpg and configuration-light-grid.jpg. Production desktop/service integration remains as previously documented. Next action is the existing webview integration or further visual review; no Rust files changed.

### CloudLab Forge 3.0 source layout port, 2026-11-17

Same isolated branch/worktree and base revision. Named UI integration owner remains this desktop task. Read-only source supplied by user: Z:/CloudLab Forge/CLOUDLAB FORGE 3.0. Adapted forge.css tokens/overview rules into preview cloudlab-layout.css; ArchitectureOverview.tsx adapts source overview markup to our existing Architecture. Header/catalogue/pane/code dock layout follows Designer.tsx/Catalog.tsx. Source provenance and CSS SHA-256 are in studio/SOURCE-PROVENANCE.md. Source checkout and Rust repository were not edited.

Other changed preview files: App, VisualTopbar, ResourceCatalogue, ResourceNode, DesignCanvas, PaneResizeHandle, model, exportPresentation, preview entry, styles and documentation. Added selection-only whiteboard editing toolbar (text, font size, bold, fill, duplicate, delete), preserving shared history. Fixed resize handle class collision with inspector panel styling. Inspector now opens schema form from overview. Code dock retains the last selected resource when selecting whiteboard items. Source-style palettes remain independent of renderer. Default graph viewport is 100%; Fit remains available.

Newly verified before browser disconnect: source-based shell screenshot, overview/card rendering, selection toolbar text/font/bold edits, duplicate count 1→2 and Undo 2→1. Earlier screenshot exposed summary-row markup mismatch; corrected by applying source summary-row class. TypeScript, reducer tests and build pass. Browser transport closed during the final pass, then also failed a read-only retry. Final form-click, pane resize, revised 100% initial viewport, cross-mode/theme check and stable code dock after whiteboard selection need rechecking after browser reconnect. No new final screenshots were saved. Code is uncommitted.

Exact next action: reconnect browser controls, reload localhost preview, verify overview→form, keyboard pane resize, note editing with code dock retained, then review CloudLab source proportions against live reference. Production service/native editor integration remains pending. This is a source-adapted UI preview, not full feature or pixel parity.

### Paused refinement checkpoint, 2026-11-17

User explicitly requested stopping implementation and saving/documenting progress. No further feature work after that request. Same branch/worktree and base revision. The standalone preview now imports the source catalogue (Azure 1,110 / AWS 1,763 / GCP 1,205), source Monaco 0.52.2 and appearance controls, provider primitive fields, source-style library/overview/editor layout, Radix tabs, template insertion, source-style code resizing, and retained drafts. Shared graph/renderers and independent canvas theme are preserved. Rust/reference repositories were not edited.

Resume from extensions/cloudforge/studio/REFINEMENT-CHECKPOINT.md. It lists exact files, decisions, verification coverage, browser fallback, remaining source-parity gaps and next actions. VERIFICATION-2026-11-17.json records controlled-replay step statuses. Final catalogue/editor scenarios completed without captured console errors. A provider flow ended at an ambiguous favourites locator, so its later template UI steps remain unverified. Latest source workspace screenshot is recorded in the checkpoint. Older dark capture needs retaking after recent fixes.

Save-time validation: standalone check, ten tests, build and git diff --check are run before the local checkpoint commit. No push, release, service operation or desktop rebuild is requested.

Checkpoint implementation saved locally as e780e4d3b7a; not pushed. Save-time TypeScript check, all ten tests and standalone build passed. The full staged whitespace check flags whitespace in preserved imported vendor distributions/assets; the scoped authored-source/docs/scripts/package check passed. Do not report the vendor-inclusive whitespace check as clean. node_modules and dist are ignored. See REFINEMENT-CHECKPOINT.md for continuation.

### Reference investigation and Impeccable board direction, 2026-11-18

Same isolated worktree/branch, source revision at start `b8c281808ac28f17942b498c7d513cd94df1ed49`. This continuation is investigation/documentation, not feature implementation. [Investigation index](extensions/cloudforge/studio/investigation-2026-11-18/README.md) links all ten requested reports, all 27 latest annotations, source ownership/hashes, browser evidence, proposed contracts and an acceptance-based roadmap. CloudLab reference source and Rust repository remain read only; no push or main merge was performed.

New browser observations: Brainboard SVG scene, selected subnet configuration and Shapes drawer; Miro canvas/DOM overlay layers, shape library/search/pack management, connector routing edit with Undo, unsent comment composer, nested diagram Edit context and resize. Miro socket frames were observed only as direction/length, not decoded protocol. Nested resize did not use the outer board Undo and was manually restored approximately; exact restoration is not claimed. No comment/message or infrastructure/settings operation was submitted. Browser transport later closed and two read-only reconnect attempts failed. Live settings/panel-resize/persistence/multiplayer coverage remains incomplete; preview server was unavailable.

Impeccable's Operate guidance is recorded in [board design direction](extensions/cloudforge/studio/investigation-2026-11-18/board-design-direction.md): preserve CloudLab-derived identity, contextual chrome, typed shared forms, clear hierarchy and independent canvas themes. No UI source changed. Existing builds/tests remain inherited checkpoint evidence. Current canonical protocol now includes Stage 1 graph and Stage 2 project work, while schema/config writes/plans remain excluded; proposals here do not expand that authority.

Next: reconnect existing tabs and finish bounded pane-resize/settings observations, then review the typed domain/selection/schema/source adapter contract before the next visual increment. Documentation verification is recorded in the investigation folder; no desktop rebuild is needed for these files.

### Publication and continuation handoff, 2026-11-21

Requested by the user: push the saved changes and hand off. Publish this branch to `origin/codex/infrastructure-studio-preview` in [fXrazor/vscode](https://github.com/fXrazor/vscode). Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. The saved work comprises implementation `e780e4d3b7a`, checkpoint documentation `b8c281808ac`, investigation/design guidance `5de0d1dd606`, and this publication note. No new feature implementation was performed for publication.

At the pre-publication fetch, `origin/main` was `507c1e8eec3`; the preview branch was three commits ahead and three behind it. Publication targets the feature branch, not `main`. A later integration owner must reconcile current main before merging; no force push or alteration of another worktree is needed here. Desktop UI integration remains owned by the CloudForge desktop task; Rust and user-owned CloudLab reference source are unchanged by this task.

Fresh verification on 21 November, using pinned Node `24.22.1` and pnpm `12.16.0`: standalone `corepack pnpm check` passed; all ten tests passed with no skips; `corepack pnpm build` passed. These checks cover the standalone studio, not an installed Code OSS product or backend integration. Earlier browser evidence remains historical; no new visual, PDF, collaboration or service smoke was run for publication. Imported vendor whitespace findings remain documented in the checkpoint and are not being reformatted.

Start the next session with [REFINEMENT-CHECKPOINT.md](extensions/cloudforge/studio/REFINEMENT-CHECKPOINT.md), then the [investigation index](extensions/cloudforge/studio/investigation-2026-11-18/README.md), [roadmap](extensions/cloudforge/studio/investigation-2026-11-18/roadmap.md) and [Impeccable board direction](extensions/cloudforge/studio/investigation-2026-11-18/board-design-direction.md). Preview ownership is `extensions/cloudforge/studio/**`, its packaging exclusion and root design guidance. Do not replace Rust workspace/file/process authority or edit the legacy Tauri shell expecting it to appear in Code OSS.

Exact next action: reconnect reference browser controls and run the preview from its directory with `corepack pnpm dev`. Check current form navigation, panel resizing/docking, focused resource editing, template Undo and independent renderer/theme behavior. Finish the documented Brainboard settings/pane observations, then review the typed domain/schema/source adapter before richer configuration or production mounting. Preserve one architecture and one semantic history; the JSON dock, reference-only module import, primitive schema coverage and in-memory persistence are still preview limitations. Native Code OSS source editing and a supported Webview/service adapter remain integration work.

## Stage 2 rebuilt installer, installed verification, and studio preview merge (2026-11-21)

Worktree `E:\Orca\CloudForge-Code\dace`, branch `fxrazor/continue-project-handoff-review`, started at `main` (`507c1e8eec3`) and merged `codex/infrastructure-studio-preview` (`1767da9b534`) as `e89b441716b`. Rust repository `Z:\CloudForge` and the main checkout `Z:\CloudForge-Code` (which holds uncommitted `HANDOFF.md` and `docs/cloudforge/infrastructure-studio-implementation-plan.md`) were left untouched.

### Merged tree changes and checks

- Resolved merge conflicts in `extensions/cloudforge/.vscodeignore` (retaining both `*.tsbuildinfo` and `studio/**`) and `HANDOFF.md`. No Stage 2 runtime, broker, or extension source files changed.
- `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts`: 13 passed, 0 skipped.
- `node --test build/lib/test/cloudforgeServiceArtifact.test.ts`: 73 passed, 0 skipped.
- Standalone `extensions/cloudforge/studio`: `corepack pnpm install --frozen-lockfile`, `corepack pnpm check`, `corepack pnpm test` (10 passed, 0 skipped), and `corepack pnpm build` all passed.

### Rebuilt Stage 2 installer and installed smoke

Built from the clean detached checkout `Z:\CFStage\Code` at `507c1e8eec3b3280cc3eb74505111140af19ee9c` with `build/cloudforge/package-win32-x64.ps1`.

| Item | Verified value |
| --- | --- |
| Desktop revision | `507c1e8eec3b3280cc3eb74505111140af19ee9c` (includes empty-project view fix and `*.tsbuildinfo` exclusion from `10d5bb7a547`) |
| Rust service | `ca09ef6a1a3e76f96230b69da929ebdc503fbdc6`, protocol `1`, `x64`, 1,869,824 bytes, SHA-256 `efbe7287ae244bfabb60e27bb2e2009ed963b0e4a5112e1bc89d3c3e780a36e6` |
| Bundled VSIX sample | `ms-vscode.js-debug` `1.140.1`, SHA-256 `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897` |
| Installer | [CloudForgeProofSetup-x64-507c1e8eec3.exe](Z:/CFStage/CloudForgeProofSetup-x64-507c1e8eec3.exe), unsigned, 321,558,745 bytes, SHA-256 `50cd411c2904a106223a0796d53bbae0eafce665a49a9465db0911542bb7bea7` |

| Check | Result |
| --- | --- |
| Built payload `tsconfig.typecheck.tsbuildinfo` check | Absent (`False`). |
| `node build/cloudforge/serviceArtifact.ts --verify` on built payload `Z:\CFStage\VSCode-win32-x64\resources\app` (all flags pinned) | Passed. |
| `node Z:\CFStage\smoke\stage2-smoke.mjs` against rebuilt `507c1e8eec3` payload | **26/26 passed** (empty-project view now shows all four provider clone links and existing-repo hint; report saved at `Z:\CFStage\smoke\report-507c1e8eec3.json`). |
| Silent per-user upgrade install (`CloudForgeProofSetup-x64-507c1e8eec3.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /MERGETASKS=!runcode`) | Exit code `0`; installed to `%LOCALAPPDATA%\Programs\CloudForge Proof`. |
| Installed `tsconfig.typecheck.tsbuildinfo` check and `serviceArtifact.ts --verify` on `%LOCALAPPDATA%\Programs\CloudForge Proof\resources\app` (all flags pinned) | Absent (`False`); `--verify` passed. |
| `node Z:\CFStage\smoke\stage2-extra-smoke.mjs` against installed `CloudForge Proof.exe` (isolated profile, real local HTTP Git server on `127.0.0.1`) | **18/18 passed** (report saved at `Z:\CFStage\smoke\report-extra-507c1e8eec3.json`): Welcome clone entry lists all 4 providers and prompts Create/Open Project without a project; empty project view shows all 4 provider links; GitLab (`https://gitlab.com/`), Bitbucket (`https://bitbucket.org/`), GitHub (built-in Git clone picker), and Any Git URL (`https://`) entries verified; real local HTTP clone into `<project>\repos\infra` imported with graph opened and repo files hashed unchanged; reconciliation states `notInWorkspace` ("not in this window"), `changed` ("folder replaced; import again"), and `missing` ("missing on disk") verified with architectures marked `unavailable`; inline `Clone Again` re-cloned from recorded remote; `Remove from Project` cleared marker while keeping files on disk; 0 `cloudforge-service.exe` processes remained after quit. Visual screenshots (`01-empty-project.png`, `04-changed.png`, `05-missing.png`) inspected. |

### Remaining gaps and next action

- Live clones against external GitHub/GitLab/Bitbucket hosts and the `installGit` winget offer on a machine without Git remain unverified on this host (Git is installed here).
- Authenticode signing before the pre-Inno `--verify` gate remains open for signed releases.

### Infrastructure Studio refinement continuation (2026-11-21)

Continued on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` after committing [infrastructure-studio-implementation-plan.md](docs/cloudforge/infrastructure-studio-implementation-plan.md) on `main` (`6e2f6e2dfd6`) and merging `fxrazor/continue-project-handoff-review` into `main` (`0d500f91a7e`). Changes are scoped strictly to `extensions/cloudforge/studio/**` and `HANDOFF.md`; no shipped Code OSS runtime, broker, or Rust files changed.

- **Pure panel/dock state machine ([panelLayout.ts](extensions/cloudforge/studio/src/panelLayout.ts)):** extracted `createPanelLayout`, `dockCodePanel`, `setSidePanelOpen`, and `toggleSidePanel` with 4 new unit tests ([panelLayout.test.ts](extensions/cloudforge/studio/src/panelLayout.test.ts)). Manually opening an auto-hidden side panel now clears stale auto-hide memory and moves a competing side-docked code panel to `bottom` instead of colliding or reverting later.
- **Template auto-fit timing ([App.tsx](extensions/cloudforge/studio/src/App.tsx), [DesignCanvas.tsx](extensions/cloudforge/studio/src/DesignCanvas.tsx)):** replaced synchronous `flow.fitView()` after template dispatch with `pendingFitIds` fitting only after React Flow mounts and measures the newly inserted nodes.
- **Code panel retention on undo/delete ([App.tsx](extensions/cloudforge/studio/src/App.tsx)):** live verification caught that undoing a newly inserted template (or deleting the active resource) left `codeResource` undefined and unmounted `<CodePanel>`. Added fallback to `architecture.resources[0]`.
- **Keyboard, focus preservation, and section scoping ([ModuleImport.tsx](extensions/cloudforge/studio/src/ModuleImport.tsx), [ResourceWorkspace.tsx](extensions/cloudforge/studio/src/ResourceWorkspace.tsx), [VisualTopbar.tsx](extensions/cloudforge/studio/src/VisualTopbar.tsx), [DesignCanvas.tsx](extensions/cloudforge/studio/src/DesignCanvas.tsx), [ResourceCatalogue.tsx](extensions/cloudforge/studio/src/ResourceCatalogue.tsx), [styles.css](extensions/cloudforge/studio/src/styles.css)):** restored focus to triggering controls when `ResourceWorkspace` or `ModuleImport` closes; added Escape-to-close + focus-restore on Export and View `<details>` disclosures and `aria-pressed` on topbar panel toggles; added `data-section` scoping to catalogue sections (resolving the Favourites/Recent ambiguity); wrapped long Terraform type captions in Technical Design cards with `overflow-wrap: anywhere`.

| Check (newly run in `extensions/cloudforge/studio`) | Result |
| --- | --- |
| `corepack pnpm check` (`tsc --noEmit`) | Passed. |
| `corepack pnpm test` (`model.test.ts`, `catalogue.test.ts`, `panelLayout.test.ts`) | **14/14 passed**, 0 skipped. |
| `corepack pnpm build` | Passed. |
| Live Edge Playwright verification against `node build.ts --serve` | **14/14 passed** with **0 console errors** and **0 page errors**: fresh light Architecture and dark Configuration screenshots inspected visually; Overview→Form→ResourceWorkspace Escape focus restore; ModuleImport Escape focus restore; Export disclosure Escape focus restore; Favourites (`data-section="fav"`) + Application platform template insertion + post-measure `fitView` + single UI Undo; narrow `1024×720` keyboard library/inspector resize and side-dock right/left + manual toggle reconciliation; sticky note creation retaining last selected resource in code dock; independent dark theme across Configuration and Architecture renderers. |

**Next action:** review and approve the R1 domain/selection/schema/source contract (or Phase 1 Webview mount in `extensions/cloudforge`) before connecting the Studio preview to the canonical Rust graph service and native Code OSS Terraform editors.

### Phase 1: Read-only Architecture Canvas Webview (2026-11-21)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (branched from `82c3fffb4b6`) with zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`. Uses only supported Code OSS extension APIs (`window.createWebviewPanel`, restrictive CSP with per-panel nonce, `localResourceRoots` restricted to `media/`) and the existing canonical `_cloudforge.callService` (`readArchitecture`) and `_cloudforge.openSource` routes.

- **Sanitized Webview protocol ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts)):** defines `CanvasGraphSnapshot`, `CanvasViewState`, `ExtensionToWebviewMessage`, `WebviewToExtensionMessage`, strict `parseWebviewMessage` (accepts only `ready`, `selectNode`, `openSource`, `refresh`, `viewState` with opaque IDs; never accepts filesystem paths or commands), and `sanitizeViewState`.
- **Deterministic layered layout & grouping ([layout.ts](extensions/cloudforge/src/canvas/layout.ts)):** pure topological layering (cycle-safe), Visual Design and Technical Design card metrics, collapsible provider/layer groups with summary cross-group edges, scoped search with whole-graph vs visible counts, viewport fit math, and zoom-adaptive power-of-two grid spacing.
- **Webview host ([canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts)) & extension wiring ([extension.ts](extensions/cloudforge/src/extension.ts), [controller.ts](extensions/cloudforge/src/project/controller.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json)):** adds **CloudForge: Open Architecture Canvas** (`cloudforge.openCanvas`) in the Command Palette and `CloudForge Graph` view title bar; automatically displays loaded architectures from both Stage 1 `Open Workspace` and Stage 2 `CloudForge Project`; persists per-architecture presentation state in `workspaceState`; surfaces `STALE_SOURCE` and `WORKSPACE_UNAVAILABLE`/`SCOPE_DENIED` notices with one-click Refresh; keeps the native `CloudForge Graph` tree synchronized.
- **Offline Webview UI ([canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css), [esbuild.webview.mts](extensions/cloudforge/esbuild.webview.mts), [build/lib/extensions.ts](build/lib/extensions.ts)):** built into `extensions/cloudforge/media/` via `esbuild-webview-common.mts` with zero new npm dependencies; provides Visual Design and Technical Design modes over one canonical graph, independent Workbench/Light/Dark canvas themes, adaptive grid (`lines`/`dots`/`none`), collapsible groups, single-click inspector, 3-pane n8n-style Focused Resource Workspace (`Inputs` | `Resource` | `Results & Impact`) with `← Back to Canvas` (`Escape`) focus restoration, keyboard-accessible synchronized resource list (`/` search, `ArrowUp`/`ArrowDown`, `Enter`, `O`, `F`), and stale/partial coverage banners.

| Check (newly run in `E:\Orca\CloudForge-Code\dace`) | Result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **21/21 passed**, 0 skipped (13 Stage 2 + 8 new `canvasModel.test.ts` cases). |
| `tsc --noEmit` (TypeScript 7) and `tsc6 --noEmit` (TypeScript 6) on `extensions/cloudforge/tsconfig.json` and `extensions/cloudforge/canvas-src/tsconfig.json` | Passed with 0 errors. |
| `node extensions/cloudforge/esbuild.mts` and `node extensions/cloudforge/esbuild.webview.mts` | Built `dist/extension.js` (42 KB), `media/canvas.js` (24.9 KB), and `media/canvas-style.css` (10.5 KB). |
| `node build/oxlint.ts` and `node --experimental-strip-types build/hygiene.ts` on all 10 changed/added files | Passed with 0 errors. |
| Live Edge Playwright verification of compiled `media/canvas.js` + `canvas-style.css` | **11/11 passed**, **0 console errors**, **0 page errors**; visual screenshots inspected for dark Visual Design, light Technical Design, and 3-pane Focused Resource Workspace. |

**Phase 1 packaged-desktop exit evidence (2026-11-22):** rebuilt from clean detached `Z:\CFStage\Code` at `eeeb5a1d2c56542076cdeba3886dc42a4bc97a12` (`CloudForgeProofSetup-x64-eeeb5a1d2c5.exe`, 321,576,739 bytes, SHA-256 `b77e923c5399aaa82c9ebc3d811692e3757bb9070a5426c93349a7ecb887a4ea`; Rust `ca09ef6`, protocol `1`, SHA-256 `efbe7287...`). Verified `media/canvas.js` + `media/canvas-style.css` packaged and `studio/`, `canvas-src/`, `*.tsbuildinfo` excluded. Live packaged-desktop smoke ([phase1-canvas-smoke.mjs](Z:/CFStage/smoke/phase1-canvas-smoke.mjs)) against `Z:\CFStage\VSCode-win32-x64\CloudForge Proof.exe` and the real Rust sidecar verified: Architecture Canvas Webview opening inside Code OSS with all 3 Terraform resources from a live project import, independent Light theme in Technical Design inside dark Tokyo Night Workbench, Focused Resource Workspace retained across tab switches, live `_cloudforge.openSource` opening native `main.tf` with source bytes unchanged, external edit triggering the `STALE_SOURCE` banner with `Open Source` disabled and `Refresh Graph` exposed, and `0` remaining `Z:\CFStage\VSCode-win32-x64` `cloudforge-service.exe` processes after quit (visual screenshots `01-canvas-visual.png` through `04-stale-banner.png` inspected). Note: the `eeeb5a1d2c5` installer predates Phase 2 (`1e1e8299ad6`); rebuild from `main` to include the Phase 2 schema-backed parameters form and HCL draft preview in the installer.

### Phase 2 (Desktop): Schema-backed configuration forms, typed reference picker & draft HCL preview (2026-11-21)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (on top of `eeeb5a1d2c5`) with zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`. Types mirror the canonical Rust catalogue modules (`Z:\CloudForge\src-tauri\src\catalogue\{form,draft,coverage}.rs`).

- **Schema & draft renderer ([schemaForm.ts](extensions/cloudforge/src/canvas/schemaForm.ts)):** bundles offline version-pinned (`hashicorp/azurerm 5.14.0`) schemas, field help, official Registry doc links, and HCL examples for the initial Azure networking set (`azurerm_resource_group`, `azurerm_virtual_network`, `azurerm_subnet`, `azurerm_network_security_group` with nested `security_rule` blocks, `azurerm_public_ip`, `azurerm_route_table` with nested `route` blocks); renders aligned, clearly labelled `# Unsaved draft preview` HCL with path-level diagnostics; rejects computed-only writes; preserves raw HCL expressions; builds typed reference candidates (`buildReferenceCandidates`) marking apply-time outputs honestly; falls back explicitly for unsupported/schema-absent resource types.
- **Focused Resource Workspace UI ([canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):** upgrades the 3-pane workspace with **Inputs** (upstream resources + clickable typed reference chips), **Parameters (Unsaved Draft Preview)** (Required/Optional/Nested Blocks, per-field Value|Expr toggle, inline validation, stale-revision draft banner with Reset Draft, and `Advanced (Open Source)` native HCL route), and **Results** (`HCL Preview | Findings | Outputs` tabs). Drafts stay strictly in memory and never touch Terraform files on disk.

| Check (newly run in `E:\Orca\CloudForge-Code\dace`) | Result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **25/25 passed**, 0 skipped (includes 4 new [schemaForm.test.ts](extensions/cloudforge/test/schemaForm.test.ts) suites). |
| `tsc --noEmit` (TS 7) & `tsc6 --noEmit` (TS 6) on `extensions/cloudforge/tsconfig.json` and `extensions/cloudforge/canvas-src/tsconfig.json` | Passed with 0 errors. |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Built cleanly (`media/canvas.js` + `media/canvas-style.css`). |
| `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` on all Phase 2 files | Passed with 0 errors. |
| Live Edge Playwright verification of compiled Webview bundle | **13/13 passed**, **0 console errors**, **0 page errors**; visually inspected updated [canvas-focused-workspace.png](file:///C:/Users/dalep/.gemini/antigravity-cli/brain/b485a25a-5b7f-463d-a740-47981a091ce1/scratch/canvas-verify-out/canvas-focused-workspace.png). |

**Remaining for Phase 2 cross-repo completion:** Rust owner exposes the scoped `catalogue` schema lookup and `draft::render` service capabilities in `Z:\CloudForge` so live provider snapshots replace/augment the bundled offline Azure networking set.

### Phase 3 (Desktop): Resource & Architecture Validation Runner (2026-11-22)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (on top of `28fd23db9fd`, with `28fd23db9fd` pushed to `origin/main`) with zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`. Follows [runner-view-design.md](docs/cloudforge/runner-view-design.md).

- **Deterministic offline runner ([validationRunner.ts](extensions/cloudforge/src/canvas/validationRunner.ts)):** executes the three fixed stages (`Read Architecture`, `Map Dependencies`, `Static Checks`) over one immutable captured `sourceRevision`; detects dependency cycles via Tarjan SCC (`DEPENDENCY_CYCLE`); blocks only dependent downstream work (`skipped` with exact `blockedBy` causes) while independent branches continue executing; integrates Phase 2 schema draft checks and reports explicit `partial` coverage whenever the static graph is partial or a resource type lacks a bundled provider schema (`SCHEMA_UNAVAILABLE`); supports scoped `Validate Resource` (`computePrerequisiteScope`), linked rerun attempts (`attempt`, `previousRunId`), terminal `cancelValidationRun`, and `syncRunWithRevision` stale detection.
- **Workbench & Canvas Runner UI ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):** adds **CloudForge: Validate Architecture** (`cloudforge.validateArchitecture`) and **CloudForge: Cancel Validation Run** (`cloudforge.cancelValidation`) in Command Palette and `CloudForge Graph` title bar; displays accessible icon+text status pills on canvas nodes, blocked/passed edge highlighting, a dockable **Runner Timeline** (3 stage cards, coverage notes, Cancel/Rerun, and clickable chronological event rows), and scoped **Validate Resource** inside the Focused Resource Workspace and inspector.

| Check (newly run in `E:\Orca\CloudForge-Code\dace`) | Result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **29/29 passed**, 0 skipped (includes 4 new [validationRunner.test.ts](extensions/cloudforge/test/validationRunner.test.ts) suites). |
| `tsc --noEmit` (TS 7) & `tsc6 --noEmit` (TS 6) on `extensions/cloudforge/tsconfig.json` and `extensions/cloudforge/canvas-src/tsconfig.json` | Passed with 0 errors. |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Built cleanly (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css`). |
| `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` on all Phase 3 files | Passed with 0 errors after formatting `validationRunner.ts`. |
| Live Edge Playwright verification of compiled Webview bundle | **14/14 passed**, **0 console errors**, **0 page errors**; visually inspected [canvas-runner-timeline.png](file:///C:/Users/dalep/.gemini/antigravity-cli/brain/b485a25a-5b7f-463d-a740-47981a091ce1/scratch/canvas-verify-out/canvas-runner-timeline.png). |

**Phases 1–3 packaged-desktop exit evidence (2026-11-22):** rebuilt from clean detached `Z:\CFStage\Code` at `ad83d0d6b58a9418f1b7e908f660118736d5c747` ([CloudForgeProofSetup-x64-ad83d0d6b58.exe](Z:/CFStage/CloudForgeProofSetup-x64-ad83d0d6b58.exe), unsigned, 321,575,746 bytes, SHA-256 `4b1797b831ae58f0c99de444600fc9801fbf4821a8f6943eb4dee77758ce6480`; Rust `ca09ef6`, protocol `1`, SHA-256 `efbe7287ae244bfabb60e27bb2e2009ed963b0e4a5112e1bc89d3c3e780a36e6`; VSIX `7accf785...`). Verified `media/canvas.js` + `media/canvas-style.css` present and `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed with all flags pinned. Live packaged-desktop smoke ([phases1-3-smoke.mjs](Z:/CFStage/smoke/phases1-3-smoke.mjs), report [report-phases1-3-ad83d0d6b58.json](Z:/CFStage/smoke/report-phases1-3-ad83d0d6b58.json)) against `Z:\CFStage\VSCode-win32-x64\CloudForge Proof.exe` + real Rust sidecar passed **6/6**: all 3 Rust-parsed resources rendered in Architecture Canvas; Phase 3 **Validate** executed all 3 stages (`Read Architecture`, `Map Dependencies`, `Static Checks`) with status badges and Runner Timeline (`01-phase3-runner.png` inspected); Phase 2 Focused Resource Workspace typed reference chip + schema inputs produced aligned `# Unsaved draft preview` HCL (`02-phase2-workspace.png` inspected); `Advanced (Open Source)` opened native `main.tf` with bytes preserved; external edit triggered `STALE_SOURCE` banner; `0` payload `cloudforge-service.exe` orphans remained after quit; `%LOCALAPPDATA%\CloudForge\service\consent.json` restored cleanly. Note: visual inspection of `01-phase3-runner.png` observed that Rust `readArchitecture` emits `reference` edges from dependent→dependency (`apps → vnet_hub → hub`), which reverses left-to-right flow relative to provision order; align edge orientation in layout/runner in a follow-up pass.

**Next actions:**
- Rebuild the Windows x64 installer from `main` (`86cd0782e31` or later) once ready to package Phase 4 (Desktop Foundation) together with Phases 1–3, and verify `readArchitecture` edge orientation (`fromId`/`toId`) for left-to-right dependency layout.
- Cross-repo (Rust `Z:\CloudForge`): expose scoped `catalogue` schema/draft rendering (Phase 2), background cursor-based validation runs (Phase 3), and revision-checked atomic guarded Terraform save (Phase 4) in the canonical service protocol.

### Phase 4 (Desktop Foundation): Shared Draft Document, Semantic Undo/Redo & Reviewable HCL Generation (2026-11-22)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (on top of `ad83d0d6b58`) with zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`. Keeps all edits strictly in memory bound to `baseSourceRevision` until Rust's guarded atomic save capability is approved and connected in `Z:\CloudForge`.

- **Shared semantic draft model ([draftDocument.ts](extensions/cloudforge/src/canvas/draftDocument.ts)):** introduces `DraftDocument` as the single architecture model shared across Visual Design, Technical Design, Focused Resource Workspace, and the Validation Runner (`projectDraftGraph`), with a single semantic undo/redo stack (`applyDraftEdit`, `undoDraftEdit`, `redoDraftEdit`, `revertDraftDocument`) covering `addResource`, `duplicateResource`, atomic `deleteResource` (removing and restoring connected edges together), cycle-safe `connectResources` (rejecting self-loops, duplicate edges, and cycles), and `updateDraft`. Presentation state (`theme`, `grid`, `mode`, `viewport`) stays completely outside undo history. `generateTerraformPreview` emits deterministic, read-only Terraform HCL for all added and modified schema-backed resources plus an explicit removal summary without mutating disk files.
- **Contextual authoring UI ([canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css), [canvas-src/tsconfig.json](extensions/cloudforge/canvas-src/tsconfig.json)):** adds a contextual `+ Add` disclosure for the 6 schema-backed Azure networking types, dashed `Draft` indicators on added nodes, inspector `Duplicate`, `Delete`, and cycle-safe `Connect dependency` controls, a contextual dirty-state header group (`Undo` / `Redo` / `Review HCL` / `Revert Draft`, shown only once draft edits exist, plus `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`), and an accessible **Review Generated Terraform HCL** modal (`Escape` focus restore). Also formatted [validationRunner.ts](extensions/cloudforge/src/canvas/validationRunner.ts) via `build/lib/formatter.ts --replace` so `build/hygiene.ts` passes with zero notices.

| Check (newly run in `E:\Orca\CloudForge-Code\dace`) | Result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **32/32 passed**, 0 skipped (includes 3 new [draftDocument.test.ts](extensions/cloudforge/test/draftDocument.test.ts) suites). |
| `tsc --noEmit` (TS 7) & `tsc6 --noEmit` (TS 6) on `extensions/cloudforge/tsconfig.json` and `extensions/cloudforge/canvas-src/tsconfig.json` | Passed with 0 errors. |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Built cleanly (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css`). |
| `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` on all Phase 4 files + `validationRunner.ts` | Passed with 0 errors and 0 formatting notices. |
| Live Edge Playwright verification of compiled Webview bundle | **20/20 passed**, **0 console errors**, **0 page errors** (verifies `+ Add`, Visual↔Technical persistence, `Duplicate`, `Delete`, atomic `Undo`, **Review Generated Terraform HCL** modal, `Escape` close, and `Revert Draft`; visually inspected `canvas-phase4-hcl-review.png`). |

**Remaining for Phase 4 cross-repo completion:** Rust owner implements revision-checked, previewed, atomic guarded Terraform save (`saveDraft` / guarded patch) in `Z:\CloudForge` and exposes it through the canonical service protocol before the desktop enables writing drafts to disk.

### Auto-open project architecture & Stage 3/4 service broker wiring (2026-11-22)

Implemented on `fxrazor/auto-open-and-stage3-4` in isolated worktree `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (rebased onto `86cd0782e31` and fast-forward merged into local `main` at `92625488807`). Coordinates with Rust `Z:\CloudForge` `main` at `3e17be1` (Stage 3 catalogue/draft RPCs `3a9130c` and Stage 4 offline validation runner RPCs `e2332d0`).

- **Auto-open architecture on project load:**
  - Added pure `selectDefaultArchitecture(project, lastArchitectureName?)` in [model.ts](extensions/cloudforge/src/project/model.ts): skips architectures backed by `missing`/`changed`/`notInWorkspace` repos, prefers the last-opened architecture by display name (case-insensitive across per-grant opaque ID changes), and falls back to the first available architecture.
  - Updated [controller.ts](extensions/cloudforge/src/project/controller.ts) to persist `cloudforge.lastArchitectureName` in `context.workspaceState` whenever an architecture opens (click or post-import) and automatically call `openArchitecture(...)` on initial `doConnect()`, landing reopened CloudForge projects directly on the Architecture Canvas tab without re-yanking focus on subsequent folder refreshes.
  - Added `workspaceContains:*.tf` and `workspaceContains:*.tf.json` to `activationEvents` in [package.json](extensions/cloudforge/package.json).
- **Stage 3 & Stage 4 Electron-main broker + Workbench bridge wiring:**
  - Extended [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts) with Stage 3 (`listCatalogueSnapshots`, `listCatalogueTypes`, `getResourceFormSchema`, `renderResourceDraft`) and Stage 4 (`startValidationRun`, `pollValidationRun`, `cancelValidationRun`) methods and `-32011` (`SCHEMA_UNAVAILABLE`) error mapping.
  - Added strict parameter validation (including `SnapshotKey`, `DraftBody`, `expectedSourceRevision`, and `maxEvents` 1..=512; rejecting unknown fields and path parameters) in [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts).
  - Forwarded Stage 3 read-only catalogue methods and active-scope-checked Stage 4 validation methods through `_cloudforge.callService` in [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts).
  - Added tests in [projectModel.test.ts](extensions/cloudforge/test/projectModel.test.ts) and [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts).

| Check (newly run on `92625488807` in `Z:\CloudForge-Code`) | Result |
| --- | --- |
| `node --experimental-strip-types build/hygiene.ts` & `node build/oxlint.ts` (all 8 changed files) | Passed (0 errors, 0 warnings). |
| `node extensions/cloudforge/esbuild.mts` | Passed. |
| `CLOUDFORGE_REPO=E:\Orca\CloudForge\umibozu node --test extensions/cloudforge/test/*.test.ts` | **33/33 passed**, 0 skipped. |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit` & `tsc -p src/tsconfig.json --noEmit --skipLibCheck` | Passed (0 errors). |
| `node build/next/index.ts transpile` & `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts --run src/vs/code/test/electron-main/cloudForgeService.test.ts` | **41/41 Electron-main tests passed**. |

**Remaining gaps & next actions:**
- Not run: full Windows x64 installer rebuild packaging the new Rust service (`e2332d0`) together with this desktop revision (`92625488807`) and live installed smoke verifying auto-open on project reopen.
- Connect the Architecture Canvas Webview (`canvasPanel.ts` / `canvas-src/index.ts`) to call the newly wired Stage 3 (`getResourceFormSchema` / `renderResourceDraft`) and Stage 4 (`startValidationRun` / `pollValidationRun` / `cancelValidationRun`) RPCs against the live Rust service.

### Stage 5 guarded draft save broker wiring (2026-11-22)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (rebased onto `3980ac11ea7`, fast-forward merged into `main` at `5b802643203`). Pairs with Rust `Z:\CloudForge` `main` at `9581a4d` (Stage 5 service revision `311ed186308236bd11ad86baf0d965699af34d19`, release `cloudforge-service.exe` 2,632,704 bytes, SHA-256 `1f69b077e1edb62bcde229b66d728c7ef7f0e4960faace1103dab963d7952f9f`).

- Extended [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts), [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts), and [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts) with `previewDraftSave` and `applyDraftSave` (enforcing single top-level `.tf` filename, `<= 512 KiB` UTF-8 payload, 64-hex `expectedSourceRevision`, opaque `previewToken` on apply, active workspace/architecture scope check, and unknown-field rejection).
- Extended [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts) with Stage 5 valid & invalid parameter tests.
- Fresh verification on `5b802643203`: `build/hygiene.ts` & `build/oxlint.ts` passed (0 errors/warnings); `tsc -p src/tsconfig.json --noEmit --skipLibCheck` passed; `node build/next/index.ts transpile` + `scripts\test.bat --run cloudForgeServiceChannel.test.ts --run cloudForgeService.test.ts` passed **41/41 tests**.

**Next actions:**
- Wire the Architecture Canvas Webview (`canvasPanel.ts` / `canvas-src/index.ts`) to invoke the live Stage 3 (`getResourceFormSchema` / `renderResourceDraft`), Stage 4 (`startValidationRun` / `pollValidationRun` / `cancelValidationRun`), and Stage 5 (`previewDraftSave` / `applyDraftSave`) RPCs.
- Rebuild the Windows x64 installer packaging Rust `311ed186308236bd11ad86baf0d965699af34d19` + desktop `main` and run installed smoke.

### Live Architecture Canvas wiring for Stage 3, Stage 4, and Stage 5 RPCs (2026-11-22)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` and fast-forward merged into local `main` at `8a6bc8d0037`. Pairs end-to-end with Rust `Z:\CloudForge` `main` at `9581a4d` (`311ed186308236bd11ad86baf0d965699af34d19`).

- **Pure-TS service adapters ([serviceAdapters.ts](extensions/cloudforge/src/canvas/serviceAdapters.ts)) & strict Webview protocol ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts)):**
  - Added validated narrow Webview intents (`requestValidation`, `cancelValidation`, `requestDraftSavePreview`, `applyDraftSave`, `requestSchema`) enforcing top-level `*.tf` filenames, `<= 512 KiB` UTF-8 content, opaque `previewToken`, and safe Terraform type names with zero path-taking parameters.
  - Added Stage 3 (`parseCatalogueSnapshots`, `selectBestSnapshotForType`, `mapRustFormSchemaToCanvasFormSchema`), Stage 4 (`parseValidationStart`, `parseValidationPoll`, `mapServiceValidationPollToRun`), and Stage 5 (`parseDraftSavePreview`, `parseDraftSaveApply`, `draftSaveErrorMessage`) adapters with unit coverage in [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts).
- **Extension host & Webview integration ([canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - **Stage 4 live Runner View:** clean architectures delegate **Validate** / **Validate Resource** to `startValidationRun` + cursor-batched `pollValidationRun` (streaming live status updates and supporting `cancelValidationRun`), falling back gracefully (`localOnly: true`) if an older service does not support Stage 4, while unsaved local drafts continue validating in memory.
  - **Stage 5 guarded Terraform draft save:** upgraded the **Review Generated Terraform HCL** modal with a two-step **Preview Save** (`previewDraftSave` showing create/replace target, `+added/-removed` line counts, SHA-256 digest, and any `SENSITIVE_LITERAL` warnings without values) -> **Apply Saved Changes** (`applyDraftSave` with one-shot `previewToken`), automatically refreshing both the `CloudForge Graph` tree and Architecture Canvas to `newSourceRevision` and clearing the dirty draft state on success.
  - **Stage 3 live provider catalogue hydration:** queries `listCatalogueSnapshots` on canvas load and fetches verified `getResourceFormSchema` snapshots on demand when opening the Focused Resource Workspace for resource types beyond the 6 bundled Azure networking schemas.

| Check (newly run on `8a6bc8d0037` in `Z:\CloudForge-Code`) | Result |
| --- | --- |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Passed (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css` rebuilt cleanly). |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit` & `tsc -p extensions/cloudforge/canvas-src/tsconfig.json --noEmit` | Passed (0 errors). |
| `CLOUDFORGE_REPO=E:\Orca\CloudForge\umibozu node --test extensions/cloudforge/test/*.test.ts` | **36/36 passed**, 0 skipped (includes 3 new [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts) suites). |
| `node --experimental-strip-types build/hygiene.ts` & `node build/oxlint.ts` (all 7 changed files) | Passed (0 errors, 0 warnings). |

**Remaining gaps & next actions:**
- Not run: full Windows x64 installer rebuild packaging Rust `cloudforge-service.exe` (`311ed186308236bd11ad86baf0d965699af34d19`, SHA-256 `1f69b077e1edb62bcde229b66d728c7ef7f0e4960faace1103dab963d7952f9f`) with desktop `main`, and live installed smoke verifying auto-open on project reopen, live Stage 4 validation, and Stage 5 guarded save end-to-end.
- Follow-up: align `readArchitecture` edge orientation (`fromId`/`toId`) for left-to-right dependency layout as noted in the Phases 1–3 smoke report.
- `main` remains local-only in both repositories (not pushed to `origin/main`).

### Stage 1–5 Edge Orientation Fix, Windows x64 Installer Rebuild & Live End-to-End Smoke (2026-11-22)

Completed on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (`401a948f404`, fast-forwarded to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Left-to-right edge orientation ([layout.ts](extensions/cloudforge/src/canvas/layout.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [canvasModel.test.ts](extensions/cloudforge/test/canvasModel.test.ts)):** added `orientServiceEdgesForCanvas` to normalize Rust `readArchitecture` `reference`/`explicit` edges (`dependent → prerequisite`) into provision-order dataflow edges (`prerequisite → dependent`) in `toCanvasSnapshot`, aligning canvas layout, inspector Upstream/Downstream lists, and scoped validation prerequisites. Verified with `37/37` extension tests, TS 6 & TS 7, `esbuild`, `oxlint`, and `build/hygiene.ts`.
- **Stage 1–5 Windows x64 installer rebuild (`401a948f404` + Rust `311ed18`):** built from clean detached `Z:\CFStage\Code` at `401a948f404d88c2a2e58a150e5c9c10bbdf3b25` with Stage 5 Rust `cloudforge-service.exe` (`311ed186308236bd11ad86baf0d965699af34d19`, 2,632,704 bytes, SHA-256 `1f69b077e1edb62bcde229b66d728c7ef7f0e4960faace1103dab963d7952f9f`) and pinned VSIX `ms-vscode.js-debug@1.140.1` (`7accf785...`).

| Artifact or check | Verified result |
| --- | --- |
| Installer | [CloudForgeProofSetup-x64-401a948f404.exe](Z:/CFStage/CloudForgeProofSetup-x64-401a948f404.exe), unsigned, `321,788,527` bytes, SHA-256 `4f21a826055af2786ff14032d73b3d85342896b070aeed001357e69c904f7066`. |
| Payload hygiene & manifest verify | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed with all flags pinned. |
| Live Stage 1–5 packaged-desktop smoke ([stages1-5-smoke.mjs](Z:/CFStage/smoke/stages1-5-smoke.mjs), [report-stages1-5-401a948f404.json](Z:/CFStage/smoke/report-stages1-5-401a948f404.json)) against `Z:\CFStage\VSCode-win32-x64\CloudForge Proof.exe` + real Stage 5 Rust sidecar | **8/8 passed** (screenshots `01-stage4-live-runner-oriented.png`, `02-stage5-readonly-refused.png`, `03-stage5-preview-save.png`, `04-stage5-applied-refreshed.png` inspected): (1) `vnet_hub` laid out left of `apps` with `hub` upstream and `apps` downstream; (2) Stage 4 live Rust validation ran `workspace-...-run-1` (`Read Architecture (Rust)`, `Map Dependencies (Rust)`, `Static Checks`) with `Passed` pills on all 3 nodes; (3) Stage 5 refused draft save on imported read-only repo with `SCOPE_DENIED`; (4) reopening `StagesProject` auto-opened remembered `Hub Studio` Architecture Canvas with zero clicks; (5) directly opened local Terraform root loaded 2 resources; (6) `+ Add` Public IP + typed reference chip + **Preview Save** validated HCL (`Create cloudforge_draft.tf`, `+11 / -0 lines`) without writing to disk; (7) **Apply Saved Changes** atomically wrote `cloudforge_draft.tf` (454 bytes) and refreshed canvas to `rev 69bae198` showing 3 clean resources with `hub → pip` arrow; (8) `0` payload `cloudforge-service.exe` orphans remained after quit and `%LOCALAPPDATA%\CloudForge\service\consent.json` was restored cleanly. |

**Real-world UX gap discovered on user install (`Z:\CloudLab Forge\project1`) & desktop fix (2026-11-22):**
1. **Project-root `.tf` discovery & local architecture creation ([terraformDetection.ts](extensions/cloudforge/src/terraformDetection.ts), [controller.ts](extensions/cloudforge/src/project/controller.ts), [index.ts](extensions/cloudforge/src/project/index.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [terraformDetection.test.ts](extensions/cloudforge/test/terraformDetection.test.ts)):**
   - Added pure `findProjectRootTerraformFiles` (filename-only scan for top-level `.tf`/`.tf.json` plus companion `.tfvars`/`.tfvars.json`, ignoring markers, dotfiles, and folders).
   - Added **CloudForge: New Architecture…** (`cloudforge.createArchitecture`) in the Command Palette, `CloudForge Project` title bar (`+`), and empty-project welcome view (preserving all 4 Git provider clone links and existing-repo hint). Creates a writable `architectures/<name>/` folder with `cloudforge.architecture.json`, optionally moves root-level Terraform files into it (or creates a starter `main.tf`), refreshes the project, and opens the new architecture immediately in the Architecture Canvas.
   - Added automatic `offerAdoptRootTerraform` prompt on project connect when a project has `0` architectures and top-level `.tf` files sit in its root folder (such as `Z:\CloudLab Forge\project1`).
   - Verified in `E:\Orca\CloudForge-Code\dace`: `38/38` extension unit tests passed (`0` skipped), TS 6 & TS 7 clean, `node extensions/cloudforge/esbuild.mts` clean, `oxlint` & `build/hygiene.ts` clean (`0` errors/warnings).

**Remaining gaps & exact next actions:**
1. **Rebuild Windows x64 installer** from desktop `main` (including `cloudforge.createArchitecture` + root `.tf` adoption) with Rust `311ed18` (`1f69b077...`) and install/upgrade `%LOCALAPPDATA%\Programs\CloudForge Proof` so `Z:\CloudLab Forge\project1` prompts to adopt its root `.tf` files into a local architecture automatically.
2. **Startup window noise:** upstream Code OSS's Sessions window (`window1`, `sessions.desktop.main.js`) logs `TypeError: Cannot read properties of undefined (reading 'hasMaximizedView')` and does not activate `cloudforge.cloudforge` until a project/workspace is opened; review default window/onboarding startup in `product.json` / workbench config.
3. **Push Rust `Z:\CloudForge` `main` (`9581a4d`)** to `origin/main` when ready (this session did not modify `Z:\CloudForge`).

### Canvas-First Frontend Design Polish, Installer Rebuild & Installed Upgrade (2026-11-23)

Completed on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (`ff70423bf38`, rebased onto `d4d23652223` Sessions startup guard and `9a7bf1728de` New Architecture / root `.tf` adoption, fast-forwarded to `Z:\CloudForge-Code` `main`, and pushed to `origin/main`). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Canvas-first UI & layout polish ([layout.ts](extensions/cloudforge/src/canvas/layout.ts), [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [canvasModel.test.ts](extensions/cloudforge/test/canvasModel.test.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Compacted the header into a single 44px row (title + single scannable status chip + clickable validation pill, `Visual Design | Technical Design`, `+ Add`, contextual `Undo`/`Redo`/`Review HCL`/`Revert Draft`, `List`/`Inspector`, consolidated `View` popover, and `Validate`).
  - Defaulted `inspectorOpen: false` so initial/unselected canvas views open 100% full-bleed; Inspector opens contextually on resource selection, collapses on empty-canvas click, and provides a focus-restoring `×` close button.
  - Ordered provider groups by minimum topological layer (`Azure Resources → Azure Networking → Azure Storage → Azure Compute`) and added smart horizontal/vertical edge anchors (`orientation: 'horizontal' | 'vertical'`) so cross-group arrows flow cleanly top-to-bottom without U-turns.
  - Added CSP-safe offline SVG category glyphs (`network`, `security`, `compute`, `storage`, `module`, `resource`) inside provider-tinted card and `+ Add` menu badges, frosted group headers, glassmorphic floating zoom bar, floating `?` keyboard-shortcuts popover, and an empty starter architecture welcome card.

| Artifact or check | Verified result |
| --- | --- |
| Unit tests, TS 6 & TS 7, esbuild, oxlint, hygiene (`ff70423bf38`) | **38/38** extension tests passed (`0` skipped), TS 6 & TS 7 clean, `esbuild.mts` + `esbuild.webview.mts` clean, `oxlint` & `build/hygiene.ts` clean (`0` errors/warnings). |
| Live Edge Playwright polish check (`frontend-polish-verify.mjs`) | **6/6 passed**, 0 console/page errors (`headerHeight: 44`, `inspectorInitial: 0`, `glyphCount: 6`; `01-visual-dark-fullbleed.png` & `02-technical-light-validated.png` inspected). |
| Windows x64 installer (`ff70423bf38` + Rust `311ed18`) | [CloudForgeProofSetup-x64-ff70423bf38.exe](Z:/CFStage/CloudForgeProofSetup-x64-ff70423bf38.exe), unsigned, `321,748,485` bytes, SHA-256 `306c77327525e190b0bad36a8796c7f1fd95e8a07eba6908c1eec86f4f0b4721`; Rust `311ed186308236bd11ad86baf0d965699af34d19` (`1f69b077...`), VSIX `7accf785...`. |
| Payload hygiene & manifest verify | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed on both built payload and installed app. |
| Live packaged-desktop smoke ([root-adopt-and-polish-smoke.mjs](Z:/CFStage/smoke/root-adopt-and-polish-smoke.mjs), [report-root-adopt-ff70423bf38.json](Z:/CFStage/smoke/report-root-adopt-ff70423bf38.json)) | **5/5 passed** (`01-adopted-fullbleed-canvas.png`, `02-adopted-validated.png`, `03-adopted-stage5-saved.png` inspected): automatic root `.tf`/`.tfvars` adoption prompt (`Create Architecture…`) moved files into `architectures/Hub` and opened full-bleed canvas (`headerHeight: 44`, `inspectorHidden: true`, top-to-bottom + left-to-right flow, 3 SVG glyphs); live Stage 4 Rust validation passed (3/3 `Passed` pills); live Stage 5 guarded save wrote `cloudforge_draft.tf` into `architectures/Hub` and refreshed to 4 clean resources; `0` payload sidecar orphans remained after quit. |
| Silent per-user upgrade install (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`ff70423bf38` + Rust `311ed18`), `tsconfig.typecheck.tsbuildinfo` absent, `consent.json` preserved. |

**Remaining next actions:**
1. Push local `Z:\CloudForge` `main` (`01e1b4b`) to `origin/main` when ready (this session did not modify `Z:\CloudForge`).
2. Add Authenticode signing prior to the pre-Inno `serviceArtifact.ts --verify` gate for signed releases, and consider adding a Stage 3 provider schema snapshot download/import workflow for providers beyond the 6 bundled offline Azure networking schemas.

### Stage 6: Offline Provider Dependencies & Scoped Cloud Region Metadata Integration (2026-11-23)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (`4e7b58a64ea` + `2569bd924ad`, fast-forward merged into local `Z:\CloudForge-Code` `main`). Pairs end-to-end with Rust `Z:\CloudForge` `main` at `a3dd202` (Stage 6 service revision `c4ffa00981d3505e965faf9749bde5fded1fbdc4`, release `cloudforge-service.exe` 3,078,144 bytes, SHA-256 `7aa6005e7555b1dcc689fccf0d6907dae07eb874c88005412e22302adc811070`).

- **Electron-main broker & Workbench bridge (`4e7b58a64ea`):** extended [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts), [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts), [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts), and [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts) with `inspectDependencies` (active workspace/architecture scope check, optional `expectedSourceRevision` and `engine`) and `listCloudRegions` (strict `provider`/`scope`/`configuredRegions` validation, unknown-field rejection).
- **Architecture Canvas UI (`2569bd924ad`):** extended [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [serviceAdapters.ts](extensions/cloudforge/src/canvas/serviceAdapters.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), and [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts):
  - Hydrates live Azure, AWS, and Google Cloud region lists from `listCloudRegions` on canvas ready to populate `location`/`region` dropdown pickers in the Focused Resource Workspace (preserving bundled defaults gracefully on older sidecars).
  - Queries `inspectDependencies` per architecture revision and displays a scannable **Providers & locks** section inside the contextual Inspector (`engine`, lock file state, per-provider `locked`/`unlocked`/`conflict`/`lockOutsideConstraints` status, requirement/conflict counts, and unused lock entries) without altering the 44px full-bleed header.

| Check (newly run on `4e7b58a64ea` / `2569bd924ad` in `Z:\CloudForge-Code`) | Result |
| --- | --- |
| `build/hygiene.ts` & `build/oxlint.ts` (all 10 changed files across broker + canvas) | Passed (0 errors, 0 warnings). |
| `tsc -p src/tsconfig.json --noEmit --skipLibCheck`, `tsc -p extensions/cloudforge/tsconfig.json --noEmit`, `tsc -p extensions/cloudforge/canvas-src/tsconfig.json --noEmit` | Passed (0 errors). |
| `node build/next/index.ts transpile` & `scripts\test.bat --run cloudForgeServiceChannel.test.ts --run cloudForgeService.test.ts` | **41/41 Electron-main tests passed**. |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Passed (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css`). |
| `CLOUDFORGE_REPO=E:\Orca\CloudForge\umibozu node --test extensions/cloudforge/test/*.test.ts` | **39/39 extension tests passed**, 0 skipped. |
| Windows x64 installer (`5b02f7db16a` + Rust `c4ffa00`) | [CloudForgeProofSetup-x64-5b02f7db16a.exe](Z:/CFStage/CloudForgeProofSetup-x64-5b02f7db16a.exe), unsigned, `321,864,095` bytes, SHA-256 `3dbaade95bc9ab95e2a535fe543cc4c19e163414ee4c4aec96a9882c0b67d567`; Rust `c4ffa00981d3505e965faf9749bde5fded1fbdc4` (`7aa6005e...`), VSIX `7accf785...`. |
| Payload hygiene & manifest verify | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed on both built payload and installed app. |
| Live Stage 6 packaged-desktop smoke ([stage6-smoke.mjs](Z:/CFStage/smoke/stage6-smoke.mjs), [report-stage6-5b02f7db16a.json](Z:/CFStage/smoke/report-stage6-5b02f7db16a.json)) | **5/5 passed** (`01-stage6-inspector-providers.png`, `02-stage6-live-regions-picker.png`, `03-stage6-saved-swedencentral.png` inspected): `inspectDependencies` rendered **Providers & locks (1)** (`terraform (inferred) · lock valid`, `hashicorp/azurerm`, `locked 5.14.0 · 2 requirements`, `1 unused lock entry.`); `listCloudRegions` hydrated all 24 Azure regions (`25` select options incl. `swedencentral` & `australiaeast`); Stage 4 live validation ran cleanly on the Stage 6 sidecar; Stage 5 guarded save wrote `swedencentral` to `cloudforge_draft.tf` (460 bytes) and refreshed to 4 resources; `0` payload sidecar orphans remained after quit. |
| Silent per-user upgrade install (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`5b02f7db16a` + Rust `c4ffa00`), `consent.json` SHA-256 preserved byte-for-byte (`ee409e0c...`). |

**Remaining next actions:**
1. Push local `main` branches (`Z:\CloudForge` and `Z:\CloudForge-Code`) to `origin/main` when ready. *(Desktop `main` pushed to `origin/main`; Rust `Z:\CloudForge` `main` remains local-only.)*
2. Authenticode signing hook and Stage 3 provider schema snapshot import landed in `70b0f940aad`; package and verify with the matching Rust service build when ready.

### Phase 5 (Desktop): Architecture Layers, Visual Frames, Annotations, Alignment & SVG/PNG/Markdown Export + Stage 6/Phase 5 Installer & Live Smoke (2026-11-23)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (`c05b027706f`, fast-forwarded to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Architecture layers & presentation-only organisation ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [layout.ts](extensions/cloudforge/src/canvas/layout.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Added 5-layer classification (`Infrastructure`, `Platforms`, `Applications`, `Security`, `Operations`) with persisted `hiddenLayers` toggles inside the `View` popover and a contextual header chip showing hidden layers or hidden validation findings (`Show all` restore).
  - Added persisted **Visual Frames** (`CanvasFrame`: create/wrap selection, rename, accent color cycle, drag with contained nodes, delete without touching Terraform semantics), **Sticky Annotations** (`CanvasAnnotation`: draggable, editable, color-coded notes), **drag-and-snap node positioning** (16px grid snap + live magnetic alignment guide lines, persisted per mode in `nodePositions` outside semantic undo history, with `Reset Auto-Layout`), and a contextual bottom-center **Multi-Selection Toolbar** (`Shift+Click`/`Ctrl+Click` -> `Align Left`, `Align Top`, `Center Y`, `Distribute`, `Wrap Frame`, `Clear`).
- **Offline Diagram & Architecture Report Export ([exportDiagram.ts](extensions/cloudforge/src/canvas/exportDiagram.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json)):**
  - Added pure offline `renderArchitectureSvg` and `renderArchitectureMarkdownReport` supporting `Full Architecture`, `Selection`, and named `Frame` scopes, `Light`/`Dark` themes, optional validation badges, annotations, Stage 6 provider dependency lock tables, and revision provenance footers.
  - Added offline 2× Retina PNG rasterization in the Webview and trusted `exportArtifact` save routing through `window.showSaveDialog` + `workspace.fs.writeFile` (plus `cloudforge.exportCanvas` / `Ctrl+Shift+E` and `View -> Export Diagram / Report…`).

| Artifact or check | Verified result |
| --- | --- |
| Unit tests, TS 6 & TS 7, esbuild, oxlint, hygiene (`c05b027706f`) | **43/43** extension tests passed (`0` skipped; includes 4 new [phase5Canvas.test.ts](extensions/cloudforge/test/phase5Canvas.test.ts) suites), TS 6 & TS 7 clean on extension & webview, `esbuild.mts` + `esbuild.webview.mts` clean, `oxlint` & `build/hygiene.ts` clean (`0` errors/warnings). |
| Live Edge Playwright Phase 5 check (`phase5-verify.mjs`) | **6/6 passed**, 0 console/page errors (`headerHeight: 44`, `svgChars: 7456`, `pngBase64Chars: 273088`; screenshots inspected). |
| Windows x64 installer (`c05b027706f` + Rust Stage 6 `c4ffa00`) | [CloudForgeProofSetup-x64-c05b027706f.exe](Z:/CFStage/CloudForgeProofSetup-x64-c05b027706f.exe), unsigned, `321,856,635` bytes, SHA-256 `5618829753d18e5aab4fcb26177eef9035fe13e9215931d2bd02eecaa29053d6`; Rust `c4ffa00981d3505e965faf9749bde5fded1fbdc4` (`3,078,144` bytes, SHA-256 `7aa6005e7555b1dcc689fccf0d6907dae07eb874c88005412e22302adc811070`), VSIX `7accf785...`. |
| Payload hygiene & manifest verify | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed on built payload and installed app. |
| Live Stage 6 + Phase 5 packaged-desktop smoke ([stage6-phase5-smoke.mjs](Z:/CFStage/smoke/stage6-phase5-smoke.mjs), [report-stage6-phase5-c05b027706f.json](Z:/CFStage/smoke/report-stage6-phase5-c05b027706f.json)) | **6/6 passed** (`01-stage6-providers-locks.png`, `02-phase5-frames-notes-layers.png`, `03-phase5-export-modal.png` inspected): auto-opened `LandingZone` (4 resources); live Stage 6 `inspectDependencies` displayed `Providers & locks` (`terraform (inferred) · lock valid`, `hashicorp/azurerm`, `locked 5.14.0`); live Stage 6 `listCloudRegions` hydrated `25` Azure regions into the `location` picker; Phase 5 multi-select `Wrap Frame`, Sticky Note, and `Security` layer hide/restore verified; Phase 5 Export modal rendered live SVG preview + Markdown report containing `hashicorp/azurerm` `5.14.0`; `0` payload `cloudforge-service.exe` orphans remained after quit. |
| Silent per-user upgrade install (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`c05b027706f` + Rust `c4ffa00`), `tsconfig.typecheck.tsbuildinfo` absent, `consent.json` preserved. |

**Remaining next actions:**
1. **Phase 6 (Modules, Reusable Patterns & Scale):** add Terraform module drill-down with breadcrumb navigation, typed module input/output inspection, reusable starter architecture templates (e.g., Azure Hub-Spoke Network), and bounded group pagination/level-of-detail for large graphs.
2. **Release & cross-repo backlog:** push local `Z:\CloudForge` `main` to `origin/main` when ready; package `70b0f940aad` (Authenticode signing hook + Stage 3 provider schema snapshot import) once paired with its matching Rust service revision.

### Authenticode Signing Hook, Stage 3 Provider Schema Snapshot Import & Combined Packaging (2026-11-23)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (`70b0f940aad`, fast-forward merged into `Z:\CloudForge-Code` `main` and pushed to `origin/main`). Pairs end-to-end with Rust `Z:\CloudForge` `main` (`bf2978d`, service revision `18f6ce6410cf09e21c6952151eb09752fc4d7c28`, `3,198,976` bytes, SHA-256 `03ef9f7cff2c613556e3b4b5f92ead5b0ac787db7b81ddaf83e20f708b9205e4`, pushed to `origin/main`).

- **Optional Authenticode service signing ahead of `serviceArtifact.ts --verify` ([package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1), [service-artifact.md](docs/cloudforge/service-artifact.md)):**
  - Added optional `-SignCertificateThumbprint` (`40-hex SHA-1`), `-SignTimestampUrl` (default `https://timestamp.digicert.com`), and `-RequireSignedService`.
  - When `-SignCertificateThumbprint` is provided, verifies the input `-ServiceSha256`, copies `cloudforge-service.exe` to a temporary file, runs `signtool.exe sign /fd SHA256 /sha1 <thumbprint> /tr <timestampUrl> /td SHA256`, verifies `(Get-AuthenticodeSignature).Status -eq 'Valid'`, recomputes the post-sign SHA-256, and passes those final signed bytes and digest to both `serviceArtifact.ts` and the pre-Inno `serviceArtifact.ts --verify` gate (cleaning up the temp copy in `finally` and reporting `ServiceSigned` in output JSON). Unsigned proof builds remain unchanged when omitted; `-RequireSignedService` fails fast on unsigned binaries.
- **Stage 3 Provider Schema Snapshot Import broker & command ([cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts), [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts), [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts), [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [extension.ts](extensions/cloudforge/src/extension.ts)):**
  - Wired `inspectCatalogueSchemaFile` (extension sends `{}`; Electron main opens native `.json` picker, rejects UNC/non-local paths with `SCOPE_DENIED`, returns `CANCELLED` if dismissed, passes `{ schemaPath }` to Rust) and `importCatalogueSnapshot` (strict validation of `previewId`, 3-segment `address`, `version`, `engineName`, `engineVersion`).
  - Added **CloudForge: Import Provider Schema Snapshot…** (`cloudforge.importProviderSchema`) command that inspects a chosen `providers schema -json` file, pre-fills version from any adjacent `.terraform.lock.hcl`, publishes the verified snapshot into `<service_data_dir>/catalogue`, clears cached schemas, and refreshes the Architecture Canvas.

| Artifact or check (run on `70b0f940aad` + Rust `18f6ce6`) | Verified result |
| --- | --- |
| PowerShell AST parse & `-RequireSignedService` guardrail | AST OK (`1059` tokens); `-RequireSignedService` exited `1` with clear `NotSigned` error against unsigned `cloudforge-service.exe`. |
| `build/hygiene.ts` & `build/oxlint.ts` (all 9 changed files) | Passed (`0` errors, `0` warnings). |
| `node --test build/lib/test/cloudforgeServiceArtifact.test.ts` | **73/73 passed**. |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit`, `esbuild.mts`, `esbuild.webview.mts`, `node --test extensions/cloudforge/test/*.test.ts` | **43/43 extension tests passed** (`0` skipped). |
| `node build/next/index.ts transpile` & `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts --run src/vs/code/test/electron-main/cloudForgeService.test.ts` | **42/42 Electron-main tests passed**. |
| Windows x64 installer (`70b0f940aad` + Rust `18f6ce6`) | [CloudForgeProofSetup-x64-70b0f940aad.exe](Z:/CFStage/CloudForgeProofSetup-x64-70b0f940aad.exe), unsigned (`ServiceSigned: false`), `321,898,996` bytes, SHA-256 `8188a8b00a7cdc9df1c7db5208ed8f048ec1bfd4da47e077844cb8ee4e1fa8ce`; Rust `18f6ce6410cf09e21c6952151eb09752fc4d7c28` (`03ef9f7c...`), VSIX `7accf785...`. |
| Payload hygiene & `serviceArtifact.ts --verify` | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed. |
| Live packaged-desktop smoke ([stage6-smoke.mjs](Z:/CFStage/smoke/stage6-smoke.mjs), [report-stage6-70b0f940aad.json](Z:/CFStage/smoke/report-stage6-70b0f940aad.json)) | **5/5 passed** (`01-stage6-inspector-providers.png` inspected): Stage 6 `inspectDependencies` (`Providers & locks`, `terraform (inferred) · lock valid`, `locked 5.14.0 · 2 requirements`, `1 unused lock entry.`), Stage 6 `listCloudRegions` (24 Azure regions incl. `swedencentral` & `australiaeast`), Stage 4 live validation, Stage 5 guarded save with `swedencentral`, and `0` sidecar orphans after quit. |
| Per-user installed upgrade (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Deferred because an existing `CloudForge Proof.exe` desktop session was open during verification (Inno exited `1` safely without interrupting the open app; `consent.json` SHA-256 `ee409e0c...` untouched). Close `CloudForge Proof.exe` and run `CloudForgeProofSetup-x64-70b0f940aad.exe` to upgrade the installed app. |

**Next actions:**
1. Close any open `CloudForge Proof.exe` window and run `Z:\CFStage\CloudForgeProofSetup-x64-70b0f940aad.exe` to upgrade `%LOCALAPPDATA%\Programs\CloudForge Proof` to the combined Phase 5 + Stage 6 + Stage 3 schema import build.
2. When a Windows code-signing certificate is installed on the build host, pass `-SignCertificateThumbprint <40-hex>` (and optionally `-RequireSignedService`) to `build/cloudforge/package-win32-x64.ps1` for signed releases.
3. Proceed to **Phase 6 (Modules, Reusable Patterns & Scale)**: Terraform module drill-down with breadcrumb navigation, typed module input/output inspection, reusable starter architecture templates, and bounded group pagination/LOD for large graphs.

### Stage 7 Live Child Module Drill-Down & Typed I/O Integration (`readModule`, 2026-11-23)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (`86478d200cb`, fast-forward merged into `Z:\CloudForge-Code` `main` cleanly on top of Phase 6/7 `65941d7d4ae`). Pairs end-to-end with Rust `Z:\CloudForge` Stage 7 service revision `ad360e3eca5b5c4209931baba21e3369587092ba` (`3,351,552` bytes, SHA-256 `7580b16aae7dfd89d72b5e0cc4bf037365607758683328593343c93533298ec2`, archived at `Z:\CFStage\service-ad360e3\cloudforge-service.exe`).

- **Electron-main broker & Workbench bridge ([cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts), [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts), [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts), [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts)):**
  - Wired `readModule` (`{ workspaceId, architectureId, expectedSourceRevision?, modulePath: string[] }`) with active-window scope enforcement and strict `1..=8` safe identifier validation on `modulePath` (zero filesystem paths).
- **Live child module boundary & nested drill-down ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [serviceAdapters.ts](extensions/cloudforge/src/canvas/serviceAdapters.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css), [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts)):**
  - Upgraded the Phase 6 `Module boundary view` overlay to request live Rust Stage 7 `readModule` data on open and nested drill-down, displaying clickable multi-level breadcrumbs (`architecture / module.net / module.sub`), declared `variable` blocks (`typeExpr`, `passed`/`required`/`optional`, `sensitive`), declared `output` blocks (`sensitive`, description), declared child module resources, clickable nested local child modules, and honest read-only summaries for external registry/git modules (with URL credentials stripped by Rust).

| Check (run on `86478d200cb`) | Verified result |
| --- | --- |
| `build/hygiene.ts` (11 files) & `build/oxlint.ts` (10 files) | Passed (`0` errors, `0` warnings). |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit` & `tsc -p extensions/cloudforge/canvas-src/tsconfig.json --noEmit` | Passed (`0` errors). |
| `node --test extensions/cloudforge/test/*.test.ts` | **48/48 extension tests passed** (`0` skipped; includes Phase 5, Phase 6/7, and Stage 3–7 adapter suites). |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Passed (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css`). |
| `node build/next/index.ts transpile` & `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts --run src/vs/code/test/electron-main/cloudForgeService.test.ts` | **42/42 Electron-main tests passed**. |

**Remaining next action:**
- Once the sibling session's packaging run in `Z:\CFStage` completes, package `86478d200cb` (Phase 6/7 + Stage 7 `readModule` UI) together with Rust Stage 7 `ad360e3` (`Z:\CFStage\service-ad360e3\cloudforge-service.exe`, SHA-256 `7580b16aae7dfd89d72b5e0cc4bf037365607758683328593343c93533298ec2`) and run a live packaged-desktop smoke verifying nested local module drill-down and typed I/O.

### Stage 8 Broker & Adapter Wiring: Schema Upgrade Impact Diff & Reproducible Export Audit (2026-11-23)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (`6476cd0ecd3`, fast-forward merged into `Z:\CloudForge-Code` `main` cleanly on top of Phase 8/9 `bb85491fa81`). Pairs with Rust `Z:\CloudForge` Stage 8 service revision `a75edf0f42745c57afcaa0df0474b4d2d82f8bbf` (`3,527,680` bytes, SHA-256 `0e1e8d3fa4a472133d6465e6436c9848f756fc8893b74bf72defa1ed640f7767`, archived at `Z:\CFStage\service-a75edf0\cloudforge-service.exe`).

- **Electron-main broker & Workbench bridge ([cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts), [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts), [cloudForgeService.contribution.ts](src/vs/workbench/electron-browser/cloudForgeService.contribution.ts), [cloudForgeServiceChannel.test.ts](src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts)):**
  - Added strict parameter & active-window scope validation for `diffCatalogueSnapshots` (validated `fromKey`/`toKey`, optional paired `workspaceId`/`architectureId` + `expectedSourceRevision`) and `auditExportReadiness` (active scope, optional `expectedSourceRevision` and `engine: "openTofu" | "terraform"`). Zero filesystem paths.
- **Pure-TS adapters ([serviceAdapters.ts](extensions/cloudforge/src/canvas/serviceAdapters.ts), [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts)):**
  - Added `parseSchemaDiffReport` and `parseExportAuditReport` ready to bind directly into Phase 8 plan/policy/approval review UI.

| Check (run on `6476cd0ecd3`) | Verified result |
| --- | --- |
| `build/hygiene.ts` (6 files) & `build/oxlint.ts` (6 files) | Passed (`0` errors, `0` warnings). |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit` & `node --test extensions/cloudforge/test/*.test.ts` | **52/52 extension tests passed** (`0` skipped). |
| `node extensions/cloudforge/esbuild.mts`, `node build/next/index.ts transpile`, & `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts --run src/vs/code/test/electron-main/cloudForgeService.test.ts` | **42/42 Electron-main tests passed**. |

**Next actions:**
1. Once `Z:\CFStage` is idle, package desktop `main` (`6476cd0ecd3`+) with Rust Stage 8 `a75edf0` (`Z:\CFStage\service-a75edf0\cloudforge-service.exe`), run live Stage 8 smoke, and silently upgrade `%LOCALAPPDATA%\Programs\CloudForge Proof`.
2. Surface live `auditExportReadiness` and `diffCatalogueSnapshots` results inside the Phase 8 Plan & Policy Review modal.

### Phases 6–9 (Desktop): Patterns, Module Drill-Down/Extract, Checkpoints/Experiments, Plan/Policy/Cost/Approval & Explain/Recipes/Playback + Stage 7 Combined Installer & Live Smoke (2026-11-23)

Completed on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (`65941d7d4ae` for Phases 6–7 and `bb85491fa81` for Phases 8–9, fast-forwarded to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Phase 6 — Modules, Reusable Patterns & Scale ([patterns.ts](extensions/cloudforge/src/canvas/patterns.ts), [draftDocument.ts](extensions/cloudforge/src/canvas/draftDocument.ts), [layout.ts](extensions/cloudforge/src/canvas/layout.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Added versioned, schema-backed **Starter Architecture Patterns** (`Azure Hub Network`, `Azure Secure Spoke`, `Azure Edge Perimeter`) inserted as a single atomic undoable `insertPattern` edit (generating valid Terraform HCL ready for Stage 5 guarded save) via `+ Add` and the Empty Architecture welcome card.
  - Added **Module Boundary Drill-Down** with breadcrumb navigation and `← Back to Parent` focus/selection restoration (upgraded by Stage 7 `86478d200cb` with live Rust `readModule` nested child-module inspection and typed I/O), read-only **Extract-to-Module** refactoring preview (`module` call, `moved {}` state migration blocks, `variables.tf`, `outputs.tf`), **LOD (`full | compact | minimal`)**, and bounded **group pagination** pinning selected/finding nodes.
- **Phase 7 — Checkpoints, Semantic Compare, Experiments & Sample Context ([history.ts](extensions/cloudforge/src/canvas/history.ts), [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts)):**
  - Added bounded **Named Checkpoints** (`Ctrl+Shift+H` / `View -> History & Experiments…`), **Semantic Graph Diff**, one-click **Restore** (automatically saving an `"Auto-backup before restore"` checkpoint first), **Isolated Local Design Experiments** (compare, promote, or discard without touching disk/credentials), and **Pinned Sample Validation Contexts** with explicit freshness detection (`CURRENT` vs `STALE`) surfaced in the header and Runner Timeline.
- **Phase 8 — Full-Root Plan Review, Policies, Cost Estimates & Context-Bound Approval ([planReview.ts](extensions/cloudforge/src/canvas/planReview.ts)):**
  - Added **Plan, Policy, Cost & Recipes** modal (`Ctrl+Shift+R` / `View -> Plan, Policy & Recipes…`) with honest full-root **Offline Draft Preview** plus optional sanitized `terraform show -json` CLI plan import (never retaining sensitive literals), deterministic offline security/governance/provider-lock **Policies** (`CF-SEC-001`, `CF-SEC-002`, `CF-GOV-001`, `CF-DEP-001`), transparent **Estimated Monthly Cost & Delta** (explicitly marking uncatalogued types as `Unknown`), and **Context-Bound Approval** tied to `planFingerprint` + `baseSourceRevision` (requiring explicit acknowledgement for replacements/deletions and invalidating immediately on any edit).
- **Phase 9 — Explain Resource Advisor, Workflow Recipes & Simulated Run Playback ([advisorRecipes.ts](extensions/cloudforge/src/canvas/advisorRecipes.ts)):**
  - Added offline **Explain Resource** modal (from Inspector `Explain`) with explicit data-scope disclosure, schema provenance, transitive blast radius, cost estimate, and clickable **Apply to Draft** advisor proposals (`cloudforge-advisor`, entering normal undo/validation/guarded-save flow).
  - Added **Reusable Workflow Recipes** (`Standard Static Validation`, `Security & Cost Readiness`, `Full Deployment Review Pipeline`) with per-step status and `Select N resource(s)` canvas highlighting, plus **Simulated Run Playback** (`Prev / Play / Pause / Next`) in the Runner Timeline.

| Artifact or check | Verified result |
| --- | --- |
| Unit tests, TS 6 & TS 7, esbuild, oxlint, hygiene (`65941d7d4ae` & `bb85491fa81`) | **51/51** extension tests passed on `bb85491fa81` (`0` skipped; includes [phase67Canvas.test.ts](extensions/cloudforge/test/phase67Canvas.test.ts) and [phase89Canvas.test.ts](extensions/cloudforge/test/phase89Canvas.test.ts)); TS 6 & TS 7 clean on extension & webview; `esbuild.mts` + `esbuild.webview.mts` clean; `oxlint` & `build/hygiene.ts` clean (`0` errors/warnings). |
| Live Edge Playwright checks (`phase67-verify.mjs`, `phase89-verify.mjs`) | **6/6** (Phases 6–7) and **6/6** (Phases 8–9) passed with 0 console/page errors; all 6 visual screenshots inspected. |
| Phases 6–7 installer & live smoke (`65941d7d4ae` + Rust `18f6ce6`) | [CloudForgeProofSetup-x64-65941d7d4ae.exe](Z:/CFStage/CloudForgeProofSetup-x64-65941d7d4ae.exe) (`321,897,895` bytes, SHA-256 `0afb14aa84f88a1a39180cea9430e56ddee5cd802f71c0473e36eab03849658c`); [phase67-smoke.mjs](Z:/CFStage/smoke/phase67-smoke.mjs) ([report-phase67-65941d7d4ae.json](Z:/CFStage/smoke/report-phase67-65941d7d4ae.json)) **5/5 passed** (module drill-down, starter pattern -> live Stage 5 guarded save writing `cloudforge_draft.tf` 1,274 bytes & refreshing to 8 clean resources, checkpoints/experiment/sample context, 0 sidecar orphans). |
| Combined Stages 1–7 + Phases 1–9 installer (`bb85491fa81` + Rust Stage 7 `ad360e3`) | [CloudForgeProofSetup-x64-bb85491fa81.exe](Z:/CFStage/CloudForgeProofSetup-x64-bb85491fa81.exe), unsigned (`ServiceSigned: false`), `321,983,992` bytes, SHA-256 `4d4e25b5758eeeab2d46c69a8da1617f3eb7400e26727b6b9932746455ac7019`; Rust Stage 7 `ad360e3eca5b5c4209931baba21e3369587092ba` (`3,351,552` bytes, SHA-256 `7580b16aae7dfd89d72b5e0cc4bf037365607758683328593343c93533298ec2`), VSIX `7accf785...`. |
| Payload hygiene & manifest verify | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed on built payload and installed app. |
| Live Stage 7 + Phases 8–9 packaged-desktop smoke ([stage7-phase89-smoke.mjs](Z:/CFStage/smoke/stage7-phase89-smoke.mjs), [report-stage7-phase89-bb85491fa81.json](Z:/CFStage/smoke/report-stage7-phase89-bb85491fa81.json)) | **7/7 passed** (`01-stage7-live-readmodule.png`, `02-stage7-nested-module.png`, `03-phase89-plan-recipes.png` inspected): auto-opened `ProdPlatform`; live Stage 7 `readModule` inspected `module.network` (`location`/`resource_group_name` vars `string \| passed`, `vnet_id` output, `core` & `subnets` child resources) and drilled into nested `ProdPlatform / module.network / module.subnets` (`workload_subnet_id`); Phase 9 Explain Resource displayed scope disclosure + `$3.65` estimate and applied advisor proposal; Phase 8/9 Plan Review approved exact plan fingerprint and reflected approval in Workflow Recipes & header; Phase 9 Simulated Run Playback scrubbed retained validation events; `0` payload `cloudforge-service.exe` orphans remained after quit. |
| Silent per-user upgrade install (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`bb85491fa81` + Rust Stage 7 `ad360e3`), `tsconfig.typecheck.tsbuildinfo` absent, `consent.json` preserved. |

**Remaining next actions:**
1. Wire live Stage 8 `auditExportReadiness` and `diffCatalogueSnapshots` (broker + adapters landed in `6476cd0ecd3`) into the Phase 8 Plan & Policy Review modal and package with Rust Stage 8 `a75edf0`.
2. When ready for signed releases, pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` to `build/cloudforge/package-win32-x64.ps1`.

### Stage 8 Live Plan & Policy Review UI + Combined Stages 1–8 / Phases 1–9 Installer, Live Smoke & Installed Upgrade (2026-11-23)

Implemented on `fxrazor/auto-open-and-stage3-4` in `Z:\CloudForge-Code\.claude\worktrees\auto-open-stage3-4` (`00e91c5dbc51f51e26ad5c2029c0a5abc5e91bd5`, rebased and fast-forward merged cleanly into `Z:\CloudForge-Code` `main`). Packaged end-to-end with Rust `Z:\CloudForge` Stage 8 service revision `a75edf0f42745c57afcaa0df0474b4d2d82f8bbf` (`3,527,680` bytes, SHA-256 `0e1e8d3fa4a472133d6465e6436c9848f756fc8893b74bf72defa1ed640f7767`).

- **Live Stage 8 UI wiring ([protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [serviceAdapters.ts](extensions/cloudforge/src/canvas/serviceAdapters.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [serviceAdapters.test.ts](extensions/cloudforge/test/serviceAdapters.test.ts)):**
  - Auto-fetches `auditExportReadiness` alongside `inspectDependencies` on architecture load and renders **Reproducible Export & Lock Audit** (`Reproducible` vs `Unresolved (N)`, engine, lock file state/entry count, module count, and unresolved reason badges) inside `Plan Review, Policy, Cost & Recipes -> Policies`.
  - Adds **Provider Schema Upgrade Impact** inside `Policies`, automatically surfacing provider/version selectors and **Check Upgrade Impact** (`requestSchemaDiff` -> Rust `diffCatalogueSnapshots`, showing added/removed type counts, path changes, breaking impact badge, and impacted architecture items) whenever two or more versions of a provider schema are imported (or a quiet import hint otherwise).

| Artifact or check (run on `00e91c5dbc5` + Rust Stage 8 `a75edf0`) | Verified result |
| --- | --- |
| `build/hygiene.ts` & `build/oxlint.ts` (all 6 changed files) | Passed (`0` errors, `0` warnings). |
| `tsc -p extensions/cloudforge/tsconfig.json --noEmit`, `tsc -p extensions/cloudforge/canvas-src/tsconfig.json --noEmit`, `esbuild.mts`, `esbuild.webview.mts` | Passed (`0` errors). |
| `node --test extensions/cloudforge/test/*.test.ts` | **52/52 extension tests passed** (`0` skipped). |
| `node build/next/index.ts transpile` & `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts --run src/vs/code/test/electron-main/cloudForgeService.test.ts` | **42/42 Electron-main tests passed**. |
| Combined Stages 1–8 + Phases 1–9 Windows x64 installer | [CloudForgeProofSetup-x64-00e91c5dbc5.exe](Z:/CFStage/CloudForgeProofSetup-x64-00e91c5dbc5.exe), unsigned (`ServiceSigned: false`), `322,015,352` bytes, SHA-256 `2c6bf44b3d24b250b8e2bfc1287f2add51a42cf8399a45c5fe958e251e284982`; Rust Stage 8 `a75edf0f42745c57afcaa0df0474b4d2d82f8bbf` (`0e1e8d3f...`), VSIX `7accf785...`. |
| Payload hygiene & `serviceArtifact.ts --verify` | `media/canvas.js` & `media/canvas-style.css` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed on built payload and installed app. |
| Live Stage 8 + Stage 7 packaged-desktop smoke ([stage8-smoke.mjs](Z:/CFStage/smoke/stage8-smoke.mjs), [report-stage8-00e91c5dbc5.json](Z:/CFStage/smoke/report-stage8-00e91c5dbc5.json)) | **6/6 passed** (`01-stage8-policy-audit.png` & `02-stage7-nested-module.png` inspected): live Stage 8 `auditExportReadiness` rendered `Reproducible Export & Lock Audit`, `Unresolved (2)`, `Engine: terraform (inferred) · Lock file: valid (1 entry) · Modules: 3`, `missingLockHashes` + `partialScan`, and `Provider Schema Upgrade Impact`; Stage 6 `inspectDependencies` rendered `Providers & locks`; Stage 7 `readModule` inspected `module.net` (zero secrets) and nested 2-level `stage8-tf / module.net / module.sub` (`azurerm_subnet`); Stage 4 live validation completed on the Stage 8 sidecar; `0` payload `cloudforge-service.exe` orphans remained after quit. |
| Silent per-user upgrade (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`00e91c5dbc5` + Rust Stage 8 `a75edf0`), `tsconfig.typecheck.tsbuildinfo` absent, `consent.json` SHA-256 `ee409e0c...` preserved. |

**Next actions:**
1. When ready for signed releases, install a Windows Authenticode certificate on the build host and pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` to `build/cloudforge/package-win32-x64.ps1`.
2. Proceed to the next approved roadmap milestone (e.g., Stage 9 managed Terraform/OpenTofu engine execution & live `terraform plan -json` capture, or AI Builder / Projects & Template Library from `Z:\CloudForge\design.md`).

### Offline Multi-Cloud Template Library, Multi-Target IaC Generators, Status Bar & Clickable Diagnostics + Combined Stage 9A Installer, Live Smoke & Installed Upgrade (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (`407d56014c1d964e2697a724d07a89f6c3e989dd`, rebased cleanly onto Stage 9A `0fb2a7fad750eece606a729af21213df02070ef5`, fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Offline Multi-Cloud Template Library ([templateLibrary.ts](extensions/cloudforge/src/canvas/templateLibrary.ts), [controller.ts](extensions/cloudforge/src/project/controller.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Added 6 offline multi-cloud starter templates (`Azure Hub Network`, `Azure Secure Workload Spoke`, `Azure Edge Perimeter`, `AWS Two-Tier VPC Foundation`, `Google Cloud Custom VPC & Firewall`, `Kubernetes App Namespace & Policy`) with CSP-safe SVG mini-topology thumbnails, search, provider filter, sort, HCL preview, **Create New Architecture…** (`architectures/<name>/main.tf` + marker), and **Insert into Current Draft** (atomic undoable edit).
  - Accessible from Command Palette (`CloudForge: Browse Template Library…`), `CloudForge Project` view title (`$(library)`), Canvas `View -> Template Library…`, `Ctrl+Shift+T`, and the empty canvas welcome state.
- **Multi-Target IaC Generators ([generators.ts](extensions/cloudforge/src/canvas/generators.ts), [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts)):**
  - Upgraded the `Export Architecture` modal with a **Generate IaC** tab supporting **Azure Bicep (`.bicep`)**, **Azure ARM JSON (`.json`)**, **AWS CloudFormation YAML (`.yaml`)**, and **Kubernetes YAML (`.yaml`)** with deterministic draft attribute overrides, explicit mapped/unmapped counts, provenance, honest loss notes, and `Save Export…` file dialog filters. Fixed modal tab vertical collapse across all modals via `.cf-modal-body > * { flex-shrink: 0; }`.
- **Native Workbench Status Bar & Clickable Diagnostics ([extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts)):**
  - Added a native Workbench Status Bar item (`$(type-hierarchy) CloudForge: <name> · rev <8-hex>`) clicking through to `cloudforge.openCanvas` and kept in sync across open/refresh/save/clear.
  - Upgraded Inspector Diagnostics with clickable `Reveal <name> on Canvas` buttons that automatically unhide hidden layers, expand collapsed groups, clear filters if needed, and select + pan/zoom to the matching node.

| Artifact or check (run on `407d56014c1` + Rust Stage 9A `ef4be9d`) | Verified result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **57/57 extension tests passed** (`0` skipped; includes [templateAndGenerators.test.ts](extensions/cloudforge/test/templateAndGenerators.test.ts) and Stage 9A `serviceAdapters.test.ts`). |
| TS 6 (`tsc6.cmd`) & TS 7 (`tsc.cmd`) on `extensions/cloudforge/tsconfig.json` & `canvas-src/tsconfig.json` | Passed (`0` errors). |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Passed (`dist/extension.js`, `media/canvas.js`, `media/canvas-style.css`). |
| `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` (all 9 changed/new files) | Passed (`0` errors, `0` warnings). |
| Live Edge Playwright UI check (`templates-generators-verify.mjs`) | Passed with `0` console/page errors; 3 screenshots visually inspected (caught and fixed `.cf-modal-body > .cf-segmented` vertical squish). |
| Combined Stage 9A + Templates/Generators Windows x64 installer | [CloudForgeProofSetup-x64-407d56014c1.exe](Z:/CFStage/CloudForgeProofSetup-x64-407d56014c1.exe), unsigned (`ServiceSigned: false`), `322,068,682` bytes, SHA-256 `871d6d38804ca40859c2d436857da8f4a7bbf965384752ec318737619e443c11`; Rust Stage 9A `ef4be9d09b0b2ddf504ea1bb31172c116c72da19` (`3,670,016` bytes, SHA-256 `2a9954d61776602d74471e1d638ed86c14b404c1ed5139b1424a4db22eef03db`), VSIX `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897`. |
| Payload hygiene & `serviceArtifact.ts --verify` | 6/6 hygiene checks passed (`media/canvas.js`, `media/canvas-style.css`, `dist/extension.js` present; `studio/`, `canvas-src/`, `tsconfig.typecheck.tsbuildinfo` absent); `serviceArtifact.ts --verify` passed on built payload and installed app. |
| Live packaged-desktop smoke ([stage9a-templates-smoke.mjs](Z:/CFStage/smoke/stage9a-templates-smoke.mjs), [report-stage9a-407d56014c1.json](Z:/CFStage/smoke/report-stage9a-407d56014c1.json)) | **5/5 passed** (`01-packaged-templates-gallery.png`, `02-packaged-export-iac-bicep.png` inspected): native Status Bar rendered `CloudForge: stage9a-tf · rev 39d3523f`; Stage 4 live validation + Stage 9A Runner Timeline surfaced `tofu 1.13.9` and `terraform 1.15.8` on `ef4be9d`; Command Palette opened the 6-template offline gallery and inserted `Azure Secure Workload Spoke` (`3 -> 8` nodes); Multi-Target IaC Generator rendered `Azure Bicep: 8 mapped, 0 unmapped` and valid ARM JSON; `0` payload `cloudforge-service.exe` orphans remained after quit. |
| Live Stage 9A `CLI Validate` packaged-desktop smoke ([stage9a-smoke.mjs](Z:/CFStage/smoke/stage9a-smoke.mjs), [report-stage9a-cli-validate-407d56014c1.json](Z:/CFStage/smoke/report-stage9a-cli-validate-407d56014c1.json)) | **5/5 passed** (`01-stage9a-cli-validate.png` inspected): detected `tofu 1.13.9` & `terraform 1.15.8` under Electron-main's scrubbed no-`PATH` sidecar, executed live `OpenTofu 1.13.9 validate -json` (`Valid (126ms)`, zero OS paths), passed Stage 4 offline validation & Stage 8 `Reproducible Export & Lock Audit`, and left `0` payload `cloudforge-service.exe` orphans after quit. |
| Silent per-user upgrade (`%LOCALAPPDATA%\Programs\CloudForge Proof`) | Exit code `0`; installed `serviceArtifact.ts --verify` passed (`407d56014c1` + Rust Stage 9A `ef4be9d`), `tsconfig.typecheck.tsbuildinfo` absent. |

**Next actions:**
1. Wire live Stage 9B (`terraform plan -json` / `tofu plan -json` execution) into the Plan Review modal once the Rust sidecar adds guarded plan capture.
2. When ready for signed releases, pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` to `build/cloudforge/package-win32-x64.ps1`.

### Multi-Cloud Schema Authoring, Canvas Copy/Paste & Batch Delete, Native Problems Integration & Accessibility Polish (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). **No unnecessary Windows installer build was triggered** per user instruction; `%LOCALAPPDATA%\Programs\CloudForge Proof` remains verified at `407d56014c1` + Rust Stage 9A `ef4be9d`, and this slice will ship automatically in the next milestone build (e.g., alongside Rust Stage 9B). Zero edits to `extensions/cloudforge/studio/**` or `Z:\CloudForge`.

- **Multi-Cloud Bundled Schemas & `+ Add` Palette ([schemaForm.ts](extensions/cloudforge/src/canvas/schemaForm.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Added bundled offline form schemas, outputs, and HCL previews for **AWS** (`aws_vpc`, `aws_subnet`, `aws_internet_gateway`, `aws_security_group`), **Google Cloud** (`google_compute_network`, `google_compute_subnetwork`, `google_compute_firewall`), and **Kubernetes** (`kubernetes_namespace`, `kubernetes_config_map`, `kubernetes_network_policy`) alongside the 6 Azure schemas, grouped cleanly inside `+ Add` with left-aligned horizontal provider rows.
- **Atomic Copy/Paste & Batch Delete ([draftDocument.ts](extensions/cloudforge/src/canvas/draftDocument.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts)):**
  - Added `copySelectionToClipboard`, `pasteClipboardEdit`, and `deleteResources` in `draftDocument.ts` plus `Ctrl+C` / `Ctrl+V` (preserving drafts & internal edges, generating unique names, offsetting pasted positions by `(+36, +36)`), `Delete` / `Backspace`, multi-selection toolbar `Copy`/`Delete` buttons, and updated `?` keyboard shortcuts help.
- **Native VS Code Problems Panel & Clickable Stage 9A CLI Diagnostics ([extension.ts](extensions/cloudforge/src/extension.ts), [canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts)):**
  - Added `languages.createDiagnosticCollection('cloudforge')` synced on architecture open/refresh/save/clear and after live Stage 9A `runEngineValidate` runs (mapping severity, file URI, line number, and address code into native Problems).
  - Added clickable `Reveal <name> on Canvas` buttons on matched Stage 9A CLI Validate findings in the Runner Timeline.
- **Responsive Narrow Workspace & High-Contrast Accessibility ([canvas-src/index.ts](extensions/cloudforge/canvas-src/index.ts), [canvas-src/canvas.css](extensions/cloudforge/canvas-src/canvas.css)):**
  - Added narrow-width (`<= 960px`) `Inputs | Parameters | Results` tab switcher in Focused Resource Workspace and `@media (forced-colors: active)` Windows High Contrast styling.

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **60/60 extension tests passed** (`0` skipped; includes [authoringPolish.test.ts](extensions/cloudforge/test/authoringPolish.test.ts)). |
| TS 6 (`tsc6.cmd`) & TS 7 (`tsc.cmd`) on `extensions/cloudforge/tsconfig.json` & `canvas-src/tsconfig.json` | Passed (`0` errors). |
| `node extensions/cloudforge/esbuild.mts` & `node extensions/cloudforge/esbuild.webview.mts` | Passed (`0` errors). |
| `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` (all 6 changed/new files) | Passed (`0` errors, `0` warnings). |
| Live Edge Playwright UI check (`authoring-polish-verify.mjs`) | Passed (`0` console/page errors; multi-cloud `+ Add`, `Ctrl+C`/`Ctrl+V`/`Delete`/`Ctrl+Z`, Stage 9A CLI diagnostic reveal, and narrow 820px workspace tabs verified with 2 screenshots inspected). |

**Next actions:**
1. Wire live Stage 9B (`terraform plan -json` / `tofu plan -json`) once the Rust sidecar adds guarded plan capture, then package one combined installer covering Stage 9B + this authoring polish slice.
2. When ready for signed releases, pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` to `build/cloudforge/package-win32-x64.ps1`.

### Infrastructure Studio Preview Merge, Configurator/Workspace Browser Verification & Typed Resource-Attribute Reference Selection (2026-11-25)

Merged `origin/codex/infrastructure-studio-preview` (`f82e0c1200f`) cleanly into `fxrazor/continue-project-handoff-review` (`f23a43d72db`), completed Codex's paused browser verification checklist from [CONFIGURATOR-REFINEMENT-2026-11-25.md](extensions/cloudforge/studio/CONFIGURATOR-REFINEMENT-2026-11-25.md), and delivered the next stage from [NESTING-AND-FEEDBACK-PASS.md](extensions/cloudforge/studio/NESTING-AND-FEEDBACK-PASS.md) (typed resource-attribute reference selection). **No unnecessary Windows installer build was triggered** (`%LOCALAPPDATA%\Programs\CloudForge Proof` remains verified at `407d56014c1` + Rust Stage 9A `ef4be9d`).

- **Completed paused Studio browser verification (`studio-configurator-verify.mjs`, 0 console/page errors, 5 screenshots inspected):**
  - Verified the final **Variable Configurator** at desktop (`1360×860`) and narrow (`760×820`) widths: pinned header & Save/Cancel footer above the fold, body-owned scrolling, effective-value precedence, `bool`/`number`/`list`/`string` + `null`/`0`/empty preservation, invalid Save error focus, sensitivity masking, and return focus on Save/Cancel.
  - Verified **VM (Dark)** and **Resource Group (Light)** focused workspaces, all 4 close paths (**top-right X**, **backdrop click**, **Back**, **Escape**) retaining unapplied variable drafts on reopen, **pointer-down inside -> pointer-up outside** non-dismissal, and independent per-renderer zoom restoration.
- **Typed Resource-Attribute Reference Selection ([ResourceReferencePicker.tsx](extensions/cloudforge/studio/src/ResourceReferencePicker.tsx), [SchemaField.tsx](extensions/cloudforge/studio/src/SchemaField.tsx), [fieldBindings.ts](extensions/cloudforge/studio/src/fieldBindings.ts), [model.ts](extensions/cloudforge/studio/src/model.ts), [resourceHierarchy.ts](extensions/cloudforge/studio/src/resourceHierarchy.ts), [terraformProjection.ts](extensions/cloudforge/studio/src/terraformProjection.ts), [ResourceFields.tsx](extensions/cloudforge/studio/src/ResourceFields.tsx), [ResourceWorkspace.tsx](extensions/cloudforge/studio/src/ResourceWorkspace.tsx), [formDefinition.ts](extensions/cloudforge/studio/src/formDefinition.ts), [diagnostics.ts](extensions/cloudforge/studio/src/diagnostics.ts), [canvasOperations.ts](extensions/cloudforge/studio/src/canvasOperations.ts), [editor-refinement.css](extensions/cloudforge/studio/src/editor-refinement.css)):**
  - Added a `Reference` mode right alongside `Value` and `Variable` (and `Inherited`) in `SchemaField` for any field declaring `refTypes`, constrained by `refTypes`, `refAttr` (default `id`), same-provider exported attributes, sensitivity rules, and cycle detection.
  - Supports both list references (`vm-application.network_interface_ids = [azurerm_network_interface.nic-application.id]`) and scalar/nested-block references (`ip_configuration.subnet_id`), projects derived Technical-view dependency edges distinctly from drawing links, surfaces a **Referenced resources** section in Resource Workspace `Connections`, remaps copied references in `duplicate`, preserves references across sibling HCL edits in `applyTerraformDraft`, and reports truthful missing-resource diagnostics if a target is deleted.

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| `corepack pnpm run check` & `corepack pnpm run build` (in `extensions/cloudforge/studio`) | Passed (`0` errors). |
| `corepack pnpm run test` (in `extensions/cloudforge/studio`) | **66/66 studio tests passed** (`0` skipped; includes [resourceRefs.test.ts](extensions/cloudforge/studio/src/resourceRefs.test.ts)). |
| Headless Edge Playwright verification (`studio-configurator-verify.mjs`) | Passed (`0` console/page errors; Variable Configurator desktop/narrow, VM Dark & RG Light workspaces, all 4 close paths + drag-out non-dismissal + draft retention, per-renderer zoom, and live VM -> NIC typed reference verified with 5 screenshots inspected). |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **60/60 root extension tests passed** (`0` skipped). |

**Next actions:**
1. Wire live Stage 9B (`terraform plan -json` / `tofu plan -json`) once the Rust sidecar adds guarded plan capture, and bridge the verified Studio canvas components (`extensions/cloudforge/studio`) with the Rust service/extension-host Webview boundary (`extensions/cloudforge/src/canvas/protocol.ts`).
2. Package one combined Windows x64 installer once Stage 9B or the Studio Webview integration is ready (pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` for signed releases).

### Studio Extension-Host Webview Bridge, Live Rust `FormSchema` Adapter & Guarded Save Flow (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). **No unnecessary Windows installer build was triggered** (`%LOCALAPPDATA%\Programs\CloudForge Proof` remains verified at `407d56014c1` + Rust Stage 9A `ef4be9d`; `extensions/cloudforge/studio/src/cloudlab-core/` provenance files and `Z:\CloudForge` remain untouched).

- **Live Version-Matched Rust `FormSchema` Adapter ([liveSchema.ts](extensions/cloudforge/studio/src/liveSchema.ts), [formDefinition.ts](extensions/cloudforge/studio/src/formDefinition.ts), [fieldBindings.ts](extensions/cloudforge/studio/src/fieldBindings.ts), [diagnostics.ts](extensions/cloudforge/studio/src/diagnostics.ts), [ResourceFields.tsx](extensions/cloudforge/studio/src/ResourceFields.tsx), [ResourceWorkspace.tsx](extensions/cloudforge/studio/src/ResourceWorkspace.tsx)):**
  - Converts live Rust `FormSchema` payloads (`getResourceFormSchema`) into Studio `AttrDef[]`, `BlockDefinition[]` (`minItems >= 1` -> required, `maxItems` -> cardinality), and exported outputs while preserving curated `cloudlab-core` `refTypes`/`refAttr`/`inherit` rules and clearing the primitive-only schema warning once a live Rust schema is active.
- **Bidirectional `CanvasGraphSnapshot` <-> Studio `Architecture` Adapter & Bottom-Up Container Auto-Layout ([serviceAdapter.ts](extensions/cloudforge/studio/src/serviceAdapter.ts), [serviceAdapter.test.ts](extensions/cloudforge/studio/src/serviceAdapter.test.ts), [model.ts](extensions/cloudforge/studio/src/model.ts)):**
  - Projects sanitized Rust `CanvasGraphSnapshot` nodes (`azurerm_*`, `aws_*`, `google_*`, `module`, generic resources) into Studio's single `Architecture` model while preserving exact opaque Rust node IDs 1:1.
  - Automatically infers most-specific valid infrastructure containment (`Resource Group -> VNet -> Subnet -> VM/NIC`) from graph edges + schema rules, derives explicit typed `resourceRefs` (e.g., `vm.network_interface_ids -> nic.id`) into HCL and Technical-view dependency edges, lays out nested containers bottom-up with zero sibling overlap, and preserves user-positioned coordinates across live `sourceRevision` refreshes.
  - Unifies Rust graph diagnostics, Stage 3/5 `ValidationRun` findings, and Stage 9A CLI `validate -json` findings with provenance badges (`CLI validate`, `Rust service`, `Graph`, `Local`) and Terraform address-to-nodeId resolution.
- **VS Code Webview Protocol Bridge & Two-Step Guarded Save Modal ([webviewBridge.ts](extensions/cloudforge/studio/src/webviewBridge.ts), [DraftSaveDialog.tsx](extensions/cloudforge/studio/src/DraftSaveDialog.tsx), [App.tsx](extensions/cloudforge/studio/src/App.tsx), [VisualTopbar.tsx](extensions/cloudforge/studio/src/VisualTopbar.tsx), [IssuesPanel.tsx](extensions/cloudforge/studio/src/IssuesPanel.tsx), [editor-refinement.css](extensions/cloudforge/studio/src/editor-refinement.css)):**
  - Detects `acquireVsCodeApi` transparently: standalone preview (`pnpm dev`) remains unchanged in sample mode; hosted VS Code Webview mode speaks the canonical `ExtensionToWebviewMessage` / `WebviewToExtensionMessage` protocol (`ready`, `graph`, `selectNode`, `openSource`, `refresh`, `requestSchema`/`liveSchema`, `requestValidation`/`validationRunUpdate`, `detectedEngines`/`requestEngineValidate`/`engineValidateReport`, `requestDraftSavePreview`/`applyDraftSave`, and `exportArtifact`).
  - Adds compact hosted revision badge (`rev <8-hex>` / `Modified`), contextual `Save` button opening `DraftSaveDialog` (requiring an active Rust `previewToken` before `Apply Save`), `Open source` buttons in Inspector & Resource Workspace, and `Validate` / `OpenTofu|Terraform validate` actions in Checks & Validation.

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| `corepack pnpm run check` & `corepack pnpm run build` (in `extensions/cloudforge/studio`) | Passed (`0` errors). |
| `corepack pnpm run test` (in `extensions/cloudforge/studio`) | **70/70 studio tests passed** (`0` skipped; includes [serviceAdapter.test.ts](extensions/cloudforge/studio/src/serviceAdapter.test.ts) with non-overlap container layout, live `FormSchema`, containment/ref inference, CLI/Rust diagnostic unification, and `replace` history reset). |
| Headless Edge Playwright E2E (`studio-host-bridge-verify.mjs`) | **5/5 passed** (`0` console/page errors; standalone `Sample draft` regression, hosted `CanvasGraphSnapshot` load & zero-overlap bottom-up container layout, live `requestSchema` -> `liveSchema` hydration & `openSource`, Stage 9A `OpenTofu validate` finding reveal, and two-step guarded save `Preview -> Apply -> Refresh`; 4 screenshots visually inspected — caught and fixed topbar `.shell-preview.is-hosted` breakpoint & sibling-over-expanded-VNet overlap). |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **60/60 root extension tests passed** (`0` skipped). |

**Next actions:**
1. Wire an opt-in desktop command/setting in `extensions/cloudforge` (e.g., `cloudforge.canvasEngine`: `'classic' | 'studio'` or `CloudForge: Open Studio Canvas (Preview)`) bundling `extensions/cloudforge/studio` into the extension Webview with CSP-safe nonce/asset URIs so users can switch to the live React Flow Studio canvas inside Code OSS without breaking existing packaged-desktop flows.
2. Wire live Stage 9B (`terraform plan -json` / `tofu plan -json`) once the Rust sidecar adds guarded plan capture, then package one combined Windows x64 installer (pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` for signed releases).

### Opt-In Desktop Studio Webview Host (`cloudforge.canvasEngine` & `cloudforge.openStudioCanvas`) + Live Code OSS Verification (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). **No unnecessary Windows installer build was triggered** (`%LOCALAPPDATA%\Programs\CloudForge Proof` remains verified at `407d56014c1` + Rust Stage 9A `ef4be9d`; `Z:\CloudForge` untouched).

- **Opt-In Engine Setting, Command & Seamless Switching ([canvasEngine.ts](extensions/cloudforge/src/canvas/canvasEngine.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [canvasEngine.test.ts](extensions/cloudforge/test/canvasEngine.test.ts)):**
  - Added setting `cloudforge.canvasEngine` (`classic` default, `studio` opt-in) and Command Palette / Graph view overflow command `cloudforge.openStudioCanvas` (`CloudForge: Open Studio Canvas (Preview)`).
  - `CloudForgeCanvasPanel` probes `media/studio/studio.{js,css}` asynchronously (`workspace.fs.stat` — compliant with `local/code-no-sync-fs`), falls back gracefully to Classic Canvas with a warning if Studio assets are not staged, and switches cleanly between `classic` and `studio` in the same editor tab without losing the loaded `graph` or host callbacks.
  - Hardened Studio Webview HTML via `buildStudioWebviewHtml`: `<base href="${studioBaseUri}/">`, `<div id="root"></div>`, strict CSP (`default-src 'none'`, `base-uri`, `img-src ... data: blob:`, `font-src ... data:`, `style-src ... 'unsafe-inline'`, `script-src ... 'nonce-...'`, `connect-src ... data: blob:`, `worker-src ... blob:`, zero `'unsafe-eval'`, zero `'unsafe-inline'` scripts).
- **Slimmed Webview Media Staging & Code OSS Webview Polish ([build.ts](extensions/cloudforge/studio/build.ts), [package.json](extensions/cloudforge/studio/package.json), [.gitignore](extensions/cloudforge/.gitignore), [CodeEditor.tsx](extensions/cloudforge/studio/src/CodeEditor.tsx), [App.tsx](extensions/cloudforge/studio/src/App.tsx), [VisualTopbar.tsx](extensions/cloudforge/studio/src/VisualTopbar.tsx), [editor-refinement.css](extensions/cloudforge/studio/src/editor-refinement.css)):**
  - Added `corepack pnpm run build:webview` (`node build.ts --stage-media`) outputting minified `studio.js`, `studio.css`, fonts, icons, catalogues, and slimmed HCL-only Monaco (`loader.js`, `base/`, `editor/`, `basic-languages/hcl/`) into ignored `extensions/cloudforge/media/studio/` (**653 files, 11.20 MB total** — cutting ~10 MB of unused Monaco languages/locales/sourcemaps).
  - Auto-detects Code OSS `vscode-dark` / `vscode-high-contrast` theme on launch & when `viewState.theme === 'workbench'`, resets VS Code Webview's default 20px body padding (`html, body, #root { margin: 0; padding: 0; }`), explicitly resolves `loader.js` via `document.baseURI`, wraps long status messages cleanly, and shows truthful `Sample preview` pill when no workspace architecture is loaded yet.

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| Studio `check`, `test`, `build`, `build:webview` (`extensions/cloudforge/studio`) | Passed (**70/70 studio tests**, staged `media/studio/` = `11.20 MB`). |
| Extension `esbuild.mts`, `esbuild.webview.mts`, TS6 & TS7, `oxlint`, `hygiene` | Passed (`0` errors, `0` warnings). |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **62/62 root extension tests passed** (`0` skipped; includes [canvasEngine.test.ts](extensions/cloudforge/test/canvasEngine.test.ts)). |
| Live isolated Code OSS desktop verification (via `.agents/skills/launch/scripts/launch.ps1` + `@playwright/cli` over CDP) | **Passed** (`0` CloudForge/Webview console or CSP errors; 4 live Code OSS screenshots inspected — confirmed `bodyPadding: 0px`, `vscode-dark` auto-theme, **147/147** provider icons loaded, `1,110 types` offline Azure 5.14.0 catalogue loaded, live **Monaco HCL editor** rendering 26 highlighted lines under strict CSP, and seamless tab switching back to Classic Canvas; cleaned up isolated profile via `cleanup.ps1`). |

**Next actions:**
1. Optionally wire `build/lib/extensions.ts` / `build/cloudforge/package-win32-x64.ps1` to run `studio` `build:webview` automatically before packaging when ready to ship Studio Preview in the Windows installer (keeping `cloudforge.canvasEngine` default `classic` until full parity is verified).
2. Wire live Stage 9B (`terraform plan -json` / `tofu plan -json`) once the Rust sidecar adds guarded plan capture, then package one combined Windows x64 installer covering Stage 9B + Studio Preview.

### Studio Automated Packaging Pipeline (`esbuild.webview.mts` & `package-win32-x64.ps1`) + Live Desktop Service Parity (`viewState`, Stages 6–8) (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). **No unnecessary Windows installer build was triggered** (`%LOCALAPPDATA%\Programs\CloudForge Proof` remains verified at `407d56014c1` + Rust Stage 9A `ef4be9d`; `Z:\CloudForge` remains at Stage 9A `6814623` / `ef4be9d` and was not edited).

- **Turnkey Packaging Integration ([esbuild.webview.mts](extensions/cloudforge/esbuild.webview.mts), [studio/build.ts](extensions/cloudforge/studio/build.ts), [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1)):**
  - Added `--outdir <path>` support to `extensions/cloudforge/studio/build.ts` and wired `didBuild(resolvedMediaOutDir)` in `extensions/cloudforge/esbuild.webview.mts` so every local build and every `gulp vscode-win32-x64-min` (`--outputRoot`) build automatically stages slimmed Studio Webview assets (`media/studio/studio.{js,css}`, icons, catalogues, HCL-only Monaco) alongside Classic `media/canvas.{js,css}` when `studio/node_modules` is present (skipping cleanly when absent).
  - Updated `build/cloudforge/package-win32-x64.ps1` to ensure `extensions/cloudforge/studio/node_modules` is installed via `corepack pnpm install --frozen-lockfile` when building fresh, and added payload hygiene gates verifying both Classic and Studio assets are present while excluding `studio/`, `canvas-src/`, `src/`, `test/`, and `*.tsbuildinfo`.
- **Full Live Rust Service Parity in Studio ([webviewBridge.ts](extensions/cloudforge/studio/src/webviewBridge.ts), [serviceAdapter.ts](extensions/cloudforge/studio/src/serviceAdapter.ts), [serviceAdapter.test.ts](extensions/cloudforge/studio/src/serviceAdapter.test.ts), [App.tsx](extensions/cloudforge/studio/src/App.tsx), [ResourceFields.tsx](extensions/cloudforge/studio/src/ResourceFields.tsx), [ResourceWorkspace.tsx](extensions/cloudforge/studio/src/ResourceWorkspace.tsx), [IssuesPanel.tsx](extensions/cloudforge/studio/src/IssuesPanel.tsx), [VisualTopbar.tsx](extensions/cloudforge/studio/src/VisualTopbar.tsx), [editor-refinement.css](extensions/cloudforge/studio/src/editor-refinement.css)):**
  - **Outbound `viewState` persistence (`buildHostViewState`):** Debounced sync of Studio's `mode`, `theme`, `selectedId`, `focusedWorkspaceOpen`, `inspectorOpen`, `libraryOpen`, `viewports`, and per-renderer `nodePositions` back to `CloudForgeCanvasPanel` `workspaceState` when connected to a real workspace architecture, restoring `inspectorOpen` and `viewports` on load.
  - **Stage 6 Live Cloud Regions (`resolveProviderRegions`):** Consumes `cloudRegions` payloads from the host to populate the `Region` picker dynamically across Azure, AWS, and Google Cloud.
  - **Stages 6 & 8 Workspace Readiness:** Surfaces `dependencyReport` (engine, lockfile state, locked provider versions) and `exportAuditReport` (reproducibility, lock entries, module count, unresolved reasons) in a compact collapsible **Workspace readiness** card inside `IssuesPanel`.
  - **Stage 7 Child Module Inspection:** Adds `requestModule` -> `moduleInspection` support on `module` resources in Inspector & Resource Workspace (`Child module interface` showing sourceKind, source, typed inputs with required/sensitive tags, outputs, and nested child modules).
  - **Honest Empty-Workspace Guard:** Disables hosted Validate & hides Save when no workspace architecture is loaded (`Sample preview` mode).

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| Studio `check`, `test`, `build` (`extensions/cloudforge/studio`) | Passed (**72/72 studio tests**, including `buildHostViewState` and `resolveProviderRegions`). |
| `node extensions/cloudforge/esbuild.webview.mts` + `--outputRoot` packaging dry-run | Passed (verified both Classic `media/canvas.{js,css}` and Studio `media/studio/{studio.js,studio.css,assets/catalogue/azure.json,assets/monaco/vs/loader.js}` staged automatically under `--outputRoot`). |
| PowerShell AST syntax check (`package-win32-x64.ps1`), `oxlint`, `hygiene` (`esbuild.webview.mts`) | Passed (`0` errors, `0` warnings). |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **62/62 root extension tests passed** (`0` skipped). |
| Headless Edge Playwright E2E (`studio-host-bridge-verify.mjs`) | **5/5 passed** (`0` console/page errors; verified outbound `viewState`, live Rust `FormSchema`, Stage 6 `Sweden Central` region hydration, Stage 7 `monitoring` child module inspection, Stage 8 `Reproducible` readiness card, Stage 9A `OpenTofu validate` reveal, and guarded save `Preview -> Apply -> Refresh`; screenshots inspected). |

**Next actions:**
1. Wire live Rust Stage 9B (`terraform plan -json` / `tofu plan -json`) once the Rust sidecar (`Z:\CloudForge`) adds guarded plan capture.
2. When ready to ship a new combined Windows x64 installer (including Multi-Cloud Authoring Polish + Opt-In Studio Preview + Stage 9A/9B), run `build/cloudforge/package-win32-x64.ps1` (pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` for signed releases).

### Studio-Only Architecture Canvas Cutover + Combined Windows x64 Installer & 5/5 Live Packaged-Desktop Smoke (2026-11-25)

Per user direction ("there shouldn't be a classic canvas only the new one worked on by codex"), removed the legacy classic canvas completely (`extensions/cloudforge/canvas-src/`, `media/canvas.{js,css}`, `cloudforge.canvasEngine` setting, and duplicate `cloudforge.openStudioCanvas` command) on `46049aac53bc6e14bd38d8e95e5a9ee25c81eaf4` (`origin/main` & `Z:\CloudForge-Code` `main`), shipped **Codex's React Flow Studio Canvas** as the sole Architecture Canvas (`8,138` lines of legacy canvas code deleted), and built & live-smoked the combined Windows x64 installer paired with Rust Stage 9A (`ef4be9d09b0b`).

- **Studio-Only Unification ([canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [canvasEngine.ts](extensions/cloudforge/src/canvas/canvasEngine.ts), [extension.ts](extensions/cloudforge/src/extension.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [esbuild.webview.mts](extensions/cloudforge/esbuild.webview.mts), [build/lib/extensions.ts](build/lib/extensions.ts), [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1), [App.tsx](extensions/cloudforge/studio/src/App.tsx), [ResourceCatalogue.tsx](extensions/cloudforge/studio/src/ResourceCatalogue.tsx)):**
  - `CloudForge: Open Architecture Canvas` (`cloudforge.openCanvas`) and opening any workspace/project architecture launch Studio directly; `Validate Architecture`, `Cancel Validation`, `Export Architecture Diagram / Report…`, and `Browse Template Library…` route directly into Studio's Checks & Validation, Export menu, and Templates tab.
  - `build/lib/extensions.ts` typechecks `extensions/cloudforge/studio/tsconfig.json` via `tsgo` during `vscode-win32-x64-min`, `esbuild.webview.mts` stages only `media/studio/`, and `package-win32-x64.ps1` forbids legacy `media/canvas.js`, `media/canvas-style.css`, and `canvas-src`.

| Artifact or check (run on `46049aac53b` + Rust Stage 9A `ef4be9d`) | Verified result |
| --- | --- |
| Studio `check`, `test`, `build`, TS7 (`studio/tsconfig.json`), Extension `esbuild.mts` & `esbuild.webview.mts`, TS6 & TS7, `oxlint`, `hygiene` | Passed (`0` errors, `0` warnings; **72/72 studio tests**, **62/62 root extension tests**). |
| Studio-only Windows x64 installer | [CloudForgeProofSetup-x64-46049aac53b.exe](Z:/CFStage/CloudForgeProofSetup-x64-46049aac53b.exe), unsigned (`ServiceSigned: false`), `324,337,655` bytes, SHA-256 `cffe61a72e6363a4eaa73db2161307aab15e30f037f8cf2877c91fef51404552`; Desktop `46049aac53bc6e14bd38d8e95e5a9ee25c81eaf4`; Rust Stage 9A `ef4be9d09b0b2ddf504ea1bb31172c116c72da19` (`3,670,016` bytes, SHA-256 `2a9954d61776602d74471e1d638ed86c14b404c1ed5139b1424a4db22eef03db`); VSIX `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897`. |
| Payload hygiene & `serviceArtifact.ts --verify` | Passed (`media/studio/{studio.js,studio.css,assets/catalogue/azure.json,assets/monaco/vs/loader.js}` present; `canvas-src/`, `studio/`, `media/canvas.{js,css}`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed). |
| Live packaged-desktop smoke ([studio-packaged-smoke.mjs](Z:/CFStage/smoke/studio-packaged-smoke.mjs), [report.json](Z:/CFStage/smoke/run-studio-46049aac53b/report.json)) | **5/5 passed** (`01-packaged-studio-live-rust.png`, `02-packaged-studio-checks-and-readiness.png` visually inspected): opened a 5-resource Azure Terraform workspace via the live packaged Rust Stage 9A sidecar (`rev d2b77f24`, `5 in design`, zero classic canvas), loaded **139/139** icons (`0` broken) & `1,110 types` offline catalogue with `0px` body padding, rendered live **Monaco HCL** under strict CSP, ran live **Stage 4 Rust service validation (`complete coverage`)** + surfaced **Stage 8 Export Audit** & **Stage 9A detected `OpenTofu validate`**, and left **0** payload `cloudforge-service.exe` orphans after quit. |

**Next actions:**
1. User can run [CloudForgeProofSetup-x64-46049aac53b.exe](Z:/CFStage/CloudForgeProofSetup-x64-46049aac53b.exe) directly as an in-place upgrade over `%LOCALAPPDATA%\Programs\CloudForge Proof` (no uninstall needed; just close any running CloudForge Proof window first).
2. Wire live Rust Stage 9B (`terraform plan -json` / `tofu plan -json`) once guarded plan capture lands in `Z:\CloudForge`.

### Canvas Focus Mode & Bidirectional Corresponding Project Terraform File Linking (2026-11-25)

Implemented on `fxrazor/continue-project-handoff-review` in `E:\Orca\CloudForge-Code\dace` (fast-forward merged to `Z:\CloudForge-Code` `main` and pushed to `origin/main`). **No unnecessary Windows installer rebuild was triggered** (the previously built installer [CloudForgeProofSetup-x64-46049aac53b.exe](Z:/CFStage/CloudForgeProofSetup-x64-46049aac53b.exe) remains verified at `46049aac53b`, and `Z:\CloudForge` / `extensions/cloudforge/studio/src/cloudlab-core/` remain untouched).

- **Canvas Focus Mode (Full-Screen Distraction-Free Canvas Workspace) ([extension.ts](extensions/cloudforge/src/extension.ts), [canvasPanel.ts](extensions/cloudforge/src/canvas/canvasPanel.ts), [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [package.json](extensions/cloudforge/package.json), [package.nls.json](extensions/cloudforge/package.nls.json), [VisualTopbar.tsx](extensions/cloudforge/studio/src/VisualTopbar.tsx), [App.tsx](extensions/cloudforge/studio/src/App.tsx), [webviewBridge.ts](extensions/cloudforge/studio/src/webviewBridge.ts), [editor-refinement.css](extensions/cloudforge/studio/src/editor-refinement.css)):**
  - Added **CloudForge: Toggle Canvas Focus Mode** (`cloudforge.toggleCanvasFocusMode`, shortcut `Ctrl+Alt+F` / `Cmd+Alt+F`) and a one-click **Focus Canvas** / **Exit Focus** pill in Studio's topbar (and compact menu).
  - Entering Focus Mode saves the user's prior `zenMode.centerLayout` and `zenMode.showTabs` settings, switches to edge-to-edge full-screen Zen Mode (`centerLayout: false`, `showTabs: 'none'`), hides Primary Side Bar, Chat Auxiliary Bar, Activity Bar, Panel, Status Bar, and Editor Tabs so the Studio Canvas fills the full VS Code application window (`3064×1689` inside `3072×1728` fullscreen), and restores the exact prior Workbench geometry & settings on Exit Focus, panel close, extension dispose, or **Open source** jump so the user is never trapped in a chromeless window.
- **Bidirectional Corresponding Project `.tf` File Linking ([extension.ts](extensions/cloudforge/src/extension.ts), [protocol.ts](extensions/cloudforge/src/canvas/protocol.ts), [model.ts](extensions/cloudforge/studio/src/model.ts), [terraformProjection.ts](extensions/cloudforge/studio/src/terraformProjection.ts), [serviceAdapter.ts](extensions/cloudforge/studio/src/serviceAdapter.ts), [serviceAdapter.test.ts](extensions/cloudforge/studio/src/serviceAdapter.test.ts), [ResourceFields.tsx](extensions/cloudforge/studio/src/ResourceFields.tsx), [CodePanel.tsx](extensions/cloudforge/studio/src/CodePanel.tsx), [ResourceWorkspace.tsx](extensions/cloudforge/studio/src/ResourceWorkspace.tsx), [DraftSaveDialog.tsx](extensions/cloudforge/studio/src/DraftSaveDialog.tsx), [App.tsx](extensions/cloudforge/studio/src/App.tsx)):**
  - **Source File Provenance (Trust-Boundary Safe):** `parseGraph()` preserves validated single-filename `sourceFile` (`isValidTfFileName`, zero OS paths) and 1-based `sourceLine` from Rust `readArchitecture`'s `node.source` into `CanvasNodeSummary` -> Studio `Resource`.
  - **Per-File Scoped HCL & Guarded Save:** Sets `node.file = resourceSourceFile(resource)` so `cloudlab-core`'s untouched generator splits HCL by source `.tf` file (`projectResourceFiles`), defaults guarded saves to the selected resource's corresponding `.tf` file (`defaultTargetTfFile`), scopes `buildDraftSavePayload` to emit only that `.tf` file's resources (preserving cross-file Terraform references), and adds a clickable **Project Terraform files** pill selector (`main.tf`, `compute.tf`, `network.tf`, …) in `DraftSaveDialog`.
  - **Direct File Links & Live Reverse Sync:** `ResourceFields`, `CodePanel`, and `ResourceWorkspace` display the real `<sourceFile>:<sourceLine>` with inline **Open `<file>`** (jumps straight to the `.tf` file and line in Code OSS, exiting Focus Mode automatically) and **Save `<file>`** actions. Saving any `.tf` / `.tf.json` file in Code OSS triggers a debounced (`250 ms`) `workspace.onDidSaveTextDocument` reverse refresh of the Rust graph, Status Bar, Problems, and open Studio Canvas.

| Check (no full desktop/installer rebuild) | Verified result |
| --- | --- |
| Studio `check`, `test`, `build`, TS7 (`studio/tsconfig.json`) | Passed (**73/73 studio tests**, including multi-file `network.tf` / `compute.tf` scoped save verification). |
| Extension `esbuild.mts`, `esbuild.webview.mts`, TS6 & TS7, `oxlint`, `hygiene` | Passed (`0` errors, `0` warnings). |
| `CLOUDFORGE_REPO=Z:\CloudForge node --test extensions/cloudforge/test/*.test.ts` | **63/63 root extension tests passed** (`0` skipped; includes `toggleFocusMode` protocol validation). |
| Headless Edge Playwright E2E (`studio-host-bridge-verify.mjs`) | **5/5 passed** (`0` console/page errors; verified Focus Mode pill sync, multi-file `network.tf`/`compute.tf`/`main.tf` project file chips, scoped `network.tf` HCL preview/apply, and `Open network.tf` jump; `04-hosted-guarded-save-dialog.png` inspected). |
| Live isolated Code OSS desktop verification (`.agents/skills/launch/scripts/launch.ps1` + `@playwright/cli` over CDP) | **Passed** (`0` page errors; verified `CloudForge: Open Architecture Canvas` -> `Focus Canvas (Full Screen)` entering true edge-to-edge fullscreen (`noauxiliarybar nosidebar noactivitybar nostatusbar fullscreen`, `sidebarW=0`, `auxW=0`, `statusH=0`, `tabsH=0`, `activityW=0`, editor `3064×1689` in `3072×1728`) -> `Exit Focus` restoring exact prior geometry (`editorRect 788×835`, `sidebarW=300`, `auxW=292`, `statusH=28`, `tabsH=32`); `05-live-codeoss-focus-mode.png` visually inspected). |

**Next actions:**
1. Rebuild the Windows x64 installer with `pwsh -NoProfile -ExecutionPolicy Bypass -File build/cloudforge/package-win32-x64.ps1` whenever ready to package Canvas Focus Mode + Corresponding `.tf` File Linking into an updated `CloudForgeProofSetup-x64-*.exe` (pass `-SignCertificateThumbprint <40-hex>` + `-RequireSignedService` for signed releases).
2. Wire live Rust Stage 9B (`terraform plan -json` / `tofu plan -json`) once guarded plan capture lands in `Z:\CloudForge`.

### Combined Windows x64 Installer (`d7c58cc29fe`) + 5/5 Live Packaged-Desktop Smoke (2026-11-25)

Built and live-smoked the updated Windows x64 installer from `Z:\CloudForge-Code` at `d7c58cc29fe4fec61e403f01ee8738a56223a5a0` (Studio-only Architecture Canvas + **Canvas Focus Mode** + **Bidirectional Corresponding Project `.tf` File Linking**), paired with Rust Stage 9A (`ef4be9d09b0b`).

| Artifact or check (run on `d7c58cc29fe` + Rust Stage 9A `ef4be9d`) | Verified result |
| --- | --- |
| Windows x64 installer | [CloudForgeProofSetup-x64-d7c58cc29fe.exe](Z:/CFStage/CloudForgeProofSetup-x64-d7c58cc29fe.exe), unsigned (`ServiceSigned: false`), `324,353,778` bytes, SHA-256 `7726000ada5f5526f6058aa1931a60f4a91a3084fc64673b8c151fd66d7d1652`; Desktop `d7c58cc29fe4fec61e403f01ee8738a56223a5a0`; Rust Stage 9A `ef4be9d09b0b2ddf504ea1bb31172c116c72da19` (`3,670,016` bytes, SHA-256 `2a9954d61776602d74471e1d638ed86c14b404c1ed5139b1424a4db22eef03db`); VSIX `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897`. |
| Payload hygiene & `serviceArtifact.ts --verify` | Passed (`media/studio/{studio.js,studio.css,assets/catalogue/azure.json,assets/monaco/vs/loader.js}` present; `canvas-src/`, `studio/`, `media/canvas.{js,css}`, `tsconfig.typecheck.tsbuildinfo` absent; `serviceArtifact.ts --verify` passed). |
| Live packaged-desktop smoke ([studio-focus-multifile-smoke.mjs](Z:/CFStage/smoke/studio-focus-multifile-smoke.mjs), [report.json](Z:/CFStage/smoke/run-studio-d7c58cc29fe/report.json)) | **5/5 passed** (`01-packaged-focus-mode.png`, `02-packaged-multifile-guarded-save.png` visually inspected): opened a 3-file Azure Terraform workspace (`main.tf`, `network.tf`, `compute.tf`, `5 in design`, `rev 00da2e16`) via the live bundled Rust Stage 9A sidecar; entered **Canvas Focus Mode** edge-to-edge fullscreen (`3064×1689` inside `3072×1728`, `sidebarW=0`, `auxW=0`, `statusH=0`, `tabsH=0`) and restored cleanly via **Exit Focus**; verified `snet_app` linked to `network.tf:8`, previewed & applied a live Rust guarded save writing ONLY `network.tf` (`address_prefixes = ["10.20.2.0/24"]`, refreshing `rev 00da2e16 -> rev 2b9bcd7a`) while leaving `main.tf` and `compute.tf` untouched; jumped directly to `network.tf` in Code OSS via **Open network.tf**; and left **0** payload `cloudforge-service.exe` orphans after quit. |

**Next actions:**
1. User can run [CloudForgeProofSetup-x64-d7c58cc29fe.exe](Z:/CFStage/CloudForgeProofSetup-x64-d7c58cc29fe.exe) directly (fresh install or in-place upgrade over `%LOCALAPPDATA%\Programs\CloudForge Proof`; no uninstall needed).
2. Wire live Rust Stage 9B (`terraform plan -json` / `tofu plan -json`) once guarded plan capture lands in `Z:\CloudForge`.










### Studio Semantic Undo Survives Live Refreshes (2026-11-25)

Branch `claude/project-thread-dnlp5o` from `main` (`156a0fdc`). Scope: `extensions/cloudforge/studio` plus this entry. No Rust, protocol, installer or classic-canvas changes.

- A live `graph` refresh of the **same** architecture now dispatches `rebase` instead of `replace` ([historyRebase.ts](extensions/cloudforge/studio/src/historyRebase.ts), [model.ts](extensions/cloudforge/studio/src/model.ts), [App.tsx](extensions/cloudforge/studio/src/App.tsx)). Every past/future snapshot is three-way merged against the state the refresh replaced: what the refresh added, changed or removed (resources, board items, connections, variables, groups, layer order, name) is taken from the service in every step; everything else keeps the user's own step. Steps that become no-ops are dropped; dangling parents, connections and group members are pruned. Switching to a different architecture still uses `replace` and starts a fresh history.
- The hosted `Modified` badge now compares the present against the last loaded architecture instead of `past.length > 0`, so a save-echo refresh with retained undo steps reads clean.

| Check | Result |
| --- | --- |
| Studio `check`, `build` | Passed (`0` errors). |
| Studio `test` | **76/76 passed** (adds [historyRebase.test.ts](extensions/cloudforge/studio/src/historyRebase.test.ts): echo refresh keeps undo/redo, external addition survives undo/redo, external removal prunes history, different architecture resets). |

Follow-up on the same branch (see [STUDIO-CONTINUATION-2026-11-25.md](extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md)): drawing links, edge styling, groups and layer order now carry through refresh; menu-driven multi-object resize added; 81/81 tests.

Not verified: hosted browser/Code OSS run of the refresh path (`studio-host-bridge-verify.mjs` lives on the Windows checkout). Known projection limits found while tracing, unchanged here: `projectGraphSnapshotToArchitecture` always takes the architecture name from the snapshot, and rebuilds connections from service edges, so user drawing links and `groups`/`layerOrder` are not carried through a refresh. Next: carry those through the projection, then the whiteboard gaps (multi-object resize, rotation, freehand, free connector endpoints).
