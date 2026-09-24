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
| python  | 🔲 Planned | [limited-support.md](../limited-support.md) |
| java    | 🔲 Planned | [limited-support.md](../limited-support.md) |

> **Limited-support runtimes:** Emit `⚠️ LIMITED SUPPORT:` per [limited-support.md](../limited-support.md), then ask whether to proceed. On agreement, best-effort generate all artifacts (emulators, debug config, tasks). Never silently skip debug/launch configuration; user decides.

---

## Dependency Discovery

Scan every `function.json` `"type"` binding, or Python/Java sources for trigger decorator/attribute names. Map each binding to an emulator.

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

> **Azurite consolidation:** Multiple storage bindings (blob + queue + table) use one Azurite service, not one per type.

### Services Without Azure Emulators

| Binding Type | Azure Service | Recommendation |
|-------------|---------------|----------------|
| `signalR` | Azure SignalR | Use dev-tier Azure SignalR |
| PostgreSQL (SDK, not a binding) | Azure Database for PostgreSQL | [emulators/postgres.md](../emulators/postgres.md) |

---

## Startup Command

> For VS Code `"type": "func"` tasks, omit `func` executable prefix; Azure Functions extension supplies it. Full CLI equivalents follow.

**Node.js (TypeScript & JavaScript):**

```
languageWorkers__node__arguments="--inspect=9229" func host start
```

> ⚠️ Azure Functions Core Tools do **not** enable Node.js debugging automatically. Supply `--inspect=9229` so Node worker opens VS Code's debug port; otherwise `attach` connects to nothing. In VS Code `func` task, use `options.env` (`languageWorkers__node__arguments`), not command-line flag. Env form avoids shell/JSON quoting and keeps `languageWorkers__<runtime>__arguments` consistent across runtimes.

**dotnet:**

```
func host start
```

> For .NET, Functions host spawns worker; VS Code attaches via `coreclr`. No extra command-line debug flags.

---

## Runtime Wiring

<!-- Quick index. See § VS Code Task Configuration for concrete task JSON per runtime. -->

> See **§ VS Code Task Configuration** for concrete task JSON per runtime.

| Runtime | Startup task label | Task type | Problem matcher | Request mode | Status | Reference |
|---------|--------------------|-----------|-----------------|--------------|--------|-----------|
| node-ts | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| node-js | `{service-id}: func host start` | `func` | `$func-node-watch` | `attach` | ✅ Implemented | [runtimes/node.md](../runtimes/node.md) |
| dotnet  | `{service-id}: func host start` | `func` | `$func-dotnet-watch` | `attach` | ✅ Implemented | [runtimes/dotnet.md](../runtimes/dotnet.md) |
| python  | `{service-id}: func host start` | `func` | `$func-python-watch` | `attach` | 🔲 Planned | [limited-support.md](../limited-support.md) |
| java    | `{service-id}: func host start` | `func` | `$func-java-watch` | `attach` | 🔲 Planned | [limited-support.md](../limited-support.md) |

> `{service-id}` is kebab-case ID from plan Service Label; see [generate.md § Service ID Derivation](../generate.md).

> **dotnet `processName` warning.** .NET `coreclr` request `attach` requires literal `processName` in `launch.json`: `.exe` suffix on Windows, none on macOS/Linux. Otherwise F5 fails with `"No process with the specified name is currently running"`. Do NOT use `${command:pickProcess}`. See [runtimes/dotnet.md § processName Determination](../runtimes/dotnet.md).

Startup `dependsOn`:
1. Runtime build/watch label from `runtimes/{rt}.md` § Build Chain (e.g., `{service-id}: npm watch` for node-ts, `{service-id}: dotnet build` for dotnet)
2. `"Start Emulators"` only when plan has checked emulators

### VS Code Task Configuration

Top-level task uses Azure Functions extension (`ms-azuretools.vscode-azurefunctions`) VS Code `func` type. Launch `preLaunchTask` targets it.

> **Task label scoping:** Prefix ALL task labels with service ID (e.g., `functions-api: func host start`) to prevent multi-service collisions. See [generate.md § Service ID Derivation](../generate.md).

#### Debug Argument Injection

Functions host runs code in separate **language-worker**, which must start with runtime debug flag. Inject through task `options.env` using `languageWorkers__<runtime>__arguments`; point matching `attach` config at that port. Per runtime, only env key, flag, and attach `type`/`port` differ; keep remaining `func host start` task identical.

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

---

## Checklist — Functions Project Validation

After generating `launch.json`, `tasks.json`, and `extensions.json`, verify:

1. ✅ `{service-id}: func host start` exists in `tasks.json` with `"type": "func"`
2. ✅ `launch.json` `preLaunchTask` targets `{service-id}: func host start`
3. ✅ `.vscode/extensions.json` includes `ms-azuretools.vscode-azurefunctions`
4. ✅ `local.settings.json` has all required connection keys (e.g., `AzureWebJobsStorage`)
5. ✅ `dependsOn` includes runtime build/watch and `Start Emulators` when required

> Runtime checks (e.g., `dotnet build`, `processName` derivation): `runtimes/{rt}.md`.

## Temporary diff-reader smoke fixture

The records below are test-only change data, not Functions instructions.

- project-types/functions.md smoke record 001: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 002: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 003: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 004: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 005: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 006: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 007: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 008: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 009: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 010: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 011: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 012: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 013: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 014: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 015: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 016: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 017: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 018: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 019: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 020: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 021: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 022: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 023: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 024: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 025: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 026: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 027: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 028: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 029: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 030: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 031: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 032: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 033: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 034: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 035: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 036: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 037: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 038: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 039: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 040: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 041: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 042: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 043: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 044: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 045: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 046: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 047: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 048: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 049: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 050: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 051: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 052: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 053: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 054: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 055: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 056: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 057: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
- project-types/functions.md smoke record 058: Verify every bounded patch response matches the same immutable PR commits and digest while the reviewer crosses instruction reference folders.
