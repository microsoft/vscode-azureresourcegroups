# Bicep — Static Web Apps Patterns

SWA-specific Bicep patterns. For shared patterns (skeleton, naming, tags, security defaults, data modules), see [bicep-patterns.md](bicep-patterns.md).

## Module Template

SWA modules for token-based deploys (no GitHub CI/CD):

```bicep
resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {} // ⛔ MUST be empty — no repositoryUrl, no branch, no buildProperties
}
```

> ⛔ **Standard SKU minimum — Free SWA is not offered.** Free Static Web Apps lack the configuration these apps need (custom authentication, configurable CORS, SLA, private endpoints, BYO API backends via managed identity). Always emit `sku: { name: 'Standard', tier: 'Standard' }`.

> ⛔ **Detached SWA deploy:** Omit `repositoryUrl`, `branch`, and `buildProperties` entirely. These are only for GitHub Actions–connected deployments. Including `repositoryUrl: ''` causes `BadRequest: RepositoryUrl is invalid`.
