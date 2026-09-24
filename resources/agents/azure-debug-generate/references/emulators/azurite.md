# Azurite (Azure Blob / Queue / Table Storage)

## Docker Image

```
mcr.microsoft.com/azure-storage/azurite
```

## docker-compose Service Block

```yaml
services:
  azurite:
    image: mcr.microsoft.com/azure-storage/azurite
    # Overriding the default command requires re-specifying --blobHost/--queueHost/--tableHost 0.0.0.0
    # so Azurite listens on all interfaces (the image's default). Without them, Azurite falls back to
    # 127.0.0.1 inside the container and becomes unreachable from the host via port mapping.
    # --skipApiVersionCheck allows newer Azure SDK API versions to work with older Azurite releases.
    command: azurite --blobHost 0.0.0.0 --queueHost 0.0.0.0 --tableHost 0.0.0.0 --skipApiVersionCheck
    ports:
      - "10000:10000"
      - "10001:10001"
      - "10002:10002"
    volumes:
      - ./.azurite:/data
    restart: unless-stopped
```

## Connection String

```
UseDevelopmentStorage=true
```

## Required App Environment Variables

| Variable | Value |
|----------|-------|
| `AzureWebJobsStorage` (Functions) | `UseDevelopmentStorage=true` |
| `AZURE_STORAGE_CONNECTION_STRING` (SDK) | `UseDevelopmentStorage=true` |

## Notes

- Ports: 10000 (Blob), 10001 (Queue), 10002 (Table)
- **Consolidation:** Multiple storage bindings (blob + queue + table) use **one** Azurite service, not one per binding type.
- Event Hubs Emulator needs Azurite for checkpointing. When both are needed, share the `azurite` service.
- **Container runtime:** Certified for **Docker** and **Podman**; service block unchanged for either engine. On Windows/macOS, Podman publishes ports from Podman machine to host like Docker; the `./.azurite` bind mount needs no `:Z`/`:z` volume label.

## Temporary diff-reader smoke fixture

The records below are test-only change data, not Azurite instructions.

- emulators/azurite.md smoke record 001: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 002: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 003: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 004: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 005: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 006: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 007: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 008: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 009: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 010: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 011: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 012: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 013: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 014: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 015: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 016: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 017: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 018: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 019: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 020: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 021: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 022: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 023: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 024: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 025: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 026: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 027: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 028: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 029: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 030: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 031: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 032: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 033: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 034: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 035: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 036: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 037: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 038: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 039: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 040: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 041: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 042: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 043: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 044: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 045: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 046: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 047: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 048: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 049: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 050: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 051: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 052: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 053: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 054: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 055: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 056: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 057: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- emulators/azurite.md smoke record 058: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
