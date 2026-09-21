# Blocked Patterns

Agent NEVER executes these commands. Non-negotiable; user runs them manually outside AppOnboard.

| Pattern | Action | Reason |
|---------|--------|--------|
| `rm -rf` (any path outside a fresh temp dir) | ⛔ Block | Prevents accidental IaC, app code, or session artifact deletion—especially `infra/`, `.azure/`, `.copilot-azure/`. |
| `git reset --hard`, `git checkout -- <path>`, `git restore`, `git clean` | ⛔ Block | Discards uncommitted work. Region-fallback healing edits Bicep/app config; these irrecoverably wipe unstaged changes. |
| `git push --force` / `--force-with-lease` (any branch) | ⛔ Block | Prevents generated code overwriting remote history. |
| `--no-verify` (on `git commit` / `git push`) | ⛔ Block | Bypasses protective hooks (secret-scan, lint). |
| `DROP TABLE` / `DROP DATABASE` | ⛔ Block | Prevents data loss |
| `terraform destroy` | ⛔ Block | Prevents accidental teardown; user runs manually |
| `az group delete` | ⛔ HARD BLOCK | **NEVER delete resource groups.** Region/RG switch during healing: track old RG in `orphanedResourceGroups[]` (per `OrphanResourceGroup` in [`deploy-schemas.ts`](deploy-schemas.ts)); do not delete. At handoff, emit `az group delete` commands for USER execution; agent never executes them. Before typing `az group delete` in terminal, STOP; track it in `orphanedResourceGroups[]`. |
| `az containerapp up --source` / `az containerapp create` | ⛔ Block | Imperatively creates ACR + CA Environment + Log Analytics: orphan resources invisible to `terraform destroy`, `az deployment sub delete`, and session tag-based bulk cleanup; unrecoverable IaC drift. Container App MUST use Bicep `az deployment sub create`; existing-CA code deploy uses `az containerapp update --source` (Step 6d). |
| `az appservice plan update` | ⛔ Block | Imperative SKU change—edit Bicep + redeploy |
| `az webapp update` | ⛔ Block | Imperative modification—all changes via IaC |
| `az functionapp update` | ⛔ Block | Imperative modification—all changes via IaC |
| `az webapp deployment source config-zip` | ⛔ Block | Requires SCM basic auth—use `az webapp deploy` (Entra auth). ⛔ **Only the `webapp` command is blocked.** `az functionapp deployment source config-zip` is the **ALLOWED** Flex Consumption function app deploy channel (blob-container package, not SCM basic auth)—see [`code-deployment-functions-flex.md`](code-deployment-functions-flex.md). |
| `az webapp deploy --track-status` | ⛔ Block | `--track-status` flag does not exist. Remove it. |
| `az webapp up` / `az webapp create` / `az appservice plan create` | ⛔ Block | Creates App Service Plan + App imperatively — bypasses IaC entirely |
| `az containerapp update` (config changes) | ⛔ Block | Imperative modification—all changes via IaC |
| `az containerapp update --revision-suffix` (no config changes) | ⚠️ ALLOWED | KV secret rotation only — when KV secrets were updated post-deploy and a new revision is needed to pick up cached values |
| `az webapp delete` | ⛔ Block | Imperative deletion—destroys resources outside IaC |
| `az appservice plan delete` | ⛔ Block | Imperative plan deletion — remove from Bicep + redeploy instead |
| `az containerapp update --image` | ⛔ Block (during healing) | Imperative image swap causes IaC drift — update Bicep + redeploy |
| Inline secret values in CLI args | ⛔ Block | `--parameters password=MyP@ss$word!` breaks shell escaping and leaks secrets in terminal history. Pass app-internal secrets via `main.parameters.json`, `terraform.tfvars`, or an `@secure()` param from a variable reloaded from `deploy-secrets.env` (no Key Vault). |
| Writing secrets to temp files on disk | ⛔ Block | ⛔ NEVER write rendered secrets to arbitrary temp files. Pass app-internal secrets as `@secure()` params; store on compute (App Service app settings / CA native secrets). Only persisted copy: git-ignored `deploy-secrets.env` reload cache under `.copilot-azure/`. Temp files risk crash-dump, log, and unprotected-storage exposure. |
| `az group create` (during healing) | ⛔ HARD BLOCK — **one sanctioned exception** | **NEVER create RGs imperatively during healing.** All RG creation uses `az deployment sub create` with Bicep `targetScope = 'subscription'`. Region fallback: update Bicep region parameter + redeploy. **Sole exception:** documented 403 scope-fallback in [`deploy-safety.md`](deploy-safety.md) § 403 Scope Fallback—after `az deployment sub create` returns 403, RG-scoped Bicep requires `az group create` with all 5 AppOnboard tags. |
| `az rest --method put/patch` (for individual resource creation) | ⛔ HARD BLOCK | **NEVER create individual Azure resources via REST API after Bicep failures.** ONLY fix Bicep parameters/template → rerun `az deployment sub create`. Bicep→ARM compilation + REST deployment remains imperative creation. |
| Disabling a security control to unblock — `require_secure_transport`/TLS → OFF, HTTPS-only off, KV purge protection off, auth off (via `az ... parameter set` OR editing the Bicep) | ⛔ HARD BLOCK | **NEVER weaken security to pass a failing deploy.** DB TLS handshake failure means missing client SSL config—fix client (prereq `W-MYSQL-SSL`/`W-PG-SSL`) or surface user tradeoff. Server-control downgrade forbidden. |
| `Compress-Archive -Path $files.FullName` | ⛔ Block | Absolute paths flatten directories—app crashes when `./src/app` is missing. Use `System.IO.Compression.ZipFile` with workspace-root-relative paths. On Windows, normalize: `$entryName = $relativePath.Replace('\', '/')`. |

> **Repos with existing `azure.yaml`:** See [`pipeline-rules.md`](../../references/pipeline-rules.md) § azure.yaml prohibition. Deploy via `az deployment sub create` — do NOT run `azd up`.
