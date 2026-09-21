# Session Protocol — Step 1

## All Prompts Are Actionable

> ⛔ **ALL activating prompts actionable; go directly to Step 1.** Before pipeline, never answer question, overview capabilities, or describe AppOnboard. "Can Azure figure out my app?" = "Deploy my app": Step 1 → Step 2 → scan. Question vs command never changes workflow.

## Session Check

Resolve active session through pointer.

> ⛔ **YOU MUST CREATE A SESSION BEFORE DOING ANY WORK — INCLUDING SCANNING**
>
> 1. **STOP** — Do not answer, scan code, or plan architecture yet
> 2. **CHECK** — Read `.copilot-azure/sessions/active-session.json`.
>    - ⛔ **First ensure repo `.gitignore` contains `.copilot-azure/`**; append if missing, create file if absent. Run on EVERY path below BEFORE any branch writes session files because artifacts may hold deploy secrets.
>    - **Pointer exists** → ⛔ **MUST read [`session-schemas.ts`](session-schemas.ts)** for exact `AppOnboardContext` fields/types; never guess. Read pointed session's `context.json`. Display: "Found session from [lastModifiedUtc] — {statusSummary}." ⛔ **Via `ask_user`, MUST ask: "Resume this session or start fresh?" Never auto-resume.** Mandatory gate prevents stale tests skipping phase instructions.md reads/artifact writes.
>      - Resume → ⛔ **Refresh deployment inventory baseline before more provisioning.** Preserve current `deploy-result.json.createdResources[]` + `orphanedResourceGroups[]`; call `capture_deployment_inventory` with `phase: "baseline"`, `context.json.sessionId`, `context.json.azure.subscriptionId`. Missing subscription/auth refresh → complete Azure login gate first. Until baseline succeeds, never run `az deployment`, `az group create`, `az webapp deploy`, `az acr build`, or any resource-creating command. New baseline begins resumed inventory segment: union later capture with preserved inventory by normalized resource ID + case-insensitive resource-group name; never discard pre-resume cleanup evidence. Then ⛔ **read NEXT phase instructions.md**, derived from `completedPhases`. E.g., prereq done → read `prepare/instructions.md`, continue there.
>        - ⛔ **If `context.json.routeToSkill` set:** Previous session halted for migration (e.g., `azure-cloud-migrate`); code likely changed. **Never skip prereq**. Start fresh: clear `routeToSkill`, `routeReason`, remove `"prereq"` from `completedPhases`, rerun Step 2. Gives migrated codebase clean 3-axis evaluation.
>        - ⛔ **If `completedPhases` includes `"prereq"` without `routeToSkill`:** Prereq wrote `prereq-output.json` + `context.json.components[]`. Proceed Step 2 scope triage; standalone prereq still requires user full-pipeline confirmation. Skip Step 3 prereq invocation; continue Step 4 scan-informed intent.
>      - Start fresh → generate UUID via `[guid]::NewGuid().ToString()`; create session folder; point `active-session.json` to new session. Never touch old folder again.
>    - **Pointer missing, session folders exist** → list `.copilot-azure/sessions/`. 1 folder: adopt; read `context.json`, write pointing `active-session.json`, show summary. 2+: show numbered `statusSummary` + `lastModifiedUtc`, ask user choose or start fresh. Write chosen pointer.
>    - **No sessions** → terminal-run `[guid]::NewGuid().ToString()`. ⛔ **MUST generate UUID through terminal; never hardcode placeholder such as `a1b2c3d4-e5f6-7890-abcd-ef1234567890`.** Create directory: `New-Item -ItemType Directory -Path ".copilot-azure/sessions/{uuid}" -Force`. Then write **minimal** `context.json` via `create`; only 3 immediately known fields: `{ "sessionId": "{uuid}", "createdUtc": "{ISO 8601 now}", "intent": { "userPrompt": "{user's first message verbatim}" } }`. Write `active-session.json` with `activeSessionId: {uuid}` via `create`.
> 3. **PRUNE** — After active resolution, inspect remaining session folders. Delete those with `context.json.lastModifiedUtc` >7 days old. **Never delete active session** pointed to by `active-session.json`.
> 4. **VERIFY** — Confirm existing valid-JSON `context.json`. Missing/malformed → halt + retry creation; never continue Step 2 unverified.
> 5. **CONFIRM** — Start first response: "Started session at `.copilot-azure/sessions/{uuid}/`" (new) or "Resuming session from [date] — {statusSummary}" (existing)
> 6. **THEN** proceed to Step 2
>
> ⛔ **Order: session FIRST, scan SECOND.** Scanning workspace/reading project before writing `context.json` violates rule. Session must precede ANY code analysis.
>
> ⛔ **Shell fallback:** First PowerShell/terminal attempt hangs (no output after 10s) → use `create` directly for session directory + file writes. Never retry shell over once.
>
> ⛔ **Path scope: ALL session-artifact `create` calls MUST target `.copilot-azure/sessions/{active-session-id}/`.** Other session folders forbidden.

## CLI Availability

Call `mcp_azure_mcp_extension_cli_install` with `cli-type: "az"` to verify Azure CLI. Missing → show install instructions before proceeding; prepare/deploy require it. MCP unavailable → skip fallback.

## Azure Login Gate

**Azure login gate (mandatory):** Run `az account show --query "{id:id, name:name, tenantId:tenantId}" -o json` with **15-second timeout** (PowerShell `Start-Process` + `-Wait` or inline timeout; >15s = failure). Also run `az ad signed-in-user show --query displayName -o tsv` with 15-second timeout. After BOTH finish, merge ALL fields into `context.json.azure` in **ONE update**: `subscriptionId`, `subscriptionName`, `tenantId`, `userDisplayName`. Never separately update subscription/identity.

> ⛔ **If `az account show` fails/hangs:** ⛔ **MUST read + follow [`subscription-resolution.md`](subscription-resolution.md)** fallback. Never proceed Step 2 unresolved or with empty `context.json.azure`. Every downstream phase (prepare, scaffold validation, deploy) requires Azure auth; omission yields incomplete results.

## User Identity Detection

**User identity detection (`deployed-by` tag):** Run `az ad signed-in-user show --query displayName -o tsv` (15-second timeout) alongside `az account show`. If `az ad` fails, use `az account show --query user.name -o tsv` (UPN/email). Both fail → leave empty; prepare resolves. Value tags ALL resources as `deployed-by`; one resolution prevents inconsistent tags. **Merge into SAME `context.json` update as login gate; never separately.**

## Subscription Detection Method

> ⛔ **`az account show` is Step 1's ONLY subscription detection.** Never call `mcp_azure_mcp_subscription_list` here; it returns ALL subscriptions across ALL tenants, causing long picker detour. `az account show` returns CLI active subscription in <1 second. Reserve MCP list for prepare Step 1 when user explicitly wants another subscription.

## Artifact Locations

| Location | Artifacts |
|----------|-----------|
| `.copilot-azure/sessions/{uuid}/` | `context.json`, `prereq-output.json`, `prepare-plan.json`, `scaffold-manifest.json`, `deploy-result.json` |
| `.copilot-azure/sessions/{uuid}/replaced-files/` | Scaffold-displaced user files (existing IaC), stored at original relative path (**mirror path** = repo directory structure). Never overwrite/delete; move here preserving original. |

## Phase-gated Reference Loading

> ⛔ **Phase-gated references.** Never pre-read downstream references. Read phase references only upon step entry. Scaffold references (bicep-patterns, self-review) irrelevant during deploy; prepare references (service-mapping, pricing-guide) irrelevant during scaffold. Each phase instructions.md defines required reads.
