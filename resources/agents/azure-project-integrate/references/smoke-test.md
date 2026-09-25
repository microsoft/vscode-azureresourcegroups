# Backend Smoke Test

> Read at **Step 2**. Start backend; prove every endpoint registers + responds.

---

## Per-runtime start command

| Runtime | Build | Start host | Default port |
|---------|-------|-----------|--------------|
| Azure Functions (Node v4 / TS) | `npm run build` | `func start` | 7071 |
| Azure Functions (Python v2) | `python -m py_compile` (or build) | `func start` | 7071 |
| Azure Functions (.NET isolated) | `dotnet build` | `func start` (or `dotnet run`) | 7071 |
| Plain Node API | `npm run build` | `npm start` | project-defined |

Run exact artifact (`.azure/integration-plan.md`) command; it reflects real project.

---

## Before starting: config & build

- Ensure `.env` / `local.settings.json` contains host values, especially **DB connection string** targeting Step 1 local database. Use `.env.example` template. Never commit secrets.
- Build first; zero errors. `TS2307: Cannot find module '@app/shared'` means broken shared package exports/build; fix before start.
- Functions Node v4: list `dist/`; confirm `main` glob matches compiled handler paths. Parent `rootDir` nests output deeper (`dist/functions/src/functions/*.js`). Fix `main` before start or no functions register.

---

## Reading host output (pass/fail)

| Console signal | Meaning | Action |
|----------------|---------|--------|
| Each function name under "Functions:" | Registered | PASS |
| `No job functions found.` | Build/`main` mismatch | Fix `main`/build, restart |
| `ERR_MODULE_NOT_FOUND` / broken import | Bad import or missing dist | Fix import/build, restart |
| Constructor throws on startup | Service (often Enhancement) constructor throws | Move config validation from constructor / wrap in try-catch, restart |

---

## Probing endpoints

| Probe | Expected | Verdict |
|-------|----------|---------|
| `GET /api/health` | `200` + status body | PASS (required) |
| `GET` list/read endpoint | `200` + array/object, or clean `401/400` | PASS |
| Write endpoint with missing/invalid body | `400`/`401` structured error | PASS (validation works) |
| Any endpoint returning `500` | Missing schema, service crash, unhandled error | **FAIL — investigate & fix** |

Clean `4xx` (missing auth, invalid body) is **PASS**: validation + routing work. `500` is **FAIL**, usually missing table (revisit Step 1) or service constructor crash.

Hit endpoints via `curl`/`Invoke-RestMethod` or browser tool. Stop host after probes unless Step 4 reuses it.
