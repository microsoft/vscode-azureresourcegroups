# Bicep Patterns

Default AppOnboard scaffold Bicep patterns; primary IaC format. Terraform path (existing `.tf` or user override) uses `mcp_azure_mcp_azureterraformbestpractices` output patterns.

> **Source:** Adapted from Azure [Bicep best practices](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/best-practices).

## File Structure

> ⛔ **Always use `targetScope = 'subscription'`.** Subscription-scope Bicep creates resource group with all 5 AppOnboard tags, including `created-at`. Resource-group scope needs `az group create`, which misses `created-at` because CLI groups lack IaC-managed tags. AppOnboard gains nothing from resource-group scope.

```
infra/
├── main.bicep              # Entry point (subscription scope)
├── main.parameters.json    # ARM JSON parameter values (NOT .bicepparam)
└── modules/
    ├── container-app.bicep
    ├── app-service.bicep
    ├── sql-database.bicep
    ├── key-vault.bicep
    ├── log-analytics.bicep
    └── ...
```

Give each service a module. `main.bicep` orchestrates resource group creation + modules.

## main.bicep Skeleton

```bicep
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param environmentName string

@minLength(1)
param location string

param sessionId string

param deployedBy string   // resolved via: az ad signed-in-user show --query displayName -o tsv

// ⛔ createdAt: passed in parameters.json, NOT utcNow() default (crashes Portal blade)
param createdAt string

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// ⛔ scope: rg (symbolic) — creates implicit dependsOn. Do NOT use resourceGroup(name) — it races against RG creation.
module resources './modules/resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
    tags: tags
  }
}
```

## main.parameters.json

> ⛔ **ARM JSON only.** Do NOT use `.bicepparam` syntax (`using`, `param`, `readEnvironmentVariable()`). AppOnboard uses `az deployment sub create`, not `azd`; `.bicepparam` needs azd or newer tooling. Without subscription permissions, deploy automatically falls back to `az deployment group create`.

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "environmentName": { "value": "{project}-{env}" },
    "location": { "value": "{region}" },
    "sessionId": { "value": "{context.json.sessionId}" },
    "deployedBy": { "value": "{context.json.azure.userDisplayName}" }
  }
}
```

## Naming Convention (Bicep)

Prepare generates logical prefix in `prepare-plan.json.naming.resourcePrefix` (e.g., `myapp-dev`). Scaffold MUST add globally unique Bicep `uniqueString()` suffix to prevent cross-deployment collisions for App Service, Storage Account, ACR.

```bicep
// main.bicep — derive unique suffix from resource group
var nameSuffix = uniqueString(resourceGroup().id)

// Pass unique names to modules
param appName string = 'app-${resourcePrefix}-${take(nameSuffix, 4)}'
param storName string = 'st${replace(resourcePrefix, '-', '')}${take(nameSuffix, 4)}'
param acrName string = 'cr${replace(resourcePrefix, '-', '')}${take(nameSuffix, 4)}'
```

> ⛔ **Do NOT use `uniqueString()` for secrets**; deterministic and predictable. See [bicep-patterns-security.md](bicep-patterns-security.md) § Secrets.

Prefer pre-computed suffixed names from `prepare-plan.json.naming.resources[]`, but ALWAYS ensure global names include `uniqueString()` or equivalent hash in main.bicep.

## Log Analytics Module Output

> ⛔ **Output resource ID (`.id`), NOT `.properties.customerId`.** Container Apps Environment requires full ARM `workspaceResourceId`; `.properties.customerId` is query GUID. Passing GUID as `workspaceResourceId` causes ARM `BadRequest`. Separate outputs:
> ```bicep
> output workspaceId string = logAnalyticsWorkspace.id                          // ARM resource ID — for CAE, App Insights
> output workspaceCustomerId string = logAnalyticsWorkspace.properties.customerId // GUID — for Log Analytics queries only
> ```

## Compute-Target Patterns

Read the file(s) matching the service mapping — load only what's needed:
- **Functions on Flex Consumption** (the default Functions floor): [bicep-functions-flex.md](bicep-functions-flex.md) — `functionAppConfig`, MI-based deployment storage, forbidden App Service settings. ⛔ Do NOT use the App Service module for a Flex function app.
- **App Service (and Functions on Premium/EP1):** [bicep-app-service.md](bicep-app-service.md) — module template, SCM/FTP auth, native module deploy strategy
- **Container Apps:** [bicep-container-apps.md](bicep-container-apps.md) — two-phase ACR wiring, ingress, secretRef, image parameter, multi-container DNS
- **Static Web Apps:** [bicep-swa.md](bicep-swa.md) — module template, detached deploy rule

Load multiple only if the plan includes multiple compute targets.

> ⛔ **F1/D1 SKU: do NOT generate a Dockerfile.** If `prepare-plan.json` specifies F1 or D1 (free/shared tier), use the platform's built-in runtime stack (e.g., `NODE|20-lts` for Node.js, `PYTHON|3.12` for Python). Dockerfiles are for B1+ or Container Apps only.

> ⛔ **Native module deploy strategy.** If `prepare-plan.json.deployStrategy` exists, read [bicep-app-service.md § Native Module Deploy Strategy](bicep-app-service.md) and apply the startup command + app settings. `deployStrategy.startupCommand` → `appCommandLine`, `deployStrategy.requiredAppSettings` → `appSettings[]`. When no `deployStrategy` exists, do NOT set `appCommandLine`.

## Cross-Origin (CORS) Between Frontend and Backend

> ⛔ **If the frontend is served from a different hostname than the API, the API MUST declare the frontend
> origin.** A Static Web App calling a Function App / App Service is *always* cross-origin — different
> hostname means different origin, so the browser sends a preflight `OPTIONS` and blocks the response
> unless the API returns `Access-Control-Allow-Origin`. A backend deployed with no `cors` block fails
> **every** browser call with:
> `No 'Access-Control-Allow-Origin' header is present on the requested resource`.
> The API works fine from `curl` and from the portal test console, so this surfaces only in the browser.

> ⛔ **Local success proves nothing here.** `local.settings.json` has `"Host": { "CORS": "*" }`, but that
> file configures the **local Functions emulator only** — it is git-ignored and never deployed. F5 working
> is not evidence that the deployed API allows the deployed frontend.

Emit `cors` on the backend's `siteConfig`, alongside the frontend resource in the same module:

```bicep
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  properties: {
    siteConfig: {
      cors: {
        // staticSites → `defaultHostname`; the value has no scheme, so add https://
        allowedOrigins: [ 'https://${staticWebApp.properties.defaultHostname}' ]
        supportCredentials: false
      }
    }
  }
}
```

When the frontend and backend are in **different modules**, pass the origin instead of referencing across.
Guard with `empty()` so the same module still compiles for an API with no browser frontend:

```bicep
// api module
param allowedOrigin string = ''
...
    siteConfig: {
      cors: {
        allowedOrigins: empty(allowedOrigin) ? [] : [ allowedOrigin ]
        supportCredentials: false
      }
    }

// frontend module
output defaultHostname string = staticWebApp.properties.defaultHostname

// main.bicep
module api './modules/api.bicep' = {
  params: { allowedOrigin: 'https://${frontend.outputs.defaultHostname}' }
}
```

> ⛔ **A symbolic reference only compiles inside the file that declares it.** `staticWebApp.properties...`
> fails `bicep build` with **`BCP057: The name "staticWebApp" does not exist in the current context`**
> whenever the SWA lives in another module — or when there is no frontend at all. Use the direct reference
> only in the file that declares both; otherwise use the `allowedOrigin` param form above. For an API with
> no browser frontend, leave `allowedOrigin` empty (or omit `cors` entirely).

> ⛔ **Property casing differs by resource type.** `Microsoft.Web/staticSites` exposes
> `properties.defaultHostname` (lowercase **n**); `Microsoft.Web/sites` exposes `properties.defaultHostName`
> (capital **N**). Using the wrong one fails at `bicep build` — verify against the resource you are actually
> referencing when the frontend is an App Service rather than a SWA.

> ⛔ **`allowedOrigins: ['*']` cannot be combined with `supportCredentials: true`** — Azure rejects the pair.
> Always emit the explicit origin; it is required anyway the moment cookie or bearer auth is added, and it
> avoids re-work. Include any custom domain as an additional entry when one is configured.

**No dependency cycle.** The frontend receives the API URL at **build** time (`VITE_API_BASE_URL` /
`NEXT_PUBLIC_API_URL`, baked into the bundle from `deploy-result.json.endpoints[]` — see
[deploy-checklist-template.md](../../deploy/references/deploy-checklist-template.md)), so the frontend
resource never references the backend in Bicep. The backend may therefore reference the frontend hostname
freely. Do **not** add the API URL to the SWA resource to "pair" them — that is what creates a cycle.

**Alternative that removes CORS entirely:** linking an existing Function App as an SWA backend makes the
frontend call `/api/*` on its own origin, so no preflight occurs. This is allowed only when
`context.json.overrides[]` records explicit user approval for `linkFunctionsToStaticWebApp`. The Function
App remains a separate resource and uses the Functions deployment channel. Never move or copy its source
into an SWA API directory, emit SWA `buildProperties.apiLocation`, or change the backend's runtime or
authentication provider to `azureStaticWebApps`.

**Self-review check:** If the plan has a browser frontend AND a separate HTTP API resource, verify the API's
`siteConfig.cors.allowedOrigins` contains the frontend origin. **FLAGGED** if absent — the app will deploy
successfully and then fail on first use.

## Service Tagging

> ⛔ **You MUST read [iac-generation-rules.md § Session Tags](iac-generation-rules.md).** All resources MUST include the 5 AppOnboard session tags. Pass `tags` object from `main.bicep` into every module.

## API Version Policy

Use the latest stable API version for each resource type. Never use preview APIs unless required for a feature with no GA alternative. Validate via `bicep build` — stale API versions produce warnings.

## App-Internal Secret Syntax (No Key Vault)

⛔ **No Key Vault is created.** App-internal secrets (e.g. `SECRET_KEY`) are stored on the compute resource from an `@secure()` param at deploy time. App Service → `siteConfig.appSettings`; Container Apps → native `secrets: [{ name, value }]` + `secretRef` (see [bicep-container-apps.md](bicep-container-apps.md)). Never use `@Microsoft.KeyVault(...)` / `keyVaultUrl`. See [bicep-patterns-security.md](bicep-patterns-security.md) § Secrets. For Terraform, see [terraform-patterns.md](terraform-patterns.md).
