# Service Abstraction Layer

> Patterns for testable code that works against local mocks and live Azure services with zero code changes.

---

## Core Principle

**Same application code runs against mocks (tests), local emulators (dev), and Azure services (production).** Only difference is which implementation is injected:

- **Tests**: In-memory mock (pre-registered via `setup.ts` / `conftest.py`)
- **Local dev**: Real SDK pointing to emulator (via local-dev skill's docker-compose)
- **Azure**: Real SDK pointing to Azure services (via managed identity)

Function handlers NEVER import Azure SDKs directly. They receive services via dependency injection.

> ⚠️ **Auto-initialization requirement**: Service registry's `getServices()` MUST auto-initialize with concrete implementations at runtime. User runs `func start` after `npm run build` — no manual `registerServices()` call, no startup script. Tests override via `registerServices()` with mocks before each test.

> ⚠️ **camelCase↔snake_case conversion requirement**: TypeScript entities use camelCase (`displayName`, `coupleId`) but PostgreSQL columns use snake_case (`display_name`, `couple_id`). Concrete database service MUST handle conversion automatically — snake_case for outbound SQL, camelCase for inbound results. **Mock database does NOT enforce this** (uses plain Maps), so mismatch only surfaces at runtime against real database. Conversion must be built into concrete implementation.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Function Handler                    │
│  (receives services — no SDK imports)            │
├─────────────────────────────────────────────────┤
│              Service Interface                   │
│  IStorageService │ IDatabaseService │ ICacheService
├─────────────────┬───────────────────────────────┤
│ Real Impl       │ Mock Impl                      │
│ (Azure SDK)     │ (in-memory Map/Dict/List)      │
│ ↓               │ ↓                              │
│ Azurite/Azure   │ No external deps               │
└─────────────────┴───────────────────────────────┘
```

---

## TypeScript Patterns

### Service Interface

```typescript
// services/interfaces/IDatabaseService.ts
export interface IDatabaseService {
  findAll<T>(collection: string, options?: QueryOptions): Promise<T[]>;
  findById<T>(collection: string, id: string): Promise<T | null>;
  findOne<T>(collection: string, filter: Record<string, unknown>): Promise<T | null>;
  create<T>(collection: string, data: T): Promise<T>;
  update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null>;
  delete(collection: string, id: string): Promise<boolean>;
  count(collection: string, filter?: Record<string, unknown>): Promise<number>;
  healthCheck(): Promise<boolean>;

  // Execute multiple operations atomically — all succeed or all rollback.
  // The callback receives a transactional IDatabaseService scoped to the transaction.
  transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T>;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  filter?: Record<string, unknown>;
}
```

```typescript
// services/interfaces/IStorageService.ts
export interface IStorageService {
  upload(container: string, name: string, data: Buffer, contentType?: string): Promise<string>;
  download(container: string, name: string): Promise<Buffer>;
  list(container: string): Promise<string[]>;
  delete(container: string, name: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

```typescript
// services/interfaces/ICacheService.ts
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

### Config Module with Environment Validation

> ⚠️ **Use flat config structure** (not nested objects). Canonical shape — tests and implementation must agree. Flat fields are simpler (`config.databaseUrl` not `config.database.url`), avoid ambiguity when multiple agents scaffold independently.
>
> Only list env vars project uses. `REQUIRED_VARS` array drives validation and documentation. **Enhancement service vars** (e.g., `AZURE_OPENAI_ENDPOINT`) are NOT required — accessed via `process.env` directly, may be `undefined`.

```typescript
// services/config.ts
export interface AppConfig {
  databaseUrl: string;
  storageConnectionString: string;
  jwtSecret: string;
  azureOpenAiEndpoint: string | undefined;  // Optional — Enhancement service
  azureOpenAiApiKey: string | undefined;    // Optional — Enhancement service
  nodeEnv: string;
}

const REQUIRED_VARS = ['DATABASE_URL', 'STORAGE_CONNECTION_STRING', 'JWT_SECRET'] as const;

export function validateEnvironment(): string[] {
  const missing: string[] = [];
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  return missing;
}

export function loadConfig(): AppConfig {
  const missing = validateEnvironment();
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n\nCopy .env.example to .env and fill in the values.`
    );
  }

  return {
    databaseUrl: process.env.DATABASE_URL!,
    storageConnectionString: process.env.STORAGE_CONNECTION_STRING!,
    jwtSecret: process.env.JWT_SECRET!,
    azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAiApiKey: process.env.AZURE_OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
```

### Concrete Implementation (PostgreSQL Example)

> **Important**: Includes camelCase↔snake_case key conversion and `collectionToTable()` mapping. See [examples/service-abstraction-examples.md](examples/service-abstraction-examples.md) for complete implementation.

**Key requirements for concrete implementation**:
- `toSnake()`/`toCamel()`/`keysToSnake()`/`keysToCamel()` conversion utilities
- `collectionToTable()` mapping singular collection names to plural SQL table names (e.g., `user` → `users`)
- `create()` and `update()` strip auto-managed fields (`createdAt`, `updatedAt`, `id`) before building SQL
- `transaction()` uses `BEGIN`/`COMMIT`/`ROLLBACK` with pooled client
- `healthCheck()` executes `SELECT 1` wrapped in try/catch

### Mock Implementation (For Tests)

> See [examples/service-abstraction-examples.md](examples/service-abstraction-examples.md) for complete `MockDatabaseService`.

**Key requirements for mock**:
- In-memory `Map<string, Map<string, unknown>>` storage (collection → id → item)
- Constructor accepts optional `Record<string, unknown[]>` for initial test data
- `findOne()` iterates store values and matches all filter key-value pairs
- `update()` auto-sets `updatedAt` timestamp
- `transaction()` executes callback directly (no real transaction for unit tests)
- Must replicate same implicit behaviors as concrete (field stripping, timestamp handling)

### Service Registry (DI)

> **Critical**: Registry MUST auto-initialize with concrete implementations at runtime. `func start` must work without manual `registerServices()` call. Tests pre-register mocks via `setup.ts`, overriding auto-initialization.
>
> ⚠️ **`getServices()` MUST lazily call `initializeServices()` when `services === null`.** Registry that throws "Services not initialized" when none pre-registered is BROKEN — `func start` will crash on every request. Correct behavior: if `services` is null, construct concrete implementations from config and cache them.
>
> ⚠️ **Enhancement service safety**: Enhancement services MUST be wrapped in try/catch during construction. If constructor throws, registry must substitute no-op fallback — NOT crash all handlers.
>
> See [examples/service-abstraction-examples.md](examples/service-abstraction-examples.md) for complete registry pattern.

**Key requirements for the registry**:
- `registerServices(registry)` — stores provided services (used by tests)
- `getServices()` — returns services; auto-initializes if none registered
- `clearServices()` — resets to null (used in test teardown)
- `initializeServices()` — creates concrete instances; Essential services can throw, Enhancement services wrapped in try/catch with no-op fallback

### Usage in Function Handlers

```typescript
// functions/getItems.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { Item } from '../../shared/types/entities';

app.http('getItems', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { database } = getServices();
      const limit = Number(request.query.get('limit')) || 20;
      const offset = Number(request.query.get('offset')) || 0;

      const items = await database.findAll<Item>('items', { limit, offset });
      return { jsonBody: { items, total: items.length } };
    } catch (error) {
      return handleError(error, context);
    }
  }
});
```

---

## Python and C# Patterns

For Python service abstraction patterns (Protocol interfaces, config, mock implementations, registry), see [runtimes/python.md](runtimes/python.md). For C# (.NET) patterns (interfaces, DI registration, mock implementations), see [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Testing Service Abstractions

Every service implementation (real and mock) should be tested:

```typescript
// tests/services/registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerServices, getServices, clearServices } from '../../src/services/registry';
import { MockDatabaseService } from '../mocks/mockDatabase';
import { MockStorageService } from '../mocks/mockStorage';
import { MockCacheService } from '../mocks/mockCache';

describe('ServiceRegistry', () => {
  beforeEach(() => {
    clearServices();
  });

  afterEach(() => {
    clearServices();
  });

  it('should return registered mock services (not auto-initialized ones)', () => {
    const registry = {
      database: new MockDatabaseService(),
      storage: new MockStorageService(),
      cache: new MockCacheService(),
    };
    registerServices(registry);

    const services = getServices();
    expect(services.database).toBe(registry.database);
    expect(services.storage).toBe(registry.storage);
    expect(services.cache).toBe(registry.cache);
  });

  it('should allow re-registration after clearServices', () => {
    const first = { database: new MockDatabaseService(), storage: new MockStorageService(), cache: new MockCacheService() };
    const second = { database: new MockDatabaseService(), storage: new MockStorageService(), cache: new MockCacheService() };

    registerServices(first);
    clearServices();
    registerServices(second);

    expect(getServices().database).toBe(second.database);
  });

  it('pre-registered mocks take priority over auto-initialization', () => {
    const mock = new MockDatabaseService();
    registerServices({
      database: mock,
      storage: new MockStorageService(),
      cache: new MockCacheService(),
    });
    expect(getServices().database).toBe(mock);
  });

  // ⚠️ MANDATORY — Rule 13 auto-initialization test
  // This MUST call getServices() after clearServices() — a test that only
  // calls clearServices() without getServices() is a NO-OP and does not
  // satisfy the auto-initialization requirement.
  it('should auto-initialize without throwing when Enhancement config is missing (Rule 13)', () => {
    clearServices();
    // Set only Essential service env vars
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
    process.env.STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    // Enhancement env vars intentionally NOT set
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;

    // getServices() MUST auto-initialize without throwing
    expect(() => getServices()).not.toThrow();

    const services = getServices();
    expect(services.database).toBeDefined();
    expect(services.storage).toBeDefined();
    expect(services.cache).toBeDefined();
  });
});
```
