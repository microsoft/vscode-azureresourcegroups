# Deploy Safety

Deploy-phase hook safety. Block destructive operations.

## deploy-result.json Skeleton

Created by scaffold validate sub-agent. If missing at deploy Step 5b, create from [`deploy-schemas.ts`](deploy-schemas.ts) with `status: "in-progress"`. Append each healing retry to `deploymentNames[]`.

## Deploy Checklist (compaction-safe — generated at Step 5b)

> ⛔ **You MUST read [`deploy-checklist-template.md`](deploy-checklist-template.md)** at Step 5b; write checklist to `.copilot-azure/sessions/{id}/deploy-checklist.md`. Re-read it after every long-running command, failed health check, and conversation compaction.

## Finalize deploy-result.json (Step 8)

Overwrite skeleton with real values:
- `status` → `"succeeded"` or `"failed"`
- `deploymentNames` → ALL names used (initial + retries)
- `healthStatus` → worst across endpoints
- `duration.completedUtc` → now
- `resourceResults` → one entry per resource from `az deployment operation list`

## Blocked Patterns

> ⛔ **You MUST read [`blocked-patterns.md`](blocked-patterns.md)** before ANY deploy-phase `az` command. It lists forbidden commands. Blocks are non-negotiable; user runs them manually outside AppOnboard.

## 403 Scope Fallback

When `az deployment sub create` returns 403 (insufficient subscription-scope permission), do NOT halt:

1. **Restructure Bicep to RG-scope** — change `targetScope = 'subscription'` to resource-group scope; remove `Microsoft.Resources/resourceGroups`.
2. **Create RG via CLI** — `az group create -n {rg} -l {region} --tags app-onboard-skill=true app-onboard-session-id={sessionId} created-at={createdAt} environment={environmentName} deployed-by={deployedBy}`. All 5 AppOnboard tags MUST be included.
3. **Retry with `az deployment group create`** — use `--resource-group {rg}` instead of subscription scope.
4. **Regenerate portal link** for RG-scope — `$resId` includes `/resourceGroups/{rg}`: `$resId = "/subscriptions/{subscriptionId}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/$deploymentName"`. Re-run `Write-Output "LINK=$l"`; print new bare URL. ⛔ Do NOT auto-open (no `Start-Process`).
5. **If retry ALSO fails with 403** → `ENVIRONMENT_BLOCKING`. Show required role: `az role assignment create --role Contributor --assignee {user} --scope /subscriptions/{sub}/resourceGroups/{rg}`.

## Deploy Checklist

> ⛔ **Use sync shells** for persistent state. Generate **app-internal secrets only** (e.g. `SECRET_KEY`, JWT signing key, third-party API keys) at deploy; pass as `@secure()` params and store on compute (App Service app settings / Container Apps native secrets). ⛔ **No Key Vault.** ⛔ **NO database/cache/storage passwords or access keys**—those services use managed identity + token (see [database-post-deploy.md](database-post-deploy.md)). Persist app-internal secrets to `.copilot-azure/sessions/{id}/deploy-secrets.env`; generate each ONCE (URL-safe, no `/+=`), reload every later shell, pass to EVERY deployment. Never regenerate existing keys; desired-state apply would overwrite live values. File is git-ignored cross-shell reload cache. NEVER echo/log rendered secrets.
>
> ⛔ **URL-embedded app-internal secrets must be URL-safe.** Forbidden chars: `# @ / ? % : & = + ;`.
> ⛔ **`az webapp deploy` does NOT support `--track-status`.**
> ⛔ **`az rest` on Windows PowerShell:** ALWAYS include `--headers "Content-Type=application/json"`.
> ⛔ **Suppress deployment output:** Add `--query properties.provisioningState -o tsv` to deployment commands. For `az acr build`, append `--no-logs`.

## Post-Deploy Tag Verification

After deployment, verify all 5 AppOnboard tags: `az group show -n {rg} --query tags -o json`. Reapply missing via `az tag update`.

## Deployment Operation Polling

For deployments with >5 resources, poll every 30s: `az deployment operation list --name {name} --subscription {sub} --query "[?properties.provisioningState=='Failed']" -o table`. Wait for FULL completion before healing; collect ALL errors once.

## Re-Approval Gates

User-approved region, service type, or SKU changes → repeat approval gate. Resource name changes → informational only. Same-deployment retries → no re-approval.

## Antipatterns

⛔ Do NOT `az group delete --no-wait` then `az group create` with same name—5-15 min background deletion destroys new RG. Use another name or wait: `az group wait --name {rg} --deleted --timeout 900`.

## Artifact Reconciliation After Healing

After ANY healing changing deployed resources, update `prepare-plan.json`, `scaffold-manifest.json`, and `context.json` to actual state. On RG switch, immediately track orphaned RGs in `deploy-result.json.orphanedResourceGroups[]`.
