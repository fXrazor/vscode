# Studio continuation checkpoint — 25 November 2026

## Current handoff — read first

### Technical Graph Rebuild — Phase 4 Provider Topology Patterns & Phase 5 WhyPanel Evidence Integration (26 November 2026)

- **Worktree / branch / owner:** `E:/Orca/CloudForge-Code/dace`, branch `fxrazor/continue-project-handoff-review` (fast-forwarded to `origin/main` `c39a66477bc` including Claude's PR #3 dedicated `TechnicalGraph.tsx` before adding Phase 4–5), integration owner Antigravity. Resolve the commit with `git log -1 -- extensions/cloudforge/studio/src/technicalGraphPatterns.ts`.
- **Conflict-free scope (zero edits to `App.tsx`, `protocol.ts`, `liveSchema.ts`, `resourceValues.ts`, `CodePanel.tsx`, `ResourceFields.tsx`, `SchemaField.tsx`, `assets/*`, or any file in Codex's active `codex/provider-editor-coverage` worktree):**
  - Added `extensions/cloudforge/studio/src/technicalGraphPatterns.ts` + `technicalGraphPatterns.test.ts` (4 comprehensive positive + negative test suites).
  - Wired `patterns` and `boundaries` into `TechnicalGraphSnapshot` in `extensions/cloudforge/studio/src/technicalGraph.ts` (strictly additive; also fixed `id in wave` -> `Object.hasOwn(wave, id)` for root oxlint cleanliness).
  - Wired Phase 4 topology pattern cards, clickable direct `Uses` / `Used by` peer links, clickable cycle member links, Phase 5 deterministic evidence checks, and honest mixed-provider/multi-region/Kubernetes-adapter boundary badges into `WhyPanel` in `extensions/cloudforge/studio/src/TechnicalGraph.tsx` + matching light/dark styles in `extensions/cloudforge/studio/src/technical-graph.css`.
  - Registered `src/technicalGraphPatterns.test.ts` in `extensions/cloudforge/studio/package.json` `"test"` and updated this handoff + root `HANDOFF.md`.
- **What Phase 4 & Phase 5 integration delivers:**
  - **Evidence-backed topology patterns (`detectTechnicalGraphPatterns`):**
    1. **Azure Hub-Spoke** (`azure-hub-spoke`, backed by verified `azurerm_virtual_network_peering` local + remote references).
    2. **AWS VPC Network** (`aws-vpc-network`, `aws_vpc` + evidenced `aws_subnet` + linked `aws_internet_gateway` / `aws_nat_gateway` / `aws_route_table`).
    3. **AWS Organizations Landing Zone** (`aws-landing-zone`, requires `aws_organizations_organization` + `aws_organizations_account` + linked governance resources — VPCs named `"landing-zone"` never match).
    4. **Managed Kubernetes (AKS / EKS / GKE)** (`managed-kubernetes`, requires evidenced network/node-group/identity/monitoring links; explicitly states that in-cluster Pods/Services/NetworkPolicies require an explicit Kubernetes adapter).
    5. **GCP Regional vs Global HTTP LB Chains** (`gcp-load-balancer-chain`, strictly separates regional vs global forwarding-rule → proxy → url-map → backend-service hops; cross-scope links never match).
  - **Honest architectural boundaries (`summarizeGraphBoundaries`):** reports `providers` / `mixedProviders`, `knownRegions` / `multiRegion` (ignoring `'Unknown'` regions so missing regions never fake multi-region), `moduleCallIds`, and `kubernetesAdapterStatus: 'none' | 'manifest-adapter-required'`.
  - **Deterministic snapshot troubleshooting & shortest path (`snapshotTroubleshootingFindings`, `shortestSnapshotPath`):** surfaces ordering cycles, missing documented structural parents/attachments, and Kubernetes manifest adapter notices directly over `TechnicalGraphSnapshot`, plus bounded BFS shortest path with per-hop field provenance.
- **Fresh verification (26 November 2026):**
  - `corepack pnpm --dir extensions/cloudforge/studio run check` (`tsc --noEmit`): **PASS**
  - `corepack pnpm --dir extensions/cloudforge/studio run test`: **198/198 PASS** (0 skipped; +4 Phase 4/5 positive+negative suites atop merged 194/194)
  - `corepack pnpm --dir extensions/cloudforge/studio run build` & `node extensions/cloudforge/esbuild.webview.mts`: **PASS**
  - `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` on `technicalGraphPatterns.ts`, `technicalGraphPatterns.test.ts`, `technicalGraph.ts`, `technical-graph.css`, `package.json`: **PASS** (0 warnings/errors)
  - Extension Node tests (`CLOUDFORGE_REPO=Z:/CloudForge`): **97/97 PASS** (0 skipped)
- **Exact next action:** once Codex's `codex/provider-editor-coverage` worktree merges to `main`, finish remaining Phase 5/6 items: promote `source-graph` edges in `technicalGraph.ts` with `readResourceValues` field expressions (via `App.tsx` once Codex lands), deduplicate the Phase 1–2 standalone workflow helpers against `technicalGraph.ts`, and run the Windows Edge `technical-view-verify.mjs` + installed Code OSS Phase 6 save/refresh/Undo proof.

### Technical Graph Rebuild — Phase 2 background workflow, tracing & routing engine (26 November 2026)

- **Worktree / branch / owner:** `E:/Orca/CloudForge-Code/dace`, branch `fxrazor/continue-project-handoff-review` (pushed to `origin/main` atop Phase 1 `e5fc572a702`), integration owner Antigravity. Resolve the commit with `git log -1 -- extensions/cloudforge/studio/src/technicalGraphWorkflows.ts`.
- **Conflict-free scope (zero UI / shared authoring edits):** intentionally kept out of `App.tsx`, `DesignCanvas.tsx`, `ResourceNode.tsx`, `RelationshipContext.tsx`, `model.ts`, `serviceAdapter.ts`, `liveSchema.ts`, `CodePanel.tsx`, and CSS while parallel Claude/Codex worktrees evolve the Graph View UI and provider forms.
  - Extended `extensions/cloudforge/studio/src/technicalGraphContract.ts` (`TechnicalGraphLens`, `lens`, `expandedNodeIds`, `setGraphLens`, `toggleGraphExpandedNode`, and `pruneGraphPresentationState`).
  - Added `extensions/cloudforge/studio/src/technicalGraphWorkflows.ts` + `technicalGraphWorkflows.test.ts` (4 tests).
  - Added `extensions/cloudforge/studio/src/technicalGraphRouting.ts` + `technicalGraphRouting.test.ts` (3 tests).
  - Updated `extensions/cloudforge/studio/package.json` `"test"`, this handoff, and root `HANDOFF.md`.
- **What Phase 2 background logic delivers:**
  - **Focused lenses (`TECHNICAL_GRAPH_LENSES`, `filterTechnicalGraphByLens`):** `all`, `dependencies` (prerequisite → consumer, ordering-only), `topology` (ownership + attachment), `runtime` (configured runtime intent, explicitly not observed traffic), and `observability` (telemetry collection → destination), each with explicit arrow semantics and boundary notes.
  - **Neighborhood & multi-hop path tracing (`traceNodeNeighborhood`, `tracePathsBetweenNodes`):** computes direct/transitive upstream prerequisites, direct/transitive downstream configured dependents, hop distances, cycle members, `selected | upstream | downstream | cycle | dimmed` focus roles, and bounded shortest-first paths with per-hop field/expression provenance.
  - **Contextual node inspector & troubleshooting findings (`inspectTechnicalGraphNode`, `collectGraphTroubleshootingFindings`):** deterministic, evidence-scoped findings (`ordering-cycle`, `validation-error`, `validation-warning`, `stale-overlay`, `missing-expected-parent`, `missing-expected-attachment`, `unverified-evidence`) with `sourceRevision`, `sourceTarget`, and actionable `nextCheck`; separates configured dependent impact from revision-checked plan action impact; honestly reports unavailable source locations.
  - **High-degree edge aggregation (`aggregateHighDegreeEdges`):** collapses dense fans above threshold per `(node, direction, category)` into inspectable bundles (e.g., `+12 attachments`) without merging distinct categories, while automatically expanding edges touching focused/expanded nodes.
  - **Semantic zoom, bounded attachment rows & route-style comparison (`resolveSemanticZoomBand`, `computeNodeAttachmentLayout`, `computeGraphPortAnchors`, `computeTechnicalEdgeRoute`, `countRouteCrossings`, `compareTechnicalRouteStyles`, `buildAttachmentScaleArchitecture`):** collapses rows to category summary pills at overview zoom (`< 0.55`), bounds visible rows (`4/6/8` by density, max `12` expanded) across 1/2/6/50/200-attachment scale fixtures with exact row anchor offsets and overflow fallback anchors, computes deterministic SVG paths for `curved`, `orthogonal` (with rounded corners & backtrack detours), and `straight`, and counts pairwise non-endpoint crossings for Phase 3 renderer benchmarks.
- **Fresh verification (26 November 2026):**
  - `corepack pnpm --dir extensions/cloudforge/studio run check` (`tsc --noEmit`): **PASS**
  - `corepack pnpm --dir extensions/cloudforge/studio run test`: **173/173 PASS** (0 skipped; +7 Phase 2 tests covering 1/2/6/50/200 attachment scaling, lenses, tracing, troubleshooting, aggregation, port anchors, and route comparison)
  - `corepack pnpm --dir extensions/cloudforge/studio run build` & `node extensions/cloudforge/esbuild.webview.mts`: **PASS**
  - `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts`: **PASS** (0 warnings/errors)
  - Extension Node tests (`CLOUDFORGE_REPO=Z:/CloudForge`): **97/97 PASS** (0 skipped)
- **Exact next action:** once Claude's Graph View UI improvements merge to `main`, connect these pure Phase 1–2 modules (`projectTechnicalGraph`, `filterTechnicalGraphByLens`, `traceNodeNeighborhood`, `inspectTechnicalGraphNode`, `computeNodeAttachmentLayout`, `computeTechnicalEdgeRoute`) into the contextual details pane and begin **Phase 3** (dedicated `TechnicalGraph` renderer extraction + D3/Canvas vs React Flow/ELK benchmark on identical fixtures).

### Technical Graph Rebuild — Phase 1 completed (26 November 2026)

- **Worktree / branch / owner:** `E:/Orca/CloudForge-Code/dace`, branch `fxrazor/continue-project-handoff-review` (pushed to `origin/main` from base `cf455878505`), integration owner Antigravity. Resolve the commit with `git log -1 -- extensions/cloudforge/studio/src/technicalGraphContract.ts`.
- **Files added/changed (strictly additive — zero edits to `App.tsx`, `DesignCanvas.tsx`, `model.ts`, or `serviceAdapter.ts`):**
  - `extensions/cloudforge/studio/src/technicalGraphContract.ts`
  - `extensions/cloudforge/studio/src/technicalGraphContract.test.ts`
  - `extensions/cloudforge/studio/package.json` (added `src/technicalGraphContract.test.ts` to `"test"`)
  - `extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md` and root `HANDOFF.md`
- **What Phase 1 delivers:**
  - Deeply immutable (`deepFreeze`) `TechnicalGraphProjection` (`projectionVersion: 1`, `sourceRevision`, `graphStatus`, `nodes`, `edges`, `patterns`, `cycles`, `capabilities`) projected purely from the canonical `Architecture` plus existing host payloads (`FileResourceValues`, `LiveSchemaMap`, `HostDependencyReport`, `HostEnginePlanReport`, `HostEngineValidateReport`, `HostGraphSnapshot`). Zero new backend APIs; zero inferred links from type compatibility or proximity.
  - Strict separation of `structuralParentId` (provider-backed `ownership` edge ONLY) from `visualGroupId` (`visualParentId`), plus deterministic peer-keyed `attachmentPorts` (`${nodeId}:${direction}:${field}:${peerNodeId}`) bounded by `maxAttachmentPortsPerNode` with explicit `attachmentOverflowCount`.
  - `extractFileExpressionEvidence()` extracts explicit HCL references from Rust `readResourceValues` payloads (`FileResourceValues`) while honestly recording `redacted-value`, `opaque-expression`, `unreviewed-type`, `unverified-schema-version`, `partial-source-graph`, `stale-plan`, `stale-validate`, `missing-provider-lock`, and `kubernetes-manifest-unmapped` unknowns.
  - Revision-bound schema version provenance (`live-matched | locked-only | bundled-fallback | unknown`), `sourceRevision`-checked plan/validate overlays (marking mismatched revisions `stale`), Tarjan SCC ordering cycle detection (`detectOrderingCycles`), evidence-backed hub-spoke pattern projection (`documentedHubSpokes` over both canonical bindings and source expressions), and `TechnicalGraphCapabilityAudit`.
  - Completely isolated `TechnicalGraphPresentationState` (`pins`, `routeStyle`, `density`, `collapsedGroupIds`, `hiddenCategories`, `selectedNodeId`, `tracedNodeId`) with immutable reducers (`setGraphNodePin`, `clearGraphNodePins`, `setGraphRouteStyle`, `setGraphDensity`, `toggleGraphCollapsedGroup`, `setGraphHiddenCategories`, `setGraphSelection`, `pruneGraphPresentationState`) that NEVER touch `Architecture`, `Resource.positions`, `parentId`, `visualParentId`, container sizes, Terraform, Modified state, or project Undo.
- **Fresh verification (26 November 2026):**
  - `corepack pnpm --dir extensions/cloudforge/studio run check` (`tsc --noEmit`): **PASS**
  - `corepack pnpm --dir extensions/cloudforge/studio run test`: **166/166 PASS** (0 skipped; 6 new Phase 1 contract tests covering zero-mutation deep-freeze invariant, structural vs visual grouping + bounded peer-keyed ports, `FileResourceValues` expression extraction + explicit unknowns, schema version + current/stale plan & validate revision binding, Tarjan SCC cycles + pin pruning, multi-provider AWS/GCP/K8s + positive/negative hub-spoke patterns)
  - `corepack pnpm --dir extensions/cloudforge/studio run build` & `node extensions/cloudforge/esbuild.webview.mts`: **PASS**
  - `node build/oxlint.ts` & `node --experimental-strip-types build/hygiene.ts` on all touched files: **PASS**
  - Extension Node tests (`CLOUDFORGE_REPO=Z:/CloudForge`): **97/97 PASS** (0 skipped)
  - Note: `research:verify` was not re-verified in this fresh worktree because `output/provider-research/` is gitignored; prior 88/88 hash verification remains inherited from the main integration entry below. No Rust, protocol, dependency, or Windows installer changes were made in this slice.
- **Remaining Phase 1 / Phase 2 gaps & exact next action:**
  - AWS research source version applicability (`6.73.1` vs research revision) and Kubernetes Terraform provider adapter remain explicitly flagged as unknowns (`unverified-schema-version`, `kubernetes-manifest-unmapped`) until version-matched live schemas or a dedicated K8s adapter are supplied.
  - **Exact next action — Phase 2 (Engineering workflows & visual direction):** wire `projectTechnicalGraph` into a read-only contextual inspection/trace lens (dependency path tracing, upstream/downstream configured impact, unknown/plan/cycle disclosure, source navigation, bounded attachment-row design, and curved vs orthogonal vs straight route comparison) verified across light/dark and 1360×860 / 1024×768 before extracting the dedicated `TechnicalGraph` renderer in Phase 3.

Canonical Studio checkpoint: this file. Dale requested consolidation on 25 November 2026; the earlier Claude continuation and Codex whiteboard continuation are retained below as historical evidence. Use the current queue here instead of historical branch commands or pending-approval notes.

Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`. Integration owner: Codex. Initial revision for this continuation: `5963df26af39f3f65365304025df8fa70773ff9d`. Historical starting baseline: Studio check/build passed, **111/111** Node tests and two Edge suites 20/20. Use the main integration verification below for the current merged result.

Dale approved continuing the proposed point-endpoint pass in this chat. No further approval is needed for that plan. Work remains within Studio and handoff documentation; one architecture and one semantic undo history, independent theme/viewport/tool preferences, drawings excluded from Terraform and Rust-owned guarded I/O remain binding.

### Technical Graph pass 7: large graphs, final checks and merge (Claude), 26 November 2026

- Network solver: exact repulsion up to 400 nodes (`forceSettings.exactLimit`), Barnes–Hut (theta 0.9, mass √r) plus a uniform collision grid above it; per-simulation degree/index cache. Bench: 1,000 nodes settle in ~0.4 s, 2,000 in ~1 s; Bundled layout is under 40 ms at 2,000 nodes.
- Find → Enter in Network re-centres on the found resource without changing zoom.
- Merged `origin/main` (Antigravity Phase 1–2: `technicalGraphContract.ts`, `technicalGraphWorkflows.ts`, `technicalGraphRouting.ts`) into this branch. No code overlap: those modules are pure logic and not yet wired into the UI. `technicalLayout.test.ts` stays removed (the old module is gone); their three test files are added to `pnpm test`.
- Checks on the merged tree: Studio `check` pass; `test` 194/194; `technical-view-verify` 60/60; whiteboard 20/20, loose connectors 16/16, annotation 4/4, hosted refresh 20/20 (quick mode). Not run here (no root node_modules in the container): `build/oxlint.ts`, `build/hygiene.ts`, extension Node tests, host `tsc`. The host sanitiser was exercised directly with Node.
- **Next for whoever continues:** wire Antigravity's contract/workflow/routing modules into `TechnicalGraph.tsx` where they overlap (`technicalGraph.ts` lenses and tracing duplicate parts of `technicalGraphWorkflows.ts`; pick one and delete the other). Then still open: drift overlay (Rust per-address state), module drill-down, service-edge field provenance.

### Technical Graph pass 6: Network spread dial and sizing fix (Claude), 26 November 2026

- Dale: bigger nodes must be the ones with more connections to them. Sizing now counts every line, including resource-group membership (always, even when membership lines are hidden), so rg-platform (21 members) is the biggest node. Growth is logarithmic relative to the busiest node; default Size by connections is 150 %. View → Network options → Count picks All connections / Used by others (edge source = referenced resource) / Uses others.
- Spread dial on the toolbar (Network layout only), 50–400 %, default 150 %. It scales link length, repulsion² , collision room and cluster reach; it commits on release, so a drag is one relayout. Fit never zooms out past 0.62 px per unit, so a wide spread stays spread on screen and pans.
- Persisted as `viewState.graph.network.spread` / `sizeCount`, sanitised on the host. Tests 180/180, verify 60/60.

### Technical Graph pass 5: Network design and options (Claude), 26 November 2026

- Network nodes are sized by configured connections (in + out, membership excluded): radius = 22 × (1 + sizeBy% × √(degree / max degree)). "Size by connections" goes Off, 30–200 %; default 60 %.
- View menu shows Network options when the Network layout is on: Size by connections, Link length and Spacing (percent of default, clamped 40–300), Clusters (scope / layer / none), Labels (auto / all / hover only) and Link shape (curved / straight). They persist as `viewState.graph.network`, sanitised on the host by `sanitizeNetworkOptions` (protocol.ts) and in the webview by `parseNetworkOptions` (technicalGraphForce.ts).
- Design: soft dashed cluster hulls (`hullPath`) labelled with the scope or layer; groups repel each other more so clusters separate; the settled layout is turned so its long axis follows the viewport (`orientForce`); curved arcs; hubs get a heavier ring and bigger label; focused links animate (off under reduced motion); labels in auto mode show for hubs, hover, search hits, small graphs or when zoomed in.
- Changing the cluster mode re-runs the layout from scratch; other option changes keep current positions.
- Still presentation-only: nothing writes positions, Terraform, Modified or Undo. Tests: 180/180 Studio, verify 56/56 in Chromium.
- Next ideas: per-category link width, a search "fly to" in Network, large-graph perf (repulsion is O(n²); switch to Barnes–Hut past ~800 nodes).

### Technical Graph pass 4: Network view and tidy tree (Claude), 26 November 2026

Dale asked for a final graph like [d3 force-directed graph](https://observablehq.com/@d3/force-directed-graph/2), with resource icons as the nodes, and a better tree.
- **Network view** (`layout: 'force'`, toolbar "Network"). `technicalGraphForce.ts` is a d3-force-style simulation with no dependency:
  - Forces: link springs (strength 1/min degree, degree-biased), exact many-body repulsion, collision, a weak per-layer directional pull and centring.
  - Integration: velocity Verlet, alpha cooling over ~300 ticks.
  - Start: deterministic phyllotaxis, so a project always settles the same way.
  
  `ForceGraph` in `TechnicalGraph.tsx` draws icon nodes in a layer-coloured ring with issue badges, an exposure ring and haloed labels.
  - Resource-group membership edges are faint, arrowless links that cluster members.
  - Hover or select shows uses (blue) and used-by (orange), including arrowheads.
  - Dragging fixes the node (`fx`/`fy`) and reheats the simulation like d3. Positions are view-local and never pins or project state.
  - Wheel zoom and background pan use the viewBox, with a Re-run layout button.
  - Reduced motion settles synchronously and moves dragged nodes without animation.
- **Tidy tree.** `treeLayout` is now horizontal, after `d3.tree`: depth runs left to right, siblings stack, and parents sit at the centre of their children. Links are `linkHorizontal` S-curves (`treeConnector`). A parent with more than 6 leaf children wraps them into a block of columns (`treeBlocks`, at most 6 rows) reached by one bus above the block and a bracket per column (`treeLinkPath`). **Fold toggles** (−/+N on the card's right edge) are stored in `GraphPresentation.collapsed`, persisted in `viewState.graph.collapsed` and sanitised by the host. Auto density spacing is skipped for the tree; explicit percentages still apply.
- Tests: deterministic force settle, no icon overlap, links shorter than average, parents centred, folding, block wrapping, and links never crossing a card. **178/178** pass. The browser verify is **52/52** and adds a Network drag with the export unchanged and a tree fold/unfold.
- Next: Barnes–Hut or a grid for the force view above ~800 nodes, and an optional canvas renderer for it.

### Technical Graph pass 3: design refinement (Claude), 26 November 2026

Dale asked where the tree view was (it was hidden in View) and asked for further design refinement. Changes in `TechnicalGraph.tsx`, `technicalGraphLayout.ts` and `technical-graph.css`:
- **Layout switcher on the toolbar.** Layers / Scopes / Tree / Bundled are now radios with an icon and a short label (`graphLayouts`). Labels hide below 1360 px. Find collapses to an icon below 1280 px. The Layout select was removed from View.
- **Ownership-tree connectors** (`treeConnector`, `elbowPath`): rounded orthogonal elbows with a bus below the parent, drops into first-row children and a comb spine in the column gap into the left side of wrapped leaf rows. A test asserts that no connector passes through a card.
- **`LaneRuler`.** A child of React Flow that uses `useViewport` and renders lane labels in screen space as tabs on the lane border: 11 px with a layer dot and member count, sticky below the toolbar. The in-canvas layer and input labels are hidden.
- **Cards.** Issue counts moved to the right of the chip row (top-right on compact cards, hidden on hover so the actions show), so the name and type get full width. Rows show the leaf attribute (`vnet_subnet_id`) with the full path in the tooltip. Arrows into rows are 11 px. Compact ghost inputs use 17 px text.

Checks: 176/176 Studio tests pass; technical graph 44/44 and whiteboard 20/20 in Chromium. Cost-category chips were deliberately not added: most registry `costCategory` values are just the layer name, so they would repeat the lane. Add them once the registry has real cost classes.

### Technical Graph pass 2 (Claude), 26 November 2026: read this first

Same branch, `claude/project-thread-2irlth` in fXrazor/vscode, pushed through `3fb1fe86` (not merged to main). There are still no new dependencies and no Rust changes. One small additive protocol change: optional `viewState.graph`. Dale said "continue with the rest until all completed", so pass 1's next actions 1–4 and engineer needs (a), (b), (c), (e), (g) and (h) are now built:

| Item | What was built | Where |
| --- | --- | --- |
| Verify script | `scripts/technical-view-verify.mjs` was rewritten for the new DOM. It covers cards = resources, no overlap in Layers/Scopes/Tree, the Bundled view, AKS rows, drag → pin with the export unchanged, swallowed keys, no Undo step, all six lenses, overlays, focus, 4 ghost inputs, rename edits the project and is undoable from Architecture, and pins survive a mode switch. **44/44 in Chromium** (2 sizes × 2 themes), zero browser errors. | script |
| Dead technical mode removed | `DesignCanvas.tsx` lost every `mode === 'technical'` branch. `technicalLayout.ts`/`.test.ts` are deleted; the hub/spoke test in `infrastructureRelationships.test.ts` now uses `layoutTechnicalGraph`. The pen preset moved into App (props `ink`/`onInkChange`) because DesignCanvas now unmounts in Configuration view. | `DesignCanvas.tsx`, `App.tsx` |
| Presentation persisted separately | `HostViewState.graph` / `CanvasViewState.graph` (optional) hold lens, layout, route, density, overlay, spacing, height, membership, inputs, expanded and **graph-only pins**. Focus stays transient. The host sanitises it (`sanitizeGraphViewState`: enum allow-lists, spacing/height clamped to 100–300, ≤512 pins). Studio uses `serialiseGraphPresentation` / `parseGraphPresentation` and a `restore` reducer action. It never touches `nodePositions`; both sides have tests for that. | `graphPresentation.ts`, `serviceAdapter.ts`, `webviewBridge.ts`, `../src/canvas/protocol.ts` |
| (a) Replace/destroy blast | `graphOverlays` sets `affectedBy` on configured dependents (ordering edges, no membership) of planned replace/delete nodes. In the Plan overlay those cards show a dashed **⚠ affected** badge, and the Why panel lists **Affected by** with links. | `technicalGraph.ts`, `TechnicalGraph.tsx` |
| (b)+(c) Ghost inputs | `snapshot.inputs` (`graphInputs`) holds variables bound through `fieldBindings`, plus `var.`, `local.` and `data.TYPE.NAME` found in setting and block expressions, with sensitive/declared flags and consumer fields. They are **not** nodes or edges, so waves, cycles and impact are unchanged. They render as dashed ghost cards in an "Inputs" band above the graph (`placeInputs`, overlap-free). Their lines appear only when the input or a consumer is hovered or selected. Toggle: View → Inputs (n). | `technicalGraph.ts`, `technicalGraphLayout.ts`, `TechnicalGraph.tsx` |
| (e) Exposure lens | New **Exposure** lens. `configuredExposure` marks public entry types (public IP, App Gateway, Front Door, LB, EIP, ALB/ELB, IGW, CloudFront, API Gateway, GCP addresses/forwarding rules), `public_network_access_enabled` / `publicly_accessible` / `associate_public_ip_address` / `map_public_ip_on_launch` / `allow_nested_items_to_be_public` set to true, and what is configured downstream of an entry. The lens keeps lines that touch exposed, security or identity resources and dims the rest. Chips say *public entry*, *public access* and *behind entry*. Tooltips state that NSG, firewall and route rules are not evaluated. | `technicalGraph.ts` |
| (g) Image export | View → **Save image: SVG / PNG**. `technicalGraphSvg` draws from the snapshot and layout (current lens, layout, spacing, pins, focus, overlay badges, inputs, exposure chips, legend), not the DOM, with icons inlined. In hosted mode it uses the existing `exportArtifact` (`-graph` suffix); otherwise `downloadSvg` (new, in `exportPresentation.ts`). | `technicalGraphExport.ts` |
| (h) Modules | Module calls get the address `module.NAME` and a **module · source** chip. Planned changes with `moduleAddress` fold onto the module card as `module +2 ~1 ±1`, so they are no longer counted as unmatched. Drilling into module internals still needs the host `requestModule` graph and is not built. | `technicalGraph.ts` |
| Bundled view | View → Layout → **Bundled (radial)**. This is hierarchical edge bundling after Holten / `d3.curveBundle.beta(0.85)`, implemented in ~60 lines with no D3 dependency: leaves sit on a circle grouped by layer then scope, and each edge is a uniform B-spline through leaf → layer anchor → centre → layer anchor → leaf. Hover or select shows *uses* (blue) and *used by* (orange). It supports scroll zoom, drag pan, click to select (the Why panel works), double-click for details, and Find dims non-matches. React Flow unmounts in this view and its instance is dropped. | `technicalGraphBundle.ts`, `TechnicalGraph.tsx` |

**Checks (Linux container, Node 22.23):** Studio `pnpm run check` passes and **175/175** tests pass. Host `node --test test/canvasModel.test.ts test/phase5Canvas.test.ts` gives 14/14. Chromium suites against the preview: technical graph **44/44**, whiteboard 20/20, endpoints 16/16, annotations 16/16, hosted refresh 20/20, all with zero browser errors. The host `tsc -p` could not run here (no `@types/node` in the container). No Windows/Edge/installed run was made.

**Still open, in order:** (d) drift/state overlay is blocked on Rust per-address state. (f) cost-category chips. Module drill-down via `requestModule`. Service-edge field provenance from `readResourceValues`. High-degree aggregation. Scopes/tree polish (pass 1 items 5–7). Run the D3-free bundle against 200/1,000/5,000-node fixtures and switch to canvas rendering if SVG is slow. Before merging, re-run `technical-view-verify.mjs` with `--channel=msedge` on Windows.

### Technical Graph rebuild, pass 1 (Claude), 26 November 2026 (superseded in part by pass 2 above)

Branch `claude/project-thread-2irlth` in fXrazor/vscode, based on main `5b66f85c`. Studio-only change. There are no new dependencies, no Rust changes and no protocol changes. Dale asked for the Technical Graph rebuild with better spacing and visual polish, and added four requests during the pass:
1. Cards must stay **editable** (rename, open the form) but must **not move** project elements.
2. Later options should include D3-style views: [hierarchical edge bundling](https://observablehq.com/@d3/hierarchical-edge-bundling) for the resource graph and a [tidy tree](https://observablehq.com/@d3/tree/2).
3. Use React Flow [database-schema-style rows](https://reactflow.dev/ui/components/database-schema-node).
4. Show how dependencies animate and how hierarchy is displayed.

**What now exists**

| File | Role |
| --- | --- |
| `src/technicalGraph.ts` | Phase 1 contract. `projectTechnicalGraph(architecture)` returns a detached, deeply frozen `TechnicalGraphSnapshot`: nodes (address, layer, scope chain, region known/unknown, review status, cost/blast category, cycle flag, **ports**), edges (category, ordering facet, confidence `configured/source-graph/unclassified`, `membership`, evidence list), hub/spoke stars, Tarjan cycles and coverage. It copies only primitives, so no renderer or layout code can reach `Resource.positions`/`parentId`. `lensEdges()` covers All, Dependencies, Topology, Runtime and Observability. `traceNode()` gives cycle-safe upstream and downstream. Port ids are `port:[resourceId, field, peerId]`: stable across reordering and refresh. |
| `src/technicalGraphLayout.ts` | Pure layouts on presentation coordinates. **Layers** puts rows in reading order (scope → network → security → identity → compute → application → data → monitoring), runs barycentre crossing-reduction sweeps, wraps at 7 per line and centres the hub of a configured peering star. **Scopes** gives one column per top-level ownership root, with layer rows inside. **Ownership tree** is a tidy top-down tree from configured parentage; leaf children wrap into a 3-column grid. Graph pins override the computed positions. Card height grows with rows, capped at 5 visible (4 rows plus “+N more”). |
| `src/graphPresentation.ts` | `GraphPresentation` (lens, layout, route, pins, expanded, showMembership, density) and its reducer. It is held in App with its own `useReducer`, outside architecture history. `graphEditAllowed(action)` is the **graph edit gate**. It allows `update` with label/name/terraformName/region/settings/blocks, plus `bindVariable`, `bindResourceRef` and `useInheritance`. It refuses everything else: move, placeResource, resize, add/insert/delete, connect, undo/redo, and icon or appearance changes. |
| `src/TechnicalGraph.tsx` | The dedicated renderer, a separate React Flow instance. App mounts it instead of `DesignCanvas` when `mode === 'technical'`. It receives **no `dispatch`**; App passes `onEdit={graphEdit}`, which re-checks `graphEditAllowed`. Cards carry the provider icon, name (double-click/F2/pencil renames through the gate), type, layer/region/review chips and schema-style **input rows** (`field → peer`), each with its own target handle. Edge sides are picked from relative placement (down, up or same band). Routes can be curved (default), orthogonal or straight. Category colours are restrained: reference/unclassified edges are dashed and observability edges dotted. Selecting a card dims unrelated context and animates only its upstream and downstream trace (marching dash plus a dot travelling along the path, both disabled under reduced motion). Clicking an edge opens a **Why** panel with field, expression, meaning, origin and ordering facet. Detail is Auto (compact below 42% zoom), Detailed or Compact. Dragging a card stores a **graph-only pin**, with Reset pins and per-card unpin. Delete, Ctrl+Z/Y/D/V/X and Backspace are swallowed inside the graph. A cycle banner appears when Tarjan finds cycles. |
| `src/technical-graph.css` | Light and dark tokens (`--tg-edge-*`, lanes and layer accents), cards, rows, toolbar, legend, Why panel, zoom pill and the reduced-motion guard. Imported by `preview.tsx`. |
| `src/graphFixtures.ts` | A 27-resource Azure hub/spoke + AKS + VM + Key Vault + storage + Log Analytics fixture. Every link comes from a real field binding or an inherited parent field. Preview it with `?sample=hub-spoke` (preview only; the hosted webview still receives the project from the extension). |
| `src/technicalGraph.test.ts` | 9 tests: detachment/freeze and no project change; evidence on every edge and row fields; stable port ids; lens meanings; layer order, hub centring and **no card overlap**; scope and tree ownership; trace and cycles; presentation outside history plus the edit gate (allowed and refused lists); a static guard that `TechnicalGraph.tsx` has no dispatch or placement actions and that App passes only `onEdit={graphEdit}`. |

**Checks run in the Linux cloud container (Node 22.23, pnpm 12.16):** `pnpm run check` passes; `pnpm run test` gives **169/169**; `node build.ts` succeeds. Playwright/Chromium screenshots of the preview in light and dark at 1440×900, light at 1024×768, a trace, the scopes layout and the tree layout produced zero console or page errors. The screenshots are not committed; Dale has copies. No Windows, Edge or installed Code OSS run was made (Dale asked to skip long Windows/Playwright runs).

**Known gaps and next actions for Codex, in order**
1. **Update `scripts/technical-view-verify.mjs`.** It targets the old DesignCanvas technical DOM (`.technical-view-options`, the Layout select, resource cards). The new DOM is `main.technical-graph[data-graph="technical"]`, `.tg-card`, `.tg-row`, `.tg-toolbar`, `[aria-label="Graph layout"]`, `.tg-why`. Keep its invariant: drag AKS, then compare the entire exported project. Now also assert that dragging creates a pin and that a rename through the card *does* change the project and is undoable from Architecture view.
2. **Remove the dead technical branch from `DesignCanvas.tsx`** (`mode === 'technical'` paths, `technicalLayout.ts`, the technical spacing state). App no longer renders DesignCanvas in technical mode. It was left in place to keep this diff reviewable, and `technicalLayout.test.ts` still covers it.
3. **Persist `GraphPresentation`** (pins, lens, layout, route) in host view state under a *separate* key from `nodePositions`. Never write it through `buildHostViewState().nodePositions`.
4. **Edge bundling and D3 tree (Dale's links).** Add a fourth layout, “Bundled”: a radial layout grouped by scope → layer using `d3-hierarchy` cluster plus `d3.curveBundle`, rendered as SVG or Canvas from the same frozen snapshot. Evaluate it against the current ELK-free layouts on 200/1,000/5,000-node fixtures before adding the dependency. The tree layout already exists in React Flow; compare it with `d3.tree` only if spacing becomes a problem.
5. **Scopes polish.** Column headers are small at fit zoom. Give the scope column a stronger header and an optional subnet sub-grouping. **Tree polish:** resources whose `parentId` is the resource group appear as leaves; a NIC or VM placed in a subnet nests under it.
6. **Service-edge field provenance.** `source-graph` edges still lack field paths. Consume `readResourceValues` expressions to promote them to field-level evidence (Phase 1 remainder). Add plan/state overlays only from `enginePlanReport` (Phase 5).
7. High-degree aggregation (“+12 attachments” edge bundles to one peer group), keyboard row inspection and graph-only multi-select are not built.

**Spacing pass (Dale's annotation, same day):** the toolbar is now a single non-wrapping row ("Membership" is a toggle button; field captions hide below 1180 px). Card layout heights now match the measured DOM (80 px header, +26 px per row, +10 px footer). Before this, a 15 px underestimate let cards in adjacent lines crowd each other. Card, chip and lane-label padding are larger. Same-band links between non-adjacent cards route underneath the line instead of across neighbouring cards. Edge labels appear only for a clicked edge (trace rows already name the field). Fit padding is 84/40 px. If card markup changes, re-measure with Detail set to Detailed and update `graphMetrics`.

**Engineer features pass (Dale: "continue looking through engineer docs … what DevOps engineers need to see").** This was a desk review against the Terraform docs: [dependency graph](https://developer.hashicorp.com/terraform/internals/graph) (walks run concurrently up to `-parallelism`, default 10; destroy reverses the order), [`terraform graph`](https://developer.hashicorp.com/terraform/cli/commands/graph), the [plan JSON format](https://developer.hashicorp.com/terraform/internals/json-format) (`resource_changes[].change.actions`, which can be create/update/delete/read/no-op, with `["delete","create"]` meaning replace) and [resource addressing](https://developer.hashicorp.com/terraform/cli/state/resource-addressing) (`type.name[index]`, `module.x.`); and against what Rover, Pluralith, Inframap and Brainboard put on a graph. No pages were fetched this pass, so check the details against those links. These were **built**:
- **Overlay selector**, which shows a badge on every card:
  - *Plan actions*: `+ create`, `~ update`, `± replace`, `− destroy`, `↻ read`, ×instances. It uses App's existing `enginePlanReport` joined by root-module address (indexed instances fold into the base address, data sources are skipped). A banner says when the plan is stale (source revision differs, or the draft has changed since the baseline) and how many planned changes live in modules or resources that aren't drawn.
  - *Apply order*: a wave number = the longest ordering chain (`applyWaves`). Cycle members show "cycle".
  - *Dependents*: the configured downstream count, explicitly not an outage prediction.
- **Issue badges**: the error or warning count from `findings` (local + host diagnostics). The Why panel lists the first five.
- **Find**: matches name, address, type and source file. Non-matches dim; Enter selects the first match and zooms to it.
- **Focus 2 hops**: neighbourhood-only layout from the Why panel, with a toolbar chip to clear it. It is presentation-only (`focus` in GraphPresentation).
- **Why panel actions**: Edit (focused form), Source (hosted, when `hasSourceById`), the apply wave, planned attributes and the source file:line chip on cards.
- **Toolbar**: Find, Lens, Overlay and a **View** popover (Layout, Routes, Detail, Membership), so the bar never wraps. Card action icons appear only on hover or selection, so names get the room.
- Tests: `applyWaves`, `graphOverlays` (address join, `[n]` folding, unmatched count, data skipped), `neighbourhood`, focus layout and `matchesQuery`. **170/170 Studio tests pass.**

**Density spacing (Dale's annotation):** `GraphPresentation.spacing` is `'auto' | number` and lives in the View popover. In **Auto** (the default), `spread()` in `technicalGraphLayout.ts` counts the lines crossing each gap between card rows (same-row lines count for the gap below, because they route underneath) and adds `densityGap(n) = min(220, max(0, n−3)·9)` px. A percentage (100–200%) scales all positions about the origin and is clamped at ≥100% so cards can't overlap. Lanes and scope columns are refitted to their members after spreading. Tested: auto is taller than 100% at the same width, 150% is larger in both directions, and there are no overlaps and no card outside its lane. A future refinement could also widen horizontal gaps for dense fan-in to a single card.

**Visibility pass (Dale: "spread the height by a percentage", "can't make out where some of the lines go", "show me all the different view types", improve card design):**
- **Height** (100–300%) in the View popover. It stretches only the vertical axis, independent of Spacing.
- **Line tracing.** Hovering a card highlights its direct lines and peers, and fades the rest. Hovering a line highlights it and both endpoints, with a label `source → field · category`. Every line has a canvas-coloured halo so crossings separate, lines are thicker (1.75/2.6/3.2 px) and arrows are 16 px. The marching animation now runs only for a clicked selection's trace, never on hover. Same-band links to non-adjacent cards use an explicit dip curve below the row instead of a flat bottom-to-bottom Bézier.
- **Bug fixed.** Presentation changes rebuilt node objects without React Flow's `measured`, which hid nodes until re-measured, so the graph blanked on hover. The sync effect now carries `measured` forward.
- **Cards.** The header has a tinted layer gradient, the accent bar is 4 px, the border is layer-tinted, the title is 14 px, rows have zebra striping and 11 px monospace fields, and the layer chip is dropped (the lane, colour and type say it). **Overview (compact, below 42% zoom)**: a 40 px icon and a 19 px two-line name that wraps at hyphens, larger issue and overlay badges, larger lane labels, and the gutter widened to 170 px.
- **All view types captured** in a contact sheet (16 states: lenses, layouts, routes, height, detailed, overlays, hover, trace, focus, dark). Dale has the copy; regenerate it with a Playwright script like the one described for `technical-view-verify.mjs`.

**Engineer needs still open, in priority order for Codex:**
- (a) **Destroy/replace blast preview**: when the plan overlay shows replace/delete, highlight configured dependents of those nodes.
- (b) **External and unknown nodes**: references to `data.*`, `var.*`, remote state and module outputs that have no card should appear as small ghost nodes.
- (c) **Variable inputs** on cards (`fieldBindings` → `var.NAME` rows).
- (d) **Drift and state overlay** once Rust exposes per-address state (Stage 11 summarizeState is structure-only today).
- (e) **Security exposure lens**: public IP/listener → workload path, built only from configured attachments, labelled as configured intent.
- (f) **Cost category chips** from the registry (category, never price).
- (g) **Export graph** as SVG/PNG, reusing `exportPresentation.ts`.
- (h) **Module boundaries** as collapsible groups when source summaries carry `moduleAddress`.

**Binding rules (unchanged):** graph drag, layout, pins, expansion and selection never write Resource.positions, parentId, visualParentId, container sizes, Terraform, Modified state or Undo. Configuration edits from the graph go only through `graphEditAllowed`.

### Main integration and portable agent handoff — 25 November 2026

Dale explicitly instructed Codex to finish the handoff and push completed work to **main**. This authorizes the present main integration and supersedes the older no-main-push notes below; it does not authorize force-pushing, merging unrelated open PRs or changing the Rust repository. Integration work remains in the existing isolated worktree on `codex/studio-whiteboard-2`. The fetched main baseline was `e9a36e0e73fdf429a0ac1a0cc11474e32ac81e68` (35 commits ahead of the feature branch's base); the four feature commits through `64c01b2b4c3` are integrated with it. Resolve the final integration revision from the repository root with `git log -1 -- extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md` or the latest root HANDOFF entry. The remote main revision, rather than an old local worktree path, is the portable starting point.

Repository: **https://github.com/fXrazor/vscode**. Canonical continuation: `extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md` (this file). Supporting research: `research/provider-intelligence.md` and `research/provider-source-manifest.json` under the Studio directory. They supplement this handoff; do not create a second continuation document. Prior backlog and source notes remain intact below.

**What is included:** the earlier designer/endpoint work, variable picker/provider/icon/constraint follow-ups, independent visual versus provider containment, preliminary provider intelligence, and the technical-graph mutation safety correction. Graph gestures cannot write the design layout; explicit Parameters/Code project editing remains available. D3, the final TechnicalGraph renderer, tasteful curve/density/attachment-row design, graph-local pins, Miro copy handles and perimeter/bend controls remain planned, not implemented.

**Main capabilities to reuse:** `resourceValues.ts` and App's `resourceValues` event hydrate source literals and `var.NAME` bindings with source-revision checks/rebase. Imported provider types/coverage are registered in `catalogue.ts`/`liveSchema.ts`; `resourceDraft.ts` supports schema draft checks. `sourceChanges`, focused and three-way saves, Save All, clickable/stale diagnostics, source navigation, project gallery/side panel, offline mirror and `HostEnginePlanReport`/`enginePlanReport` already exist. Do not build replacement service APIs from the earlier historical gap descriptions. The graph snapshot alone remains a summary; consume the separate existing value/schema/plan payloads. Complex resource expressions are not yet comprehensively converted into typed, provenance-backed graph relationships. Installed integration and graph-overlay completeness still need verification.

Two merge conflicts were resolved: root HANDOFF preserves both the new graph handoff and main's Rust/desktop history; `ResourceCatalogue.tsx` keeps both provider identity/schema disclosure and main's imported-schema registration. Auto-merges retain source hydration, focused saves, diagnostics, rebase and plan support. No new dependency versions, Rust source, protocol authority or installer changes were introduced relative to main.

#### Copy this prompt to a successor agent

```text
Continue CloudForge Infrastructure Studio from the latest origin/main in https://github.com/fXrazor/vscode. Use your own isolated worktree and a codex/ branch; preserve other agents' work. Read AGENTS.md, HANDOFF.md, and extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md before editing. That is the single canonical continuation; keep it updated.

Start Phase 1 of the Technical Graph rebuild: audit the CURRENT source-value/schema/dependency/plan capabilities, then define and test an immutable graph projection contract with evidence/version/unknown-state metadata. Reuse resourceValues.ts, existing imported schema coverage, focused/three-way save and plan-report bridges. Do not invent new backend APIs or infer attachments from resource-type compatibility. Do not duplicate the architecture model.

Critical invariant: graph layout, simulation ticks, node dragging/pins, expansion, routing, selection and filters must NEVER write Resource.positions, parentId, visualParentId, container sizes, Terraform, Modified state or project Undo. The previous shared-delta experiment was wrong and removed. Keep the current safety guard. Any future graph-local dragging belongs in separate presentation state; deliberate configuration edits use explicit project commands/editors.

The current technical cards/packing are a guarded prototype, not the accepted final UI. Follow the master phases: provider evidence/graph contract -> engineer workflows and visual design -> D3/Canvas versus React Flow/compound-layout benchmark and dedicated TechnicalGraph -> provider patterns -> diagnostics/impact -> installed integration. Preserve the approved interest in tasteful curved paths, bounded attachment rows with distinct stable ports, zoom-dependent density, graph-local pins, and the separately queued Miro copy/perimeter/bend controls.

Research is preliminary: 88 pinned documents, 87 documented profiles and 4,005 unreviewed records; AWS source applicability is unresolved and Kubernetes is manifest research, not a newly supported provider. Runtime connectivity/outages/prices/replacement effects require the appropriate evidence. Do not silently treat defaults or diagram positions as infrastructure facts.

Finish one bounded phase with meaningful tests, record exact branch/revision/file ownership/checks/gaps/next action in the same handoff, and give the integration owner a reviewable commit. Do not push unrelated main/Claude/Rust branches or deploy cloud infrastructure. See the current integration verification entry for commands and known limits. Do not require the previous chat to understand the work.
```

#### Optional work ownership for separate successor agents

| Workstream | Scoped ownership | Dependency / integration rule |
| --- | --- | --- |
| Provider evidence | `providerKnowledge.ts`, registry generation/source manifests and provider fixtures | Research actual selected versions; keep unknowns explicit. Coordinate registry contract changes with the graph-contract owner. |
| Graph contract (next priority) | New readonly graph projection/types/tests plus narrow adapters | Reuse current service/value/plan payloads; establish no-mutation tests before changing the renderer. One integration owner reconciles shared model/adapter files. |
| Visual/layout exploration | Separate graph prototype/spec/benchmarks and existing design tokens | Depends on the agreed graph DTO. Compare D3/Canvas and compound layout with identical fixtures; no canonical model setters in renderer callbacks. |
| Designer handle follow-up | Drawing/endpoint geometry, copy gesture, exports and tests | Separate branch/worktree, preserving Graph View isolation. Coordinate changes to shared endpoint types before integration. |

These are handoff scopes, not agents launched by this checkpoint. Each editing agent needs a separate worktree. Do not have parallel agents edit `model.ts`, `App.tsx`, `serviceAdapter.ts` or this handoff without an integration owner.

#### Main integration verification and reproducible commands

The merged source passed Studio TypeScript and production preview build, **160/160 Studio Node tests**, **96/96 extension Node tests** (including adjacent Rust fixture parsing, no skips), and the extension TypeScript check. The successful extension compiler invocation uses Studio's installed compiler and Node types; the root checkout has no directly executable `tsc`. No dependencies were installed or shared across worktrees.

From the repository root (PowerShell, Node **24.22.1**, pnpm **12.16.0**):

```powershell
corepack pnpm --dir extensions/cloudforge/studio run check
corepack pnpm --dir extensions/cloudforge/studio run test
corepack pnpm --dir extensions/cloudforge/studio run build
# Point this at the matching, separately owned Rust checkout for fixture tests.
$env:CLOUDFORGE_REPO = 'Z:/CloudForge'
$extensionTests = @(rg --files extensions/cloudforge/test -g '*.test.ts')
node --test @extensionTests
```

From `extensions/cloudforge/studio`: `corepack pnpm exec tsc --noEmit -p ../tsconfig.json --typeRoots ./node_modules/@types`. Research capture verification: `node scripts/research-provider-intelligence.mjs --verify-local` — **88/88** document hashes matched. Pure tests read local fixtures; these commands do not deploy infrastructure or mutate the Rust checkout.

Browser checks use the existing owned QA preview (`http://127.0.0.1:56797/` while running), an installed Playwright runtime selected with `PLAYWRIGHT_DIR`, and `--channel=msedge`. On another machine start its own preview with `corepack pnpm --dir extensions/cloudforge/studio run dev`, use the printed URL and a locally installed browser/runtime. Run suites serially from the Studio directory; their scenarios reload owned pages and mock extension-host messages. Do not point them at the user's draft tab or a live project.

| Fresh merged browser suite | Result | Command from Studio (append the owned preview URL and `--channel=msedge`) |
| --- | --- | --- |
| Technical graph isolation/layout | 20/20 | `node scripts/technical-view-verify.mjs` |
| Variable/provider/icon/containment annotations | 16/16 | `node scripts/annotation-followup-verify.mjs` |
| Hosted refresh/history/Modified state | 20/20 | `node scripts/hosted-refresh-verify.mjs` |
| Whiteboard controls | 20/20 | `node scripts/whiteboard-controls-verify.mjs` |
| Loose endpoints/reconnection/export | 16/16 | `node scripts/loose-connectors-verify.mjs` |

**92/92 browser checks passed with zero console/page errors.** The graph, annotation, whiteboard and endpoint matrices cover light/dark at 1360×860 and 1024×768; hosted refresh covers both widths. The graph test attempts a large AKS drag and mutation shortcuts, compares the entire exported project and checks mode/theme boundaries. This is preview and mocked-host evidence, not installed-product proof.

The hosted refresh script now distinguishes an external graph refresh from an acknowledged save: unsaved edits remain **Modified** until the actual save flow acknowledges them. It also moves its note clear of neighbouring selection controls before multi-selection, using ordinary keyboard actions. No forced clicks or product behavior changes were used to make the test pass.

Artifacts live under ignored `output/playwright/`; test counts and commands are recorded here so the handoff remains useful without those local files. Installed Code OSS/service interaction, real save/plan execution, desktop/installer builds, renderer benchmarks and the final Technical Graph design remain unverified or pending as specified by the master phases. Historical verification entries below describe their own earlier source revisions, not this integration.

### Master handoff: Technical Graph rebuild — latest user correction takes precedence

**Dale's correction:** Graph View represents the project. It can be dynamic and interactive, but dragging AKS or any other graph node must never move the Architecture Design layout, reparent resources or change the project. The earlier shared-delta implementation and its passing test encoded the wrong product behavior. They are superseded and have been removed. Do not restore them to satisfy historical tests.

**Latest additions:** evaluate D3.js (Dale wrote “ds3”) for a large technical graph; support limited editing with a strict separation of graph presentation from project edits; give the graph a more tasteful visual design, including curved routes as an option. These extend this plan. They do not authorize another architecture model or implicit topology changes from positioning.

Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`; branch `codex/studio-whiteboard-2`; integration owner Codex. Research commit: `f48b9c15b3d`; verified graph-isolation code checkpoint: `129b58e0eeb` (pushed). The commit containing this master handoff preserves the guarded experiment and safety correction; resolve its revision with `git log -1 -- extensions/cloudforge/studio/STUDIO-CONTINUATION-2026-11-25.md` from the repository root. Nothing here is a product-release or installed Workbench/service verification claim. Dale's latest explicit main-integration instruction above supersedes the older main restriction for this checkpoint; do not merge unrelated PRs or push Claude/Rust branches.

#### Binding state and interaction contract

- **Canonical project:** resource identity, configuration, ownership/attachments, variables, source references and semantic history. Architecture Design authoring positions remain in the existing model. Graph layout never writes them.
- **Derived graph snapshot:** immutable display/topology records keyed by canonical resource IDs, source revision and evidence provenance. It refreshes when the project changes. It is a projection, not a second editable project.
- **Graph presentation:** viewport, positions, pins, expanded groups, filters, route style, selection and trace highlights. Store separately from `Resource.positions`, `parentId`, `visualParentId`, container sizes, Terraform, project save state and architecture Undo. Never serialize graph coordinates through `buildHostViewState().nodePositions`.
- **Limited editing:** future graph-local rearrangement and pinning affect presentation only. Explicit resource/dependency editing may open the existing project editor or a validated command preview. A graph drag, proximity or layout algorithm cannot create that command. Permission/topology changes need typed field evidence and an explicit operation.
- **Steady and dynamic:** keep the graph stable for reading; update it incrementally on project revisions, selection, expansion and filter changes. Avoid a continuously moving force simulation. Layout animation must settle and respect reduced motion.
- **Recovery:** this correction does not reset existing project coordinates or attempt to guess the pre-drag design. Recover a prior damaged layout only from a verified pre-drag Undo entry/snapshot; never apply reverse graph offsets or a blanket rearrangement.

#### Phase 0 — stop cross-view project mutations (implemented; verify before handoff)

`canvasMutationPolicy.ts` blocks all architecture actions dispatched by the technical canvas. Graph nodes explicitly have `draggable`, `connectable` and `deletable` false: React Flow per-node flags can override global flags, so both boundaries are set. Drag/drop, keyboard move/delete/duplicate/paste/Undo, authoring context menus, inline card inputs, connection tools, resize/rotation handles and the drawing toolbar are removed or blocked in Graph View. Global Undo ignores graph-focused events. App catalogue/template/drawing creation also checks the current mode, including asynchronous catalogue completion. Explicit shared Parameters/Code editors still operate on the canonical project; graph selection itself does not edit it.

The experiment's spacing, relationship context and provider metadata are retained for inspection, not approved as the final Technical Graph UI. `DesignCanvas.tsx` still contains both modes and must be split in Phase 3. No D3/ELK dependency was installed. Fresh safety verification is recorded in the verification entry below. The current graph allows selection, inspection, filtering, pan/zoom and automatic spacing. Graph-local draggable pins are future work, not currently enabled.

#### Phased rebuild and exit criteria

| Phase | Work and deliverable | Exit condition |
| --- | --- | --- |
| 1. Evidence and graph contract | Complete the provider research matrix below. Define readonly graph nodes/edges, semantic direction/facets, provenance, version applicability and unknown states. Audit source-summary → model projection and catalogue identifiers. | Every relationship rendered has an instance-level reason and source/version record. Missing information stays unknown. No inferred field binding from a compatible type pair. Required families have reviewed fixtures and explicit coverage gaps. |
| 2. Engineering workflows and visual direction | Define dependency inspection, path tracing, configured impact, troubleshooting and source navigation. Build representative graphs with compact nodes and a contextual details pane. Compare tasteful curved, orthogonal and straight routes at real graph densities. | Engineers can explain why a link exists, distinguish order from traffic, find a missing prerequisite and trace a change without opening every form. Visual direction is checked in both themes and wide/narrow windows. |
| 3. Renderer/layout prototype and separation | Extract `TechnicalGraph` from the authoring canvas. Benchmark the same graph snapshots in the candidates below. Add a dedicated graph-presentation store, cancellation/revision handling and optional graph-local pins. | AKS dragging/pinning/layout ticks never change canonical coordinates, parentage, Terraform, Modified state or architecture history. Results include measured performance, accessibility and label/routing quality. Select the renderer from evidence. |
| 4. Provider topology/patterns | Implement evidence-backed Azure hub/spoke, AWS account/landing-zone, AKS/EKS and multi-region views. Add Kubernetes topology only through an explicit supported adapter. | Pattern-specific fixtures prove both positive and negative recognition. Names/proximity never create patterns or runtime links. Mixed provider, module and region boundaries remain honest. |
| 5. Diagnostics and impact | Add SCC/cycle and missing-reference investigation, upstream/downstream paths, source locations and plan/state overlays when the service supplies them. Separate configured-dependent scope, plan action impact and observed runtime impact. | Each finding identifies evidence, scope, timestamp/source revision and the next useful check. No outage, replacement, reachable-network or cost claim from a generic edge. |
| 6. Product integration and release proof | Package the chosen implementation in the Code OSS Studio, validate workers/CSP and versioned presentation persistence, then run hosted and installed save/refresh tests. | One canonical model remains intact through refresh, renderer switch and Undo. Actual installed results, Rust/service revision and relevant artifact checks are recorded. Cloud deployment is outside this UI task. |

**Exact next action after this checkpoint:** start Phase 1 with a source capability/coverage matrix and readonly graph projection contract tests. Do not continue adding controls to the shared authoring canvas. Use the current experiment as evidence to refactor, not as an accepted final design. Keep phases bounded and checkpoint after each one; preserve the wider backlog below.

#### What the engineer needs to see

1. Resource identity/address, provider alias/version, module/instance boundary and trustworthy scope/region. Show unavailable values as unavailable; do not display seeded fallback regions/settings as live project facts.
2. Ownership, attachments, explicit ordering, expression references, runtime intent/observations and telemetry paths with different meanings. Ownership nesting is not an attachment. An edge may have a semantic category plus an ordering facet.
3. The exact field/expression or source graph reason behind a link, its provenance and confidence. Offer direct source/parameter navigation rather than a full editable form on every node.
4. Upstream prerequisites, direct/transitive configured dependents, path/cycle isolation and missing references. Distinguish configuration, state, saved plan and observed cloud/Kubernetes data.
5. Change impact based on actual plan actions when available; otherwise clearly bounded configured impact. Unknown/external resources and incomplete coverage must remain visible.

Offer focused lenses rather than one overloaded diagram: **Dependencies** (prerequisite → consumer), **Topology** (ownership/attachment), **Runtime** (configured intent versus observed flows), **Observability** (collection → destination). A single universal arrow direction would misrepresent these meanings. Design connectors are diagram intent and stay separate.

#### Research scope and present coverage

The 88-document capture and 87 profiles are a **preliminary evidence inventory**, not completed comprehensive provider intelligence. The 4,092 registry records cover all 4,078 catalogue entries plus documented canonical types; **4,005 records remain explicitly unreviewed**. Unknown fields must not become invented relationships. The source manifest has pinned document revisions/hashes; full source captures are ignored artifacts. [Research report](research/provider-intelligence.md), [source manifest](research/provider-source-manifest.json), [registry](assets/provider-intelligence.json).

| Scope to complete | Existing evidence and remaining work |
| --- | --- |
| Terraform Core | Graph generation, implicit expressions, `depends_on`, data reads, outputs, providers/aliases, modules/module references, state/orphans, plan, apply and destroy/lifecycle ordering are covered in the report. The final graph projection still needs complete, provenance-backed field/module/provider/output/state/plan records; reuse the existing source-value and plan-report bridges rather than assuming those APIs are absent. Build those capability tests before depicting them. |
| Azure | Resource groups, VNets/subnets, NSGs/rules and associations, routes, public IPs, LB/pools, Application Gateway, Firewall, AKS, VMs/NICs, identities/role grants, storage, Key Vault, Log Analytics and Monitor: 25 pinned AzureRM 5.14.0 documents. Validate parent/attachment/runtime distinctions, identity propagation, subnet/route/NSG failures, monitoring agent/DCR paths and cycles with versioned fixtures. |
| AWS | VPC/subnets/SGs/routes, NAT/IGW, EC2/ENIs, EKS/node groups, ALB/NLB listeners/targets, RDS, IAM, S3, Lambda, Route53 and Organizations: 28 documents. The catalogue's 6.73.1 tag was unavailable; current research revision is not version-matched. Resolve applicability and conditional constraints before authoritative rules. Landing-zone recognition needs account/OU/security/logging evidence, not VPC names. |
| Google Cloud | Global VPC, regional subnetworks, GKE, Compute Engine, Cloud SQL, Storage, IAM/service accounts, Router/NAT, firewall, global/regional LB chains and monitoring/logging: 22 pinned 8.10.0 documents. Audit doubled catalogue prefixes, private-service networking/API prerequisites and actual project/region evidence. |
| Kubernetes | Namespace, Pod, Deployment, StatefulSet, DaemonSet, Service, Ingress, ConfigMap, Secret, PVC/PV and StorageClass: 13 platform guides / 12 profiles. Paths are manifest syntax, not Terraform provider syntax. Namespace scope, controller/ReplicaSet ownerReferences, Service selectors/EndpointSlices, readiness, network policy and volume lifecycle need an explicit adapter. No Kubernetes provider was added. |

Each reviewed resource entry must retain resource/parent/child/attachment types, dependency possibilities, runtime/security/monitoring evidence requirements, cost category and blast-radius category, plus source/version and field-syntax metadata. Cost category is not a price; shared-component category is not an outage score. Required fixture families must cover creation/import, association resources, computed/read-only fields, advanced/nested blocks, circular references and common deployment failures.

The adapter audit found generic graph edges being converted into guessed NIC bindings and inherited fields. Fresh source summaries now retain edge provenance and suggest visual grouping only. Existing explicit local bindings remain preserved. The original summary-only observation is historical: integrated main now also supplies `readResourceValues` payloads and source-preserving saves. Reuse those capabilities; full expression-to-relationship provenance and the final graph adapter still need Phase 1 work. Do not work around this by guessing fields or reading workspace files directly in the browser. Backend changes belong in `Z:/CloudForge` through the canonical service boundary and its applicable approval scope. Read-only Rust source used for direction: `terraform_graph.rs` at Rust HEAD `8e8dcc38f40f7fb288963008977b3ead9080ceeb`; desktop normalization: `extensions/cloudforge/src/canvas/layout.ts:orientServiceEdgesForCanvas`. No Rust files were edited.

#### Renderer candidates and visual design

| Candidate | Investigate before selecting |
| --- | --- |
| D3 with Canvas or an evaluated GPU renderer | Flexible overview and graph-local interaction; measure label picking, keyboard alternatives, compound groups, edge routing and rendering cost. Force layout alone does not supply infrastructure semantics or nested ownership layout. |
| React Flow with a compound layout engine such as ELK | Reuses accessible node/detail integration and existing UI components; benchmark DOM density, crossings and worker layout on the same fixtures. Keep it a separate graph renderer, not the authoring component. |
| D3/Canvas overview plus a focused DOM inspector | Evaluate if large-graph overview and detailed resource inspection benefit from different rendering strategies. Do not maintain a second semantic model. |

These are proposed experiments, not measured results or a dependency decision. Test 19-resource regression, 200/1,000/5,000-node fixtures, nested groups, fan-in/out, cycles, long labels and updates. Record hardware, timings, memory, responsiveness and label legibility. Use aggregation, semantic zoom, neighbour focus and level-of-detail before showing thousands of equally detailed cards.

D3's force simulation mutates its node objects. A prototype must use detached graph-layout DTOs; never pass `Architecture.resources`, their position objects or canonical connection records into a simulation/link force. `fx`/`fy` pins belong to graph presentation. Stop/settle layout by default, isolate expensive computation and reject stale revision results. [D3 force simulation](https://d3js.org/d3-force/simulation), [React Flow layout comparison](https://reactflow.dev/learn/layouting/layouting).

The visual direction is a calm engineering graph: compact official provider icons, readable identity/type, restrained category colour, concise validation badges and details on demand. Curved Bézier routes are a candidate for path tracing; compare with orthogonal routes around compound groups. Route style is presentation only. Highlight selected upstream/downstream paths; dim unrelated context; animate only a selected trace or a transition, then settle. Avoid permanent particle motion, glowing lines, duplicated form cards or an undifferentiated hairball. Include reduced motion, strong contrast, accessible edge labels and keyboard source navigation. Use Impeccable for the phase's critique/polish, preserving the product identity.

#### Latest graph annotation — attachment rows and density controls (Phases 2–3)

Dale's [React Flow Database Schema Node reference](https://reactflow.dev/ui/components/database-schema-node) demonstrates labelled row-level connection points. Apply the concept to real resource attachments/references, rather than treating infrastructure as database columns or attaching every line to one central dot. This is a **queued design requirement**, not implemented by the safety checkpoint.

- Prototype compact rows for evidenced NICs, identities, security/routing associations or other actual relationships. A row must explain its field and endpoint; do not create ports for arbitrary compatible resources or every scalar setting.
- Let the rendered graph node grow to a bounded number of visible rows. At overview zoom, collapse them to semantic groups/counts; on selection/expansion reveal the relevant rows and curved paths. Compare an initial 4–6-row limit with real fixtures rather than allowing unlimited card height.
- For high-degree resources, show a counted group such as “+12 attachments”, neighbour focus and edge aggregation with an inspectable membership list. Preserve category distinctions and exact endpoints when grouping; avoid a dense fan of near-identical lines and unreadable spacing.
- Use stable port IDs derived from resource ID, field path and referenced endpoint identity, not current array indices or screen position. Node expansion and port geometry belong to GraphViewState. Node growth must never resize an Architecture icon/container or change semantic history.
- If React Flow is selected, map unique handles through `sourceHandle`/`targetHandle` and refresh measured internals after handle changes. If D3/Canvas is selected, derive equivalent row-anchor coordinates and hit targets from the same detached graph DTO. [Dynamic and multiple handles](https://reactflow.dev/learn/customization/handles), [Updating node internals](https://reactflow.dev/api-reference/hooks/use-update-node-internals).

Verify 1/2/6/50/200 attachments, expanded/collapsed states, stable handles after reordering/refresh, curve crossings and label collisions, keyboard inspection, both themes, zoom-dependent detail and zero canonical-model changes. No shadcn/table dependency or example installation command was executed; use the existing product styling and choose dependencies only in the renderer evaluation.

#### Checkpoint verification and remaining gaps

Fresh Phase 0: Studio TypeScript/build and **149/149 Node tests** pass. The corrected Edge matrix is **20/20** at 1360×860 and 1024×768 in both themes with zero console/page errors. It attempts a large AKS drag, keyboard movement/delete/duplicate/paste/Undo, checks for absent inline editors/resize/connection tools, inspects the context menu and compares the entire exported project before/after and across mode switches. The unit policy test also compares canonical history and generated Terraform. Explicit Parameters editing still updates the graph, as intended.

Current screenshots/reports: `output/playwright/technical-view/` and `output/playwright/graph-safety-node-tests.txt`. The whiteboard test was corrected to expect no pen or resize controls in Graph View, then verified again: **20/20** whiteboard scenarios and **20/20** hosted-refresh checks passed, zero browser errors. Together with the graph matrix, this is **60 fresh browser checks** after the safety correction. The final Impeccable scan returned only the two unchanged incumbent Mona Sans/Inter warnings; product typography was preserved. Report: `output/playwright/impeccable-graph-safety.json`. Earlier 92 browser checks preceded Dale's interaction correction and must not be treated as final acceptance of the new graph contract. Installed Code OSS/service save, graph presentation persistence, authoritative plan/runtime impact, renderer benchmarking and the final visual redesign remain open. Automatic spacing/export fidelity and source-complete import also need Phase 3/6 work. No claim of a finished Technical View redesign is made.

Implementation ownership: Studio only (`DesignCanvas.tsx`, `ResourceNode.tsx`, `SelectionControls.tsx`, `App.tsx`, `canvasMutationPolicy.ts`, the experimental `technicalLayout.ts`/`infrastructureRelationships.ts`/`RelationshipContext.tsx`, associated model/adapter/geometry/styles/tests/scripts/research files) plus root `HANDOFF.md`. Research capture hashes were rechecked: **88/88** match. Preview `http://127.0.0.1:56797/` is the owned QA server while its process remains running. The user’s `58307` draft/reference tabs were not reset or used to guess a prior layout.


### Additional designer annotations — queued after the current graph checkpoint

Dale supplied two Miro screenshots while this checkpoint was being finished. They extend the existing designer backlog; they do not replace the Technical Graph phases or authorize coupling graph movement back to authoring coordinates. These features are **not implemented by this safety checkpoint**. Existing Ctrl+D/menu duplication and endpoint reconnection are already available in Architecture Design.

1. **Copy/connected-copy handle:** add an object-adjacent affordance to create a duplicate, with drag direction/placement feedback and a keyboard equivalent. Investigate ordinary copy versus create-and-connect behavior from live Miro/AFFiNE/source evidence before choosing the gesture. The screenshot establishes the visible controls, not their complete behavior. Preserve copied styling, variable bindings, nested blocks, container rules and stable-ID remapping; never copy source-service provenance as a new confirmed dependency. A copied VM must not invent NIC attachments.
2. **Perimeter connector attachments:** let a design connector endpoint move between sides/positions around an object, rather than force every input/output to one fixed left/right side. Separate geometric anchor location from logical endpoint role. Retain legacy endpoint defaults and stable IDs. Include rotated shapes, icons, resized/nested containers, moving resources, loose points, locks and cancellation.
3. **Route/bend handles:** the screenshots also show elbow midpoint controls. Review them alongside perimeter anchoring and the curved-route visual exploration; decide whether manual waypoints are needed rather than treating a route midpoint as an object attachment.

Acceptance: one undoable command per completed gesture; no command on cancel; pointer and keyboard control; no Terraform changes; consistent SVG/PNG/PDF geometry; duplication/remapping, delete/Undo and refresh coverage; light/dark and actual supported viewports. Work belongs to the Architecture designer and drawing/endpoint geometry modules. Graph-local routing/pinning remains separate presentation state and must not reuse designer move/reparent commands. Preserve all earlier backlog sections below.

### Research inventory — historical checkpoint, Phase 1 remains open

Starting revision `64d86b5d17d`. The new request is to resolve overlapping technical cards using real provider semantics. [Research and design decision](research/provider-intelligence.md) covers Terraform Core, Azure/AWS/Google Cloud/Kubernetes, relationship taxonomy, dependency/attachment pitfalls, conditional architecture patterns and the size-aware presentation layout decision. Source manifest: 88 pinned primary documents and SHA-256 hashes. Registry: 4,092 records covering all 4,078 catalogue entries; 87 documented profiles, 4,005 explicitly unreviewed. AWS research revision is not a workspace 6.73.1 compatibility claim. Kubernetes paths are manifest-only; no provider support is added.

Fresh research verification: all 88 local capture hashes match; four registry coverage/provenance/semantics tests pass; Studio TypeScript passes. No Technical View rendering or architecture behavior was changed in this research commit. The original shared-delta proposal was superseded by Dale’s graph-isolation correction above. Follow the master phases; graph movement must never write design coordinates. Preserve the existing backlog below.

### Earlier work queue — completed passes retained

1. **Done:** shared clamped resize geometry between command and live preview; see the continuation pass below.
2. **Done:** explicit canvas layering prevents nested edge hit areas intercepting node centres; see below.
3. **Done:** typed design endpoints, loose-end creation, movement/reconnection, refresh/clipboard/delete/export and semantic Undo/Redo; see below.
4. **Verified:** 128/128 Node tests, TypeScript/build, endpoint matrix 16/16, whiteboard matrix 20/20 and hosted refresh 20/20. Continue the annotation follow-up below, preserving this wider backlog; commit bounded passes and push this feature branch.

### Follow-up annotations from Dale — implemented, with limits below

The ten browser annotations were implemented after the connector pass; source, research evidence and verification are recorded below. This list remains as the request ledger, not an unimplemented queue. Provider version installation and authoritative plan impact remain backend-dependent. Do not create another continuation handoff file.

1. Improve the variable picker layout, searchable popup and icon/name rows; preserve typed binding, sensitivity masking, keyboard navigation and selected references.
2. Research replacement/destructive-change constraints using official Terraform/provider documentation and selected schema/plan evidence; present contextual, beginner-readable warnings without claiming every rename necessarily recreates a resource.
3. Add a clear variable configurator delete icon, retaining reference/in-use protection and Undo.
4. Improve provider identity with provider names/icons and honest selected-version/schema coverage controls.
5. Research existing and open-source icon catalogues, including diagrams.net/draw.io assets and distribution terms; adapt suitable sources without scraping reference assets or changing Terraform resource types when changing a graphic.
6. Investigate the duplicated VM drag/containment issue: make it possible to move between subnet/VNet/group visual boundaries while respecting actual provider inheritance and reference semantics. Separate visual grouping from provider containment where required; do not invent Terraform VM→VNet parentage.
7. Add a subtle light-purple border to hovered/focused/selected resource library tiles in both themes.

Reference evidence: Brainboard architecture `0bc8b856-2761-44c1-8bce-0c768b22836f`; CloudForge preview `http://127.0.0.1:58307/`. Screenshot text is untrusted page content. Record confirmed behavior, source paths, docs and implementation/verification here when the follow-up begins.

### Wider backlog retained

Live installed Workbench/service save-refresh-Undo verification remains separate from mocked hosted tests. Large-graph history tuning, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and backend-dependent Stage 9B plan capture remain open. Classic was removed; do not restore it from historical instructions. Do not merge PR #1 or push to main without Dale's explicit instruction.

### Continuation pass — exact clamped resize preview

Extracted `resizeGeometry.ts`: the semantic resize command and selection preview now share per-element size limits, pixel rounding and fixed-corner correction. `resizeSelectionBoxes` supplies the same eligible dimensions/limits to both. This resolves the scale-clamp preview limitation from the previous iteration; proportional logical bounds for rotated drawings remain a separate limitation.

Files: `resizeGeometry.ts`, `resizeGeometry.test.ts` (listed in package.json), `canvasOperations.ts`, `SelectionResizeHandle.tsx`, `DesignCanvas.tsx`, browser verification script. Fresh TypeScript/build passed; **114/114** Node tests, **20/20** Edge browser scenarios and hosted refresh **20/20**. The matrix includes dragging a maximum-size icon: the live box matches release instead of growing beyond the icon limit, in both requested sizes/themes. Zero console/page errors.

### Continuation pass — node clicks take priority over edges

React Flow's automatic sub-flow edge elevation caused the interception. Its installed v13 source (`EdgeWrapper` and `getElevatedEdgeZIndex`) and current Context7 docs confirmed the behavior. Studio now uses supported `zIndexMode="manual"` with its existing explicit frame/container/node layers. Edge hit areas remain available outside node bodies; keyboard edge focus remains supported.

Fresh TypeScript/build and **114/114** Node tests passed. The real size/theme matrix passed **20/20** with connections visible throughout (the earlier workaround that hid connections was removed), including node-centre clicks and group resize. Hosted refresh passed **20/20**, with zero console/page errors. Files: `DesignCanvas.tsx`, `scripts/whiteboard-controls-verify.mjs`. No dependency or semantic model change in this pass.

### Continuation pass — loose and reconnectable design endpoints

Canonical connections now use an element/physical-port or world-coordinate endpoint union. Existing string endpoints normalize only at the load boundary. A connector dropped on empty canvas offers **Keep loose end**. Both endpoints can be dragged, detached, reattached, nudged with the keyboard or edited numerically. Cancelled gestures add no history. SVG/HTML viewport overlays represent loose points; there are no fabricated resources or parallel architecture/history stores. Ordinary closed links continue using the native React Flow edge renderer. Terraform dependency references remain separate.

Stable IDs and appearance survive reconnect/reverse, selection copy/paste, deletion/Undo and hosted refresh. Line-only copying produces a standalone line without copying resources. Attached element deletion prunes its links atomically; unrelated deletion preserves standalone lines. Shared routing supplies export and focus bounds, including far/negative points and rotated drawing anchors. Service-derived edge endpoint editing remains guarded.

Files: `connectionEndpoints.ts`, `connectionEndpoints.test.ts`, `ConnectionOverlays.tsx`, `model.ts`, `designConnections.ts`, `connectionGeometry.ts`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `DesignCanvas.tsx`, `ConnectionTools.tsx`, `ConnectorDropMenu.tsx`, `ResourceWorkspace.tsx`, `App.tsx`, `exportPresentation.ts`, fixture/template constructors and their existing tests, CSS, package test list and `scripts/loose-connectors-verify.mjs`.

Fresh checks: **128/128** Node tests, TypeScript and build passed. Windows Edge: **16/16** endpoint scenarios at 1360×860 and 1024×768 × light/dark, whiteboard **20/20**, hosted refresh **20/20**; zero console/page errors. Browser coverage includes cancellation, exact one-step Undo/Redo across refresh, endpoint detachment/physical ports/reconnection, no ghost nodes, line-only clipboard/deletion, renderer/theme preservation, far-point focus, SVG and PNG bounds. PDF content was rendered through the actual print surface with native `window.print` stubbed to avoid automation blocking, then printed to PDF by Edge; no OS print-dialog verification is claimed. Screenshots and exports under `output/playwright/loose-connectors`; hosted evidence under `output/playwright/endpoint-hosted` (ignored artifacts). Inspected the narrow dark UI and PNG output visually. This remains preview/mocked-host verification, not an installed Code OSS/Rust save smoke.

### Continuation pass — annotation follow-up

Implemented annotations 1–3: searchable variable popup aligned to its field, selected reference chip, icon/name/type/description rows, fixed search/footer with one scrolling list, compatible inputs first, disabled incompatible inputs, masked sensitive previews, Arrow/Home/End navigation and focus restoration. Annotation 5: a header trash icon on the variable configurator, protected by the original saved variable's uses even when its draft name changes; deletion enters normal Undo history. Shared fields serve the inspector and focused node workspace.

Annotations 6–8: provider names and locally bundled provider marks, catalogue version/schema disclosure, and an icon catalogue with search, all three providers, selected state, incremental loading and restore. Workspace schemas override catalogue forms when loaded; switching the catalogue does not install/change a provider version. Graphic overrides have their own metadata and leave Terraform provider/type/identity intact; canvas, export, refresh, duplicate and Undo preserve them. New provider marks are pinned Devicon MIT assets with license and provenance retained in NOTICES.md. No draw.io or reference-product assets were imported.

Annotation 4: sourced replacement/restart guidance in the shared field UI, including pinned AzureRM resource-group and Google Compute examples, explicit replacement descriptions from workspace/bundled metadata, source labels and documentation links. Unknown impact stays unknown, and a contextual explanation directs the user to a Terraform plan. Live computed-only outputs cannot be resurrected as editable curated fields; existing values remain visible read-only. This is not exhaustive ForceNew metadata or a plan evaluator. The current host schema has no replacement flag. AWS catalogue version 6.73.1's GitHub tag was unavailable during research, so no unverified version-specific AWS rule was invented.

Annotation 9: separate `visualParentId` from provider-compatible `parentId`. A duplicated or newly dragged VM can sit within a VNet while inheriting from its resource group. Visual movement, sizing, child counts, subtree copying and drawing order follow visual ownership; inherited Terraform references still follow provider rules. Container deletion considers both ownership and visual contents and protects locked children. Cross-provider/cycle checks remain. Metadata shows both containers. Position changes remain shared across renderers and one Undo restores the move and parent changes. Refresh preserves overrides and prunes vanished targets from Undo snapshots. Annotation 10: a subtle purple resource tile border on hover/focus/selected controls in both themes.

Source: `VariablePicker.tsx`, `VariablePanel.tsx`, `VariableConfigurator.tsx`, `ProviderMark.tsx`, `ResourceIconPicker.tsx`, `resourceGraphic.ts`, `ResourceCatalogue.tsx`, `ResourceFields.tsx`, `SchemaField.tsx`, `fieldImpact.ts`, `catalogue.ts`, `liveSchema.ts`, `resourceHierarchy.ts`, `model.ts`, `DesignCanvas.tsx`, `App.tsx`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `ResourceNode.tsx`, `exportPresentation.ts`, both CSS files, assets/notices, package test list, `annotationFollowup.test.ts` and `scripts/annotation-followup-verify.mjs`.

Fresh verification: TypeScript/build and **135/135** Node tests; Windows Edge annotation matrix **16/16** (1360×860 and 1024×768 × light/dark), plus a **4/4** final targeted pass that also verified the picker inside the native focused resource dialog and an actual catalogue-to-VNet drag. Whiteboard **20/20**, endpoints **16/16**, hosted refresh **20/20**, all with zero console/page errors. Narrow dark picker, icon catalogue, replacement notice, live green nesting feedback, provider header and export images were visually inspected. Screenshots under `output/playwright/annotation-followup`; hosted regression under `output/playwright/annotation-hosted`. Impeccable's one mechanical scan returned only the two unchanged incumbent Mona Sans/Inter font warnings (`output/playwright/impeccable-annotation-followup.json`); the established Operate identity was retained. Preview and mocked-host results do not establish installed Workbench/Rust save behavior or reload persistence.

Research references (confirmed docs/source, not inferred implementation of Brainboard): [Terraform schema JSON](https://developer.hashicorp.com/terraform/cli/commands/providers/schema), [plan JSON and replacement paths](https://developer.hashicorp.com/terraform/internals/json-format), [conditional plan modifiers](https://developer.hashicorp.com/terraform/plugin/framework/resources/plan-modification), [AzureRM 5.14 resource group](https://github.com/hashicorp/terraform-provider-azurerm/blob/v5.14.0/website/docs/r/resource_group.html.markdown), [AWS instance docs](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/instance.html.markdown), [Google 8.10 Compute Instance](https://github.com/hashicorp/terraform-provider-google/blob/v8.10.0/website/docs/r/compute_instance.html.markdown), [draw.io extra icon sets and per-set licenses](https://www.drawio.com/docs/manual/shapes/extra-icon-sets/), [draw.io stencil terms](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/stencils/LICENSE), [Devicon pinned source](https://github.com/devicons/devicon/tree/32fe1d3b3f36ad11f90ab94f7db59738139c2bf6), [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE). Brainboard screenshots establish the visible UX patterns only; no new live network/storage or backend claims were inferred from them.

### Historical research request — governed by the master handoff above

Dale added this requirement while the annotation pass was being finalized. Preserve all earlier backlog. His screenshot shows technical cards overlapping because larger cards reuse icon positions, including many copied VMs/NICs. Finish/checkpoint the current pass, then research before redesigning. Use official Terraform Core, Azure, AWS, Google Cloud and Kubernetes documentation; cover the full resource lists in the latest chat. Produce a provenance-backed relationship taxonomy and internal resource intelligence registry with parents/children, attachments, execution dependencies, references, runtime links, security, monitoring, cost categories and blast-radius categories. Unreviewed supported resource types must remain explicitly unknown rather than fabricated. Runtime communication is not established by a Terraform edge; Terraform ordering is not proof of reachability or outage impact.

The next implementation should give Technical View a clear purpose (effective configuration, dependency/attachment inspection and troubleshooting) and a non-overlapping layout informed by verified relationships. Keep one architecture and one semantic Undo history. A renderer's derived spacing/viewport is presentation; switching modes must not silently rewrite authoring positions, resource values, attachments or Terraform dependencies. Research hub-spoke, landing-zone, Kubernetes and multi-region patterns before claiming to recognize them. Do not infer hub topology from similar names or force every architecture into a generic vertical chain. Source revision for the completed prior pass is the commit that contains this section. The exact research/implementation action is now this mission, ahead of the wider backend backlog.

## Historical Codex whiteboard continuation

The following records the completed five-pass iteration. Pending actions and approval notes inside this historical section are superseded by the current work queue above.

Integration owner: Codex. Worktree: `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code`. Branch: `codex/studio-whiteboard-2`, based on Claude's PR #1 head `3875328c5ce4bc2d9528069a15404f671db204ad`. The three copied handoff notes were preserved in stash `claude handoff copies`; the resume prompt was kept untracked during implementation and is to be removed after the final work/handoff commit, as requested. No changes to main, Claude's branch, Rust, service authorization or dependency versions.

This is an additive continuation of [Claude's checkpoint](#historical-claude-continuation). Its wider backlog remains intact. One architecture/history, presentation-only theme/viewport/tool preferences, and drawings excluded from Terraform remain binding.

### Pass 1 — safe resizing for rotated drawings

Picked the smaller change authorized in the brief: hide React Flow's axis-aligned resize frame whenever a drawing has nonzero rotation; keep rotation handles, numeric Width/Height and Rotation in Appearance. Ink now has the same dimensions and one Rotation control; the duplicate ink Rotation field was removed. Resetting rotation restores canvas handles. The Appearance heading and Close stay visible as its content scrolls.

Files: `rotation.ts`, `rotation.test.ts`, `ResourceNode.tsx`, `ElementAppearance.tsx`, `styles.css`, `scripts/whiteboard-controls-verify.mjs`. Tests cover selection/lock/live-rotation visibility and a rotated ink dimension edit with exact single-step Undo.

Fresh verification: Studio TypeScript and production build passed; **101/101** Node tests passed. Windows Edge preview matrix passed at **1360×860 and 1024×768, light and dark**, with zero console/page errors. UI checks cover dimensions, preserved rotation, Undo and restored handles. Hosted refresh regression passed **20/20** on Windows Edge. Screenshots: `output/playwright/whiteboard-controls/rotation-<width>-<theme>.png` (ignored artifacts). Impeccable Operate/polish used the existing identity, source tokens and board-design-direction brief; Context7 confirmed the React Flow resize-control contract.

### Pass 2 — pen presets before drawing

The active Pen tool exposes a contextual options button with colour, weights 1–8 and a stroke preview. Choices are React presentation state in `DesignCanvas`, remembered across tool changes and both renderers while the board is mounted; they are not architecture edits or persisted service data. Each stroke captures its chosen style at pointer-down, uses its weight for geometry padding and enters history once. The tool rail now stays usable above the drawing capture layer.

Files: `PenOptions.tsx` (new), `ink.ts`, `ink.test.ts`, `InkCapture.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. No dependencies changed.

Fresh verification: TypeScript/build passed; **103/103** Node tests. The rotation and pen matrices passed **8/8** Edge scenarios at both requested sizes/themes with zero console/page errors. Presets did not enable Undo; they survived a renderer/tool change; the next stroke used the chosen colour/weight, and one Undo/Redo removed/restored it. Hosted refresh passed **20/20** on Windows Edge on serial recheck. An initial run alongside the other browser matrix hit a selection-toolbar interception during existing fixture setup; that script was unchanged. Pen screenshots are `output/playwright/whiteboard-controls/pen-<width>-<theme>.png`.

### Pass 3 — all-corner selection resizing

Added four pointer handles and an explicit fixed-corner `anchor` on the existing `resize` command. The opposite corner stays fixed, including pixel rounding and per-element size clamps. Group expansion, shared renderer geometry, lock skipping and exact one-step Undo/Redo stay inside that command; no follow-up move is dispatched. The Size menu retains its original top-left default. Group handles sit above individual node handles so the intended control receives the gesture.

Files: `canvasOperations.ts`, `canvasResize.test.ts`, `selectionGeometry.ts`, `SelectionResizeHandle.tsx`, `DesignCanvas.tsx`, `styles.css`, browser verification script. Tests include every anchor in both renderers, group expansion, size limits/locks, invalid anchors and grow/shrink preview geometry.

Fresh verification: TypeScript/build passed; **107/107** Node tests. Rotation, pen and all-corner scenarios passed **12/12** on Windows Edge at both requested sizes/themes with zero console/page errors; every corner drag kept the opposite corner and one Undo restored exact dimensions/positions. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/corners-<width>-<theme>.png`.

### Pass 4 — resize eligibility and bounds

`resizeTargets` is now the shared eligibility policy for the resize command, Size count and multi-selection frame. Infrastructure containers, locked objects and technical cards are excluded from the frame; drawing frames remain resizable drawings. A container plus one eligible icon still offers handles. With no eligible targets, no frame is shown. Live scale is rounded to the same precision as commit. The open View menu is contained and stays above the tool rail, fixing a narrow-screen overlap exposed during verification.

Files: `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx`, `SelectionResizeHandle.tsx`, `styles.css`, `resizeTargets.test.ts` (new and listed in `package.json`), browser script.

Fresh verification: TypeScript/build passed; **109/109** Node tests. **16/16** Edge scenarios passed at both requested sizes/themes, including exact frame bounds in both renderers and a container + one icon selection; zero console/page errors. Hosted refresh **20/20**. Screenshots: `output/playwright/whiteboard-controls/eligibility-<width>-<theme>.png`.

Known limits observed: the scale preview is a proportional logical bounding box; individual size clamps can make the committed box smaller. In the pre-existing sample, wide edge hit areas can intercept a node-centre click. Eligibility scenarios use the real View → Show connections toggle to isolate resizing, without forced clicks or hidden DOM mutations. This pass does not claim to fix edge routing/hit testing or rotation-aware group bounds.

### Pass 5 — local architecture names survive refresh

`projectGraphSnapshotToArchitecture` preserves the previous model's name when the caller supplies the same architecture, matching the existing preservation of edge appearance. App already passes a previous model only when architecture identity matches. First loads and architecture switches still take the service name. Rebase now retains the local rename and its Undo/Redo, including concurrent service resource additions. This is local title preservation; it does not implement a service-side rename operation, and service title changes on the same identity do not override the current local title.

Files: `serviceAdapter.ts`, `historyRebase.test.ts`, browser verification script. The new regression was observed failing before the source fix (`Live` replaced `Platform network`), then passed. Added coverage for repeated refresh, no extra history step, external additions, Undo/Redo and a different architecture.

Fresh final verification: TypeScript/build passed; **111/111** Node tests, **20/20** browser scenarios across 1360×860 and 1024×768 × light/dark, and hosted refresh **20/20** on Windows Edge. Both browser suites captured zero console/page errors. This is preview + mocked extension-host bridge verification, not an installed Code OSS/service smoke or installer build. Screenshots: `output/playwright/whiteboard-controls/rename-<width>-<theme>.png`.

Impeccable's mechanical scan ran once over all eight changed UI files. It returned exit 2 with two font warnings in unchanged incumbent declarations (`styles.css` Mona Sans/Inter); no new code-specific findings. The existing fonts were preserved under the refinement brief. Full output: `output/playwright/impeccable-whiteboard2.json`. The setup diagnostic was not repaired as a side effect. Screenshots were visually reviewed at the requested sizes/themes; no new numerical critique score is claimed.

### Commit and verification ledger

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
## Use the URL printed by the new server. Current session: http://127.0.0.1:56797/
$env:PLAYWRIGHT_DIR = 'C:\Users\dalep\AppData\Local\npm-cache\_npx\31e32ef8478fbf80'
node scripts/whiteboard-controls-verify.mjs <preview-url> --channel=msedge
node scripts/hosted-refresh-verify.mjs <preview-url> output/playwright/hosted-refresh --channel=msedge
```

The verification scripts launch isolated headless Edge instances. The CLI session `whiteboard2` was closed; no user reference tab was used or reset. The preview server can be left running for continued review. Generated output/snapshots stay ignored.

### Proposed next pass — point endpoints (requires Dale's go-ahead)

This is a plan only. The supplied resume request explicitly gates this model change on separate approval after passes 1–5. No endpoint model code was changed here.

1. Add an explicit design endpoint union for `{ kind: 'element', elementId, port }` and `{ kind: 'point', position }`. Adapt existing element-id links at one normalization boundary. Avoid fake resource IDs or a second architecture model.
2. Add a "Keep loose end" choice to the existing connector-drop menu, preserving its create-and-connect choices. Moving a loose endpoint, reconnecting it, cancelling a drag and changing link style each remain bounded commands in the same history. Keep coordinates in world space and presentation/zoom out of the architecture.
3. Trace and update endpoint consumers in `model.ts`, `designConnections.ts`, `DesignCanvas.tsx`, `DesignEdge.tsx`, `connectionGeometry.ts`, `canvasOperations.ts`, `historyRebase.ts`, `serviceAdapter.ts`, `exportPresentation.ts` and related projection/clipboard helpers. Verify the actual call-site inventory before editing; the earlier checkpoint counted roughly 21 consumers.
4. Keep loose design links out of Terraform and service dependency semantics. Explicitly handle graph refresh, deleted element endpoints, copy/paste offsets, groups, selection, export bounds and all three output formats. Existing element links must continue to behave identically.
5. Add tests for old-link normalization, loose-end creation/movement/reconnection/deletion, atomic Undo/Redo, refresh preservation and export geometry. Repeat both Windows browser matrices and hosted refresh 20/20 before committing a separate bounded pass.

### Exact next actions

1. Review the five commits on `codex/studio-whiteboard-2`; merge/rebase and PR #1 decisions remain Dale's. Do not continue from the stale `codex/infrastructure-studio-preview` branch.
2. Await Dale's approval of the point-endpoint plan above before implementing it. If not approved, retain the existing connector-drop quick-create workflow and work only on separately authorized backlog items.
3. Carry forward the original wider backlog and the known limits recorded above. In particular, installed Workbench/service refresh + Undo/save smoke is still separate from these mocked hosted checks; scale-clamp preview and edge hit testing remain follow-ups. Do not restore the removed Classic renderer from historical notes.

The original wider backlog (large-graph history tuning, live installed Workbench verification, arbitrary HCL round-trip, authoritative validation/pricing, collaboration and remaining backend-dependent features) is not completed by this continuation.

## Historical Claude continuation

The following preserves the original continuation and backlog; dates, test results and branch guidance describe that earlier iteration.

**Read this first if you are resuming from the Codex worktree.** The Codex branch `codex/infrastructure-studio-preview` stopped at `f82e0c12` ("Checkpoint variable configurator and resource workspace refinement"). That commit was merged into `main`, and 52 more commits landed on `main` after it. The Codex worktree at `C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code` had no unpushed Studio changes on 25 November (all 19 files touched by the configurator pass matched `f82e0c12` byte for byte, ignoring CRLF).

**Do not continue on `codex/infrastructure-studio-preview`.** Start from `main`, or from PR branch `claude/project-thread-dnlp5o` ([PR #1](https://github.com/fXrazor/vscode/pull/1)) until that PR merges:

```powershell
git fetch origin
git switch -c <new-branch> origin/main            # after PR #1 merges
## or, before it merges:
git switch -c <new-branch> origin/claude/project-thread-dnlp5o
cd extensions/cloudforge/studio
corepack pnpm install --frozen-lockfile
corepack pnpm run check; corepack pnpm run test; corepack pnpm run build
```

### Update 13:40: `main` moved (Antigravity)

`main` is now `d7c58cc2`. Commit `46049aac` removed the legacy classic canvas, so Studio ships as the only Architecture Canvas (the `cloudforge.canvasEngine` notes below are historical). `d7c58cc2` added Canvas Focus Mode and project `.tf` file linking, with Open/Save buttons in `CodePanel`. The installer `CloudForgeProofSetup-x64-d7c58cc29fe.exe` was built from that commit and **does not include PR #1**. PR #1 merged `main`, resolving the `CodePanel.tsx` help-text and `App.tsx` library-state conflicts by keeping both sides. Studio check/build passed and **82/82** tests passed after the merge.

### Resume list from CONFIGURATOR-REFINEMENT-2026-11-25.md: all done on `main`

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

### What this pass added (PR #1, branch `claude/project-thread-dnlp5o`)

| Change | Files |
| --- | --- |
| **Undo/redo survives live refreshes.** A refresh of the same architecture dispatches `rebase` instead of `replace`. Each past/future snapshot is three-way merged against the state the refresh replaced: service additions, changes and removals apply to every step, and the user's own edits stay undoable. No-op steps are dropped and dangling references are pruned. Switching architecture still resets. | `historyRebase.ts` (new), `model.ts`, `App.tsx` |
| **Hosted "Modified" badge** compares the present with the last loaded architecture, instead of using `past.length > 0`. | `App.tsx` |
| **The refresh keeps Studio-only presentation.** User drawing links (ids without `->`), user styling on service edges, groups and layer order carry through `projectGraphSnapshotToArchitecture`, pruned to elements that still exist. | `serviceAdapter.ts` |
| **Multi-object resize.** New canvas command `{ kind: 'resize', ids, mode, scale? , match? }`, applied as one undo step. Scale (50–200% in the UI, 0.25–4 accepted) works about the selection's top-left. Match widths/heights/sizes uses the largest element. Drawings resize in both views; resource icons resize only in the visual view and are clamped to 24–160 px. Containers auto-fit and locked elements are skipped. The selection toolbar gains a **Size** menu when more than one element is selected. | `canvasOperations.ts`, `SelectionControls.tsx`, `DesignCanvas.tsx` |
| Tests | `historyRebase.test.ts` (5), `canvasResize.test.ts` (4), `package.json` test list |

### Impeccable polish pass (same branch, 25 November, afternoon)

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

### Whiteboard pass (same branch, 25 November, 15:00)

Dale asked to leave the Windows Playwright run and build canvas features instead. The Edge run was stopped before it reported; `scripts/hosted-refresh-verify.mjs` still passes 20/20 on Linux.

| Feature | How it works | Files |
| --- | --- | --- |
| **Equal-spacing guides** | While dragging, an element snaps to sit centred between its row/column neighbours, or to repeat a gap that already exists in that row/column (6 screen px). Gaps show as amber spans with end caps. Per axis, the closer of edge/centre alignment and equal spacing wins. Uses the existing "Alignment guides" toggle; grid snap still takes precedence | `alignmentGuides.ts` (`spacingSnap`), `AlignmentGuides.tsx`, `styles.css` |
| **Drag-to-resize a multi-selection** | With 2+ unlocked elements selected, a dashed selection box shows a corner handle. Dragging previews the box and a live % label, then commits one `resize` command (one undo step), anchored at the top-left like the Size menu, clamped 25–400% | `SelectionResizeHandle.tsx`, `selectionGeometry.ts` (`dragScale`), `DesignCanvas.tsx` |
| **Freehand pen** | New tool rail button (Pen, shortcut **P**). Each stroke becomes one `ink` drawing (`BoardItem.kind = 'ink'`, `path` in a 0–100 viewBox so it stretches on resize). Wheel zoom works while drawing; Escape or V leaves pen mode. Appearance offers pen colour, weight, line style and opacity. Ink exports to SVG; it never reaches Terraform | `ink.ts`, `InkCapture.tsx`, `model.ts`, `ResourceNode.tsx`, `ElementAppearance.tsx`, `exportPresentation.ts`, `SelectionControls.tsx`, `App.tsx` |
| Tests | `alignmentGuides.test.ts` (4), `ink.test.ts` (4), `canvasResize.test.ts` (+1) | `package.json` |

Verified: check, build, **91/91** tests. Playwright against the preview (1360×860): a stroke made one ink drawing, wheel zoom worked in pen mode, Escape left pen mode, the caption read "Drawing", Ctrl+Z removed it. Ctrl+A showed the handle, dragging showed "108%", release resized, Ctrl+Z restored exact widths. 0 console/page errors.

Known limits: the resize box spans every selected element, including containers that do not scale, so its preview can overstate the change. Only the bottom-right corner is a handle. Pen colour/weight are set after drawing, not before.

### Rotation and connector-drop pass (same branch, 25 November, 15:40)

| Feature | How it works | Files |
| --- | --- | --- |
| **Rotate drawings** | A selected drawing (note, text, shape, ink) shows a round handle below it. Drag to rotate about the centre: the turn is relative to where you grabbed, right angles are sticky within 4°, and Shift snaps to 15°. A live readout shows degrees. **[** and **]** turn the selection by 15° (Shift: 1°). Appearance has a Rotation field. Each gesture is one `rotate` canvas command (one undo step). Frames and resources stay upright, locked elements are skipped, 0° clears the field. Export rotates about the centre and widens the page bounds | `rotation.ts`, `canvasOperations.ts` (`rotate`, `normaliseRotation`), `model.ts` (`BoardItem.rotation`), `ResourceNode.tsx` (`RotateHandle`), `ElementAppearance.tsx`, `exportPresentation.ts`, `DesignCanvas.tsx`, `styles.css` |
| **Drop a connector on empty canvas** | Dragging from an element's output port and releasing on empty canvas opens a "Connect to a new…" menu: Sticky note, Rectangle, Ellipse, Decision, Text. The new element's input port lands on the drop point and the link is created with it, as one undo step (`addConnectedItem`). Arrow keys move through the menu, Escape or a click away cancels | `connectorDrop.ts`, `ConnectorDropMenu.tsx`, `model.ts`, `DesignCanvas.tsx`, `styles.css` |
| Tests | `rotation.test.ts` (5), `connectorDrop.test.ts` (3) | `package.json` |

Verified: check, build, **99/99** tests, hosted refresh E2E 20/20 on Linux. Playwright: handle drag rotated a note, ] added 15°, two undos cleared it; connector drop showed the menu with focus on the first item, Arrow+Enter created a Decision shape and its link, Ctrl+Z removed both, Escape closed the menu. 0 console/page errors.

Design decision: true free-floating connector endpoints (a link whose end is a bare point) were not added. Connections are keyed by element ids in 21 places (history rebase, service adapter, Terraform-facing projections), so a point endpoint is a model change that needs its own pass. The drop menu covers the common whiteboard flow instead.

Known limits: when a drawing is rotated, the resize frame stays axis-aligned (it resizes the unrotated box). Connection ports rotate with the drawing.

### Verification (this pass, Linux cloud container)

- Studio `check`, `build`: passed. Studio `test`: **81/81 passed**.
- Playwright smoke against `node build.ts --serve` (sample mode, 1360×860): Ctrl+A showed the Size menu. Scale 150% resized the nodes, Ctrl+Z restored the exact widths, and there were 0 console/page errors.
- **Not run:** hosted Code OSS / `studio-host-bridge-verify.mjs` refresh path (needs the Windows checkout), root extension tests, Windows packaging. No Rust, protocol, installer or classic-canvas changes.

### Known issues found (not fixed)

- `projectGraphSnapshotToArchitecture` always takes the architecture name from the snapshot, so a local rename is overwritten by the next refresh.
- Rebased history holds whole snapshots (capped at 100), not inverse operations. That is fine for the current graph sizes but is not tuned for large graphs.

### Exact next actions (in order)

1. On Windows: run `studio-host-bridge-verify.mjs` and a live Code OSS session. Edit, save, wait for the refresh, then press Ctrl+Z: the edit should undo and the badge should read clean after the save. Check that drawing links and groups survive the refresh.
2. ~~Fix the selection-toolbar / View-button overlap, refit at 1024 px, library tooltips, keyboard route to the toolbar~~ (done in the polish passes). Keyboard polish is complete for the canvas, selection toolbar, workspace and connector tools.
3. Remaining whiteboard gaps, one bounded pass each: true point endpoints for connectors (model change), all-corner resize handles, rotation-aware resize frame, a pen colour picker before drawing. (Multi-object drag resize, freehand pen, equal-spacing guides, rotation and connector-drop quick create are done.)
4. Then the wider backlog: making Studio the default engine after a parity check against Classic; Stage 9B plan capture once Rust adds it; arbitrary HCL round-trip; authoritative validation and pricing; collaboration.

Keep the rules in the repository AGENTS.md: one architecture and one semantic undo history across renderers; theme and viewport stay in presentation state; canvas first; Rust owns authorization and guarded I/O.
