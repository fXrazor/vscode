# Infrastructure Studio preview

A standalone React Flow preview for the Code OSS CloudForge extension. This directory is excluded from extension packaging until the desktop webview integration is implemented.

Run from this directory with the repository-pinned Node and pnpm versions.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The development server prints an available loopback port. Verification commands are `corepack pnpm check`, `corepack pnpm test` and `corepack pnpm build`.

## Rendering contract

Architecture Design View renders cloud icons, labels, containers and design relationships. Infrastructure Configuration View renders inline configuration cards, the same container hierarchy, inherited dependencies, local configuration findings and an unavailable cost estimate. Both use `history.present` in `App.tsx`; inline inputs dispatch the same actions as `ResourceFields`. Moving or resizing an element preserves its position across both renderers. The retained two layout fields are synchronized at edit boundaries for adapter compatibility. Viewports remain independent; renderer and theme changes do not enter architecture history. See [NESTING-AND-FEEDBACK-PASS.md](NESTING-AND-FEEDBACK-PASS.md) for the latest checkpoint.

The shared resource form also appears in the focused resource workspace. Nested blocks derive from bundled curated definitions where available, with required prompts and typed fields; other entries retain imported primitive metadata. Advanced properties exposes optional additions. These are local catalogue checks, not complete version-matched provider validation. Code view projects Terraform through the supplied CloudLab generator: no selection shows main.tf; a selected resource shows its block. Existing representable field edits apply atomically; unsupported changes retain the draft and report an error. Module import records a reference only and does not fetch or execute code.

## Canvas-first rule

Persistent chrome must directly support the current workflow. The authoring layout keeps the resource library on the left, the canvas in the centre and the overview/resource/variables inspector on the right. Supporting panels can close to reclaim canvas space. There is no global bottom code dock; use Block view / Code view in the resource panel. Workspace identity, export and panel actions are in the compact header; grid, snap and minimap are in View. Minimap starts off. View also provides an independent Light/Dark theme selector. Changing the renderer preserves the selected theme. The default background is a faint line grid whose world-aligned spacing subdivides with zoom; Dots and None remain available. Theme and grid choices do not modify graph history. Mode choice, creation tools and zoom remain available for the active canvas task. The duplicated app headers and permanent status strip were removed. Whiteboard elements have a selection-only editing bar for text, size, bold, fill, duplicate and delete. Toolbar edits use the same graph history. Status messages remain available to assistive technology. This rule is also recorded in the repository root AGENTS.md for future CloudForge UI work.

## Export

Resource design connections have selection-only label, path, stroke and arrow controls. Connection edits share Undo/Redo and presentation export. These remain design links. Inherited dependencies are derived separately from the resource hierarchy and bundled inheritance rules; they generate typed Terraform references. Technical view hides design links by default and uses dotted dependencies, animating incident links only. View can reveal design links or all inherited dependencies without editing the graph. See [CANVAS-CONNECTIONS-PASS.md](CANVAS-CONNECTIONS-PASS.md) for the earlier connection pass.

Shapes, notes and text can also connect to each other and to resources. Use their left/right ports or the keyboard-accessible Connect elements tool. Moving/resizing follows stable endpoints; deleting a drawing removes its links in the same undo step. Frames remain visual containers. At narrow widths, Workspace actions holds the compact header controls. See [CANVAS-DESIGN-REFINEMENT.md](CANVAS-DESIGN-REFINEMENT.md) for the design review and coverage limits.

Workspace offers SVG, PNG and Print / Save PDF. Export projects the architecture presentation layout even while Configuration View is active. Provider icon bytes are embedded, so exported images have no external asset dependency. Chrome, selection highlights and configuration controls are excluded. PNG is capped at 8192 pixels on its longest side. PDF opens the browser print flow; the user chooses Save as PDF. This flow requires a permitted popup. Export currently uses a simple orthogonal connection projection and single-line labels; long labels and large multi-page layouts need further refinement.

## Boundaries

This is an in-memory sample preview. Reload resets edits. Rust persistence, workspace authorization, live provider schema lookup, Terraform/provider validation, pricing and deployment are not connected. Local findings cover bundled required/type/block rules, hierarchy and basic literal IPv4 CIDR checks; a clear indicator is not deployment readiness. All 4,078 catalogue entries retain primitive descriptors; complete nested/provider constraints are unavailable for many entries. Normal Code OSS source-editor integration remains future work.

Tabs, variable popovers, context menus and selection menus use Radix primitives; the focused workspace uses a native dialog. The full production shadcn/Radix migration remains pending.

## Verification recorded 2026-11-17

- TypeScript check, ten tests (eight reducer/history and two catalogue integrity/grouping cases) and standalone production build pass.
- Live browser verified an inline configuration rename appears in Architecture View, then Undo restores the original resource across the shared graph.
- SVG and PNG downloads completed. PNG inspected visually.
- Configuration renderer shows settings, dependency disclosures, local name status and unavailable cost.
- Browser console inspection returned no captured error entries.
- Print/PDF save, full keyboard audit, large-graph performance, all pane arrangements and production webview integration remain unverified.

The CloudLab Forge 3.0 source layout is adapted in cloudlab-layout.css and ArchitectureOverview.tsx. SOURCE-PROVENANCE.md records source ownership and boundaries. The contextual right-side editor uses the source Monaco/appearance components and a computed Terraform projection; it does not maintain another editable graph. The former bottom code dock is removed.

See [REFINEMENT-CHECKPOINT.md](REFINEMENT-CHECKPOINT.md) for the historical checkpoint and [AFFINE-ADAPTATION.md](AFFINE-ADAPTATION.md) for current coverage and remaining gaps.

## Refinement on 23 November 2026

See [AFFINE-ADAPTATION.md](AFFINE-ADAPTATION.md) for source evidence, current controls, variables and coverage. A searchable Shapes drawer now offers six editable vector shapes with shared geometry/stroke export. Resource code editing is contextual on the right; variable forms and declaration previews use the shared architecture model. Sensitive variable values are omitted from graph exports. The preview remains in memory and is not connected to Terraform execution or Rust persistence.
