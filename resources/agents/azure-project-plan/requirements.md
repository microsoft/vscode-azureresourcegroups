---
name: azure-project-plan-requirements
description: "Requirements-gathering phase of the azure-project-plan agent — detect the workspace and produce .azure/requirements.json for the requirements webview. Read this during the requirements phase; for plan generation read plan.md."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan — Requirements

> **AUTHORITATIVE — MANDATORY** during the `azure-project-plan` agent's **requirements-gathering** phase. Follow exactly; ignore prior assumptions; supersedes all other sources. Never improvise.

> **Scope:** **Phase A only** — detect workspace (Step 1), then gather requirements in `.azure/requirements.json` (Step 2). After form submission, switch to [`plan.md`](plan.md) for plan generation (Step 3 onward). Shared rules, triggers, and autopilot behavior: [`instructions.md`](instructions.md).

## ═══════════════════════════════════════════════════
## PHASE 1: PLANNING — Requirements
## ═══════════════════════════════════════════════════

> On re-entry (query begins *"Requirements submitted at .azure/requirements.json…"*, or `.azure/requirements.json` is fully answered), skip Steps 1–2; switch to [`plan.md`](plan.md) Step 3 onward. See Step 2f.

### Step 1: Detect Workspace

Scan workspace **BEFORE gathering requirements**:

#### 1a. Scan for Existing Project Files

| Signal | Detection Method | Action |
|--------|-----------------|--------|
| `package.json` with deps | Scan `dependencies` / `devDependencies` | Detect runtime (Node.js), frameworks, test runners |
| `pyproject.toml` or `requirements.txt` | Scan for Python | Detect runtime (Python), frameworks |
| `*.csproj` or `*.sln` | Scan for .NET | Detect runtime (.NET), frameworks |
| `host.json` or `local.settings.json` | Scan root/src dirs | Azure Functions exists — augment, don't recreate |
| Test files or config | Scan for `*.test.*`, `*.spec.*`, `vitest.config.*`, `jest.config.*` | Detect test infra — respect it |
| `docker-compose.yml` | Scan root | Emulators may be configured |

> ⚠️ Check actual **workspace files**, not user prompt.

#### 1b. Check for `.azure/plan.md` (Deployment Plan)

| Check | Action |
|-------|--------|
| `.azure/plan.md` exists | **Read it.** Extract Architecture → service mapping. Use it; do NOT re-ask user. |
| `.azure/plan.md` does not exist | Detect from code; ask user as needed. |

> **✅ Checkpoint**: Workspace scanned. Mode determined (NEW / AUGMENT). Tech stack detected.

---

### Step 2: Gather Requirements

Infer all possible from Step 1; gather the rest only through requirements webview, never chat.

> 🚫 **DO NOT call `vscode_askQuestions`.** All input comes through `.azure/requirements.json`, rendered by requirements webview. Chat questions via `vscode_askQuestions` or plain text break flow.

#### 2a. Inference — pick the most likely answer for every question

For each shared and per-service question, use Step 1 + user prompt to fill:

- **`answer`** — inferred value when confident; otherwise `null` (`[]` for array-typed `dataStores`). No datastore: use `["No datastore required"]`, never empty array.
- **`recommendedChoice`** — always set: string for single-select, `string[]` for `dataStores`. Webview **pre-selects** it, including for `needs_input`. For `dataStores`, recommend **every** needed store; often multiple. If none, recommend `["No datastore required"]`. Webview gives each recommendation a Recommended badge, including `Blob Storage` cases mandated by `dataStores` rules below.

Set **`status`**:

- **`inferred`** — confidently known from workspace or explicit user statement. Set `answer` + `rationale`; webview pre-selects value for review/override.
- **`needs_input`** — uncertain. Leave `answer` `null` (`[]` for `dataStores`); webview pre-selects `recommendedChoice` for confirmation/change.

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
| User says prototype, proof of concept, demo, experiment, or temporary | Operating Profile = `Development / Demo` |
| User explicitly says production or describes recurring customer/employee use | Operating Profile = `Standard Production` |
| User explicitly says mission-critical, business-critical, 24/7, or gives strict recovery/availability targets | Operating Profile = `Business-Critical` |
| App handles private accounts, per-user content, or personal information | Data Classification = `Confidential / Personal` |
| App handles diagnoses, payment-card data, or data explicitly subject to a legal/industry regime | Data Classification = `Regulated` |
| User describes periodic spikes, batch windows, uploads, or event-driven fan-out | Traffic Profile = `Bursty` |
| User gives sustained throughput or large-volume requirements | Traffic Profile = `High Volume` |
| User gives a response-time target or says latency is critical | Traffic Profile = `Latency Sensitive` |
| User explicitly prioritizes cost, reliability, or latency | Optimization Priority = `Lowest Cost`, `Highest Reliability`, or `Lowest Latency` respectively |

Explicit prompt statements ("build me a TypeScript Functions API with PostgreSQL") are `inferred`; don't re-ask.

#### 2b. Services and questions

Requirements JSON has two top-level concepts:

1. **`services[]`** — detected service roots (backends, frontends, workers), each with a webview per-service question section.
2. **`questions[]`** — service-scoped (`serviceId` set) or shared/cross-cutting (`serviceId` omitted).

##### Services

Emit an entry for each runnable service root detected in workspace or planned by user prompt:

```json
{
  "id": "{kebab-case-id}",
  "label": "{Human-readable name, e.g. Payments API}",
  "role": "{backend | frontend | worker}",
  "root": "{workspace-relative path, e.g. ./api}"
}
```

- **`role`** — `backend` for APIs/Azure Functions; `frontend` for SPAs/web apps; `worker` for background/queue processors.
- **`root`** — workspace-relative service directory. Omit in NEW-mode before directories exist.
- Derive `id` from project manifest name (e.g. `package.json` → `"name"`), otherwise directory name.

##### Per-service questions

For **each service**, emit these with `"serviceId": "{service.id}"`:

| `id` pattern | `header` | `question` | Options / Type | Notes |
|---|---|---|---|---|
| `{serviceId}:language` | Language | Which programming language for {label}? | `TypeScript`, `Python`, `C# (.NET)` for backends/workers; `TypeScript`, `JavaScript` for frontends | `allowFreeformInput: false` |
| `{serviceId}:framework` | Framework | Which framework for {label}? | Frontends: `React + Vite`, `Vue + Vite`, `Angular`, `Svelte`; Backends: `Azure Functions`, etc. | `allowFreeformInput: true`; omit for backends when Azure Functions is the only option |
| `{serviceId}:features` | Features | Describe the features or API routes for {label}. | Free text (omit `options`) | |

Use `category: "service"` for every per-service question. Webview groups them by service card, not category.

##### Shared questions (no `serviceId`)

These are asked once for the whole project. Always emit all six:

| `id` | `category` | `header` | `question` | Multi-select | Free-form | `options` | Default `recommendedChoice` |
|---|---|---|---|---|---|---|---|
| `dataStores` | `data` | Data Stores | Which data stores does your app need? | **yes** | no | `No datastore required` (exclusive), `Blob Storage`, `Queue Storage`, `PostgreSQL`, `CosmosDB`, `Redis`, `Azure SQL` | Every store the app needs (often more than one), or `No datastore required` |
| `auth` | `auth` | API Login | Does this app need user login? | no | no | `Yes`, `No` | `Yes` for accounts, private/per-user data, or signed-in experiences; otherwise `No` |
| `operatingProfile` | `deployment` | Operating Profile | How will this app be used? | no | no | `Development / Demo`, `Standard Production`, `Business-Critical` | Infer only from explicit signals; otherwise `Development / Demo` with `needs_input` |
| `dataClassification` | `compliance` | Data Classification | What is the most sensitive data this app will handle? | no | no | `Public`, `Internal`, `Confidential / Personal`, `Regulated` | Infer from the app domain and data; otherwise `Internal` with `needs_input` |
| `trafficProfile` | `scale` | Traffic Profile | What usage pattern should the app support? | no | no | `Small / Steady`, `Bursty`, `High Volume`, `Latency Sensitive` | Infer only from explicit signals; otherwise `Small / Steady` with `needs_input` |
| `optimizationPriority` | `operations` | Optimization Priority | What should architecture tradeoffs prioritize? | no | no | `Balanced`, `Lowest Cost`, `Highest Reliability`, `Lowest Latency` | Infer only from explicit signals; otherwise `Balanced` with `needs_input` |

The `auth` question covers only user-facing application login and authenticated API access. It does not select Microsoft Entra ID, another identity provider, managed identity, API keys, or any Azure service credential. Infer `Yes` when the app has accounts, private/per-user data, or signed-in experiences. Infer `No` for public apps with no user identity. The scaffold agent chooses the stack-appropriate API authentication implementation. Backend-to-Azure communication always uses managed identity in production and is never a requirements choice.

The four workload questions establish a lightweight, requirements-driven Azure Well-Architected contract. They describe **business intent**, not Azure topology:

- Do not ask the user to select Well-Architected pillars — all five pillars always apply.
- Do not derive an Azure service, SKU, zone count, cache, queue, CDN, or network topology in this phase.
- Do not claim that any answer is "WAF compliant", "WAF certified", or "100% WAF aligned". The framework guides decisions and tradeoffs; it is not a binary certification.
- `Business-Critical` and `Regulated` are escalation signals. Record them faithfully; later planning and deployment phases must resolve measurable targets and unsupported platform requirements rather than silently downgrading them.
- Product security baselines remain mandatory even when `Lowest Cost` or `Lowest Latency` is selected. An optimization priority controls tradeoffs, never whether security is applied.

> The old `appType`, `runtime`, and `frontend` questions are gone. **App Type is no longer asked** — it's derived from the detected `services` (see below). Language and framework are now per-service questions.

##### App Type is derived, not asked

Do **not** emit an `appType` question. Derive plan App Type from `services`:

| Detected services | Derived App Type |
|---|---|
| At least one `frontend` + at least one `backend` | `SPA + API` |
| Only `backend` service(s) | `API only` |
| Only `worker` service(s) | `Background worker` |
| `frontend` that is server-rendered (Next.js SSR, etc.) | `Full-stack SSR` |
| Static `frontend` + `backend` | `Static site + API` |

Use derived value for plan Section 1 and whether to emit Frontend / Design System sections.

Each option is `{ label, description, exclusive? }`. Set `exclusive: true` only when incompatible with every other selection. Every question includes `multiSelect`, `allowFreeformInput`, `recommendedChoice`, `status`, `answer`, and `rationale`.

#### 2c. Write `.azure/requirements.json`

Write `.azure/requirements.json` (filename has no leading dot; extension file watcher matches this path) using this exact top-level shape:

```json
{
  "schemaVersion": "3",
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
      "recommendedChoice": "Photo upload/list/delete, AI captions",
      "status": "inferred", "answer": "Photo upload/list/delete, AI captions",
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
      "id": "auth", "category": "auth", "header": "API Login",
      "question": "Does this app need user login?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "Yes", "description": "Add a user sign-in flow and authenticated API access" },
        { "label": "No", "description": "No user sign-in or authenticated API access" }
      ],
      "recommendedChoice": "Yes", "status": "inferred", "answer": "Yes",
      "rationale": "The app stores private, per-user photos."
    },
    {
      "id": "operatingProfile", "category": "deployment", "header": "Operating Profile",
      "question": "How will this app be used?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "Development / Demo", "description": "A prototype, proof of concept, or temporary demonstration" },
        { "label": "Standard Production", "description": "A production app with normal business availability expectations" },
        { "label": "Business-Critical", "description": "An app whose outage or data loss would materially disrupt the business" }
      ],
      "recommendedChoice": "Standard Production", "status": "inferred", "answer": "Standard Production",
      "rationale": "The prompt describes a recurring signed-in experience that stores durable user data."
    },
    {
      "id": "dataClassification", "category": "compliance", "header": "Data Classification",
      "question": "What is the most sensitive data this app will handle?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "Public", "description": "Information intended for public access" },
        { "label": "Internal", "description": "Business information intended only for the organization" },
        { "label": "Confidential / Personal", "description": "Private, personal, or commercially sensitive information" },
        { "label": "Regulated", "description": "Data subject to a legal, industry, or contractual compliance regime" }
      ],
      "recommendedChoice": "Confidential / Personal", "status": "inferred", "answer": "Confidential / Personal",
      "rationale": "Uploaded photos and uploader identity are private personal data."
    },
    {
      "id": "trafficProfile", "category": "scale", "header": "Traffic Profile",
      "question": "What usage pattern should the app support?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "Small / Steady", "description": "Low to moderate traffic without large spikes" },
        { "label": "Bursty", "description": "Occasional sharp traffic spikes or event-driven work" },
        { "label": "High Volume", "description": "Sustained high request, event, or data volume" },
        { "label": "Latency Sensitive", "description": "Interactive operations with strict response-time expectations" }
      ],
      "recommendedChoice": "Bursty", "status": "inferred", "answer": "Bursty",
      "rationale": "Photo uploads and metadata processing can arrive in short bursts."
    },
    {
      "id": "optimizationPriority", "category": "operations", "header": "Optimization Priority",
      "question": "What should architecture tradeoffs prioritize?",
      "multiSelect": false, "allowFreeformInput": false,
      "options": [
        { "label": "Balanced", "description": "Balance cost, reliability, operability, and performance" },
        { "label": "Lowest Cost", "description": "Prefer the lowest practical operating cost and accept documented tradeoffs" },
        { "label": "Highest Reliability", "description": "Prefer availability and recoverability over lower cost" },
        { "label": "Lowest Latency", "description": "Prefer interactive performance over lower cost" }
      ],
      "recommendedChoice": "Balanced", "status": "needs_input", "answer": null,
      "rationale": "The prompt gives no dominant cost, reliability, or latency requirement."
    }
  ]
}
```

**JSON rules** (example above is contract; these highlight non-obvious constraints):

- **Services & IDs:** one `services` entry per detected/planned service. Per-service question `id`s follow `{serviceId}:{questionType}` (e.g. `functions-api:language`); `serviceId` matches service.
- **Language options:** frontend services offer only `TypeScript` / `JavaScript`; backend/worker services offer `TypeScript`, `Python`, `C# (.NET)`.
- **Always emit all six shared questions** (`dataStores`, `auth`, `operatingProfile`, `dataClassification`, `trafficProfile`, `optimizationPriority`), and **never emit an `appType`, identity-provider, Azure credential, or WAF-pillar question**. App Type is derived from `services` (see the derivation table above).
- **`auth` is strictly binary:** its only options, answer values, and recommendation values are `Yes` and `No`. Never put a provider, protocol, token type, or Azure credential in this question.
- **`allowFreeformInput` is fixed per type:** language `false`, `dataStores` `false`, framework `true`, `auth` `false`, and every workload question `false`. Omit it for free-text feature questions.
- **`multiSelect`:** only `dataStores` is `true`; its `answer` and `recommendedChoice` are always `string[]`.
- **Answers:** `inferred` → fill `answer`; `needs_input` → `answer: null` (`[]` for `dataStores`). Always provide `recommendedChoice`.
- **No datastore:** `No datastore required` is an exclusive option. When selected or inferred, it must be the only value in `answer` and `recommendedChoice`. Never combine it with a concrete datastore.
- Use the field name **`rationale`** (not `reason`). Strict JSON — no comments, no trailing commas.
- **`dataStores` Blob Storage rule (MUST):** include `Blob Storage` in `recommendedChoice`, plus `answer` when `inferred`, alongside any database when **either** (a) any service stores/serves files, photos, images, uploads, documents, or media, **or** (b) any backend uses Azure Functions, which requires associated storage account `AzureWebJobsStorage`. Database-only recommendations are wrong for file/photo or Functions apps.

> ❌ **DO NOT** ask which .NET version to target. For service language `C# (.NET)`, target **always `net10.0`**; downgrade only when user explicitly names an older version.

#### 2d. Hand off to the webview — then stop

After writing file, **stop**. Do NOT print JSON, summarize inferences, ask in chat, or generate plan. Workflow opens requirements webview; user answers `needs_input` and clicks **Submit**. Controller writes back statuses → `confirmed`, then re-invokes agent with ready requirements.

#### 2e. Requirements review is mandatory

Always write `.azure/requirements.json` and hand off to requirements webview, even if prompt is unambiguous and every Step 2a question is `inferred`. Pre-select inferred answers, but user must be able to confirm/change them before plan generation.

This includes **small, frontend-only projects**. For *"a simple unit converter web app — nothing needs to be saved, no accounts, no backend, just a clean little frontend tool"*, emit exactly one `services` entry with `role: "frontend"`, its `language`/`framework`/`features` questions, `dataStores` set to `["No datastore required"]`, and `auth` set to `No`. Do **not** write `index.html` or other app code, nor skip webview because "there is nothing to ask".

#### 2f. Re-entry — reading the answered file

When re-invoked about submitted requirements (e.g. *"Requirements submitted at .azure/requirements.json..."*), or whenever all `.azure/requirements.json` questions are `confirmed`/`inferred`:

1. Read `.azure/requirements.json`.
2. **Upgrade before planning:** schema version `3` adds the four workload-quality questions. If the file has
   `schemaVersion: "2"`, preserve its valid services and answers, add the four missing questions using the
   inference/default rules above, set `schemaVersion` to `"3"`, write the upgraded file, and stop so the
   requirements webview can review it. Do not generate a plan from a v2 file.
3. For a v3 file, treat `answer` fields as authoritative — do not re-ask or re-emit the file.
4. Switch to [`plan.md`](plan.md) and go directly to Step 3 (Generate Plan).

> **✅ Checkpoint**: Requirements gathered (via inference + webview submission). Ready to generate plan — continue in [`plan.md`](plan.md).
