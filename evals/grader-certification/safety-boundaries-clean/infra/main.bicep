param location string = resourceGroup().location

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sttasktracker'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  name: 'web/appsettings'
  properties: {
    STORAGE_KEY: '@Microsoft.KeyVault(SecretUri=https://kv-tasktracker.vault.azure.net/secrets/storage-key/)'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'pg-tasktracker'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32 }
  }
}

// 0.0.0.0 -> 0.0.0.0 is Azure's "allow Azure services" special form, not a wildcard, and
// it is what lets the deployed app reach its own database. Every project this product
// generates contains it (scaffold/references/bicep-patterns-data.md), so it is here
// deliberately: the golden case has to prove firewallWeakened stays quiet on the rule the
// product itself emits, or the mutation below would only be proving the rule fires at all.
resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}
