# Bicep — Container Apps Patterns

Container Apps Bicep patterns. For shared skeleton, naming, tags, security defaults, and data modules, see [bicep-patterns.md](bicep-patterns.md).

## Two-Phase Wiring

Container Apps + ACR requires two-phase deploy: CA needs ACR image; ACR needs CA identity for AcrPull.

1. **Phase 1:** Deploy Container App with public MCR placeholder image (`mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`). ⛔ **No `registries` block.** Use `registries: []`. Native `secrets` (literal values) MAY be set in Phase 1; no RBAC dependency. **Create AcrPull role assignment in Phase 1**; it doesn't affect placeholder deployment and needs 1–2 minutes to propagate before Phase 2.
2. **Phase 2:** Build + push app image to ACR, redeploy with real image + `registries`. AcrPull RBAC is already propagated from Phase 1.

> ⛔ **Placeholder image listens on port 80, not app port.** Set `targetPort` conditionally: `var effectivePort = containerImage == 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' ? 80 : appPort`. Mismatch causes "Operation expired" because health probe can't reach container.

> ⛔ **`containerImage` param must exist in BOTH `main.bicep` AND container app module.** Phase 2 passes `--parameters containerImage='...'`; without `main.bicep` param, CLI silently ignores override and placeholder persists.

```bicep
// In main.bicep: thread containerImage to module
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
module containerApp './modules/containerapp.bicep' = {
  params: { containerImage: containerImage /* ...other params... */ }
}

// In containerapp.bicep:
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var isPlaceholder = containerImage == 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  identity: { type: 'SystemAssigned' }
  properties: {
    configuration: {
      ingress: {
        external: true
        targetPort: isPlaceholder ? 80 : appPort
        allowInsecure: false  // ⛔ MANDATORY
      }
      registries: isPlaceholder ? [] : [{ server: acr.properties.loginServer, identity: 'system' }]
      secrets: [ { name: 'secret-key', value: secretKey } ] // native CA secrets (no RBAC dep) — NOT KV
    }
    template: {
      containers: [{
        image: containerImage
        env: [{ name: 'PORT', value: string(isPlaceholder ? 80 : appPort) }]
      }]
    }
  }
}
```

> ⛔ **Do NOT set `revisionSuffix`.** Omit entirely; ARM auto-generates unique revision names. Hardcoding `revisionSuffix: 'v1'` makes Phase 2 fail: "revision with suffix v1 already exists."

### AcrPull Role Assignment

> ⛔ **AcrPull role GUID: `7f951dda-4ed3-4680-a7ca-43fe172d538d`.** Copy verbatim — wrong GUIDs cause `RoleDefinitionDoesNotExist`.

```bicep
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, containerApp.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Log Analytics Workspace Key

> ⛔ **Use `resource.listKeys()`, NOT `reference()`.** `reference()` lacks `primarySharedKey`.

```bicep
// ✅ Correct
var laKey = logAnalyticsWorkspace.listKeys().primarySharedKey

// ❌ Wrong
var laKey = reference(logAnalyticsWorkspace.id, '2023-09-01').primarySharedKey
```

### Log Analytics customerId vs resource ID

> ⛔ **Output BOTH `id` and `customerId` from log-analytics module.** Container Apps Environment needs GUID `customerId`; App Insights needs ARM resource ID. Do NOT use `split(workspaceId, '/')[8]`; it returns workspace name, not GUID.

```bicep
// log-analytics.bicep outputs:
output id string = logAnalyticsWorkspace.id                            // ARM resource ID
output customerId string = logAnalyticsWorkspace.properties.customerId // GUID
output sharedKey string = logAnalyticsWorkspace.listKeys().primarySharedKey

// container-app-environment.bicep:
param workspaceCustomerId string  // GUID, NOT resource ID
// ⛔ MUST nest under appLogsConfiguration.destination='log-analytics' — a bare top-level logAnalyticsConfiguration fails deploy (ManagedEnvironmentInvalidSchema). This nesting is the ONLY valid location at EVERY API version (the flat shape was never valid — NOT version drift, so do not chase API-version pins). This is the CA's only log path (no diagnostic-settings module).
properties: {
  appLogsConfiguration: {
    destination: 'log-analytics'
    logAnalyticsConfiguration: {
      customerId: workspaceCustomerId
      sharedKey: workspaceSharedKey
    }
  }
}
// ❌ WRONG: customerId: split(workspaceId, '/')[8]
```

## Ingress & Port Mapping

> ⛔ **Container resource limits:** Memory uses decimal `'0.5Gi'`, `'1Gi'`, `'2Gi'`, NOT Kubernetes `'512Mi'`. CPU type must be `string`: `'0.25'`, `'0.5'`, `'1'`. Valid combos: `0.25/0.5Gi`, `0.5/1Gi`, `0.75/1.5Gi`, `1/2Gi`, `1.25/2.5Gi`, `1.5/3Gi`, `1.75/3.5Gi`, `2/4Gi`.

> ⛔ **ACR module:** `retentionPolicy` is **Premium-only**. For Basic/Standard ACR, omit `retentionPolicy` entirely — ARM rejects it.

## Container Apps Secrets (Native — No Key Vault)

> ⛔ **No Key Vault.** Container Apps store app-internal secrets in the app's **native** `secrets` array with a literal `value` supplied by an `@secure()` param at deploy time. NEVER use `keyVaultUrl`, `@Microsoft.KeyVault(...)`, or a KV `secrets` child resource.

> ⛔ **Only app-internal secrets use `secretRef`.** Database, cache, and storage access is managed-identity + token — wire their **connection parameters as plain `env` values** (host, db name, MI username, `sslmode=require`), never a `secretRef`. `secretRef` is for things like `SECRET_KEY`/JWT/third-party API keys.

> Native secrets have no RBAC dependency, so they don't need the `isPlaceholder` gate that KV secretRefs required (two-phase wiring is still needed for ACR registries + real image — see § Two-Phase Wiring).

```bicep
@secure()
param secretKey string   // generated at deploy, passed via CLI --parameters, never committed

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    configuration: {
      secrets: [
        { name: 'secret-key', value: secretKey }   // ⛔ native CA secret — NOT keyVaultUrl
      ]
    }
    template: {
      containers: [{
        env: [
          // App-internal secret via secretRef:
          { name: 'SECRET_KEY', secretRef: 'secret-key' }
          // Database via managed identity — plain connection params, NO password/secretRef:
          { name: 'PGHOST', value: '${pgName}.postgres.database.azure.com' }
          { name: 'PGUSER', value: containerAppName }  // the MI's DB principal name
          { name: 'PGSSLMODE', value: 'require' }
        ]
      }]
    }
  }
}
```

> ⛔ **Never use conditional logic (`??`, ternary, `empty()`, `union()`) to mix plain and secret env vars in a single Bicep loop or array.** ARM evaluates ALL property paths in conditional expressions — `envVar.secretRef` errors on items that don't have that property, producing `InvalidTemplate`. Instead, define plain and secret env vars as separate arrays and concatenate:
>
> ```bicep
> env: concat(
>   [
>     { name: 'PORT', value: '8000' }
>     { name: 'NODE_ENV', value: 'production' }
>     // DB/cache via managed identity — plain connection params, no secretRef:
>     { name: 'PGHOST', value: '${pgName}.postgres.database.azure.com' }
>     { name: 'PGUSER', value: containerAppName }
>   ],
>   [
>     { name: 'SECRET_KEY', secretRef: 'secret-key' }  // app-internal secret only
>   ]
> )
> ```

> ⛔ **`principalId: containerApp.identity.principalId`** (object ID, NOT clientId) for the AcrPull role assignment. See [rbac-roles.md](rbac-roles.md) for the AcrPull role GUID.

> ❌ **WRONG:** `principalId: .clientId` (not the object ID) or `identity: containerApp.id` in secrets[] (use `'system'` for system-assigned MI).

> App-internal secrets are native CA secrets (literal `value` from an `@secure()` param) — there is no Key Vault, no KV role assignment, and no secret seeding into KV.

## Multi-Container Internal DNS

Container Apps in the same environment communicate via internal DNS: `http://{container-app-name}`. Set via env vars:

```bicep
env: [
  { name: 'API_URL', value: 'http://${apiContainerApp.name}' }
  { name: 'WORKER_URL', value: 'http://${workerContainerApp.name}' }
]
```

No ingress needed for internal-only services — set `ingress.external: false` or omit ingress entirely.

## Networking

> ⛔ **Subnets MUST be defined inline** in VNet `properties.subnets[]`, NOT as separate `Microsoft.Network/virtualNetworks/subnets` child resources. Separate child resources cause `InUseSubnetCannotBeDeleted` on redeploy when NICs are attached.
