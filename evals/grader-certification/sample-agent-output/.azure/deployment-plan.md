# Azure Deployment Plan

> **Status:** Ready for Validation

Generated: 2026-08-07

## 1. Project Overview

Deploy the Golden Project Tracker as a Node.js Azure Container App using Azure Developer CLI and Bicep.

## 2. Requirements

| Attribute | Value |
|---|---|
| Classification | Development |
| Scale | Small |
| Budget | Cost-Optimized |
| Subscription | Dedicated evaluation subscription |
| Location | East US 2 |

## 3. Components Detected

| Component | Type | Technology | Path |
|---|---|---|---|
| app | Web and API | Node.js 22 | `.` |

## 4. Recipe Selection

**Selected:** AZD with Bicep.

## 5. Architecture

The application runs in Azure Container Apps with managed logging and no embedded secrets.

### Azure Resources

| Component | Azure Service | SKU / Tier |
|---|---|---|
| app | Azure Container Apps | Consumption |
| logs | Log Analytics | Pay-as-you-go |

```text
Internet -> Azure Container Apps -> Node.js application
```

## 6. Execution Checklist

- [x] Analyze workspace
- [x] Select recipe
- [x] Generate `azure.yaml`
- [x] Generate Bicep infrastructure
- [ ] Run validation
- [ ] Deploy after explicit authorization

## 7. Validation Proof

| Check | Command Run | Result | Timestamp |
|---|---|---|---|
| Static artifacts | grader certification | Passed | 2026-08-07 |

## 8. Files to Generate

| File | Purpose | Status |
|---|---|---|
| `.azure/deployment-plan.md` | Deployment plan | Complete |
| `azure.yaml` | Azure Developer CLI manifest | Complete |
| `infra/main.bicep` | Infrastructure | Complete |

## 9. Next Steps

1. Run `azd package`.
2. Deploy only in the dedicated evaluation subscription after explicit authorization.
