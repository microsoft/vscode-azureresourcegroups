# Database Migrations — Detection

When a database dependency is found, detect the migration tool so the plan can record it. The generation phase uses this to configure migration automation within the orchestrator.

---

## Detection

Scan three layers, then synthesize.

### Layer 1: Migration Files

Non-exhaustive detection pattern examples:

| Pattern | Tool |
|---------|------|
| `prisma/migrations/` | Prisma |
| `alembic/`, `alembic.ini` | Alembic |
| `**/migrations/*.py` | Django |
| `Migrations/*.cs` | EF Core |
| `flyway.conf` | Flyway |
| `migrations/*.sql` | Raw SQL |

### Layer 2: Dependencies

Check dependency manifests for migration tools, ORMs with built-in migration support, and database driver packages.

### Layer 3: Scripts

Check script runners (`package.json`, `Makefile`, etc.) for existing migration commands (grep for common migration key words like: `migrate`, `schema`, `seed`).

### Synthesis

1. Cross-reference all three layers — they should agree
2. If an existing migration command exists, use it (don't invent a new one)
3. If layers conflict, ask the user which tool is active

### Insufficient Evidence

If a database dependency exists but no migration strategy is found across all three layers:

1. Do not guess
2. Ask the user via `ask_user` how they manage schema changes
3. Record the gap in the plan's Migrations section with `⚠️ Not detected`
