# Pipeline Rules — Reference

Cross-cutting rules for every workflow step. Referenced by [instructions.md](../instructions.md) `## Pipeline Rules`.

## Approval gates

⛔ **Require two separate approval gates; never merge.**

1. **Scaffold gate (Step 6):** "✅ Ready to proceed with scaffolding? (Yes / Edit plan / Cancel)" approves IaC generation only. ⛔ PostgreSQL/MySQL plan: add selectable `Private access`; exact variant in approval-gates.md.
2. **Deploy gate (Step 8):** "🚀 Ready to deploy? (Yes / Run manually / Edit plan / Cancel)" approves resource provisioning.

Scaffold gate grants NO deploy permission. After scaffold, MUST present deploy gate in SEPARATE response. Never proceed directly from scaffold approval to `az group create` or `az deployment`.

⛔ **BOTH gates MUST show Subscription (name + ID), Resource Group, Region** on standalone lines above service table, exposing creation target before approval.

⛔ **NEVER create/write/modify infrastructure before user explicitly says "Yes" to scaffold gate.** No exceptions for simple apps, trivial plans, free tier, or single-component repos.

⛔ **Modifying existing non-AppOnboard IaC requires explicit user approval.** Present: "I need to modify {file}: {change description}. Approve? (Yes / Edit / Cancel)". Applies when adjusting existing Bicep/Terraform SKUs, regions, or settings.

Each gate must be response's LAST content; do NOT continue same turn.

> ❌ BAD: Writes Bicep without approval · scaffolds and deploys in same response · skips deploy gate after scaffold approval
> ✅ GOOD: Shows plan → user says Yes → scaffold → show validation summary → deploy gate → user says Yes → deploy

## Phase lifecycle

At phase boundaries, update `context.json`: combine `completedPhases` + next `currentPhase` in one write. Write phase artifact before completion mark. Orchestrator instructions.md defines exact post-prereq/scaffold/deploy write points.

`currentPhase` must NEVER occur in `completedPhases`; violation → halt + report.

`context.json` is NOT write-once; every completed phase boundary MUST update it:
- Write `intent` after Step 2
- `components` after Step 3
- `azure.resourceGroup` after Step 7 (also written to `deploy-result.json.resourceGroupName`)
- Push to `completedPhases` at phase boundaries
- Update `statusSummary` at every phase exit — 1-line description. Templates:
  - prereq: `"{N} components, stack: {detectedStack}, health: {overallHealth}"`
  - prepare: `"{N} services, ~${monthlyUsd}/mo, region: {region}"` (when `quotaValidation.checkedRegions` >1, append fallback reason: `"region: westus2 (eastus quota full)"`)
  - scaffold: `"{N} files, self-review: {VERIFIED|FLAGGED count}"`
  - deploy: `"{healthStatus}, RG: {resourceGroupName}"`
  - cancel: `"Paused at {phase} — {reason}"`

## Session artifacts

**Session writes: directories via `New-Item -ItemType Directory`; file content via `create`.** Create session dir with `New-Item -ItemType Directory -Path ".copilot-azure/sessions/{uuid}" -Force`, then use `create` for all JSON/md. Never use `Out-File`, `Set-Content`, or shell content commands.

## Phase transition rule

> ⛔ **Before FIRST command of every new phase, re-read its instructions.md.** After prereq → `prepare/instructions.md`; after prepare → `scaffold/instructions.md`; after scaffold gate → `deploy/instructions.md`. Applies EVERY transition.

## Post-compaction recovery

> ⛔ After ANY compaction, re-read current phase instructions.md + this file. Mid-scaffold/deploy: verify `scaffold-manifest.json` + `completedPhases` exist.

Begin response: "Started session at `.copilot-azure/sessions/{uuid}/`" or "Resuming session from [date] — {statusSummary}".

⛔ **Session immutability:** NEVER write outside active session folder (pointed to by `.copilot-azure/sessions/active-session.json`). Old sessions read-only: no updates, backfills, status changes.

**Session TTL:** 7 days. Next invocation deletes non-active sessions with `context.json.lastModifiedUtc` >7 days old. Never prune active session.

## fastTrackEligible

Prereq sets it to (1) auto-approve readiness gate, (2) simplify prepare Step 3 alternatives. Never skips phases, reads, gates, self-review, validation, preflight.

## Deploy as-is

⛔ Do NOT refactor/upgrade working app code; deploy what works. Approval gate allows broken-code fixes (build errors, missing deps). Upgrades → `prepare-plan.json.postDeployRecommendations[]`. Infrastructure changes allowed; code rewrites forbidden; prereq-detected AND approved Azure compatibility changes (TLS, SSL, port) allowed. Never request secrets—databases/caches/storage use managed identity (no passwords). Auto-generate only app-internal secrets (e.g. `SECRET_KEY`); store on compute (App Service app settings / Container Apps native secrets) via an `@secure()` param—no Key Vault.

## Known Platform Bugs

Full bug table + workarounds: [`pipeline-rules-runtime.md`](pipeline-rules-runtime.md) § Known Platform Bugs.

## No top-level agent invocation

⛔ **NEVER call external agents** (`azure-validate`, `azure-deploy`, `azure-prepare`, etc.) during AppOnboard. Only `azure-app-onboard-prereq` + `azure-app-onboard` orchestrator allowed. Validate/deploy via direct CLI.

## Structured sub-agent delegation

⛔ Use ONLY `subagent-*.md` templates; no ad-hoc prompts. Pass template verbatim. Run destructive commands (`az deployment`, `az webapp deploy`, `az acr build`) only in main thread.

## Security baseline

See [iac-generation-rules.md](../scaffold/references/iac-generation-rules.md) § Security Patterns + [bicep-patterns-security.md](../scaffold/references/bicep-patterns-security.md). Flag `AllowAzureServices` firewall rule security warning.

## azure.yaml prohibition

⛔ **NEVER generate `azure.yaml`. NEVER use `azd up`/`azd provision`/`azd deploy`.** AppOnboard uses `az deployment sub create` (Bicep) or `terraform apply` (Terraform). Existing `azure.yaml` repos → route via [`azd-template-routing.md`](azd-template-routing.md).
