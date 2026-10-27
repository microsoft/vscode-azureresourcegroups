# Pipeline Rules — Runtime Reference

Known platform bugs and deploy timing. Read before deploy completion or on scaffold/deploy error.

For core pipeline rules (approval gates, phase lifecycle, session artifacts, security baseline), see [pipeline-rules.md](pipeline-rules.md).

## Known Platform Bugs

| Bug | Symptom | Workaround |
|-----|---------|------------|
| SWA CLI Windows path with spaces | `StaticSitesClient.exe` fails when workspace path contains spaces | Use a short, space-free temp path on FIRST attempt (e.g., `C:\temp\swadeploy` on Windows, `/tmp/swa-deploy` on macOS/Linux) — do NOT wait for retry. Copy app content to the temp path before running `swa deploy`. |
| `az deployment sub validate` HTTP stream | "HTTP response stream consumed" error (Azure CLI bug, also affects `create` in CLI 2.75.0+) | `validate`: use `az deployment sub what-if` instead. `create`: use `az rest --method PUT` on deployment URI as fallback. |
| `az quota list` extension error | `PermissionError: [WinError 5]` blocks extension commands | Use `az rest` instead (see [sku-quota-validation.md](../prepare/references/sku-quota-validation.md)) |
| Managed identity sidecar OOM on free-tier Linux | `503 Service Unavailable` with `Microsoft.Azure.WebSites.DataProtection` or `/msi/token` timeout | This is exactly why free tier is not used. Managed identity is REQUIRED and works on B1+; the compute floor is B1. Never provision F1/D1 (the sidecar OOMs there). |
| `Compress-Archive` path flattening | PowerShell's `Compress-Archive -Path $files.FullName` uses absolute paths, flattening directory structure | Use `System.IO.Compression.ZipFile` with relative paths instead |
| AADSTS530084 (Terraform) | Token protection conditional access policy breaks `azurerm` provider auth; regular `az` CLI commands work fine | Re-scaffold as Bicep |
| Secret values with shell special chars | App-internal secrets containing `$`, `` ` ``, `!`, `'`, `"` break when passed as inline CLI args (`--parameters key=val`) | **Pass app-internal secrets via `main.parameters.json` / `terraform.tfvars`, or as an `@secure()` param from a variable reloaded from `deploy-secrets.env`** — never inline. Prefer URL-safe generation (no `/+=` and no shell-special chars) so the value is safe everywhere. No Key Vault. |
| `az acr task logs` encoding crash | `UnicodeEncodeError` on Windows from Unicode chars in build logs | Use `--no-format` + strip non-ASCII, or REST API `listLogSasUrl` |
| `create` tool nested path failure | `"Parent directory does not exist"` when creating files in `.copilot-azure/sessions/{id}/` | Run `New-Item -ItemType Directory -Path {parent} -Force` before `create`. Platform tool limitation — agent always recovers. |
| Windows PowerShell `az rest` 415 error | `az rest --method put --body '{json}'` returns `415 Unsupported Media Type` on Windows PowerShell | Add `--headers "Content-Type=application/json"` to every `az rest --method put` call |

## Deploy Timing

- **B1 App Service cold-start:** After IaC creation, a newly created B1 plan needs ~30–90 seconds before the Kudu sidecar is ready. Deploying code immediately after `az deployment group create` returns can cause a 504 Gateway Timeout. Wait for sidecar readiness before code deployment.
- **Identity tag resolution:** Resolve `deployed-by` once at session start via `az ad signed-in-user show`. Without this, resources may receive inconsistent tag values (display name, UPN, or hardcoded strings) across different runs.

## Shell Rules

⛔ Shell variables do NOT persist between tool calls. Generate secrets inline within the command that consumes them — never store in `$env:` for later use. Use synchronous shells for all deploy-phase operations.
