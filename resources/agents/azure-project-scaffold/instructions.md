---
name: azure-project-scaffold
description: "Scaffold the frontend preview, backend services, database, API routes, and wire frontend for an Azure-centric project following an approved project plan. Generates the frontend preview via a dedicated sub-agent running in parallel with the backend sub-agents, auto-opens the live preview in the browser, then wires the frontend to the real backend. Suggests verification and local dev setup as follow-ups. WHEN: \"scaffold backend\", \"build services\", \"execute plan\", \"scaffold project\", \"create backend\", \"implement plan\", \"build backend\", \"scaffold services\", \"wire frontend\", \"create API\", \"scaffold API\", \"preview frontend\"."
license: MIT
metadata:
  author: Microsoft
  version: "3.0.0"
---

# Azure Project Scaffold

> **AUTHORITATIVE — MANDATORY.** Canonical source for scaffolding Azure-centric backends from approved plans. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

**North Star:** produce a working, buildable, runnable Azure backend fast from the approved plan. If the plan has a frontend, generate a standalone auto-authenticated mock preview via a dedicated **Frontend Preview sub-agent that runs in parallel with the backend sub-agents** (user lands on main content, not login); once it returns, the orchestrator auto-opens the live preview in the browser. After scaffolding, suggest verification and local dev setup.

## Triggers
Execute approved plan; scaffold backend services; build API routes + service layer; preview frontend; wire frontend to real backend types; continue after `azure-project-plan`.

## ❌ Do NOT activate — route instead
| User intent | Correct skill |
|-------------|---------------|
| Plan / gather requirements | **azure-project-plan** |
| Docker Compose, emulators, VS Code F5 | **azure-localdev** |
| Add test coverage | **azure-project-test** |
| Deploy to Azure / generate Bicep/Terraform | **azure-prepare** |
| Benchmark scaffold quality | **scaffold-benchmark** |

## Prerequisites
Requires an approved plan (`azure-project-plan` runs first). Verify before starting:
- `.azure/project-plan.md` exists
- Status = `Approved` (not `Planning`)
- Section 7 lists API routes; Section 4 lists Azure services

> If `.azure/project-plan.md` is missing or status ≠ `Approved`: **STOP** — tell the user _"No approved project plan found. Run `azure-project-plan` first."_

## Rules

> **16 core rules** govern every scaffold. Rule 0 is the load-bearing UX rule — visible feedback first. Rules 1–15 govern correctness. Details in referenced docs, consumed at relevant step.

> **📁 Paths are examples, not assumptions.** Every directory shown in these instructions (`services/web/`, `services/functions/`, `services/shared/`, `services/functions/src/utils/`, …) is an **illustrative default for a fresh project**. When the workspace already has a structure, follow it. Read the actual layout first and map these roles (frontend folder, Functions project, shared types, etc.) onto the user's real folders — never assume or impose a specific path. The plan's Project Structure section, when present, is the source of truth for where things go. **If the plan names the deployable apps after the product** (e.g. `services/office-compliance-api`, `services/office-compliance-portal`), honor those names exactly — including in `workspaces`, `cd` commands, imports, and the computed `main`/`rootDir` (`dist/<project>-api/src/functions/*.js`). The shared package stays generic (`services/shared`).

0. **Frontend-first feedback (load-bearing UX rule)** — If the plan includes a frontend, the orchestrator launches the **Frontend Preview Sub-Agent** (Step 1) at the same point it kicks off the backend track, so frontend generation runs **concurrently** with backend Phase A/B rather than blocking it. The sub-agent generates `services/web/` (mock data, pages, components) and reports back; **the orchestrator then starts the dev server and opens the VS Code Simple Browser** so the persistent process is owned by the main session, not a stateless sub-agent. Visible feedback (the live preview) is the user's signal that work is progressing — get the Frontend sub-agent running first so that signal arrives promptly. **The preview is shown for visibility only — do NOT ask the user to approve the UX during scaffolding.** The user already approved the design during planning (the `.azure/.preview-temp/` mock-up). The Simple Browser preview stays open the entire time so the user can watch the real app come together as Step 12 wires it up. If the plan has no frontend, this rule is satisfied trivially. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md).
1. **Plan is source of truth** — Read `.azure/project-plan.md` at start. Follow route definitions, service list, types, architecture exactly. Do NOT re-ask user for plan requirements.
2. **Track progress** — Copy Section 8 (Execution Checklist) from plan into `.azure/execution-checklist.md`. Mark `[ ]` → `[x]` as each step completes — do NOT defer. Plan stays clean as reference; checklist is live tracker. Update plan status: Approved → In Progress → Scaffolded → Ready. Step 13 MUST verify all items checked. If >50% unchecked despite completion, finalization NOT complete.
3. **Build-gate enforcement** — Every phase ends with build check (`tsc` / `npm run build`). If fails, iterate until clean. **Do NOT proceed until code compiles.** Most important rule.
4. **Azure Functions v4** — Always v4 programming model (Node.js v4, Python v2, .NET isolated). Prioritize Azure services. Runtimes: TypeScript, Python, C#.
5. **Service abstraction & DI** — All Azure SDK calls behind injectable interfaces. Handlers NEVER import SDKs directly. **CRITICAL: Step 4 MUST produce interface AND concrete implementation per service.** Interface-only = #1 cause of runtime crashes. Concrete impl is what `func start` uses. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
6. **Modular, one function per file** — Each Function own file. Each service own module. Extract shared utilities to `services/functions/src/utils/` — no duplication, no unused stubs. Prefix unused params with `_`. **DRY**: Same helper in 2+ files → extract to `services/functions/src/utils/` and import. **Proactive**: Before writing handlers, identify common patterns (password hashing, entity sanitization, response formatting) and pre-create shared utils. See [architecture.md](.github/agents/shared-references/architecture.md).
7. **Environment-driven config** — Connection strings switch local/Azure via env vars. Validate required vars on startup, fail fast. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
8. **Input validation & standardized errors** — Every endpoint has validation schema (Zod/Pydantic/FluentValidation). Every route returns `{ error: { code, message, details? } }`. Error codes typed union, not strings. See [error-handling.md](.github/agents/shared-references/error-handling.md).
9. **Resilience classification** — Follow plan's Essential/Enhancement classification. Enhancement services wrapped in try/catch with fallback. **Enhancement constructors MUST NOT throw** — defer config validation to method calls or wrap in try/catch in registry. Constructor throws crash ALL handlers via `getServices()`. See [resilience.md](.github/agents/shared-references/resilience.md).
10. **Database integrity** — Migrations MUST include UNIQUE, FK (ON DELETE), CHECK, INDEX constraints. Multi-table writes MUST use transactions. Collection-to-table mappings documented and verified. See [database-integrity.md](.github/agents/shared-references/database-integrity.md).
11. **Wire frontend to real types** — If frontend preview generated, replace mock types with shared package imports, replace mock API client with real typed client, verify frontend builds. No `any` types.
12. **Mandatory `func start` smoke test** — After all handlers implemented, execute `func start`, verify all functions register, stop. Catches blocking runtime errors (broken imports, constructor crashes) that mocked tests miss. **Do NOT skip.** See [architecture.md](.github/agents/shared-references/architecture.md).
13. **Auto-initialization** — Registry `getServices()` MUST auto-initialize with concrete implementations when nothing pre-registered. Verified by `func start`. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
14. **Cross-workspace build safety** — When Functions imports `../shared/`, set `rootDir` to `".."` and **compute `main` field from actual `dist/` output after `tsc`** — never hardcode. With `rootDir: ".."`, handlers compile to `dist/functions/src/functions/X.js`. After build, list `dist/`, verify `main` matches. Run `func start` to confirm. **#1 cause of "build passes but app won't start"**. See [architecture.md](.github/agents/shared-references/architecture.md).
15. **Frontend quality contract** — If the plan has a frontend, **Section 5 (Design System & UI) of the plan is load-bearing**. Treat each region token in Section 5's Pages table (`header`, `hero`, `grid`, `form`, ...) as layout **intent** — render it using real primitives from the library named in `Component Library:`, themed by the Color Palette. **Reproduce the records from Section 5's Sample Content block** — the scaffolded page MUST show the same entities, names, values, and states the planning preview showed (the preview and the scaffold share this one content contract, so they stay in parity). Seed your mock data from Sample Content, then extend it. **Never produce raw `<div className="card">` placeholders that just mimic the wireframe** — but bespoke, domain-specific components (polaroid frames, ticket stubs, gallery tiles, chat bubbles) that wrap a real library primitive and carry real content + imagery are encouraged, not banned. **Every media-bearing entity MUST render a real image from the mock data, never an empty tinted surface or solid-color block.** **The HTML preview at `.azure/.preview-temp/*.html` is a directional sketch — the scaffolded app MUST visibly exceed it.** If a generated page looks like a re-skin of the static HTML sketch (same flat surfaces, no real icons, no motion, no dark mode, no polished hero, no library elevation), you have failed the bar — go back and apply the Polish floor before claiming the page is complete. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library region-token → primitive mapping, theming contract, icon contract, state-coverage contract, **Polish floor**, and **Polish self-review checklist**. If Section 5 is missing or `Component Library:` is blank, STOP — re-run `azure-project-plan`.

---

## 📦 Context Management — read this first

> Do NOT read all reference files upfront (~250KB total) — it wastes context needed for code, test output, and fixes. Read lazily: only when a step needs them.

### Step-to-Reference Mapping

| Step | Read ONLY these files | Skip |
|------|----------------------|------|
| **Step 0** (Read Plan) | `.azure/project-plan.md` | All reference files |
| **Step 1** (Frontend Preview) | `references/frontend-patterns.md`, `references/frontend-preview-steps.md`, `references/frontend-quality-bar.md` | All other reference files |
| **Sub-Agent Strategy** | `references/sub-agent-strategy.md` | |
| **Step 2** (Foundation) | `../shared-references/architecture.md` | |
| **Step 3** (Config) | `../shared-references/service-abstraction.md` — read only the Config Module section | |
| **Step 4** (Services) | `../shared-references/service-abstraction.md` (full), selected runtime file | |
| **Step 5** (Migrations) | `../shared-references/database-integrity.md`, `../shared-references/seed-data.md` | |
| **Step 6** (Types/Validation) | `../shared-references/error-handling.md` — read only the Error Code Type Safety section | |
| **Step 7** (Routes) | `../shared-references/resilience.md`, selected runtime file | |
| **Step 8** (Errors) | `../shared-references/error-handling.md` (full) | |
| **Step 9–11** (Health/OpenAPI/Logging) | _(instructions are in SKILL.md)_ | |
| **Step 12** (Wire Frontend) | _(instructions are in SKILL.md — uses shared types from Step 6; if Section 5 'Design System & UI' is present, re-read `references/frontend-quality-bar.md`)_ | |
| **Step 13** (Wrap Up) | _(instructions are in SKILL.md)_ | |

### Runtime-Specific Files — Load ONLY ONE

Select based on the **backend service's Language** (its stack section, e.g. `## 2. Backend`) — not the `Runtime` row (Node / Bun / etc.). When the frontend is a different language than the backend, load the runtime reference for each language a service uses.

| Selected Language | Orchestration | Load | Do NOT load |
|-------------------|---------------|------|-------------|
| TypeScript | docker-compose | `../shared-references/runtimes/typescript.md` | `python.md`, `dotnet.md` |
| Python | docker-compose | `../shared-references/runtimes/python.md` | `typescript.md`, `dotnet.md` |
| C# (.NET) | docker-compose / Functions | `../shared-references/runtimes/dotnet.md` | `typescript.md`, `python.md` |

### Context Release

> After step checkpoint passes, that step's reference no longer needed. Under context pressure, prioritize current step reference + project source over completed step references.

---

## 🔁 Cross-platform command discipline — read once, apply everywhere

> **Every shell command in this skill MUST work on Windows (PowerShell + cmd) AND macOS / Linux (bash / zsh) unchanged.** Each `run_in_terminal` call lands in a fresh shell whose default differs by OS — assume nothing.

| ❌ Non-portable pattern | ✅ Portable replacement |
|------------------------|------------------------|
| `cd services/web && npx vite build` | `run_in_terminal` with `cwd: "services/web"` and command `npx vite build`. If no `cwd` param, use `npm --prefix services/web run build` (or `npm --prefix services/web exec -- vite build`). |
| `mkdir -p services/web/src/components` | `node -e "require('fs').mkdirSync('services/web/src/components', {recursive: true})"` |
| `rm -rf .azure/.preview-temp` | `node -e "require('fs').rmSync('.azure/.preview-temp', {recursive: true, force: true})"` |
| `cp -r services/shared/types services/web/src/types` | `node -e "require('fs').cpSync('services/shared/types', 'services/web/src/types', {recursive: true})"` |
| `touch .env` | `node -e "require('fs').closeSync(require('fs').openSync('.env', 'a'))"` or just write the file via the file-creation tool. |
| `cat .env >> .env.local` | Read with the file-read tool, write with the file-write tool. |
| `export FOO=bar` followed by another call | Pass via the command line on the same call: `npx cross-env FOO=bar npm run build` (or set in `.env`). PowerShell uses `$env:FOO`, bash uses `export FOO` — they don't share. |
| `ls`, `pwd`, `which X` | Don't invoke shell utilities. Use the workspace tools (`list_dir`, etc.) for read-only inspection. |

**Cardinal rules:**

1. **Prefer the tool's `cwd` parameter** over `cd X && …` chains. `cd` doesn't survive across `run_in_terminal` calls and isn't equally portable.
2. **For Node-based operations**, prefer `node -e "…"` — Node is already a dependency of any frontend scaffold and is on PATH for backend scaffolds too.
3. **For npm operations in subfolders**, prefer `npm --prefix <folder> run <script>` over chained `cd`.
4. **Never use `&&` or `||` or `;` with shell built-ins** (`cd`, `export`, `set`) — those built-ins behave differently between PowerShell and POSIX shells. Multiple commands joined with `&&` are fine if every command is a real binary (`node`, `npm`, `npx`, `func`).
5. **Path separators**: use forward slashes (`/`) in all command-line paths — both Node and modern Windows tooling accept them; backslashes break in bash and break inside JSON strings in `node -e`.

If you find yourself writing a command that wouldn't run on the other OS, stop and rewrite it using one of the portable patterns above.

---

## STEP 0: Read Plan & Validate — MANDATORY FIRST ACTION

**BEFORE starting execution**, read and validate plan:

| Task | Details |
|------|---------|
| Read `.azure/project-plan.md` | Load complete plan |
| Validate status | Must be `Approved`. If not, STOP — instruct user to run `azure-project-plan`. |
| Extract plan details | Routes, services, entity types, language, runtime, framework, and **orchestration** for each service's stack section (`## 2. Backend`, `## 3. Frontend`, …), structure |
| Extract design contract (if frontend) | If a frontend is planned, read Section 5 (Design System & UI). Extract `Component Library:`, `Style Direction:`, `Typography:`, the Color Palette table, and the Pages table (page → layout regions). **If Section 5 is missing or `Component Library:` is blank, STOP — instruct user to re-run `azure-project-plan`. Section 5 is load-bearing for Rule 15 / Step 1 quality bar.** |
| Read the approved HTML preview (if frontend) | List `.azure/.preview-temp/` if it exists. Read `manifest.json` to get the page list, then read each `<slug>.html` plus `theme.css`. **Treat these files as the visual mock-up that the user already approved during planning.** They are the source of truth for layout, palette translation, and per-page region composition. The scaffolded app must reproduce this look using the framework + library named in the Frontend stack section / Section 5 — NOT by serving the preview HTML itself. If `.azure/.preview-temp/` is missing for a plan that has a frontend, do not fail — just rely on Section 5 alone. |
| Determine frontend needed | Check if plan includes frontend (SPA + API, Full-stack SSR, Static + API). If yes, Step 1 generates preview. |
| Copy execution checklist | Copy Section 8 into `.azure/execution-checklist.md` |
| Update plan status | Set to `In Progress` |

> **✅ Checkpoint**: Plan loaded, status valid, checklist created, status `In Progress`. If frontend planned, `.azure/.preview-temp/` contents loaded into context as visual reference.

---

## Execution Steps

> **Execution chronology** (frontend-first, backend in parallel):
>
> ```
> t=0      Step 0     read plan, validate
> t=10s    Step 1     frontend preview SUB-AGENT    ─┐
> t=10s    Phase A    contracts (sequential)        ─┼─ concurrent
> t=10s    Phase B    backend SUB-AGENT             ─┘
> t=~      (orchestrator) start dev server + open Simple Browser when Frontend sub-agent returns
> t=Nm     Step 12    sync gate: preview ready AND Phase B done → wire frontend
> t=...    Step 13    wrap up                          (sequential)
> ```
>
> The chronology is load-bearing. **Launch the Frontend Preview sub-agent and the backend track together** right after Step 0 so they run in parallel. The orchestrator owns the persistent dev server: once the Frontend sub-agent returns, start the server and open Simple Browser. **Never** wire the frontend before backend is built. For API-only projects (no frontend), Step 1 is skipped and Phase A/B begin immediately after Step 0.

### Step 1: Frontend Preview (If Applicable)

> **Skip** if plan has no frontend ("API only" or "Background worker").

> **Run as a sub-agent (parallel with backend).** The orchestrator delegates frontend generation (sub-steps **F1–F3**) to a dedicated **Frontend Preview Sub-Agent** so it runs concurrently with backend Phase A/B. The sub-agent is stateless and returns a single report — so it must NOT start or own the long-running dev server. **F4 (build the dev server + open Simple Browser) is performed by the orchestrator after the sub-agent returns**, because the persistent process must be owned by the main session. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md) for the sub-agent brief and hand-back contract.

**Goal**: Standalone frontend with mock data for user to see/interact with before backend work. **Preview MUST be auto-authenticated** — if app has auth, seed mock auth state so user lands on main view (dashboard, feed), NOT login page. **Auto-open in browser** — do NOT prompt.

> ⚠️ **WORKING DIRECTORY (most-common scaffold failure)**: Every frontend command — `npm install`, `npx vite build`, `npx vite --host`, `npm run dev` — MUST run against the **frontend folder** (typically `services/web/`), never the workspace root. **Prefer the working-directory-independent form `npm --prefix services/web run <script>`** (e.g. `npm --prefix services/web run dev -- --host` to show the UI) — `--prefix` loads the frontend's `package.json` no matter where the shell starts, so it can't accidentally launch from the root. When using a binary directly (e.g. `npx vite --host` with no `dev` script), pass `cwd: "services/web"` on the same terminal call. Running from the workspace root produces a blank white page even though the dev server still binds to a port and prints `ready in N ms`. **Never claim the preview is live until you have fetched the page and confirmed it serves your app** — see the verification gate in [frontend-preview-steps.md F4](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md).

**References**:
- [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library region-token → primitive mapping, theming contract, icon contract, and state-coverage contract. **READ THIS FIRST — it is the contract between the plan's Section 5 and the JSX you ship.**
- [frontend-patterns.md](.github/agents/azure-project-scaffold/references/frontend-patterns.md) for patterns and quality bar.
- [frontend-preview-steps.md](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md) for sub-steps (F1–F4), working directory rules, approval loop.

> **✅ Checkpoint**:
> 1. Frontend builds zero errors (`npm --prefix services/web run build` — cwd-independent; **never** a bare `npx vite build` from the workspace root)
> 2. No `any` types in `.ts`/`.tsx`
> 3. Auto-authenticated — user lands on main content on first load
> 4. Dev server started with the cwd-independent form (`npm --prefix services/web run dev -- --host`, or `npx vite --host` with `cwd: services/web/`) **and verified to serve actual app content** (not just "ready in N ms" — page must render). Preview opened in VS Code Simple Browser.
> 5. **No UX approval prompt** — the design was already approved during planning via `.azure/.preview-temp/`. Show the live dev server in Simple Browser and move on; do NOT call `ask_user` for "do you approve this UI?".
> 6. **Quality bar (Rule 15)**: Every page imports primitives from the library named in plan Section 5's `Component Library:`; the app shell is wrapped in that library's theme provider with a brand ramp derived from Section 5's palette; every icon is a real library icon (no emoji, no SVG placeholders); every `form` region has a visible validation state; every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle. **Use the approved HTML mock-up at `.azure/.preview-temp/<slug>.html` as the layout/visual reference per page** — reproduce the same regions and tonal feel using the real library primitives, not by embedding the HTML. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md).

---

### Sub-Agent Strategy for Backend Scaffolding

**Reference**: Read [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md) for execution model, Frontend/Phase A/Phase B details, coordination rules.

> Sub-agents parallelize work. The **Frontend Preview sub-agent** (Step 1, F1–F3) and the backend track launch together right after Step 0. Phase A (Contracts) is sequential/blocking; Phase B (Backend) launches when Phase A completes. The Frontend sub-agent runs concurrently with both.

> **Synchronization gate**: Step 12 MUST wait for BOTH: (a) frontend preview ready (sub-agent returned and orchestrator opened Simple Browser) AND (b) Phase B completed.

### Step 2: Foundation

**Goal**: Project skeleton compiles/builds with zero errors.

| Task | Details |
|------|---------|
| Initialize project | `package.json` + `tsconfig.json` (Node.js) / `pyproject.toml` (Python) / `*.csproj` + `*.sln` (.NET) |
| Configure linter/formatter | ESLint + Prettier (Node.js) / Ruff (Python) / dotnet format (.NET) |
| Create `.gitignore` | Runtime-appropriate ignores (node_modules, .env, data/, etc.) |
| Create directory structure | `services/functions/`, `services/functions/src/utils/`, `services/shared/` (do NOT create `services/web/` — may exist from frontend preview) |

**Reference**: [architecture.md](.github/agents/shared-references/architecture.md)

> **✅ Checkpoint**:
> 1. **Build gate**: `npm run build` / `python -m py_compile` / `dotnet build`. Zero errors.
> 2. **Workspace build scripts**: If monorepo, verify every workspace has `build` script. Run in each. If produces `dist/`, verify non-empty.
> 3. **Shared package**: If `services/shared/` exists, verify: (a) `package.json` has `"exports"` or `"main"` pointing to compiled output, (b) `npm run build` produces `dist/` with `.js` and `.d.ts`, (c) other workspaces import without errors.
> 4. **Cross-workspace imports (CRITICAL)**: Run `tsc --noEmit` in every workspace importing shared. If `TS2307: Cannot find module` → exports broken. **Fix before proceeding.**
> 5. **rootDir and main field (CRITICAL)**: After `tsc`, **list actual dist/ contents**, verify `main` glob matches compiled handlers. If `rootDir: ".."`, output nests deeper. Fix `main`. Run `func start` briefly to confirm functions register.
> 6. All pass → check off in `.azure/execution-checklist.md`.
> ⚠️ **Pitfalls**: (1) Shared packages without build → `ERR_MODULE_NOT_FOUND`. (2) Wildcard exports fail TS resolution. (3) `rootDir: "."` blocks cross-workspace imports — use `".."` and update `main`.

---

### Step 3: Configuration & Environment

**Goal**: Config module that loads env vars with validation and safe defaults.

| Task | Details |
|------|---------|
| Create `config` module | `services/config.ts` / `services/config.py` / `Services/Config.cs` |
| Create `.env.example` | All required env vars with placeholders and comments |
| Create `local.settings.json` | Azure Functions local settings with emulator defaults |
| Implement env validation | On startup, check required vars set. Fail fast with clear error listing missing. |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md)

> **✅ Checkpoint**: Config module loads env vars. `.env.example` documents all variables.

---

### Step 4: Service Abstraction Layer

**Goal**: One module per Azure service, with injectable interfaces and concrete implementations.

> ⚠️ **CRITICAL — DO NOT SKIP CONCRETE IMPLEMENTATIONS**
>
> MUST produce **two files per service**: interface and concrete implementation. Interface-only scaffolding is #1 cause of runtime failures. `func start` crashes because registry has nothing to auto-initialize. **Every interface MUST have corresponding concrete implementation before checkpoint.**

| Task | Details |
|------|---------|
| Create service interface/protocol | Define contract (TS interface / Python Protocol / C# interface). **Document auto-managed fields** (e.g., `updated_at`, `created_at`, `id`) in comments. **IDatabaseService MUST include `transaction()` method** for atomic multi-table writes. |
| Create concrete implementation | Implements interface with Azure SDK. **MUST strip auto-managed fields** from caller data in `update()` and `create()` before building queries. **Transaction MUST use BEGIN/COMMIT/ROLLBACK.** |
| Create service factory/registry | Factory/DI that returns real impl from config. **`getServices()` MUST auto-initialize with concrete implementations when nothing pre-registered** — calling without prior `registerServices()` MUST construct instances from config, NOT throw. **MUST use correct import style** — ESM uses static imports or `await import()`, NOT `require()`. **Enhancement construction wrapped in try/catch** (Rule 9). |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md)

> **📋 File Verification** — Before checkpoint, verify on disk:
>
> For EACH service in plan:
> - [ ] `src/services/interfaces/I{Service}Service.ts` — interface
> - [ ] `src/services/{service}.ts` — **concrete implementation** (imports SDK, implements interface)
>
> Additionally:
> - [ ] `src/services/registry.ts` — `initializeServices()` constructs concrete instances
> - [ ] `getServices()` calls `initializeServices()` when `services === null` (lazy auto-init)
>
> **If any concrete implementation missing, DO NOT proceed.** `func start` will fail.

> **✅ Checkpoint**: All interfaces, concrete implementations, and registry exist. `getServices()` auto-initializes. `tsc` zero errors.

---

### Step 5: Database Schema & Migrations

**Goal**: Repeatable schema management and seed data with constraints.

> ⛛ **MANDATORY for relational databases.** If plan includes PostgreSQL, Azure SQL, or any relational DB, NOT optional. Empty `seeds/` directory = scaffold failure — tables don't exist, every handler fails with `relation "X" does not exist`. Mocked tests can't catch this.
>
> ⛛ **BLOCKING DEPENDENCY**: Step 5 can't complete until Step 7 (API Routes) planned. Migration schema must match handler data access patterns. If Step 7 reveals schema changes, return and update.
>
> ⛛ **MIGRATION FILES MUST CONTAIN CODE.** Empty migration files do NOT satisfy this step. Each MUST contain complete `up()` with `CREATE TABLE` (all columns, types, constraints, indexes from plan) and `down()` reversing changes. **After creating, list directory and verify non-zero size.** Empty files = NOT complete.
>
> ⛛ **SEED DATA MUST BE GENERATED.** `seeds/fixtures/seed-data.json` and `seeds/seed.ts` (or equivalent) MUST be created with realistic data. Enables demo-ability and integration testing baseline.

| Task | Details |
|------|---------|
| Create migration scripts | Knex (Node.js) / Alembic (Python) / EF Core (C#) |
| Add database constraints | UNIQUE on business-unique fields, FK with ON DELETE, CHECK for enums, indexes on queried columns |
| Create seed data scripts | Realistic fixtures in JSON + seed script |
| Create migration runner | Script/function to run migrations forward/backward |
| Verify table names match handlers | Cross-reference every table in migration against handler collection names via `collectionToTable` mapping. Document mapping in plan. |

> **✅ Checkpoint**:
> - Migration files exist and non-empty (check count > 0)
> - **List migration files, verify each > 0 bytes.** If directory empty or files empty, **STOP — create migrations with full `CREATE TABLE` before continuing.**
> - **Seed data files exist.** `seeds/fixtures/seed-data.json` with valid JSON. `seeds/seed.ts` with idempotent script. If missing, create before proceeding.
> - **File existence**: Every plan table has corresponding migration.
> - **Migration count**: Should match plan's schema section.
> - Seed data exists. Table names match collection-to-table mapping.
> - All pass → proceed

---

### Step 6: Shared Types & Validation Schemas

**Goal**: Type-safe contracts between frontend and backend, with validation covering every endpoint.

| Task | Details |
|------|---------|
| Create shared types | Entity types, API request/response contracts in `services/shared/` |
| Create validation schemas | Zod (Node.js) / Pydantic (Python) / FluentValidation (.NET) — **one per endpoint accepting input** |
| Create path param schemas | UUID format validation for path params (e.g., `:id`) |
| Create file upload validation | Size limit and MIME type validation for uploads |
| Define error code enum | Typed union of all valid error codes (not plain `string`) |
| Wire validation into handlers | Validate request body/params before processing |

**Reference**: [error-handling.md](.github/agents/shared-references/error-handling.md)

> ⚠️ **Schema Completeness Check** (MANDATORY)
>
> Before marking complete, verify **every route** has:
> - Request body schema (if accepts body)
> - Query param schema (if has query params)
> - Path param schema (if has path params like `:id`)
> - Response type in shared package
>
> Count schemas vs routes. Coverage < 100% = NOT complete.

> **✅ Checkpoint**: Every route has a corresponding validation schema. Types build cleanly.

---

### Step 7: API Routes / Functions (Per Feature)

**Goal**: Implement each route one at a time. Each compiles and matches API contract before starting next.

> ❌ **CRITICAL**: Implement ONE route at a time. Verify compiles. THEN start next.

For **each** route in plan:

| Task | Details |
|------|---------|
| Create function handler | One file per function. **All async calls MUST include `await`**. **`handleError` calls MUST match standardized signature**. |
| Use transactions for multi-table writes | Any handler writing 2+ tables MUST use `database.transaction()` |
| Wrap Enhancement services | External services classified Enhancement MUST have try/catch with fallback (see [resilience.md](.github/agents/shared-references/resilience.md)) |
| Validate file uploads server-side | Check file size and MIME type before processing |
| Validate path params before DB queries | When auth middleware extracts userId from token, **validate format** (e.g., UUID) before DB query. Malformed ID on typed column causes 500 instead of 401. Most common runtime error mocked tests miss. |
| Verify response shape | `jsonBody` must match Route Definitions |
| Verify collection names | Must map to migration tables (Rule 10) |
| Extract shared utilities | Duplicated helpers → `services/functions/src/utils/` (Rule 6). **After each handler**, grep for helpers in 2+ files, extract immediately. Consider handler wrapper if >8 handlers share try/catch boilerplate. Prefix unused params with `_`. |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md), [resilience.md](.github/agents/shared-references/resilience.md)

> **✅ Checkpoint (per feature)**: Handler compiles. Response shape matches plan contract.

> **✅ Post-Step 7 Smoke Test (MANDATORY — after ALL routes)**:
>
> 1. Build functions: `npm run build` (or `tsc`). **Zero errors.** If `TS2307` import errors → shared package exports broken, fix first.
> 2. **Verify `main` field** — List `dist/`, confirm `main` glob matches compiled handlers. If `rootDir` set to parent, output nests deeper (Rule 14). Fix before proceeding.
> 3. Start Functions host: `func start`. **MUST actually execute** (Rule 12) — do NOT skip. If unavailable, log warning.
> 4. Verify **all functions register** — check console. "No job functions found" or `ERR_MODULE_NOT_FOUND` = import/build bug.
> 5. **`GET /api/health`** → 200. Confirm app starts and serves.
> 6. Stop Functions host.
>
> ⚠️ **Catches blocking runtime errors** (missing migrations, broken imports) that compile-time checks miss. Full API testing handled by `azure-project-test`.

---

### Step 8: Error Handling Middleware

**Goal**: Global error handler for consistent error responses.

| Task | Details |
|------|---------|
| Create error types | Custom classes (NotFoundError, ValidationError, etc.) |
| Create error middleware | Catches errors, maps to standardized response |
| Create error response shape | `{ error: { code: string, message: string, details?: any } }` |

**Reference**: [error-handling.md](.github/agents/shared-references/error-handling.md)

> **✅ Checkpoint**: Error types and middleware exist. Response shape consistent. `tsc` zero errors.

---

### Step 9: Health Check Endpoint

**Goal**: `/api/health` endpoint that reports status of all configured services.

| Task | Details |
|------|---------|
| Create health check function | Calls each service's health method, aggregates results |
| Return structured response | `{ status: "healthy" | "degraded" | "unhealthy", services: { ... } }` |

**Status → HTTP code mapping** (must match tests):

| Status | HTTP Code | Condition |
|--------|:---------:|-----------|
| `healthy` | 200 | All services healthy |
| `degraded` | 200 | Some services down but app functional |
| `unhealthy` | 503 | All services down or all Essential down |

> ⚠️ **`degraded` returns 200, NOT 503.** App still serving — reduced functionality. Only `unhealthy` returns 503. Tests must match.

> **✅ Checkpoint**: Health endpoint exists, returns structured response. Status-to-HTTP mapping correct.

---

### Step 10: OpenAPI / API Contract

**Goal**: Auto-generated or manually defined OpenAPI 3.x spec from route definitions.

| Task | Details |
|------|---------|
| Generate OpenAPI spec | From plan route definitions, produce `openapi.yaml` or `.json`. **Prefer inlining as TypeScript object** in handler to avoid dist/ path issues. |
| Add spec endpoint | Serve at `/api/docs` or `/api/openapi.json`. If file-based, verify path resolves from compiled output. |
| Validate responses | Test actual responses match spec shapes |

> **✅ Checkpoint**: OpenAPI spec exists and valid. Endpoint wired.

---

### Step 11: Structured Logging

**Goal**: Consistent, machine-readable logging across handlers and services.

| Task | Details |
|------|---------|
| Configure logger | pino (Node.js) / structlog (Python) / **`ILogger<T>` + OpenTelemetry → App Insights (.NET — no Serilog)** |
| Add request logging | Log method, path, status, duration per request |
| Add operation logging | Log key operations (create, update, delete) |

**Reference**: [runtimes/](.github/agents/shared-references/runtimes//)

> **✅ Checkpoint**: Logger configured, wired into handlers. Request logging in place. `tsc` zero errors.

---

### Step 12: Wire Frontend (If Applicable)

**Goal**: Replace mock data/types in frontend preview with real shared types and typed API client.

> **Skip** if no frontend or no preview generated.

| Task | Details |
|------|---------|
| Replace local types | Remove `services/web/src/types/` locals. Import from shared package (e.g., `import type { PublicUser } from '@app/shared'`) |
| Replace mock API client | Remove `services/web/src/mocks/api.ts`. Create typed client in `services/web/src/api/client.ts` calling real endpoints |
| Configure dev proxy | Dev server proxies `/api` to Functions host (e.g., `localhost:7071`) |
| Update hooks and pages | Replace mock imports with real API calls. Maintain 4 data states (loading, error, empty, data) |
| Error handling in hooks | Every async hook catches errors, rolls back optimistic updates on failure |
| Destructive action confirmations | Delete/irreversible actions require user confirmation |
| Client-side upload validation | Files validate size and MIME before sending (server also validates) |
| Correct file extensions | JSX content (`<Component />`) MUST use `.tsx`. Pure TS (no JSX) uses `.ts`. Includes hooks returning JSX providers. |

> ⚠️ **No `any` Types** (MANDATORY)
>
> Frontend MUST import and use types from shared package for all entities/responses.
> `useState<any>` or untyped responses found = NOT complete.

> **✅ Checkpoint**:
> - Frontend builds zero errors, zero `any` warnings
> - **Dev server starts**: `npx vite` **from `services/web/`** starts without errors. Kill after confirming. Catches `.ts`/`.tsx` extension mismatches that `tsc` doesn't report.
> - Mock data layer removed or no longer imported
> - All pass → check off in `.azure/execution-checklist.md`

---

### Step 13: Wrap Up

**Goal**: All code compiles, app starts, health check responds. Scaffold complete.

| Task | Details |
|------|---------|
| Build all workspaces | `npm run build` in every workspace — zero errors |
| Verify func start | `func start` — all functions register |
| Verify health check | `GET /api/health` → 200 |
| Clean up the HTML preview | If `.azure/.preview-temp/` exists, delete the whole folder — its contents were a transient mock-up consumed during scaffolding and should not ship in the repo. Use a portable command (see Cross-platform command discipline): `node -e "require('fs').rmSync('.azure/.preview-temp', {recursive: true, force: true})"`. Do **NOT** use `rm -rf` or `Remove-Item -Recurse -Force` directly — those are not cross-platform. |
| Update checklist | Mark all scaffold items `[x]` in `.azure/execution-checklist.md` (Rule 2). **If >50% unchecked, NOT complete.** |
| Update plan status | Set to `Scaffolded` |
| Print completion | List created files, announce: **"Scaffolding complete!"** |
| **Suggest next steps** | **MANDATORY**: Present follow-up via `vscode_askQuestions`. Do NOT auto-invoke. Single question with two options:\n\n**Header**: "Next Step"\n**Question**: "Scaffolding complete! What would you like to do next?"\n**Options** (allowFreeformInput: false):\n- **"Verify project"** ("Add test coverage and runtime validation") — recommended\n- **"Set up local dev"** ("Configure Docker emulators, VS Code debugging, and F5 launch")\n\nIf "Verify project" → invoke `azure-project-test`\nIf "Set up local dev" → invoke `azure-localdev` |

> **✅ Final Checkpoint**:
> 1. **Build**: `npm run build` every workspace. `dist/` has output. Zero errors.
> 2. **Runtime**: `func start` → all functions register → `GET /api/health` → 200. Stop.
> 3. **Preview cleanup**: `.azure/.preview-temp/` no longer exists.
> 4. **Checklist**: All items in `.azure/execution-checklist.md` marked `[x]`.
> 5. **Status**: `.azure/project-plan.md` = `Scaffolded`.
> 6. **Follow-up**: Button prompt presented via `vscode_askQuestions`.

---

## Outputs

> Locations below are **example conventions** for a new project. Where the workspace already has a structure, the actual paths follow it — do not assume these exact directories.

| Artifact | Location |
|----------|----------|
| **Execution Checklist** | `.azure/execution-checklist.md` (live progress tracker — copied from plan Section 8 at start) |
| Frontend preview (if applicable) | `services/web/` (with mock data, local types, pages, components — from Step 1) |
| Backend (Functions) | `services/functions/` or user-specified path |
| Shared types | `services/shared/` |
| Service abstractions | `services/functions/src/services/` (or equivalent) |
| Function handlers | `services/functions/src/functions/` (or equivalent) |
| Validation schemas | `services/shared/schemas/` or `services/shared/validation/` |
| Error types | `services/functions/src/errors/` (or equivalent) |
| OpenAPI spec | `services/functions/openapi.yaml` or `openapi.json` |
| Environment template | `.env.example` (project root) |
| Functions config | `services/functions/local.settings.json` |
| Seed data | `services/functions/seeds/` or `data/fixtures/` |
| Wired frontend (if applicable) | `services/web/` (with real types + API client — from Step 12) |
| **Next step** | Presented via `vscode_askQuestions`: "Verify project" or "Set up local dev" |

---

## Runtime Quick Reference

| Language | Orchestration | Init | Hosting Model | Package Manager |
|----------|---------------|------|---------------|-----------------|
| TypeScript | docker-compose | `func init --typescript --model V4` | Functions v4 | npm / pnpm |
| Python | docker-compose | `func init --python --model V2` | Functions v2 | pip / poetry |
| C# (.NET) | docker-compose | `func init --dotnet --isolated` | Functions isolated worker | dotnet |

For runtime-specific implementation patterns, see [runtimes/](.github/agents/shared-references/runtimes//).

---

## Next

> Use the Step 13 "Suggest next steps" prompt (`vscode_askQuestions`): "Verify project" → `azure-project-test`, "Set up local dev" → `azure-localdev`. Do NOT print plain-text suggestions; do NOT suggest deploy or benchmark.
