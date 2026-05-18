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
| **Mocking Library** | {vi.mock (vitest) / jest.mock / sinon / unittest.mock / Moq / NSubstitute} |
| **Assertion Library** | {vitest expect / jest expect / chai / pytest assert / xUnit Assert / FluentAssertions} |
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

## 5. Project Structure

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

## 6. Route Definitions

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

## 7. Database Constraints

> List all database-level constraints that migrations must enforce. See [database-integrity.md](references/database-integrity.md).

| Table | Constraint Type | Column(s) | Detail |
|-------|----------------|-----------|--------|
| {users} | UNIQUE | {email} | {Prevent duplicate registration} |
| {users} | FK | {couple_id → couples.id} | {ON DELETE SET NULL} |
| {photos} | FK | {couple_id → couples.id} | {ON DELETE CASCADE} |
| {photos} | INDEX | {couple_id} | {Frequent filter column} |
| {invites} | CHECK | {status} | {IN ('pending', 'accepted', 'rejected')} |

> Add/remove rows as needed. Every UNIQUE field, FK relationship, CHECK constraint, and performance index must be listed here.

### 7a. Collection-to-Table Name Mapping

> Document how handler collection names map to SQL table names. The database service's `collectionToTable` function converts collection names used in handler code (e.g., `database.findAll('user')`) to actual SQL table names (e.g., `users`). **Every table in the migration must appear in this mapping.**

| Collection Name (in handler code) | SQL Table Name (in migration) | Mapping Rule |
|-----------------------------------|-------------------------------|--------------|
| {`'user'`} | {`users`} | {camelToSnake + pluralize} |
| {`'couple'`} | {`couples`} | {camelToSnake + pluralize} |
| {`'invite'`} | {`invites`} | {camelToSnake + pluralize} |
| {`'photo'`} | {`photos`} | {camelToSnake + pluralize} |

> ⚠️ If you plan to name a table `pairing_invites` but handlers use `database.findAll('invite')`, the mapping produces `invites` — a mismatch. Either rename the table to `invites` or add an explicit override in `collectionToTable`. Document whichever approach you choose.

---

## 8. Service Dependency Classification

> Classify each external service to determine failure handling. See [resilience.md](references/resilience.md).

| Service | Type | Failure Behavior |
|---------|------|-----------------|
| {PostgreSQL} | Essential | Request fails with 503 |
| {Azure Blob Storage} | Essential | Upload fails with 503 |
| {Azure OpenAI} | Enhancement | Falls back to default caption |
| {Email Service} | Enhancement | Log warning, operation still succeeds |

> **Essential**: Request MUST fail if this service is down.
> **Enhancement**: Request should succeed with degraded output (fallback value).

---

## 9. Execution Checklist

> Each phase has a test gate (🧪). The agent MUST run tests and verify they pass before checking the box and proceeding. If tests fail, iterate on the code until green.

### Phase 1: Planning
- [ ] Analyze workspace (mode: NEW / AUGMENT)
- [ ] Gather requirements (runtime, services, frontend, features)
- [ ] Select test runner
- [ ] Select Azure services
- [ ] Design project structure
- [ ] Define routes
- [ ] Generate execution checklist
- [ ] Define test suite plan
- [ ] Write `.azure/project-plan.md`
- [ ] Present plan — get user approval

### Phase 2: Execution

#### Step 1: Foundation
- [ ] Initialize project config ({package.json / pyproject.toml / .csproj})
- [ ] Configure TypeScript / Python / .NET build
- [ ] Configure linter and formatter
- [ ] Configure test runner ({vitest / jest / mocha / pytest / xunit})
- [ ] Create directory structure
- [ ] Create `.gitignore`
- [ ] 🧪 **Test Gate**: Project builds with zero errors; test runner executes cleanly

#### Step 2: Configuration & Environment
- [ ] Create config module with env var loading
- [ ] Create `.env.example` with all variables
- [ ] Create `local.settings.json` with emulator defaults
- [ ] Implement startup env validation (fail fast on missing required vars)
- [ ] Write config unit tests (load, defaults, missing var error)
- [ ] 🧪 **Test Gate**: All config tests pass

#### Step 3: Service Abstraction Layer
- [ ] Create service interfaces ({IStorageService / IDatabaseService / ICacheService})
- [ ] IDatabaseService includes `transaction()` method for atomic multi-table writes
- [ ] Create concrete implementations (Azure SDK-based, with transaction support)
- [ ] Create mock implementations (in-memory, for tests; mock `transaction()` executes callback directly)
- [ ] Create service factory / registry (returns real or mock based on config)
- [ ] **Registry MUST auto-initialize** with concrete implementations at runtime — `func start` must work without manual setup. Tests pre-register mocks via `setup.ts` to override auto-init.
- [ ] Write unit tests for mock implementations
- [ ] Write unit tests for service factory
- [ ] 🧪 **Test Gate**: All service abstraction tests pass; `func start` loads all functions without errors

#### Step 4: Database Schema & Migrations _(if applicable)_
- [ ] Create migration scripts (schema up/down)
- [ ] Include UNIQUE constraints on business-unique fields (per Section 7)
- [ ] Include FK constraints with ON DELETE behavior (per Section 7)
- [ ] Include CHECK constraints for enum fields (per Section 7)
- [ ] Include indexes on frequently-queried columns (per Section 7)
- [ ] Create seed data fixtures (JSON files with realistic data)
- [ ] Create seed script (idempotent)
- [ ] Write migration tests (forward, backward, idempotent)
- [ ] Write constraint tests (duplicate rejection, FK enforcement)
- [ ] Write seed data tests (correct row counts, no duplicates)
- [ ] 🧪 **Test Gate**: All migration, constraint, and seed tests pass

#### Step 5: Shared Types & Validation
- [ ] Create entity types in `src/shared/types/`
- [ ] Create API request/response contracts in `src/shared/types/`
- [ ] Define error code enum/union type (not plain string)
- [ ] Create validation schemas ({Zod / Pydantic / FluentValidation}) — **one per endpoint that accepts input**
- [ ] Create path parameter validation schemas (e.g., UUID format for `:id`)
- [ ] Create file upload validation (size limit, MIME type check) if applicable
- [ ] Create validation middleware / helper
- [ ] Write validation tests (valid input, invalid input, edge cases, path params, file limits)
- [ ] **Schema completeness check**: verify every route has a corresponding schema
- [ ] 🧪 **Test Gate**: All validation tests pass, schema coverage = 100%

#### Step 6: API Routes / Functions
> Repeat this block for EACH feature/route defined in Section 6:

**Feature: {feature name} — `{METHOD} {/api/path}`**
- [ ] Create function handler (`src/functions/src/functions/{name}.ts`)
- [ ] Use `database.transaction()` if handler writes to 2+ tables
- [ ] Wrap Enhancement service calls in try/catch with fallback (per Section 8)
- [ ] Validate file uploads server-side (size + MIME type) if applicable
- [ ] Write unit tests with mock services and fixture data
- [ ] Test happy path (correct status code, response shape)
- [ ] Test invalid input (400/422 — correct error shape)
- [ ] Test not found (404 — if applicable)
- [ ] Test service failure (500 — correct error shape)
- [ ] Test Enhancement service failure (handler succeeds with fallback)
- [ ] 🧪 **Test Gate**: All tests for `{feature name}` pass

**Feature: {next feature}**
- [ ] ...
- [ ] 🧪 **Test Gate**: All tests for `{next feature}` pass

_(Repeat for every route)_

#### Step 7: Error Handling
- [ ] Create custom error types (NotFoundError, ValidationError, ConflictError, etc.)
- [ ] Create error handler middleware / wrapper
- [ ] Create standardized error response builder
- [ ] Write error handling tests (each error type → correct status + shape)
- [ ] Write unhandled error test (500 with generic message)
- [ ] 🧪 **Test Gate**: All error handling tests pass

#### Step 8: Health Check
- [ ] Create `/api/health` function
- [ ] Implement per-service health checks (DB ping, cache ping, storage check)
- [ ] Write health check tests (all healthy, partial degraded, all unhealthy)
- [ ] 🧪 **Test Gate**: All health check tests pass

#### Step 9: OpenAPI Contract
- [ ] Generate `openapi.yaml` from route definitions
- [ ] Create `/api/openapi.json` endpoint (or serve static file)
- [ ] Write contract tests (valid spec, response shapes match)
- [ ] 🧪 **Test Gate**: Spec is valid, contract tests pass

#### Step 10: Structured Logging
- [ ] Configure logger ({pino / structlog / Serilog})
- [ ] Add request logging middleware (method, path, status, duration)
- [ ] Add operation logging in services (create, update, delete actions)
- [ ] Write logging tests (structured output, correct fields)
- [ ] 🧪 **Test Gate**: All logging tests pass

#### Step 11: Frontend _(if applicable)_
- [ ] Initialize frontend project ({React+Vite / Vue+Vite / Angular / Svelte})
- [ ] Create fully typed API client using shared types — **no `any` types**
- [ ] Configure dev proxy to Functions host
- [ ] Create pages/components for each feature (handle all 4 states: loading, error, empty, data)
- [ ] Error handling in hooks: catch errors, roll back optimistic updates
- [ ] Destructive actions require user confirmation before executing
- [ ] Extract shared components when pages share >50% structure
- [ ] Client-side file upload validation (size + MIME type) if applicable
- [ ] Write auth flow tests (login, logout, token expiry)
- [ ] Write protected route tests (redirect unauthenticated users)
- [ ] Write data display tests (list renders from mock data)
- [ ] Write error state tests (API failure shows error message)
- [ ] Write form validation tests (invalid input shows feedback)
- [ ] 🧪 **Test Gate**: Frontend builds with zero errors, all component tests pass, no `any` types

#### Step 12: Dead Code & Lint Sweep
- [ ] Run linter across entire project — zero errors
- [ ] Remove unused imports, unreferenced functions, dead code paths
- [ ] Verify all defined middleware is wired into handlers
- [ ] Verify schema completeness (every route has a schema)
- [ ] 🧪 **Test Gate**: Linter clean, all tests still pass after cleanup

#### Step 13: Finalize
- [ ] Run full test suite — ALL tests must pass
- [ ] 🧪 **Final Test Gate**: Zero failures across entire project
- [ ] Update `.azure/project-plan.md` status to `Ready`

---

## 10. Test Suite Plan

| # | Test File | Type | Tests | Mock Data Source | Pass Criteria |
|---|-----------|------|-------|-----------------|---------------|
| 1 | `tests/services/config.test.ts` | Unit | Config loading, defaults, missing var errors | Inline env vars | All assertions pass |
| 2 | `tests/services/storage.test.ts` | Unit | Upload, download, list, delete via mock | `tests/fixtures/files.json` | Mock operations match expected calls |
| 3 | `tests/services/database.test.ts` | Unit | CRUD operations via mock | `tests/fixtures/items.json` | Mock operations match expected calls |
| 4 | `tests/validation/itemSchema.test.ts` | Unit | Valid/invalid input variations | Inline test cases | Validation passes/fails correctly |
| 5 | `tests/functions/getItems.test.ts` | Unit | GET /api/items with mock DB | `tests/fixtures/items.json` | Returns 200 + correct items |
| 6 | `tests/functions/createItem.test.ts` | Unit | POST /api/items with valid/invalid body | `tests/fixtures/items.json` | 201 on valid, 400/422 on invalid |
| 7 | `tests/functions/getItemById.test.ts` | Unit | GET /api/items/:id found/not found | `tests/fixtures/items.json` | 200 on found, 404 on missing |
| 8 | `tests/errors/errorHandler.test.ts` | Unit | Error type → status code mapping | Inline error instances | Correct status + response shape |
| 9 | `tests/functions/health.test.ts` | Unit | Health check with mocked services | Mock service health methods | Correct aggregate status |
| {n} | `{test file path}` | {Unit/Integration} | {what it tests} | {fixture file or inline} | {pass criteria} |

> Add rows for every test file in the project. Each module should have at least one corresponding test file.

---

## 11. Files to Generate

| File | Action | Description |
|------|--------|-------------|
| `.env.example` | CREATE | Environment variable template with documentation |
| `.gitignore` | CREATE/MODIFY | Runtime-appropriate ignore rules |
| `{project config}` | CREATE | `package.json` / `pyproject.toml` / `.csproj` |
| `{build config}` | CREATE | `tsconfig.json` / build settings |
| `{test config}` | CREATE | `vitest.config.ts` / `jest.config.ts` / `.mocharc.yml` / `pytest.ini` |
| `{lint config}` | CREATE | `.eslintrc.*` / `ruff.toml` / `.editorconfig` |
| `src/functions/host.json` | CREATE | Functions host configuration |
| `src/functions/local.settings.json` | CREATE | Functions local env config |
| `src/functions/src/services/config.ts` | CREATE | Configuration loader + validation |
| `src/functions/src/services/interfaces/*` | CREATE | Service contracts |
| `src/functions/src/services/*.ts` | CREATE | Service implementations |
| `src/functions/src/errors/*` | CREATE | Error types and handler |
| `src/functions/src/middleware/*` | CREATE | Request logging, validation |
| `src/functions/src/functions/*.ts` | CREATE | Function handlers (one per route) |
| `src/functions/openapi.yaml` | CREATE | OpenAPI 3.x specification |
| `src/functions/tests/**` | CREATE | All test files |
| `src/functions/tests/fixtures/*` | CREATE | Mock data fixtures |
| `src/functions/tests/mocks/*` | CREATE | Mock service implementations |
| `src/shared/types/*` | CREATE | Shared entity and API types |
| `src/shared/schemas/*` | CREATE | Validation schemas |
| `src/web/**` | CREATE | Frontend (if applicable) |

---

## 12. Next Steps

**Current Phase**: {Planning | Execution}

**When current phase completes:**

1. **Set up local dev environment** — Run the **local-dev** skill to add Docker Compose emulators, VS Code F5 debugging, and `docker-compose.yml`. The service abstraction layer generated here is fully compatible.

2. **Deploy to Azure** — Run **azure-prepare** → **azure-validate** → **azure-deploy**. The service abstraction layer ensures your code works against both local mocks and Azure services — no code changes needed.

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
