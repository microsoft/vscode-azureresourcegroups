# Project Plan

**Status**: Integrated
**Created**: 2026-08-25
**Mode**: New Project

## 1. Project Overview

**Goal**: Build a ticket tracker whose browser UI, HTTP API and background worker are independently testable.

**App Type**: SPA + API

**Mode**: NEW

## 2. Backend — Azure Functions

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

## 3. Frontend — Web App

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | React + Vite |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Test Command** | npm test |

## 4. Worker — Background Jobs

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

## 5. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| PostgreSQL | Primary data store for tickets | DATABASE_URL | postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/tickets | Essential |
| Blob Storage | Store ticket attachments | STORAGE_CONNECTION_STRING | UseDevelopmentStorage=true | Essential |
| Queue Storage | Hand queued work to the background worker | QUEUE_CONNECTION_STRING | UseDevelopmentStorage=true | Essential |

## 6. Prerequisites

### Run

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| Node.js | * | ✅ | 22.x | https://nodejs.org |
| npm | * | ✅ | 10.x | https://nodejs.org |

### Debug

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| Docker | api, worker | ❓ | — | https://docs.docker.com/get-docker/ |

## 7. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: Dense operational console with restrained elevation and scannable ticket rows.
**Typography**: Segoe UI Variable

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#0F6CBD` | Primary actions and active navigation |
| `accent` | `#8764B8` | Priority badges |
| `surface` | `#FFFFFF` | Ticket cards and page background |
| `text` | `#1B1A19` | Ticket titles and body copy |
| `muted` | `#605E5C` | Timestamps and assignee captions |
| `border` | `#E1DFDD` | Row dividers and input borders |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Tickets | `/` | Browse and triage open tickets | `header + table + action-bar` |

## 8. Project Structure

```text
services/api/src/index.ts
services/api/src/db.ts
services/api/src/storage.ts
services/web/src/App.tsx
services/worker/src/index.ts
services/shared/src/types.ts
```

## 9. Route Definitions

| # | Method | Path | Description | Auth | Status Codes |
|---|--------|------|-------------|------|-------------|
| 1 | GET | `/api/health` | Report service health | None | 200 |
| 2 | GET | `/api/tickets` | List tickets | None | 200 |
| 3 | POST | `/api/tickets` | Create a ticket | None | 201, 400 |

## 10. Next Steps

1. Scaffold the three services.
2. Integrate the browser client with the API.
3. Generate debug artifacts.
