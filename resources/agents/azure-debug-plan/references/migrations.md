# Database Migrations — Detection

When finding a database dependency, detect and record its migration tool. Generation uses it to configure orchestrator migration automation.

---

## Detection

Scan three layers, then synthesize.

### Layer 1: Migration Files

Non-exhaustive patterns:

| Pattern | Tool |
|---------|------|
| `prisma/migrations/` | Prisma |
| `alembic/`, `alembic.ini` | Alembic |
| `**/migrations/*.py` | Django |
| `Migrations/*.cs` | EF Core |
| `flyway.conf` | Flyway |
| `migrations/*.sql` | Raw SQL |

### Layer 2: Dependencies

Check manifests for migration tools, ORMs with built-in migration support, and database drivers.

### Layer 3: Scripts

Check script runners (`package.json`, `Makefile`, etc.) for migration commands; grep terms such as `migrate`, `schema`, `seed`.

### Synthesis

1. Cross-reference all three layers; they should agree
2. Use an existing migration command; don't invent one
3. If layers conflict, ask user which tool is active

### Insufficient Evidence

If database dependency exists but no strategy appears across all three layers:

1. Do not guess
2. Ask via `ask_user` how user manages schema changes
3. Record plan Migrations gap as `⚠️ Not detected`
