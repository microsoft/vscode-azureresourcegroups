# Inventory 

Scan the workspace to populate the plan. For multi-service workspaces, loop over each service in `services[]` from classify.md; deduplicate emulators across services per [multi-service.md](multi-service.md).

---

## Step 1: Prerequisites

Check only tools relevant to the detected project types and runtimes.

| Tool | Detection | Required For |
|------|-----------|-------------|
| Node.js | `node --version` | node-ts / node-js runtimes |
| npm | `npm --version` | Node dependency management |
| .NET SDK | `dotnet --version` | dotnet runtime |
| Azure Functions Core Tools | `func --version` | Azure Functions projects |
| Docker | `docker --version` | Running emulators |
| Docker Compose | `docker compose version` | Orchestrating emulators |

### VS Code Extensions

Check the extensions filesystem — do **NOT** use `code --list-extensions` (it launches a new VS Code instance). Instead use something like:

```bash
ls ~/.vscode/extensions/ 2>/dev/null | grep -i "<extension-id-prefix>"
```

| Extension ID | Provides | Required For |
|-------------|----------|-------------|
| `ms-azuretools.vscode-azurefunctions` | Task type `func`, problem matchers | Azure Functions projects |

---

## Step 2: Azure Dependencies

For each service, identify Azure service dependencies by scanning bindings or SDK packages.

- **Functions projects:** Scan bindings per [project-types.md](project-types.md) § functions
- **Other project types:** Scan dependency files (e.g. `package.json`, `requirements.txt`, `*.csproj`) for packages that indicate an Azure service dependency

The table below shows common SDK-to-service mappings — this is **not exhaustive**. Any package that implies connectivity to an Azure service should be mapped accordingly.

| Example Packages | Azure Service | Emulator |
|-----------------|--------------|----------|
| `@azure/storage-blob`, `@azure/storage-queue`, `@azure/data-tables` | Azure Storage | azurite |
| `pg`, `postgres`, `@prisma/client`, `typeorm`, `sequelize`, `Npgsql`, `psycopg2` | PostgreSQL | postgresql |
| `@azure/cosmos` | Cosmos DB | cosmosdb-emulator |
| `@azure/service-bus` | Service Bus | servicebus-emulator |
| `@azure/event-hubs` | Event Hubs | eventhubs-emulator |
| `mssql`, `Microsoft.Data.SqlClient` | Azure SQL | azure-sql-edge |

> Multiple storage bindings (blob + queue + table) consolidate to a **single** azurite entry.
> Cross-check `local.settings.json`, `.env`, and app config for existing connection references to confirm findings.

---

## Step 3: API Test Collection Inventory

For each service, identify whether it exposes testable HTTP endpoints or triggers and provide a brief summary for the plan. Detailed endpoint parsing happens during the generation phase.
