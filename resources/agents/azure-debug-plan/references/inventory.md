# Inventory

Scan workspace to populate plan. For multi-service workspaces, process each `services[]` service from classify.md; deduplicate emulators per [multi-service.md](multi-service.md).

---

## Step 1: Prerequisites

### Autopilot: Reuse the Project Plan Prerequisites

**Autopilot mode only.** If `.azure/project-plan.md` lists Prerequisites (`### Run` and `### Debug` groups), copy all into debug plan instead of re-deriving: planning already inventoried them, and autopilot lacks approval gate to catch omissions. Add scan-discovered missing prerequisites; never silently override project-plan entries. Derive from workspace scan below only when project-plan lacks Prerequisites.

In interactive (non-autopilot) mode, derive from workspace scan; user reviews and edits before approval.

### Deriving Prerequisites from the Workspace Scan

Identify and inventory required tools via [prerequisites.md](../../shared-references/prerequisites.md).

Derive tools from current workspace scan. Check only those relevant to detected project types, runtimes, and Azure bindings. Include both prerequisites.md sets: **Run** tools (Node.js, .NET SDK, Python, Functions Core Tools, ...) and **Debug** tools (Docker, Docker Compose, VS Code extensions, ...), because debugging uses full local stack.

For every detected project type, add its VS Code debug-integration extension from Debug Tools as a separate Debug row (e.g. Azure Functions always includes `ms-azuretools.vscode-azurefunctions`). These required extensions differ from Run-group CLI/runtime tools; never omit them.

---

## Step 2: Azure Dependencies

Identify each service's Azure dependencies by scanning bindings or SDK packages.

- **Functions projects:** Scan bindings per [project-types.md](project-types.md) § functions
- **Other project types:** Scan dependency files (e.g. `package.json`, `requirements.txt`, `*.csproj`) for Azure service packages

Common SDK-to-service mappings below are **not exhaustive**. Map every package implying Azure service connectivity.

| Example Packages | Azure Service | Emulator |
|-----------------|--------------|----------|
| `@azure/storage-blob`, `@azure/storage-queue`, `@azure/data-tables` | Azure Storage | azurite |
| `pg`, `postgres`, `@prisma/client`, `typeorm`, `sequelize`, `Npgsql`, `psycopg2` | PostgreSQL | postgresql |
| `@azure/cosmos` | Cosmos DB | cosmosdb-emulator |
| `@azure/service-bus` | Service Bus | servicebus-emulator |
| `@azure/event-hubs` | Event Hubs | eventhubs-emulator |
| `mssql`, `Microsoft.Data.SqlClient` | Azure SQL | azure-sql-edge |

> Consolidate multiple storage bindings (blob + queue + table) into **one** azurite entry.
> Confirm findings against connection references in `local.settings.json`, `.env`, and app config.

---

## Step 3: API Test Collection Inventory

For each service, identify testable HTTP endpoints or triggers; summarize briefly in the plan. Inventory implemented route and trigger registrations in the workspace, not only the route table in `.azure/project-plan.md`. The project plan intentionally omits derived authentication routes; include implemented registration, login, and current-user endpoints when `API Login` is enabled. Detailed parsing occurs during generation.
