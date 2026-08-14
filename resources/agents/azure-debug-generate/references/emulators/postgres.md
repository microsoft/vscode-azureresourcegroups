# PostgreSQL

> PostgreSQL has no Azure-provided emulator. Use the standard `postgres` Docker image for local development. If the project targets **Azure Cosmos DB for PostgreSQL**, note in the plan that no local emulator is available.

## Docker Image

```
postgres:16
```

## docker-compose Service Block

Declare the local credentials **once** in a workspace-root `.env` file, then reference them
everywhere else. Docker Compose interpolates `${...}` from `.env` (or the shell environment),
so the same values feed the database service and every application service.

`.env` at the workspace root — this file is required; without it Compose interpolates
`${POSTGRES_USER}` to an empty string and the database silently fails to authenticate:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=localdev
```

> **Never inline a concrete `user:password@host` URL** in a generated file. Build the URL from
> the discrete variables above. Besides hard-coding credentials, concrete credential literals are
> rewritten by secret-redaction filters, which silently corrupts the generated file — a masked
> value starting with `*` is a fatal YAML parse error, because YAML reads a leading `*` as an
> alias reference.

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
      - ./.postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped
```

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

> **`.env` must declare every key `.env.example` declares.** `.env.example` is documentation; nothing
> loads it. A key that appears only in `.env.example` is undefined at run time.

> **A runtime settings file does not cover host-run tasks.** `local.settings.json` is read by the
> Azure Functions host, and a compose `environment:` block is read by the container it belongs to.
> Neither reaches a VS Code task that runs a tool directly on the host, such as
> `npm run db:migrate`. A migration client handed an undefined connection string fails with
> "Unable to acquire a connection", which reads like an unready database but is a missing variable —
> the client never opened a socket. Put the value in `.env` so both paths resolve it.

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
- Data is persisted to `./.postgres/`.
