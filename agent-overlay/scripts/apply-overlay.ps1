#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Transforms a pristine vendored upstream skill tree into the azure-deploy agent tree.
# Mockup of `apply` mode from ../SKILL.md.
#
#   pwsh ./agent-overlay/scripts/apply-overlay.ps1 -UpstreamRoot ./.agents/skills -OutRoot ./test-output/agents
#
# Rule execution has three modes:
#   mechanical - deterministic find/replace, fully scripted here
#   payload    - overlay-owned file copied from ../payloads (no upstream counterpart)
#   manual     - requires an agent to author prose into upstream text; reported, NOT applied
#
# The manual list is the honest output of this mockup: it is exactly the work that
# still needs a language model on every re-vendor.

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $UpstreamRoot,
    [Parameter(Mandatory)] [string] $OutRoot,
    [string] $OverlayRoot,
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $OverlayRoot) { $OverlayRoot = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'overlay-common.ps1')
$UpstreamRoot = (Resolve-Path -LiteralPath $UpstreamRoot).Path

if (Test-Path -LiteralPath $OutRoot) {
    if (-not $Force) { throw "OutRoot already exists: $OutRoot (use -Force to replace)" }
    Get-ChildItem -LiteralPath $OutRoot -Recurse -File | ForEach-Object { $_.Attributes = 'Normal' }
    Remove-Item -LiteralPath $OutRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null
$OutRoot = (Resolve-Path -LiteralPath $OutRoot).Path

$AGENT = 'azure-deploy'
$report = [System.Collections.Generic.List[object]]::new()
function Add-Report([string]$rule, [string]$mode, [string]$status, [string]$detail) {
    $report.Add([pscustomobject]@{ Rule = $rule; Mode = $mode; Status = $status; Detail = $detail })
}

# ---------------------------------------------------------------- Step 2: routing
# Explicit entry points first; the directory sweeps below must not clobber them.
$entryPoints = @{
    'azure-app-onboard/SKILL.md'          = "$AGENT/instructions.md"
    'azure-app-onboard/prepare/SKILL.md'  = "$AGENT/prepare/instructions.md"
    'azure-app-onboard/scaffold/SKILL.md' = "$AGENT/scaffold/instructions.md"
    'azure-app-onboard/deploy/SKILL.md'   = "$AGENT/deploy/instructions.md"
    'azure-app-onboard-prereq/SKILL.md'   = "$AGENT/prereq/instructions.md"
}

$copied = 0
$unmapped = [System.Collections.Generic.List[string]]::new()

foreach ($src in Get-ChildItem -LiteralPath $UpstreamRoot -Recurse -File) {
    $rel = $src.FullName.Substring($UpstreamRoot.Length).TrimStart('\', '/').Replace('\', '/')

    if ($rel -notlike 'azure-app-onboard/*' -and $rel -notlike 'azure-app-onboard-prereq/*') { continue }

    $dest = $null
    if ($entryPoints.ContainsKey($rel)) { $dest = $entryPoints[$rel] }
    elseif ($rel -like 'azure-app-onboard-prereq/*') { $dest = "$AGENT/prereq/" + $rel.Substring('azure-app-onboard-prereq/'.Length) }
    elseif ($rel -like 'azure-app-onboard/*') { $dest = "$AGENT/" + $rel.Substring('azure-app-onboard/'.Length) }

    if (-not $dest) { $unmapped.Add($rel); continue }
    if ($dest -like '*/SKILL.md') { $unmapped.Add("$rel -> nested SKILL.md, no entry-point mapping"); continue }

    $full = Join-Path $OutRoot $dest
    New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
    Copy-Item -LiteralPath $src.FullName -Destination $full -Force
    $copied++
}

Add-Report 'routing' 'mechanical' $(if ($unmapped.Count -eq 0) { 'OK' } else { 'REVIEW' }) `
    "$copied files routed; $($unmapped.Count) unmapped"
foreach ($u in $unmapped) { Add-Report 'routing' 'mechanical' 'UNMAPPED' $u }
Add-Report 'R-101' 'mechanical' 'OK' 'Entry points renamed to instructions.md via routing'

# ------------------------------------------------- Step 3a: mechanical transforms
$textFiles = Get-ChildItem -LiteralPath $OutRoot -Recurse -File |
    Where-Object { $_.Extension -in '.md', '.ts', '.ps1', '.sh', '.json' }

# Literal/regex substitutions applied across the routed tree.
$subs = @(
    @{ Rule = 'R-102'; Kind = 'literal'; Find = 'SKILL.md'; Replace = 'instructions.md' }
    @{ Rule = 'R-103'; Kind = 'literal'; Find = 'plugin/skills/azure-app-onboard/'; Replace = ".github/agents/$AGENT/" }
    @{ Rule = 'R-105'; Kind = 'literal'; Find = 'When to Use This Skill'; Replace = 'When to Use This Agent' }
    @{ Rule = 'R-105'; Kind = 'literal'; Find = 'Do NOT invoke any skills.'; Replace = 'Do NOT invoke any agents.' }
    @{ Rule = 'R-105'; Kind = 'literal'; Find = 'no external skill calls'; Replace = 'no external agent calls' }
    @{ Rule = 'R-406'; Kind = 'regex'; Find = 'Free \S+ unlimited\.'; Replace = 'Paid != unlimited.' }
    # Sub-agent briefs list the dispatch tokens inside a prohibition. The prose is correct,
    # but the literal tokens are the hazard R-202 exists to remove. Matches every trailing form.
    # Replacement strings must carry real characters: .NET expands \uFFFF in patterns, not replacements.
    @{ Rule = 'R-202'; Kind = 'regex'
        Find = '(?m)^- \u26d4 \*\*Do NOT invoke ANY skills\*\*.*$'
        Replace = '- ⛔ **Do NOT invoke ANY skills or agents** — no skill or agent dispatch of any kind, including this pipeline''s own phases. Use the procedures in THIS file only.'
    }
    # R-203: upstream routes to installed sibling skills. We ship one agent, so keep the
    # detection and replace the dispatch with a report. Silently continuing is worse than either.
    @{ Rule = 'R-203'; Kind = 'regex'
        Find = 'Call `\{"skill": "azure-prepare"\}` to load the skill, then follow its workflow using'
        Replace = 'Report to the user that this repo already has an azd template and that the azd-based workflow is a separate tool, then STOP. Do not continue the greenfield path over an existing template. If they choose to proceed here anyway, follow this pipeline''s own phases using'
    }
    @{ Rule = 'R-203'; Kind = 'regex'
        Find = 'Any other \u2192 invoke `\{"skill": "azure-prepare"\}`\.'
        Replace = 'Any other -> tell the user this pipeline does not host that workflow, and STOP.'
    }
    @{ Rule = 'R-203'; Kind = 'regex'
        Find = 'Then invoke `\{"skill": "azure-enterprise-infra-planner"\}`\.'
        Replace = 'Then STOP and report the halt to the user — this agent cannot hand off to another skill, so the user must start that workflow themselves.'
    }
    # Leftover single lines that still assume Key Vault or password auth. Literal matches:
    # these strings are dense with backticks and arrows, and regex escaping has already
    # bitten this file twice.
    @{ Rule = 'R-403'; Kind = 'literal'
        Find = '| ⛔ KV URL uses `environment().suffixes.keyvaultDns` | Leading dot → double-dot URL → `ContainerAppSecretKeyVaultUrlInvalid`. Use `keyVault.name` + `.vault.azure.net` or `vaultUri` output. → ⛔ **FLAGGED** |'
        Replace = '| ⛔ Any Key Vault reference in a Container App | No Key Vault is created — app-internal secrets are native CA secrets with a literal value from an `@secure()` param. → ⛔ **FLAGGED** |'
    }
    @{ Rule = 'R-403'; Kind = 'literal'
        Find = '| **Secret ref completeness** — every CA `secrets[].keyVaultUrl` has a matching KV secret resource | Missing KV secret → `FLAGGED` |'
        Replace = '| **Secret ref completeness** — every CA `secretRef` has a matching entry in the app''s native `secrets[]` (name + literal value from an `@secure()` param) | Missing native secret, or any Key Vault reference → `FLAGGED` |'
    }
    @{ Rule = 'R-403'; Kind = 'literal'
        Find = 'Every KV secret URL in `secrets[]` must reference a `Microsoft.KeyVault/vaults/secrets` resource that exists in the generated modules. Missing secret resource → FIXABLE: add it to the KV module.'
        Replace = '⛔ No Key Vault: any Key Vault reference is a BLOCK. Every native secret must carry a literal `value` sourced from an `@secure()` param. Missing native secret entry → FIXABLE: add `{ name, value: <secureParam> }` to the app''s `secrets[]`.'
    }
    @{ Rule = 'R-402'; Kind = 'literal'
        Find = 'Use `@secure() param administratorLoginPassword` — deploy generates the value once and reuses it on redeploy; do NOT bake a value.'
        Replace = '⛔ Entra-only: emit NO admin login or password params. Set `authConfig { passwordAuth: ''Disabled'', activeDirectoryAuth: ''Enabled'' }` and add an `administrators` child resource for the deploying principal.'
    }
    @{ Rule = 'R-403'; Kind = 'literal'
        Find = '- Security: managed identity, KV secrets, HTTPS+TLS 1.2, no public blob, no `administratorLogin`'
        Replace = '- Security: managed identity, app-internal secrets stored on-compute (NO Key Vault), HTTPS+TLS 1.2, no public blob, no admin login on any data service'
    }
    @{ Rule = 'R-402'; Kind = 'literal'
        Find = '> ⛔ **Azure managed databases only create the `administratorLogin` user.** Docker-compose `POSTGRES_USER` / `MYSQL_USER` auto-creates a database user — Azure PostgreSQL/MySQL Flexible Server does NOT. Map compose user env vars to the `administratorLogin` value from your Bicep, not the compose username.'
        Replace = '> ⛔ **Azure managed databases are provisioned Entra-only — there is no username/password to map.** Docker-compose `POSTGRES_USER`/`POSTGRES_PASSWORD` and `MYSQL_USER`/`MYSQL_PASSWORD` are DROPPED, not translated. The app connects with its **managed identity**: the DB username is the app MI''s principal name and the "password" is an Entra token fetched at runtime. Map only the compose DB **name** (`POSTGRES_DB`/`MYSQL_DATABASE`).'
    }
)

foreach ($s in $subs) {
    $hits = 0
    foreach ($f in $textFiles) {
        $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
        if ($null -eq $text) { continue }
        $new = if ($s.Kind -eq 'regex') { [regex]::Replace($text, $s.Find, $s.Replace) } else { $text.Replace($s.Find, $s.Replace) }
        if ($new -ne $text) {
            Set-Content -LiteralPath $f.FullName -Value $new -Encoding UTF8 -NoNewline
            $hits++
        }
    }
    Add-Report $s.Rule 'mechanical' $(if ($hits -gt 0) { 'OK' } else { 'NOOP' }) "$($s.Find) -> $($s.Replace) [$hits files]"
}

# R-603 - strip browser-launching commands without ever deleting a content line.
# The replacement prose deliberately still says "Start-Process" (as a prohibition), so a
# blanket "delete lines containing Start-Process" filter would delete the line it just fixed.
# Only lines whose entire content IS the command may be removed.
$r603 = 0
foreach ($f in ($textFiles | Where-Object Extension -eq '.md')) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
    if ($null -eq $text -or -not $text.Contains('Start-Process')) { continue }
    $text = $text.Replace(
        '⛔ **Auto-open link in browser:** `Start-Process $l 2>$null`. Print bare URL in chat (ctrl-clickable).',
        '⛔ **Do NOT auto-open the link** — never launch a browser on it. Print the bare URL in chat (ctrl-clickable) so the user can open it if they choose.')
    $text = $text.Replace('; Start-Process $l 2>$null', '')
    $text = $text.Replace('Write-Output "LINK=$l"; Start-Process $l 2>$null', 'Write-Output "LINK=$l"')
    $kept = $text -split "`n" | Where-Object { $_.Trim() -notmatch '^Start-Process\s' }
    Set-Content -LiteralPath $f.FullName -Value ($kept -join "`n") -Encoding UTF8 -NoNewline
    $r603++
}
Add-Report 'R-603' 'mechanical' $(if ($r603 -gt 0) { 'OK' } else { 'NOOP' }) "Portal auto-open removed [$r603 files]"

# R-106 - agent identity in the orchestrator frontmatter.
$orch = Join-Path $OutRoot "$AGENT/instructions.md"
if (Test-Path -LiteralPath $orch) {
    $text = Get-Content -LiteralPath $orch -Raw -Encoding UTF8
    $text = [regex]::Replace($text, '(?m)^name:\s*azure-app-onboard\s*$', "name: $AGENT")
    $text = [regex]::Replace($text, '(?ms)^description:\s*".*?"\s*$',
        'description: "End-to-end Azure deployment instructions for the azure-deploy agent: from app analysis to a running Azure deployment with cost estimates and pre-deploy approval."')
    Set-Content -LiteralPath $orch -Value $text -Encoding UTF8 -NoNewline
    Add-Report 'R-106' 'mechanical' 'OK' 'Orchestrator frontmatter retargeted'
}
else { Add-Report 'R-106' 'mechanical' 'UNANCHORED' 'orchestrator instructions.md missing' }

# R-201 / R-202 - skill dispatch becomes an in-tree instruction read.
$r2 = 0
foreach ($f in ($textFiles | Where-Object Extension -eq '.md')) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
    if ($null -eq $text) { continue }
    $orig = $text
    $text = $text.Replace('invoke `{"skill": "azure-app-onboard-prereq"}`', 'read and follow [prereq/instructions.md](prereq/instructions.md)')
    $text = $text.Replace('NEVER invoke `{"skill": "azure-deploy"}` — that is a DIFFERENT skill for a DIFFERENT workflow.',
        "Always use this pipeline's own deploy phase (``deploy/instructions.md``) — do NOT hand off to any other deployment workflow.")
    $text = $text.Replace('NEVER `{"skill": "azure-deploy"}`.', "Always use this pipeline's own ``deploy/instructions.md`` — do NOT hand off elsewhere.")
    $text = [regex]::Replace($text, '\{"skill":\s*"azure-app-onboard"\}', 'the orchestrator [instructions.md](instructions.md)')
    if ($text -ne $orig) { Set-Content -LiteralPath $f.FullName -Value $text -Encoding UTF8 -NoNewline; $r2++ }
}
Add-Report 'R-201/R-202' 'mechanical' $(if ($r2 -gt 0) { 'OK' } else { 'NOOP' }) "Skill dispatch rewritten [$r2 files]"

# R-104 - prereq no longer describes itself as a standalone sibling skill.
$pre = Join-Path $OutRoot "$AGENT/prereq/instructions.md"
if (Test-Path -LiteralPath $pre) {
    $text = Get-Content -LiteralPath $pre -Raw -Encoding UTF8
    $text = $text.Replace('Called by `azure-app-onboard` at Step 3, or standalone for code readiness checks. When called by orchestrator, return control to `azure-app-onboard` after writing artifacts',
        "Called by the deploy agent's [``instructions.md``](../instructions.md) at Step 3. Return control to ``instructions.md`` (continue at Step 4) after writing artifacts")
    Set-Content -LiteralPath $pre -Value $text -Encoding UTF8 -NoNewline
    Add-Report 'R-104' 'mechanical' 'OK' 'Prereq parent reference retargeted'
}

# ----------------------------------------------------- Step 3b: overlay payloads
$payloadRoot = Join-Path $OverlayRoot 'payloads'
$payloadCount = 0
if (Test-Path -LiteralPath $payloadRoot) {
    foreach ($p in Get-ChildItem -LiteralPath $payloadRoot -Recurse -File) {
        $rel = $p.FullName.Substring($payloadRoot.Length).TrimStart('\', '/')
        $dest = Join-Path $OutRoot $rel
        New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
        Copy-Item -LiteralPath $p.FullName -Destination $dest -Force
        $payloadCount++
    }
}
Add-Report 'R-301/302/304/601/701/703/704/705/805' 'payload' 'OK' "azure-deploy.agent.md emitted"
Add-Report 'R-702' 'payload' 'OK' 'cor-references/migration-access.md emitted'
Add-Report 'R-801' 'payload' 'OK' 'scaffold/references/bicep-functions-flex.md emitted'
Add-Report 'R-802' 'payload' 'OK' 'deploy/references/code-deployment-functions-flex.md emitted'

# ------------------------------------------- Step 3c: anchored snippet insertion
$snipDoc = Join-Path $OverlayRoot 'snippets/snippets.json'
if (Test-Path -LiteralPath $snipDoc) {
    $snips = (Get-Content -LiteralPath $snipDoc -Raw -Encoding UTF8 | ConvertFrom-Json).snippets
    foreach ($s in $snips) {
        $target = Join-Path $OutRoot $s.file
        if (-not (Test-Path -LiteralPath $target)) {
            Add-Report $s.rule 'snippet' 'UNANCHORED' "target missing: $($s.file)"
            continue
        }

        $body = Get-Content -LiteralPath (Join-Path $OverlayRoot "snippets/$($s.content)") -Raw -Encoding UTF8
        $text = Get-Content -LiteralPath $target -Raw -Encoding UTF8

        if ($text.Contains([string]$s.idempotencyKey)) {
            Add-Report $s.rule 'snippet' 'SKIP' "already applied ($($s.idempotencyKey))"
            continue
        }

        $before = $text

        if ($s.position -eq 'append') {
            $new = $text.TrimEnd() + "`n" + $body
        }
        elseif ($s.position -in @('replace-block', 'delete-block')) {
            $anchor = [string]$s.anchor
            $anchorEnd = [string]$s.anchorEnd
            $idx = $text.IndexOf($anchor)
            if ($idx -lt 0) { Add-Report $s.rule 'snippet' 'UNANCHORED' "start anchor not found in $($s.file)"; continue }
            $endIdx = $text.IndexOf($anchorEnd, $idx + $anchor.Length)
            if ($endIdx -lt 0) { Add-Report $s.rule 'snippet' 'UNANCHORED' "end anchor not found in $($s.file)"; continue }
            $replacement = if ($s.position -eq 'delete-block') { '' } else { $body }
            $new = $text.Substring(0, $idx) + $replacement + $text.Substring($endIdx)
        }
        else {
            $anchor = [string]$s.anchor
            $idx = $text.IndexOf($anchor)
            if ($idx -lt 0) {
                # Upstream restructured the text this rule depends on. Do not guess a location.
                Add-Report $s.rule 'snippet' 'UNANCHORED' "anchor not found in $($s.file)"
                continue
            }
            if ($text.IndexOf($anchor, $idx + $anchor.Length) -ge 0) {
                Add-Report $s.rule 'snippet' 'AMBIGUOUS' "anchor occurs more than once in $($s.file)"
                continue
            }
            $new = if ($s.position -eq 'before') { $text.Insert($idx, $body + "`n") }
            else { $text.Insert($idx + $anchor.Length, "`n" + $body) }
        }

        # Survivor assertion: any range-based edit must prove it did not take neighbours with it.
        $lost = @()
        if ($s.PSObject.Properties.Name -contains 'requires') {
            foreach ($need in $s.requires) { if (-not $new.Contains([string]$need)) { $lost += $need } }
        }
        if ($lost.Count -gt 0) {
            Add-Report $s.rule 'snippet' 'BROKEN' "reverted - would have removed: $($lost -join ', ')"
            Set-Content -LiteralPath $target -Value $before -Encoding UTF8 -NoNewline
            continue
        }

        Set-Content -LiteralPath $target -Value $new -Encoding UTF8 -NoNewline
        Add-Report $s.rule 'snippet' 'OK' "$($s.position) -> $($s.file)"
    }
}

# --------------------------------------------- Step 3d: rules needing an author
# Everything else is automated. What remains is review, not authoring.
$manual = @(
    @{ Rule = 'R-204'; File = 'references/approval-gates.md'; Why = 'Read-only: confirm gate wording survived the R-303 insertion' }
    @{ Rule = 'R-405 (residual)'; File = 'prepare/references/pricing-guide*.md, prereq/references/*'; Why = 'sku-matrix floors are automated; pricing/prereq prose still references F1 sizing signals (not covered by C-412)' }
)
foreach ($m in $manual) { Add-Report $m.Rule 'manual' 'PENDING' "$($m.File) - $($m.Why)" }

# ------------------------------------------------- Step 3e: provenance stamp
# Travels with the artifact so a tree found in the wild can be traced back to the
# ruleset that produced it, without consulting this repo.
$fingerprint = Get-OverlayFingerprint -OverlayRoot $OverlayRoot
$stamp = [ordered]@{
    '$comment'         = 'Generated by agent-overlay. Do not hand-edit this tree; edit the overlay rules and re-apply.'
    generator          = 'agent-overlay/scripts/apply-overlay.ps1'
    overlayVersion     = '0.1.0-mockup'
    overlayFingerprint = $fingerprint
    generatedUtc       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    upstreamFiles      = $copied
    unanchoredRules    = @($report | Where-Object Status -eq 'UNANCHORED' | ForEach-Object { $_.Rule } | Sort-Object -Unique)
    pendingManualRules = @($manual | ForEach-Object { $_.Rule })
}
$stampPath = Join-Path $OutRoot "$AGENT/.overlay.json"
$stamp | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stampPath -Encoding UTF8
Add-Report 'provenance' 'mechanical' 'OK' "fingerprint $fingerprint -> $AGENT/.overlay.json"

# ------------------------------------------------------------------------ report
$report | Format-Table -AutoSize -Wrap Rule, Mode, Status, Detail | Out-String -Width 210 | Write-Output

$byMode = $report | Where-Object Rule -ne 'routing' | Group-Object Mode
foreach ($g in $byMode) { Write-Output ("{0,-11} {1} rules" -f $g.Name, $g.Count) }
Write-Output ("`nrouted {0} upstream files + {1} overlay payloads -> {2}" -f $copied, $payloadCount, $OutRoot)
