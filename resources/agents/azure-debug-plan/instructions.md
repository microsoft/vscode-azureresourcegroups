# Azure Debug Plan

> **AUTHORITATIVE GUIDANCE — MANDATORY COMPLIANCE**
>
> **Official, canonical source** for workspace classification and VS Code debug
> setup planning. You **MUST** follow it exactly. When unsure, defer here; never
> improvise, infer, or substitute steps.

---

## Global Rules (NO EXCEPTIONS)

1. **Update plan progressively** — Mark completed steps; update **Last Updated** on every status change
2. ❌ **Destructive actions require `ask_user`** — Confirm before overwriting, deleting, or modifying existing files
3. **Preserve existing config** — Never silently overwrite project config or `docker-compose.yml`; merge or ask first
4. **Scope — VS Code debug setup only** — Classify workspace and generate plan. **azure-deploy** handles cloud architecture, IaC generation, provisioning, and deployment through the complete **azure-app-onboard** pipeline.
---

## Autopilot mode (overrides the approval STOP)
**Active when** invoking chat starts with `[AUTOPILOT MODE]`, **or** `.azure/project-plan.md` records `executionMode: auto` or equivalent. Run unattended:
- Run **Phase 0–1 in full**. In `.azure/vscode-debug-plan.md`, record `executionMode: auto` or similar and follow template-specific instructions.
- Skip `openLocalPlanView`; do NOT await approval. Set status directly to `Approved`, then invoke `azure-debug-generate` normally with chat arg prefixed `[AUTOPILOT MODE] `.
- **Reuse project-plan prerequisites.** If `.azure/project-plan.md` lists Prerequisites, copy all instead of re-deriving; details: [inventory.md § Step 1](references/inventory.md).
- Never call `ask_user` for non-destructive steps. Keep scan completeness; suppress **only preview and approval gates**.

## Workflow

> **Two phases — Classify → Plan — then STOP.**
>
> Do NOT generate configuration files (docker-compose, launch.json, tasks.json, etc.).
> Create all `.azure/` artifacts in **workspace root**, never a session-state folder.

---

## Phase 0: Classify

Scan the workspace for service roots. Produce a `services[]` list.

| Action | Reference |
|--------|-----------|
| Check for `.azure/project-plan.md`; if found, read for advisory context | — |
| Scan all subdirectories; detect each service root's project type + runtime | [classify.md](references/classify.md) |
| With 2+ service roots, assign service IDs, deduplicate emulators, plan compound debug config | [multi-service.md](references/multi-service.md) |

---

## Phase 1: Plan

Scan dependencies, detect config, generate plan directly. User reviews and edits plan markdown before approval.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Detect prerequisites** — Check required tools and VS Code extensions | [inventory.md](references/inventory.md) § Step 1 |
| 2 | **Scan Azure dependencies** — Per service, scan bindings (Functions) or SDK packages (other types) to identify Azure service dependencies | [inventory.md](references/inventory.md) § Step 2 |
| 3 | **Map dependencies to emulators** — Map every detected Azure dependency to its local emulator; deduplicate across services. | [inventory.md](references/inventory.md) § Step 2 |
| 4 | **Detect container runtime & Compose provider** — Scan for existing `docker-compose.yml`/`compose.yaml`; detect available runtime per [prerequisites.md § Container runtime detection](../../shared-references/prerequisites.md). Record chosen runtime (**Docker**, **Podman**, or **Podman (Docker-compatible)**) and Compose command in plan Orchestrator table. **Prefer the Podman engine when it's ready** — native `podman compose`, or `docker compose` backed by Podman; fall back to Docker. Default to Docker Compose only when neither is confirmed. | [prerequisites.md](../../shared-references/prerequisites.md) |
| 5 | **Detect migrations** — Scan migration files, dependencies, and scripts | [migrations.md](references/migrations.md) |
| 6 | **Inventory API test opportunities** — List each service's HTTP endpoints and triggers | [inventory.md](references/inventory.md) § Step 3 |
| 7 | **Write plan** — Generate `.azure/vscode-debug-plan.md` from scans; complete every section. | [plan-template.md](references/plan-template.md) |
| 8 | **Present plan** — Show user and request approval; highlight ❓ prerequisites to double-check. User may edit directly before approval. On approval, set status `Approved`. | `.azure/vscode-debug-plan.md` |

---

> **❌ STOP HERE** — Do NOT generate artifacts, including docker-compose.yml, launch.json, tasks.json, or other config. Present plan and await user approval. Afterward, custom agent wrapper invokes `azure-debug-generate`.
