# Code Deployment — Container Apps

After IaC creates the Container App with placeholder image (`mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`), deploy application code. This is **Phase 2** of two-phase Container Apps deployment.

> ⛔ **`--subscription {subscriptionId}` on EVERY `az` command** (from `context.json.azure.subscriptionId`). Otherwise CLI uses the active subscription, which may have changed since prepare. Applies to ALL commands below.

> ⛔ **Phase 2 is NOT optional.** If IaC used a placeholder image, you MUST execute Phase 2 before health checks. Do NOT leave it for manual user deployment.

**Choose code deploy path:**

| Condition | Path | Steps |
|-----------|------|-------|
| ACR exists in IaC (`services[]` has Container Registry) | ACR build + image update | Steps 1–4 below |
| No ACR, simple app (single Dockerfile or source) | Add ACR to IaC + redeploy, then ACR build | Step 0 + Steps 1–4 |
| No ACR in IaC, no Dockerfile, Oryx-compatible (Node/Python/Go/.NET) | `az containerapp update --source .` | Step 5 (Oryx shortcut) |

## Step 0 — Add ACR to IaC (if not already present)

Add `container-registry.bicep` module (ACR Basic, `adminUserEnabled: false`) + AcrPull role assignment for CA managed identity (role GUID: `7f951dda-4ed3-4680-a7ca-43fe172d538d`). Redeploy IaC; wait ~60s for AcrPull propagation. Log healing attempt.

⛔ Update `prepare-plan.json` (add ACR to `services[]`), `scaffold-manifest.json.files[]`, and `costEstimate`.

## Steps 1–4 — ACR Build + Image Update (IaC-compliant)

| Step | Command | Notes |
|------|---------|-------|
| 1. Build image | `az acr build --subscription {subscriptionId} -r {acrName} -t {appName}:latest . --no-logs` | Builds from workspace root. If `buildRequirements.hasBuildKitSyntax`, use `-f Dockerfile.azure` (see BuildKit handling below). ⛔ **Build-time env vars:** If Dockerfile has `ARG NEXT_PUBLIC_*` or `ARG VITE_*`, pass `--build-arg NEXT_PUBLIC_API_URL=https://{api-fqdn}` to inject the deployed API URL. These vars are baked into the JS bundle at build time — runtime env vars have no effect on client-side code. Get the API FQDN from Phase 1 output: `az containerapp show -g {rg} -n {apiApp} --query properties.configuration.ingress.fqdn -o tsv`. |
| 2. Update Bicep image | Edit `infra/modules/{containerapp}.bicep`: replace placeholder with `image: '{acrLoginServer}/{appName}:latest'`. Add ACR registry config: `registries: [{ server: acrLoginServer, identity: 'system' }]` | IaC-only — no imperative `az containerapp update` |
| 3. Redeploy | `az deployment sub create --subscription {subscriptionId} --location {location} --template-file infra/main.bicep --parameters @infra/main.parameters.json --parameters containerImage='{acrLoginServer}/{appName}:latest' --name app-onboard-code-deploy-{timestamp} --query properties.provisioningState -o tsv` | Emit new portal link. ⛔ No DB password param — databases are managed-identity only (see [Parameter Pass-Through](#parameter-pass-through-bicep-redeploy-safety)). |
| 4. Verify revision | `az containerapp show --subscription {subscriptionId} -g {rg} -n {ca} --query "{revision:properties.latestReadyRevisionName, image:properties.template.containers[0].image}" -o json` | Confirm image is not the placeholder |

> ⛔ **`az acr build` failures count toward the `deploy-result.json.healingAttempts[]` counter.** After 3 failed builds, regardless of root cause, pause and diagnose: "Web image build failed 3 times: [root causes]. Continue healing? (Yes / Cancel)." Each build fix = 1 healing entry. Follow deploy instructions.md healing loop.

> ⛔ **Windows: `az acr build` may fail with `UnicodeEncodeError`.** Azure CLI log streaming crashes on non-ASCII characters (✓, ✗) under Windows `charmap`. Append `--no-logs`; exit code still reports success/failure.

## Step 5 — Oryx Shortcut (no ACR needed, no Dockerfile)

```powershell
az containerapp update --subscription {subscriptionId} -g {rg} -n {ca} --source . --set-env-vars NODE_ENV=production
```

> ⛔ **`az containerapp update --source` is allowed ONLY for code deploy.** Unlike blocked `az containerapp up --source`, which creates resources imperatively, `update --source` updates an EXISTING Container App without state drift.

## App-Internal Secrets (native CA secrets — No Key Vault, no seeding step)

Set app-internal secrets directly as **native Container Apps secrets** in Bicep; supply values as `@secure()` deployment params. ⛔ **No Key Vault or `az keyvault secret set` step.** Generate each secret ONCE; pass on every `az deployment sub create`:

```powershell
$secretKey = (openssl rand -base64 32) -replace '[/+=]',''   # generate ONCE, persist to deploy-secrets.env
az deployment sub create ... --parameters secretKey=$secretKey --query properties.provisioningState -o tsv
```

> ⛔ Every retry/redeploy reloads the SAME value from `deploy-secrets.env` (shell variables don't persist between tool calls). Pass to EVERY deployment so desired-state apply keeps CA secret stable.

## After Code Deploy (all paths)

- Wait 30–60s for new revision readiness
- Proceed to Step 7 (Health-Check Endpoints)
- Placeholder health content → image update failed. Check `az containerapp revision list`

> ⛔ **`az containerapp revision restart` does NOT load changed secrets.** Container Apps bind secrets at revision *creation*. Load updated native secret by creating a NEW revision: redeploy Bicep (preferred) or `az containerapp update --revision-suffix rev{timestamp}`.

> ⛔ **ACR registries require existing CA managed identity + AcrPull.** Phase 1 of two-phase deploy creates Container App with placeholder image and `registries: []` (native secrets MAY be set in Phase 1; no RBAC dependency). ACR `registries` with `identity: 'system'` fails in Phase 1 because CA managed identity lacks principalId → AcrPull fails → "Operation expired". After Phase 1 + RBAC propagation (~60s), Phase 2 redeploys ACR registries + real image + correct `targetPort`.

## Config-File Apps (Go/Viper, Spring Boot, etc.)

Azure-specific config (e.g., `config-azure.yml`) may contain non-secret values.

> ⛔ **NEVER bake secrets into config files COPY'd into Docker images.**

**Secret injection:** Config placeholders → `az containerapp secret set` → `az containerapp update --set-env-vars KEY=secretref:name` → framework env override.

> **Go/Viper:** `AutomaticEnv()` maps `POSTGRES_PASSWORD` → `postgres_password` (underscores), NOT `postgres.password`. Without `SetEnvKeyReplacer(strings.NewReplacer(".", "_"))`, env vars cannot override nested keys.

## BuildKit Dockerfile Handling

ACR's `az acr build` uses classic Docker builder without BuildKit. When `buildRequirements.hasBuildKitSyntax == true`, use ACR-compatible copy: `az acr build -f Dockerfile.azure .`. Keep user's original Dockerfile untouched. If `Dockerfile.azure` is absent, create it by stripping BuildKit syntax per [`dockerfile-generation.md § ACR Build Compatibility`](../../scaffold/references/dockerfile-generation.md).

## Parameter Pass-Through (Bicep Redeploy Safety)

⛔ **Every redeploy passes the SAME original values.** Full desired-state apply, not patch; omitted params revert to defaults. Critical param:

- **`containerImage`** — omission restores Container App placeholder image.

> ⛔ **No `administratorLoginPassword` (or DB password/key) param exists**—databases use Entra/managed identity only. Nothing to re-pass; no `deploy-secrets.env` DB password. App-internal secrets (e.g. `SECRET_KEY`) live in Key Vault, read via app MI; they are not passed as deploy params.

```powershell
az deployment sub create ... `
  --parameters containerImage='{acrLoginServer}/{appName}:latest' `
  --query properties.provisioningState -o tsv
```

## Database Post-Deploy Verification

> ⛔ **You MUST read [`database-post-deploy.md`](database-post-deploy.md)** for migration discovery, Container Apps exec, error handling, and PostgreSQL checks.
