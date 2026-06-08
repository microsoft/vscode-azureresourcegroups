# Service Abstraction — Full Code Examples

> Complete implementation examples referenced by [service-abstraction.md](../service-abstraction.md). Read this file ONLY during Step 3 (Service Abstraction Layer).

---

## Concrete Implementation (PostgreSQL)

> Includes camelCase↔snake_case key conversion. TypeScript entities use camelCase but PostgreSQL columns are snake_case. Conversion handled transparently — function handlers never deal with snake_case.

```typescript
// services/database.ts
import { Pool } from 'pg';
import { IDatabaseService, QueryOptions } from './interfaces/IDatabaseService';
import { loadConfig } from './config';

// --- camelCase ↔ snake_case conversion utilities ---

function toSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function keysToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnake(key)] = value;
  }
  return result;
}

function keysToCamel<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamel(key)] = value;
  }
  return result as T;
}

function rowsToCamel<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(row => keysToCamel<T>(row));
}

// --- Collection name → SQL table name mapping ---

function collectionToTable(collection: string): string {
  const map: Record<string, string> = {
    // Add all entity → table mappings here
    // e.g., user: 'users', couple: 'couples', photo: 'photos'
  };
  return map[collection] ?? `${collection}s`;
}

// --- Database service implementation ---

export class PostgresDatabaseService implements IDatabaseService {
  private pool: Pool;

  constructor(connectionString?: string) {
    const config = loadConfig();
    this.pool = new Pool({
      connectionString: connectionString || config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }

  async findAll<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    const table = collectionToTable(collection);
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const orderBy = toSnake(options?.orderBy || 'createdAt');
    const direction = options?.orderDirection || 'desc';

    const result = await this.pool.query(
      `SELECT * FROM ${table} ORDER BY ${orderBy} ${direction} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rowsToCamel<T>(result.rows);
  }

  async findById<T>(collection: string, id: string): Promise<T | null> {
    const table = collectionToTable(collection);
    const result = await this.pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async findOne<T>(collection: string, filter: Record<string, unknown>): Promise<T | null> {
    const table = collectionToTable(collection);
    const snakeFilter = keysToSnake(filter);
    const entries = Object.entries(snakeFilter);
    const conditions = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, val]) => val);
    const result = await this.pool.query(
      `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT 1`, values
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const keys = Object.keys(snakeData);
    const values = Object.values(snakeData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.pool.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`, values
    );
    return keysToCamel<T>(result.rows[0]);
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const entries = Object.entries(snakeData);
    const sets = entries.map(([key], i) => `${key} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, val]) => val), id];
    const result = await this.pool.query(
      `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const table = collectionToTable(collection);
    const result = await this.pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const table = collectionToTable(collection);
    // ... filter handling similar to findAll
    const result = await this.pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    return result.rows[0].count;
  }

  async healthCheck(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; }
    catch { return false; }
  }

  async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Create a transaction-scoped service using this client
      const trxService = createTransactionService(client);
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

---

## Mock Implementation (For Tests)

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
    if (!this.stores.has(collection)) this.stores.set(collection, new Map());
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
    return (this.getStore(collection).get(id) as T) || null;
  }

  async findOne<T>(collection: string, filter: Record<string, unknown>): Promise<T | null> {
    for (const item of this.getStore(collection).values()) {
      const record = item as Record<string, unknown>;
      if (Object.entries(filter).every(([k, v]) => record[k] === v)) return item as T;
    }
    return null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const item = data as Record<string, unknown>;
    this.getStore(collection).set(item.id as string, item);
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
    return this.getStore(collection).delete(id);
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    if (!filter) return this.getStore(collection).size;
    return (await this.findAll(collection)).length;
  }

  async healthCheck(): Promise<boolean> { return true; }

  async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
    return fn(this); // Mock: execute directly, no rollback
  }
}
```

---

## Service Registry (DI)

> **Critical**: Auto-initializes at runtime. Enhancement services wrapped in try/catch.

```typescript
// services/registry.ts
import { IDatabaseService } from './interfaces/IDatabaseService';
import { IStorageService } from './interfaces/IStorageService';
// ... other interfaces

import { PostgresDatabaseService } from './database';
import { BlobStorageService } from './storage';
// ... other concrete implementations

export interface ServiceRegistry {
  database: IDatabaseService;
  storage: IStorageService;
  // ... other services
}

let services: ServiceRegistry | null = null;

export function registerServices(registry: ServiceRegistry): void {
  services = registry;
}

export function getServices(): ServiceRegistry {
  if (!services) initializeServices();
  return services!;
}

export function clearServices(): void {
  services = null;
}

function initializeServices(): void {
  // Essential services — let them throw
  const database = new PostgresDatabaseService();
  const storage = new BlobStorageService();

  // Enhancement services — wrapped in try/catch with no-op fallback
  let aiCaption: IAICaptionService;
  try {
    aiCaption = new AzureAICaptionService();
  } catch (err) {
    logger.warn({ err }, 'AI caption service unavailable, using no-op fallback');
    aiCaption = { generateCaption: async () => 'A special moment 📸', healthCheck: async () => false };
  }

  services = { database, storage, aiCaption };
}
```
