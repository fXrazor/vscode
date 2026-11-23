# Resource forms and constraints — 23 November 2026

This pass implements the user's requirement that Azure, AWS and Google Cloud resources have a visual representation, editable properties, constraints and advanced additions. It extends the standalone preview, not the installed desktop or Rust service.

## Evidence and confidence

- **Confirmed source:** `Z:/CLOUDLAB FORGE 3.0/apps/web/components/forge/Fields.tsx:216` normalizes singleton/repeated blocks; `:220` copies only explicit scalar defaults; `:235` controls Add; `:259` recursively renders child attributes; `:265` reports absent required blocks. `:21` and `:56` use typed reference pickers; inheritance has explicit provenance at `:30`. These are CloudLab source facts, not Brainboard implementation facts.
- **Historical Brainboard evidence:** supplied annotations show Graphics/Metadata/Main parameters, nested editing, Add blocks and linked reference styling. `Z:/CLOUDLAB FORGE 3.0/docs/brainboard-research/resource-property-editor.md:3` limits earlier direct evidence; `:25` separates local implementation targets from observations.
- **Unresolved fresh runtime inspection:** the embedded browser transport closed on two safe connection attempts. The URL also could not be read through web retrieval. No new Brainboard runtime, traffic, storage or internal React claims were made, and no REA Evidence IDs were generated. No new API-origin or backend claims are supported. Resume live inspection after reconnecting the embedded browser; do not repeat setup or invent a CDP endpoint.

## Implemented

- The shared form preserves imported primitive properties for all **4,078 bundled resource entries**: Azure 1,110, AWS 1,763, Google Cloud 1,205. Existing visual icon/name representation is retained.
- `editableFields` combines curated descriptors with imported primitive descriptors. Required missing properties remain visible. `Advanced properties` exposes optional arguments with their type and adds them through the existing canonical resource update.
- `blockDefinitions` derives recursive blocks from bundled AttrDef metadata: required flag, description, scalar defaults, children and singleton/repeatable cardinality. It never invents provider maxima where the metadata only says repeatable.
- `SchemaField` renders types, descriptions, required state, permitted option choices and local shape errors. False, zero and absence remain distinct. Unknown existing block types/values remain editable and are not silently dropped.
- Nested sections use a single vertical guide, open/close chevrons, instance numbering, field/review counts and missing-required prompts. The same ResourceFields component serves both renderers and the focused resource workspace.
- `resourceFormIssues` derives node warning indicators from current field/block values. It is computed from the same resource, without a second editable configuration store. Terraform validation and design-link semantics remain separate.

## Verification

TypeScript, production preview build and 27 tests pass, including an exhaustive descriptor-coverage check over all bundled entries and recursive required/default/cardinality cases. Browser verified: VM required OS disk prompt; defaults ReadWrite/Standard_LRS; caching edit and Undo; optional authentication property; node issue count 5 → 4 after adding OS disk; inline label alignment; light/dark appearance. Captured console contains only React development information. Local screenshots are `output/playwright/schema-vm-refined-light.png` and `output/playwright/schema-vm-refined-dark.png`.

## Coverage limits and next work

This does **not** yet satisfy complete provider constraint coverage. The snapshots are not full version-matched provider schemas. Most entries have primitive descriptors only; curated entries add richer blocks. Unknown nested blocks, computed/read-only attributes, mutually exclusive/exactly-one fields, replacement/plan modifiers, provider validation, real inheritance, typed reference pickers and semantic dependency updates require fuller schema/domain integration. The source versions also differ from the snapshot versions; curated metadata must not be presented as certification for the selected version.

Next: inventory available provider schema artifacts and the approved Rust FormSchema contract, preserve exact provider/version identity, import complete available schema metadata, and surface read-only/computed versus editable fields. Then introduce stable-ID references and inherited values with provenance into the canonical model, connect form changes to Terraform expressions and semantic canvas edges, and verify rename/delete/Undo across both renderers. Do not manufacture references from visual design lines or duplicate the architecture model.
