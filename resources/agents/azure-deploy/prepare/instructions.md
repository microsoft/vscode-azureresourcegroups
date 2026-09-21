# Prepare — Architecture Planning & Cost Estimation

## Quick Reference

| Property | Value |
|----------|-------|
| Best for | Mapping app components to Azure services; cost and quota validation |
| Inputs | `prereq-output.json` + `context.json` from `.copilot-azure/sessions/{id}/` |
| Outputs | `prepare-plan.json` in session directory |
| Parent | [azure-app-onboard](../instructions.md) |

## When to Use This Agent

`azure-app-onboard` invokes at Phase 2 when `prereq-output.json` exists. Not user-routable.

> **Return to orchestrator:** On completion, return to `azure-app-onboard`. Do NOT directly invoke scaffold or deploy.

## When NOT to Use

| Scenario | Use Instead |
|----------|-------------|
| Code readiness or prereq scan | `azure-app-onboard` Step 3 (prereq) |
| IaC generation from completed plan | `azure-app-onboard` Step 7 (scaffold) |
| Azure resource deployment | `azure-app-onboard` Step 9 (deploy) |
| Optimizing existing Azure spend | `azure-cost` |
| VM-specific cost estimates | `azure-compute` |
| Enterprise landing zones | `azure-enterprise-infra-planner` |

## MCP Tools

| Tool | Purpose |
|------|----------|
| `mcp_azure_mcp_pricing` / `azure-pricing` (router → `command: pricing_get`) | Inline cost estimate (Step 6). Fallback: [`subagent-pricing.md`](references/subagent-pricing.md) |
| `mcp_azure_mcp_policy` | Subscription constraints |
| `az rest` | Sub-agent quota validation (Step 5) |
| `mcp_azure_mcp_cloudarchitect` → `cloudarchitect_design` | WAF-aligned design |
| `mcp_azure_mcp_wellarchitectedframework` | Service WAF guidance |
| `mcp_azure_mcp_advisor` → `advisor_recommendation_list` | Optimization advice |

## Workflow

| # | Step | Action | Reference |
|---|------|--------|-----------|
| 1 | **Read session state** | Load `prereq-output.json` + `context.json`; resolve subscription | Use [subscription-resolution.md](../references/subscription-resolution.md) if needed |
| 2 | **Query policy constraints** | Inline MCP: fetch policy + advisor advice | `mcp_azure_mcp_policy` + `mcp_azure_mcp_advisor` |
| 3 | **Map components to services** | Select Azure service per component; route Dockerfile; deploy as-is. ⛔ Existing Azure Functions components MUST remain separate Azure Functions services. | ⛔ **You MUST read [service-mapping.md](references/service-mapping.md) and [deploy-strategy.md](references/deploy-strategy.md)** |
| 4 | **Select SKUs + WAF analysis** | Budget-aware SKUs; inline WAF guidance | ⛔ **You MUST read [sku-matrix.md](references/sku-matrix.md)** |
| 5 | **Validate quotas + region capacity** | ⛔ Read [`subagent-quota.md`](references/subagent-quota.md), then dispatch as `task` (NEXT action MUST be `task`) with agent_type `"task"`—NEVER `"general-purpose"`. Copy **COMPLETE and UNMODIFIED** template between `<<<TEMPLATE_START>>>` / `<<<TEMPLATE_END>>>`; do NOT summarize. Append caller inputs from [`subagent-quota.md`](references/subagent-quota.md)'s Input table AFTER template. ⛔ **Then run Step 6 while subagent runs. Do NOT run quota checks yourself. Collect results before Step 9.** | ⛔ **You MUST read [`subagent-quota.md`](references/subagent-quota.md)** |
| 6 | **Estimate costs** | ⛔ **You MUST read [pricing-guide.md](references/pricing-guide.md)**, then [pricing-guide-services.md](references/pricing-guide-services.md). Call (`mcp_azure_mcp_pricing`/`azure-pricing`) inline per paid service with `command: "pricing_get"` + `parameters{}`. On MCP failure or unavailability, ⛔ read [`subagent-pricing.md`](references/subagent-pricing.md), then dispatch as `task` (NEXT action MUST be `task`) with agent_type `"task"`—NEVER `"general-purpose"`. Copy **COMPLETE and UNMODIFIED** template between `<<<TEMPLATE_START>>>` / `<<<TEMPLATE_END>>>`; do NOT summarize. Append services[], region, budget tier AFTER template. Write `prepare-plan.json.costEstimate`. | [pricing-guide.md](references/pricing-guide.md) |
| 7 | **Generate naming** | Centralize suffix, prefix, all resource names | ⛔ **You MUST read [naming-patterns.md](references/naming-patterns.md)** |
| 8 | **Determine IaC format** | Existing non-Azure `.tf` → `ask_user` Bicep vs TF; write `overrides[].iacFormat`. No `.tf` → Bicep. | (inline) |
| 9 | **Write prepare-plan.json** | Follow `PreparePlan`; include postDeployRecommendations, deploymentVariables | ⛔ **You MUST read [prepare-schemas.ts](references/prepare-schemas.ts)** for `PreparePlan` schema |
| 10 | **Return summary** | Structured orchestrator approval-gate summary | (inline — 1 line) |
| 11 | **Validate plan** | 4-dimension check: Goal Alignment, WAF Alignment, Dependency Completeness, Deployment Viability. Fix failures inline; document tradeoffs in `assumptions[]`. | All must pass before writing |

### Step 5 — Post-Quota Validation

> ⛔ **NEVER present a region without checking quota first.** Skipping causes cascading deploy failures and healing loops.
> ⛔ If plan includes PostgreSQL/MySQL, verify `offerRestrictionsVerified: true` — if false/missing, region is blocked. Do NOT proceed to scaffold with unchecked DB services.
> ⛔ **Paid ≠ unlimited.** Every compute SKU—including B1, Consumption, and Serverless tiers—has per-subscription, per-region quota. Do NOT skip quota checks. (F1/D1/Free are never selected; compute floor is B1.)
> ⛔ After region fallback, update ALL `services[].region` in `prepare-plan.json`; leave no stale values.

## Error Handling

| Error | Remediation |
|-------|-------------|
| Pricing API 400 | Verify `--sku` included in the query |
| MCP pricing unavailable | Dispatch [`subagent-pricing.md`](references/subagent-pricing.md) as `task` fallback (uses direct HTTP to `prices.azure.com`) |
| Prereq output missing | Trigger prereq backfill |
| Quota check fails | Fall back to best-effort estimate + disclaimer |
| Override conflicts | Re-run from Step 3 with new constraints |
