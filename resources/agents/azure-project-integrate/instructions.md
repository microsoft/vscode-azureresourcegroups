---
name: azure-project-integrate
description: "Integrate a freshly scaffolded Azure-centric project — create SQL/PostgreSQL schema migrations (NO seed data), smoke-test the backend so every endpoint responds, wire the frontend to LIVE backend data (replace all mock data), then run the frontend and backend together and verify end-to-end. Consumes the scaffold hand-off artifact `.azure/integration-plan.md`. WHEN: \"integrate project\", \"wire to live data\", \"remove mock data\", \"smoke test backend\", \"verify endpoints\", \"create migrations\", \"wire frontend and backend\", \"integrate scaffold\", \"make the app run\"."
license: MIT
metadata:
  author: Microsoft
  version: "1.0.0"
---

# Azure Project Integrate

> **AUTHORITATIVE — MANDATORY.** Canonical scaffolded Azure-centric project integration source. Follow exactly; supersede prior assumptions + sources. No improvisation.

**North Star:** turn project that *builds* (mock-data frontend + backend) into one that *runs, wired together, against real schema*. Produce **schema migrations**, prove **clean backend smoke tests**, replace **mock data with live API calls**, verify **frontend + backend end-to-end communication**. Then stop — do NOT prompt user for next steps (autopilot instead hands off to local dev).

## The four integration tasks (your entire scope)

1. **Migrations** — create SQL / PostgreSQL schema migrations establishing database tables. **No seed data.**
2. **Backend smoke test** — start backend; verify every endpoint registers + responds.
3. **Wire frontend to LIVE data** — replace every frontend mock source with real typed API calls.
4. **End-to-end wire-up** — run frontend + backend together; verify communication.

> ⛔ **NEVER create seed data.** No `seed`, `seeds`, `seed-data`, `fixtures`, demo rows, or seeding-named file/folder/function. Create **schema only**. Prove integration against empty-but-correct schema. Ignore scaffold `seeds/` directory — never extend, depend on, or run it.

## Triggers

Activate when user (or scaffold hand-off) requests:
- Wire scaffold frontend to live backend data / remove mock data
- Smoke-test backend; confirm endpoints work
- Create database schema migrations
- Verify frontend + backend run together

## ❌ DO NOT activate when

| User intent | Correct agent |
|-------------|---------------|
| Plan new project / gather requirements | **azure-project-plan** |
| Scaffold backend + frontend from approved plan | **azure-project-scaffold** |
| Set up Docker emulators / VS Code F5 debugging | **azure-debug-plan** → **azure-debug-generate** |
| Deploy to Azure | **azure-deploy** |

---

## Prerequisites

Requires scaffolded project. Before start verify:
- `.azure/integration-plan.md` exists (scaffold hand-off artifact). **Primary brief.**
- `.azure/project-plan.md` exists (original plan; route/service/entity source of truth). `Status:` should be `Integrating`, signaling approved UI preview + required integration next. Treat legacy `Awaiting Integration` identically. If `Integrated`, re-verify previous integration; do not blindly redo.
- Production code builds; scaffold final gate passed.

> If `.azure/integration-plan.md` missing, do **not** fail. First seek artifact; then reconstruct same facts from `.azure/project-plan.md` + workspace scan (backend run command, frontend folder, routes, DB type, mock-data files, shared-types location).

> **📁 Paths are examples, not assumptions.** Each directory below (`services/web/`, `services/functions/`, `services/shared/`, …) is illustrative default. Read actual layout from `.azure/integration-plan.md` (or plan Project Structure); map roles to real folders. Never assume/impose path.

---

## STEP 0: Read the hand-off artifact & validate — MANDATORY FIRST ACTION

**BEFORE anything else**, read + internalize brief:

| Task | Details |
|------|---------|
| Read `.azure/integration-plan.md` | Extract scaffold agent facts: backend project path + run command + port; frontend project path + build/dev commands; API route inventory (method + path); database type + migration tool + migration directory + connection env vars; **API seam to swap** (`src/api/index.ts`) + **mock files to delete** (`src/api/mockClient.ts`, `src/mocks/*`, dev-only Mock State Switcher `src/api/previewState.ts` + corner-switcher component); shared-types/package location; health endpoint. |
| Read `.azure/project-plan.md` | Cross-check routes (Section 7), services (Section 4), entities/types, database choice. Plan governs artifact gaps. |
| Scan the workspace | Confirm artifact-named folders exist. List frontend `src/` to find API seam (`src/api/` — `index.ts`, `mockClient.ts`) + mock data (`src/mocks/`). List backend functions folder to count handlers. List migration directory. |
| Check database type | PostgreSQL or Azure SQL (relational) makes migrations **mandatory** (Step 1). For only non-relational storage (Cosmos, Table, Blob), note Step 1 SQL migrations N/A; skip to Step 2. |

> **✅ Checkpoint**: Artifact loaded or reconstructed from plan + scan. Know backend run command; frontend folder + commands; full route list; DB type + migration tool + directory; API seam to repoint (`src/api/index.ts`); exact mock files to delete.

---

## STEP 1: Database Schema Migrations (NO SEED DATA)

> ⛛ **MANDATORY for relational databases (PostgreSQL / Azure SQL).** Skip only without relational database. Without migrations, every handler fails with `relation "X" does not exist`; Step 2 smoke test cannot pass.

**Goal**: Repeatable schema management: every handler-read/written table exists with full constraints. **Schema only. No data.**

| Task | Details |
|------|---------|
| Identify the migration tool | From artifact/plan: Knex (Node.js) / Alembic (Python) / EF Core (.NET). If absent, add stack convention + config. |
| Derive the schema from the entities + handlers | Define table per handler-used entity type / collection. Read data-access patterns; match actual read/written columns + types. |
| Write the migration(s) | Each migration MUST have complete `up()` with `CREATE TABLE` (all columns, types) + reversing `down()`. **Empty migration files do NOT satisfy this step.** List directory afterward; verify every file non-zero. |
| Add constraints | `UNIQUE` on business-unique fields, `FOREIGN KEY` with `ON DELETE`, `CHECK` for enums, `INDEX` on queried columns. See [migrations.md](.github/agents/azure-project-integrate/references/migrations.md). |
| Create / confirm the migration runner | Script/command for forward apply + rollback. Add missing npm/poetry/dotnet script (e.g. `"migrate"`, `"migrate:rollback"`). |
| Verify table names match handlers | Cross-reference every table with handler collection/table names. Document mapping when `collectionToTable` map exists. |
| Apply the migrations | Run migrate command against local database; start documented local DB / emulator. Require **zero errors** + existing tables. |

> ⛔ **DO NOT** create `seeds/`, `seed.ts`, `seed-data.json`, fixtures, or insert demo rows. Leave scaffold-created ones untouched + uninvoked. Schema must stand alone.

> **✅ Checkpoint**:
> - Migration files exist, each non-empty; list directory, verify > 0 bytes.
> - Migrations apply cleanly to local database; tables created, zero errors.
> - Every plan/handler table has constrained `CREATE TABLE`.
> - **No seed/fixture/demo-data files created or run.**

---

## STEP 2: Backend Smoke Test

**Goal**: Prove backend starts + every endpoint registers/responds; catch runtime errors (broken imports, constructor crashes, missing tables) missed by compile-time build.

| Task | Details |
|------|---------|
| Ensure config/env is present | Confirm `.env` / `local.settings.json` has backend values: Step 1 local DB connection string + required service vars. Use scaffold `.env.example` template. **Do not** commit secrets. |
| Build the backend | Run backend build (`npm run build` / `tsc` / `dotnet build` / `python -m py_compile`). Require zero errors. `TS2307` import errors mean broken shared package exports; fix before continuing. |
| Verify the `main`/entry field | Azure Functions Node v4: list `dist/`; confirm `main` glob matches compiled handlers (parent `rootDir` nests output deeper). Fix before host start. |
| Start the backend host | Actually execute artifact run command (e.g. `func start`, `npm start`, `dotnet run`); never skip. |
| Verify all functions register | Read host console. **Every** inventory route must register. `No job functions found` or `ERR_MODULE_NOT_FOUND` means import/build bug; fix + restart. |
| Hit the health endpoint | `GET /api/health` (or artifact health path) → expect `200`, proving app serves. |
| Probe representative endpoints | Exercise at least one endpoint per entity area: `GET` list/read, ideally one write. Require structured response or well-formed validation/`4xx`, **not** `500` from missing table/crashed service. Clean missing-auth/body `4xx` = PASS; `500` = investigate FAIL. |
| Stop the host when done | Stop backend after probes; leave running only for concurrent Step 4 use. |

**Reference**: [smoke-test.md](.github/agents/azure-project-integrate/references/smoke-test.md): per-runtime start commands, host-output reading, pass/fail matrix.

> **✅ Checkpoint**:
> - Backend builds with zero errors; host starts.
> - Every endpoint in the inventory registers.
> - `GET /api/health` → `200`.
> - Probed endpoints return structured responses or clean `4xx`; **no schema/runtime-bug `500`s**.
> - Fix + re-verify every failure; never defer.

---

## STEP 3: Wire the Frontend to LIVE Data

**Goal**: Replace every frontend mock source with real typed calls to Step 2-verified backend. Afterward, **no mock data layer is in use**.

> **Skip** only without frontend.

| Task | Details |
|------|---------|
| Locate the seam | Scaffold provides stable `ApiClient` seam: `src/api/types.ts` (interface), `src/api/mockClient.ts` (mock impl), `src/api/index.ts` (one-line swap). Pages/hooks import only `api` from `src/api/`. Confirm via artifact + scan. |
| Replace local types with shared types | Point `src/api/types.ts` at shared package (e.g. `import type { PublicUser } from '@app/shared'`); delete duplicate frontend entity types. Keep `ApiClient` shape. **No `any` types.** |
| Build the live client | Add `src/api/client.ts`: second method-for-method implementation of **same `ApiClient` interface** (typed `: ApiClient`) against route inventory; env-based base URL. |
| **Swap the seam (one file)** | Point `src/api/index.ts` `api` to live client (`mockClient` → `liveClient`). One line wires every page/hook; **no page or hook edits**. |
| Configure the dev proxy | Point dev server `/api` proxy at backend host (e.g. `http://localhost:7071`) for development live endpoints. |
| Remove the mock layer | Delete `src/api/mockClient.ts`, `src/mocks/*`, and now-shared local types. Any lingering `import … from './mockClient'` or `'../mocks'` = NOT done. |
| **Remove the Mock State Switcher** | Delete scaffold dev-only state switcher: `src/api/previewState.ts`, corner-switcher component, every `previewState` import/usage in mock client, pages, hooks, app shell. Live data only; forced `loading`/`empty`/`error` override must disappear. Any lingering `import … previewState` or rendered Data/Loading/Empty/Error switcher = NOT done. |
| Keep correct file extensions | JSX (`<Component />`) MUST use `.tsx`; pure TS `.ts`. |
| Rebuild the frontend | Run `npm --prefix <frontend> run build` (cwd-independent). Require zero errors, zero `any`. |

> ⚠️ **No mock data may remain in use.** Frontend `src/` search for `mock` / `mockData` / `previewState` must find no live imports. `useState<any>` or untyped responses = NOT done.

> **Reference**: [wire-live-data.md](.github/agents/azure-project-integrate/references/wire-live-data.md): one-file seam swap, typed-client pattern, per-framework dev-proxy config.

> **✅ Checkpoint**:
> - Frontend builds with zero errors + zero `any`.
> - Mock layer (`src/api/mockClient.ts`, `src/mocks/*`) deleted or nowhere imported.
> - Mock State Switcher (`src/api/previewState.ts` + corner switcher component) deleted + nowhere imported.
> - Seam (`src/api/index.ts`) points to live client; pages/hooks untouched.
> - Dev proxy targets backend host.

---

## STEP 4: End-to-End Wire-Up Verification

**Goal**: Run frontend + backend **together**; confirm real wire communication.

| Task | Details |
|------|---------|
| Start the backend | Start listening Step 2 backend host. |
| Start the frontend dev server | Start frontend dev server (`npm --prefix <frontend> run dev`) with backend-targeting dev proxy. |
| Verify a live request path | Confirm successful frontend fetch: dev-server/host logs show real `/api/...` returning `200`, or browser-loaded page renders live rather than mock data. At least one page MUST display data from running backend. |
| Verify a write path (if applicable) | Exercise create/update flow; confirm backend receipt + frontend result. |
| Capture evidence | Record request/response path + status proving frontend → backend wiring. |
| Shut down cleanly | Stop both processes after verification. |

**Reference**: [end-to-end.md](.github/agents/azure-project-integrate/references/end-to-end.md): cross-platform concurrent processes + evidence reading.

> **✅ Checkpoint**:
> - Frontend + backend ran concurrently.
> - At least one real frontend `/api/...` request hit backend, returning `200` + live data (no mock).
> - Evidence captured; both processes stopped cleanly.

---

## STEP 5: Wrap Up

**Goal**: Confirm all four tasks pass; update status; stop.

| Task | Details |
|------|---------|
| Confirm all four checkpoints passed | Migrations applied · backend smoke-tested · frontend live · end-to-end verified. |
| Update the artifact | Mark `.azure/integration-plan.md` items complete, or append short "Integration results": migrations, passing endpoints, removed mock files, end-to-end evidence. |
| Update plan status | Set `.azure/project-plan.md` status to `Integrated`. |
| Print completion | Summarize: migrations created, endpoints verified, mock layer removed, end-to-end request proven. Announce: **"Integration complete!"** |
| **Open the Next Steps view, then stop** | Call `open_scaffold_next_steps_view` with no arguments (`{}`) for post-integration "What's next?" view. Then **STOP**; view owns next hand-off (local development setup or deploy). Do **NOT** ask user what next; do **NOT** call `vscode_askQuestions`. Autopilot exception: **skip** view; hand off via `start_local_development` per agent autopilot rule. |

> **✅ Final Checkpoint**:
> 1. Migrations exist, non-empty, apply cleanly — **no seed data**.
> 2. Backend starts; all endpoints register; `GET /api/health` → 200; probes have no schema/runtime `500`s.
> 3. Frontend builds clean with live data; mock layer removed; no `any`.
> 4. Frontend + backend ran together; real `/api/...` request returned live data.
> 5. `.azure/project-plan.md` = `Integrated`; artifact updated.
> 6. Opened **Next Steps view** (`open_scaffold_next_steps_view`), then stopped — **no follow-up prompt**; autopilot instead hands off to `azure-debug-plan`.

---

## Outputs

| Artifact | Location |
|----------|----------|
| Schema migrations | Project migration directory (e.g. `services/functions/migrations/`) — **schema only, no seeds** |
| Real typed API client | `services/web/src/api/client.ts` + `services/web/src/api/index.ts` seam repoint (or project frontend) |
| Dev proxy config | Frontend dev-server config (e.g. `vite.config.ts`) |
| Updated artifact | `.azure/integration-plan.md` with appended results |
| Plan status | `.azure/project-plan.md` → `Integrated` |
| **Next step** | Open Next Steps view via `open_scaffold_next_steps_view`; autopilot instead hands off to `azure-debug-plan` |

---

## Next

> After integration, announce **"Integration complete!"**, then open post-integration **Next Steps view** via `open_scaffold_next_steps_view` (no arguments). Then **stop**; view drives local-development/deploy hand-off. Do NOT ask user what next; do NOT call `vscode_askQuestions` or print plain-text suggestions. Autopilot exception: **skip** view; hand off via `start_local_development` with `[AUTOPILOT MODE]` marker.
