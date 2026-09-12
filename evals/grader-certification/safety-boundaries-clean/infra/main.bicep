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
