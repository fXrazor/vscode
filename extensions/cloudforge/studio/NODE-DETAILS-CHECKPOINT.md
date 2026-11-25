# Node details and canvas controls — 24 November 2026

> Historical checkpoint. Resumed on 25 November 2026. See [NESTING-AND-FEEDBACK-PASS.md](NESTING-AND-FEEDBACK-PASS.md) for the completed verification, latest behavior and next action. Earlier per-renderer positioning is superseded by synchronized movement; viewports remain independent. The records below retain the evidence available at the pause.

**PAUSED at the user's explicit request.** Stop implementation and verification here. Everything is saved in the working tree; no commit or push was performed. The next turn must resume the pending verification below before committing. Earlier commit/push authorization remains recorded, but this pause takes precedence until the user resumes.

## Resume location and ownership

- Integration owner: Codex. Repository/worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`.
- Feature branch: `codex/infrastructure-studio-preview`; starting revision `ccf110495e1`. Resolve the checkpoint commit with `git log -1 -- extensions/cloudforge/studio/NODE-DETAILS-CHECKPOINT.md`.
- Implementation belongs to `extensions/cloudforge/studio/src`. This remains a standalone in-memory preview, excluded from the shipped extension. Rust, protocol, installer and upstream baseline were not changed.
- Current preview: `http://127.0.0.1:52646/`. Esbuild watch does not hot-reload the page. Check the listener before starting another server; reload intentionally to reset disposable sample edits.
- Latest user steering: resize resource icons; anchor controls near selected objects; scoped Terraform on the left of focused node details; shared form beside it; Brainboard-style variable binding; AFFiNE/Miro controls and alignment guides; only the right inspector content scrolls. Save a checkpoint before usage is exhausted.

## Implemented continuation

The earlier batch in [ELEMENT-CONTROLS-CHECKPOINT.md](ELEMENT-CONTROLS-CHECKPOINT.md) remains included: multi-selection, flat visual groups, batch movement/style/locking/deletion, alignment/distribution, layers, internal clipboard, drawing typography/direct text editing and connector label/direction controls. The global bottom code dock stays removed.

This continuation adds:

- React Flow `NodeToolbar` follows the selected resource, drawing, group or connection. Collision correction keeps its content in the canvas. Appearance and More are contextual Radix popovers/menus.
- Native square resource-icon resize handles and a 24–160 px size control. Size and visual origin change in one history action; technical position and Terraform configuration do not change. Connection anchors and SVG/PNG exports use the same icon geometry.
- Focused node details: scoped Terraform at left, the existing shared schema form in the middle, Links/Variables/Checks at right. The code pane resizes and can collapse. Narrow screens use Terraform/Parameters/Context views. Configure, Enter and double-click open this view; a secondary action opens the quick right inspector.
- Resource code drafts retain their existing per-resource storage and stale-form protection when details close/reopen. Code and form project the same architecture, without a duplicate editable graph.
- Value/Variable controls on supported root, primitive and nested fields. Searchable typed variable picker, linked chips, effective-value preview, sensitivity masking, missing/type-error feedback, and a direct route to variable creation/import.
- Bindings store variable IDs and stable nested block IDs. They generate `var.name`, preserve the inactive literal, index variable usage, prevent deleting referenced declarations, remap block IDs on duplication and prune removed blocks. An initially empty schema field can bind directly.
- Bound expressions appear consistently in Configuration nodes and the architecture overview. Bound fields do not expose an editable inactive literal on a node surface.
- Variable-management destination focus and return focus after save/cancel. Selected binding/context text uses a darker light-theme foreground and a separate dark-theme token.
- One scrolling content container in the right inspector; switch bar, categories and selected resource header/actions remain fixed.
- Transient edge/centre alignment guides with a six-screen-pixel magnetic threshold. A group moves as one bounds unit; parent containers/moving descendants are excluded from snap targets. Grid snapping takes precedence. Guides clear after release; the model receives one final move and one Undo restores it.
- A fresh renderer fits its actual measured nodes. Each visited renderer restores its own presentation viewport and preserves selection/theme. The renderer remount is presentation-only; architecture and history remain in the parent.

## Feature-to-code map

| Concern | Owned implementation |
| --- | --- |
| Canonical state, icon resize and binding actions | `src/model.ts` |
| Typed bindings, schema paths, previews and usage | `src/fieldBindings.ts`, `src/variables.ts` |
| Shared fields and nested block controls | `src/ResourceFields.tsx`, `src/SchemaField.tsx`, `src/VariablePicker.tsx` |
| Focused node composition and resizable code | `src/ResourceWorkspace.tsx`, `src/PaneResizeHandle.tsx`, existing `src/CodePanel.tsx` |
| Resource graphics/inline configuration | `src/ResourceNode.tsx`, `src/resourceGeometry.ts` |
| Selection, command UI and appearance | `src/SelectionAnchor.tsx`, `src/SelectionControls.tsx`, `src/ContextPopover.tsx`, `src/ElementAppearance.tsx` |
| Shared semantic canvas operations | `src/canvasOperations.ts`, `src/selectionGeometry.ts`, `src/DrawingText.tsx` |
| Magnetic alignment and viewport overlay | `src/alignmentGuides.ts`, `src/AlignmentGuides.tsx`, `src/DesignCanvas.tsx` |
| Right inspector and overview | `src/App.tsx`, `src/ArchitectureOverview.tsx` |
| Terraform and presentation projections | `src/terraformProjection.ts`, `src/exportPresentation.ts`, `src/designConnections.ts` |

## Reference evidence and classification

**Confirmed live Brainboard UI:** provider-icon squares in an SVG graph; side/corner resize controls; object-adjacent selection toolbar; resource card actions opening the right Form/Code inspector; Graphics/Metadata/Main parameters/Add blocks; field variable/resource chips. No claim is made about its internal React store, backend schema or collaboration protocol. Reference saves/deployments were not performed.

**Confirmed live Miro UI, resumed pass:** the supplied Flowchart board became accessible again after an earlier deleted-board response. Selected shapes expose type conversion, font/size, style/alignment, fill/border opacity, line weight, duplicate/delete/lock and linking. More exposes copy style/paste style, arrange and frame creation. Preferences contains an enabled Align objects option. Only menus and selection were inspected; no Miro object or preference was changed. The earlier unavailable-board observation must not be treated as the final state.

**Confirmed AFFiNE source, not live runtime:** read-only checkout `Z:/CloudLab Forge/AFFiNE`, revision `dc2b2212441602452f3cf0ea50a4eaedaf03bcc2`.

- `blocksuite/affine/gfx/pointer/src/snap/snap-overlay.ts`: `SnapOverlay`, moving/reference bounds, alignment/distribution overlay, pixel threshold and workload limits.
- `blocksuite/affine/gfx/pointer/src/snap/snap-manager.ts`: `SnapExtension`, transient drag/resize alignment and clear lifecycle.
- Earlier source correlations for typography, grouping, layers and transactions remain in the historical element-controls checkpoint. These concepts were adapted to React Flow; AFFiNE's Yjs/graphics engine was not copied into the product.

**Confirmed CloudLab source:** read-only `Z:/CLOUDLAB FORGE 3.0`, revision `003f5d662be59fe92719034917fabc7c4572129a`; existing generator/parser/catalogue adapter retained. See [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md). `src/cloudlab-core` was not edited.

**n8n documentation, not a live n8n teardown:** [UI mapper](https://github.com/n8n-io/n8n-docs/blob/main/docs/build/work-with-data/reference-data/use-the-ui-mapper.md), [Edit Fields](https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.set.md), and [first workflow](https://github.com/n8n-io/n8n-docs/blob/main/docs/get-started/build-your-first-workflow.md) confirm input mapping, fixed/expression editing and result inspection. Adaptation here uses Terraform variable identity and does not execute arbitrary expressions.

Context7 supplied current [React Flow NodeToolbar](https://reactflow.dev/api-reference/components/node-toolbar), [NodeResizer](https://reactflow.dev/api-reference/components/node-resizer), [helper lines](https://reactflow.dev/examples/interaction/helper-lines), [viewport APIs](https://reactflow.dev/api-reference/types/react-flow-instance) and [v13 changesets](https://reactflow.dev/learn/troubleshooting/migrate-to-v13), plus Radix nonmodal dialog guidance. The installed React Flow is 13.0.2; do not reintroduce v12 `applyNodeChanges` examples.

## Verification checkpoint

- Fresh TypeScript check passed after the final viewport/provider change; **48 tests passed** immediately before that presentation-only change. This includes geometry, atomic group/frame moves, stable binding IDs, empty required-field binding, type checks, masking/redaction, duplication, stale code, export, and existing catalogue coverage. Rerun the final suite with the build after resuming.
- Final production build, whitespace check, final browser sweep and commit/push remain pending. The user paused before these could finish. Update this section with observed results before claiming completion.
- Root lint could not start in the earlier pass because root dependency `minimatch` is absent. Studio dependencies are installed; no dependencies were added or shared.
- Additional strict unused-local check found only the copied generator's pre-existing unused `ctx` after authored unused imports/functions were removed. Keep upstream provenance files untouched.
- Browser-confirmed: 48→72 px corner resize and one Undo to 48; preset resize to 96; bound Region produces `location = var.deployment_region`; matching chip preview and source expression; Variables destination focus and focus on saved Edit action; one right-form scroll container; first technical fit contains all six resources; narrow details navigation and no page horizontal overflow at requested 320/390 widths. Browser zoom made actual CSS widths 291/355; record that distinction. Temporary viewport overrides were reset.
- Final viewport fix: removed the outer `ReactFlowProvider` in `src/preview.tsx`. React Flow now owns a renderer-scoped store and is keyed by mode. In an isolated fresh 1280×720 QA tab, initial visual zoom was 0.862, first technical fit was 0.501 with all six resources visible; setting technical 0.700, returning to visual 0.862, setting visual 0.500 and returning to technical restored 0.700. Do not restore the outer shared provider or copy a departing flow instance into the next mode's saved viewport.
- Magnetic placement: moving Storage four screen pixels below Gateway snapped its final Y back to 30; X changed; one Undo restored `(850,30)`. Transient guide rendering is covered by source/test review, not a captured mid-drag screenshot.
- SVG downloaded successfully to `C:/Users/dalep/Downloads/cloudforge-architecture (3).svg` and contains a 96×96 embedded resource icon and matching connection anchor. PNG subsequently downloaded to `C:/Users/dalep/Downloads/cloudforge-architecture (1).png`; its visual inspection remains pending. No PDF save performed. The earlier PNG attempt timed out because Export was toggled closed; the later isolated-tab download succeeded.
- The final isolated QA tab's captured console contained zero warnings/errors. That tab was closed on pause. The user's existing preview tab was left intact; no final screenshot artifact was saved during this continuation.
- Monaco verification detail: after its lazy load, the accessible textarea is an input buffer, so `.value` can be empty while the editor has content; `.fill()` can append rather than replace the full editor model. Use the documented UI clipboard workflow (write clipboard, focus editor, Ctrl/Cmd+A then Ctrl/Cmd+V) and inspect rendered code. A malformed duplicate-resource draft was correctly rejected and retained across close/reopen; Discard recovered it. A valid `vnet-checked` edit was then pasted as a single resource block, but Apply/Undo was **not retested before the pause**. Do not report that last browser scenario as passing. Earlier reducer tests for supported atomic Apply still pass.
- Two independent Impeccable assessments used separate tabs and did not share findings. A scored 30/40; its findings plus B's contrast/focus findings were fixed afterward. Do not present that score as a new post-fix rating. B ran the detector once: 2 font warnings, 0 errors; one inactive Mona Sans declaration and the deliberately retained incumbent Inter face. No writable overlay API was available; no overlay server was started.

## Remaining work and exact next action

1. On explicit resume: inspect the saved diff, confirm the existing preview listener, and use a new disposable background tab so the user's live preview edits are not reset. Finish scoped Monaco Apply/Undo and draft retention using the real editor UI, inspect the downloaded PNG, check anchored toolbar behaviour after dragging an initially unselected object (the last `onNodeDragStart` selection change needs a fresh browser check), verify pane/theme behaviour after the renderer-store fix, and capture final visual evidence. Run the final TypeScript/tests/build/whitespace checks; update this record and HANDOFF; commit and push the feature branch. Do not merge main. The preview server may remain for the user.
2. Next implementation slice: typed resource-attribute references and inherited container values with provenance. Reuse this field component in both renderers, derive semantic dependencies from the same bindings, and keep drawing connections distinct. Follow the original CloudLab VM form evidence for required/optional/nested constraints.
3. Add full version-matched provider schemas and provider-level region handling. Bundled catalogue coverage is not complete Terraform/provider validation. Preserve complex imported expressions without interpreting literal text as a binding.
4. Extend whiteboard parity deliberately: equal-spacing drag guides, resize guides, rotation/freehand, richer shape sets, hyperlink/style clipboard, multi-object resize and precise free connector endpoints. These were not implemented in this bounded pass.
5. Run real screen-reader, 200% browser zoom and large-graph performance testing. Current guide search is linear over visible/model nodes per drag update, without AFFiNE's spatial/adaptive scheduling.
6. Persistence, collaboration/comments, environment/project variable scopes, authoritative validation/pricing and supported Workbench integration still need separately scoped service/product work. Do not invent APIs or claim deployment readiness.
