# Integration Plan

**Project**: Task Tracker
**Status**: Ready for Integration
**Created**: 2026-08-31

## Overview

The project has been scaffolded with a React frontend (mock data), Azure Functions backend (TypeScript), PostgreSQL database, and Blob Storage. This document provides the integrate agent with all the details needed to:
1. Create database schema migrations (NO seed data)
2. Wire the frontend to live backend data
3. Smoke-test every API endpoint
4. Verify the app end-to-end

---

## Backend

### Project Details
- **Folder**: `services/functions/`
- **Run Command**: `npm start` (runs `func start` after building)
- **Port**: 7071 (default Azure Functions local port)
- **Health Endpoint**: `GET /api/health`
- **Build Command**: `npm run build`

### API Routes Inventory

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check with database and storage status |
| GET | `/api/tasks` | List all tasks (supports `?limit=N&offset=N` pagination) |
| POST | `/api/tasks` | Create a new task (body: `{ title, dueDate, status? }`) |
| GET | `/api/openapi` | OpenAPI 3.0 spec |

---

## Frontend

### Project Details
- **Folder**: `services/web/`
- **Build Command**: `npm run build`
- **Dev Command**: `npm run dev`
- **Dev Server**: Vite (configured for iframe embeddability)

### API Seam (Wire-Up Point)
- **File**: `services/web/src/api/index.ts`
- **Current**: Exports `mockClient` (in-memory mock data)
- **Target**: Replace with the live client that calls the Functions backend

### Mock Files to Delete
When wiring to live data, delete these mock-only artifacts:
- `services/web/src/api/mockClient.ts` — mock implementation
- `services/web/src/mocks/data.ts` — mock task records
- `services/web/src/api/previewState.ts` — dev-only Mock State Switcher logic
- `services/web/src/components/MockStateSwitcher.tsx` — corner toggle component

The live client will implement the same `ApiClient` interface from `services/web/src/api/types.ts`:
```typescript
interface ApiClient {
  getHealth(): Promise<HealthResponse>;
  getTasks(): Promise<TaskListResponse>;
  getTask(id: string): Promise<Task>;
  createTask(data: CreateTaskRequest): Promise<Task>;
}
```

---

## Database

### Configuration
- **Type**: PostgreSQL
- **Migration Tool**: Raw SQL or a migration library (your choice)
- **Migration Directory**: Create `services/functions/migrations/` or equivalent
- **Connection Env Var**: `DATABASE_URL` (format: `postgresql://user:pass@host:port/dbname`)

### Collection → Table Mapping
- Collection `task` → SQL table `tasks`

### Schema Requirements
The `tasks` table MUST have these columns (snake_case):
- `id` (text/uuid, primary key)
- `title` (text, not null)
- `status` (text, not null, check constraint for 'not-started' | 'in-progress' | 'done')
- `due_date` (text/date, not null)
- `attachment_url` (text, nullable)
- `attachment_name` (text, nullable)
- `attachment_size` (integer, nullable)
- `created_at` (timestamp, default NOW())
- `updated_at` (timestamp, default NOW())

**IMPORTANT**: Do NOT create seed data. The frontend's mock data was purely for scaffolding preview and should not be inserted into the real database.

---

## Shared Types

- **Package**: `services/shared/`
- **Import Alias**: `../shared/` (relative path imports, not a workspace alias)
- **Exports**: Entity types (`Task`, `TaskStatus`, `HealthResponse`), validation schemas (`CreateTaskSchema`), API types (`ErrorCode`, `ErrorResponse`, `TaskListResponse`)

---

## Services

All services are **Essential** (database and storage). No Enhancement services in this project.

---

## Integration Checklist

The `azure-project-integrate` agent will:

1. **Create Migrations**:
   - Write `001_create_tasks_table.sql` (or equivalent) with the `tasks` table schema above
   - Do NOT insert seed data

2. **Smoke-Test Backend**:
   - Start the backend (`func start` in `services/functions/`)
   - Probe each route:
     - `GET /api/health` → expect 200 or 503 with `{ status, services }`
     - `GET /api/tasks` → expect 200 with `{ tasks: [], total: 0 }` (empty initially)
     - `POST /api/tasks` with valid body → expect 201 with `{ task: {...} }`
   - Verify all routes respond (not 404 or 500 on valid requests)

3. **Wire Frontend to Live Data**:
   - Create `services/web/src/api/liveClient.ts` implementing `ApiClient` interface
   - Update `services/web/src/api/index.ts` to export `liveClient` instead of `mockClient`
   - Delete the four mock files listed above

4. **Verify End-to-End**:
   - Start backend (`npm start` in `services/functions/`)
   - Start frontend (`npm run dev` in `services/web/`)
   - Create a task via the frontend UI
   - Verify it persists (refresh the page, task still appears)
   - Verify the task is in the database (query the `tasks` table)

---

## Notes

- The frontend is already configured for CORS proxy in `vite.config.ts` (routes `/api/*` to `http://localhost:7071/api`)
- The backend handlers return standardized error responses with `{ error: { code, message, details } }`
- The frontend's mock state switcher (corner toggle) is only for scaffolding preview — remove it during integration
