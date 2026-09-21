# MCP Tool Reference — Shared Index

Tools shared across AppOnboard phases + cross-cutting Phase→Tool Map. Per-phase references below contain phase-specific tools + full parameters.

> **Troubleshooting:** Unknown parameter or missing command errors → consult official current parameter names + allowed values: <https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/>

## Per-Phase Tool References

| Phase | File | Exclusive Tools |
|-------|------|-----------------|
| Prereq | *(shared tools only—see below)* | *(shared only)* |
| Prepare | [mcp-tools.md](../prepare/references/mcp-tools.md) | pricing, quota, cloudarchitect, WAF, advisor, group_resource_list, policy |
| Scaffold | [mcp-tools.md](../scaffold/references/mcp-tools.md) | bicepschema, all mcp_bicep_*, deploy (iac_rules/pipeline/plan), terraform best practices |
| Deploy | [mcp-tools.md](../deploy/references/mcp-tools.md) | resourcehealth, monitor, appservice, deploy (app_logs/arch_diagram), role |

---

## Global Parameters (all tools)

Every Azure MCP tool also accepts:

| Parameter | Description |
|-----------|-------------|
| `subscription` | Azure subscription ID/display name. Defaults to `az account show` default. |
| `tenant` | Entra ID tenant GUID/name. Omitted → default tenant. |
| `resource-group` | Resource group name. Required for most resource-specific operations. |

> **Additional global params** (rare for AppOnboard): `authentication-method` (credential\|key\|connectionString), `max-retries` (default 3), `retry-delay` (default 2s), `retry-delay-maximum` (default 10s), `retry-mode` (fixed\|exponential), `retry-network-timeout` (default 100s). Details: [official docs](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/).

---

## Shared Tools (used by 2+ phases)

### `mcp_azure_mcp_subscription_list`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| *(none)* | `tenant` | ✅ |

Returns `subscriptionId`, `displayName`, `state`, `tenantId`, `isDefault`. `isDefault: true` = default subscription.

Used by: **prepare** (Step 1), **deploy** (Step 1)

### `mcp_azure_mcp_group_list`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| *(none)* | `subscription`, `tenant` | ✅ |

Returns resource group names + IDs as JSON array.

Used by: **prepare** (Step 7), **deploy** (Step 3)

### `mcp_azure_mcp_extension_cli_install`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `cli-type` (az\|azd\|func) | `tenant` | ✅ |

Returns specified CLI tool's installation instructions.

Used by: **prereq** (Step 2), **deploy** (Step 3)

### `mcp_azure_mcp_get_azure_bestpractices` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `get_azure_bestpractices_get` | `resource` (general\|azurefunctions\|static-web-app\|coding-agent), `action` (all\|code-generation\|deployment) | — | ✅ |
| `get_azure_bestpractices_ai_app` | *(none)* | — | ✅ |

**Usage:** Both `resource` + `action` required for `_get`. `static-web-app` and `coding-agent` support only `action: "all"`.

Used by: **prereq** (Step 3), **scaffold** (Step 5)

---

## Tool Pitfalls

- **`mcp_azure_mcp_subscription_list` slow at scale:** Returns ALL subscriptions across ALL tenants (238+ in large orgs), causing long picker detours. Use `az account show` for active subscription (<1 second). Reserve `subscription_list` for prepare Step 1 only when user explicitly wants another subscription.
