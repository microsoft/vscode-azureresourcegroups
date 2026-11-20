# Azure Debug Plan

> This plan is the source of truth for generating the
> VS Code debug setup in this workspace.
>
> **Status:** Planning
> **Execution Mode:** Guided
> **Created:** 2026-08-31T00:00:00Z
> **Last Updated:** 2026-08-31T00:00:00Z
>
> <!-- Guided Mode (default) - hand-holds the user through review and approval before generating. -->

---

## Development Environment

| Field | Value |
|-------|-------|
| Mode | Sandbox |
| Image | Local Dockerfile based on `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm@sha256:1bc82e3350b0da52ca1a1b1b2e7527300bc6fdfd778287e0eed564203d66a68c` |
| Match Rationale | The root workspace, Functions API, and React/Vite frontend explicitly declare Node.js 24.x; the backend uses Azure Functions programming model v4; Azurite and PostgreSQL are supported. |
| Host Prerequisites | Docker, Docker Compose, Chrome, Azure Functions extension |
| Base-Provided Tools | Node.js 24.22.1, npm 11.19.1, pnpm 12.16.1, Yarn 1.22.22, Git, certificates, build tools, and common developer utilities |
| CoR-Added Tools | Azure CLI 2.91.0, Azure Functions Core Tools 4.16.0, DNS diagnostics, netcat, and PostgreSQL client |
| Supporting Emulators | Azurite and PostgreSQL as separate Compose services |
| Forwarded Ports | 5173 frontend, 7071 Functions HTTP, 9229 Node inspector, 10000-10002 Azurite, 5432 PostgreSQL |
| Workspace Topology | VS Code remains on the host; Compose tasks bind-mount the workspace, run application commands with `docker compose exec dev`, and map host sources to `/workspaces/task-tracker`; root `node_modules` uses a container-only named volume; emulators run as sibling services. |

---

## Prerequisites

All required tools and VS Code extensions with install status — list both the Run and Debug tool sets.

| Tool / Extension | Category | Service(s) | Installed | Version |
|------------------|----------|------------|-----------|---------|
| Docker | Container Runtime | * | ❓ | — |
| Docker Compose | Orchestration | * | ❓ | — |
| Chrome | Browser | web | ❓ | — |
| ms-azuretools.vscode-azurefunctions | VS Code Extension | functions | ❓ | — |
| dbaeumer.vscode-eslint | VS Code Extension | * | ❓ | — |

> ⚠️ **Action required:** Confirm any tool or extension marked ❓ is installed and ready before approving this plan — rerun the recheck to confirm CLI tools provided by a version manager.

---

## Debug Configurations

Each checked row below produces a VS Code debug configuration in the `.vscode/launch.json`.

| Generate | Debug Config Name | Service Label | Service Root | Project Type | Runtime | Version | Azure Dependencies |
|----------|-------------------|---------------|--------------|--------------|---------|---------|-------------------|
| [x] | Task Tracker API (debug) | functions | services/functions | functions | node-ts | 24.x | Azure Storage, PostgreSQL |
| [x] | Task Tracker Frontend (debug) | web | services/web | frontend-spa | node-ts | 24.x | — |
| [x] | Debug All Services | — | — | *Compound Config* | — | — | — |

<details>
<summary>ℹ️ Project Type Descriptions</summary>

| Project Type | Description |
|-------------|-------------|
| functions | Azure Functions — serverless compute with triggers and bindings |
| frontend-spa | Single-page application served by a dev server (Vite, Next.js, Angular, etc.) |

</details>

> ℹ️ **Proxy detected:** Task Tracker Frontend will need to proxy requests to Task Tracker API (configure in `vite.config.ts`). The compound config should start backends before frontends.

---

## Orchestrator

| Orchestrator | Description |
|-------------|-------------|
| Docker Compose | Uses Docker Compose to orchestrate emulators and dependent services during local development |

---

## Emulators

| Dependent Service | Emulator | Purpose |
|-------------------|----------|---------|
| Azure Storage | Azurite Container | Blob storage for task attachments |
| PostgreSQL | PostgreSQL Container | Relational database for task records |

---

## Architecture Diagram

The Task Tracker API connects to PostgreSQL for task storage and Azure Storage (Azurite) for attachments. The frontend proxies API requests to the Functions backend.

```mermaid
graph LR
    Frontend[Task Tracker Frontend<br/>React + Vite<br/>:5173]
    API[Task Tracker API<br/>Azure Functions<br/>:7071]
    DB[(PostgreSQL<br/>:5432)]
    Storage[(Azurite<br/>:10000)]
    
    Frontend -->|Proxy /api/*| API
    API -->|Query| DB
    API -->|Upload/Download| Storage
```

---

## Migrations

When selected, the generation phase creates automated VS Code tasks that run migration scripts on launch — so emulator databases are automatically provisioned with the correct schema and seed data before the app starts debugging. No manual migration steps needed.

| Generate | Service | Migration Tool |
|----------|---------|---------------|
| [x] | functions | Raw SQL |

> ℹ️ **Note:** Migration files will be created in `services/functions/migrations/` with the `tasks` table schema.

---

## API Test Collections

When selected, the generation phase produces lightweight, runnable API test scripts in the project so you can quickly smoke-test endpoints and triggers once everything is launched and connected locally.

| Generate | Service | Description |
|----------|---------|-------------|
| [x] | functions | <details><summary>HTTP Endpoints (4)</summary><br>GET /api/health<br>GET /api/tasks<br>POST /api/tasks<br>GET /api/openapi</details> |

---

## Convenience Scripts

| Generate | Script | Registered In | Description |
|----------|--------|---------------|-------------|
| [x] | emulators:start | ./package.json | Start all emulators in the background, preserving existing data |
| [x] | emulators:stop | ./package.json | Stop all running emulators |
| [x] | emulators:clean | ./package.json | Stop emulators and delete all data (fresh start) |
| [x] | db:migrate | ./services/functions/package.json | Apply pending database migrations to the emulator database |
