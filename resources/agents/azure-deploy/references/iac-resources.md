# IaC Resources — Official Documentation & Tools

Look up after 3 failed tries, for edge cases, or generated-code ground-truth validation.

## Bicep

| Resource | URL | Use When |
|----------|-----|----------|
| Bicep Documentation | https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/ | Syntax, structure, deployment scopes, install |
| Azure Resource Reference | https://learn.microsoft.com/en-us/azure/templates/ | Resource properties, API versions, schema per type |

## Terraform

| Resource | URL | Use When |
|----------|-----|----------|
| Terraform Registry — azurerm | https://registry.terraform.io/providers/hashicorp/azurerm/latest | Resource properties, argument reference, import blocks |
| Terraform Registry — azapi | https://registry.terraform.io/providers/azure/azapi/latest | Preview resources not yet in azurerm; maps to ARM REST APIs |

## Validation Tools

| Tool | Format | Purpose |
|------|--------|---------|
| `bicep build` | Bicep | Syntax + schema validation |
| `az deployment group create --what-if` | Bicep | ARM dry run + change preview |
| `terraform validate` | Terraform | Syntax + schema validation |
| `terraform plan` | Terraform | Provider dry run |

## Deploy Troubleshooting

> ⛔ **Primary lookup:** First call `mcp_azure_mcp_documentation` with error message. Use table only when MCP unavailable or empty.
>
> **Repeated failure (same error 2+ consecutive attempts):** `fetch_webpage` matching URL below, querying error message. Apply documented fix; never retry same approach.

| Resource | URL | Use When |
|----------|-----|----------|
| Common ARM Deployment Errors | https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/common-deployment-errors | `InvalidTemplateDeployment`, `SkuNotAvailable`, `QuotaExceeded`, any ARM error code |
| App Service Troubleshooting | https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/ | Startup crashes, Kudu/Oryx build failures, health probe issues |
| App Service Zip Deploy Guide | https://learn.microsoft.com/en-us/azure/app-service/deploy-zip | Zip deploy, SCM_DO_BUILD_DURING_DEPLOYMENT, Kudu publish API |
| Container Apps Troubleshooting | https://learn.microsoft.com/en-us/azure/container-apps/troubleshooting | Revision failures, ingress errors, secret resolution, image pull failures |
| Quota Increase Portal | https://portal.azure.com/#blade/Microsoft_Azure_Capacity/QuotaMenuBlade/myQuotas | Quota increase requests |

> **Source:** Official Microsoft Learn, HashiCorp Developer, and Azure documentation.
