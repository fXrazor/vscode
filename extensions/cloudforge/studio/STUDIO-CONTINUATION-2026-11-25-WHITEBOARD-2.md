# Studio whiteboard continuation — 25 November 2026

Integration owner: Codex. Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`, based on Claude's PR #1 head `3875328c5ce4bc2d9528069a15404f671db204ad`. The three copied handoff notes were preserved in stash `claude handoff copies`; the resume prompt stays untracked until this work and handoff are committed. No changes to main, Claude's branch, Rust, service authorization or dependencies.

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

## Exact next actions

1. Preserve local architecture renames across live refresh; regression test in `historyRebase.test.ts`.
2. Final handoff and push this branch. True point connector endpoints require Dale's separate approval after a short plan; do not implement them in these passes.

The original wider backlog (large-graph history tuning, live installed Workbench verification, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and remaining backend-dependent features) is not completed by this continuation.
