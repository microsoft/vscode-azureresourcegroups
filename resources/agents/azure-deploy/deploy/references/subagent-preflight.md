# Subagent Template — Deploy Preflight & Checklist Generation

Distill deploy references into deployment-specific `deploy-checklist.md`, main agent's ONLY deploy-rule source.

## Critical Rules

- ⛔ Do NOT invoke agents, run `az` commands, or modify IaC/app code. Read-only sub-agent.
- ⛔ Do NOT read `deploy-schemas.ts` or `error-classification.md`; main agent reads on demand.

## Input (provided by caller)

| Field | Source |
|-------|--------|
| `prepare-plan.json` content | services[], naming, region, costEstimate, deploymentVariables |
| `scaffold-manifest.json` content | deployCommand, validationResult, files[] |
| `context.json` content | azure.subscriptionId, subscriptionName, resourceGroup, sessionId, intent |
| `prereq-output.json` content | buildRequirements, warnings[], components[] |
| Session folder path + working directory | Required |

## Output

| Artifact | Location |
|----------|----------|
| `deploy-checklist.md` | Session folder |
| `deploy-result.json` skeleton (if missing) | Session folder |
| Summary (≤300 tokens) | Return to caller |

## Workflow

### Step 1 — Read session artifacts + write skeleton

Read all 4 session artifacts. Extract: services[], naming, costEstimate, deployCommand, validationResult, deploymentVariables, subscriptionId, sessionId, buildRequirements, warnings[], quotaValidation.

If `deploy-result.json` is missing, write skeleton with these EXACT field names (never rename): `{ sessionId, subscriptionId, resourceGroupName, deploymentNames: ["app-onboard-deploy-{first 8 of sessionId}"], status: "in-progress", startedUtc, resourceIds: [], endpoints: [], healthStatus: "unknown", resourceResults: [], healingAttempts: [] }`.

### Step 2 — Read safety + blocked patterns refs

Read [deploy-safety.md](deploy-safety.md) and [blocked-patterns.md](blocked-patterns.md). Add checklist sections for deploy-result.json rules, blocked commands, shell rules (sync shells, secret persistence, no --track-status, Windows az rest headers), 403 scope fallback (4 real-value steps), tag verification, deployment polling (if >5 resources), re-approval gates, antipatterns, artifact reconciliation.

### Step 3 — Read preflight + approval gate refs

Read [preflight-checks.md](preflight-checks.md) and [approval-gate-template.md](approval-gate-template.md).

Add preflight checklist: auth token, real resource-name availability, RBAC scope, ⛔ MANDATORY pre-filled what-if command (real deploymentName, region, subscriptionId), RG existence, offer restriction (if `offerRestrictionsVerified` false AND plan has DB services).

Add approval gate VERBATIM with real subscription, RG, region, service table, cost table, validation status, files, and response handlers with exact CLI commands. Append warning for F1/D1.

### Step 4 — Read code-deployment + health refs

Read ONLY code-deployment refs matching compute types in `prepare-plan.json.services[]`. **Do NOT read** refs for absent types:
- If `App Service` or `Functions` in plan → read [code-deployment-appservice.md](code-deployment-appservice.md)
- If `Container Apps` in plan → read [code-deployment-container-apps.md](code-deployment-container-apps.md)
- If `Static Web Apps` in plan → read [code-deployment-swa.md](code-deployment-swa.md)

Add per-service-type `## Code deploy` sections, one per compute service; do NOT merge.

Read [health-check-patterns.md](health-check-patterns.md). Add health checks: HTTP (30s timeout, 3 retries), status interpretation, Azure default-page strings, non-HTTP checks, conditional functional verification.

### Step 5 — Read conditional refs + handoff + write checklist

**Database (conditional):** If plan has DB services, read [database-post-deploy.md](database-post-deploy.md). Add migration discovery, execution commands, PG checks.

Read [../../references/handoff-protocol.md](../../references/handoff-protocol.md). Add cleanup commands (real rg, sessionId), orphan list, healing summary, post-deploy recommendations, agent next steps, auth-aware handoff.

**Write `deploy-checklist.md`** to session folder. Replace existing content via `edit`; otherwise use `create`:
```
# Deploy Checklist for {appName}
# RG: {rgName} | Sub: {subscriptionId} | Session: {sessionId}
# ⚠️ If compaction recently occurred: re-read deploy/instructions.md Steps 6-8
```

Delete inapplicable sections (e.g., App Service for Container Apps deploy).

> ⛔ **Copy `## Before handoff (Step 8)` and `## Artifact verification (Step 8 — MANDATORY)` from template VERBATIM.** Do NOT paraphrase, merge, or weaken `⛔` markers. They are compaction-safe finalization anchors; dilution causes skipped artifact writes.

### Step 6 — Return summary

Return ≤300 tokens: preflight warnings, deploy command, service types, checklist-write confirmation, database migration note if applicable.
