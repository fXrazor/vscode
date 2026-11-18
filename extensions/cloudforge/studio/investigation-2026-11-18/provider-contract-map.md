# Provider, schema, hierarchy and Terraform contract map

Investigation date: 2026-11-18. This is read-only code archaeology and a proposed integration map. Browser observations belong to the primary investigation. Confirmed below means confirmed in source, not exercised in the deployed browser.

## Scope and skill application

The provider-resources skill applies to required/optional/computed/sensitive attributes, nested structures, resource/data-source distinctions and null/zero semantics. CloudForge is consuming provider definitions; adding a diagram node does not require writing a custom provider CRUD implementation. No provider or product source was changed.

## Feature-to-code correlation

Source root (S): Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web.
Preview root (P): C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio.
Each reference is an absolute path below.

| Feature / user annotations | Confirmed CloudLab source evidence | Preview state and gap | Priority |
| --- | --- | --- | --- |
| Provider/version selector (#16) | [Catalog.tsx](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Catalog.tsx:333>) commits the version constraint to Project.providerVersions. [model.ts](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:91>) stores the map. | [ResourceCatalogue.tsx](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/ResourceCatalogue.tsx:61>) displays a snapshot version span; its palette provider is local UI state. The architecture has no persisted provider requirements. | Critical |
| Runtime/provider settings (#12–13, #16) | [Inspector ProjectPanel](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Inspector.tsx:449>) edits Terraform/OpenTofu, required_version, provider constraints and provider defaults. [generate](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:226>) writes versions.tf. [importTerraform](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:505>) reads provider and runtime constraints back. | Preview [Architecture](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/model.ts:40>) has name/resources/items/connections only. Active palette filtering cannot stand in for authored architecture requirements. | Critical |
| Requirement persistence | [saveProject](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/storage.ts:211>) clones and writes the whole Project. [write](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/storage.ts:107>) serializes updates through service PUT /api/store or localStorage fallback. | Preview graph is memory-only. Runtime reload persistence of the reference requires observation. Production must preserve Rust/workspace authority rather than directly import the legacy browser storage layer. | Critical |
| Recursive forms / Add blocks (#23–27) | [AttrDef](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/catalog/types.ts:17>) carries required/default/options, refs, sensitivity, children/repeat and deprecation. [Field](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Fields.tsx:173>) routes scalar/list/map/block/ref/expression editors. [BlockField](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Fields.tsx:216>) recursively edits repeatable children. | [Importer](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/scripts/import-cloudlab-catalogue.py:60>) imports only non-computed string/number/bool fields. [ResourceFields](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/ResourceFields.tsx:58>) adds primitive properties; nested forms are separate handcrafted sample definitions. Catalogue breadth is not complete schema coverage. | Critical |
| Ref chips / dependencies (#17, #25) | [Ref / Expr / Value](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:13>) are tagged values. [Ref editor](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Fields.tsx:22>) uses typed candidates. [lines](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:548>) derives relationship and depends_on edges separately from explicit visual edges. | Preview [settings](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/model.ts:28>) are string records; [connections](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/model.ts:44>) are untyped design links. Styling a line must not imply Terraform dependency semantics. | Critical |
| Drop validity / inheritance (#18) | [canPlace](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:381>) checks cycles, subscription/provider restrictions, declared parent types, accepting ancestors and swap cases. [Canvas hover](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Canvas.tsx:253>) computes validity; [rendering](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/Canvas.tsx:449>) applies drop-ok/drop-bad. [applyInheritance](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:430>) creates/removes tagged inherited refs. | Preview frame membership moves grouped objects but has no provider-aware semantic reparenting. Reuse the algorithm as catalogue rule enforcement, not as authoritative proof of every cloud/provider constraint. Reparent + inheritance should be one undo transaction. | High |
| Module hierarchy (#18) | [ArchNode.module](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:72>) stores source/version/inputs. [canPlace](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:403>) permits modules under containers. [nodeBlock](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:158>) emits module blocks and version only for its registry-source heuristic. | Preview ModuleImport records references, not resolved module schemas. Visual parentId is not Terraform lexical module ownership. Source generation writes nodes into assigned root files; it does not create nested module directories just from visual nesting. | Critical distinction |
| Full-project code (#20–21) | [generate](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:206>) groups by node.file, sorting containers before descendants. [BottomPanel](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/BottomPanel.tsx:22>) shows generated files; [selection effect](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/BottomPanel.tsx:30>) switches to the selected node's file if no dirty draft. | [CodePanel](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/studio/src/CodePanel.tsx:15>) edits JSON despite its Monaco appearance. Main.tf is not inherently every resource: source supports file assignments. | High |
| Code/graph round trip | [applyNodeCode](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:725>) parses node HCL. [importTerraform](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:489>) parses full files and resolves refs. [BottomPanel apply](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/components/forge/BottomPanel.tsx:37>) imports merged drafts and commits the Project. | Preview applies only name/region/string settings with a stale-form guard. Parser coverage and preservation of unknown syntax/comments/expressions need fidelity testing before production reuse. | Critical |
| Source highlighting (#20–21) | BottomPanel changes files, but the inspected CodeEditor interface has no revealRange/decorateSelection method. Exact block highlighting there is not established. The Code OSS extension already routes resource-tree selection to trusted _cloudforge.openSource at [extension.ts](<C:/Users/dalep/.codex/worktrees/infrastructure-studio/CloudForge-Code/extensions/cloudforge/src/extension.ts:450>). | Preview has no Terraform source ranges or host selection bridge. Reuse fresh validated locations and revision checks, not regex matches of names in arbitrary code. | High |
| Backend/state settings (#12–13) | [terraform.ts](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/terraform.ts:326>) writes local backend.tf plus commented Azure/S3/GCS examples. Inspected ProjectPanel has runtime/provider/import settings, not the annotated Brainboard backend intent model. | No backend settings or state migration operation. A draft setting/file is not effective initialized backend state and must not trigger init/migration on select change. | Critical boundary |

## Semantic facts to preserve

- Source Value supports string, number, boolean, null, tagged ref, tagged expression, recursive arrays and objects ([model.ts:13](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:13>)). Preview string conversion loses meaning; false, zero, null, omitted and unknown must remain distinct.
- Resource/data/module/icon/shape/text are meaningful domain kinds ([model.ts:30](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:30>)). Data sources emit lookup blocks; icon-only nodes preserve configuration but leave code generation.
- Source coordinates are parent-relative, node.file is explicit, and provider aliases can be inherited from subscription frames ([model.ts:49](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:49>), [providerAlias:158](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/model.ts:158>)).
- Derived lines exclude hidden/inherited relationships from some visual paths; hiding a line is not necessarily deleting a ref.
- ResourceDef.generated explicitly describes documentation-inferred definitions ([types.ts:75](<Z:/CloudLab Forge/CLOUDLAB FORGE 3.0/apps/web/lib/catalog/types.ts:75>)). Those are not equivalent to an exact installed-provider machine schema.

## Production authority boundary, current source

The canonical [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:3) now records approved Stage 1 read-only graph and Stage 2 project contract work. This differs from the old checkpoint's handshake-only description, but does not authorize inventing additional methods.

- [Line 29](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:29): graph projection has compact IDs, safe fields, typed reference kind and validated source location. Raw module URLs, config literals and resource values are excluded.
- [Line 48](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md:48): provider schema import, writes, command execution and plans remain outside this contract.
- Trusted host navigation can use fresh validated source locations, context/revision checks and dirty-editor handling.
- Raw preview config/module fields cannot simply be added to readArchitecture. A reviewed schema/editing authority and redaction contract is required.

## Proposed data structures — not approved wire protocol

~~~ts
type ProviderRequirement = {
  sourceAddress: string;
  localName: string;
  versionConstraint: string;
  configurationAliases: string[];
  resolved?: { version: string; lockDigest: string; packageDigest?: string };
  schema?: {
    providerVersion: string;
    formatMajor: number;
    digest: string;
    provenance: 'provider-schema' | 'reviewed-catalogue' | 'doc-inferred';
  };
};
type ValueIntent =
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'null' }
  | { kind: 'unknown'; typeHint?: string }
  | { kind: 'reference'; targetNodeId: string; attributePath: string[] }
  | { kind: 'expression'; language: 'hcl'; text: string }
  | { kind: 'list' | 'set'; items: { id: string; value: ValueIntent }[] }
  | { kind: 'map' | 'object'; entries: Record<string, ValueIntent> };
// Missing attribute key means omitted.
type BlockInstance = {
  id: string;
  schemaPath: string[];
  labels: string[];
  attributes: Record<string, ValueIntent>;
  blocks: BlockInstance[];
};
type CodeSelection = {
  workspaceId: string;
  architectureId: string;
  sourceRevision: string;
  nodeId: string;
};
type BackendIntent = {
  type: 'local' | 'azurerm' | 's3' | 'gcs' | 'remote';
  nonSecretConfig: Record<string, ValueIntent>;
  credentialReferenceId?: string;
};
~~~

Descriptors also need required/optional/computed/sensitive, collection element types, block nesting mode/min/max, deprecation and schema identity. Provider resource schema version is distinct from provider package release version. Schema JSON alone does not prove every runtime/API validator. Module scope must be explicit and separate from a visual frame.

## Proposed integration map

| UI action | UI/domain recommendation | Host/Rust integration |
| --- | --- | --- |
| Pick palette provider | Filter library only; no graph/history mutation. | Read a version-identified approved catalogue snapshot. |
| Change provider requirement | Expected-revision domain command and schema-compatibility review. | Reviewed persistence/model extension; actual lock metadata supplies resolved version. |
| Change typed property/add block | Stable IDs and typed intent through shared form in both renderers. | Exact selected schema/reference checks; code generation/write only under reviewed editing authority. |
| Drag into container | View-only hover decision and rejection reason; atomic final reparent/inheritance. | Authoritative domain check if service owns edits. |
| Select card/node/code | One selection atom with origin to avoid feedback loops. | Existing trusted source navigation for read-only graphs; fresh range/revision. |
| Switch whole-project code | Preserve file drafts independently of renderer. | Native Code OSS editors preferred; parse fidelity and stale revisions checked. |
| Change backend setting | Draft intent and reviewed code diff. | Separate explicit init/reconfigure/migration workflow. No execution on setting change. |

## Priorities

1. Critical: authored provider requirements, separate lock/schema/catalogue identities, reviewed config editing authority.
2. Critical: typed values and semantic reference edges; null/omitted/unknown and round-trip fidelity.
3. High: recursive schema forms with stable block IDs, cardinality, list/set/map semantics.
4. High: provider-aware placement and inheritance; explicit module ownership.
5. High: source selection/highlight through validated ranges.
6. High: architecture runtime/provider/file settings, then a separately scoped backend-intent workflow.
7. Medium: selected dashed styling, richer cards and breadcrumbs on top of correct semantics.

## Current primary documentation

Fetched through Context7 after resolve Terraform, with separate version/backend/schema queries:

- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements): constraints specify compatibility.
- [Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock): chosen version, constraints and hashes differ; preserve an actual lock file, not a fabricated one from a selector.
- [Provider schema command](https://developer.hashicorp.com/terraform/cli/commands/providers/schema): versioned machine schema; reject unsupported format majors.
- [Backend configuration](https://developer.hashicorp.com/terraform/language/backend): credentials can leak into local/backend/plan artifacts if embedded; use appropriate credential/environment channels.
- [Init](https://developer.hashicorp.com/terraform/cli/commands/init): reconfigure and migrate-state differ, and migration may require confirmation.

## Unknowns requiring browser evidence

- Does the deployed CloudLab build persist version edits through reload as source predicts?
- Is Brainboard's shown version an authored constraint, resolved binary or schema snapshot?
- Do reference chip forms preserve null/unknown/omitted distinctions?
- Do red/green drop highlights indicate provider legality, module scope, geometry or several?
- Is node/code selection bidirectional and range-accurate after edits?
- Which state-lock, backend migration and collaborative conflict APIs actually run? UI alone cannot answer this.
