# Staging the CloudForge service artifact

[serviceArtifact.ts](../../build/cloudforge/serviceArtifact.ts) is a local build tool that stages a supplied service executable into a packaged desktop and writes the runtime manifest that the desktop verifies before every launch. It does not download, execute, or build the service. The Windows proof script [package-win32-x64.ps1](../../build/cloudforge/package-win32-x64.ps1) calls it after the desktop payload is assembled and before the Inno tasks run. It is not a Gulp task.

## Inputs and usage

Run with the Node version in `.nvmrc`. `node build/cloudforge/serviceArtifact.ts --help` prints the flags. A controlled build job supplies these values:

| Required flag | Value |
| --- | --- |
| `--artifact` | Path to the service executable from the selected service build |
| `--sha256` | Expected 64-character hexadecimal digest from the trusted artifact record |
| `--service-commit` | Full 40-character service source revision from that build |
| `--protocol` | Protocol version from the canonical service contract, as a positive decimal integer without leading zeros. The proof uses `1` |
| `--desktop-commit` | Full 40-character desktop revision expected in the packaged `product.json` |
| `--app-directory` | Actual packaged app directory containing `product.json`, normally `resources/app` or the version-prefixed equivalent |

For example, a PowerShell build job can provide its selected artifact values through task-specific environment variables:

```powershell
node build/cloudforge/serviceArtifact.ts `
  --artifact "$env:CLOUDFORGE_SERVICE_ARTIFACT" `
  --sha256 "$env:CLOUDFORGE_SERVICE_SHA256" `
  --service-commit "$env:CLOUDFORGE_SERVICE_COMMIT" `
  --protocol "$env:CLOUDFORGE_PROTOCOL_VERSION" `
  --desktop-commit "$env:CLOUDFORGE_DESKTOP_COMMIT" `
  --app-directory "$env:CLOUDFORGE_PACKAGED_APP"
```

These variables must come from the selected build inputs. Recomputing a digest from an untrusted download and passing it as the expected digest does not authenticate that download. The tests use inert bytes that are never executed.

## Output and failure behavior

The tool checks the existing app directory and its product commit before making any changes. It rejects empty/non-file/symbolic-link artifacts and a mismatching SHA-256. It then reserves a new `cloudforge-service` directory exclusively, streams the copy, verifies the copied bytes again, and writes `manifest.json` last. Successful stdout is JSON containing the staged directory and manifest. Failure sets exit code 1.

The staged layout is the one `src/vs/code/electron-main/cloudForgeService.ts` loads from the app root:

```text
<packaged app>/
  product.json
  cloudforge-service/
    cloudforge-service.exe
    manifest.json
```

`manifest.json` is UTF-8 without a byte-order mark and well under the desktop's 4 KiB read limit. It contains exactly the fields the desktop verifies:

```json
{
	"serviceCommit": "<40 lowercase hex>",
	"protocolVersion": 1,
	"architecture": "x64",
	"sha256": "<64 lowercase hex>"
}
```

At startup the desktop rejects an invalid manifest, a different protocol version, or an executable whose SHA-256 differs. It then sends `serviceCommit` in `initialize` and the service rejects a different embedded commit. The tool checks the packaged desktop commit but does not record it; `product.json` already carries it. The service commit, protocol, and architecture fields are declarations: this tool does not inspect PE architecture, attest source provenance, negotiate protocol compatibility, or verify Authenticode signatures.

The proof script removes a previous `cloudforge-service` directory from a reused payload (`-UseBuiltDesktop`) only when it holds exactly `cloudforge-service.exe` and `manifest.json` and neither is a link. Any other content stops packaging unchanged.

An existing staging directory, file, or junction is rejected unchanged. A failed run removes only output files it created and attempts a nonrecursive directory removal. If another writer adds an unrelated file or claims the manifest name, that file remains and cleanup failure is reported. A later build should inspect that directory and use a fresh package rather than assuming partial output is valid.

The directory is not published atomically. The caller must await successful completion; downstream consumers must require a complete, valid manifest and verify the executable against it. Run this as a serialized packaging step against trusted build directories, not as a filesystem authorization boundary for the extension or Webview.

## Verifying a staged or installed service

`--verify` rechecks an existing `cloudforge-service` folder without changing it:

```powershell
node build/cloudforge/serviceArtifact.ts --verify --app-directory <resources/app> --protocol <n> `
  [--sha256 <digest>] [--service-commit <sha>] [--desktop-commit <sha>]
```

`--protocol` is required because the desktop launches only its own protocol version; the proof uses `1`.

It requires a regular directory holding exactly `cloudforge-service.exe` and `manifest.json`, neither a link. The manifest must be BOM-free UTF-8 JSON of at most 4 KiB with exactly the four runtime fields, lowercase hex, `architecture: "x64"`, and a positive integer protocol. The executable must be a nonempty regular file and match the manifest digest. With `--protocol` set to the desktop's version, these checks are at least as strict as the desktop's launch check. Each optional flag pins one value to the trusted build inputs; `--desktop-commit` checks the packaged `product.json`. Success prints JSON with the directory, manifest, and executable size. Any mismatch exits with code 1 and names the failed check.

The proof script runs this gate with every flag pinned immediately before the Inno tasks. Use the same command on an installed `resources\app` folder during installed smoke. Like staging, verification proves byte identity against the recorded manifest. It does not authenticate the manifest, inspect PE architecture, or check signatures.

## Signing and integration

Signing changes executable bytes. Stage final signed service bytes, or refresh and reverify the manifest against final bytes after any signing step that modifies the staged executable. The existing Windows signer can sign executables recursively, so its ordering must be resolved before adding an automatic packaging hook. A pre-sign digest must not remain in a released package after the binary changes.

The proof installer is unsigned, so the staged bytes are final. A signed release must sign `cloudforge-service.exe` before staging, or run the stager again on the signed bytes, and must keep the recursive payload signer from changing the staged executable afterwards. A pre-sign digest must not remain in a released package. The pre-Inno `--verify` gate in the proof script fails the build if the staged executable was rewritten after staging, so any signing pass must run before it.

For the `cloudforge-proof` product, [code.iss](../../build/win32/code.iss) deletes `resources/app/cloudforge-service` during a normal install or upgrade (`InstallDelete`, skipped for background updates like the other payload entries). The service is therefore replaced as a unit and no stale executable or manifest survives. Uninstall removes the installed files as before.

The [product handoff](../../HANDOFF.md#verified-windows-installer-proof) records the proof's revisions and installed checks. Staging alone establishes none of those runtime results; rerun the installed smoke after changing the packaging path.

## Validation

`node --test build/lib/test/cloudforgeServiceArtifact.test.ts` covers byte identity, the exact runtime manifest shape and size, invalid protocol versions, invalid inputs/package metadata, symbolic links and junctions, existing destinations, corrupt/interrupted copies, preservation during cleanup, concurrent staging, and CLI success/failure. Its verification suite covers a read-only pass, an executable rewritten after staging, each pinned expectation, malformed and noncanonical manifests, missing or extra files, a junction folder and a linked manifest, and the `--verify` CLI. The fixture bytes are never executed. Targeted TypeScript checking and `corepack pnpm run oxlint build/cloudforge/serviceArtifact.ts build/lib/test/cloudforgeServiceArtifact.test.ts` cover the two changed build-tool files.
