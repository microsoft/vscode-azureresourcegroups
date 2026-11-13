# Inventory

Scan workspace to populate plan. For multi-service workspaces, process each `services[]` service from classify.md; deduplicate emulators per [multi-service.md](multi-service.md).

---

## Step 1: Prerequisites

### Autopilot: Reuse the Project Plan Prerequisites

**Autopilot mode only.** If `.azure/project-plan.md` lists Prerequisites (`### Run` and `### Debug` groups), copy all into debug plan instead of re-deriving: planning already inventoried them, and autopilot lacks approval gate to catch omissions. Add scan-discovered missing prerequisites; never silently override project-plan entries. Derive from workspace scan below only when project-plan lacks Prerequisites.

In interactive (non-autopilot) mode, derive from workspace scan; user reviews and edits before approval.

### Deriving Prerequisites from the Workspace Scan

Identify and inventory required tools via [prerequisites.md](../../shared-references/prerequisites.md).

First select the development environment using [development-environments.md](development-environments.md).
Inspect `.azure/created-by-cor.json` before treating an undeclared runtime as eligible for the deterministic
Node 24 default. Host-installed Node and `@types/node` are inventory observations only and never runtime
selection evidence.

For **Host** mode, derive tools from the current workspace scan. Check only those relevant to detected
project types, runtimes, and Azure bindings. Include both prerequisites.md sets: **Run** tools (Node.js,
.NET SDK, Python, Functions Core Tools, ...) and **Debug** tools (Docker, Docker Compose, VS Code
extensions, ...), because debugging uses the full local stack.

For **Sandbox** mode, the Prerequisites table contains host requirements only: the selected container
runtime plus Compose provider, a supported browser for frontend debugging, and matching runtime debug
extensions. Record the inherited Microsoft image toolchain under **Base-Provided Tools** and the
tools installed by the generated Dockerfile under **CoR-Added Tools**. Never mark either set missing
on the host or require host installation.

For every detected project type, add its VS Code debug-integration extension from Debug Tools as a
separate Debug row (e.g. Azure Functions always includes `ms-azuretools.vscode-azurefunctions`).
Never add `ms-vscode-remote.remote-containers` for Sandbox mode.

Apply prerequisites.md's runtime compatibility and extension requirements, including in autopilot. Add missing prerequisite rows and recheck stale installation results against the actual service rather than carrying forward an incompatible tool as `✅`.

---

## Step 2: Azure Dependencies

Identify each service's Azure dependencies by scanning bindings or SDK packages.

- **Functions projects:** Scan bindings per [project-types.md](project-types.md) § functions.
- **Every project type, including Functions:** Scan dependency files (e.g. `package.json`, `requirements.txt`, `pyproject.toml`, `*.csproj`) and SDK imports for Azure service packages.

Common SDK-to-service mappings below are **not exhaustive**. Map every package implying Azure service connectivity.

| Example Packages | Azure Service | Emulator |
|-----------------|--------------|----------|
| `@azure/storage-blob`, `@azure/storage-queue`, `@azure/data-tables`, `azure-storage-blob`, `azure-storage-queue`, `azure-data-tables` | Azure Storage | azurite |
| `pg`, `postgres`, `@prisma/client`, `typeorm`, `sequelize`, `Npgsql`, `psycopg2`, `psycopg2-binary`, `psycopg`, `asyncpg` | PostgreSQL | postgresql |
| `@azure/cosmos`, `azure-cosmos` | Cosmos DB | cosmosdb-emulator |
| `@azure/service-bus`, `azure-servicebus` | Service Bus | servicebus-emulator |
| `@azure/event-hubs`, `azure-eventhub` | Event Hubs | eventhubs-emulator |
| `mssql`, `Microsoft.Data.SqlClient`, `pyodbc` with an Azure SQL connection | Azure SQL | azure-sql-edge |
| `redis`, `ioredis`, Python `redis` / `redis.asyncio` | Redis | redis |

> Consolidate multiple storage bindings (blob + queue + table) into **one** azurite entry.
> Confirm findings against connection references in `local.settings.json`, `.env`, and app config.

Python distribution names can differ from imports (`azure-storage-blob` / `azure.storage.blob`) and include extras/version constraints (`psycopg[binary,pool]>=3`). Normalize those names before mapping. SQLAlchemy alone does not identify a database; inspect its configured driver/connection. Keep emulator support warnings independent of Python runtime support.

---

## Step 3: API Test Collection Inventory

For each service, identify testable HTTP endpoints or triggers; summarize briefly in the plan. Inventory implemented route and trigger registrations in the workspace, not only the route table in `.azure/project-plan.md`. The project plan intentionally omits derived authentication routes; include implemented registration, login, and current-user endpoints when `API Login` is enabled. Detailed parsing occurs during generation.
