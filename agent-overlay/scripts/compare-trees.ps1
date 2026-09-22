#!/usr/bin/env pwsh
# Compares a generated overlay tree against the hand-built reference tree.
param(
    [string] $Reference = 'agents',
    [string] $Generated = 'test-output/agents'
)
Set-StrictMode -Version Latest
$rootA = (Resolve-Path $Reference).Path
$rootB = (Resolve-Path $Generated).Path

$fa = @{}; Get-ChildItem $rootA -Recurse -File | ForEach-Object { $fa[$_.FullName.Substring($rootA.Length + 1)] = $_.FullName }
$fb = @{}; Get-ChildItem $rootB -Recurse -File | ForEach-Object { $fb[$_.FullName.Substring($rootB.Length + 1)] = $_.FullName }

function Norm([string]$p) { $t = Get-Content -LiteralPath $p -Raw -Encoding UTF8; if ($null -eq $t) { return '' }; return ($t -replace "`r`n", "`n").TrimEnd() }

$same = 0
$diff = [System.Collections.Generic.List[string]]::new()
$onlyA = [System.Collections.Generic.List[string]]::new()
$onlyB = [System.Collections.Generic.List[string]]::new()

foreach ($k in $fa.Keys) {
    if ($fb.ContainsKey($k)) { if ((Norm $fa[$k]) -eq (Norm $fb[$k])) { $same++ } else { $diff.Add($k) } }
    else { $onlyA.Add($k) }
}
foreach ($k in $fb.Keys) { if (-not $fa.ContainsKey($k)) { $onlyB.Add($k) } }

$total = $fa.Count
Write-Output ("reference files              : {0}" -f $total)
Write-Output ("identical after overlay      : {0}  ({1:P0})" -f $same, ($same / $total))
Write-Output ("differ (manual-rule gap)     : {0}" -f $diff.Count)
Write-Output ("only in reference            : {0}" -f $onlyA.Count)
Write-Output ("only in generated            : {0}" -f $onlyB.Count)

Write-Output "`n--- differing files ---"
$diff | Sort-Object | ForEach-Object { "  $_" }
if ($onlyA.Count) { Write-Output "`n--- only in reference ---"; $onlyA | Sort-Object | ForEach-Object { "  $_" } }
if ($onlyB.Count) { Write-Output "`n--- only in generated ---"; $onlyB | Sort-Object | ForEach-Object { "  $_" } }

Write-Output "`n--- unresolved skill-dispatch sites in generated ---"
Get-ChildItem $rootB -Recurse -File -Filter *.md |
    Select-String -Pattern '\{"skill":\s*"[a-z-]+"\}' -AllMatches |
    ForEach-Object { foreach ($m in $_.Matches) { [pscustomobject]@{ Token = $m.Value; File = $_.Path.Substring($rootB.Length + 1) } } } |
    Group-Object Token | Sort-Object Count -Descending |
    ForEach-Object { '  {0,-42} x{1}' -f $_.Name, $_.Count }
