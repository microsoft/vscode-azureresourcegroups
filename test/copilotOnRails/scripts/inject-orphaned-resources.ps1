#!/usr/bin/env pwsh

<#
.SYNOPSIS
Creates Azure resources during a Copilot Create Project deployment to test orphan detection.

.DESCRIPTION
Waits until the active deploy session's deploy-audit.log records a started command. The deploy
pipeline captures its inventory baseline before starting that command, so resources created by
this script should appear in deploy-result.json as orphaned.

The script creates a uniquely named resource group and a user-assigned managed identity. It never
deletes them automatically because the deployment inventory must observe them first. On completion,
it prints commands for inspecting the result and deleting the injected resource group.

.EXAMPLE
./test/copilotOnRails/scripts/inject-orphaned-resources.ps1 `
  -SessionPath .copilot-azure/sessions/abc123 `
  -SubscriptionId 00000000-0000-0000-0000-000000000000 `
  -Location westus2

.EXAMPLE
./test/copilotOnRails/scripts/inject-orphaned-resources.ps1 `
  -SessionPath .copilot-azure/sessions/abc123 `
  -SubscriptionId 00000000-0000-0000-0000-000000000000 `
  -Location westus2 `
  -WhatIf
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$SessionPath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$SubscriptionId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Location,

    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 600,

    [ValidateRange(1, 30)]
    [int]$PollIntervalSeconds = 2
)

$ErrorActionPreference = 'Stop'
$sessionPath = (Resolve-Path -LiteralPath $SessionPath).Path
$deployResultPath = Join-Path $sessionPath 'deploy-result.json'
$auditLogPath = Join-Path $sessionPath 'deploy-audit.log'

if (-not (Test-Path -LiteralPath $deployResultPath -PathType Leaf)) {
    throw "Deploy result not found at '$deployResultPath'. Start the deploy phase before running this script."
}

try {
    $deployResult = Get-Content -LiteralPath $deployResultPath -Raw | ConvertFrom-Json
} catch {
    throw "Deploy result at '$deployResultPath' is not valid JSON: $($_.Exception.Message)"
}

$sessionId = "$($deployResult.sessionId)".Trim()
if (-not $sessionId) {
    throw "Deploy result at '$deployResultPath' does not contain sessionId."
}
if ($deployResult.subscriptionId -and "$($deployResult.subscriptionId)" -ne $SubscriptionId) {
    throw "Subscription '$SubscriptionId' does not match deploy-result.json subscription '$($deployResult.subscriptionId)'."
}

& az account show --subscription $SubscriptionId --only-show-errors --output none
if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI cannot access subscription '$SubscriptionId'. Run 'az login' and retry."
}

Write-Host "Waiting for deployment command activity in '$auditLogPath'..."
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
while ($true) {
    if (Test-Path -LiteralPath $auditLogPath -PathType Leaf) {
        $audit = Get-Content -LiteralPath $auditLogPath -Raw
        if ($audit -match '(?m)\|\s*started\s*$') {
            break
        }
    }
    if ([DateTimeOffset]::UtcNow -ge $deadline) {
        throw "Timed out after $TimeoutSeconds seconds waiting for a started deployment command. No resources were created."
    }
    Start-Sleep -Seconds $PollIntervalSeconds
}

$suffix = "{0}-{1}" -f [DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'), (Get-Random -Minimum 1000 -Maximum 9999)
$resourceGroupName = "cor-orphan-test-$suffix"
$identityName = "cor-orphan-$suffix"
$target = "resource group '$resourceGroupName' and managed identity '$identityName' in '$SubscriptionId'"

if (-not $PSCmdlet.ShouldProcess($target, 'Create orphan-detection test resources')) {
    return
}

Write-Host "Creating orphan-detection resource group '$resourceGroupName'..."
& az group create `
    --name $resourceGroupName `
    --location $Location `
    --subscription $SubscriptionId `
    --tags "app-onboard-session-id=$sessionId" "test-purpose=deployment-inventory-orphan" `
    --only-show-errors `
    --output none
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create resource group '$resourceGroupName'."
}

Write-Host "Creating orphan-detection managed identity '$identityName'..."
$identityJson = & az identity create `
    --name $identityName `
    --resource-group $resourceGroupName `
    --location $Location `
    --subscription $SubscriptionId `
    --tags "app-onboard-session-id=$sessionId" "test-purpose=deployment-inventory-orphan" `
    --only-show-errors `
    --output json
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Managed identity creation failed. The resource group still exists and must be deleted manually."
    Write-Host "az group delete --name `"$resourceGroupName`" --subscription `"$SubscriptionId`" --yes --no-wait"
    throw "Failed to create managed identity '$identityName'."
}

$identity = $identityJson | ConvertFrom-Json
$cleanupCommand = "az group delete --name `"$resourceGroupName`" --subscription `"$SubscriptionId`" --yes --no-wait"
$inspectCommand = "az resource show --ids `"$($identity.id)`" --subscription `"$SubscriptionId`""

Write-Host ''
Write-Host 'Injected resources. Let the deployment finish and verify:'
Write-Host "  deploy-result.json contains '$($identity.id)' with classification 'orphaned'"
Write-Host "  orphanedResourceGroups contains '$resourceGroupName'"
Write-Host ''
Write-Host "Inspect: $inspectCommand"
Write-Host "Cleanup: $cleanupCommand"

[ordered]@{
    sessionId = $sessionId
    subscriptionId = $SubscriptionId
    resourceGroupName = $resourceGroupName
    resourceId = $identity.id
    inspectCommand = $inspectCommand
    cleanupCommand = $cleanupCommand
} | ConvertTo-Json