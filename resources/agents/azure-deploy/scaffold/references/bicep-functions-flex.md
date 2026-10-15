# Bicep — Azure Functions (Flex Consumption)

Bicep patterns for **Azure Functions on the Flex Consumption plan** — the default Functions floor in this
pipeline (see [sku-matrix.md](../../prepare/references/sku-matrix.md)). For shared patterns (skeleton, naming,
tags, storage, RBAC), see [bicep-patterns.md](bicep-patterns.md) and
[bicep-patterns-data.md](bicep-patterns-data.md).

> ⛔ **A Flex Consumption function app is NOT an App Service.** Do **not** reuse
> [bicep-app-service.md](bicep-app-service.md) for it. Flex uses a different resource shape
> (`functionAppConfig`), a different deploy channel (a blob-container package — see
> [code-deployment-functions-flex.md](../../deploy/references/code-deployment-functions-flex.md)), and it
> rejects the App Service build/publish settings. Only **Functions on Premium (EP1)** use the App Service
> module + SCM/Kudu path.

## ⛔ Settings that are deprecated / moved on Flex Consumption — NEVER emit them

Flex Consumption ignores or is broken by these App Service / Consumption settings. Emitting them is the
single most common cause of a "provisioned but broken" Flex app. See
[Flex Consumption plan deprecations](https://learn.microsoft.com/azure/azure-functions/functions-app-settings#flex-consumption-plan-deprecations).

| Setting | Why it's wrong on Flex |
| --- | --- |
| `FUNCTIONS_WORKER_RUNTIME` | Conflicts with `functionAppConfig.runtime`. The runtime is declared **only** in `functionAppConfig.runtime`. |
| `FUNCTIONS_EXTENSION_VERSION` | Managed by the platform on Flex. |
| `SCM_DO_BUILD_DURING_DEPLOYMENT`, `ENABLE_ORYX_BUILD` | Oryx/Kudu build settings — unsupported. Flex uses the package-deploy channel; TypeScript packages are compiled and validated locally with remote build disabled (see the deploy reference). |
| `WEBSITE_RUN_FROM_PACKAGE` | Flex runs from its deployment blob container automatically. |
| `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`, `WEBSITE_CONTENTSHARE` | Flex has no content share. |
| `WEBSITES_CONTAINER_START_TIME_LIMIT`, `WEBSITE_TIME_ZONE`, `TZ` | Not supported on Flex. |

> ⛔ **Inline `siteConfig.appSettings` on a Flex site are dropped for any of the keys above.** Put runtime in
> `functionAppConfig.runtime`, scale/memory in `functionAppConfig.scaleAndConcurrency`, and only genuine
> **app** settings (connection info, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `AzureWebJobsStorage__accountName`)
> in `siteConfig.appSettings`.

> ⛔ **Do NOT add `basicPublishingCredentialsPolicies` (`scm`/`ftp`) to a Flex function app.** That is an App
> Service / Premium publishing concept. Flex deploys through its deployment storage container, so there is no
> SCM basic-auth to enable or re-disable. Adding these does not harden anything and the deploy phase must not
> toggle them for Flex (see [code-deployment-functions-flex.md](../../deploy/references/code-deployment-functions-flex.md)).

## Module Template

```bicep
param location string
param tags object
param functionAppName string
param planName string
param storageAccountName string           // host + deployment storage (Entra/MI — shared-key disabled)
param deploymentContainerName string       // blob container that holds the package, e.g. 'app-package'
param appInsightsConnectionString string
@allowed(['dotnet-isolated', 'node', 'python', 'java', 'powershell', 'go'])
param runtimeName string
param runtimeVersion string                // e.g. '8.0' (dotnet-isolated), '22' (node), '3.11' (python)
param instanceMemoryMB int = 2048          // 512 | 2048 | 4096
param maximumInstanceCount int = 100

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// Flex Consumption plan — FC1 / FlexConsumption, Linux (reserved).
resource flexPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: flexPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Only when a browser frontend on a DIFFERENT hostname calls this API. Omit the whole `cors`
      // block when there is no separate frontend — `staticWebApp` must be a real symbolic name in
      // THIS file, or use the `allowedOrigin` param form for a cross-module frontend.
      // See bicep-patterns.md § Cross-Origin (CORS).
      cors: {
        allowedOrigins: [ 'https://${staticWebApp.properties.defaultHostname}' ]
        supportCredentials: false
      }
      // ⛔ ONLY genuine app settings here — NEVER the deprecated keys listed above.
      appSettings: [
        // Identity-based host storage (shared-key access is disabled on the account).
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            // Managed identity — REQUIRED here because storage shared-key access is disabled.
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        instanceMemoryMB: instanceMemoryMB
        maximumInstanceCount: maximumInstanceCount
      }
      runtime: {
        name: runtimeName
        version: runtimeVersion
      }
    }
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output principalId string = functionApp.identity.principalId
```

## Required companions (emit these too)

- **Deployment blob container.** The container named by `deploymentContainerName` MUST exist on the storage
  account (a `Microsoft.Storage/storageAccounts/blobServices/containers` resource). Flex writes the package
  there on deploy and mounts it on startup.
- **Storage role for the app identity.** Because shared-key access is disabled, grant the function app's
  managed identity **Storage Blob Data Owner** (or Contributor) on the storage account via a deterministic
  `Microsoft.Authorization/roleAssignments` — see [rbac-roles.md](rbac-roles.md). Without it the app cannot
  read its own deployment package and fails to start.
- **Application Insights** — same as other compute targets.

> ⛔ **Region gating.** Flex Consumption is not available in every region. The plan must target a
> Flex-supported region (`az functionapp list-flexconsumption-locations`). This is validated in
> [sku-quota-validation.md](../../prepare/references/sku-quota-validation.md); if the requested region has no
> Flex, surface the region fallback there — do not silently relocate.

## Self-review (Flex)

- `functionAppConfig.runtime` present; **no** `FUNCTIONS_WORKER_RUNTIME` anywhere → else `FLAGGED`.
- **No** `SCM_DO_BUILD_DURING_DEPLOYMENT` / `ENABLE_ORYX_BUILD` / `WEBSITE_RUN_FROM_PACKAGE` → else `FLAGGED`.
- **No** `basicPublishingCredentialsPolicies` on the Flex site → else `FLAGGED`.
- `deployment.storage.authentication.type` is an identity type (not a connection string) when shared-key is
  disabled, and the app identity has a Storage Blob Data role on the account → else `FLAGGED`.
- If the plan includes a browser frontend on a different hostname, `siteConfig.cors.allowedOrigins` contains
  that frontend's origin → else `FLAGGED`. A missing `cors` block deploys cleanly and then fails every
  browser call with `No 'Access-Control-Allow-Origin' header is present`. See
  [bicep-patterns.md § Cross-Origin (CORS)](bicep-patterns.md).
