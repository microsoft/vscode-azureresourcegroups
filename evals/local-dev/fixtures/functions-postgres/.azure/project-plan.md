# Project Plan

**Status**: Approved
**Created**: 2026-08-24
**Mode**: New Project

## 1. Project Overview

**App Type**: Web Application

Build a task tracker with a React frontend, an Azure Functions HTTP backend, and a
PostgreSQL database for durable storage. Uploaded attachments are held in Blob Storage.

### User Flow

A user opens the tracker, creates a task with an optional attachment, and sees the
task persist across restarts.

### Architecture

- A React single-page app calls the Functions API.
- An Azure Functions (Node.js) app exposes the task routes.
- PostgreSQL stores task records; Blob Storage holds attachments.

## 2. Services Required

| Name | Responsibility |
|---|---|
| web | React frontend for creating and listing tasks |
| api | Azure Functions HTTP API for task CRUD |
| database | PostgreSQL store for task records |
| storage | Blob Storage for task attachments |

## 3. Prerequisites

- Node.js 22
- npm
- Docker (for the local PostgreSQL and Azurite containers)
- Azure Functions Core Tools v4

## 4. Project Structure

```text
web/src/App.tsx
web/package.json
api/src/functions/tasks.js
api/host.json
api/package.json
```

## 5. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: Calm, data-dense task console — flat surfaces with subtle elevation on cards, 4px radii, and an emphasis on scannable rows over decoration.
**Typography**: Inter, system-ui

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#2F6FEB` | Create-task button, active nav item, task links |
| `accent`  | `#7A5AF8` | Due-soon highlights, attachment chips |
| `surface` | `#F7F8FA` | Page background and task card surfaces |
| `text`    | `#1B1E23` | Task titles and body copy |
| `muted`   | `#6B7280` | Timestamps, task counts, empty-state copy |
| `border`  | `#E1E4E8` | Row dividers, card and input borders |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Tasks | `/` | List every task with status and due date | `header + list + action-bar` |
| Task Detail | `/tasks/:id` | Show one task with its attachment and history | `two-column(media+meta) + action-bar` |
| New Task | `/tasks/new` | Capture a task with an optional attachment | `form` |

### Sample Content

```
Tasks — task:
| Title                          | Due        | Attachment       | Status      |
| Renew SSL certificate          | 2026-09-04 | renewal.pdf      | In progress |
| Migrate staging database       | 2026-09-11 | —                | Not started |
| Write incident postmortem      | 2026-08-29 | timeline.png     | Done        |
| Audit blob retention policy    | 2026-09-18 | —                | Not started |

Task Detail — task: Renew SSL certificate · Due: 2026-09-04 · Status: In progress · Attachment: renewal.pdf (412 KB)

New Task — Title: (empty) · Due: today + 7 days · Attachment: none · Status: Not started
```

## 6. Route Definitions

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | Liveness probe |
| GET | /api/tasks | List tasks |
| POST | /api/tasks | Create a task |

## 7. Azure Dependencies

| Dependency | Service | Local Emulator |
|---|---|---|
| PostgreSQL | database | `postgres:16` container |
| Blob Storage | storage | Azurite container |

## 8. Acceptance Criteria

- `GET /api/health` returns 200.
- A created task survives an API restart.
- The frontend lists tasks returned by the API.
