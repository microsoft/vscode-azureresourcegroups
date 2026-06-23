---
name: azure-project-scaffold
description: "Scaffold the frontend, backend services, API routes, and service layer for an Azure-centric project following an approved project plan. Generates the frontend via a dedicated sub-agent running in parallel with the backend sub-agents, then hands off to the integrate agent for migrations, wiring, and runtime verification. WHEN: \"scaffold backend\", \"build services\", \"execute plan\", \"scaffold project\", \"create backend\", \"implement plan\", \"build backend\", \"scaffold services\", \"create API\", \"scaffold API\", \"preview frontend\"."
license: MIT
metadata:
  author: Microsoft
  version: "3.0.0"
---

# Azure Project Scaffold

> **AUTHORITATIVE — MANDATORY.** Canonical source for scaffolding Azure-centric backends from approved plans. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

**North Star:** produce a working, buildable Azure backend fast from the approved plan. If the plan has a frontend, generate it via a dedicated **Frontend sub-agent that runs in parallel with the backend sub-agents**. After scaffolding, write the `.azure/integration-plan.md` hand-off artifact and hand off to the `azure-project-integrate` agent — do NOT prompt the user for next steps.

## Triggers
Execute approved plan; scaffold backend services; build API routes + service layer; generate frontend.

## Prerequisites
Requires an approved plan. Verify before starting:
- `.azure/project-plan.md` exists
- Status = `Approved` (not `Planning`)
- Section 7 lists API routes; Section 4 lists Azure services

> If `.azure/project-plan.md` is missing or status ≠ `Approved`: **STOP** — tell the user _"No approved project plan found. Create and approve a project plan first."_

## Autopilot mode (overrides approval gates & the Next Step question)
**Active when** the invoking chat query begins with `[AUTOPILOT MODE]`, **or** `.azure/project-plan.md` contains `executionMode: auto` (front-matter or a `**Execution Mode**: auto` row). When active, run fully unattended:
- **Skip the plan preview & approval** — the plan was already approved upstream; go straight to scaffolding (do NOT open `openPlanView` or re-request approval).
- **Skip the frontend preview approval gate** — do NOT call `azureResourceGroups.openFrontendPreviewView`; the UI is auto-approved in autopilot.
- **Replace the Step 11 "Next Step" question with the integrate hand-off** — do NOT call `vscode_askQuestions`. Still write `.azure/integration-plan.md`, then hand off to the integrate agent unattended via `azureResourceGroups.startProjectIntegrate`, prefixing the args with `[AUTOPILOT MODE] `.
- All scaffold quality work (frontend preview verification, build gates, `.azure/.preview-temp/` cleanup) still applies — autopilot suppresses **gates and questions only**.

## Rules

> **14 core rules** govern every scaffold. Rule 0 is the load-bearing UX rule — visible feedback first. Rules 1–13 govern correctness. Details in referenced docs, consumed at relevant step.

> **📁 Paths are examples, not assumptions.** Every directory shown in these instructions (`services/web/`, `services/functions/`, `services/shared/`, `services/functions/src/utils/`, …) is an **illustrative default for a fresh project**. When the workspace already has a structure, follow it. Read the actual layout first and map these roles (frontend folder, Functions project, shared types, etc.) onto the user's real folders — never assume or impose a specific path. The plan's Project Structure section, when present, is the source of truth for where things go. **If the plan names the deployable apps after the product** (e.g. `services/office-compliance-api`, `services/office-compliance-portal`), honor those names exactly — including in `workspaces`, `cd` commands, imports, and the computed `main`/`rootDir` (`dist/<project>-api/src/functions/*.js`). The shared package stays generic (`services/shared`).

0. **Frontend-first generation (load-bearing UX rule)** — If the plan includes a frontend, the orchestrator launches the **Frontend Sub-Agent** (Step 1) at the same point it kicks off the backend track, so frontend generation runs **concurrently** with backend Phase A/B rather than blocking it. The sub-agent generates `services/web/` (mock data, pages, components), builds it, and reports back. The user already approved the design during planning (the `.azure/.preview-temp/` mock-up), so **do NOT ask the user to approve the UX during scaffolding.** If the plan has no frontend, this rule is satisfied trivially. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md).
1. **Plan is source of truth** — Read `.azure/project-plan.md` at start. Follow route definitions, service list, types, architecture exactly. Do NOT re-ask user for plan requirements.
2. **Track progress** — Update plan status as you go: Approved → In Progress → Awaiting Integration. Do not defer status updates. (The `azure-project-integrate` agent advances it to `Integrated`.)
3. **Build-gate enforcement** — Every phase ends with build check (`tsc` / `npm run build`). If fails, iterate until clean. **Do NOT proceed until code compiles.** Most important rule.
4. **Azure Functions v4** — Always v4 programming model (Node.js v4, Python v2, .NET isolated). Prioritize Azure services. Runtimes: TypeScript, Python, C#.
5. **Service abstraction & DI** — All Azure SDK calls behind injectable interfaces. Handlers NEVER import SDKs directly. **CRITICAL: Step 4 MUST produce interface AND concrete implementation per service.** Interface-only = #1 cause of runtime crashes. Concrete impl is what the app uses at runtime. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
6. **Modular, one function per file** — Each Function own file. Each service own module. Extract shared utilities to `services/functions/src/utils/` — no duplication, no unused stubs. Prefix unused params with `_`. **DRY**: Same helper in 2+ files → extract to `services/functions/src/utils/` and import. **Proactive**: Before writing handlers, identify common patterns (password hashing, entity sanitization, response formatting) and pre-create shared utils. See [architecture.md](.github/agents/shared-references/architecture.md).
7. **Environment-driven config** — Connection strings switch local/Azure via env vars. Validate required vars on startup, fail fast. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
8. **Input validation & standardized errors** — Every endpoint has validation schema (Zod/Pydantic/FluentValidation). Every route returns `{ error: { code, message, details? } }`. Error codes typed union, not strings. See [error-handling.md](.github/agents/shared-references/error-handling.md).
9. **Resilience classification** — Follow plan's Essential/Enhancement classification. Enhancement services wrapped in try/catch with fallback. **Enhancement constructors MUST NOT throw** — defer config validation to method calls or wrap in try/catch in registry. Constructor throws crash ALL handlers via `getServices()`. See [resilience.md](.github/agents/shared-references/resilience.md).
10. **Database write integrity** — Handlers performing multi-table writes MUST use `database.transaction()`. Document the collection-to-table mapping so the integrate agent can build matching schema migrations. (The integrate agent owns schema migrations and seed data; the scaffold does not create them.) See [database-integrity.md](.github/agents/shared-references/database-integrity.md).
11. **Auto-initialization** — Registry `getServices()` MUST auto-initialize with concrete implementations when nothing pre-registered. (The integrate agent's runtime smoke test confirms this — but the code must be correct here.) See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
12. **Cross-workspace build safety** — When Functions imports `../shared/`, set `rootDir` to `".."` and **compute `main` field from actual `dist/` output after `tsc`** — never hardcode. With `rootDir: ".."`, handlers compile to `dist/functions/src/functions/X.js`. After build, list `dist/`, verify `main` matches. **#1 cause of "build passes but app won't start"**. See [architecture.md](.github/agents/shared-references/architecture.md).
13. **Frontend quality contract** — If the plan has a frontend, **Section 5 (Design System & UI) of the plan is load-bearing**. Treat each region token in Section 5's Pages table (`header`, `hero`, `grid`, `form`, ...) as layout **intent** — render it using real primitives from the library named in `Component Library:`, themed by the Color Palette. **Reproduce the records from Section 5's Sample Content block** — the scaffolded page MUST show the same entities, names, values, and states the planning preview showed (the preview and the scaffold share this one content contract, so they stay in parity). Seed your mock data from Sample Content, then extend it. **Never produce raw `<div className="card">` placeholders that just mimic the wireframe** — but bespoke, domain-specific components (polaroid frames, ticket stubs, gallery tiles, chat bubbles) that wrap a real library primitive and carry real content + imagery are encouraged, not banned. **Every media-bearing entity MUST render a real image from the mock data, never an empty tinted surface or solid-color block.** **The HTML preview at `.azure/.preview-temp/*.html` is a directional sketch — the scaffolded app MUST visibly exceed it.** If a generated page looks like a re-skin of the static HTML sketch (same flat surfaces, no real icons, no motion, no dark mode, no polished hero, no library elevation), you have failed the bar — go back and apply the Polish floor before claiming the page is complete. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library region-token → primitive mapping, theming contract, icon contract, state-coverage contract, **Polish floor**, and **Polish self-review checklist**. If Section 5 is missing or `Component Library:` is blank, STOP — the plan must be completed before scaffolding.

---

## 📦 Context Management — read this first

> Do NOT read all reference files upfront (~250KB total) — it wastes context needed for code, test output, and fixes. Read lazily: only when a step needs them.

### Step-to-Reference Mapping

| Step | Read ONLY these files | Skip |
|------|----------------------|------|
| **Step 0** (Read Plan) | `.azure/project-plan.md` | All reference files |
| **Step 1** (Frontend) | `../shared-references/frontend-patterns.md`, `references/frontend-preview-steps.md`, `references/frontend-quality-bar.md` | All other reference files |
| **Sub-Agent Strategy** | `references/sub-agent-strategy.md` | |
| **Step 2** (Foundation) | `../shared-references/architecture.md` | |
| **Step 3** (Config) | `../shared-references/service-abstraction.md` — read only the Config Module section | |
| **Step 4** (Services) | `../shared-references/service-abstraction.md` (full), selected runtime file | |
| **Step 5** (Types/Validation) | `../shared-references/error-handling.md` — read only the Error Code Type Safety section | |
| **Step 6** (Routes) | `../shared-references/resilience.md`, selected runtime file | |
| **Step 7** (Errors) | `../shared-references/error-handling.md` (full) | |
| **Step 8–10** (Health/OpenAPI/Logging) | _(instructions are in this skill, below)_ | |
| **Step 11** (Wrap Up) | _(instructions are in this skill, below)_ | |

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
| Validate status | Must be `Approved`. If not, STOP — the plan must be approved before scaffolding. |
| Extract plan details | Routes, services, entity types, language, runtime, framework, and **orchestration** for each service's stack section (`## 2. Backend`, `## 3. Frontend`, …), structure |
| Extract design contract (if frontend) | If a frontend is planned, read Section 5 (Design System & UI). Extract `Component Library:`, `Style Direction:`, `Typography:`, the Color Palette table, and the Pages table (page → layout regions). **If Section 5 is missing or `Component Library:` is blank, STOP — the plan's design section must be completed before scaffolding. Section 5 is load-bearing for Rule 13 / Step 1 quality bar.** |
| Read the approved HTML preview (if frontend) | List `.azure/.preview-temp/` if it exists. Read `manifest.json` to get the page list, then read each `<slug>.html` plus `theme.css`. **Treat these files as the visual mock-up that the user already approved during planning.** They are the source of truth for layout, palette translation, and per-page region composition. The scaffolded app must reproduce this look using the framework + library named in the Frontend stack section / Section 5 — NOT by serving the preview HTML itself. If `.azure/.preview-temp/` is missing for a plan that has a frontend, do not fail — just rely on Section 5 alone. |
| Determine frontend needed | Check if plan includes frontend (SPA + API, Full-stack SSR, Static + API). If yes, Step 1 generates the frontend. |
| Update plan status | Set to `In Progress` |

> **✅ Checkpoint**: Plan loaded, status valid, status `In Progress`. If frontend planned, `.azure/.preview-temp/` contents loaded into context as visual reference.

---

## Execution Steps

> **Execution chronology** (frontend-first, backend in parallel):
>
> ```
> t=0      Step 0     read plan, validate
> t=10s    Step 1     frontend SUB-AGENT            ─┐
> t=10s    Phase A    contracts (sequential)        ─┼─ concurrent
> t=10s    Phase B    backend SUB-AGENT             ─┘
> t=Nm     Step 11    wrap up: frontend built AND Phase B done → write hand-off (sequential)
> ```
>
> The chronology is load-bearing. **Launch the Frontend sub-agent and the backend track together** right after Step 0 so they run in parallel. For API-only projects (no frontend), Step 1 is skipped and Phase A/B begin immediately after Step 0.

### Step 1: Frontend (If Applicable)

> **Skip** if plan has no frontend ("API only" or "Background worker").

> **Run as a sub-agent (parallel with backend).** The orchestrator delegates frontend generation (sub-steps **F1–F4**) to a dedicated **Frontend Sub-Agent** so it runs concurrently with backend Phase A/B. The sub-agent generates + builds `services/web/` and returns a single report. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md) for the sub-agent brief and hand-back contract.

**Goal**: Standalone frontend with mock data, generated and built. The integrate agent later wires it to the real backend. **Auto-authenticated** — if app has auth, seed mock auth state so the app lands on the main view (dashboard, feed), NOT a login page.

> ⚠️ **WORKING DIRECTORY (most-common scaffold failure)**: Every frontend command — `npm install`, `npx vite build`, `npm run build` — MUST run against the **frontend folder** (typically `services/web/`), never the workspace root. **Prefer the working-directory-independent form `npm --prefix services/web run <script>`** — `--prefix` loads the frontend's `package.json` no matter where the shell starts, so it can't accidentally run from the root. When using a binary directly (e.g. `npx vite build`), pass `cwd: "services/web"` on the same terminal call.

**References**:
- [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library region-token → primitive mapping, theming contract, icon contract, and state-coverage contract. **READ THIS FIRST — it is the contract between the plan's Section 5 and the JSX you ship.**
- [frontend-patterns.md](.github/agents/shared-references/frontend-patterns.md) for patterns and quality bar.
- [frontend-preview-steps.md](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md) for sub-steps (F1–F4), working directory rules.

> **✅ Checkpoint**:
> 1. Frontend builds zero errors (`npm --prefix services/web run build` — cwd-independent; **never** a bare `npx vite build` from the workspace root)
> 2. No `any` types in `.ts`/`.tsx`
> 3. Auto-authenticated — mock auth state seeded so the app lands on main content on first load
> 4. **No UX approval prompt** — the design was already approved during planning via `.azure/.preview-temp/`. Do NOT call `ask_user` for "do you approve this UI?".
> 5. **Quality bar (Rule 13)**: Every page imports primitives from the library named in plan Section 5's `Component Library:`; the app shell is wrapped in that library's theme provider with a brand ramp derived from Section 5's palette; every icon is a real library icon (no emoji, no SVG placeholders); every `form` region has a visible validation state; every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle. **Use the approved HTML mock-up at `.azure/.preview-temp/<slug>.html` as the layout/visual reference per page** — reproduce the same regions and tonal feel using the real library primitives, not by embedding the HTML. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md).

---

### Sub-Agent Strategy for Backend Scaffolding

**Reference**: Read [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md) for execution model, Frontend/Phase A/Phase B details, coordination rules.

> Sub-agents parallelize work. The **Frontend sub-agent** (Step 1, F1–F4) and the backend track launch together right after Step 0. Phase A (Contracts) is sequential/blocking; Phase B (Backend) launches when Phase A completes. The Frontend sub-agent runs concurrently with both.

> **Completion gate**: Step 11 (Wrap Up) writes the hand-off artifact only after BOTH: (a) the frontend is generated and built (sub-agent returned) AND (b) Phase B completed.

### Step 2: Foundation

**Goal**: Project skeleton compiles/builds with zero errors.

| Task | Details |
|------|---------|
| Initialize project | `package.json` + `tsconfig.json` (Node.js) / `pyproject.toml` (Python) / `*.csproj` + `*.sln` (.NET) |
| Configure linter/formatter | ESLint + Prettier (Node.js) / Ruff (Python) / dotnet format (.NET) |
| Create `.gitignore` | Runtime-appropriate ignores (node_modules, .env, data/, etc.) |
| Create directory structure | `services/functions/`, `services/functions/src/utils/`, `services/shared/` (do NOT create `services/web/` — may exist from frontend generation) |

**Reference**: [architecture.md](.github/agents/shared-references/architecture.md)

> **✅ Checkpoint**:
> 1. **Build gate**: `npm run build` / `python -m py_compile` / `dotnet build`. Zero errors.
> 2. **Workspace build scripts**: If monorepo, verify every workspace has `build` script. Run in each. If produces `dist/`, verify non-empty.
> 3. **Shared package**: If `services/shared/` exists, verify: (a) `package.json` has `"exports"` or `"main"` pointing to compiled output, (b) `npm run build` produces `dist/` with `.js` and `.d.ts`, (c) other workspaces import without errors.
> 4. **Cross-workspace imports (CRITICAL)**: Run `tsc --noEmit` in every workspace importing shared. If `TS2307: Cannot find module` → exports broken. **Fix before proceeding.**
> 5. **rootDir and main field (CRITICAL)**: After `tsc`, **list actual dist/ contents**, verify `main` glob matches compiled handlers. If `rootDir: ".."`, output nests deeper. Fix `main`.
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
> MUST produce **two files per service**: interface and concrete implementation. Interface-only scaffolding is #1 cause of runtime failures — the app crashes at startup because the registry has nothing to auto-initialize. **Every interface MUST have corresponding concrete implementation before checkpoint.**

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
> **If any concrete implementation missing, DO NOT proceed.** The app will fail to start at runtime.

> **✅ Checkpoint**: All interfaces, concrete implementations, and registry exist. `getServices()` auto-initializes. `tsc` zero errors.

---

### Step 5: Shared Types & Validation Schemas

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

### Step 6: API Routes / Functions (Per Feature)

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
| Verify collection names | Must map to the documented collection-to-table mapping (Rule 10) |
| Extract shared utilities | Duplicated helpers → `services/functions/src/utils/` (Rule 6). **After each handler**, grep for helpers in 2+ files, extract immediately. Consider handler wrapper if >8 handlers share try/catch boilerplate. Prefix unused params with `_`. |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md), [resilience.md](.github/agents/shared-references/resilience.md)

> **✅ Checkpoint (per feature)**: Handler compiles. Response shape matches plan contract.

> **✅ Post-Step 6 Build Check (MANDATORY — after ALL routes)**:
>
> 1. Build functions: `npm run build` (or `tsc`). **Zero errors.** If `TS2307` import errors → shared package exports broken, fix first.
> 2. **Verify `main` field** — List `dist/`, confirm `main` glob matches compiled handlers. If `rootDir` set to parent, output nests deeper (Rule 12). Fix before proceeding.
>
> ⚠️ The integrate agent runs the `func start` smoke test, endpoint checks, and migrations after scaffolding — the scaffold's job ends at a clean build.

---

### Step 7: Error Handling Middleware

**Goal**: Global error handler for consistent error responses.

| Task | Details |
|------|---------|
| Create error types | Custom classes (NotFoundError, ValidationError, etc.) |
| Create error middleware | Catches errors, maps to standardized response |
| Create error response shape | `{ error: { code: string, message: string, details?: any } }` |

**Reference**: [error-handling.md](.github/agents/shared-references/error-handling.md)

> **✅ Checkpoint**: Error types and middleware exist. Response shape consistent. `tsc` zero errors.

---

### Step 8: Health Check Endpoint

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

### Step 9: OpenAPI / API Contract

**Goal**: Auto-generated or manually defined OpenAPI 3.x spec from route definitions.

| Task | Details |
|------|---------|
| Generate OpenAPI spec | From plan route definitions, produce `openapi.yaml` or `.json`. **Prefer inlining as TypeScript object** in handler to avoid dist/ path issues. |
| Add spec endpoint | Serve at `/api/docs` or `/api/openapi.json`. If file-based, verify path resolves from compiled output. |
| Validate responses | Test actual responses match spec shapes |

> **✅ Checkpoint**: OpenAPI spec exists and valid. Endpoint wired.

---

### Step 10: Structured Logging

**Goal**: Consistent, machine-readable logging across handlers and services.

| Task | Details |
|------|---------|
| Configure logger | pino (Node.js) / structlog (Python) / **`ILogger<T>` + OpenTelemetry → App Insights (.NET — no Serilog)** |
| Add request logging | Log method, path, status, duration per request |
| Add operation logging | Log key operations (create, update, delete) |

**Reference**: [runtimes/](.github/agents/shared-references/runtimes//)

> **✅ Checkpoint**: Logger configured, wired into handlers. Request logging in place. `tsc` zero errors.

---

### Step 11: Wrap Up

**Goal**: All code compiles and builds cleanly. Scaffold complete; hand off to verify.

| Task | Details |
|------|---------|
| Build all workspaces | `npm run build` in every workspace — zero errors |
| Clean up the HTML preview | If `.azure/.preview-temp/` exists, delete the whole folder — its contents were a transient mock-up consumed during scaffolding and should not ship in the repo. Use a portable command (see Cross-platform command discipline): `node -e "require('fs').rmSync('.azure/.preview-temp', {recursive: true, force: true})"`. Do **NOT** use `rm -rf` or `Remove-Item -Recurse -Force` directly — those are not cross-platform. |
| Update plan status | Set to `Awaiting Integration` — signals the scaffold built clean but the frontend still uses mock data and migrations/live wiring are pending (the `azure-project-integrate` agent's job) |
| Print completion | List created files, announce: **"Scaffolding complete!"** |
| **Write the integration artifact** | Write `.azure/integration-plan.md` — the hand-off brief the `azure-project-integrate` agent consumes. Include: backend folder + run command + port + health path; frontend folder + build/dev commands + the **API seam to swap** (`services/web/src/api/index.ts` — repoint from `mockClient` to the live client) plus the **mock files to delete** (`src/api/mockClient.ts`, `src/mocks/*`, local mock types, and the dev-only Mock State Switcher `src/api/previewState.ts` + its corner-switcher component); the full API route inventory (method + path) so the live client mirrors the `ApiClient` interface method-for-method; the database type + migration tool + migration directory + connection env vars (state explicitly that **NO seed data** is to be created); the shared-types package + import alias; the service list (Essential vs Enhancement). Keep it concise — paths and commands, not prose. |
| **Open the frontend preview & UI-approval gate** | **Only when the plan has a frontend AND not in autopilot.** Call `run_vscode_command` with `{ "commandId": "azureResourceGroups.openFrontendPreviewView", "name": "Open Frontend Preview", "skipCheck": true }`. Pass the frontend folder as the command argument when it isn't the default `services/web` (e.g. a product-named app). This opens a webview that starts the frontend dev server and renders the **running app (mock data)** in an iframe, with an **Approve UI** header and a feedback box — mirroring the plan-approval UX. **The webview owns the hand-off**: clicking **Approve UI** triggers `azureResourceGroups.startProjectIntegrate` itself, and the feedback box re-opens this scaffold agent with the user's UI change requests (the dev server hot-reloads as you edit). After opening the gate, **STOP** — do NOT also call `startProjectIntegrate`, do NOT call `vscode_askQuestions`. If the plan has **no frontend**, skip this row and use the direct hand-off row below. |
| **Hand off to the Integrate agent** | **Use this row only when there is NO frontend, or in autopilot mode** (the preview gate is skipped). Call `run_vscode_command` with `{ "commandId": "azureResourceGroups.startProjectIntegrate", "name": "Start Project Integrate" }`. This starts a **new chat session** running `azure-project-integrate`, which reads the artifact and its instruction file to wire the frontend to live data, smoke-test the backend, create the migrations, and verify end-to-end. `run_vscode_command` is deferred — if not loaded, call `tool_search` for `run_vscode_command` first. Do **NOT** call `vscode_askQuestions` — the hand-off is the next step. |

> **✅ Final Checkpoint**:
> 1. **Build**: `npm run build` every workspace. `dist/` has output. Zero errors.
> 2. **Preview cleanup**: `.azure/.preview-temp/` no longer exists.
> 3. **Status**: `.azure/project-plan.md` = `Awaiting Integration`.
> 4. **Integration artifact**: `.azure/integration-plan.md` written with the integrate agent's brief.
> 5. **Hand-off**: For a project **with a frontend** (interactive mode), opened the UI-approval gate via `azureResourceGroups.openFrontendPreviewView` and stopped — the gate's **Approve UI** button performs the hand-off. For a **no-frontend** project (or autopilot), started the `azure-project-integrate` session via `azureResourceGroups.startProjectIntegrate`. Either way, did NOT call `vscode_askQuestions` or print next-step suggestions.

---

## Outputs

> Locations below are **example conventions** for a new project. Where the workspace already has a structure, the actual paths follow it — do not assume these exact directories.

| Artifact | Location |
|----------|----------|
| Frontend (if applicable) | `services/web/` (with the `src/api/` seam — `ApiClient` interface + mock impl + one-line swap point — mock data, local types, pages, components — from Step 1) |
| Backend (Functions) | `services/functions/` or user-specified path |
| Shared types | `services/shared/` |
| Service abstractions | `services/functions/src/services/` (or equivalent) |
| Function handlers | `services/functions/src/functions/` (or equivalent) |
| Validation schemas | `services/shared/schemas/` or `services/shared/validation/` |
| Error types | `services/functions/src/errors/` (or equivalent) |
| OpenAPI spec | `services/functions/openapi.yaml` or `openapi.json` |
| Environment template | `.env.example` (project root) |
| Functions config | `services/functions/local.settings.json` |
| **Integration artifact** | `.azure/integration-plan.md` (hand-off brief for `azure-project-integrate`) |
| **Next step** | If the plan has a frontend: open the UI-approval gate via `azureResourceGroups.openFrontendPreviewView` (its **Approve UI** button hands off). Otherwise: hand off directly via `azureResourceGroups.startProjectIntegrate` |

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

> After scaffolding completes, write `.azure/integration-plan.md`. **If the plan includes a frontend (and you are not in autopilot), open the UI-approval gate via `azureResourceGroups.openFrontendPreviewView`** — it shows the running frontend (mock data) in a webview with an **Approve UI** header + feedback box, and its Approve button performs the integrate hand-off for you, so do NOT also call `startProjectIntegrate`. For a no-frontend project (or autopilot), hand off directly to the `azure-project-integrate` agent via `azureResourceGroups.startProjectIntegrate` (Step 11). Do NOT ask the user what to do next — do NOT call `vscode_askQuestions` (or any chat question API), and do NOT print plain-text follow-up suggestions. The integrate agent takes over from here.
