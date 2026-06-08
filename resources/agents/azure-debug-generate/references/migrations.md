# Database Migrations — Generation

Generate docker-compose migration services from the plan's Migrations table. The plan records WHAT migration tool is in use and which service needs it. This reference covers HOW to generate the docker-compose configuration.

---

## Targeted Resolution

The plan's Migrations table provides: `Generate | Service | Migration Tool`. Before generating the docker-compose migration service, perform targeted resolution to fill in the details:

| Detail | How to Resolve |
|--------|---------------|
| **Migration directory** | Scan for tool-specific directories: `prisma/migrations/`, `migrations/`, `Migrations/`, `alembic/` |
| **Migration command** | Check the project's script runner (e.g., `package.json` scripts) for an existing migration command. If found, use it. If not, construct from the tool name. |
| **Target database service** | Match against the plan's Emulators table — the database emulator's compose service name |
| **Connection env var** | Check `local.settings.json`, `.env`, or the migration tool's config file for the variable name |
| **Compose-network connection string** | Same shape as the local connection string but with the compose service name as host instead of `localhost` |
| **Existing script** | Check whether a migration script already exists in the project's script runner |

### Migration Script Lookup

| Detection Evidence | Instruction |
|--------------------|-------------|
| Existing migration script in project (e.g., `npm run db:migrate`) | Use it as-is in the docker-compose service |
| Migration tool detected but no script | Create a script in the project's native script runner that wraps the tool's CLI command (e.g., `"db:migrate": "npx prisma migrate deploy"` in `package.json`) |
| Raw SQL files only, no migration tool | Recommend and install a lightweight migration tool as a dev dependency (e.g., `node-pg-migrate` for Node.js). Ask the user before installing. |

---

## Docker Compose Patterns

Two patterns are needed: a **healthcheck** on the database service and a one-shot **migration service**.

### Healthcheck Pattern

When migrations are present, the target database service **must** have a healthcheck so the migration service can use `depends_on` with `condition: service_healthy`. The healthcheck definition belongs in the emulator's docker-compose config — see the emulator reference files in [emulators/](emulators/).

### Migration Service Pattern

```yaml
services:
  db-migrate:
    image: ${RUNTIME_IMAGE}
    working_dir: /app
    depends_on:
      ${DATABASE_SERVICE}:
        condition: service_healthy
    volumes:
      - ./:/app:ro
      ${EXTRA_VOLUME_MOUNTS}
    environment:
      ${CONNECTION_ENV_VAR}: ${CONNECTION_STRING_FOR_COMPOSE_NETWORK}
    entrypoint: ${MIGRATION_SCRIPT}
    restart: "no"
```

**Filling in the template — use resolved details:**

| Placeholder | How to determine |
|-------------|-----------------|
| `RUNTIME_IMAGE` | A Docker image that provides the language runtime. See the table below. |
| `DATABASE_SERVICE` | The compose service name for the target database (from Emulators table) |
| `CONNECTION_ENV_VAR` | The environment variable the migration tool expects (from targeted resolution) |
| `CONNECTION_STRING_FOR_COMPOSE_NETWORK` | Same shape as local connection string but with compose service name as host |
| `EXTRA_VOLUME_MOUNTS` | Additional mounts needed for the ecosystem. See the table below. |
| `MIGRATION_SCRIPT` | The project's migration script command (from targeted resolution) |

**Runtime images and extra volume mounts:**

| Ecosystem | Image | Extra Volume Mounts | Notes |
|-----------|-------|-------------------|-------|
| Node.js / TypeScript | `node:{major}-slim` | `./node_modules:/app/node_modules:ro` | Mount node_modules separately for native modules |
| .NET | `mcr.microsoft.com/dotnet/sdk:{version}` | — | Best-effort — emit limited support warning |
| Python | `python:{version}-slim` | `./.venv:/app/.venv:ro` (if applicable) | Best-effort — emit limited support warning |
| Java | `eclipse-temurin:{version}` | — | Best-effort — emit limited support warning |
| Go | `golang:{version}` | — | Best-effort — emit limited support warning |

> **Key properties:**
> - `depends_on` with `condition: service_healthy` — waits for the database to accept connections
> - `volumes` with `:ro` — mounts project files read-only for safety
> - `restart: "no"` — runs once per `docker compose up`, does not restart after exit
> - Mount ecosystem-specific dependency directories when the migration tool is installed as a project dependency
