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
1. **Plan first** — create `.azure/project-plan.md` before any code. No `services/`, configs, or project files until the user approves. Only files allowed under the project root: `.azure/project-plan.md` and the contents of `.azure/.preview-temp/` (per Step 3.5).
2. **Resilience classification** — classify each service **Essential** (fails without it) or **Enhancement** (succeeds with fallback). See Quick Reference.
3. **Auto-chain after approval** — immediately invoke `azure-project-scaffold`; never ask the user to invoke it manually. **Generate a frontend HTML/CSS preview** during planning per Step 3.5 (the scaffold agent consumes it as a mock-up but builds the real app with the chosen framework).
4. **Interactive UI** — use `vscode_askQuestions`, never plain chat; batch unanswered questions into one call.

## Autopilot mode (overrides the gates below)
**Active when** the invoking chat query begins with `[AUTOPILOT MODE]`, **or** `.azure/requirements.json` contains `"executionMode": "auto"`. Autopilot only applies on the **re-entry** path (after the requirements form was submitted) — the first pass that writes `.azure/requirements.json` is always guided. When active, run fully unattended:
- **Skip the frontend preview** (Step 3.5) and the `openPlanView` preview — do NOT write `.azure/.preview-temp/` or fan out page sub-agents.
- **Skip the approval gate** (Step 3 "Present plan… ask for approval" / the STOP). Set status straight from `Planning` to `Approved` and auto-chain.
- **Record the mode** — write `executionMode: auto` into `.azure/project-plan.md` (front-matter or a `**Execution Mode**: auto` row) so downstream skills inherit it.
- **Hand off with the marker** — prefix the `azure-project-scaffold` invocation args with `[AUTOPILOT MODE] `.
- Never call `vscode_askQuestions`. Plan quality (incl. the Design System section) is unchanged — autopilot suppresses **gates and previews only**.

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

For each question (shared + per-service), use the Step 1 scan + the user's prompt to fill:

- **`answer`** — the inferred value when confident, else `null` (`[]` for array-typed `dataStores`).
- **`recommendedChoice`** — always provide one (string for single-select questions, `string[]` for `dataStores`); becomes the **pre-selected** option in the webview, even for `needs_input`.

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

#### 2b. Services and questions

The requirements JSON has two top-level concepts:

1. **`services[]`** — detected service roots (backends, frontends, workers). Each gets a per-service question section in the webview.
2. **`questions[]`** — questions, either scoped to a service (`serviceId` set) or shared/cross-cutting (`serviceId` omitted).

##### Services

For each runnable service root detected in the workspace (or planned from the user's prompt), emit a service entry:

```json
{
  "id": "{kebab-case-id}",
  "label": "{Human-readable name, e.g. Payments API}",
  "role": "{backend | frontend | worker}",
  "root": "{workspace-relative path, e.g. ./api}"
}
```

- **`role`** — `backend` for APIs/Azure Functions, `frontend` for SPAs/web apps, `worker` for background/queue processors.
- **`root`** — workspace-relative path to the service directory. Omit for NEW-mode when no directories exist yet.
- Derive `id` from the project manifest name (e.g. `package.json` → `"name"`) when available, else from the directory name.

##### Per-service questions

For **each service**, emit these questions with `"serviceId": "{service.id}"`:

| `id` pattern | `header` | `question` | Options / Type | Notes |
|---|---|---|---|---|
| `{serviceId}:language` | Language | Which programming language for {label}? | `TypeScript`, `Python`, `C# (.NET)` for backends/workers; `TypeScript`, `JavaScript` for frontends | `allowFreeformInput: false` |
| `{serviceId}:framework` | Framework | Which framework for {label}? | Frontends: `React + Vite`, `Vue + Vite`, `Angular`, `Svelte`; Backends: `Azure Functions`, etc. | `allowFreeformInput: true`; omit for backends when Azure Functions is the only option |
| `{serviceId}:features` | Features | Describe the features or API routes for {label}. | Free text (omit `options`) | |

Use `category: "service"` for all per-service questions. The webview groups them under the service card, not by category.

##### Shared questions (no `serviceId`)

These are asked once for the whole project. Always emit all of them:

| # | `id` | `category` | `header` | `question` | Multi-select | Free-form | `options` | Default `recommendedChoice` |
|---|---|---|---|---|---|---|---|---|
| 1 | `dataStores` | `data` | Data Stores | Which data stores does your app need? | **yes** | no | `Blob Storage`, `Queue Storage`, `PostgreSQL`, `CosmosDB`, `Redis`, `Azure SQL` | Best-guess subset |
| 2 | `auth` | `auth` | Authentication | Does your app need authentication? | no | **yes** | `No auth`, `Mock auth middleware`, `Microsoft Entra ID`, `Microsoft Entra External ID`, `Auth0`, `Clerk` | `Mock auth middleware` if user data, else `No auth` |

> The old `appType`, `runtime`, and `frontend` questions are gone. **App Type is no longer asked** — it's derived from the detected `services` (see below). Language and framework are now per-service questions.

##### App Type is derived, not asked

Do **not** emit an `appType` question. Instead, derive the plan's App Type from the `services` array:

| Detected services | Derived App Type |
|---|---|
| At least one `frontend` + at least one `backend` | `SPA + API` |
| Only `backend` service(s) | `API only` |
| Only `worker` service(s) | `Background worker` |
| `frontend` that is server-rendered (Next.js SSR, etc.) | `Full-stack SSR` |
| Static `frontend` + `backend` | `Static site + API` |

Use this derived value to fill Section 1 of the plan and to decide whether to emit the Frontend / Design System sections.

Each option is `{ label, description }` as before. Include `multiSelect`, `allowFreeformInput`, `recommendedChoice`, `status`, `answer`, and `rationale` on every question.

#### 2c. Write `.azure/requirements.json`

Write the file at `.azure/requirements.json` (no leading dot on the filename — this is the path the extension's file watcher matches). Use this exact top-level shape:

```json
{
  "schemaVersion": "2",
  "generatedAt": "{ISO date}",
  "mode": "{NEW | AUGMENT}",
  "summary": "{1–2 sentences describing what the user is building}",
  "workspaceSignals": {
    "decision": "{NEW | AUGMENT}",
    "decisionReason": "{one sentence on why}",
    "detectedFiles": ["{relative paths from Step 1, if any}"]
  },
  "services": [
    { "id": "functions-api", "label": "Functions API", "role": "backend", "root": "./api" },
    { "id": "web-app", "label": "Customer Portal", "role": "frontend", "root": "./web" }
  ],
  "questions": [
    {
      "id": "functions-api:language", "category": "service", "serviceId": "functions-api",
      "header": "Language", "question": "Which programming language for Functions API?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "TypeScript", "description": "Node.js + TypeScript on Azure Functions" },
        { "label": "Python", "description": "Python on Azure Functions" },
        { "label": "C# (.NET)", "description": "Isolated worker on .NET 10" }
      ],
      "recommendedChoice": "TypeScript", "status": "inferred", "answer": "TypeScript",
      "rationale": "Detected package.json with TypeScript devDependency."
    },
    {
      "id": "functions-api:features", "category": "service", "serviceId": "functions-api",
      "header": "Features", "question": "Describe the features or API routes for Functions API.",
      "multiSelect": false,
      "recommendedChoice": "Auth, photo upload/list/delete, AI captions",
      "status": "inferred", "answer": "Auth, photo upload/list/delete, AI captions",
      "rationale": "Distilled from the user's prompt."
    },
    {
      "id": "web-app:language", "category": "service", "serviceId": "web-app",
      "header": "Language", "question": "Which programming language for Customer Portal?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "TypeScript", "description": "TypeScript with type safety" },
        { "label": "JavaScript", "description": "Plain JavaScript" }
      ],
      "recommendedChoice": "TypeScript", "status": "inferred", "answer": "TypeScript",
      "rationale": "TypeScript is the most popular choice for modern SPAs."
    },
    {
      "id": "web-app:framework", "category": "service", "serviceId": "web-app",
      "header": "Framework", "question": "Which frontend framework for Customer Portal?",
      "multiSelect": false, "allowFreeformInput": true,
      "options": [
        { "label": "React + Vite", "description": "React with Vite bundler" },
        { "label": "Vue + Vite", "description": "Vue with Vite bundler" },
        { "label": "Angular", "description": "Angular CLI" },
        { "label": "Svelte", "description": "Svelte + Vite" }
      ],
      "recommendedChoice": "React + Vite", "status": "needs_input", "answer": null,
      "rationale": "React is the most common pick for SPA + API on Azure."
    },
    {
      "id": "dataStores", "category": "data", "header": "Data Stores",
      "question": "Which data stores does your app need?",
      "multiSelect": true, "allowFreeformInput": false,
      "options": [
        { "label": "Blob Storage", "description": "Store files and images" },
        { "label": "Queue Storage", "description": "Async message queue" },
        { "label": "PostgreSQL", "description": "Relational database" },
        { "label": "CosmosDB", "description": "NoSQL document database" },
        { "label": "Redis", "description": "In-memory cache" },
        { "label": "Azure SQL", "description": "Managed SQL Server" }
      ],
      "recommendedChoice": ["Blob Storage", "PostgreSQL"],
      "status": "inferred", "answer": ["Blob Storage", "PostgreSQL"],
      "rationale": "Photo files → Blob Storage; relational data → PostgreSQL."
    },
    {
      "id": "auth", "category": "auth", "header": "Authentication",
      "question": "Does your app need authentication?",
      "multiSelect": false, "allowFreeformInput": true,
      "options": [
        { "label": "No auth", "description": "Public app, no login required" },
        { "label": "Mock auth middleware", "description": "HMAC-signed test tokens — testable without an IdP" },
        { "label": "Microsoft Entra ID", "description": "Workforce identity — sign in with org or Microsoft accounts" },
        { "label": "Microsoft Entra External ID", "description": "Customer identity — sign-up plus social logins" },
        { "label": "Auth0", "description": "Third-party IdP — social and enterprise connections" },
        { "label": "Clerk", "description": "Drop-in user management with prebuilt UI" }
      ],
      "recommendedChoice": "Mock auth middleware", "status": "needs_input", "answer": null,
      "rationale": "App handles user data — start with mock auth for testability."
    }
  ]
}
```

**Rules for the JSON:**

- Always emit a `services` array with one entry per detected/planned service.
- For each service, emit per-service questions with `serviceId` matching the service's `id`. Use the `id` pattern `{serviceId}:{questionType}` (e.g. `functions-api:language`).
- Frontend services must only offer `TypeScript` / `JavaScript` for their language question — never `Python` or `C# (.NET)`.
- Backend/worker services offer `TypeScript`, `Python`, `C# (.NET)` for language.
- Always emit both shared questions: `dataStores`, `auth`. Never omit one.
- **Do not emit an `appType` question** — App Type is derived from the `services` array (see the derivation table above).
- Always include a short `header` plus the full `question` text on every question.
- Always include `multiSelect` (boolean). Only `dataStores` is `true`.
- Always include `allowFreeformInput` (boolean) for questions with `options`:
  - Language questions → `false`
  - Framework questions → `true`
  - `dataStores` → `false`
  - `auth` → **`true`** (always — never `false`, even when a listed option fits)
  For free-text questions (features), omit `allowFreeformInput`.
- Use the field name **`rationale`** (not `reason`).
- Always include `options` (array of `{ label, description }`), except for feature questions.
- Always include `recommendedChoice`. For single-select it's a string; for `dataStores` it's a `string[]`.
- For `inferred` questions, fill in `answer`. For `needs_input`, set `answer: null` (`[]` for `dataStores`).
- `dataStores` is the only multi-select question — `answer` and `recommendedChoice` are always `string[]`.
- Strict JSON — no comments, no trailing commas.

> ❌ **DO NOT** ask the user which .NET version to target. If a service's language = `C# (.NET)`, the target framework is **always `net10.0`**. Only downgrade when the user explicitly states an older version.

#### 2d. Hand off to the webview — then stop

Once the file is written, **stop**. Do NOT print the JSON, summarize inferences, ask anything in chat, or proceed to Step 3. The agent's workflow rules open the requirements webview after this write; the user fills the `needs_input` questions and clicks **Submit**. The requirements controller writes the file back (statuses → `confirmed`) and re-invokes this agent saying the requirements are ready.

#### 2e. Skip rule — only when the prompt is fully unambiguous

If the prompt was extremely explicit (e.g. *"Azure Functions TypeScript API with PostgreSQL — no frontend, no auth, routes GET /widgets and POST /widgets"*) and every question is `inferred` in Step 2a, you **may** skip writing `.azure/requirements.json` and go straight to Step 3. When in doubt, **write the file** — review is fast and cheap.

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

**App Type**: {API only | SPA + API | Full-stack SSR | Static + API | Background worker — **derived from the detected services**, not asked}

**Mode**: {NEW | AUGMENT}

**Deployment Plan**: {`.azure/plan.md` found — services derived from deployment plan | No deployment plan found}

---

## 2. Backend — Azure Functions

> One **stack section per service** — emit a `## N. <Service> — <role>` heading and a single combined table for the backend, a frontend section when the app has a UI, and extra sections for any worker services. The plan view turns every section that has a **Language** row into an editable, language-aware stack card, so each service picks its own language independently. Renumber the sections that follow to match the services you emit.

| Component | Technology |
|-----------|-----------|
| **Language** | {TypeScript / Python / C#} |
| **Runtime** | {Node / Bun / Deno / CPython / PyPy / .NET} |
| **Package Manager** | {npm / pnpm / pip / poetry / dotnet (NuGet)} |
| **Test Runner** | {vitest / jest / pytest / xUnit} |
| **Mocking Library** | {vi.mock / jest.mock / sinon / unittest.mock / **NSubstitute** (.NET — never Moq, see runtimes/dotnet.md)} |
| **Test Command** | {npm test / pytest / dotnet test} |
| **Orchestration** | docker-compose |

> **Language vs Runtime**: `Language` is the source language the user picked (Q2). `Runtime` is the execution runtime — default `Node` for TypeScript/JavaScript, `CPython` for Python, `.NET` for C#. Only deviate from the default (e.g. `Bun`, `Deno`, `PyPy`) when the user explicitly asks. **Package Manager and Test Runner are language-dependent** — match them to this service's Language (e.g. C# → `dotnet (NuGet)` + `xUnit`/`NUnit`/`MSTest`). The `Orchestration` row is recorded for the scaffold step but hidden in the plan UI — always keep it set to `docker-compose`.

---

## 3. Frontend — Web App

> Emit this section only when `services` contains a `frontend` service (derived App Type ≠ `API only` / `Background worker`); omit it entirely otherwise. The frontend is its own service with its own Language and **Framework**. Frontend Language is always **JavaScript or TypeScript** — even when the backend uses Python or C#, the frontend is a JS/TS app.

| Component | Technology |
|-----------|-----------|
| **Language** | {TypeScript / JavaScript} |
| **Framework** | {React + Vite / Vue + Vite / Angular / Svelte} |
| **Package Manager** | {npm / pnpm} |
| **Test Runner** | {vitest / jest} |
| **Mocking Library** | {vi.mock / jest.mock / sinon} |
| **Test Command** | {npm test} |

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| {Blob Storage} | {Store uploaded images} | {STORAGE_CONNECTION_STRING} | {UseDevelopmentStorage=true} | {Essential} |
| {PostgreSQL} | {Primary data store} | {DATABASE_URL} | {postgresql://localdev:localdevpassword@localhost:5432/appdb} | {Essential} |

---

## 5. Design System & UI

> **MANDATORY when `services` contains a `frontend` service.** Skip only when there is no frontend service (derived App Type `API only` / `Background worker`). The plan-preview webview parses this section by title (`s.title.toLowerCase().includes('design system')`) and the scaffold quality contract reads `Component Library:` to decide which real library primitives to render.

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

> **Order matters — open the plan view BEFORE rendering the per-page previews.** The whole point of the loading state is that the user sees and can interact with the plan document while the page previews are still being generated. If you generate every preview page first and only then open the view, the plan appears late and the flow is broken.

1. **Write the preview scaffolding** — Step 3.5a below: write `.azure/.preview-temp/theme.css` + `manifest.json` (every page `status: "pending"`). Skip this and all of Step 3.5 when there is no `frontend` service (derived App Type `API only` / `Background worker` — no UI to preview).
2. **Open the plan preview NOW** — the workflow rules in `azure-project-plan.agent.md` call `azureResourceGroups.openPlanView`. Do this **immediately after `manifest.json` exists and before fanning out the page sub-agents**. The webview starts watching `.azure/.preview-temp/` and shows the plan document plus a *Generating preview…* placeholder per page.
3. **Render the page previews** — Step 3.5b below: fan out one sub-agent per page. The view is already open; its file watcher flips each page from *Generating preview…* to the rendered HTML as soon as its `<slug>.html` lands.
4. **Present plan**, ask for approval.
5. If approved, update status from `Planning` to `Approved`.
6. **Immediately invoke `azure-project-scaffold`** (auto-chain). Do NOT ask user to invoke manually. The scaffold agent treats `.azure/.preview-temp/*.html` as a mock-up reference and translates it into real components using the framework named in the Frontend stack section.

> **❌ STOP** — Do NOT proceed past approval until user approves. Once approved, auto-chain immediately.

---

### Step 3.5: Generate Frontend HTML/CSS Preview (parallel sub-agents)

> **Skip entirely** when Section 5 was omitted (i.e. no `frontend` service — derived App Type `API only` / `Background worker`). For all other app types this step is **mandatory** — without it, the plan-preview webview shows a permanent *Generating preview…* spinner and the user has no UI to approve.

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
>
> **Prefer domain-specific names for the deployable apps.** When the project has a clear product name, derive a kebab-case slug and name the Functions backend `services/<project>-api` and the frontend `services/<project>-<type>` (`-portal`/`-app`/`-web`, whichever fits) — e.g. for an office-compliance calendar: `services/office-compliance-api`, `services/office-compliance-portal`. Keep the shared package generic (`services/shared`). Fall back to the generic `functions`/`web` only when there is no clear project name. Whatever you choose, record it in Section 6 and use it consistently across `workspaces`, imports, and `main`/`rootDir`.

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
