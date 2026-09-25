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

**North Star:** take a project that *builds* (frontend with mock data + backend) and make it *run, wired together, against a real schema* without losing its approved workload-quality controls. You produce **schema migrations**, prove the **backend smoke-tests clean**, replace **mock data with live API calls**, verify the **Workload Quality Contract**, and confirm the **frontend and backend communicate end-to-end**. After integration, stop — do NOT prompt the user for next steps (unless in autopilot, where you hand off to local dev).

## The five integration tasks (your entire scope)

1. **Migrations** — create the SQL / PostgreSQL schema migrations so the database tables exist. **No seed data.**
2. **Backend smoke test** — start the backend and verify every endpoint registers and responds.
3. **Wire frontend to LIVE data** — replace every mock data source in the frontend with real, typed API calls.
4. **End-to-end wire-up** — run the frontend and backend together and verify they communicate.
5. **Workload quality verification** — run every integration validation recorded in the artifact and append
   evidence/results without claiming WAF compliance.

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
| Read `.azure/integration-plan.md` | The scaffold agent wrote this for you. Extract: backend project path + run command + port; frontend project path + build/dev commands; the API route inventory (method + path); the database type + migration tool + migration directory + connection env vars; the **API seam to swap** (`src/api/index.ts`) + the **mock files to delete** (`src/api/mockClient.ts`, `src/mocks/*`, the dev-only Mock State Switcher `src/api/previewState.ts` + its corner-switcher component); the shared-types/package location; the health endpoint; and the **Workload Quality Contract** (four answers, Application Controls, validations, Deferred Risks). |
| Read quality reference | Read `.github/agents/shared-references/workload-quality.md`. Its safety boundaries and validation rules remain active during the live-data swap. |
| Read `.azure/project-plan.md` | Cross-check routes, services, entities/types, database choice, and Quality Attributes & Tradeoffs. The plan is the source of truth where the artifact is silent. |
| Scan the workspace | Confirm the folders the artifact names actually exist. List the frontend `src/` to locate the API seam (`src/api/` — `index.ts`, `mockClient.ts`) and the mock data (`src/mocks/`). List the backend functions folder to count handlers. List the migration directory. |
| Check database type | If the plan/artifact specifies PostgreSQL or Azure SQL (relational), migrations are **mandatory** (Step 1). If the project uses only non-relational storage (Cosmos, Table, Blob), Step 1's SQL migrations are N/A — note it and skip to Step 2. |

> **✅ Checkpoint**: Artifact loaded (or reconstructed from the plan + scan). You know: the backend run command, the frontend folder + commands, the full route list, the DB type + migration tool + directory, the API seam to repoint (`src/api/index.ts`), the exact mock files to delete, and every application-control validation to run.

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
| Locate the seam | The scaffold left a stable `ApiClient` seam: `src/api/types.ts` (interface), `src/api/mockClient.ts` (mock impl), `src/api/index.ts` (the one-line swap point). Pages/hooks import only `api` from `src/api/`. Confirm this seam exists (artifact + scan). |
| Replace local types with shared types | Point `src/api/types.ts` at the shared package (e.g. `import type { PublicUser } from '@app/shared'`); delete the frontend's duplicated entity types. The `ApiClient` shape is unchanged. **No `any` types.** |
| Build the live client | Add `src/api/client.ts` — a second implementation of the **same `ApiClient` interface** (typed `: ApiClient`), method-for-method against the route inventory, base URL from env. Every request has a finite timeout, preserves/creates a correlation ID, and never automatically retries a non-idempotent write. |
| **Swap the seam (one file)** | Edit `src/api/index.ts` so `api` points at the live client (`mockClient` → `liveClient`). This single line wires every page/hook to live data — **no page or hook edits**. |
| Configure the dev proxy | Point the dev server's `/api` proxy at the backend host (e.g. `http://localhost:7071`) so the frontend reaches live endpoints in development. |
| Remove the mock layer | Delete `src/api/mockClient.ts` and `src/mocks/*` (and local types now sourced from shared). A lingering `import … from './mockClient'` or `'../mocks'` = NOT done. |
| **Remove the Mock State Switcher** | Delete the dev-only state switcher the scaffold added: `src/api/previewState.ts`, its corner-switcher component, and every `previewState` import/usage in the mock client, pages, hooks, and app shell. Live data is the only source now — the forced `loading`/`empty`/`error` override must be gone. A lingering `import … previewState` or a rendered Data/Loading/Empty/Error switcher = NOT done. |
| Keep correct file extensions | JSX (`<Component />`) MUST be `.tsx`; pure TS `.ts`. |
| Rebuild the frontend | Run `npm --prefix <frontend> run build` (cwd-independent). Zero errors, zero `any`. |

> ⚠️ **No mock data may remain in use.** Frontend `src/` search for `mock` / `mockData` / `previewState` must find no live imports. `useState<any>` or untyped responses = NOT done.

> **Reference**: [wire-live-data.md](.github/agents/azure-project-integrate/references/wire-live-data.md): one-file seam swap, typed-client pattern, per-framework dev-proxy config.

> **✅ Checkpoint**:
> - Frontend builds with zero errors and zero `any`.
> - The mock layer (`src/api/mockClient.ts`, `src/mocks/*`) is deleted or no longer imported anywhere.
> - The Mock State Switcher (`src/api/previewState.ts` + corner switcher component) is deleted and no longer imported anywhere.
> - The seam (`src/api/index.ts`) points at the live client; pages/hooks were not edited.
> - The dev proxy targets the backend host.
> - Live requests preserve finite timeouts, correlation, authorization, payload bounds, and safe retry/idempotency behavior from the Workload Quality Contract.

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

## STEP 5: Workload Quality Contract Verification

**Goal**: prove that replacing emulators/mocks with live local services did not erase the controls the user
approved.

1. Read every row in `.azure/integration-plan.md` under `## Workload Quality Contract` →
   `### Application Controls`.
2. Confirm its evidence path/symbol still exists after integration.
3. Run the exact `Integration Validation` command or probe. If a validation is missing, non-executable, or
   only says "implemented", add a focused validation using the project's existing test runner.
4. Verify at minimum:
   - Enhancement failure degrades; Essential failure returns a structured error.
   - Outbound operations have finite timeouts; retries are bounded and exclude non-idempotent writes.
   - Authorization/validation match API Login and Data Classification.
   - Representative sensitive values do not appear in captured logs.
   - Correlation ID, pagination/payload bounds, and traffic-profile controls survive the live client.
5. Verify the `### Dependency Access` rows against the live client you just wired. For each dependency, the
   operation named in the row must be the operation the code now calls — including its health probe — and it
   must be one the named permission authorizes. Locally every client holds a connection string, which carries
   every permission, so this is the one control a passing local run cannot confirm on its own: a probe that
   calls an ARM `action` while the deployed identity holds only a data role passes here and 403s after
   provisioning. Correct the row or the call so they agree, and leave the permission unchanged.
6. Fix failures within application/integration scope and re-run. Preserve architecture, compliance, RTO/RPO,
   and other deployment-owned gaps under `Deferred Risks`; do not fabricate evidence.
7. Append `### Integration Results` with one `PASS | FAIL | DEFERRED` row per control ID, the command/probe
   run, and concise evidence. Never write `WAF compliant`, `WAF certified`, or `100% WAF aligned`.

> **✅ Checkpoint**: Every listed control has real evidence and a result. Every dependency's operation and
> permission agree. No failed application control is silently carried forward; deployment-owned risks remain
> explicit.

---

## STEP 6: Wrap Up

**Goal**: Confirm all five tasks pass, update status, and stop.

| Task | Details |
|------|---------|
| Confirm all five checkpoints passed | Migrations applied · backend smoke-tested · frontend on live data · end-to-end verified · workload-quality controls verified. |
| Update the artifact | Mark `.azure/integration-plan.md` items complete and append integration results: what was migrated, which endpoints passed, mock files removed, end-to-end evidence, and one quality-control result per ID. |
| Update plan status | Set `.azure/project-plan.md` status to `Integrated`. |
| Print completion | Summarize: migrations created, endpoints verified, mock layer removed, end-to-end request proven. Announce: **"Integration complete!"** |
| **Open the Next Steps view, then stop** | Call `open_scaffold_next_steps_view` with no arguments (`{}`) for post-integration "What's next?" view. Then **STOP**; view owns next hand-off (local development setup or deploy). Do **NOT** ask user what next; do **NOT** call `vscode_askQuestions`. Autopilot exception: **skip** view; hand off via `start_local_development` per agent autopilot rule. |

> **✅ Final Checkpoint**:
> 1. Migrations exist, are non-empty, apply cleanly — **no seed data**.
> 2. Backend host starts, all endpoints register, `GET /api/health` → 200, probes return no schema/runtime `500`s.
> 3. Frontend builds clean on live data; mock layer removed; no `any`.
> 4. Frontend + backend ran together; a real `/api/...` request returned live data.
> 5. Every workload-quality control has a `PASS`, `FAIL`, or deployment-owned `DEFERRED` result with evidence; no false compliance claim.
> 6. `.azure/project-plan.md` = `Integrated`; artifact updated.
> 7. Opened the **Next Steps view** (the `open_scaffold_next_steps_view` tool), then stopped — **no follow-up prompt** (autopilot instead hands off to `azure-debug-plan`).

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
