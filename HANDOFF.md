# CloudForge Code OSS handoff

The Windows x64 Code OSS baseline passed dependency installation, packaging, a fresh-profile launch, and local open, edit, and save. The cold launch and file save also passed with inbound and outbound firewall rules for all nine packaged executables. The saved file was verified on disk, the process exited with code 0, and all 18 temporary rules were removed. [Baseline evidence](Z:/CloudForge/HANDOFF.md#code-oss-foundation-setup)

| Item | Verified value |
| --- | --- |
| Product repository | [fXrazor/vscode](https://github.com/fXrazor/vscode), checked out at `Z:\CloudForge-Code` |
| Clean source revision tested | `a3cabfed1ada486415b1d3b4fff66bb2d47771ac`, also the merge base with Microsoft `main` |
| Upstream reference at baseline | `62c6591a3a5c5cf409cb9cac554f1f1e4879af15`, 16 commits ahead |
| Rust repository | [fXrazor/CloudForge](https://github.com/fXrazor/CloudForge), adjacent at `Z:\CloudForge`. Inventory at `2a0959410ba5b5eaf73ef53e8cecaab689029693`; preserve the existing uncommitted work |
| Windows toolchain | Node `24.22.1`, pnpm `12.16.0`, Python `3.15.2`, VS 2026 C++ Build Tools with x64 Spectre libraries, Windows SDK `10.0.26100.0`, and Inno Setup `6.4.1` |
| Build command | `corepack pnpm run gulp vscode-win32-x64-min` with the Windows SDK x64 tools on `PATH`. Exit code 0 in 8m 52.3s |
| Portable payload | `Z:\VSCode-win32-x64`, 2,707 files totaling 1,440,484,904 bytes |
| Baseline executable | `Code - OSS.exe`, SHA-256 `c70cb8ccd1876809841c4d136f01910a67e232b89b556ad9d2fd8b8fe835662b` |

The upstream baseline executable is the portable Code OSS build. The [foundation plan](Z:/CloudForge/docs/superpowers/plans/2026-11-16-code-oss-desktop.md) describes the branded desktop, Rust service, and one Windows installer. The [approved design](Z:/CloudForge/docs/superpowers/specs/2026-11-16-code-oss-cloudforge-ide-design.md) defines the product scope.

## Repository routing

The user-facing deliverable is **one installable CloudForge app**: this Code OSS desktop packaged with the Rust service built from `Z:\CloudForge`. These are source boundaries, not two installed apps. Put shipped desktop UI, extension, product configuration, and installer work in this repository; put Rust service and core behavior in `Z:\CloudForge`. The React/Vite UI in the Tauri fallback does not get compiled into Code OSS. Preserve its existing changes, and explicitly implement in this repository any behavior that should appear in the shipped desktop. Follow the [foundation plan](Z:/CloudForge/docs/superpowers/plans/2026-11-16-code-oss-desktop.md): the handshake-only proof passed, and the separately approved workspace/graph slice is the only next implementation scope. Broader product work remains gated.

## Approved handshake-only proof

The user approved a proof limited to a built-in command, service handshake, package provenance, and process lifecycle. Keep the implementation in separate worktrees and stay within that boundary:

1. Build a Tauri-independent `cloudforge-service.exe` from a recorded clean Rust revision. Implement only bounded framing and `initialize` for protocol/service identity from the [draft protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md).
2. Add the minimum product identity and built-in command needed to demonstrate activation and sidecar handshake/lifecycle in Code OSS. The broker choice, executable path, and manifest/signing order must follow the resolved decisions in the [readiness review](Z:/CloudForge/HANDOFF.md#protocol-and-proof-readiness-review-2026-11-17), not assumptions in this outline.
3. Package and verify service provenance, manifest/hash, notices, startup/handshake, mismatch handling, and cleanup on normal quit and forced desktop termination. Do not add `openWorkspace`, `readArchitecture`, Terraform parsing, graph UI, or other workspace behavior in this proof.

The full product identity, selected broker, and packaging approach are not blanket-approved by this proof; apply only decisions recorded for this bounded scope. The first proof and protocol remain proposals for approval where they extend beyond the handshake-only scope.

### Readiness review (2026-11-17)

A read-only review checked this proof against the fork at `a3cabfed1ada486415b1d3b4fff66bb2d47771ac` and CloudForge `2a0959410ba5b5eaf73ef53e8cecaab689029693`. The full findings, owner decisions, and acceptance checklist are in the [Rust handoff](Z:/CloudForge/HANDOFF.md#protocol-and-proof-readiness-review-2026-11-17). Points specific to this repository:

- Step 2 names Electron main as the supervisor but adds a built-in extension, which runs in the extension host. Supervision from Electron main needs a core patch: a main-process service and an IPC channel. The owner chooses the broker.
- Code OSS has no Job Object, and its `taskkill` tree kill (`src/vs/base/node/processes.ts`) needs a living parent. During shutdown, `extensionHostStarter.ts` gives the extension host up to 6 s and deliberately does not kill it. Prove cleanup after a forced exit through stdin EOF and a service-side parent watchdog. Spawn the service with a scrubbed environment and drain stderr continuously.
- Step 3 stages the manifest before signing. Authenticode signing changes the executable bytes, so compute the manifest SHA-256 after signing.
- `resources/app/cloudforge-service/` is outside the `InstallDelete` entries in `build/win32/code.iss`, so stale files can survive updates. A folder inside the built-in extension is cleaned on full updates.
- `product.json` still uses Code OSS AppIds, mutex, data folders, built-in Copilot with auto-updates, `voiceWsUrl`, and the `vscode-cdn.net` Webview template. At minimum, give the proof distinct AppIds, mutex, and data folders.
- `builtInExtensions` accepts a local `vsix` with `sha256` (`build/lib/builtInExtensions.ts`), which suits the one-VSIX bundling check.

The user approved the bounded installer proof and later approved the separate workspace/graph slice. The integration owner owns the shared protocol, packaged service pin, licensing and provenance checks for bundled artifacts, and installed-product smoke. See the [Rust handoff](Z:/CloudForge/HANDOFF.md#read-only-inventories-completed-2026-11-17) and [approved slice design](Z:/CloudForge/docs/superpowers/specs/2026-11-17-workspace-graph-slice-design.md) for scope and safeguards.

## Verified Windows installer proof

The [Windows x64 per-user installer](Z:/CFProof/Code/.build/win32-x64/user-setup/CloudForgeProofSetup-x64.exe) built and passed its installed smoke on 17 November 2026. This is an unsigned proof build.

| Artifact or source | Verified identity |
| --- | --- |
| Installer | 321,101,265 bytes, SHA-256 `f9c8ca71ec3c7e6f5edaa39ab38c10a84be3a1cf651b7161bbd7d3bf94fb7e35` |
| Desktop | `codex/cloudforge-desktop-proof` at `0e5307e3c63e384c139cfd9bd264de3b0da94e8a`, built from the clean linked checkout at `Z:\CFProof\Code` |
| Rust sidecar | `codex/cloudforge-sidecar-proof` at `9ff372edad50b636678ac90f3f8ea363c9c71d2a`, protocol 1, Windows x64, SHA-256 `086f96faaa9d39debb71137c0b6911ce46429aeda4721569e4fae7cd64f2f793` |
| VSIX sample | JavaScript Debugger `1.140.1`, SHA-256 `7accf7857ea4f4717b6211a2b75f5b434faf477033203a8919b6d26b6abc1897`, extracted with MIT license and third-party notices |

The installed executable and service manifest matched the build. On a cold launch with 24 firewall rules covering the 12 installed executables, the desktop negotiated protocol 1, the built-in **CloudForge: Show Proof Status** command activated, and a local edit saved correctly. The main log reported both a rejected service commit and a rejected protocol version in separate runs. The sidecar exited after normal desktop quit and after forced desktop termination. The Rust process also exited when a separate test launcher was killed while writing a partial frame. The test installation and firewall rules were removed. [Installed workbench screenshot](Z:/CFProof/Code/.build/cloudforge/installed-workbench.png)

Electron main owns one sidecar per running proof app and verifies the service digest on every startup. The built-in command verifies extension activation independently. The proof has no workspace grant or graph calls. The [service draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md) records the follow-on window and workspace boundary. The unchanged Tauri fallback passed its frontend build, 68 Rust tests, formatting, and Clippy.

## Service artifact staging slice

Worktree `E:\Orca\CloudForge-Code\dagon`, branch `fxrazor/chore-review-handoffs`, source base `a3cabfed1ada486415b1d3b4fff66bb2d47771ac`. See the [source map](docs/cloudforge/repository-map.md) and [staging guide](docs/cloudforge/service-artifact.md). The installer proof above is inherited verification from its separate branch; this merge does not bring that branch's implementation onto `main`.

Selected in response to the user's instruction to continue working from the handoff. No canonical runtime protocol or service revision was chosen.

- Added [build/cloudforge/serviceArtifact.ts](build/cloudforge/serviceArtifact.ts): a Node-only CLI/function that checks a trusted expected digest and packaged desktop commit, streams the supplied service into a fresh `cloudforge-service` directory, rechecks copied bytes, and writes build metadata last. It records supplied service/desktop revisions, opaque protocol identifier, declared Windows x64 target, hash, and size.
- Added [targeted tests](build/lib/test/cloudforgeServiceArtifact.test.ts) and [usage/integration guidance](docs/cloudforge/service-artifact.md). Review identified a cleanup ownership bug; a failing regression reproduced it before the fix. Exclusive file handles now track which outputs this run created, preserving a manifest claimed by another writer.
- The CLI does not execute/download the artifact, modify product metadata, or overwrite existing service output. It has no automatic Gulp/installer hook. Hash verification proves byte identity; provenance, PE architecture, signing, protocol compatibility, installed behavior, and lifecycle need their separate checks.
- The initial targeted lint attempt found missing tooling dependencies. `corepack pnpm install --frozen-lockfile --ignore-scripts` then installed this worktree's locked dependencies. Native/postinstall setup was deliberately not run for this build-tool task; this is not a prepared editor build. No package manifest or lockfile changed.
- Validation: 34 Node tests passed with no skips; targeted strict TypeScript checking and targeted oxlint passed. No new desktop build, real Rust service, installer, or runtime connection was tested.

## Proof and stager integration slice

Branch `fxrazor/service-staging-integration` in worktree `Z:\CloudForge-Code\.claude\worktrees\service-staging`. It merges `main` (`080f2b03bd8`, the stager) into `codex/cloudforge-desktop-proof` (`0e5307e3c63`, the verified proof) with no conflicts. The proof's runtime code is unchanged. No other active worktree touches `build/cloudforge/` or `build/win32/code.iss`. The `feature/workspace-graph-desktop` worktree reads the same `cloudforge-service/manifest.json` and does not change its schema.

- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) now writes the runtime `manifest.json` that `cloudForgeService.ts` verifies: `serviceCommit`, integer `protocolVersion`, `architecture: "x64"`, and `sha256`, with no BOM and under the 4 KiB read limit. The old `service-manifest.json` build-metadata schema is gone. `--protocol` takes a positive decimal integer.
- [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1) stages through the stager instead of an inline copy and manifest write. It replaces a reused payload's previous service only when that directory holds exactly the two staged files and neither is a link; otherwise it stops unchanged.
- [code.iss](build/win32/code.iss) deletes `resources/app/cloudforge-service` on normal install or upgrade for the `cloudforge-proof` product, so stale service files cannot survive an upgrade.
- The proof is unsigned, so staged bytes are final. A signed release must sign the service before staging, or restage after signing, as recorded in the [staging guide](docs/cloudforge/service-artifact.md#signing-and-integration).

| Check | Result |
| --- | --- |
| `node --test build/lib/test/cloudforgeServiceArtifact.test.ts` | 36 passed, 0 skipped. Covers the exact runtime manifest shape and size, and integer protocol validation for the API and CLI. |
| Strict `tsc` (TypeScript 6 from the main checkout) using `build/tsconfig.json` with Node types on the two build files | Passed. |
| `node build/oxlint.ts` on the two build files | Passed. Temporary junctions to the main checkout's `node_modules` were used because this worktree has no installed dependencies, and were removed afterwards. |
| PowerShell parse of `package-win32-x64.ps1`; scratch run of its staging block | No parse errors. A fresh payload and a reused payload produced the expected executable and manifest; unexpected content stopped staging with the directory untouched. |

### Installed package check (2026-11-17)

Built from the clean detached checkout `Z:\CFStage\Code` at `6f62ece11e4ca9623c4139b76b4a85fba4692086`. `corepack pnpm install --frozen-lockfile` passed in 3m 26s. `build/cloudforge/package-win32-x64.ps1` used the Rust service from `codex/cloudforge-sidecar-proof` at `9ff372edad50b636678ac90f3f8ea363c9c71d2a` (SHA-256 `086f96faaa9d39debb71137c0b6911ce46429aeda4721569e4fae7cd64f2f793`) and the pinned JavaScript Debugger VSIX (`7accf785…6abc1897`). The script passed in 12m 47s.

| Item | Result |
| --- | --- |
| Installer | `Z:\CFStage\Code\.build\win32-x64\user-setup\CloudForgeProofSetup-x64.exe`, unsigned, 321,074,228 bytes, SHA-256 `9a7c33a9cd0d0af097c3bf12275eff780106cc5325245d4253f4e01b5a3331e2` |
| Staged manifest | Written by the stager: service commit `9ff372e…`, protocol `1`, `x64`, and the service SHA-256 above |
| Install | The user installed it per-user at the default `%LOCALAPPDATA%\Programs\CloudForge Proof`. The installed product commit and service manifest matched the build. |
| Upgrade over install | A stale file was planted in `resources\app\cloudforge-service`, then the same installer was rerun silently (`/MERGETASKS=!runcode`, exit 0). Afterwards the folder held only `cloudforge-service.exe` and `manifest.json`, and both matched. |
| Launch and handshake | Launched with a fresh user-data folder and a local fixture folder. The main log recorded `Initialized protocol 1, service 9ff372edad50b636678ac90f3f8ea363c9c71d2a`, with one sidecar running. |
| Normal quit | After closing the main window, the desktop and the sidecar exited. |
| Forced termination | After the desktop main process was killed, the sidecar exited within 20 s. No installed processes remained. |

Not rerun in this check: the firewall-blocked offline launch, the commit and protocol mismatch cases, the partial-frame EOF test, and uninstall. The user's install was left in place, and the temporary user-data and fixture folders were removed. The original [installer proof](#verified-windows-installer-proof) covers those checks for the earlier packaging path.

## Sidecar handshake unit tests (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\stingaree`, branch `fxrazor/chore-test-verify-handoff`, based on `main` at `6f389944d1a`. This change adds tests only and stays within the handshake-only proof scope. The runtime supervisor [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts) had no unit tests and is unchanged.

- Added [cloudForgeService.test.ts](src/vs/code/test/electron-main/cloudForgeService.test.ts), with 23 cases in the Electron unit runner:
  - **Initialize reply parser:** replies delivered in one chunk, one byte at a time, and with the delimiter split across chunks. Error codes `-32001`, `-32002`, and other codes. Protocol or commit identity mismatches, including a string `"1"` and an uppercase commit. Malformed JSON-RPC envelopes, non-object and invalid UTF-8 bodies, invalid `Content-Length` values and extra headers, a 4 KiB header without a delimiter, trailing output, and early EOF.
  - **Package verification through `start()`:** a missing manifest, or a manifest path that is a directory. Manifests over 4 KiB, exactly 4 KiB, and not a JSON object. Invalid architecture, commit, and digest fields, and a different protocol. A missing executable and a digest mismatch. Stopping during verification, which must neither spawn nor log, and stopping before start.
  - The fixture executable holds inert text, and every case fails before spawning. The tests assert that no child process exists.
- Coordination: the `dab-ee` session (`fxrazor/collaborative-build-test-handoff`, `b2639f50659`) owns `build/cloudforge/**`, the stager test, and `docs/cloudforge/service-artifact.md`. This branch touched none of them.

| Check | Result |
| --- | --- |
| `node build/next/index.ts transpile`, then `scripts\test.bat --run src/vs/code/test/electron-main/cloudForgeService.test.ts`. Electron was downloaded into this worktree's `.build/electron` | 24 passing: 23 new cases and the runner's clean-state check. 0 failing |
| Mutants applied to the transpiled module, then the module was restored byte for byte: header-size bound off by one, trailing-output check removed, `-32002` mapping changed | Each mutant caused exactly 1 failing test |
| `tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` (worktree TypeScript `7.1.0-dev.20261105.1`) | Exit 0, with the new file included |
| `node --experimental-strip-types build/hygiene.ts <test file>` (oxlint and formatting) | Passed |

Observations:

- When the executable is not a valid PE image, Windows `spawn` throws synchronously. The supervisor therefore logs `SERVICE_START_FAILED`, not `SERVICE_SPAWN_FAILED`. A Node probe confirmed that start and stop return within about 180 ms, so shutdown does not hang. This is diagnostic wording only and was not changed.
- Two mutants were not completed: an inverted digest check, and ignoring a stop requested during verification. Both make the code reach `spawn` with the fixture. The first one hung the Electron runner for more than 10 minutes and was stopped. Afterwards no stray processes remained, and the module was restored.
- The Codex worktree `feature/workspace-graph-desktop` has uncommitted changes to `cloudForgeService.ts`. Rerun this test there after it rebases onto `main`.
- Not covered by these tests: a successful spawn and handshake against a real service, and lifecycle on quit or forced termination. The [installed package check](#installed-package-check-2026-11-17) covers those.

## Staged service verification gate (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\dab`, branch `fxrazor/collaborative-build-test-handoff`, based on `main` at `6f389944d1a74eecd0d0298d4a87f2e1d232bbfc`. Integration owner for this slice: this session (`dab`). It addresses next action 2: a digest recorded before signing must not reach an installer. The service protocol, runtime code, and Rust repository are unchanged.

File ownership was agreed with the concurrent `stingaree` session (branch `fxrazor/chore-test-verify-handoff`). That session owns only the new `src/vs/code/test/electron-main/cloudForgeService.test.ts`, and this slice owns only the files below. Neither changes the other's files. The `feature/workspace-graph-desktop` Codex worktree still holds uncommitted changes to `src/vs/code/electron-main/cloudForgeService.ts`. These were not touched, but they may conflict with the stingaree test when it rebases.

- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) adds `verifyStagedService` and a read-only `--verify` CLI mode. It rechecks an existing `cloudforge-service` folder. The folder must be a regular directory holding exactly the executable and `manifest.json`, with no links. The manifest must be BOM-free UTF-8 of at most 4 KiB with exactly the four runtime fields in lowercase canonical form. The executable must be nonempty and match the manifest digest. `--protocol` is required. `--sha256`, `--service-commit`, and `--desktop-commit` optionally pin the other build inputs. Stage mode, its flags, and its messages are unchanged.
- [package-win32-x64.ps1](build/cloudforge/package-win32-x64.ps1) runs `--verify` with every value pinned immediately before the Inno tasks. Any later signing pass must therefore run before this gate, or the build fails.
- The [staging guide](docs/cloudforge/service-artifact.md#verifying-a-staged-or-installed-service) and the [installer README](build/cloudforge/README.md) document the mode and the gate.

| Check (newly run in this worktree) | Result |
| --- | --- |
| `node --test build/lib/test/cloudforgeServiceArtifact.test.ts` | 64 passed, 0 skipped. This is the original 36 plus 28 verification tests. File symbolic links were permitted on this machine, so the linked-manifest and linked-executable cases ran. |
| Mutation check: remove the digest check, the required protocol comparison, the executable or manifest link check, or the manifest protocol range, drop the CLI `--sha256` or `--desktop-commit` wiring, or raise the size limit by 1 byte | Each mutation failed at least one test. The source was restored afterwards. |
| Independent review by a code-review subagent | One confirmed gap: bare `--verify` accepted any protocol while the desktop accepts only 1. It is fixed by requiring `--protocol`, with tests. The listed test gaps are also closed. |
| Strict `tsc6` (TypeScript 6.0.2 from this worktree) on the two TypeScript files; `node build/oxlint.ts` on the same files | Both passed. The full `build/tsconfig.json` check reports 19 errors, all in `build/lib/policies` files and their tests. None are in CloudForge files. |
| PowerShell parse of the packaging script; scratch run of its staging and gate commands on an inert fixture | No parse errors. The gate passed after a fresh stage and failed with exit code 1 after the staged executable was rewritten. |
| `--verify` on the real built payloads `Z:\CFStage\VSCode-win32-x64` (product `696a213e335…`) and `Z:\CFProof\VSCode-win32-x64` (product `0e5307e3c63…`), pinned to service `9ff372e…`, SHA-256 `086f96fa…`, and protocol 1 | Both passed. The run was read-only. `--protocol 2` on CFStage failed as expected. |

Not run: a full desktop build, the installer, or installed smoke. The earlier per-user install at `%LOCALAPPDATA%\Programs\CloudForge Proof` is no longer present, so the installed-folder check used the built payloads instead. The gate proves byte identity only. It does not authenticate the manifest, inspect PE architecture, or check Authenticode signatures.

Next action: when a signing step is added, run it before the pre-Inno gate, and restage after signing as the staging guide describes. On the next installed smoke, also run `--verify` against the installed `resources\app` folder.

## Windows x64 service executable validation (2026-11-17)

- Branch `codex/verify-sidecar-architecture` in `Z:\CFArch`, based on desktop `main` at `f1a8b400e6a`.
- [serviceArtifact.ts](build/cloudforge/serviceArtifact.ts) checks the AMD64 PE32+ executable headers on the supplied binary and staged copy. The pre-Inno and installed `--verify` command applies the same check. A matching SHA-256 alone can no longer admit an x86, ARM64, DLL, or malformed PE artifact.
- [cloudforgeServiceArtifact.test.ts](build/lib/test/cloudforgeServiceArtifact.test.ts) passed 73 tests. The nine new cases failed against the baseline because staging accepted their matching digests. Targeted strict TypeScript checking passed. The read-only CLI accepted the binaries in `Z:\CFProof` and `Z:\CFStage` with all expected inputs pinned. A scratch staging run with the `CFProof` binary also passed the gate. A fresh installer and installed smoke remain pending.
- The [staging guide](docs/cloudforge/service-artifact.md) describes the header checks. Before a signed release, stage the final signed bytes and run the pre-Inno verification gate on those bytes.

## Stage 2 D1: Electron-main broker (2026-11-17)

Worktree `E:\Orca\CloudForge-Code\stingaree`, branch `feature/project-repos-desktop`, based on `main` at `7d54bb08544`. This is task D1 of the [Stage 2 plan](Z:/CloudForge/docs/superpowers/plans/2026-11-17-project-repos-import.md#desktop-featureproject-repos-desktop). It is built against the Phase 0 contract on CloudForge `main` at `ae5785d`. No Rust code or protocol file changed.

- [cloudForgeServiceChannel.ts](src/vs/code/electron-main/cloudForgeServiceChannel.ts) accepts the nine Stage 2 methods. `validateCloudForgeServiceParams` checks only the parameters the extension may send:
  - `createProject`: `{ name }`.
  - `openProject`, `grantProject`, `forgetProjectAccess`, `installGit`: `{}`.
  - `inspectRepository`: `{ workspaceId, workspaceFolderIndex }`.
  - `createWorkspaceFile`, `importRepository`, `removeRepository`: ID-only parameters.

  Any `parentPath`, `projectPath`, `workspaceFolders`, or `folderPath` from the extension is rejected.
- `resolveCloudForgeRequest` adds the parameters the broker owns. It uses the calling window only:
  - `projectPath` is the folder containing the window's saved `.code-workspace`, or its single opened folder.
  - `workspaceFolders` comes from `resolveLocalWorkspace`, in window order.
  - `folderPath` is chosen by index into that list.
  - `parentPath` comes from a native single-folder picker that Electron main opens.

  The broker sends nothing to the service when:
  - the workspace is untitled, remote, or contains a non-local or UNC folder;
  - the window is empty;
  - the index is out of range;
  - the picker is cancelled.
- Contract choices for D2 to use:
  - A cancelled picker returns `CANCELLED`.
  - A window without a usable project scope returns `INVALID_STATE`.
  - A successful `createProject` result gains `workspaceFile`, a `file:` URI for the extension to open. The broker joins it only from validated single-component names, and the extension never receives the parent path any other way.
- [cloudForgeService.ts](src/vs/code/electron-main/cloudForgeService.ts):
  - The new errors map to fixed codes: `-32009` to `CONSENT_REQUIRED`, `-32010` to `ALREADY_EXISTS`, and `-32602` with kind `INVALID_PARAMS` to `INVALID_PARAMS`.
  - `call` takes a per-request timeout. `installGit` waits 11 minutes, against the service's 10-minute limit; other requests keep 30 s.
- [app.ts](src/vs/code/electron-main/app.ts) passes the workspaces and dialog main services to the broker. Its window, workspace, dialog, and service dependencies are narrow interfaces, so the tests use typed fakes and nothing is spawned.

| Check | Result |
| --- | --- |
| `pnpm run build-fast --client-only`, then `scripts\test.bat --run …/cloudForgeServiceChannel.test.ts --run …/cloudForgeService.test.ts` | 39 passing, 0 failing. Broker tests: <ul><li>a folder outside the window's list is refused;</li><li>each of two windows gets only its own paths and service;</li><li>a cancelled picker sends nothing;</li><li>unknown windows, empty, untitled, and remote workspaces are refused;</li><li>UNC and multiple picks are refused;</li><li>unsafe names in the service's reply are refused;</li><li>`installGit` gets its longer timeout;</li><li>error messages are fixed.</li></ul> |
| Five mutants on the compiled broker: extra keys accepted, remote check removed, cancel ignored, index ignored, folder-name check removed | Each mutant caused 1 or 2 failing tests. The module was restored. |
| Every Stage 2 fixture request, with broker-owned keys removed, run through `validateCloudForgeServiceParams` | 49 of 50 accepted. The rejected one, `importRepository` with empty `selections`, gets the `INVALID_PARAMS` the fixture expects from the service. The broker supplies the same parameter names as the fixtures. |
| `tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` | Exit 0. |
| `build/hygiene.ts` and `pnpm run oxlint` on the 5 changed files | Passed. |

Not done in D1:
- The renderer command `_cloudforge.callService` forwards the Stage 2 methods since the [extension slice](#stage-2-extension-slice-2026-11-17) merged. The broker's `createProject` result, `CANCELLED`, and `workspaceFolderIndex` match what that slice sends and parses (`parseCreatedProject` requires the `file:///` URI the broker returns).
- Not run in D1: the Rust service, a debug build, and the installed product.

## Stage 2 extension slice (2026-11-17)

Branch `fxrazor/project-repos-extension` in worktree `Z:\CloudForge-Code\.claude\worktrees\project-repos-extension`, based on `main` at `7d54bb08544`. It implements desktop tasks D2, D4, D5, D6, D7, and D9 from the [Stage 2 plan](Z:/CloudForge/docs/superpowers/plans/2026-11-17-project-repos-import.md#desktop-featureproject-repos-desktop) against the [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md#stage-2-projects-with-repositories) on CloudForge `main` at `ca09ef6` (Rust R1–R10 merged).

**Ownership split (assigned by the user):**

| Owner | Tasks | Files |
| --- | --- | --- |
| This branch | D2, D4, D5, D6, D7, D9 | `extensions/cloudforge/src/project/*`, `extensions/cloudforge/test/projectModel.test.ts`, the extension's manifest, strings, and `tsconfig.json`, wiring in `extension.ts`, and `src/vs/workbench/electron-browser/cloudForgeService.contribution.ts` |
| `stingaree` session, branch `feature/project-repos-desktop` | D1 (broker) | `src/vs/code/electron-main/cloudForgeService*.ts`, `app.ts`, and their tests |
| Codex, branch `codex/stage2-terraform-detection` in `Z:\CFWelcome` | D3, D8 | `extensions/cloudforge/src/terraformDetection.ts`, its test, `.vscodeignore`, `gettingStartedContent.ts` |

A cross-session message about the split was held by the `stingaree` session and expired undelivered, so this table is the record.

**What it does:**

- **Project lifecycle (D2):**
  - In a window whose workspace file, or single folder, holds `cloudforge.project.json`, the extension calls `openProject`. On `CONSENT_REQUIRED` it asks once, "Allow CloudForge to read this project and its imported repos?", then calls `grantProject`. A decline is remembered until **CloudForge: Refresh Project**.
  - **Forget Project Access**, **Open as CloudForge Project** (a project folder opened plainly), and **Set Up for Repos** (`createWorkspaceFile`, then open the workspace) are included.
  - Folder changes reconnect after a 0.5-second debounce.
- **Import (D4):**
  1. `inspectRepository` runs with a workspace folder index only.
  2. Secret findings are listed, with a warning that other agents can still read the files.
  3. You choose roots in a multi-select and name each architecture (unique, valid Windows name).
  4. `importRepository` runs with the folder's Git remote, and the first imported graph opens.
  - A stale project reloads the project.
- **Clone (D5):**
  - `cloudforge.cloneRepository` is the same command Codex's Welcome entry calls. It takes a provider argument (`github`, `gitlab`, `bitbucket`, `url`).
  - Repositories clone into `<project>\repos` with `git.clone(url, parent, { postCloneAction: 'none', returnRepositoryPath: true })`. GitHub uses the Git extension's own picker. The new folder is added to the window, and then the import offer appears.
  - Without a project, it offers **Create Project…** or **Open Project…** and continues the clone in the new window within 15 minutes. **Clone Again** re-clones a missing repository from its recorded remote.
- **Projects view (D6):** `cloudforge.projects` in Explorer shows:
  - repositories with their status and a remove action;
  - linked and local architectures, which open in the Stage 1 graph view;
  - window folders not yet imported, with an import action.

  Its empty state has GitHub, GitLab, Bitbucket, Any Git URL, and Create Project links.
- **Git (D7):** a missing Git is detected when the Git extension is enabled in settings but has no model. A modal states that installing accepts the Git for Windows license and the winget source agreement, then calls `installGit`. It reports installed (with a reload), cancelled, or falls back to the official download page.
- **Secrets (D9):** findings go to Problems under the source `CloudForge`, as warnings with the finding code, the file and line, and no values. Flagged files are kept in workspace state for CloudForge's own future AI features.
- **Bridge:** `_cloudforge.callService` forwards the nine Stage 2 methods without adding any path, and tracks the project grant: workspace ID, all architecture IDs, and each repository's folder index. `_cloudforge.openSource` resolves a linked architecture's source from its repository's workspace folder using `sourceBase`.

| Check | Result |
| --- | --- |
| `node --test extensions/cloudforge/test/projectModel.test.ts` | 8 passed. Every project, inspection, and Git result in the 18 CloudForge fixtures parses. Unsafe data is refused: credential remotes, finding values, foreign links, and bad indexes. |
| Extension type check (`tsc6 -p extensions/cloudforge`) and core type check (TypeScript 7 `tsc --project src/tsconfig.json --noEmit --skipLibCheck`) | Both passed. The TypeScript 6 core check ran out of memory at 8 GB, so TypeScript 7 was used, as in the Stage 1 tests. |
| `build/oxlint.ts` and `build/hygiene.ts` on all changed files | Passed. `code-no-accessor-after-await` caught services taken after an `await` in the bridge; this was fixed before commit. Hygiene refuses new `.mjs` files, so the test is TypeScript. Codex's `terraformDetection.test.mjs` will hit the same rule. |
| esbuild bundle of the extension | 58 KB, including all seven project modules. |

**Not done or not verified:**

- No desktop build or interactive run. The flows need D1's broker methods, which are not on `main` yet.
- The controller's Terraform check (`hasTerraform`) duplicates Codex's `findTerraformImportCandidates`. Switch to that module when both branches merge.
- `.vscodeignore` still ships `test/`. Codex's branch adds the exclusion.

## Next actions

The [Runner View design](docs/cloudforge/runner-view-design.md) is a documentation proposal based on desktop `main` at `c9f463818ef` in `Z:\CloudForge-Code`. This work adds the design and this handoff entry. The first slice would validate a saved Terraform revision offline and present the execution in the Workbench. The local links resolved and the documentation whitespace checks passed. Review the scope and name an integration owner before defining the service capability or starting implementation.

1. **Stage 2 desktop.** The [extension slice](#stage-2-extension-slice-2026-11-17) (D2, D4–D7, D9) and the [D1 broker](#stage-2-d1-electron-main-broker-2026-11-17) are merged on `main`. The extension can now reach the Stage 2 methods through Electron main.
   - **Remaining:** Codex's D3 and D8 branch (`codex/stage2-terraform-detection`).
   - **After those merge:** replace `hasTerraform` in `extensions/cloudforge/src/project/controller.ts` with `findTerraformImportCandidates`, and rename Codex's test to `.ts`. Then build, package, and run the installed smoke against the design's 12 acceptance criteria.
   - **Contract:** the [protocol's Stage 2 section](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md#stage-2-projects-with-repositories) and [fixtures](Z:/CloudForge/docs/protocol/fixtures/stage2/README.md). Broker-supplied paths (`projectPath`, `workspaceFolders`, `folderPath`, `parentPath`) come from Electron main, never from the extension.
   - **Already done on CloudForge `main`:** Phase 0 and the Rust tasks (`ae5785d`, `ca09ef6`).
2. Before a signed release, sign the service before staging. The pre-Inno `--verify` gate checks the final signed executable against the manifest digest. See the [staging guide](docs/cloudforge/service-artifact.md#signing-and-integration).

## Stage 1 merged revisions (2026-11-17)

- Desktop `main` at `b36a727d3c6529283ac82116f45d32659088b2c6` includes the Stage 1 workspace command and resource tree (`b9c551d7411`), the x64 executable validation (`60f9d09293b`), and the Tokyo Night themes and walkthrough (`696a213e335`). The theme assets retain the upstream Enkia MIT notices. The walkthrough's **Open Workspace** action uses the merged command.
- Rust `main` at `898b067fe7f4de56dcbb9bf26c905ce29a2d5b41` includes the guarded read-only service and [protocol](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md). The service stages as protocol 1 with SHA-256 `6155b5c08e5d1526f2df35701b4224af585598c95f934881aaf27e2ee0619a08`.
- Validation passed in `Z:\CFArch` and the `workspace-graph-service` worktree. Desktop client build and typecheck, extension typecheck, targeted oxlint, 26 desktop tests, 73 stager tests, 14 locked offline Rust tests, Rust formatting, and Clippy with warnings denied all passed. An RPC smoke test staged the release executable and passed the desktop handshake, graph read, cross-process grant refusal, and stale revision checks against it.
- The [Windows x64 installer](Z:/CFMerge/CloudForgeProofSetup-x64.exe) is 321,395,983 bytes with SHA-256 `b107bf51b0bddaff9b978ceabdd89b1bd571cb0d06731f2f2e93c037fe43e6ff`. The upstream native dependency metadata step stalled after the desktop payload was assembled. The supported `-UseBuiltDesktop` mode packaged that payload and verified the pinned Rust service before Inno compilation.
- Packaged-desktop smoke with a fresh profile passed for a direct Terraform root, picker cancellation, explicit nested root choice, project architecture isolation, navigation to source, byte preservation, stale source rejection, handshake, and normal sidecar exit. The user reported an earlier installation and removal, and accepted the installed smoke gate on that basis. The latest installer was verified at build time and the workbench checks ran against its packaged payload.

### Tokyo Night preview evidence

The preview installer from `Z:\CFStage\Code` at `696a213e335` was 321,099,975 bytes with SHA-256 `c89a5b30ee02acbb32b96f9ed2803b3d68a8c8ef988bce255d86db0dcb601b34`. Its portable payload in `Z:\CFStage\VSCode-win32-x64` showed the following with a fresh profile on 17 November 2026.

- Startup used Tokyo Night (editor background `#1a1b26`), and Tokyo Night Light applied `#e6e7ed`.
- The theme picker labels them Default Dark and Default Light.
- The Welcome page is otherwise unchanged and lists “Get started with CloudForge” under Walkthroughs with its four steps.
- The chat and agent panel are unchanged.

Screenshots are in the preview session scratchpad (`look-welcome.png`, `look-walkthrough.png`, `look-light.png`). The user's own installed profile had already selected Tokyo Night Light.
