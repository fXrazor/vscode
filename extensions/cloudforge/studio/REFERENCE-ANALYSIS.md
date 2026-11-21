# Reference interaction analysis

Observed in user-authorized live Brainboard, Miro and existing CloudLab Forge tabs on 2026-11-17. These notes describe visible controls and runtime layout measurements. They do not claim access to proprietary source, hidden state, service implementation or exhaustive feature parity.

| Workflow | Observed evidence | CloudForge application | Coverage gap |
| --- | --- | --- | --- |
| Project management | Brainboard top bar exposes project/environment/architecture breadcrumbs and history actions. | Keep identity and navigation in a compact Workspace disclosure; maintain graph edits when changing renderer. | Creation, sharing, permissions, persistence and project switching were not fully inspected and are not implemented in this sample. The environment selector is only a label. |
| Architecture workspace | Floating resource library, full-height right configurator and unobscured central canvas. Provider icons sit above labels; containers establish hierarchy. | Icon projection for presentation and configuration-card projection for engineering; optional library, inspector and code dock. | Production Workbench mounting remains open. |
| Resource configuration | Graphics, Metadata, Main parameters, Add blocks. Resource group exposes Lifecycle and Timeouts options. | One ResourceFields component in inspector and focused n8n-style workspace; nested groups and recursive sample block editors. | Full provider schema ingestion and lifecycle fidelity remain open. |
| Navigation | Breadcrumbs, provider/version controls, search and focus/fit controls. Existing CloudLab resource overview cards open forms. | Compact mode selector, searchable provider catalogue, overview cards and focused resource editing. | Provider version switching and production project routes are not connected. |
| Context menus | Miro selection toolbar exposes convert, styles, duplicate, delete and lock actions. | Reserve contextual editing actions for selection rather than adding permanent toolbars. | Full Brainboard context-menu contents were not captured; equivalent CloudForge context menus remain pending. |
| Property editing | Metadata/resource names, code expressions, references and nested blocks are separated into collapsible sections. | Shared immutable update actions back sidebar, focused form and inline configuration-node fields. | Expression type checking, references and service validation remain open. |
| Zoom and pan | Brainboard zoom/focus controls; Miro presets from 50% to 2000%, grid choices, snap toggle and optional minimap. | Pan tool, Space panning, zoom presets, fit, optional minimap and separate grid/snap controls. | Gesture parity, touch behaviour and broad accessibility sweep remain open. |
| Grouping | Nested cloud containers have corner labels and outline boundaries. | Shared frame membership; dragging a frame moves member resources as one undoable edit. | Selection-to-group, nesting rules and ungroup context actions remain pending. |
| Whiteboard | Miro tools include notes, text, shapes, pen and frames; frame formats include common paper, screen and slide sizes. | Free-floating note/text/shape/frame items share the architecture history. | Pen, frame presets, locking and rich text remain pending. |

## Flexible panes

Live Brainboard drag tests confirmed left minimum 346px and right minimum 440px, both up to 60vw in the observed desktop viewport. Resize grips were approximately 4px at pane edges. Resource tiles were 60px square with 8px gaps and wrapping; a default-width library fit five per row, while an approximately 516px pane fit seven. Source scrollbars were slim rather than absent. These observations motivate flexible CloudForge panes and adaptive wrapping; CloudForge need not reproduce pixel geometry where it reduces usable canvas space.

## Module import and code docking

Brainboard module import offers Registry, Git and Files inputs; no reference module was submitted. CloudForge's preview records a module reference and intentionally does not fetch or execute it. Existing CloudLab Forge code docking was verified in bottom and right arrangements; right docking hides the inspector, and returning to bottom restores it. The new preview offers bottom/left/right/closed draft JSON docking. Real Terraform editing should use normal Code OSS editor groups as well as an optional contextual dock.

## Priority

The current user direction is to preserve interaction principles rather than clone visual styling. The canvas-first rule in root AGENTS.md takes precedence over showing every discovered reference feature permanently. Cost and validation surfaces must identify their scope and unavailable data rather than fabricate values.

## CloudLab Forge 3.0 source port

The user supplied Z:/CloudLab Forge/CLOUDLAB FORGE 3.0. Read Designer.tsx, Catalog.tsx, Inspector.tsx, architecture-overview.tsx and forge.css. The REA skill explicitly routes complete source analysis through normal repository tools; no decompilation is needed. Source files were read without mutation. The preview now directly adapts its palette and scoped overview CSS plus header, pane and catalogue dimensions. ArchitectureOverview adapts the source markup to the existing shared graph; the source Project model and service operations were not imported.

The authoring workspace starts with library/overview/code dock open, with header controls to close them. This is the requested CloudLab-style layout while preserving the canvas-first ability to remove surfaces. Miro's selection toolbar principle is implemented for whiteboard items using React Flow NodeToolbar, with text/font size/bold/fill/duplicate/delete actions. It disappears with selection. No claim of complete CloudLab feature or pixel parity is made: sample catalogue, graph content, draft JSON editor and service wiring differ.
