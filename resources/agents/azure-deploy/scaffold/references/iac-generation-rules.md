# IaC Generation Rules — Steps 5–8

Rules for infrastructure code, Dockerfiles, security verification, telemetry wiring.

## Step 5 — Generate IaC

For each service in `services[]`:

> **Sub-agent delegation:** Use [subagent-iac-gen.md](subagent-iac-gen.md) verbatim. Include full `prepare-plan.json`, `ScaffoldManifest` interface, compute-target patterns. Self-review (Step 9) remains mandatory.

> **PostgreSQL wiring:** Include firewall + extension allow-list (see [subagent-iac-gen.md](subagent-iac-gen.md) Step 6 when planned). ⛔ **PostgreSQL config resources** (e.g., `require_secure_transport`) must use `source: 'user-override'`; `'system-default'` is read-only and ARM rejects it. ⛔ **Do NOT create `databases/postgres` child resource**; it exists and duplicate creation fails. **BuildKit Dockerfiles:** Generate `Dockerfile.azure` for ACR compatibility; see [code-deployment-container-apps.md § BuildKit](../../deploy/references/code-deployment-container-apps.md).

> **Env var completeness:** Read `.env.example` (or `.env.sample`, `config.example`) + config/settings files (Pydantic `Settings`, `@t3-oss/env-nextjs`, Django `settings.py`) for each component to enumerate required env vars before generating IaC. Every env var with a placeholder value (not `localhost`) should map to either: (1) a Bicep parameter, (2) a **managed-identity KV reference** for an app-internal secret (NOT an Azure resource credential), or (3) a value derived from other resources. ⛔ **Database/cache/storage access is managed-identity + token — wire connection *parameters* (host, db name, MI username, `sslmode=require`) as plain app settings, never a connection-string password or access key.** ⛔ **Container Apps:** KV `secretRef` entries must be gated behind `isPlaceholder` — Phase 1 = `secrets: []`, Phase 2 activates KV refs. See [bicep-container-apps.md](bicep-container-apps.md). Flag unmapped vars in selfReview as ⚠️ WARN. Missing vars cause container crash loops at deploy time.

> ⛔ **Set `targetScope = 'subscription'` in `main.bicep`.** Subscription scope creates resource group with all 5 AppOnboard tags, including `created-at`. Do NOT use default resource-group scope; imperative `az group create` misses tags. Deploy automatically falls back to RG scope without subscription permission.

> ⛔ **Native module deploy strategy.** If `prepare-plan.json.deployStrategy` exists, read [bicep-app-service.md § Native Module Deploy Strategy](bicep-app-service.md); apply startup command + app settings to App Service Bicep. Put `deployStrategy.startupCommand` in `appCommandLine` and `deployStrategy.requiredAppSettings` in `appSettings[]`. Without `deployStrategy`, do NOT set `appCommandLine`; use Oryx default.

### Session Tags — Mandatory on ALL Resources

⛔ Add all 5 AppOnboard tags to every resource and module. See [bicep-patterns.md § tags](bicep-patterns.md) for Bicep or [terraform-patterns.md § tags](terraform-patterns.md) for HCL.

| Tag key | Value source |
|---------|-------------|
| `app-onboard-skill` | `'true'` |
| `app-onboard-session-id` | `sessionId` param |
| `created-at` | ISO timestamp (scaffold populates, deploy may override) |
| `environment` | `naming.resourcePrefix` |
| `deployed-by` | `context.json.azure.userDisplayName` |

When extending IaC, MERGE tags using `union()` / `merge()`.

> ⛔ **Do NOT generate `azure.yaml`.** Use `az deployment sub create`. See [pipeline-rules.md](../../references/pipeline-rules.md) § azure.yaml prohibition.

### Verification

⛔ **API version verification:** Use `apiVersions` map. For missing type, use latest GA from reference examples, without `-preview`. `az bicep build` catches invalid versions.

⛔ **Resource property verification:** Training data references deprecated properties. Known traps: `Microsoft.CognitiveServices/accounts/deployments` uses `sku` (name + capacity), NOT `scaleSettings` (deprecated) — omit `raiPolicyName`. ⛔ **Do NOT emit a `Microsoft.KeyVault/vaults` resource at all** (no Key Vault). Fallback: `az bicep build` + `what-if`.

### Output

`infra/main.bicep`, `main.parameters.json`, `modules/{service}.bicep` per service.

### Platform Compatibility

- **Line endings:** Generated `.bicep` needs LF, not CRLF; Bicep triple-quoted strings pass literal `\r` to ARM, crashing container `/bin/sh`. Validate subagent runs `mcp_bicep_format_bicep_file` (or `bicep-format_bicep_file`). If unavailable, ensure LF manually.
- **Shell compatibility:** Bicep multiline startup scripts MUST use POSIX `set -eu`. Do NOT use `set -euo pipefail`; Container Apps images use `/bin/sh` (dash), not bash.
- **Package manager pinning:** Pin Dockerfile package managers to project `packageManager` version (e.g., `pnpm@9.4.0`). Never `@latest`; major drift breaks older Node.js images.

### Security Patterns — Apply During Generation

⛔ Apply ALL patterns from [`bicep-patterns-security.md`](bicep-patterns-security.md) during generation — managed identity, SCM/FTP auth policies, on-compute app-internal secrets (NO Key Vault), least-privilege RBAC.

## Step 6b — Dockerfile Generation (conditional)

If any `prepare-plan.json.services[]` entry has `name` containing "Container Apps" AND component lacks Dockerfile, ⛔ **MUST read [`dockerfile-generation.md`](dockerfile-generation.md)** and generate one. Skip if all have Dockerfiles or no Container Apps target.

## Step 7 — Secure-by-Default Verification

⛔ Read [`bicep-patterns-security.md`](bicep-patterns-security.md) (or `terraform-patterns.md` § Security Defaults); verify ALL Step 5 security patterns. For compute with MI ↔ resource RBAC, ⛔ read [rbac-roles.md](rbac-roles.md) GUID table. **For missing roles, check [Azure built-in roles docs](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles).** Never guess GUIDs. Skip RBAC for SWA-only.

Tell user applied patterns: managed identity, KV secrets, least-privilege RBAC, SCM/FTP auth, private endpoints.

## Step 8 — Wire Telemetry

If `prepare-plan.json.instrumentation.appInsightsEnabled` is `true`, add plain `APPLICATIONINSIGHTS_CONNECTION_STRING` wired from App Insights module. Not secret; no KV. Container Apps: plain env var, not `secretRef`.
