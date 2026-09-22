#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Shared helpers for the overlay scripts.
#
# Routing and file selection live here because apply and drift MUST agree on which
# upstream files are in scope. If they diverge, drift silently stops reporting on a
# file that apply is still transforming.

Set-StrictMode -Version Latest

$script:UpstreamPrefixes = @('azure-app-onboard/', 'azure-app-onboard-prereq/')

# Entry points are renamed (R-101); everything else keeps its relative path.
$script:EntryPoints = @{
    'azure-app-onboard/SKILL.md'          = 'azure-deploy/instructions.md'
    'azure-app-onboard/prepare/SKILL.md'  = 'azure-deploy/prepare/instructions.md'
    'azure-app-onboard/scaffold/SKILL.md' = 'azure-deploy/scaffold/instructions.md'
    'azure-app-onboard/deploy/SKILL.md'   = 'azure-deploy/deploy/instructions.md'
    'azure-app-onboard-prereq/SKILL.md'   = 'azure-deploy/prereq/instructions.md'
}

function Get-RoutedDestination {
    param([Parameter(Mandatory)][string] $Rel)

    if ($script:EntryPoints.ContainsKey($Rel)) { return $script:EntryPoints[$Rel] }
    if ($Rel -like 'azure-app-onboard-prereq/*') { return 'azure-deploy/prereq/' + $Rel.Substring('azure-app-onboard-prereq/'.Length) }
    if ($Rel -like 'azure-app-onboard/*') { return 'azure-deploy/' + $Rel.Substring('azure-app-onboard/'.Length) }
    return $null
}

function Get-UpstreamFiles {
    param([Parameter(Mandatory)][string] $UpstreamRoot)

    $root = (Resolve-Path -LiteralPath $UpstreamRoot).Path
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName) {
            $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
            $inScope = $false
            foreach ($p in $script:UpstreamPrefixes) { if ($rel.StartsWith($p, [System.StringComparison]::Ordinal)) { $inScope = $true; break } }
            if (-not $inScope) { continue }

            $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($f.FullName))).Replace('-', '').ToLowerInvariant()
            [pscustomobject]@{ Rel = $rel; Hash = $hash; Dest = Get-RoutedDestination -Rel $rel }
        }
    }
    finally { $sha.Dispose() }
}

# Identifies the overlay ruleset that produced a tree. Changing any rule, snippet,
# check, or the apply script itself changes this value.
function Get-OverlayFingerprint {
    param([Parameter(Mandatory)][string] $OverlayRoot)

    $files = Get-ChildItem -LiteralPath $OverlayRoot -Recurse -File |
        Where-Object { $_.Extension -in '.md', '.json', '.ps1', '.ts', '.txt' } |
        Where-Object { $_.Name -ne 'baseline.json' } |
        Sort-Object { $_.FullName.Substring($OverlayRoot.Length).Replace('\', '/') }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $acc = [System.Text.StringBuilder]::new()
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($OverlayRoot.Length).TrimStart('\', '/').Replace('\', '/')
            $h = [System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($f.FullName))).Replace('-', '')
            [void]$acc.Append($rel).Append(':').Append($h).Append("`n")
        }
        $final = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($acc.ToString()))
        return [System.BitConverter]::ToString($final).Replace('-', '').ToLowerInvariant().Substring(0, 16)
    }
    finally { $sha.Dispose() }
}

function Get-BaselinePath {
    param([Parameter(Mandatory)][string] $OverlayRoot)
    return (Join-Path $OverlayRoot 'baseline.json')
}
