# Verification Patterns

> How `azure-project-test` generates tests from scaffolded code.

---

## Codebase Scanning Strategy

Verify skill reads existing code to determine tests needed. Does NOT require user to re-explain app.

### Priority Order for Understanding the Project

1. **`.azure/project-plan.md`** (best) — Has routes, services, types, constraints documented
2. **Code scanning** (fallback) — Read source files to infer same info

---

## Detecting Routes

Scan `src/functions/src/functions/*.ts` for `app.http()` calls:

```typescript
// Pattern to detect:
app.http('functionName', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'path/to/route',
  handler: handlerFunction,
});
```

Extract:
- Function name (first arg)
- HTTP method(s)
- Route path
- Whether handler uses `extractUserId()` (requires auth)
- Whether handler uses `database.transaction()` (multi-table write)
- Whether handler uses AI/Enhancement service (needs resilience test)

### Detection Commands

```powershell
# Find all app.http registrations
Get-ChildItem src/functions/src/functions -Filter "*.ts" | Select-String -Pattern "app\.http\("

# Find auth-required handlers
Get-ChildItem src/functions/src/functions -Filter "*.ts" | Select-String -Pattern "extractUserId"

# Find Enhancement service usage
Get-ChildItem src/functions/src/functions -Filter "*.ts" | Select-String -Pattern "\bai\." 

# Find transaction usage
Get-ChildItem src/functions/src/functions -Filter "*.ts" | Select-String -Pattern "\.transaction\("
```

---

## Detecting Services

Scan `src/functions/src/services/interfaces/` for interface files:

```powershell
Get-ChildItem src/functions/src/services/interfaces -Filter "I*.ts"
```

Each file = one service. Read interface for method signatures.

### Detecting Service Classification

Check service registry (`src/functions/src/services/registry.ts`) for try/catch patterns:

- Services constructed **without** try/catch = Essential
- Services constructed **with** try/catch = Enhancement

---

## Detecting Schemas

Scan `src/shared/schemas/validation.ts` for exported schemas:

```powershell
Select-String -Path "src/shared/schemas/validation.ts" -Pattern "export const \w+Schema"
```

Each exported schema needs validation tests (valid + invalid + edge cases).

---

## Generating Mock Implementations

For each service interface:

1. Read interface methods
2. Read concrete implementation to understand:
   - Auto-managed fields (stripped in `create`/`update`)
   - Timestamp handling
   - Key conversion (camelCase ↔ snake_case)
3. Create in-memory mock replicating these behaviors

### Key Rule: Mock Must Match Concrete

If concrete `create()` strips `id` and generates UUID, mock must either:
- Strip `id` and generate UUID, OR
- Preserve caller `id` (for fixtures) and generate UUID only when `id` missing

Second approach preferred — fixtures use human-readable IDs like `usr-001`.

---

## Generating Test Fixtures

1. Read entity types from `src/shared/types/entities.ts`
2. Read seed data from `seeds/fixtures/seed-data.json` (if exists)
3. Generate fixture JSON with:
   - 2-3 records per entity
   - Human-readable IDs (`usr-001`, `cpl-001`, `pht-001`)
   - Cross-referenced FKs (user.coupleId matches couple.id)
   - At least one entity per state (e.g., coupled + uncoupled user)
   - camelCase keys (matching TypeScript types)

---

## Generating Handler Tests

For each handler, generate test file following this template:

1. **Setup**: `vi.mock('@azure/functions')` + `await import()` to capture handler
2. **beforeEach**: Seed fixture data into mock database
3. **Happy path**: Valid input → correct status + response shape
4. **Error paths**: Based on handler's error throws:
   - `NotFoundError` → test 404
   - `ConflictError` → test 409
   - `UnauthorizedError` → test 401
   - `ForbiddenError` → test 403
   - `ValidationError` / `ZodError` → test 422
5. **Resilience**: If handler uses Enhancement service → test failure fallback

### Detecting Error Paths from Handler Code

```powershell
# What errors does this handler throw?
Select-String -Path "src/functions/src/functions/register.ts" -Pattern "throw new \w+Error"
```

Each thrown error type maps to a test case.

---

## Test Rigor Filtering

| Rigor | What to Generate |
|-------|-----------------|
| **Full** | All handlers get all test categories |
| **Partial** | Key handlers only (auth, main CRUD, upload). Skip read-only duplicates (getPhotoById if getPhotos tested). Always include resilience test for Enhancement services. |
| **None** | No test files generated. Only lint sweep + smoke test. |
