---
name: azure-project-plan-requirements
description: "Requirements-gathering phase of the azure-project-plan agent — detect the workspace and produce .azure/requirements.json for the requirements webview. Read this during the requirements phase; for plan generation read plan.md."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan — Requirements

> **AUTHORITATIVE — MANDATORY** for the **requirements-gathering** phase of the `azure-project-plan` agent. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

> **Scope:** this file covers **Phase A only** — detect the workspace (Step 1) and gather requirements into `.azure/requirements.json` (Step 2). Once the user submits the requirements form, switch to [`plan.md`](plan.md) for plan generation (Step 3 onward). Shared rules, triggers, and autopilot behavior live in [`instructions.md`](instructions.md).

## ═══════════════════════════════════════════════════
## PHASE 1: PLANNING — Requirements
## ═══════════════════════════════════════════════════

> On re-entry (the query begins *"Requirements submitted at .azure/requirements.json…"*, or `.azure/requirements.json` is already fully answered), skip Steps 1–2 and switch to [`plan.md`](plan.md) for plan generation (Step 3 onward) — see Step 2f.

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

- **`answer`** — the inferred value when confident, else `null` (`[]` for array-typed `dataStores`). When the app needs no datastore, use `["No datastore required"]`, not an empty array.
- **`recommendedChoice`** — always provide one (string for single-select questions, `string[]` for `dataStores`); becomes the **pre-selected** option in the webview, even for `needs_input`. For `dataStores`, recommend **every** store the app needs, not just one — it is a subset and often has more than one entry. Recommend `["No datastore required"]` when the app needs no datastore. The webview shows a Recommended badge on each selected recommendation (including the `Blob Storage` cases required by the `dataStores` MUST rules below).

Then set **`status`**:

- **`inferred`** — confidently known from workspace signals or an explicit user statement. Set `answer` + `rationale`; the webview pre-selects the inferred value for review/override.
- **`needs_input`** — not confidently known. Leave `answer` `null` (`[]` for `dataStores`); the webview pre-selects your `recommendedChoice` to confirm or change.

| If you detect... | Then infer... |
|-----------------|---------------|
| `.azure/plan.md` exists | Read it — extract all Azure services. Authoritative. |
| `@azure/storage-blob` import | App uses Blob Storage |
| App stores files, photos, images, uploads, documents, or media | App uses Blob Storage |
| Backend service uses Azure Functions | App uses Blob Storage (Functions requires a storage account) |
| App needs no persistence, file/object storage, queue, or cache, and no service requires an associated storage account | App uses `No datastore required` |
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
| 1 | `dataStores` | `data` | Data Stores | Which data stores does your app need? | **yes** | no | `No datastore required` (exclusive), `Blob Storage`, `Queue Storage`, `PostgreSQL`, `CosmosDB`, `Redis`, `Azure SQL` | Every store the app needs (often more than one), or `No datastore required` |
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

Each option is `{ label, description, exclusive? }`. Set `exclusive: true` only on an option that cannot be combined with any other selection. Include `multiSelect`, `allowFreeformInput`, `recommendedChoice`, `status`, `answer`, and `rationale` on every question.

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
        { "label": "No datastore required", "description": "The app does not persist data or use storage, queues, or caches", "exclusive": true },
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

**Rules for the JSON** (the worked example above is the contract — these call out only the non-obvious constraints):

- **Services & IDs:** one `services` entry per detected/planned service; per-service question `id`s follow `{serviceId}:{questionType}` (e.g. `functions-api:language`), with `serviceId` matching the service.
- **Language options:** frontend services offer only `TypeScript` / `JavaScript`; backend/worker services offer `TypeScript`, `Python`, `C# (.NET)`.
- **Always emit both shared questions** (`dataStores`, `auth`), and **never emit an `appType` question** — App Type is derived from `services` (see the derivation table above).
- **`allowFreeformInput` is fixed per type:** language `false`, `dataStores` `false`, framework `true`, `auth` **`true`** (always — even when a listed option fits). Omit it for free-text feature questions.
- **`multiSelect`:** only `dataStores` is `true`; its `answer` and `recommendedChoice` are always `string[]`.
- **Answers:** `inferred` → fill `answer`; `needs_input` → `answer: null` (`[]` for `dataStores`). Always provide `recommendedChoice`.
- **No datastore:** `No datastore required` is an exclusive option. When selected or inferred, it must be the only value in `answer` and `recommendedChoice`. Never combine it with a concrete datastore.
- Use the field name **`rationale`** (not `reason`). Strict JSON — no comments, no trailing commas.
- **`dataStores` Blob Storage rule (MUST):** include `Blob Storage` in `recommendedChoice` — and in `answer` when the question is `inferred` — alongside any database whenever **either** (a) any service stores or serves files, photos, images, uploads, documents, or media, **or** (b) any backend service uses Azure Functions (which requires an associated storage account, `AzureWebJobsStorage`). A file/photo app — or a Functions app — whose recommendation is only a database is wrong.

> ❌ **DO NOT** ask the user which .NET version to target. If a service's language = `C# (.NET)`, the target framework is **always `net10.0`**. Only downgrade when the user explicitly states an older version.

#### 2d. Hand off to the webview — then stop

Once the file is written, **stop**. Do NOT print the JSON, summarize inferences, ask anything in chat, or proceed to plan generation. The agent's workflow rules open the requirements webview after this write; the user fills the `needs_input` questions and clicks **Submit**. The requirements controller writes the file back (statuses → `confirmed`) and re-invokes this agent saying the requirements are ready.

#### 2e. Requirements review is mandatory

Always write `.azure/requirements.json` and hand it off to the requirements webview, even when the prompt is fully unambiguous and every question is `inferred` in Step 2a. Inferred answers are pre-selected so review remains quick, but the user must still have an opportunity to confirm or change them before plan generation.

#### 2f. Re-entry — reading the answered file

When re-invoked with a query mentioning submitted requirements (e.g. *"Requirements submitted at .azure/requirements.json..."*), or whenever `.azure/requirements.json` has all questions `confirmed`/`inferred`:

1. Read `.azure/requirements.json`.
2. Treat `answer` fields as authoritative — do not re-ask, do not re-emit the file.
3. Switch to [`plan.md`](plan.md) and go directly to Step 3 (Generate Plan).

> **✅ Checkpoint**: Requirements gathered (via inference + webview submission). Ready to generate plan — continue in [`plan.md`](plan.md).