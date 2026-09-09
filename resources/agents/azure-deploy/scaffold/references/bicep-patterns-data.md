# Bicep Patterns — Data Service Modules

Bicep module templates for database and cache services. Read when the prepare plan includes PostgreSQL, MySQL, or Redis.

For core patterns (file structure, skeleton, naming, tagging), see [bicep-patterns.md](bicep-patterns.md). For security defaults, see [bicep-patterns-security.md](bicep-patterns-security.md).

## PostgreSQL Flexible Server Module

> ⛔ **Microsoft Entra authentication is the default — not admin password.** Enable Entra auth and add the app's managed identity as an Entra administrator; the app connects with an Entra token (no password). Emit `administratorLogin` / `@secure() administratorLoginPassword` **only** when a password fallback was explicitly approved at the Scaffold Gate (a runtime/driver with no Entra support), and even then keep `passwordAuth` off unless required.

```bicep
param pgName string
param location string
param tags object
// The app's managed identity (principalId) and its display name — added as the Entra admin.
param appPrincipalId string
param appPrincipalName string

param allowedExtensions string = 'uuid-ossp,pgcrypto,pg_trgm'

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16' // ⛔ use prepare-plan.json.services[].version (capabilities-verified) — do not guess
    // Entra-only by default: no admin password. Set passwordAuth 'Enabled' + admin params ONLY for an approved fallback.
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    storage: { storageSizeGB: 32 }
  }
}

// The app's managed identity as a PostgreSQL Entra administrator — this is how the app authenticates (token, no password).
resource pgEntraAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  name: appPrincipalId
  properties: {
    principalType: 'ServicePrincipal' // the app's managed identity; use 'User'/'Group' for an interactive admin
    principalName: appPrincipalName
    tenantId: subscription().tenantId
  }
}

// 0.0.0.0 = all Azure services (intentional) — broad access consented at the Scaffold Gate.
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// Allow PG extensions (uuid-ossp, pgcrypto, pg_trgm)
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: allowedExtensions, source: 'user-override' }
}
```

Wire auth via the app's **managed identity + Entra token** by default (the app fetches a token for `https://ossrdbms-aad.database.windows.net/.default`; see the runtime references' "Managed Identity — Azure vs local"). Only when a password fallback was approved do you store a connection string via Key Vault `secretRef` (Container Apps) / `@Microsoft.KeyVault()` (App Service).

## MySQL Flexible Server Module

> ⛔ **Microsoft Entra authentication is the default — not admin password.** Add the app's managed identity as an Entra administrator and connect with an Entra token. Emit `administratorLogin` / `@secure() administratorLoginPassword` **only** for an explicitly approved password fallback.

```bicep
param mysqlName string
param location string
param tags object
// The app's managed identity (principalId) and its display name — added as the Entra admin.
param appPrincipalId string
param appPrincipalName string

resource mysql 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: mysqlName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '8.0.21' // ⛔ use prepare-plan.json.services[].version (capabilities-verified) — major-only '8.0' is rejected by ARM
    storage: { storageSizeGB: 32 }
  }
}

// The app's managed identity as a MySQL Entra administrator (token auth, no password).
resource mysqlEntraAdmin 'Microsoft.DBforMySQL/flexibleServers/administrators@2023-12-30' = {
  parent: mysql
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    identityResourceId: appIdentityResourceId // user-assigned identity used to read the admin from Entra
    login: appPrincipalName
    sid: appPrincipalId
    tenantId: subscription().tenantId
  }
}

// 0.0.0.0 = all Azure services (intentional) — broad access consented at the Scaffold Gate.
resource mysqlFirewall 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = {
  parent: mysql
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// Enforce TLS
resource mysqlTls 'Microsoft.DBforMySQL/flexibleServers/configurations@2023-12-30' = {
  parent: mysql
  name: 'require_secure_transport'
  properties: { value: 'ON', source: 'user-override' }
}

// App database from compose (e.g. MYSQLDB_DATABASE) — emit so it exists before first boot. Omit if only the default DB is used.
resource mysqlDb 'Microsoft.DBforMySQL/flexibleServers/databases@2023-12-30' = {
  parent: mysql
  name: appDbName
}
```

Wire auth via the app's **managed identity + Entra token** by default (see the runtime references' "Managed Identity — Azure vs local"). Only when a password fallback was approved do you store a connection string via Key Vault `secretRef` / `@Microsoft.KeyVault()`.

> ℹ️ MySQL Entra admin resolution needs a **user-assigned managed identity** on the server (`identityResourceId` above) that can read Entra — attach it to the server's `identity` block. If that adds too much complexity for a given project, an admin-password fallback may be approved at the Scaffold Gate; document it in `assumptions[]`.

## Redis Cache Module (Minimal)

```bicep
param redisName string
param location string
param tags object

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  tags: tags
  properties: { sku: { name: 'Basic', family: 'C', capacity: 0 }, enableNonSslPort: false, minimumTlsVersion: '1.2' }
}
```

Store `redis.properties.hostName` + access key in Key Vault. Wire via `secretRef`/`@Microsoft.KeyVault()`.
