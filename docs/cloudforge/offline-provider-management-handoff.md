# Offline provider management: evidence and continuation

26 November 2026. Integration owner: Codex. [Reviewable product and journey specification](offline-provider-management-spec.md).

## Ownership

- Repository: fXrazor/vscode (`Z:/CloudForge-Code` Git common repository).
- Isolated worktree: `C:/Users/dalep/.codex/worktrees/release-readiness/CloudForge-Code`; retained the tool-created path after Dale selected the offline-provider workstream.
- Branch: `codex/offline-provider-management-spec`, based on `5b66f85cdba4564d2c4f8cf076714edcd0306785` (the locally available `origin/main` when this work began; no remote freshness claim).
- This pass owns only these two documentation files and its root HANDOFF entry. No product code, configuration, dependencies, service, protocol or installer changes.
- Exclude `extensions/cloudforge/studio/**` and its continuation from edits. The separate `codex/studio-whiteboard-2` worktree owns the design board, graph contract/renderer, attachment rows, endpoints, provider knowledge and Runner View work. Do not reset, merge, push, start/stop its preview or repurpose its worktree for this task.
- The root checkout `claude/project-thread-jvga4j` at `1696245582e8d94c8ac726362d042ad929513d21` contains two JSON Crack commits absent from this base. They are unrelated pending work and were not merged. The Rust root `claude/pending-handoff-docs` at `8e8dcc38f40f7fb288963008977b3ead9080ceeb` is a different history again; it was read only.

## Selection and workflow status

Dale chose **Offline provider-package management workflow**, then **Native QuickPick manager with guided steps**. The requested spec-design-feature and underlying design skills were read. Tempo tools (`issues_summarize_board`, Docs, asset/canvas guides, canvas creation/validation and `link_items`) are absent; plugin discovery returned no Tempo plugin. Repository handoffs were used as evidence, with a local spec as a clearly labelled fallback. No issue, Tempo Doc, rendered canvas or issue/artifact links were created. Do not emit `TEMPO_STEP_COMPLETE` for this pass.

The initial release-readiness investigation was superseded by Dale's selection; its one generated inventory file was removed. No release-readiness deliverable or product changes remain in this diff.

## Exact source evidence

Desktop links below resolve against this isolated base. Rust links are immutable source references; inspect the canonical protocol at the recorded revision rather than assuming the adjacent checkout is at that revision.

| Evidence | Source | Implication |
| --- | --- | --- |
| Native init and schema commands | [extension.ts](../../extensions/cloudforge/src/extension.ts), `cloudforge.initArchitectureOffline` and `cloudforge.extractMirrorSchema` | Existing progress and engine-backed workflows; no new runner or Studio workflow needed. |
| Guided import | [extension.ts](../../extensions/cloudforge/src/extension.ts), `cloudforge.importMirrorPackage` | Address/version/platform/digest inputs already exist; import can be prefilled from the first missing readiness package. Current platform placeholder does not establish selection of the suggested platform. |
| Removal versus cleanup | [extension.ts](../../extensions/cloudforge/src/extension.ts), `cloudforge.evictMirrorPackage` and `cloudforge.planMirrorCleanup` | Direct removal has modal confirmation; cleanup selection currently calls eviction immediately. Unify the review rule. |
| Integrity result handling | [extension.ts](../../extensions/cloudforge/src/extension.ts), `cloudforge.verifyMirrorIntegrity` | After only checking that the report is an object, absent counters default to zero. `{}` can reach the intact-package success notification. This was established by reading the branch, not a live reproduction. |
| Cleanup result handling | [extension.ts](../../extensions/cloudforge/src/extension.ts), `cloudforge.planMirrorCleanup` | Uses `evictable` and `pinnedRequiringReview`; does not display `protectedActive` or projected usage. Empty action arrays alone currently trigger within-quota copy. |
| Package and readiness adapters | [serviceAdapters.ts](../../extensions/cloudforge/src/canvas/serviceAdapters.ts), `parseMirrorPackages`, `parseOfflineMirrorReadiness` | Package list is capped at 512; invalid/missing list returns empty. Readiness arrays are capped at 128. A new manager must represent invalid/incomplete state explicitly without broadly changing Studio consumers. |
| Existing test coverage | [serviceAdapters.test.ts](../../extensions/cloudforge/test/serviceAdapters.test.ts), Stage 10 test | Covers list/readiness/init parsing and webview messages; does not prove native guided-flow behavior. |
| Native picker and request validation | [cloudForgeServiceChannel.ts](../../src/vs/code/electron-main/cloudForgeServiceChannel.ts), import/evict/cleanup cases and `prepareCloudForgeServiceCall` | `archivePath` is rejected in extension params and supplied by the native picker. Quota bytes must be a non-negative safe integer. Eviction accepts only address/version/platform, with no workspace or lockfile-pin context. |
| Timeout and native picker tests | [cloudForgeServiceChannel.test.ts](../../src/vs/code/test/electron-main/cloudForgeServiceChannel.test.ts), Stage 10 cases | Source tests exist for invalid params, path rejection, cancelled/UNC/native picker behavior and import budget. These Electron tests were not rerun here. |
| Workbench scope | [cloudForgeService.contribution.ts](../../src/vs/workbench/electron-browser/cloudForgeService.contribution.ts) | Scoped cleanup and architecture operations use the originating window's authorized context. Preserve the bridge. |
| Canonical Stage 10 contract | [Rust protocol at f6ccff1](https://github.com/fXrazor/CloudForge/blob/f6ccff1af12a8c60911b8e9977f7127700d2df5c/docs/protocol/cloudforge-service-v1.md#stage-10-offline-provider-mirror-offline-init-and-mirror-schema-extraction) | Import/evict/integrity/cleanup already exist. Treat architecture pins and active leases separately. No new protocol method selected. |
| Rust implementation and tests | [mirror_service.rs](https://github.com/fXrazor/CloudForge/blob/f6ccff1af12a8c60911b8e9977f7127700d2df5c/service/src/mirror_service.rs), [stage10_mirror.rs](https://github.com/fXrazor/CloudForge/blob/f6ccff1af12a8c60911b8e9977f7127700d2df5c/service/tests/stage10_mirror.rs) | Read at this exact Git object using `git show`. Rust owns publication, ZIP checks, leases and engine execution. Tests were inventoried, not executed in this pass. |
| Native design primitives | [vscode.d.ts](../../src/vscode-dts/vscode.d.ts), QuickInput/QuickPick; existing project command QuickPicks | Reuse actual Workbench controls, localisation and disposable input lifetimes. No raw colour/spacing or replacement webview necessary. |

## Observed artifact boundary

Read-only metadata inspection found `Z:/CFStage/VSCode-win32-x64/resources/app/product.json` stamped desktop `e9a36e0e73fdf429a0ac1a0cc11474e32ac81e68`, with runtime service manifest commit `f6ccff1af12a8c60911b8e9977f7127700d2df5c`, protocol 1, x64, declared SHA-256 `ee20be59e58febef29b01877ae117914605284ae94d69871ed89fdfa31ba35ba`. This was metadata inspection only: no executable hashing, process launch, manifest verification, installed smoke or compatibility proof. It is not the current desktop source revision. Use f6ccff1 above as contract evidence, not an automatic service pin for the next release.

The older `Z:/VSCode-win32-x64` payload is another revision (`d7c58cc29fe4fec61e403f01ee8738a56223a5a0`, service `ef4be9d09b0b2ddf504ea1bb31172c116c72da19`). Do not reuse either payload as evidence that this new manager works.

## Scoped build work after design review

This is a proposed sequence, not authorization or a completion claim for product implementation.

| Slice | Proposed ownership | Acceptance |
| --- | --- | --- |
| 1. Mirror presentation contract | New `extensions/cloudforge/src/providerMirror/model.ts` and focused `test/providerMirror.test.ts` | Explicit valid/empty/unavailable/incomplete states; strict result adapters for integrity/cleanup/import/eviction; counters and byte conversions checked; full package key retained; no vscode/filesystem/process imports in pure model. Share existing key semantics rather than copying backend policy. |
| 2. Native guided journey | New `src/providerMirror/quickPick.ts`, narrow activation registration, `package.json` and `package.nls.json` | Use real Workbench input controls. Back, Escape, focus, disposal, busy state and late completion behavior covered. Existing command IDs remain supported. All user-facing copy localized. |
| 3. Existing action integration | Narrow `extension.ts` command orchestration edits owned by one integration agent | Reuse scoped service calls and cache refresh behavior. Both cleanup and direct eviction go through one explicit review. Never infer success from fallback counters/bytes. Capture context before awaiting. No Studio edits. |
| 4. Mocked journey and visual review | Tempo native-component storyboards when tooling is available; isolated extension-host UI verification | Cover the spec's 12 frames and alternate states. No backend changes disguised as a design. A browser redraw of native QuickPick is not production-component evidence. |
| 5. Matched product proof | Build/installer integration owner, separately reserved output directories | Record desktop/Rust revisions and executable hash; verify offline import/check/cleanup/init/schema scenarios, scope changes and cleanup refusal while a lease exists. Recheck installed product; do not overwrite a sibling packaging job's output. |

Keep shared `extension.ts` edits small and check other worktrees before starting them. Do not split those changes between concurrent editors. Do not edit the Studio continuation to describe this separate workstream. Rust changes, downloads, installer execution and signed-release decisions are outside this spec pass.

## Verification

Freshly executed against the new worktree, Node `v24.22.1`:

```powershell
node --test --test-name-pattern='Stage 10 mirror' extensions/cloudforge/test/serviceAdapters.test.ts
```

Result: **1 selected test passed, zero failed, zero skipped**. Node printed its existing MODULE_TYPELESS_PACKAGE_JSON warning; no manifest change was made to suppress it. This checks existing adapter behavior, not the proposed manager.

Fresh documentation verification passed: `git diff --check`; all **13 relative file links** resolved; both docs passed trailing-whitespace and fenced-block checks; the working-tree status contained exactly these two docs and HANDOFF.md. Read-only status checks showed the Studio, original desktop and Rust checkouts still clean. No dependency installation, typecheck, build, Rust test, Electron test or UI/installer smoke was necessary or claimed for this documentation diff. Identify this documentation checkpoint with `git log -1 -- docs/cloudforge/offline-provider-management-spec.md`; no remote branch was pushed.

## Exact continuation

Review the spec's journeys, truthful-state requirements and one-package removal boundary with Dale. In a Tempo-capable session, create the backlog issue and PRD, build a clickable canvas from native production controls, perform visual review and link both artifacts to the issue. Those artifacts and links are still outstanding. Then implement the approved native workflow in an isolated worktree on a `codex/` branch, beginning with presentation/result parsing tests and keeping `studio/**` excluded. Re-read the current canonical Rust contract and source revisions before any integration; do not infer product approval from an old handoff entry.
