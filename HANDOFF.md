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

## Next actions

1. `main` now contains the verified desktop/service proof and the reconciled stager. Preserve its protocol-1 handshake scope and the canonical [service draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md); workspace and graph operations remain the follow-on slice. `feature/workspace-graph-desktop` is based on `0e5307e3c63` and can rebase onto `main` without conflicting files in `build/cloudforge/` or `build/win32/code.iss`.
2. Before a signed release, settle where the service is signed relative to staging and the recursive payload signer.
3. Keep the integration owner responsible for the desktop/service revision pair, installed smoke, and follow-on window/workspace boundary. Use separate implementation worktrees and preserve the Rust checkout's existing changes.
