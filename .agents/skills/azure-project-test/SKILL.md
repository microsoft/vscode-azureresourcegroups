---
name: azure-project-test
description: "Add test coverage and build verification to a project scaffolded by azure-project-scaffold. Generates test infrastructure, mock services, test fixtures, unit tests for all routes/services/validation, runs lint sweep, and validates the build. WHEN: \"verify project\", \"add tests\", \"test scaffold\", \"verify scaffold\", \"add test coverage\", \"validate project\", \"project test\", \"azure project test\", \"add unit tests\", \"test coverage\", \"test app\"."
license: MIT
metadata:
  author: Microsoft
  version: "1.0.0"
---

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
| Set up local dev environment | **azure-localdev** |
| Deploy to Azure | **azure-prepare** |
| Benchmark scaffold quality (read-only) | **scaffold-benchmark** |

---

## Prerequisites

Requires:
1. Project scaffolded by `azure-project-scaffold` (or equivalent). Typical flow: `azure-project-plan` → `azure-project-scaffold` → **this skill**.
2. `.azure/project-plan.md` with status `Scaffolded` or `In Progress` (recommended, not required — can scan codebase)
3. Production code builds cleanly (`tsc` / `dotnet build` / `python -m py_compile`)

If no plan exists, scans codebase to detect:
- Service interfaces (`src/functions/src/services/interfaces/`)
- Route handlers (`src/functions/src/functions/`)
- Validation schemas (`src/shared/schemas/`)
- Entity types (`src/shared/types/`)

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
| V0 (Read Plan) | `.azure/project-plan.md`, scan `src/` structure, [verification-patterns.md](references/verification-patterns.md) |
| V1 (Test Infrastructure) | [test-runners.md](references/test-runners.md) |
| V2 (Mock Implementations) | [mock-patterns.md](references/mock-patterns.md), source: `src/functions/src/services/interfaces/*.ts` and `src/functions/src/services/*.ts` |
| V3 (Test Fixtures) | Source: `src/shared/types/entities.ts`, `seeds/fixtures/seed-data.json` |
| V4 (Service Tests) | [mandatory-test-patterns.md](references/mandatory-test-patterns.md) |
| V5 (Validation Tests) | Source: schema files |
| V6 (Handler Tests) | [handler-test-patterns.md](references/handler-test-patterns.md), [mandatory-test-patterns.md](references/mandatory-test-patterns.md) |
| V6b (Frontend Tests) | [frontend-test-patterns.md](references/frontend-test-patterns.md) |
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
| Scan service interfaces | List `src/functions/src/services/interfaces/` for service names |
| Scan handlers | List `src/functions/src/functions/` for handlers. Read each for `app.http()` name and path |
| Scan shared types | Read `src/shared/types/entities.ts` and `src/shared/schemas/validation.ts` for shapes/schemas |
| Scan concrete implementations | Read concrete services for field handling (auto-managed, timestamps, key conversion) |
| **Scan existing tests** | List `tests/`, `tests/functions/`, `tests/services/`, `tests/validation/`, `tests/mocks/`, `tests/fixtures/`. Count existing. |
| **Gap analysis** | Compare: handler files vs handler tests, interfaces vs service tests, schemas vs schema tests. Report missing. |
| Select test rigor | If plan has rigor, use it. Otherwise ask: Full / Partial / None |

> ⚠️ **IMPORTANT**: Existing test files do NOT mean testing complete. Always perform full gap analysis. If partial infrastructure exists, identify missing and generate only what's needed. Do NOT skip because some tests exist.

> **✅ Checkpoint**: Complete inventory of routes, services, schemas, types — AND gap report showing which modules need tests.

---

## STEP V1: Test Infrastructure

**Goal**: Set up test runner and shared utilities.

**Reference**: [test-runners.md](references/test-runners.md) for runner configs and vitest resolve alias patterns.

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

**Reference**: [mock-patterns.md](references/mock-patterns.md) for mock implementation patterns.

For EACH interface in `src/functions/src/services/interfaces/`:

| Task | Details |
|------|---------|  
| Read interface | Extract method signatures from `I{Service}Service.ts` |
| Read concrete | Understand field handling (auto-managed fields, timestamps, key conversion) |
| Create mock | In-memory impl replicating concrete behaviors. `tests/mocks/mock{Service}.ts` |

> **🧪 Test Gate**: Mock files exist and compile cleanly.

---

## STEP V3: Test Fixtures

**Goal**: Realistic test data from entity types and seed data.

| Task | Details |
|------|---------|  
| Read entity types | From `src/shared/types/entities.ts` — field names and types |
| Read seed data | From `seeds/fixtures/seed-data.json` — basis for fixtures |
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

**Reference**: [mandatory-test-patterns.md](references/mandatory-test-patterns.md) for auto-init test (MANDATORY) and Enhancement resilience pattern.

| Test File | Tests |
|-----------|-------|
| `tests/services/registry.test.ts` | Mock registration, re-registration after clear, pre-registered priority, **auto-init test (Rule 13)**: `clearServices()` → `getServices()` → `.not.toThrow()` |

> **🧪 Test Gate**: Registry tests pass. Auto-init test passes (`.not.toThrow()`).

---

## STEP V5: Validation Tests

**Goal**: Test all Zod/Pydantic/FluentValidation schemas.

For EACH schema in `src/shared/schemas/validation.ts`:

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

**Reference**: [handler-test-patterns.md](references/handler-test-patterns.md) for typed handler test template, required-tests-per-handler matrix, naming conventions. [mandatory-test-patterns.md](references/mandatory-test-patterns.md) for Enhancement resilience pattern.

#### Pre-Step: Route Coverage Audit

Before generating tests:

1. **Count handlers**: List `.ts` in `src/functions/src/functions/` (excluding `health.ts`, `openapi.ts`)
2. **Count existing tests**: List `.test.ts` in `tests/functions/`
3. **Match**: For each handler `{name}.ts`, check `{name}.test.ts` exists
4. **Report gaps**: _"X of Y handlers covered. Missing: [list]"_
5. **Generate only missing**: Do NOT overwrite existing test files.

> ⚠️ Do NOT skip handler test generation because some tests exist. Audit ensures ALL covered.

> **🧪 Test Gate (per handler)**: All tests pass. Move to next handler.

---

## STEP V6b: Frontend Component Tests (If Applicable, Full Rigor Only)

> **Skip** if: (a) no frontend, (b) rigor Partial/None, (c) `src/web/` doesn't exist.

**Goal**: React component tests for auth flow, protected routes, data display, error states.

**Reference**: [frontend-test-patterns.md](references/frontend-test-patterns.md) for prerequisites, vitest config, coverage matrix, patterns.

> **🧪 Test Gate**: All frontend tests pass. `npx vitest run` in `src/web/` clean.

---

## STEP V7: Lint Sweep

**Goal**: Clean up the codebase.

| Check | Action |
|-------|--------|
| `any` types | Grep `\bany\b` in all `.ts`/`.tsx`. Report count. |
| Direct SDK imports | Grep `from '(@azure/storage|pg|openai)` in handlers. Only `@azure/functions` allowed. |
| Duplicated helpers | Grep functions defined in 3+ handlers. Extract to `src/utils/`. |
| Unused imports | `tsc --noUnusedLocals --noUnusedParameters --noEmit` or eslint |
| Schema completeness | Count routes vs schemas. Report gaps. |

> **NOTE**: May modify production code (removing dead code, extracting helpers). One exception to "don't modify production code" rule.

> **🧪 Test Gate**: Zero `any`. Zero duplicated helpers. All tests still pass.

---

## STEP V8: Build & Full Test Gate

**Goal**: Everything compiles, all tests pass.

| Check | Command |
|-------|---------|  
| Shared builds | `cd src/shared && npx tsc` |
| Functions build | `cd src/functions && npx tsc` |
| Frontend builds | `cd src/web && npx vite build` (or `tsc --noEmit`) |
| Full test suite | `cd src/functions && npx vitest run` — ALL pass |

> **🧪 Test Gate**: Zero build errors. Zero test failures. Fix before proceeding.

---

## STEP V9: Finalize

**Goal**: Everything verified, project marked Ready.

| Task | Details |
|------|---------|  
| Update checklist | Mark all verify items `[x]` in `.azure/execution-checklist.md` |
| Update plan status | Set `.azure/project-plan.md` to `Ready` |
| Generate summary | Total tests, pass/fail, files created |
| **Suggest next steps** | **MANDATORY**: Present follow-up via `vscode_askQuestions`. Do NOT auto-invoke.\n\n**Header**: "Next Step"\n**Question**: "Verification complete! Set up local dev?"\n**Options** (allowFreeformInput: false):\n- **"Set up local dev"** ("Configure Docker emulators, VS Code debugging, F5 launch") — recommended\n\nIf selected → invoke `azure-localdev` |

---

## Test Rigor Behavior

| Rigor | V1 | V2 | V3 | V4 | V5 | V6 | V6b | V7 | V8 | V9 |
|-------|:--:|:--:|:--:|:--:|:--:|:--:|:---:|:--:|:--:|:--:|
| **Full** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ All handlers | ✅ Frontend tests | ✅ | ✅ | ✅ |
| **Partial** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Key handlers only | ❌ Skip | ✅ | ✅ | ✅ |
| **None** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Lint only | ✅ Build only | ✅ |

> At **None** rigor, only the lint sweep and build gate run. For runtime verification against live endpoints, use `azure-localdev`.

---

## Outputs

| Artifact | Location |
|----------|----------|
| Test runner config | `src/functions/vitest.config.ts` (or equivalent) |
| Test setup | `src/functions/tests/setup.ts` |
| Test helpers | `src/functions/tests/helpers.ts` |
| Mock implementations | `src/functions/tests/mocks/mock*.ts` |
| Test fixtures | `src/functions/tests/fixtures/*.json` |
| Service tests | `src/functions/tests/services/*.test.ts` |
| Validation tests | `src/functions/tests/validation/*.test.ts` |
| Handler tests | `src/functions/tests/functions/*.test.ts` |
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
> If selected → invoke `azure-localdev`
>
> Do NOT print plain-text suggestions. Do NOT suggest deploy or benchmark.
