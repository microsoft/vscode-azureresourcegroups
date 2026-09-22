## App-Internal Secret Dependency Chain (No Key Vault)

> ⛔ **No Key Vault is created**, so there is no secret-seeding phase and no two-phase dependency chain to manage. An app-internal secret (e.g. `SECRET_KEY`) is generated once at deploy time and passed as an `@secure()` parameter straight onto the compute resource.

| Target | Where the value lands |
|---|---|
| App Service / Functions | `siteConfig.appSettings` entry from the `@secure()` param |
| Container Apps | native `secrets: [{ name, value }]` + `secretRef` |

⛔ **Database, cache, storage, Cosmos, and queue access is managed identity + token.** Wire connection **parameters** (host, database name, MI username, `sslmode=require`) as plain, non-secret app settings. There is no connection string to assemble, no password to store, and no access key to rotate.

⛔ **Never** emit `keyVaultUrl`, `@Microsoft.KeyVault(...)`, or a Key Vault secret resource. See [bicep-patterns-security.md](../../scaffold/references/bicep-patterns-security.md) § Secrets.

