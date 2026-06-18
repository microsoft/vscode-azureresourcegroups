# Plan Template

> Generate `.azure/vscode-debug-plan.md` using this template. This file is the
> **single source of truth** for the generation phase. The generation phase reads this plan and
> generates all artifacts from it — no re-scanning of the workspace is needed.
>
> The plan is generated directly from the workspace scan. The user reviews the plan,
> edits it as needed, then approves it before generation proceeds.

## ⛔ BLOCKING REQUIREMENT

You **MUST** create this plan file and get user approval BEFORE generating any configuration files.

---

## Template

````markdown
# Azure Debug Plan

> This plan is the source of truth for generating the
> VS Code debug setup in this workspace.
>
> **Status:** {Planning | Approved | Executing | Implemented}
> **Execution Mode:** {Auto | Guided}
> **Created:** {ISO-8601 datetime}
> **Last Updated:** {ISO-8601 datetime}
>
> <!-- Guided Mode (default) - hand-holds the user through review and approval before generating. -->
> <!-- Auto Mode (aka YOLO mode) — skips approval gates and runs generation unattended. -->

---

## Prerequisites

<!-- All required tools and VS Code extensions with install status. -->
<!-- The user must install anything marked ❌ before approving. -->

| Tool / Extension | Required For | Installed | Version | Install |
|-----------------|-------------|-----------|---------|---------|
| {name} | {reason} | {✅/❌} | {version or —} | {install URL or link} |

> ⚠️ **Action required:** Install any tools or extensions marked ❌ before approving this plan.

---

## Debug Configurations

<!-- One row per detected service root. Each row maps to a VS Code debug configuration in launch.json. -->
<!-- The generation phase loads project-types.md and runtimes.md based on these values. -->
<!-- Services with Generate = No are excluded from all generation but shown for reference. -->
<!-- Azure Dependencies drive emulator matching — see Emulators section. -->
<!-- Debug Config Name is the VS Code debug configuration display name shown in the Run & Debug dropdown. -->
<!-- For multi-service workspaces, include a compound debug config row at the end. -->
<!-- ✏️ User can edit: Generate (check/uncheck), Debug Config Name -->

Each checked row below produces a VS Code debug configuration in the `.vscode/launch.json`.

| Generate | Debug Config Name | Service Label | Service Root | Project Type | Runtime | Version | Azure Dependencies |
|----------|--------------------|---------------|--------------|--------------|---------|---------|-----|
| {[x] / [ ]} | {e.g. Payments API (debug)} | {label} | {path} | {type} | {runtime} | {version} | {comma-separated azure service labels} |

<!-- Example: -->
<!-- | [x] | Payments API (debug) | Payments API | ./api | functions | node-ts | 20.x | Azure Storage, Azure PostgreSQL | -->
<!-- | [x] | Customer Portal (debug) | Customer Portal | ./web | frontend-spa | node-ts | 20.x | — | -->
<!-- | [x] | Debug All Services | Debug All Services | | *Compound Config* |||| -->

<!-- If a frontend SPA has a proxy config pointing to a local backend, add a note: -->
<!-- > ℹ️ **Proxy detected:** Customer Portal proxies requests to Payments API (via `vite.config.ts`). The compound config should start backends before frontends. -->

---

## Orchestrator

<!-- Detected from the workspace (e.g. existing docker-compose.yml). -->
<!-- If no orchestrator is detected, default to Docker Compose. -->

| Orchestrator | Description |
|-------------|-------------|
| {display name, e.g. Docker Compose} | {description, e.g. Uses Docker Compose to orchestrate emulators and dependent services during local development} |

<!-- Example: -->
<!-- | Docker Compose | Uses Docker Compose to orchestrate emulators and dependent services during local development | -->

---

## Emulators

<!-- One row per deduplicated emulator. Dependent Service is the Azure service this emulator replaces. -->

| Dependent Service | Emulator | Purpose |
|-------------------|----------|---------|
| {azure service label} | {emulator name} | {description of what this emulator provides} |

<!-- Example: -->
<!-- | Azure Storage | Azurite Container | Blob and queue storage for photo uploads and background processing | -->
<!-- | PostgreSQL | PostgreSQL Container | Relational database for user accounts, couples, and photo metadata | -->

---

## Architecture Diagram

{One sentence describing how the app connects to its dependencies during debugging.}

```mermaid
graph LR
    %% Generated from Debug Configurations + Emulators tables above.
    %% Show each service as a node, each emulator as a node,
    %% and edges for the Azure Dependencies that connect them.
```

---

## Migrations

<!-- Only include this section when database migrations are detected for one or more services. Omit entirely if not applicable. -->
<!-- ✏️ User can edit: Generate (check/uncheck) -->

When selected, the generation phase creates automated VS Code tasks that run migration scripts on launch — so emulator databases are automatically provisioned with the correct schema and seed data before the app starts debugging. No manual migration steps needed.

| Generate | Service | Migration Tool |
|----------|---------|---------------|
| {[x] / [ ]} | {service label} | {tool name, e.g. Prisma / Knex / Drizzle / EF Core} |

---

## API Test Collections

<!-- Only include this section when one or more services expose testable HTTP endpoints or triggers. Omit entirely if not applicable. -->
<!-- ✏️ User can edit: Generate (check/uncheck) -->

When selected, the generation phase produces lightweight, runnable API test scripts in the project so you can quickly smoke-test endpoints and triggers once everything is launched and connected locally.

| Generate | Service | Description |
|----------|---------|-------------|
| {[x] / [ ]} | {service label} | {collapsible lists of HTTP endpoints and/or triggers — see format below} |

<!-- Description cell format: use collapsible <details> blocks (collapsed by default) to keep the table compact. -->
<!-- Include an HTTP Endpoints section and/or a Triggers section as applicable. Each route/trigger on its own line. -->

<!-- Example: -->
<!-- | [x] | Functions API | <details><summary>HTTP Endpoints (16)</summary><br>GET /api/health<br>POST /api/auth/register<br>POST /api/auth/login<br>POST /api/auth/logout<br>GET /api/auth/me<br>GET /api/couples<br>POST /api/couples<br>GET /api/photos<br>POST /api/photos<br>DELETE /api/photos/:id<br>GET /api/albums<br>POST /api/albums<br>PUT /api/albums/:id<br>DELETE /api/albums/:id<br>GET /api/tags<br>POST /api/tags<br><br></details><details><summary>Triggers (2)</summary><br>blobTrigger — uploads<br>timerTrigger — cleanup</details> | -->

---

## Convenience Scripts

<!-- The generation phase generates only checked scripts into the project's script runner. -->
<!-- ✏️ User can edit: Generate (check/uncheck) -->

| Generate | Script | Registered In | Description |
|----------|--------|---------------|-------------|
| {[x] / [ ]} | {script name} | {path to file where script is registered, e.g. ./package.json} | {what the script does} |

<!-- Example: -->
<!-- | [x] | emulators:start | ./package.json | Start all emulators in the background, preserving existing data | -->
<!-- | [x] | emulators:stop | ./package.json | Stop all running emulators | -->
<!-- | [x] | emulators:clean | ./package.json | Stop emulators and delete all data (fresh start) | -->
<!-- | [x] | db:migrate | ./package.json | Apply pending database migrations to the emulator database | -->
