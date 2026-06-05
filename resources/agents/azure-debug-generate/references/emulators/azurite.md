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
- **Consolidation:** If multiple storage bindings are detected (blob + queue + table), use a **single** Azurite service — not one per binding type.
- The Event Hubs Emulator requires Azurite for checkpointing. If both are needed, the `azurite` service is shared.
