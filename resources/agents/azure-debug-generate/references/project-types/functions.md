# Project Type: Azure Functions

Local development reference for Azure Functions projects.

---

## Detection Signals

| Signal | Notes |
|--------|-------|
| `host.json` present | Required primary signal |
| Azure Functions SDK in dependencies | Confirms Functions project during planning |

---

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| Azure Functions Core Tools | `func --version` | Run Functions host locally | [aka.ms/azure-functions-core-tools](https://aka.ms/azure-functions-core-tools) |

---

## Runtime Support Matrix

| Runtime | Status | Reference |
|---------|--------|-----------|
| node-ts | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| node-js | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| dotnet (Functions isolated) | ✅ Implemented | [runtimes/dotnet.md](../runtimes/dotnet.md) |
| python  | ✅ Implemented | [runtimes/python.md](../runtimes/python.md) |
| java    | 🔲 Planned | [limited-support.md](../limited-support.md) |

> **Limited-support runtimes:** Emit `⚠️ LIMITED SUPPORT:` per [limited-support.md](../limited-support.md), then ask whether to proceed. On agreement, best-effort generate all artifacts (emulators, debug config, tasks). Never silently skip debug/launch configuration; user decides.

---

## Dependency Discovery

Scan `function.json` binding types and source decorators/attributes, including handler modules registered by the entry point. Exclude installed dependencies and generated files. Map each binding to an emulator.

### Binding → Emulator Mapping

Binding names include `function.json` types and Python decorator names. For Python generic binding decorators, inspect their `type` argument to identify the binding.

| Binding Type(s) | Azure Service | Default Ports | Connection String | Status | Reference |
|----------------|---------------|---------------|-------------------|--------|-----------|
| `blobTrigger`, `blob`, `blob_trigger`, `blob_input`, `blob_output` | Blob Storage | 10000 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `queueTrigger`, `queue`, `queue_trigger`, `queue_output` | Queue Storage | 10001 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `table`, `table_input`, `table_output` | Table Storage | 10002 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `cosmosDBTrigger`, `cosmosDB`, `cosmos_db_trigger`, `cosmos_db_input`, `cosmos_db_output`, `cosmos_db_trigger_v3`, `cosmos_db_input_v3`, `cosmos_db_output_v3` | Cosmos DB | 8081, 10250–10254 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `serviceBusTrigger`, `serviceBus`, `service_bus_queue_trigger`, `service_bus_topic_trigger`, `service_bus_queue_output`, `service_bus_topic_output` | Service Bus | 5672 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `eventHubTrigger`, `eventHub`, `event_hub_message_trigger`, `event_hub_output` | Event Hubs | 9093 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `sql`, `sqlTrigger`, `sql_trigger`, `sql_input`, `sql_output` | Azure SQL | 1433 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `httpTrigger`, `route` | (built-in) | — | — | ✅ Implemented | — |
| `timerTrigger`, `timer_trigger`, `schedule` | (built-in) | — | — | ✅ Implemented | — |

> **Azurite consolidation:** Multiple storage bindings (blob + queue + table) use one Azurite service, not one per type.

### Services Without Azure Emulators

| Binding Type | Azure Service | Recommendation |
|-------------|---------------|----------------|
| `signalR`, `signalRConnectionInfo`, `signalRTrigger` | Azure SignalR | Use dev-tier Azure SignalR |
| PostgreSQL (SDK, not a binding) | Azure Database for PostgreSQL | [emulators/postgres.md](../emulators/postgres.md) |

---

## Startup Command

> For VS Code `"type": "func"` tasks, omit `func` executable prefix; Azure Functions extension supplies it. Full CLI equivalents follow.

**Node.js (TypeScript & JavaScript):**

```
languageWorkers__node__arguments="--inspect=9229" func host start
```

> ⚠️ Azure Functions Core Tools do **not** enable Node.js debugging automatically. Supply `--inspect=9229` so Node worker opens VS Code's debug port; otherwise `attach` connects to nothing. In VS Code `func` task, use `options.env` (`languageWorkers__node__arguments`), not command-line flag.

**Python and dotnet:**

```
func host start
```

> Use the native task wiring below. For .NET, Functions host spawns the worker; VS Code attaches via `coreclr`.

---

## Runtime Wiring

<!-- Quick index. See § VS Code Task Configuration for concrete task JSON per runtime. -->

> See **§ VS Code Task Configuration** for concrete task JSON per runtime.

| Runtime | Startup task label | Task type | Problem matcher | Request mode | Status | Reference |
|---------|--------------------|-----------|-----------------|--------------|--------|-----------|
| node-ts | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| node-js | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| dotnet  | `{service-id}: func host start` | `func` | `$func-dotnet-watch` | `attach` | ✅ Implemented | [runtimes/dotnet.md](../runtimes/dotnet.md) |
| python  | `{service-id}: func host start` | `func` | `$func-python-watch` | `attach` | ✅ Implemented | [runtimes/python.md](../runtimes/python.md) |
| java    | `{service-id}: func host start` | `func` | `$func-java-watch` | `attach` | 🔲 Planned | [limited-support.md](../limited-support.md) |

> `{service-id}` is kebab-case ID from plan Service Label; see [generate.md § Service ID Derivation](../generate.md).

> **dotnet `processName` warning.** .NET `coreclr` request `attach` requires literal `processName` in `launch.json`: `.exe` suffix on Windows, none on macOS/Linux. Otherwise F5 fails with `"No process with the specified name is currently running"`. Do NOT use `${command:pickProcess}`. See [runtimes/dotnet.md § processName Determination](../runtimes/dotnet.md).

Startup `dependsOn`:
1. Runtime build/watch label from `runtimes/{rt}.md` § Build Chain (e.g., `{service-id}: npm watch` for node-ts, `{service-id}: dotnet build` for dotnet)
2. `"Start Emulators"` only when plan has checked emulators

> Python's native task provider selects the worker listener port, defaulting to the runtime's base debug port. Changing only `connect.port` does not reconfigure it; verify the provider uses the assigned port before composing multiple Python Functions services.

### VS Code Task Configuration

Top-level task uses Azure Functions extension (`ms-azuretools.vscode-azurefunctions`) VS Code `func` type. Launch `preLaunchTask` targets it.

> **Task label scoping:** Prefix ALL task labels with service ID (e.g., `functions-api: func host start`) to prevent multi-service collisions. See [generate.md § Service ID Derivation](../generate.md).

#### Debug Argument Injection

Functions host runs code in a separate **language-worker**. Point the matching attach config at that worker's port. Node requires the following task environment settings:

| Runtime | `options.env` setting | Value to inject | Debug port | `attach` type | Status |
|---------|-----------------------|-----------------|------------|---------------|--------|
| node-ts | `languageWorkers__node__arguments` | `--inspect=9229` | 9229 | `node` | ✅ Implemented |
| node-js | `languageWorkers__node__arguments` | `--inspect=9229` | 9229 | `node` | ✅ Implemented |


**node-ts** (watch task):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": {
    "cwd": "${workspaceFolder}/{path-to-functions-project}",
    "env": { "languageWorkers__node__arguments": "--inspect=9229" }
  },
  "problemMatcher": "$func-node-watch",
  "isBackground": true,
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "dependsOn": ["{service-id}: npm watch", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` if plan has no checked emulators.

**node-js** (no compile/watch):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": {
    "cwd": "${workspaceFolder}/{path-to-functions-project}",
    "env": { "languageWorkers__node__arguments": "--inspect=9229" }
  },
  "problemMatcher": "$func-node-watch",
  "isBackground": true,
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "dependsOn": ["{service-id}: npm install", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` if plan has no checked emulators.

> `dependsOn` first entry is runtime prerequisite: TypeScript watch or JavaScript install. Exact service-ID-prefixed labels come from `runtimes/{rt}.md` § Build Chain.

**dotnet** (compile before host):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": { "cwd": "${workspaceFolder}/{path-to-functions-project}" },
  "problemMatcher": "$func-dotnet-watch",
  "isBackground": true,
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "dependsOn": ["{service-id}: dotnet build", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` if plan has no checked emulators.

> **dotnet `processName`:** `coreclr` attach needs literal `processName` in `launch.json`. Derive from `.csproj` per [runtimes/dotnet.md § processName Determination](../runtimes/dotnet.md), including cross-platform rule (`.exe` suffix only on Windows).

**Python** (restore and source compile before native host):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": { "cwd": "${workspaceFolder}/{service-root}" },
  "problemMatcher": "$func-python-watch",
  "isBackground": true,
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "dependsOn": ["{service-id}: python compile", "Start Emulators"]
}
```

Remove `"Start Emulators"` when none are checked. The native provider activates the venv selected by Python native-task settings and supplies debugger arguments; do not override them through task environment variables or a host wrapper. Build prerequisites come from [runtimes/python.md](../runtimes/python.md).

#### .NET Isolated Worker Version Constraints

Functions Worker **2.x** required for .NET 10:
- `Microsoft.Azure.Functions.Worker >= 2.50.0`
- `Microsoft.Azure.Functions.Worker.Sdk >= 2.0.5`

For .NET Functions, verify these minimums. Worker 2.x canonical flow: `func host start` + `coreclr` request `attach`; Functions host spawns worker.

### Connection Strings

| Emulator | Key | Value | Status | Reference |
|----------|-----|-------|--------|-----------|
| Azurite (storage) | `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| Cosmos DB | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| Service Bus | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| Event Hubs | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| SQL Edge | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| PostgreSQL | {detected from code} | See [emulators/postgres.md](../emulators/postgres.md) | ✅ Implemented | [emulators/postgres.md](../emulators/postgres.md) |

> **Key discovery:** Only `AzureWebJobsStorage` is fixed by Azure Functions convention. Resolve actual other key names from `local.settings.json`, `.env`, binding configs, and SDK use; never invent defaults.

> **Never overwrite** values in `local.settings.json`; only add missing keys.

Verify that host/client storage settings match Azurite's actual accounts and mapped ports. Default `UseDevelopmentStorage=true` cannot authenticate a custom `AZURITE_ACCOUNTS` account. Surface an existing mismatch for an approved repair rather than claiming readiness or silently switching the storage configuration.

---

## API Test Collections

See [api-test-collections.md](../api-test-collections.md). Generate:

- HTTP triggers → HTTP patterns with `baseUrl: http://localhost:7071/api`
- Blob triggers → Storage § Blob trigger pattern
- Queue triggers → Storage § Queue trigger pattern
- Timer triggers → Timer § admin API pattern, only when explicitly requested
- Cosmos DB triggers → Cosmos DB pattern
- Service Bus triggers → Service Bus pattern
- Event Hub triggers → Event Hubs pattern

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

Add to `.vscode/extensions.json`.

| Extension ID | Why Required |
|--------------|-------------|
| `ms-azuretools.vscode-azurefunctions` | Contributes the `"type": "func"` task type |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

Add to `.vscode/settings.json`.

| Setting | Value | Why |
|---------|-------|-----|
| `azureFunctions.showProjectWarning` | `false` | Suppress "failed to detect project" prompt; generated config handles setup |
| `azureFunctions.validateEmulators` | `false` | Suppress extension emulator warnings; user's orchestrator manages emulators |

### Project discovery

For any language, set `azureFunctions.projectSubpath` only when extension project discovery needs an explicit Functions root, relative to the workspace folder. A generated task's `options.cwd` already selects its startup directory; a nested service alone does not require this setting.

### Python native-task settings

Require these settings for the folder owning a Python Functions task; preserve existing customizations.

| Setting | Value | Why |
|---------|-------|-----|
| `azureFunctions.projectLanguage` | `Python` | Selects Python venv activation and debugger launcher in the native task provider |
| `azureFunctions.pythonVenv` | Actual venv path relative to the Functions task's service cwd | Selects the worker interpreter, not just the Python editor interpreter |

```json
{
  "azureFunctions.projectLanguage": "Python",
  "azureFunctions.pythonVenv": ".venv"
}
```

For task `cwd: "services/my-api"`, a workspace-root `.venv` requires `pythonVenv: "../../.venv"` instead. The runtime's editor interpreter setting must identify the same environment but does not replace native-task settings.

Settings are **folder-scoped**, not task-scoped. Resolve conflicting service settings through an approved separately scoped workspace rather than overwriting one service's values.

---

## Validation Signals

[validation.md](../validation.md) uses these in Phase 3 to verify generated debug configuration.

### Ready Signal

| Top-Level Task | Ready Signal (stdout) |
|----------------|----------------------|
| `{service-id}: func host start` | `"Host lock lease acquired"` or `"Functions host started"` |

> `Top-Level Task` uses canonical `{service-id}:` prefix; see [generate.md § Service ID Derivation](../generate.md). Resolve `{service-id}` exactly as generation before matching `tasks.json`.

### HTTP Verification

| Curl Target | Expected Status | Notes |
|-------------|-----------------|-------|
| First discovered anonymous `httpTrigger` route (e.g., `http://localhost:7071/api/{function-name}`) | `200` | `7071` is Functions HTTP port; `9229` is debugger only. Use first anonymous HTTP trigger found by targeted resolution. If only function-key/admin routes exist, warn and skip HTTP verification; never assume a route. |

### Startup Readiness Task

`$func-python-watch` can signal worker initialization before routes are reachable. For a Python HTTP backend used by a frontend proxy, generate `{service-id}: wait for HTTP` as a bounded HTTP-health readiness task using existing runtime tooling. Probe the route/status from HTTP Verification; fail on timeout. If no safe probe exists, surface the limitation instead of inventing an endpoint.

[multi-service.md](../multi-service.md) owns insertion and ordering of this task.

---

## Checklist — Functions Project Validation

### Post-Generation Checks

After generating `launch.json`, `tasks.json`, and `extensions.json`, verify:

1. ✅ `{service-id}: func host start` exists in `tasks.json` with `"type": "func"`
2. ✅ `launch.json` `preLaunchTask` targets `{service-id}: func host start`
3. ✅ `.vscode/extensions.json` includes `ms-azuretools.vscode-azurefunctions`
4. ✅ `local.settings.json` has all required connection keys (e.g., `AzureWebJobsStorage`)
5. ✅ `dependsOn` includes runtime build/watch and `Start Emulators` when required
6. ✅ Workspace settings follow the selected runtime's requirements in VS Code Workspace Settings above

> Runtime checks (e.g., `dotnet build`, `processName` derivation): `runtimes/{rt}.md`.

### Live Validation Checks

For Python, verify venv activation through the real VS Code `func` task; a terminal-only host launch does not exercise the provider. Verify the host indexes the application's registered functions. Report unavailable native-task controls as unverified per [validation.md](../validation.md).
