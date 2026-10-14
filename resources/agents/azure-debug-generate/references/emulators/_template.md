# {Emulator Name}

> **Template** — Copy to `emulators/{name}.md` for new emulator.

---

## Docker Image

<!-- Official image + recommended pinned tag. -->

```
{org}/{image}:{tag}
```

## docker-compose Service Block

<!-- Paste-ready service YAML: ports, volumes, health check. -->

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

<!-- App's default local connection string. -->

```
{connection-string}
```

## Required App Environment Variables

<!-- App variables targeting emulator. -->

| Variable | Value |
|----------|-------|
| `{VAR_NAME}` | `{value}` |

## Healthcheck (Database Emulators Only)

<!-- For database emulator, add healthcheck above AND document here. Migration service (see migrations.md) uses `condition: service_healthy` before migrations. No healthcheck breaks auto-migration. -->

<!-- Delete for non-database emulator. -->

## Container Runtime Support

<!-- State whether this emulator has been certified for Docker, Podman, or both. -->
<!-- The compose service block is engine-agnostic, but some Microsoft emulator images make Docker-specific assumptions (privileged mode, architecture, licensing). -->
<!-- If this emulator is NOT yet certified for Podman, say so here so the generation phase emits a `⚠️ LIMITED SUPPORT` warning when the plan selects Podman. -->

| Docker | Podman |
|--------|--------|
| {✅ certified / 🔲 planned} | {✅ certified / 🔲 planned} |

## Notes

<!-- Platform caveats (arm64/x86), known issues, resource needs. -->
<!-- Note Podman-specific caveats here (SELinux `:Z` labels on Linux, rootless port ranges, Podman-machine bind-mount paths). -->
