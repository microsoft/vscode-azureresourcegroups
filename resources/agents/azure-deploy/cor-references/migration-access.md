# Migration database access — tier ladder

How to reach the provisioned database to run migrations. **Work down the tiers in order.**
Record the tier you used in `deploy-result.json`.

> ⛔ **Choose the tier during prepare, not mid-deploy.** The app's compute type already determines it —
> Functions on Flex Consumption can never use tier 1 — so record the intended tier and its host in
> `prepare-plan.json` and validate it under Deployment Viability. Discovering at deploy time that the
> chosen path is blocked is how a deployment ends up improvising an access route under time pressure.

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
- **The compute has no exec surface at all.** Azure Functions on **Flex Consumption** is the common
  case: it has no Kudu/SCM shell and no `exec` verb, so tier 1 never applies to it. Go straight to
  tier 2 — do **not** read the absence of a shell as "tiers 1 and 2 are impossible" and fall to tier 3.

> ⛔ `az containerapp exec` is TTY-oriented. Capture the output explicitly and verify the schema
> state afterward — a zero exit code from the shell is **not** proof the migration applied.

## Tier 2 — One-shot Azure-side job

Runs on compute **inside Azure**, which is the whole point: the `AllowAllAzureServicesAndResourcesWithinAzureIps`
rule the IaC already created admits it, so this tier needs **no firewall change** and no network
exception. This is the correct choice whenever the app image lacks migration tooling or the app has
no exec surface.

Pick the host by what the workload already has:

| App compute | One-shot host | Why |
|-------------|---------------|-----|
| Container Apps | Container Apps job in the same environment | Same VNet, inherits the app's connectivity |
| Functions (Flex Consumption), Static Web Apps, or any app with no shell | Container Apps job, or an Azure Container Instances group in the same region | Azure-side egress, so the existing Azure-services rule already admits it |
| App Service (Windows) | Same as above | `az webapp ssh` is Linux-only |

Use a job image that contains the migration tool (commonly the app's *build* stage rather than its
runtime stage), the same connection configuration as the app, and a `Never` restart policy. Give it
the **app's** managed identity — or an identity mapped as a database principal the same way — so the
token it presents is one the database already trusts. Delete the job once it completes, and record its
creation in `deploy-result.json` so it is not mistaken for an orphaned resource by
the selected product inventory provider.

### Tier-2 execution evidence and retry gate

Before starting the job, configure a durable log destination or a session-artifact capture for both stdout
and stderr. Record the immutable image digest, command, effective non-secret environment, identity resource
ID, retry limit, timeout, and intended migration-history table. Start the job with a deterministic execution
name and persist the start response immediately. Do not rely on retrieving ephemeral console logs after the
replica exits.

On completion, persist these as separate facts:

1. Application process exit code plus stdout/stderr, keyed by execution name.
2. Job-controller status/reason, replica timestamps, and retry count.
3. Migration-history state (`pgmigrations`, `_prisma_migrations`, `alembic_version`, or the framework
   equivalent) and the expected application tables.
4. Database principal name/object ID and a token-authenticated connectivity probe for the migration identity.

`BackoffLimitExceeded` says only that the controller exhausted the configured retry budget. With
`replicaRetryLimit: 0`, it follows any single nonzero process exit and is **not** the application root cause.
If stdout/stderr is missing, report the cause as `UNKNOWN`; do not relabel it `IAC_ERROR`,
`APPLICATION_ERROR`, authorization, network, or readiness based on the controller reason alone.

⛔ **No blind job restart.** A retry is allowed only after all four evidence groups above are captured:

- If history, expected tables, or principal/OID state is unknown or inconsistent, do not retry. Preserve the
  job and fail the deploy until the state is read and reconciled.
- If logs identify a transient failure and history/schema state proves no applied-but-untracked migration,
  allow at most **one unchanged retry** of that image/spec.
- If logs identify code, package, command, identity, or configuration failure, repair it, revalidate the
  image/spec, and count the next execution as a healing attempt rather than an unchanged retry.

After any successful execution, query migration history and expected tables again before deleting the job.
The health check is the final application-level proof, not a substitute for those database reads.

⛔ **Do not invent a migration surface inside the application to get around this.** Adding a
migration HTTP endpoint, an admin route, or a bootstrap function to the deployed app — even
temporarily — puts a schema-mutating entry point on a public service, changes the application under
test, and leaves the app's own controls unverified. Use a one-shot job.

**Move to tier 3 only when:** there is no Azure-side compute in the database's network at all (for
example a database provisioned without an accompanying app service) **and** no one-shot job can be
created in the subscription.

## Tier 3 — Temporary single-IP firewall rule (last resort)

⛔ **Preconditions — all must hold. If any fails, do not proceed; fall back to tier 2 or fail the
deploy.**

1. Tiers 1 and 2 are genuinely impossible. State why in `deploy-result.json`. "The app has no shell"
   is a reason to use tier 2, not a reason to reach tier 3.
2. The server's `publicNetworkAccess` is already **Enabled**. If it is Disabled, or the server is
   reachable only through a private endpoint, **stop** — do not enable public access.
3. The migration can run with the developer's own Entra credentials. Do **not** copy the admin
   password to the local machine to satisfy this tier.
4. No management lock or deny assignment blocks the write. Check before attempting:
   `az lock list --resource-group {rg} --subscription {sub}`. A governed subscription returns
   `ScopeLocked` on the firewall write, and that is a **policy answer, not a transient error** —
   do not retry it, do not attempt to remove the lock, and do not escalate. Go back to tier 2.

**Use the extension's tools.** They scope the rule to a single IP and guarantee its removal even
if this session dies — which prompt instructions cannot:

- `open_database_migration_access` → records a lease, then creates `cor-tempmigration-{sessionId}-{expiry}`
- `close_database_migration_access` → deletes that rule and clears the lease

The lease is written **before** the rule is created, and the extension reconciles outstanding
leases **on its next activation**. So if this session crashes, is compacted, or the window closes
mid-migration, the rule is removed when the workspace is reopened rather than surviving unnoticed.

> ⛔ Two things these tools do **not** do, so do not tell the user otherwise. They do **not**
> snapshot or compare the server's full firewall rule list — they only ever create and delete their
> own uniquely-named rule, and never read, modify, or remove any other rule. And cleanup on a crash
> happens at the **next activation**, not instantly. If `close_database_migration_access` reports
> that it could not remove the rule, the rule is still there until then: say exactly that, name the
> rule, and fail the deploy.

`open_database_migration_access` refuses rather than guessing when it cannot confirm the server's
network posture, or when ten exceptions are already outstanding in the workspace. A refusal is not
a failure to route around — fall back to tier 2, or fail the deploy.

Both are `copilot-azure-resources-extension-tools/*` tools. If they are not in your active tool
list, load them with `tool_search` → `activate_tools` as described in the agent's MCP tools
section — do **not** treat them as unavailable and fall back to `az`.

**Only if those tools genuinely cannot be loaded**, use `az` — and obey every rule below. Note that
this path has no crash safety at all: nothing records what you changed, so restoring it is entirely
your responsibility.

- **Record the baseline first**, before any change:
  `az postgres flexible-server firewall-rule list --subscription {sub}`,
  `az mysql flexible-server firewall-rule list --subscription {sub}`, or
  `az sql server firewall-rule list --subscription {sub}`. Write it into the session directory.
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
expected tables exist, then re-run the health check so the app exercises the migrated schema. For a
failed tier-2 job, complete the evidence and retry gate above before another execution.

If migrations cannot be completed, write the failure into `deploy-result.json` and treat the deploy
as failed rather than reporting success over an un-migrated database.
