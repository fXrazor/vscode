# Canvas design refinement — 24 November 2026

## Direction before implementation

Software workspace for cloud architects. Primary task: explain an architecture using connected cloud resources and editable drawings. Preserve the approved left library / central canvas / right resource form, with one graph and history. This is a narrow Operate-surface refinement, not a marketing-page redesign.

Use existing tokens: light surface #ffffff, dark surface #242632, text #24283d / #f3f1fa, border #dfe2ec, approved accent #714eff. Mona Sans handles interface text; the existing code font stays limited to source/data. Preserve the user's pinned palette rather than applying a skill's generic palette ban. The memorable content remains the architecture and official provider icons.

Layout: `[library] [creation tools | connected diagram | contextual controls] [resource form]`. Keep controls left aligned and use the existing connection editor. Add a short-lived connection creation form for keyboard users; no extra persistent panel. Drawing ports appear on hover, selection and keyboard focus. Use brief labels and native controls, clear disabled reasons, Escape dismissal and focus restoration.

Review against brief: a hero, photos, decorative animation or newly dealt palette would consume canvas space and break the established product. Apply the supplied frontend-design, design-taste and frontend-design-review principles to interaction feedback, hierarchy, consistency and keyboard access. Their marketing-screen recipes are outside this workspace's scope. No Figma/Storybook specification was supplied; review against committed components and both rendered themes, without claiming Figma compliance or a marketing gate pass.

## Scope

Allow visual connections between resources and non-frame drawings by stable ID. Follow endpoints on move/resize. Deleting a drawing removes its visual connections atomically. Provide keyboard creation with labelled source/target selectors; reuse contextual appearance editing and export geometry. Provider dependencies, visual frame membership and visual connectors remain distinct.

## Evidence ledger

- **Confirmed live Brainboard UI:** the General drawing drawer replaces the resource palette and offers Arrow, Line and Text. Only the drawer was opened; no reference drawings or configurations were created. This confirms progressive disclosure of drawing tools, not its private rendering or persistence model.
- **Confirmed AFFiNE source:** `model/src/elements/connector/connector.ts:44–55` defines element IDs and relative/free positions; `blocks/surface/src/surface-model.ts:43` maintains an endpoint connector index; `blocks/surface/src/extensions/crud-extension.ts:39–62` cascades deletion to attached connectors; `gfx/connector/src/connector-watcher.ts:54–76` reacts to element bounds changes. Paths are relative to `Z:/CloudLab Forge/AFFiNE/blocksuite/affine`. The checkout is read only. The independent source review corroborated these paths; no AFFiNE code/assets were copied.
- **Implementation choice:** CloudForge uses fixed left/right React Flow handles and stable IDs in its existing connection array. Precise shape intersections, free endpoints, rotation and AFFiNE-style indexed adjacency are not claimed. Context7 supplied current Handle / isValidConnection documentation (`/websites/reactflow_dev`) and the pinned package passed TypeScript.
- **Unknown:** Brainboard internal models, transport, private source and collaboration behaviour. No REA runtime evidence bundle or API capture was obtained; browser observations and source facts remain separate.

## Implemented and reviewed

`designConnections.ts` defines connectable resources, shapes, notes and text; frames, self-links, duplicates and missing endpoints are rejected. `ConnectionCreate` provides labelled native selectors and disables existing destinations. It opens with the selected element as source, suppresses the competing shape edit bar, and restores focus to the launcher on Escape/close. Shape/note/text ports reveal on hover/selection/focus. Current node bounds drive live endpoint movement; export resolves drawing bounds using the same stable IDs. The existing canonical reducer deletes an item and its attached connections in one history action.

The focused resource workspace now lists incoming drawing links alongside resources. Technical cards say incoming design links, avoiding a provider-dependency claim. Full Terraform constraints and inheritance remain open.

### Review findings

| Pillar | Finding | Resolution |
| --- | --- | --- |
| Frictionless | Drawing links required precision dragging with no keyboard creation path. | Source/target selectors plus Add connection; no extra permanent sidebar. |
| Craft — major | Shape toolbar remained behind the connection creation form. | Clear node selection on opening; keep the initial source separately as presentation state. Browser verified zero competing edit bars. |
| Craft — major | Desktop header overflowed at 390px. | Secondary workspace actions collapse into one native menu below 580px; architecture identity remains visible. |
| Trustworthy | Drawings could be mistaken for provider dependencies in technical summaries. | Label them as design links; preserve explicit no-Terraform-dependency copy and unchanged Terraform projection. |
| Open | Full multi-selection/group editing and precise attachment geometry. | Deferred; this increment implements attached drawing connectors, not grouped manipulation. |

## Verification

TypeScript, 31 tests and production preview build pass. Added tests verify drawing/resource connection eligibility, stable attachment after movement/resize, cascade deletion with one-step Undo and escaped SVG connector labels. Existing full catalogue and Terraform tests remain passing.

Live preview checks: created a note and shape; connected them through the keyboard-accessible form; linked a resource to the note; moved the shape and observed its attached path; deleted/restored the shape and link (rendered links 6 → 5 → 6); verified source autofocus, no competing shape edit toolbar and Escape focus restoration. Light/dark screenshots reviewed. After collapsing panels via the compact menu, document scrollWidth equals viewport width at 390, 320, 768 and 1024px. The temporary viewport override was reset. Captured preview console errors: none.

Screenshots: `output/playwright/drawing-links-light.jpg`, `drawing-links-dark.jpg`, `drawing-connect-mobile.jpg`. These are ignored local evidence, not shipped assets. The marketing-site taste gate was not run or reported as passed: its hero/section/dealt-moment requirements conflict with the user's explicit canvas-first workspace rule. Applicable design principles and direct browser reflow checks were used; no Figma/Storybook or full accessibility certification is claimed.
