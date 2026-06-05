# PostgreSQL

> PostgreSQL has no Azure-provided emulator. Use the standard `postgres` Docker image for local development. If the project targets **Azure Cosmos DB for PostgreSQL**, note in the plan that no local emulator is available.

## Docker Image

```
postgres:16
```

## docker-compose Service Block

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: localdev
    volumes:
      - ./.postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped
```

## Connection String

```
postgresql://postgres:postgres@localhost:5432/localdev
```

## Required App Environment Variables

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/localdev` |
| `POSTGRES_CONNECTION_STRING` | `postgresql://postgres:postgres@localhost:5432/localdev` |

> Use whichever variable name the project's ORM or SDK expects. Both forms above are shown as reference.

## Healthcheck

The healthcheck is included in the docker-compose service block above. It uses `pg_isready` to verify PostgreSQL is accepting connections. The migration service (see [migrations.md](../migrations.md)) depends on `condition: service_healthy` to wait for readiness before running migrations.

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres"]
  interval: 5s
  timeout: 5s
  retries: 5
  start_period: 30s
```

## Notes

- Port 5432 is the standard PostgreSQL port.
- Default credentials (`postgres`/`postgres`) are intentionally simple for local dev. Never use in production.
- Data is persisted to `./.postgres/`.
