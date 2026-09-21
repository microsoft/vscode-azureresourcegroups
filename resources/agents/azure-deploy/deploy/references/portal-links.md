# Portal Monitoring Links

Generate portal link BEFORE deploy. Deterministic deployment name makes it work before start, enabling real-time monitoring.

## Generate via PowerShell — NEVER construct manually

`%2F` encoding is critical; text generation often decodes it to `/`, breaking links. Always use `.Replace('/', '%2F')`.

```powershell
# Subscription-scope deployment
$deploymentName = "app-onboard-deploy-$("{sessionId}".Substring(0,8))"
$resId = "/subscriptions/{subscriptionId}/providers/Microsoft.Resources/deployments/$deploymentName"
$link = "https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/$($resId.Replace('/', '%2F'))"
Write-Output "LINK=$link"
```

Read `LINK=` from terminal; print URL as its own bare chat line—no backticks or markdown. Then deploy:
```powershell
az deployment sub create --name $deploymentName --subscription {subscriptionId} --location {location} --template-file infra/main.bicep --parameters @infra/main.parameters.json
```

### RG-scope (403 fallback)

Use `az deployment group create --name $deploymentName --resource-group {rg}`; include `/resourceGroups/{rg}` in `$resId`:
```powershell
$resId = "/subscriptions/{subscriptionId}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/$deploymentName"
$link = "https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/$($resId.Replace('/', '%2F'))"
Write-Output "LINK=$link"
```

For Terraform (no single ARM deployment): `https://portal.azure.com/#@{tenantId}/resource/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/activitylog`

> 💡 Resolve `{subscriptionId}` and `{resourceGroup}` from `context.json`; Terraform `{tenantId}` via `az account show --query tenantId -o tsv`.

## Same-Scope Retries vs New Names

Portal link remains valid for same-scope retries because ARM overwrites in place. Generate new name (e.g., `$deploymentName = "app-onboard-deploy-{first8}-2"`) **only** when scope or RG changes.

## Chat Output Rules

1. **Terminal command:** run PowerShell above; outputs bare URL via `Write-Output "LINK=..."`. ⛔ **Do NOT auto-open in browser**—never call `Start-Process` or any browser-launching command on portal URL. Print it for optional user opening.
2. **Read terminal output** — extract URL from line starting with `LINK=`
3. **Chat output:** paste bare URL alone—no backticks, markdown, or emoji

⛔ **Link must be ctrl+clickable.** URL MUST be line's ONLY content—no emoji, text, backticks, markdown formatting, or link syntax. Terminals auto-linkify only bare, solitary URLs.

⛔ **Emit NEW link whenever deployment name changes.** If healing redeploys with different `--name`, you MUST re-run PowerShell with new name; print new link:
```
⚠️ Previous deployment link is stale — use this one:
https://portal.azure.com/.../{newDeploymentName}
```
