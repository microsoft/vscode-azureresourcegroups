# Subscription Resolution — Defensive Fallback

The `azure-app-onboard` orchestrator resolves subscription at Step 1 (login hard gate), writing `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure` before any phase. Normally, `context.json.azure.subscriptionId` is set before prepare.

At prepare entry, verify `context.json.azure.subscriptionId`. If set (expected), use it.

If `context.json.azure` is empty, resolve instead of halting:

1. **Check env vars** — if `AZURE_SUBSCRIPTION_ID` is set, use it (and `AZURE_TENANT_ID` if set). Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
2. **Run `az account show`** — `az account show --query "{id:id, name:name, tenantId:tenantId}" -o json`. If it succeeds, **auto-select** — write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`. Do NOT run `az account list` or present a picker.
3. **Fallback: `mcp_azure_mcp_subscription_list` + picker** — only when `az account show` fails. Call `mcp_azure_mcp_subscription_list` for all subscriptions (`subscriptionId`, `displayName`, `isDefault`).
   - **1 subscription** → auto-select without asking. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
   - **2+ subscriptions** → use `ask_user` picker. List each choice as `"{displayName} ({subscriptionId})"`; mark default. Write selected `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
4. **MCP tool fails** → run `az login` (interactive browser login). If that fails (no browser, remote session), fall back to `az login --use-device-code`. After login succeeds, retry from step 2. Do NOT proceed without a resolved subscription.
