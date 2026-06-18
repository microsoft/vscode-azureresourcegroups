# Inventory

Scan the workspace to populate the plan. For multi-service workspaces, loop over each service in `services[]` from classify.md; deduplicate emulators across services per [multi-service.md](multi-service.md).

---

## Step 1: Prerequisites

Check only tools relevant to the detected project types and runtimes.

### Shell Environment Caveats

Subagent shells may run as **non-interactive** processes. On macOS/Linux, non-interactive shells skip user startup files like `~/.bashrc`, `~/.zshrc`, etc. Since some users may configure PATH additions in these interactive-only rc files, those paths are invisible to subagents.

**Before running any version checks**, detect the user's default shell via `$SHELL` and source any relevant rc files to inherit any PATH additions:

```bash
# macOS / Linux — source the user's rc file silently based on their default shell
case "$SHELL" in
  */bash) [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null >/dev/null ;;
  */zsh)  [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null >/dev/null ;;
  */fish) ;; # fish uses incompatible syntax; rely on fallback PATH approach below
  *)      [ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null >/dev/null ;;
esac
```

On **Windows**, PATH is set at the system/user level via the Windows registry. Tools installed via `winget`, `choco`, etc. are available in all shell contexts without sourcing any profile — the missing-PATH problem is primarily a macOS/Linux issue.

### CLI Tool Detection

| Tool | Detection | Required For |
|------|-----------|-------------|
| Node.js | `node --version` | node-ts / node-js runtimes |
| npm | `npm --version` | Node dependency management |
| .NET SDK | `dotnet --version` | dotnet runtime |
| Azure Functions Core Tools | `func --version` | Azure Functions projects |
| Docker | `docker --version` | Running emulators |
| Docker Compose | `docker compose version` | Orchestrating emulators |

When a tool check fails, use `which`/`where` with fallback paths before reporting it as missing:

```bash
# macOS/Linux
which func 2>/dev/null || \
  find /opt/homebrew/bin /usr/local/bin ~/.npm-global/bin -name "func" 2>/dev/null | head -1
```

```powershell
# Windows PowerShell
Get-Command func -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

### VS Code Extensions

Check the extensions filesystem — do **NOT** use `code --list-extensions` (it launches a new VS Code instance). Users may have VS Code, VS Code Insiders, or both — always check all possible locations using `find` (more reliable than piping `ls` through `grep`):

```bash
# macOS/Linux
find ~/.vscode/extensions ~/.vscode-insiders/extensions -maxdepth 1 -name "<extension-id-prefix>*" 2>/dev/null
```

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.vscode\extensions", "$env:USERPROFILE\.vscode-insiders\extensions" -Filter "<extension-id-prefix>*" -ErrorAction SilentlyContinue
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
