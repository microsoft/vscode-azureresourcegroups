# Project Plan

**Status**: Approved
**Created**: 2026-09-02
**Mode**: NEW

---

## 1. Project Overview

**Goal**: A task tracker web app — users create, prioritize, and complete tasks, and attach files (design mocks, notes, screenshots) to any task. A React SPA talks to an Azure Functions HTTP API; tasks are stored in PostgreSQL and attachments live in Blob Storage. The project is designed so that every module is independently testable.

**App Type**: SPA + API

**Mode**: NEW

**Deployment Plan**: No deployment plan found

---

## 2. Tasks API — Backend (Azure Functions)

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

---

## 3. Task Tracker Web — Frontend

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | React + Vite |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Blob Storage | Store task attachments (files, images, docs) and back Functions runtime state (`AzureWebJobsStorage`) | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` | Essential |
| PostgreSQL | Primary data store for tasks, users, and attachment metadata | `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/tasksdb` | Essential |
| Mock Auth Middleware | HMAC-signed test tokens on every request; scopes tasks to a user without wiring an IdP | `AUTH_SIGNING_KEY` | `dev-signing-key-change-me` | Essential |

---

## 5. Prerequisites

### Run

| Tool | Service(s) | Installed | Version |
|------|-----------|-----------|---------|
| Node.js | * | ✅ | v24.19.0 |
| npm | * | ✅ | 11.17.0 |
| Azure Functions Core Tools | tasks-api | ✅ | 4.14.0 |

### Debug

| Tool | Service(s) | Installed | Version |
|------|-----------|-----------|---------|
| Docker | tasks-api | ❓ | — |
| Docker Compose | tasks-api | ❓ | — |
| Chrome | tasks-web | ✅ | — |
| ms-azuretools.vscode-azurefunctions | tasks-api | ❓ | — |

> Double-check the ❓ entries are installed before running local debug — the sandboxed scan may have missed them.

---

## 6. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: Focused productivity console — calm indigo surfaces, generous whitespace, scannable task rows with clear priority and status affordances, and a warm orange accent reserved for primary CTAs so "what to do next" always pops off the page.
**Typography**: Inter, system-ui

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#4f46e5` | Primary buttons ("Create task"), active nav, active task badge, links |
| `accent`  | `#f97316` | High-priority markers, attachment upload zone highlight, hero CTA |
| `surface` | `#f8fafc` | App background, board columns |
| `text`    | `#0f172a` | Task titles, form inputs, body copy |
| `muted`   | `#64748b` | Due dates, assignee labels, empty-state copy, meta rows |
| `border`  | `#e2e8f0` | Card borders, table dividers, input outlines |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Task Dashboard | `/` | Filterable list of every task the signed-in user owns, with quick status controls | `header + nav + main(kpi-row + section-title + tabs + table)` |
| Task Detail | `/tasks/:id` | Single-task view with attachments, edits, and complete/delete actions | `header + nav + main(section-title + two-column(form + list) + action-bar)` |
| New Task | `/tasks/new` | Guided form to capture a new task with initial attachments | `header + nav + main(section-title + form + action-bar)` |

### Sample Content

```
Task Dashboard — task:
| Title                             | Priority | Due       | Assignee     | Status       |
| Q4 launch checklist               | High     | Oct 15    | Priya Shah   | In Progress  |
| Draft press release               | Medium   | Sep 20    | Diego Alvear | Blocked      |
| Design onboarding flow            | Medium   | Aug 30    | Priya Shah   | Done         |
| Migrate database schema           | High     | Oct 5     | Sam Okafor   | In Progress  |
| Weekly team notes                 | Low      | —         | Priya Shah   | Not Started  |
| Kickoff feedback follow-up        | Medium   | Sep 12    | Diego Alvear | Not Started  |

KPI tiles: Open tasks: 14 (▲ 3 this week) · Due this week: 5 · Blocked: 2 · Completed (30d): 27
Tabs: All (14) · Mine (9) · Blocked (2) · Done (27)

Task Detail — task: "Q4 launch checklist"
| Field       | Value                                                   |
| Priority    | High                                                    |
| Status      | In Progress                                             |
| Due         | Oct 15, 2026                                            |
| Assignee    | Priya Shah                                              |
| Created     | Aug 28, 2026                                            |
| Description | Ship the launch page, send the customer email, and post the release notes by end of day Oct 15. |

Attachments — attachment:
| File                          | Size    | Uploaded     |
| launch-brief-v3.pdf           | 480 KB  | 2 days ago   |
| homepage-mock.png             | 1.2 MB  | yesterday    |
| release-notes-draft.md        | 12 KB   | 3 hours ago  |

New Task — form defaults:
Title: {empty} · Priority: Medium · Assignee: Priya Shah (me) · Due: (blank) · Description: {empty} · Attachments: (drag files here)
```

---

## 7. Project Structure

```
task-tracker/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                    ← Root workspace config (npm workspaces)
├── services/
│   ├── tasks-api/                  ← Azure Functions project
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── functions/          ← One HTTP handler per file
│   │   │   │   ├── health.ts
│   │   │   │   ├── tasks-list.ts
│   │   │   │   ├── tasks-create.ts
│   │   │   │   ├── tasks-get.ts
│   │   │   │   ├── tasks-update.ts
│   │   │   │   ├── tasks-delete.ts
│   │   │   │   ├── attachments-list.ts
│   │   │   │   ├── attachments-upload.ts
│   │   │   │   └── attachments-delete.ts
│   │   │   ├── services/           ← Service abstraction layer
│   │   │   │   ├── interfaces/     ← ITaskRepo, IAttachmentStore, IAuth
│   │   │   │   ├── postgres-task-repo.ts
│   │   │   │   ├── blob-attachment-store.ts
│   │   │   │   ├── config.ts       ← Env loader + validation
│   │   │   │   └── registry.ts     ← Service factory / DI
│   │   │   ├── errors/             ← Error types + handler middleware
│   │   │   └── middleware/
│   │   │       └── mock-auth.ts    ← HMAC token verification
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   ├── mocks/
│   │   │   ├── services/
│   │   │   ├── functions/
│   │   │   └── validation/
│   │   └── seeds/
│   ├── tasks-web/                  ← React + Vite frontend
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── api/client.ts       ← Typed API client (fetch wrapper)
│   │       ├── components/
│   │       │   ├── TaskRow.tsx
│   │       │   ├── PriorityBadge.tsx
│   │       │   ├── StatusBadge.tsx
│   │       │   └── AttachmentDropzone.tsx
│   │       ├── pages/
│   │       │   ├── TaskDashboard.tsx
│   │       │   ├── TaskDetail.tsx
│   │       │   └── NewTask.tsx
│   │       └── hooks/
│   │           └── useTasks.ts
│   └── shared/                     ← Shared types + Zod schemas
│       ├── package.json
│       ├── types/
│       │   ├── entities.ts         ← Task, Attachment, User
│       │   └── api.ts              ← Response envelopes, ErrorCode
│       └── schemas/
│           └── validation.ts       ← Zod schemas + inferred request types
```

---

## 8. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check (probes DB + blob) | — | `{ status, services }` | None | 200, 503 |
| 2 | GET | `/api/tasks` | List tasks for the signed-in user; supports `?status=`, `?priority=`, `?q=` | — | `{ items: Task[] }` | Required | 200, 401 |
| 3 | POST | `/api/tasks` | Create a task | `{ title, priority, dueDate?, assigneeId?, description? }` | `{ item: Task }` | Required | 201, 401, 422 |
| 4 | GET | `/api/tasks/:id` | Fetch a single task with attachment metadata | — | `{ item: Task & { attachments: Attachment[] } }` | Required | 200, 401, 404 |
| 5 | PATCH | `/api/tasks/:id` | Update task fields (title, status, priority, dueDate, description) | `{ title?, status?, priority?, dueDate?, description? }` | `{ item: Task }` | Required | 200, 401, 404, 422 |
| 6 | DELETE | `/api/tasks/:id` | Delete a task and its attachments | — | — | Required | 204, 401, 404 |
| 7 | POST | `/api/tasks/:id/attachments` | Upload one attachment (multipart) | `multipart/form-data: file` | `{ item: Attachment }` | Required | 201, 401, 404, 413, 422 |
| 8 | GET | `/api/tasks/:id/attachments` | List attachments for a task with short-lived download URLs | — | `{ items: Attachment[] }` | Required | 200, 401, 404 |
| 9 | DELETE | `/api/tasks/:id/attachments/:attachmentId` | Delete a single attachment (row + blob) | — | — | Required | 204, 401, 404 |

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run the **azure-deploy** agent when ready; it uses **azure-app-onboard** for architecture, cost estimation, IaC generation, provisioning, and health verification
