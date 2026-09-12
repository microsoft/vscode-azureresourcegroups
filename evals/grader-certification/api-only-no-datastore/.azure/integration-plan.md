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

## Validation

Run build, generated tests, lint, browser actions, accessibility checks, persistence restart, and debugger readiness.
