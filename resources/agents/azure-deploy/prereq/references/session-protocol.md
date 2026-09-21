# Session Protocol — Step 1

## All Prompts Are Actionable

> ⛔ **ALL prompts activating this agent are actionable — start Step 1.** Before pipeline start, do NOT answer questions, summarize capabilities, or describe AppOnboard. "Can Azure figure out my app?" and "Deploy my app" both mean Step 1 → Step 2 → scan. Question versus command does NOT change workflow.

## Session Check

Resolve active session from pointer file.

> ⛔ **CREATE A SESSION BEFORE ANY WORK, INCLUDING SCANNING**
>
> 1. **STOP** — Do not answer, scan code, or plan architecture
> 2. **CHECK** — Read `.copilot-azure/sessions/active-session.json`.
>    - **Pointer exists** →
>      1. ⛔ **Read [`session-schemas.ts`](session-schemas.ts)** for exact `AppOnboardContext`, `PrereqOutput`, and `PreparePlan` fields and types; never guess. Read pointed session's `context.json`. Display: "Found session from [lastModifiedUtc] — {statusSummary}."
>      2. ⛔ **MANDATORY `ask_user` GATE — NOW, before ANY branch.** Call `ask_user`: "Resume this session or start fresh?" **Never auto-resume, advance to staleness check, or present cached findings.** Wait for user. Stale test sessions can silently reuse old results and skip phase instructions.md; staleness check cannot determine relevance, only user can.
>      3. **Branch on user's answer** (only after `ask_user` returns):
>         - Resume → **Staleness check (prereq phase only):** If `completedPhases` includes `"prereq"`, run `git rev-parse HEAD`; compare with `context.json.repo.lastScanCommit`. Different commit OR missing `lastScanCommit` → say "Repo has changed since last scan — re-running prereq." Continue at instructions.md Step 2 without session creation. Identical → present cached `prereq-output.json` findings and go to instructions.md Step 8 (Route). Then ⛔ **Read NEXT phase instructions.md**, derived from `completedPhases`; e.g., prereq done → `prepare/instructions.md`. Continue that phase.
>         - Start fresh → generate UUID via `[guid]::NewGuid().ToString()`, create session folder, point `active-session.json` to it. Never touch old session folder again.
>    - **Pointer missing but session folders exist** → list `.copilot-azure/sessions/`. With 1 folder, adopt it: read `context.json`, write pointing `active-session.json`, show summary. With 2+, show numbered `statusSummary` + `lastModifiedUtc`, ask user to choose or start fresh, then write chosen pointer.
>    - **No sessions at all** → run `[guid]::NewGuid().ToString()` in terminal. ⛔ **Generate UUID via terminal; never hardcode placeholder such as `a1b2c3d4-e5f6-7890-abcd-ef1234567890`.** Create directory: `New-Item -ItemType Directory -Path ".copilot-azure/sessions/{uuid}" -Force`. Using `create`, write minimal `context.json` with only 3 immediately known fields: `{ "sessionId": "{uuid}", "createdUtc": "{ISO 8601 now}", "intent": { "userPrompt": "{user's first message verbatim}" } }`. Using `create`, write `active-session.json` with `activeSessionId: {uuid}`.
> 3. **PRUNE** — After resolving active session, delete remaining sessions whose `context.json.lastModifiedUtc` is >7 days old. **Never delete active session** pointed to by `active-session.json`.
> 4. **VERIFY** — Confirm existing valid-JSON `context.json`. If missing or malformed, halt and retry creation; never reach Step 2 without verification.
> 5. **CONFIRM** — Start first response: "Started session at `.copilot-azure/sessions/{uuid}/`" (new) or "Resuming session from [date] — {statusSummary}" (existing)
> 6. **THEN** proceed to Step 2
>
> ⛔ **Order: session FIRST, scanning SECOND.** Reading or scanning project files before writing `context.json` violates session-first. Session must exist before ANY code analysis.
>
> ⛔ **Shell fallback:** If first PowerShell/terminal attempt has no output after 10s, use `create` directly for session directory and files. Never retry shell more than once.
>
> ⛔ **Path scoping: ALL `create` tool calls for session artifacts MUST target `.copilot-azure/sessions/{active-session-id}/`.** Writing to any other session folder is forbidden.

## CLI Availability

Call `mcp_azure_mcp_extension_cli_install` with `cli-type: "az"` to verify Azure CLI. If absent, show installation instructions before continuing; prepare and deploy require it. Skip only if MCP tool unavailable.

## Azure Login Gate

**Azure login gate (mandatory):** Run `az account show --query "{id:id, name:name, tenantId:tenantId}" -o json` with **5-second timeout** (PowerShell: `Start-Process` with `-Wait` or inline timeout; >5s = failure). On success, merge `subscriptionId`, `subscriptionName`, `tenantId` into `context.json.azure` using `replace_string_in_file` or file rewrite; minimal context.json from Step 1 sub-step 2 may lack `azure`.

> ⛔ **If `az account show` fails or hangs:** ⛔ **Read and follow [`subscription-resolution.md`](subscription-resolution.md) fallback.** Do NOT reach Step 2 unresolved or leave `context.json.azure` empty. Prepare, scaffold validation, and deploy require Azure auth; without it results are incomplete.

## User Identity Detection

**User identity detection (for `deployed-by` tag):** After successful `az account show`, run `az ad signed-in-user show --query displayName -o tsv` (5-second timeout). Write to `context.json.azure.userDisplayName`. If `az ad` fails, use `az account show --query user.name -o tsv` (UPN/email). If both fail, leave empty for prepare to resolve. This becomes ALL resources' `deployed-by` tag; resolve once for consistency.

## Subscription Detection Method

> ⛔ **`az account show` is Step 1's ONLY subscription detection.** Never call `mcp_azure_mcp_subscription_list` here; it returns ALL subscriptions across ALL tenants, causing lengthy picker detour. `az account show` returns active CLI subscription in <1 second. Reserve MCP list for prepare Step 1 when user explicitly requests another subscription.

## Artifact Locations

| Location | Artifacts |
|----------|-----------|
| `.copilot-azure/sessions/{uuid}/` | `context.json`, `prereq-output.json`, `prepare-plan.json`, `scaffold-manifest.json`, `deploy-result.json` |

## Phase-gated Reference Loading

> ⛔ **Phase-gated reference loading.** Never pre-read downstream references. Read phase references only upon entry. Scaffold references are irrelevant during deploy; prepare references during scaffold. Each phase instructions.md defines required reads.
