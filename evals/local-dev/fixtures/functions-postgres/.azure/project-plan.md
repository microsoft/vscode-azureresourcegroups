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

## 5. Route Definitions

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | Liveness probe |
| GET | /api/tasks | List tasks |
| POST | /api/tasks | Create a task |

## 6. Azure Dependencies

| Dependency | Service | Local Emulator |
|---|---|---|
| PostgreSQL | database | `postgres:16` container |
| Blob Storage | storage | Azurite container |

## 7. Acceptance Criteria

- `GET /api/health` returns 200.
- A created task survives an API restart.
- The frontend lists tasks returned by the API.
