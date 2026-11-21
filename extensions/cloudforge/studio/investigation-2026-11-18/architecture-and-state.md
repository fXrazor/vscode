# Architecture, workflow canvas, state and data model

This report supplies requested deliverables 3, 5, 6 and 7. Commercial implementation hypotheses are labelled; local source facts are bounded to the recorded snapshot. Supporting ownership/line citations are in [source archaeology](source-archaeology.md) and the [preview map](preview-gap-map.md).

## Rendering and component boundaries

| Target | Confirmed evidence | Hypothesis and limit |
| --- | --- | --- |
| Brainboard live | SVG `rootSVG`, nested groups, SVG nodes/edges and HTML form; DOM resize handles (BB-01–03). | **Strongly Likely:** a graph scene with HTML application panels. Exact React ownership, graph library, layout algorithm, event dispatch and renderer caches **Unknown**. No `.react-flow` root was present in the inspected state, which alone cannot prove a library is never used. |
| Miro live | Multiple canvas elements plus SVG/HTML controls; selected-object toolbar outside canvas container; nested diagram editing context (MI-03/07). | **Strongly Likely:** scene content and screen-space editing overlays use separate layers. Canvas2D/WebGL, renderer vendor, scene graph, workers and offscreen strategy **Unknown**. |
| CloudLab source | [Canvas](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Canvas.tsx:541>) renders an HTML world with translate/scale and SVG lines. Pointer conversion/capture and custom node recursion. | **Confirmed source:** custom DOM/SVG designer in inspected file. Does not prove localhost 4318 runs these exact bytes. |
| CloudForge preview | [DesignCanvas](C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/DesignCanvas.tsx:47) projects Resource/BoardItem into React Flow nodes; [ResourceNode](C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/ResourceNode.tsx:16) switches visual/configuration content. | **Confirmed source:** suitable extension seam for richer renderers. Browser parity at HEAD was not rerun in this pass. |

Recommended component boundaries (**Possible / proposed**, not recovered reference names):

| Owner | Responsibility | State/input | Integration |
| --- | --- | --- | --- |
| StudioController / host adapter | Active authorized architecture, command dispatch, revision changes | One canonical domain snapshot + context | Canonical Rust protocol; no Webview path/process API |
| CanvasSceneProjection | Resource/drawing IDs → render nodes/edges | Domain + selected layout + presentation selection | React Flow controlled nodes/edges; stable maps and memoized components |
| DesignResourceNode / ConfigurationResourceNode | Provider-icon presentation versus inline configuration surface | Same resource ID, typed config and result selectors | One form command system; no independent resource copies |
| WorkspaceLayout | Library, inspector and optional code surface geometry | Presentation-only panel arrangement | Prefer native Code OSS editor groups for real files |
| LibraryPanel / ShapeRegistry | Resources, modules, shapes, custom assets | Search/filter/drawer stack; versioned registries | Lazy data/assets; authorized module/schema resolution later |
| ResourceForm / Field / BlockList | Scalar, collection, nested block, ref/expression editing | Shared typed draft, schema identity, per-path errors | Sidebar and focused n8n-style layout use the same renderer |
| SelectionActions / ConnectorActions | Capability-driven contextual commands | Selection and entity capabilities | React Flow toolbar + Radix popovers/context menus; restore focus |
| SourceNavigation | Entity↔trusted file/range | Fresh context + source revision | Existing `_cloudforge.openSource`; native editor remains authority for file buffers |
| AnnotationLayer | Markers, threads, highlights, anchored review | Separate annotation records + scene geometry | Proposed reviewed annotation persistence; presence is ephemeral |

No source evidence establishes a general browser UI plugin architecture. CloudLab's MCP read/propose tools and AI integrations are service extension points, not proof of a visual-plugin runtime.

For the requested shadcn/ui layer, adapt a small set of styled Button/Input/Select/Tabs/Popover/Dialog/ContextMenu primitives to the existing CloudForge tokens. Select its Radix-based variants to match this stack; do not keep separate handcrafted and shadcn variants for the same control indefinitely. shadcn supports semantic CSS variable tokens; preserve the independent canvas theme when scoping those tokens. [shadcn theming](https://ui.shadcn.com/docs/theming). The current checkpoint records only partial Radix adoption, not completed shadcn migration. VS Code contributes native document/docking behavior; n8n contributes the focused resource-editing layout; Adobe contributes collapsible, task-based workspace arrangements. Those three are design recommendations here, not apps newly reverse engineered in this pass.

## Workflow canvas

### Geometry, viewport and gestures

CloudLab [Canvas.tsx:177](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Canvas.tsx:177>) converts screen coordinates into its x/y/z world and uses a discriminated drag ref for move/pan/marquee/connect/resize. [Designer.tsx:92](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Designer.tsx:92>) brackets gesture history. Reparenting preserves absolute placement while converting to parent-relative coordinates ([model.ts:490](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:490>)). These are useful algorithms and fixture expectations; importing the entire legacy renderer would introduce unnecessary state duplication.

Preview React Flow already supplies viewport, handles, marquee and node resizing. Its current app selection is singular, display projection resets node selection from that ID, and drag-stop commits one node. Full group-move and nested multi-select parity is not established. Implement `moveMany` with original world positions, filtered top-level selected ancestors and one final transaction; do not let a frame and its child move twice.

Store pointer-start/current points and temporary resize bounds locally/ref-based. Cancel must restore the starting layout. Defer persistence/history/expensive schema work until gesture completion. Keep viewport updates isolated from resource/schema subscribers. These are React best-practice recommendations, not measured performance results.

### Hierarchy and semantic relationships

CloudLab [canPlace](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:381>) checks self/descendant cycles, known provider/container rules and ancestors; [applyInheritance](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:430>) sets inherited typed references. Missing definitions explicitly allow placement at line 404: this is a meaningful gap, not complete provider validation.

A visual frame, cloud containment and Terraform module scope are three separate relations. Canonical parentage must be unique, cycle-free and explicit. Module source identity, inputs, outputs and lexical addresses cannot be inferred from whether one icon visually sits inside another box.

CloudLab [Canvas.connect](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Canvas.tsx:312>) selects a unique typed property reference, offers a choice when several paths are valid, or falls back to a drawing-only line. [lines](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:548>) derives reference/depends_on lines separately from visual edges. [unlinkReference](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:611>) can hide a drawn reference without deleting the underlying configuration. Preserve this distinction explicitly in the UI.

### Edges and shapes

Keep React Flow as the preview's canvas adapter. A custom SVG body can render normalized shape geometry inside its node; handles/ports remain explicit. A custom edge uses BaseEdge for the hit path, routing helpers for straight/Bezier/orthogonal curves, and an HTML label portal only when needed. Routing around arbitrary obstacles and line jumps require additional algorithms; routing helper availability does not establish those capabilities. [React Flow custom edges](https://reactflow.dev/api-reference/components/base-edge), [edge labels](https://reactflow.dev/api-reference/components/edge-label-renderer).

NodeToolbar and EdgeToolbar support readable screen-size controls across zoom; a shared toolbar can target several IDs. Verify exact APIs against the pinned package when implementing. Do not scale the whole form with the canvas. [NodeToolbar](https://reactflow.dev/api-reference/components/node-toolbar), [EdgeToolbar](https://reactflow.dev/api-reference/components/edge-toolbar).

Use Radix portals/collision boundaries and focus restoration for secondary popovers and context menus. Overlay ownership must account for scrolled/resized panes and the Workbench Webview boundary. Installing a primitive does not prove the complete interaction accessible. [Radix Context Menu](https://www.radix-ui.com/primitives/docs/components/context-menu).

### Layout, grid and export

Renderer, viewport, theme, grid and panel changes are presentation state. Keep the existing independent light/dark theme. The earlier grid implementation uses world-aligned adaptive spacing; this pass did not remeasure it. A single offscreen scene projection should supply export geometry, typography and edge labels, with chrome excluded. Full SVG fidelity requires all shape assets and clipping/fonts to be represented; PDF remains a separate unverified path.

## State management

| State class | Current evidence | Recommended rule |
| --- | --- | --- |
| Resource configuration / dependencies | Preview Architecture reducer; CloudLab Project with typed Value/Ref/Expr | One canonical domain model, immutable IDs and revisioned commands. Rendering never owns another editable architecture. |
| Drawing content / layout | Preview BoardItem/per-mode positions inside Architecture; CloudLab parent-local bounds | Keep authored drawings and geometry keyed by entity IDs. Their undoable edits may join the shared authoring history; switching renderer/layout preference is not itself an edit. Normalize layout metadata without duplicating resources. |
| Theme / viewport / selection / panels | Preview local state and viewport refs | Presentation state; no semantic undo. Restore focus/selection through panel and mode transitions. Workspace-scoped persistence is a host preference decision. |
| Pointer gestures | CloudLab drag ref + begin/preview; preview transient React Flow nodes | Local transient state; begin/update/commit/cancel transaction; commit all affected IDs atomically. |
| Form draft | Preview shared fields/string values | Typed per-entity draft with base revision/schema identity; retain dirty draft across layout changes, detect conflicting source edits. |
| Native editor draft | CloudLab EditorDraftStore/sessionStorage; Code OSS already owns text buffers | Native editor owns dirty documents. Code generation, graph read and unapplied text are not three equally authoritative saved copies. |
| Validation / estimated cost | Preview local name checks and unavailable pricing | Derived results keyed to graph/schema/pricing revision, region/currency/time where relevant. No invented prices or duplicated editable validation graph. |
| Save acknowledgement / recovery | CloudLab 400ms acknowledged save + immediate recovery + 4s Terraform snapshot | Explicit pending/saved/error state tied to actual backend acknowledgement. Preserve recovery but do not report it as durable server save. |
| Comments / presence | Live Miro composer/socket; no preview entities | Durable review annotations separate from infrastructure generation; transient cursors/selection presence never enter undo. |

CloudLab uses React present state and bounded past/future refs, not a confirmed external state-store library. Explicit saved versions cap at 30 and differ from undo. Browser recovery is account-scoped, and service writes are serialized. The server's cache data-token checks prevent stale cached snapshots, but the inspected batch API does not establish expected-document-revision conflict checks. SQLite/Supabase/Redis presence is not evidence of realtime collaborative merge.

For CloudForge, use narrow selectors/ID indexes and memoized render projections first. Preserve one command log/history; do not add Redux/Zustand or CRDT dependencies solely to imitate an assumed reference architecture. Profile a realistic large graph before selecting a different store.

## Data model

**Confirmed source:** [CloudLab Value/ArchNode/Project](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:13>) carries scalars, null, refs, expressions, arrays/objects, parentId, config, file, lifecycle/depends_on and module inputs/outputs. **Confirmed preview:** [model.ts](C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/model.ts:11) stores primitive catalogue fields, string settings, generic blocks and resource-only untyped connections. These are not interchangeable without a migration/adapter.

Proposed document concepts (**Possible**, not an approved wire contract):

```ts
type ValueIntent =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'reference'; targetId: string; attributePath: string[] }
  | { kind: 'expression'; source: string }
  | { kind: 'list'; items: ValueIntent[] }
  | { kind: 'object'; fields: Record<string, ValueIntent> }
  | { kind: 'unknown'; expectedType: string };
// Omitted is absence of a field, not literal null or unknown.

type SchemaIdentity = {
  providerAddress: string; providerVersion: string; schemaDigest: string;
};
type ResourceIntent = {
  id: string; type: string; declarationKind: 'resource' | 'data';
  parentId?: string; moduleScopeId?: string; fileId: string;
  schema: SchemaIdentity; attributes: Record<string, ValueIntent>;
  blocks: BlockInstance[]; dependsOn: string[];
};
type BlockInstance = {
  id: string; schemaPath: string[];
  attributes: Record<string, ValueIntent>; blocks: BlockInstance[];
};
type Endpoint = { entityId: string; portId?: string };
type VisualConnector = {
  id: string; from: Endpoint; to: Endpoint;
  routing: 'straight' | 'orthogonal' | 'bezier';
  stroke: { color: string; width: number; dash: 'solid' | 'dashed' | 'dotted' };
  startMarker: string; endMarker: string;
  label?: { text: string; fraction: number; offset: number; rotation: 'follow' | 'horizontal' };
};
```

Further required contracts:

- Schema descriptors retain collection element types, list/set/map and nesting modes, min/max items, required/optional/computed/sensitive flags, defaults and deprecation. Stable UI IDs are not Terraform set identity. Provider schemas do not express every runtime/cloud validator.
- `ProviderRequirement` stores source address and authored constraint; actual lock metadata stores resolved version/hashes. Catalogue snapshot, package version and resource schema version remain distinct.
- `ModuleInstance` stores module definition identity and scope, typed inputs, declared outputs, provider mappings and source reference handled through the authorized host. A frame is not a module.
- `ShapeDefinition` stores family, normalized geometry, viewBox, ports, bounds/resize rules, capabilities and asset provenance; `DrawingItem` references its ID plus bounds/styles/text. Do not embed thousands of definitions in every architecture.
- `SourceMap` keys entity IDs to file/range at a source revision. Generated compact IDs may change across source rereads; reconcile only through trusted mappings, not display-name equality.
- `PlacementDecision` is allowed/rejected/unknown with machine reason, affected inheritance and expected revision. Domain authority rechecks on commit.
- `SelectionModel` includes entity IDs, optional edge/field path, origin and revision. It is presentation state; origin prevents code→graph→code loops.
- `WorkspacePresentation` keys layouts/viewports/panels by architecture and renderer, stores independent theme/grid and optional minimized panels. It carries no copied resource configuration.

Proposed mutation envelope: `{context, expectedRevision, operationId, command}` → `{newRevision, changedIds, diagnostics}` or structured stale/rejected result. This is an interface design for review, not a method added to the current service. Establish undo ownership and native dirty-buffer behavior before implementing writes.
