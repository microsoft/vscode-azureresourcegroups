# {Emulator Name}

> **Template** — Copy this file to `emulators/{name}.md` when adding a new emulator.

---

## Docker Image

<!-- Official image and recommended pinned tag. -->

```
{org}/{image}:{tag}
```

## docker-compose Service Block

<!-- Complete service YAML block, ready to paste. Includes ports, volumes, health check. -->

```yaml
services:
  {service-name}:
    image: {org}/{image}:{tag}
    ports:
      - "{host-port}:{container-port}"
    volumes:
      - ./.{service-name}:/data
    restart: unless-stopped
```

## Connection String

<!-- Default local connection string for the app to use. -->

```
{connection-string}
```

## Required App Environment Variables

<!-- Variable names the app must set to point at this emulator. -->

| Variable | Value |
|----------|-------|
| `{VAR_NAME}` | `{value}` |

## Healthcheck (Database Emulators Only)

<!-- If this emulator is a database, include a healthcheck block in the docker-compose service above AND document it here. The migration service (see migrations.md) depends on `condition: service_healthy` to wait for the database before running migrations. Without a healthcheck, auto-migration will not work. -->

<!-- Delete this section if the emulator is not a database. -->

## Notes

<!-- Platform caveats (arm64/x86), known issues, resource requirements. -->
