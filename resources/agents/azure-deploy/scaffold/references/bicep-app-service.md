# Bicep — App Service Patterns

App Service Bicep patterns. For shared skeleton, naming, tags, security defaults, and data modules, see [bicep-patterns.md](bicep-patterns.md).

> ⛔ **Azure Functions on Flex Consumption (the default Functions floor) is NOT an App Service — do NOT use this module for it.** Flex uses a different resource shape (`functionAppConfig`) and a different deploy channel; see [bicep-functions-flex.md](bicep-functions-flex.md). This module applies to App Service web apps and to Functions only on **Premium (EP1)**.

## Module Template

Base ALL App Service resources on this module with managed identity and SCM/FTP auth disabled.

```bicep
param location string
param tags object
param appServicePlanId string
param appServiceName string

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanId
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Only when this App Service is an API called by a browser frontend on a DIFFERENT hostname.
      // Omit entirely for a full-stack app that serves its own UI — that is same-origin and needs no CORS.
      // See bicep-patterns.md § Cross-Origin (CORS).
      cors: {
        allowedOrigins: [ 'https://${staticWebApp.properties.defaultHostname}' ]
        supportCredentials: false
      }
    }
  }
}

// SCM basic auth — enabled in IaC for deploy convenience. Deploy phase re-disables via REST API after code upload.
resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: true
  }
}

// ⛔ MANDATORY — disable FTP basic auth
resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}

output appServiceId string = appService.id
output principalId string = appService.identity.principalId
```

> ⛔ **Every App Service module MUST include:** (1) `identity: { type: 'SystemAssigned' }`, (2) `scm` basicPublishingCredentialsPolicies with `allow: true` (deploy convenience; deploy phase re-disables via REST API after code upload), (3) `ftp` basicPublishingCredentialsPolicies with `allow: false`. Any missing → self-review L1 `FLAGGED`.

## Native Module Deploy Strategy

When `prepare-plan.json.deployStrategy` has `codeDeployPattern: "startup-install"`, apply these App Service Bicep patterns:

```bicep
resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  tags: tags
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|${nodeVersion}' // ⛔ Use exact version tag (18-lts, 20-lts) — NEVER tilde (~18). Tilde works for WEBSITE_NODE_DEFAULT_VERSION but NOT linuxFxVersion.
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      // Startup command: Oryx build is primary, this is the safety-net fallback.
      // Runs npm install only if node_modules doesn't exist (Oryx missed it).
      // MUST be inline — never a .sh file (Windows CRLF → bash exit code 2).
      appCommandLine: '${deployStrategy.startupCommand}'
      appSettings: [
        // Primary: tell Oryx to run npm install during zip deploy
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'ENABLE_ORYX_BUILD', value: 'true' }
        // Extended timeout for native module compilation (max 1800, default 230)
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '1800' }
        // App-specific settings
        { name: 'NODE_ENV', value: 'production' }
      ]
    }
  }
}
```

**Rules:**
- ⛔ **Inline `appCommandLine` only** — never generate `.sh` startup script. Windows CRLF → bash exit code 2 on Linux
- ⛔ **Entry point from manifest** — read `package.json.scripts.start` or `.main`; never hardcode `index.js`
- ⛔ **`WEBSITES_CONTAINER_START_TIME_LIMIT` = 1800** (maximum). Native compilation takes 2-5 min; Python with scipy can take longer
- When `deployStrategy` is absent (no native modules), do NOT set `appCommandLine` — let Oryx use its default startup
- ⛔ **Never prefix startup with `cd /home/site/wwwroot`** — Oryx extracts to temp and sets working directory. Hardcoding `cd /home/site/wwwroot` causes `MODULE_NOT_FOUND` / `Could not import`; app files aren't there

**Self-review check (L2 Pattern):** If `hasNativeModules == true`, require BOTH `appCommandLine` and `WEBSITES_CONTAINER_START_TIME_LIMIT`. If `prereq-output.json.initCommands[]` contains `required: true`, require those entries in `appCommandLine` before app start. **FLAGGED** on either failure.

## Identity Output — SystemAssigned vs UserAssigned

> ⛔ **`appService.identity.principalId` exists only for `SystemAssigned`.** For `UserAssigned`, output managed identity MODULE's `principalId`; `identity.principalId` is undefined and causes `DeploymentOutputEvaluationFailed`. Every App Service has mandatory managed identity: compute floor B1 supports MI; F1/D1/Free are never selected.
