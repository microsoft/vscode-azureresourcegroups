# Subscription Resolution — Defensive Fallback

The `azure-app-onboard` orchestrator resolves the subscription at Step 1 (login hard gate) and writes `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure` before any phase runs. In normal operation, `context.json.azure.subscriptionId` is always set by the time prepare runs.

At prepare phase entry, verify `context.json.azure.subscriptionId` is set. If it is (expected path), first run
`az account show --subscription {contextSubscriptionId} --query "{id:id, name:name, tenantId:tenantId}" -o json`
and compare it with every field in `context.json.azure.lockedFields`. A matching result preserves the saved
target — done. A mismatch halts before planning or provisioning; never replace a locked value with global CLI
state.

If `context.json.azure` is somehow empty, resolve now rather than halting the flow:

1. **Recover explicit prompt values first** — parse `context.json.intent.userPrompt` for a subscription and
   tenant. If present, run `az account show --subscription {requestedIdOrName}`. A GUID request must equal the
   returned ID; a display-name request must equal the returned name case-insensitively; require an exact tenant
   match when one was supplied. Write the returned canonical ID/name, `selectionSource: "user-prompt"`, and
   locked fields. Never fall through to an active default when this scoped lookup fails.
2. **Check env vars** — if `AZURE_SUBSCRIPTION_ID` is set, verify it with
   `az account show --subscription {envId}` (and require `AZURE_TENANT_ID` to match when set). Write
   `selectionSource: "environment"` and lock the resolved fields.
3. **Run unscoped `az account show` only when no explicit target exists** —
   `az account show --query "{id:id, name:name, tenantId:tenantId}" -o json`. If it succeeds, auto-select and
   write `selectionSource: "active-cli"` plus locked subscription/tenant fields. Do NOT run `az account list`
   or present a picker.
4. **Fallback: `mcp_azure_mcp_subscription_list` + picker** — only if no explicit target exists and unscoped
   `az account show` fails. Call `mcp_azure_mcp_subscription_list` to retrieve all subscriptions (returns
   `subscriptionId`, `displayName`, `isDefault`).
   - **1 subscription** → auto-select, no question. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
   - **2+ subscriptions** → present a picker via `ask_user`: list each subscription as a choice `"{displayName} ({subscriptionId})"` with the default marked. The user selects one. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
5. **MCP tool fails** → attempt `az login --tenant {explicitOrSavedTenant}` when a tenant is known; otherwise
   use interactive `az login`. If that fails (no browser, remote session), use `az login --tenant
   {explicitOrSavedTenant} --use-device-code` (omit `--tenant` only when genuinely unknown). On success, retry
   the same scoped lookup. **Cap login at 3 attempts total** — if login still fails after the 3rd attempt,
   **HALT once** with the exact login command and note that re-invoking the agent resumes this session. Do not
   retry past 3 attempts or proceed without a resolved, verified target.
