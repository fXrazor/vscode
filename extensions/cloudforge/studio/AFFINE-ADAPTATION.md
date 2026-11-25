# AFFiNE and Brainboard refinement — 23 November 2026

This pass uses the supplied source at `Z:/CloudLab Forge/AFFiNE`, revision `dc2b2212441602452f3cf0ea50a4eaedaf03bcc2`, read only. REA's source-repository route calls for ordinary source inspection here; no binary decompilation or private runtime reconstruction is needed. No AFFiNE packages, assets, backend, Lit renderer or Yjs document store were copied into CloudForge.

## Confirmed source → adaptation

| Source evidence | Decision / implementation |
| --- | --- |
| [ShapeProps and ShapeElementModel](<Z:/CloudLab Forge/AFFiNE/blocksuite/affine/model/src/elements/shape/shape.ts:35>) separate geometry, fill, stroke, text and bounds; use Y.Text for text. | Keep original SVG geometry and appearance in CloudForge BoardItem. Add shape ID, border colour, weight and dash style. Do not introduce another editable graph or a Yjs store. |
| [shapeToolbarConfig](<Z:/CloudLab Forge/AFFiNE/blocksuite/affine/gfx/shape/src/toolbar/config.ts:48>) uses selection-specific actions and a shape-type menu. | Shape selector and border controls appear only for selected shapes. Six normalized original paths are shared by canvas and presentation export. |
| [captureSync and colour gesture handling](<Z:/CloudLab Forge/AFFiNE/blocksuite/affine/gfx/shape/src/toolbar/config.ts:171>) distinguish gesture start/end and property updates. | Resize position and bounds commit together in one history action. No-op size updates do not consume history. Continuous colour/text gesture coalescing is still a follow-up. |
| [EdgelessToolbarWidget](<Z:/CloudLab Forge/AFFiNE/blocksuite/affine/widgets/edgeless-toolbar/src/edgeless-toolbar.ts:47>) has quick/secondary tools, safe-area sizing and optional hide/reveal. | Keep the current contextual toolbar and resource library; a temporary Shapes drawer replaces library content and Escape/back restores focus. Do not relocate CloudForge's whole layout to AFFiNE's bottom toolbar. |
| [GfxSelectionManager](<Z:/CloudLab Forge/AFFiNE/blocksuite/framework/std/src/gfx/selection.ts:21>) distinguishes selected IDs, editing state and remote selection. | Preserve presentation-only selection. Multi-selection, explicit text-editing mode, remote presence and rotation are future work; this pass does not claim AFFiNE parity. |
| [Shape geometry methods](<Z:/CloudLab Forge/AFFiNE/blocksuite/affine/model/src/elements/shape/shape.ts:75>) distinguish hit tests, intersections and attachment points. | Current shapes are editable/resizable drawings. Shape-to-shape connectors, precise geometric hit testing and ports need their own implementation; provider reference edges are unchanged. |

AFFiNE's [licence](<Z:/CloudLab Forge/AFFiNE/LICENSE>) distinguishes backend/native and third-party terms from the other source. This pass adapts interaction principles in original code and bundles none of that source. Any future file/asset reuse must retain its applicable notices and provenance.

## Brainboard layout and variables

The user's latest correction supersedes the earlier request for left-side details: **library left, canvas centre, resource/variables panel right**. The global bottom code dock, its topbar toggle, positioning menu and resize component were removed. A compact Block view / Code view switch and Local name issues control replace the old nested Form/Code/Draft/Checks tab arrangement. Code view now shows the supplied CloudLab generator's Terraform projection: main.tf without selection, one resource block with selection. Monaco mounts only while code is visible; per-scope drafts survive returning to the block form. Unsupported changes retain the draft. Returning to Block view without selection restores the architecture cards.

Live Brainboard inspection opened a blank variable form and its advanced type editor, then closed it without saving. Confirmed fields: Name, Scope (Architecture), Description, basic/advanced Type, Default value, Value, Sensitive, validation condition/error, and Create more. The supplied screenshots additionally show variable cards, scope chips and masked sensitive values. No variable, infrastructure configuration, plan or deployment was submitted to Brainboard.

CloudLab's [Terraform generator](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:275>) distinguishes project/generated declarations and values, with sensitive-input handling at [line 114](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:114>). The preview now adds:

- Architecture-owned variable definitions with type, description, optional default and separate assigned value, sensitivity and shared Undo/Redo.
- Searchable right-side cards, create/edit forms, explicit required-input state and a read-only `variables.tf` declaration preview.
- String/number/bool/list(string)/map(string)/any input validation. Empty string, zero, false, null and absence remain distinct.
- Conservative discovery of `var.name` text in resource region/settings/nested blocks; missing declarations are added as `any` and require type review. Discovery is not a Terraform parser or proof of reference validity.
- Rename/delete guards for referenced variables. Sensitive defaults/values are masked and omitted from Graph JSON export and declaration previews; the in-memory draft is not a secret store.
- Reviewed local .tf/.tfvars import with explicit conflict override. Literal imports preserve declaration defaults separately from assigned values; unsupported expressions, validation and structural types are rejected.
- Name and last-updated sorting in either direction, local sensitive/required/referenced filters, and explicit Copy reference actions. These local filters adapt useful principles; they do not reproduce Brainboard's unverified user/scope filter backend.

Later live inspection confirmed Brainboard's four sorting choices and its .tf/.tfvars import dialog with override control. The dialog was closed without uploading or importing anything. The preview uses an additional review step before its single undoable import action. See SOURCE-PROVENANCE.md and CLOUDLAB-CORE-PROVENANCE.json for the eight unchanged CloudLab generator/parser/catalogue files used here. The temporary generator input is computed, never another editable architecture store.

Terraform documentation was checked through Context7: [variable declarations](https://developer.hashicorp.com/terraform/language/block/variable). A missing default means required input; null and sensitivity have distinct semantics. Validation expressions are evaluated by Terraform, not by this preview. Advanced structural type editing, validation rules, environment/project inheritance, AST-based discovery, tfvars generation, native source round-trip and Rust persistence are still pending. Assigned values here do not change deployed infrastructure or get written into a tfvars file.

## Verification and remaining coverage

TypeScript, 22 tests and standalone production build pass. Tests cover catalogue integrity, shared history, atomic shape resize, geometry/stroke export, variable types/defaults, reference guards, batch discovery, literal HCL import, scoped Terraform apply, rejection of unsupported edits and sensitive-value redaction. These checks do not verify an installed desktop or Terraform execution.

Browser evidence obtained in this pass: shape search/add/type change, cross-mode theme preservation, drawer Escape focus restoration, pointer top-left resize through scoped CDP and one-step Undo/Redo, right-side resource form placement, removal of global code controls, variable bool=false creation and Undo/Redo/declaration view, and keyboard right-panel resizing. After the embedded browser transport disconnected, a separate Playwright session verified whole-architecture versus selected-resource Terraform, physical-name edit/apply and Undo, reviewed two-variable import including bool=false, descending sorting, copy-reference feedback, dashed shape borders and toolbar containment. No captured preview console error entries were found. Final evidence is recorded in VERIFICATION-2026-11-23.json. The older JSON-editor browser check is superseded by the Terraform check.

## Next resource-constraint pass requested by the user

The latest annotated CloudLab VM inspector is a positive reference: required fields, inherited resource group/location with provenance, schema-constrained dependency pickers, nested required blocks and canvas dependency updates. Implement these after the current jobs, using the existing backend investments. Inspect the source Fields/model/reference-resolution flow before choosing a contract; the preview's string settings and visual connections cannot honestly provide those semantics. Use the same resource form in both renderers and the focused workspace; keep it on the right. No constraint/reference parity is claimed in this checkpoint.

Still pending: shape tile drag/drop end-to-end, complete keyboard/contrast audit, very narrow layouts, full PDF fidelity, richer inline text editing, grouped/multi-node manipulation, connector editing and production schema/service integration. The earlier preview checkpoint and research remain useful, but their bottom-docking instructions are historical and must not be restored.
