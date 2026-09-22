#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Verifies that a generated azure-deploy agent tree still carries every overlay rule.
# Mockup: see ../SKILL.md. Assertions live in ../checks.json.
#
#   pwsh ./agent-overlay/scripts/verify-overlay.ps1 -AgentRoot ./resources/agents
#   pwsh ./agent-overlay/scripts/verify-overlay.ps1 -AgentRoot ./agents -Id C-4*
#   pwsh ./agent-overlay/scripts/verify-overlay.ps1 -AgentRoot ./agents -Json
#
# Exit 0 = every required check passed. Exit 1 = at least one required check failed.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $AgentRoot,

    [string] $ChecksPath,

    # Wildcard filter over check ids, e.g. 'C-4*'.
    [string] $Id = '*',

    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ChecksPath) {
    $ChecksPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'checks.json'
}

if (-not (Test-Path -LiteralPath $AgentRoot)) { throw "AgentRoot not found: $AgentRoot" }
if (-not (Test-Path -LiteralPath $ChecksPath)) { throw "checks.json not found: $ChecksPath" }

$AgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path
$checksDoc = Get-Content -LiteralPath $ChecksPath -Raw -Encoding UTF8 | ConvertFrom-Json

# Supports '<dir>/**/<leafPattern>' and plain relative paths.
function Resolve-GlobFiles {
    param([string] $Root, [string] $Pattern)

    if ($Pattern -match '^(.*?)/\*\*/(.*)$') {
        $base = Join-Path $Root $Matches[1]
        $leaf = $Matches[2]
        if (-not (Test-Path -LiteralPath $base)) { return @() }
        return @(Get-ChildItem -LiteralPath $base -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue)
    }

    return @(Get-ChildItem -Path (Join-Path $Root $Pattern) -File -ErrorAction SilentlyContinue)
}

function Read-Text {
    param([string] $Path)
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($null -eq $raw) { return '' }
    return $raw
}

function Get-Property {
    param($Object, [string] $Name)
    if ($null -eq $Object) { return $null }
    if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
    return $null
}

function To-Relative {
    param([string] $Path)
    if ($Path.StartsWith($AgentRoot)) { return $Path.Substring($AgentRoot.Length).TrimStart('\', '/') }
    return $Path
}

$results = @()

foreach ($check in $checksDoc.checks) {
    if ($check.id -notlike $Id) { continue }

    $assert = $check.assert
    $failures = [System.Collections.Generic.List[string]]::new()

    # --- Resolve the files this check applies to -----------------------------
    $targets = @()
    $scope = Get-Property $check 'scope'
    $single = Get-Property $check 'file'
    $many = Get-Property $check 'files'

    if ($single) { $targets = @((Join-Path $AgentRoot $single)) }
    elseif ($many) { $targets = @($many | ForEach-Object { Join-Path $AgentRoot $_ }) }
    elseif ($scope) { $targets = @((Resolve-GlobFiles -Root $AgentRoot -Pattern $scope) | ForEach-Object { $_.FullName }) }

    # --- noFilesMatch: the glob must resolve to nothing ----------------------
    $noFilesMatch = Get-Property $assert 'noFilesMatch'
    if ($noFilesMatch) {
        $hits = Resolve-GlobFiles -Root $AgentRoot -Pattern $noFilesMatch
        foreach ($h in $hits) { $failures.Add("unexpected file: $(To-Relative $h.FullName)") }
    }

    # --- Existence -----------------------------------------------------------
    $needsContent = ($null -ne (Get-Property $assert 'mustContain')) -or
                    ($null -ne (Get-Property $assert 'mustNotContain')) -or
                    ($null -ne (Get-Property $assert 'maxOccurrences'))

    if ((Get-Property $assert 'fileExists') -or ($needsContent -and ($single -or $many))) {
        foreach ($t in $targets) {
            if (-not (Test-Path -LiteralPath $t)) { $failures.Add("missing file: $(To-Relative $t)") }
        }
    }

    $existing = @($targets | Where-Object { Test-Path -LiteralPath $_ })

    # --- mustContain: every listed file contains every string ----------------
    # Ordinal Contains, never -like: needles routinely hold backticks and brackets,
    # which -like would interpret as escape and character-class metacharacters.
    $mustContain = Get-Property $assert 'mustContain'
    if ($mustContain) {
        foreach ($t in $existing) {
            $text = Read-Text $t
            foreach ($needle in $mustContain) {
                if (-not $text.Contains([string]$needle)) {
                    $failures.Add("missing '$needle' in $(To-Relative $t)")
                }
            }
        }
    }

    # --- mustNotContain: no file may contain any string ----------------------
    $mustNotContain = Get-Property $assert 'mustNotContain'
    if ($mustNotContain) {
        foreach ($t in $existing) {
            $text = Read-Text $t
            foreach ($needle in $mustNotContain) {
                if ($text.Contains([string]$needle)) {
                    $failures.Add("found '$needle' in $(To-Relative $t)")
                }
            }
        }
    }

    # --- maxOccurrences: idempotency-key duplication detector ----------------
    $maxOcc = Get-Property $assert 'maxOccurrences'
    if ($maxOcc) {
        foreach ($t in $existing) {
            $text = Read-Text $t
            $n = ([regex]::Matches($text, [regex]::Escape($maxOcc.text))).Count
            if ($n -gt $maxOcc.count) {
                $failures.Add("'$($maxOcc.text)' appears $n times (max $($maxOcc.count)) in $(To-Relative $t)")
            }
        }
    }

    $results += [pscustomobject]@{
        Id       = $check.id
        Rule     = $check.rule
        Severity = $check.severity
        Status   = if ($failures.Count -eq 0) { 'PASS' } elseif ($check.severity -eq 'warn') { 'WARN' } else { 'FAIL' }
        Detail   = if ($failures.Count -eq 0) { $check.description } else { ($failures -join '; ') }
    }
}

if ($Json) {
    $results | ConvertTo-Json -Depth 4
}
else {
    $results | Format-Table -AutoSize -Wrap Id, Rule, Severity, Status, Detail | Out-String -Width 200 | Write-Output
}

$failed = @($results | Where-Object Status -eq 'FAIL')
$warned = @($results | Where-Object Status -eq 'WARN')
$passed = @($results | Where-Object Status -eq 'PASS')

Write-Output ("overlay verify: {0} passed, {1} failed, {2} warnings ({3} checks)" -f `
        $passed.Count, $failed.Count, $warned.Count, $results.Count)

if ($failed.Count -gt 0) {
    Write-Output "Required rules are not satisfied. Do not report the import as complete."
    exit 1
}

exit 0
