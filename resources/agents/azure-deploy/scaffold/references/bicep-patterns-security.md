# Bicep Patterns — Security Defaults

Mandatory security configuration for all AppOnboard-generated Bicep. Read during IaC generation before writing resource definitions. Apply during scaffold — never defer to deploy.

For core patterns (file structure, skeleton, naming, tagging), see [bicep-patterns.md](bicep-patterns.md). For data module templates (PostgreSQL, Redis), see [subagent-iac-gen.md](subagent-iac-gen.md) Step 6.

## No Key Vault — App-Internal Secret Storage

> ⛔ **Do NOT create a Key Vault.** AppOnboard-generated IaC MUST NOT emit `Microsoft.KeyVault/vaults` (or any KV secret / KV RBAC resource). Azure resource auth (database, cache, storage, Cosmos, queues) is managed-identity + token — there is nothing to store. App-internal secrets that are NOT an Azure resource credential (e.g. `SECRET_KEY`, JWT signing key, third-party API keys) are stored **directly on the compute resource**, never in Key Vault:

- **App Service / Functions:** pass each secret as an `@secure()` Bicep param → `siteConfig.appSettings`. The platform encrypts app settings at rest. The value is generated at deploy time and passed via CLI (never committed); it does not appear in ARM deployment history because it's `@secure()`.
- **Container Apps:** pass each secret as an `@secure()` param → the Container App's **native** `secrets: [{ name, value }]` array → referenced by `secretRef`. This is the Container Apps secret store, NOT Key Vault (`keyVaultUrl` is never used).

> ⛔ **No `@Microsoft.KeyVault(...)` references, no `keyVaultUrl` secretRefs, no KV role assignments** (`Key Vault Secrets Officer`/`Secrets User`), no `deployerObjectId` KV param.

## Security Defaults

> **Source:** Adapted from Azure security best practices. See [Azure security baseline](https://learn.microsoft.com/en-us/security/benchmark/azure/overview) for updates.

### Identity — Managed Identity Everywhere (MANDATORY, NO EXCEPTIONS)

> ⛔ **Every compute resource MUST have a managed identity. There is NO SKU, tier, or service combination that is exempt.** Managed identity is the ONLY sanctioned way for app code to authenticate to any Azure resource. Shared keys, admin logins, and connection-string passwords are BLOCKED (see [`bicep-patterns-data.md`](bicep-patterns-data.md) and the conformance gate).
>
> | Condition | Include MI? |
> |-----------|-------------|
> | Any compute (App Service, Container Apps, Functions) | **YES — always** |
> | Any database, storage, queue, cache, Cosmos, or ACR access | **YES — always** |
> | None of the above | **YES** (default secure) |

- **System-assigned managed identity** for all services (default). User-assigned only when shared identity is explicitly needed.
- ⛔ **Compute floor is B1 (App Service) / Standard (Static Web Apps).** F1/D1/Free tiers are NOT offered — the free-tier MI sidecar OOMs and cannot host managed identity, and free SWA lacks the config (CORS, custom auth) these apps need. SKU selection MUST NOT emit F1, D1, or Free. See [sku-matrix.md](../../prepare/references/sku-matrix.md).
- ⛔ **Never generate `administratorLogin`, `administratorLoginPassword`, access keys, or connection-string passwords** for ANY data service (SQL, PostgreSQL, MySQL, Redis, Storage, Cosmos DB, Service Bus, Event Hubs) — including inside conditional branches. Use Entra/MI-only auth (see the data-service patterns below and in [`bicep-patterns-data.md`](bicep-patterns-data.md)).
- App-to-service auth: managed identity + RBAC role assignments (or data-plane role assignments for Cosmos/Redis). Zero shared-key or password auth to any Azure resource.
- **App-internal secrets** that are NOT an Azure resource credential (e.g. Django `SECRET_KEY`, JWT signing key, third-party API keys) are stored **directly on the compute resource** — App Service app settings or Container Apps native secrets, from an `@secure()` param generated at deploy. ⛔ **No Key Vault** (see § No Key Vault — App-Internal Secret Storage).

```bicep
identity: {
  type: 'SystemAssigned'
}
```

### Data Services — Entra / Managed-Identity-Only Authentication

> ⛔ **Local/shared-key/password authentication MUST be disabled on every data service.** The app authenticates with its managed identity; the deploying principal is granted an Entra admin/data role so migrations and seeding can run token-based. Full module templates (auth config, Entra admin child resources, MI data-plane roles) live in [`bicep-patterns-data.md`](bicep-patterns-data.md).

| Service | How local auth is disabled | App/MI access |
|---------|----------------------------|---------------|
| Azure SQL | `azureADOnlyAuthentication: true` (pattern below) | Entra admin + `CREATE USER [<mi>] FROM EXTERNAL PROVIDER` |
| PostgreSQL Flexible | `authConfig: { passwordAuth: 'Disabled', activeDirectoryAuth: 'Enabled' }` | Entra admin child resource + MI role via `pgaadauth_create_principal` |
| MySQL Flexible | Entra admin child resource, `aad_auth_only` config | MI mapped as an AAD login |
| Redis | `disableAccessKeyAuthentication: true` + `accessPolicyAssignments` | Data Owner/Contributor access policy to the MI |
| Storage | `allowSharedKeyAccess: false` | Storage Blob/Queue Data role to the MI |
| Cosmos DB | `disableLocalAuth: true` | `sqlRoleAssignments` (data plane) — see [rbac-roles.md](rbac-roles.md) |
| Service Bus / Event Hubs | `disableLocalAuth: true` | Data Sender/Receiver role to the MI |

### SQL Server — Entra-Only Authentication

```bicep
param principalId string
param principalName string
@allowed(['User', 'Group', 'Application'])
param principalType string = 'User'

// Preview API required — azureADOnlyAuthentication via administrators block
// is not available in GA API versions (GA path uses a separate child resource).
resource sqlServer 'Microsoft.Sql/servers@2024-05-01-preview' = {
  name: '${resourcePrefix}-sql-${uniqueHash}'
  location: location
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: principalType
      login: principalName
      sid: principalId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
    minimalTlsVersion: '1.2'
  }
}
```

> ⚠️ If deploying from CI/CD with a service principal, set `principalType` to `'Application'`. The default `'User'` only works for interactive deployments.

### Secrets — App-Internal, Stored On-Compute (No Key Vault)

App-internal secrets (e.g. `SECRET_KEY`, `JWT_SECRET`, `API_KEY`, session secrets) are stored directly on the compute resource. ⛔ **No Key Vault**, no `@Microsoft.KeyVault(...)`, no `keyVaultUrl`.

> ⛔ **No plaintext/committed secrets.** Values MUST NOT be hardcoded in Bicep or committed to `main.parameters.json` — pass them as `@secure()` params generated at deploy time. Never use `uniqueString()` for secrets (deterministic/predictable). `@secure()` params do NOT appear in ARM deployment history.
>
> ❌ **NEVER:** `{ name: 'SECRET_KEY', value: 'hard-to-guess-string' }` or `value: 'change-me'`; any `@secure()` password param for a database/cache/storage account (those use managed identity — see § Data Services).

```bicep
// App Service / Functions
@secure()
param secretKey string   // generated at deploy time, passed via CLI --parameters, never committed

appSettings: [
  // Database via managed identity — plain connection params, NO password:
  { name: 'PGHOST', value: '${pgName}.postgres.database.azure.com' }
  { name: 'PGDATABASE', value: appDbName }
  { name: 'PGUSER', value: appServiceName }   // the MI's DB principal name
  { name: 'PGSSLMODE', value: 'require' }
  // App-internal secret stored directly as an app setting (platform-encrypted at rest):
  { name: 'SECRET_KEY', value: secretKey }
]
```

For Container Apps, put the secret in the Container App's **native** `secrets: [{ name, value: secretKey }]` array (value from an `@secure()` param) and reference it via `secretRef` — see [bicep-container-apps.md](bicep-container-apps.md). ⛔ **Never** emit a `Microsoft.KeyVault/vaults` resource.

### App Settings Are Non-Secret Endpoint Configuration Only

> ⛔ **App settings / container `env` MUST NOT contain any secret or connection string.** With managed identity the app authenticates by token — there is nothing secret to configure. App settings carry ONLY **non-secret endpoint configuration** that tells the app *where* and *as which identity* to connect:
> - **Endpoint / host** — e.g. `PGHOST=myserver.postgres.database.azure.com`, `AZURE_STORAGE_BLOB_ENDPOINT=https://myacct.blob.core.windows.net`
> - **Resource name** — e.g. database name, container/queue name
> - **Identity principal** — the MI's DB principal name as the connection `user` (Postgres/MySQL AAD auth)
> - **`AZURE_CLIENT_ID`** — ONLY for a user-assigned MI, so `DefaultAzureCredential` selects the right identity (omit for system-assigned)
> - **Non-secret app flags** — e.g. `NODE_ENV`, `PGSSLMODE=require`, CORS origins
>
> ❌ **NEVER put in app settings / `env`:** a full **connection string** (`DATABASE_URL=postgres://user:pass@host/db`, `AccountKey=...`, `SharedAccessKey=...`), a **password**, an **access key**, a **SAS token**, or any other credential. If a value would authenticate you, it does not belong here — use managed identity instead. The ONLY secret-like value permitted anywhere is a genuinely app-internal secret (e.g. `SECRET_KEY`) that is NOT an Azure resource credential, and even that is passed as an `@secure()` param, never as a plain app-setting literal.

### Transport — HTTPS Only

All web-facing resources:

```bicep
// App Service
httpsOnly: true
siteConfig: {
  minTlsVersion: '1.2'
}

// Storage
supportsHttpsTrafficOnly: true
allowBlobPublicAccess: false
minimumTlsVersion: 'TLS1_2'
```

### App Service / Functions — Publishing Credential Lockdown

> ⛔ **Every App Service and Functions app MUST include both `basicPublishingCredentialsPolicies` child resources.** Missing these means deploy cannot toggle SCM auth post-deployment — the REST API call targets a resource that doesn't exist in ARM.

```bicep
// SCM — allow: true for deploy phase (deploy re-disables via REST API after code upload)
resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: true
  }
}

// FTP — always disabled
resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}
```

> **Deploy lifecycle:** Scaffold sets `scm.allow: true` so `az webapp deploy` works. After code upload + health check, deploy phase runs `az rest --method put .../basicPublishingCredentialsPolicies/scm` with `allow: false` to re-harden. If scaffold omits these resources, deploy's Step 7 SCM re-disable REST API call fails silently.

### Cosmos DB — Data Plane RBAC

⛔ Cosmos DB uses its own role system — see [rbac-roles.md](rbac-roles.md) § Cosmos DB for role IDs and behavioral rules. Do NOT use `Microsoft.Authorization/roleAssignments` for Cosmos data access.

### RBAC — Deterministic Role Assignments

For the common roles GUID table, see [rbac-roles.md](rbac-roles.md).

```bicep
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(scopeResourceId, principalId, roleDefinitionId)
  scope: targetResource
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'  // REQUIRED — prevents AAD graph lookup delays
  }
}
