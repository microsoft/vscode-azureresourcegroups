# Azure Debug Plan

> **AUTHORITATIVE GUIDANCE — MANDATORY COMPLIANCE**
>
> This document is the **official, canonical source** for classifying a workspace
> and generating a VS Code debug setup plan. You **MUST** follow these instructions
> exactly as written. When in doubt, defer to this document. Do not improvise,
> infer, or substitute steps.

---

## Global Rules (NO EXCEPTIONS)

1. **Update plan progressively** — Mark steps complete as you go; update **Last Updated** timestamp on every status change
2. ❌ **Destructive actions require `ask_user`** — Always confirm before overwriting, deleting, or modifying existing files
3. **Preserve existing config** — Never silently overwrite project configuration files or `docker-compose.yml`. Merge or ask first.
4. **Scope — VS Code debug setup only** — This instruction set classifies the workspace and generates a plan. Cloud deployment is handled by **azure-prepare** → **azure-validate** → **azure-deploy**.
---

## Workflow

> **Two phases — Classify → Plan — then STOP.**
>
> Do NOT generate any configuration files (docker-compose, launch.json, tasks.json, etc.).
> All `.azure/` artifacts must be created inside the **workspace root**, not a session-state folder.

---

## Phase 0: Classify

Scan the workspace for service roots. Produce a `services[]` list.

| Action | Reference |
|--------|-----------|
| Check for `.azure/project-plan.md` — if found, read for advisory context. **Optional.** | — |
| Scan all subdirectories; detect project type + runtime per service root | [classify.md](references/classify.md) |
| If 2+ service roots: assign service IDs, deduplicate emulators, plan compound debug config | [multi-service.md](references/multi-service.md) |

---

## Phase 1: Plan

Scan dependencies, detect configuration, and generate the plan directly. The user reviews and edits the plan markdown before approving.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Detect prerequisites** — Check required tools and VS Code extensions | [inventory.md](references/inventory.md) § Step 1 |
| 2 | **Scan Azure dependencies** — For each service, scan bindings (Functions) or SDK packages (other types) to identify Azure service dependencies | [inventory.md](references/inventory.md) § Step 2 |
| 3 | **Map dependencies to emulators** — Map each detected Azure dependency to its local emulator. Deduplicate across services. | [inventory.md](references/inventory.md) § Step 2 |
| 4 | **Detect orchestrator** — Scan for existing `docker-compose.yml` or compose files. If none found, default to Docker Compose. | — |
| 5 | **Detect migrations** — Scan for migration files, dependencies, and scripts | [migrations.md](references/migrations.md) |
| 6 | **Inventory API test opportunities** — List HTTP endpoints and triggers per service | [inventory.md](references/inventory.md) § Step 3 |
| 7 | **Write plan** — Generate `.azure/vscode-debug-plan.md` from scan results. Fill all sections completely. | [plan-template.md](references/plan-template.md) |
| 8 | **Present plan** — Show plan to user and ask for approval. Highlight missing prerequisites. The user can edit the plan directly before approving. On approval, update status to `Approved`. | `.azure/vscode-debug-plan.md` |

---

> **❌ STOP HERE** — Do NOT proceed to artifact generation. Do NOT generate docker-compose.yml, launch.json, tasks.json, or any other configuration files. Present the plan to the user and wait for approval. After approval, the custom agent wrapper will invoke `azure-debug-generate` to handle generation.
