# Studio continuation checkpoint — 25 November 2026

**Read this first if you are resuming from the Codex worktree.** The Codex branch `codex/infrastructure-studio-preview` stopped at `f82e0c12` ("Checkpoint variable configurator and resource workspace refinement"). That commit was merged into `main`, and 52 more commits landed on `main` after it. The Codex worktree at `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code` had no unpushed Studio changes on 25 November (all 19 files touched by the configurator pass matched `f82e0c12` byte for byte, ignoring CRLF).

**Do not continue on `codex/infrastructure-studio-preview`.** Start from `main`, or from PR branch `claude/project-thread-dnlp5o` ([PR #1](https://github.com/fXrazor/vscode/pull/1)) until that PR merges:

```powershell
git fetch origin
git switch -c <new-branch> origin/main            # after PR #1 merges
# or, before it merges:
git switch -c <new-branch> origin/claude/project-thread-dnlp5o
cd extensions/cloudforge/studio
corepack pnpm install --frozen-lockfile
corepack pnpm run check; corepack pnpm run test; corepack pnpm run build
```

## Update 13:40: `main` moved (Antigravity)

`main` is now `d7c58cc2`. Commit `46049aac` removed the legacy classic canvas, so Studio ships as the only Architecture Canvas (the `cloudforge.canvasEngine` notes below are historical). `d7c58cc2` added Canvas Focus Mode and project `.tf` file linking, with Open/Save buttons in `CodePanel`. The installer `CloudForgeProofSetup-x64-d7c58cc29fe.exe` was built from that commit and **does not include PR #1**. PR #1 merged `main`, resolving the `CodePanel.tsx` help-text and `App.tsx` library-state conflicts by keeping both sides. Studio check/build passed and **82/82** tests passed after the merge.

## Resume list from CONFIGURATOR-REFINEMENT-2026-11-25.md: all done on `main`

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

## What this pass added (PR #1, branch `claude/project-thread-dnlp5o`)

| Change | Files |
| --- | --- |
| **Undo/redo survives live refreshes.** A refresh of the same architecture dispatches `rebase` instead of `replace`. Each past/future snapshot is three-way merged against the state the refresh replaced: service additions, changes and removals apply to every step, and the user's own edits stay undoable. No-op steps are dropped and dangling references are pruned. Switching architecture still resets. | `historyRebase.ts` (new), `model.ts`, `App.tsx` |
| **Hosted "Modified" badge** compares the present with the last loaded architecture, instead of using `past.length > 0`. | `App.tsx` |
| **The refresh keeps Studio-only presentation.** User drawing links (ids without `->`), user styling on service edges, groups and layer order carry through `projectGraphSnapshotToArchitecture`, pruned to elements that still exist. | `serviceAdapter.ts` |
| **Multi-object resize.** New canvas command `{ kind: 'resize', ids, mode, scale? , match? }`, applied as one undo step. Scale (50–200% in the UI, 0.25–4 accepted) works about the selection's top-left. Match widths/heights/sizes uses the largest element. Drawings resize in both views; resource icons resize only in the visual view and are clamped to 24–160 px. Containers auto-fit and locked elements are skipped. The selection toolbar gains a **Size** menu when more than one element is selected. | `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx` |
| Tests | `historyRebase.test.ts` (5), `canvasResize.test.ts` (4), `package.json` test list |

## Impeccable polish pass (same branch, 25 November, afternoon)

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

## Verification (this pass, Linux cloud container)

- Studio `check`, `build`: passed. Studio `test`: **81/81 passed**.
- Playwright smoke against `node build.ts --serve` (sample mode, 1360×860): Ctrl+A showed the Size menu. Scale 150% resized the nodes, Ctrl+Z restored the exact widths, and there were 0 console/page errors.
- **Not run:** hosted Code OSS / `studio-host-bridge-verify.mjs` refresh path (needs the Windows checkout), root extension tests, Windows packaging. No Rust, protocol, installer or classic-canvas changes.

## Known issues found (not fixed)

- `projectGraphSnapshotToArchitecture` always takes the architecture name from the snapshot, so a local rename is overwritten by the next refresh.
- Rebased history holds whole snapshots (capped at 100), not inverse operations. That is fine for the current graph sizes but is not tuned for large graphs.

## Exact next actions (in order)

1. On Windows: run `studio-host-bridge-verify.mjs` and a live Code OSS session. Edit, save, wait for the refresh, then press Ctrl+Z: the edit should undo and the badge should read clean after the save. Check that drawing links and groups survive the refresh.
2. ~~Fix the selection-toolbar / View-button overlap, refit at 1024 px, library tooltips, keyboard route to the toolbar~~ (done in the polish passes). Keyboard polish is complete for the canvas, selection toolbar, workspace and connector tools.
3. Remaining whiteboard gaps, one bounded pass each: drag handles for multi-object resize (this pass added only menu-driven resize), rotation, freehand, free connector endpoints, equal-spacing guides.
4. Then the wider backlog: making Studio the default engine after a parity check against Classic; Stage 9B plan capture once Rust adds it; arbitrary HCL round-trip; authoritative validation and pricing; collaboration.

Keep the rules in the repository AGENTS.md: one architecture and one semantic undo history across renderers; theme and viewport stay in presentation state; canvas first; Rust owns authorization and guarded I/O.
