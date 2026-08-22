# Inventory

Scan the workspace to populate the plan. For multi-service workspaces, loop over each service in `services[]` from classify.md; deduplicate emulators across services per [multi-service.md](multi-service.md).

---

## Step 1: Prerequisites

### Autopilot: Reuse the Project Plan Prerequisites

**Autopilot mode only.** In autopilot, if `.azure/project-plan.md` exists and lists Prerequisites (its `### Run` and `### Debug` groups), carry those prerequisites over wholesale into the debug plan instead of re-deriving them — the planning stage already inventoried them, and autopilot has no approval gate to catch a dropped prerequisite. Add any prerequisites the workspace scan reveals that project-plan is missing, and don't silently override a project-plan entry. Only when project-plan has no Prerequisites do you fall back to deriving them from the workspace scan below.

In interactive (non-autopilot) mode, derive prerequisites from the workspace scan as usual; the user reviews and edits the plan before approving.

### Deriving Prerequisites from the Workspace Scan

Identify required tools and then inventory them by following [prerequisites.md](../../shared-references/prerequisites.md).

The required tools are derived from a scan of the currently opened workspace project — check only the tools and extensions relevant to the detected project types, runtimes, and Azure bindings. Both tool sets defined in prerequisites.md apply here — the **Run** tools (Node.js, .NET SDK, Python, Functions Core Tools, ...) and the **Debug** tools (Docker, Docker Compose, VS Code extensions, ...) — since debugging exercises the full local stack.

For every detected project type, include its VS Code debug-integration extension from the Debug Tools table as its own Debug row (e.g. an Azure Functions project always includes `ms-azuretools.vscode-azurefunctions`) — these extensions are required for the debug experience and are separate from the Run-group CLI/runtime tools, so never omit them.

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
