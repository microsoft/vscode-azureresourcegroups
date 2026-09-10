# Environment Variables & Secrets — Cross-Cutting Rules

Applies to ALL compute targets (App Service, Container Apps, Functions). For Container Apps-specific Bicep patterns (secretRef, identity), see [bicep-container-apps.md](bicep-container-apps.md).

## Environment Variable Value Derivation

> ⛔ **Never invent env var values — derive from the app's config class.** Cross-reference `.env.example`, `.env.sample`, `docker-compose.yml`, and the app's config module. Verify each value:
> 1. **Type validation:** URL-typed fields need valid URLs — not `*` or placeholders
> 2. **Defaults:** Use app defaults unless overriding with deployed URL
> 3. **Required:** Fields without defaults must be provided
>
> **Pitfalls:** `CORS_ORIGINS=["*"]` → invalid for strict validators (use actual URLs). `DATABASE_URL=changethis` → use a managed-identity connection (no password; wire plain connection params, driver fetches a token). JSON array env vars need Bicep variable escaping:
> ```bicep
> var corsOrigins = '["https://${containerApp.properties.configuration.ingress.fqdn}"]'
> { name: 'CORS_ORIGINS', value: corsOrigins }
> ```

## App-Internal Secret Storage (No Key Vault)

> ⛔ **No Key Vault is created.** Database/cache/storage access is managed-identity + token — there is NO connection-string password or access key to store. App-internal secrets that are NOT an Azure resource credential (e.g. `SECRET_KEY`, JWT signing key, third-party API keys) are stored **directly on the compute resource** from an `@secure()` param generated at deploy time.

**Where app-internal secrets go:**
- **App Service / Functions:** `@secure()` param → `siteConfig.appSettings` (platform-encrypted at rest), or set at deploy via `az webapp config appsettings set`.
- **Container Apps:** `@secure()` param → the CA's **native** `secrets: [{ name, value }]` → `secretRef`. No `keyVaultUrl`. Native secrets have no RBAC dependency, so they need no `isPlaceholder` gating (two-phase wiring is still needed for ACR registries + real image only).

```bicep
// Container Apps — native secret (NOT keyVaultUrl)
secrets: [
  { name: 'secret-key', value: secretKey }  // value from an @secure() param
]
```

> ⛔ **Do NOT hardcode secrets in committed files** — not in `main.parameters.json`, `terraform.tfvars`, env vars, or any generated file. (`@secure()` Bicep params ARE the correct way to pass an **app-internal** secret at deploy time — the ban is on committing the value, not on the parameter. Databases/caches/storage have NO secret param — they use managed identity.) The deploy phase generates each app-internal secret ONCE and passes it as an `@secure()` param — see [code-deployment-appservice.md](../../deploy/references/code-deployment-appservice.md) or [code-deployment-container-apps.md](../../deploy/references/code-deployment-container-apps.md).

## Azure Managed Service SSL/TLS Requirements

> ⛔ **Azure managed databases and caches enforce TLS. Local docker-compose configs typically don't.** This mismatch causes container crashes post-deploy.

Check `prereq-output.json.warnings[]` for warnings with `fixPhase: "scaffold"`. Each warning's `fix` field describes the required IaC change. Read the app's config loader for the actual env var name.

> ⛔ **Prefer env var override over code change.** Only modify source if no env override path exists AND user approves.
> ⛔ **Self-review:** If any `fixPhase: "scaffold"` warning exists and IaC lacks the fix → flag as FLAGGED.

## App-Internal Secret Naming

> ⛔ **Container Apps native secret names allow only lowercase alphanumeric characters and hyphens.** Map env var names: `SECRET_KEY` → `secret-key`, `JWT_SECRET` → `jwt-secret`. Do NOT use underscores or uppercase. (App Service app settings keep the original env var name, e.g. `SECRET_KEY`.)

## Compose → Azure PaaS Credential Mapping (Entra-only)

> ⛔ **Azure managed databases are provisioned Entra-only — there is no username/password to map.** Docker-compose `POSTGRES_USER`/`POSTGRES_PASSWORD` / `MYSQL_USER`/`MYSQL_PASSWORD` are DROPPED, not translated. The app connects with its **managed identity**: the DB username is the app MI's principal name and the "password" is an Entra token fetched at runtime. Map the compose DB **name** (`POSTGRES_DB`/`MYSQL_DATABASE`) to the app DB; do NOT emit any password env var. See [database-post-deploy.md](../../deploy/references/database-post-deploy.md) for granting the MI a DB role.
