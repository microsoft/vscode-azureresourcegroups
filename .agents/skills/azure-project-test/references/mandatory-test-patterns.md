# Mandatory Test Patterns

> These test patterns MUST be included in every scaffold. Top cause of "tests pass but app doesn't start" failures in benchmarking. Read during **Step V4** (Service Tests) and **Step V6** (Handler Tests).

---

## Pattern 1: Auto-Initialization Test (Rule 13)

`getServices()` auto-initializes with concrete implementations at runtime. Tests pre-register mocks via `setup.ts`, bypassing this path. Without explicit test, Enhancement service constructor crashes go undetected until `func start`.

> ⚠️ **PREREQUISITE: Concrete service implementation files MUST exist.** Test fails if scaffold skipped creating concrete files (e.g., `database.ts`, `storage.ts`). If auto-init test asserts `getServices()` *throws*, WRONG — proves registry has no auto-init logic or no concrete implementations. Test MUST assert `.not.toThrow()`.

> ⚠️ **CRITICAL: Mock concrete service constructors in this test.** Auto-init test calls `getServices()` without pre-registered mocks, triggering real `PostgresDatabaseService` / `BlobStorageService` construction. Constructors create `pg.Pool` and `BlobServiceClient` instances attempting real connections, causing tests to **hang indefinitely** (pool keeps process alive). Mock concrete service modules at top of test file to substitute lightweight stubs.

```typescript
// tests/services/registry.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServices, getServices, clearServices } from '../../src/services/registry.js';
import { MockDatabaseService } from '../mocks/mockDatabase.js';
import { MockStorageService } from '../mocks/mockStorage.js';
import { MockAICaptionService } from '../mocks/mockAICaption.js';

// MANDATORY: Mock concrete services to prevent real DB/storage connections
vi.mock('../../src/services/database.js', () => ({
  PostgresDatabaseService: class {
    async findAll() { return []; }
    async findById() { return null; }
    async findOne() { return null; }
    async create() { return {}; }
    async update() { return null; }
    async delete() { return false; }
    async count() { return 0; }
    async healthCheck() { return true; }
    async transaction<T>(fn: (trx: unknown) => Promise<T>) { return fn(this); }
  },
}));

vi.mock('../../src/services/storage.js', () => ({
  BlobStorageService: class {
    async upload() { return 'https://mock.blob.core.windows.net/test'; }
    async download() { return Buffer.from(''); }
    async delete() { }
    async healthCheck() { return true; }
  },
}));

describe('auto-initialization', () => {
  afterEach(() => { clearServices(); });

  it('should auto-initialize with concrete services after clearServices (Rule 13)', () => {
    clearServices();
    // Set only Essential service env vars
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
    process.env.STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    process.env.JWT_SECRET = 'test-secret';
    // Enhancement env vars intentionally NOT set — must not crash
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;

    // getServices() MUST succeed — Enhancement fallback kicks in
    expect(() => getServices()).not.toThrow();

    const services = getServices();
    expect(services.database).toBeDefined();
    expect(services.storage).toBeDefined();
    expect(services.aiCaption).toBeDefined(); // no-op fallback, not null
  });

  it('pre-registered mocks take priority over auto-initialization', () => {
    clearServices();
    const mock = new MockDatabaseService();
    registerServices({
      database: mock,
      storage: new MockStorageService(),
      aiCaption: new MockAICaptionService(),
    });
    expect(getServices().database).toBe(mock);
  });
});
```

> ❌ **Anti-pattern** — NO-OP test, MUST be rejected:
> ```typescript
> it('should clear services', () => {
>   clearServices();
>   expect(true).toBe(true);  // ← Does NOT test auto-initialization!
> });
> ```
> Test MUST call `getServices()` after `clearServices()` and assert it does not throw. Without that assertion, proves nothing.

> ❌ **Anti-pattern #2** — Asserting `getServices()` throws is WRONG:
> ```typescript
> it('auto-initialization: clearServices then getServices does not crash unexpectedly', () => {
>   clearServices();
>   expect(() => getServices()).toThrow('Services not initialized'); // ← WRONG!
> });
> ```
> Proves registry has NO auto-init logic — just throws when services null. Means `func start` crashes on every request. Test MUST assert `.not.toThrow()`, requiring:
> 1. Concrete service files exist (database.ts, storage.ts, etc.)
> 2. Registry's `getServices()` calls `initializeServices()` when `services === null`
> 3. Enhancement services wrapped in try/catch with no-op fallbacks

---

## Pattern 2: Enhancement Service Resilience Test (Rule 9)

Every handler using Enhancement service MUST have test where Enhancement service throws and handler still succeeds with fallback value. Core resilience guarantee.

```typescript
// tests/functions/uploadPhoto.test.ts
it('should return 201 with fallback caption when AI service fails', async () => {
  // Arrange: Make the Enhancement service throw
  const { aiCaption } = getServices();
  const mockAI = aiCaption as MockAICaptionService;
  mockAI.shouldFail = true;

  const token = makeToken('user-001', 'alice@example.com');
  const fakeFile = {
    name: 'sunset.png',
    type: 'image/png',
    size: 2048,
    arrayBuffer: async () => new ArrayBuffer(2048),
  };
  const formDataMap = new Map();
  formDataMap.set('file', fakeFile);

  const request = createMockRequest({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    formData: async () => formDataMap,
  });
  const response = await handlers.uploadPhoto(request, createMockContext());

  // Assert: Handler succeeds with fallback
  expect(response.status).toBe(201);
  expect(response.jsonBody.photo).toBeDefined();
  expect(response.jsonBody.photo.caption).toBe('A special moment 📸');
});
```

> ❌ **Common mistake**: Testing only happy path (AI works → caption returned). Resilience test is SEPARATE and MANDATORY — proves handler works even when Enhancement service completely unavailable.
