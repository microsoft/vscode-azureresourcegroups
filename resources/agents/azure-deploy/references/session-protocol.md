# Session Protocol — Step 1

## All Prompts Are Actionable

> ⛔ **ALL prompts that activate this agent are actionable — go directly to Step 1.** Do NOT answer the user's question, give an overview of capabilities, or describe what AppOnboard can do before starting the pipeline. "Can Azure figure out my app?" and "Deploy my app" are the same action: Step 1 → Step 2 → scan. The user's phrasing (question vs command) does NOT change the workflow.

## Session Check

Resolve active session via pointer file.

> ⛔ **YOU MUST CREATE A SESSION BEFORE DOING ANY WORK — INCLUDING SCANNING**
>
> 1. **STOP** — Do not answer the user's question, scan code, or plan architecture yet
> 2. **CHECK** — Read `.copilot-azure/sessions/active-session.json`.
>    - ⛔ **First, ensure the repo's `.gitignore` contains `.copilot-azure/`** (append if missing, create the file if absent) — this runs on EVERY path below, BEFORE any branch writes a session file, since session artifacts may hold deploy secrets.
>    - **Pointer exists** → ⛔ **You MUST read [`session-schemas.ts`](session-schemas.ts)** to get the exact field names and types for `AppOnboardContext`. Do not guess field names. Then read the pointed-to session's `context.json`. Display: "Found session from [lastModifiedUtc] — {statusSummary}." ⛔ **You MUST ask the user via `ask_user`: "Resume this session or start fresh?" Do NOT auto-resume.** This gate is mandatory — stale sessions from prior tests cause the agent to skip phase instructions.md reads and miss artifact writes.
>      - Resume → ⛔ **Refresh the deployment inventory baseline before any more provisioning.** Preserve the current `deploy-result.json.createdResources[]` and `orphanedResourceGroups[]`, then run the product inventory provider with `phase: "baseline"`, using `context.json.sessionId` and `context.json.azure.subscriptionId`. Prefer `capture_deployment_inventory`; when a CLI host does not load the in-process provider, run `deploy/scripts/capture-deployment-inventory.mjs` as documented in deploy instructions. If the subscription is missing or auth must be refreshed, complete the Azure login gate below first, but do not run `az deployment`, `az group create`, `az webapp deploy`, `az acr build`, or any other command that can create resources until the baseline succeeds. This new baseline starts a resumed inventory segment: union later capture output with the preserved inventory by normalized resource ID and case-insensitive resource-group name; never discard cleanup evidence from before the resume. Then ⛔ **read the phase instructions.md for the NEXT phase** (derive from `completedPhases`). E.g., prereq done → read `prepare/instructions.md`, then continue from that phase.
>        - ⛔ **If `context.json.routeToSkill` is set:** The previous session was halted for migration (e.g., `azure-cloud-migrate`). The code has likely changed since then. **Do NOT skip prereq** — start fresh: clear `routeToSkill`, `routeReason`, remove `"prereq"` from `completedPhases`, and re-run from Step 2. This ensures the migrated codebase gets a clean 3-axis evaluation.
>        - ⛔ **If `completedPhases` includes `"prereq"` (and no `routeToSkill`):** Prereq already wrote `prereq-output.json` and `context.json.components[]`. Proceed to Step 2 (scope triage) — prereq may have been invoked standalone, so the user still needs to confirm the full pipeline. Skip Step 3 (prereq invocation), then continue to Step 4 (scan-informed intent gathering).
>      - Start fresh → generate a new UUID via `[guid]::NewGuid().ToString()`, create a new session folder, update `active-session.json` to point to the new session. Old session folder is never touched again.
>    - **Pointer missing but session folders exist** → list folders under `.copilot-azure/sessions/`. If 1 folder: adopt it (read its `context.json`, write `active-session.json` pointing to it, show summary). If 2+: show a numbered list with `statusSummary` + `lastModifiedUtc` from each, ask user to pick one or start fresh. Write pointer for the chosen session.
>    - **No sessions at all** → generate a UUID by running `[guid]::NewGuid().ToString()` in the terminal. ⛔ **You MUST generate the UUID via a terminal command — do NOT hardcode a placeholder like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`.** Create the session directory: `New-Item -ItemType Directory -Path ".copilot-azure/sessions/{uuid}" -Force`. Resolve the exact current runtime model identifier (for example `gpt-5.6-sol`) from the session metadata, then write a **minimal** `context.json` using the `create` tool — only these 4 values are known immediately: `{ "sessionId": "{uuid}", "createdUtc": "{ISO 8601 now}", "execution": { "modelId": "{exact current runtime model id}", "selectedUtc": "{ISO 8601 now}" }, "intent": { "userPrompt": "{user's first message verbatim}" } }`. Write `active-session.json` with `activeSessionId: {uuid}` using the `create` tool.
> 3. **PRUNE** — After resolving the active session, check remaining session folders. Delete any where `context.json.lastModifiedUtc` is >7 days ago. **Never delete the active session** (the one `active-session.json` points to).
> 4. **VERIFY** — Confirm `context.json` exists and is valid JSON. If missing or malformed, halt and retry creation — do NOT continue to Step 2 without a verified session.
> 5. **CONFIRM** — Begin your first response with: "Started session at `.copilot-azure/sessions/{uuid}/`" (new) or "Resuming session from [date] — {statusSummary}" (existing)
> 6. **THEN** proceed to Step 2
>
> ⛔ **Ordering: session FIRST, scanning SECOND.** If you scan the workspace or read project files before writing `context.json`, you have violated the session-first rule. The session must exist before ANY code analysis.
>
> ⛔ **Shell fallback:** If PowerShell/terminal hangs on first attempt (no output after 10s), use the `create` tool directly for session directory and file writes. Do NOT retry shell commands more than once.
>
> ⛔ **Path scoping: ALL `create` tool calls for session artifacts MUST target `.copilot-azure/sessions/{active-session-id}/`.** Writing to any other session folder is forbidden.

## Execution Model Lock

At new-session creation and every resume, persist the exact current runtime model identifier in
`context.json.execution.modelId` and refresh `execution.selectedUtc`. A legacy session without `execution` must
be backfilled before any generic sub-agent dispatch.

> ⛔ **Every `task` or `runSubagent` call MUST pass `model: context.json.execution.modelId` explicitly.**
> Built-in `task` agents have their own default model; omitting `model` can silently route nested work to a
> different family even when the parent session is pinned. Never infer that inheritance occurred. If the
> runtime does not expose an exact model identifier, halt before delegation with an explicit model-lock
> blocker rather than dispatching on an agent-definition default.

## CLI Availability

Call `mcp_azure_mcp_extension_cli_install` with `cli-type: "az"` to verify Azure CLI is available. If missing, surface installation instructions before proceeding. Downstream phases (prepare, deploy) require it. Fallback: skip if MCP tool unavailable.

## Azure Login + Target-Lock Gate

**Azure login gate (mandatory):**

1. Extract any explicit subscription ID/name, tenant ID, resource group, and region from
   `context.json.intent.userPrompt` and the current user message. Then inspect `AZURE_SUBSCRIPTION_ID` and
   `AZURE_TENANT_ID`. Precedence is **explicit user target → environment target → saved locked target → active
   CLI default**. A lower-priority source may fill a missing field but may never replace a higher-priority
   value.
2. If the user or environment supplied a subscription, run
   `az account show --subscription {requestedSubscriptionIdOrName} --query "{id:id, name:name, tenantId:tenantId}" -o json`
   with a 15-second timeout. **Do not run an unscoped `az account show` first and do not call
   `az account set`.** Global CLI state is observation-only and is not permission to change the requested
   target.
3. If no explicit or saved subscription exists, run the unscoped `az account show` command with the same
   query and timeout. This is the only path allowed to adopt the active CLI default.
4. Compare the returned subscription to the request: a GUID request must equal returned `id`; a display-name
   request must equal returned `name` case-insensitively. Compare `tenantId` to every explicit/saved tenant.
   Lock the returned canonical ID and display name. A mismatch is a hard stop before session planning,
   what-if, inventory, or provisioning: authenticate to the requested tenant/subscription and rerun the
   scoped command. Never silently substitute the active subscription.
5. Run `az ad signed-in-user show --query displayName -o tsv` (15-second timeout). After both commands
   complete, merge all Azure fields into `context.json.azure` in a **single update**:
   `subscriptionId`, `subscriptionName`, `tenantId`, `userDisplayName`, any explicit `resourceGroup`/`region`,
   `selectionSource`, and `lockedFields`. Lock every field supplied by the user or environment plus the
   resolved subscription and tenant. Do not write separate subscription and identity updates.

On resume, preserve `lockedFields`. If the new prompt names a different locked subscription, tenant, resource
group, or region, require a fresh session or an explicit target-change approval; do not overwrite the field in
place.

> ⛔ **If `az account show` fails or hangs:** ⛔ **You MUST read [`subscription-resolution.md`](subscription-resolution.md)** and follow its fallback procedure. Do NOT proceed to Step 2 without a resolved subscription. Do NOT leave `context.json.azure` empty and continue. Every downstream phase (prepare, scaffold validation, deploy) requires Azure auth — proceeding without it produces incomplete results.

## User Identity Detection

**User identity detection (for `deployed-by` tag):** Run `az ad signed-in-user show --query displayName -o tsv` (15-second timeout) alongside `az account show`. Fallback if `az ad` fails: use `az account show --query user.name -o tsv` (returns UPN/email). If both fail, leave empty — prepare phase will resolve. This value becomes the `deployed-by` tag on ALL resources — resolving it once here prevents inconsistent tag values across resources. **Merge into the SAME `context.json` update as the azure login gate — do NOT write separately.**

## Subscription Detection Method

> ⛔ **A scoped `az account show --subscription {requestedId}` is the only detector when the prompt,
> environment, or saved session names a subscription.** An unscoped `az account show` is allowed only when
> no higher-priority target exists. Do NOT call `mcp_azure_mcp_subscription_list` unless neither scoped nor
> unscoped CLI resolution can identify the requested subscription. The active CLI default never overrides an
> explicit target.

## Artifact Locations

| Location | Artifacts |
|----------|-----------|
| `.copilot-azure/sessions/{uuid}/` | `context.json`, `prereq-output.json`, `prepare-plan.json`, `scaffold-manifest.json`, `deploy-result.json` |
| `.copilot-azure/sessions/{uuid}/replaced-files/` | User files displaced by scaffold (existing IaC), stored at their original relative path (**mirror path** = same directory structure as the repo). Never overwritten or deleted — moved here so the original is preserved. |

## Phase-gated Reference Loading

> ⛔ **Phase-gated reference loading.** Do NOT pre-read reference files for downstream phases. Read each phase's references only when entering that step. Scaffold references (bicep-patterns, self-review) are irrelevant during deploy; prepare references (service-mapping, pricing-guide) are irrelevant during scaffold. Each phase instructions.md specifies its own required reads.
