# Azure Deployment Plan

> **Status:** Planning

Generated: 2026-07-23

---

## 1. Project Overview

**Goal:** Deploy the Scrapbook photo-sharing app to Azure — two Azure Functions apps (HTTP API + timer-triggered cleanup worker), a React SPA frontend, PostgreSQL database, and Blob Storage for photos.

**Path:** Modernize Existing (local dev environment already working)

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
| scrapbook-api | HTTP API (Azure Functions v4) | TypeScript / Node.js 20 | services/scrapbook-api |
| cleanup-worker | Timer Worker (Azure Functions v4) | TypeScript / Node.js 20 | services/cleanup-worker |
| scrapbook-web | SPA Frontend | React + Vite (Fluent UI v9) | services/scrapbook-web |
| shared | Shared Library | TypeScript | services/shared |

---

## 4. Recipe Selection

**Selected:** AZD (Bicep)

**Rationale:**
- Multi-service Azure-native app (Functions + SWA)
- Simplest deployment with `azd up`
- Flex Consumption is the recommended plan for new Functions deployments
- No multi-cloud requirement

---

## 5. Architecture

**Stack:** Serverless + Static Web Apps

### Service Mapping

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| scrapbook-api | Azure Functions (Flex Consumption) | FC1 |
| cleanup-worker | Azure Functions (Flex Consumption) | FC1 |
| scrapbook-web | Azure Static Web Apps | Free |
| Database | Azure Database for PostgreSQL Flexible Server | Burstable B1ms |
| Photo Storage | Azure Storage Account (Blob) | Standard_LRS |

### Supporting Services

| Service | Purpose |
|---------|---------|
| Log Analytics Workspace | Centralized logging |
| Application Insights | Monitoring & APM |
| Key Vault | Secrets management (DB password, AUTH_SECRET) |
| User Assigned Managed Identity | Function apps → Storage + Key Vault access |

### Networking & Security

- PostgreSQL: Firewall allows Azure services only
- Storage: No public blob access; UAMI-based auth for Functions runtime storage
- Key Vault: RBAC-based access via managed identity
- Functions: HTTPS only, TLS 1.2+
- Static Web Apps: Proxy `/api` calls to scrapbook-api Function App

---

## 6. Execution Checklist

### Phase 1: Planning
- [ ] Analyze workspace
- [ ] Gather requirements
- [ ] Confirm subscription and location with user
- [ ] Scan codebase
- [ ] Select recipe (AZD + Bicep)
- [ ] Plan architecture
- [ ] **User approved this plan**

### Phase 2: Execution
- [ ] Generate `azure.yaml` (AZD config — defines 3 services)
- [ ] Generate `infra/main.bicep` (orchestrator)
- [ ] Generate `infra/main.parameters.json`
- [ ] Generate `infra/abbreviations.json`
- [ ] Generate Bicep modules:
  - [ ] `infra/core/host/functions.bicep` (shared Function App module)
  - [ ] `infra/core/host/staticwebapp.bicep`
  - [ ] `infra/core/database/postgresql.bicep`
  - [ ] `infra/core/storage/storage-account.bicep`
  - [ ] `infra/core/monitor/monitoring.bicep`
  - [ ] `infra/core/security/keyvault.bicep`
  - [ ] `infra/core/security/identity.bicep`
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

## 7. Generated Artifacts

| File | Purpose |
|------|---------|
| `azure.yaml` | AZD service definitions |
| `infra/main.bicep` | Orchestrator — provisions all resources |
| `infra/main.parameters.json` | Environment parameters |
| `infra/abbreviations.json` | Naming conventions |
| `infra/core/host/functions.bicep` | Azure Functions Flex Consumption module |
| `infra/core/host/staticwebapp.bicep` | Static Web Apps module |
| `infra/core/database/postgresql.bicep` | PostgreSQL Flexible Server module |
| `infra/core/storage/storage-account.bicep` | Storage Account (photos + Functions runtime) |
| `infra/core/monitor/monitoring.bicep` | Log Analytics + App Insights |
| `infra/core/security/keyvault.bicep` | Key Vault + secrets |
| `infra/core/security/identity.bicep` | User Assigned Managed Identity + role assignments |

---

## 8. Validation Proof

> **⛔ REQUIRED**: The azure-validate skill MUST populate this section before setting status to `Validated`. If this section is empty and status is `Validated`, the validation was bypassed improperly.

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|
| | | | |

**Validated by:** azure-validate skill
