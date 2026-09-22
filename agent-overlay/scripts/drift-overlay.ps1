#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# `drift` mode from ../SKILL.md. Answers one question before a re-vendor:
#   "Upstream changed. Which of our rules are anchored in the text that moved?"
#
#   pwsh ./agent-overlay/scripts/drift-overlay.ps1 -UpstreamRoot ./.agents/skills
#
# This does NOT edit anything. It classifies upstream files against the last captured
# baseline and reports the rules that need a re-anchor review. Run it BEFORE apply.

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $UpstreamRoot,
    [string] $OverlayRoot,
    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $OverlayRoot) { $OverlayRoot = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'overlay-common.ps1')

$baselinePath = Get-BaselinePath -OverlayRoot $OverlayRoot
if (-not (Test-Path -LiteralPath $baselinePath)) {
    Write-Output "No baseline recorded at $baselinePath."
    Write-Output "Run apply, then capture-baseline.ps1, to establish one. Until then drift cannot be computed."
    exit 2
}

$baseline = Get-Content -LiteralPath $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
$baseFiles = @{}
foreach ($p in $baseline.files.PSObject.Properties) { $baseFiles[$p.Name] = [string]$p.Value }

$current = @{}
$destOf = @{}
foreach ($f in Get-UpstreamFiles -UpstreamRoot $UpstreamRoot) {
    $current[$f.Rel] = $f.Hash
    $destOf[$f.Rel] = $f.Dest
}

# ------------------------------------------------------------------ rule index
# Which rules have an anchor inside which generated file. Snippets name their target
# directly; checks name the file they assert over. Mechanical subs are tree-global and
# report their own UNANCHORED status at apply time, so they are listed separately.
function Convert-GlobToRegex([string] $glob) {
    $re = [regex]::Escape($glob).Replace('\*\*/', '(?:.*/)?').Replace('\*\*', '.*').Replace('\*', '[^/]*').Replace('\?', '.')
    return "^$re$"
}

$rulesByDest = @{}
function Add-RuleTarget([string] $dest, [string] $rule, [string] $via) {
    if (-not $dest -or -not $rule) { return }
    if (-not $rulesByDest.ContainsKey($dest)) { $rulesByDest[$dest] = [System.Collections.Generic.List[object]]::new() }
    if (-not ($rulesByDest[$dest] | Where-Object { $_.Rule -eq $rule -and $_.Via -eq $via })) {
        $rulesByDest[$dest].Add([pscustomobject]@{ Rule = $rule; Via = $via })
    }
}

$snippets = (Get-Content -LiteralPath (Join-Path $OverlayRoot 'snippets/snippets.json') -Raw -Encoding UTF8 | ConvertFrom-Json).snippets
foreach ($s in $snippets) { Add-RuleTarget ([string]$s.file) ([string]$s.rule) 'snippet anchor' }

$checks = (Get-Content -LiteralPath (Join-Path $OverlayRoot 'checks.json') -Raw -Encoding UTF8 | ConvertFrom-Json).checks
$globChecks = [System.Collections.Generic.List[object]]::new()
$treeWide = [System.Collections.Generic.List[object]]::new()
foreach ($c in $checks) {
    $hasFile = $c.PSObject.Properties.Name -contains 'file'
    $hasScope = $c.PSObject.Properties.Name -contains 'scope'
    if ($hasFile) { Add-RuleTarget ([string]$c.file) ([string]$c.rule) "check $($c.id)" }
    elseif ($hasScope) {
        $scope = [string]$c.scope
        # A `**` scope asserts over the whole tree, so it matches every file and tells you
        # nothing about where a rule is anchored. Attributing it per-file buries the real
        # signal under every rule at once. verify re-runs these regardless.
        if ($scope.Contains('**')) { $treeWide.Add([pscustomobject]@{ Rule = [string]$c.rule; Id = [string]$c.id; Scope = $scope }) }
        else { $globChecks.Add([pscustomobject]@{ Rule = [string]$c.rule; Id = [string]$c.id; Regex = Convert-GlobToRegex $scope }) }
    }
}

function Get-AffectedRules([string] $dest) {
    $hits = [System.Collections.Generic.List[object]]::new()
    if ($dest -and $rulesByDest.ContainsKey($dest)) { foreach ($r in $rulesByDest[$dest]) { $hits.Add($r) } }
    foreach ($g in $globChecks) {
        if ($dest -and $dest -match $g.Regex) { $hits.Add([pscustomobject]@{ Rule = $g.Rule; Via = "check $($g.Id)" }) }
    }
    return $hits
}

# ------------------------------------------------------------------- classify
$rows = [System.Collections.Generic.List[object]]::new()
foreach ($rel in ($current.Keys + $baseFiles.Keys | Sort-Object -Unique)) {
    $inBase = $baseFiles.ContainsKey($rel)
    $inCur = $current.ContainsKey($rel)

    $class =
        if ($inBase -and -not $inCur) { 'removed' }
        elseif (-not $inBase -and $inCur) { 'added' }
        elseif ($baseFiles[$rel] -ne $current[$rel]) { 'changed' }
        else { 'unchanged' }

    if ($class -eq 'unchanged') { continue }

    $dest = if ($inCur) { $destOf[$rel] } else { Get-RoutedDestination -Rel $rel }
    $affected = if ($class -eq 'added') { @() } else { Get-AffectedRules $dest }

    $rows.Add([pscustomobject]@{
            Class    = $class
            Upstream = $rel
            Rules    = (($affected | ForEach-Object { $_.Rule } | Sort-Object -Unique) -join ', ')
            Via      = (($affected | ForEach-Object { $_.Via } | Sort-Object -Unique) -join '; ')
        })
}

if ($Json) {
    [pscustomobject]@{
        baselineUpstreamRef = $baseline.upstreamRef
        baselineCapturedUtc = $baseline.capturedUtc
        rows                = $rows
    } | ConvertTo-Json -Depth 6
    exit 0
}

Write-Output "baseline: $($baseline.upstreamRef)  captured $($baseline.capturedUtc)"
Write-Output "overlay fingerprint at capture: $($baseline.overlayFingerprint)"
Write-Output "overlay fingerprint now:        $(Get-OverlayFingerprint -OverlayRoot $OverlayRoot)"
Write-Output ''

if ($rows.Count -eq 0) {
    Write-Output "No upstream drift. $($current.Count) files match the baseline."
    exit 0
}

$rows | Sort-Object Class, Upstream | Format-Table -AutoSize -Wrap Class, Upstream, Rules, Via | Out-String -Width 200 | Write-Output

$changed = @($rows | Where-Object Class -eq 'changed')
$removed = @($rows | Where-Object Class -eq 'removed')
$added = @($rows | Where-Object Class -eq 'added')
$needReview = @($rows | Where-Object { $_.Class -ne 'added' -and $_.Rules })

Write-Output ("changed {0}  added {1}  removed {2}  unchanged {3}" -f $changed.Count, $added.Count, $removed.Count, ($current.Count - $changed.Count - $added.Count))

$reviewRules = @($needReview | ForEach-Object { $_.Rules -split ', ' } | Sort-Object -Unique)
if ($reviewRules.Count -gt 0) {
    Write-Output ("rules needing re-anchor review: {0}" -f ($reviewRules -join ', '))
}
else {
    Write-Output 'rules needing re-anchor review: none - no rule is anchored in the drifted files'
}
Write-Output ("{0} tree-wide checks re-evaluate on every apply and are not listed per file." -f $treeWide.Count)

if ($removed.Count -gt 0) {
    Write-Output ''
    Write-Output "STOP: upstream deleted files that rules target. Resolve before apply."
}

exit $(if ($removed.Count -gt 0 -or $needReview.Count -gt 0) { 1 } else { 0 })
