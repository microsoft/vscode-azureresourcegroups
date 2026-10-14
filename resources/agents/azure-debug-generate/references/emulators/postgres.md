# PostgreSQL

> PostgreSQL lacks Azure-provided emulator. Use standard `postgres` Docker image locally. For **Azure Cosmos DB for PostgreSQL**, note in plan: no local emulator.

## Docker Image

```
postgres:16
```

## docker-compose Service Block

Declare local credentials **once** in workspace-root `.env`; reference everywhere.
Compose interpolates `${...}` from `.env` (or shell), feeding database and every app service.

`.env` required; otherwise Compose makes `${POSTGRES_USER}` empty and database auth silently fails:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=localdev
```

> ⛔ **`.gitignore` must list `.env` before you create it.** Committed credentials are
> compromised and require rotation; later deletion leaves them in history, clones, and forks.
> Private repositories included. If `.gitignore` is absent or omits `.env`, fix before writing.

> **Never inline a concrete `user:password@host` URL** in generated files; build from variables
> above. Besides hard-coding credentials, secret-redaction filters rewrite such literals; masked
> values starting with `*` fatally fail YAML parsing because leading `*` means alias reference.

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped

# Declare the named volume at the top level of the compose file (merge into an
# existing top-level `volumes:` key if the file already has one).
volumes:
  postgres_data:
```

> ⛔ **Use a named volume for the Postgres data dir — not a `./.postgres` bind mount.** On its first
> start Postgres's `initdb` sets the data directory's permissions to `0700`, which requires `chown`/`chmod`
> on the mount. Against a **host bind mount on Windows/macOS** — especially **rootless Podman**, where the
> container user can't change ownership of a Windows-side path — that fails with
> `could not change permissions of directory "/var/lib/postgresql/data": Operation not permitted`, and the
> database never initializes. A **named volume** is managed inside the engine's VM (ext4), so `initdb`
> succeeds on Docker Desktop and Podman alike. This also sidesteps the bind-mount performance and
> permission quirks Postgres hits on Docker Desktop for Windows/macOS. (Azurite and most other emulators
> tolerate a workspace bind mount fine — this named-volume rule is specific to database emulators like
> Postgres that `chown` their data directory.)

## Connection String

Host depends on client location:

| Client location | Host |
|---|---|
| Host machine (VS Code debug target, `npm` task) | `localhost` |
| Another docker-compose service | `postgres` (the service name) |

```
postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
```

## Required App Environment Variables

Declare in workspace-root **`.env`** beside `POSTGRES_*` values:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}` |
| `POSTGRES_CONNECTION_STRING` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}` |

> Use variable name expected by project ORM/SDK. Above forms are references.
> For docker-compose service values, replace `localhost` host with `postgres`.

> **`.env` must declare every key `.env.example` declares.** `.env.example` is unloaded
> documentation; keys only there remain undefined at run time.

> **A runtime settings file does not cover host-run tasks.** Azure Functions host reads
> `local.settings.json`; its container reads compose `environment:`. Neither reaches host VS Code
> tasks such as `npm run db:migrate`. "Unable to acquire a connection" may mean missing variable,
> not unready database; no socket opened. Put value in `.env` for both paths.

## Healthcheck

The docker-compose block above uses `pg_isready` to verify PostgreSQL accepts connections. Migration service (see [migrations.md](../migrations.md)) waits through `condition: service_healthy` before migrations.

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
  interval: 5s
  timeout: 5s
  retries: 5
  start_period: 30s
```

## Notes

- Port 5432 is the standard PostgreSQL port.
- Simple local-dev default credentials (`postgres`/`postgres`) live in workspace-root `.env`. Never use in production.
- Data persists to container-engine-managed **named volume `postgres_data`**, not a workspace folder. Reset via `docker compose down -v` / `podman compose down -v`, or `docker volume rm <project>_postgres_data`. It needs no `.vscode/settings.json` `files.exclude` entry and is excluded from workspace stale-**directory** preflight checks.
- **Container runtime:** Certified for **Docker** and **Podman**; service block, healthcheck, and named `postgres_data` volume are unchanged for either engine. This named volume, not a bind mount, lets `initdb` run under rootless Podman on Windows/macOS. Both `docker compose` and `podman compose` honor the migrations' `condition: service_healthy` gate.
