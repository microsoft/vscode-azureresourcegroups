# Database Post-Deploy Verification (Managed-Identity / Entra-Only)

Run schema migrations on AppOnboard-created databases (listed in `prepare-plan.json.services[]`) before health checks. App must run first; fix crashes before migrations.

> ⛔ **No passwords anywhere.** Databases use Entra-only provisioning (no `administratorLogin`/`administratorLoginPassword` or access keys). Admin operations (create DB, grant app managed-identity role, run migrations) use an **Entra access token** for deploying principal, set by Bicep as server Entra administrator. No `deploy-secrets.env` DB password or `pgAdminPassword` parameter.

## 0. Mint an Entra token for the deploying principal

Deployer is server Entra admin (set by DB module's `administrators` child). Mint short-lived token; use as CLI connection "password". `{entraAdminName}` = deployer UPN / app display name (`login` in server `administrators` block).

```powershell
# PostgreSQL / MySQL Flexible Server (OSS RDBMS audience)
$dbToken = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
# Azure SQL (SQL audience)
$sqlToken = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv
```

## 1. Create the app database (if needed)

> ⛔ **Azure PostgreSQL/MySQL Flexible Server creates only system `postgres`/`mysql` by default.** If app config references a named database (e.g., `car_sale_db`, `myapp_production`), create it BEFORE container start—token auth only, never password:
>
> ```powershell
> az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken `
>   -d postgres --querytext "CREATE DATABASE {dbName};"
> ```
>
> Detect the database name from: (1) `prereq-output.json.initCommands[]` with `type: "db-migrate"`, (2) app config files (`config-docker.yml`, `.env`, `database.yml`), (3) compose `POSTGRES_DB` env var. If the container crashes with `database "X" does not exist`, this step was missed. (MySQL app DBs are emitted in Bicep as a `flexibleServers/databases` child — no CLI step needed.)

## 2. Grant the app's managed identity a database role

The app authenticates with its **managed identity**, which must exist as a database principal. Do this ONCE, as the Entra admin, before migrations. `{appMiName}` = the compute resource name (system-assigned MI display name); `{appMiObjectId}` = its object id.

**PostgreSQL** — two connections are required. The `pgaadauth_*` functions exist **only on the `postgres` database** (running them on the app DB fails with `No function matches the given name and argument types`), and for a **managed identity** you must use the `_with_oid` variant with `objectType 'service'` (the name-only `pgaadauth_create_principal` can't resolve a managed identity by name). Roles are cluster-wide, so create the principal on `postgres`, then GRANT on `{dbName}`:

```powershell
# 2a. Create the Entra principal for the app MI — MUST run on the `postgres` database.
az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken -d postgres --querytext @"
SELECT * FROM pgaadauth_create_principal_with_oid('{appMiName}', '{appMiObjectId}', 'service', false, false);
"@

# 2b. Grant privileges — run on the app database {dbName} (the role already exists cluster-wide).
# NOTE: a PowerShell here-string does NOT treat "" as an escape — use a single " around the identifier
# (doubling it emits `TO ""myapp"";` → Postgres `zero-length delimited identifier`).
az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken -d {dbName} --querytext @"
GRANT ALL PRIVILEGES ON DATABASE {dbName} TO "{appMiName}";
GRANT ALL ON SCHEMA public TO "{appMiName}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{appMiName}";
"@
```

**MySQL:** `CREATE AADUSER '{appMiName}' IDENTIFIED BY '{appMiObjectId}'; GRANT ALL PRIVILEGES ON `` `{dbName}`.* `` TO '{appMiName}'@'%'; FLUSH PRIVILEGES;`

**Azure SQL:** `CREATE USER [{appMiName}] FROM EXTERNAL PROVIDER;` then add to `db_datareader`, `db_datawriter`, and (if the app runs migrations) `db_ddladmin`.

**Discover migration command** from codebase, in order:

| Signal | Command | Working directory |
|--------|---------|-------------------|
| `alembic.ini` exists | `alembic upgrade head` | Directory containing `alembic.ini` |
| Django `manage.py` exists | `python manage.py migrate` | Directory containing `manage.py` |
| `prisma/schema.prisma` exists | `npx prisma migrate deploy` | Project root |
| EF `Migrations/` directory | `dotnet ef database update` | Project root |
| Rails `db/migrate/` directory | `rails db:migrate` | Project root |
| Sequelize `migrations/` + `.sequelizerc` | `npx sequelize-cli db:migrate` | Project root |

## Execute via the Deployed Environment

Run migrations where managed identity lives—inside app, not workstation.

> ⛔ **Use token authentication, never password; PREFER app's own credential.**
> - **(1) Preferred — `DefaultAzureCredential`:** with DB config using `DefaultAzureCredential` / `Authentication=Active Directory Default`, migration command works **unchanged** as app MI. No token handling or `curl`/`jq`; works on slim/distroless. Use whenever possible.
> - **(2) Fallback — inject an MI token:** only when app cannot self-authenticate. Fetch token from container IMDS endpoint; pass as driver password env var (below). ⛔ Requires `curl` + `jq` (or `wget`) **in image**—absent on `slim`/`distroless`. If absent, do NOT hand-roll: surface `FLAGGED` finding + `postDeployRecommendation` to add `DefaultAzureCredential` to app DB config.
> - ⛔ NEVER re-enable password auth to unblock.

### App Service (Linux only)

```powershell
az webapp ssh -n {app} -g {rg} --subscription {sub}
```
Then **inside SSH session** (container shell—no PowerShell layer), token-injection fallback requires image `curl`+`jq`:
```bash
export PGPASSWORD="$(curl -s "$IDENTITY_ENDPOINT?resource=https://ossrdbms-aad.database.windows.net&api-version=2019-08-01" -H "X-IDENTITY-HEADER: $IDENTITY_HEADER" | jq -r .access_token)"
export PGUSER={appMiName} PGSSLMODE=require
{migration_command}
```

### Container Apps

**Preferred (DefaultAzureCredential—no injection; works on distroless):**
```powershell
az containerapp exec -n {ca} -g {rg} --subscription {sub} --command '{migration_command}'
```

**Fallback (token injection; image requires `curl`+`jq`):**
```powershell
# ⛔ SINGLE-QUOTE the whole --command so $(...) and $IDENTITY_* evaluate IN THE CONTAINER, not on the deployer.
#    (A double-quoted PowerShell string would run curl locally and expand $IDENTITY_* to empty → empty PGPASSWORD.)
az containerapp exec -n {ca} -g {rg} --subscription {sub} --command 'sh -lc "export PGPASSWORD=$(curl -s \"$IDENTITY_ENDPOINT?resource=https://ossrdbms-aad.database.windows.net&api-version=2019-08-01\" -H \"X-IDENTITY-HEADER: $IDENTITY_HEADER\" | jq -r .access_token); export PGUSER={appMiName} PGSSLMODE=require; {migration_command}"'
```

> Prefer startup migration (`initCommands[]` → `appCommandLine`) with app `DefaultAzureCredential`: token-based, idempotent every cold start, no exec or `curl`/`jq`.

## Error Handling

Migration failure → `IAC_ERROR`; check by DB type:
- **AAD token / auth failure** (`password authentication failed`, `Login failed for token-identified principal`) → missing app-MI DB role (§2) or incomplete Entra-admin/RBAC propagation. Verify app MI principal, wait 60s, retry.
- DB unreachable → check firewall (PostgreSQL: `AllowAllAzureServicesAndResourcesWithinAzureIps`; SQL: server firewall; MySQL: similar)
- Missing extension/feature → check DB config (PostgreSQL: `azure.extensions`; SQL: compatibility level; MySQL: `require_secure_transport`)
- Module missing → verify runtime includes migration tool

> ⛔ **NEVER weaken auth to unblock.** Do NOT set `passwordAuth: 'Enabled'`, add `administratorLoginPassword`, or re-enable access keys. Fix grant (§2) or client token config.

## PostgreSQL-Specific Checks

Run BEFORE migrations when `services[]` includes PostgreSQL Flexible Server:

1. **Token connectivity:** `az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken -d postgres --querytext "SELECT 1"` — failure means missing firewall rule, deployer not Entra admin, or incomplete AAD propagation. Verify `AllowAllAzureServicesAndResourcesWithinAzureIps` + deployed `administrators` child; wait 60s, retry
2. **Extension availability:** `az postgres flexible-server parameter show -g {rg} -n {pg} --name azure.extensions --query value -o tsv` — verify required extensions (e.g., `uuid-ossp` for Alembic/Django UUID fields) in allow-list. If missing, Bicep module should set them—check `infra/modules/postgresql.bicep`

## MySQL Flexible Server Checks

Run BEFORE migrations when `services[]` includes MySQL Flexible Server:

1. **Token connectivity:** `az mysql flexible-server execute -n {mysql} -u "{entraAdminName}" -p $dbToken -d mysql -q "SELECT 1"` — on failure, check firewall, Entra admin, AAD propagation. `execute` resolves by server name (no `-g`)
2. **SSL enforcement:** `az mysql flexible-server parameter show -g {rg} -n {mysql} --name require_secure_transport --query value -o tsv` — verify app connection SSL mode matches

## Azure SQL Checks

Run BEFORE migrations when `services[]` includes Azure SQL:

1. **Database online:** `az sql db show -g {rg} -s {sqlServer} -n {dbName} --query status -o tsv` — verify `Online`
2. **Server firewall:** `az sql server firewall-rule list -g {rg} -s {sqlServer} -o table` — verify `AllowAllWindowsAzureIps` (0.0.0.0 → 0.0.0.0) for Azure-internal access
3. **Entra-only auth:** verify `azureADOnlyAuthentication` is `true`; app MI has contained user (§2)
