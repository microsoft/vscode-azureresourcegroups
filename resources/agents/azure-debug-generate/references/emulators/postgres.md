# PostgreSQL

> PostgreSQL has no Azure-provided emulator. Use the standard `postgres` Docker image for local development. If the project targets **Azure Cosmos DB for PostgreSQL**, note in the plan that no local emulator is available.

## Docker Image

```
postgres:16
```

## docker-compose Service Block

Declare the local credentials **once** in a workspace-root `.env`, then reference them everywhere
else. Compose interpolates `${...}` from `.env` (or the shell environment), so the same values feed
the database service and every application service.

`.env` is required — without it Compose interpolates `${POSTGRES_USER}` to an empty string and the
database silently fails to authenticate:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=localdev
```

> ⛔ **`.gitignore` must list `.env` before you create it.** A credential that reaches a commit is
> compromised and has to be rotated — deleting it in a later commit leaves the value in history and
> in every existing clone and fork. Private repositories are no exception. If the project has no
> `.gitignore`, or has one that omits `.env`, fix that before writing the file.

> **Never inline a concrete `user:password@host` URL** in a generated file — build it from the
> variables above. Beyond hard-coding a credential, such literals are rewritten by secret-redaction
> filters, and a masked value starting with `*` is a fatal YAML parse error: YAML reads a leading
> `*` as an alias reference.

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

The host depends on where the client runs:

| Client location | Host |
|---|---|
| Host machine (VS Code debug target, `npm` task) | `localhost` |
| Another docker-compose service | `postgres` (the service name) |

```
postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
```

## Required App Environment Variables

Declare these in the workspace-root **`.env`**, alongside the `POSTGRES_*` values:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}` |
| `POSTGRES_CONNECTION_STRING` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}` |

> Use whichever variable name the project's ORM or SDK expects. Both forms above are shown as reference.
> When the value is set on a docker-compose service, replace the `localhost` host with `postgres`.

> **`.env` must declare every key `.env.example` declares.** `.env.example` is documentation —
> nothing loads it, so a key that appears only there is undefined at run time.

> **A runtime settings file does not cover host-run tasks.** `local.settings.json` is read by the
> Azure Functions host and a compose `environment:` block by its own container; neither reaches a
> VS Code task that runs a tool directly on the host, such as `npm run db:migrate`. That client
> fails with "Unable to acquire a connection", which reads like an unready database but is a
> missing variable — it never opened a socket. Put the value in `.env` so both paths resolve it.

## Healthcheck

The healthcheck is included in the docker-compose service block above. It uses `pg_isready` to verify PostgreSQL is accepting connections. The migration service (see [migrations.md](../migrations.md)) depends on `condition: service_healthy` to wait for readiness before running migrations.

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
- Default credentials (`postgres`/`postgres`) are intentionally simple for local dev and are declared in the workspace-root `.env`. Never use in production.
- Data is persisted to the **named volume `postgres_data`** (managed by the container engine, not a workspace folder). Reset it with `docker compose down -v` / `podman compose down -v`, or `docker volume rm <project>_postgres_data`. Because it is not a workspace directory, it needs no `.vscode/settings.json` `files.exclude` entry and is not part of the workspace stale-**directory** preflight check.
- **Container runtime:** Certified for both **Docker** and **Podman** — the service block, healthcheck, and named `postgres_data` volume are unchanged for either engine. The named volume (not a bind mount) is what lets `initdb` run under rootless Podman on Windows/macOS. The `condition: service_healthy` gate that migrations depend on is honored by both `docker compose` and `podman compose`.
