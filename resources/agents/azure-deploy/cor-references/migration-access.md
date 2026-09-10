# Migration database access — tier ladder

How to reach the provisioned database to run migrations. **Work down the tiers in order.**
Record the tier you used in `deploy-result.json`.

The generated IaC already grants the *deployed app* database access via
`AllowAllAzureServicesAndResourcesWithinAzureIps` (`0.0.0.0`, consented at the Scaffold Gate).
That rule allows **Azure services**, not arbitrary public IPs — so compute already running inside
Azure can reach the database and a developer laptop cannot. This is why tiers 1 and 2 need no
network change and tier 3 does.

## Tier 1 — Exec inside the deployed app (default)

The migration tool, its dependencies, and the connection string already exist in the running app.
Nothing to install, no secret to move, no network change.

**Container Apps**

```powershell
az containerapp exec -n {ca} -g {rg} --subscription {sub} --command "{migration_command}"
# If the migration tool lives outside WORKDIR:
az containerapp exec -n {ca} -g {rg} --subscription {sub} --command "cd /app/backend && alembic upgrade head"
```

**App Service (Linux only)**

```powershell
az webapp ssh -n {app} -g {rg} --subscription {sub}
```

Discover `{migration_command}` from the table in
[`deploy/references/database-post-deploy.md`](../deploy/references/database-post-deploy.md).

**Move to tier 2 when:**

- The image is a slim/multi-stage build that dropped the migration CLI (`alembic`, `prisma`,
  `dotnet-ef`, `sequelize-cli` not on `PATH`).
- Container Apps has scaled to zero and there is no replica to exec into.
- App Service on **Windows** (`az webapp ssh` is Linux-only).
- `exec` cannot return a usable exit code or output for verification.

> ⛔ `az containerapp exec` is TTY-oriented. Capture the output explicitly and verify the schema
> state afterward — a zero exit code from the shell is **not** proof the migration applied.

## Tier 2 — One-shot job in the same environment

Runs inside the same Container Apps environment (and therefore the same VNet), so it inherits the
app's database connectivity with **no firewall change**. This is the correct choice when the app
image lacks migration tooling or cannot be exec'd into.

Use a job image that contains the migration tool (commonly the app's *build* stage rather than its
runtime stage), the same connection configuration as the app, and a `Never` restart policy. Delete
the job once it completes, and record its creation in `deploy-result.json` so it is not mistaken
for an orphaned resource by `capture_deployment_inventory`.

**Move to tier 3 only when:** there is no Azure-side compute in the database's network at all (for
example a database provisioned without an accompanying app service), or the job cannot be created.

## Tier 3 — Temporary single-IP firewall rule (last resort)

⛔ **Preconditions — all must hold. If any fails, do not proceed; fall back to tier 2 or fail the
deploy.**

1. Tiers 1 and 2 are genuinely impossible. State why in `deploy-result.json`.
2. The server's `publicNetworkAccess` is already **Enabled**. If it is Disabled, or the server is
   reachable only through a private endpoint, **stop** — do not enable public access.
3. The migration can run with the developer's own Entra credentials. Do **not** copy the admin
   password to the local machine to satisfy this tier.

**Use the extension's tools.** They record the baseline, scope the rule to a single IP, and remove
it in a real finally — including on crash or abort, which prompt instructions cannot guarantee:

- `open_database_migration_access` → creates `cor-tempmigration-{sessionId}-{expiry}`
- `close_database_migration_access` → removes it and verifies the rule list matches the baseline

Both are `copilot-azure-resources-extension-tools/*` tools. If they are not in your active tool
list, load them with `tool_search` → `activate_tools` as described in the agent's MCP tools
section — do **not** treat them as unavailable and fall back to `az`.

**Only if those tools genuinely cannot be loaded**, use `az` — and obey every rule below:

- **Record the baseline first**, before any change:
  `az postgres flexible-server firewall-rule list`, `az mysql flexible-server firewall-rule list`,
  or `az sql server firewall-rule list`. Write it into the session directory.
- **Add only a single-IP rule** (`startIpAddress` equal to `endIpAddress`) for the current client.
- **Never** widen to `0.0.0.0`–`255.255.255.255`, **never** disable enforcement, **never** delete
  or modify a pre-existing rule, **never** touch VNet rules or `publicNetworkAccess`.
- **Restore on every path** — success, failure, timeout, or user abort — so the firewall matches
  the recorded baseline exactly.
- **If restoration fails**, treat it as a deploy failure, name the exact rule that remains, and do
  not report a clean deployment.

### Determining the client IP

Do **not** call a third-party IP echo service. Let Azure tell you: attempt the connection and read
the refusal, which contains the egress IP as Azure sees it — the only value the rule needs.

```text
Azure SQL:    Client with IP address 'x.x.x.x' is not allowed to access the server.
PostgreSQL:   no pg_hba.conf entry for host "x.x.x.x"
```

Confirm the detected IP with the user before creating the rule.

## Verification (all tiers)

A green HTTP status is not proof. Confirm the migration tool reports up to date **and** that the
expected tables exist, then re-run the health check so the app exercises the migrated schema.

If migrations cannot be completed, write the failure into `deploy-result.json` and treat the deploy
as failed rather than reporting success over an un-migrated database.
