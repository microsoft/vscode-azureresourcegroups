# Integration Plan

## Overview

Integrate the browser client and Node.js API through same-origin HTTP routes. The browser calls the live backend and never imports preview or mock data modules.

## Backend

| Field | Value |
|-------|-------|
| Project folder | `.` (repository root) |
| Build command | `npm run build` |
| Run command | `npm start` |
| Port | 7071 (override with `PORT`) |
| Health endpoint | `GET /api/health` |

The Node.js service in `src/server.js` exposes health, list, and create routes. It validates project names and returns explicit HTTP statuses.

## Frontend

| Field | Value |
|-------|-------|
| Project folder | `public/` |
| Build command | `npm run build` |
| Dev command | `npm run dev` |
| API seam file | `public/js/api/index.js` |
| Mock client to delete | `public/js/api/mockClient.js` |
| Mock data to delete | `public/js/mocks/data.js` |
| Preview state to delete | `public/js/api/previewState.js` |

The live-data swap is a one-file edit at `public/js/api/index.js`: repoint from `mockClient` to the live client. No page or component changes are needed — every caller imports the seam.

## API Routes

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/health` | Report readiness |
| 2 | GET | `/api/items` | List projects |
| 3 | POST | `/api/items` | Create a project |

## Database

| Field | Value |
|-------|-------|
| Type | File-backed JSON store |
| Data file | `data/items.json` |
| Migration tool | none (no schema to migrate) |

Production migration would replace the file store with managed storage. **NO seed data is to be created.**

### Collection → table mapping (whitelisted in `src/services/database.ts`)

| Collection (code) | Store key |
|-------------------|-----------|
| `tickets` | `items` |

## Shared Types

| Field | Value |
|-------|-------|
| Package | `@app/shared` |
| Location | `src/shared/` |
| Import alias | `@app/shared` |

## Services

| Service | Classification | Role |
|---------|---------------|------|
| File repository (IItemRepository) | Essential | Persist project records |
| Static file server | Essential | Serve HTML, JS, and CSS from `public/` |

## Workload Quality Contract

| Field | Value |
|---|---|
| Operating Profile | Development / Demo |
| Data Classification | Public |
| Traffic Profile | Small / Steady |
| Optimization Priority | Balanced |

### Application Controls

| ID | Pillar | Control | Evidence | Integration Validation |
|---|---|---|---|---|
| `REL-HEALTH-01` | Reliability | Health and explicit failure behavior | `GET /api/health`; `src/server.js` | `npm test` |
| `SEC-INPUT-01` | Security | Validate project names and expose no secrets | `src/server.js`; `test/server.test.js` | `npm test` |
| `COST-SCOPE-01` | Cost Optimization | Dependency-free implementation uses only approved services | Project dependency inventory | `npm run build` |
| `OE-ERROR-01` | Operational Excellence | Structured HTTP errors and health output | `src/server.js` | `npm test` |
| `PE-BOUNDS-01` | Performance Efficiency | Project list and names have explicit bounds | Request validation in `src/server.js` | `npm test` |

### Dependency Access

None — this fixture stores projects in-process and reaches no Azure dependency, so no deployed
identity or role is involved.

### Deferred Risks

- Production recovery, identity, alerting, and load testing are outside this Development / Demo fixture.

## Validation

Run build, generated tests, lint, browser actions, accessibility checks, persistence restart, and debugger readiness.
