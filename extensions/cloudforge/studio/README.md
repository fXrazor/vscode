# Infrastructure Studio preview

A standalone React Flow preview for the Code OSS CloudForge extension. This directory is excluded from extension packaging until the desktop webview integration is implemented.

Run from this directory with the repository-pinned Node and pnpm versions.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The development server prints an available loopback port. Verification commands are `corepack pnpm check`, `corepack pnpm test` and `corepack pnpm build`.

## Rendering contract

Architecture Design View renders cloud icons, labels, groups and design relationships. Infrastructure Configuration View renders configuration cards with inline name/settings editors, expandable incoming relationships, local name-check findings and a clearly unavailable cost estimate. Both views use `history.present` in `App.tsx`. `ResourceNode.tsx` projects the same resource objects; inline inputs dispatch the same update actions as `ResourceFields`. Switching renderers does not dispatch an architecture edit or reset history. Per-view positions and viewport are presentation metadata, not copies of resources or configuration.

The shared resource form also appears in the focused resource workspace. Provider-specific nested block definitions are sample definitions. The code dock edits draft JSON, not Terraform. Module import records a reference only and does not fetch or execute code.

## Canvas-first rule

Persistent chrome must directly support the current workflow. The CloudLab-style authoring layout opens with resource library, overview inspector and bottom code dock. Each can be closed from the compact header to reclaim canvas space. Workspace identity, export and panel actions are in the compact header; grid, snap and minimap are in View. Minimap starts off. View also provides an independent Light/Dark theme selector. Changing the renderer preserves the selected theme. The default background is a faint line grid whose world-aligned spacing subdivides with zoom; Dots and None remain available. Theme and grid choices do not modify graph history. Mode choice, creation tools and zoom remain available for the active canvas task. The duplicated app headers and permanent status strip were removed. Whiteboard elements have a selection-only editing bar for text, size, bold, fill, duplicate and delete. Toolbar edits use the same graph history. Status messages remain available to assistive technology. This rule is also recorded in the repository root AGENTS.md for future CloudForge UI work.

## Export

Workspace offers SVG, PNG and Print / Save PDF. Export projects the architecture presentation layout even while Configuration View is active. Provider icon bytes are embedded, so exported images have no external asset dependency. Chrome, selection highlights and configuration controls are excluded. PNG is capped at 8192 pixels on its longest side. PDF opens the browser print flow; the user chooses Save as PDF. This flow requires a permitted popup. Export currently uses a simple orthogonal connection projection and single-line labels; long labels and large multi-page layouts need further refinement.

## Boundaries

This is an in-memory sample preview. Reload resets edits. No Rust service, workspace authorization, live provider schema lookup, Terraform validation, pricing service or deployment operation is connected. Bundled CloudLab catalogue snapshots supply metadata and primitive form properties. A passing node indicator means only the local draft-name check passed. Relationship labels describe design links, not verified Terraform references. Cost is explicitly Not estimated. Normal Code OSS editors and production docking remain future integration work.

Catalogue and code-panel tabs now use Radix Tabs. Dialogs and other menu surfaces still use native controls; the full shadcn/Radix migration is pending. Do not report the production shadcn/Radix migration as complete.

## Verification recorded 2026-11-17

- TypeScript check, ten tests (eight reducer/history and two catalogue integrity/grouping cases) and standalone production build pass.
- Live browser verified an inline configuration rename appears in Architecture View, then Undo restores the original resource across the shared graph.
- SVG and PNG downloads completed. PNG inspected visually.
- Configuration renderer shows settings, dependency disclosures, local name status and unavailable cost.
- Browser console inspection returned no captured error entries.
- Print/PDF save, full keyboard audit, large-graph performance, all pane arrangements and production webview integration remain unverified.

The CloudLab Forge 3.0 source layout is adapted in cloudlab-layout.css and ArchitectureOverview.tsx. SOURCE-PROVENANCE.md records the source path, file ownership and boundaries. The code dock ports the source Monaco/appearance components but edits draft JSON; Terraform generation/import is not ported.

Paused at the user request. See [REFINEMENT-CHECKPOINT.md](REFINEMENT-CHECKPOINT.md) for the exact continuation plan, verification coverage and known gaps.
