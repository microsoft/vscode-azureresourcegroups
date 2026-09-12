# Integration Plan — Attendance Compliance App

Hand-off brief for `azure-project-integrate`. Scaffold is built and clean (all 3 workspaces compile with zero errors). This agent wires the frontend to live data, smoke-tests the backend, creates schema migrations (NO seed data), and verifies end-to-end.

## Backend

- **Folder**: `api/`
- **Build**: `npm run build --workspace=api` (produces `api/dist/`)
- **Run**: `npm run start --workspace=api` (runs `func start`, requires `func` build first — `prestart` script already runs `npm run build`)
- **Port**: `7071` (Azure Functions default)
- **Health endpoint**: `GET /api/health` → `{ status: "healthy"|"degraded"|"unhealthy", services: { database: bool, storage: bool } }`. `unhealthy` → HTTP 503, others → 200.
- **OpenAPI spec**: `GET /api/openapi.json`
- **Env file**: copy `.env.example` → `.env` at repo root; `api/local.settings.json` already has Azurite + local Postgres defaults wired for `func start`.
- **Auth**: Microsoft Entra ID. Locally, when `AZURE_AD_TENANT_ID`/`AZURE_AD_CLIENT_ID` are unset and `NODE_ENV !== 'production'`, `src/middleware/auth.ts` returns a mock dev identity (`userId: 'dev-user'`) — no real token required for smoke testing.

## Frontend

- **Folder**: `web/`
- **Build**: `npm run build --workspace=web`
- **Dev server**: `npm run dev --workspace=web` (Vite, default port 5173 — proxy `/api` to `http://localhost:7071` needs to be added to `web/vite.config.ts` if not already present)
- **API seam to swap**: `web/src/api/index.ts` — currently re-exports the mock client (`web/src/api/mockClient.ts`). Repoint this one file to a new live client implementing the same `ApiClient` interface (`web/src/api/types.ts`) that calls the real endpoints below.
- **Mock files to delete once the live client is wired and verified**:
  - `web/src/api/mockClient.ts`
  - `web/src/mocks/data.ts`
  - `web/src/api/previewState.ts` and the dev-only corner `MockStateSwitcher` component (`web/src/components/MockStateSwitcher.tsx`) — remove its usage from `web/src/App.tsx` (or wherever it's mounted) once mock states are no longer needed.
  - Local mock/demo types can stay if they match `shared` — prefer switching frontend type imports to the `shared` package (see below) where shapes match exactly.
- **Auth**: `web/src/auth/AuthContext.tsx` currently auto-logs-in with a mock identity — leave as-is for local dev against the mock backend identity; wire to real Entra ID only when preparing for production deploy (out of scope here).

## API routes (mirror method-for-method in the live client)

| # | Method | Path | Request | Response | Auth | Status codes |
|---|--------|------|---------|----------|------|--------------|
| 1 | GET | `/api/health` | — | `{ status, services }` | None | 200, 503 |
| 2 | GET | `/api/policy` | — | `{ requiredDays, periodWeeks, periodStartDay }` | Entra ID (mock in dev) | 200, 401, 404 |
| 3 | PUT | `/api/policy` | `{ requiredDays, periodWeeks, periodStartDay }` | same shape | Entra ID | 200, 401, 422 |
| 4 | GET | `/api/entries?month=YYYY-MM` | — | `{ entries: [{ date, status }] }` | Entra ID | 200, 401 |
| 5 | POST | `/api/entries` | `{ date, status }` | `{ date, status }` | Entra ID | 201, 401, 422 |
| 6 | DELETE | `/api/entries/{date}` | — | — | Entra ID | 204, 401, 404 |
| 7 | GET | `/api/compliance/summary?periods=N` | — | `{ periods: [{ period, required, actual, compliant }] }` | Entra ID | 200, 401 |
| 8 | GET | `/api/plans?from&to` | — | `{ plans: [{ date, plannedStatus }] }` | Entra ID | 200, 401 |
| 9 | POST | `/api/plans` | `{ date, plannedStatus }` | `{ date, plannedStatus }` | Entra ID | 201, 401, 422 |
| 10 | GET | `/api/compliance/comparison?from&to` | — | `{ periods: [{ period, planned, actual }] }` | Entra ID | 200, 401 |

`status`/`plannedStatus` values: `"in-office" | "remote"`. Dates are `YYYY-MM-DD`.

## Database

- **Type**: PostgreSQL
- **Connection env var**: `DATABASE_URL` (default local: `postgresql://localdev:localdevpassword@localhost:5432/attendance`)
- **Migration tool**: none installed yet — pick a lightweight one (e.g. `node-pg-migrate` or raw `.sql` files run via a small script) and add a `db:migrate` script to `api/package.json`.
- **Migration directory**: create `api/migrations/`
- **Tables to create** (collection → table mapping is defined in `api/src/utils/caseConversion.ts` → `COLLECTION_TABLE_MAP`):
  - `attendance_policies` — `id UUID PK`, `user_id TEXT NOT NULL UNIQUE`, `required_days INT NOT NULL`, `period_weeks INT NOT NULL`, `period_start_day TEXT NOT NULL` (CHECK enum of 7 day names), `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
  - `attendance_entries` — `id UUID PK`, `user_id TEXT NOT NULL`, `date DATE NOT NULL`, `status TEXT NOT NULL` (CHECK `in-office`/`remote`), `created_at`, `updated_at`. **UNIQUE (user_id, date)**.
  - `attendance_plans` — same shape as `attendance_entries` but `planned_status` instead of `status`. **UNIQUE (user_id, date)**.
- **NO SEED DATA** — migrations must only create schema/constraints, not insert rows.

## Shared types

- **Package**: `shared` (npm workspace, import as `from 'shared'`)
- **Contents**: `shared/types/entities.ts` (DB entity shapes), `shared/types/api.ts` (response contracts), `shared/types/errors.ts` (`ErrorCode`), `shared/schemas/validation.ts` (Zod schemas + inferred request types)
- Build with `npm run build --workspace=shared` before building `api` or `web` if types change.

## Services (Essential vs Enhancement)

All three services in this app are classified **Essential** (no Enhancement/optional services):
- **PostgreSQL** — `DATABASE_URL` — primary data store (`api/src/services/database.ts`, `PostgresDatabaseService`)
- **Blob Storage** — `STORAGE_CONNECTION_STRING` — required by the Functions host; also health-checked (`api/src/services/storage.ts`, `BlobStorageService`)
- **Microsoft Entra ID** — `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` — auth; falls back to mock dev identity locally when unset (`api/src/middleware/auth.ts`)

## Smoke test checklist

1. Start Postgres + Azurite (docker-compose — not yet generated; `azure-debug-plan`/`azure-debug-generate` will produce this after integration).
2. Run migrations (no seed data).
3. `npm run start --workspace=api`, confirm `GET /api/health` returns `200` with `database: true, storage: true`.
4. Exercise each of the 10 routes above with a `dev-user` identity (no auth header needed locally).
5. Wire `web/src/api/index.ts` to the live client, delete mock files, run `npm run dev --workspace=web`, confirm the app renders real (initially empty) data instead of the seeded mock dataset.
