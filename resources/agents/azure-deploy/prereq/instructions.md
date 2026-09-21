---
name: azure-app-onboard-prereq
description: "Assess whether source code is ready to deploy to Azure — the check BEFORE infrastructure work. Evaluates build health, app completeness, dependencies and local services, stack compatibility, and deployment feasibility. Answers questions about what your app needs before it can be deployed — frameworks, dependencies, and configuration. Checks whether dependencies are compatible and identifies deployment blockers and unsupported frameworks. WHEN: \"evaluate my repo\", \"is my app ready to deploy\", \"what does my app need to deploy\", \"what do I need before deploying\", \"does my app need\", \"can I ship this to Azure\", \"scan my repo for issues\", \"is this app deployable\", \"check if my app is ready for Azure\", \"do I need a Dockerfile\", \"what's blocking my deployment\", \"are there any blockers\", \"are my dependencies compatible\", \"does Azure support my framework\", \"what needs to change before deploying\", \"check my app configuration\"."
license: MIT
metadata:
  author: Microsoft
  version: "1.2.1"
---

# Azure App Onboard Prereq — Repository Evaluation

Evaluate repository build health, app completeness, and Azure deployability before infrastructure planning. Produce downstream per-component verdicts (PASS/WARN/FAIL).

> **Orchestrator relationship:** Deploy agent's [`instructions.md`](../instructions.md) calls this at Step 3. After artifacts, return to `instructions.md` Step 4; do NOT invoke downstream phases directly.

AppOnboard phase 1 of 4. Session: `.copilot-azure/sessions/{session-id}/`. Read `context.json`; write `components[]`, `repo{}`, `detectedInfra[]`; produce `prereq-output.json`. Schema: [`prereq-schemas.ts`](references/prereq-schemas.ts) — `PrereqOutput`, `BuildRequirements`. Supports direct entry.

## When NOT to Use

| Signal | Redirect |
|--------|----------|
| Validate infrastructure (Bicep/TF/azure.yaml) | **azure-validate** |
| Generate IaC | **azure-prepare** |
| End-to-end idea-to-production | **azure-app-onboard** |
| Run `azd up` or deploy | **azure-deploy** |

## Rules

> ⛔ **ABSOLUTE PROHIBITION — `npm install`, `npm test`, `npx jest`, `pytest`, and ALL install/build/test commands are NEVER allowed.**
> During prereq, NEVER run `npm install`, `npm test`, `npx jest`, `pip install`, `pytest`, `dotnet build`, `dotnet restore`, `dotnet test`, `go mod download`, `cargo build`, or ANY package-manager install, build, or test operation. Do NOT run tests; check test config statically. Prereq is read-only evaluation + static verification.
> **ONLY exception — two consent-gated contexts:** (a) agent code **modified** during migration/remediation ([remediation-protocol.md](references/remediation-protocol.md) step 6), or (b) agent code **wrote** from scratch on zero-code path ([zero-code-path.md](references/zero-code-path.md)). Installation, build, and test runs ONLY through user-confirmed build-validation gate ([build-check.md](references/build-check.md) Step 3), after specific per-command consent. General consent never counts.

1. ⛔ **Full pipeline (Steps 1–8), no exceptions.** Every prompt → Step 1. Answer specific questions within findings (Step 5), never before.
2. ⛔ **No evaluation sub-agents.** Run 3-axis evaluation inline. **Exception**: zero-code-path scaffolding (Step 2).
3. Code/destructive modifications require `ask_user`. Max 3 questions before results. Direct entry: don't repeat orchestrator's intent questions.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp_azure_mcp_get_azure_bestpractices` | Validate detected stack patterns against Azure best practices |
| `mcp_azure_mcp_extension_cli_install` | Check/install required CLI tools (az, azd, func) |

## Workflow

### Step 1: Session Check

**Orchestrator entry:** Read existing session `context.json`; proceed to Step 2.

**Direct entry:** Check `.copilot-azure/sessions/active-session.json`:
- **Exists** → ⛔ read [session-protocol.md](references/session-protocol.md) for resume/fresh gate. Do NOT proceed until user answers.
- **Missing** → create session: generate UUID, `New-Item -ItemType Directory -Path ".copilot-azure/sessions/{uuid}" -Force`; write `context.json` + `active-session.json` via `create`.

Then `az account show` → merge `{id, name, tenantId}` into `context.json.azure`. ⛔ Session MUST exist on disk before scanning.

### Step 2: Scan Workspace

Scan project files. Detect components, `repo{}`, `detectedInfra[]`, `detectedServices[]`; classify Terraform providers; check CLI. Stack conflicts: explicit user statement wins (write `context.json`, mark scan override); scan-only → confirm with user; multiple stacks → show all and ask (see [component-mapping.md](references/component-mapping.md)); no code → [zero-code-path.md](references/zero-code-path.md).

> ⛔ **Preserve Azure Functions service roots.** Directory with `host.json` + Azure Functions SDK or worker signal (`@azure/functions`, `Microsoft.NET.Sdk.Functions`, Functions Python decorators, or `FUNCTIONS_WORKER_RUNTIME`) is Azure Functions component. Record exact path and Azure Functions framework in both `context.json.components[]` and `prereq-output.json.components[]`. Do not classify HTTP-triggered Functions as generic REST API. With SPA + Functions root, record two components even when frontend calls backend through `/api`.

> If no project files, no Dockerfile, AND no index.html → ⛔ read [zero-code-path.md](references/zero-code-path.md).

> ⛔ **Cloud SDK early gate.** Grep `aws-sdk|@aws-sdk|boto3|google-cloud|@google-cloud|firebase`. On functional deps, read [cloud-sdk-migration.md](references/cloud-sdk-migration.md), then `ask_user`: **"Redirect to Azure Cloud Migrate"** (set `routeToSkill: "azure-cloud-migrate"`) · **"Continue evaluation anyway"** (finish readiness + SDK→Azure mapping, then STOP at Step 8; no plan before swapping deps) · **"Cancel"**.

### Step 3: Per-Component Evaluation

| Sub-step | Action | Reference |
|----------|--------|-----------|
| 3.1 | **Build check** | ⛔ **You MUST read [build-check.md](references/build-check.md)** |
| 3.2 | **Completeness check** | ⛔ **You MUST read [completeness-check.md](references/completeness-check.md)** |
| 3.3 | **Deployability check** | ⛔ **You MUST read [deployability-check.md](references/deployability-check.md)** |
| 3.3a | **Component mapping** (conditional) | Read [component-mapping.md](references/component-mapping.md) ONLY IF >1 project manifest found (monorepo) |

After evaluation, fill each component's `buildRequirements`. [readiness-gate.md](references/readiness-gate.md) and check references define verdict propagation, tiers, and f1Viable aggregation.

### Step 4: Write Artifacts + Readiness Gate

⛔ Verify on-disk `context.json`. Read [readiness-gate.md](references/readiness-gate.md) (verdicts, tiers, batch-then-approve, fast-track), then [prereq-artifacts.md](references/prereq-artifacts.md) (writes, schemas).

### Step 5: Present Findings

Per [readiness-gate.md § Present Findings](references/readiness-gate.md), show severity-grouped verdicts before continuing.

### Step 6: Remediation (conditional)

⛔ **You MUST read [remediation-protocol.md](references/remediation-protocol.md)** for any ❌ FAIL, 🔧 Recommended Fix, or ⚠️ WARN with `fixPhase: "prereq"`. It defines remediation loop, static verification, required re-evaluation, post-remediation artifact updates, and build-validation consent. If only ✅ PASS or ⚠️ WARN without `fixPhase: "prereq"`, skip to Step 7.

### Step 7: Write Final State

Step 4 already set `completedPhases` with `"prereq"` + `currentPhase: null`. Then:

> ⛔ **Write `lastScanCommit`.** Run `git rev-parse HEAD`; store full 40-character SHA as `context.json.repo.lastScanCommit`. Required: Step 1 resume staleness guard compares to HEAD to detect changes.

### Step 8: Route

⛔ **Mandatory — do NOT skip this step.**

> **Routing fields:** Every route writes `routeToSkill` and `routeReason` to `context.json`.

> **Post-remediation context:** If Step 6 ran, prefix routing prompt: "Remediation complete — {N} issues fixed, your app is now {overallHealth}."

> ⛔ **Evaluate rows top-down; first match wins.**

| # | Condition | Action |
|---|-----------|--------|
| 1 | `routeToSkill` set (any entry) | `ask_user`: "Redirect to {routeToSkill}" / "Not now". ⛔ Pipeline stops — do NOT proceed to architecture planning. |
| 2 | `cloudSdkFindings[]` non-empty (user chose "Continue evaluation anyway") | Present the cloud-SDK → Azure swap mapping as 🔶 blockers, then `ask_user` with this exact prompt: **"🔶 Cloud SDK migration required — these dependencies must be swapped before this app can deploy to Azure. (Redirect to azure-cloud-migrate / Stop — swap manually and re-run)"** — Redirect sets `routeToSkill: "azure-cloud-migrate"`, Stop halts. ⛔ Pipeline stops — do NOT proceed to architecture planning, and do NOT offer a "continue to prepare" option; the app can't deploy until the deps are swapped. |
| 3 | Orchestrator + no `routeToSkill` | Tell the user: "✅ Your app has been evaluated and is ready — let's plan your Azure deployment." Then return to the deploy agent's [`instructions.md`](../instructions.md) and continue at Step 4 (Gather intent). ⛔ Do NOT stop, do NOT wait for user input, do NOT narrate internal handoffs. The user already consented to the full pipeline at scope triage. |
| 4 | Direct + ready/readyWithCaveats + no Azure infra | `ask_user`: "Deploy to Azure (full pipeline)" → invoke `azure-app-onboard` / "Not now" |
| 5 | Direct + ready/readyWithCaveats + existing Azure infra | `ask_user`: "Start fresh" → invoke `azure-app-onboard` / "Use existing infra" → invoke `azure-prepare` / "Not now" |
| 6 | Direct + blocked | Report blocker summary + "Fix and re-run." |

Severity tiers (🛑🔶❌🔧⚠️✅): [readiness-gate.md](references/readiness-gate.md).

## Outputs

| Artifact | Location | Consumer |
|----------|----------|----------|
| Session context | `context.json` → `components[]`, `repo{}`, `detectedInfra[]`, `detectedServices[]` | All downstream phases |
| Prereq output | `prereq-output.json` | prepare phase (via `azure-app-onboard`) |
| Readiness report | `.copilot-azure/sessions/{uuid}/readiness-report.md` | User (offline reference) |