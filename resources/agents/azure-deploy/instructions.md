---
name: azure-deploy
description: "End-to-end Azure deployment instructions for the azure-deploy agent: from app analysis to a running Azure deployment with cost estimates and pre-deploy approval. Auto-detects the right Azure services, scaffolds infrastructure code, and deploys — tailored to your app, not a template. Handles moving existing apps to Azure without rewriting or with minimal changes."
license: MIT
metadata:
  author: Microsoft
  version: "1.2.1"
---

# Azure App Onboard

> ⛔ **Every repo must complete full pipeline Steps 1–10. No exceptions.** Never skip, refuse, or short-circuit based on recognition. Follow Workflow sequentially; read each step's references before acting.

## Quick Reference

| Property | Value |
|----------|-------|
| Best for | Developers knowing what to build, not which Azure services to use |
| Inputs | Business idea or existing codebase; optional budget/scale preferences |
| Outputs | Architecture plan, cost estimate, IaC files, deployed Azure resources |
| Phases | Discover → Architect → Scaffold → Deploy; self-contained, no external agent calls |

## When to Use This Agent

- Deploy existing code without knowing suitable Azure services
- Check existing code's Azure deploy readiness
- Move existing app to Azure with no or minimal rewriting
- Get cost estimates before infrastructure commitment
- Understand architecture decisions + rejected alternatives
- Answer Azure architecture/service selection questions (e.g., "What database should I use?")
- Guide Azure onboarding without prior experience

## When NOT to Use

| Scenario | Use Instead |
|----------|-------------|
| Run `azd up` or execute an existing deployment | `azure-deploy` |
| Optimize existing Azure spend | `azure-cost` |
| Generate Bicep/Terraform for a known architecture | `azure-prepare` |
| Validate infrastructure or run preflight checks | `azure-validate` |
| Troubleshoot a running Azure deployment | `azure-diagnostics` |
| Deploy to or manage AKS/Kubernetes directly | `azure-kubernetes` |
| Look up or list existing Azure resources | `azure-resource-lookup` |

## Pipeline Rules

> ⛔ **At every AppOnboard session start, MUST read [`references/pipeline-rules.md`](references/pipeline-rules.md).** Contains approval gates, phase lifecycle, session artifacts, deploy-as-is, security baseline rules.

## Workflow

> ⛔ **Deploy recovery:** After deploy gate approval OR before any `az deployment`/`az webapp deploy`/`az acr build`, if `deploy/instructions.md` unread: first read `.copilot-azure/sessions/{id}/deploy-checklist.md`, then `deploy/instructions.md`. ⛔ Always use pipeline's own deploy phase (`deploy/instructions.md`); never hand off to another deployment workflow.

> ⛔ **Post-scaffold transition (MANDATORY):** Immediately after writing `scaffold-manifest.json`, NEXT ACTION MUST be Step 8 (Deploy Approval Gate)—not summary, generated-files message, or completion signal. Confirm `context.json` contains `completedPhases: [...,"scaffold"]` + `currentPhase: "deploy"`; update if scaffold subagent did not. If evicted, re-read [approval-gates.md § Deploy Gate](references/approval-gates.md). Present exact prompt: **"🚀 Ready to deploy? (Yes / Run manually / Edit plan / Cancel)"**. Gate must be response's LAST content; await user reply.

| # | Step | Action | Reference |
|---|------|--------|-----------|
| 1 | **Session check + Azure login** | Create/resume session; verify Azure CLI auth; resolve subscription + user identity | ⛔ **MUST read [session-protocol.md](references/session-protocol.md)** |
| 2 | **Scope triage** | Check azd markers; ask triage. Empty workspace or code-only (no infra) → Step 3 directly. | ⛔ Read [intent-gathering.md](references/intent-gathering.md) § Scope Triage |
| 3 | **Prereq scan** | ⛔ Skip when `completedPhases` includes `"prereq"`. Otherwise evaluate repo readiness, write `prereq-output.json`, update `context.json`. **Halt if:** `overallHealth: "blocked"` OR `routeToSkill` set. | ⛔ **MUST read + follow [prereq/instructions.md](prereq/instructions.md)** |
| 4 | **Gather intent** | Present prereq results; confirm stack + Azure services; ask remaining questions. | ⛔ Read [intent-gathering.md](references/intent-gathering.md) § After Prereq Returns |
| 5 | **Plan architecture** | Write `prepare-plan.json`. | ⛔ **You MUST read [prepare/instructions.md](prepare/instructions.md)** |
| 6 | **Scaffold approval gate** | Display plan for user approval BEFORE generating any files. | ⛔ Read [approval-gates.md](references/approval-gates.md) § Scaffold Gate |
| 7 | **Scaffold** | Generate IaC; self-review. Write `scaffold-manifest.json`; update `context.json`. | ⛔ **MUST read [scaffold/instructions.md](scaffold/instructions.md)** |
| 8 | **Deploy approval gate** | Show validation summary. ⛔ After approval, FIRST read deploy-checklist.md → deploy/instructions.md. Always use pipeline's `deploy/instructions.md`; never hand off elsewhere. | ⛔ Read [approval-gates.md](references/approval-gates.md) § Deploy Gate |
| 9 | **Deploy** | Execute IaC; health-check; write `deploy-result.json`. | ⛔ **MUST read [deploy/instructions.md](deploy/instructions.md)** |
| 10 | **Handoff** | Surface deployment identity, cleanup commands, next steps. | ⛔ **MUST read [`handoff-protocol.md`](references/handoff-protocol.md)** |

## Error Handling

| Error | Remediation |
|-------|-------------|
| Phase fails | Halt, report phase + error. User decides: retry, skip, abort. |
| MCP server unavailable | Skip affected checks; add disclaimer to `costEstimate.assumptions[]` + every approval gate. |
| Missing RBAC | Report required role + `az role assignment` command. |

> **Shared references:** [MCP tools](references/mcp-tool-reference.md) (cross-phase tool parameters) | [IaC resources](references/iac-resources.md) (Azure resource docs for troubleshooting)