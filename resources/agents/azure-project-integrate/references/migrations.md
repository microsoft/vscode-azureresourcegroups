# Schema Migrations (NO seed data)

> Read at **Step 1**. Canonical guidance for creating SQL / PostgreSQL schema migrations during integration. **Schema only — never seed data.**

---

## The one hard rule

You create **structure**, not **content**. Allowed: `CREATE TABLE`, `ALTER TABLE`, constraints, indexes, the migration runner. **Forbidden:** `INSERT`, demo rows, and any file/folder/function named `seed`, `seeds`, `seed-data`, `fixtures`. If the scaffold already produced seed files, leave them where they are — do not extend, run, or depend on them.

---

## Per-stack migration tool

| Stack | Tool | Create | Apply | Roll back |
|-------|------|--------|-------|-----------|
| Node.js / TypeScript | Knex | `knex migrate:make <name>` | `knex migrate:latest` | `knex migrate:rollback` |
| Python | Alembic | `alembic revision -m "<name>"` | `alembic upgrade head` | `alembic downgrade -1` |
| C# / .NET | EF Core | `dotnet ef migrations add <Name>` | `dotnet ef database update` | `dotnet ef database update <Prev>` |

Add the apply/rollback commands as scripts (`"migrate"`, `"migrate:rollback"`) if the scaffold did not.

---

## Every migration file MUST contain real code

- A complete `up()` (or `upgrade()`): `CREATE TABLE` with **all** columns and types the handlers use.
- A complete `down()` (or `downgrade()`): reverses the `up()` (`DROP TABLE`, etc.).
- After writing, **list the directory and confirm each file is > 0 bytes**. An empty migration file does not satisfy Step 1.

## Constraints to include (Step 1 requires these)

| Constraint | When |
|-----------|------|
| `UNIQUE` | Business-unique fields (email, slug, external id) |
| `FOREIGN KEY … ON DELETE` | Every relationship; choose `CASCADE` / `SET NULL` deliberately |
| `CHECK` | Enum-like columns (status, role) |
| `INDEX` | Columns used in `WHERE` / `JOIN` / `ORDER BY` |
| `NOT NULL` + sensible defaults | Required columns; timestamps default to `now()` |

### Knex: `check*` helpers are **column** methods, not table methods

The only `check` method on the table builder is `table.check(predicate)`. Every
constrained-value helper — `checkIn`, `checkNotIn`, `checkPositive`, `checkNegative`,
`checkBetween`, `checkLength`, `checkRegex` — exists **only on the column builder**, so it
must be chained onto the column definition. Calling one on the table crashes at apply time:

```
TypeError: table.checkIn is not a function
    at TableBuilder._fn (migrations/…_create_schema.ts:28:11)
migration failed with error: table.checkIn is not a function
```

```typescript
// ❌ WRONG — checkIn does not exist on the table builder
table.string('status', 20).notNullable();
table.checkIn('status', ['open', 'in_progress', 'closed']);

// ✅ RIGHT — chain it onto the column
table.string('status', 20).notNullable().checkIn(['open', 'in_progress', 'closed']);

// ✅ Also fine — a raw predicate via the table-level `check`
table.check("status in ('open','in_progress','closed')");
```

This fails only when migrations actually run, which is *after* build and tests pass — so it
burns the whole repair budget. Chain the helper the first time.

## Derive the schema from real usage

Read the handler data-access code (and the entity types) before writing columns — the table must match what the code actually reads and writes. Cross-reference every table name against the collection/table names the handlers use (a `collectionToTable` map if one exists). A mismatch here is the #1 cause of `relation "X" does not exist` at smoke-test time.

## Apply, then prove

1. Start the local database / emulator if the artifact documents one.
2. Run the apply command. Expect zero errors.
3. Confirm the tables now exist (the migration tool's status command, or a `\dt` against the local DB).

The proof that migrations are correct is **Step 2's smoke test passing** — handlers querying these tables must not 500.
