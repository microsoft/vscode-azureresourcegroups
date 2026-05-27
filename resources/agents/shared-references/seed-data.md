# Seed Data & Migrations

> Database schema management and realistic test data seeding patterns.

---

## Core Principle

**Repeatable, idempotent schema and data management.** Migrations run forward and backward cleanly. Seed data is realistic, usable in both dev and tests. Running seed twice does not duplicate data.

---

## When This Applies

This reference is used **only when project includes a database service** (PostgreSQL, CosmosDB, Azure SQL). If project only uses Blob Storage, Queue Storage, or Redis, skip this reference.

> ⛛ **CRITICAL**: Migration files and seed data scripts MUST contain actual code — not empty files or empty directories. Empty `seeds/migrations/` directory is #1 cause of runtime failures that unit tests cannot catch (mocks use in-memory Maps, not SQL tables). Every table in plan's Database Constraints section MUST have corresponding migration file with complete `CREATE TABLE` statement. Every migration file MUST have both `up()` and `down()` functions. `seeds/fixtures/seed-data.json` MUST contain realistic sample data.

---

## Migration Patterns

### TypeScript — Knex Migrations

#### Setup

```bash
npm install knex pg
npm install -D @types/pg
```

```typescript
// knexfile.ts
import { loadConfig } from './src/services/config';

const config = loadConfig();

export default {
  client: 'pg',
  connection: config.database.url,
  migrations: {
    directory: './seeds/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './seeds/data',
    extension: 'ts',
  },
};
```

#### Migration File

```typescript
// seeds/migrations/20260101000000_create_items.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('items', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name').notNullable();
    table.text('description');
    table.decimal('price', 10, 2).notNullable();
    table.string('category').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Add indexes
  await knex.schema.alterTable('items', (table) => {
    table.index('category');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('items');
}
```

#### Seed Script

```typescript
// seeds/seed.ts
import knex from 'knex';
import knexConfig from '../knexfile';
import seedData from './fixtures/seed-data.json';

async function seed() {
  const db = knex(knexConfig);

  try {
    // Run migrations first
    await db.migrate.latest();
    console.log('Migrations applied.');

    // Seed data — idempotent (upsert)
    for (const item of seedData.items) {
      await db('items')
        .insert(item)
        .onConflict('id')
        .merge();
    }
    console.log(`Seeded ${seedData.items.length} items.`);
  } finally {
    await db.destroy();
  }
}

seed().catch(console.error);
```

#### Seed Data Fixture

```json
// seeds/fixtures/seed-data.json
{
  "items": [
    {
      "id": "seed-001",
      "name": "Sample Widget",
      "description": "A sample widget for development",
      "price": 29.99,
      "category": "widgets",
      "created_at": "2026-01-15T10:00:00.000Z",
      "updated_at": "2026-01-15T10:00:00.000Z"
    },
    {
      "id": "seed-002",
      "name": "Demo Gadget",
      "description": "A demo gadget for development",
      "price": 49.99,
      "category": "gadgets",
      "created_at": "2026-02-01T14:00:00.000Z",
      "updated_at": "2026-02-01T14:00:00.000Z"
    },
    {
      "id": "seed-003",
      "name": "Test Doohickey",
      "description": "A test doohickey for development",
      "price": 9.99,
      "category": "doohickeys",
      "created_at": "2026-03-01T08:00:00.000Z",
      "updated_at": "2026-03-01T08:00:00.000Z"
    }
  ]
}
```

#### Package.json Scripts

```json
{
  "scripts": {
    "db:migrate": "knex migrate:latest",
    "db:migrate:rollback": "knex migrate:rollback",
    "db:seed": "tsx seeds/seed.ts",
    "db:reset": "knex migrate:rollback --all && knex migrate:latest && npm run db:seed"
  }
}
```

---

### Python and C# Migrations

For Python migration patterns (Alembic + SQLAlchemy), see [runtimes/python.md](runtimes/python.md). For C# migration patterns (Entity Framework Core), see [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Testing Migrations & Seed Data

### TypeScript Tests

```typescript
// tests/seeds/migration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex, { Knex } from 'knex';
import knexConfig from '../../knexfile';

// These tests require a running database (integration tests)
// Skip if DATABASE_URL is not set
const shouldRun = !!process.env.DATABASE_URL;

describe.skipIf(!shouldRun)('Database Migrations', () => {
  let db: Knex;

  beforeAll(() => {
    db = knex(knexConfig);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should run migrations forward', async () => {
    await db.migrate.latest();
    const tables = await db.raw(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tableNames = tables.rows.map((r: any) => r.table_name);
    expect(tableNames).toContain('items');
  });

  it('should run migrations backward', async () => {
    await db.migrate.rollback(undefined, true);
    const tables = await db.raw(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tableNames = tables.rows.map((r: any) => r.table_name);
    expect(tableNames).not.toContain('items');
  });

  it('should be idempotent (run forward twice without error)', async () => {
    await db.migrate.latest();
    await db.migrate.latest(); // Should not throw
  });
});
```

```typescript
// tests/seeds/seedData.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import knex, { Knex } from 'knex';
import knexConfig from '../../knexfile';
import seedData from '../../seeds/fixtures/seed-data.json';

const shouldRun = !!process.env.DATABASE_URL;

describe.skipIf(!shouldRun)('Seed Data', () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(knexConfig);
    await db.migrate.latest();
  });

  beforeEach(async () => {
    await db('items').del(); // Clean slate
  });

  afterAll(async () => {
    await db.migrate.rollback(undefined, true);
    await db.destroy();
  });

  it('should seed correct number of rows', async () => {
    for (const item of seedData.items) {
      await db('items').insert(item).onConflict('id').merge();
    }
    const count = await db('items').count('* as total').first();
    expect(Number(count?.total)).toBe(seedData.items.length);
  });

  it('should be idempotent (seeding twice produces same row count)', async () => {
    // Seed once
    for (const item of seedData.items) {
      await db('items').insert(item).onConflict('id').merge();
    }
    // Seed again
    for (const item of seedData.items) {
      await db('items').insert(item).onConflict('id').merge();
    }
    const count = await db('items').count('* as total').first();
    expect(Number(count?.total)).toBe(seedData.items.length);
  });
});
```

---

## Fixture Data Guidelines

1. **Use realistic data** — Names, descriptions, values should look like real data, not "test1", "test2"
2. **Include edge cases** — Empty strings (where valid), long strings, special characters, Unicode, boundary numbers (0, negative, max)
3. **Use stable IDs** — Seed data should have predictable IDs (e.g., `seed-001`) so tests can reference specific records
4. **Keep fixtures in JSON** — Shared between seed scripts and test fixtures. Easy to read and modify.
5. **Separate seed data from test fixtures** — Seed data populates dev database. Test fixtures drive unit test assertions. May overlap but serve different purposes.
6. **Document fixture schema** — Add comment block or README explaining what each fixture covers

### Example Fixture Structure

```
seeds/
├── seed.ts                 ← Seed script (runs against real DB)
├── migrations/
│   └── 20260101_create_items.ts
└── fixtures/
    └── seed-data.json      ← Seed data (realistic dev data)

tests/
├── fixtures/
│   ├── items.json          ← Test data (valid + invalid variations)
│   └── users.json          ← Test data for another entity
└── mocks/
    └── mockDatabase.ts     ← Mock service pre-loaded with fixture data
```
