# Studio whiteboard continuation — 25 November 2026

Integration owner: Codex. Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`, based on Claude's PR #1 head `3875328c5ce4bc2d9528069a15404f671db204ad`. The three copied handoff notes were preserved in stash `claude handoff copies`; the resume prompt was kept untracked during implementation and is to be removed after the final work/handoff commit, as requested. No changes to main, Claude's branch, Rust, service authorization or dependency versions.

This is an additive continuation of [Claude's checkpoint](STUDIO-CONTINUATION-2026-11-25.md). Its wider backlog remains intact. One architecture/history, presentation-only theme/viewport/tool preferences, and drawings excluded from Terraform remain binding.

## Pass 1 — safe resizing for rotated drawings

Picked the smaller change authorized in the brief: hide React Flow's axis-aligned resize frame whenever a drawing has nonzero rotation; keep rotation handles, numeric Width/Height and Rotation in Appearance. Ink now has the same dimensions and one Rotation control; the duplicate ink Rotation field was removed. Resetting rotation restores canvas handles. The Appearance heading and Close stay visible as its content scrolls.

Files: `rotation.ts`, `rotation.test.ts`, `ResourceNode.tsx`, `ElementAppearance.tsx`, `styles.css`, `scripts/whiteboard-controls-verify.mjs`. Tests cover selection/lock/live-rotation visibility and a rotated ink dimension edit with exact single-step Undo.

Fresh verification: Studio TypeScript and production build passed; **101/101** Node tests passed. Windows Edge preview matrix passed at **1360×860 and 1024×768, light and dark**, with zero console/page errors. UI checks cover dimensions, preserved rotation, Undo and restored handles. Hosted refresh regression passed **20/20** on Windows Edge. Screenshots: `output/playwright/whiteboard-controls/rotation-<width>-<theme>.png` (ignored artifacts). Impeccable Operate/polish used the existing identity, source tokens and board-design-direction brief; Context7 confirmed the React Flow resize-control contract.

## Pass 2 — pen presets before drawing

The active Pen tool exposes a contextual options button with colour, weights 1–8 and a stroke preview. Choices are React presentation state in `DesignCanvas`, remembered across tool changes and both renderers while the board is mounted; they are not architecture edits or persisted service data. Each stroke captures its chosen style at pointer-down, uses its weight for geometry padding and enters history once. The tool rail now stays usable above the drawing capture layer.

Files: `PenOptions.tsx` (new), `ink.ts`, `ink.test.ts`, `InkCapture.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. No dependencies changed.

Fresh verification: TypeScript/build passed; **103/103** Node tests. The rotation and pen matrices passed **8/8** Edge scenarios at both requested sizes/themes with zero console/page errors. Presets did not enable Undo; they survived a renderer/tool change; the next stroke used the chosen colour/weight, and one Undo/Redo removed/restored it. Hosted refresh passed **20/20** on Windows Edge on serial recheck. An initial run alongside the other browser matrix hit a selection-toolbar interception during existing fixture setup; that script was unchanged. Pen screenshots are `output/playwright/whiteboard-controls/pen-<width>-<theme>.png`.

## Pass 3 — all-corner selection resizing

Added four pointer handles and an explicit fixed-corner `anchor` on the existing `resize` command. The opposite corner stays fixed, including pixel rounding and per-element size clamps. Group expansion, shared renderer geometry, lock skipping and exact one-step Undo/Redo stay inside that command; no follow-up move is dispatched. The Size menu retains its original top-left default. Group handles sit above individual node handles so the intended control receives the gesture.

Files: `canvasOperations.ts`, `canvasResize.test.ts`, `selectionGeometry.ts`, `SelectionResizeHandle.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. Tests include every anchor in both renderers, group expansion, size limits/locks, invalid anchors and grow/shrink preview geometry.

Fresh verification: TypeScript/build passed; **107/107** Node tests. Rotation, pen and all-corner scenarios passed **12/12** on Windows Edge at both requested sizes/themes with zero console/page errors; every corner drag kept the opposite corner and one Undo restored exact dimensions/positions. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/corners-<width>-<theme>.png`.

## Pass 4 — resize eligibility and bounds

`resizeTargets` is now the shared eligibility policy for the resize command, Size count and multi-selection frame. Infrastructure containers, locked objects and technical cards are excluded from the frame; drawing frames remain resizable drawings. A container plus one eligible icon still offers handles. With no eligible targets, no frame is shown. Live scale is rounded to the same precision as commit. The open View menu is contained and stays above the tool rail, fixing a narrow-screen overlap exposed during verification.

Files: `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx`, `SelectionResizeHandle.tsx`, `styles.css`, `resizeTargets.test.ts` (new and listed in `package.json`), browser script.

Fresh verification: TypeScript/build passed; **109/109** Node tests. **16/16** Edge scenarios passed at both requested sizes/themes, including exact frame bounds in both renderers and a container + one icon selection; zero console/page errors. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/eligibility-<width>-<theme>.png`.

Known limits observed: the scale preview is a proportional logical bounding box; individual size clamps can make the committed box smaller. In the pre-existing sample, wide edge hit areas can intercept a node-centre click. Eligibility scenarios use the real View → Show connections toggle to isolate resizing, without forced clicks or hidden DOM mutations. This pass does not claim to fix edge routing/hit testing or rotation-aware group bounds.

## Pass 5 — local architecture names survive refresh

`projectGraphSnapshotToArchitecture` preserves the previous model's name when the caller supplies the same architecture, matching the existing preservation of edge appearance. App already passes a previous model only when architecture identity matches. First loads and architecture switches still take the service name. Rebase now retains the local rename and its Undo/Redo, including concurrent service resource additions. This is local title preservation; it does not implement a service-side rename operation, and service title changes on the same identity do not override the current local title.

Files: `serviceAdapter.ts`, `historyRebase.test.ts`, browser verification script. The new regression was observed failing before the source fix (`Live` replaced `Platform network`), then passed. Added coverage for repeated refresh, no extra history step, external additions, Undo/Redo and a different architecture.

Fresh final verification: TypeScript/build passed; **111/111** Node tests, **20/20** browser scenarios across 1360×860 and 1024×768 × light/dark, and hosted refresh **20/20** on Windows Edge. Both browser suites captured zero console/page errors. This is preview + mocked extension-host bridge verification, not an installed Code OSS/service smoke or installer build. Screenshots: `output/playwright/whiteboard-controls/rename-<width>-<theme>.png`.

Impeccable's mechanical scan ran once over all eight changed UI files. It returned exit 2 with two font warnings in unchanged incumbent declarations (`styles.css` Mona Sans/Inter); no new code-specific findings. The existing fonts were preserved under the refinement brief. Full output: `output/playwright/impeccable-whiteboard2.json`. The setup diagnostic was not repaired as a side effect. Screenshots were visually reviewed at the requested sizes/themes; no new numerical critique score is claimed.

## Commit and verification ledger

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
# Use the URL printed by the new server. Current session: http://127.0.0.1:56797/
$env:PLAYWRIGHT_DIR = 'C:\Users\dalep\AppData\Local\npm-cache\_npx\31e32ef8478fbf80'
node scripts/whiteboard-controls-verify.mjs <preview-url> --channel=msedge
node scripts/hosted-refresh-verify.mjs <preview-url> output/playwright/hosted-refresh --channel=msedge
```

The verification scripts launch isolated headless Edge instances. The CLI session `whiteboard2` was closed; no user reference tab was used or reset. The preview server can be left running for continued review. Generated output/snapshots stay ignored.

## Proposed next pass — point endpoints (requires Dale's go-ahead)

This is a plan only. The supplied resume request explicitly gates this model change on separate approval after passes 1–5. No endpoint model code was changed here.

1. Add an explicit design endpoint union for `{ kind: 'element', elementId, port }` and `{ kind: 'point', position }`. Adapt existing element-id links at one normalization boundary. Avoid fake resource IDs or a second architecture model.
2. Add a "Keep loose end" choice to the existing connector-drop menu, preserving its create-and-connect choices. Moving a loose endpoint, reconnecting it, cancelling a drag and changing link style each remain bounded commands in the same history. Keep coordinates in world space and presentation/zoom out of the architecture.
3. Trace and update endpoint consumers in `model.ts`, `designConnections.ts`, `DesignCanvas.tsx`, `DesignEdge.tsx`, `connectionGeometry.ts`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `exportPresentation.ts` and related projection/clipboard helpers. Verify the actual call-site inventory before editing; the earlier checkpoint counted roughly 21 consumers.
4. Keep loose design links out of Terraform and service dependency semantics. Explicitly handle graph refresh, deleted element endpoints, copy/paste offsets, groups, selection, export bounds and all three output formats. Existing element links must continue to behave identically.
5. Add tests for old-link normalization, loose-end creation/movement/reconnection/deletion, atomic Undo/Redo, refresh preservation and export geometry. Repeat both Windows browser matrices and hosted refresh 20/20 before committing a separate bounded pass.

## Exact next actions

1. Review the five commits on `codex/studio-whiteboard-2`; merge/rebase and PR #1 decisions remain Dale's. Do not continue from the stale `codex/infrastructure-studio-preview` branch.
2. Await Dale's approval of the point-endpoint plan above before implementing it. If not approved, retain the existing connector-drop quick-create workflow and work only on separately authorized backlog items.
3. Carry forward the original wider backlog and the known limits recorded above. In particular, installed Workbench/service refresh + Undo/save smoke is still separate from these mocked hosted checks; scale-clamp preview and edge hit testing remain follow-ups. Do not restore the removed Classic renderer from historical notes.

The original wider backlog (large-graph history tuning, live installed Workbench verification, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and remaining backend-dependent features) is not completed by this continuation.
