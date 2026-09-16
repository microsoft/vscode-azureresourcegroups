# Backend Smoke Test

> Read at **Step 2**. How to start the backend and prove every endpoint registers and responds.

---

## Per-runtime start command

| Runtime | Build | Start host | Default port |
|---------|-------|-----------|--------------|
| Azure Functions (Node v4 / TS) | `npm run build` | `func start` | 7071 |
| Azure Functions (Python v2) | `python -m py_compile` (or build) | `func start` | 7071 |
| Azure Functions (.NET isolated) | `dotnet build` | `func start` (or `dotnet run`) | 7071 |
| Plain Node API | `npm run build` | `npm start` | project-defined |

Run the exact command the artifact (`.azure/integration-plan.md`) documents — it reflects the real project.

---

## Before starting: config & build

- Ensure `.env` / `local.settings.json` has the values the host needs — especially the **DB connection string** pointing at the local database from Step 1. Use `.env.example` as the template. Never commit secrets.
- Build first. Zero errors. `TS2307: Cannot find module '@app/shared'` → the shared package exports/build are broken; fix before starting.
- For Functions Node v4: list `dist/` and confirm the `main` glob matches the compiled handler paths. A parent `rootDir` nests output one level deeper (`dist/functions/src/functions/*.js`). Fix `main` before starting or no functions register.

---

## Reading host output (pass/fail)

| Console signal | Meaning | Action |
|----------------|---------|--------|
| Each function name listed under "Functions:" | Registered | PASS |
| `No job functions found.` | Build/`main` mismatch | Fix `main`/build, restart |
| `ERR_MODULE_NOT_FOUND` / broken import | Bad import or missing dist | Fix import/build, restart |
| Constructor throws on startup | A service (often Enhancement) throws in its constructor | Defer config validation out of the constructor / wrap in try-catch, restart |

---

## Probing endpoints

| Probe | Expected | Verdict |
|-------|----------|---------|
| `GET /api/health` | `200` with status body | PASS (required) |
| `GET` a list/read endpoint | `200` with array/object, or clean `401/400` | PASS |
| A write endpoint with missing/invalid body | `400`/`401` structured error | PASS (validation working) |
| Any endpoint returning `500` | Schema missing, service crash, unhandled error | **FAIL — investigate & fix** |

A clean `4xx` (missing auth, invalid body) is a **PASS** — it proves validation and routing work. A `500` is a **FAIL**: most often a missing table (revisit Step 1) or a service constructor crash.

Use `curl`/`Invoke-RestMethod` or the browser tool to hit endpoints. Stop the host when probing is done (unless Step 4 will reuse it).
