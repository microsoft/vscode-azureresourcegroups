# Deploy — IaC Execution & Health Verification

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

> ⛔ **Healing loop:** ask user after 3 attempts, then every 5 (counter = `healingAttempts[].length`).

> ⛔ **Region lock:** Before `az deployment` retry, compare `--location` against `prepare-plan.json.deploymentVariables.location`. If changed → re-approval gate required. Update plan after approval.

> ⛔ **After compaction or any `az deployment`/`az webapp deploy`/`az acr build`/failed health check: re-read `deploy-checklist.md`.** If missing → fill from [`deploy-checklist-template.md`](references/deploy-checklist-template.md). On significant context loss: also re-read this instructions.md.

> ⛔ **Deterministic resource inventory (MANDATORY — do NOT rely on memory for what was created).** The `capture_deployment_inventory` MCP tool records exactly which Azure resources this session created by diffing a `resources.list()` snapshot taken **before** the first deployment against one taken **after** each attempt. Call it:
> - **Step 5b** with `phase: "baseline"` — BEFORE the first `az deployment` (once).
> - **Every time the user resumes this deployment** with `phase: "baseline"` — AFTER the user chooses Resume and the subscription is resolved, but BEFORE any further command that can provision resources. Preserve the inventory already in `deploy-result.json`; subsequent captures cover only the resumed segment and must be unioned into the preserved `createdResources[]`/`orphanedResourceGroups[]` by normalized resource ID/case-insensitive RG name.
> - **After EVERY `az deployment` attempt** (success, failure, or healing retry) with `phase: "capture"`, passing `expectedResourceGroup`, all `deploymentNames[]`, and every `resourceGroups[]` touched (including abandoned healing RGs).
> - **On the Step 9 failure path** before returning `status: "failed"`.
> It holds the baseline snapshot **in memory** (no files are written to the workspace) and, on `phase: "capture"`, returns the created resources classified as `expected`/`failed`/`orphaned`/`unverified` plus the orphaned resource groups. Write that output into `deploy-result.json.createdResources[]` and `orphanedResourceGroups[]` — the durable record. ⛔ **Build ready-to-run cleanup commands from `failed` entries only.** `orphaned` means "appeared during the deploy window but no deployment claimed it" — it may be a healing stray, or it may belong to someone else on a shared subscription, so present it as "review before deleting" with no delete command. If the tool returns `inventoryUnverified`, present no cleanup list at all (see [`references/mcp-tools.md`](references/mcp-tools.md)). After a resume, merge the new segment into the durable record rather than replacing prior entries. The tool never deletes anything and never writes to disk; it only reports.

| # | Step | Action | Artifact | Reference |
|---|------|--------|----------|-----------|
| 0 | **Dispatch preflight sub-agent** | ⛔ **You MUST dispatch [`subagent-preflight.md`](references/subagent-preflight.md) as a `task`.** ⛔ agent_type: `"task"` — NEVER `"general-purpose"`. Read the template, then your NEXT action MUST be `task`. If after reading the template your next action is `powershell`, `view`, or anything other than `task`, STOP — you are executing inline instead of delegating. Writes `deploy-checklist.md`. **`view` it immediately after return.** | `deploy-checklist.md` | ⛔ **You MUST read [`subagent-preflight.md`](references/subagent-preflight.md)** |
| 1 | **Read upstream artifacts** | Load `prepare-plan.json` + `scaffold-manifest.json`. Check `validationResult`. Resolve subscription + deployment variables. | — | — |
| 3 | **Preflight checks** | Auth, **mandatory what-if preview**, RBAC, RG per `deploy-checklist.md` § Preflight. | — | ⛔ **You MUST read `deploy-checklist.md`** (re-read if compaction occurred) |
| 4 | **Deploy approval gate** | Present cost + resource summary per `deploy-checklist.md` § Deploy approval gate format. | — | — |
| 5b | **Write deploy-result.json skeleton + baseline inventory** | ⛔ Read [`deploy-schemas.ts`](references/deploy-schemas.ts), write skeleton (`status: "in-progress"`). Must exist BEFORE first `az` command. ⛔ **Then call `capture_deployment_inventory` with `phase: "baseline"`** (passing `sessionId`, `subscriptionId`) BEFORE the first `az deployment` — this snapshots pre-existing resources (held in memory) so the post-deploy diff is accurate. | `deploy-result.json` | ⛔ **You MUST read [`deploy-schemas.ts`](references/deploy-schemas.ts)** |
| 6 | **Execute deployment** | ⛔ **BEFORE `az deployment sub create`:** Generate portal link — `$dn="{deploymentName}"; $r="/subscriptions/{subId}/providers/Microsoft.Resources/deployments/$dn"; $l="https://portal.azure.com/#view/Microsoft_Azure_Resources/DeploymentDetails.MenuView/~/overview/id/$($r.Replace('/','%2F'))"; Write-Output "LINK=$l"`. ⛔ **Auto-open link in browser:** `Start-Process $l 2>$null`. Print bare URL in chat (ctrl-clickable).<br>Auto-generate ALL `@secure()` params (`openssl rand -base64 32 \| tr -d '/+='`), NEVER `ask_user` for passwords; on retry reuse from `deploy-secrets.env` or Key Vault — NEVER regenerate (see deploy-safety.md § Deploy Checklist). THEN deploy IaC. ⛔ **After the deployment command returns (success OR failure), call `capture_deployment_inventory` with `phase: "capture"`** (`expectedResourceGroup`, all `deploymentNames[]`, every `resourceGroups[]` used) to record what was actually created and surface any orphans early. | — | ⛔ **You MUST read `deploy-checklist.md`** § Execute deployment |
| 6b | **Deploy application code** | ⛔ Deploy code for EVERY service in `prepare-plan.json.services[]`. Follow `deploy-checklist.md` § Code deploy. | — | ⛔ **You MUST read `deploy-checklist.md`** § Code deploy |
| 7 | **Health-check + SCM re-disable** | HTTP GET per endpoint (max 3 iterations). ⛔ **Multi-service apps:** Also inspect the response body for error patterns (`connection refused`, `MODULE_NOT_FOUND`, `localhost`, `SET-IN-DEPLOY-PHASE`) — HTTP 200 alone does not mean functional when the app depends on another service or KV secrets. Then ⛔ for EVERY App Service/Functions app run BOTH commands — no exceptions: `az rest --method put --url "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}/basicPublishingCredentialsPolicies/scm?api-version=2023-12-01" --headers "Content-Type=application/json" --body '{"properties":{"allow":false}}'` then verify: `az rest --method get --url "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}/basicPublishingCredentialsPolicies/scm?api-version=2023-12-01" --query properties.allow -o tsv` (must return `false`). | `deploy-result.json` full | ⛔ **You MUST read `deploy-checklist.md`** § Health check |
| 8 | **Finalize artifacts** | ⛔ Read [`deploy-schemas.ts`](references/deploy-schemas.ts). ⛔ Re-read `deploy-checklist.md` § Artifact verification — follow ALL 5 checks. ⛔ **Run a final `capture_deployment_inventory` (`phase: "capture"`) and populate `deploy-result.json.createdResources[]` + `orphanedResourceGroups[]` FROM its returned output** — do NOT hand-author these fields. ⛔ **No "live"/handoff message until you overwrite the skeleton `deploy-result.json`** — flip `status` off `"in-progress"` (→ `succeeded`/`failed`) and fill healthStatus, endpoints, completedUtc, deploymentNames, healingAttempts. Write `deployment-summary.md` (status table + health + portal link(s) + cleanup commands — same content as your handoff message). Update `context.json` — add `"deploy"` to `completedPhases`, `currentPhase: null`, `lastModifiedUtc`. Read back to confirm `status != "in-progress"` and `"deploy"` ∈ `completedPhases`. ⛔ **Then STOP — return to orchestrator. No further CLI commands.** | `deploy-result.json` final + `deployment-summary.md` + `context.json` update | ⛔ **You MUST read [`deploy-schemas.ts`](references/deploy-schemas.ts)** + ⛔ **Re-read `deploy-checklist.md` § Artifact verification** |
| 9 | **Error handling + healing** | ⛔ **Only if Steps 6/6b/7 returned nonzero exit code or health check failed.** Skip entirely on clean deploys. Classify errors, healing loop, PLAN_LEVEL_CHANGE re-approval per `deploy-checklist.md` § During healing. ⛔ **Even on unrecoverable failure:** first run `capture_deployment_inventory` (`phase: "capture"`) to record what was partially created, then write `deploy-result.json` with `status: "failed"`, `errorDetails`, and `createdResources[]`/`orphanedResourceGroups[]` from its returned output, and surface cleanup commands built from its `failed` entries only (list `orphaned` entries separately as "review before deleting", with no delete command) — before returning to orchestrator. `deploy-result.json` and the cleanup report must ALWAYS exist, especially on failure. | — | ⛔ **You MUST read [`error-classification.md`](references/error-classification.md)** |
