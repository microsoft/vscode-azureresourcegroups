---
name: azure-project-integrate
description: "Integrate a freshly scaffolded Azure-centric project — create SQL/PostgreSQL schema migrations (NO seed data), smoke-test the backend so every endpoint responds, wire the frontend to LIVE backend data (replace all mock data), then run the frontend and backend together and verify end-to-end. Consumes the scaffold hand-off artifact `.azure/integration-plan.md`. WHEN: \"integrate project\", \"wire to live data\", \"remove mock data\", \"smoke test backend\", \"verify endpoints\", \"create migrations\", \"wire frontend and backend\", \"integrate scaffold\", \"make the app run\"."
license: MIT
metadata:
  author: Microsoft
  version: "1.0.0"
---

# Azure Project Integrate

> **AUTHORITATIVE — MANDATORY.** Canonical source for integrating a scaffolded Azure-centric project. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

**North Star:** take a project that *builds* (frontend with mock data + backend) and make it *run, wired together, against a real schema*. You produce **schema migrations**, prove the **backend smoke-tests clean**, replace **mock data with live API calls**, and verify the **frontend and backend communicate end-to-end**. After integration, stop — do NOT prompt the user for next steps (unless in autopilot, where you hand off to local dev).

## The four integration tasks (your entire scope)

1. **Migrations** — create the SQL / PostgreSQL schema migrations so the database tables exist. **No seed data.**
2. **Backend smoke test** — start the backend and verify every endpoint registers and responds.
3. **Wire frontend to LIVE data** — replace every mock data source in the frontend with real, typed API calls.
4. **End-to-end wire-up** — run the frontend and backend together and verify they communicate.

> ⛔ **NEVER create seed data.** No `seed`, `seeds`, `seed-data`, `fixtures`, demo rows, or any file/folder/function named after seeding. You create **schema only**. Integration is proven by the app running against an empty-but-correct schema. If the scaffold left a `seeds/` directory, ignore it — do not extend it, do not depend on it, do not run it.

## Triggers

Activate when the user (or the scaffold hand-off) wants to:
- Wire the scaffolded frontend to live backend data / remove mock data
- Smoke-test the backend and confirm endpoints work
- Create the database schema migrations
- Verify the frontend and backend run together

## ❌ DO NOT activate when

| User intent | Correct agent |
|-------------|---------------|
| Plan a new project / gather requirements | **azure-project-plan** |
| Scaffold backend + frontend from approved plan | **azure-project-scaffold** |
| Set up Docker emulators / VS Code F5 debugging | **azure-debug-plan** → **azure-debug-generate** |
| Deploy to Azure | **azure-deploy** |

---

## Prerequisites

Requires a scaffolded project. Verify before starting:
- `.azure/integration-plan.md` exists (the scaffold hand-off artifact). **This is your primary brief.**
- `.azure/project-plan.md` exists (the original plan — source of truth for routes, services, entities). Its `Status:` should be `Awaiting Integration` — the signal that the scaffold built clean and integration is the next required step. (If it already reads `Integrated`, integration has run before — re-verify rather than redo blindly.)
- Production code builds (the scaffold's final gate passed).

> If `.azure/integration-plan.md` is missing: do **not** fail. Fall back to `.azure/project-plan.md` plus a workspace scan to reconstruct the same facts (backend run command, frontend folder, routes, DB type, mock-data files, shared-types location). But always look for the artifact first.

> **📁 Paths are examples, not assumptions.** Every directory shown below (`services/web/`, `services/functions/`, `services/shared/`, …) is an illustrative default. Read the actual layout from `.azure/integration-plan.md` (or the plan's Project Structure section) and map these roles onto the real folders. Never assume or impose a path.

---

## STEP 0: Read the hand-off artifact & validate — MANDATORY FIRST ACTION

**BEFORE doing anything else**, read and internalize the brief:

| Task | Details |
|------|---------|
| Read `.azure/integration-plan.md` | The scaffold agent wrote this for you. Extract: backend project path + run command + port; frontend project path + build/dev commands; the API route inventory (method + path); the database type + migration tool + migration directory + connection env vars; the **API seam to swap** (`src/api/index.ts`) + the **mock files to delete** (`src/api/mockClient.ts`, `src/mocks/*`, the dev-only Mock State Switcher `src/api/previewState.ts` + its corner-switcher component); the shared-types/package location; the health endpoint. |
| Read `.azure/project-plan.md` | Cross-check routes (Section 7), services (Section 4), entities/types, and the database choice. The plan is the source of truth where the artifact is silent. |
| Scan the workspace | Confirm the folders the artifact names actually exist. List the frontend `src/` to locate the API seam (`src/api/` — `index.ts`, `mockClient.ts`) and the mock data (`src/mocks/`). List the backend functions folder to count handlers. List the migration directory. |
| Check database type | If the plan/artifact specifies PostgreSQL or Azure SQL (relational), migrations are **mandatory** (Step 1). If the project uses only non-relational storage (Cosmos, Table, Blob), Step 1's SQL migrations are N/A — note it and skip to Step 2. |

> **✅ Checkpoint**: Artifact loaded (or reconstructed from the plan + scan). You know: the backend run command, the frontend folder + commands, the full route list, the DB type + migration tool + directory, the API seam to repoint (`src/api/index.ts`), and the exact mock files to delete.

---

## STEP 1: Database Schema Migrations (NO SEED DATA)

> ⛛ **MANDATORY for relational databases (PostgreSQL / Azure SQL).** Skip only if the project has no relational database. Without migrations, every handler fails with `relation "X" does not exist` — the smoke test in Step 2 cannot pass.

**Goal**: Repeatable schema management — every table the handlers read/write exists, with full constraints. **Schema only. No data.**

| Task | Details |
|------|---------|
| Identify the migration tool | From the artifact/plan: Knex (Node.js) / Alembic (Python) / EF Core (.NET). If none configured, add the conventional one for the stack and wire its config. |
| Derive the schema from the entities + handlers | For each entity type / collection the handlers use, define a table. Read the handler data-access patterns so columns and types match what the code actually reads/writes. |
| Write the migration(s) | Each migration MUST contain a complete `up()` with `CREATE TABLE` (all columns, types) and a `down()` that reverses it. **Empty migration files do NOT satisfy this step.** After writing, list the directory and verify each file is non-zero size. |
| Add constraints | `UNIQUE` on business-unique fields, `FOREIGN KEY` with `ON DELETE`, `CHECK` for enums, `INDEX` on queried columns. (See [migrations.md](.github/agents/azure-project-integrate/references/migrations.md).) |
| Create / confirm the migration runner | A script or command to apply migrations forward and roll back. Add an npm/poetry/dotnet script if missing (e.g. `"migrate"`, `"migrate:rollback"`). |
| Verify table names match handlers | Cross-reference every table against the collection/table names the handlers use. Document the mapping if a `collectionToTable` map exists. |
| Apply the migrations | Run the migrate command against the local database (start the local DB / emulator if the artifact documents one). Confirm it applies with **zero errors** and the tables now exist. |

> ⛔ **DO NOT** create `seeds/`, `seed.ts`, `seed-data.json`, fixtures, or insert demo rows. If the scaffold created any, leave them untouched and do not invoke them. The schema must stand on its own.

> **✅ Checkpoint**:
> - Migration files exist and each is non-empty (list the directory, verify > 0 bytes).
> - Migrations apply cleanly against the local database — tables created, zero errors.
> - Every plan/handler table has a corresponding `CREATE TABLE` with constraints.
> - **No seed/fixture/demo-data files were created or run.**

---

## STEP 2: Backend Smoke Test

**Goal**: Prove the backend actually starts and every endpoint registers and responds — catching the runtime errors (broken imports, constructor crashes, missing tables) that a compile-time build never surfaces.

| Task | Details |
|------|---------|
| Ensure config/env is present | Confirm `.env` / `local.settings.json` has the values the backend needs (DB connection string pointing at the local DB from Step 1, required service vars). Use the scaffold's `.env.example` as the template. **Do not** commit secrets. |
| Build the backend | Run the backend build (`npm run build` / `tsc` / `dotnet build` / `python -m py_compile`). Zero errors. If `TS2307` import errors appear, the shared package exports are broken — fix before continuing. |
| Verify the `main`/entry field | For Azure Functions Node v4, list `dist/` and confirm the `main` glob matches the compiled handlers (a parent `rootDir` nests output deeper). Fix before starting the host. |
| Start the backend host | Run the run command from the artifact (e.g. `func start`, `npm start`, `dotnet run`). It MUST actually execute — do not skip. |
| Verify all functions register | Read the host console output. **Every** route from the inventory must register. `No job functions found` or `ERR_MODULE_NOT_FOUND` = an import/build bug — fix and restart. |
| Hit the health endpoint | `GET /api/health` (or the artifact's health path) → expect `200`. Confirms the app serves. |
| Probe representative endpoints | For each entity area, exercise at least one endpoint (a `GET` list/read, and ideally one write). Expect a structured response or a well-formed validation/`4xx` error — **not** a `500` from a missing table or crashed service. A clean `4xx` for missing auth/body is a PASS; a `500` is a FAIL to investigate. |
| Stop the host when done | Stop the backend process after probing (leave it running only if Step 4 needs it concurrently). |

**Reference**: [smoke-test.md](.github/agents/azure-project-integrate/references/smoke-test.md) for the per-runtime start commands, how to read host output, and the pass/fail matrix.

> **✅ Checkpoint**:
> - Backend builds with zero errors and the host starts.
> - Every endpoint in the inventory registers.
> - `GET /api/health` → `200`.
> - Probed endpoints return structured responses or clean `4xx` — **no `500`s from schema/runtime bugs**.
> - Any failure found here was fixed and re-verified, not deferred.

---

## STEP 3: Wire the Frontend to LIVE Data

**Goal**: Replace every mock data source in the frontend with real, typed calls to the backend verified in Step 2. After this step, **no mock data layer is in use**.

> **Skip** only if the project has no frontend.

| Task | Details |
|------|---------|
| Locate the seam | The scaffold left a stable `ApiClient` seam: `src/api/types.ts` (interface), `src/api/mockClient.ts` (mock impl), `src/api/index.ts` (the one-line swap point). Pages/hooks import only `api` from `src/api/`. Confirm this seam exists (artifact + scan). |
| Replace local types with shared types | Point `src/api/types.ts` at the shared package (e.g. `import type { PublicUser } from '@app/shared'`); delete the frontend's duplicated entity types. The `ApiClient` shape is unchanged. **No `any` types.** |
| Build the live client | Add `src/api/client.ts` — a second implementation of the **same `ApiClient` interface** (typed `: ApiClient`), method-for-method against the route inventory, base URL from env. |
| **Swap the seam (one file)** | Edit `src/api/index.ts` so `api` points at the live client (`mockClient` → `liveClient`). This single line wires every page/hook to live data — **no page or hook edits**. |
| Configure the dev proxy | Point the dev server's `/api` proxy at the backend host (e.g. `http://localhost:7071`) so the frontend reaches live endpoints in development. |
| Remove the mock layer | Delete `src/api/mockClient.ts` and `src/mocks/*` (and local types now sourced from shared). A lingering `import … from './mockClient'` or `'../mocks'` = NOT done. |
| **Remove the Mock State Switcher** | Delete the dev-only state switcher the scaffold added: `src/api/previewState.ts`, its corner-switcher component, and every `previewState` import/usage in the mock client, pages, hooks, and app shell. Live data is the only source now — the forced `loading`/`empty`/`error` override must be gone. A lingering `import … previewState` or a rendered Data/Loading/Empty/Error switcher = NOT done. |
| Keep correct file extensions | JSX (`<Component />`) MUST be `.tsx`; pure TS `.ts`. |
| Rebuild the frontend | Run `npm --prefix <frontend> run build` (cwd-independent). Zero errors, zero `any`. |

> ⚠️ **No mock data may remain in use.** Searching the frontend `src/` for `mock` / `mockData` / `previewState` must turn up nothing that is still imported. `useState<any>` or untyped responses = NOT done.

> **Reference**: [wire-live-data.md](.github/agents/azure-project-integrate/references/wire-live-data.md) for the one-file seam swap, the typed-client pattern, and the dev-proxy config per framework.

> **✅ Checkpoint**:
> - Frontend builds with zero errors and zero `any`.
> - The mock layer (`src/api/mockClient.ts`, `src/mocks/*`) is deleted or no longer imported anywhere.
> - The Mock State Switcher (`src/api/previewState.ts` + corner switcher component) is deleted and no longer imported anywhere.
> - The seam (`src/api/index.ts`) points at the live client; pages/hooks were not edited.
> - The dev proxy targets the backend host.

---

## STEP 4: End-to-End Wire-Up Verification

**Goal**: Run the frontend and backend **together** and confirm they actually communicate over the wire.

| Task | Details |
|------|---------|
| Start the backend | Start the backend host (from Step 2) so it is listening. |
| Start the frontend dev server | Start the frontend dev server (`npm --prefix <frontend> run dev`) with the dev proxy pointing at the backend. |
| Verify a live request path | Confirm the frontend successfully fetches from the backend — inspect the dev-server/host logs for a real `/api/...` request returning `200` (or load a page via the browser tool and confirm live data renders, not a mock placeholder). At least one page MUST display data that came from the running backend. |
| Verify a write path (if applicable) | If the app has a create/update flow, exercise one and confirm the backend receives it and the frontend reflects the result. |
| Capture evidence | Record the request/response (path, status) that proves frontend → backend wiring works. |
| Shut down cleanly | Stop both processes after verifying. |

**Reference**: [end-to-end.md](.github/agents/azure-project-integrate/references/end-to-end.md) for running both processes concurrently cross-platform and reading the evidence.

> **✅ Checkpoint**:
> - Frontend and backend ran concurrently.
> - At least one real `/api/...` request from the frontend hit the backend and returned `200` with live data (no mock).
> - Evidence captured. Both processes stopped cleanly.

---

## STEP 5: Wrap Up

**Goal**: Confirm all four tasks pass, update status, and stop.

| Task | Details |
|------|---------|
| Confirm all four checkpoints passed | Migrations applied · backend smoke-tested · frontend on live data · end-to-end verified. |
| Update the artifact | Mark `.azure/integration-plan.md` items complete (or append a short "Integration results" section: what was migrated, which endpoints passed, the mock files removed, the end-to-end evidence). |
| Update plan status | Set `.azure/project-plan.md` status to `Integrated`. |
| Print completion | Summarize: migrations created, endpoints verified, mock layer removed, end-to-end request proven. Announce: **"Integration complete!"** |
| **Open the Next Steps view, then stop** | Load `run_vscode_command` (via `tool_search`) and call `{ "commandId": "azureResourceGroups.openScaffoldNextStepsView", "name": "Open Project Next Steps View", "skipCheck": true }` to surface the post-integration "What's next?" view. Then **STOP** — the view owns the next hand-off (set up local development, or deploy). Do **NOT** ask the user what to do next; do **NOT** call `vscode_askQuestions`. (Autopilot exception: **skip** this view and hand off to `azureResourceGroups.startLocalDevelopment` per the agent's autopilot rule.) |

> **✅ Final Checkpoint**:
> 1. Migrations exist, are non-empty, apply cleanly — **no seed data**.
> 2. Backend host starts, all endpoints register, `GET /api/health` → 200, probes return no schema/runtime `500`s.
> 3. Frontend builds clean on live data; mock layer removed; no `any`.
> 4. Frontend + backend ran together; a real `/api/...` request returned live data.
> 5. `.azure/project-plan.md` = `Integrated`; artifact updated.
> 6. Opened the **Next Steps view** (`azureResourceGroups.openScaffoldNextStepsView`), then stopped — **no follow-up prompt** (autopilot instead hands off to `azure-debug-plan`).

---

## Outputs

| Artifact | Location |
|----------|----------|
| Schema migrations | The project's migration directory (e.g. `services/functions/migrations/`) — **schema only, no seeds** |
| Real typed API client | `services/web/src/api/client.ts` + seam repoint in `services/web/src/api/index.ts` (or the project's frontend) |
| Dev proxy config | The frontend dev-server config (e.g. `vite.config.ts`) |
| Updated artifact | `.azure/integration-plan.md` (results appended) |
| Plan status | `.azure/project-plan.md` → `Integrated` |
| **Next step** | Open the Next Steps view via `azureResourceGroups.openScaffoldNextStepsView` (autopilot instead hands off to `azure-debug-plan`) |

---

## Next

> After integration completes, announce **"Integration complete!"**, then open the post-integration **Next Steps view** by loading `run_vscode_command` and calling `azureResourceGroups.openScaffoldNextStepsView`. After opening it, **stop** — the view drives the next hand-off (local development or deploy). Do NOT ask the user what to do next — do NOT call `vscode_askQuestions` or print plain-text follow-up suggestions. (Autopilot exception: **skip** the view and hand off to `azureResourceGroups.startLocalDevelopment` with the `[AUTOPILOT MODE]` marker.)
