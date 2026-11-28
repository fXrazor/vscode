# Installed provider workflow verification — 26 November 2026

Closeout: Dale requested merge/update/close. The fix below was integrated with main `d2f5e7e06dd` as **`fa5a778e82de44e42eb9f3a0c87995883930be40`**, verified with **238 Studio tests**, TypeScript and preview build. The installed results below retain their original source/asset identities and were not rerun for the later canvas merge. The separate feature branches mentioned below remain preserved and unmerged by this closeout.

## Studio editor continuation after Claude's merged passes — 26 November 2026

Dale asked to inspect Claude's current Studio and continue the handoff. Codex compared merged main **`df2168b72700c6ca0956e15888ee3789212a51c0`**, the pass 9/10 ledger and the resource/variable/list implementations. Claude's PR #6, mixed entries and object-variable paths are in the tested source, along with Antigravity's subsequent canvas/Technical Graph work. Older ledger entries describing those capabilities as pending are superseded by the reconciliation at the top of the canonical Studio continuation.

Source checkpoint **`1a3a54740e68fdc5f1602deb52550e0d53d7ad88`**, branch **`codex/studio-handoff-verification`**, worktree **`C:/Users/dalep/.codex/worktrees/guided-variable-values/CloudForge-Code`**, based directly on merged main. Other worktrees were inspected read-only. Existing native-import (`codex/provider-import-navigation`) and guided-variable (`codex/guided-variable-values`) work remains separately committed and is not included in this checkpoint.

The installed inspection found an actual follow-up bug: the mixed-list UI could bind a variable, but `variableUses()` only scanned whole-field bindings and expression text. A list-only variable therefore showed **0 resource uses**, leaving rename/delete unguarded. The seven-line production change scans `resourceRefs[*].items` for variable entries as well. Existing guards then work for scalar variables and object leaves, with one use per resource even if several list entries reuse it. The focused regression failed before the fix and passed after it; removing entries and Undo are covered. Existing list rendering, fields, styling, reference eligibility and canonical architecture are preserved.

The new [installed runner](../scripts/installed-studio-editor-verify.ts) passed **22/22** with the actual Workbench, development extension/media and packaged Rust service. It exercises the current mixed NIC reference editor, variable creation and list binding, correct use count/disabled Delete, shared Undo, additional expression review, unavailable provider-validation wording, form/code preservation, Undo/Redo, guarded preview and Cancel, explicit guarded save to the owned fixture, exact preservation of all other original Terraform blocks, and source rehydration after refresh. No bridge responses, grants, architecture state or service inventory were mocked. Guest-frame controls are scoped to the top active dialog; Radix tabs receive their mousedown activation. Text fields use native input/change events and Monaco's own text-buffer change event. This is functional installed development-extension proof, not pointer hit-testing or a new packaged release.

Fixture: three disposable AzureRM resources, locked to **5.14.0** using the original signed-capture lockfile. The VMSS starts at **12 instances**. The only saved change adds `tags = merge({ owner = "qa" }, { stage = "test" })` to that VMSS. Its temporary instance-count and variable/list edits are undone before save. The provider's semantics of this expression and the fixture's deployability were not validated. The UI explicitly reports that additional Terraform has not been validated by the provider. No Terraform engine, init, plan, apply, provider execution, credentials or cloud operation ran.

| Installed artifact | Verified identity |
| --- | --- |
| Code OSS desktop | `48d529c95579b144a1c5fc6836982967a5830772` |
| Packaged Rust service / protocol | `68cbe03e5425fa0d55db9cd7144a1178ef38fe77` / `1` |
| Service executable SHA-256 | `20ffe53c7c30f140a1016c6f04aa485055d461584a6e35f0e4ef1b4db50dae87`, matched its installed manifest |
| Development extension SHA-256 | `ad1ccc3f1bca8d982f0a51b5b09b38d8b49e2bfc40e30532ba86200a7c2d9a4f` |

The owned QA root is `extensions/cloudforge/studio/output/studio-continuation-installed/`. `asset-provenance.json` records the current Studio JS/CSS, extension, service and lock hashes. `editor-results.json` records the passing runner hash, check list and source revision before checkpointing; its tested source contents were committed as `1a3a54740e6`. Screenshots: `mixed-list.png`, `additional-guarded-save.png`, `additional-after-refresh.png`; exact source snapshots: `before-main.tf` / `after-main.tf`. A copy is preserved outside this worktree at `C:/Users/dalep/.codex/visualizations/2026/11/26/01a216e1-525e-74f0-a26e-e7a5d5728866/studio-editor-continuation/` with a SHA-256 manifest. The earlier unpatched pass is retained locally under `baseline-proof/` and is not the deletion-protection evidence.

Fresh source checks: **233/233 Studio tests**, `corepack pnpm run check`, standalone runner TypeScript, minified Studio media staging and strict targeted oxlint passed. Node **24.22.1**, pinned pnpm **12.16.0**; dependencies belonged to this checkout. Lint used the external executable/configuration fallback documented below against explicit changed files, without sharing application dependencies or disabling rules.

Reproduce with a fresh disposable fixture and `before-main.tf` beneath the owned QA root, the authentic capture lockfile, and the isolated development-host launch described below. Open the fixture through **CloudForge: Open Workspace** and close the extra Workbench chat sidebar so all three fixture nodes fit. Stage this checkout's extension and minified Studio media first, preserving installed files. From Studio:

```powershell
$env:PLAYWRIGHT_DIR = 'Z:/CloudForge-Code'
node scripts/installed-studio-editor-verify.ts
```

The runner intentionally refuses a fixture already modified by an earlier completed run. Use fresh owned source/profile/storage for a rerun; do not point it at a user's project. The QA host uses isolated profile, extensions, shared data, LOCALAPPDATA and APPDATA. No installed files or installer were changed.

Next: integrate only when requested; finish live snapshot-import/render states, AWS/Google installed coverage, engine validation of captured examples and additional configuration, and the authentic native-archive workflow from the existing mirror handoff. Sensitive variable exports, all object-leaf combinations and arbitrary HCL are not exhaustively proven by this run. The historical results below describe their earlier tested revisions.

Codex continued after Dale's explicit request to resume development. Integration owner: Codex. Worktree: `C:/Users/dalep/.codex/worktrees/release-readiness/CloudForge-Code`; branch: `codex/provider-installed-verification`; product source baseline: `930b9d7af51e2a4fdf814d9679e5fb74485b8e05`. This phase adds a repeatable installed integration runner and evidence, without changing production UI, Rust, the protocol, installer, or other worktrees.

## Fresh installed results

The actual Windows CloudForge executable loaded this worktree's development extension and staged Studio media, and supervised its own verified Rust service. No webview bridge responses, workspace grants, or service inventory were mocked or seeded. Opening the disposable Terraform folder used **CloudForge: Open Workspace** and the real folder picker. Startup log inspection caught that the first launch still opened the default `.cloudforge-shared` app storage despite its separate profile; no attempt was made to restore that shared database. The final run explicitly passed `--shared-data-dir` beneath the disposable root, and its startup log confirms that isolated database path.

| Artifact | Observed value |
| --- | --- |
| Installed desktop version / commit | 1.148.0 / `d8c253fd95b686bfd258b04429cdef70d2c59e4c` |
| Packaged Rust commit / protocol | `f6ccff1af12a8c60911b8e9977f7127700d2df5c` / 1 |
| Packaged executable SHA-256 | `ee20be59e58febef29b01877ae117914605284ae94d69871ed89fdfa31ba35ba` — matches installed manifest |
| Development extension | This worktree's `extensions/cloudforge/dist/extension.js`, freshly bundled from merged source |
| Resource fixture | One `azurerm_linux_virtual_machine_scale_set.fixture`, exact AzureRM 5.14.0 requirement and captured official lockfile |
| Runner | [installed-provider-verify.ts](../scripts/installed-provider-verify.ts), **13/13 passed** |

Verified required admin/SKU/instance fields and existing disk/NIC/IP values; exact captured schema provenance; form editing without source writes; semantic Undo; Rust guarded preview without writes; apply changing **only** the reviewed instance count byte-for-byte; and the saved value after workspace refresh. The native manager verified real empty inventory, valid zero-package integrity, zero MiB cleanup quota, and readiness reporting the missing AzureRM 5.14.0 Linux/Windows archives without offering offline initialization.

Screenshots and machine-readable results are in this worktree's ignored `extensions/cloudforge/studio/output/desktop-provider-smoke-930b9d7/`: `guarded-save.png`, `vmss-installed.png`, `mirror-installed.png`, `installed-results.json`, `artifact.json`, `readiness-installed.txt`, and isolated profile logs. The original manual save proof is `save-proof.json`. The disposable fixture changes on each runner invocation by incrementing its instance count; this is intentional. No provider, backend, state, plan, apply, cloud sign-in, or deployed resource operation ran.

## Reproduce

1. Use an isolated checkout and its own installed Studio dependencies. Bundle the extension with Studio's `corepack pnpm exec esbuild ../src/extension.ts --bundle --platform=node --external:vscode --format=cjs --outfile=../dist/extension.js`. Stage media with `node build.ts --stage-media --outdir <this-extension>/media/studio`, after verifying the resolved output is inside this extension: this build recursively replaces its output directory.
2. Create a fresh directory beneath this worktree's `extensions/cloudforge/studio/output/`, containing `fixture`, `profile/User`, `extensions`, `local-app-data`, and `roaming`. Copy the prior disposable fixture, or prepare the equivalent fixture below. Copy the signed AzureRM 5.14.0 capture's `.terraform.lock.hcl` from `output/provider-schema-capture/azurerm-5.14.0/`. If unavailable, follow the [schema capture reproduction](provider-form-coverage.md) first; do not synthesize lock hashes.
3. In the isolated profile's `User/settings.json`, set `files.simpleDialog.enable: true`, `security.workspace.trust.enabled: false`, `workbench.startupEditor: "none"`, `window.restoreWindows: "none"`, `telemetry.telemetryLevel: "off"`, `update.mode: "none"`, `extensions.autoUpdate: false`. These settings apply only to the disposable fixture/profile.
4. Launch the installed `CloudForge.exe` from a child process with `LOCALAPPDATA=<owned-root>/local-app-data`, `APPDATA=<owned-root>/roaming`, and `ELECTRON_RUN_AS_NODE` unset. Pass `--user-data-dir=<owned-root>/profile`, `--shared-data-dir=<owned-root>/shared-data`, `--extensions-dir=<owned-root>/extensions`, `--extensionDevelopmentPath=<this-worktree>/extensions/cloudforge`, `--remote-debugging-port=<free-local-port>`, `--new-window --skip-welcome --skip-release-notes --disable-updates --disable-gpu --no-proxy-server`, and the fixture folder. Use `Start-Process -WindowStyle Hidden`. The service supervisor forwards `LOCALAPPDATA`; a custom service-data environment variable is not forwarded. Record `root`, `fixture`, `extension`, `sharedData`, `port`, and `processId` in `<owned-root>/launch.json`.
5. Execute **CloudForge: Open Workspace**, choose the owned fixture folder, and open its Studio view. Record `launch.json` in the owned root with absolute `root`, `fixture`, `extension` paths and numeric `port`, `processId`. Ensure the service really started under the isolated profile and its packaged hash matched.
6. Run from the repository root:

```powershell
$env:PLAYWRIGHT_DIR = '<tooling-checkout-with-playwright-core>'
node extensions/cloudforge/studio/scripts/installed-provider-verify.ts '<owned-root>/launch.json'
```

`PLAYWRIGHT_DIR` selects browser automation tooling only; never share application `node_modules` between worktrees. The runner accepts only a launch record beneath its own Studio output and a real fixture path beneath that record's directory, with shared app storage isolated there too. It assumes an empty isolated service mirror, and opens the fixture through the real simple folder picker if Studio is not already open. It drives actual UI controls and keyboard input, preserves unrelated source, writes screenshots/results, and disconnects without closing the desktop. Inspect the process command line against the owned profile before stopping that process; leave other CloudForge instances untouched.

The fixture's `main.tf` has exactly one Terraform requirements block and one resource. Use `hashicorp/azurerm` version `5.14.0`; resource type/address as above; name `provider-editor-fixture`, location `uksouth`, resource group `fixture-rg`, admin username `cloudforge`, SKU `Standard_D2s_v5`, a literal `instances` between 1 and 999, `os_disk` with caching `ReadWrite` and storage `Standard_LRS`, and a primary `network_interface` / primary `ip_configuration` named `primary`. Its `subnet_id` ends in `/subnets/primary` and uses a dummy all-zero subscription UUID. This is a source-editing fixture, not a deployable VMSS example; provider semantic validation is not claimed.

## Remaining installed journeys

- Import an authentic published provider ZIP through the native picker with its independently verified published digest; inspect populated inventory, integrity after mutation, explicit removal/cancel, and protected cleanup. Do not rezip an executable and call it an official release archive.
- Extract/import the exact snapshot through the real service and exercise unavailable or mismatched lock/schema states. This pass used the matching signed **bundled** catalogue and real dependency lock inspection; it does not prove live schema import/render validation.
- Exercise variable creation/binding, expression/dynamic/labelled Terraform configuration, review/highlighting, preservation across form/code and guarded save, and their shared Undo in the installed host. Existing hosted browser tests cover these; this pass does not promote them to installed evidence.
- Repeat meaningful provider-specific integration samples for AWS and Google and capture light/narrow layout evidence. A single VMSS fixture does not verify 4,271 providers' resource semantics.
- Full extra-code provider validation, official-example engine validation, and existing opaque-source hydration gaps remain in the [canonical continuation](../STUDIO-CONTINUATION-2026-11-25.md). Preserve its Technical Graph backlog and coordinate ownership before editing those renderer files.

The runner passed a targeted TypeScript check using Studio's pinned compiler: `corepack pnpm exec tsc --ignoreConfig --noEmit scripts/installed-provider-verify.ts --types node --target es2024 --module nodenext --skipLibCheck`. Repository `build/oxlint.ts` could not start because this isolated root lacks `minimatch`. Direct loading of its configuration also lacked the root `oxlint` package. The existing external tooling binary was therefore run with its configuration after verifying identical hashes for `oxlint.config.ts`, `eslint.config.js`, and `build/lib/oxlintConfig.ts` in both checkouts. `--debug=files` confirmed it selected the new TypeScript runner; lint returned no diagnostics. No dependency tree was shared or installed just for this documentation/automation change.
