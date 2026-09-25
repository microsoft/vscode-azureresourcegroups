# Bicep Patterns — Data Service Modules

Bicep module templates for database and cache services. Read when the prepare plan includes PostgreSQL, MySQL, or Redis.

For core patterns (file structure, skeleton, naming, tagging), see [bicep-patterns.md](bicep-patterns.md). For security defaults, see [bicep-patterns-security.md](bicep-patterns-security.md).

## PostgreSQL Flexible Server Modules — Entra-Only

> ⛔ **Password authentication is disabled.** No `administratorLogin` / `administratorLoginPassword`. The deploying principal is set as the Entra admin so migrations/seeding run token-based; the app's managed identity is granted a DB role as a post-deploy data-plane step (see [database-post-deploy.md](../../deploy/references/database-post-deploy.md)).

Use three modules. The first deployment creates the server, firewall rule, and Reader assignment for an
existing user-assigned identity. The second runs an Azure CLI deployment script under that identity until the
server reports `Ready` and the administrator child-provider endpoint responds, then waits through a stabilization
interval. Only the third creates the administrator and remaining children. A module output, `parent:`, or resource-level `dependsOn` only proves ARM PUT
completion; it does not prove the PostgreSQL management provider will accept child operations and can still
race with `AadAuthOperationCannotBePerformedWhenServerIsNotAccessible`.

**`infra/modules/postgres.bicep` — server deployment:**

```bicep
param pgName string
param location string
param tags object
param readinessPrincipalId string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16' // ⛔ use prepare-plan.json.services[].version (capabilities-verified) — do not guess
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    storage: { storageSizeGB: 32 }
  }
}

// 0.0.0.0 = all Azure services (intentional) — broad access consented at the Scaffold Gate.
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource readinessReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pg.id, readinessPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  scope: pg
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'acdd72a7-3385-48ef-bd42-f606fba81ae7'
    )
    principalId: readinessPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output serverName string = pg.name
```

**`infra/modules/postgres-readiness.bicep` — executable management-readiness barrier:**

```bicep
param location string
param tags object
param sessionId string
param subscriptionId string
param serverName string
param readinessIdentityResourceId string

resource readiness 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'wait-postgres-${uniqueString(serverName)}'
  location: location
  tags: tags
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${readinessIdentityResourceId}': {}
    }
  }
  properties: {
    azCliVersion: '2.89.0'
    cleanupPreference: 'OnSuccess'
    forceUpdateTag: sessionId
    retentionInterval: 'P1D'
    timeout: 'PT20M'
    environmentVariables: [
      { name: 'SUBSCRIPTION_ID', value: subscriptionId }
      { name: 'RESOURCE_GROUP', value: resourceGroup().name }
      { name: 'SERVER_NAME', value: serverName }
    ]
    scriptContent: '''
      for attempt in $(seq 1 40); do
        state=$(az postgres flexible-server show --subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" --query state -o tsv 2>/dev/null || true)
        if [ "$state" = "Ready" ]; then
          if az postgres flexible-server microsoft-entra-admin list --subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --output none 2>/dev/null; then
            sleep 90
            printf '{"ready":true,"state":"%s","attempt":%s}\n' "$state" "$attempt" > "$AZ_SCRIPTS_OUTPUT_PATH"
            exit 0
          fi
        fi
        sleep 15
      done
      printf '{"ready":false,"state":"%s","attempt":40}\n' "$state" > "$AZ_SCRIPTS_OUTPUT_PATH"
      exit 1
    '''
  }
}

output serverName string = serverName
output readiness object = readiness.properties.outputs
```

The script is bounded, passes subscription and resource group explicitly, has no `jq` dependency, fails
closed, and records its result at `$AZ_SCRIPTS_OUTPUT_PATH`. It must successfully read the exact
`microsoft-entra-admin` child-provider endpoint before the stabilization wait; server state alone is not
provider-readiness proof, and live provider acceptance can lag the state transition.

**`infra/modules/postgres-children.bicep` — post-readiness children:**

```bicep
param pgName string
param entraAdminObjectId string
param entraAdminName string
@allowed(['User', 'Group', 'ServicePrincipal'])
param entraAdminType string = 'User'
param allowedExtensions string = 'uuid-ossp,pgcrypto,pg_trgm'
param appDbName string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: pgName
}

resource pgAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  // ⛔ This child name is the administrator object-ID segment in the ARM URL.
  // It MUST be the GUID-backed input — never 'activeDirectory', a display label, or another literal.
  name: entraAdminObjectId
  properties: {
    principalType: entraAdminType
    principalName: entraAdminName
    tenantId: subscription().tenantId
  }
}

resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: allowedExtensions, source: 'user-override' }
  dependsOn: [ pgAdmin ]
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: appDbName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [ pgExtensions ]
}
```

**Wire both deployments from subscription-scope `infra/main.bicep`:**

```bicep
module pg 'modules/postgres.bicep' = {
  name: 'postgres-server'
  scope: rg
  params: {
    pgName: pgName
    location: location
    tags: tags
    readinessPrincipalId: identity.outputs.principalId
  }
}

module pgReadiness 'modules/postgres-readiness.bicep' = {
  name: 'postgres-readiness'
  scope: rg
  params: {
    location: location
    tags: tags
    sessionId: sessionId
    subscriptionId: subscription().subscriptionId
    serverName: pg.outputs.serverName
    readinessIdentityResourceId: identity.outputs.resourceId
  }
}

module pgChildren 'modules/postgres-children.bicep' = {
  name: 'postgres-children'
  scope: rg
  params: {
    // ⛔ Do not bypass the executable readiness module with pg.outputs.serverName.
    pgName: pgReadiness.outputs.serverName
    entraAdminObjectId: entraAdminObjectId
    entraAdminName: entraAdminName
    entraAdminType: entraAdminType
    appDbName: appDbName
  }
}
```

> ⛔ **Both levels of ordering are required.**
>
> 1. `pg.outputs.serverName` feeds the managed-identity deployment script, which polls the exact subscription,
>    resource group, and server until `Ready`, successfully probes the `microsoft-entra-admin` child endpoint,
>    stabilizes, and fails closed.
> 2. `pgReadiness.outputs.serverName` feeds `pgChildren`; bypassing it with the original name/output is invalid.
> 3. Inside the companion module, `pgAdmin → pgExtensions → pgDb` remains serialized so ARM does not start the
>    children in parallel.
>
> `az bicep build` and `what-if` validate shape but do not exercise either runtime constraint. The scaffold
> conformance gate therefore blocks a PostgreSQL administrator whose `name` is not `entraAdminObjectId`
> (`PG-ENTRA-ADMIN-ID`) and blocks a missing, bypassed, unbounded, non-portable, or non-failing executable
> readiness barrier (`PG-ADMIN-READY-BARRIER`).

Wire connection **parameters** (host, db name, MI username, `sslmode=require`) as plain app settings — NOT a Key Vault secret. The driver fetches an Entra access token at runtime as the password. The app's managed identity is granted a DB role post-deploy via `pgaadauth_create_principal` (see [database-post-deploy.md](../../deploy/references/database-post-deploy.md) § Grant the app managed identity a DB role).

## MySQL Flexible Server Module — Entra-Only

> ⛔ **Password authentication is disabled.** No `administratorLogin` / `administratorLoginPassword`. The deploying principal is the Entra admin; the app's MI is mapped as an AAD login post-deploy.

> ⛔ **MySQL Entra admin REQUIRES a user-assigned managed identity (UAMI).** Unlike PostgreSQL, `Microsoft.DBforMySQL/flexibleServers/administrators` will not deploy without a UAMI: the `identityResourceId` property is mandatory (the portal and `az mysql flexible-server ad-admin create --identity` both require it), and the parent server must carry that UAMI in its `identity` block. `identityResourceId: null` fails to deploy. The UAMI is what the server uses to read Microsoft Entra — grant it the **Directory Readers** role (or `User.Read.All` / `GroupMember.Read.All` / `Application.Read.All` app permissions) in Entra ID; emit a `postDeployRecommendation` for that grant since it cannot be assigned from ARM.

```bicep
param mysqlName string
param location string
param tags object
param appDbName string

// Entra admin = the deploying principal. No password params.
param entraAdminObjectId string
param entraAdminName string

// UAMI required for MySQL Entra auth — the server uses it to read Entra.
resource mysqlAadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${mysqlName}-aad-id'
  location: location
  tags: tags
}

resource mysql 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: mysqlName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${mysqlAadIdentity.id}': {}
    }
  }
  properties: {
    version: '8.0.21' // ⛔ use prepare-plan.json.services[].version (capabilities-verified) — major-only '8.0' is rejected by ARM
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
    identityResourceId: mysqlAadIdentity.id // ⛔ MANDATORY — MySQL AAD admin will not deploy without a UAMI
  }
}

// Enforce Entra-only auth (disable native password auth)
resource mysqlAadOnly 'Microsoft.DBforMySQL/flexibleServers/configurations@2023-12-30' = {
  parent: mysql
  name: 'aad_auth_only'
  properties: { value: 'ON', source: 'user-override' }
  dependsOn: [ mysqlAdmin ]
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

Wire connection **parameters** as plain app settings (host, db name, MI username, SSL required) — NOT a Key Vault secret. The driver fetches an Entra token at runtime. The app's MI is mapped as an AAD login post-deploy (see [database-post-deploy.md](../../deploy/references/database-post-deploy.md)).

## Redis Cache Module (Entra-Only)

> ⛔ **Access-key authentication is disabled** (`disableAccessKeyAuthentication: true`). The app's managed identity is granted data access via an access-policy assignment. Do NOT store a Redis access key in Key Vault. If the app's Redis client library cannot present an Entra token, surface it as a `FLAGGED` finding rather than re-enabling keys.

```bicep
param redisName string
param location string
param tags object
param appPrincipalId string // the app compute MI objectId

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: { name: 'Basic', family: 'C', capacity: 0 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    disableAccessKeyAuthentication: true // ⛔ Entra-only
    redisConfiguration: {
      'aad-enabled': 'true'
    }
  }
}

// Data-plane access for the app MI (Entra) — no keys.
resource redisAccess 'Microsoft.Cache/redis/accessPolicyAssignments@2024-03-01' = {
  parent: redis
  name: guid(redis.id, appPrincipalId, 'Data Owner')
  properties: {
    accessPolicyName: 'Data Owner'
    objectId: appPrincipalId
    objectIdAlias: appPrincipalId
  }
}
```

Wire `redis.properties.hostName` (+ MI object id as the username) as plain app settings. The client obtains an Entra token at runtime — no key in Key Vault.
