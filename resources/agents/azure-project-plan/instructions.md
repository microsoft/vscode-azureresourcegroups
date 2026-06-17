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
| Docker Compose, emulators, VS Code F5 | **azure-debug-plan** |
| Add test coverage | **azure-project-test** |
| Deploy to Azure / generate Bicep/Terraform | **azure-prepare** |
| Benchmark scaffold quality | **scaffold-benchmark** |

## Rules
1. **Plan first** — create `.azure/project-plan.md` before any code. No `services/`, configs, or project files until the user approves. Only files allowed under the project root: `.azure/project-plan.md` and the contents of `.azure/.preview-temp/` (per Step 3.5).
2. **Resilience classification** — classify each service **Essential** (fails without it) or **Enhancement** (succeeds with fallback). See Quick Reference.
3. **Auto-chain after approval** — immediately invoke `azure-project-scaffold`; never ask the user to invoke it manually. **Generate a frontend HTML/CSS preview** during planning per Step 3.5 (the scaffold agent consumes it as a mock-up but builds the real app with the chosen framework).
4. **Interactive UI** — use `vscode_askQuestions`, never plain chat; batch unanswered questions into one call.
5. **Scope = app/service code only** — the plan must describe **only** high-quality application / service code. Do **NOT** plan for, reference, or add checklist items that produce `docker-compose.yml` / Docker / emulator orchestration, **SQL migration files**, **SQL seed / fixture data files**, or **Infrastructure-as-Code** (Bicep / ARM / Terraform / Pulumi / `infra/`). Those are owned by other skills (**azure-debug-plan**, **azure-prepare**). If a relational DB is chosen, the plan still describes the data-access service layer — never schema migrations or seed scripts.

## Workflow (mandatory order)
DETECT (Step 1) → GATHER (Step 2) → GENERATE `.azure/project-plan.md` (Step 3) → GENERATE FRONTEND PREVIEW (Step 3.5, if applicable) → approval → AUTO-CHAIN scaffold after approval. Only files allowed: `.azure/project-plan.md` and the contents of `.azure/.preview-temp/` — no `services/`, configs, or production code. Planning needs ZERO external file reads except `references/html-preview.md` for Step 3.5; all other context is inlined below.

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
| `host.json` + `dotnet-isolated` worker runtime | Runtime = C#; Backend = Azure Functions isolated worker |

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

> **Choose colors that fit THIS app — never copy the example hexes.** Derive the palette from `Style Direction` above plus any brand cues in the user's prompt (industry, mood, named colors, an existing logo). The `{#…}` values are illustrative placeholders, **not** defaults — only fall back to a plain neutral set when the project genuinely has no brand or style direction (e.g. generic internal tooling). The **Usage** column must describe each color's role in **this app's** UI in domain terms, not generic boilerplate. Token names (`primary`, `accent`, `surface`, `text`, `muted`, `border`) are a **fixed contract** — do NOT rename, add, or drop them; the scaffold's quality contract and preview theming key off these exact names.

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `{#…}` | {Brand color — primary buttons, links, active nav} |
| `accent`  | `{#…}` | {Secondary accents, highlights} |
| `surface` | `{#…}` | {Page + card backgrounds} |
| `text`    | `{#…}` | {Body text} |
| `muted`   | `{#…}` | {Secondary text, captions, timestamps} |
| `border`  | `{#…}` | {Dividers, input + card borders} |

### Pages

> **List THIS app's real screens and give each its own content-specific layout.** Name pages after what they show (recipe app → `Recipes` / `Recipe Detail` / `New Recipe`; issue tracker → `Board` / `Issue` / `Backlog`), and choose each page's region tokens from the records that page actually displays — a list-heavy page wants `table`/`card-list`, a single-record page wants `two-column(media+meta) + action-bar`, a capture flow wants `form`. Do **not** reuse one boilerplate layout for every row or pad a page with regions it has no content for.

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| {Primary page — name it after the main entity} | `/` | {one-line purpose} | `{region tokens chosen for this page's content}` |
| {Next page} | `{/route}` | {one-line purpose} | `{region tokens for this page's content}` |

> **Layout tokens are layout INTENT, not implementation.** The scaffold agent renders them using `Component Library` primitives per the scaffold skill's `frontend-quality-bar.md`. Recognized tokens: `header, nav, sidebar, hero, main, list, card-list, grid, form, table, actions, action-bar, tabs, modal, footer`. Compound tokens: `split(a|b)` (1:2 columns), `two-column(a+b)` (1:1 columns).

### Sample Content

> **Shared content contract — this is what keeps the planning preview and the scaffolded app in parity.** The preview sub-agents (Step 3.5b) and the scaffold agent both read this block and render the **same** records, so the low-fidelity preview faithfully previews what ships instead of generic filler. Author it now, while you have full domain context (Sections 1–4).

For each page above, list 3–6 representative records using that page's primary entity — a short table or bullet list per page, whatever fits the data shape. Use **real values from this app's domain** (real entity names, realistic numbers, real states) — a recipe app lists recipes, an issue tracker lists issues, a storefront lists products. **Never** emit generic placeholders like "Item 1", "Recent items", "Card title", or lorem ipsum. The skeleton below shows the **format**, not the content — replace every `{...}` with your domain's records.

```
{Page name} — {primary entity}:
| {Field A}     | {Field B} | {Field C} | {Status} |
| {record 1 …}  | {…}       | {…}       | {state}  |
| {record 2 …}  | {…}       | {…}       | {state}  |
| {record 3 …}  | {…}       | {…}       | {state}  |

{Form/settings page} — {field}: {realistic default} · {field}: {realistic default}
```

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
- [ ] Step 5: Data Access (app-code data-access in the service layer — NO SQL migrations or seed files)
- [ ] Step 6: Shared Types & Validation Schemas
- [ ] Step 7: API Routes / Functions (one handler per route)
- [ ] Step 8: Error Handling Middleware
- [ ] Step 9: Health Check Endpoint
- [ ] Step 10: OpenAPI Contract
- [ ] Step 11: Structured Logging
- [ ] Step 12: Wire Frontend (if applicable — replace mock data/types with real backend)
- [ ] Step 13: Wrap Up & Smoke Test

> Scaffold-time concerns (collection-to-table mapping, test suite plan, file-by-file generation list) are NOT part of the plan — they are produced by `azure-project-scaffold` from this plan + its own reference docs (`database-integrity.md`, `service-abstraction.md`). The plan only commits to **what** is built; the scaffold handles **how**. Note: SQL migrations, seed files, `docker-compose.yml`, and Infrastructure-as-Code are **never** produced (see Rule 5).

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-test** to add test coverage and validate the build
3. Run **azure-debug-plan** for Docker emulators and VS Code debugging
4. Run **azure-prepare** → **azure-deploy** when ready to deploy
````

#### After Writing the Plan

> **Order matters — open the plan view BEFORE rendering the per-page previews.** The whole point of the loading state is that the user sees and can interact with the plan document while the page previews are still being generated. If you generate every preview page first and only then open the view, the plan appears late and the flow is broken.

1. **Write the preview scaffolding** — Step 3.5a below: write `.azure/.preview-temp/theme.css` + `manifest.json` (every page `status: "pending"`). Skip this and all of Step 3.5 for `API only` / `Background worker` (no UI to preview).
2. **Open the plan preview NOW** — the workflow rules in `azure-project-plan.agent.md` call `azureResourceGroups.openPlanView`. Do this **immediately after `manifest.json` exists and before fanning out the page sub-agents**. The webview starts watching `.azure/.preview-temp/` and shows the plan document plus a *Generating preview…* placeholder per page.
3. **Render the page previews** — Step 3.5b below: fan out one sub-agent per page. The view is already open; its file watcher flips each page from *Generating preview…* to the rendered HTML as soon as its `<slug>.html` lands.
4. **Present plan**, ask for approval.
5. If approved, update status from `Planning` to `Approved`.
6. **Immediately invoke `azure-project-scaffold`** (auto-chain). Do NOT ask user to invoke manually. The scaffold agent treats `.azure/.preview-temp/*.html` as a mock-up reference and translates it into real components using the framework named in Section 2.

> **❌ STOP** — Do NOT proceed past approval until user approves. Once approved, auto-chain immediately.

---

### Step 3.5: Generate Frontend HTML/CSS Preview (parallel sub-agents)

> **Skip entirely** when Section 5 was omitted (i.e. `appType` ∈ `API only` / `Background worker`). For all other app types this step is **mandatory** — without it, the plan-preview webview shows a permanent *Generating preview…* spinner and the user has no UI to approve.

**Output location:** `.azure/.preview-temp/` (note the leading dot on the folder name — it's a transient, gitignored scratch space). The scaffold agent reads it as a mock-up reference, then deletes it as the last step of scaffolding (see scaffold skill Step 13).

**Inputs:** the just-written `.azure/project-plan.md` Section 5 (Color Palette, Typography, Pages, Style Direction, Component Library) plus the per-region recipes in [`references/html-preview.md`](references/html-preview.md). Read that reference file **once** at the start of this step.

#### 3.5a. Write `theme.css` and `manifest.json` (do this BEFORE fan-out)

Both files MUST exist before the plan-preview webview opens, so the controller can render tabs in the loading state. Use the `create_file` tool — it's OS-agnostic and creates parent folders automatically.

**`.azure/.preview-temp/theme.css`** — single shared stylesheet derived from Section 5:

```css
:root {
    /* ── Brand colors (from Section 5 palette) ── */
    --color-primary: {hex from Section 5};
    --color-on-primary: {white or near-black, whichever contrasts better};
    --color-accent: {hex};
    --color-on-accent: {white or near-black};

    /* ── Surfaces (derive from the palette — do NOT assume a light theme) ── */
    --color-surface: {hex — page background from Section 5};
    --color-surface-raised: {a card/panel tone that reads as raised against surface — #ffffff for a light theme, a step LIGHTER than surface for a dark one};
    --color-surface-sunken: color-mix(in srgb, var(--color-surface) 92%, var(--color-text) 6%);

    /* ── Text & borders ── */
    --color-text: {hex — e.g. #111827};
    --color-muted: {hex — e.g. #6b7280};
    --color-border: {hex — e.g. #e5e7eb};

    /* ── Semantic (status badges, alerts) ── */
    --color-success: #16a34a;
    --color-warning: #d97706;
    --color-danger:  #dc2626;

    /* ── Typography ── */
    --font-body: {typography from Section 5}, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-heading: var(--font-body);
    --text-xs: 11px;
    --text-sm: 13px;
    --text-base: 14px;
    --text-lg: 16px;
    --text-xl: 20px;
    --text-2xl: 26px;
    --text-3xl: 34px;

    /* ── Shape (match the roundness to Style Direction — these are a neutral middle, not a mandate) ── */
    /* sharp/technical → 2–4px · balanced → the values below · soft/friendly → 12–18px */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
    --radius-pill: 9999px;

    /* ── Spacing scale (4px base) ── */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 28px;
    --space-7: 40px;
    --space-8: 56px;

    /* ── Elevation (preview = single tier; the scaffold uses real component-library elevation) ── */
    --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: var(--text-base);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
h1, h2, h3, h4 {
    font-family: var(--font-heading);
    line-height: 1.2;
    margin: 0;
}
a { color: var(--color-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
/* Plus the shared component CSS from references/html-preview.md §Shared CSS */
```

> **Why so plain?** This stylesheet powers a *directional sketch* — it confirms color story, page regions, and density during planning, nothing more. The scaffold raises the visual ambition (real component library, real icons, motion, dark mode, polished hero treatments). Resist the urge to add depth/shadow tiers/gradients here — that work belongs in the scaffold and is governed by `azure-project-scaffold/references/frontend-quality-bar.md` "Polish floor".

Paste the full Shared CSS block from `references/html-preview.md` into the same file (header, nav, sidebar, hero, etc. — keep names exactly as the reference defines so the per-page HTML matches).

**`.azure/.preview-temp/manifest.json`** — one entry per page in Section 5's Pages table:

```json
{
    "generatedAt": "{ISO timestamp}",
    "pages": [
        { "slug": "dashboard", "title": "Dashboard", "route": "/", "status": "pending" },
        { "slug": "settings",  "title": "Settings",  "route": "/settings", "status": "pending" }
    ]
}
```

- `slug` is the kebab-cased page name (`Photo Upload` → `photo-upload`). It MUST match the eventual filename (`<slug>.html`). Slugs MUST be unique.
- `route` is the path from Section 5's Pages table verbatim. Default to `/<slug>` when missing.
- `status` starts at `"pending"` for every page. You SHOULD flip it to `"ready"` in step 3.5c after the HTML is written (keeps the manifest accurate), but the webview no longer depends on it — **the presence of a non-empty `<slug>.html` file is what makes a page render**. The manifest only supplies the page list (slug/title/route) and the initial loading tabs.

#### 3.5a-open. Open the plan view NOW — before fanning out

The instant `theme.css` and `manifest.json` exist, the agent workflow opens the plan view (`azureResourceGroups.openPlanView`, per `azure-project-plan.agent.md` Step C). **Do this before Step 3.5b.** The user immediately sees the plan document plus one *Generating preview…* tab per manifest page, and can read and interact with the plan while the page sub-agents render in the background. Do **not** wait for the sub-agents to finish before the view opens — that delay is exactly the regression this ordering prevents.

> **Embedded webview only — never a browser or separate tab.** The planning preview is shown *exclusively* inside the plan webview's **UI Preview** card, where each `.azure/.preview-temp/*.html` page is rendered in a sandboxed iframe. Never open it with `simpleBrowser.show`, `vscode.env.openExternal`, a dev/web server, or by opening a `.preview-temp/*.html` file in an editor/preview tab. There is no port and no URL for the planning preview. (The Simple Browser belongs to the *scaffold* step's real dev server, not here.)

#### 3.5b. Fan out one sub-agent per page (parallel)

Launch one `runSubagent` call per page, **all in a single tool-call batch** (the platform parallelizes independent sub-agent invocations). Cap at **4 concurrent** — if the plan has more than 4 pages, split into batches of 4. Each sub-agent's prompt MUST contain:

1. The page's row from Section 5's Pages table (page name, route, purpose, layout regions).
2. The Color Palette, Typography, Style Direction, and Component Library values (for visual fidelity hints).
3. **The app's domain context** — a 1–2 sentence summary of what the app does (from Sections 1–2) plus the relevant entity/data model, so the sub-agent knows what the page is actually about.
4. **That page's records from Section 5's Sample Content block** — the real, domain-specific rows/values the page must display. This is the shared content contract; the scaffold reproduces the same records.
5. The full contents of `references/html-preview.md`.
6. The exact output path: `.azure/.preview-temp/<slug>.html`.
7. A directive: *"Write a single self-contained HTML file linking to `./theme.css`. Use the per-region recipes in the reference. Replace every `{...}` placeholder token in the recipes with the real Sample Content provided above — never generic filler like 'Item 1', 'Recent items', or 'Card title'. Do NOT add a banner claiming the app 'will use' a different library. Do NOT add `<script>` tags — the preview iframe runs sandboxed without scripts. Do NOT inline any CSS — all styling MUST come from `./theme.css`."*

Expected file shape:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{Page Title} — Preview</title>
    <link rel="stylesheet" href="./theme.css">
</head>
<body>
    <!-- Per-region HTML per references/html-preview.md, in the order from the plan's Pages table -->
</body>
</html>
```

> ⚠️ The `<link rel="stylesheet" href="./theme.css">` is load-bearing — the extension's `ScaffoldPlanViewController` substitutes it with an inline `<style>` block at runtime so the iframe `srcDoc` is self-contained. If you inline CSS or use a different `href`, the substitution won't fire and the preview will fall back to unstyled HTML.

#### 3.5c. (Optional) Flip statuses to `ready` after each page lands

The webview renders a page the moment its `<slug>.html` file exists — it does **not** wait for a manifest `status` change — so the preview appears even if you skip this step. Still, for an accurate manifest you SHOULD rewrite `manifest.json` with each page's `status` flipped to `"ready"` once its HTML is written. Either:
- update the manifest after every sub-agent completes (more responsive), or
- update once at the end after all sub-agents complete (simpler).

The webview's file watcher refreshes on every change under `.azure/.preview-temp/`, so the user sees tabs flip from loading to rendered in near-real-time.

> **✅ Checkpoint**: `.azure/.preview-temp/{theme.css, manifest.json, *.html}` all exist. Every page has a non-empty `<slug>.html` (which is what makes it render; the manifest `status` is best-effort bookkeeping). The plan-preview webview now shows the rendered HTML inside the iframe per page.

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
> In production, the `ConnectionStrings:*` values should be **resource URIs** (e.g., `https://<account>.blob.core.windows.net`) authenticated via `DefaultAzureCredential` (Managed Identity) — never raw account keys. See [runtimes/dotnet.md](.github/agents/shared-references/runtimes/dotnet.md#managed-identity--quick-reference) for the full mapping.

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

> **Plan-preview note**: The plan-preview webview renders Section 5 as a **sandboxed HTML/CSS iframe** loaded from `.azure/.preview-temp/<page>.html`. It deliberately does NOT use any component library, real icons, motion, dark mode, or webfonts — the preview is a *directional sketch* (color story + page regions + density), and the scaffolded app is required to visibly exceed it using whatever `Component Library` is named in the plan. The webview disclosure reads *"Directional mock, not the final UI. The scaffold renders this with **{Component Library}**, real icons, motion, and dark mode — it will look noticeably more polished than the sketch below."* and a `MOCK` ribbon overlays the iframe.

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

### Example Project Structure (TypeScript — SPA + API)

> This is a **default convention for a brand-new project**, not a mandate. When the workspace already has a structure, follow it; never assume or impose these exact paths. Treat the names below (`services/functions`, `services/web`, `services/shared`, …) as illustrative roles the agent maps onto the user's actual layout.

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                    ← Root workspace config
├── services/
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
> - Scaffolds backend (services, handlers, types)
> - Auto-invokes **azure-project-test** for test coverage
>
> **No user action required** — chain is automatic.
