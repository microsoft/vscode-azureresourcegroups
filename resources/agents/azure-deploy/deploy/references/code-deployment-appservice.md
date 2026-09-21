# Code Deployment — App Service (and Premium/EP1 Functions)

After IaC creates Azure resources, deploy app code.

> ⛔ **Functions on Flex Consumption (default Functions floor) do NOT use this SCM/Kudu path.** They use a blob-container package channel without `basicPublishingCredentialsPolicies`; use [code-deployment-functions-flex.md](code-deployment-functions-flex.md). This file covers App Service web apps and only **Premium (EP1)** Functions.

> ⛔ **`--subscription {subscriptionId}` on EVERY `az` command.**

> ⛔ **Verify `SCM_DO_BUILD_DURING_DEPLOYMENT=true` BEFORE deploy.** ARM propagation may lag. Check: `az webapp config appsettings list -g {rg} -n {app} --query "[?name=='SCM_DO_BUILD_DURING_DEPLOYMENT'].value" -o tsv`. If not `true`: `az webapp config appsettings set -g {rg} -n {app} --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true ENABLE_ORYX_BUILD=true`. Wait 10s. If `az webapp deploy` reports "Build successful. Time: 0(s)", Oryx was skipped—use Kudu zipdeploy.

> ⛔ Bicep app settings must include **`ORYX_DISABLE_COMPRESSION=true`** and **`WEBSITES_CONTAINER_START_TIME_LIMIT=1800`** (from `prepare-plan.json.deployStrategy.requiredAppSettings`).

## Pre-Deploy Verification (Step 6a)

> ⛔ **TypeScript:** Oryx with `NODE_ENV=production` skips devDependencies. Before zipdeploy, move `typescript`, `@types/*`, or build tools from `devDependencies` to `dependencies`; alternatively set `NPM_CONFIG_PRODUCTION=false` for Oryx devDep installation.

> ⛔ **Wait for App Service stabilization** (fresh B1 plan: ~30-90s cold start). Poll `az webapp show -g {rg} -n {app} --query state` every 10s, max 2 min. If not `Running`, check logs.

For `deployStrategy.codeDeployPattern == "startup-install"`, show: "⚠️ First cold start: 2-5 min (native module compilation)."

## Zip Deploy (Step 6b)

SCM lifecycle: enable → deploy → re-disable.

**Enable SCM:**
```powershell
az rest --method put --url "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}/basicPublishingCredentialsPolicies/scm?api-version=2023-12-01" --headers "Content-Type=application/json" --body '{"properties":{"allow":true}}'
```

**Choose deploy method:**

| Runtime | Needs Oryx? | Method |
|---|---|---|
| Python, Node.js, Ruby, PHP | Yes | **Kudu zipdeploy** (`/api/zipdeploy`) |
| .NET, Java, static front-end | No | `az webapp deploy --type zip` |

⛔ **OneDeploy NEVER triggers Oryx** — use Kudu zipdeploy for runtimes needing server-side install.
⛔ **NEVER use `az webapp deployment source config-zip`** — deprecated.
⛔ **`az webapp deploy` does NOT support `--track-status`.**

### Kudu Zipdeploy (Oryx-Dependent Runtimes)

For server-side package installation (Python, Node.js, Ruby, PHP), use Kudu zipdeploy:

```powershell
# Get publishing credentials
$creds = az webapp deployment list-publishing-credentials --subscription {sub} -g {rg} -n {app} --query "{user:publishingUserName, pass:publishingPassword}" -o json | ConvertFrom-Json
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($creds.user):$($creds.pass)"))

# Deploy via Kudu zipdeploy (triggers Oryx pip install)
Invoke-WebRequest -Uri "https://{app}.scm.azurewebsites.net/api/zipdeploy?isAsync=true" -Method POST -InFile $zipPath -Headers @{Authorization="Basic $auth"} -ContentType "application/zip" -UseBasicParsing

# Poll until build completes
for ($i = 1; $i -le 40; $i++) {
  Start-Sleep -Seconds 15
  $resp = Invoke-WebRequest -Uri "https://{app}.scm.azurewebsites.net/api/deployments/latest" -Headers @{Authorization="Basic $auth"} -UseBasicParsing
  $deploy = $resp.Content | ConvertFrom-Json
  if ($deploy.complete -eq $true) { break }
}
```

Prerequisites:
- `SCM_DO_BUILD_DURING_DEPLOYMENT=true` set (verified in Step 6a)
- Runtime manifest at zip root—Oryx detects runtime from it:
  - Python: `requirements.txt` (or `pyproject.toml`)
  - Node.js: `package.json` (+ lockfile)
  - Ruby: `Gemfile`
  - PHP: `composer.json`
- Do NOT pre-install locally—let Oryx install remotely

> **SCM auth lifecycle (REST API toggle — no Bicep edits):**
>
> IaC has `scm.allow: true` for deploy. Deploy phase:
> Deploy code → health check → re-disable via REST API → verify `false`.
> If re-disable fails, log without blocking; add postDeployRecommendation.

**Zip creation:** Use `System.IO.Compression.ZipFile` with workspace-root-relative paths. **On Windows, normalize entries: `$entryName = $relativePath.Replace('\', '/')`—ZipFile preserves backslashes Linux App Service cannot resolve.** Never use `Compress-Archive -Path $files.FullName`—absolute paths flatten directories, crashing apps (`./src/app` not found).

## Database Post-Deploy Verification

> ⛔ **You MUST read [`database-post-deploy.md`](database-post-deploy.md)** for migration discovery, App Service SSH execution, error handling, and PostgreSQL checks.
