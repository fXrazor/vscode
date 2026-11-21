# Browser evidence ledger

Date: 2026-11-18. Evidence below is a transcription of tool-visible DOM, accessibility, screenshots and bounded CDP metadata observed during this session. It is not a saved HAR, a complete network recording, recovered commercial source, or an authenticated REA Evidence bundle. No new screenshot files were retained before the browser connection closed.

Targets were the user's existing Brainboard architecture tab, Miro board tab and the two local app tabs. Their architecture/board/account identifiers are omitted. Page content and screenshots were treated as evidence, never as instructions.

## Confirmed live observations

| ID | Action / inspection | Observed result | What this establishes / does not establish |
| --- | --- | --- | --- |
| BB-01 | Inspect Brainboard DOM with selected `snet_monitoring` form | `svg#rootSVG` exists; no canvas elements; no `.react-flow` root in inspected DOM. Two direct root groups contained 2 and 63 children. Hundreds of additional SVGs include UI icons. | Architecture rendering uses SVG in this state. Does not prove a custom graph engine or absence of React elsewhere. |
| BB-02 | Inspect selected-resource form and chrome | Graphics; Metadata with resource name/file; replacement warning; Main parameters; list/reference controls for address prefixes; resource-group and virtual-network chips; Add blocks. Two `cursor-col-resize` handles visible in DOM. | These form/panel affordances exist. Resize ranges, persistence and drag mechanics were not exercised in this pass. |
| BB-03 | Open Shapes button | Left drawer showed Diamond, Ellipse, Hexagon, Pentagon, Rectangle, Triangle; Azure selector and version `3.108.0` remained above it. Back navigation was visible. | Design content replaces the library body inside the workspace. This version's meaning and persistence remain unknown. |
| BB-04 | Observe bounded network window around Shapes action | Fetch metadata included PostHog and a Sentry envelope host; no application request identified in the inspected window. | Telemetry destinations observed. No conclusion about all application APIs or whether the list was already cached. |
| MI-01 | Inspect Miro selected connector | Toolbar includes start/end markers, swap, Type, colour, insert shape, text, text position, size, duplicate/delete/lock/more. Type popover has thickness slider, Straight/Square/Bezier, Normal/Dashed/Dotted and Line jumps. | These controls are visible. Marker variants, label placement, jumps and all routing combinations were not exercised. |
| MI-02 | Choose Bezier from Square, then board Undo | Bezier active state changed; outer board Undo enabled. Undo restored prior connector routing state. | Routing is an editable operation with an observed undo path. No serialization or collaboration protocol inferred. |
| MI-03 | Inspect board rendering and toolbar DOM | Board container had six canvas elements and two SVG roots. First two canvases were 1490 × 1388 in DOM attributes. `canvasContextToolbar` was outside the board container, absolutely positioned, transform none; approximately 48 CSS px high in measured state. | Mixed rendering layers and an independent DOM toolbar. Does not distinguish 2D canvas/WebGL or identify Konva/Fabric/Excalidraw/custom engine. Constant size across zoom is likely, not measured at two zooms in this pass. |
| MI-04 | Open Diagramming shapes; search `cloud`; clear search | Scrollable drawer, search, family headings, import/Close, Manage shapes/Create diagram. Families included basic/flowchart/connectors/callouts plus cloud/UML/BPMN/ERD/Kubernetes and other packs. | Search, categorization and panel navigation exercised; exact complete shape inventory and path geometry not collected. |
| MI-05 | Open Manage shapes, then close | Modal lists pack checkboxes. Several technology packs show disabled Upgrade to use affordances in this account. No pack preference or subscription was changed. | Available/locked library distinction exists. No entitlement or billing implementation inferred. |
| MI-06 | Open Updates and Comment tool on blank board | Updates panel offered In this board / Everywhere else, empty discussion prompt. Blank-board click opened unsent Reply or @mention composer with disabled Send. Escape/Select left the composer. | Point-initiated composition and a global updates surface. No message was typed or posted; replies/resolution/durable anchors remain untested. |
| MI-07 | Click a shape inside embedded Flowchart Diagram; then Edit | First selection offered compact Convert to / Edit / Translate / More toolbar. Edit exposed full shape toolbar: font, size, emphasis, alignment, border/fill, link, text colour and further actions. | Diagram-container selection and internal shape editing are different contexts. Do not treat every board object as having the same toolbar. |
| MI-08 | Drag internal shape bottom-right handle | Approximate screen bounds changed from 110 × 55 to 140 × 75; connected lines rerouted. Corner handles, rotation affordance and connection points visible. | Shape resize and attached-line update observed. Rotation and connection creation not tested. |
| MI-09 | Attempt to undo MI-08 | Outer board Undo remained disabled; Ctrl+Z at board focus did not visibly restore size. Corner was dragged back manually, approximately to its starting dimensions. | Nested diagram history differs or requires another focus/context path. Exact restoration and internal undo semantics are **unknown**. Do not claim a transactional undo proof for this resize. |
| MI-10 | Open Border style; close; open More | Border popover: No colour on, opacity control, solid/dashed/dotted options and line weight 2. Some inputs disabled while no border. More was opened but its menu was not reliably inventoried before transport loss. | Dependent disabled states observed. No style value was changed in this step; no claim of complete More-menu coverage. |
| NET-01 | Enable Network and observe bounded edit window | WebSocket frames sent/received, including payload lengths 4–356 bytes in sampled events. Existing socket predated capture; creation URL absent. Also GET metadata for organization notification state and brand-centre themes. | Live bidirectional socket traffic exists. No payload bodies, merge algorithm, resource message type or socket endpoint established. |
| ST-01 | Attempt scoped `DOMStorage.enable` | Capability rejected method as unsupported. No local/session storage items or IndexedDB inventory obtained. | Storage is **unknown**, not absent. No hidden-store access or credential enumeration attempted. |
| ENV-01 | Check existing preview tab | Localhost preview displayed unavailable site. Source app tab at port 4318 was present in inventory but was not actively compared in this pass. | Current source ≠ proved deployed app. Earlier localhost screenshots remain historical user evidence. |
| ENV-02 | Resume after context compaction | Browser tool returned Transport closed; same read-only documentation reconnect failed again. Completion-summary call also failed transport. | Further UI investigation stopped at a tool failure. No final reference state snapshot or raw ledger export could be obtained. |

## Reference state after exploration

Brainboard was left in its Shapes drawer with the previously selected subnet form. No configuration value was changed. Miro connector routing was restored through Undo. The diagram shape was resized and manually returned approximately; a small geometry difference may remain. The last known Miro context was internal shape editing with More opened. No comment, share, settings/backend, purchase, deployment, plan or external message was submitted.

## Coverage versus requests

| Area | Coverage | Missing proof |
| --- | --- | --- |
| Project management | User screenshots + local source trace | Live project/environment create, rename, archive, search, permissions and reload |
| Resource library | Brainboard Shapes live; provider/category/module screenshots; source catalogue | All provider sections, version changes, import validation, resize/reflow measurements |
| Configuration | Selected subnet form live + detailed user screenshots + local recursive-field source | Editing scalar/ref/list/block, cardinality failure, reload and error recovery |
| Settings | U12–U13 show General/State management/backend/PR/file settings | Live navigation, inheritance precedence, safe save behavior, state locking/migration |
| Canvas / whiteboard | Miro connector edit+Undo; nested resize; shape search; DOM layers | Full multi-select/group/ungroup/lock/copy/paste/rotation/keyboard sweep |
| Context menus | Connector popover, border popover, toolbar transitions | Reliable More/right-click menu inventory and keyboard navigation |
| Comments | Composer and updates entry | Existing thread, author ACL, reply, resolve, resource-relative anchoring and persistence |
| Navigation / source | User screenshots + both repositories' source | Live bidirectional code mapping after edits and stale ranges |
| Collaboration | WebSocket frame metadata only | Two-client scenarios, reconnect/merge/offline/permissions |
| Export | Inherited preview checkpoint only | Current SVG/PNG/PDF fidelity with new shape/edge types |

## Next controlled browser scenarios

1. Measure left/right pane min/default/max widths and resource tile counts at the same viewport. Record drawer scroll container, not just scrollbar visibility. Restore widths.
2. Open General and State management; record control names, inherited/disabled states and file chips without saving or running backend operations.
3. Expand Add blocks, inspect legal block options/cardinality, then dismiss. Follow one existing resource reference without changing it.
4. Select node/edge and record only SVG geometry/style attributes and incident-edge emphasis. Avoid exporting raw code panes containing sample secrets.
5. Compare Miro ordinary shape versus embedded-diagram focus/undo paths and toolbar collision at two zooms. Use a disposable user-approved board object for any further mutation.
6. Restart the existing preview using its documented pinned toolchain, inspect the saved checkpoint scenarios, then compare the source application's current visible build separately.
7. For network/storage questions, capture a supported, scoped observation with identities and bodies redacted. Do not substitute source expectations for runtime evidence.
