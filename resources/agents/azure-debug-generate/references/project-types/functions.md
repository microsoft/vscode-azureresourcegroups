# Project Type: Azure Functions

Reference guide for local development setup of Azure Functions projects.

---

## Detection Signals

| Signal | Notes |
|--------|-------|
| `host.json` present | Primary signal — required |
| Azure Functions SDK in dependencies | Confirms it's a Functions project — identified during the plan phase |

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
| python  | 🔲 Planned | [limited-support.md](../limited-support.md) |
| java    | 🔲 Planned | [limited-support.md](../limited-support.md) |

> **Limited-support runtimes:** When a runtime with limited support is detected, emit a `⚠️ LIMITED SUPPORT:` warning per [limited-support.md](../limited-support.md) and ask the user whether to proceed. If the user agrees, proceed with best-effort generation for all artifacts (emulators, debug config, tasks). Do not silently skip debug/launch configuration — let the user decide.

---

## Dependency Discovery

Scan every `function.json` for its `"type"` binding field, **or** scan Python/Java source files for trigger decorator/attribute names. Each binding maps to an emulator.

### Binding → Emulator Mapping

| Binding Type(s) | Azure Service | Default Ports | Connection String | Status | Reference |
|----------------|---------------|---------------|-------------------|--------|-----------|
| `blobTrigger`, `blob` | Blob Storage | 10000 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `queueTrigger`, `queue` | Queue Storage | 10001 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `table` | Table Storage | 10002 | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| `cosmosDBTrigger`, `cosmosDB` | Cosmos DB | 8081, 10250–10254 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `serviceBusTrigger`, `serviceBus` | Service Bus | 5672 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `eventHubTrigger`, `eventHub` | Event Hubs | 9093 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `sql`, `sqlTrigger` | Azure SQL | 1433 | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| `httpTrigger` | (built-in) | — | — | ✅ Implemented | — |
| `timerTrigger` | (built-in) | — | — | ✅ Implemented | — |

> **Azurite consolidation:** If multiple storage bindings (blob + queue + table) are detected, create a **single** Azurite service — not one per binding type.

### Services Without Azure Emulators

| Binding Type | Azure Service | Recommendation |
|-------------|---------------|----------------|
| `signalR` | Azure SignalR | Use a dev-tier Azure SignalR instance |
| PostgreSQL (SDK, not a binding) | Azure Database for PostgreSQL | [emulators/postgres.md](../emulators/postgres.md) |

---

## Startup Command

> For VS Code `"type": "func"` tasks, omit the `func` executable prefix — the Azure Functions extension supplies it. The equivalent CLI commands are shown below for reference.

**Node.js (TypeScript & JavaScript):**

```
func host start --language-worker -- "--inspect=9229"
```

> ⚠️ The Azure Functions Core Tools do **not** automatically enable the Node.js debugger. You **must** pass `--language-worker -- "--inspect=9229"` explicitly so the Node worker process opens a debug port for VS Code to attach to. Without this flag, the `attach` configuration connects to nothing.

**dotnet:**

```
func host start
```

> For .NET, the Functions host spawns a worker process that VS Code attaches to via `coreclr` — no additional debug flags are needed on the command line.

---

## Runtime Wiring

<!-- Quick-reference index. See § VS Code Task Configuration below for the concrete task JSON per runtime. -->

> See **§ VS Code Task Configuration** below for the concrete task JSON for each runtime.

| Runtime | Startup task label | Task type | Problem matcher | Request mode | Status | Reference |
|---------|--------------------|-----------|-----------------|--------------|--------|-----------|
| node-ts | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| node-js | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| dotnet  | `{service-id}: func host start` | `func` | `$func-dotnet-watch` | `attach` | ✅ Implemented | [runtimes/dotnet.md](../runtimes/dotnet.md) |
| python  | `{service-id}: func host start` | `func` | `$func-python-watch` | `attach` | 🔲 Planned | [limited-support.md](../limited-support.md) |
| java    | `{service-id}: func host start` | `func` | `$func-java-watch` | `attach` | 🔲 Planned | [limited-support.md](../limited-support.md) |

> `{service-id}` is the kebab-case ID derived from the plan's Service Label column — see [generate.md § Service ID Derivation](../generate.md).

> **dotnet `processName` warning.** The .NET `coreclr` (request: `attach`) configuration requires the literal `processName` in `launch.json` — `.exe` suffix on Windows, no extension on macOS/Linux. Without it, F5 fails with `"No process with the specified name is currently running"`. Do NOT use `${command:pickProcess}`. See [runtimes/dotnet.md § processName Determination](../runtimes/dotnet.md).

The startup step `dependsOn`:
1. The runtime-specific build/watch task label from `runtimes/{rt}.md` § Build Chain (e.g., `{service-id}: npm watch` for node-ts, `{service-id}: dotnet build` for dotnet)
2. `"Start Emulators"` (only when emulators are required — omit when the plan has no checked emulators)

### VS Code Task Configuration

The top-level task uses the VS Code `func` task type provided by the Azure Functions extension (`ms-azuretools.vscode-azurefunctions`). The launch configuration's `preLaunchTask` points to this task.

> **Task label scoping:** All task labels MUST be prefixed with the service ID (e.g., `functions-api: func host start`). This prevents label collisions in multi-service workspaces. See [generate.md § Service ID Derivation](../generate.md).

**node-ts** (has watch task):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start --language-worker -- \"--inspect=9229\"",
  "problemMatcher": "$func-node-watch",
  "isBackground": true,
  "runOptions": { 
    "instanceLimit": 1, 
    "instancePolicy": "terminateOldest" 
  },
  "dependsOn": ["{service-id}: npm watch", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` when the plan has no checked emulators.

**node-js** (no compile/watch step):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start --language-worker -- \"--inspect=9229\"",
  "problemMatcher": "$func-node-watch",
  "isBackground": true,
  "runOptions": { 
    "instanceLimit": 1, 
    "instancePolicy": "terminateOldest"
  },
  "dependsOn": ["{service-id}: npm install", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` when the plan has no checked emulators.

> `dependsOn`: first entry is the runtime-specific prerequisite — watch task for TypeScript, install task for JavaScript. The exact task labels come from `runtimes/{rt}.md` § Build Chain, prefixed with the service ID.

**dotnet** (compiled — requires build before host start):

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": { "cwd": "${workspaceFolder}/{path-to-functions-project}" },
  "problemMatcher": "$func-dotnet-watch",
  "isBackground": true,
  "runOptions": {
    "instanceLimit": 1,
    "instancePolicy": "terminateOldest"
  },
  "dependsOn": ["{service-id}: dotnet build", "Start Emulators"]
}
```

> Remove `"Start Emulators"` from `dependsOn` when the plan has no checked emulators.

> All `func host start` tasks use `terminateOldest` because they bind a network port (default 7071). See [generate.md](../generate.md) § Task `runOptions` Rules for the general principle.

> **dotnet `processName`:** The `coreclr` attach configuration requires a literal `processName` in `launch.json`. See [runtimes/dotnet.md § processName Determination](../runtimes/dotnet.md) for how to derive it from the `.csproj`, including cross-platform rules (`.exe` suffix on Windows only).

#### .NET Isolated Worker Version Constraints

Functions Worker **2.x** is required for .NET 10:
- `Microsoft.Azure.Functions.Worker >= 2.50.0`
- `Microsoft.Azure.Functions.Worker.Sdk >= 2.0.5`

When detecting a .NET Functions project, verify these minimum versions. Worker 2.x uses the canonical `func host start` + `coreclr` (request: `attach`) flow where the Functions host spawns the worker process.

### Connection Strings

| Emulator | Key | Value | Status | Reference |
|----------|-----|-------|--------|-----------|
| Azurite (storage) | `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | ✅ Implemented | [emulators/azurite.md](../emulators/azurite.md) |
| Cosmos DB | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| Service Bus | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| Event Hubs | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| SQL Edge | {detected from bindings} | — | 🔲 Planned | [limited-support.md](../limited-support.md) |
| PostgreSQL | {detected from code} | See [emulators/postgres.md](../emulators/postgres.md) | ✅ Implemented | [emulators/postgres.md](../emulators/postgres.md) |

> **Key discovery:** Except for `AzureWebJobsStorage` (a well-known Azure Functions convention), connection string key names are not fixed. Perform targeted resolution — check `local.settings.json`, `.env`, binding configurations, and SDK usage to detect the actual key names. Use the detected names — do not invent defaults.

> **Never overwrite** existing values in `local.settings.json` — only add missing keys.

---

## API Test Collections

See [api-test-collections.md](../api-test-collections.md) for all test script patterns. For this project type, generate tests for:

- HTTP triggers → HTTP patterns with `baseUrl: http://localhost:7071/api`
- Blob triggers → Storage § Blob trigger pattern
- Queue triggers → Storage § Queue trigger pattern
- Timer triggers → Timer § admin API pattern (only if explicitly requested)
- Cosmos DB triggers → Cosmos DB pattern
- Service Bus triggers → Service Bus pattern
- Event Hub triggers → Event Hubs pattern

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

Contribute the following to `.vscode/extensions.json`.

| Extension ID | Why Required |
|--------------|-------------|
| `ms-azuretools.vscode-azurefunctions` | Contributes the `"type": "func"` task type |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

Contribute the following to `.vscode/settings.json`.

| Setting | Value | Why |
|---------|-------|-----|
| `azureFunctions.showProjectWarning` | `false` | Suppresses the "failed to detect project" prompt that fires when the extension scans the workspace — our generated config already handles project setup |
| `azureFunctions.validateEmulators` | `false` | Suppresses emulator validation warnings from the extension — emulators are managed via user's orchestrator configuration |

---

## Validation Signals

Used by [validation.md](../validation.md) during Phase 3 to verify the generated debug configuration works.

### Ready Signal

| Top-Level Task | Ready Signal (stdout) |
|----------------|----------------------|
| `{service-id}: func host start` | `"Host lock lease acquired"` or `"Functions host started"` |

> The `Top-Level Task` column uses the canonical `{service-id}:`-prefixed label — see [generate.md § Service ID Derivation](../generate.md). Resolve `{service-id}` to the same value used during generation before matching against `tasks.json`.

### HTTP Verification

| Curl Target | Expected Status | Notes |
|-------------|-----------------|-------|
| First discovered anonymous `httpTrigger` route (e.g., `http://localhost:7071/api/{function-name}`) | `200` | Port `7071` is the Functions host HTTP port; debug port `9229` is for the debugger only. Use the first anonymous HTTP trigger found during targeted resolution. If only function-key/admin routes exist, skip HTTP verification with a warning rather than assuming a route. |

---

## Checklist — Functions Project Validation

After generating `launch.json`, `tasks.json`, and `extensions.json`, verify the following were produced correctly:

1. ✅ `{service-id}: func host start` task exists in `tasks.json` with `"type": "func"`
2. ✅ `launch.json` `preLaunchTask` points to `{service-id}: func host start`
3. ✅ `.vscode/extensions.json` includes `ms-azuretools.vscode-azurefunctions`
4. ✅ `local.settings.json` contains all required connection string keys (e.g., `AzureWebJobsStorage`)
5. ✅ `dependsOn` chain includes the runtime build/watch task and `Start Emulators` (when emulators are required)

> Runtime-specific checks (e.g., `dotnet build` task, `processName` derivation) are defined in `runtimes/{rt}.md`.
