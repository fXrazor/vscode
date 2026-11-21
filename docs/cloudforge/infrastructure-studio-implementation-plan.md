# CloudForge Infrastructure Studio implementation plan

Planning proposal, 17 November 2026. Prepared from the supplied master specification, two reference screenshots, and the user's clarification to think of this part as “n8n for cloud infrastructure.” All phases describe future work. Priority, sequencing, initial provider scope and acceptance targets are recommendations for review.

## Product direction

Infrastructure design has two modes. **Visual Design** retains the original Brainboard-style architecture diagram with Miro-inspired whiteboard features. **Technical Design** provides the n8n/Blender-inspired engineering nodes, resource configuration and dependency inspection. Both represent the same resources and architecture revision. Keep resource selection and architecture context when switching between them.

Build the technical resource editing and execution experience around n8n's canvas-to-node workflow. An engineer opens an architecture, selects a resource, inspects what it depends on, edits supported configuration, validates the proposed change, and follows its results back onto the canvas. Validation, generation, execution and deployment are workflows accessible from the shared architecture. They can open the Runner, timeline or plan review as needed.

The first useful delivery is a navigable architecture canvas with a focused resource workspace. Provider-backed forms, safe editing, generation and deployment then extend that workspace in stages. Begin authoring support with one provider and a small network resource set. Azure networking is the proposed starting point because it matches the examples. Keep the domain interfaces provider-neutral and add resource types according to verified schema coverage.

The attached master specification supplies requirements to assess and sequence. Its imperative wording describes the desired product, while the user's current instruction requests an implementation plan. The screenshots supply interaction references. The n8n example supports a detailed visual assessment. The small node-editor image shows an overview of a dense graph with a property inspector, with limited legible detail.

## Evidence from the current product

Source review used desktop `main` at `70c72e1b523c3948e3f092ec174e09ab4cda2432` and Rust `main` at `ca09ef6a1a3e76f96230b69da929ebdc503fbdc6`. The adjacent Rust checkout contains existing local modifications. Findings below describe inspected source and inherited handoff evidence.

| Existing capability | Implication for this plan |
| --- | --- |
| Code OSS shell, editor groups, Explorer, Source Control, Problems and panels | Reuse the Workbench for navigation, code, diff review and docking. Implement the specialised canvas inside the built-in CloudForge extension. |
| `cloudforge.projects` and `cloudforge.resources` native trees | Use these as launch points for architecture and resource workspaces. The current desktop graph is a resource tree. A shipped React Flow canvas is a new delivery. |
| Stage 2 broker and extension have merged | Complete the remaining Terraform detection integration and installed smoke recorded in the handoff before declaring the project journey ready. |
| Revision-bound graph reads and trusted source navigation | Preserve per-window scope and stale-source handling when opening or validating a node. |
| Sanitised graph protocol with one outstanding request | Rich configuration values, schema browsing, drafts, Runner operations and cloud calls each require a defined contract extension. |
| Rust catalogue schema, form, coverage and HCL draft-rendering modules | Assess and reuse the domain modules through a Tauri-independent service adapter. Verify their coverage, diagnostics and data projection before exposing them to the desktop. |
| Parser limits of 1,200 nodes, 6,000 edges and 200 diagnostics | Measure the initial canvas within those bounds. Enterprise-scale graph coverage needs service work in addition to UI rendering improvements. |
| Existing Runner View proposal | Reuse its state, cancellation and progress-batch direction. Align its entry points with the focused resource workspace. |

Source entry points are the [desktop handoff](../../HANDOFF.md), [built-in extension](../../extensions/cloudforge/src/extension.ts), [project controller](../../extensions/cloudforge/src/project/controller.ts), [main-process broker](../../src/vs/code/electron-main/cloudForgeServiceChannel.ts), [Runner proposal](runner-view-design.md), [canonical service protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md), [Rust form schema](Z:/CloudForge/src-tauri/src/catalogue/form.rs), [draft renderer](Z:/CloudForge/src-tauri/src/catalogue/draft.rs), and [Terraform parser](Z:/CloudForge/src-tauri/src/terraform_graph.rs).

## Lessons from other applications

The observed features below come from official product documentation. CloudForge adaptations and effort ratings are engineering proposals. Availability in a particular commercial plan is outside this assessment.

| Reference | Documented pattern | CloudForge adaptation | Feasibility |
| --- | --- | --- | --- |
| n8n node workflow | A selected node exposes actions and can be tested in context. | Open a resource workspace with dependencies, configuration and results. Make **Validate Resource** the first scoped action. | High for inspection, medium for validation. [Node controls](https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes.md) |
| n8n partial execution | Executing one step can execute preceding nodes needed for its inputs. | Calculate and display the check prerequisite scope before validation. Support read-only checks across that scope. | Medium. Requires a check dependency model. [Execution types](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions.md) |
| n8n pinning | Saved test outputs can be reused during development. | Offer a clearly labelled sample or captured validation context for repeatable draft checks, recording its revision and age. Production planning must resolve current authoritative inputs. | Medium, after provenance and retention are defined. [Pinned test data](https://docs.n8n.io/build/work-with-data/pin-and-mock-data.md) |
| n8n expressions | Parameters can reference earlier data and show computed previews. | Add a schema-aware reference picker for resource outputs, module outputs and variables. Preserve HCL expressions and show unresolved or apply-time values explicitly. | Medium to high complexity. Requires type checks and expression preservation. [Expressions](https://docs.n8n.io/build/work-with-data/expressions-versus-data-nodes.md) |
| n8n execution history | Executions can be filtered, inspected and retried. | Provide runs by architecture, revision, status and time. A validation rerun records a new run and its relationship to the earlier attempt. | Medium for validation, high for deployment recovery. [Execution history](https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions.md) |
| n8n sub-workflows | A workflow can call a smaller workflow. | Reusable infrastructure modules expose typed inputs and outputs. Separately, approved validation recipes can compose checks. | High complexity for extracting existing Terraform into modules. [Sub-workflows](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts.md) |
| Brainboard | Resources, code, issues and deployment are accessible alongside the design. | Keep a lightweight inspector for quick checks and open the larger resource workspace for deep work. Link findings to generated HCL previews. | High for navigation, medium for previews. [Right panel](https://docs.brainboard.co/cloud-design/right-panel) |
| Blender | Frames organise related nodes in a large node setup. | Add named visual areas, group selection and compact engineering cards. Treat frame membership as presentation metadata. | High after canvas persistence. The cited manual is version 3.6. [Frame nodes](https://docs.blender.org/manual/en/3.6/interface/controls/nodes/frame.html) |
| Miro | Frames organise, navigate, present and export board content. | Architecture sections become export boundaries and a presentation sequence for customer reviews. | High for sections, medium for faithful exports. [Frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames) |
| Figma | Version history supports browsing, naming, restoring and duplicating checkpoints. | Add named architecture checkpoints, a compare preview and restore as a new revision. | Medium for design documents, high for linked multi-file source. [Version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history) |
| Adobe workspace model | Panels can be arranged and saved as task-oriented workspaces. | Start with modes within the architecture editor. Add optional Workbench layout presets after the mode journeys are established. | High within the editor, medium for supported whole-window presets. [Workspace management](https://helpx.adobe.com/after-effects/desktop/get-started/get-familiar-with-the-interface/workspaces-panels-viewers.html) |
| React Flow | Supports custom nodes, grouped subflows and visibility optimisations. | Share one canvas foundation for icons, configuration summaries and status overlays. Benchmark collapse and viewport culling. | High for rendering, service pagination remains separate work. [Subflows](https://reactflow.dev/learn/layouting/sub-flows), [performance](https://reactflow.dev/learn/advanced-use/performance) |

## Recommended experience

### Architecture workspace

The editor header identifies the project, architecture, active revision and source authority. A **Visual Design | Technical Design** switch selects the infrastructure design presentation. Retain selection, expanded groups and active finding through a mode change. Store a viewport and layout preference for each mode so the visual diagram and technical cards can each remain readable. Shared resource edits update both presentations.

Users can switch between the two modes at any point while designing, including with unsaved changes. Both modes edit the same in-progress architecture document and share its draft, dirty state and undo/redo history. Switching preserves edits and validation messages and requires no save, export or re-import. A user can add a resource visually, configure it technically, then return to the visual diagram and continue designing.

| Mode | Primary content | Main action when available |
| --- | --- | --- |
| Visual Design | Brainboard-style provider icons, resource names and architecture connections, with Miro-inspired frames, annotations, alignment, grouping and presentation/export tools | Add Resource |
| Technical Design | n8n/Blender-inspired engineering cards, typed inputs and outputs, key settings, dependencies, configuration coverage and the focused resource workspace | Open Resource |

Both modes expose the available validation, generation and deployment commands. The Runner displays the current or selected run, resource status and check timeline. Plan review displays root changes, replacements, deletions and approvals. These workflows preserve the originating design mode and offer a return to its resource selection and viewport.

Support provider icons for Azure, AWS, GCP and Kubernetes as their reviewed assets and metadata become available. Configuration authoring coverage advances independently of icon availability. Persist layer visibility for Infrastructure, Platforms, Applications, Security and Operations as a view preference. Show a persistent count of hidden findings when a filter or collapsed group hides affected resources.

Single-click selects a resource and shows a brief inspector. Double-click, **Open Resource** from the menu, or a keyboard command opens the dedicated resource workspace. Returning to the canvas restores the originating selection and viewport. Resource list and search give equivalent access without spatial navigation.

### Focused resource workspace

Adapt the supplied n8n screenshot into this layout. The configuration form is the centre of attention. The side panes can collapse or become tabs at narrow widths.

| Left pane — Inputs | Centre — Resource | Right pane — Results |
| --- | --- | --- |
| Upstream resources and module outputs | Provider, type, resource name and source authority | Validation findings with remediation |
| Variables and reference provenance | Parameters and Settings | Draft HCL preview |
| Reference type and resolution state | Simple and Advanced views | Dependency impact and affected resources |
| Contextual documentation and examples | Schema-backed fields and inline errors | Planned changes, once a plan exists |
| Optional advisor entry | Validate Resource | Known outputs and their provenance |

Use **Parameters** for resource properties and **Settings** for CloudForge-specific options such as display label and visibility. Provider lifecycle or deployment behaviour belongs in clearly described infrastructure configuration. Contextual help sits beside the field or in the left pane. Show the source, provider version and last refresh time of documentation or schema-derived guidance.

The right pane has Findings, Preview and Outputs tabs. Outputs distinguish draft expressions, sample values, plan values and observed deployment values. Mark unknown, sensitive, stale and unavailable values explicitly. A simulated result carries its sample label wherever it appears. Structured tables and safe JSON views are useful where the service supplies approved projections.

**Simple** presents fields the form adapter can represent faithfully. **Advanced** opens the relevant HCL in a native editor or split group. Both connect to the same draft and source revision. Preserve unsupported expressions and blocks, with a clear route to edit them in source. Detect changes in either view, invalidate derived previews and require reconciliation before a stale draft can be applied.

For imported resources, the initial resource workspace offers inspection and **Open Source**. Rich field values and writable forms arrive after the service defines safe, scoped projections. Avoid synthesising example values in an actual resource inspector.

### Main user journeys

| Journey | Sequence | Required alternate states |
| --- | --- | --- |
| Inspect imported infrastructure | Open project → choose architecture → select resource → Open Resource → follow dependency or source | Consent needed, missing root, parser partial, resource removed, source changed, unsupported schema |
| Configure a resource | Open Resource → change supported field → inspect preview → save or review source change | Dirty draft, expression beyond form coverage, validation error, external edit, failed save, discarded draft |
| Validate a selected resource | Validate Resource → inspect prerequisite scope → run → open finding → amend → rerun | Missing inputs, dependency cycle, failed check, incomplete coverage, cancelled run, disconnected service |
| Prepare a deployment | Save input → Create Plan → review whole-root changes and risk → approve exact plan → apply → verify | Missing credentials, backend lock, changed inputs, expired plan context, replacement or deletion, interruption, partial apply |
| Recover earlier work | Open History → select checkpoint → compare → restore into a new revision or experiment | Unsaved work, missing source, conflict, corrupt checkpoint, storage limit |

Primary inspection and validation tasks should be reachable within three deliberate actions from a selected architecture. Deployment review has its own explicit steps so the user can assess the full change.

### Infrastructure workflows

Make the n8n execution concept visible through a linked workflow view. Offer a fixed **Validate Architecture** recipe in Phase 3. Extend it to **Validate → Generate Preview → Review Changes → Create Plan → Approve Plan → Apply → Verify** as the required capabilities arrive. Every step exposes its captured inputs, operation settings, findings, duration and safe outputs in the same focused workspace pattern. Selecting a step highlights its affected resources. Selecting a resource reveals the steps that act on it.

Resource cards represent infrastructure declarations. Workflow step cards represent operations and have a distinct shape and action label. An approval step waits for a recorded decision. A validation failure exposes the failing check and its recovery action. The scheduler owns prerequisites and concurrency, while the canvas presents their state. Step outputs carry typed handles for artifacts, plans or findings with bounded, display-safe projections.

After manual recipes are reliable, expose a curated step palette, versioned saved workflows and module/recipe reuse. Offer “skip this check for a draft run” only with a reason and visible coverage reduction. Keep resource deletion and deployment semantics explicit in their own actions. Configuration edits invalidate affected downstream evidence. Retry policy is operation-specific, and interrupted cloud operations require state reconciliation before a new attempt.

## Model and service design to resolve before engineering

### Resource authority and identity

Use one logical resource identity within an architecture across every view. Keep semantic content, presentation layout and execution evidence in distinct records linked to that identity. Architecture IDs scope the resource IDs. A run captures an immutable revision and adds operation records referencing those resources.

For linked Terraform, the source files remain authoritative. The graph is a projection of those files. For a design-first architecture, a versioned architecture document owns the semantic graph and generation creates reviewed Terraform artifacts. Record which authority applies on each architecture. Switching modes preserves that authority. A code edit is reconciled through the owning source model before the diagram shows it as saved.

Current parser IDs are generated for graph reads. Phase 0 must establish stability guarantees before persisting layout or history against them. Design-first resources need persistent IDs. Imported declarations need a service-owned mapping based on root, module/declaration identity and revision. Renames and ambiguous matches require explicit remapping or a visible unmatched state. Never attach an old finding to a new resource merely because a label matches.

Terraform declarations may expand into multiple instances through `count`, `for_each` and modules. Keep the declaration card separate from its plan-time instances and show coverage when expansion is unknown. A static diagram can display relationships whose values will only become known during planning or apply.

### Relationships and actions

Record visual grouping, resource references, explicit dependencies and typed field bindings separately. Label edge kinds and expose their provenance. Creating a typed binding must validate the target field and value type and produce a reviewable configuration change. A generic connector or frame drag carries presentation meaning.

The architecture graph and execution DAG have different responsibilities. Validation checks and Terraform operations reference architecture resources. The engine determines actual scheduling and blockers. Service-reported operation events drive execution animations. This preserves the brief's shared resource model while allowing several checks per resource and many plan instances per declaration.

### Drafts, writes and recovery

Use the Rust form and draft modules as the starting point for schema-backed edits and HCL previews. Pin each form to its provider schema release and coverage report. Preserve sensitive flags, nested-block constraints, deprecation and unsupported-field information. A small resource whitelist with verified round trips is the first authoring scope.

Design edits participate in Workbench dirty state, undo, redo, save, revert and crash recovery. Persist source and architecture changes through guarded Rust operations. A custom-editor adapter acknowledges save only after the service confirms the new revision. Backups need their own service-owned storage and per-document opaque handles. Validate cancellation and restore across all editor instances. The API lifecycle is documented in the [custom editor guide](https://code.visualstudio.com/api/extension-guides/custom-editors).

Linked-source edits require a reviewable patch, expected source revision and preservation of unrelated HCL. Multi-file operations need a transaction journal or equivalent crash-safe staging and recovery before being exposed. A repeated operation ID returns the original result or a safe conflict. Cancellation after a durable commit reports the committed state. External edits trigger conflict review.

### Execution and safety boundaries

Rust owns grants, source reads, managed processes, credentials, long-running checks and bounded event retention. Electron main routes by window and binds opaque handles to the service instance. The extension owns commands and view state. Webviews receive only bounded display-safe projections and send typed intents.

Extend the canonical Rust protocol with capability negotiation and fixtures for resource inspection, schema access, draft preview, guarded mutations, run control and history as each phase needs them. Keep method names and exact payload schemas in that repository. Account for the current single-request transport using quick run start, bounded cursor reads and cancellation. Reserve a push transport change for measured requirements.

**Validate Resource** runs supported checks and displays the prerequisite scope. **Create Plan** reviews the Terraform root with current input and backend context. HashiCorp documents routine resource targeting as inappropriate for normal operation, so the default resource action should filter or explain a full-root plan. Treat a specialised targeting recovery workflow as an additional capability. [Terraform planning](https://developer.hashicorp.com/terraform/cli/commands/plan)

Apply binds to the reviewed plan artifact, source/configuration revision, backend/workspace, engine/provider identities and credential scope. Recheck the context before execution. Saved plans and JSON can contain sensitive data, requiring local protected storage and service redaction before display. A cancelled apply needs reconciliation with real state, and a retry begins with a fresh assessment. [Saved plan handling](https://developer.hashicorp.com/terraform/tutorials/cli/plan)

## Prioritised feature decisions

| Feature from the brief or references | Recommendation | Delivery |
| --- | --- | --- |
| n8n-style resource workspace, dependencies and output inspection | Highest value for the requested experience | Phase 1, extended in Phase 2 |
| Visual Design and Technical Design modes on shared resources | Preserve the Brainboard/Miro visual experience alongside the n8n/Blender technical experience, with shared selection and mode-specific layouts | Phases 1–4 |
| Search by type, name and finding | Deliver structured filters first. Offer “High Cost” when cost evidence exists | Phase 1, extended in Phase 8 |
| Node status, blockers and scoped validation | Reuse the Runner design and show check coverage | Phase 3 |
| Schema-backed forms, reference picker and draft preview | Reuse catalogue modules with explicit schema coverage | Phase 2 |
| Copy, duplicate, delete and grouping | Support view operations early, semantic edits after guarded persistence. Duplicate with new IDs and prompt for unresolved references | Phases 1 and 4 |
| Context-menu AI actions | Introduce where a configured advisor can explain or propose a change with evidence | Phase 9 |
| Autosave, undo, redo and crash recovery | Required with the first editable architecture document | Phase 4 |
| Frames, layers, guides, snap and diagram exports | Build on persisted layout, with presentation-oriented exports | Phase 5 |
| Nested modules and reusable templates | Start with existing module inspection and a reviewed template. Extract-to-module requires source refactoring | Phase 6 |
| Thousands of nodes and hundreds of architectures | Add paging, background layout and service bounds together. Load only the active architecture and requested groups | Phases 1 and 6 |
| Pinned input and sample scenarios | Useful for repeated draft validation after evidence provenance is established | Phase 7 |
| Named checkpoints, compare and restore | Basic recovery with editing, semantic compare and named versions next | Phases 4 and 7 |
| Local experiments, promote and merge | Use detached document revisions or source copies with explicit origin. Define semantic conflicts before merge | Phase 7, after checkpoint reliability |
| Plan, apply, state updates, security and cost delta | Stage full-root planning before apply. Label coverage and estimates | Phase 8 |
| AI agents and recommendation overlays | Add advisor proposals first, then observable specialised agent runs | Phase 9 |
| Terraform, Bicep, ARM, CloudFormation, Kubernetes and documentation | Deliver Terraform and architecture reports first. Give each later generator its own mapping and conformance suite | Phase 9 follow-on |
| Playback, time travel and deployment heatmaps | Build on retained events and captured inputs. Use history navigation and reproducible evidence | Phase 9 follow-on |
| Automatic triggers, arbitrary scripts and broad connector catalogue | Assess after manual workflows prove useful and managed execution is established | Later product decision |

## Delivery sequence and engineering work packages

Each phase is an independently reviewable slice. Effort is relative, with M for a contained feature, L for a feature spanning the desktop and service, and XL for substantial execution, persistence or refactoring work. Calendar estimates require the integration assessment. A named integration owner coordinates the protocol, service pin and installed acceptance, with separate desktop and Rust worktrees for implementation.

### Phase 0 — Establish the integrated foundation · M

**Dependencies** — Existing Stage 2 branches and the project handoff.

- Complete the Terraform detection integration, reconcile duplicate detection helpers and run the installed Stage 2 acceptance journey. Record the exact desktop and Rust revisions that pass.
- Inventory reusable catalogue/domain logic, provider snapshots, current architecture formats and supported HCL coverage. Verify which modules can be linked into the standalone service without Tauri dependencies.
- Decide the architecture-document format, imported node identity strategy, metadata storage location and capability negotiation. Keep existing file formats readable and provide explicit unsupported-version errors.
- Define the representative direct root, multi-repository project, partial graph, nested module, sensitive-field and source-change fixtures. Select the first provider/resource set and name its ownership.

**Exit evidence** — One recorded working project/import baseline, an ownership table, approved data-authority decisions, and contract fixtures for Phase 1. Deliver implementation estimates against that baseline.

### Phase 1 — Read-only canvas and n8n-style resource inspection · L

**Dependencies** — Phase 0.

- Desktop owner adds an architecture editor webview in `extensions/cloudforge`, with locally bundled React Flow assets, theme integration, resource selection and a synchronised resource list.
- Implement single-click inspector, focused Open Resource journey, Back to Canvas, scoped search, fit-selection and keyboard navigation. Restore camera and selection after mode or tab changes.
- Rust owner supplies only additional display-safe metadata needed for dependency and finding inspection. Make current coverage and unresolved references visible.
- Deliver the two-mode switch with Visual Design icon diagrams and Technical Design engineering cards using available fields. Preserve a viewport per mode and shared selection. Include whole-graph and visible-graph status counts. Use collapsed groups and culling within the existing parser cap.
- Expose Open Source through the existing trusted navigation route. Preserve read-only imported source and show stale, partial, unavailable and missing-resource states.

**Exit evidence** — An engineer can inspect a root in both modes, switch with the same resource selected, open that resource, follow a dependency and return to the originating canvas position offline. Imported source bytes are preserved. Keyboard, light, dark and high-contrast journeys pass in the packaged desktop.

### Phase 2 — Schema-backed configuration and preview · L

**Dependencies** — Phase 1 and the catalogue compatibility assessment.

- Rust owner adapts provider snapshot lookup, coverage classification, form schema and draft rendering into scoped service capabilities. Review diagnostics and output fields for the desktop trust boundary.
- Desktop owner builds Parameters forms from the returned schema, with required fields, nested blocks, field-level help, reference chips, type checks and expression-aware read-only fallbacks.
- Define explicit draft identity and base revision. Render draft HCL in the Preview tab and provide a native HCL editor route for advanced work. Keep draft previews labelled until saved.
- Handle schema absent, provider release mismatch, unavailable option lists, sensitive values and stale previews. Select a small supported resource set and document unsupported cases.
- Bundle a small, versioned set of resource help and examples for offline use. Link to official provider documentation for deeper reference and show when local guidance or schema information is out of date.
- Add a typed reference picker. Resolve references where safe and represent unknown apply-time values without inventing output data.

**Exit evidence** — Covered resources produce the expected HCL and diagnostics from the existing renderer. Unsupported content survives inspection and mode changes. Draft editing leaves project source unchanged until the guarded save capability in Phase 4 is used.

### Phase 3 — Resource and architecture validation Runner · L

**Dependencies** — Phase 1 and the [Runner proposal](runner-view-design.md). Schema-specific checks additionally require Phase 2.

- Rust owner adds snapshot-bound validation jobs, check prerequisites, bounded events, cursor recovery, cancellation and per-scope lifecycle. Begin with parse, reference and cycle checks, then add verified schema checks.
- Desktop owner exposes Validate Resource and Validate Architecture. Show the analysed scope, check coverage, live statuses, Findings and a dockable timeline. Source links remain revision checked.
- Distinguish resource severity from run completion, incomplete coverage, cancellation and interruption. A failed prerequisite blocks only checks that depend on its output.
- Support rerun as a new attempt. Link it to the earlier run and captured revision. Keep independent validation branches useful after another branch fails.
- Render the fixed validation recipe as inspectable operation steps linked to resource nodes. Use the same Inputs, Parameters and Results pattern for a check step.

**Exit evidence** — Fixtures for success, warning, cycle, blocked checks, partial coverage, cursor gaps, duplicate events, cancellation, scope change and service exit produce truthful results. Hiding or reopening the canvas preserves the active run.

### Phase 4 — Guarded authoring, Terraform generation and recovery · XL

**Dependencies** — Phases 0–2. Validation coverage from Phase 3 supports change review.

- Rust owner adds versioned design-document loading, stable resource IDs and atomic save with expected revision. Create nodes, edit supported properties, create verified bindings and delete through domain operations.
- Desktop owner wires Workbench dirty state, undo/redo, save/revert and hot-exit recovery to confirmed service revisions. Exercise split editors against one document model.
- Verify switching modes during an unsaved edit. Add a resource in Visual Design, configure it in Technical Design, return to Visual Design, and undo/redo across those actions through the shared edit history.
- Support Add Resource, Duplicate, Copy/Paste, Delete and editable configuration for the covered types. Validate new identifiers and references before saving.
- Add Terraform generation from design-first documents with preview and reviewable file changes. Bind generation to document and provider-schema revisions.
- Add linked Terraform patching only for explicitly covered syntax. Preserve comments and unrelated blocks. Detect unsaved native-editor buffers and external source changes before committing.
- Create recovery checkpoints at semantic transactions, with named event reasons. Coalesce pointer moves into a single undoable layout change. Establish byte/count retention limits and recoverable cleanup.
- Exercise interrupted writes, duplicate requests and multi-file recovery. Keep generated artifacts consistent with the acknowledged graph revision.

**Exit evidence** — A supported network architecture can be created, configured, previewed, saved, reopened and recovered after a crash. Covered linked-source patches preserve unrelated content. Stale or concurrent edits open conflict review. Initial generation is reproducible for the same inputs.

### Phase 5 — Design organisation, layers and export · M/L

**Dependencies** — Phase 4 persistence. Temporary group inspection can ship in Phase 1.

- Add persisted frames/sections, multi-selection, alignment, guides, snap, annotations and layer visibility. Preserve view state per architecture and mode.
- Curate the provider-icon inventory with provenance and notices. Use provider assets within the existing Workbench theme and density system.
- Offer SVG and PNG export first, then PDF and architecture reports. Select architecture, frames or visible selection, and describe whether findings or layers are included.
- Verify text, fonts, icons, edge labels and clipping across export sizes. Render exported content from a captured revision and display its origin.

**Exit evidence** — A customer-facing section sequence exports consistently, hidden layers remain intentional, and moving a visual frame preserves resource semantics and validation results.

### Phase 6 — Modules, reusable patterns and enterprise scale · XL

**Dependencies** — Phases 1, 4 and 5.

- Add module drill-down with a breadcrumb back to the same parent selection. Show typed inputs, outputs and boundary diagnostics. Begin with existing Terraform module inspection and one versioned template.
- Define reusable module references separately from visual grouping. Deliver extract-to-module through a previewed source refactoring, including affected addresses and migration implications.
- Rust owner adds bounded graph pages, group summaries and stable revision/cursor semantics. Define filtering and search across unloaded groups.
- Desktop owner adds progressive expansion, visible-node detail levels, background layout and bounded UI caches. Keep selection and findings addressable when their nodes are unloaded.
- Index projects and architectures without loading all their graphs. Extend limits only against measured memory and latency evidence.

**Exit evidence** — Module boundaries retain identity and typed bindings. A project with hundreds of architecture entries opens one requested graph at a time. Target 5,000 nodes and 20,000 edges as the next negotiated service/UI milestone, with honest partial coverage until it passes.

### Phase 7 — Checkpoints, sample contexts and design experiments · L/XL

**Dependencies** — Phase 4 recovery and Phase 3 run evidence. Module-aware comparisons additionally depend on Phase 6.

- Add named checkpoints, semantic graph and source comparisons, and restore into a new revision. Keep a checkpoint of current work before restore.
- Add sample/captured input contexts for draft validation, with source revision, schema/rule versions, capture time and an obvious freshness indicator. Store only approved data fields.
- Add isolated experiments as design-document branches or detached source copies. Promotion previews a change against the current original revision. Resolve field, node deletion, reference and layout conflicts explicitly.
- Define experiment copy rules for approved source and layout. Exclude credentials, Terraform state and runtime caches from copies. A deployable experiment needs an explicit backend and environment binding so its isolation is clear before planning.
- Define retention, disk budgets, sensitive-data exclusions, corrupt-entry handling and cleanup. Preserve useful history without keeping a full copy for each drag event.

**Exit evidence** — An experiment can be compared and promoted without overwriting concurrent work. Captured contexts remain visibly identified through reruns and exports. Restoring architecture history changes local design/source according to review, with deployed infrastructure tracked separately.

### Phase 8 — Terraform planning, cost and deployment · XL

**Dependencies** — Phases 3 and 4, with Phase 7 retained evidence for deployment audit and recovery. Requires managed tool and credential capabilities.

- Rust owner manages supported engine/provider identities, backend/workspace context, credential references, process lifecycle and redacted structured events. Distinguish local static validation, tool validation, planning and apply.
- Deliver full-root Plan first. The selected-resource view filters its results and shows related changes, replacements, deletions and unknown values.
- Add optional cost and policy checks with provider/rule provenance, currency, region, pricing time and coverage. Show unknown costs and unavailable recommendations. Define the basis for cost delta.
- Bind approval to the exact plan and context, execute through Rust, and stream resource operations into the Runner and deployment review. Report partial apply and expose reconciliation after interruption.
- Extend the workflow view with generation review, planning, approval, apply and verification steps. Require a fresh approval whenever an upstream change invalidates the reviewed plan.
- Verify backend locking, changed inputs, stale plans, revoked credentials, child-process cleanup and replayed approval attempts. Give users an explicit recovery path.

**Exit evidence** — A disposable sandbox deployment has traceable plan-to-approval-to-apply evidence, realistic interruption recovery and no sensitive payload leakage. A source edit or context change invalidates prior approval. Process cancellation reports the observed outcome and next reconciliation action.

### Phase 9 — Advisors, reusable workflows and additional generators · XL, split into independent slices

**Dependencies** — The relevant configuration, run, history and managed-execution capabilities.

- Add contextual Explain Resource and recommendation actions with data-scope disclosure, evidence links and provider/schema provenance. Display proposed changes as drafts. User acceptance enters the existing validation and guarded-write flow.
- Add named Architecture, Security, Cost and Compliance agent runs only when their tasks and outputs can be tracked. Expose measurable progress and record unavailable ETA explicitly.
- Package reusable validation recipes such as Parse → Schema → Security → Cost → Review. Keep resource topology and check workflow visible through linked views. Expose trigger and approval behaviour explicitly before adding automation.
- Add Bicep, ARM, CloudFormation, Kubernetes and documentation adapters individually. Define supported semantic mappings, loss/coverage reporting, schema provenance and generator-specific fixtures.
- Add playback and heatmaps over retained run evidence. Bind every replay to its original inputs, captured graph and event schema. Label simulated playback separately from live operation status.

**Exit evidence** — Each advisor proposal, recipe or generator can be inspected and evaluated through the existing workspace. AI-produced changes carry their origin and require the same validation and write controls as manually authored changes.

## Frontend design review and acceptance plan

This is a review of the proposed interaction and the supplied examples. A rendered CloudForge implementation, Figma specification and interactive prototype are outside the evidence available in this planning task. The design direction is a focused, information-dense engineering workspace using CloudForge's existing Workbench typography, theme palette, icons and control patterns.

| Pillar | Assessment | Acceptance requirement |
| --- | --- | --- |
| Frictionless insight to action | The n8n three-pane pattern directly supports inspecting a selected resource and its result. Multiple stacked tab rows could obscure the main action. | Keep resource name, selected scope, Back to Canvas and one primary action visible. Test inspect → validate → finding → source with engineers. |
| Quality craft | Dense configuration is appropriate for this audience. The reference screenshot's many scroll regions and tooltip overlap need adaptation. | Collapsible side panes, independent scroll only where useful, visible labels, stable focus and a reflow path at narrow widths and increased zoom. |
| Trustworthy building | “Test,” output and green status can imply more coverage or live state than exists. | Name the actual action, display revision/coverage/data origin, and make field and service errors actionable. Distinguish draft, sample, planned and observed evidence throughout. |

| Priority | Design issue to address | Proposed treatment |
| --- | --- | --- |
| Blocking before editable delivery | Competing source and graph drafts could lose user edits. | One document owner, explicit authority/revision, a conflict state and shared undo/save semantics. |
| Blocking before deployment delivery | Node-level execution can imply that only one resource will change. | Full-root plan review with related changes, visible target context and an approval bound to the reviewed artifact. |
| Major | The n8n example shows a field left at “Loading options” with a separate error tooltip. | End loading when lookup fails. Keep a visible inline explanation, Retry and supported manual-entry/source routes. Preserve the current value. |
| Major | Three permanently open columns become cramped. | At narrower editor widths, collapse Inputs and Results into named tabs while retaining the resource header and primary action. |
| Major | Form-only editing may discard advanced HCL. | Preserve unsupported expressions and open their native source representation. Validate form/source transition with coverage fixtures. |
| Major | Continuous glow and animated edges compete with selected resource state. | Animate only active visible work, keep selection styling distinct and support reduced motion. |
| Minor | Too many summary fields or AI actions can crowd nodes. | Show a small configurable summary and place secondary actions behind intent or a labelled menu. |

Reuse the repository's Calm, Focused, Consistent and Delightful principles, theme-aware color roles and size ramps. Webviews must verify which tokens are supplied by the host and map any additional design tokens explicitly. Reuse native file editors, Quick Pick, menus, Problems and diff experiences through supported contributions. Initial visual QA covers dark, light and high contrast, keyboard-only operation, screen-reader labels, reduced motion and 200% zoom. Use the existing Workbench font settings and mono code font. [Design philosophy](../../.github/skills/design-philosophy/SKILL.md) · [Token guidance](../../.github/instructions/design-tokens.instructions.md)

## Verification and handoff requirements

Use the pinned Node and pnpm versions when implementation begins. Follow the repository's targeted validation guidance. Reuse existing unit tests and add regression cases for new state, revision, persistence and execution risks. Keep Rust and desktop toolchains independent.

For each implemented slice, record the desktop branch/revision, Rust branch/revision, protocol capability/version, changed files, exact checks, remaining gaps and next action. Product integration additionally records the service executable digest, extension inventory, installer checksum and installed Windows smoke. Preserve the identifiable upstream baseline.

Performance targets are proposals to measure on a declared Windows x64 machine. Within the current 1,200-node/6,000-edge limit, target first meaningful canvas within 2 seconds of graph receipt, p95 frame time under 32 ms during navigation, and p95 run-event-to-visible latency under 500 ms. Record memory usage and payload size. Measure culling overhead, worker layout and collapsed groups against real fixtures. New 5,000-node coverage requires service and UI acceptance together. React Flow culling controls visible rendering and incurs overhead. [Performance guidance](https://reactflow.dev/learn/advanced-use/performance) · [Viewport rendering option](https://reactflow.dev/api-reference/react-flow)

The next implementation assignment is Phase 0 followed by Phase 1. This gives users the n8n-style resource investigation loop and establishes the identity, source authority and view foundation needed by configuration and execution. The broader master specification is represented by the later work packages, each with its own dependencies and exit evidence.
