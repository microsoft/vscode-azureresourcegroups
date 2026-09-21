# Subscription Resolution — Defensive Fallback

At Step 1 login hard gate, `azure-app-onboard` resolves subscription and writes `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure` before phases run. Normally `context.json.azure.subscriptionId` exists before prepare.

At prepare entry, verify `context.json.azure.subscriptionId`. If set (expected), use it; done.

If `context.json.azure` empty, resolve instead of halting:

1. **Check env vars** — if `AZURE_SUBSCRIPTION_ID` set, use directly, with `AZURE_TENANT_ID` if set. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`; done.
2. **Run `az account show`** — `az account show --query "{id:id, name:name, tenantId:tenantId}" -o json`. Success → **auto-select**; write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`. Never run `az account list` or show picker.
3. **Fallback: `mcp_azure_mcp_subscription_list` + picker** — only after `az account show` failure. Call `mcp_azure_mcp_subscription_list` for all subscriptions (returns `subscriptionId`, `displayName`, `isDefault`).
   - **1 subscription** → auto-select without question. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
   - **2+ subscriptions** → via `ask_user`, list each choice `"{displayName} ({subscriptionId})"` and mark default. User selects. Write `subscriptionId`, `subscriptionName`, `tenantId` to `context.json.azure`.
4. **MCP tool fails** → try `az login` (interactive browser). If failure (no browser/remote), use `az login --use-device-code`. Success → retry step 2. **Maximum 3 total login attempts**. After 3rd failure, **HALT once** with clear action: exact `az login --tenant <tenant>` command and note re-invoking agent resumes session with completed phases preserved. Never retry past 3 or proceed unresolved.
