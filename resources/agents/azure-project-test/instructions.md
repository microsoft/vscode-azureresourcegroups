# Azure Project Test

> **POST-SCAFFOLD VERIFICATION TOOL**
>
> Runs **after** `azure-project-scaffold`. Adds test coverage, validates build, marks project `Ready`.

---

## 🎯 North Star: Self-Testable by Default

> Every module ships with tests and mock data. Agent self-validates by running test suite. If tests fail, iterate until green.

---

## Triggers

Activate when user wants to:
- Add test coverage to scaffolded project
- Verify scaffolded project works
- Add unit tests after scaffolding
- Validate project quality before deployment

## ❌ DO NOT Activate When

| User Intent | Correct Skill |
|-------------|---------------|
| Plan new project, requirements, preview frontend | **azure-project-plan** |
| Scaffold backend from approved plan | **azure-project-scaffold** |
| Set up local dev environment | **azure-debug-plan** |
| Deploy to Azure | **azure-prepare** |
| Benchmark scaffold quality (read-only) | **scaffold-benchmark** |

---

## Prerequisites

Requires:
1. Project scaffolded by `azure-project-scaffold` (or equivalent). Typical flow: `azure-project-plan` → `azure-project-scaffold` → **this skill**.
2. `.azure/project-plan.md` with status `Scaffolded` or `In Progress` (recommended, not required — can scan codebase)
3. Production code builds cleanly (`tsc` / `dotnet build` / `python -m py_compile`)

If no plan exists, scans codebase to detect:
- Service interfaces
- Route handlers
- Validation schemas
- Entity types

> **Paths shown throughout this skill are example conventions, not assumptions.** Discover the project's actual layout first (read the plan's Project Structure section if present, otherwise scan the workspace) and map these roles onto the real folders. Never assume a specific directory exists.

---

## Rules

1. **Plan is source of truth** — If `.azure/project-plan.md` exists, use its route definitions, service list, types for test generation. Don't re-ask user.
2. **Don't modify production code** — Only create test/mock/fixture files. Exception: lint sweep (V7) may remove dead code.
3. **Test-gate enforcement** — Every step ends with test gate. Run tests. Fail → iterate until green.
4. **Idempotent** — Safe to run multiple times. Overwrites existing test files.
5. **Respect rigor** — Follow plan's test rigor (Full/Partial/None). If unspecified, ask user.

---

## 📦 Context Management — READ THIS FIRST

> **Do NOT read all reference files upfront.** Read lazily — only at step that needs them.

### Step-to-Reference Mapping

| Step | Read ONLY these files |
|------|----------------------|
| V0 (Read Plan) | `.azure/project-plan.md`, scan the project structure, [verification-patterns.md](.github/agents/azure-project-test/references/verification-patterns.md) |
| V1 (Test Infrastructure) | [test-runners.md](.github/agents/azure-project-test/references/test-runners.md) |
| V2 (Mock Implementations) | [mock-patterns.md](.github/agents/azure-project-test/references/mock-patterns.md), source: the service interface and implementation files |
| V3 (Test Fixtures) | Source: the entity type definitions and any seed-data fixtures |
| V4 (Service Tests) | [mandatory-test-patterns.md](.github/agents/azure-project-test/references/mandatory-test-patterns.md) |
| V5 (Validation Tests) | Source: schema files |
| V6 (Handler Tests) | [handler-test-patterns.md](.github/agents/azure-project-test/references/handler-test-patterns.md), [mandatory-test-patterns.md](.github/agents/azure-project-test/references/mandatory-test-patterns.md) |
| V6b (Frontend Tests) | [frontend-test-patterns.md](.github/agents/azure-project-test/references/frontend-test-patterns.md) |
| V7 (Lint) | Source: all `.ts`/`.tsx` files |
| V8 (Build & Full Test Gate) | — |
| V9 (Finalize) | `.azure/execution-checklist.md` |

### Context Release

> After step checkpoint passes, that step's reference no longer needed.

---

## STEP V0: Read Plan & Detect Structure

**Goal**: Understand scaffolded project contents to determine what tests to generate.

| Task | Details |
|------|---------|
| Read project plan | Load `.azure/project-plan.md`. Extract: routes, services, entities, schemas, frontend, test rigor |
| Scan service interfaces | List the service-interfaces folder for service names |
| Scan handlers | List the route-handlers folder for handlers. Read each for `app.http()` name and path |
| Scan shared types | Read the entity type and validation schema files for shapes/schemas |
| Scan concrete implementations | Read concrete services for field handling (auto-managed, timestamps, key conversion) |
| **Scan existing tests** | List `tests/`, `tests/functions/`, `tests/services/`, `tests/validation/`, `tests/mocks/`, `tests/fixtures/`. Count existing. |
| **Gap analysis** | Compare: handler files vs handler tests, interfaces vs service tests, schemas vs schema tests. Report missing. |
| Select test rigor | If plan has rigor, use it. Otherwise ask: Full / Partial / None |

> ⚠️ **IMPORTANT**: Existing test files do NOT mean testing complete. Always perform full gap analysis. If partial infrastructure exists, identify missing and generate only what's needed. Do NOT skip because some tests exist.

> **✅ Checkpoint**: Complete inventory of routes, services, schemas, types — AND gap report showing which modules need tests.

---

## STEP V1: Test Infrastructure

**Goal**: Set up test runner and shared utilities.

**Reference**: [test-runners.md](.github/agents/azure-project-test/references/test-runners.md) for runner configs and vitest resolve alias patterns.

| Task | Details |
|------|---------|
| Configure test runner | `vitest.config.ts` (TS) / `pytest.ini` (Python) / test project (C#) with resolve aliases for workspace imports |
| Create test setup | `tests/setup.ts` — registers mocks before each test, sets env vars |
| Create test helpers | `tests/helpers.ts` — typed mock factories: `createMockContext()`, `createMockRequest()`, `createAuthenticatedRequest()`. **Zero `any`.** |
| Add test scripts | Add `"test"` to `package.json` if missing |

> **🧪 Test Gate**: `npx vitest run` executes with zero tests, exits cleanly.

---

## STEP V2: Mock Implementations

**Goal**: In-memory mock implementations for each service interface.

**Reference**: [mock-patterns.md](.github/agents/azure-project-test/references/mock-patterns.md) for mock implementation patterns.

For EACH service interface in the project:

| Task | Details |
|------|---------|
| Read interface | Extract method signatures from the `I{Service}Service` interface |
| Read concrete | Understand field handling (auto-managed fields, timestamps, key conversion) |
| Create mock | In-memory impl replicating concrete behaviors, placed in the tests' mocks folder (e.g. `tests/mocks/mock{Service}.ts`) |

> **🧪 Test Gate**: Mock files exist and compile cleanly.

---

## STEP V3: Test Fixtures

**Goal**: Realistic test data from entity types and seed data.

| Task | Details |
|------|---------|
| Read entity types | From the entity type definitions — field names and types |
| Read seed data | From any seed-data fixtures — basis for fixtures |
| Create fixture JSON | `tests/fixtures/{entity}.json` — 2-3 records per entity with realistic data and cross-references |

### Fixture Design Rules
- Human-readable IDs (e.g., `usr-001`, `cpl-001`)
- At least one entity per "state" (e.g., coupled + uncoupled user)
- Cross-reference FKs correctly
- camelCase keys (matching TS entities, not SQL snake_case)

> **✅ Checkpoint**: Fixture files exist with valid JSON. Each entity has 2+ records.

---

## Sub-Agent Strategy for Test Generation (V4–V6)

> ⚠️ **Parallelization**: After V1-V3 complete (infra, mocks, fixtures), V4-V6 can run in parallel via sub-agents. Each writes different test files — no conflicts.

### Execution Model

**Phase V-A (sequential — complete first):**
- V1: Test infra (vitest.config.ts, setup.ts, helpers.ts)
- V2: Mock implementations
- V3: Test fixtures

**Phase V-B (parallel sub-agents — launch after V-A completes):**

| Sub-Agent | Scope | Test Files |
|-----------|-------|------------|
| **Agent 1**: Validation + Services | V4 (registry tests) + V5 (schema tests) | `tests/services/registry.test.ts`, `tests/validation/schemas.test.ts` |
| **Agent 2**: Auth + User handler tests | V6 partial (auth-login, auth-me, users-get, health) | `tests/functions/auth-*.test.ts`, `tests/functions/users-get.test.ts`, `tests/functions/health.test.ts` |
| **Agent 3**: Feature handler tests | V6 partial (couples-*, photos-*) | `tests/functions/couples-*.test.ts`, `tests/functions/photos-*.test.ts` |

Each agent receives:
- Full project plan
- All handler source in scope
- Shared test infra (helpers.ts, setup.ts, mocks/*, fixtures/*)

After all complete, proceed to V7 (Lint) and V8 (Build & Test).

> **Fallback**: If parallelization not feasible, run V4 → V5 → V6 sequentially. Parallel strategy is optimization, not requirement.

---

## STEP V4: Service Tests

**Goal**: Test service registry and contracts.

**Reference**: [mandatory-test-patterns.md](.github/agents/azure-project-test/references/mandatory-test-patterns.md) for auto-init test (MANDATORY) and Enhancement resilience pattern.

| Test File | Tests |
|-----------|-------|
| `tests/services/registry.test.ts` | Mock registration, re-registration after clear, pre-registered priority, **auto-init test (Rule 13)**: `clearServices()` → `getServices()` → `.not.toThrow()` |

> **🧪 Test Gate**: Registry tests pass. Auto-init test passes (`.not.toThrow()`).

---

## STEP V5: Validation Tests

**Goal**: Test all Zod/Pydantic/FluentValidation schemas.

For EACH validation schema in the project:

| Test | Pattern |
|------|---------|
| Valid input passes | `schema.safeParse(validData)` → `success: true` |
| Missing required field | `schema.safeParse({...valid, field: undefined})` → `success: false` |
| Invalid format | e.g., bad email, short password → `success: false` with correct error |
| Edge cases | Empty strings, boundary values, null |
| File upload validation | If `validateFileUpload` exists: valid image passes, oversized fails, wrong MIME fails |

> **🧪 Test Gate**: All validation tests pass.

---

## STEP V6: Handler Tests

**Goal**: Test each route handler with mock services.

**Reference**: [handler-test-patterns.md](.github/agents/azure-project-test/references/handler-test-patterns.md) for typed handler test template, required-tests-per-handler matrix, naming conventions. [mandatory-test-patterns.md](.github/agents/azure-project-test/references/mandatory-test-patterns.md) for Enhancement resilience pattern.

#### Pre-Step: Route Coverage Audit

Before generating tests:

1. **Count handlers**: List handler files in the route-handlers folder (excluding `health` and `openapi` handlers)
2. **Count existing tests**: List `.test.ts` in `tests/functions/`
3. **Match**: For each handler `{name}.ts`, check `{name}.test.ts` exists
4. **Report gaps**: _"X of Y handlers covered. Missing: [list]"_
5. **Generate only missing**: Do NOT overwrite existing test files.

> ⚠️ Do NOT skip handler test generation because some tests exist. Audit ensures ALL covered.

> **🧪 Test Gate (per handler)**: All tests pass. Move to next handler.

---

## STEP V6b: Frontend Component Tests (If Applicable, Full Rigor Only)

> **Skip** if: (a) no frontend, (b) rigor Partial/None, (c) the frontend folder doesn't exist.

**Goal**: React component tests for auth flow, protected routes, data display, error states.

**Reference**: [frontend-test-patterns.md](.github/agents/azure-project-test/references/frontend-test-patterns.md) for prerequisites, vitest config, coverage matrix, patterns.

> **🧪 Test Gate**: All frontend tests pass. The frontend test run (e.g. `npx vitest run` in the frontend folder) is clean.

---

## STEP V7: Lint Sweep

**Goal**: Clean up the codebase.

| Check | Action |
|-------|--------|
| `any` types | Grep `\bany\b` in all `.ts`/`.tsx`. Report count. |
| Direct SDK imports | Grep `from '(@azure/storage|pg|openai)` in handlers. Only `@azure/functions` allowed. |
| Duplicated helpers | Grep functions defined in 3+ handlers. Extract to a shared utilities module. |
| Unused imports | `tsc --noUnusedLocals --noUnusedParameters --noEmit` or eslint |
| Schema completeness | Count routes vs schemas. Report gaps. |

> **NOTE**: May modify production code (removing dead code, extracting helpers). One exception to "don't modify production code" rule.

> **🧪 Test Gate**: Zero `any`. Zero duplicated helpers. All tests still pass.

---

## STEP V8: Build & Full Test Gate

**Goal**: Everything compiles, all tests pass.

| Check | Command |
|-------|---------|
| Shared builds | Build the shared types workspace (e.g. `npx tsc`) |
| Functions build | Build the Functions workspace (e.g. `npx tsc`) |
| Frontend builds | Build the frontend workspace (e.g. `npx vite build` or `tsc --noEmit`) |
| Full test suite | Run the full test suite in the Functions workspace (e.g. `npx vitest run`) — ALL pass |

> **🧪 Test Gate**: Zero build errors. Zero test failures. Fix before proceeding.

---

## STEP V9: Finalize

**Goal**: Everything verified, project marked Ready.

| Task | Details |
|------|---------|
| Update checklist | Mark all verify items `[x]` in `.azure/execution-checklist.md` |
| Update plan status | Set `.azure/project-plan.md` to `Ready` |
| Generate summary | Total tests, pass/fail, files created |
| **Suggest next steps** | **MANDATORY**: Present follow-up via `vscode_askQuestions`. Do NOT auto-invoke.\n\n**Header**: "Next Step"\n**Question**: "Verification complete! Set up local dev?"\n**Options** (allowFreeformInput: false):\n- **"Set up local dev"** ("Configure Docker emulators, VS Code debugging, F5 launch") — recommended\n\nIf selected → invoke `azure-debug-plan` |

---

## Test Rigor Behavior

| Rigor | V1 | V2 | V3 | V4 | V5 | V6 | V6b | V7 | V8 | V9 |
|-------|:--:|:--:|:--:|:--:|:--:|:--:|:---:|:--:|:--:|:--:|
| **Full** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ All handlers | ✅ Frontend tests | ✅ | ✅ | ✅ |
| **Partial** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Key handlers only | ❌ Skip | ✅ | ✅ | ✅ |
| **None** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Lint only | ✅ Build only | ✅ |

> At **None** rigor, only the lint sweep and build gate run. For runtime verification against live endpoints, use `azure-debug-plan`.

---

## Outputs

> Locations below describe **roles**, not fixed paths — they land wherever the project's structure places its tests and source. Example paths are illustrative only.

| Artifact | Location |
|----------|----------|
| Test runner config | Functions workspace test config (e.g. `vitest.config.ts`) |
| Test setup | Tests setup file (e.g. `tests/setup.ts`) |
| Test helpers | Tests helpers file (e.g. `tests/helpers.ts`) |
| Mock implementations | Tests mocks folder (e.g. `tests/mocks/mock*.ts`) |
| Test fixtures | Tests fixtures folder (e.g. `tests/fixtures/*.json`) |
| Service tests | Service tests folder (e.g. `tests/services/*.test.ts`) |
| Validation tests | Validation tests folder (e.g. `tests/validation/*.test.ts`) |
| Handler tests | Handler tests folder (e.g. `tests/functions/*.test.ts`) |
| Updated plan | `.azure/project-plan.md` (Status: Ready) |
| Updated checklist | `.azure/execution-checklist.md` (all items checked) |

---

## Next

> **MANDATORY**: Use `vscode_askQuestions` with one option:
>
> **Header**: "Next Step"
> **Question**: "Verification complete! Set up local dev?"
> **Options** (allowFreeformInput: false):
> - **"Set up local dev"** ("Configure Docker emulators, VS Code debugging, F5 launch") — recommended
>
> If selected → invoke `azure-debug-plan`
>
> Do NOT print plain-text suggestions. Do NOT suggest deploy or benchmark.
