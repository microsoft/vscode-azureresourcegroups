# Database Post-Deploy Verification (Managed-Identity / Entra-Only)

Run schema migrations on AppOnboard-created databases (listed in `prepare-plan.json.services[]`) before health checks. The app must be running first — if it's crashing, fix that before attempting migrations.

> ⛔ **No passwords anywhere.** Databases are provisioned Entra-only (no `administratorLogin`/`administratorLoginPassword`, no access keys). Admin operations (create DB, grant the app's managed identity a role, run migrations) authenticate with an **Entra access token** minted for the deploying principal, which the Bicep set as the server's Entra administrator. There is no `deploy-secrets.env` DB password and no `pgAdminPassword` parameter.

## 0. Mint an Entra token for the deploying principal

The deployer is the Entra admin on the server (set by the DB module's `administrators` child resource). Mint a short-lived token and use it as the "password" for CLI connections. `{entraAdminName}` = the deployer's UPN / app display name (the `login` set in the server's `administrators` block).

```powershell
# PostgreSQL / MySQL Flexible Server (OSS RDBMS audience)
$dbToken = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
# Azure SQL (SQL audience)
$sqlToken = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv
```

## 1. Create the app database (if needed)

> ⛔ **Azure PostgreSQL/MySQL Flexible Server only creates the system `postgres`/`mysql` database by default.** If the app's config references a named database (e.g., `car_sale_db`, `myapp_production`), create it BEFORE the container starts — using token auth, never a password:
>
> ```powershell
> az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken `
>   -d postgres --querytext "CREATE DATABASE {dbName};"
> ```
>
> Detect the database name from: (1) `prereq-output.json.initCommands[]` with `type: "db-migrate"`, (2) app config files (`config-docker.yml`, `.env`, `database.yml`), (3) compose `POSTGRES_DB` env var. If the container crashes with `database "X" does not exist`, this step was missed. (MySQL app DBs are emitted in Bicep as a `flexibleServers/databases` child — no CLI step needed.)

## 2. Grant the app's managed identity a database role

The app authenticates with its **managed identity**, which must exist as a database principal. Do this ONCE, as the Entra admin, before migrations. `{appMiName}` = the compute resource name (system-assigned MI display name); `{appMiObjectId}` = its object id.

**PostgreSQL:**
```powershell
az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken -d {dbName} --querytext @"
SELECT * FROM pgaadauth_create_principal('{appMiName}', false, false);
GRANT ALL PRIVILEGES ON DATABASE {dbName} TO ""{appMiName}"";
GRANT ALL ON SCHEMA public TO ""{appMiName}"";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ""{appMiName}"";
"@
```

**MySQL:** `CREATE AADUSER '{appMiName}' IDENTIFIED BY '{appMiObjectId}'; GRANT ALL PRIVILEGES ON `` `{dbName}`.* `` TO '{appMiName}'@'%'; FLUSH PRIVILEGES;`

**Azure SQL:** `CREATE USER [{appMiName}] FROM EXTERNAL PROVIDER;` then add to `db_datareader`, `db_datawriter`, and (if the app runs migrations) `db_ddladmin`.

**Discover the migration command** from the codebase (check in order):

| Signal | Command | Working directory |
|--------|---------|-------------------|
| `alembic.ini` exists | `alembic upgrade head` | Directory containing `alembic.ini` |
| Django `manage.py` exists | `python manage.py migrate` | Directory containing `manage.py` |
| `prisma/schema.prisma` exists | `npx prisma migrate deploy` | Project root |
| EF `Migrations/` directory | `dotnet ef database update` | Project root |
| Rails `db/migrate/` directory | `rails db:migrate` | Project root |
| Sequelize `migrations/` + `.sequelizerc` | `npx sequelize-cli db:migrate` | Project root |

## Execute via the Deployed Environment

Migrations run where the managed identity lives — inside the app, not from your workstation.

> ⛔ **The migration tool must authenticate with a token, not a password.** Either (1) the app already uses token auth (`DefaultAzureCredential` / `Authentication=Active Directory Default`) so the command works unchanged, or (2) inject a freshly minted MI token as the driver's password env var before running. If the app's stack cannot present an Entra token to the DB, do NOT re-enable password auth — surface a `FLAGGED` finding + `postDeployRecommendation` for the required client change.

### App Service (Linux only)

```powershell
az webapp ssh -n {app} -g {rg} --subscription {sub}
# Inside the session: export an MI token as the DB password (PGPASSWORD/MYSQL_PWD), set PGUSER={appMiName}, then run the migration command
```

### Container Apps

```powershell
az containerapp exec -n {ca} -g {rg} --subscription {sub} --command "/bin/sh -c 'export PGPASSWORD=$(curl -s \"$IDENTITY_ENDPOINT?resource=https://ossrdbms-aad.database.windows.net&api-version=2019-08-01\" -H \"X-IDENTITY-HEADER: $IDENTITY_HEADER\" | jq -r .access_token); export PGUSER={appMiName}; export PGSSLMODE=require; {migration_command}'"
```

> Preferred: bake the migration into the app's startup (`initCommands[]` → `appCommandLine`) using the app's own `DefaultAzureCredential` config, so migrations run token-based on every cold start (idempotent) with no exec step.

## Error Handling

If the migration command fails, classify as `IAC_ERROR` and check based on the database type:
- **AAD token / auth failure** (`password authentication failed`, `Login failed for token-identified principal`) → the app MI was not granted a DB role (§2), or Entra-admin/RBAC propagation hasn't completed. Verify the app MI principal exists, wait 60s, retry.
- DB unreachable → check firewall rules (PostgreSQL: `AllowAllAzureServicesAndResourcesWithinAzureIps`, SQL: server firewall, MySQL: similar)
- Extension/feature missing → check DB-specific config (PostgreSQL: `azure.extensions`, SQL: compatibility level, MySQL: `require_secure_transport`)
- Module not found → verify the runtime includes the migration tool

> ⛔ **Never weaken auth to unblock.** Do NOT set `passwordAuth: 'Enabled'`, add an `administratorLoginPassword`, or re-enable access keys to make a failing migration pass. Fix the grant (§2) or the client token config.

## PostgreSQL-Specific Checks

Run BEFORE migrations when `services[]` includes PostgreSQL Flexible Server:

1. **Token connectivity:** `az postgres flexible-server execute -n {pg} -g {rg} -u "{entraAdminName}" -p $dbToken -d postgres --querytext "SELECT 1"` — if this fails, the firewall rule is missing, the deployer is not the Entra admin, or AAD propagation hasn't completed. Check `AllowAllAzureServicesAndResourcesWithinAzureIps` exists and the `administrators` child deployed, wait 60s, retry
2. **Extension availability:** `az postgres flexible-server parameter show -g {rg} -n {pg} --name azure.extensions --query value -o tsv` — verify the extensions the app needs (e.g., `uuid-ossp` for Alembic/Django UUID fields) are in the allow-list. If missing, the Bicep module should have set them — check `infra/modules/postgresql.bicep`

## MySQL Flexible Server Checks

Run BEFORE migrations when `services[]` includes MySQL Flexible Server:

1. **Token connectivity:** `az mysql flexible-server execute -n {mysql} -u "{entraAdminName}" -p $dbToken -d mysql -q "SELECT 1"` — if this fails, check the firewall rule, that the Entra admin is set, and AAD propagation. Note: `execute` resolves by server name (no `-g` needed)
2. **SSL enforcement:** `az mysql flexible-server parameter show -g {rg} -n {mysql} --name require_secure_transport --query value -o tsv` — verify matches the app's connection SSL mode

## Azure SQL Checks

Run BEFORE migrations when `services[]` includes Azure SQL:

1. **Database online:** `az sql db show -g {rg} -s {sqlServer} -n {dbName} --query status -o tsv` — verify the database is `Online`
2. **Server firewall:** `az sql server firewall-rule list -g {rg} -s {sqlServer} -o table` — verify `AllowAllWindowsAzureIps` (0.0.0.0 → 0.0.0.0) exists for Azure-internal access
3. **Entra-only auth:** verify `azureADOnlyAuthentication` is `true` and the app MI has a contained user (§2)
