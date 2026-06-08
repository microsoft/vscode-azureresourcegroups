# Testing Patterns

> Core reference for self-testable north star. Every module ships with tests. Every phase has test gate.

---

## Core Principle

**The project is not done until the tests say it is.**

An AI agent runs tests after every module. If tests fail, iterate until pass. No module complete until tests green. Not a suggestion — it's the workflow.

---

## Test Pyramid

```
           ┌─────────────┐
           │   E2E /      │  ← Full request-response cycle
           │  Integration  │     with real/mock services
           ├──────────────┤
           │              │
           │    Unit       │  ← Fast, isolated, mocked deps
           │              │
           └──────────────┘
```

| Layer | What It Tests | Dependencies | Speed | When |
|-------|---------------|-------------|-------|------|
| **Unit** | Single function/class in isolation | All deps mocked | Fast (ms) | Every module, always |
| **Integration** | Request → handler → service → response cycle | Mock services injected | Fast (ms) | Every route, always |
| **E2E** | Full stack with real emulators | Running emulators (via local-dev) | Slower (s) | When emulators available |

### What Each Layer Covers

**Unit Tests** (mandatory for every module):
- Service abstraction methods (with mock storage/DB/cache)
- Config loading (env vars present, missing, defaults)
- Validation schemas (valid, invalid, edge cases)
- Error types and error handler (mapping to HTTP status codes)
- Individual handler logic (with injected mock services)
- Utility functions and helpers

**Integration Tests** (mandatory for every route):
- HTTP request → handler → mock service → HTTP response
- Correct status codes (200, 201, 400, 404, 422, 500)
- Correct response body shapes
- Request validation (bad input rejected)
- Error handling (service failures produce correct error responses)

**E2E Tests** (when emulators available via local-dev):
- Full database round-trip (create → read → verify)
- File upload → storage → retrieval
- Cache set → get → verify
- Health check with live services

---

## Test Gate Enforcement

The agent MUST follow this workflow at every test gate:

### 1. Run Tests

```bash
# TypeScript
npm test
# or: npx vitest run

# Python
pytest

# .NET
dotnet test
```

### 2. Parse Output

Look for:
- **Pass**: All tests passed, zero failures → proceed to next phase
- **Fail**: One or more tests failed → DO NOT proceed

### 3. If Tests Fail

1. Read failure output — identify which test failed and why
2. Determine if issue is in **code** or **test**
3. Fix it
4. Re-run tests
5. Repeat until ALL pass

### 4. Decision Tree

```
Run tests
    │
    ├── ALL PASS ──→ Mark phase complete → Proceed to next phase
    │
    └── ANY FAIL ──→ Read failure output
                         │
                         ├── Code bug ──→ Fix code → Re-run tests
                         │
                         ├── Test bug ──→ Fix test → Re-run tests
                         │
                         └── Missing dep ──→ Install dep → Re-run tests
```

> **NEVER skip a test gate.** If tests won't pass after reasonable effort, report failure to user rather than silently proceeding.

---

## Coverage Guidance

DO NOT set hard coverage thresholds. Instead ensure:

- Every handler has at least one happy-path and one error-path test
- Every service method tested via mock implementations
- Every validation schema has valid/invalid input tests
- Every error type tested for correct HTTP status mapping
- Edge cases covered (empty arrays, null values, boundary numbers, special characters)
- **Auto-initialization path tested** (Rule 13) — see [mandatory-test-patterns.md](mandatory-test-patterns.md)
- **Enhancement service resilience tested** — see [mandatory-test-patterns.md](mandatory-test-patterns.md)

Goal: **meaningful coverage**, not percentage target.

---

## Detailed Reference Files

Detailed patterns and examples in step-specific reference files:

| Topic | Reference File | Used By |
|-------|---------------|---------|
| Test runner setup (vitest/jest/pytest/xUnit configs) | [test-runners.md](test-runners.md) | Step V1 |
| Mock data & service mocking patterns | [mock-patterns.md](mock-patterns.md) | Step V2 |
| Auto-init & resilience test patterns (MANDATORY) | [mandatory-test-patterns.md](mandatory-test-patterns.md) | Steps V4, V6 |
| Handler test boilerplate & test matrix | [handler-test-patterns.md](handler-test-patterns.md) | Step V6 |
| Frontend component test setup & patterns | [frontend-test-patterns.md](frontend-test-patterns.md) | Step V6b |
| Codebase scanning & test generation strategy | [verification-patterns.md](verification-patterns.md) | Step V0 |
