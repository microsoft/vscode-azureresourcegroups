# SKU Quota Validation Procedure

Pre-deploy quota/offer-restriction checks. Read in prepare Step 5.

For SKU budget tiers, modifiers, defaults, see [sku-matrix.md](sku-matrix.md).

## Quota Validation Procedure

> ⛔ **Use `az rest`, NOT `az quota list`.** `az quota list` scans all extension metadata; ANY permission error (commonly `azure-devops` WinError 5 on Windows) fails it. Built-in `az rest` bypasses extensions and calls same REST API. Quota increases are free; only used resources cost.

> ⛔ **`what-if` does NOT catch App Service quota errors.** `az deployment sub what-if` returns `Succeeded` for target SKU limit=0; rejection appears only at `az deployment sub create`. Prepare quota check is ONLY pre-deploy safety net; never skip/shortcut.

> ⛔ **Do NOT use `az vm list-usage`, `az appservice list-locations`, or `mcp_azure_mcp_quota`** for quota checks; data misleads. See [Anti-Patterns](#anti-patterns).

### Region Selection

Build scan list dynamically; do NOT hardcode regions:

1. **User's preferred region** — read `context.json.azure.region` or `context.json.overrides[]`; scan stated region first.
2. **Nearest alternates** — add 3–4 geographically close regions from global pool.
3. **If no user preference** — default to well-supported region (e.g., `eastus2`) and 4 alternates from likely geography; infer subscription tenant location or ask.

**Global region pool:** `eastus2`, `eastus`, `westus2`, `centralus`, `westeurope`, `northeurope`, `australiaeast`, `japaneast`, `southeastasia`, `brazilsouth`

> **Agent: adapt shell syntax to environment.** PowerShell shown; use bash/zsh equivalent (e.g., `for region in eastus eastus2 ...; do ... done`).

> ⛔ **PowerShell `?` in URLs:** When building `az rest` URLs with variable interpolation, PowerShell may strip `?` from `?api-version=`. Always use the URL **inline in double quotes** (as shown below), NOT via a `$url` variable. If you must use a variable, wrap the `?` with a backtick: `` `?api-version= ``.

### Per-Provider Scripts

Use `az rest` for all quota checks. Query BOTH limit AND usage (limit alone is insufficient).

**App Service:** Query quota + usages endpoints per region:
```powershell
$sub = '{subscriptionId}'; $sku = '{sku}'
@('{userRegion}','{alt1}','{alt2}','{alt3}') | ForEach-Object {
  $limit = az rest --method get --url "https://management.azure.com/subscriptions/$sub/providers/Microsoft.Web/locations/$_/providers/Microsoft.Quota/quotas/$sku?api-version=2023-02-01" --query "properties.limit.value" -o tsv 2>$null
  $used  = az rest --method get --url "https://management.azure.com/subscriptions/$sub/providers/Microsoft.Web/locations/$_/providers/Microsoft.Quota/usages/$sku?api-version=2023-02-01" --query "properties.usages.value" -o tsv 2>$null
  # limit=0 with used=-1 is the API's "SKU not offered here" sentinel — treat limit<=0 as BLOCKED and clamp negative usage so 0-(-1) does NOT become a false-positive 1.
  $ln = if ($limit) { [int]$limit } else { $null }; $un = if ($used) { [int]$used } else { 0 }
  $avail = if ($null -eq $ln) { 'unknown' } elseif ($ln -le 0) { 0 } else { $ln - [math]::Max(0, $un) }
  Write-Host "$_ : $sku limit=$limit available=$avail"
}
```

**Container Apps:** `/usages` gives usage+limit in one call:
```powershell
az rest --method get --url "https://management.azure.com/subscriptions/$sub/providers/Microsoft.App/locations/{region}/usages?api-version=2024-03-01" --query "value[?name.value=='ManagedEnvironmentCount'].{used:currentValue, limit:limit}" -o json
```

**Static Web Apps:** No `Microsoft.Quota` provider. SWA **Standard** is the floor (Free is never selected — see [sku-matrix.md](sku-matrix.md)); Standard has no per-subscription app cap to check. No quota gate needed.

**Storage** — default limit 250 accounts/region. Rarely exhausted — skip programmatic check unless the plan requires multiple storage accounts.

### Interpret Results

- `available > 0` → AVAILABLE. `available = 0` / `limit <= 0` → BLOCKED (a `limit=0`, `used=-1` response is the API sentinel for "SKU not offered in this region" — the script clamps it so it does not read as available). 404/empty → fallback candidate.
- `az rest` fails → `quotaValidation: { verified: false, method: "unverifiable" }`.

### After Checking

1. Only offer regions with **confirmed** capacity — "try anyway" on zero/unconfirmed quota is a known deploy failure.
1b. **Floor SKU missing in requested region but present elsewhere** → present BOTH, ranked by cost: (a) the floor SKU (B1 / SWA Standard / Flex Consumption) in the nearest confirmed region, (b) the cheapest available SKU IN the requested region. Both show monthly cost + an `assumptions[]` note. User picks — never silently relocate (region may be a data-residency/latency requirement).
2. **Floor SKU unavailable in ALL regions** → step down the fallback ladder to the **cheapest available** tier at or above the floor (never below B1 / SWA Standard / Flex Consumption; let live quota decide the exact SKU):
   - No option at the floor → the cheapest available higher tier the app supports. Add an `assumptions[]` note stating why (e.g., "No B1 quota in {checkedRegions}; selected {sku}").
   - All tiers exhausted → **HALT**: specify region, switch compute type, request increase at portal, or cancel.
3. Write `prepare-plan.json.quotaValidation`: `{ verified: true, method: "cli", verifiedRegion, verifiedSku, checkedRegions[], failedResources[] }`.

### Offer Restriction Check (Database Services)

> ⛔ `what-if`/`validate` do NOT catch `LocationIsOfferRestricted`. Use capabilities API.

| Provider | API Version |
|----------|-------------|
| PostgreSQL | `2022-12-01` |
| MySQL | `2023-12-30` |

```powershell
$sub = '{subscriptionId}'; $provider = 'Microsoft.DBforPostgreSQL'; $apiVer = '2022-12-01'
@('{userRegion}','{alt1}','{alt2}','{alt3}') | ForEach-Object {
  $result = az rest --method get --url "https://management.azure.com/subscriptions/$sub/providers/$provider/locations/$_/capabilities?api-version=$apiVer" --query "value[0].supportedFlexibleServerEditions[0].name" -o tsv 2>$null
  if ($result) { Write-Host "$_ : $provider AVAILABLE ($result)" } else { Write-Host "$_ : $provider BLOCKED (offer restricted)" }
}
```

> For MySQL: change `$provider = 'Microsoft.DBforMySQL'` and `$apiVer = '2023-12-30'`.

⛔ JMESPath MUST start with `value[0].`. URL MUST include `/locations/{region}/`. Empty/null response = BLOCKED. Write results to `quotaValidation.offerRestrictions[]`.

> ⛔ **Select the engine version deterministically from the capabilities payload** — match the app's detected version, upgrading only to the nearest compatible release. The payload lists supported versions at `value[0].supportedFlexibleServerEditions[0].supportedServerVersions[].name` (e.g. MySQL: `5.7`, `8.0.21`, `8.4`, `9.5`). Using the **detected DB version passed by the caller** (from `context.json.detectedServices[]`):
> 1. If the **exact detected version** (or its exact patch) is in the supported list → use it.
> 2. Else use the **lowest supported version whose major ≥ the detected major** (detected `5.7`, supported `[5.7, 8.0.21, 8.4, 9.5]` → `8.0.21`). Picking the lowest compatible major — not the newest — avoids the 60+ minute provisioning hangs seen on brand-new majors (e.g. `9.x`) and keeps compatibility with the app's driver/ORM.
> Return it in the quota output's per-service `version` field; the orchestrator copies it to `prepare-plan.json.services[].version` at plan-write (exact patch required — see [prepare-schemas.ts](prepare-schemas.ts) `version`). Record the bump in `assumptions[]` if the detected version was upgraded.

### Anti-Patterns

⛔ `az quota list` (extension failures), `az vm list-usage` (wrong layer), `az appservice list-locations` (ignores quota), `mcp_azure_mcp_quota` (misleading), `what-if`/`validate` (false positives).

## Deploy Gate Re-Validation

If `quotaValidation.verified == false` at deploy gate: re-run Per-Provider Scripts above. Pass → update quotaValidation. Fail → present alternatives. `az rest` fails → warn and proceed.

## Sub-Agent Delegation

When delegating from prepare Step 5, provide: `subscriptionId`, SKU list from `prepare-plan.json.services[].sku`, preferred region + fallbacks, list of managed database services, and this file's content. See [subagent-quota.md](subagent-quota.md) for the template.
