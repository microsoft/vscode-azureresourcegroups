# Subagent Template — IaC Generation (Steps 5–8)

Generate deployment-ready IaC from `prepare-plan.json`. Each workflow step names required reference and action.

## Critical Rules

- ⛔ **Do NOT invoke other agents or hand off** — no external agent calls. Use THIS file only.
- ⛔ **Do NOT generate `azure.yaml`**
- ⛔ **Do NOT modify app source code** — only write files under `infra/` (and `Dockerfile.azure` if needed)
- ⛔ **Do NOT run app build/test/lint commands** (`npm test`, `npm run build`, `pnpm build`, `python -m pytest`, `dotnet build`, etc.). Only validate generated IaC via `az bicep build`.

## Input (provided by caller)

| Field | Source | Required |
|-------|--------|----------|
| `prepare-plan.json` content | Session folder — services, naming, quotas, cost, deploymentVariables | YES (verbatim) |
| `context.json.overrides` | `iacFormat`, `detectedInfraProvider` | YES |
| `buildRequirements` | From `prereq-output.json` — runtime, deps, Dockerfiles | YES |
| `warnings[]` | From `prereq-output.json` — warnings requiring IaC fixes (env var overrides, config changes), applied Steps 3–4. | YES |
| Compute targets | App Service/Functions, Container Apps, or both + whether PostgreSQL/Redis present | YES |
| `apiVersions` | `resourceType → latestGAVersion` map from main-thread MCP lookup. Use in generated Bicep; do NOT use training-data versions. If `"MCP unavailable"`, use Step 1 fallback. | YES |

## Output

| Artifact | Location |
|----------|----------|
| `infra/main.bicep` (or `main.tf`) | Workspace `infra/` |
| `infra/main.parameters.json` (or `variables.tf`) | Workspace `infra/` |
| `infra/modules/{service}.bicep` per service | Workspace `infra/modules/` |
| File list | Return to caller for `scaffold-manifest.json.files[]` |

## Workflow

### Step 1 — Read skeleton + tag patterns

Read [bicep-patterns.md](bicep-patterns.md) (Bicep) OR [terraform-patterns.md](terraform-patterns.md) (Terraform), NOT both.

**Do:** Extract `main.bicep` skeleton (targetScope, parameters, variables, resource group, module calls) and 5-tag block. Use `prepare-plan.json.naming` for every resource name; never derive with `take()`, `substring()`, `uniqueString()`, or string manipulation. Plan's 4-char session suffix provides uniqueness. ⛔ Every `resource 'Type@Version'` uses `apiVersions` input; missing types use reference examples.

> ⛔ **If `apiVersions` is `"MCP unavailable"` or lacks resource type:** run `az provider show --namespace {ns} --query "resourceTypes[?resourceType=='{type}'].apiVersions[?!contains(@, 'preview')] | [0][0]" -o tsv` per missing provider for latest GA. NEVER use training data; hallucinated API versions cause deploy healing cycles.

### Step 2 — Read compute-target patterns

Read ONLY plan-matching compute references; for multiple targets, read each:
- If plan has App Service/Functions → read [bicep-app-service.md](bicep-app-service.md).
- If plan has Container Apps → read [bicep-container-apps.md](bicep-container-apps.md).
- If plan has Static Web Apps → read [bicep-swa.md](bicep-swa.md).
- If plan has BOTH → read both.

**Do:** Generate compute modules from matching patterns. F1/D1 App Service: do NOT generate Dockerfile, do NOT add managed identity (OOM). App Service health probe: non-null `prereq-output.json.healthEndpoint` → set `siteConfig.healthCheckPath`; otherwise omit (do NOT default to `/`).

### Step 3 — Read security patterns

⛔ **You MUST read [bicep-patterns-security.md](bicep-patterns-security.md).** Apply its Key Vault, managed identity, HTTPS/TLS, credential hygiene rules to every module.

### Step 4 — Read generation rules

Read [iac-generation-rules.md](iac-generation-rules.md).

**Do:** Apply ALL reference rules to every module: mandatory tags, naming constraints, security, env-var completeness, Dockerfile generation. Do NOT skip any section.

### Step 5 — Read env var + secrets wiring

Read [env-var-secrets.md](env-var-secrets.md).

**Do:** For each component in the plan, read `.env.example` (or `.env.sample`, config files like Pydantic `Settings`, Django `settings.py`) from the workspace. Map every env var to either: (1) a Bicep parameter, (2) an **`@secure()` param stored on the compute resource** (App Service `appSettings` / Container Apps native `secrets`) for app-internal secrets that are NOT Azure resource credentials (e.g. `SECRET_KEY`, JWT key), or (3) a value derived from other resources. ⛔ **No Key Vault.** ⛔ **Database/cache/storage access is managed-identity + token — never a connection-string password or access key.** Wire DB/cache **connection parameters** (host, db name, MI username, `sslmode=require`) as plain `appSettings`/`env` values. See [bicep-patterns-security.md](bicep-patterns-security.md) § Data Services and § No Key Vault.

### Step 6 — Generate data modules (if needed)

ONLY when plan has PostgreSQL, MySQL, or Redis; otherwise skip.

**PostgreSQL Flexible Server module** — **Entra-only** (`authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Disabled', tenantId }`). NO `administratorLogin`/`administratorLoginPassword`. Add an `administrators` child resource setting the **deploying principal** as Entra admin (pass `entraAdminObjectId`/`entraAdminName`/`entraAdminType`). Include the `AllowAllAzureServicesAndResourcesWithinAzureIps` (`0.0.0.0`) firewall rule, extension allow-list (`azure.extensions` config: `uuid-ossp,pgcrypto,pg_trgm`), storage config (default 32 GB). Set the server `version` from `prepare-plan.json.services[].version` (capabilities-verified) — do NOT hardcode or guess. The app MI is granted a DB role post-deploy (see [database-post-deploy.md](../../deploy/references/database-post-deploy.md)).

**MySQL Flexible Server module** — **Entra-only**: a **user-assigned managed identity (REQUIRED for MySQL AAD auth)** + `identity: { type: 'UserAssigned', … }` on the server + an `administrators` child resource (deploying principal) with `identityResourceId` set to that UAMI (⛔ `null` fails to deploy) + `aad_auth_only: ON` config. NO password params. Emit a `postDeployRecommendation` to grant the UAMI **Directory Readers** in Entra. Include the MySQL-only deltas: `require_secure_transport: ON` config, the server `version` from `prepare-plan.json.services[].version` (ARM rejects major-only strings like `'8.0'` — needs an exact patch such as `'8.0.21'`), and a `flexibleServers/databases` child resource for the compose-declared DB name (e.g. `MYSQLDB_DATABASE`) so the app's schema DB exists in IaC before the container starts. See [bicep-patterns-data.md § MySQL Flexible Server Module](bicep-patterns-data.md).

**Redis Cache module** — Basic SKU, `enableNonSslPort: false`, `minimumTlsVersion: '1.2'`, **`disableAccessKeyAuthentication: true`** + `redisConfiguration: { 'aad-enabled': 'true' }` + an `accessPolicyAssignments` child granting the app MI Data Owner. ⛔ **No access key in Key Vault.** ⛔ Known Bicep type issue: `sku` property may cause BCP035/BCP187 warnings — these are false positives. If deploy fails with `InvalidRequestBody` for `properties.sku.name`, create via `az redis create --sku Basic --vm-size c0` then reference with `existing` keyword in Bicep.

Wire DB/cache **connection parameters** (host, db name, MI username, SSL required) as plain `appSettings`/`env` values — NOT secrets. The driver fetches an Entra token at runtime. App-internal (non-Azure) secrets are stored on the compute resource via an `@secure()` param (App Service `appSettings` / Container Apps native `secrets`) — ⛔ **no Key Vault**.

### Step 7 — Generate all files

> ⛔ **Before writing ANY file, verify:** (1) ⛔ **NO `Microsoft.KeyVault/vaults` resource anywhere** — app-internal secrets live on the compute resource. (2) No secrets in module outputs — `@secure()` params flow in at deploy, never out. (3) API versions from `apiVersions` input, not memory. (4) Container Apps: no `revisionSuffix`, placeholder image as default, `isPlaceholder` conditionals on registries only (native secrets need no gating).

**Do:** Create the `infra/` directory and write all files:
1. `infra/bicepconfig.json` — write `{ "formatting": { "newlineKind": "LF" } }` if it doesn't already exist (user's repo may have one). LF is critical because Bicep triple-quoted strings pass content literally to ARM, and `\r` bytes crash `/bin/sh` in containers.
2. `infra/main.bicep` — subscription scope, RG creation with tags, module calls for all services + `role-assignments` module (AcrPull + app-to-resource data-plane RBAC — NO Key Vault roles), all unconditional.
3. `infra/main.parameters.json` — ARM JSON format (NOT `.bicepparam`). Include `environmentName`, `location`, `sessionId`, `deployedBy`, `createdAt`, and `entraAdminObjectId`/`entraAdminName` (Entra DB admin = deployer). ⛔ **`createdAt` value:** run `Get-Date -Format "o"` in terminal to get the current ISO 8601 timestamp — NEVER use a hardcoded or placeholder date. Do NOT include `@secure()` app-internal secret params (passed at deploy time). Deploy phase passes the deployer object id via `az ad signed-in-user show --query id -o tsv`.
4. `infra/modules/{service}.bicep` — one module per service from the plan, PLUS `role-assignments.bicep` (AcrPull for Container Apps → ACR, and app-MI → resource data-plane roles per [rbac-roles.md](rbac-roles.md)). ⛔ **No Key Vault module and no Key Vault role assignments.**
5. If `buildRequirements.hasBuildKitSyntax == true`: ⛔ create `{component}/Dockerfile.azure` per [dockerfile-generation.md § ACR Build Compatibility](dockerfile-generation.md).
6. If Container Apps component has NO Dockerfile: read [dockerfile-generation.md](dockerfile-generation.md), then generate with its layer order, port alignment, security defaults. do NOT use memory.

> ⛔ **Container Apps health probes:** Path priority: (1) non-null `prereq-output.json.healthEndpoint`, (2) first detected app GET route, (3) `/` only with root handler. Do NOT default to `/` for sub-path-only APIs; 404 blocks activation. DB apps use `/healthz`, not `/readyz` (DB unwired in Phase 1).

### Step 8 — Validate syntax

**Do:** Run `az bicep build --file infra/main.bicep --stdout > $null`. Fix errors and retry (max 2). Do NOT use `azure-validate` agent.

### Step 9 — Return results

**Do:** Return generated file list and validation notes. Status ≤1500 tokens.
