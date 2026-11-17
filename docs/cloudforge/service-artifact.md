# Staging the CloudForge service artifact

[serviceArtifact.ts](../../build/cloudforge/serviceArtifact.ts) is a standalone, local build tool for staging a supplied service executable into a fresh packaged desktop. It does not download, execute, or build the service. It is not yet wired into Gulp or the installer pipeline.

## Inputs and usage

Run with the Node version in `.nvmrc`. `node build/cloudforge/serviceArtifact.ts --help` prints the flags. A controlled build job supplies these values:

| Required flag | Value |
| --- | --- |
| `--artifact` | Path to the service executable from the selected service build |
| `--sha256` | Expected 64-character hexadecimal digest from the trusted artifact record |
| `--service-commit` | Full 40-character service source revision from that build |
| `--protocol` | Declared protocol version from the canonical service contract; an opaque 1–64 character identifier |
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

These variables must come from the selected build inputs. Recomputing a digest from an untrusted download and passing it as the expected digest does not authenticate that download. No real service revision/protocol version has been assigned by this tool; tests use inert bytes and the identifier `test-only`.

## Output and failure behavior

The tool checks the existing app directory and its product commit before making any changes. It rejects empty/non-file/symbolic-link artifacts and a mismatching SHA-256. It then reserves a new `cloudforge-service` directory exclusively, streams the copy, verifies the copied bytes again, and writes `service-manifest.json` last. Successful stdout is JSON containing the staged directory and manifest. Failure sets exit code 1.

The staged layout is:

```text
<packaged app>/
  product.json
  cloudforge-service/
    cloudforge-service.exe
    service-manifest.json
```

The manifest contains build metadata schema version `1`, the fixed executable filename, `declaredTarget: "win32-x64"`, the supplied service/desktop commits and protocol identifier, and the verified SHA-256 and byte length. Its schema version is not a runtime protocol version. The source/protocol/target fields are declarations: this tool does not inspect PE architecture, attest source provenance, negotiate protocol compatibility, or verify Authenticode signatures.

An existing staging directory, file, or junction is rejected unchanged. A failed run removes only output files it created and attempts a nonrecursive directory removal. If another writer adds an unrelated file or claims the manifest name, that file remains and cleanup failure is reported. A later build should inspect that directory and use a fresh package rather than assuming partial output is valid.

The directory is not published atomically. The caller must await successful completion; downstream consumers must require a complete, valid manifest and verify the executable against it. Run this as a serialized packaging step against trusted build directories, not as a filesystem authorization boundary for the extension or Webview.

## Signing and integration

Signing changes executable bytes. Stage final signed service bytes, or refresh and reverify the manifest against final bytes after any signing step that modifies the staged executable. The existing Windows signer can sign executables recursively, so its ordering must be resolved before adding an automatic packaging hook. A pre-sign digest must not remain in a released package after the binary changes.

The separately verified handshake proof now has a service executable and a [canonical protocol draft](Z:/CloudForge/docs/protocol/cloudforge-service-v1.md). Its manifest and bundled-extension payload layout differ from this standalone helper's build metadata and staging location. Reconcile those formats before adding a product packaging hook; the helper is not a drop-in producer for the proof's runtime manifest. In particular, `resources/app/cloudforge-service/` is outside the current installer's cleanup entries, so release integration must resolve stale files on upgrade or select a payload location with the required cleanup behavior.

The [product handoff](../../HANDOFF.md#verified-windows-installer-proof) records the proof's separate revisions and installed checks. Preserve its final payload, signing/hash ordering, compatibility, offline, and process-cleanup verification when integrating the branches. Staging alone establishes none of those runtime results.

## Validation

`node --test build/lib/test/cloudforgeServiceArtifact.test.ts` covers byte identity, invalid inputs/package metadata, symbolic links and junctions, existing destinations, corrupt/interrupted copies, preservation during cleanup, concurrent staging, and CLI success/failure. The fixture bytes are never executed. Targeted TypeScript checking and `corepack pnpm run oxlint build/cloudforge/serviceArtifact.ts build/lib/test/cloudforgeServiceArtifact.test.ts` cover the two changed build-tool files.
