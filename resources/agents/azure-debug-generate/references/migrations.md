# Database Migrations — Generation

Generate compose migration services from the plan's Migrations table. The plan records WHAT migration tool each service uses; this reference defines HOW to generate compose configuration.

> Migration service is ordinary compose content, identical for Docker or Podman. Any task or command driving it (`docker compose up db-migrate`) uses the plan's Orchestrator **Compose Command**; substitute `podman compose` when the plan selects Podman.

---

## Targeted Resolution

Plan Migrations table provides `Generate | Service | Migration Tool`. Before docker-compose migration service generation, resolve details:

| Detail | How to Resolve |
|--------|---------------|
| **Migration directory** | Scan tool directories: `prisma/migrations/`, `migrations/`, `Migrations/`, `alembic/` |
| **Migration command** | Check project script runner (e.g., `package.json` scripts). Use existing migration command; otherwise construct from tool name. |
| **Target database service** | Match against the plan's Emulators table — the database emulator's compose service name |
| **Connection env var** | Find variable name in `local.settings.json`, `.env`, or migration tool config |
| **Compose-network connection string** | Local connection-string shape, replacing `localhost` host with compose service name |
| **Existing script** | Check project script runner for migration script |

### Migration Script Lookup

| Detection Evidence | Instruction |
|--------------------|-------------|
| Existing migration script in project (e.g., `npm run db:migrate`) | Reuse the existing migration script, adapting its invocation to the container environment |
| Migration tool detected but no script | Add native-runner script wrapping tool CLI (e.g., `"db:migrate": "npx prisma migrate deploy"` in `package.json`) |
| Raw SQL only, no migration tool | Recommend/install lightweight dev dependency (e.g., `node-pg-migrate` for Node.js). Ask before install. |

---

## Docker Compose Patterns

Need database **healthcheck** + one-shot **migration service**.

### Healthcheck Pattern

With migrations, target database service **must** have healthcheck, enabling migration `depends_on` with `condition: service_healthy`. Define in emulator docker-compose config; see [emulators/](emulators/).

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

**Fill template with resolved details:**

| Placeholder | How to determine |
|-------------|-----------------|
| `RUNTIME_IMAGE` | Docker image providing language runtime; see below. |
| `DATABASE_SERVICE` | The compose service name for the target database (from Emulators table) |
| `CONNECTION_ENV_VAR` | Migration tool's expected environment variable (from resolution) |
| `CONNECTION_STRING_FOR_COMPOSE_NETWORK` | Local connection-string shape with compose service host |
| `EXTRA_VOLUME_MOUNTS` | Ecosystem mounts; see below. |
| `MIGRATION_SCRIPT` | The project's migration script command (from targeted resolution) |

**Runtime images and extra volume mounts:**

| Ecosystem | Image | Extra Volume Mounts | Notes |
|-----------|-------|-------------------|-------|
| Node.js / TypeScript | `node:{major}-slim` | `./node_modules:/app/node_modules:ro` | Mount node_modules separately for native modules |
| .NET | `mcr.microsoft.com/dotnet/sdk:{version}` | — | Best-effort — emit limited support warning |
| Python | `python:{major.minor}-slim` matching the service | None | Restore Linux-native requirements and run the Python migration tool inside the container; never mount a macOS/Windows host venv |
| Java | `eclipse-temurin:{version}` | — | Best-effort — emit limited support warning |
| Go | `golang:{version}` | — | Best-effort — emit limited support warning |

> **Key properties:**
> - `depends_on` with `condition: service_healthy` — waits for database connections
> - `volumes` with `:ro` — read-only project mounts
> - `restart: "no"` — once per `docker compose up`; no restart after exit
> - Mount ecosystem dependency directories when migration tool is project dependency

### Python migration services

Resolve the actual service working directory and migration command (`python -m alembic upgrade head` or an existing Python runner). Use the service's detected Python major/minor for the image, not the literal `requires-python` constraint.

Install production requirements plus the manifest/group containing migration tooling **inside the Linux container**, using that container's interpreter. A temporary container venv (e.g. `/tmp/migration-venv`) can keep the read-only source mount unchanged. Never execute or mount the host `.venv`: its interpreter, paths, and binary wheels may be incompatible with the container.

For a pip/Alembic project, the container command creates that temporary venv, restores the existing requirements files, then runs its interpreter with `-m alembic upgrade head` from the service root. Include `requirements-dev.txt` only if present/needed; preserve native Poetry/uv workflows when selected. The connection env var uses the database compose service hostname and internal port, not the host's `localhost` URL. Retain the database healthcheck, one-shot exit-code validation, read-only source mount, and `restart: "no"`. Do not create seed data.
