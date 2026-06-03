# Seed Data & Migrations

> Database schema management and realistic test data seeding patterns.

---

## Core Principle

**Repeatable, idempotent schema and data management.** Migrations run forward and backward cleanly. Seed data is realistic and can be used in both development and tests. Running seed twice does not duplicate data.

---

## When This Applies

This reference is used **only when the project includes a database service** (PostgreSQL, CosmosDB, Azure SQL). If the project only uses Blob Storage, Queue Storage, or Redis, skip this reference.

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

### Python — Alembic Migrations

#### Setup

```bash
pip install alembic psycopg2-binary sqlalchemy
```

```ini
# alembic.ini (key settings)
[alembic]
script_location = seeds/migrations
sqlalchemy.url = postgresql://localdev:localdevpassword@localhost:5432/appdb
```

#### Migration File

```python
# seeds/migrations/versions/001_create_items.py
"""create items table"""
from alembic import op
import sqlalchemy as sa

revision = '001'
down_revision = None

def upgrade():
    op.create_table(
        'items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('price', sa.Numeric(10, 2), nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index('ix_items_category', 'items', ['category'])
    op.create_index('ix_items_created_at', 'items', ['created_at'])

def downgrade():
    op.drop_table('items')
```

#### Seed Script

```python
# seeds/seed.py
import json
from pathlib import Path
from services.config import load_config
import psycopg2
from psycopg2.extras import execute_values

def seed():
    config = load_config()
    fixture_path = Path(__file__).parent / "fixtures" / "seed-data.json"
    
    with open(fixture_path) as f:
        data = json.load(f)
    
    conn = psycopg2.connect(config.database_url)
    try:
        with conn.cursor() as cur:
            for item in data["items"]:
                cur.execute(
                    """
                    INSERT INTO items (id, name, description, price, category, created_at, updated_at)
                    VALUES (%(id)s, %(name)s, %(description)s, %(price)s, %(category)s, %(created_at)s, %(updated_at)s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        price = EXCLUDED.price,
                        category = EXCLUDED.category,
                        updated_at = EXCLUDED.updated_at
                    """,
                    item,
                )
        conn.commit()
        print(f"Seeded {len(data['items'])} items.")
    finally:
        conn.close()

if __name__ == "__main__":
    seed()
```

---

### C# — Entity Framework Core Migrations

#### Setup

```bash
dotnet add package Microsoft.EntityFrameworkCore
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet add package Microsoft.EntityFrameworkCore.Design
dotnet tool install --global dotnet-ef
```

#### DbContext

```csharp
// Data/AppDbContext.cs
public class AppDbContext : DbContext
{
    public DbSet<Item> Items => Set<Item>();

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Item>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(255);
            entity.Property(e => e.Price).IsRequired().HasPrecision(10, 2);
            entity.Property(e => e.Category).IsRequired().HasMaxLength(100);
            entity.HasIndex(e => e.Category);
            entity.HasIndex(e => e.CreatedAt);
        });
    }
}
```

#### Seed Data

```csharp
// Seeds/SeedData.cs
public static class SeedData
{
    public static async Task SeedAsync(AppDbContext context)
    {
        if (await context.Items.AnyAsync()) return; // Idempotent

        var items = new List<Item>
        {
            new() { Id = "seed-001", Name = "Sample Widget", Description = "A sample widget", Price = 29.99m, Category = "widgets" },
            new() { Id = "seed-002", Name = "Demo Gadget", Description = "A demo gadget", Price = 49.99m, Category = "gadgets" },
            new() { Id = "seed-003", Name = "Test Doohickey", Description = "A test doohickey", Price = 9.99m, Category = "doohickeys" },
        };

        context.Items.AddRange(items);
        await context.SaveChangesAsync();
    }
}
```

#### Commands

```bash
dotnet ef migrations add CreateItems
dotnet ef database update
dotnet ef database update 0   # rollback all
```

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

1. **Use realistic data** — Names, descriptions, and values should look like real data, not "test1", "test2"
2. **Include edge cases** — Empty strings (where valid), long strings, special characters, Unicode, boundary numbers (0, negative, max)
3. **Use stable IDs** — Seed data should have predictable IDs (e.g., `seed-001`) so tests can reference specific records
4. **Keep fixtures in JSON** — Shared between seed scripts and test fixtures. Easy to read and modify.
5. **Separate seed data from test fixtures** — Seed data populates the dev database. Test fixtures drive unit test assertions. They may overlap but serve different purposes.
6. **Document the fixture schema** — Add a comment block or README explaining what each fixture covers

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
