# Project Plan Template

> Template for `.azure/project-plan.md` — the source of truth for the azure-project-scaffold skill workflow.

---

## Template

````markdown
# Project Plan

**Status**: Planning | Approved | In Progress | Ready
**Created**: {date}
**Mode**: NEW | AUGMENT

---

## 1. Project Overview

**Goal**: {Brief description of what the user is building}. The project is designed so that every module is independently testable. An AI agent can self-validate each component by running its test suite — if tests pass, the module is working as intended.

**App Type**: {API only | SPA + API | Full-stack SSR | Static + API | Background worker}

**Mode**: {NEW | AUGMENT}
- NEW: Scaffolding entire project from scratch
- AUGMENT: Adding structure, services, or tests to an existing project

**Deployment Plan**: {`.azure/plan.md` found — services derived from deployment plan | No deployment plan found — services determined from workspace analysis and user input}

---

## 2. Runtime & Framework

| Component | Technology |
|-----------|-----------|
| **Runtime** | {TypeScript / Python / C#} |
| **Backend** | {Azure Functions v4} |
| **Frontend** | {React + Vite / Vue + Vite / Angular / Svelte / None} |
| **Package Manager** | {npm / pnpm / pip / poetry / dotnet} |

---

## 3. Test Runner & Configuration

| Component | Technology |
|-----------|-----------|
| **Test Runner** | {vitest / jest / mocha+chai+sinon / pytest / xUnit / NUnit} |
| **Mocking Library** | {vi.mock (vitest) / jest.mock / sinon / unittest.mock / **NSubstitute** (.NET — never Moq)} |
| **Assertion Library** | {vitest expect / jest expect / chai / pytest assert / xUnit Assert + **Shouldly** (.NET — never FluentAssertions ≥ 8.0)} |
| **Coverage Tool** | {vitest --coverage / jest --coverage / nyc / pytest-cov / coverlet} |
| **Test Command** | {npm test / pytest / dotnet test} |

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) |
|---------------|------------|---------------------|----------------------|
| {Blob Storage} | {Store uploaded images} | {STORAGE_CONNECTION_STRING} | {UseDevelopmentStorage=true} |
| {PostgreSQL} | {Primary data store} | {DATABASE_URL} | {postgresql://localdev:localdevpassword@localhost:5432/appdb} |
| {Redis} | {Session caching} | {REDIS_URL} | {redis://localhost:6379} |

> _Services listed here are for code and environment configuration. To run these services locally via Docker emulators, use the **local-dev** skill._

---

## 5. Design System & UI

> **MANDATORY when the plan includes a frontend.** Skip this section only for `API only` / `Background worker` app types. The plan-preview webview parses this section by title (it looks for "Design System") and the scaffold quality contract reads `Component Library:` to decide which real library primitives to render. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md).

**Component Library**: {Fluent UI v9 / Vuetify 3 / Skeleton UI / Angular Material / Pico.css — pick the default for the chosen frontend framework, see the plan skill's "Component Library Defaults" table}
**Style Direction**: {1–2 sentence design intent, e.g. "Modern data-dense console with subtle elevations, rounded 4px corners, and an emphasis on scannable lists over hero imagery."}
**Typography**: {Inter, system-ui / Roboto / Segoe UI Variable}

### Color Palette

> **Pick hex values that fit the project.** Use `Style Direction` above plus any brand cues from the user's prompt (industry, mood, named colors, existing logos) to choose colors. The values in `{}` below are FALLBACK defaults — only keep them verbatim when the project has no brand or style direction. Token names (`primary`, `accent`, `surface`, `text`, `muted`, `border`) are fixed — do NOT rename or add tokens; the scaffold's quality contract and preview theming key off these exact names.

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

> **Layout tokens are layout INTENT, not implementation.** The scaffold agent renders each token using `Component Library` primitives per [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) — never as raw `<div>` placeholders. Recognized tokens: `header, nav, sidebar, hero, main, list, card-list, grid, form, table, actions, action-bar, tabs, modal, footer`. Compound tokens: `split(a|b)` (1:2 columns), `two-column(a+b)` (1:1 columns).

---

## 6. Project Structure

```
{Generated directory tree showing the planned project layout}

Example for TypeScript:
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
│   │   ├── vitest.config.ts        ← (or jest.config.ts, .mocharc.yml)
│   │   ├── openapi.yaml
│   │   ├── src/
│   │   │   ├── functions/          ← One file per Azure Function
│   │   │   │   ├── getItems.ts
│   │   │   │   ├── createItem.ts
│   │   │   │   ├── getItemById.ts
│   │   │   │   ├── health.ts
│   │   │   │   └── openapi.ts
│   │   │   ├── services/           ← Service abstraction layer
│   │   │   │   ├── interfaces/     ← Service contracts
│   │   │   │   │   ├── IStorageService.ts
│   │   │   │   │   ├── IDatabaseService.ts
│   │   │   │   │   └── ICacheService.ts
│   │   │   │   ├── storage.ts      ← Concrete implementation
│   │   │   │   ├── database.ts
│   │   │   │   ├── cache.ts
│   │   │   │   ├── config.ts       ← Configuration loader + validation
│   │   │   │   └── registry.ts     ← Service factory / DI registry
│   │   │   ├── errors/             ← Error types and middleware
│   │   │   │   ├── AppError.ts
│   │   │   │   ├── errorHandler.ts
│   │   │   │   └── errorTypes.ts
│   │   │   ├── middleware/         ← Request middleware
│   │   │   │   ├── requestLogger.ts
│   │   │   │   └── validateRequest.ts
│   │   │   └── logger.ts          ← Structured logger setup
│   │   ├── tests/
│   │   │   ├── fixtures/           ← Mock data / fixture files
│   │   │   │   ├── items.json
│   │   │   │   └── users.json
│   │   │   ├── mocks/              ← Mock service implementations
│   │   │   │   ├── mockStorage.ts
│   │   │   │   ├── mockDatabase.ts
│   │   │   │   └── mockCache.ts
│   │   │   ├── services/           ← Service unit tests
│   │   │   │   ├── config.test.ts
│   │   │   │   ├── storage.test.ts
│   │   │   │   └── database.test.ts
│   │   │   ├── functions/          ← Function handler tests
│   │   │   │   ├── getItems.test.ts
│   │   │   │   ├── createItem.test.ts
│   │   │   │   └── health.test.ts
│   │   │   ├── errors/             ← Error handling tests
│   │   │   │   └── errorHandler.test.ts
│   │   │   └── validation/         ← Validation schema tests
│   │   │       └── itemSchema.test.ts
│   │   └── seeds/                  ← Database seed data
│   │       ├── seed.ts
│   │       └── fixtures/
│   │           └── seed-data.json
│   ├── web/                        ← Frontend (if applicable)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── main.tsx
│   │       ├── api/                ← Typed API client
│   │       │   └── client.ts
│   │       ├── components/
│   │       ├── pages/
│   │       └── types/
│   └── shared/                     ← Shared types and schemas
│       ├── package.json
│       ├── types/
│       │   ├── index.ts
│       │   ├── entities.ts         ← Entity types (Item, User, etc.)
│       │   └── api.ts              ← API request/response contracts
│       └── schemas/
│           └── validation.ts       ← Zod / validation schemas
└── data/                           ← Volume mounts (gitignored)
```

---

## 7. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check — reports status of all services | — | `{ status, services: {...} }` | None | 200, 503 |
| 2 | GET | `/api/items` | List all items with optional filtering | Query: `?limit=20&offset=0` | `{ items: Item[], total: number }` | {None/Required} | 200 |
| 3 | POST | `/api/items` | Create a new item | `{ name, description, ... }` | `{ item: Item }` | {None/Required} | 201, 400, 422 |
| 4 | GET | `/api/items/:id` | Get item by ID | — | `{ item: Item }` | {None/Required} | 200, 404 |
| 5 | PUT | `/api/items/:id` | Update item | `{ name?, description?, ... }` | `{ item: Item }` | {None/Required} | 200, 400, 404, 422 |
| 6 | DELETE | `/api/items/:id` | Delete item | — | `{ success: true }` | {None/Required} | 200, 404 |
| {n} | {METHOD} | {/api/path} | {description} | {body shape or —} | {response shape} | {auth} | {codes} |

> Replace `Item` with actual entity names. Add/remove rows as needed per the user's feature requirements.

---

## 8. Execution Checklist

> High-level phases the scaffold agent will execute. The scaffold expands these into step-by-step items with build gates in `.azure/execution-checklist.md`. Test coverage is added separately by `azure-project-test`.

### Phase 1: Planning
- [ ] Analyze workspace (mode: NEW / AUGMENT)
- [ ] Gather requirements (runtime, services, frontend, features)
- [ ] Select Azure services
- [ ] Design project structure
- [ ] Define routes
- [ ] Write `.azure/project-plan.md`
- [ ] Present plan — get user approval

### Phase 2: Execution

#### Step 1: Frontend Preview _(if applicable)_
- [ ] Scaffold frontend project ({React+Vite / Vue+Vite / Angular / Svelte})
- [ ] Generate all pages and components using **mock data + mock types** — no backend required
- [ ] Open preview in browser; report URL to the user
- [ ] 🧪 **Quality Gate** (per `references/frontend-quality-bar.md`): all 4 states handled (loading/error/empty/data), no `any` types, all routes render
- [ ] Hand off URL to user for review while backend Phase A/B sub-agents run in parallel

#### Step 2: Foundation
- [ ] Initialize project config ({package.json / pyproject.toml / .csproj})
- [ ] Configure TypeScript / Python / .NET build
- [ ] Configure linter and formatter
- [ ] Create directory structure
- [ ] Create `.gitignore`
- [ ] 🧪 **Build Gate**: Project builds with zero errors

#### Step 3: Configuration & Environment
- [ ] Create config module with env var loading
- [ ] Create `.env.example` with all variables
- [ ] Create `local.settings.json` with emulator defaults
- [ ] Implement startup env validation (fail fast on missing required vars)
- [ ] 🧪 **Build Gate**: Config module compiles, env validation runs on import

#### Step 4: Service Abstraction Layer
- [ ] Create service interfaces ({IStorageService / IDatabaseService / ICacheService})
- [ ] IDatabaseService includes `transaction()` method for atomic multi-table writes
- [ ] Create concrete implementations (Azure SDK-based, with transaction support)
- [ ] Create mock implementations (in-memory; mock `transaction()` executes callback directly)
- [ ] Create service factory / registry (returns real or mock based on config)
- [ ] **Registry MUST auto-initialize** with concrete implementations at runtime — `func start` must work without manual setup
- [ ] 🧪 **Build Gate**: `func start` loads all functions without errors

#### Step 5: Database Schema & Migrations _(if applicable)_
- [ ] Create migration scripts (schema up/down)
- [ ] Include UNIQUE / FK / CHECK constraints and indexes per `../shared-references/database-integrity.md`
- [ ] Create seed data fixtures (JSON files with realistic data)
- [ ] Create seed script (idempotent)
- [ ] 🧪 **Build Gate**: Migration runs against a fresh database without errors

#### Step 6: Shared Types & Validation
- [ ] Create entity types in `src/shared/types/`
- [ ] Create API request/response contracts in `src/shared/types/`
- [ ] Define error code enum/union type (not plain string)
- [ ] Create validation schemas ({Zod / Pydantic / FluentValidation}) — **one per endpoint that accepts input**
- [ ] Create path parameter validation schemas (e.g., UUID format for `:id`)
- [ ] Create file upload validation (size limit, MIME type check) if applicable
- [ ] Create validation middleware / helper
- [ ] **Schema completeness check**: verify every route has a corresponding schema
- [ ] 🧪 **Build Gate**: Types and schemas compile; schema coverage = 100%

#### Step 7: API Routes / Functions
> Repeat this block for EACH feature/route defined in Section 7:

**Feature: {feature name} — `{METHOD} {/api/path}`**
- [ ] Create function handler (`src/functions/src/functions/{name}.ts`)
- [ ] Use `database.transaction()` if handler writes to 2+ tables
- [ ] Wrap Enhancement service calls in try/catch with fallback (per `../shared-references/resilience.md`)
- [ ] Validate file uploads server-side (size + MIME type) if applicable
- [ ] 🧪 **Build Gate**: Handler compiles, registers in Functions host, responds to a smoke request

**Feature: {next feature}**
- [ ] ...

_(Repeat for every route)_

#### Step 8: Error Handling
- [ ] Create custom error types (NotFoundError, ValidationError, ConflictError, etc.)
- [ ] Create error handler middleware / wrapper
- [ ] Create standardized error response builder
- [ ] 🧪 **Build Gate**: Error types compile and integrate with handler middleware

#### Step 9: Health Check
- [ ] Create `/api/health` function
- [ ] Implement per-service health checks (DB ping, cache ping, storage check)
- [ ] 🧪 **Build Gate**: `/api/health` returns 200 with all services reporting status

#### Step 10: OpenAPI Contract
- [ ] Generate `openapi.yaml` from route definitions
- [ ] Create `/api/openapi.json` endpoint (or serve static file)
- [ ] 🧪 **Build Gate**: Spec parses as valid OpenAPI 3.x

#### Step 11: Structured Logging
- [ ] Configure logger ({pino / structlog / `ILogger<T>` + OpenTelemetry — never Serilog for .NET})
- [ ] Add request logging middleware (method, path, status, duration)
- [ ] Add operation logging in services (create, update, delete actions)
- [ ] 🧪 **Build Gate**: A request emits a structured log line

#### Step 12: Wire Frontend _(if applicable)_
- [ ] Replace mock data fetchers with real API client calls
- [ ] Swap mock types for the shared types from Step 6
- [ ] Configure dev proxy to Functions host
- [ ] Error handling in hooks: catch errors, roll back optimistic updates
- [ ] Destructive actions require user confirmation before executing
- [ ] Client-side file upload validation (size + MIME type) if applicable
- [ ] 🧪 **Build Gate**: Frontend builds with zero errors, no `any` types, no remaining mock imports

#### Step 13: Wrap Up & Smoke Test
- [ ] Run linter across entire project — zero errors
- [ ] Remove unused imports, unreferenced functions, dead code paths
- [ ] Verify all defined middleware is wired into handlers
- [ ] Run a full smoke test: `func start` + a request against each route
- [ ] Update `.azure/project-plan.md` status to `Ready`
- [ ] 🧪 **Final Gate**: Build clean, lint clean, smoke test passes

> Test coverage (unit + integration + mocks) is added by **`azure-project-test`** in a separate phase. The scaffold's Build Gates only verify that code compiles and the host loads.

---

## 9. Next Steps

**Current Phase**: {Planning | Execution}

**When current phase completes:**

1. **Add test coverage** — Run **azure-project-test** to scaffold the test suite (unit + integration + mocks), then run the lint sweep and validate the build.

2. **Set up local dev environment** — Run **azure-localdev** to add Docker Compose emulators, VS Code F5 debugging, and `docker-compose.yml`. The service abstraction layer generated here is fully compatible.

3. **Deploy to Azure** — Run **azure-prepare** → **azure-validate** → **azure-deploy**. The service abstraction layer ensures your code works against both local mocks and Azure services — no code changes needed.

> **Note**: {If derived from `.azure/plan.md`} This project was configured to use the Azure services from your deployment plan (`.azure/plan.md`). The service abstraction layer generates appropriate interfaces for each planned service.
````

---

## Usage Rules

1. **Replace all `{placeholders}`** with actual values from requirements gathering
2. **Only include services the user actually needs** in the Services Required table
3. **Only include routes the user actually needs** in the Route Definitions table — do not generate example CRUD routes unless requested
4. **Adjust the project structure** based on selected runtime (TypeScript / Python / .NET) and mode (NEW / AUGMENT)
5. **Expand the execution checklist** with actual feature names from route definitions — Step 6 should have one block per route
6. **Expand the test suite plan** with actual test files that will be created
7. **Update the checklist** as each step is completed during execution
8. **Set status to `Ready`** only after the final test gate passes with zero failures

---

## Status Transitions

```
Planning → Approved → In Progress → Ready
```

| Status | Meaning |
|--------|---------|
| **Planning** | Plan is being created (Phase 1) |
| **Approved** | User has approved the plan — execution can begin |
| **In Progress** | Phase 2 execution is underway |
| **Ready** | All tests pass — project is complete and self-validated |
