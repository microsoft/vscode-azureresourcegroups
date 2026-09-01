// services/database.ts
import { Pool, PoolClient } from 'pg';
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
    task: 'tasks',
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
      `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT 1`,
      values
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { createdAt: _ca, updatedAt: _ua, id: _id, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const keys = Object.keys(snakeData);
    const values = Object.values(snakeData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.pool.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return keysToCamel<T>(result.rows[0]);
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const entries = Object.entries(snakeData);
    if (entries.length === 0) {
      // No fields to update, just fetch current
      return this.findById<T>(collection, id);
    }
    const sets = entries.map(([key], i) => `${key} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, val]) => val), id];
    const result = await this.pool.query(
      `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
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
    if (!filter) {
      const result = await this.pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      return result.rows[0].count;
    }
    const snakeFilter = keysToSnake(filter);
    const entries = Object.entries(snakeFilter);
    const conditions = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, val]) => val);
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${conditions.join(' AND ')}`,
      values
    );
    return result.rows[0].count;
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
      const trxService = new TransactionDatabaseService(client, this.pool);
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

// Transaction-scoped database service
class TransactionDatabaseService implements IDatabaseService {
  constructor(private client: PoolClient, private pool: Pool) {}

  async findAll<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    const table = collectionToTable(collection);
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const orderBy = toSnake(options?.orderBy || 'createdAt');
    const direction = options?.orderDirection || 'desc';

    const result = await this.client.query(
      `SELECT * FROM ${table} ORDER BY ${orderBy} ${direction} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rowsToCamel<T>(result.rows);
  }

  async findById<T>(collection: string, id: string): Promise<T | null> {
    const table = collectionToTable(collection);
    const result = await this.client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async findOne<T>(collection: string, filter: Record<string, unknown>): Promise<T | null> {
    const table = collectionToTable(collection);
    const snakeFilter = keysToSnake(filter);
    const entries = Object.entries(snakeFilter);
    const conditions = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, val]) => val);
    const result = await this.client.query(
      `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT 1`,
      values
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async create<T>(collection: string, data: T): Promise<T> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { createdAt: _ca, updatedAt: _ua, id: _id, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const keys = Object.keys(snakeData);
    const values = Object.values(snakeData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.client.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return keysToCamel<T>(result.rows[0]);
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null> {
    const table = collectionToTable(collection);
    const record = data as Record<string, unknown>;
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...cleanData } = record;
    const snakeData = keysToSnake(cleanData);
    const entries = Object.entries(snakeData);
    if (entries.length === 0) {
      return this.findById<T>(collection, id);
    }
    const sets = entries.map(([key], i) => `${key} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, val]) => val), id];
    const result = await this.client.query(
      `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    return result.rows[0] ? keysToCamel<T>(result.rows[0]) : null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const table = collectionToTable(collection);
    const result = await this.client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const table = collectionToTable(collection);
    if (!filter) {
      const result = await this.client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      return result.rows[0].count;
    }
    const snakeFilter = keysToSnake(filter);
    const entries = Object.entries(snakeFilter);
    const conditions = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, val]) => val);
    const result = await this.client.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${conditions.join(' AND ')}`,
      values
    );
    return result.rows[0].count;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
    // Nested transactions not supported - just execute in current transaction
    return fn(this);
  }
}
