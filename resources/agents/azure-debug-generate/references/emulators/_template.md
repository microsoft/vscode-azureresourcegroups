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

## Container Runtime Support

<!-- State whether this emulator has been certified for Docker, Podman, or both. -->
<!-- The compose service block is engine-agnostic, but some Microsoft emulator images make Docker-specific assumptions (privileged mode, architecture, licensing). -->
<!-- If this emulator is NOT yet certified for Podman, say so here so the generation phase emits a `⚠️ LIMITED SUPPORT` warning when the plan selects Podman. -->

| Docker | Podman |
|--------|--------|
| {✅ certified / 🔲 planned} | {✅ certified / 🔲 planned} |

## Notes

<!-- Platform caveats (arm64/x86), known issues, resource requirements. -->
<!-- Note any Podman-specific caveats here (SELinux `:Z` labels on Linux, rootless port ranges, Podman-machine bind-mount paths). -->
