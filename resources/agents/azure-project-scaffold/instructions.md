---
name: azure-project-scaffold
description: "Scaffold the frontend, backend services, API routes, and service layer for an Azure-centric project following an approved project plan. Generates the frontend via a dedicated sub-agent running in parallel with the backend sub-agents, then hands off to the integrate agent for migrations, wiring, and runtime verification. WHEN: \"scaffold backend\", \"build services\", \"execute plan\", \"scaffold project\", \"create backend\", \"implement plan\", \"build backend\", \"scaffold services\", \"create API\", \"scaffold API\", \"preview frontend\"."
license: MIT
metadata:
  author: Microsoft
  version: "3.0.0"
---

# Azure Project Scaffold

> **AUTHORITATIVE — MANDATORY.** Canonical Azure-centric backend scaffolding source for approved plans. Follow exactly; ignore prior assumptions and other sources. Do not improvise.

**North Star:** quickly produce a working, buildable Azure backend from the approved plan. For frontends, use a dedicated **Frontend sub-agent running parallel with backend sub-agents**. Then write `.azure/integration-plan.md` and hand off to `azure-project-integrate` — do NOT prompt for next steps.

## Triggers
Execute approved plan; scaffold backend services; build API routes + service layer; generate frontend.

## Prerequisites
Requires approved plan. Before starting, verify:
- `.azure/project-plan.md` exists
- Status = `Approved` (not `Planning`)
- Section 8 lists API routes; Section 4 lists Azure services

> If `.azure/project-plan.md` is missing or status ≠ `Approved`: **STOP** — say _"No approved project plan found. Create and approve a project plan first."_

## Autopilot mode (overrides approval gates & the Next Step question)
**Active when** invoking chat query starts with `[AUTOPILOT MODE]`, **or** `.azure/project-plan.md` contains `executionMode: auto` (front-matter or `**Execution Mode**: auto` row). Run unattended:
- **Skip the plan preview & approval** — already approved upstream; scaffold directly (do NOT open plan view or re-request approval).
- **Skip the frontend preview approval gate** — do NOT call the `open_frontend_preview_view` tool; the UI is auto-approved in autopilot.
- **Replace the Step 11 "Next Step" question with integrate hand-off** — do NOT call `vscode_askQuestions`. Write `.azure/integration-plan.md`, then hand off unattended via `start_project_integrate`, prefixing `prompt` with `[AUTOPILOT MODE] `.
- All quality work (frontend preview verification, build gates, `.azure/.preview-temp/` cleanup) still applies — autopilot suppresses **only gates and questions**.

## Rules

> **15 core rules** govern each scaffold. Rule 0: load-bearing UX, visible feedback first. Rules 1–14: correctness. Read referenced details at relevant steps.

> **📁 Paths are examples, not assumptions.** Directories here (`services/web/`, `services/functions/`, `services/shared/`, `services/functions/src/utils/`, …) are **fresh-project defaults**. Follow existing workspace structure: inspect it, then map roles (frontend, Functions, shared types) to actual folders. Never impose a path. Plan Project Structure is authoritative when present. **If deployable apps use product names** (e.g. `services/office-compliance-api`, `services/office-compliance-portal`), preserve them in `workspaces`, `cd` commands, imports, and computed `main`/`rootDir` (`dist/<project>-api/src/functions/*.js`). Keep shared package generic (`services/shared`).

0. **Frontend-first generation (load-bearing UX rule)** — For a frontend plan, launch **Frontend Sub-Agent** (Step 1) with backend track; frontend generation runs **concurrently** with backend Phase A/B. It generates and builds `services/web/` (mock data, pages, components), then reports. Planning already approved `.azure/.preview-temp/`; **do NOT request UX approval during scaffolding.** No frontend satisfies this rule. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md).
1. **Plan is source of truth** — Read `.azure/project-plan.md` at start. Follow route definitions, service list, types, architecture exactly. Do NOT re-ask user for plan requirements.
2. **Track progress** — Update status promptly: Approved → In Progress → Awaiting Integration. (`azure-project-integrate` advances to `Integrated`.)
3. **Build-gate enforcement** — End each phase with build check (`tsc` / `npm run build`). Fix failures. **Do NOT proceed until code compiles.** Most important rule.
4. **Azure Functions v4** — Always v4 programming model (Node.js v4, Python v2, .NET isolated). Prioritize Azure services. Runtimes: TypeScript, Python, C#.
5. **API auth and Azure client boundaries** — Read `API Login` from plan. When `Yes`, scaffold user-facing frontend/API login behind small application auth interface. Separately put every Azure SDK client behind client-provider interface. Handlers/domain code NEVER import Azure SDKs, inspect environment, or choose implementations. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
6. **Modular, one function per file** — One file per Function; one module per service. Put shared utilities in `services/functions/src/utils/`; no duplication or unused stubs. Prefix unused params with `_`. **DRY**: helper in 2+ files → extract to `services/functions/src/utils/` and import. **Proactive**: before handlers, identify patterns (password hashing, entity sanitization, response formatting) and create shared utils. See [architecture.md](.github/agents/shared-references/architecture.md).
7. **Managed identity in production** — Every production backend-to-Azure client MUST use managed identity (`DefaultAzureCredential` or runtime equivalent) + resource endpoint. Select emulator-backed local client only when runtime environment is exactly `Development`. Every other value, including missing/misspelled, selects managed-identity client and fails startup on invalid endpoint config. Never use account keys, connection-string secrets, API keys, or local emulator as production fallback. Keep environment check in composition root. See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
8. **Input validation & standardized errors** — Every endpoint has validation schema (Zod/Pydantic/FluentValidation). Every route returns `{ error: { code, message, details? } }`. Error codes typed union, not strings. See [error-handling.md](.github/agents/shared-references/error-handling.md).
9. **Resilience classification** — Follow Essential/Enhancement classification. Wrap Enhancement services in try/catch with fallback. **Enhancement constructors MUST NOT throw** — defer config validation to methods or catch in registry. Constructor throws crash ALL handlers via `getServices()`. See [resilience.md](.github/agents/shared-references/resilience.md).
10. **Database write integrity** — Multi-table writes MUST use `database.transaction()`. Document collection-to-table mapping for integrate-agent migrations. Integrate owns schema migrations and seed data; scaffold creates neither. See [database-integrity.md](.github/agents/shared-references/database-integrity.md).
11. **Auto-initialization** — Registry `getServices()` MUST auto-initialize with concrete implementations when nothing pre-registered. (The integrate agent's runtime smoke test confirms this — but the code must be correct here.) See [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).
12. **Cross-workspace build safety** — When Functions imports `../shared/`, set `rootDir` to `".."`; **derive `main` from actual `dist/` output after `tsc`**, never hardcode. With `rootDir: ".."`, handlers compile to `dist/functions/src/functions/X.js`. List `dist/` after build and verify `main`. This prevents "build passes but app won't start". See [architecture.md](.github/agents/shared-references/architecture.md).
13. **Deploy-ready artifact (dependency split)** — Deploy **compiled `dist/`**, not TS source. Server installs **production deps only** (`npm install --omit=dev`) without rebuilding. Runtime imports MUST be in `dependencies`; build tools (`typescript`, `@types/*`, test runners, bundlers) in `devDependencies`; `--omit=dev` must satisfy every `import` in `dist/`. `dist/` never imports `src/` or requires rebuild. Native addons (`bcrypt`, `sharp`, `better-sqlite3`, Prisma engines) remain in `dependencies`, installed on Linux, not bundled locally. Thus deploy ships prebuilt artifact with platform build **disabled**, avoiding Oryx rebuild without devDependencies/`tsc`. **Monorepo:** keep services self-contained — import `shared` via **relative paths** so `tsc` compiles it into service `dist/`; resolve hoisted third-party deps via service-level production install. Single-file bundling (esbuild `--packages=external`) is optional, not default. See [typescript.md](.github/agents/shared-references/runtimes/typescript.md) → Deployment build contract.
14. **Frontend quality contract** — For frontends, plan **Section 5 (Design System & UI) is load-bearing**. Treat Pages-table region tokens (`header`, `hero`, `grid`, `form`, ...) as layout **intent**, rendered with real `Component Library:` primitives and Color Palette theme. **Reproduce Section 5 Sample Content records**: same entities, names, values, and states as planning preview. Seed mocks from Sample Content, then extend. **Never use raw `<div className="card">` wireframe placeholders**; bespoke domain components (polaroid frames, ticket stubs, gallery tiles, chat bubbles) wrapping real primitives with content + imagery are welcome. **Each media entity MUST render a real mock image, never empty tint or solid color.** Faithfully reproduce presentation-quality `.azure/.preview-temp/*.html` with real primitives plus production polish (real photos, motion, dark mode, webfont, library elevation); never regress. If less polished than static preview (flat surfaces, missing icons/motion/dark mode/polished hero/elevation), apply Polish floor before completion. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for mappings, theming, icons, states, **Polish floor**, and **Polish self-review checklist**. Missing Section 5 or blank `Component Library:` → STOP until plan completed.

---

## 📦 Context Management — read this first

> Do NOT read all reference files upfront (~250KB); preserve context for code, tests, fixes. Read only when needed.

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

> After checkpoint, release its reference. Under pressure, prioritize current-step reference + project source.

---

## 🔁 Cross-platform command discipline — read once, apply everywhere

> **Every shell command MUST run unchanged on Windows (PowerShell + cmd) AND macOS / Linux (bash / zsh).** Each `run_in_terminal` uses a fresh OS-dependent shell.

| ❌ Non-portable pattern | ✅ Portable replacement |
|------------------------|------------------------|
| `cd services/web && npx vite build` | `run_in_terminal` with `cwd: "services/web"` and `npx vite build`. Without `cwd`, use `npm --prefix services/web run build` (or `npm --prefix services/web exec -- vite build`). |
| `mkdir -p services/web/src/components` | `node -e "require('fs').mkdirSync('services/web/src/components', {recursive: true})"` |
| `rm -rf .azure/.preview-temp` | `node -e "require('fs').rmSync('.azure/.preview-temp', {recursive: true, force: true})"` |
| `cp -r services/shared/types services/web/src/types` | `node -e "require('fs').cpSync('services/shared/types', 'services/web/src/types', {recursive: true})"` |
| `touch .env` | `node -e "require('fs').closeSync(require('fs').openSync('.env', 'a'))"` or use file-creation tool. |
| `cat .env >> .env.local` | Read with the file-read tool, write with the file-write tool. |
| `export FOO=bar` followed by another call | Pass via the command line on the same call: `npx cross-env FOO=bar npm run build` (or set in `.env`). PowerShell uses `$env:FOO`, bash uses `export FOO` — they don't share. |
| `ls`, `pwd`, `which X` | Use workspace tools (`list_dir`, etc.), not shell utilities. |

**Cardinal rules:**

1. **Prefer tool `cwd`** over `cd X && …`. `cd` does not persist across `run_in_terminal` calls and is not portable.
2. **For Node operations**, prefer `node -e "…"`; Node is available for frontend and backend scaffolds.
3. **For subfolder npm operations**, prefer `npm --prefix <folder> run <script>` over chained `cd`.
4. **Never combine `&&`, `||`, or `;` with shell built-ins** (`cd`, `export`, `set`); PowerShell and POSIX differ. `&&` may join real binaries (`node`, `npm`, `npx`, `func`).
5. **Path separators**: use forward slashes (`/`) in command paths; Node and modern Windows support them, while backslashes break bash and JSON strings in `node -e`.

Rewrite nonportable commands using these patterns.

---

## STEP 0: Read Plan & Validate — MANDATORY FIRST ACTION

**BEFORE execution**, read and validate plan:

| Task | Details |
|------|---------|
| Read `.azure/project-plan.md` | Load complete plan |
| Validate status | Must be `Approved`. If not, STOP — instruct user to run `azure-project-plan`. |
| Extract plan details | Routes, services, entity types, language, runtime, framework, **API Login**, structure, and **orchestration** for each service stack section (`## 2. Backend`, `## 3. Frontend`, …) |
| Extract design contract (if frontend) | If frontend planned, read Section 5 (Design System & UI). Extract `Component Library:`, `Style Direction:`, `Typography:`, Color Palette table, and Pages table (page → layout regions). Missing Section 5 or blank `Component Library:` → **STOP** until completed; Section 5 drives Rule 13 / Step 1 quality. |
| Read the approved HTML preview (if frontend) | If `.azure/.preview-temp/` exists, read `manifest.json`, each `<slug>.html`, and `theme.css`. These planning-approved visual sources govern layout, palette translation, and page regions. Reproduce with Frontend stack/Section 5 framework + library; never serve preview HTML. If `.azure/.preview-temp/` is missing for frontend plan, rely on Section 5. |
| Determine frontend needed | Frontend plans (SPA + API, Full-stack SSR, Static + API) require Step 1. |
| Update plan status | Set to `In Progress` |

> **✅ Checkpoint**: Plan loaded, status valid, status `In Progress`. For frontend, load `.azure/.preview-temp/` as visual reference.

---

## Execution Steps

> **Execution chronology** (frontend first, backend parallel):
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

**Goal**: Standalone frontend with mock data, generated and built. The integrate agent later wires it to the real backend. When `API Login` is `Yes`, include the login UI and auth state, but seed local identity so the preview lands on the main view (dashboard, feed), NOT the login page.

> ⚠️ **WORKING DIRECTORY (most-common scaffold failure)**: Every frontend command — `npm install`, `npx vite build`, `npm run build` — MUST run against the **frontend folder** (typically `services/web/`), never the workspace root. **Prefer the working-directory-independent form `npm --prefix services/web run <script>`** — `--prefix` loads the frontend's `package.json` no matter where the shell starts, so it can't accidentally run from the root. When using a binary directly (e.g. `npx vite build`), pass `cwd: "services/web"` on the same terminal call.

**References**:
- [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library region-token → primitive mapping, theming contract, icon contract, and state-coverage contract. **READ THIS FIRST — it is the contract between the plan's Section 6 and the JSX you ship.**
- [frontend-patterns.md](.github/agents/shared-references/frontend-patterns.md) for patterns and quality bar.
- [frontend-preview-steps.md](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md) for sub-steps (F1–F4), working directory rules, approval loop.

> **✅ Checkpoint**:
> 1. Frontend builds zero errors (`npm --prefix services/web run build` — cwd-independent; **never** a bare `npx vite build` from the workspace root)
> 2. No `any` types in `.ts`/`.tsx`
> 3. When `API Login` is `Yes`, local identity state is seeded so the app lands on main content on first load, with the signed-in user read from the seam (`api.getCurrentUser()`), not imported from `src/mocks/`
> 4. **API seam intact** — `src/api/` declares an `ApiClient` interface (never `type ApiClient = typeof mockClient`), the mock is declared as `ApiClient`, `src/api/index.ts` is the one-line swap point, and **no file outside `src/api/` imports `src/mocks/` or `mockClient`**. Reference data with no plan route (assignee names, the signed-in user) gets an `ApiClient` method backed by the mock — it is never imported directly. See [frontend-preview-steps.md](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md) → Load-bearing seam rule.
> 5. **No UX approval prompt** — the design was already approved during planning via `.azure/.preview-temp/`. Do NOT call `ask_user` for "do you approve this UI?".
> 6. **Preview-embeddable dev server** — `vite.config`'s `server` sets `host: true`, `allowedHosts: true`, `strictPort: false` (Angular: `--host 0.0.0.0 --disable-host-check`; Next.js: `-H 0.0.0.0`); the `dev`/`start` script serves and prints a `http://localhost:<port>/` URL (never `build --watch`); no `X-Frame-Options`/`frame-ancestors` meta CSP in `index.html`; and you did NOT start your own dev server or an auto-start dev task. The `open_frontend_preview_view` tool starts and owns the dev server for the **Approve UI** preview — these keep its webview iframe from hanging or rendering blank (which would leave the user unable to approve). See [frontend-preview-steps.md](.github/agents/azure-project-scaffold/references/frontend-preview-steps.md) → Preview compatibility.
> 7. **Quality bar (Rule 13)**: Every page imports primitives from the library named in plan Section 5's `Component Library:`; the app shell is wrapped in that library's theme provider with a brand ramp derived from Section 5's palette; every icon is a real library icon (no emoji, no SVG placeholders); every `form` region has a visible validation state; every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle. **Use the approved HTML mock-up at `.azure/.preview-temp/<slug>.html` as the layout/visual reference per page** — reproduce the same regions and tonal feel using the real library primitives, not by embedding the HTML. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md).

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
| Create `.gitignore` | Runtime-appropriate ignores (node_modules, data/, etc.). **Write it before any file that holds credentials** — `.env` and `local.settings.json` must be ignored from the first commit, never added and removed later. See architecture.md § .gitignore Additions |
| Create directory structure | `services/functions/`, `services/functions/src/utils/`, `services/shared/` (do NOT create `services/web/` — may exist from frontend generation) |

**Reference**: [architecture.md](.github/agents/shared-references/architecture.md)

> **✅ Checkpoint**:
> 1. **Build gate**: `npm run build` / `python -m py_compile` / `dotnet build`. Zero errors.
> 2. **Workspace build scripts**: If monorepo, verify every workspace has `build` script. Run in each. If produces `dist/`, verify non-empty.
> 3. **Shared package**: If `services/shared/` exists, verify: (a) `package.json` has `"exports"` or `"main"` pointing to compiled output, (b) `npm run build` produces `dist/` with `.js` and `.d.ts`, (c) other workspaces import without errors.
> 4. **Cross-workspace imports (CRITICAL)**: Run `tsc --noEmit` in every workspace importing shared. If `TS2307: Cannot find module` → exports broken. **Fix before proceeding.**
> 5. **rootDir and main field (CRITICAL)**: After `tsc`, **list actual dist/ contents**, verify `main` glob matches compiled handlers. If `rootDir: ".."`, output nests deeper. Fix `main`.
> 6. **Dependency split (deploy-readiness, Rule 13)**: Every package imported by runtime code lives in `dependencies`; build-only tooling (`typescript`, `@types/*`, test runners, bundlers) lives in `devDependencies`. A production install (`npm install --omit=dev`) must satisfy every `import` in `dist/` — this is what lets the deploy ship the prebuilt artifact without an Oryx rebuild.
> 7. **Emitted specifiers resolve (CRITICAL — after build, not `--noEmit`)**: `tsc` does **not** rewrite module specifiers on emit. Any non-relative import that only resolved through a tsconfig `paths` alias is still in `dist/` verbatim and dies at runtime with `Cannot find module`, even though checkpoints 1–6 all pass. **Do NOT use `paths` aliases for cross-workspace imports** — import the shared package by its `package.json` `name`, or use the relative `../shared/...` form. After building, verify every non-relative specifier in `dist/` actually resolves from that workspace (run from the workspace that emitted `dist/`):
>
> ```bash
> node --input-type=module -e "
> import fs from 'node:fs';
> import path from 'node:path';
> import {builtinModules, createRequire} from 'node:module';
> const bad=[];
> (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
>   const p=path.join(d,e.name);
>   if(e.isDirectory()) walk(p);
>   else if(e.name.endsWith('.js')) for(const m of fs.readFileSync(p,'utf8').matchAll(/(?:require\(|from\s*)['\x22]([^'\x22]+)['\x22]/g)){
>     const s=m[1];
>     if(s.startsWith('.')||s.startsWith('node:')||builtinModules.includes(s)) continue;
>     let ok=false;
>     try { createRequire(path.resolve(p)).resolve(s); ok=true; } catch {}
>     if(ok===false){ try { import.meta.resolve(s); ok=true; } catch {} }
>     if(ok===false) bad.push(p+' -> '+s);
>   }}})('dist');
> if(bad.length){ console.error('unresolvable specifiers in emitted output:'); bad.forEach(b=>console.error('  '+b)); process.exit(1); }
> console.log('all emitted specifiers resolve');
> "
> ```
>
> Three details in it are load-bearing — do not "simplify" them away:
> - **`path.resolve(p)`** — the walk builds paths relative to `dist/`, and `createRequire()` rejects a relative path with `ERR_INVALID_ARG_VALUE`. Swallowed by the `catch`, that reports **every** bare specifier as unresolvable, including real dependencies like `@azure/functions` — a check that reds on a healthy project gets ignored.
> - **The second `import.meta.resolve` attempt** — `createRequire().resolve()` resolves under the `require` condition only. A `"type": "module"` shared package whose `exports` declare `import` and not `require` resolves fine at runtime but not that way, so a single CJS attempt would red the very fix this checkpoint recommends. A specifier is only reported when **both** conditions fail, which still catches a genuinely unexported subpath.
> - **`['\x22]` rather than a literal `"`** — keeps the body free of double quotes so `node -e "…"` parses in PowerShell as well as bash (see the cross-platform cardinal rules above).
>
> ⚠️ **Pitfalls**: (1) Shared packages without build → `ERR_MODULE_NOT_FOUND`. (2) Wildcard exports fail TS resolution. (3) `rootDir: "."` blocks cross-workspace imports — use `".."` and update `main`. (4) tsconfig `paths` aliases (e.g. `@shared/*`) resolve at compile time only — `tsc --noEmit` passes and the emitted `dist/` still says `Cannot find module` at runtime.

---

### Step 3: Configuration & Environment

**Goal**: Config module that loads env vars with validation and safe defaults.

| Task | Details |
|------|---------|
| Create `config` module | `services/config.ts` / `services/config.py` / `Services/Config.cs` |
| Create `.env.example` | All required env vars with placeholders and comments |
| Create `local.settings.json` | Azure Functions local settings with emulator defaults and `"AZURE_FUNCTIONS_ENVIRONMENT": "Development"` so local provider selection is explicit |
| Implement env validation | Validate the variables required by the selected providers at startup. Missing or unknown environment means production, so missing production configuration fails fast. |
| Keep selection centralized | Read the environment once in the startup composition root. Application code receives interfaces and contains no environment checks. |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md)

> **✅ Checkpoint**: Config module loads env vars. `.env.example` documents all variables.

---

### Step 4: Service Abstraction Layer

**Goal**: Implement user-facing API authentication when selected, and isolate every Azure client behind local and managed-identity providers.

`API Login` is authoritative. Do not infer or override it. It controls application user login only; it never changes how backend services authenticate to Azure.

#### API login

When `API Login` is `Yes`, scaffold the complete frontend-to-API flow. When it is `No`, do not add login pages, auth endpoints, token middleware, mock users, or protected-route wrappers.

| Task | Details |
|------|---------|
| Define the auth interface | Model application behavior such as `createAccount(input)`, `login(credentials)`, `authenticate(request)`, and `getCurrentUser()`. Keep token and credential logic out of handlers and UI components. |
| Add the API flow | Add registration, login, and current-user endpoints even though the plan intentionally omits auth routes. Registration validates input, rejects duplicate accounts, and stores only a strong password hash. Protect every non-health, non-auth API route by default unless its product behavior is explicitly public. |
| Choose a stack-appropriate implementation | Reuse an existing auth system when present. Otherwise default to a REST login flow that verifies stored password hashes and issues a short-lived signed JWT. Verify signature, algorithm, issuer, audience, and expiry on every protected request. Require production signing configuration; never ship a hard-coded or generated-at-startup production secret. |
| Add the frontend flow | Add login, logout, current-user state, protected navigation, and authenticated API calls. The login page MUST contain a visible **Create account** button that opens a dedicated create-account page. The create-account page MUST submit to the registration flow, show field and duplicate-account errors, and return the user to login or establish the new session after success. Keep the token out of source code and fixture imports. Prefer an HttpOnly, Secure, SameSite cookie when the chosen stack supports it; otherwise keep a bearer token in memory rather than long-lived browser storage. |
| Test the boundary | Cover successful and failed account creation, duplicate accounts, successful and failed login, invalid/expired tokens, logout, current-user lookup, protected-route rejection, and authorization between users. |

Managed identity is not an end-user login mechanism. Never use a managed identity token as the application's user session.

#### Azure client providers

> ⚠️ **CRITICAL — DO NOT SKIP EITHER AZURE CLIENT IMPLEMENTATION**
>
> Every Azure client interface MUST have both an emulator-backed local implementation and a managed-identity production implementation. Select once at startup and inject the selected interface. Do not scatter `isDevelopment` checks through handlers or services.

| Task | Details |
|------|---------|
| Define the client-provider interface | Model only the Azure client behavior the application needs. Handlers and domain services depend on this interface, never an environment variable or credential. |
| Implement local behavior | Point the Azure SDK client at Azurite or the planned emulator. Never embed local selection inside the implementation. |
| Implement production behavior | Use the Azure resource endpoint with managed identity (`DefaultAzureCredential` or the runtime equivalent). Do not accept account keys, SAS tokens, or connection-string secrets for production Azure communication. |
| Select once at startup | A factory/composition root checks for the exact development marker, constructs the matching providers, validates endpoint configuration, and injects the interfaces. Missing or invalid production configuration fails startup. |
| Create service registry | `getServices()` MUST auto-initialize selected clients when nothing was pre-registered. ESM uses static imports or `await import()`, NOT `require()`. Enhancement construction follows Rule 9 without substituting a local provider. |
| Leave breadcrumbs | Use explicit names such as `AzuriteBlobClientProvider` and `ManagedIdentityBlobClientProvider`. Keep the interface, both implementations, and factory together; document settings in `.env.example`; set the development marker in `local.settings.json`. |

**Reference**: [service-abstraction.md](.github/agents/shared-references/service-abstraction.md)

> **📋 File Verification** — Before checkpoint, verify on disk:
>
> When `API Login` is `Yes`:
> - [ ] auth interface and implementation
> - [ ] registration, login, and current-user endpoints
> - [ ] frontend login/session flow, including a visible **Create account** button and dedicated create-account page
> - [ ] authentication and authorization tests
>
> For each Azure service in the plan:
> - [ ] `src/services/interfaces/I{Service}Service.ts` — interface
> - [ ] local client provider — emulator behavior
> - [ ] production client provider — Azure endpoint plus managed identity
>
> Additionally:
> - [ ] `src/services/registry.ts` — `initializeServices()` selects Azure client providers once and constructs them
> - [ ] `getServices()` calls `initializeServices()` when `services === null` (lazy auto-init)
> - [ ] application code depends only on auth/client interfaces and contains no Azure-client environment checks
> - [ ] client selection tests prove explicit Development uses emulators, missing/other values use managed identity, and invalid production config fails
>
> **If an API Login flow is incomplete or either Azure client implementation is missing, DO NOT proceed.**

> **✅ Checkpoint**: All interfaces, concrete implementations, and registry exist. `getServices()` auto-initializes. `tsc` zero errors.

---

### Step 5: Shared Types & Validation Schemas

**Goal**: Type-safe contracts between frontend and backend, with validation covering every endpoint.

| Task | Details |
|------|---------|
| Create shared types | Entity types, API request/response contracts in `services/shared/` |
| Create auth contracts when selected | When `API Login` is `Yes`, add credential, session/current-user, and login response types without exposing password hashes or signing secrets |
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

When `API Login` is `Yes`, implement the derived auth endpoints and middleware before the plan's feature routes. The plan omits auth route details by design; this is the one allowed addition to its route inventory. Protect feature routes according to the Step 4 API login rule.

For **each** route in plan:

| Task | Details |
|------|---------|
| Create function handler | One file per function. **All async calls MUST include `await`**. **`handleError` calls MUST match standardized signature**. |
| Use transactions for multi-table writes | Any handler writing 2+ tables MUST use `database.transaction()` |
| Wrap Enhancement services | External services classified Enhancement MUST have try/catch with fallback (see [resilience.md](.github/agents/shared-references/resilience.md)) |
| Validate file uploads server-side | Check file size and MIME type before processing |
| Validate path params before DB queries | When the auth service supplies a user ID, **validate its format** (e.g., UUID) before a DB query. A malformed ID on a typed column causes 500 instead of 401. |
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
| **Write the integration artifact** | Write `.azure/integration-plan.md` — the hand-off brief the `azure-project-integrate` agent consumes. Include: backend folder + run command + port + health path; frontend folder + build/dev commands + the **API seam to swap** (`services/web/src/api/index.ts` — repoint from `mockClient` to the live client) plus the **mock files to delete** (`src/api/mockClient.ts`, `src/mocks/*`, local mock types, and the dev-only Mock State Switcher `src/api/previewState.ts` + its corner-switcher component); the full API route inventory (method + path) so the live client mirrors the `ApiClient` interface method-for-method; when `API Login` is `Yes`, the registration, login, and current-user endpoints, auth middleware, create-account and session files, and required signing configuration; the database type + migration tool + migration directory + connection env vars (state explicitly that **NO seed data** is to be created); the shared-types package + import alias; the service list (Essential vs Enhancement). Keep it concise — paths and commands, not prose. |
| **Open the frontend preview & UI-approval gate** | **Only when the plan has a frontend AND not in autopilot.** Call the `open_frontend_preview_view` tool with `{ "frontendFolder": "services/web" }`. Set `frontendFolder` only when it isn't the default `services/web` (e.g. a product-named app); otherwise call with `{}`. This opens a webview that starts the frontend dev server and renders the **running app (mock data)** in an iframe, with an **Approve UI** header and a feedback box — mirroring the plan-approval UX. **The webview owns the hand-off**: clicking **Approve UI** triggers `copilotOnRails.startProjectIntegrate` itself, and the feedback box re-opens this scaffold agent with the user's UI change requests (the dev server hot-reloads as you edit). After opening the gate, **STOP** — do NOT also call `start_project_integrate`, do NOT call `vscode_askQuestions`. If the plan has **no frontend**, skip this row and use the direct hand-off row below. |
| **Hand off to the Integrate agent** | **Use this row only when there is NO frontend, or in autopilot mode** (the preview gate is skipped). Call the `start_project_integrate` tool with no arguments (`{}`). This starts a **new chat session** running `azure-project-integrate`, which reads the artifact and its instruction file to wire the frontend to live data, smoke-test the backend, create the migrations, and verify end-to-end. Do **NOT** call `vscode_askQuestions` — the hand-off is the next step. |

> **✅ Final Checkpoint**:
> 1. **Build**: `npm run build` every workspace. `dist/` has output. Zero errors.
> 2. **Preview cleanup**: `.azure/.preview-temp/` no longer exists.
> 3. **Status**: `.azure/project-plan.md` = `Awaiting Integration`.
> 4. **Integration artifact**: `.azure/integration-plan.md` written with the integrate agent's brief.
> 5. **Hand-off**: For a project **with a frontend** (interactive mode), opened the UI-approval gate via the `open_frontend_preview_view` tool and stopped — the gate's **Approve UI** button performs the hand-off. For a **no-frontend** project (or autopilot), started the `azure-project-integrate` session via the `start_project_integrate` tool. Either way, did NOT call `vscode_askQuestions` or print next-step suggestions.

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
| **Next step** | If the plan has a frontend: open the UI-approval gate via the `open_frontend_preview_view` tool (its **Approve UI** button hands off). Otherwise: hand off directly via the `start_project_integrate` tool |

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

> After scaffolding completes, write `.azure/integration-plan.md`. **If the plan includes a frontend (and you are not in autopilot), open the UI-approval gate via the `open_frontend_preview_view` tool** — it shows the running frontend (mock data) in a webview with an **Approve UI** header + feedback box, and its Approve button performs the integrate hand-off for you, so do NOT also call the `start_project_integrate` tool. For a no-frontend project (or autopilot), hand off directly to the `azure-project-integrate` agent via the `start_project_integrate` tool (Step 11). Do NOT ask the user what to do next — do NOT call `vscode_askQuestions` (or any chat question API), and do NOT print plain-text follow-up suggestions. The integrate agent takes over from here.
