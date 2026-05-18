# Service Abstraction Layer

> Patterns for writing testable code that works against both local mocks and live Azure services with zero code changes.

---

## Core Principle

**The same application code runs against mocks (tests), local emulators (dev), and Azure services (production).** The only difference is which implementation is injected:

- **Tests**: In-memory mock implementation (pre-registered via `setup.ts` / `conftest.py`)
- **Local dev**: Real SDK pointing to emulator (via local-dev skill's docker-compose)
- **Azure**: Real SDK pointing to Azure services (via managed identity)

Function handlers NEVER import Azure SDKs directly. They receive services via dependency injection.

> ⚠️ **Auto-initialization requirement**: The service registry's `getServices()` MUST auto-initialize with concrete implementations at runtime. The user should be able to run `func start` immediately after `npm run build` — no manual `registerServices()` call, no startup script. Tests override this by calling `registerServices()` with mocks before each test.

> ⚠️ **camelCase↔snake_case conversion requirement**: TypeScript entities use camelCase (`displayName`, `coupleId`) but PostgreSQL columns use snake_case (`display_name`, `couple_id`). The concrete database service MUST handle this conversion automatically — converting keys to snake_case for outbound SQL queries and converting row keys to camelCase for inbound results. **The mock database does NOT enforce this** (it uses plain Maps), so this mismatch will only surface at runtime against a real database. The conversion must be built into the concrete implementation, not left as an exercise.

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

```typescript
// services/config.ts
export interface AppConfig {
  storage: { connectionString: string };
  database: { url: string };
  cache: { url: string };
  isDevelopment: boolean;
}

const REQUIRED_VARS: { key: string; envVar: string; description: string }[] = [
  // Add required vars here based on selected services
];

export function validateEnvironment(): string[] {
  const missing: string[] = [];
  for (const { key, envVar, description } of REQUIRED_VARS) {
    if (!process.env[envVar]) {
      missing.push(`${envVar} — ${description}`);
    }
  }
  return missing;
}

export function loadConfig(): AppConfig {
  const missing = validateEnvironment();
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map(m => `  - ${m}`).join('\n')}\n\nCopy .env.example to .env and fill in the values.`
    );
  }

  return {
    storage: {
      connectionString: process.env.STORAGE_CONNECTION_STRING || 'UseDevelopmentStorage=true',
    },
    database: {
      url: process.env.DATABASE_URL || 'postgresql://localdev:localdevpassword@localhost:5432/appdb',
    },
    cache: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    isDevelopment: process.env.NODE_ENV !== 'production',
  };
}
```

### Concrete Implementation (PostgreSQL Example)

> **Important**: Includes camelCase↔snake_case key conversion. TypeScript entities use camelCase but PostgreSQL columns are snake_case. The conversion is handled transparently — function handlers never deal with snake_case.

```typescript
// services/database.ts
import { Pool } from 'pg';
import { IDatabaseService, QueryOptions } from './interfaces/IDatabaseService';
import { loadConfig } from './config';

// --- camelCase ↔ snake_case conversion utilities ---

/** Convert camelCase to snake_case (e.g. displayName → display_name) */
function toSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/** Convert snake_case to camelCase (e.g. display_name → displayName) */
function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Convert all keys in an object from camelCase to snake_case */
function keysToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnake(key)] = value;
  }
  return result;
}

/** Convert all keys in an object from snake_case to camelCase */
function keysToCamel<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamel(key)] = value;
  }
  return result as T;
}

/** Convert an array of rows from snake_case to camelCase */
function rowsToCamel<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(row => keysToCamel<T>(row));
}

// --- Database service implementation ---

export class PostgresDatabaseService implements IDatabaseService {
  private pool: Pool;

  constructor(connectionString?: string) {
    const config = loadConfig();
    this.pool = new Pool({
      connectionString: connectionString || config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }

  async findAll<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const orderBy = toSnake(options?.orderBy || 'createdAt');
    const direction = options?.orderDirection || 'desc';

    const result = await this.pool.query(
      `SELECT * FROM ${collection} ORDER BY ${orderBy} ${direction} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rowsToCamel<T>(result.rows);
  }

  async findById<T>(collection: string, id: string): Promise<T | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${collection} WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const record = data as Record<string, unknown>;
    const { createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const keys = Object.keys(snakeData);
    const values = Object.values(snakeData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const result = await this.pool.query(
      `INSERT INTO ${collection} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return keysToCamel<T>(result.rows[0]);
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null> {
    const record = data as Record<string, unknown>;
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const entries = Object.entries(snakeData);
    const sets = entries.map(([key], i) => `${key} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, val]) => val), id];

    const result = await this.pool.query(
      `UPDATE ${collection} SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    return (result.rows[0] as T) || null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${collection} WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trxService = new PostgresDatabaseService(); // shares pool reference
      // Override pool methods to use this client for the transaction scope
      (trxService as any).pool = { query: (...args: any[]) => client.query(...args) };
      const result = await fn(trxService);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
```

### Mock Implementation (For Tests)

```typescript
// tests/mocks/mockDatabase.ts
import { IDatabaseService, QueryOptions } from '../../src/services/interfaces/IDatabaseService';

export class MockDatabaseService implements IDatabaseService {
  private stores: Map<string, Map<string, unknown>> = new Map();

  constructor(initialData?: Record<string, unknown[]>) {
    if (initialData) {
      for (const [collection, items] of Object.entries(initialData)) {
        const store = new Map<string, unknown>();
        items.forEach((item: any) => store.set(item.id, item));
        this.stores.set(collection, store);
      }
    }
  }

  private getStore(collection: string): Map<string, unknown> {
    if (!this.stores.has(collection)) {
      this.stores.set(collection, new Map());
    }
    return this.stores.get(collection)!;
  }

  async findAll<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    const store = this.getStore(collection);
    let items = Array.from(store.values()) as T[];
    if (options?.limit) {
      const offset = options.offset || 0;
      items = items.slice(offset, offset + options.limit);
    }
    return items;
  }

  async findById<T>(collection: string, id: string): Promise<T | null> {
    const store = this.getStore(collection);
    return (store.get(id) as T) || null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const store = this.getStore(collection);
    const item = data as any;
    store.set(item.id, item);
    return data;
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null> {
    const store = this.getStore(collection);
    const existing = store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    store.set(id, updated);
    return updated as T;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const store = this.getStore(collection);
    return store.delete(id);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
    // Mock transactions execute the callback directly against in-memory state.
    // For unit tests this is sufficient — transaction atomicity is validated
    // via integration tests against a real database.
    return fn(this);
  }
}
```

### Service Registry (DI)

> **Critical**: The registry MUST auto-initialize with concrete implementations at runtime. `func start` must work without any manual `registerServices()` call. Tests pre-register mocks via `setup.ts`, which overrides auto-initialization.

```typescript
// services/registry.ts
import { IDatabaseService } from './interfaces/IDatabaseService';
import { IStorageService } from './interfaces/IStorageService';
import { ICacheService } from './interfaces/ICacheService';

export interface ServiceRegistry {
  database: IDatabaseService;
  storage: IStorageService;
  cache: ICacheService;
}

let services: ServiceRegistry | null = null;

export function registerServices(registry: ServiceRegistry): void {
  services = registry;
}

/**
 * Returns the service registry. In tests, services are pre-registered via setup.ts.
 * At runtime, auto-initializes with concrete implementations on first call.
 */
export function getServices(): ServiceRegistry {
  if (!services) {
    initializeServices();
  }
  return services!;
}

export function clearServices(): void {
  services = null;
}

/** Lazy-load concrete implementations at runtime */
function initializeServices(): void {
  // Use require() for synchronous lazy loading.
  // Replace with the actual concrete service classes for the project.
  const { PostgresDatabaseService } = require('./database');
  const { BlobStorageService } = require('./storage');
  const { RedisCacheService } = require('./cache');

  services = {
    database: new PostgresDatabaseService(),
    storage: new BlobStorageService(),
    cache: new RedisCacheService(),
  };
}
```

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

## Python Patterns

### Service Interface (Protocol)

```python
# services/interfaces.py
from typing import Protocol, TypeVar, Optional, Any
from dataclasses import dataclass

T = TypeVar('T')

@dataclass
class QueryOptions:
    limit: int = 100
    offset: int = 0
    order_by: str = 'created_at'
    order_direction: str = 'desc'

class IDatabaseService(Protocol):
    async def find_all(self, collection: str, options: Optional[QueryOptions] = None) -> list[dict]: ...
    async def find_by_id(self, collection: str, id: str) -> Optional[dict]: ...
    async def create(self, collection: str, data: dict) -> dict: ...
    async def update(self, collection: str, id: str, data: dict) -> Optional[dict]: ...
    async def delete(self, collection: str, id: str) -> bool: ...
    async def health_check(self) -> bool: ...

class IStorageService(Protocol):
    async def upload(self, container: str, name: str, data: bytes, content_type: Optional[str] = None) -> str: ...
    async def download(self, container: str, name: str) -> bytes: ...
    async def list(self, container: str) -> list[str]: ...
    async def delete(self, container: str, name: str) -> None: ...
    async def health_check(self) -> bool: ...

class ICacheService(Protocol):
    async def get(self, key: str) -> Optional[Any]: ...
    async def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None: ...
    async def delete(self, key: str) -> None: ...
    async def health_check(self) -> bool: ...
```

### Config with Validation

```python
# services/config.py
import os
from dataclasses import dataclass

REQUIRED_VARS = [
    # ("ENV_VAR_NAME", "description")
]

def validate_environment() -> list[str]:
    missing = []
    for var_name, description in REQUIRED_VARS:
        if not os.environ.get(var_name):
            missing.append(f"{var_name} — {description}")
    return missing

@dataclass
class AppConfig:
    storage_connection_string: str
    database_url: str
    redis_url: str
    is_development: bool

def load_config() -> AppConfig:
    missing = validate_environment()
    if missing:
        raise RuntimeError(
            "Missing required environment variables:\n"
            + "\n".join(f"  - {m}" for m in missing)
            + "\n\nCopy .env.example to .env and fill in the values."
        )

    return AppConfig(
        storage_connection_string=os.environ.get(
            "STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true"
        ),
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://localdev:localdevpassword@localhost:5432/appdb"
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
        is_development=os.environ.get("ENVIRONMENT", "development") != "production",
    )
```

### Mock Implementation

```python
# tests/mocks/mock_database.py
from typing import Optional
from services.interfaces import QueryOptions

class MockDatabaseService:
    def __init__(self, initial_data: Optional[dict[str, list[dict]]] = None):
        self._stores: dict[str, dict[str, dict]] = {}
        if initial_data:
            for collection, items in initial_data.items():
                self._stores[collection] = {item["id"]: item for item in items}

    def _get_store(self, collection: str) -> dict[str, dict]:
        if collection not in self._stores:
            self._stores[collection] = {}
        return self._stores[collection]

    async def find_all(self, collection: str, options: Optional[QueryOptions] = None) -> list[dict]:
        store = self._get_store(collection)
        items = list(store.values())
        if options:
            items = items[options.offset:options.offset + options.limit]
        return items

    async def find_by_id(self, collection: str, id: str) -> Optional[dict]:
        store = self._get_store(collection)
        return store.get(id)

    async def create(self, collection: str, data: dict) -> dict:
        store = self._get_store(collection)
        store[data["id"]] = data
        return data

    async def update(self, collection: str, id: str, data: dict) -> Optional[dict]:
        store = self._get_store(collection)
        if id not in store:
            return None
        store[id] = {**store[id], **data}
        return store[id]

    async def delete(self, collection: str, id: str) -> bool:
        store = self._get_store(collection)
        return store.pop(id, None) is not None

    async def health_check(self) -> bool:
        return True
```

### Service Registry

> **Critical**: The registry MUST auto-initialize with concrete implementations at runtime. `func start` must work without any manual `register_services()` call. Tests pre-register mocks via `conftest.py`, which overrides auto-initialization.

```python
# services/registry.py
from typing import Optional
from services.interfaces import IDatabaseService, IStorageService, ICacheService
from dataclasses import dataclass

@dataclass
class ServiceRegistry:
    database: IDatabaseService
    storage: IStorageService
    cache: ICacheService

_services: Optional[ServiceRegistry] = None

def register_services(registry: ServiceRegistry) -> None:
    global _services
    _services = registry

def get_services() -> ServiceRegistry:
    """Returns the service registry. Auto-initializes with concrete implementations at runtime."""
    global _services
    if _services is None:
        _initialize_services()
    return _services  # type: ignore

def clear_services() -> None:
    global _services
    _services = None

def _initialize_services() -> None:
    """Lazy-load concrete implementations at runtime."""
    global _services
    from services.database import PostgresDatabaseService
    from services.storage import BlobStorageService
    from services.cache import RedisCacheService

    _services = ServiceRegistry(
        database=PostgresDatabaseService(),
        storage=BlobStorageService(),
        cache=RedisCacheService(),
    )
```

---

## C# (.NET) Patterns

### Service Interface

```csharp
// Services/Interfaces/IDatabaseService.cs
public interface IDatabaseService
{
    Task<List<T>> FindAllAsync<T>(string collection, QueryOptions? options = null);
    Task<T?> FindByIdAsync<T>(string collection, string id);
    Task<T> CreateAsync<T>(string collection, T data);
    Task<T?> UpdateAsync<T>(string collection, string id, object data);
    Task<bool> DeleteAsync(string collection, string id);
    Task<bool> HealthCheckAsync();
}
```

### DI Registration (Program.cs)

```csharp
// Program.cs
var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices((context, services) =>
    {
        // Register services — swap implementations via config
        if (context.HostingEnvironment.IsDevelopment())
        {
            services.AddSingleton<IDatabaseService, PostgresDatabaseService>();
        }
        else
        {
            services.AddSingleton<IDatabaseService, PostgresDatabaseService>();
        }
        
        services.AddSingleton<IStorageService, AzureStorageService>();
        services.AddSingleton<ICacheService, RedisCacheService>();
    })
    .Build();

host.Run();
```

### Mock Implementation

```csharp
// Tests/Mocks/MockDatabaseService.cs
public class MockDatabaseService : IDatabaseService
{
    private readonly Dictionary<string, Dictionary<string, object>> _stores = new();

    public MockDatabaseService(Dictionary<string, List<object>>? initialData = null)
    {
        if (initialData != null)
        {
            foreach (var (collection, items) in initialData)
            {
                _stores[collection] = new Dictionary<string, object>();
                foreach (dynamic item in items)
                {
                    _stores[collection][item.Id] = item;
                }
            }
        }
    }

    public Task<List<T>> FindAllAsync<T>(string collection, QueryOptions? options = null)
    {
        if (!_stores.ContainsKey(collection))
            return Task.FromResult(new List<T>());
        return Task.FromResult(_stores[collection].Values.Cast<T>().ToList());
    }

    public Task<T?> FindByIdAsync<T>(string collection, string id)
    {
        if (!_stores.ContainsKey(collection) || !_stores[collection].ContainsKey(id))
            return Task.FromResult<T?>(default);
        return Task.FromResult((T?)_stores[collection][id]);
    }

    // ... create, update, delete implementations follow same pattern

    public Task<bool> HealthCheckAsync() => Task.FromResult(true);
}
```

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
});
```
