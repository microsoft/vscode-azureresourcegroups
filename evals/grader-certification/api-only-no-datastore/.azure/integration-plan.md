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

## API Routes

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/health` | Report readiness |
| 2 | GET | `/api/items` | List projects |
| 3 | POST | `/api/items` | Create a project |

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

None — this fixture reaches no Azure dependency. The item repository is a local file and the static
file server is in-process, so no deployed identity or role is involved.

### Deferred Risks

- Production recovery, identity, alerting, and load testing are outside this Development / Demo fixture.

## Validation

Run build, generated tests, lint, browser actions, accessibility checks, persistence restart, and debugger readiness.
