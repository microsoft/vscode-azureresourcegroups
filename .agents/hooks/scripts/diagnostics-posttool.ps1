# Diagnostics PostToolUse hook (Azure project-create diagnostics)
# Computes per-tool-call latency (paired with diagnostics-pretool.ps1) and appends
# a metadata-only event tagged with the active phase to the run's local event log.
# Captures ONLY: tool name, phase, latency, success. No arguments, paths, or output.
#
# This is a separate, unsigned companion to track-telemetry.ps1 — it does not
# modify or replace that (signed) script.

$ErrorActionPreference = "SilentlyContinue"

function Write-Success {
    Write-Output '{"continue":true}'
    exit 0
}

try { $rawInput = [Console]::In.ReadToEnd() } catch { Write-Success }
if ([string]::IsNullOrWhiteSpace($rawInput)) { Write-Success }
try { $inputData = $rawInput | ConvertFrom-Json } catch { Write-Success }

$toolName = $inputData.tool_name
if (-not $toolName) { $toolName = $inputData.toolName }
if (-not $toolName) { Write-Success }

$toolUseId = $inputData.tool_use_id
if (-not $toolUseId) { $toolUseId = $inputData.toolUseId }

# Determine success: default true unless the payload clearly signals an error.
$success = $true
if ($inputData.PSObject.Properties.Name -contains 'is_error' -and $inputData.is_error) { $success = $false }
$toolResponse = $inputData.tool_response
if ($toolResponse -and ($toolResponse.PSObject.Properties.Name -contains 'error') -and $toolResponse.error) { $success = $false }

# Locate the run via the pointer written by the extension.
$pointerPath = Join-Path $PSScriptRoot '..\.diagnostics-context.json'
if (-not (Test-Path $pointerPath)) { Write-Success }
try { $ctx = Get-Content -Raw $pointerPath | ConvertFrom-Json } catch { Write-Success }
$runtimeDir = $ctx.runtimeDir
$sessionId = $ctx.sessionId
$phase = $ctx.phase
if (-not $runtimeDir -or -not $sessionId) { Write-Success }

# Compute latency from the paired start file, if present.
$latencyMs = -1
if ($toolUseId) {
    $safeId = ($toolUseId -replace '[^A-Za-z0-9_.-]', '_')
    $startFile = Join-Path (Join-Path $runtimeDir 'starts') $safeId
    if (Test-Path $startFile) {
        try {
            $startMs = [int64](Get-Content -Raw $startFile)
            $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $latencyMs = [Math]::Max(0, $nowMs - $startMs)
            Remove-Item -Force $startFile
        } catch { }
    }
}

# Privacy-safe hash of the target path (for churn) — never the path itself.
$targetHash = ''
$toolPath = $inputData.tool_input.path
if (-not $toolPath) { $toolPath = $inputData.tool_input.filePath }
if (-not $toolPath) { $toolPath = $inputData.tool_input.file_path }
if ($toolPath) {
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$toolPath)
        $targetHash = (([System.BitConverter]::ToString($sha.ComputeHash($bytes))) -replace '-','').Substring(0,12).ToLower()
    } catch { }
}

# Append a metadata-only JSON line to the run's event log.
try {
    if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null }
    $event = [ordered]@{
        name      = [string]$toolName
        phase     = [string]$phase
        latencyMs = $latencyMs
        success   = [bool]$success
        targetHash = [string]$targetHash
    }
    $line = ($event | ConvertTo-Json -Compress)
    $logFile = Join-Path $runtimeDir ("tool-events-" + $sessionId + ".jsonl")
    Add-Content -Path $logFile -Value $line
} catch { }

Write-Success
