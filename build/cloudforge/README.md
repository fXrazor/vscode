# CloudForge Windows installer proof

Use PowerShell 7 on Windows x64. Use the repository's pinned Node and pnpm and run `corepack pnpm install --frozen-lockfile` in this worktree. Install the C++ x64 build prerequisites and the Windows SDK listed in the baseline handoff. Use a short checkout path such as `Z:\CFProof\Code` because some native dependency builds still hit the Windows path limit.

Build `cloudforge-service.exe` from a recorded CloudForge Rust commit using that repository's locked release build. Pass the exact commit and executable SHA-256 to the installer script.

```powershell
.\build\cloudforge\package-win32-x64.ps1 -ServiceExecutable <path-to-cloudforge-service.exe> -ServiceCommit <rust-git-sha> -ServiceSha256 <exe-sha256>
```

The script verifies the service hash and fetches the [JavaScript Debugger 1.140.1 VSIX](https://github.com/microsoft/vscode-js-debug/releases/tag/v1.140.1) when the archive is absent. The upstream extension bundle checks the pinned archive digest and installs its extracted files with the MIT license and third-party notices. The Windows icon comes from `assets/branding/icon.ico` in the CloudForge Rust repository.

The script packages the desktop in the sibling `VSCode-win32-x64` directory. It then uses the [service stager](../../docs/cloudforge/service-artifact.md) to stage the executable and runtime manifest under `resources/app/cloudforge-service/`; a reused payload's previous service is replaced only if that directory holds nothing else. The script then makes the per-user Inno installer at `.build/win32-x64/user-setup/CloudForgeProofSetup-x64.exe`. It prints the installer SHA-256 and the exact desktop and service revisions. `-UseBuiltDesktop` reuses a previously assembled desktop from the current source revision. The proof installer is unsigned.

On launch, the desktop verifies the packaged service and negotiates protocol version 1 over private stdio. The desktop main log records the result. The built-in **CloudForge: Show Proof Status** command demonstrates extension activation separately. The proof carries no workspace or Terraform service methods.
