# Integration Plan

## 1. Overview

Integrate the browser client and Node.js API through same-origin HTTP routes. The browser calls the live backend and never imports preview or mock data modules.

## 2. Frontend

The frontend in `public/` uses `GET /api/items` to render persisted projects and `POST /api/items` to create a project. It uses semantic labels, a form, a button, an `aria-live` project list, and high-contrast styling.

## 3. Backend

The Node.js service in `src/server.js` exposes health, list, and create routes. It validates project names and returns explicit HTTP statuses.

## 4. Database

The file-backed repository persists records in `data/items.json`. Production migration would replace the file store with managed storage. NO seed data.

## 5. Services

The service also serves static HTML, JavaScript, and CSS from `public/`. Browser and API traffic use the same origin and port.

## 6. API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Report readiness |
| GET | `/api/items` | List projects |
| POST | `/api/items` | Create a project |

## 7. Validation

Run build, generated tests, lint, browser actions, accessibility checks, persistence restart, and debugger readiness.
