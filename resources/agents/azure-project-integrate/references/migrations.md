# Schema Migrations (NO seed data)

> Read at **Step 1**. Canonical SQL / PostgreSQL schema migration guidance. **Schema only — never seed data.**

---

## The one hard rule

Create **structure**, not **content**. Allowed: `CREATE TABLE`, `ALTER TABLE`, constraints, indexes, migration runner. **Forbidden:** `INSERT`, demo rows, files/folders/functions named `seed`, `seeds`, `seed-data`, `fixtures`. Leave scaffold seed files untouched; never extend, run, or depend on them.

---

## Per-stack migration tool

| Stack | Tool | Create | Apply | Roll back |
|-------|------|--------|-------|-----------|
| Node.js / TypeScript | Knex | `knex migrate:make <name>` | `knex migrate:latest` | `knex migrate:rollback` |
| Python | Alembic | `alembic revision -m "<name>"` | `alembic upgrade head` | `alembic downgrade -1` |
| C# / .NET | EF Core | `dotnet ef migrations add <Name>` | `dotnet ef database update` | `dotnet ef database update <Prev>` |

If scaffold lacks them, add apply/rollback scripts (`"migrate"`, `"migrate:rollback"`).

---

## Every migration file MUST contain real code

- Complete `up()` (or `upgrade()`): `CREATE TABLE` with **all** handler-used columns + types.
- Complete `down()` (or `downgrade()`): reverse `up()` (`DROP TABLE`, etc.).
- After writing, **list directory; confirm each file is > 0 bytes**. Empty migration fails Step 1.

## Constraints to include (Step 1 requires these)

| Constraint | When |
|-----------|------|
| `UNIQUE` | Business-unique fields (email, slug, external id) |
| `FOREIGN KEY … ON DELETE` | Every relationship; deliberately choose `CASCADE` / `SET NULL` |
| `CHECK` | Enum-like columns (status, role) |
| `INDEX` | `WHERE` / `JOIN` / `ORDER BY` columns |
| `NOT NULL` + sensible defaults | Required columns; timestamps default `now()` |

## Derive the schema from real usage

Before writing columns, read handler data-access code + entity types. Tables must match actual reads/writes. Cross-reference every table name with handler collection/table names (including any `collectionToTable` map). Mismatch is #1 smoke-test cause of `relation "X" does not exist`.

## Apply, then prove

1. Start local database / emulator when artifact documents one.
2. Run apply command; require zero errors.
3. Confirm tables exist via migration tool status or `\dt` against local DB.

Migration proof: **Step 2's smoke test passes**; handlers querying tables never 500.
