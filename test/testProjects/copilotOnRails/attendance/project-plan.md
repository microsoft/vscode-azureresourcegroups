# Project Plan

**Status**: Awaiting Integration
**Created**: 2026-07-21
**Mode**: NEW
**Execution Mode**: auto

---

## 1. Project Overview

**Goal**: A personal in-office attendance compliance application with an interactive monthly calendar for logging office days, configurable "X required days per Y-week period" policies, compliance progress tracking, and a future planning mode that compares planned vs. actual attendance. The project is designed so that every module is independently testable.

**App Type**: SPA + API

**Mode**: NEW

**Deployment Plan**: No deployment plan found

---

## 2. Attendance Compliance API — Azure Functions

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

## 3. Attendance Compliance Web App — Web App

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
| Blob Storage | Backing storage account required by the Azure Functions host (`AzureWebJobsStorage`) | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` | Essential |
| PostgreSQL | Primary data store for policies, attendance entries, and future plans | `DATABASE_URL` | `postgresql://localdev:localdevpassword@localhost:5432/attendance` | Essential |
| Microsoft Entra ID | User sign-in and API authorization | `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` | Mock auth middleware issuing a local dev identity | Essential |

---

## 5. Prerequisites

### Run

| Tool | Category | Service(s) | Installed | Version | Install |
|------|----------|-----------|-----------|---------|---------|
| Node.js | Runtime | * | ✅ | v24.18.0 | https://nodejs.org |
| npm | Package manager | * | ✅ | 11.16.0 | Bundled with Node.js |
| Azure Functions Core Tools | Runtime | attendance-api | ✅ | 4.12.1 | `npm i -g azure-functions-core-tools@4 --unsafe-perm true` |

### Debug

| Tool / Extension | Category | Service(s) | Installed | Version | Install |
|-------------------|----------|-----------|-----------|---------|---------|
| Docker | Container runtime | attendance-api (Blob Storage + PostgreSQL emulators) | ✅ | 29.3.1 | https://www.docker.com/products/docker-desktop |
| Docker Compose | Orchestrator | attendance-api | ❓ | — | Ensure Docker Compose is installed and ready (ships with Docker Desktop) |
| Chrome | Browser | attendance-web | ✅ | (installed) | https://www.google.com/chrome/ |
| `ms-azuretools.vscode-azurefunctions` | VS Code extension | attendance-api | ✅ | 1.20.3 / 1.22.0 | VS Code Marketplace |

---

## 6. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: A calm, trustworthy workplace-compliance console — generous whitespace, soft elevation, rounded 8px corners, and a blue/teal palette that reads "on track" rather than punitive.
**Typography**: Inter, system-ui

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#2F5D9E` | Primary buttons, active nav/sidebar items, links |
| `accent`  | `#17A689` | Compliance/"on track" badges, positive KPI deltas, secondary CTAs |
| `surface` | `#F7F9FB` | Page background |
| `text`    | `#1F2933` | Body text, headings |
| `muted`   | `#64748B` | Secondary text, captions, meta timestamps |
| `border`  | `#DFE3E8` | Dividers, card and input borders |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Dashboard | `/` | Interactive monthly calendar for logging in-office days, plus current-period compliance KPIs | `header, sidebar, hero, kpi-row, table, list, action-bar` |
| Planning | `/planning` | Create future attendance plans and compare planned vs. actual compliance over time | `header, sidebar, hero, table, action-bar` |
| Settings | `/settings` | Configure the "X required office days per Y-week period" policy | `header, sidebar, form, actions` |

### Sample Content

```
Dashboard — this week's office days (week of Jul 20–24, 2026):
| Date        | Day | Status     |
| Jul 20      | Mon | In-Office  |
| Jul 21      | Tue | In-Office (today) |
| Jul 22      | Wed | Remote     |
| Jul 23      | Thu | In-Office  |
| Jul 24      | Fri | Remote     |

Dashboard — KPIs: This Week's Office Days: 3 / 3 required · Compliance Rate (last 4 weeks): 92% · Current Streak: 6 weeks compliant

Dashboard — Recent Overrides (empty state): no manual overrides logged yet.

Planning — planned vs. actual (shown as loading skeleton):
| Period            | Planned Office Days       | Actual Office Days | Status     |
| Jul 27 – Jul 31    | Mon, Wed, Fri (3)         | Not started yet     | Upcoming   |
| Aug 3 – Aug 7      | Tue, Wed, Thu (3)         | Not started yet     | Upcoming   |
| Aug 10 – Aug 14    | Mon, Tue, Thu (3)         | Not started yet     | Upcoming   |

Settings — policy form (shown with an error banner: "Couldn't load your saved policy — showing defaults below"): Required office days: 3 · Period length: 1 week · Period start day: Monday
```

---

## 7. Project Structure

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                        ← Root workspace config
├── api/                                ← Attendance Compliance API (Azure Functions)
│   ├── host.json
│   ├── local.settings.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── functions/                  ← One handler per file (policy, entries, plans, compliance)
│   │   ├── services/                   ← Service abstraction layer
│   │   │   ├── interfaces/             ← Service contracts
│   │   │   ├── config.ts               ← Config loader + validation
│   │   │   └── registry.ts             ← Service factory / DI
│   │   ├── errors/                     ← Error types and middleware
│   │   └── middleware/                 ← Auth (Entra ID) middleware
│   ├── tests/
│   │   ├── fixtures/
│   │   ├── mocks/
│   │   ├── services/
│   │   ├── functions/
│   │   └── validation/
│   └── seeds/
├── web/                                ← Attendance Compliance Web App
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/client.ts               ← Typed API client
│       ├── components/                 ← Calendar, KPI tiles, policy form
│       ├── pages/                      ← Dashboard, Planning, Settings
│       └── hooks/
└── shared/                             ← Shared types and schemas
    ├── package.json
    ├── types/
    │   ├── entities.ts                 ← AttendancePolicy, AttendanceEntry, AttendancePlan
    │   └── api.ts                      ← Response contracts + ErrorCode
    └── schemas/
        └── validation.ts               ← Zod schemas + inferred request types
```

---

## 8. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check | — | `{ status, services }` | None | 200, 503 |
| 2 | GET | `/api/policy` | Get the current attendance policy | — | `{ requiredDays, periodWeeks, periodStartDay }` | Entra ID | 200, 401, 404 |
| 3 | PUT | `/api/policy` | Create or update the attendance policy | `{ requiredDays, periodWeeks, periodStartDay }` | `{ requiredDays, periodWeeks, periodStartDay }` | Entra ID | 200, 401, 422 |
| 4 | GET | `/api/entries` | Get attendance entries for a calendar month | Query: `month` (`YYYY-MM`) | `{ entries: [{ date, status }] }` | Entra ID | 200, 401 |
| 5 | POST | `/api/entries` | Record or update an in-office day entry | `{ date, status }` | `{ date, status }` | Entra ID | 201, 401, 422 |
| 6 | DELETE | `/api/entries/{date}` | Clear an attendance entry | — | — | Entra ID | 204, 401, 404 |
| 7 | GET | `/api/compliance/summary` | Get current + historical compliance summary | Query: `periods` | `{ periods: [{ period, required, actual, compliant }] }` | Entra ID | 200, 401 |
| 8 | GET | `/api/plans` | Get future attendance plans | Query: `from`, `to` | `{ plans: [{ date, plannedStatus }] }` | Entra ID | 200, 401 |
| 9 | POST | `/api/plans` | Create a future attendance plan entry | `{ date, plannedStatus }` | `{ date, plannedStatus }` | Entra ID | 201, 401, 422 |
| 10 | GET | `/api/compliance/comparison` | Compare planned vs. actual compliance over time | Query: `from`, `to` | `{ periods: [{ period, planned, actual }] }` | Entra ID | 200, 401 |

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run **azure-prepare** → **azure-deploy** when ready to deploy
