# Shared canvas controls, nesting and feedback — 25 November 2026

Latest checkpoint after the user's explicit resume. This incorporates the uncommitted 24 November element-controls/node-details batch and the eleven new annotations. The paused records remain historical evidence, not the current next-action list.

Integration owner: Codex. Repository: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`; branch: `codex/infrastructure-studio-preview`; starting revision: `ccf110495e1209a3a3715a7ed038f5534507d887`. Resolve the checkpoint commit using `git log -1 -- extensions/cloudforge/studio/NESTING-AND-FEEDBACK-PASS.md`. Implementation belongs to the standalone `extensions/cloudforge/studio` preview; root `HANDOFF.md` records the integration boundary. Rust, protocol, installer, packaged Workbench, dependencies and reference checkouts were not changed.

## Annotation-to-implementation map

| User annotation | Implemented behavior | Ownership |
|---|---|---|
| 1: show which panels are open | Active styling, `aria-pressed`, `aria-expanded`, controlled panel IDs and contextual Show/Hide labels. | `VisualTopbar`, `App`, `ResourceCatalogue` |
| 2–4: resource-group/network/subnet nesting | Schema-backed resource containers render real boundaries, headers, counts and native corner handles. Known valid targets turn green; invalid targets turn red with a reason. Invalid drops restore the graph without history. Nearest compatible ancestors are identified explicitly. | `resourceHierarchy.ts`: `resourcePlacement`, `fitResourceContainers`; `DesignCanvas`: `placementAt`, `commitDrag`; `ResourceNode` |
| 2–4: move within/outside boundaries | Parent selection and drag placement preserve world coordinates; moving a container moves descendants once. Detaching releases inherited references while retaining inactive literals. Subtree copy/delete/Undo preserve hierarchy. Locked descendants prevent moving/deleting their ancestor. | `model.ts`, `canvasOperations.ts`, `selectionGeometry.ts` |
| 5–6: actionable errors/warnings and learner guidance | Local severity counters open an issue list; selecting a finding opens the resource and focuses its field/required-block notice. Node badges are actionable. Field-help controls expose bundled descriptions, declared type, required state and supported reference types. | `diagnostics.ts`, `IssuesPanel`, `SchemaField`, `ResourceFields` |
| 7: inheritance provenance | Shared forms show source resource, attribute and generated expression. Reveal-source, Use own value and Restore inheritance operate on stable resource IDs. Variable bindings explicitly override inheritance. | `resourceHierarchy.ts`: `inheritedReferences`; `fieldBindings.ts`; `SchemaField`; `ResourceWorkspace` |
| 8–9: movement missing in the other renderer | Position edits now write both retained layout fields; frame geometry no longer multiplies by renderer. Configurations, hierarchy, bindings and semantic history remain single-source. Viewports and canvas theme remain presentation state. | `model.ts`, `canvasOperations.ts`, `DesignCanvas`, `fixture.ts` |
| 10: technical dependency lines | Technical mode hides solid design links by default. Inherited references derive separate dotted dependencies, selected incident animation and reduced-motion fallback. Clicking a derived edge opens the consumer; it cannot be deleted as a stored design link. View exposes optional design/all-dependency visibility. | `DesignCanvas`, `DesignEdge`, `resourceHierarchy.ts`, `styles.css` |
| 11: diagramming/flowcharts | Six basic plus ten flowchart stencils use original SVG paths. Editable labelled deployment-review workflow inserts six shapes and six connectors as one undoable action. Search/drag/create, shared formatting and exports reuse the existing drawing model. | `shapes.ts`, `ShapeLibrary`, `workflowTemplate.ts`, `App` |

The preceding batch also delivers object-anchored selection controls; native icon resizing; direct multiline text editing; multi-selection, grouping, alignment/distribution, locks, layers and internal copy/paste; typed Terraform-variable pickers; a resizable focused workspace with scoped HCL left, shared parameters centre and dependencies/variables/checks right; and one right-inspector content scroller under fixed chrome. There is no bottom code dock. See [NODE-DETAILS-CHECKPOINT.md](NODE-DETAILS-CHECKPOINT.md) and [ELEMENT-CONTROLS-CHECKPOINT.md](ELEMENT-CONTROLS-CHECKPOINT.md) for those source correlations.

## Evidence and confidence

**Confirmed, reference runtime:** the supplied CloudLab page exposes nested DOM containers for Resource group → Virtual network → Subnet; the VM form shows inherited group/location references; header panel controls expose active state; Checks opens local overlap warnings. Opened Checks then restored its prior collapsed state. The reference graph was not edited. Miro's selected shape toolbar and searchable Diagramming shapes drawer expose Basic Shapes, Flowchart and Connectors sections. The drawer was opened and closed; no board content was changed.

**Confirmed, source:** `Z:/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts` functions `canPlace` (~381), `applyInheritance` (~430), `fitContainers` (~450), `reparent` (~490); `Canvas.tsx` `finishMove` (~288) and `drop-ok/drop-bad`; `validation.ts` local severity/CIDR/reference checks. Reference revision observed: `003f5d662be59fe92719034917fabc7c4572129a`. The copied `cloudlab-core/catalog/types.ts` provides `ResourceDef.container`, `parents`, `inherit`, reference types and field metadata. Eight copied core hashes still match [the manifest](CLOUDLAB-CORE-PROVENANCE.json). AFFiNE control/selection/viewport adaptations remain documented in [AFFINE-ADAPTATION.md](AFFINE-ADAPTATION.md) and the earlier checkpoints; no AFFiNE engine was transplanted.

**Confirmed, current API guidance:** React Flow v13 nested parent coordinates and native resize/toolbar/viewport APIs were checked through Context7. Resource model positions stay absolute; only the React Flow projection uses relative parent coordinates. Architecture Design and Infrastructure Configuration use renderer-scoped Flow stores, one shared domain model/history, and saved independent viewports. Source-checkout behavior, including n8n/AFFiNE evidence from earlier passes, is distinguished from fresh runtime observations.

**Unknown/uninspected this slice:** Brainboard/Miro server contracts, persistence, websockets and multi-user synchronization. No such contracts are invented here. This pass adapts interaction principles and uses available owned source evidence.

## Domain and projection contract

- `Resource.parentId` is infrastructure containment. Drawing-frame membership and visual groups remain separate concepts; rectangles never silently create Terraform hierarchy.
- `containerSize` and element positions describe shared diagram geometry. No configuration/dependency/cost data is duplicated per renderer.
- `inheritanceOverrides` stores explicit opt-outs. Active inherited values derive from ancestors and bundled rules; literal values remain available for override/detach. Nested rules activate only when the corresponding block path exists, so no dependency is advertised for a missing generated block.
- `projectTerraform` computes typed `$ref` generator values. The source-owned generator is unchanged. Bounded Apply compares parsed generated configurations so unchanged inherited expressions round-trip; unsupported reference/type/block edits reject and retain their draft.
- Local findings are deterministic derived data, not a second state store or a claim that Terraform validated the project. Sample VM deliberately exposes a required `os_disk` finding; Application Gateway reports limited schema coverage.

## Fresh verification

Using pinned Node `24.22.1` and pnpm `12.16.0`:

- `corepack pnpm run check`: passed.
- `corepack pnpm run test`: **58 tests, 58 passed, 0 failed**, including all 4,078 catalogue primitive descriptors, three-provider nesting rules, cycles/provider boundaries, inherited/nested projection, override/variable/detach, supported HCL apply, shared movement, subtree copy/delete/locks, atomic history, local diagnostics and flowchart export/insertion.
- `corepack pnpm run build`: passed.
- Eight copied-core SHA-256 checks: passed. No dependency or lockfile changes.
- Root lint remains unavailable from the earlier pass because root `minimatch` is missing; no root lint success is claimed. The copied generator's previously reported unused `ctx` was left intact. No Code OSS desktop rebuild was required for this isolated preview.

Fresh browser work used an isolated preview at `http://127.0.0.1:58307/`; the user's reference tabs were preserved. Observed:

1. Single selection opens the right form; native icon corner handles resize 48→96px, and one Undo restores 48px.
2. A VM move is visible at identical world coordinates in Configuration and Architecture; one Undo restores the prior position. Dark theme survives renderer switching. Technical mode has zero solid design edges by default; selected inherited edges use `2 6` dash geometry.
3. A dragged VM shows green Subnet feedback. A Subnet dragged over an incompatible Resource group shows a red target/reason, then restores its position and parent with Undo still disabled. Intermediate drag evidence used ordinary CDP pointer input through the supported CUA developer capability; early native coordinate attempts were discarded. Browser zoom affected coordinate scaling; do not reuse those raw coordinates.
4. Issue selection focuses the VM required-block notice. Field-help opens and Escape closes it. With the long VM form visible, only `inspector-content` scrolls on that side.
5. The focused workspace shows scoped Terraform on the left and identical inherited parameter fields. Real Monaco clipboard editing changed the VM name to `vm-reviewed`; Apply updated the graph while preserving ancestor expressions, Back returned to canvas, and one semantic Undo restored the name. Do not use textarea `.fill()` to replace Monaco's document.
6. The flowchart starter inserted six editable shapes and labelled Yes/No connectors; one Undo removed the complete insertion.
7. Actual CSS widths **320, 390, 768 and 1025px** with supporting panels collapsed had zero document/header horizontal overflow. Viewport overrides were reset. Earlier assessments cover narrow focused-pane tabs; this pass does not claim fresh touch/screen-reader or 200% zoom verification.
8. SVG/PNG downloads include embedded provider icons and infrastructure-container geometry. The PNG was opened and visually inspected. Print/Save PDF was not completed. Captured page console had zero error entries at the recorded check.

Local, ignored evidence lives under `output/playwright/`: `nested-configuration-dark-2026-11-25.jpg`, `focused-resource-dark-2026-11-25.jpg`, `nested-presentation-2026-11-25.png`. Screenshots are artifacts rather than production assets.

After these checks, the browser connection closed and could not be recovered through its documented control surface. The last small additions—inline first-setting editing on technical container headers, quiet help-button styling and removal of dependencies for absent nested blocks—passed fresh TypeScript/tests/build, but were not browser-rechecked. Do not treat the saved screenshots as captures of those final small changes. The final explicit per-view 50%/70% zoom-restoration recheck did not execute; the earlier independent-viewport evidence remains historical. Temporary responsive overrides had already been reset. The QA tab could not be marked/closed after the disconnect; no user reference tab was deliberately reloaded or closed.

## Impeccable review and boundaries

Retained the incumbent Inter/white-violet system, used semantic danger/warning/success/dependency tokens, kept selection controls contextual, and reviewed both themes and recovery paths. Removed obsolete appearance components and their orphaned styles; field-help buttons now use the shared quiet treatment. The earlier two independent assessments and single detector run are recorded in the node-details checkpoint. The earlier 30/40 score is historical; this is an unscored follow-up, not a new claimed rating or a second detector run.

Known limits: nesting/ref constraints exist only where bundled definitions provide them; many resources retain primitive-only coverage. Sibling resource-attribute reference picking (for example choosing a specific NIC for a VM), complete provider-version schemas, arbitrary HCL expression/source round-trip, IPv6/dynamic CIDR evaluation, pricing, persistence and deployment remain open. Dependency animation represents a reference relationship, not observed execution or traffic. Flowchart starters are diagram content, not executable workflows. Presentation export uses a white background and current graph geometry, not the active canvas theme or viewport.

## Exact next action

When browser control is available again, first verify the final inline container CIDR editor/help styling and explicitly restore independent 50%/70% renderer zooms in a fresh disposable tab. Then add typed resource-attribute reference selection alongside Value/Variable/Inherited in the shared `SchemaField`, constrained by bundled `refTypes/refAttr`, with stable IDs, assignable output types, dependency projection, sensitivity and round-trip tests. Start with VM → NIC IDs and subnet references. Keep graph semantics distinct from drawing links. Then import complete version-matched schemas through the approved Rust/service boundary, rather than extending hand-authored guesses. Large-graph performance, equal-spacing/resize guides, multi-object resize, rotation/freehand, free connector endpoints and collaborative annotations need separate bounded passes. Integrate the preview into supported Workbench contributions only through the recorded product/protocol plan.
