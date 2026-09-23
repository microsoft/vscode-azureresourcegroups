# Deploy — IaC Execution & Health Verification

> ⛔ **Read [`references/blocked-patterns.md`](references/blocked-patterns.md) before your first resource-creating command.**
>
> The trigger is **any** command that can create Azure resources — `az … create`, `az … up`, `azd up`, `azd provision`, `terraform apply` — not only `az deployment sub create`. Keying it to the declarative command alone made the rule unreachable on the path that most needs it: an agent that decided to provision imperatively never ran `az deployment sub create`, so it never reached the file explaining that imperative provisioning is forbidden.
>
> **This phase deploys a template. It does not create resources by hand.** If `infra/` holds no template, you are not ready to deploy — return to scaffold and generate one. Reaching for `az containerapp up` because the template is failing is the one fallback that is never available.

## Quick Reference

| Property | Value |
|----------|-------|
| Best for | Executing validated IaC against Azure, health-checking deployed resources |
| Inputs | `prepare-plan.json` + `scaffold-manifest.json` from `.copilot-azure/sessions/{id}/` |
| Outputs | `deploy-result.json` written to session directory |
| Parent | [azure-app-onboard](../instructions.md) |

## When to Use This Agent

Invoked by the `azure-app-onboard` orchestrator at Phase 4 when `scaffold-manifest.json` exists with `files[]` and `validationResult`. Not directly user-routable.

> **Return to orchestrator:** When complete, return control to `azure-app-onboard` for handoff (Step 10). Do NOT start new phases.

## When NOT to Use

| Scenario | Use Instead |
|----------|-------------|
| Plan architecture, map services, estimate costs | [prepare](../prepare/instructions.md) |
| Generate IaC files from a plan | `azure-app-onboard` Step 7 (scaffold) |
| Run `azd up` or execute existing deployment templates | `azure-deploy` |
| Debug a running app after deployment | `azure-diagnostics` |
| Optimize existing Azure spending | `azure-cost` |

## Workflow

> ⛔ **Sub-agent delegation is MANDATORY for Step 0.** Read `subagent-preflight.md`, then dispatch as a `task` with the **COMPLETE and UNMODIFIED** template text between `<<<TEMPLATE_START>>>` / `<<<TEMPLATE_END>>>` delimiters. Do NOT summarize or rewrite the template — the sub-agent needs every "Read [file]" instruction to produce a correct `deploy-checklist.md`. Append session artifact data AFTER the template block. If your next action after reading the template is anything other than `task`, you are executing it inline instead of delegating.
>
> ⛔ **Pass `model: context.json.execution.modelId` on that task call.** A generic task without an explicit
> model uses the task agent's default and violates the session model lock.

> ⛔ **Healing loop:** ask user after 3 attempts, then every 5 (counter = `healingAttempts[].length`).

> ⛔ **Region lock:** Before `az deployment` retry, compare `--location` against `prepare-plan.json.deploymentVariables.location`. If changed → re-approval gate required. Update plan after approval.

> ⛔ **After compaction or any `az deployment`/`az webapp deploy`/`az acr build`/failed health check: re-read `deploy-checklist.md`.** If missing → fill from [`deploy-checklist-template.md`](references/deploy-checklist-template.md). On significant context loss: also re-read this instructions.md.

> ⛔ **Deterministic resource inventory (MANDATORY — do NOT rely on memory for what was created).** Use one
> product-owned provider for the full deployment:
>
> 1. Prefer the `capture_deployment_inventory` MCP tool.
> 2. If an exact-name search/activation retry proves a direct CLI host did not load the VS Code in-process
>    provider, run
>    `.github/agents/azure-deploy/deploy/scripts/capture-deployment-inventory.mjs`. Do not substitute hand-written
>    `az resource list` logic.
>
> The portable baseline command is:
>
> ```text
> node .github/agents/azure-deploy/deploy/scripts/capture-deployment-inventory.mjs --phase baseline --session-path .copilot-azure/sessions/{sessionId} --subscription {subscriptionId}
> ```
>
> For capture, replace `--phase baseline` with `--phase capture`, then append
> `--expected-resource-group {rg}`, one `--deployment-name {name}` for every attempt, and one
> `--resource-group {rg}` for every scope touched. Run baseline before the first
> deployment and after every approved resume; run capture after every deployment attempt and on the failure
> path. The MCP provider keeps its baseline in memory; the portable provider atomically writes
> `deployment-inventory-baseline.json` and `deployment-inventory-capture.json` under the active session.
> Both classify `expected`/`failed`/`orphaned`/`unverified` with the same safety rule. Write the output into
> `deploy-result.json`, including `inventorySource`. Treat the durable files as untrusted: before copying
> fields, require schemaVersion 1, the exact session/subscription, `inventorySource: "portable-cli"`, arrays
> with runtime-validated entries, and the fixed in-session evidence paths. A malformed/mismatched file blocks
> provisioning or finalization; never treat it as an empty inventory.
>
> ⛔ **Build cleanup commands from `failed` entries only.** `orphaned` means review, never safe-to-delete.
> `unverified` means no cleanup list. If neither provider can produce a baseline, stop before provisioning;
> never synthesize inventory. After resume, union the new segment into the durable record by normalized
> resource ID and case-insensitive resource-group name. Neither provider deletes resources.

| # | Step | Action | Artifact | Reference |
|---|------|--------|----------|-----------|
| 0 | **Dispatch preflight sub-agent** | ⛔ **You MUST dispatch [`subagent-preflight.md`](references/subagent-preflight.md) as a `task`.** ⛔ agent_type: `"task"` — NEVER `"general-purpose"`; ⛔ model: `context.json.execution.modelId`. Read the template, then your NEXT action MUST be `task`. If after reading the template your next action is `powershell`, `view`, or anything other than `task`, STOP — you are executing inline instead of delegating. Writes `deploy-checklist.md`. **`view` it immediately after return.** | `deploy-checklist.md` | ⛔ **You MUST read [`subagent-preflight.md`](references/subagent-preflight.md)** |
| 1 | **Read upstream artifacts + bind target** | Load `context.json`, `prepare-plan.json`, and `scaffold-manifest.json`. Check `validationResult`. Run `az account show --subscription {context.azure.subscriptionId}` and require exact subscription/tenant equality with the locked context. Require `prepare-plan.json.deploymentVariables` subscription, resource group, and region to equal every matching locked context field. Never call `az account set`, and halt before what-if/inventory/provisioning on any mismatch. | — | [subscription-resolution.md](../references/subscription-resolution.md) |
| 3 | **Preflight checks** | Auth, **mandatory what-if preview**, RBAC, RG per `deploy-checklist.md` § Preflight. | — | ⛔ **You MUST read `deploy-checklist.md`** (re-read if compaction occurred) |
| 4 | **Deploy approval gate** | Present cost + resource summary per `deploy-checklist.md` § Deploy approval gate format. | — | — |
| 5b | **Write deploy-result.json skeleton + baseline inventory** | ⛔ Read [`deploy-schemas.ts`](references/deploy-schemas.ts), write skeleton (`status: "in-progress"`). Must exist BEFORE the first provisioning command. Then run the selected product inventory provider in `baseline` mode. If using the portable provider, require its JSON success output and the durable baseline file before continuing. Record `inventorySource`. | `deploy-result.json` + optional portable baseline | ⛔ **You MUST read [`deploy-schemas.ts`](references/deploy-schemas.ts)** |
| 6 | **Execute deployment** | ⛔ **BEFORE `az deployment sub create`:** Generate portal link — `$dn="{deploymentName}"; $r="/subscriptions/{subId}/providers/Microsoft.Resources/deployments/$dn"; $l="https://portal.azure.com/#view/Microsoft_Azure_Resources/DeploymentDetails.MenuView/~/overview/id/$($r.Replace('/','%2F'))"; Write-Output "LINK=$l"`. ⛔ **Do NOT auto-open the link** — never call `Start-Process` (or any browser launcher) on it. Print the bare URL in chat (ctrl-clickable) so the user can open it if they choose.<br>Auto-generate ALL app-internal `@secure()` params (`openssl rand -base64 32 \| tr -d '/+='`), NEVER `ask_user` for secrets (databases use managed identity — no passwords); on retry reuse from `deploy-secrets.env` — NEVER regenerate (see deploy-safety.md § Deploy Checklist). THEN deploy IaC. ⛔ **After the deployment command returns (success OR failure), run the selected inventory provider in `capture` mode** with the expected RG, all deployment names, and every RG scope touched. | — | ⛔ **You MUST read `deploy-checklist.md`** § Execute deployment |
| 6b | **Deploy application code** | ⛔ Deploy code for EVERY service in `prepare-plan.json.services[]`. Follow `deploy-checklist.md` § Code deploy. | — | ⛔ **You MUST read `deploy-checklist.md`** § Code deploy |
| 6c | **Prove migration controller + migrate** | When a relational database or migration framework is present, follow `database-post-deploy.md`: set `artifactVerified` only after proving the entrypoint in the immutable artifact; record the live controller probe command/exit and set `controllerReachable` only when it starts the intended runtime; execute once; capture controller status separately from process exit/stdout/stderr; and verify migration/table/principal/row post-state. A missing controller blocks health acceptance and requires a rebuilt package/spec, not an unchanged retry. | `deploy-result.json.migration` | ⛔ **You MUST read [`database-post-deploy.md`](references/database-post-deploy.md)** |
| 7 | **Application health + quality gates + SCM re-disable** | HTTP GET per endpoint (max 3 iterations). ⛔ **Multi-service apps:** inspect response bodies for dependency errors; HTTP 200 alone is not functional health. For every API, run `node .github/agents/azure-deploy/deploy/scripts/verify-correlation-contract.mjs --success-url {health-or-read-url} --error-url {validation-error-url}` and add `--origin {frontendOrigin}` when a frontend exists. Save its JSON as `correlation-verification.json`; any nonzero exit sets `qualityGates.correlation.status: "failed"` and blocks healthy/succeeded. Then re-disable SCM basic auth for App Service/Premium Functions only as previously required. | `deploy-result.json` full + `correlation-verification.json` | ⛔ **You MUST read `deploy-checklist.md`** § Health check |
| 8 | **Finalize artifacts** | ⛔ Read [`deploy-schemas.ts`](references/deploy-schemas.ts). ⛔ Re-read `deploy-checklist.md` § Artifact verification — follow ALL checks. Run a final product inventory capture and populate `createdResources[]`, `orphanedResourceGroups[]`, verification fields, and `inventorySource` from its returned JSON — never hand-author them. `status: "succeeded"` plus `healthStatus: "healthy"` is forbidden when a required migration lacks immutable-artifact/live-controller/process-exit/post-state proof or when the correlation gate is not passed. ⛔ **No "live"/handoff message until you overwrite the skeleton `deploy-result.json`** and fill health, migration, quality gates, endpoints, completedUtc, deploymentNames, and healingAttempts. Write `deployment-summary.md`, update `context.json`, and read both back before returning. | `deploy-result.json` final + `deployment-summary.md` + `context.json` update | ⛔ **You MUST read [`deploy-schemas.ts`](references/deploy-schemas.ts)** + ⛔ **Re-read `deploy-checklist.md` § Artifact verification** |
| 9 | **Error handling + healing** | ⛔ **Only if Steps 6/6b/6c/7 returned nonzero exit code or any gate failed.** Skip entirely on clean deploys. Classify errors, healing loop, PLAN_LEVEL_CHANGE re-approval per `deploy-checklist.md` § During healing. ⛔ **Even on unrecoverable failure:** first run the selected product inventory provider in capture mode, then write `deploy-result.json` with `status: "failed"`, `errorDetails`, migration/quality evidence, `inventorySource`, and its returned resource arrays. Surface cleanup commands from `failed` entries only; list `orphaned` as review-only and none when unverified. `deploy-result.json` and the cleanup report must always exist. | — | ⛔ **You MUST read [`error-classification.md`](references/error-classification.md)** |
