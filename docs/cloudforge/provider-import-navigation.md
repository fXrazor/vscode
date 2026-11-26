# Provider archive import navigation

## Follow-up: shared direct import — 26 November 2026

Current source checkpoint **`f4000cd3401f67ac7a4f4dceb5d9b280544b357f`**, same branch/worktree. Dale requested continued work. Refreshed and merged main **`df2168b7270`** first, preserving Claude's list-reference fix and Antigravity's canvas cloning/toolbar work exactly. Only the handoff introduction conflicted; both entries were retained. The separate `cloudforge.importMirrorPackage` command now calls the existing guided manager import, so the Providers view's existing import action also reaches the same five-step Back/review flow. Its prefill/readiness lookup and refresh callbacks are preserved. The direct command retains a blank version suggestion when none is known. Studio source and Providers view files were not edited.

Fresh verification: **131/131 extension tests**, **20/20 installed development-host navigation checks** covering both manager and direct commands, extension and runner/test TypeScript, extension bundle build, and whitespace checks passed. Strict lint passed for the updated test and runner. Full-file lint of `extension.ts` reports one pre-existing `local/code-no-in-operator` warning at its unchanged Providers registry action (also present before this change).

Installed desktop: `48d529c95579b144a1c5fc6836982967a5830772`; development extension SHA-256: `c7becfe8656c2dc24b8ff00c94944bfd90d7f2bc1b4231773f9d556d58e751af`. The isolated QA profile/storage was reused after confirming its previous process had closed. Installed app files were not changed. Evidence: `extensions/cloudforge/studio/output/provider-import-navigation/{results.json,provenance-direct.json,direct-review.png,extension-tests-direct.log}`. An external copy is at `C:/Users/dalep/.codex/visualizations/2026/11/26/01a216e1-525e-74f0-a26e-e7a5d5728866/provider-import-direct/`.

This supersedes the earlier note below that direct-command reuse remained pending. Next: review/integrate this local branch when requested, then continue the authentic archive/native-dialog and populated Providers-view proof. No main push/merge or installer build was performed; no archive selection/import was executed.

## Original manager checkpoint

26 November 2026. Owner: Codex. Branch `codex/provider-import-navigation`, reusing the clean isolated checkout at `C:/Users/dalep/.codex/worktrees/guided-variable-values/CloudForge-Code`, from merged main `e58ba69c4dd`. The earlier `codex/guided-variable-values` checkpoint remains on its own branch.

Dale asked to continue useful development without overlapping Claude's Studio work. Read-only inspection found Claude's JSON Crack, startup, Providers/Get Ready and Studio control updates already implemented, plus Antigravity's Network and connector changes on main. The inspected Claude/Antigravity checkouts were clean. This change completes Back navigation explicitly required by the existing [native provider-package workflow](offline-provider-management-spec.md), whose current import is a forward-only sequence.

Use the existing native InputBox/QuickPick flow. Restarting the wizard discards corrections; a new form or Studio panel adds unnecessary persistent UI. Standard Back buttons will move through Address → Version → Platform → Expected SHA-256 → Review while retaining the in-progress values, including edits made before pressing Back. Escape at any step abandons the draft without importing. Returning from Review permits correction of the digest, platform and identity. The platform picker restores the chosen platform. Invalid text remains on its step with the existing validation guidance.

Keep import metadata in a short-lived wizard draft, separate from architecture state. Review and the final broker request use the same trimmed identity and normalized digest. Only explicit Choose Archive and Import opens the existing broker-owned archive picker. Native-dialog cancellation and service errors keep existing behavior; there is no automatic retry, download, initialization or provider execution.

Implementation: a small API-independent step coordinator, a disposable native InputBox adapter, and reuse of the manager's existing QuickPick helper with optional step/selection metadata. Changes are limited to `extensions/cloudforge/src/providerMirror/`, focused tests, and handoff documentation. Studio, Providers view, extension command wiring, Rust, broker and installers are outside this change.

Verify retained edits across every Back transition, no result on Escape at every step, no accepted invalid input, exact reviewed/submitted identity/digest, and explicit review before import. Run focused mirror tests, extension type checking/build and targeted lint. If the installed development host is available, exercise native Back/cancel/review there with an isolated profile and capture evidence; distinguish this from a completed archive-import/service proof.

## Verified checkpoint

Source commit **`c7d595cd7c771d418a07d9199e71fbd45e4c02e4`**, branch **`codex/provider-import-navigation`**, base `e58ba69c4dd`. Files: `extensions/cloudforge/src/providerMirror/{importFlow,manager}.ts`, `test/providerMirrorImport.test.ts`, `scripts/provider-import-navigation-verify.mts`, this document and the root handoff. No Studio source, Providers view, command registration, broker or Rust files changed. Other worktrees were only inspected; the previous guided-variable feature remains on `codex/guided-variable-values`.

The import manager now uses standard InputBox Back buttons, step counts through 5/5, a restored active platform row and a small transient navigation draft. Existing syntax validation is shared with the navigation coordinator; it does not verify release existence or authenticate publishers. The existing trusted-digest, native ZIP picker and guarded service-import operation run only after explicit review. Cancellation resolves once and disposes the picker. Back retains even text edited before the step was accepted.

| Fresh verification against the committed source | Result |
| --- | --- |
| Focused mirror/import/Providers tests | 21/21 |
| All extension Node tests, `CLOUDFORGE_REPO=Z:/CloudForge` | **130/130**, no failures/skips |
| Extension TypeScript with own Studio Node types | Passed |
| New test and installed-runner TypeScript checks | Passed |
| Extension esbuild bundle, own Studio esbuild, `vscode` external | Passed |
| Strict targeted oxlint with warnings denied | Passed |
| Whitespace checks | Passed |
| Real installed Workbench, own development extension | **13/13 navigation assertions** |

Node **24.22.1**, pinned pnpm **12.16.0**. Studio dependencies were already installed in this isolated checkout. Targeted lint used the existing executable/configuration at `Z:/CloudForge-Code/node_modules/.bin/oxlint.cmd` and `Z:/CloudForge-Code/oxlint.config.ts` against these explicit changed paths; no application dependency tree was shared or rules disabled.

Installed desktop: **`48d529c95579b144a1c5fc6836982967a5830772`**. Development extension bundle SHA-256: **`119669eb5cd0a84f7a97caf7d7fce119a9a95344fa3fadbbeb6b50fe595356ab`**. The final bundle was rebuilt and the isolated extension host restarted before the passing final run. The installed application directory and service were not replaced. The host used separate profile, extensions, shared storage, LOCALAPPDATA and APPDATA under this worktree's ignored `extensions/cloudforge/studio/output/provider-import-navigation/`; the startup log confirmed the isolated shared database. It was launched hidden and closed after verification. Initial stock startup UI required its existing Continue to the window action; startup behavior was not changed in this task.

The installed runner exercised real native widgets for Address → Version → Platform → Digest → Review, traversed Back with unaccepted version/digest edits, restored the Linux selection, rejected an invalid digest, reviewed changed Google identity/digest together, and cancelled at review and the initial step. It stopped before **Choose Archive and Import**. This is installed development-extension navigation evidence; it is not a packaged release, ZIP-dialog/import or provider-execution proof. Unit tests additionally cover cancellation at all five steps and exact returned parameters.

Evidence: `extensions/cloudforge/studio/output/provider-import-navigation/{results.json,provenance.json,address.png,review.png,extension-tests.log}`. A copy is preserved outside the worktree at `C:/Users/dalep/.codex/visualizations/2026/11/26/01a216e1-525e-74f0-a26e-e7a5d5728866/provider-import-navigation/` with SHA-256 manifest.

## Reproduction and next action

Use the isolated development-host launch documented in [installed-provider-verification.md](../../extensions/cloudforge/studio/research/installed-provider-verification.md), with the current extension, its own `studio/output/provider-import-navigation/launch.json`, and no Terraform folder needed for this manager-only check. From the repository root:

```powershell
$env:PLAYWRIGHT_DIR = 'Z:/CloudForge-Code' # automation tooling only
node extensions/cloudforge/scripts/provider-import-navigation-verify.mts
$env:CLOUDFORGE_REPO = 'Z:/CloudForge'
$extensionTests = Get-ChildItem extensions/cloudforge/test -Filter '*.test.ts' | ForEach-Object FullName
node --test @extensionTests
```

From `extensions/cloudforge/studio`:

```powershell
corepack pnpm exec tsc --noEmit --project ../tsconfig.json --typeRoots ./node_modules/@types
corepack pnpm exec tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --allowImportingTsExtensions --skipLibCheck ../scripts/provider-import-navigation-verify.mts ../test/providerMirrorImport.test.ts
corepack pnpm exec esbuild ../src/extension.ts --bundle --platform=node --format=cjs --external:vscode --outfile=../dist/extension.js
```

Local checkpoint only, not pushed or merged. When integration is requested, refresh main and preserve all concurrent Studio work. This changes **Manage Offline Provider Packages → Import Provider Archive**; the separate direct import command used by Claude's Providers view still has its existing prompts. Reusing this guided flow there is a separate integration step that should be coordinated with that view's owner. Authentic ZIP import/native-dialog cancellation and service-side import correctness remain in the existing provider-mirror continuation; no claim is made that those pending checks are complete.
