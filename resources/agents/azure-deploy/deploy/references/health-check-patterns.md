# Health Check Patterns

Health verification for AppOnboard-deployed resources.

## HTTP Endpoints

Per endpoint: HTTPS GET, 30s timeout, 3 retries (10s/20s/40s backoff).

| Status | Health | Note |
|--------|--------|------|
| 2xx | `healthy` | **Verify not placeholder (below)** |
| 401/403 | `healthy` | Auth working, app running |
| 5xx ×3 | `degraded` | |
| Timeout/DNS ×3 | `unreachable` | |

> ⛔ **DB-backed apps: 200 on `/` is NOT healthy.** When `prepare-plan.json.services[]` includes a database, `/` or another non-DB route proves only web server startup. Probe at least one **data-backed route** derived from detected app routes (e.g. REST resource path); inspect body for DB errors (`insecure transport`, `Access denied`, `connection refused`, `Unknown database`, `doesn't exist`) → `degraded`, not `healthy`.

### HTTP Redirect Handling (Container Apps)

> ⛔ **ACA health probes do NOT follow HTTP redirects.** Probe-path 301/302 causes `ActivationFailed`; treated as failure, not redirect.

If the first health check returns **301 or 302**:
1. Read the `Location` header: `curl -sI "https://{fqdn}{probePath}" | Select-String "^location:" -CaseSensitive:$false`
2. Update `probePath` in Bicep to the redirect target (e.g., `/wetty/` → `/wetty`)
3. Redeploy: `az deployment sub create` with updated Bicep
4. Re-check health after new revision activates

Common redirects: Express trailing-slash normalization (`/app/` → `/app`), framework path canonicalization, HTTPS redirects on mixed-content paths.

### App Service Default Page Detection

> ⛔ **HTTP 200 ≠ app started.** Azure serves its default page with 200 after app startup failure—a false positive.

After App Service HTTP 200, check body's first 2KB:

| Body contains | Meaning |
|---------------|--------|
| `"Your app service is up and running"` | Default page—app didn't start |
| `"Time to take the next step and deploy your code"` | Default page—no code or failed app |
| `"Hey, Python developers!"` / `"Hey, Node.js developers!"` | Runtime default—app didn't start |
| `"Error 503"` / `"Application Error"` | Startup crash |

If detected → `healthStatus: "degraded"` + warning: `"App Service default page detected — check logs: az webapp log tail -g {rg} -n {app}"`.

## Non-HTTP Resources

```bash
az resource show --ids {resourceId} --query "properties.provisioningState" -o tsv
```

`Succeeded` → `healthy`. `Failed` → `degraded`. Other → `unknown`.

| Service | Health Signal |
|---------|---------------|
| Container Apps | `latestReadyRevisionName` not empty + HTTP on ingress FQDN |
| App Service | HTTP GET `https://{name}.azurewebsites.net/` + `/health` |
| Static Web Apps | HTTP GET `https://{defaultHostname}/` → 2xx = `healthy` (hostname: `az staticwebapp show -n {swa} -g {rg} --query defaultHostname -o tsv`) |
| Azure SQL | `provisioningState` + `az sql db show` |
| Cosmos DB | `provisioningState` |
| Storage | `provisioningState` + `statusOfPrimary` |
| Functions | HTTP trigger URL + HTTP check |

> ⛔ **Container Apps—run explicit live HTTP probe; pipeline status is insufficient.** After `latestReadyRevisionName` is set, request ingress FQDN and capture result in `deploy-result.json.endpoints[].healthStatus`:
> ```powershell
> iwr "https://{ingressFqdn}/{probePath}" -UseBasicParsing   # PowerShell
> curl -sSfL "https://{ingressFqdn}/{probePath}"             # bash
> ```
> This live HTTP call against `*.azurecontainerapps.io` IS the health verification — do NOT infer health from the revision's internal status alone.

## Output

Write to `deploy-result.json.endpoints[]`:

```jsonc
{
  "name": "api",
  "url": "https://myapp-ca-dev-a1b2.azurecontainerapps.io",
  "healthStatus": "healthy"  // healthy | degraded | unreachable | unknown
}
```

Overall `healthStatus` = worst status across all endpoints. If any `unreachable` → overall `unreachable`.

## Functional Endpoint Verification

> ⛔ **A 200 on `/` only proves the web server booted — not that the app works.** After the HTTP check, confirm the app actually functions against the services the plan provisioned (database, cache), not just that it responds.

Health checks only confirm the web server is responding. Exercise a route that depends on the backing services — for example:

| Pattern | Functional Check |
|---------|-----------------|
| Database in the plan (MySQL/PostgreSQL/SQL/Cosmos) | Probe a route that reads/writes the DB (a detected app route, NOT `/` — root often serves a static page with no DB access, so 200 on `/` masks broken DB connectivity). A 5xx or a DB error in the body (`connection refused`, `does not exist`, token/auth failure) → `degraded` — usually the app MI wasn't granted a DB role (see [database-post-deploy.md](database-post-deploy.md) § 2). |
| `FIRST_SUPERUSER` env var or `prestart.sh`/`init_db()` | After health passes, attempt login endpoint. If 401/500 → startup scripts may have failed. Trigger `az containerapp revision restart` to re-run startup. |
| Migration frameworks (Alembic, Django, Prisma, EF) | After health passes, check `prereq-output.json` for migration signals. If found, run migrations per [database-post-deploy.md](database-post-deploy.md). |
| Two-phase Container Apps (managed identity) | Wait 60s after Phase 2 for AcrPull RBAC propagation. If the DB fails with auth/token errors, the app MI may not yet have its DB role — grant it (see [database-post-deploy.md](database-post-deploy.md)) and create a new revision. |
