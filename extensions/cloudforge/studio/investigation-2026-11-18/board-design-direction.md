# Board design direction — Impeccable / Operate

This is a planning brief for refining the existing CloudLab-derived CloudForge board. It is not a replacement visual world, a rendered design proof or a new implementation. The current source/checkpoint and user screenshots are the incumbent visual evidence. Apply Impeccable's craft floor immediately before a future UI edit; it was not loaded as an editing requirement during this documentation pass.

## Product task and hierarchy

Help a cloud engineer assemble, configure, understand and communicate one infrastructure design. The canvas is primary. The library, resource form and code editor support the current task and can close. Brand comes from precise typography, spacing, icons and reliable interactions.

1. **Work:** architecture icons/groups/relations or configuration nodes, depending on renderer.
2. **Current object:** selection outline, concise name/type/status and contextual editing.
3. **Supporting tools:** resource library, inspector and native editor groups, opened when relevant.
4. **Application context:** compact architecture/environment identity and save/error status only when actionable.

Do not duplicate persistent status, breadcrumb, top toolbar and secondary tab rows to advertise features. Keep command palette/shortcuts as a discoverable alternate entry. Closing a supporting surface restores canvas or initiating-control focus.

## Refinement specifications

| Area | Direction | Evidence / acceptance |
| --- | --- | --- |
| Shell | Preserve existing CloudLab-derived neutral panels and compact source layout. Architecture identity editable; environment scope meaningful when backed by domain data. | Current App defaults library 346px, inspector 280px, source header styling 48px; these are current preview values, not measured Brainboard constraints. No fake account/database/deploy success labels. |
| Library | Provider/version/search stay together, categories form a readable vertical hierarchy, tiles have consistent icon bounds. Panel-width-dependent reflow rather than fixed column count. | Current CSS auto-fill minmax(66px,1fr) and 6px gaps. User screenshots demonstrate roughly five versus seven reference columns at different widths. Measure actual resize thresholds later; do not invent min/max parity. |
| Scroll | One scroll region per library/form body, fixed compact header/footer only when useful. Preserve keyboard scrolling and visible focus. | A screenshot with no visible scrollbar does not mean no scrollable content. Do not remove overflow to imitate a hidden/overlay scrollbar. |
| Architecture nodes | Provider icon + concise label, minimal chrome, strong enough selection outline; frame title and boundary establish scope. | Presentation-friendly; additional technical data is a contextual disclosure. Export must use the same geometry. |
| Configuration nodes | Stable icon/name/type header, a few relevant typed parameters, status with explanation, dependencies on demand. | Validation/cost show unavailable or stale honestly. Avoid permanently rendering every field or a full form on every node. |
| Overview cards | Stable header and action affordance; 2–4 useful summary rows; references as target chips; inherited/computed/sensitive distinct. | No nested button inside a whole-card button. Header action opens shared form; label truncation has accessible full text. |
| Nested forms | Left hierarchy guide + disclosure chevron, block label/count, optionality and local Add/remove actions. Expand errors and reveal field path. | Same component sidebar/focused view. Deep nesting supports breadcrumbs/section navigation rather than progressively narrower fields forever. Counts respect schema min/max. |
| Selection toolbar | Screen-readable, one toolbar for selected item/group, separated typography/appearance/arrange/actions. Use capabilities to hide irrelevant controls. | Form controls and labels use ordinary product typography. Menu/popover escapes clipping, avoids inspector, remains keyboard reachable. |
| Connector toolbar | Separate routing/markers/stroke/text/action groups. Slider changes preview immediately, commit once; label edit stays near line. | Selected infrastructure reference permits only valid semantic actions. A drawing-only line is clearly distinct. |
| Panels/docking | Resize by pointer or keyboard; close/reopen retains useful width and draft. Native editor groups for files. | Protect canvas at narrow widths; collapse lower-priority surface rather than squeezing all panels below usable widths. Dock changes do not modify graph or theme. |
| Grid/theme | Keep existing subtle world-aligned adaptive grid. Independent light/dark tokens with suitable icon/label contrast. | Renderer changes preserve theme. Low-zoom background stays quiet; all chrome and exported background obey explicit theme/export choices. |

## Interaction states and craft

Use one product sans, existing scale and restrained accent for primary action/selection. Monospace belongs to code/technical identifiers. Keep neutral borders and a clear focus ring; semantic green/red must have text/icon equivalents. Future exact colour/spacing changes should come from measured current tokens, not invented reference values.

Every interactive surface needs default/hover/focus/active/disabled/loading/error states. Schema loading uses a stable skeleton; an unavailable schema retains editable context with clear coverage limits. Save failure remains visible until resolved. Error toasts must not cover nodes/handles. Prefer inline feedback near the affected field over global notifications.

Motion communicates changes, typically short 150–250ms transitions; respect reduced motion. No decorative entrance choreography or perpetual edge animation. Menus/popovers use portals/collision handling, and Escape closes the nearest editing layer first.

## Shape/icon resource decision

Recommended first slice: keep React Flow, author standard basic/flowchart SVG geometry in a small versioned ShapeRegistry, and use the already present Lucide package for interface/general symbol icons. Lucide publishes ISC terms, with MIT notices for Feather-derived icons; retain the applicable notices. It is an icon resource, not a complete editable flowchart/port model. [Lucide licence](https://lucide.dev/license).

For a broader optional resource, diagrams.net documents a stencil XML format and lazy family loading. Build an importer/normalizer behind the registry rather than embedding a second editor/store. Its stencil assets carry additional distribution terms distinct from core code; record per-pack origin and terms before selecting assets. Do not assume core licensing covers every cloud/logo pack. [Stencil format](https://github.com/jgraph/drawio/wiki/Shapes-and-Stencils), [stencil asset terms](https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/stencils/LICENSE).

No asset package was installed or copied in this investigation. Do not scrape proprietary Miro/Brainboard assets as a substitute for a supported shape resource. The aim is to adapt interactions while preserving CloudForge's identity and source ownership.

## Visual review matrix for the next implementation

- Architecture and Configuration × Light and Dark, with the same graph and selected resource.
- Narrow/wide library and inspector; bottom/left/right/closed code; focused resource workspace.
- No selection, one shape, one resource, connector, mixed multi-selection; popup near each viewport boundary.
- Empty/search/no-match library, loading/missing schema, invalid/stale field, dirty code, save error.
- 25%, 100%, 400% zoom; long names, long references, nested blocks and dense connected graph.
- Keyboard-only editing/resize/menu close, reduced motion, export without authoring chrome.

These are acceptance scenarios, not passed checks. Review rendered output against the incumbent screenshots and tokens after implementation, and batch fixes before repeating visual checks.
