# Diagnostics PreToolUse hook (Azure project-create diagnostics)
# Records a start timestamp per tool_use_id so the PostToolUse hook can compute
# per-tool-call latency. Reads a pointer file written by the extension to locate
# the current run's runtime folder. Captures NO tool arguments or output.
#
# This is a separate, unsigned companion to track-telemetry.ps1 — it does not
# modify or replace that (signed) script.

$ErrorActionPreference = "SilentlyContinue"

function Write-Success {
    Write-Output '{"continue":true}'
    exit 0
}

# Read stdin (one complete JSON payload per invocation)
try { $rawInput = [Console]::In.ReadToEnd() } catch { Write-Success }
if ([string]::IsNullOrWhiteSpace($rawInput)) { Write-Success }
try { $inputData = $rawInput | ConvertFrom-Json } catch { Write-Success }

# tool_use_id correlates Pre/Post for the same call
$toolUseId = $inputData.tool_use_id
if (-not $toolUseId) { $toolUseId = $inputData.toolUseId }
if (-not $toolUseId) { Write-Success }

# Locate the run's runtime folder via the pointer the extension writes next to
# the hooks (this script's own directory).
$pointerPath = Join-Path $PSScriptRoot '..\.diagnostics-context.json'
if (-not (Test-Path $pointerPath)) { Write-Success }
try { $ctx = Get-Content -Raw $pointerPath | ConvertFrom-Json } catch { Write-Success }
$runtimeDir = $ctx.runtimeDir
if (-not $runtimeDir) { Write-Success }

$startsDir = Join-Path $runtimeDir 'starts'
try {
    if (-not (Test-Path $startsDir)) { New-Item -ItemType Directory -Force -Path $startsDir | Out-Null }
    # Sanitize the id for use as a file name.
    $safeId = ($toolUseId -replace '[^A-Za-z0-9_.-]', '_')
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Set-Content -Path (Join-Path $startsDir $safeId) -Value $nowMs -NoNewline
} catch { }

Write-Success
