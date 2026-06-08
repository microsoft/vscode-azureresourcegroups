---
name: azure-project-plan
description: "Plan and design an Azure-centric project with user requirements gathering and interactive plan approval. Generates .azure/project-plan.md, then auto-chains to azure-project-scaffold. WHEN: \"plan project\", \"design app\", \"new project\", \"project requirements\", \"create project plan\", \"plan my app\", \"what should I build\", \"scaffold project\", \"new Azure app\", \"create testable app\", \"new API project\", \"full-stack Azure app\", \"new project with tests\", \"create app\", \"bootstrap project\", \"new fullstack project\", \"testable API\", \"create functions project\"."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan

> **AUTHORITATIVE — MANDATORY.** Canonical source for planning Azure-centric apps. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

**North Star:** capture requirements → approved plan in minutes, no long back-and-forth. After approval, auto-chain to `azure-project-scaffold`.

## Triggers
Plan/design a new Azure-centric app; create requirements/architecture; start a project from scratch; full-stack Azure Functions app; testable API with Azure services; bootstrap Functions + frontend.

## ❌ Do NOT activate — route instead
| User intent | Correct skill |
|-------------|---------------|
| Execute plan / scaffold backend | **azure-project-scaffold** |
| Docker Compose, emulators, VS Code F5 | **azure-localdev** |
| Add test coverage | **azure-project-test** |
| Deploy to Azure / generate Bicep/Terraform | **azure-prepare** |
| Benchmark scaffold quality | **scaffold-benchmark** |

## Rules
1. **Plan first** — create `.azure/project-plan.md` before any code. No `src/`, configs, or project files until the user approves. Only file allowed: `.azure/project-plan.md`.
2. **Resilience classification** — classify each service **Essential** (fails without it) or **Enhancement** (succeeds with fallback). See Quick Reference.
3. **Auto-chain after approval** — immediately invoke `azure-project-scaffold`; never ask the user to invoke it manually; do NOT generate a frontend preview (scaffold handles it).
4. **Interactive UI** — use `vscode_askQuestions`, never plain chat; batch unanswered questions into one call.

## Workflow (mandatory order)
DETECT (Step 1) → GATHER (Step 2) → GENERATE `.azure/project-plan.md` + approval (Step 3) → AUTO-CHAIN scaffold after approval. Only file allowed: `.azure/project-plan.md` — no `src/`, configs, or code. Planning needs ZERO external file reads; all context is inlined below.

## ═══════════════════════════════════════════════════
## PHASE 1: PLANNING
## ═══════════════════════════════════════════════════

### Step 1: Detect Workspace

**BEFORE gathering requirements**, scan workspace:

#### 1a. Scan for Existing Project Files

| Signal | Detection Method | Action |
|--------|-----------------|--------|
| `package.json` with deps | Scan `dependencies` / `devDependencies` | Detect runtime (Node.js), frameworks, test runners |
| `pyproject.toml` or `requirements.txt` | Scan for Python | Detect runtime (Python), frameworks |
| `*.csproj` or `*.sln` | Scan for .NET | Detect runtime (.NET), frameworks |
| `host.json` or `local.settings.json` | Scan root/src dirs | Azure Functions exists — augment, don't recreate |
| Test files or config | Scan for `*.test.*`, `*.spec.*`, `vitest.config.*`, `jest.config.*` | Detect test infra — respect it |
| `docker-compose.yml` | Scan root | Emulators may be configured |

> ⚠️ Check actual **workspace files** — not user prompt.

#### 1b. Check for `.azure/plan.md` (Deployment Plan)

| Check | Action |
|-------|--------|
| `.azure/plan.md` exists | **Read it.** Extract Architecture → service mapping. Use these — do NOT re-ask user. |
| `.azure/plan.md` does not exist | Proceed normally — detect from code, ask user as needed. |

> **✅ Checkpoint**: Workspace scanned. Mode determined (NEW / AUGMENT). Tech stack detected.

---

### Step 2: Gather Requirements

Infer everything possible from the Step 1 scan; gather the rest through the requirements webview — never in chat.

> 🚫 **DO NOT call `vscode_askQuestions`.** All user input comes through the `.azure/requirements.json` file rendered by the requirements webview. Asking in chat (via `vscode_askQuestions` or plain text) breaks the flow.

#### 2a. Inference — pick the most likely answer for every question

For each canonical question (Q1–Q6), use the Step 1 scan + the user's prompt to fill:

- **`answer`** — the inferred value when confident, else `null` (`[]` for the array-typed Q3).
- **`recommendedChoice`** — always provide one (string for Q1/Q2/Q4/Q5/Q6, `string[]` for Q3); becomes the **pre-selected** option in the webview, even for `needs_input`.

Then set **`status`**:

- **`inferred`** — confidently known from workspace signals or an explicit user statement. Set `answer` + `rationale`; the webview pre-selects the inferred value for review/override.
- **`needs_input`** — not confidently known. Leave `answer` `null` (`[]` for Q3); the webview pre-selects your `recommendedChoice` to confirm or change.

| If you detect... | Then infer... |
|-----------------|---------------|
| `.azure/plan.md` exists | Read it — extract all Azure services. Authoritative. |
| `@azure/storage-blob` import | App uses Blob Storage |
| `@azure/cosmos` import | App uses CosmosDB |
| `pg` or `psycopg2` import | App uses PostgreSQL |
| `redis` or `ioredis` import | App uses Redis |
| `react` in dependencies | Frontend = React |
| `vue` in dependencies | Frontend = Vue |
| `@angular/core` in dependencies | Frontend = Angular |
| `svelte` in dependencies | Frontend = Svelte |
| `vitest` in devDependencies | Test runner = vitest |
| `jest` in devDependencies | Test runner = jest |
| `mocha` in devDependencies | Test runner = mocha+chai+sinon |
| `host.json` exists | Azure Functions already initialized — augment mode |
| `zod` in dependencies | Validation library = zod |
| `host.json` + `dotnet-isolated` worker runtime | Runtime = C#; Backend = Azure Functions isolated worker; Orchestration = docker-compose |

Anything the user stated explicitly in their prompt ("build me a TypeScript Functions API with PostgreSQL") is also `inferred` — don't re-ask.

#### 2b. The six canonical questions

Always emit **all six** in JSON, in this order, regardless of status. Each option is `{ label, description }` (label = the value picked; description = one-line muted hint). `multiSelect: true` lets the user tick more than one; `allowFreeformInput: false` for questions where free text is meaningless (e.g. runtime).

| # | `id`            | `category`  | `header`              | `question`                                              | Multi-select | Free-form input | `options` (label + description)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Sensible default for `recommendedChoice`                                       |
|---|-----------------|-------------|-----------------------|---------------------------------------------------------|--------------|-----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| 1 | `appType`       | `app`       | App Type              | What type of application are you building?              | no           | yes             | `API only` (Backend services without a UI), `SPA + API` (Single-page app with REST/GraphQL backend), `Full-stack SSR` (Server-rendered pages plus API), `Static site + API` (Pre-built static frontend with serverless API), `Background worker` (Headless queue/timer-driven worker)                                                                                                                                                                                                                                                                                          | `SPA + API`                                                                   |
| 2 | `runtime`       | `runtime`   | Runtime               | Which runtime language?                                 | no           | no              | `TypeScript` (Node.js + TypeScript on Azure Functions), `Python` (Python on Azure Functions), `C# (.NET)` (Isolated worker on .NET 10)                                                                                                                                                                                                                                                                                                                                                                                                                                       | `TypeScript`                                                                  |
| 3 | `dataStores`    | `data`      | Data Stores           | Which data stores does your app need?                   | **yes**      | no              | `Blob Storage` (Store files and images), `Queue Storage` (Async message queue), `PostgreSQL` (Relational database), `CosmosDB` (NoSQL document database), `Redis` (In-memory cache), `Azure SQL` (Managed SQL Server)                                                                                                                                                                                                                                                                                                                                                          | Best-guess subset (e.g. `["PostgreSQL"]`)                                     |
| 4 | `frontend`      | `frontend`  | Frontend Framework    | Which frontend framework?                               | no           | no              | `React` (React + Vite), `Vue` (Vue + Vite), `Angular` (Angular CLI), `Svelte` (Svelte + Vite), `None` (No frontend)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `React`                                                                       |
| 5 | `features`      | `app`       | Features              | Describe the features or API routes your app needs.    | no           | n/a             | *(omit `options` — free-text question, no choices)*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Short description distilled from the user's prompt                            |
| 6 | `auth`          | `auth`      | Authentication        | Does your app need authentication?                      | no           | **yes (always)** | `No auth` (Public app, no login required), `Mock auth middleware` (HMAC-signed test tokens — testable without an IdP), `Microsoft Entra ID` (Workforce identity — formerly Azure AD; sign in with org/Microsoft accounts), `Microsoft Entra External ID` (Customer identity — formerly Azure AD B2C; sign-up + social logins), `Auth0` (Third-party IdP — social + enterprise connections), `Clerk` (Drop-in user management with prebuilt UI)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `Mock auth middleware` if the app exposes user data, else `No auth`           |

**`recommendedChoice` — always provide one, even for `inferred`:** for `inferred`, usually equal to `answer`; for `needs_input`, your best guess (bias to the most common Azure-friendly choice) so the user can review-and-submit; for `dataStores` it's a `string[]` matching the `answer` shape.

> ❌ **DO NOT** ask the user which .NET version to target. If Q2 = `C# (.NET)`, the target framework is **always `net10.0`** (with `global.json` pinned to `10.0.*`). Only downgrade when the user **explicitly and unambiguously** states an older version (e.g. "target .NET 8", "we need net9.0", "stuck on 8.0 LTS"). Do not interpret "use a stable version" / "use LTS" / "use what you have installed" as a request for an older framework — default to 10.

#### 2c. Write `.azure/requirements.json`

Write the file at `.azure/requirements.json` (no leading dot on the filename — this is the path the extension's file watcher matches). Use this exact top-level shape:

```json
{
  "schemaVersion": "1",
  "generatedAt": "{ISO date, e.g. 2026-06-02}",
  "mode": "{NEW | AUGMENT}",
  "summary": "{1–2 sentences describing what the user is building, in your own words}",
  "workspaceSignals": {
    "decision": "{NEW | AUGMENT}",
    "decisionReason": "{one sentence on why}",
    "detectedFiles": ["{relative paths from Step 1, if any}"]
  },
  "questions": [
    {
      "id": "appType",
      "category": "app",
      "header": "App Type",
      "question": "What type of application are you building?",
      "multiSelect": false,
      "allowFreeformInput": true,
      "options": [
        { "label": "API only", "description": "Backend services without a UI" },
        { "label": "SPA + API", "description": "Single-page app with REST/GraphQL backend" },
        { "label": "Full-stack SSR", "description": "Server-rendered pages plus API" },
        { "label": "Static site + API", "description": "Pre-built static frontend with serverless API" },
        { "label": "Background worker", "description": "Headless queue/timer-driven worker" }
      ],
      "recommendedChoice": "SPA + API",
      "status": "needs_input",
      "answer": null,
      "rationale": "User's prompt mentions a frontend plus REST endpoints."
    },
    {
      "id": "runtime",
      "category": "runtime",
      "header": "Runtime",
      "question": "Which runtime language?",
      "multiSelect": false,
      "allowFreeformInput": false,
      "options": [
        { "label": "TypeScript", "description": "Node.js + TypeScript on Azure Functions" },
        { "label": "Python", "description": "Python on Azure Functions" },
        { "label": "C# (.NET)", "description": "Isolated worker on .NET 10" }
      ],
      "recommendedChoice": "TypeScript",
      "status": "inferred",
      "answer": "TypeScript",
      "rationale": "Detected `package.json` with TypeScript devDependency."
    },
    {
      "id": "dataStores",
      "category": "data",
      "header": "Data Stores",
      "question": "Which data stores does your app need?",
      "multiSelect": true,
      "allowFreeformInput": false,
      "options": [
        { "label": "Blob Storage", "description": "Store files and images" },
        { "label": "Queue Storage", "description": "Async message queue" },
        { "label": "PostgreSQL", "description": "Relational database" },
        { "label": "CosmosDB", "description": "NoSQL document database" },
        { "label": "Redis", "description": "In-memory cache" },
        { "label": "Azure SQL", "description": "Managed SQL Server" }
      ],
      "recommendedChoice": ["Blob Storage", "PostgreSQL"],
      "status": "inferred",
      "answer": ["Blob Storage", "PostgreSQL"],
      "rationale": "Photo files map to Blob Storage; users, couples, photo metadata, and AI captions are relational and best modeled in PostgreSQL."
    },
    {
      "id": "frontend",
      "category": "frontend",
      "header": "Frontend Framework",
      "question": "Which frontend framework?",
      "multiSelect": false,
      "allowFreeformInput": false,
      "options": [
        { "label": "React", "description": "React + Vite" },
        { "label": "Vue", "description": "Vue + Vite" },
        { "label": "Angular", "description": "Angular CLI" },
        { "label": "Svelte", "description": "Svelte + Vite" },
        { "label": "None", "description": "No frontend" }
      ],
      "recommendedChoice": "React",
      "status": "needs_input",
      "answer": null,
      "rationale": "React is the most common pick for SPA + API on Azure."
    },
    {
      "id": "features",
      "category": "app",
      "header": "Features",
      "question": "Describe the features or API routes your app needs.",
      "multiSelect": false,
      "recommendedChoice": "Auth, pairing, photo upload/list/delete, AI captions with fallback, scrapbook UI",
      "status": "inferred",
      "answer": "Auth, pairing, photo upload/list/delete, AI captions with fallback, scrapbook UI",
      "rationale": "Distilled from the user's prompt."
    },
    {
      "id": "auth",
      "category": "auth",
      "header": "Authentication",
      "question": "Does your app need authentication?",
      "multiSelect": false,
      "allowFreeformInput": true,
      "options": [
        { "label": "No auth", "description": "Public app, no login required" },
        { "label": "Mock auth middleware", "description": "HMAC-signed test tokens — testable without an IdP" },
        { "label": "Microsoft Entra ID", "description": "Workforce identity — sign in with org or Microsoft accounts (formerly Azure AD)" },
        { "label": "Microsoft Entra External ID", "description": "Customer identity — sign-up plus social logins (formerly Azure AD B2C)" },
        { "label": "Auth0", "description": "Third-party IdP — social and enterprise connections" },
        { "label": "Clerk", "description": "Drop-in user management with prebuilt UI" }
      ],
      "recommendedChoice": "Mock auth middleware",
      "status": "needs_input",
      "answer": null,
      "rationale": "App handles user data — start with mock auth so every protected route is testable without an external IdP; pick a real IdP (Entra ID, External ID, Auth0, Clerk) or type your own when you're ready."
    }
  ]
}
```

**Rules for the JSON:**

- Always emit all six questions in `id` order: `appType`, `runtime`, `dataStores`, `frontend`, `features`, `auth`. Never omit one.
- Always include a short `header` (column heading style — "App Type", "Data Stores") plus the full `question` text.
- Always include `multiSelect` (boolean). Only Q3 (`dataStores`) is `true`; the rest are `false`.
- Always include `allowFreeformInput` (boolean) for questions that have `options`. The value per question is fixed — do not change it based on the user's prompt:
  - `appType` → `true`
  - `runtime` → `false`
  - `dataStores` → `false`
  - `frontend` → `false`
  - `auth` → **`true`** (users frequently want a real IdP like Entra ID, Auth0, Clerk, Firebase Auth, etc. — never emit `false` here, even when one of the listed options seems to fit; if you find yourself writing `"allowFreeformInput": false` for `auth`, stop and re-read this rule)
  For Q5 `features` (free text, no `options`), omit `allowFreeformInput` entirely.
- Use the field name **`rationale`** (not `reason`, not `why`, not `explanation`). The webview parser falls back to `reason` for resilience, but `rationale` is canonical — always write `rationale`.
- Always include `options` (array of `{ label, description }`), except for Q5 `features`, which omits `options` so the webview renders a textarea.
- Every option object must have a `label` (the value the user picks) and a short `description` (one phrase, displayed in muted text under the label).
- Always include `recommendedChoice`. For single-select questions it's a string; for `dataStores` it's a `string[]`. The webview pre-selects it so the user just reviews and submits.
- For `inferred` questions, fill in `answer` with the actual value (a string for Q1/Q2/Q4/Q5/Q6, a `string[]` for Q3). For `needs_input` questions, set `answer: null` (or `[]` for Q3).
- Q3 (`dataStores`) is the only multi-select question — `answer`, `recommendedChoice`, and any future submitted answer are always `string[]`. Use `[]` for `answer` when `needs_input` (never `null`).
- Q5 (`features`) is free text. Omit both `options` and `allowFreeformInput`. When `inferred` from the user's prompt, store the description verbatim in both `answer` and `recommendedChoice`.
- Strict JSON — no comments in the actual file, no trailing commas.

#### 2d. Hand off to the webview — then stop

Once the file is written, **stop**. Do NOT print the JSON, summarize inferences, ask anything in chat, or proceed to Step 3. The agent's workflow rules open the requirements webview after this write; the user fills the `needs_input` questions and clicks **Submit**. The requirements controller writes the file back (statuses → `confirmed`) and re-invokes this agent saying the requirements are ready.

#### 2e. Skip rule — only when the prompt is fully unambiguous

If the prompt was extremely explicit (e.g. *"Azure Functions TypeScript API with PostgreSQL — no frontend, no auth, routes GET /widgets and POST /widgets"*) and every Q1–Q6 is `inferred` in Step 2a, you **may** skip writing `.azure/requirements.json` and go straight to Step 3. When in doubt, **write the file** — review is fast and cheap.

#### 2f. Re-entry — reading the answered file

When re-invoked with a query mentioning submitted requirements (e.g. *"Requirements submitted at .azure/requirements.json..."*), or whenever `.azure/requirements.json` has all questions `confirmed`/`inferred`:

1. Read `.azure/requirements.json`.
2. Treat `answer` fields as authoritative — do not re-ask, do not re-emit the file.
3. Go directly to Step 3 (Generate Plan).

> **✅ Checkpoint**: Requirements gathered (via inference + webview submission). Ready to generate plan.

---

### Step 3: Generate Plan & Present for Approval

Write `.azure/project-plan.md` from the template below in a **single pass** (fill all sections at once — never section-by-section), then present for approval.

#### Plan Template

`.azure/project-plan.md` structure (replace all `{placeholders}`):

````markdown
# Project Plan

**Status**: Planning
**Created**: {date}
**Mode**: {NEW | AUGMENT}

---

## 1. Project Overview

**Goal**: {Brief description of what the user is building}. The project is designed so that every module is independently testable.

**App Type**: {API only | SPA + API | Full-stack SSR | Static + API | Background worker}

**Mode**: {NEW | AUGMENT}

**Deployment Plan**: {`.azure/plan.md` found — services derived from deployment plan | No deployment plan found}

---

## 2. Runtime & Framework

| Component | Technology |
|-----------|-----------|
| **Runtime** | {TypeScript / Python / C#} |
| **Backend** | {Azure Functions v4 / Azure Functions v2 / Azure Functions isolated worker} |
| **Orchestration** | docker-compose |
| **Frontend** | {React + Vite / Vue + Vite / Angular / Svelte / None} |
| **Package Manager** | {npm / pnpm / pip / poetry / dotnet} |

---

## 3. Test Runner & Configuration

| Component | Technology |
|-----------|-----------|
| **Test Runner** | {vitest / jest / pytest / xUnit} |
| **Mocking Library** | {vi.mock / jest.mock / sinon / unittest.mock / **NSubstitute** (.NET — never Moq, see runtimes/dotnet.md)} |
| **Test Command** | {npm test / pytest / dotnet test} |

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| {Blob Storage} | {Store uploaded images} | {STORAGE_CONNECTION_STRING} | {UseDevelopmentStorage=true} | {Essential} |
| {PostgreSQL} | {Primary data store} | {DATABASE_URL} | {postgresql://localdev:localdevpassword@localhost:5432/appdb} | {Essential} |

---

## 5. Design System & UI

> **MANDATORY when the plan includes a frontend.** Skip only for `API only` / `Background worker` app types. The plan-preview webview parses this section by title (`s.title.toLowerCase().includes('design system')`) and the scaffold quality contract reads `Component Library:` to decide which real library primitives to render.

**Component Library**: {Fluent UI v9 / Vuetify 3 / Skeleton UI / Angular Material / Pico.css — see PLANNING QUICK REFERENCE → Component Library Defaults}
**Style Direction**: {1–2 sentence design intent, e.g. "Modern data-dense console with subtle elevations, rounded 4px corners, and an emphasis on scannable lists."}
**Typography**: {Inter, system-ui / Roboto / Segoe UI Variable}

### Color Palette

> **Pick hex values that fit the project.** Use `Style Direction` above plus any brand cues from the user's prompt (industry, mood, named colors, existing logos) to choose colors. The values in `{}` below are FALLBACK defaults — only keep them verbatim when the project has no brand or style direction (e.g. generic internal tooling). Token names (`primary`, `accent`, `surface`, `text`, `muted`, `border`) are fixed — do NOT rename or add tokens; the scaffold's quality contract and preview theming key off these exact names.

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `{#0078D4}` | Brand color, primary buttons, links |
| `accent` | `{#5C2D91}` | Secondary accents, highlights |
| `surface` | `{#FAFAFA}` | Page backgrounds |
| `text` | `{#1F1F1F}` | Body text |
| `muted` | `{#767676}` | Secondary text, captions |
| `border` | `{#E5E5E5}` | Dividers, input borders |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| {Dashboard} | `/` | {Overview of recent activity} | `header + hero + grid + footer` |
| {Page name} | `{/route}` | {one-line purpose} | `{region tokens, e.g. header + sidebar + main + footer}` |

> **Layout tokens are layout INTENT, not implementation.** The scaffold agent renders them using `Component Library` primitives per the scaffold skill's `frontend-quality-bar.md`. Recognized tokens: `header, nav, sidebar, hero, main, list, card-list, grid, form, table, actions, action-bar, tabs, modal, footer`. Compound tokens: `split(a|b)` (1:2 columns), `two-column(a+b)` (1:1 columns).

---

## 6. Project Structure

```
{Generated directory tree — see Canonical Structure in SKILL.md}
```

---

## 7. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check | — | `{ status, services }` | None | 200, 503 |
| {n} | {METHOD} | {/api/path} | {description} | {body or —} | {response shape} | {auth} | {codes} |

---

## 8. Execution Checklist

> The detailed execution checklist is auto-generated by `azure-project-scaffold` when it begins execution. It copies this section's high-level phases and expands them into step-by-step items with build gates.

### High-Level Phases
- [ ] Step 1: Frontend Preview (if applicable — first visible feedback; runs in parallel with backend Phase A/B)
- [ ] Step 2: Foundation (project config, directory structure, build verification)
- [ ] Step 3: Configuration & Environment (config module, .env, local.settings.json)
- [ ] Step 4: Service Abstraction Layer (interfaces + concrete implementations + registry)
- [ ] Step 5: Database Schema & Migrations (if applicable)
- [ ] Step 6: Shared Types & Validation Schemas
- [ ] Step 7: API Routes / Functions (one handler per route)
- [ ] Step 8: Error Handling Middleware
- [ ] Step 9: Health Check Endpoint
- [ ] Step 10: OpenAPI Contract
- [ ] Step 11: Structured Logging
- [ ] Step 12: Wire Frontend (if applicable — replace mock data/types with real backend)
- [ ] Step 13: Wrap Up & Smoke Test

> Scaffold-time concerns (database constraints, collection-to-table mapping, test suite plan, file-by-file generation list) are NOT part of the plan — they are produced by `azure-project-scaffold` from this plan + its own reference docs (`database-integrity.md`, `service-abstraction.md`). The plan only commits to **what** is built; the scaffold handles **how**.

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-test** to add test coverage and validate the build
3. Run **azure-localdev** for Docker emulators and VS Code debugging
4. Run **azure-prepare** → **azure-deploy** when ready to deploy
````

#### After Writing the Plan

1. **Present plan**, ask for approval
2. If approved, update status from `Planning` to `Approved`
3. **Immediately invoke `azure-project-scaffold`** (auto-chain). Do NOT ask user to invoke manually. Do NOT generate frontend preview — `azure-project-scaffold` handles it.

> **❌ STOP** — Do NOT proceed past approval until user approves. Once approved, auto-chain immediately.

---

## ═══════════════════════════════════════════════════
## PLANNING QUICK REFERENCE (Inlined — No External Reads)
## ═══════════════════════════════════════════════════

> All architectural context for planning. **Do NOT read external reference files during Phase 1.**

### Service-to-Environment-Variable Mapping

| Azure Service | Environment Variable | Local Default |
|---------------|---------------------|---------------|
| Blob Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Queue Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Table Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| PostgreSQL | `DATABASE_URL` | `postgresql://localdev:localdevpassword@localhost:5432/{dbname}` |
| CosmosDB | `COSMOSDB_CONNECTION_STRING` | `AccountEndpoint=https://localhost:8081/;AccountKey=...` |
| Redis | `REDIS_URL` | `redis://localhost:6379` |
| Azure SQL | `SQL_CONNECTION_STRING` | `Server=localhost,1433;Database={db};...` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` | _(no local emulator)_ |

> ⚠️ **.NET runtime override (C# Functions):** .NET scaffolds use the standard `ConnectionStrings:*` config convention (read via `IConfiguration.GetConnectionString("...")`), **NOT** the generic env var names above. When the selected runtime is `csharp`, translate the table above as follows:
>
> | Generic env var | .NET config key |
> |-----------------|-----------------|
> | `STORAGE_CONNECTION_STRING` | `ConnectionStrings:Storage` |
> | `DATABASE_URL` | `ConnectionStrings:AppDb` |
> | `REDIS_URL` | `ConnectionStrings:Redis` |
> | `COSMOSDB_CONNECTION_STRING` | `ConnectionStrings:Cosmos` |
> | `SQL_CONNECTION_STRING` | `ConnectionStrings:Sql` |
> | `AZURE_OPENAI_ENDPOINT` / `_API_KEY` | `OpenAI:Endpoint` / `OpenAI:ApiKey` (typed `IOptions<T>`) |
>
> In production, the `ConnectionStrings:*` values should be **resource URIs** (e.g., `https://<account>.blob.core.windows.net`) authenticated via `DefaultAzureCredential` (Managed Identity) — never raw account keys. See [runtimes/dotnet.md](../../shared-references/runtimes/dotnet.md#managed-identity--quick-reference) for the full mapping.

### Essential vs Enhancement Classification

| Type | Definition | Failure Behavior | Examples |
|------|-----------|-----------------|---------|
| **Essential** | Request cannot succeed without this service | Propagate error (4xx/5xx) | Database, auth provider, primary storage |
| **Enhancement** | Request can succeed with degraded output | Catch error, use fallback, log warning | AI captions, email notifications, analytics |

> **Key rule**: Enhancement service constructors MUST NOT throw. Defer config validation to method calls or wrap in try/catch.

### Component Library Defaults (Section 5 of the plan)

> **Pick the default for the user's frontend framework** unless the user explicitly named a different library. The chosen value goes into Section 5 verbatim as `**Component Library**: {value}` and becomes the load-bearing input for the scaffold quality contract (see scaffold skill `references/frontend-quality-bar.md`).

| Frontend (Q4) | Default `Component Library` | Reasonable alternatives | Use the default unless... |
|---------------|----------------------------|------------------------|---------------------------|
| `React` | **Fluent UI v9** (`@fluentui/react-components`) | shadcn/ui + Radix, Material UI v6, Chakra UI v3 | user explicitly names one of the alternatives, OR project already has another library installed |
| `Vue` | **Vuetify 3** | PrimeVue 4, Element Plus | user explicitly names one |
| `Svelte` | **Skeleton UI** | Melt UI + Tailwind | user explicitly names one |
| `Angular` | **Angular Material** | PrimeNG | user explicitly names one |
| `None` (plain HTML / Static + API) | **Pico.css** + native form controls | Bulma, water.css | user explicitly names one |
| `None` + `Background worker` | omit Section 5 entirely | \u2014 | always omit when there is no UI |

> **Why this matters**: Without `Component Library:`, the scaffold step treats the wireframe's region tokens (`header`, `hero`, `grid`, ...) as raw layout instructions and produces blocky placeholder `<div>` JSX that LOOKS worse than the plan-preview wireframe. With `Component Library:` set, the scaffold renders each region using real library primitives (cards, tabs, fields, toolbars, message bars) themed by the Color Palette.

> **Plan-preview note**: The plan-preview webview always renders the Section 5 wireframe in Fluent UI v9 (it's the only library bundled). When `Component Library` is anything other than Fluent UI v9, the preview shows a small footnote disclosing this. The scaffolded app still uses the library named in the plan.

### Error Response Contract

All error responses follow this shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Item not found", "details": null } }
```

| Error Code | HTTP Status | When |
|------------|-------------|------|
| `VALIDATION_ERROR` | 422 | Request body fails validation |
| `BAD_REQUEST` | 400 | Malformed request |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate resource |
| `UNAUTHORIZED` | 401 | Missing/invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

### Canonical Project Structure (TypeScript — SPA + API)

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                    ← Root workspace config
├── src/
│   ├── functions/                  ← Azure Functions project
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── functions/          ← One handler per file
│   │   │   ├── services/           ← Service abstraction layer
│   │   │   │   ├── interfaces/     ← Service contracts
│   │   │   │   ├── config.ts       ← Config loader + validation
│   │   │   │   └── registry.ts     ← Service factory / DI
│   │   │   ├── errors/             ← Error types and middleware
│   │   │   └── middleware/
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   ├── mocks/
│   │   │   ├── services/
│   │   │   ├── functions/
│   │   │   └── validation/
│   │   └── seeds/
│   ├── web/                        ← Frontend (if applicable)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── api/client.ts       ← Typed API client
│   │       ├── components/
│   │       ├── pages/
│   │       └── hooks/
│   └── shared/                     ← Shared types and schemas
│       ├── package.json
│       ├── types/
│       │   ├── entities.ts         ← Entity types
│       │   └── api.ts              ← Response contracts + ErrorCode
│       └── schemas/
│           └── validation.ts       ← Zod schemas + inferred request types
```

### Shared Types Design Rule

> **Do NOT define request types in BOTH `types/api.ts` AND `schemas/validation.ts`.** With Zod, `z.infer<typeof schema>` ARE canonical request types:
> - `types/entities.ts` → Entity interfaces
> - `types/api.ts` → Response types, ErrorCode union
> - `schemas/validation.ts` → Zod schemas + inferred request types

### Architecture Core Principles

1. **Service boundary isolation** — Every Azure service behind interface
2. **Dependency injection** — Handlers receive services, never import SDKs
3. **Environment-driven config** — Same code for mocks, emulators, Azure
4. **Monorepo by default** — Frontend, backend, shared types in one repo
5. **Contracts first** — Shared types before implementation
6. **One function per file** — Each Function independently testable

---

## Outputs

| Artifact | Location |
|----------|----------|
| **Project Plan** | `.azure/project-plan.md` (Status: Approved) |

---

## Next

> **Automatic**: After plan approved, immediately invokes **azure-project-scaffold**:
> - Generates frontend preview (if applicable) with auto-open in VS Code Simple Browser
> - Scaffolds backend (services, handlers, migrations, types)
> - Auto-invokes **azure-project-test** for test coverage
>
> **No user action required** — chain is automatic.
