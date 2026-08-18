---
name: azure-project-plan
description: "Plan and design an Azure-centric project with user requirements gathering and interactive plan approval. Generates .azure/project-plan.md, then auto-chains to azure-project-scaffold. WHEN: \"plan project\", \"design app\", \"new project\", \"project requirements\", \"create project plan\", \"plan my app\", \"what should I build\", \"scaffold project\", \"new Azure app\", \"create testable app\", \"new API project\", \"full-stack Azure app\", \"new project with tests\", \"create app\", \"bootstrap project\", \"new fullstack project\", \"testable API\", \"create functions project\"."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan

> **AUTHORITATIVE — MANDATORY.** Canonical source for planning Azure-centric apps. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

**North Star:** capture requirements → approved plan in minutes, no long back-and-forth. After approval, auto-chain to `azure-project-scaffold`.

## Triggers
Plan/design a new Azure-centric app; create requirements/architecture; start a project from scratch; full-stack Azure Functions app; testable API with Azure services; bootstrap Functions + frontend.

## ❌ Do NOT activate — route instead
| User intent | Correct skill |
|-------------|---------------|
| Execute plan / scaffold backend | **azure-project-scaffold** |
| Integrate the scaffold (live data, smoke test, migrations) | **azure-project-integrate** |
| Docker Compose, emulators, VS Code F5 | **azure-debug-plan** → **azure-debug-generate** |
| Deploy to Azure / generate Bicep/Terraform | **azure-prepare** |
| Benchmark scaffold quality | **scaffold-benchmark** |

## Rules
1. **Plan first** — create `.azure/project-plan.md` before any code. No `services/`, configs, or project files until the user approves. Only files allowed under the project root: `.azure/project-plan.md` and the contents of `.azure/.preview-temp/` (per Step 3.5).
2. **Resilience classification** — classify each service **Essential** (fails without it) or **Enhancement** (succeeds with fallback). See Quick Reference.
3. **Auto-chain after approval** — immediately invoke `azure-project-scaffold`; never ask the user to invoke it manually. **Generate a presentation-quality frontend HTML/CSS preview** during planning per Step 3.5 (the scaffold agent consumes it as a visual spec but builds the real app with the chosen framework).
4. **Interactive UI** — all user input comes through the requirements and plan webviews; never ask in plain chat and never call `vscode_askQuestions`. Batch open questions into the webview rather than the transcript.

## Autopilot is selected on the plan page (this agent always runs guided)
This agent **always** runs guided: it generates `.azure/project-plan.md` with `Status: Planning`, opens the plan preview, and stops for the user's approval. It does **not** detect, decide, or record autopilot, and never skips the preview or approval gate.
Autopilot is chosen by the **user** via the **Autopilot toggle on the plan webview**, after the plan is shown. When they approve with it on, the extension records `**Execution Mode**: auto` in `.azure/project-plan.md`, enables global auto-approve, and hands off to the scaffold agent with the `[AUTOPILOT MODE]` marker; every downstream skill then inherits autopilot from the plan file and runs unattended to the end.

There is nothing autopilot-specific for you to do here — just write a correct, complete plan and always emit both the `### Run` and `### Debug` prerequisite sub-tables (§ 5). Never call `vscode_askQuestions` in chat — the only stop is the plan webview approval.


## Two-phase instructions — read the file for the current phase

This agent runs in two phases with **separate instruction files**. Read only the file for the phase you are in — do **not** load both at once. This keeps each phase focused and fast.

| Phase | When | Read & follow | Produces |
|-------|------|---------------|----------|
| **A — Requirements** | Fresh invocation — no `.azure/requirements.json` yet, or the user is starting a new project | [`requirements.md`](requirements.md) | `.azure/requirements.json` → requirements webview |
| **B — Plan** | Re-entry after the user submits the requirements form (query begins *"Requirements submitted at .azure/requirements.json…"*), or `.azure/requirements.json` is already fully answered | [`plan.md`](plan.md) | `.azure/project-plan.md` + `.azure/.preview-temp/` |

- **Phase A** — Step 1 (Detect Workspace) + Step 2 (Gather Requirements).
- **Phase B** — Step 3 (Generate Plan) + Step 3.5 (Frontend Preview) + Planning Quick Reference.
- The end-to-end order is unchanged: **DETECT → GATHER → GENERATE PLAN → GENERATE PREVIEW → approval → AUTO-CHAIN scaffold.** Only the instructions are split by phase; each phase file is self-contained for its phase.

## Workflow (mandatory order)
DETECT (Step 1) → GATHER (Step 2) → GENERATE `.azure/project-plan.md` (Step 3) → GENERATE FRONTEND PREVIEW (Step 3.5, if applicable) → approval → AUTO-CHAIN scaffold after approval. Only files allowed: `.azure/project-plan.md` and the contents of `.azure/.preview-temp/` — no `services/`, configs, or production code. Detect + gather are inlined in [`requirements.md`](requirements.md); plan generation, the preview, and all architectural context are inlined in [`plan.md`](plan.md). Planning needs ZERO external file reads except `references/html-preview.md` for Step 3.5.

## Outputs

| Artifact | Location |
|----------|----------|
| **Requirements** | `.azure/requirements.json` (statuses → `confirmed` after the webview submit) |
| **Project Plan** | `.azure/project-plan.md` (Status: Approved) |

## Next

> **Automatic**: after the plan is approved, the flow immediately invokes **azure-project-scaffold** (auto-chain). No user action required.