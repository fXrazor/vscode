# Provider forms: merge checkpoint and evidence — 26 November 2026

This supports the [single Studio continuation](../STUDIO-CONTINUATION-2026-11-25.md). Dale requested merging the current checkpoint and handing off the remaining work for later. No new feature work should be inferred from this checkpoint.

## Current implementation

The catalogue now comes from captured, signed provider schemas rather than documentation filenames. It contains **4,271 actual resources**: AzureRM **1,109 at 5.14.0**, AWS **1,766 at 6.73.0**, and Google **1,396 at 8.10.0**. The original **4,078 documentation entries** were all audited and retained in the provenance manifest's documentationAudit records. Original documentation capture history is available in commit d2e4732c658.

The registry returned HTTP **404** for the old AWS catalogue label **6.73.1**, and **200** for 6.73.0 on 26 November. The corrected catalogue explicitly uses the captured 6.73.0 release. This does not change an architecture's provider requirements or lock file. [AWS version endpoint](https://registry.terraform.io/v1/providers/hashicorp/aws/6.73.1), [published captured release](https://registry.terraform.io/providers/hashicorp/aws/6.73.0), [Google captured release](https://registry.terraform.io/providers/hashicorp/google/8.10.0).

The Google source contained aggregate IAM documentation names such as google_compute_instance_iam. Those are replaced in discovery with actual schema types such as google_compute_instance_iam_policy, _binding and _member. Documentation-only, beta or newer types absent from the captured GA schema are not offered as resources for that release. Existing architecture state is not deleted by changing the palette. There are 1 Azure, 3 AWS and 127 Google source-document types with no corresponding resource in these captures; 137 additional Google aggregate pages map to multiple real resources.

| Provider | Schema capture SHA-256 | Form paths including blocks | Block definitions |
| --- | --- | ---: | ---: |
| AzureRM 5.14.0 | 9c6bc63fa88b2a62871f499e081b1cf71488d0d39f969e76c1bc5b7811d31d9f | 25,403 | 3,623 |
| AWS 6.73.0 | 3096ef28fdfa927743d7abc82ff6bdcf417278cb0f0dbcd3634dadee6f24a06a | 150,826 | 59,093 |
| Google 8.10.0 | 6071d9c47455d0a394e3d24b8036493e4573b647683ff86321ab4d1da85827e7 | 35,111 | 7,506 |

Counts include expanded provider schema block trees; they are not independent scalar counts or proof of all provider validators. Literal object members are carried in their own typed metadata. Executable schema JSON does not contain every provider conflict rule, enum validator or replacement condition.

## Changes

- Hosted resources and palette resources use the same recursive definitions. VMSS required fields, NIC/IP configuration, disks, lists/maps and timeouts are available in the existing editor. Optional capacity is not assigned automatically.
- Nested attributes retain actual member types, required/computed/sensitive access, tuple shapes and collection limits. Lists, sets, maps and objects have guided fields; raw JSON remains an optional view of the same canonical literal. Computed members are outputs. Bulk JSON and code apply share the local member checks. Dynamic/unknown literal shapes remain JSON, with provider validation availability explicit.
- Reviewed typed reference targets and topology rules remain curated. They are not inferred from schema adjacency. A regression which dropped the NIC reference picker was caught by the technical-graph browser suite and fixed by retaining the explicit curated field metadata separately from executable field types.
- Live schema selection uses the guarded service's requirement addresses and exact lock entries. No newest-version, alternate-registry or namespace fallback is used. Missing/conflicting/stale/ambiguous evidence leaves validation unavailable. Cache keys include architecture/source/snapshot evidence, and graph refresh clears Studio schema metadata. Async panel responses are guarded by graph identity and request generation.
- Known source literals, ordinary nested blocks and parseable field expressions hydrate after metadata arrives. Existing expressions use sparse additional configuration; replay is idempotent and source rebase preserves local edits. Redacted values are not hydrated. This is not comprehensive arbitrary-HCL hydration.
- Additional configuration reveals the existing resource-scoped Terraform pane. Ordinary literal edits return to form values; only unsupported expression/labelled structure uses sparse extras on the resource. Before/After review, semantic Undo and guarded save remain. Applied extras survive form changes, and deleting an owning block prunes its extras.
- Help icons remain beside labels. Variable heading/body scrolling, spacing, metadata collapse and both themes are covered by browser checks.
- Provider documentation links use the imported version. The adapter's invented minimal HCL example was removed. Examples in bundled evidence are real captured HCL fences containing the actual resource type, parsed locally and explicitly labelled as not executed or adapted.

## Capture and provenance

Terraform **1.15.8**, windows_amd64, executable SHA-256 **6eb0a1cb89344c97ccf2928ddc2d7a6cb71a1837b7ecccfd5991466b6d751e03** captured all three providers. Each initialization reported **signed by HashiCorp**. The research script uses a minimal environment, an owned CLI configuration and an isolated directory containing only an exact required-provider declaration. Commands: version -json; init -backend=false -input=false -no-color; providers schema -json. No plan, apply, remote backend, cloud authentication or state operation ran.

[assets/provider-forms/provenance.json](../assets/provider-forms/provenance.json) records engine/package evidence, schema/lock/init-log digests, official document revisions, individual document digests, documentation dispositions and schema-path reconciliation. Reconciliation paths are sampled to eight entries with full count/digest; full fields are in the generated resource trees. The earlier 45 ambiguous pages are therefore an audit input, not 45 automatically missing form definitions. Computed-only publishing credentials and arguments absent from the selected release are not promoted into editable fields.

The source documentation remains read-only under Z:/CLOUDLAB FORGE 3.0. Revisions: AzureRM 24ca3ae8bbdd0365277e941e99454046529de337; AWS e69536e8ae23969fb1f945cab0bab07e1ff163e1; Google 2262329f52827465646df889c8e188306f68f09f. Documentation version applicability remains separate from schema evidence. The old AWS source label had no matching local tag. No claim is made that every source document describes the captured executable release.

From Studio, regenerate after obtaining the same signed captures:

~~~powershell
node scripts/capture-provider-schemas.mjs --engine <absolute terraform.exe> --provider azurerm@5.14.0 --provider aws@6.73.0 --provider google@8.10.0
node scripts/import-provider-forms.mjs --source 'Z:/CLOUDLAB FORGE 3.0'
node scripts/build-provider-intelligence.mjs
corepack pnpm run build
~~~

Captures, init files, binaries, logs and the isolated desktop profile are ignored under output/. They are not repository artifacts; another machine must recapture them. Import verifies the captured schema, lock and init-log digests before generating assets. No provider is downloaded during a normal Studio build. The provider intelligence registry was regenerated for the real catalogue; its existing documented profiles and unknown-state policy are retained, not expanded from field syntax.

The eight original core-port hashes remain in CLOUDLAB-CORE-PROVENANCE.json. The catalogue loader and types intentionally have adapted hashes; the other six source ports are unchanged. Git attributes pin generated catalogue/form JSON and the schema normalizer/parser to LF for portable byte digests.

## Verified checkpoint and unfinished work

Before main integration: **172/172 Studio tests**, **101/101 extension tests**, both TypeScript checks, production preview build, bundled development extension build, minified extension-media staging and Impeccable changed-file detector passed. Provider editor browser matrix: **95/95**, including the new nested-member cases, zero console/page errors. The separate graph/refresh suite is rerun after the reference metadata correction; the merged result and exact commands belong in the canonical continuation.

An isolated instance of the installed CloudForge executable was launched with this development extension, separate user/extensions/local-data directories and an owned Terraform fixture. It was stopped on Dale's handoff request **before resource-editor or service/schema interaction was verified**. This is not installed-product proof. No installed files or user profile were updated; no installer was built.

Remaining work, in order:

1. Complete installed Workbench/service smoke with exact locked schemas: load VMSS source, inspect required/nested fields and source values, test reference binding, variable creation, code/form preservation, Undo, review and guarded save/reload. Verify actual lock-aware service selection and missing-schema states. The scratch setup is output/desktop-provider-smoke locally; create a fresh owned setup elsewhere. Do not infer success from the mocked-host browser tests.
2. Existing labelled/dynamic source bodies, Terraform meta-arguments and expressions the bounded parser cannot preserve are not comprehensively hydrated by the current source-value payload. Preserve them through the existing source/guarded merge flow. Only reliably represented configuration gets Configured in Terraform labels.
3. Full provider validation of additional sparse/dynamic configuration is explicitly unavailable. Reuse guarded Rust capabilities; do not claim a successful check from an incomplete serializer or run a deployment. Complex object variable authoring still has the existing variable-model limitations.
4. Engine-validate selected official examples against the recorded versions in an isolated harness. Current examples are parsed captures; compatibility is not established and failing examples must not be silently repaired or advertised as verified templates.
5. Consider finer provider/resource sharding and excluding bulky research-only provenance from packaged runtime assets. Large AWS schemas include deeply expanded WAF trees. Keep dependency/toolchain ownership isolated and coordinate shared graph files through one integration owner.

The user's latest instruction authorizes the main merge and requests continuation later. Do not start another implementation phase while finishing this handoff. Keep the canonical graph backlog intact.
