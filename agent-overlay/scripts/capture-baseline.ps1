#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Records the upstream hashes that drift is measured against.
#
#   pwsh ./agent-overlay/scripts/capture-baseline.ps1 `
#       -UpstreamRoot ./.agents/skills -AgentRoot ./test-output/agents -UpstreamRef "abc1234 (upstream drop)"
#
# SKILL.md Step 6 says the baseline moves only when every required check passes. That
# invariant is enforced here rather than documented, because a baseline captured over a
# failing tree silently marks broken output as the new "known good".

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $UpstreamRoot,
    [Parameter(Mandatory)] [string] $AgentRoot,
    [string] $UpstreamRef = 'unspecified',
    [string] $OverlayRoot,
    [switch] $SkipVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $OverlayRoot) { $OverlayRoot = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'overlay-common.ps1')

if (-not $SkipVerify) {
    Write-Output 'Verifying generated tree before moving the baseline...'
    & (Join-Path $PSScriptRoot 'verify-overlay.ps1') -AgentRoot $AgentRoot | Write-Output
    if ($LASTEXITCODE -ne 0) {
        Write-Output ''
        Write-Output 'REFUSED: verification failed. The baseline still points at the last good upstream.'
        exit 1
    }
    Write-Output ''
}

$files = [ordered]@{}
$count = 0
foreach ($f in Get-UpstreamFiles -UpstreamRoot $UpstreamRoot) {
    $files[$f.Rel] = $f.Hash
    $count++
}

$baseline = [ordered]@{
    '$comment'         = 'Generated state, not hand-authored config. sha256 per vendored upstream file at the last verified apply. Consumed by drift-overlay.ps1.'
    version            = '0.1.0-mockup'
    upstreamRef        = $UpstreamRef
    capturedUtc        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    overlayFingerprint = Get-OverlayFingerprint -OverlayRoot $OverlayRoot
    fileCount          = $count
    files              = $files
}

$path = Get-BaselinePath -OverlayRoot $OverlayRoot
$baseline | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8

Write-Output "baseline captured: $count upstream files"
Write-Output "upstreamRef:       $UpstreamRef"
Write-Output "fingerprint:       $($baseline.overlayFingerprint)"
Write-Output "written to:        $path"
