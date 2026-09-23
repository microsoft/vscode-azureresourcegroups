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
3. Project plans, integration plans, and other prose are not evidence that migration automation exists. Do not mark migration generation `[x]` from a planned tool unless its files, dependency, or command exists in the workspace.
4. If layers conflict, record the candidates as an unchecked plan row and explain that the user can resolve it by editing the plan before approval. Do not ask a chat question; the plan view is the review surface.

### Insufficient Evidence

If a database dependency exists but no migration strategy is found across all three layers:

1. Do not guess
2. Do not call `ask_user` or `vscode_askQuestions`; plan generation must complete without a parallel chat-input gate
3. Record the gap in the plan's Migrations section as an unchecked (`[ ]`) row with `⚠️ Not detected`
4. Explain that migration automation remains disabled until the user implements a strategy or edits the plan before approval
5. Do not add or check a migration convenience script (such as `db:migrate`) when no matching workspace command exists
