# Infrastructure nesting pass — 25 November 2026

User-authorized continuation of the node-details checkpoint and eleven new annotations. The product remains the existing standalone React Flow preview; no Rust/service/installer changes.

## Design and implementation decisions

- Use one canonical resource parent ID and bundled `ResourceDef.container`, `parents` and `inherit` metadata. Do not infer cloud containment from drawing rectangles. Reject cycles, cross-provider nesting and known invalid placements. When a deeper target is invalid but its ancestor accepts the resource, identify that actual parent in the drop feedback.
- Keep graph coordinates absolute in the model and project parent-relative coordinates for React Flow. Container resize and child movement use one semantic transaction, with descendant movement applied once. A valid drop changes placement and parent together; invalid drops restore the previous placement. Detach preserves coordinates and restores inactive literals. Keyboard users get an equivalent Parent container control.
- New user steering supersedes earlier independent-layout behaviour: moving a resource/drawing updates both renderer positions. Viewports, theme, selection and panel layout remain independent presentation state. Larger technical cards are accommodated by shared container geometry rather than a second architecture.
- Derive inherited resource references from stable parent IDs and the existing schema rules; generate typed `$ref` values for the retained Terraform generator. Keep stored literals for explicit overrides/detach. Expose inheritance provenance, reveal-source and override/restore controls in the shared form. Nested inheritance must not create incomplete blocks silently; report unavailable paths honestly.
- Separate actual inherited dependencies from freeform design links. Technical view uses subtle dotted dependencies, animating incident links on selection only, and respects reduced motion. Design links remain optional and explicitly labelled as design links.
- Aggregate local schema/name/network/hierarchy findings into actionable errors and warnings. Label checks as local; never imply `terraform validate` ran. Link a finding to its resource and field. Keep learning help contextual, keyboard accessible and based on bundled descriptions.
- Add active/open states to panel controls and accessible expanded/controls relationships. Keep inspector chrome fixed; only its content scrolls.
- Extend original SVG geometry with useful flowchart stencils and an editable deployment-decision template. Reuse drawing text, resize, connection, formatting, history and export code. No third-party stencil artwork or separate diagram state.

## Evidence

Confirmed in live CloudLab: nested DOM containers for Resource group → Virtual network → Subnet; inherited resource-group name/location chips in the VM form; active panel buttons; actionable local network warnings. Existing user data was not edited. Supporting source: `Z:/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts` (`canPlace`, `applyInheritance`, `fitContainers`, `reparent`), `Canvas.tsx` (`finishMove`, `drop-ok/drop-bad`), `validation.ts` (local severity model), and the unchanged copied catalogue contracts under `src/cloudlab-core/catalog`.

Confirmed in live Miro: Diagramming shapes separates Basic Shapes, Flowchart and Connectors; shape selection exposes its contextual editing toolbar. Opened/closed the library without adding or changing board content. Use these interaction principles, not a claim of complete feature parity.

React Flow Context7 documentation confirms v13 parent-relative `parentId` projections and dynamic attachment/detachment. The canonical model continues to own committed hierarchy; the React Flow store owns transient dragging.

## Validation plan

Test all three providers' known placement rules, cycle/provider rejection, inherited expression generation/rename/detach/override, synchronized moves, subtree movement/duplicate/delete/Undo, actionable errors/warnings and flowchart/export integrity. Browser-test valid and invalid drops, keyboard parent selection, both renderers/themes, panel states, reduced-motion styles, focused Terraform Apply/draft retention, and exports. Save a new checkpoint if the user pauses; preserve prior uncommitted work.
