# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## CloudForge product

This fork owns the Windows Code OSS desktop, its built-in TypeScript extension, product identity, and installer. [fXrazor/CloudForge](https://github.com/fXrazor/CloudForge) owns the Rust service, workspace authorization, guarded filesystem and process operations, and the Tauri application. The Windows installer will include the matching Rust executable, and Code OSS will supervise it as a local child process.

Start with [HANDOFF.md](HANDOFF.md). In the adjacent `CloudForge` checkout, read the [foundation plan](Z:/CloudForge/docs/superpowers/plans/2026-11-16-code-oss-desktop.md), the [approved design](Z:/CloudForge/docs/superpowers/specs/2026-11-16-code-oss-cloudforge-ide-design.md), and the [canonical service protocol draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md). The protocol stays in the Rust repository. A product build records the exact service commit, protocol version, architecture, and executable SHA-256 it packages.

Use the Node and pnpm versions pinned in this checkout. Install dependencies with `corepack pnpm install --frozen-lockfile`. Follow the upstream Copilot instructions for coding, layering, and targeted verification. Keep the two build toolchains independent. Use isolated worktrees for implementation and record the repository, branch, revision, file ownership, and checks in the handoff.

Prefer supported Workbench extension contributions for the UI. Keep workspace grants, guarded reads, and sensitive operations in Rust. Product work, the service protocol, and the installer proof need the approvals recorded in the handoff. Preserve the verified upstream baseline and existing work in the adjacent Rust checkout.

## Repository routing

- The shipped CloudForge product is one installable Code OSS desktop packaged with its Rust service. The repositories are separate source boundaries, not separate installed apps.
- New desktop UI, product UX, Workbench contributions, Code OSS product configuration, and installer work belong in this repository.
- Rust service/core changes belong in the adjacent `Z:\CloudForge` repository; do not duplicate Rust authorization, filesystem, or process logic here.
- The React/Vite UI under `Z:\CloudForge\src` is the legacy Tauri fallback, not the new product shell. Changes to that UI do not appear in this Code OSS build; if an existing behavior is wanted in the shipped app, assign its implementation here explicitly.
- Follow the exact approval gate in `HANDOFF.md` and the CloudForge plan. The handshake-only installer proof is recorded as approved; this does not authorize workspace/graph operations or the full desktop product. Do not expand beyond that proof or treat the wider protocol draft as approved.
- Cross-repository work requires one named integration owner. Keep desktop and Rust implementation in separate worktrees and coordinate only through the canonical protocol and recorded revision/manifest.

## Product source map and verification

Read the [repository map](docs/cloudforge/repository-map.md) and [service artifact staging guide](docs/cloudforge/service-artifact.md) for the additional build-tool work. The absolute local links above resolve from linked worktrees as well as the main checkout. The user's current explicit instructions supersede historical approval notes.

- Check the current branch, commit, and working tree before editing. Orca can supply an isolated worktree already; reuse it. Give parallel editing agents separate worktrees and scoped files. Preserve existing changes in the service checkout.
- Keep the pinned baseline `a3cabfed1ada486415b1d3b4fff66bb2d47771ac` identifiable. Test any upstream update as a separate change.
- Use the Node version in `.nvmrc` and pnpm version in `package.json`. Install dependencies only when needed, with `corepack pnpm install --frozen-lockfile`. Never share `node_modules` across worktrees.
- Use Context7 for current library, framework, SDK, API, and CLI documentation: resolve the library ID first, then query the specific concept. Source-only review of this fork can use the pinned implementation directly.
- Follow the upstream validation guidance below. Run the smallest checks appropriate to the change; documentation work does not require rebuilding Code OSS. Distinguish newly verified results from results inherited from another handoff.
- Update `HANDOFF.md` with the branch/worktree, source revision, files changed, checks, remaining gaps, and exact next action. Product releases also record the Rust commit, protocol version, extension inventory, and installer checksum.
