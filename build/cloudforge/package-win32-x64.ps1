# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See LICENSE.txt in the project root for license information.

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ServiceExecutable,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ServiceCommit,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$ServiceSha256,
    [string]$WindowsSdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64",
    [switch]$UseBuiltDesktop
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).ProviderPath
$service = (Resolve-Path -LiteralPath $ServiceExecutable).ProviderPath
$hash = (Get-FileHash -LiteralPath $service).Hash.ToLowerInvariant()
if ($hash -cne $ServiceSha256) {
    throw "The service SHA-256 is $hash. Expected $ServiceSha256."
}
if (-not (Test-Path -LiteralPath (Join-Path $WindowsSdkBin 'signtool.exe') -PathType Leaf)) {
    throw 'Pass the installed Windows SDK x64 bin directory containing signtool.exe.'
}

$oldPath = $env:PATH
Push-Location -LiteralPath $repo
try {
    $env:PATH = "$WindowsSdkBin;$oldPath"
    $productCommit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $productCommit -cnotmatch '^[0-9a-f]{40}$') {
        throw 'Could not resolve the desktop source revision.'
    }
    $changes = git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $changes) {
        throw 'Package the desktop from a clean checkout.'
    }
    $product = Get-Content -LiteralPath 'product.json' -Raw | ConvertFrom-Json
    if ($product.applicationName -ne 'cloudforge-proof' -or $product.win32VersionedUpdate) {
        throw 'This script packages the unversioned CloudForge Windows x64 proof.'
    }

    $sample = $product.builtInExtensions | Where-Object name -eq 'ms-vscode.js-debug'
    if ($sample.version -ne '1.140.1' -or $sample.vsix -ne '.build/cloudforge/ms-vscode.js-debug.1.140.1.vsix') {
        throw 'The package must declare the reviewed JavaScript Debugger VSIX.'
    }
    $vsix = Join-Path $repo $sample.vsix
    if (-not (Test-Path -LiteralPath $vsix -PathType Leaf)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $vsix) -Force | Out-Null
        Invoke-WebRequest -Uri 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.1/ms-vscode.js-debug.1.140.1.vsix' -OutFile $vsix -TimeoutSec 60
    }
    $vsixHash = (Get-FileHash -LiteralPath $vsix).Hash.ToLowerInvariant()
    if ($vsixHash -cne $sample.sha256) {
        throw "The VSIX SHA-256 is $vsixHash. Expected $($sample.sha256)."
    }

    if (-not $UseBuiltDesktop) {
        corepack pnpm run gulp vscode-win32-x64-min
        if ($LASTEXITCODE -ne 0) { throw 'CloudForge desktop packaging failed.' }
    }

    $payload = Join-Path (Split-Path -Parent $repo) 'VSCode-win32-x64'
    $app = Join-Path $payload 'resources/app'
    $packedProduct = Get-Content -LiteralPath (Join-Path $app 'product.json') -Raw | ConvertFrom-Json
    if ($packedProduct.commit -cne $productCommit -or $packedProduct.applicationName -cne $product.applicationName) {
        throw 'The staged desktop does not match the current proof checkout.'
    }

    $packedSample = Join-Path $app 'extensions/ms-vscode.js-debug'
    $sampleManifest = Get-Content -LiteralPath (Join-Path $packedSample 'package.json') -Raw | ConvertFrom-Json
    if ($sampleManifest.version -ne $sample.version -or $sampleManifest.license -ne 'MIT' -or
        -not (Test-Path -LiteralPath (Join-Path $packedSample 'LICENSE.txt') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $packedSample 'ThirdPartyNotices.txt') -PathType Leaf)) {
        throw 'The reviewed extension version or notices are missing from the desktop payload.'
    }

    # A reused desktop payload may still hold the previous run's service. Remove it only when it
    # contains exactly the files this script stages; anything else needs a fresh desktop build.
    $sidecar = Join-Path $app 'cloudforge-service'
    if (Test-Path -LiteralPath $sidecar) {
        $existing = Get-Item -LiteralPath $sidecar -Force
        if (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "The staged service path is not a regular directory: $sidecar"
        }
        $children = @(Get-ChildItem -LiteralPath $sidecar -Force)
        foreach ($child in $children) {
            if ($child.PSIsContainer -or ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                $child.Name -cnotin @('cloudforge-service.exe', 'manifest.json')) {
                throw "The staged service directory has unexpected content. Rebuild the desktop without -UseBuiltDesktop: $sidecar"
            }
        }
        foreach ($child in $children) { Remove-Item -LiteralPath $child.FullName -Force }
        Remove-Item -LiteralPath $sidecar
    }

    # The shared stager rechecks the digest and packaged desktop commit, copies the service, verifies
    # the copied bytes, and writes the runtime manifest last. Stage final (signed) service bytes.
    node build/cloudforge/serviceArtifact.ts --artifact $service --sha256 $hash --service-commit $ServiceCommit `
        --protocol 1 --desktop-commit $productCommit --app-directory $app
    if ($LASTEXITCODE -ne 0) { throw 'CloudForge service staging failed.' }

    foreach ($task in @('vscode-win32-x64-inno-updater', 'vscode-win32-x64-user-setup')) {
        corepack pnpm run gulp $task
        if ($LASTEXITCODE -ne 0) { throw "Packaging task failed: $task" }
    }

    $installer = Get-Item -LiteralPath '.build/win32-x64/user-setup/CloudForgeProofSetup-x64.exe'
    [pscustomobject]@{
        Installer = $installer.FullName
        Size = $installer.Length
        InstallerSha256 = (Get-FileHash -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
        ProductCommit = $productCommit
        ServiceCommit = $ServiceCommit
        ServiceSha256 = $hash
        VsixSha256 = $vsixHash
    } | ConvertTo-Json
}
finally {
    Pop-Location
    $env:PATH = $oldPath
}
