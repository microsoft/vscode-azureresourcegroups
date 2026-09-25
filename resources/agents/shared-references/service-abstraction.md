# Service Abstraction Layer

> Testable code for local mocks and live Azure services with zero code changes.

---

## Core Principle

Keep concerns separate:

- **Application user authentication** exists only when plan says `API Login: Yes`. It authenticates application users.
- **Azure client authentication** is never product choice. Backend-to-Azure uses emulator clients in explicit development and managed identity elsewhere.

Both use small application-facing interfaces. Function handlers NEVER import Azure SDKs, construct credentials, or parse login tokens. Inject auth services and Azure clients.

> ⚠️ **Auto-initialization requirement**: Service registry's `getServices()` MUST auto-initialize concrete implementations at runtime. User runs `func start` after `npm run build` without manual `registerServices()` or startup script. Tests override through `registerServices()` with mocks before each test.

> ⚠️ **camelCase↔snake_case conversion requirement**: TypeScript entities use camelCase (`displayName`, `coupleId`); PostgreSQL columns use snake_case (`display_name`, `couple_id`). Concrete database service MUST automatically convert outbound SQL to snake_case and inbound results to camelCase. **Mock database does NOT enforce this** because it uses plain Maps, so mismatches surface only against real database. Build conversion into concrete implementation.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Function Handler                    │
│  (receives services — no SDK imports)            │
├─────────────────────────────────────────────────┤
│          Application-facing interfaces           │
│  AuthService  │  BlobClientProvider  │  Database │
├───────────────┼──────────────────────┼───────────┤
│ User sessions │ Local / managed ID   │ Data impl │
└───────────────┴──────────────────────┴───────────┘
```

---

## API login contract

Read the `API Login` value from the approved plan:

- `No`: do not scaffold user login, token middleware, login UI, or mock users.
- `Yes`: define a small auth interface for the behavior the application needs, then scaffold login end to end across the frontend and API.

If the workspace already has an auth system, preserve it. Otherwise use a stack-appropriate REST API flow. A typical implementation verifies a stored password hash, issues a short-lived signed JWT, and verifies its signature, algorithm, issuer, audience, and expiry before protected requests. Put that behavior behind an interface such as `login(credentials)`, `authenticate(request)`, and `getCurrentUser()`. Require signing configuration in production. Never hard-code a signing secret or generate a new production secret at startup.

Managed identity does not authenticate application users. Never use a managed identity access token as a user session.

## Azure client provider contract

Apply this pattern to every Azure service client:

1. Define the smallest interface that expresses the client behavior the application needs. Do not expose SDK types unless the application genuinely operates on them.
2. Implement it once for the local emulator and once for Azure with managed identity. Tests may register an in-memory implementation independently.
3. Select the implementation once in the startup composition root, then inject it into handlers and domain services.
4. Select local only when the platform environment is exactly `Development`. Missing, empty, misspelled, staging, and production values all select the managed-identity implementation.
5. Validate the selected implementation before the app serves requests. Invalid production endpoint configuration must stop startup. Never recover by selecting an emulator, account key, SAS token, API key, or secret-bearing connection string.
6. Keep environment checks out of the rest of the codebase.
7. Keep the interface, both implementations, and factory together or under one provider folder. Use explicit names, document endpoints in `.env.example`, and put `"AZURE_FUNCTIONS_ENVIRONMENT": "Development"` in `local.settings.json`.

This Blob Storage example shows the shape:

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

export interface BlobClientProvider {
  getClient(): BlobServiceClient;
}

export class AzuriteBlobClientProvider implements BlobClientProvider {
  getClient(): BlobServiceClient {
    return BlobServiceClient.fromConnectionString(
      requireSetting('AZURITE_CONNECTION_STRING'),
    );
  }
}

export class ManagedIdentityBlobClientProvider implements BlobClientProvider {
  getClient(): BlobServiceClient {
    const account = requireSetting('AZURE_STORAGE_ACCOUNT');
    return new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
}

export function createBlobClientProvider(): BlobClientProvider {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') {
    return new AzuriteBlobClientProvider();
  }

  return new ManagedIdentityBlobClientProvider();
}
```

Call the factory from the composition root, not from request handlers. Mirror the same boundary in Python with a `Protocol` and in .NET with an interface plus startup DI registration. Use the equivalent managed-identity credential for every other Azure client.

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

> ⚠️ **Use flat config structure** (not nested objects). Tests and implementation must share this canonical shape. Flat fields (`config.databaseUrl` not `config.database.url`) avoid ambiguity when multiple agents scaffold independently.
>
> List only project-used env vars. Provider factories validate settings required by selected implementation. **Enhancement service vars** (e.g., `AZURE_OPENAI_ENDPOINT`) are NOT required; access through `process.env` directly, possibly `undefined`.

```typescript
// services/config.ts
export interface AppConfig {
  environment: string;
  azureOpenAiEndpoint: string | undefined;  // Optional Enhancement service
}

export function requireSetting(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    environment: process.env.AZURE_FUNCTIONS_ENVIRONMENT ?? 'Production',
    azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  };
}
```

Provider constructors or factories call `requireSetting` for the selected implementation's settings. For example, a local PostgreSQL provider may require `DATABASE_URL`, while its production provider requires the Azure PostgreSQL host/database names and obtains an Entra access token with `DefaultAzureCredential`. Do not require local emulator settings in production or production resource settings in explicit development mode. The default environment is `Production`, never `Development`.

### Concrete Implementation (PostgreSQL Example)

> **Important**: Includes camelCase↔snake_case key conversion and `collectionToTable()` mapping. See complete implementation in [examples/service-abstraction-examples.md](.github/agents/shared-references/examples/service-abstraction-examples.md).

**Key requirements for concrete implementation**:
- Local development may construct `pg.Pool` from `DATABASE_URL`; production MUST use discrete `host`,
  `port`, `database`, `user`, and `ssl` fields plus an async `password` callback that calls
  `DefaultAzureCredential.getToken("https://ossrdbms-aad.database.windows.net/.default")`. Never put an
  empty password in a production URL or combine `connectionString` with the token callback.
- `toSnake()`/`toCamel()`/`keysToSnake()`/`keysToCamel()` conversion utilities
- `collectionToTable()` maps singular collection names to plural SQL table names (e.g., `user` → `users`)
- `create()` and `update()` strip auto-managed fields (`createdAt`, `updatedAt`, `id`) before SQL construction
- `transaction()` uses `BEGIN`/`COMMIT`/`ROLLBACK` with pooled client
- `healthCheck()` runs `SELECT 1` inside try-catch

### Mock Implementation (For Tests)

> See complete `MockDatabaseService` in [examples/service-abstraction-examples.md](.github/agents/shared-references/examples/service-abstraction-examples.md).

**Key requirements for mock**:
- In-memory `Map<string, Map<string, unknown>>` storage (collection → id → item)
- Constructor accepts optional `Record<string, unknown[]>` initial test data
- `findOne()` iterates stored values, matching every filter key-value pair
- `update()` automatically sets `updatedAt` timestamp
- `transaction()` runs callback directly, without real unit-test transactions
- Replicates concrete implicit behaviors: field stripping and timestamp handling

### Service Registry (DI)

> **Critical**: Registry MUST auto-initialize concrete implementations at runtime. `func start` must work without manual `registerServices()`. Tests pre-register mocks through `setup.ts`, overriding auto-initialization.
>
> ⚠️ **`getServices()` MUST lazily call `initializeServices()` when `services === null`.** Throwing "Services not initialized" without pre-registration is BROKEN; `func start` then crashes every request. If `services` is null, construct and cache concrete implementations from config.
>
> ⚠️ **Enhancement service safety**: Wrap Enhancement service construction in try/catch; on constructor throw, registry MUST substitute no-op fallback, NOT crash all handlers.
>
> See complete registry pattern in [examples/service-abstraction-examples.md](.github/agents/shared-references/examples/service-abstraction-examples.md).

**Key requirements for the registry**:
- `registerServices(registry)` — stores provided test services
- `getServices()` — returns services; auto-initializes when none registered
- `clearServices()` — resets to null for test teardown
- `initializeServices()` — once selects local/production providers, validates, and creates concrete instances; Essential services may throw, Enhancement services use explicit no-op fallback, never local implementation

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

For Python service abstraction (Protocol interfaces, config, mock implementations, registry), see [runtimes/python.md](.github/agents/shared-references/runtimes/python.md). For C# (.NET) patterns (interfaces, DI registration, mock implementations), see [runtimes/dotnet.md](.github/agents/shared-references/runtimes/dotnet.md).

---

## Testing Service Abstractions

Test every real and mock service implementation:

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
    process.env.DATABASE_URL = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5432/testdb`;
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
