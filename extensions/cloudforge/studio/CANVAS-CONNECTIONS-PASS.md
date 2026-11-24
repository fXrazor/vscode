# Canvas connections — 24 November 2026

## Evidence checklist

| Question | Evidence and status |
| --- | --- |
| Does Brainboard separate connector visibility from labels? | **Confirmed live UI.** Opened the supplied design URL in the authenticated embedded browser. `design-area-options-bar-change-nodes-trigger` opened Nodes view options: Show titles, Show connectors, Always show connector labels, Animate connector line, Animate connector circles. Menus inspected without changing options or architecture data. |
| What grid choices exist? | **Confirmed live UI.** `design-area-options-bar-change-grid-trigger` exposed Dots, Lines, Hide. CloudForge already has equivalent presentation controls. |
| How does AFFiNE structure connector editing? | **Confirmed source.** `Z:/CloudLab Forge/AFFiNE/blocksuite/affine/gfx/connector/src/toolbar/config.ts` defines endpoint choices, Curve/Elbowed/Straight and stroke editing. `model/src/elements/connector/connector.ts:104` defines geometry, colour, width, pattern, endpoints and label properties on a connector model. Source remains unchanged and none of these files are copied. |
| Does this establish Brainboard's private model/backend? | **Unresolved.** This pass observes UI controls only; no API, websocket, storage or React-internal claims, no traffic capture and no REA Evidence IDs. AFFiNE's Yjs/Lit architecture is not attributed to Brainboard. |
| Can CloudForge adapt these interactions? | **Implemented and verified** for existing resource-to-resource design connections. Free endpoints, shape connectors, bend-point editing, line jumps, rotation and multi-selection remain open. |

## Implementation

`DesignConnection` stores optional label, routing, stroke, width, dash pattern and start/end arrows in the existing Architecture. `updateConnection` and `deleteConnection` share semantic Undo/Redo. Same-value and invalid appearance updates do not consume history. Endpoint identity and Terraform configuration are unchanged; these remain visual design links, not validated infrastructure dependencies.

`ConnectionTools` appears inside the canvas only while a connection is selected. It uses the existing palette and compact controls; Escape/close returns focus to the canvas. Resource selection closes the tool. No permanent toolbar or new sidebar is added. `DesignEdge` renders the selected line with a dashed emphasis and a wide pointer hit area. Hidden labels appear for selected connections; View can reveal them all. View visibility is local presentation state and does not dispatch an architecture action.

`connectionGeometry.ts` supplies shared straight/elbow/Bezier paths for screen and SVG/PNG/PDF presentation export. Stroke, dash, label and arrow choices export, while selection emphasis and hidden-connector preferences do not. The viewport callback now keeps the zoom readout current after programmatic fit/zoom actions.

React Flow documentation was fetched through Context7 (`/websites/reactflow_dev`): BaseEdge, getStraightPath, getSmoothStepPath and getBezierPath. The implementation uses the pinned local package; no dependency upgrades or new libraries.

## Verification

- TypeScript check, 29 tests, production build and whitespace checks pass. New tests cover distinct geometry, appearance bounds/no-op history, deletion/Undo and unchanged Terraform output.
- Browser: selected first design connection, edited label to Application traffic, curve/3px/dashed style, Undo/Redo, switched renderer retaining appearance, deleted/restored the connection, hid/revealed connections, enabled labels, changed theme and fitted the architecture. Zoom reported 60% after fit.
- Downloaded SVG inspected on disk: label, curve, `stroke-width="3"` and `stroke-dasharray="12 9"` retained. Preview captured error log was empty.
- Local screenshots: `output/playwright/connections-configuration-dark.jpg` and `output/playwright/connections-architecture-light.jpg`. These are ignored verification artifacts.

The previous preview server had stopped; verification launched a fresh server at `http://127.0.0.1:52550/`. The old browser tab was left on an unavailable-server page; a new deliverable preview tab was opened. No reference architecture edits or deployments were performed. This remains the standalone preview, not an installed desktop/service verification.

## Next refinement

Continue with multi-selection/group manipulation and shape-to-shape connectors using stable IDs. Keep visual containment distinct from provider containment. Full version-matched provider constraints, typed references/inheritance, collaboration and workspace persistence remain separate gaps documented in RESOURCE-CONSTRAINTS-PASS.md. Do not duplicate the graph model or restore the bottom code dock.
