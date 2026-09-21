# Scaffold Phase — MCP Tools

Scaffold-only tool parameters. For shared tools (`get_azure_bestpractices`, `subscription_list`, `group_list`, `extension_cli_install`), see [mcp-tool-reference.md](../../references/mcp-tool-reference.md).

> **Troubleshooting:** For unknown parameter or missing command errors, see <https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/>

---

## Azure MCP Tools — `mcp_azure_mcp_*`

### `mcp_azure_mcp_deploy` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `deploy_plan_get` | `workspace-folder`, `project-name`, `target-app-service` (ContainerApp\|WebApp\|FunctionApp\|AKS), `provisioning-tool` (AzCli\|AZD), `source-type` (from-project\|from-azure\|from-context), `deploy-option` (provision-and-deploy\|deploy-only\|provision-only) | `iac-options` (bicep\|terraform), `resource-group` | ✅ |
| `deploy_iac_rules_get` | `deployment-tool` (AzCli\|AZD) | `iac-type` (bicep\|terraform), `resource-types` (comma-sep: appservice, containerapp, function, aks, azuredatabaseforpostgresql, azuredatabaseformysql, azuresqldatabase, azurecosmosdb, azurestorageaccount, azurekeyvault) | ✅ |
| `deploy_pipeline_guidance_get` | `is-azd-project` (bool), `pipeline-platform` (github-actions\|azure-devops), `deploy-option` (deploy-only\|provision-and-deploy) | subscription, tenant | ✅ |

### `mcp_azure_mcp_bicepschema` (hierarchical)

| Sub-command | Required Params | Optional Params | Read-Only |
|-------------|----------------|-----------------|-----------|
| `bicepschema_get` | `resource_type` (e.g. Microsoft.Web/sites) | `api_version` | ✅ |

**Usage:** Primary ARM schema tool; returns properties, required fields, constraints. Prefer over `mcp_bicep_get_az_resource_type_schema` for quick lookup without exact API version.

### `mcp_azure_mcp_azureterraformbestpractices` (flat)

| Required | Optional | Read-Only |
|----------|----------|-----------|
| *(none)* | `resource_type` (e.g. "azurerm_linux_web_app") | ✅ |

**Usage:** Azure Terraform best practices. Omit `resource_type` for general guidance; provide `resource_type` for resource-specific `azurerm` patterns, properties, security. Step 5 uses this for per-resource HCL (Terraform only).

---

## Bicep MCP Tools — `mcp_bicep_*`

### `mcp_bicep_get_bicep_best_practices`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| *(none)* | — | ✅ |

Returns: Bicep authoring practices for naming, organization, parameters, security, testing.

### `mcp_bicep_get_az_resource_type_schema`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `azResourceType` (e.g. Microsoft.Web/sites), `apiVersion` (e.g. 2024-11-01) | — | ✅ |

Returns: full resource JSON schema: properties, nested types, constraints.

### `mcp_bicep_list_avm_metadata`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| *(none)* | — | ✅ |

Returns: all Azure Verified Modules (AVM) metadata, versions, docs.

### `mcp_bicep_list_az_resource_types_for_provider`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `providerNamespace` (e.g. Microsoft.Compute) | — | ✅ |

Returns: provider resource types and API versions.

### `mcp_bicep_build_bicep`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute) | — | ✅ |

Returns: compiled ARM JSON + errors, warnings, info for a `.bicep` file.

### `mcp_bicep_format_bicep_file`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute) | — | ❌ |

Formats Bicep to official standards; respects `bicepconfig.json`.

### `mcp_bicep_get_deployment_snapshot`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute, `.bicepparam`) | — | ✅ |

Returns: deployable snapshot resolving all parameter values and template references. Useful pre-deploy validation.

### `mcp_bicep_get_file_references`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute, `.bicep` or `.bicepparam`) | — | ✅ |

Returns: Bicep file references (modules, parameters, imports) for dependency and completeness checks.

### `mcp_bicep_decompile_arm_template_file`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute, .json/.jsonc/.arm) | — | ❌ |

Converts ARM JSON → Bicep; best-effort, may need review.

### `mcp_bicep_decompile_arm_parameters_file`

| Required | Optional | Read-Only |
|----------|----------|-----------|
| `filePath` (absolute, .json/.jsonc/.arm) | — | ❌ |

Converts ARM parameters JSON → `.bicepparam`.

---

## Phase 3 Tool Map

| Tool | Sub-command | AppOnboard Step | Purpose |
|------|-----------|----------|---------|
| `mcp_bicep_get_bicep_best_practices` | *(flat)* | Step 5 | **Primary** — Bicep conventions, naming, module patterns for IaC generation |
| `mcp_bicep_get_az_resource_type_schema` | *(flat)* | Step 5 | **Primary** — ARM resource type JSON schema per service for property validation |
| `mcp_bicep_list_avm_metadata` | *(flat)* | Step 5 | **Primary** — AVM module catalog; prefer verified modules over raw resource definitions |
| `mcp_azure_mcp_bicepschema` | `bicepschema_get` | Step 5 | **Primary** — ARM resource type schemas without requiring exact API version |
| `mcp_azure_mcp_deploy` | `deploy_iac_rules_get` | Step 5 | IaC best practices and rules. `--iac-type bicep` (default) or `--iac-type terraform` |
| `mcp_azure_mcp_get_azure_bestpractices` | `get_azure_bestpractices_get` | Step 5 | SDK patterns during IaC gen. `resource: "general"`, `action: "code-generation"` |
| `mcp_bicep_build_bicep` | *(flat)* | Step 9 | **Primary** — validate generated `.bicep` files in self-review L3 (syntax, properties, API versions) |
| `mcp_bicep_format_bicep_file` | *(flat)* | Step 9 | Format generated `.bicep` files per official standards after self-review fixes |
| `mcp_bicep_get_file_references` | *(flat)* | Step 11 | Verify scaffold output completeness — all module references resolve |
| `mcp_azure_mcp_deploy` | `deploy_pipeline_guidance_get` | Step 10 | CI/CD pipeline config. `is-azd-project: false`, `pipeline-platform: "github-actions"`, `deploy-option: "provision-and-deploy"` |
| `mcp_azure_mcp_deploy` | `deploy_plan_get` | Step 12 | Structured deployment plan as validation input. Set `source-type: "from-project"`, `target-app-service` from plan |
| `mcp_azure_mcp_azureterraformbestpractices` | *(flat)* | Step 5 | Terraform path only — patterns and conventions for HCL generation |
