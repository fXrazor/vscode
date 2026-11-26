# CloudForge desktop repository map

Source review at Code OSS commit `a3cabfed1ada486415b1d3b4fff66bb2d47771ac`, 17 November 2026. This is an inventory and task queue for the [product handoff](../../HANDOFF.md). The service artifact stager below is implemented and tested. A separate desktop proof branch has since verified a protocol-1 handshake and installer; its source revisions and results are recorded in the handoff. That proof implementation is not included in this build-tool merge, and the wider workspace contract remains a draft.

## Ownership and source locations

| Area | Start here | CloudForge responsibility |
| --- | --- | --- |
| Product identity and defaults | [product.json](../../product.json), [product types](../../src/vs/base/common/product.ts), [Windows resources](../../resources/win32) | Product names, data directories, application/installer IDs, branding, remote endpoints, and update policy |
| Supported extension surface | [Extension API declarations](../../src/vscode-dts/vscode.d.ts), [built-in extensions](../../extensions), [API implementation](../../src/vs/workbench/api) | Bundle first-party CloudForge contributions; use existing views, commands, editors, terminal, and status APIs before patching the Workbench |
| Workbench and desktop host | [Workbench](../../src/vs/workbench), [desktop main process](../../src/vs/code/electron-main) | Reuse shell behavior and select the service lifecycle owner; sensitive domain operations remain in Rust |
| Portable package | [build/gulpfile.vscode.ts](../../build/gulpfile.vscode.ts) | Package compiled output, extensions, metadata, notices, and eventually the matching service artifact |
| Windows installer | [build/gulpfile.vscode.win32.ts](../../build/gulpfile.vscode.win32.ts), [build/win32/code.iss](../../build/win32/code.iss) | One desktop/service installer, product identity, signing, install/upgrade/uninstall checks |
| Extension sources and downloads | [build/lib/extensions.ts](../../build/lib/extensions.ts), [build/lib/builtInExtensions.ts](../../build/lib/builtInExtensions.ts) | Inventory both source-built extensions and externally sourced VSIXs, with exact versions, hashes, licenses, and provenance |
| Targeted checks | [Contributor validation guidance](../../.github/copilot-instructions.md), [Windows unit runner](../../scripts/test.bat) | Run checks for changed behavior; reserve full packaging for changes that require it |
| Rust core and protocol | [Separate service repository](https://github.com/fXrazor/CloudForge), locally [its agent instructions](Z:/CloudForge/AGENTS.md) | Workspace grants, guarded I/O, graph/parser/schema operations, credentials, managed processes, canonical `docs/protocol/` |

## Packaging findings

`packageTask` in [gulpfile.vscode.ts](../../build/gulpfile.vscode.ts) consumes compiled output and `.build/extensions`, stamps `product.json` with the source commit/version/date/checksums, includes the license and third-party notices, and passes the app files through the Electron packager. The existing portable artifact has its app under `resources/app`. Its metadata and executable hash are recorded in [HANDOFF.md](../../HANDOFF.md).

`buildWin32Setup` in [gulpfile.vscode.win32.ts](../../build/gulpfile.vscode.win32.ts) reads the packaged product metadata and maps product identity into Inno definitions for system/user installers. The `[Files]` rules in [code.iss](../../build/win32/code.iss) recursively copy the packaged tree, with explicit exclusions and a separate product metadata copy. Versioned Windows updates can add a commit prefix to the resource layout; a service path must be resolved from the actual packaged layout.

The standalone [service artifact stager](../../build/cloudforge/serviceArtifact.ts) now verifies a supplied digest and desktop commit, copies a local artifact under packaged app resources, verifies the copied bytes, and records build provenance. See [its usage and signing constraints](service-artifact.md). It is tested with inert fixtures and has no automatic packaging hook. The existing portable baseline was not changed and still contains no CloudForge service.

Existing [Windows signing steps](../../build/azure-pipelines/win32/steps/product-build-win32-sign.yml) stage the Copilot shim before signing, and [codesign.ts](../../build/azure-pipelines/win32/codesign.ts) selects executable/native files and creates signed setup packages. These are source precedents, not evidence that CloudForge's service is included, signed, started, or cleaned up. Any signing that modifies the staged service must be followed by manifest digest regeneration/verification against final bytes.

The product build must verify the service source commit, protocol version, artifact hash, and packaged location, with the final digest matching the signed bytes. Installer inclusion alone cannot supervise a running child process. The separate proof has recorded normal-exit/forced-termination cleanup and identity-mismatch checks. Preserve that verification when integrating its implementation, and extend it for the follow-on window/workspace scope.

## Product configuration and extensions

The checked [product.json](../../product.json) retains Code OSS names, data locations, Windows application IDs, and a Microsoft issue-report URL. It contains an external Webview CDN template, a default Copilot agent with GitHub service endpoints, a voice service URL, and a built-in extension auto-update list. Configuration presence does not prove those endpoints were contacted. Review the reachable feature paths and the resulting packaged configuration when defining CloudForge defaults.

There is no `extensionsGallery`, `updateUrl`, or `enableTelemetry` key in the checked product configuration. [The desktop update service](../../src/vs/platform/update/electron-main/abstractUpdateService.ts) disables its update path without the required URL/commit. [supportsTelemetry](../../src/vs/platform/telemetry/common/telemetryUtils.ts) distinguishes built-product configuration from development logging. These observations do not establish offline behavior for all extensions or features.

The three externally sourced entries currently pinned in `product.json` are `ms-vscode.js-debug-companion` 1.1.3, `ms-vscode.js-debug` 1.140.1, and `ms-vscode.vscode-js-profile-table` 1.0.11, each with a hash and repository. JSON Crack (`AykutSarac.jsoncrack-vscode`, MIT) joins them once [pinOpenVsx.ts](../../build/cloudforge/pinOpenVsx.ts) writes its Open VSX VSIX hash. This is only part of the shipped extension inventory: [extensions.ts](../../build/lib/extensions.ts) also packages source extensions. [builtInExtensions.ts](../../build/lib/builtInExtensions.ts) can consume a local VSIX, reuse a local copy, or download from GitHub/the configured gallery. A successful offline runtime test does not imply a cold build requires no downloads.

Gallery absence does not enforce the planned curated bundle. The pinned source has these separate install/enablement paths:

| Path | Source evidence | Follow-up |
| --- | --- | --- |
| Workbench local VSIX/location installation | [extensions.contribution.ts](../../src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts), command `workbench.extensions.command.installFromVSIX` and location installation | Cover local installation, not just gallery UI |
| CLI VSIX/built-in installation | [cliProcessMain.ts](../../src/vs/code/node/cliProcessMain.ts), [extensionManagementCLI.ts](../../src/vs/platform/extensionManagement/common/extensionManagementCLI.ts) | Cover `--install-extension`, `--install-builtin-extension`, and alternate profiles |
| Existing allowlist evaluation | [allowedExtensionsService.ts](../../src/vs/platform/extensionManagement/common/allowedExtensionsService.ts), [extensionManagement.ts](../../src/vs/platform/extensionManagement/common/extensionManagement.ts) | `extensions.allowed` defaults to `*`; absent effective configuration allows extensions. A user-editable default alone cannot establish a fixed product bundle |
| VSIX installation check | [node/extensionManagementService.ts](../../src/vs/platform/extensionManagement/node/extensionManagementService.ts), `install` | Reuse the existing validation seam after the product policy is settled |
| Enablement of installed user extensions | [extensionEnablementService.ts](../../src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts), allowlist check for `ExtensionType.User` | Verify already-present extensions and load behavior; review built-ins separately |

The first-release policy and tests must cover both installation and loading. The inventory does not select an enforcement mechanism or approve any candidate VSIX for redistribution.

## Task queue

| Order | Task and owner | Prerequisite | Acceptance |
| --- | --- | --- | --- |
| Done | Product handoff and source map — this documentation worktree | Recorded pinned baseline build | Root agent entry point, source/service links, inherited versus fresh evidence, scoped tasks |
| Done | Package-scoped offline baseline — earlier baseline-test context | Results inherited from the updated service handoff | Cold start, local open/edit/save, disk evidence, exit 0, and removal of temporary firewall rules recorded against the pinned package |
| Done | Service artifact stager — this product worktree | User's continuation; Node-only local build tool | Expected digest and desktop commit checked; copied bytes verified; declared provenance recorded; failures preserve existing output; tests/typecheck/lint passed |
| Done separately | Handshake-only service and installed proof — proof branches | Inherited results and exact commits in the product handoff; implementation not merged here | Protocol-1 handshake, built-in status command, installed offline edit/save, identity mismatch, and normal/forced cleanup recorded |
| 2 | Finalize the follow-on workspace contract — integration owner | Review the [canonical draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md) and preserve the verified handshake boundary | Authorized window/workspace context, typed/stale failures, bounded/redacted outputs, and lifecycle expectations agreed |
| 3 | Extend the standalone service — Rust worktree | Agreed workspace contract and implementation scope | Linked Terraform root round trip, session-only authorization without Tauri recent-history writes, path/revision/bounds tests, existing Tauri checks still passing |
| 4 | Connect a bundled CloudForge extension — extension worktree | Agreed contract and service artifact | Activation, one-root scope, a read-only graph/source operation, explicit unavailable/incompatible/stale states, lifecycle tests |
| 5 | Integrate the Windows package beyond the handshake proof — product/integration worktree | Matched desktop/service pair, product configuration, and manifest/layout reconciliation | One installer with pinned service commit/protocol/hash, approved branding/notices, offline smoke, install/upgrade/uninstall and no-orphan checks |
| 6 | Finalize curated extensions and remote defaults — product owner | Complete shipped inventory and policy decision | License/provenance/hash records, explicit update/telemetry/endpoint defaults, approved extensions working offline, install/load enforcement tests |

Tasks 2–6 describe the proposed implementation sequence; they are not completion claims or new product decisions. Licensing and extension-policy review must finish before a distributable product release. Keep Rust source and the protocol in the service repository, and preserve its dirty working tree when creating implementation worktrees.
