# Azure Deployment Plan

> **Status:** Planning

Generated: 2026-07-23

---

## 1. Project Overview

**Goal:** Deploy the Attendance Compliance Tracker (React SPA + Azure Functions API + PostgreSQL) to Azure using the Azure Developer CLI (azd).

**Path:** Modernize Existing — an existing local-dev application being prepared for Azure deployment.

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Development |
| Scale | Small |
| Budget | Cost-Optimized |
| **Subscription** | AzCode2605 |
| **Location** | West US 2 (westus2) |

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| api | API (Azure Functions v4) | TypeScript, Node.js ≥20 | `api/` |
| web | Frontend (SPA) | React 18, Vite, Fluent UI | `web/` |
| shared | Shared library | TypeScript | `shared/` |

### Dependencies Detected

| Dependency | Current (Local) | Azure Target |
|------------|----------------|--------------|
| PostgreSQL 16 | Docker (Azurite compose) | Azure Database for PostgreSQL Flexible Server |
| Azure Blob Storage | Azurite emulator | Azure Storage Account |
| Azure AD / Entra ID | Optional (mock auth) | Entra ID App Registration |

---

## 4. Recipe Selection

**Selected:** AZD (Bicep)

**Rationale:**
- New-to-Azure deployment, no existing IaC
- Multi-service app (API + SPA + database) — AZD handles orchestration
- Simplest deployment path (`azd up`)
- Bicep is the default and best-supported IaC for Azure-only deployments

---

## 5. Architecture

**Stack:** Serverless (Functions Flex Consumption + Static Web Apps)

### Service Mapping

| Component | Azure Service | SKU / Tier |
|-----------|---------------|------------|
| api | Azure Functions | Flex Consumption (FC1) |
| web | Azure Static Web Apps | Free |
| database | Azure Database for PostgreSQL Flexible Server | Burstable B1ms |
| storage | Azure Storage Account | Standard LRS |

### Supporting Services

| Service | Purpose |
|---------|---------|
| Log Analytics Workspace | Centralized logging |
| Application Insights | Monitoring & APM for Functions |
| Key Vault | Store DATABASE_URL and other secrets |
| User Assigned Managed Identity | Service-to-service auth (Functions → Storage, Key Vault) |

### Architecture Diagram

```
┌──────────────┐       ┌────────────────────────┐
│  Static Web  │──────►│  Azure Functions (API) │
│   Apps (SPA) │       │  Flex Consumption      │
└──────────────┘       └───────────┬────────────┘
                                   │
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
              ┌───────────┐ ┌──────────┐ ┌───────────┐
              │ PostgreSQL │ │ Storage  │ │ Key Vault │
              │ Flex Server│ │ Account  │ │           │
              └───────────┘ └──────────┘ └───────────┘
```

---

## 6. Execution Checklist

### Phase 1: Planning
- [ ] Analyze workspace
- [ ] Gather requirements
- [ ] Confirm subscription and location with user
- [ ] Scan codebase
- [ ] Select recipe
- [ ] Plan architecture
- [ ] **User approved this plan**

### Phase 2: Execution
- [ ] Fetch base Functions template (TypeScript HTTP)
- [ ] Customize `azure.yaml` for multi-service (api + web)
- [ ] Generate `infra/main.bicep` with all resources
- [ ] Generate supporting Bicep modules (PostgreSQL, Key Vault, monitoring)
- [ ] Configure app settings and Key Vault references
- [ ] Update plan status to "Ready for Validation"

### Phase 3: Validation
- [ ] Invoke azure-validate skill
- [ ] All validation checks pass
- [ ] Update plan status to "Validated"

### Phase 4: Deployment
- [ ] Invoke azure-deploy skill
- [ ] Deployment successful
- [ ] Update plan status to "Deployed"

---

## 7. Validation Proof

> ⛔ REQUIRED: To be populated by azure-validate skill.

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|

---

## 8. Files to Generate

| File | Purpose | Status |
|------|---------|--------|
| `.azure/deployment-plan.md` | This plan | ✅ |
| `azure.yaml` | AZD service definitions | ✅ |
| `infra/main.bicep` | Main infrastructure orchestration | ✅ |
| `infra/main.parameters.json` | Parameter defaults | ✅ |
| `infra/abbreviations.json` | Naming conventions | ✅ |
| `infra/modules/functions.bicep` | Azure Functions resource | ✅ |
| `infra/modules/staticwebapp.bicep` | Static Web Apps resource | ✅ |
| `infra/modules/postgresql.bicep` | PostgreSQL Flexible Server | ✅ |
| `infra/modules/storage.bicep` | Storage Account | ✅ |
| `infra/modules/keyvault.bicep` | Key Vault + secrets | ✅ |
| `infra/modules/monitoring.bicep` | Log Analytics + App Insights | ✅ |
| `infra/modules/identity.bicep` | User Assigned Managed Identity | ✅ |

---

## 9. Next Steps

> Current: Phase 3 — Ready for Validation

1. ~~Confirm Azure subscription and region with user~~
2. ~~User approves this plan~~
3. ~~Generate infrastructure code and `azure.yaml`~~
4. Run azure-validate pre-deployment checks
5. Deploy with `azd up`
