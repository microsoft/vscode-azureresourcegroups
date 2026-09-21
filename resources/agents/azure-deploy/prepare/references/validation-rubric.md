# Validation Rubric

Run all 4 dimensions before writing `prepare-plan.json`. All must pass; any failure triggers [Error Handling](../instructions.md#error-handling).

## Dimensions

| Dimension | Pass Criteria |
|-----------|---------------|
| **Goal Alignment** | Every `context.json.intent` field reflected in service/SKU choice. No orphaned/omitted components: each deployable component maps to its own compute service or explicitly approved shared host. Every detected Azure Functions component maps to Azure Functions, even with Static Web Apps frontend. `overrides[]` honored. |
| **WAF Alignment** | **Cost:** SKU matches budget; alternatives state cost tradeoffs. **Reliability:** Production plans include zone-redundant SKUs, GRS storage. **Security:** Managed identity everywhere; app-internal secrets stored on-compute (⛔ no Key Vault); private endpoints where budget allows. **Ops:** Log Analytics + App Insights included. **Performance:** SKU right-sized—no over/under-provisioning. See [Azure WAF Service Guides](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/) for per-service alignment. |
| **Dependency Completeness** | Every dependency present (Container Apps → Log Analytics; App Service → App Insights for monitoring; all services → managed identity + RBAC/data-plane role for auth—databases Entra-only, no connection-string password). Cross-service references consistent (App Insights → Log Analytics workspace). |
| **Deployment Viability** | SKUs exist in target region, validated by quota/region check. No policy-blocked resources. Names follow Azure rules. Quota sufficient or remediation flagged. No free/shared SKUs (compute floor: B1 / SWA Standard / Functions Flex Consumption). |

## Applying

- **During plan creation (steps 3–7):** Use Goal Alignment and WAF Alignment for selection; Dependency Completeness after mapping.
- **Before writing (step 10):** Run all 4. Deployment Viability catches post-quota/naming issues.
- **On failure:** Fix inline via [Error Handling](../instructions.md#error-handling). Document tradeoffs (e.g., WAF Reliability vs cost-optimized budget) in `assumptions[]`.

## References

- [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/) — pillars and tradeoffs
- [WAF Service Guides](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/) — per-service WAF checklists
