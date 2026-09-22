## MySQL Flexible Server Module — Entra-Only

> ⛔ **Password authentication is disabled.** No `administratorLogin` / `administratorLoginPassword`. The deploying principal is the Entra admin; the app's MI is mapped as an AAD login post-deploy.
>
> ⛔ **MySQL Entra admin REQUIRES a user-assigned managed identity (UAMI).** Unlike PostgreSQL, `Microsoft.DBforMySQL/flexibleServers/administrators` will not deploy without one: `identityResourceId` is mandatory, and the parent server must carry that UAMI in its `identity` block. `identityResourceId: null` fails to deploy. Grant the UAMI **Directory Readers** in Entra — it cannot be assigned from ARM, so emit a `postDeployRecommendation` for it.

```bicep
param mysqlName string
param location string
param tags object

// Entra admin = the deploying principal. No password params.
param entraAdminObjectId string
param entraAdminName string
// UAMI required for MySQL Entra auth — the server uses it to read Entra.
param adminUamiResourceId string
param adminUamiPrincipalId string

resource mysql 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: mysqlName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${adminUamiResourceId}': {} }
  }
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '8.0.21' // ⛔ use prepare-plan.json.services[].version — major-only '8.0' is rejected by ARM
    storage: { storageSizeGB: 32 }
  }
}

// Entra administrator (deploying principal) — enables token-based admin + migrations.
resource mysqlAdmin 'Microsoft.DBforMySQL/flexibleServers/administrators@2023-12-30' = {
  parent: mysql
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    login: entraAdminName
    sid: entraAdminObjectId
    tenantId: subscription().tenantId
    identityResourceId: adminUamiResourceId // ⛔ null here will NOT deploy
  }
}

// Enforce Entra-only auth (disable native password auth)
resource mysqlAadOnly 'Microsoft.DBforMySQL/flexibleServers/configurations@2023-12-30' = {
  parent: mysql
  name: 'aad_auth_only'
  properties: { value: 'ON', source: 'user-override' }
  dependsOn: [ mysqlAdmin ]
}

resource mysqlTls 'Microsoft.DBforMySQL/flexibleServers/configurations@2023-12-30' = {
  parent: mysql
  name: 'require_secure_transport'
  properties: { value: 'ON', source: 'user-override' }
}

// 0.0.0.0 = all Azure services (intentional) — broad access consented at the Scaffold Gate.
resource mysqlFirewall 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = {
  parent: mysql
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
```

Wire connection **parameters** as plain app settings (host, db name, MI username, SSL required) — ⛔ never a Key Vault secret and never a password. The driver fetches an Entra token at runtime.

