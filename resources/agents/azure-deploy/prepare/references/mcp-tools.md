# Prepare Phase — MCP Tools

Prepare-only tool parameters. For shared tools (`subscription_list`, `group_list`, `get_azure_bestpractices`, `extension_cli_install`), see [mcp-tool-reference.md](../../references/mcp-tool-reference.md).

> **Troubleshooting:** For unknown parameter or missing command errors, see <https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/>

---

## `mcp_azure_mcp_pricing` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `pricing_get` | *(none)* | `service` (e.g. "Azure App Service"), `sku` (`armSkuName`), `region` (ARM name), `currency` (e.g. "USD"), `filter` (Retail Prices API OData) | ✅ |

**Usage:** Query Azure retail pricing. Use `service` + `region` broadly; `sku` for exact populated `armSkuName` (e.g., Redis Cache, App Service Premium); `filter` for advanced Retail Prices API OData. See [pricing-guide.md](pricing-guide.md) for service filters and meters.

## `mcp_azure_mcp_quota` (hierarchical)

> ⛔ **Do NOT use for AppOnboard quota checks.** Use `az rest` with Quota REST API; see [sku-quota-validation.md](sku-quota-validation.md). MCP's "No Limit" for unsupported resource types means unsupported, NOT unlimited.

| Command | Required Params | Optional Params | Read-Only |
|---------|----------------|-----------------|-----------|
| `quota_usage_check` | `region`, `resource-types` (ARM type, e.g. `Microsoft.Compute/virtualMachines`) | `subscription` | ✅ |
| `quota_region_availability_list` | `resource-types` (ARM type) | `subscription` | ✅ |

## `mcp_azure_mcp_cloudarchitect` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `cloudarchitect_design` | *(none)* | `question`, `question-number`, `total-questions`, `answer`, `next-question-needed` (bool), `confidence-score` (0.0–1.0), `state` (JSON: architectureComponents, architectureTiers, requirements{explicit,implicit,assumed}, confidenceFactors) | ✅ |

**Usage:** Multi-turn tool. For single-shot, populate `state`, set `confidence-score` ≥ 0.7 and `next-question-needed: false` for direct recommendation.

## `mcp_azure_mcp_wellarchitectedframework` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `wellarchitectedframework_serviceguide_get` | *(none)* | `service` (case-insensitive, hyphens/underscores/spaces OK, e.g. "cosmos-db", "App Service", "cosmosdb") | ✅ |

**Usage:** Omit `service` to list supported services; provide `service` for all 5 WAF pillars.

## `mcp_azure_mcp_advisor` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `advisor_recommendation_list` | *(none)* | `subscription`, `resource-group` | ✅ |

## `mcp_azure_mcp_group_resource_list`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `resource-group` | `subscription`, `tenant` | ✅ |

Returns group resource names, IDs, types, locations.

## `mcp_azure_mcp_policy` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| *(subscription scope)* | *(none)* | `subscription` | ✅ |

**Usage:** Bulk-fetch blocked types, required tags, allowed regions. In Step 2, pair with `advisor_recommendation_list` for early governance constraints.

---

## Phase 2 Tool Map

| Tool | Sub-command | AppOnboard Step | Purpose |
|------|-----------|----------|---------|
| `mcp_azure_mcp_cloudarchitect` | `cloudarchitect_design` | Step 3 | Validate architecture. Single-shot: populate `state` from `context.json`; set `confidence-score: 0.8` |
| `mcp_azure_mcp_wellarchitectedframework` | `wellarchitectedframework_serviceguide_get` | Step 4 | WAF guidance; call `service: "{service-name}"` per planned service |
| `mcp_azure_mcp_advisor` | `advisor_recommendation_list` | Step 2 | Subscription recommendations with policy query |
| `mcp_azure_mcp_policy` | *(hierarchical)* | Step 2 | Blocked types, required tags, allowed regions |
| `mcp_azure_mcp_pricing` | `pricing_get` | Step 6 | Estimate cost; first read [pricing-guide.md](pricing-guide.md) |
| `mcp_azure_mcp_quota` | ⛔ Do NOT use | Step 5 | ⛔ Read [sku-quota-validation.md](sku-quota-validation.md); use Quota REST API via `az rest` |
| `mcp_azure_mcp_subscription_list` | *(flat)* | Step 1 | Resolve absent target subscription |
| `mcp_azure_mcp_group_list` | *(flat)* | Step 7 | List RGs for reuse/conflicts |
| `mcp_azure_mcp_group_resource_list` | *(flat)* | Step 7 | Detect target-RG name collisions |

---

## Tool Pitfalls

- **`mcp_azure_mcp_pricing` → `pricing_get`:** Use `--sku` for `armSkuName` (e.g., Redis Cache, App Service Premium). Without `armSkuName`, match `filter` + `meterName`. Never omit all filters; results become excessive.
