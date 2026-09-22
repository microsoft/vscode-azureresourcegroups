### Secrets — App-Internal, Stored On-Compute (No Key Vault)

> ⛔ **Do NOT create a Key Vault.** Generated IaC MUST NOT emit `Microsoft.KeyVault/vaults`, any Key Vault secret resource, `@Microsoft.KeyVault(...)`, `keyVaultUrl`, or Key Vault role assignments (`Key Vault Secrets Officer` / `Secrets User`). There is no `deployerObjectId` KV parameter.

Azure resource auth — database, cache, storage, Cosmos, queues — is **managed identity + token**, so there is nothing secret to store. The only values that qualify as secrets here are **app-internal** and are NOT an Azure resource credential: `SECRET_KEY`, a JWT signing key, a third-party API key.

Store those **directly on the compute resource**, from an `@secure()` parameter generated at deploy time:

- **App Service / Functions:** `siteConfig.appSettings` entry whose value is the `@secure()` param.
- **Container Apps:** the app's **native** `secrets: [{ name, value }]` array, referenced by `secretRef` (see [bicep-container-apps.md](bicep-container-apps.md)).

```bicep
@secure()
param appSecretKey string

// App Service — plain app setting sourced from a secure parameter.
siteConfig: {
  appSettings: [
    { name: 'SECRET_KEY', value: appSecretKey }
    // Database via managed identity — plain connection params, NO password:
    { name: 'PGHOST', value: pgHost }
    { name: 'PGUSER', value: appMiName }
    { name: 'PGSSLMODE', value: 'require' }
  ]
}
```

> ❌ **NEVER:** a hardcoded literal (`value: 'change-me'`); an `@secure()` password parameter for a database, cache, or storage account (those use managed identity); or any full connection string, access key, or SAS token in app settings. If a value would authenticate you, it does not belong in configuration.

